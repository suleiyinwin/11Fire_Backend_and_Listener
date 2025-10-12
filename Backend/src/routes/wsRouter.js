import {
  registerPeer,
  _internal as regInternal,
  noteHeartbeat,
  noteActivity,
} from "../ws/providerRegistry.js";

import { emitWsConnection, emitWsDisconnection } from '../utils/eventSystem.js';

export default function wsRouter(wss) {
  wss.on("connection", (ws, req) => {
    // Don't emit connection event immediately - wait for identification
    let identified = false;
    let currentUserId = null;
    let currentPeerId = null;

    ws.on("message", async (buf) => {
      const str = buf.toString();

      if (!identified && str.startsWith("id|")) {
        identified = true;
        currentPeerId = str.slice(3);
        console.log(`[providers-ws] Peer connected with id ${currentPeerId}`);
        try {
          const { userId } = await registerPeer(ws, currentPeerId);
          currentUserId = userId;
          
          // Only emit WebSocket connection event after successful registration
          emitWsConnection({
            type: "provider",
            remoteAddress: req.socket.remoteAddress,
            userAgent: req.headers["user-agent"],
            peerId: currentPeerId,
            userId: userId
          });
          
          console.log(userId);
          console.log(
            `[providers-ws] Registered peer ${currentPeerId} for user ${userId}`
          );
        } catch (e) {
          console.error("[providers-ws] registerPeer failed:", e.message);
          ws.close();
        }
        return;
      }

      if (!identified) return;

      if (currentUserId) {
        noteActivity(currentUserId);
      }

      // NEW: cheap heartbeat hook
      if (str.startsWith("hb|")) {
        if (currentUserId) noteHeartbeat(currentUserId);
        return; // echo reply happens on the agent side; we don't need to route this
      }

      // Route to providerRegistry waiters (pin/unpin/ping responses)
      regInternal.handleMessage(ws, str);
    });

    ws.on("close", () => {
      emitWsDisconnection({
        type: "provider",
        peerId: currentPeerId,
        reason: "connection_closed",
      });
    });
  });
}
