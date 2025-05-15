import bootstrapController from './bootstrapController.js';
import FileModel from '../models/FileModel.js';
import ProviderModel from '../models/providerModel.js';
import Swarm from '../models/Swarm.js';
import Bootstrap from '../models/Bootstrap.js';

let pendingUploads = new Map();
let fileMetadata = new Map();

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
    storedId: user.id,
    swarm: swarmId
  });

  socket.send(`upload|${requestId}|${file.originalname}|${fileData}`);
}

function handleMessage(message) {
  const msg = message.toString();

  if (msg.startsWith('cid|')) {
    const [_, requestId, cid] = msg.split('|');
    const res = pendingUploads.get(requestId);
    const meta = fileMetadata.get(requestId);

    if (res && meta) {
      FileModel.create({
        name: meta.name,
        cid,
        size: meta.size,
        date: meta.date,
        isFile: meta.isFile,
        ownerId: meta.ownerId,
        storedId: meta.storedId,
        swarm: meta.swarm
      }).then(() => console.log('File metadata saved')).catch(console.error);

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

async function listFiles(req, res) {
  const user = req.user;
  const swarmId = req.headers['x-swarm-id'];
  if (!swarmId) return res.status(400).json({ error: 'Missing swarm ID' });

  try {
    const files = await FileModel.find({ swarm: swarmId }).sort({ date: -1 });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch files' });
  }
}

export default { handleUpload, handleMessage, listFiles };
