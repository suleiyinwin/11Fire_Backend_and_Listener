import wsController from '../controllers/wsController.js';

export default(wss) => {
    wss.on('connection', (ws) => {
        wsController.handleWebSocketConnection(ws, wss);
    });
};