import fs from 'fs';
import bootstrapController from './bootstrapController.js';

let pendingUploads = new Map();

function handleUpload(req, res) {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const fileData = fs.readFileSync(file.path).toString('base64');
    const requestId = Date.now().toString();

    pendingUploads.set(requestId, res);

    const socket = bootstrapController.getSocket();
    if (socket && socket.readyState === 1) {
        socket.send(`upload|${requestId}|${file.originalname}|${fileData}`);
    } else {
        return res.status(500).json({ error: 'Bootstrap socket not available' });
    }

    setTimeout(() => fs.unlink(file.path, () => {}), 5000);
}

function handleMessage(message) {
    const msg = message.toString();
    if (msg.startsWith('cid|')) {
        const [_, requestId, cid] = msg.split('|');
        const res = pendingUploads.get(requestId);
        if (res) {
            res.json({ cid });
            pendingUploads.delete(requestId);
        }
    }
}

export default { handleUpload, handleMessage };
