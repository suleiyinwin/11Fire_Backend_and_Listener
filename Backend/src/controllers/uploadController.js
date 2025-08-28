// Sends uploads to the connected bootstrap socket and correlates replies ('cid|<reqId>|<cid>').
// Exposes `uploadViaBootstrap(name, buffer)` and a `handleMessage` for bootstrapRouter.

import crypto from "crypto";
import bootstrapController from "./bootstrapController.js";

const pending = new Map(); // reqId -> {resolve, reject, t}

export async function uploadViaBootstrap(
  name,
  buffer,
  timeoutMs = 2 * 60 * 1000
) {
  const sock = bootstrapController.getSocket();
  if (!sock || sock.readyState !== 1)
    throw new Error("Bootstrap is not connected");

  const reqId = crypto.randomBytes(8).toString("hex");
  const payload = Buffer.from(buffer).toString("base64");

  const p = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("bootstrap upload timeout"));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, t });
  });

  // format: upload|<reqId>|<name>|<base64>
  sock.send(`upload|${reqId}|${name}|${payload}`);
  return p;
}

export async function downloadViaBootstrap(cid, timeoutMs = 2 * 60 * 1000) {
  const sock = bootstrapController.getSocket();
  if (!sock || sock.readyState !== 1)
    throw new Error("Bootstrap is not connected");

  const reqId = crypto.randomBytes(8).toString("hex");
  const p = new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error("bootstrap download timeout"));
    }, timeoutMs);
    pending.set(reqId, { resolve, reject, t });
  });

  // format: download|<reqId>|<cid>
  sock.send(`download|${reqId}|${cid}`);
  return p;
}

// called by bootstrapController.setSocket message handler
export function handleMessage(msgBuf) {
  const str = msgBuf.toString();

  // Expected: cid|<reqId>|<cid>
  if (str.startsWith("cid|")) {
    const [, reqId, cid] = str.split("|");
    const entry = pending.get(reqId);
    if (entry) {
      clearTimeout(entry.t);
      pending.delete(reqId);
      return entry.resolve(cid);
    }
  }

  if (str.startsWith("file|")) {
    const [, reqId, b64] = str.split("|");
    const entry = pending.get(reqId);
    if (entry) {
      clearTimeout(entry.t);
      pending.delete(reqId);
      try {
        const buf = Buffer.from(b64, "base64");
        return entry.resolve(buf);
      } catch (e) {
        return entry.reject(new Error("invalid base64 from bootstrap"));
      }
    }
  }
}
