package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
	"time"
	"github.com/gorilla/websocket"
	"os/exec"
)

func main() {
	for {
		runListener()
		log.Println("Disconnected from backend, retrying in 5 seconds...")
		time.Sleep(5 * time.Second)
	}
}

func runListener() {
	// Connect to backend WebSocket server (bootstrap node endpoint)
	conn, _, err := websocket.DefaultDialer.Dial("ws://localhost:9091", nil)
	if err != nil {
		log.Println("Connection failed:", err)
		return
	}
	defer conn.Close()
	log.Println("Connected to backend")

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("read error:", err)
			break // trigger reconnect
		}

		msg := string(message)
		if strings.HasPrefix(msg, "upload|") {
			parts := strings.SplitN(msg, "|", 4)
			if len(parts) < 4 {
				log.Println("Invalid upload message format")
				continue
			}

			requestId := parts[1]
			filename := parts[2]
			filedata := parts[3]

			tempPath := "/tmp/" + filename
			err := saveBase64ToFile(filedata, tempPath)
			if err != nil {
				log.Println("File write error:", err)
				continue
			}

			cid, err := uploadToIPFS(tempPath)
			if err != nil {
				log.Println("IPFS upload failed:", err)
				continue
			}

			conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("cid|%s|%s", requestId, cid)))
			log.Println("Uploaded to IPFS, CID:", cid)

			os.Remove(tempPath)
		}
	}
}

func saveBase64ToFile(encoded, path string) error {
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}

func uploadToIPFS(path string) (string, error) {
	out, err := exec.Command("ipfs", "add", "-Q", path).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
