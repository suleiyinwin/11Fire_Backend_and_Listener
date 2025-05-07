import ProviderModel from '../models/providerModel.js';
import * as broadcaster from '../utils/broadcaster.js';
import { replicateIfDead } from '../services/replicationService.js';

let providerCounter = 0;

// Handles a new WebSocket connection
function handleConnection(ws, wss) {
    let tempID = `provider_${++providerCounter}`;
    console.log(`Temporary connection from ${tempID}`);

    // Initialize provider metadata
    const providerInfo = {
        id: tempID,
        lastSeen: Date.now(),
        cids: []
    };

    ProviderModel.set(ws, providerInfo);

    // Wait for the peer ID from the client
    ws.once('message', (msg) => {
        const str = msg.toString();
        if (str.startsWith("id|")) {
            providerInfo.id = str.slice(3);
            console.log(`Registered storage provider: ${providerInfo.id}`);
        }
    });

    // Periodic heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
        try {
            ws.send("ping");
        } catch (err) {
            console.log(`Error pinging ${providerInfo.id}:`, err.message);
        }
    }, PING_INTERVAL);

    // Check provider liveness every - seconds
    setInterval(() => {
        replicateIfDead();
    }, REPLICATION_INTERVAL);


    // Handle incoming messages from the client
    ws.on('message', (message) => {
        const msg = message.toString();

        if (msg.startsWith("cids|")) {
            const cidList = msg.slice(5).split(",");
            providerInfo.lastSeen = Date.now();

            // Update provider CIDs and broadcast
            if (cidList.length > 0 && cidList[0] !== "error" && cidList[0].trim() !== "") {
                providerInfo.cids = cidList;
                console.log(`${providerInfo.id} has pinned:`, cidList);
                broadcaster.broadcastUpdate(wss, providerInfo.id, cidList);
            } else {
                console.log(`${providerInfo.id} failed to report pinned CIDs or returned empty list`);
            }
        } else {
            console.log(`Response from ${providerInfo.id}:`, msg);
        }
    });

    // Handle client disconnect
    ws.on('close', () => {
        console.log(`${providerInfo.id} disconnected`);
        clearInterval(heartbeat);
        broadcaster.broadcastDisconnect(wss, providerInfo.id);
    });
}


export default { handleConnection };
