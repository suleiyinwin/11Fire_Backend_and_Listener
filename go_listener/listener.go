// provider-listener/main.go
//
// Purpose:
//   Headless provider agent that:
//   - Claims a peerId with the backend via HTTP (one-time, using provider.token).
//   - Holds a long-lived WebSocket to backend (default ws://localhost:9090).
//   - Responds to:
//       hb|<nonce>        -> echoes hb|<nonce>    (cheap RTT / heartbeat)
//       ping              -> lists recursive pins (cids|cid1,cid2,...)
//       pin|<cid>         -> ok|pin|<cid> or err|pin|<cid>|<msg>
//       unpin|<cid>       -> ok|unpin|<cid> or err|unpin|<cid>|<msg>
//
// Build:
//   go build -o provider-listener .
// Cross-compile examples:
//   GOOS=darwin GOARCH=arm64 go build -o provider-listener .
//   GOOS=linux  GOARCH=amd64 go build -o provider-listener .
//
// Runtime ENV (all optional):
//   IPFS_BIN           (default "ipfs")
//   DELETE_TOKEN_AFTER (default "false")
//
// Files next to the binary:
//   provider.token   // one-line, plaintext token issued by backend
//
// Notes:
//   - We DO NOT call `ipfs get` before pinning (avoids disk writes). `ipfs pin add` will fetch blocks.
//   - Replies include the CID so the backend can safely correlate concurrent operations.

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ---------- Config ----------
var backendHTTP = getenv("BACKEND_HTTP_URL", "https://elevenfire.azurewebsites.net")
var backendWS = getenv("BACKEND_WS_URL", "wss://elevenfire.azurewebsites.net/ws/provider")
var ipfsBin = getenv("IPFS_BIN", "ipfs")
var deleteTokenAfterClaim = strings.EqualFold(getenv("DELETE_TOKEN_AFTER", "false"), "true")

func main() {
	exeDir := mustExeDir()

	// 1) Load one-time provider claim token
	tokenPath := filepath.Join(exeDir, "provider.token")
	token, err := readOneLine(tokenPath)
	if err != nil {
		fatal("Missing provider.token:\n" + err.Error())
	}

	// 2) Discover local IPFS peerId (Kubo daemon must be running)
	peerID, err := getPeerID()
	if err != nil {
		fatal("Failed to get IPFS PeerID. Ensure IPFS daemon is running.\n" + err.Error())
	}
	log.Println("[provider] Local PeerID:", peerID)

	// 2.1) Test IPFS daemon responsiveness
	if err := testIPFSConnection(); err != nil {
		log.Printf("[provider] Warning: IPFS daemon may be slow: %v", err)
	}

	// 3) Claim with backend over HTTP (binds this peerId to your user)
	if err := claimPeerID(token, peerID); err != nil {
		fatal("PeerID claim failed: " + err.Error())
	}
	log.Println("[provider] PeerID claimed successfully")

	if deleteTokenAfterClaim {
		_ = os.Remove(tokenPath)
	}

	// 4) Connect WS and serve commands
	connectWSAndServe(peerID)
}

// ---------- HTTP claim ----------
func claimPeerID(token, peerID string) error {
	body := map[string]string{"token": token, "peerId": peerID}
	buf, _ := json.Marshal(body)
	url := strings.TrimRight(backendHTTP, "/") + "/providers/claim"

	req, _ := http.NewRequest("POST", url, bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP POST failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("server returned HTTP %d", resp.StatusCode)
	}
	return nil
}

// ---------- WS loop ----------
func connectWSAndServe(peerID string) {
	const reconnectDelay = 3 * time.Second

	for {
		log.Println("[provider] Connecting WS ->", backendWS)

		// Use proper dialer like bootstrap
		dialer := websocket.Dialer{
			Proxy:             http.ProxyFromEnvironment,
			HandshakeTimeout:  15 * time.Second,
			EnableCompression: false,
		}

		conn, resp, err := dialer.Dial(backendWS, nil)
		if err != nil {
			if resp != nil {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				log.Printf("[provider] Dial failed: %v (status=%d) body=%s", err, resp.StatusCode, string(body))
			} else {
				log.Println("[provider] Dial failed:", err)
			}
			time.Sleep(reconnectDelay)
			continue
		}

		handleProviderConnection(conn, peerID)
		log.Println("[provider] Reconnecting in", reconnectDelay)
		time.Sleep(reconnectDelay)
	}
}

