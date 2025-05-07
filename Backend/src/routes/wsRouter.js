import wsController from '../controllers/wsController.js';

// Register the WebSocket connection handler
export default (wss) => {
    wss.on('connection', (ws) => {
        wsController.handleConnection(ws, wss);
    });
};

