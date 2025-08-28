import Auth from "../models/Auth.js";
import Swarm from "../models/Swarm.js";
import FileModel from "../models/FileModel.js";
import {
  uploadViaBootstrap,
  downloadViaBootstrap,
} from "./uploadController.js";
import {
  getOnlineProvidersForSwarm,
  measureRtt,
} from "../ws/providerRegistry.js";

/** Sum of bytes a provider stores within one swarm (based on FileModel) */
async function usedBytesInSwarm(providerUserId, swarmId) {
  const r = await FileModel.aggregate([
    {
      $match: {
        swarm: swarmId,
        storedIds: { $elemMatch: { $eq: providerUserId } },
      },
    },
    { $group: { _id: null, total: { $sum: "$size" } } },
  ]);
  return r?.[0]?.total || 0;
}

/** Get quotaBytes for a provider within a swarm (null => unlimited) */
function quotaBytesForProvider(userDoc, swarmId) {
  const mem = userDoc.getMembership
    ? userDoc.getMembership(swarmId)
    : (userDoc.memberships || []).find(
        (m) => String(m.swarm) === String(swarmId)
      );
  return mem?.quotaBytes ?? null; // null => unlimited
}

/** Pick N providers using your 5-step criteria. */
async function chooseProviders({
  swarmId,
  fileSize,
  excludeUserIds = [],
  count = 3,
}) {
  const online = await getOnlineProvidersForSwarm(swarmId);
  const exclude = new Set(excludeUserIds.map(String));

  // Load Auth docs to read quotas
  const ids = online.map((p) => p.userId);
  const authDocs = await Auth.find({ _id: { $in: ids } })
    .select("_id memberships")
    .lean();

  // Build scored candidates
  const scored = [];
  for (const p of online) {
    if (exclude.has(p.userId)) continue; // Redundancy balance: don't choose existing holders (or bootstrap owner)

    const auth = authDocs.find((a) => String(a._id) === p.userId);
    if (!auth) continue;

    // Reliability placeholder: you can persist a 7d uptimeScore later; default 1
    const uptimeScore = 1;

    // Availability: online is guaranteed (we filtered), but measure RTT for Proximity
    const rttMs = await measureRtt(p.ws, p.peerId).catch(() => 9999);

    // Space: compute available space from quota – used
    const quota = quotaBytesForProvider(auth, swarmId); // null => unlimited
    const used = await usedBytesInSwarm(p.userId, swarmId);
    const available =
      quota == null ? Number.POSITIVE_INFINITY : Math.max(0, quota - used);

    if (available < fileSize) continue; // not enough space

    // Simple composite score:
    //  - lower RTT is better
    //  - higher available space is better
    //  - higher uptime is better
    // Normalize roughly; tune weights as needed.
    const spaceScore =
      quota == null ? 1 : available / Math.max(quota, fileSize);
    const normRtt = Math.max(1, rttMs); // avoid 0
    const score =
      uptimeScore * 0.4 + spaceScore * 0.4 + (1_000 / normRtt) * 0.2;

    scored.push({ ...p, rttMs, available, uptimeScore, score });
  }

  // Sort by score desc; tie-breaker: lower RTT then higher available
  scored.sort(
    (a, b) =>
      b.score - a.score || a.rttMs - b.rttMs || b.available - a.available
  );
  return scored.slice(0, count);
}

// --- Parallel pin helpers (place above uploadAndReplicate) ---
// Treat both reply formats: "ok|pin|<cid>" and legacy "Success:" / "Error:".

