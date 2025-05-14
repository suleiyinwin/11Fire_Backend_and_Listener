const bootstrapSockets = new Map();

const setSocket = (ws) => {
  ws.once('message', (msg) => {
    const str = msg.toString();
    if (str.startsWith("id|")) {
      const peerId = str.slice(3);
      bootstrapSockets.set(peerId, ws);
      console.log(`Registered bootstrap node: ${peerId}`);
    }
  });
};

const getSocketById = (peerId) => {
  return bootstrapSockets.get(peerId);
};

export default {
  setSocket,
  getSocketById
};