func handleProviderConnection(conn *websocket.Conn, peerID string) {
	defer conn.Close()

	// Register with peer ID
	_ = conn.WriteMessage(websocket.TextMessage, []byte("id|"+peerID))
	log.Println("[provider] Connected to backend as", peerID)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("[provider] Read error:", err)
			break
		}

		text := string(msg)
		switch {
		case strings.HasPrefix(text, "hb|"):
			// cheap heartbeat: echo nonce for RTT
			nonce := strings.TrimPrefix(text, "hb|")
			if err := conn.WriteMessage(websocket.TextMessage, []byte("hb|"+nonce)); err != nil {
				log.Println("[provider] Failed to send heartbeat:", err)
				return
			}

		case text == "ping":
			handlePing(conn)

		case strings.HasPrefix(text, "pin|"):
			handlePin(conn, strings.TrimPrefix(text, "pin|"))

		case strings.HasPrefix(text, "unpin|"):
			handleUnpin(conn, strings.TrimPrefix(text, "unpin|"))
		}
	}
}

func handlePing(conn *websocket.Conn) {
	// NOTE: This is heavier than hb|, but kept for compatibility.
	out, err := exec.Command(ipfsBin, "pin", "ls", "--type=recursive").CombinedOutput()
	if err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("cids|error"))
		return
	}
	lines := strings.Split(string(out), "\n")
	var cids []string
	for _, line := range lines {
		parts := strings.Fields(line)
		if len(parts) > 0 {
			cids = append(cids, parts[0])
		}
	}
	_ = conn.WriteMessage(websocket.TextMessage, []byte("cids|"+strings.Join(cids, ",")))
}

func handlePin(conn *websocket.Conn, cid string) {
	log.Printf("[provider] Pinning CID: %s", cid)

	// Quick IPFS health check - if this fails after 5+ minutes, IPFS daemon is likely stuck
	healthCmd := exec.Command(ipfsBin, "version")
	if _, err := healthCmd.CombinedOutput(); err != nil {
		log.Printf("[provider] IPFS daemon health check failed: %v", err)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: IPFS daemon unresponsive"))
		return
	}

	// 30 second timeout for provider pin operations (testing)
	cmd := exec.Command(ipfsBin, "pin", "add", "--recursive", "--timeout=30s", cid)
	out, err := cmd.CombinedOutput()

	if err != nil {
		errorMsg := strings.TrimSpace(string(out))
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		log.Printf("[provider] Pin failed for %s: %s", cid, errorMsg)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: "+errorMsg))
		return
	}

	log.Printf("[provider] Pin successful for %s", cid)
	_ = conn.WriteMessage(websocket.TextMessage, []byte("Success: "+strings.TrimSpace(string(out))))
}

func handleUnpin(conn *websocket.Conn, cid string) {
	log.Printf("[provider] Unpinning CID: %s", cid)

	cmd := exec.Command(ipfsBin, "pin", "rm", "--timeout=30s", cid)
	out, err := cmd.CombinedOutput()

	if err != nil {
		errorMsg := strings.TrimSpace(string(out))
		if errorMsg == "" {
			errorMsg = err.Error()
		}
		log.Printf("[provider] Unpin failed for %s: %s", cid, errorMsg)
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: "+errorMsg))
		return
	}

	log.Printf("[provider] Unpin successful for %s", cid)
	_ = conn.WriteMessage(websocket.TextMessage, []byte("Success: "+strings.TrimSpace(string(out))))
}

// ---------- Helpers ----------
func readOneLine(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	tok := strings.TrimSpace(string(b))
	if tok == "" {
		return "", errors.New("provider.token is empty")
	}
	return tok, nil
}

func getPeerID() (string, error) {
	out, err := exec.Command(ipfsBin, "id", "-f=<id>").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("ipfs id failed: %v | %s", err, string(out))
	}
	peerID := strings.TrimSpace(string(out))
	if peerID == "" {
		return "", errors.New("empty PeerID from 'ipfs id'")
	}
	return peerID, nil
}

func testIPFSConnection() error {
	// Quick test of IPFS daemon responsiveness with 5s timeout
	cmd := exec.Command(ipfsBin, "version")
	cmd.Dir = "/"

	done := make(chan error, 1)
	go func() {
		_, err := cmd.Output()
		done <- err
	}()

	select {
	case err := <-done:
		return err
	case <-time.After(5 * time.Second):
		return fmt.Errorf("IPFS daemon not responding within 5s")
	}
}

func mustExeDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func getenv(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func fatal(msg string) {
	log.Println(msg)
	time.Sleep(300 * time.Millisecond)
	os.Exit(1)
}
