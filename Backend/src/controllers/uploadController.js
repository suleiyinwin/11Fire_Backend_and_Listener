import bootstrapController from './bootstrapController.js';
import FileModel from '../models/FileModel.js';
import ProviderModel from '../models/providerModel.js';
// import * as broadcaster from '../utils/broadcaster.js';

let pendingUploads = new Map();
let fileMetadata = new Map();

function handleUpload(req, res) {
    const file = req.file;

    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const fileData = file.buffer.toString('base64');
    const requestId = Date.now().toString();

    // Store res to respond later
    pendingUploads.set(requestId, res);

    // Save metadata temporarily for MongoDB insert
    fileMetadata.set(requestId, {
        name: file.originalname,
        size: file.size,
        date: new Date().toISOString(),
        isFile: true // future: handle folders
    });

    const socket = bootstrapController.getSocket();

    if (socket && socket.readyState === 1) {
        socket.send(`upload|${requestId}|${file.originalname}|${fileData}`);
    } else {
        return res.status(500).json({ error: 'Bootstrap socket not available' });
    }
}

function handleMessage(message) {
    const msg = message.toString();

    if (msg.startsWith('cid|')) {
        const [_, requestId, cid] = msg.split('|');
        const res = pendingUploads.get(requestId);
        const meta = fileMetadata.get(requestId);

        if (res && meta) {
            // Save to MongoDB
            FileModel.create({
                name: meta.name,
                cid,
                size: meta.size,
                date: meta.date,
                isFile: meta.isFile,
            }).then(() => console.log('File metadata saved')).catch(console.error);

            // Replicate CID to all online providers
            const providers = ProviderModel.getAll();
            for (const [ws, info] of providers.entries()) {
                if (ws.readyState === 1) {
                    ws.send(`pin|${cid}`);
                }
            }

            res.json({ cid });
            pendingUploads.delete(requestId);
            fileMetadata.delete(requestId);
        }
    }
}

/**
 * GET /api/files
 * Returns all uploaded files stored in MongoDB
 */
async function listFiles(req, res) {
    try {
        const files = await FileModel.find().sort({ date: -1 });
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch files' });
    }
}

export default { handleUpload, handleMessage, listFiles };