import ProviderModel from '../models/providerModel.js';
import Swarm from '../models/Swarm.js';
import Auth from '../models/Auth.js';
import * as broadcaster from '../utils/broadcaster.js';
import { replicateIfDead } from '../services/replicationService.js';

let providerCounter = 0;
const providerMap = new Map();

// Handles a new WebSocket connection
function handleConnection(ws, wss) {
    let tempID = `provider_${++providerCounter}`;
    console.log(`Temporary connection from ${tempID}`);

    // Initialize temporary provider metadata
    const providerInfo = {
        id: tempID,
        lastSeen: Date.now(),
        cids: [],
        swarms: []
    };

    providerMap.set(ws, providerInfo);

    // Wait for the peer ID from the client
    ws.once('message', async (msg) => {
        const str = msg.toString();

        if (str.startsWith('id|')) {
            const peerID = str.split('|')[1];
            console.log(`Received PeerID: ${peerID}`);

            // Look up provider in Auth collection
            const authDoc = await Auth.findOne({ peerId: peerID }).select('swarms');
            if (!authDoc) {
                console.log(`No Auth user found for PeerID: ${peerID}`);
                return;
            }

            const swarmIds = authDoc.swarms.map(id => id.toString());

            providerMap.set(ws, {
                id: peerID,
                lastSeen: Date.now(),
                cids: [],
                swarms: swarmIds
            });

            console.log(`Provider ${peerID} is part of swarms:`, swarmIds);
        }
    });

    ws.on('message', async (msg) => {
        const str = msg.toString();
        const provider = providerMap.get(ws);
        if (!provider) return;

        provider.lastSeen = Date.now();

        if (str.startsWith('cids|')) {
            const cids = str.split('|')[1].split(',');
            provider.cids = cids;
            providerMap.set(ws, provider);
        }

        // Handle additional commands here if needed
    });

    ws.on('close', () => {
        console.log(`Connection closed for ${providerInfo.id}`);
        providerMap.delete(ws);
    });
}

export default { handleConnection, providerMap };
