import bootstrapController from './bootstrapController.js';
import FileModel from '../models/FileModel.js';
import ProviderModel from '../models/providerModel.js';
import wsController from './wsController.js';
import Swarm from '../models/Swarm.js';
import Bootstrap from '../models/Bootstrap.js';
import { Buffer } from 'buffer';
import Auth from '../models/Auth.js';

let pendingUploads = new Map();
let fileMetadata = new Map();
const providerMap = wsController.providerMap;

async function handleUpload(req, res) {
  const file = req.file;
  const user = req.user;
  const swarmId = req.headers['x-swarm-id'];

  if (!file || !swarmId) {
    return res.status(400).json({ error: 'Missing file or swarm ID' });
  }

  const swarm = await Swarm.findById(swarmId);
  if (!swarm) return res.status(404).json({ error: 'Invalid swarm ID' });

  const bootstrap = await Bootstrap.findById(swarm.bootstrapId);
  if (!bootstrap) return res.status(404).json({ error: 'No bootstrap assigned' });

  const socket = bootstrapController.getSocket();
  const connectedPeerId = bootstrapController.getCurrentPeerId();

  if (!socket || socket.readyState !== 1 || connectedPeerId !== bootstrap.peerId) {
    return res.status(500).json({ error: 'Bootstrap peer mismatch or unavailable' });
  }

  const fileData = file.buffer.toString('base64');
  const requestId = Date.now().toString();

  pendingUploads.set(requestId, res);
  fileMetadata.set(requestId, {
    name: file.originalname,
    size: file.size,
    date: new Date().toISOString(),
    isFile: true,
    ownerId: user.id,
    storedIds: [],
    swarm: swarmId
  });

  socket.send(`upload|${requestId}|${file.originalname}|${fileData}`);
}

async function handleMessage(message) {
  const msg = message.toString();

  if (msg.startsWith('cid|')) {
    const [_, requestId, cid] = msg.split('|');
    const res = pendingUploads.get(requestId);
    const meta = fileMetadata.get(requestId);

    if (res && meta) {
      // Save file first
      const fileDoc = await FileModel.create({
        name: meta.name,
        cid,
        size: meta.size,
        date: meta.date,
        isFile: meta.isFile,
        ownerId: meta.ownerId,
        storedIds: [],
        swarm: meta.swarm
      });

      // Find providers in same swarm
      const providersInSwarm = [];
      for (const [ws, provider] of providerMap.entries()) {
        if (provider.swarms.includes(meta.swarm)) {
          providersInSwarm.push({ ws, provider });
        }
      }

      const selectedProviders = providersInSwarm.slice(0, 2);
      const storedIds = [];

      for (const { ws, provider } of selectedProviders) {
        try {
          ws.send(`pin|${cid}`);
          const authUser = await Auth.findOne({ peerId: provider.id });
          if (authUser) storedIds.push(authUser._id);
        } catch (err) {
          console.error(`Failed to pin to provider ${provider.id}:`, err);
        }
      }

      // Update file document with provider IDs
      fileDoc.storedIds = storedIds;
      await fileDoc.save();

      const socket = bootstrapController.getSocket();
      if (socket && socket.readyState === 1) {
        socket.send(`unpin|${cid}`);
      }

      res.json({ cid });
      pendingUploads.delete(requestId);
      fileMetadata.delete(requestId);
    }
  }
}

async function listFiles(req, res) {
  const user = req.user;
  const swarmId = req.headers['x-swarm-id'];
  if (!swarmId) return res.status(400).json({ error: 'Missing swarm ID' });

  try {
    const files = await FileModel.find({ ownerId: user.id, swarm: swarmId }).sort({ date: -1 });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
}
async function downloadFile(req, res) {
  const { cid } = req.params;
  const user = req.user;
  const swarmId = req.headers['x-swarm-id'];

  if (!cid || !swarmId) {
    return res.status(400).json({ error: 'Missing CID or swarmId' });
  }

  const file = await FileModel.findOne({ cid, swarm: swarmId });
  if (!file) return res.status(404).json({ error: 'File not found in your swarm' });

  const socket = bootstrapController.getSocket();
  const peerId = bootstrapController.getCurrentPeerId();

  const swarm = await Swarm.findById(swarmId);
  const bootstrap = await Bootstrap.findById(swarm.bootstrapId);

  if (!socket || socket.readyState !== 1 || bootstrap.peerId !== peerId) {
    return res.status(500).json({ error: 'Bootstrap not available' });
  }

  const requestId = Date.now().toString();
  const listener = (msg) => {
    const str = msg.toString();
    if (str.startsWith(`file|${requestId}|`)) {
      const base64 = str.split('|')[2];
      socket.off('message', listener);

      const buffer = Buffer.from(base64, 'base64');
      res.set({
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.name}"`,
        'Content-Length': buffer.length
      });
      return res.send(buffer);
    }
  };

  socket.on('message', listener);
  socket.send(`download|${requestId}|${cid}`);
}

async function deleteFile(req, res) {
  const { cid } = req.params;
  const user = req.user;
  const swarmId = req.headers['x-swarm-id'];

  if (!cid || !swarmId) return res.status(400).json({ error: 'Missing CID or swarm ID' });

  const file = await FileModel.findOne({ cid, swarm: swarmId, ownerId: user.id });
  if (!file) return res.status(404).json({ error: 'File not found or permission denied' });

  await FileModel.deleteOne({ _id: file._id });

  // Unpin from providers
  const providers = ProviderModel.getAll();
  for (const [ws] of providers.entries()) {
    if (ws.readyState === 1) {
      ws.send(`unpin|${cid}`);
    }
  }

  // Unpin from bootstrap
  const socket = bootstrapController.getSocket();
  if (socket && socket.readyState === 1) {
    socket.send(`unpin|${cid}`);
  }

  res.json({ message: 'File deleted and unpinned' });
}


export default { handleUpload, handleMessage, listFiles, downloadFile, deleteFile };
