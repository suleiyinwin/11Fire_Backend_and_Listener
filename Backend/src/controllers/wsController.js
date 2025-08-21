import ProviderModel from '../models/providerModel.js';
import Swarm from '../models/Swarm.js';
import Auth from '../models/Auth.js';
import FileModel from '../models/FileModel.js';
import * as broadcaster from '../utils/broadcaster.js';
import { WebSocketServer } from 'ws';

// --- Simulator WebSocket Setup ---
const simulatorWSS = new WebSocketServer({ port: 9092 });
const simulatorClients = new Set();
simulatorWSS.on('connection', (ws) => {
    simulatorClients.add(ws);
    ws.on('close', () => simulatorClients.delete(ws));
});
function broadcastToSimulator(data) {
    const message = JSON.stringify(data);
    for (const client of simulatorClients) {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    }
}

let providerCounter = 0;
const providerMap = new Map();

// Heartbeat monitor every second
setInterval(() => {
    const now = Date.now();
    for (const [ws, provider] of providerMap.entries()) {
        if (ws.readyState !== ws.OPEN) continue;

        if (provider.lastPing && (now - provider.lastPong > 3000)) {
            console.log(`Provider ${provider.id} missed pong. Assuming offline.`);
            providerMap.delete(ws);
            ws.terminate();
            replicateIfDead(provider);

            // Notify frontend simulator
            broadcastToSimulator({ type: 'disconnect', id: provider.id });
            continue;
        }

        try {
            ws.send('ping');
            provider.lastPing = now;
        } catch (err) {
            console.error(`Error sending ping to ${provider.id}`, err);
        }
    }
}, 1000);

function handleConnection(ws, wss) {
    let tempID = `provider_${++providerCounter}`;
    console.log(`Connection from ${tempID}`);

    const providerInfo = {
        id: tempID,
        lastSeen: Date.now(),
        lastPing: null,
        lastPong: null,
        cids: [],
        swarms: []
    };

    providerMap.set(ws, providerInfo);

    ws.on('message', async (msg) => {
        const str = msg.toString();
        let provider = providerMap.get(ws);
        const now = Date.now();

        if (str.startsWith('id|')) {
            const peerID = str.split('|')[1];
            const authDoc = await Auth.findOne({ peerId: peerID }).select('swarms username');

            if (!authDoc) {
                console.log(`No Auth user found for PeerID: ${peerID}`);
                return;
            }

            const swarmIds = authDoc.swarms.map(id => id.toString());
            provider = {
                id: peerID,
                lastSeen: now,
                lastPing: null,
                lastPong: null,
                cids: [],
                swarms: swarmIds,
                username: authDoc.username
            };

            providerMap.set(ws, provider);
            console.log(`Provider ${peerID} (${authDoc.username}) is part of swarms:`, swarmIds);
            return;
        }

        if (!provider) return;
        provider.lastSeen = now;

        if (str.startsWith('cids|')) {
            const cids = str.split('|')[1].split(',');
            provider.cids = cids;
            provider.lastPong = now;
            providerMap.set(ws, provider);

            const auth = await Auth.findOne({ peerId: provider.id }).select('username');
            console.log(`Incoming CIDs from ${provider.id}:`, cids);

            const files = await FileModel.find({ cid: { $in: cids } }).select('cid name');

            console.log(`Found ${files.length} matching files:`, files.map(f => f.name));

            


            // Broadcast with real username and file names
            broadcastToSimulator({
                type: 'update',
                id: provider.id,
                username: auth?.username || provider.id,
                files: files.map(f => ({ cid: f.cid, name: f.name }))
            });
        }
    });

    ws.on('close', () => {
        const provider = providerMap.get(ws);
        if (provider) {
            console.log(`Connection closed for ${provider.id}`);
            providerMap.delete(ws);
            replicateIfDead(provider);

            // Notify frontend simulator
            broadcastToSimulator({ type: 'disconnect', id: provider.id });
        }
    });
}

async function replicateIfDead(deadProvider) {
    console.log(`Evaluating replication for ${deadProvider.id}`);

    try {
        const auth = await Auth.findOne({ peerId: deadProvider.id });
        if (!auth) {
            console.log(`Auth not found for ${deadProvider.id}`);
            return;
        }

        for (const swarmId of deadProvider.swarms) {
            console.log(`Checking swarm ${swarmId}`);

            const otherProviders = Array.from(providerMap.entries())
                .filter(([_, info]) => info.swarms.includes(swarmId) && info.id !== deadProvider.id);

            console.log("Other providers in swarm:", otherProviders.map(([_, p]) => p.id));

            if (otherProviders.length === 0) {
                console.log(`No other providers in swarm ${swarmId}`);
                continue;
            }

            const files = await FileModel.find({ swarm: swarmId, storedIds: auth._id });
            console.log(`Found ${files.length} files for provider ${deadProvider.id} in swarm ${swarmId}`);

            for (const file of files) {
                let replicated = false;

                for (const [targetWs, targetInfo] of otherProviders) {
                    if (targetWs.readyState === targetWs.OPEN && !targetInfo.cids.includes(file.cid)) {
                        console.log(`Replicating CID ${file.cid} to provider ${targetInfo.id} in swarm ${swarmId}`);
                        try {
                            targetWs.send(`pin|${file.cid}`);
                            await FileModel.updateOne(
                                { _id: file._id },
                                { $addToSet: { storedIds: (await Auth.findOne({ peerId: targetInfo.id }))._id } }
                            );
                            replicated = true;
                            break;
                        } catch (err) {
                            console.error(`Failed to send pin command for ${file.cid} to ${targetInfo.id}:`, err);
                        }
                    }
                }

                if (!replicated) {
                    console.log(`No available open sockets to replicate CID ${file.cid}`);
                }
            }
        }
    } catch (err) {
        console.error('Error during replication:', err);
    }
}

export default { handleConnection, providerMap };
