package main

import (
	"encoding/base64"
	"fmt"
	"io/ioutil"
	"log"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

const backendHost = "localhost:9091"   
const backendPath = "/"               
const reconnectDelay = 3 * time.Second

func getPeerID() (string, error) {
	cmd := exec.Command("ipfs", "id", "-f", "<id>")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func uploadToIPFS(data []byte) (string, error) {
	tmp, err := ioutil.TempFile("", "upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())

	if _, err := tmp.Write(data); err != nil {
		return "", err
	}
	tmp.Close()

	cmd := exec.Command("ipfs", "add", "-Q", tmp.Name())
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func handleConnection(conn *websocket.Conn, peerID string) {
	defer conn.Close()

	// Register with peer ID
	conn.WriteMessage(websocket.TextMessage, []byte("id|" + peerID))
	log.Println("Connected to backend as", peerID)

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			break
		}
		str := string(msg)

		// === Upload ===
		if strings.HasPrefix(str, "upload|") {
			parts := strings.SplitN(str, "|", 4)
			if len(parts) < 4 {
				log.Println("Invalid upload message")
				continue
			}
			requestId := parts[1]
			base64Data := parts[3]
			data, err := base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				log.Println("Base64 decode error:", err)
				continue
			}
			cid, err := uploadToIPFS(data)
			if err != nil {
				log.Println("IPFS upload failed:", err)
				continue
			}
			resp := fmt.Sprintf("cid|%s|%s", requestId, cid)
			conn.WriteMessage(websocket.TextMessage, []byte(resp))
			log.Printf("Uploaded file -> CID: %s\n", cid)

		// === Download ===
		} else if strings.HasPrefix(str, "download|") {
			parts := strings.Split(str, "|")
			if len(parts) != 3 {
				log.Println("Invalid download request")
				continue
			}
			requestId := parts[1]
			cid := parts[2]

			cmd := exec.Command("ipfs", "cat", cid)
			out, err := cmd.Output()
			if err != nil {
				log.Println("ipfs cat failed:", err)
				continue
			}

			encoded := base64.StdEncoding.EncodeToString(out)
			resp := fmt.Sprintf("file|%s|%s", requestId, encoded)
			conn.WriteMessage(websocket.TextMessage, []byte(resp))
			log.Printf("Served download for CID %s", cid)

		// === Unpin + GC ===
		} else if strings.HasPrefix(str, "unpin|") {
			cid := strings.TrimPrefix(str, "unpin|")

			rm := exec.Command("ipfs", "pin", "rm", cid)
			if out, err := rm.CombinedOutput(); err != nil {
				log.Printf("pin rm failed: %v\n%s", err, string(out))
			} else {
				log.Println("Unpinned:", cid)
			}

			gc := exec.Command("ipfs", "repo", "gc")
			if out, err := gc.CombinedOutput(); err != nil {
				log.Printf("gc failed: %v\n%s", err, string(out))
			} else {
				log.Println("Ran GC")
			}
		}
	}
}

func connectForever() {
	for {
		u := url.URL{Scheme: "ws", Host: backendHost, Path: backendPath}
		log.Println("Connecting to", u.String())

		conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
		if err != nil {
			log.Println("Dial failed:", err)
			time.Sleep(reconnectDelay)
			continue
		}

		peerID, err := getPeerID()
		if err != nil {
			log.Println("Peer ID error:", err)
			conn.Close()
			time.Sleep(reconnectDelay)
			continue
		}

		handleConnection(conn, peerID)
		log.Println("Reconnecting in", reconnectDelay)
		time.Sleep(reconnectDelay)
	}
}

func main() {
	connectForever()
}
