import Auth from "../models/Auth.js";
import ProviderUptimeEvent from "../models/ProviderUptimeEvent.js";
import { addIntervalToDaily, accrueOpenIntervalToNow } from "../utils/uptimeDaily.js";

const byPeerId = new Map();   // peerId -> { ws, userId, lastSeen, avgRttMs }
const byUserId = new Map();   // userId -> peerId

const waiters = new WeakMap(); // ws -> Array<{matchFn, resolve, reject, t}>

function _ensureQueue(ws) {
  if (!waiters.get(ws)) waiters.set(ws, []);
  return waiters.get(ws);
}

function _waitFor(ws, matchFn, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const q = _ensureQueue(ws);
    const t = setTimeout(() => {
      const idx = q.findIndex(w => w.t === t);
      if (idx >= 0) q.splice(idx, 1);
      reject(new Error("timeout waiting for provider response"));
    }, timeoutMs);
    q.push({ matchFn, resolve, reject, t });
  });
}

function handleMessage(ws, str) {
  const q = _ensureQueue(ws);
  for (let i = 0; i < q.length; i++) {
    const w = q[i];
    try {
      if (w.matchFn(str)) {
        clearTimeout(w.t);
        q.splice(i, 1);
        return w.resolve(str);
      }
    } catch {
    }
  }
}

/** Register first 'id|peerId' and map to Auth userId */
export async function registerPeer(ws, peerId) {
  // Find which Auth has this peerId (claimed previously)
  const user = await Auth.findOne({ peerId }).select("_id memberships activeSwarm").lean();
  if (!user) throw new Error("Unknown peerId (not claimed by any user)");

  const userId = String(user._id);
  const swarmId = user.activeSwarm; // active swarm at connect time

  stateByUser.set(userId, { lastSeen: Date.now(), currentState: "online" });
  await recordTransition(user._id, swarmId, peerId, "online");

  byPeerId.set(peerId, { ws, userId: String(user._id), lastSeen: new Date(), avgRttMs: null });
  byUserId.set(String(user._id), peerId);

  ws.on("close", async () => {
    byPeerId.delete(peerId);
    byUserId.delete(String(user._id));
    waiters.delete(ws);

    stateByUser.delete(userId);
    await recordTransition(user._id, swarmId, peerId, "offline");
  });
  return { userId };
}

/** True if provider socket is connected */
export function isOnlineByUserId(userId) {
  const peerId = byUserId.get(String(userId));
  return !!(peerId && byPeerId.get(peerId)?.ws?.readyState === 1);
}

/** Get online providers (Auth userIds + sockets) that belong to a swarm and have role=provider */
export async function getOnlineProvidersForSwarm(swarmId) {
  // find users who are providers in that swarm AND are online
  const docs = await Auth.find({
    peerId: { $ne: null },
    memberships: { $elemMatch: { swarm: swarmId, role: "provider" } },
  }).select("_id peerId").lean();

  const out = [];
  for (const d of docs) {
    const m = byPeerId.get(d.peerId);
    if (m?.ws?.readyState === 1) out.push({ userId: String(d._id), peerId: d.peerId, ws: m.ws, avgRttMs: m.avgRttMs ?? null });
  }
  return out;
}

// Measure RTT using 'ping' (provider replies with 'cids|...')
export async function measureRtt(ws, peerId) {
  const started = Date.now();
  // Send a lightweight ping: we reuse 'ping' even though it lists pins; acceptable for now.
  ws.send("ping");
  await _waitFor(ws, (str) => str.startsWith("cids|"), 10000);
  const ms = Date.now() - started;

  const rec = Array.from(byPeerId.entries()).find(([,v]) => v.ws === ws)?.[1];
  if (rec) {
    rec.lastSeen = new Date();
    rec.avgRttMs = rec.avgRttMs == null ? ms : Math.round(rec.avgRttMs * 0.7 + ms * 0.3); // EMA
  }
  return ms;
}

