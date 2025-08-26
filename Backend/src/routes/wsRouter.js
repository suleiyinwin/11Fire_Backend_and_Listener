import { registerPeer, _internal as regInternal } from "../ws/providerRegistry.js";

export default function wsRouter(wss) {
  wss.on("connection", (ws) => {
    let identified = false;

    ws.on("message", async (buf) => {
      const str = buf.toString();

      if (!identified && str.startsWith("id|")) {
        identified = true;
        const peerId = str.slice(3);
        try {
          const { userId } = await registerPeer(ws, peerId);
          console.log(`[providers-ws] Registered peer ${peerId} for user ${userId}`);
        } catch (e) {
          console.error("[providers-ws] registerPeer failed:", e.message);
          ws.close();
        }
        return;
      }

      // Route to providerRegistry waiters (pin/unpin/ping responses)
      regInternal.handleMessage(ws, str);
    });

    ws.on("close", () => {
      
    });
  });
}
