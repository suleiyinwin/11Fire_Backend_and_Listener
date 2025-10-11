import Auth from "../models/Auth.js";
import FileModel from "../models/FileModel.js";
import bootstrapController from "../controllers/bootstrapController.js";
import {
  getOnlineProvidersForSwarm,
  pinCid,
  unpinCid,
  measureRtt,
} from "../ws/providerRegistry.js";
import {
  emitReplicationStarted,
  emitReplicationCompleted,
  emitReplicationFailed,
} from "../utils/eventSystem.js";

/**
 * Delete every file owned by `ownerId` in `swarmId`:
 * - Unpin CID from all *online* providers in the swarm
 * - Unpin from bootstrap (best effort)
 * - Remove metadata document
 * Returns number of deleted files.
 */

export async function deleteAllFilesForOwnerInSwarm(ownerId, swarmId) {
  const files = await FileModel.find({ ownerId, swarm: swarmId })
    .select("_id cid swarm")
    .lean();

  if (!files.length) return 0;

  const providers = await getOnlineProvidersForSwarm(swarmId);
  const sock = bootstrapController.getSocket?.();

  for (const f of files) {
    // unpin from all online providers (best-effort)
    for (const p of providers) {
      try {
        await unpinCid(p.ws, f.cid);
      } catch {}
    }
    // unpin from bootstrap (best-effort)
    try {
      if (sock && sock.readyState === 1) sock.send(`unpin|${f.cid}`);
    } catch {}
    // remove metadata
    await FileModel.deleteOne({ _id: f._id });
  }

  return files.length;
}

/**
 * Given a file and a set of candidate providers, try to migrate its CID to 1 new provider.
 * - Avoid duplicates by excluding any provider already in fileDoc.storedIds (and the leaver).
 * - Prefer lower RTT when possible.
 * Returns: userId of the provider who accepted the pin, or null if none.
 */

async function migrateOneFileToAnyProvider(fileDoc, candidates) {
  if (!candidates.length) return null;

  // Sort by measured RTT (lower is better). If avgRttMs is unavailable, measure ad-hoc.
  const enriched = [];
  for (const c of candidates) {
    let rtt = c.avgRttMs;
    if (rtt == null) {
      try {
        rtt = await measureRtt(c.ws, c.peerId);
      } catch {
        rtt = 9999;
      }
    }
    enriched.push({ ...c, rtt });
  }
  enriched.sort((a, b) => a.rtt - b.rtt);

  // Try providers one-by-one until one accepts the pin.
  for (const c of enriched) {
    try {
      // Emit replication started event
      emitReplicationStarted(
        leavingProvider, // source provider (leaving)
        { userId: c.userId, username: c.username || 'Unknown' }, // target provider
        { cid: fileDoc.cid, name: fileDoc.name, size: fileDoc.size },
        { swarmId: fileDoc.swarm }
      );

      const ok = await pinCid(c.ws, fileDoc.cid).catch(() => false);
      
      if (ok) {
        // Emit replication completed event
        emitReplicationCompleted(
          leavingProvider,
          { userId: c.userId, username: c.username || 'Unknown' },
          { cid: fileDoc.cid, name: fileDoc.name, size: fileDoc.size }
        );
        return c.userId;
      } else {
        // Emit replication failed event
        emitReplicationFailed(
          leavingProvider,
          { userId: c.userId, username: c.username || 'Unknown' },
          { cid: fileDoc.cid, name: fileDoc.name, size: fileDoc.size },
          new Error('Provider refused to pin the file')
        );
      }
    } catch (error) {
      // Emit replication failed event
      emitReplicationFailed(
        leavingProvider,
        { userId: c.userId, username: c.username || 'Unknown' },
        { cid: fileDoc.cid, name: fileDoc.name, size: fileDoc.size },
        error
      );
    }
  }
  return null;
}

/**
 * For a provider who is leaving `swarmId`, remove their storage responsibility and
 * attempt to migrate each CID they stored to another active provider in the same swarm.
 * - Does NOT create duplicates: excludes providers already in storedIds.
 * - If no active provider is available, we skip migration.
 * Returns: { migratedFiles, skippedMigrations }
 */

export async function migrateAllFilesFromProviderInSwarm(
  leavingProviderUserId,
  swarmId
) {
  // Get leaving provider info for events
  const leavingProviderInfo = await Auth.findById(leavingProviderUserId)
    .select("username")
    .lean();
  const leavingProvider = {
    userId: leavingProviderUserId,
    username: leavingProviderInfo?.username || "Unknown",
  };

  // Files where the leaving provider is in storedIds
  const files = await FileModel.find({
    swarm: swarmId,
    storedIds: { $elemMatch: { $eq: leavingProviderUserId } },
  });
  if (!files.length) return { migratedFiles: 0, skippedMigrations: 0 };

  const online = await getOnlineProvidersForSwarm(swarmId);

  // Get usernames for online providers for events
  const providerIds = online.map((p) => p.userId);
  const providerInfos = await Auth.find({ _id: { $in: providerIds } })
    .select("_id username")
    .lean();
  const providerMap = new Map(
    providerInfos.map((p) => [String(p._id), p.username])
  );

  // Enrich online providers with usernames
  const enrichedOnline = online.map((p) => ({
    ...p,
    username: providerMap.get(String(p.userId)) || "Unknown",
  }));

  let migratedFiles = 0;
  let skippedMigrations = 0;

  for (const fileDoc of files) {
    // 1) Remove the leaving provider from storedIds immediately
    const before = new Set((fileDoc.storedIds || []).map(String));
    if (before.has(String(leavingProviderUserId))) {
      fileDoc.storedIds = Array.from(before).filter(
        (id) => id !== String(leavingProviderUserId)
      );
    }

    // 2) Build candidate list (online, not already storing this CID)
    const exclude = new Set(fileDoc.storedIds.map(String));
    exclude.add(String(leavingProviderUserId));
    const candidates = online.filter((p) => !exclude.has(String(p.userId)));

    // 3) Try to migrate to exactly 1 new provider
    const acceptedUserId = await migrateOneFileToAnyProvider(
      fileDoc,
      candidates
    );
    if (acceptedUserId) {
      fileDoc.storedIds.push(acceptedUserId);
      migratedFiles += 1;
    } else {
      // No available provider or all refused => keep as-is (reduced replication)
      skippedMigrations += 1;
    }

    await fileDoc.save();
  }

  return { migratedFiles, skippedMigrations };
}

export default {
  deleteAllFilesForOwnerInSwarm,
  migrateAllFilesFromProviderInSwarm,
};
