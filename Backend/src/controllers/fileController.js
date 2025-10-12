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
  unpinCid,
} from "../ws/providerRegistry.js";
import { getOrCreateSwarmDataKey, getSwarmDataKey } from "../utils/datakey.js";
import { encryptEnvelopeGCM, decryptEnvelopeGCM } from "../utils/crypto.js";
import JSZip from "jszip";
import bootstrapController from "./bootstrapController.js";
import {
  emitProviderToPin,
  emitFileUploaded,
  emitFileDownloaded,
  emitProviderToUnpin,
  emitFileDeleted,
} from "../utils/eventSystem.js";

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
    const plain = req.file.buffer;
    const size = plain.length;

    // fetch/create per-swarm data key (NOT the swarmkey)
    const dataKey = await getOrCreateSwarmDataKey(user.activeSwarm);

    // encrypt locally; envelope is what we store
    const envelope = encryptEnvelopeGCM(plain, dataKey);

    // get CID for encrypted bytes
    const cid = await uploadViaBootstrap(fileName, envelope);

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
    // Emit intent once: notify listeners which providers we will request to pin
    try {
      const providerIds = chosen
        .map((p) => p.userId || p.peerId)
        .filter(Boolean);
      emitProviderToPin(cid, providerIds, user.activeSwarm);
    } catch (e) {
      console.warn("emitProviderToPin error:", e?.message || e);
    }

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
        encSize: envelope.length,
        date: new Date(),
        isFile: true,
        ownerId: user._id,
        storedIds: pinnedUserIds.map((id) => id),
        sharedIds: [],
        swarm: user.activeSwarm,
        enc: true,
        encAlgo: "aes-gcm@v1",
      });
    } else {
      // merge without duplicates
      const merged = Array.from(new Set([...existingStored, ...pinnedUserIds]));
      fileDoc.storedIds = merged;
      await fileDoc.save();
    }

    // Emit event: file uploaded
    emitFileUploaded(
      {
        cid: cid,
        name: fileName,
        size: size,
        replicatedTo: pinnedUserIds,
      },
      {
        userId: user._id,
        username: user.username,
      },
      {
        swarmId: user.activeSwarm,
        name: swarm.name,
      }
    );

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

// Folder upload
export async function uploadFolder(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    if (!req.file) return res.status(400).json({ error: "Missing folder" });

    const user = await Auth.findById(req.user.uid);
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });

    const swarm = await Swarm.findById(user.activeSwarm).lean();
    if (!swarm)
      return res.status(404).json({ error: "Active swarm not found" });

    // Extract folder name from the uploaded file
    // The folder will come as a ZIP or compressed file
    const originalName = req.file.originalname || "folder_upload";
    const folderName = originalName.replace(/\.(zip|tar|gz|rar)$/i, ""); 

    const fileBuffer = req.file.buffer;
    const maxFolderSize = 500 * 1024 * 1024; // 500MB limit

    if (fileBuffer.length > maxFolderSize) {
      return res.status(400).json({ error: "Folder too large (max 500MB)" });
    }

    // If it's not already a ZIP, assume it needs to be processed as a ZIP
    let zipBuffer;
    if (originalName.toLowerCase().endsWith(".zip")) {
      // Already a ZIP file
      zipBuffer = fileBuffer;
    } else {
      // Create a ZIP containing the folder content
      // This handles cases where the folder comes as a single file representation
      const zip = new JSZip();
      zip.file(originalName, fileBuffer);
      zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    }
    // Create fake request to mimic file upload
    const fakeReq = {
      ...req,
      file: {
        originalname: `${folderName}.zip`,
        buffer: zipBuffer,
        mimetype: "application/zip",
        size: zipBuffer.length,
      },
    };

    // Call existing upload function
    return uploadAndReplicate(fakeReq, res);
  } catch (err) {
    console.error("uploadFolder failed:", err);
    return res.status(500).json({ error: "Folder upload failed" });
  }
}

