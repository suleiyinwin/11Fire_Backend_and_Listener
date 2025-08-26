import * as uploadController from "./uploadController.js";

let bootstrapSocket = null;
let currentPeerId = null;

function setSocket(socket) {
  bootstrapSocket = socket;

  socket.on("message", (msg) => {
    const str = msg.toString();
    if (str.startsWith("id|")) {
      currentPeerId = str.slice(3);
      console.log("Bootstrap registered as peer:", currentPeerId);
    } else {
      uploadController.handleMessage(msg); 
    }
  });

  socket.on("close", () => {
    console.log("[BootstrapSocket] Bootstrap node disconnected");
    bootstrapSocket = null;
    currentPeerId = null;
  });
}

function getSocket() {
  return bootstrapSocket;
}
function getCurrentPeerId() {
  return currentPeerId;
}

export default { setSocket, getSocket, getCurrentPeerId };
