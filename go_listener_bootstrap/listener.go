package main

import (
    "log"
    "os/exec"
    "strings"
    "time"
    "github.com/gorilla/websocket"
)

var backendURL = "ws://10.4.56.85:9090"

func connectToBackend() {
    for {
        log.Println("Connecting to backend...")

        conn, _, err := websocket.DefaultDialer.Dial(backendURL, nil)
        if err != nil {
            log.Println("Connection failed, retrying in 3 seconds:", err)
            time.Sleep(3 * time.Second)
            continue
        }

        log.Println("Connected to backend!")

        // Send PeerID after connecting
        out, err := exec.Command("ipfs", "id", "-f=<id>").CombinedOutput()
        if err != nil {
            log.Println("Failed to get PeerID:", err)
        } else {
            peerID := strings.TrimSpace(string(out))
            conn.WriteMessage(websocket.TextMessage, []byte("id|" + peerID))
        }

        for {
            _, message, err := conn.ReadMessage()
            if err != nil {
                log.Println("Lost connection to backend. Reconnecting...")
                break
            }

            msg := string(message)
            log.Println("Received command:", msg)

            if msg == "ping" {
                out, err := exec.Command("ipfs", "pin", "ls", "--type=recursive").CombinedOutput()
                if err != nil {
                    conn.WriteMessage(websocket.TextMessage, []byte("cids|error"))
                } else {
                    lines := strings.Split(string(out), "\n")
                    var cids []string
                    for _, line := range lines {
                        parts := strings.Fields(line)
                        if len(parts) > 0 {
                            cids = append(cids, parts[0])
                        }
                    }
                    response := "cids|" + strings.Join(cids, ",")
                    conn.WriteMessage(websocket.TextMessage, []byte(response))
                }
                continue
            }

            if strings.HasPrefix(msg, "pin|") {
                cid := msg[4:]
                log.Println("Pinning CID:", cid)

                // Attempt to fetch before pinning
                fetchCmd := exec.Command("ipfs", "get", cid)
                fetchOut, fetchErr := fetchCmd.CombinedOutput()
                if fetchErr != nil {
                    log.Println("Failed to fetch CID:", fetchErr)
                    conn.WriteMessage(websocket.TextMessage, []byte("Error: fetch failed " + string(fetchOut)))
                    continue
                }

                out, err := exec.Command("ipfs", "pin", "add", cid).CombinedOutput()
                response := "Success: " + string(out)
                if err != nil {
                    response = "Error: " + err.Error()
                }

                conn.WriteMessage(websocket.TextMessage, []byte(response))
                continue
            }

            if strings.HasPrefix(msg, "unpin|") {
                cid := msg[6:]
                log.Println("Unpinning CID:", cid)

                out, err := exec.Command("ipfs", "pin", "rm", cid).CombinedOutput()
                response := "Success: " + string(out)
                if err != nil {
                    response = "Error: " + err.Error()
                }

                conn.WriteMessage(websocket.TextMessage, []byte(response))
                continue
            }
        }

        conn.Close()
        log.Println("Reconnecting in 5 seconds...")
        time.Sleep(5 * time.Second)
    }
}

func main() {
    connectToBackend()
}