// helper: check if a user (by id) can access a file document
function isUserAuthorizedForFile(userId, fileDoc) {
  if (!userId || !fileDoc) return false;
  if (String(fileDoc.ownerId) === String(userId)) return true;
  if (Array.isArray(fileDoc.sharedIds)) {
    if (fileDoc.sharedIds.map(String).includes(String(userId))) return true;
  }
  return false;
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
      if (!mem)
        return res.status(403).json({ error: "No access to this file" });
      // return res.status(403).json({ error: "No access to this file" });
    }

    const buf = await downloadViaBootstrap(cid);

    // derive swarm data key and decrypt envelope
    let plain;
    try {
      const dataKey = await getSwarmDataKey(fileDoc.swarm);
      plain = decryptEnvelopeGCM(buf, dataKey);
    } catch (e) {
      console.error("decryptEnvelopeGCM failed:", e);
      return res.status(500).json({ error: "Decryption failed" });
    }

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileDoc.name || cid}"`
    );
    res.setHeader("Content-Length", String(plain.length));

    // Emit file downloaded event
    emitFileDownloaded(
      {
        cid: cid,
        name: fileDoc.name,
      },
      {
        userId: user._id,
        username: user.username,
      }
    );

    return res.status(200).send(plain);
  } catch (err) {
    console.error("downloadFile failed:", err);
    const msg = /connected/i.test(String(err?.message || ""))
      ? "Bootstrap not connected"
      : "Download failed";
    return res.status(503).json({ error: msg });
  }
}

/** Delete a file by CID (owner-only). */
export async function deleteFile(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    const user = await Auth.findById(req.user.uid);
    const { cid } = req.params;
    if (!cid) return res.status(400).json({ error: "Missing cid" });

    const fileDoc = await FileModel.findOne({ cid });
    if (!fileDoc) return res.status(404).json({ error: "File not found" });

    // Only owner can delete
    if (String(fileDoc.ownerId) !== String(req.user.uid)) {
      return res
        .status(403)
        .json({ error: "Only the owner can delete this file" });
    }

    // Unpin from all providers
    const swarmId = fileDoc.swarm;
    //Emit Unpin Provider
    emitProviderToUnpin(cid, fileDoc.storedIds, swarmId);
    const providers = await getOnlineProvidersForSwarm(swarmId);
    for (const p of providers) {
      try {
        await unpinCid(p.ws, cid);

        console.log(`[deleteFile] Unpinned ${cid} from provider ${p.userId}`);
      } catch (e) {
        console.error(
          `[deleteFile] Failed to unpin from ${p.userId}:`,
          e.message
        );
      }
    }

    // Optionally: unpin from bootstrap
    const sock = bootstrapController.getSocket();
    if (sock && sock.readyState === 1) {
      sock.send(`unpin|${cid}`);
    }

    // Remove metadata
    await FileModel.deleteOne({ _id: fileDoc._id });

    // Emit file deleted event
    emitFileDeleted(
      {
        cid: cid,
        name: fileDoc.name,
        size: fileDoc.size,
      },
      {
        userId: user._id,
        username: user.username,
      },
      {
        swarmId: swarmId,
      }
    );

    return res.json({ ok: true, cid });
  } catch (err) {
    console.error("deleteFile failed:", err);
    return res.status(500).json({ error: "Delete failed" });
  }
}

