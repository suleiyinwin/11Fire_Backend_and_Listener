import bootstrapController from './bootstrapController.js';

// Map to keep track of pending file uploads by requestId
let pendingUploads = new Map();

/**
 * Handles file upload from frontend:
 * - Parses in-memory uploaded file from req.file
 * - Converts to base64
 * - Sends it to bootstrap node via WebSocket
 * - Stores response handler to reply with CID when received
 */
function handleUpload(req, res) {
    const file = req.file;

    // If no file is present in the request
    if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // Convert in-memory buffer to base64 string
    const fileData = file.buffer.toString('base64');
    const requestId = Date.now().toString();

    // Temporarily store the response to respond later with CID
    pendingUploads.set(requestId, res);

    // Get WebSocket connection to the bootstrap node
    const socket = bootstrapController.getSocket();

    // If connected, send file to bootstrap node
    if (socket && socket.readyState === 1) {
        socket.send(`upload|${requestId}|${file.originalname}|${fileData}`);
    } else {
        return res.status(500).json({ error: 'Bootstrap socket not available' });
    }
}

/**
 * Handles WebSocket message back from bootstrap node in the format:
 * cid|<requestId>|<cid>
 */
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