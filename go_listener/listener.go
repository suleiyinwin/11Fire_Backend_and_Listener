// Build: GOOS=darwin GOARCH=arm64 go build -o listener main.go    // Apple Silicon
//        GOOS=darwin GOARCH=amd64 go build -o listener main.go    // Intel Mac
//
// Distribute two files together:
//   - listener         (this binary)
//   - provider.token   (ONE line: 11fire_ptok_...)
// The app reads provider.token from the SAME folder, claims once, then WS-connects.

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// --- Config (override with env if needed) ---
var backendHTTP = getenv("BACKEND_HTTP_URL", "http://localhost:3001")
var backendWS   = getenv("BACKEND_WS_URL",   "ws://localhost:9090")
var ipfsBin     = getenv("IPFS_BIN", "ipfs") // set to absolute path if not on PATH

// Delete token file after successful claim? flip to true for production.
const deleteTokenAfterClaim = false

func main() {
	exeDir := mustExeDir()

	// 1) Read one‑time token from file next to the binary
	tokenPath := filepath.Join(exeDir, "provider.token")
	token, err := readToken(tokenPath)
	if err != nil {
		fatal("Missing provider.token\nPut a file named 'provider.token' next to the app with your token on a single line.\nError: " + err.Error())
	}

	// 2) Get local IPFS PeerID (requires Kubo IPFS installed & daemon running)
	peerID, err := getPeerID()
	if err != nil {
		fatal("Failed to get IPFS PeerID. Ensure IPFS is installed and the daemon is running.\n" + err.Error())
	}
	log.Println("Local PeerID:", peerID)

	// 3) One‑time claim with backend
	if err := claimPeerID(token, peerID); err != nil {
		fatal("PeerID claim failed: " + err.Error())
	}
	log.Println("PeerID claimed successfully")

	if deleteTokenAfterClaim {
		_ = os.Remove(tokenPath)
	}

	// 4) Long‑lived WS loop (ping / pin / unpin)
	connectWSAndServe(peerID)
}

// --- Claim flow ---

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

// --- WS loop ---

func connectWSAndServe(peerID string) {
	for {
		log.Println("Connecting WS…")
		conn, _, err := websocket.DefaultDialer.Dial(backendWS, nil)
		if err != nil {
			log.Println("WS connect failed; retrying in 3s:", err)
			time.Sleep(3 * time.Second)
			continue
		}
		log.Println("WS connected")
		_ = conn.WriteMessage(websocket.TextMessage, []byte("id|"+peerID))

		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				log.Println("WS lost; reconnecting:", err)
				break
			}
			text := string(msg)
			log.Println("Received:", text)

			switch {
			case text == "ping":
				handlePing(conn)
			case strings.HasPrefix(text, "pin|"):
				handlePin(conn, strings.TrimPrefix(text, "pin|"))
			case strings.HasPrefix(text, "unpin|"):
				handleUnpin(conn, strings.TrimPrefix(text, "unpin|"))
			}
		}

		_ = conn.Close()
		time.Sleep(5 * time.Second)
	}
}

func handlePing(conn *websocket.Conn) {
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
	log.Println("Pinning:", cid)
	// optional warm-up fetch
	if out, err := exec.Command(ipfsBin, "get", cid).CombinedOutput(); err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: fetch failed "+string(out)))
		return
	}
	if out, err := exec.Command(ipfsBin, "pin", "add", cid).CombinedOutput(); err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
	} else {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Success: "+string(out)))
	}
}

func handleUnpin(conn *websocket.Conn, cid string) {
	log.Println("Unpinning:", cid)
	if out, err := exec.Command(ipfsBin, "pin", "rm", cid).CombinedOutput(); err != nil {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Error: "+err.Error()))
	} else {
		_ = conn.WriteMessage(websocket.TextMessage, []byte("Success: "+string(out)))
	}
}

// --- Helpers ---

func readToken(path string) (string, error) {
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