/** Download multiple files as a ZIP archive */
export async function downloadMultipleFiles(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const { cids } = req.body;
    if (!Array.isArray(cids) || cids.length === 0) {
      return res.status(400).json({ error: "Missing or empty cids array" });
    }

    if (cids.length > 100) {
      return res.status(400).json({ error: "Too many files (max 100)" });
    }

    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    // Find all files and check access
    const filesDocs = await FileModel.find({ cid: { $in: cids } });
    const accessibleFiles = [];

    for (const fileDoc of filesDocs) {
      // Access control: owner or explicitly shared
      const isOwner = String(fileDoc.ownerId) === String(user._id);
      const isShared = (fileDoc.sharedIds || []).some(
        (id) => String(id) === String(user._id)
      );

      if (isOwner || isShared) {
        accessibleFiles.push(fileDoc);
      } else {
        // Beta implementation: check swarm membership
        const mem = user.getMembership(fileDoc.swarm);
        if (mem) {
          accessibleFiles.push(fileDoc);
        }
      }
    }

    if (accessibleFiles.length === 0) {
      return res.status(403).json({ error: "No accessible files found" });
    }

    // Download and decrypt all files
    const fileContents = [];
    const errors = [];

    for (const fileDoc of accessibleFiles) {
      try {
        const buf = await downloadViaBootstrap(fileDoc.cid);
        const dataKey = await getSwarmDataKey(fileDoc.swarm);
        const plain = decryptEnvelopeGCM(buf, dataKey);

        fileContents.push({
          name: fileDoc.name || fileDoc.cid,
          content: plain,
          cid: fileDoc.cid,
        });
      } catch (e) {
        console.error(`Failed to download ${fileDoc.cid}:`, e);
        errors.push({
          cid: fileDoc.cid,
          name: fileDoc.name,
          error: e.message,
        });
      }
    }

    if (fileContents.length === 0) {
      return res.status(503).json({
        error: "Failed to download any files",
        errors,
      });
    }

    // If only one file, return it directly
    if (fileContents.length === 1) {
      const file = fileContents[0];
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.name}"`
      );
      res.setHeader("Content-Length", String(file.content.length));
      return res.status(200).send(file.content);
    }

    // Multiple files: create ZIP
    const zip = new JSZip();

    // Add files to ZIP
    fileContents.forEach((file) => {
      zip.file(file.name, file.content);
    });

    // Add error log if there were any failures
    if (errors.length > 0) {
      const errorLog = errors
        .map((e) => `${e.cid} (${e.name}): ${e.error}`)
        .join("\n");
      zip.file("download_errors.txt", errorLog);
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="11fire_files_${Date.now()}.zip"`
    );
    res.setHeader("Content-Length", String(zipBuffer.length));

    return res.status(200).send(zipBuffer);
  } catch (err) {
    console.error("downloadMultipleFiles failed:", err);
    const msg = /connected/i.test(String(err?.message || ""))
      ? "Bootstrap not connected"
      : "Download failed";
    return res.status(503).json({ error: msg });
  }
}

/** Delete multiple files by CIDs (owner-only for each file) */
export async function deleteMultipleFiles(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const { cids } = req.body;
    if (!Array.isArray(cids) || cids.length === 0) {
      return res.status(400).json({ error: "Missing or empty cids array" });
    }

    if (cids.length > 100) {
      return res.status(400).json({ error: "Too many files (max 100)" });
    }

    // Find all files and check ownership
    const filesDocs = await FileModel.find({ cid: { $in: cids } });
    const ownedFiles = filesDocs.filter(
      (fileDoc) => String(fileDoc.ownerId) === String(req.user.uid)
    );

    if (ownedFiles.length === 0) {
      return res.status(403).json({
        error: "No owned files found to delete",
        requested: cids.length,
        found: filesDocs.length,
      });
    }

    const results = {
      successful: [],
      failed: [],
      notFound: [],
      notOwned: [],
    };

    // Track which CIDs were found
    const foundCids = new Set(filesDocs.map((f) => f.cid));
    const ownedCids = new Set(ownedFiles.map((f) => f.cid));

    // Categorize not found and not owned
    cids.forEach((cid) => {
      if (!foundCids.has(cid)) {
        results.notFound.push(cid);
      } else if (!ownedCids.has(cid)) {
        results.notOwned.push(cid);
      }
    });

    // Process each owned file
    for (const fileDoc of ownedFiles) {
      const cid = fileDoc.cid;

      try {
        // Get providers for this swarm
        const swarmId = fileDoc.swarm;
        const providers = await getOnlineProvidersForSwarm(swarmId);

        // Unpin from all providers (parallel for speed)
        const unpinPromises = providers.map(async (p) => {
          try {
            await unpinCid(p.ws, cid);
            console.log(
              `[deleteMultipleFiles] Unpinned ${cid} from provider ${p.userId}`
            );
            return { success: true, providerId: p.userId };
          } catch (e) {
            console.error(
              `[deleteMultipleFiles] Failed to unpin ${cid} from ${p.userId}:`,
              e.message
            );
            return { success: false, providerId: p.userId, error: e.message };
          }
        });

        const unpinResults = await Promise.allSettled(unpinPromises);

        // Unpin from bootstrap
        const sock = bootstrapController.getSocket();
        if (sock && sock.readyState === 1) {
          sock.send(`unpin|${cid}`);
        }

        // Remove metadata
        await FileModel.deleteOne({ _id: fileDoc._id });

        results.successful.push({
          cid,
          name: fileDoc.name,
          unpinResults: unpinResults.map((r, i) => ({
            providerId: providers[i]?.userId,
            success: r.status === "fulfilled" && r.value.success,
            error: r.status === "rejected" ? r.reason?.message : r.value?.error,
          })),
        });
      } catch (err) {
        console.error(`[deleteMultipleFiles] Failed to delete ${cid}:`, err);
        results.failed.push({
          cid,
          name: fileDoc.name,
          error: err.message,
        });
      }
    }

    const summary = {
      total: cids.length,
      successful: results.successful.length,
      failed: results.failed.length,
      notFound: results.notFound.length,
      notOwned: results.notOwned.length,
    };

    return res.json({
      ok: true,
      summary,
      results,
    });
  } catch (err) {
    console.error("deleteMultipleFiles failed:", err);
    return res.status(500).json({ error: "Bulk delete failed" });
  }
}

export async function listMyFilesInActiveSwarm(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid).select("activeSwarm");
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });

    const items = await FileModel.find({
      ownerId: user._id,
      swarm: user.activeSwarm,
    })
      .sort({ date: -1, _id: -1 })
      .select("_id name cid size date isFile swarm storedIds sharedIds");

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("listMyFilesInActiveSwarm failed:", err);
    return res.status(500).json({ error: "Failed to list files" });
  }
}

export async function listFilesSharedWithMe(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid).select("activeSwarm");
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });
    console.log(
      "listFilesSharedWithMe: user",
      user._id,
      "swarm",
      user.activeSwarm
    );

    const swarmId = user.activeSwarm;
    const uidObj = req.user.uid;
    const files = await FileModel.find({
      swarm: swarmId,
      $or: [{ sharedIds: uidObj }, { sharedIds: String(req.user.uid) }],
    })
      .select("_id name cid size date ownerId enc encAlgo")
      .populate("ownerId", "username email")
      .lean();

    return res.json({ ok: true, count: files.length, files });
  } catch (err) {
    console.error("listFilesSharedWithMe failed:", err);
    return res.status(500).json({ error: "Failed to list files" });
  }
}

export async function renameFile(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    const { cid } = req.params;
    const { name } = req.body || {};

    if (!cid) return res.status(400).json({ error: "Missing cid" });
    if (typeof name !== "string")
      return res.status(400).json({ error: "name must be a string" });

    // Basic normalization/sanitization
    const cleaned = name
      .replace(/[␀-␟•]/g, "") // control chars
      .replace(/[\/]/g, "-") // slashes -> dash
      .trim();

    if (!cleaned)
      return res.status(400).json({ error: "name cannot be empty" });
    if (cleaned.length > 255)
      return res.status(400).json({ error: "name too long (max 255)" });

    const fileDoc = await FileModel.findOne({ cid });
    if (!fileDoc) return res.status(404).json({ error: "File not found" });

    // Only owner can rename
    if (String(fileDoc.ownerId) !== String(req.user.uid)) {
      return res
        .status(403)
        .json({ error: "Only the owner can rename this file" });
    }

    fileDoc.name = cleaned;
    await fileDoc.save();

    return res.json({ ok: true, cid, name: fileDoc.name });
  } catch (err) {
    console.error("renameFile failed:", err);
    return res.status(500).json({ error: "Rename failed" });
  }
}

export async function shareFile(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });
    const { cid } = req.params;
    if (!cid) return res.status(400).json({ error: "Missing cid" });

    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res
        .status(400)
        .json({ error: "emails must be a non-empty array" });
    }

    const file = await FileModel.findOne({ cid })
      .select("ownerId swarm")
      .lean();
    if (!file) return res.status(404).json({ error: "File not found" });

    if (!file.ownerId || String(file.ownerId) !== String(req.user.uid)) {
      return res
        .status(403)
        .json({ error: "Only the owner can share this file" });
    }

    const swarmId = file.swarm;
    const tenantId = req.user.ms?.tid;
    if (!swarmId) return res.status(400).json({ error: "File has no swarm" });
    if (!tenantId)
      return res.status(400).json({ error: "Missing tenant id on user" });

    const matchedUsers = await Auth.find({
      email: { $in: emails },
      "ms.tid": tenantId,
      "memberships.swarm": swarmId,
    })
      .select("_id email")
      .lean();

    const ownerIdStr = String(file.ownerId);
    const filteredMatches = matchedUsers.filter(
      (u) => String(u._id) !== ownerIdStr
    );

    const matchedEmails = new Set(
      filteredMatches.map((u) => (u.email || "").toLowerCase())
    );
    const unresolvedEmails = emails.filter(
      (e) => !matchedEmails.has((e || "").toLowerCase())
    );

    const resolvedIds = filteredMatches.map((u) => u._id);
    if (resolvedIds.length > 0) {
      await FileModel.updateOne(
        { cid },
        { $addToSet: { sharedIds: { $each: resolvedIds } } }
      );
    }

    const updated = await FileModel.findOne({ cid }).select("sharedIds").lean();

    return res.json({
      ok: true,
      cid,
      sharedWith: filteredMatches,
      unresolvedEmails,
      sharedIdsCount: (updated?.sharedIds || []).length,
    });
  } catch (err) {
    console.error("shareFile failed:", err);
    return res.status(500).json({ error: "Share failed" });
  }
}
