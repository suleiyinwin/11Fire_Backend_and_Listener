import ProviderModel from '../models/providerModel.js';
import * as broadcaster from '../utils/broadcaster.js';

// Check for dead peers and trigger CID replication if needed
export async function replicateIfDead() {
    const providers = ProviderModel.getAll();
    const now = Date.now();

    for (const [ws, info] of providers.entries()) {
        const { lastSeen, cids: lostCIDs, id } = info;

        // Detect offline peers
        if (now - lastSeen > REPLICATION_INTERVAL) {
            console.log(`${id} is offline (no response in 3s)`);

            // Get online peers for replication
            const otherProviders = Array.from(providers.entries()).filter(
                ([otherWs, otherInfo]) =>
                    otherWs !== ws && (now - otherInfo.lastSeen < REPLICATION_INTERVAL)
            );

            if (otherProviders.length === 0) {
                console.log(`No other providers online to replicate CIDs from ${id}`);
                broadcaster.broadcastDisconnect(ws.server, id);
                ProviderModel.delete(ws);
                continue;
            }

            const [targetWs, targetInfo] = otherProviders[0];
            const missingCIDs = lostCIDs.filter(cid => !targetInfo.cids.includes(cid));

            if (missingCIDs.length === 0) {
                console.log(`No missing CIDs to replicate`);
                broadcaster.broadcastDisconnect(ws.server, id);
                ProviderModel.delete(ws);
                continue;
            }

            // Request replication by sending pin commands to the target
            for (const cid of missingCIDs) {
                if (cid.trim() !== "") {
                    console.log(`Sending pin|${cid} to ${targetInfo.id}`);
                    targetWs.send(`pin|${cid}`);
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            broadcaster.broadcastDisconnect(ws.server, id);
            ProviderModel.delete(ws);
        }
    }
}
