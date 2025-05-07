// Notify all clients about CID update
export function broadcastUpdate(wss, id, cids) {
    const data = JSON.stringify({ type: "update", id, cids });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(data);
    });
}

// Notify all clients about provider disconnect
export function broadcastDisconnect(wss, id) {
    const data = JSON.stringify({ type: "disconnect", id });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(data);
    });
}