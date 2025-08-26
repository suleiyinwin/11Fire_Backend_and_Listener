import Auth from "../models/Auth.js";

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
  const user = await Auth.findOne({ peerId }).select("_id memberships").lean();
  if (!user) throw new Error("Unknown peerId (not claimed by any user)");
  byPeerId.set(peerId, { ws, userId: String(user._id), lastSeen: new Date(), avgRttMs: null });
  byUserId.set(String(user._id), peerId);
  ws.on("close", () => {
    byPeerId.delete(peerId);
    byUserId.delete(String(user._id));
    waiters.delete(ws);
  });
  return { userId: String(user._id) };
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
