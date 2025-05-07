import uploadController from './uploadController.js';

let bootstrapSocket = null;

function setSocket(socket) {
    bootstrapSocket = socket;
    socket.on('message', uploadController.handleMessage);
    socket.on('close', () => {
        console.log('[BootstrapSocket] Bootstrap node disconnected');
        bootstrapSocket = null;
    });
}

function getSocket() {
    return bootstrapSocket;
}

export default {
    setSocket,
    getSocket
};