function pinWithTimeout(ws, cid, ms = 180000) {
  return new Promise((resolve, reject) => {
    const onMsg = (buf) => {
      const s = buf.toString();
      if (s === `ok|pin|${cid}` || s.startsWith("Success:")) {
        cleanup();
        resolve(true);
      } else if (s.startsWith(`err|pin|${cid}`) || s.startsWith("Error:")) {
        cleanup();
        resolve(false);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off?.("message", onMsg); // ws from 'ws' has .off in modern versions; fallback to removeListener if needed
      ws.removeListener?.("message", onMsg);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, ms);

    ws.on("message", onMsg);
    ws.send(`pin|${cid}`);
  });
}

/**
 * Fire pins in parallel to more candidates than needed and take the first N successes.
 * @param {string} cid
 * @param {Array<{ws:any,userId:string}>} candidates
 * @param {number} need
 * @param {number} extra extra fan-out to hedge slow/bad nodes (e.g., 2-3)
 * @returns {Promise<string[]>} userIds that successfully pinned
 */
async function replicateToN(cid, candidates, need = 3, extra = 3) {
  const targets = candidates.slice(0, need + extra);
  const attempts = targets.map((p) =>
    pinWithTimeout(p.ws, cid, 180000) // 3 minutes per peer
      .then((ok) => ({ ok, userId: p.userId }))
      .catch(() => ({ ok: false, userId: p.userId }))
  );
  const results = await Promise.all(attempts);
  return results
    .filter((r) => r.ok)
    .slice(0, need)
    .map((r) => r.userId);
}

/** The main handler */
export async function uploadAndReplicate(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    const user = await Auth.findById(req.user.uid);
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });

    const swarm = await Swarm.findById(user.activeSwarm).lean();
    if (!swarm)
      return res.status(404).json({ error: "Active swarm not found" });

    // 1) Upload to bootstrap
    const fileName = req.file.originalname || "upload.bin";
    const size = req.file.size;
    const cid = await uploadViaBootstrap(fileName, req.file.buffer);

    // 2) Avoid duplicate: if file metadata exists in this swarm, reuse
    let fileDoc = await FileModel.findOne({ cid, swarm: user.activeSwarm });
    const existingStored = new Set((fileDoc?.storedIds || []).map(String));

    // 3) Choose providers (exclude the ones that already store + optionally exclude bootstrap owner)
    const exclude = Array.from(existingStored);
    // If your bootstrap is *not* an Auth user, skip excluding it; if it is, add its userId here.
    const chosen = await chooseProviders({
      swarmId: user.activeSwarm,
      fileSize: size,
      excludeUserIds: exclude,
      count: 3,
    });

    // 4) Pin on each chosen provider (sequential keeps the listener’s simple protocol sane)
    const pinnedUserIds = await replicateToN(cid, chosen, 3, 3); // need 3, try a few extras
    if (pinnedUserIds.length === 0) {
      return res.status(503).json({ error: "No providers accepted the pin" });
    }

    // 5) Save/Update File metadata
    if (!fileDoc) {
      fileDoc = await FileModel.create({
        name: fileName,
        cid,
        size,
        date: new Date(),
        isFile: true,
        ownerId: user._id,
        storedIds: pinnedUserIds.map((id) => id),
        sharedIds: [],
        swarm: user.activeSwarm,
      });
    } else {
      // merge without duplicates
      const merged = Array.from(new Set([...existingStored, ...pinnedUserIds]));
      fileDoc.storedIds = merged;
      await fileDoc.save();
    }

    return res.json({
      ok: true,
      cid,
      replicatedTo: pinnedUserIds, // userIds of providers
      swarmId: String(user.activeSwarm),
      fileId: String(fileDoc._id),
      size,
    });
  } catch (err) {
    console.error("uploadAndReplicate failed:", err);
    return res.status(500).json({ error: "Upload failed" });
  }
}

/** Download a file's bytes by CID via bootstrap, with basic access control. */
export async function downloadFile(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    const { cid } = req.params;
    if (!cid) return res.status(400).json({ error: "Missing cid" });

    const fileDoc = await FileModel.findOne({ cid });
    if (!fileDoc) return res.status(404).json({ error: "File not found" });

    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Access control: owner or explicitly shared. (Adjust policy here if needed.) -> beta implementation
    const isOwner = String(fileDoc.ownerId) === String(user._id);
    const isShared = (fileDoc.sharedIds || []).some(
      (id) => String(id) === String(user._id)
    );
    if (!isOwner && !isShared) {
      //file access for beta implementation
      const mem = user.getMembership(fileDoc.swarm);
      if (!mem) return res.status(403).json({ error: "No access to this file" });
      // return res.status(403).json({ error: "No access to this file" });
    }

    const buf = await downloadViaBootstrap(cid);

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileDoc.name || cid}"`
    );
    res.setHeader("Content-Length", String(buf.length));
    return res.status(200).send(buf);
  } catch (err) {
    console.error("downloadFile failed:", err);
    const msg = /connected/i.test(String(err?.message || ""))
      ? "Bootstrap not connected"
      : "Download failed";
    return res.status(503).json({ error: msg });
  }
}