// Ask provider to pin a CID, resolves true/false 
export async function pinCid(ws, cid, timeoutMs = 5 * 60 * 1000) {
  ws.send(`pin|${cid}`);
  try {
    const res = await _waitFor(ws, (str) => str.startsWith("Success:") || str.startsWith("Error:"), timeoutMs);
    return res.startsWith("Success:");
  } catch {
    return false;
  }
}

/** Ask provider to unpin a CID */
export async function unpinCid(ws, cid, timeoutMs = 120000) {
  ws.send(`unpin|${cid}`);
  try {
    const res = await _waitFor(ws, (str) => str.startsWith("Success:") || str.startsWith("Error:"), timeoutMs);
    return res.startsWith("Success:");
  } catch {
    return false;
  }
}

/** Expose message pump to wsRouter */
export const _internal = { handleMessage };

/** for testing */
export function _debugState() {
  return { byPeerId: Array.from(byPeerId.keys()), byUserId: Array.from(byUserId.keys()) };
}

const HEARTBEAT_TIMEOUT_MS = 90_000;
const stateByUser = new Map(); // userId -> { lastSeen, currentState: "online"|"offline" }

/** Close current open interval (if any), accrue to daily, then open new state */
async function recordTransition(userId, swarmId, peerId, newState) {
  const now = new Date();

  // Close any open interval for this user+swarm
  if (swarmId) {
    const open = await ProviderUptimeEvent.findOne({ userId, swarm: swarmId, end: null }).sort({ start: -1 });
    if (open) {
      open.end = now;
      await open.save();
      await addIntervalToDaily({ userId, swarmId, state: open.state, start: open.start, end: now });
    }

    // Open the new state interval
    await ProviderUptimeEvent.create({ userId, swarm: swarmId, peerId, state: newState, start: now, end: null });
  }
}

export async function noteActivity(userId, peerId) {
  const key = String(userId);
  const rec = stateByUser.get(key);
  if (!rec) return;
  rec.lastSeen = Date.now();

  if (rec.currentState === "offline") {
    rec.currentState = "online";
    try {
      await recordTransition(userId, rec.swarmId || null, peerId || byUserId.get(key), "online");
    } catch (e) {
      console.error("[uptime] activity->online transition failed:", e);
    }
  }
}



/** Call from wsRouter on every hb|nonce (or ping if you prefer) */
export async function noteHeartbeat(userId) {
  return noteActivity(userId, byUserId.get(String(userId)));
}

setInterval(() => {
  for (const [peerId, rec] of byPeerId.entries()) {
    try {
      const nonce = Date.now().toString(36);
      rec.ws.send(`hb|${nonce}`);
    } catch (e) {
      // ignore send errors
    }
  }
}, 30_000);

// Periodic timeout: if no heartbeat for a while, mark offline
setInterval(async () => {
  const now = Date.now();
  for (const [userId, rec] of stateByUser.entries()) {
    if (rec.currentState !== "online") continue;
    if (now - rec.lastSeen > HEARTBEAT_TIMEOUT_MS) {
      rec.currentState = "offline";
      try {
        await recordTransition(userId, rec.swarmId || null, rec.peerId || byUserId.get(userId) || null, "offline");
      } catch (e) {
        console.error("[uptime] timeout transition failed:", e);
      }
    }
  }
}, 30_000);

// Keep daily buckets fresh while intervals are open (does NOT close intervals)
setInterval(async () => {
  try {
    const clampSince = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const opens = await ProviderUptimeEvent.find({ end: null }).select("userId swarm state start").lean();
    for (const ev of opens) {
      await accrueOpenIntervalToNow({
        userId: ev.userId,
        swarmId: ev.swarm,
        state: ev.state,
        start: ev.start,
        clampSince,
      });
    }
  } catch (e) {
    console.error("[uptime accrual] periodic fold failed:", e);
  }
}, 5 * 60 * 1000);