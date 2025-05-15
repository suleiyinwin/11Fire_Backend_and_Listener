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

	"github.com/gorilla/websocket"
)

const backendURL = "ws://localhost:9091/bootstrap-ws"

func getPeerID() (string, error) {
	cmd := exec.Command("ipfs", "id", "-f", "<id>")
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func uploadToIPFS(data []byte) (string, error) {
	tmpFile, err := ioutil.TempFile("", "upload-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(data); err != nil {
		return "", err
	}
	tmpFile.Close()

	cmd := exec.Command("ipfs", "add", "-Q", tmpFile.Name())
	cidBytes, err := cmd.Output()
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(cidBytes)), nil
}

func main() {
	u := url.URL{Scheme: "ws", Host: "localhost:9091", Path: "/bootstrap-ws"}
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		log.Fatal("Dial error:", err)
	}
	defer conn.Close()

	// Send peer ID to backend
	peerID, err := getPeerID()
	if err != nil {
		log.Fatal("Peer ID error:", err)
	}
	conn.WriteMessage(websocket.TextMessage, []byte("id|"+peerID))
	fmt.Println("Connected to backend as:", peerID)

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			break
		}

		msg := string(message)
		if strings.HasPrefix(msg, "upload|") {
			parts := strings.SplitN(msg, "|", 4)
			if len(parts) < 4 {
				log.Println("Invalid upload message")
				continue
			}
			requestId := parts[1]
			filename := parts[2]
			base64Data := parts[3]

			data, err := base64.StdEncoding.DecodeString(base64Data)
			if err != nil {
				log.Println("Base64 decode error:", err)
				continue
			}

			cid, err := uploadToIPFS(data)
			if err != nil {
				log.Println("Upload to IPFS failed:", err)
				continue
			}

			response := fmt.Sprintf("cid|%s|%s", requestId, cid)
			conn.WriteMessage(websocket.TextMessage, []byte(response))
			log.Printf("Uploaded %s as %s\n", filename, cid)
		}
		if strings.HasPrefix(msg, "download|") {
  parts := strings.Split(msg, "|")
  if len(parts) != 3 {
    log.Println("Invalid download message")
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
  response := fmt.Sprintf("file|%s|%s", requestId, encoded)
  conn.WriteMessage(websocket.TextMessage, []byte(response))
}

	}
}
