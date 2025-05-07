import bootstrapController from '../controllers/bootstrapController.js';

export default (wss) => {
    wss.on('connection', (ws) => {
        console.log("Bootstrap node connected");
        bootstrapController.setSocket(ws);
    });
};