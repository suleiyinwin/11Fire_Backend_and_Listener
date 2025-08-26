// bootstrap-listener/main.go
//
// Purpose:
//   Bootstrap agent that:
//   - Connects to backend WebSocket gateway for bootstrap (default ws://localhost:9091/).
//   - Performs IPFS ingest on request from backend:
//       upload|<reqId>|<name>|<base64>  -> cid|<reqId>|<cid>
//       download|<reqId>|<cid>          -> file|<reqId>|<base64>
//       unpin|<cid>                     -> ok|unpin|<cid> or err|unpin|<cid>|<msg>
//       hb|<nonce>                      -> hb|<nonce> (for uniformity)
//   - `PIN_ON_BOOTSTRAP=false` by default (does not keep a replica on bootstrap).
//
// Build:
//   go build -o bootstrap-listener .
// Cross-compile examples:
//   GOOS=darwin GOARCH=arm64 go build -o bootstrap-listener .
//   GOOS=linux  GOARCH=amd64 go build -o bootstrap-listener .
//
// Runtime ENV (all optional):
//   BOOTSTRAP_WS_URL   (default "ws://localhost:9091/")   // e.g. "wss://<sub>.ngrok-free.app/"
//   IPFS_BIN           (default "ipfs")
//   PIN_ON_BOOTSTRAP   (default "false")                  // "true" to keep a pin on bootstrap
//
// ngrok tip:
//   ngrok http 9091 --domain=<sub>.ngrok-free.app
//   export BOOTSTRAP_WS_URL="wss://<sub>.ngrok-free.app/"
//   The client adds header "ngrok-skip-browser-warning: 1" automatically.

package main

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// ---------- Config ----------
var backendWSURL = getenv("BOOTSTRAP_WS_URL", "ws://localhost:9091/")
var ipfsBin = getenv("IPFS_BIN", "ipfs")
var pinOnBootstrap = strings.EqualFold(getenv("PIN_ON_BOOTSTRAP", "false"), "true")

const reconnectDelay = 3 * time.Second

func main() {
	connectForever()
}

func connectForever() {
	for {
		u, err := url.Parse(backendWSURL)
		if err != nil {
			log.Println("[bootstrap] Bad BOOTSTRAP_WS_URL:", err)
			time.Sleep(reconnectDelay)
			continue
		}
		log.Println("[bootstrap] Connecting to", u.String())

		// Send headers helpful for ngrok HTTPS tunnels.
		hdr := http.Header{}
		hdr.Set("ngrok-skip-browser-warning", "1")
		hdr.Set("Origin", "https://"+u.Host) // harmless for ws:// too

		dialer := websocket.Dialer{
			Proxy:             http.ProxyFromEnvironment,
			HandshakeTimeout:  15 * time.Second,
			EnableCompression: false,
		}

		conn, resp, err := dialer.Dial(u.String(), hdr)
		if err != nil {
			if resp != nil {
				body, _ := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				log.Printf("[bootstrap] Dial failed: %v (status=%d) body=%s", err, resp.StatusCode, string(body))
			} else {
				log.Println("[bootstrap] Dial failed:", err)
			}
			time.Sleep(reconnectDelay)
			continue
		}

		peerID, err := getPeerID()
		if err != nil {
			log.Println("[bootstrap] Peer ID error:", err)
			conn.Close()
			time.Sleep(reconnectDelay)
			continue
		}

		handleConnection(conn, peerID)
		log.Println("[bootstrap] Reconnecting in", reconnectDelay)
		time.Sleep(reconnectDelay)
	}
}

func handleConnection(conn *websocket.Conn, peerID string) {
	defer conn.Close()

	// Register with peer ID
	_ = conn.WriteMessage(websocket.TextMessage, []byte("id|"+peerID))
	log.Println("[bootstrap] Connected to backend as", peerID)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("[bootstrap] Read error:", err)
			break
		}
		str := string(msg)

		switch {
		case strings.HasPrefix(str, "hb|"):
			nonce := strings.TrimPrefix(str, "hb|")
			_ = conn.WriteMessage(websocket.TextMessage, []byte("hb|"+nonce))

		case strings.HasPrefix(str, "upload|"):
			handleUpload(conn, str)

		case strings.HasPrefix(str, "download|"):
			handleDownload(conn, str)

		case strings.HasPrefix(str, "unpin|"):
			cid := strings.TrimPrefix(str, "unpin|")
			out, err := exec.Command(ipfsBin, "pin", "rm", cid).CombinedOutput()
			if err != nil {
				_ = conn.WriteMessage(websocket.TextMessage,
					[]byte(fmt.Sprintf("err|unpin|%s|%s", cid, strings.TrimSpace(string(out)))))
			} else {
				_ = conn.WriteMessage(websocket.TextMessage, []byte("ok|unpin|"+cid))
			}
		}
	}
}

// upload|<reqId>|<name>|<base64>
func handleUpload(conn *websocket.Conn, msg string) {
	parts := strings.SplitN(msg, "|", 4)
	if len(parts) < 4 {
		log.Println("[bootstrap] Invalid upload message")
		return
	}
	reqId := parts[1]
	// name := parts[2]  // kept for future on-disk naming; not required by IPFS add
	b64 := parts[3]

	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		log.Println("[bootstrap] Base64 decode error:", err)
		return
	}

	cid, err := addToIPFS(data)
	if err != nil {
		log.Println("[bootstrap] IPFS add failed:", err)
		return
	}
	resp := fmt.Sprintf("cid|%s|%s", reqId, cid)
	_ = conn.WriteMessage(websocket.TextMessage, []byte(resp))
	log.Printf("[bootstrap] Uploaded -> CID: %s\n", cid)
}

// download|<reqId>|<cid>
func handleDownload(conn *websocket.Conn, msg string) {
	parts := strings.Split(msg, "|")
	if len(parts) != 3 {
		log.Println("[bootstrap] Invalid download request")
		return
	}
	reqId := parts[1]
	cid := parts[2]

	out, err := exec.Command(ipfsBin, "cat", cid).Output()
	if err != nil {
		log.Println("[bootstrap] ipfs cat failed:", err)
		return
	}
	encoded := base64.StdEncoding.EncodeToString(out)
	resp := fmt.Sprintf("file|%s|%s", reqId, encoded)
	_ = conn.WriteMessage(websocket.TextMessage, []byte(resp))
	log.Printf("[bootstrap] Served download for CID %s", cid)
}

func addToIPFS(data []byte) (string, error) {
	tmpDir := os.TempDir()
	tmpPath := filepath.Join(tmpDir, fmt.Sprintf("upload-%d.bin", time.Now().UnixNano()))
	if err := os.WriteFile(tmpPath, data, 0600); err != nil {
		return "", err
	}
	defer os.Remove(tmpPath)

	args := []string{"add", "-Q", tmpPath}
	if !pinOnBootstrap {
		args = []string{"add", "--pin=false", "-Q", tmpPath}
	}
	out, err := exec.Command(ipfsBin, args...).Output()
	if err != nil {
		return "", fmt.Errorf("ipfs add failed: %w | %s", err, strings.TrimSpace(string(out)))
	}
	return strings.TrimSpace(string(out)), nil
}

func getPeerID() (string, error) {
	out, err := exec.Command(ipfsBin, "id", "-f=<id>").CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("ipfs id failed: %v | %s", err, string(out))
	}
	peerID := strings.TrimSpace(string(out))
	if peerID == "" {
		return "", fmt.Errorf("empty PeerID from 'ipfs id'")
	}
	return peerID, nil
}

func getenv(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}
