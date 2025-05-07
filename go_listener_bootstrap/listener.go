package main

import (
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"strings"
	"github.com/gorilla/websocket"
	"os/exec"
)

func main() {
	conn, _, err := websocket.DefaultDialer.Dial("ws://localhost:9091", nil)
	if err != nil {
		log.Fatal("dial:", err)
	}
	defer conn.Close()
	log.Println("Connected to backend")

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("read:", err)
			break
		}

		msg := string(message)
		if strings.HasPrefix(msg, "upload|") {
			parts := strings.SplitN(msg, "|", 4)
			if len(parts) < 4 {
				log.Println("invalid upload message format")
				continue
			}

			requestId := parts[1]
			filename := parts[2]
			filedata := parts[3]

			tempPath := "/tmp/" + filename
			err := saveBase64ToFile(filedata, tempPath)
			if err != nil {
				log.Println("file write error:", err)
				continue
			}

			cid, err := uploadToIPFS(tempPath)
			if err != nil {
				log.Println("ipfs upload failed:", err)
				continue
			}

			conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("cid|%s|%s", requestId, cid)))
			log.Println("Sent CID:", cid)

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