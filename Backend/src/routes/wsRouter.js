import { registerPeer, _internal as regInternal, noteHeartbeat, noteActivity } from "../ws/providerRegistry.js";

export default function wsRouter(wss) {
  wss.on("connection", (ws) => {
    let identified = false;
    let currentUserId = null;

    ws.on("message", async (buf) => {
      const str = buf.toString();

      if (!identified && str.startsWith("id|")) {
        identified = true;
        const peerId = str.slice(3);
        console.log(`[providers-ws] Peer connected with id ${peerId}`);
        try {
          const { userId } = await registerPeer(ws, peerId);
          console.log(userId);
          console.log(`[providers-ws] Registered peer ${peerId} for user ${userId}`);
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
      
    });
  });
}
