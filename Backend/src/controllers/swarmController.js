import bcrypt from 'bcryptjs';
import Swarm from '../models/Swarm.js';
import Bootstrap from '../models/Bootstrap.js';
import Auth from '../models/Auth.js';
import bootstrapController from './bootstrapController.js';
import generator from 'js-ipfs-swarm-key-gen';

const createSwarm = async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Generate swarm key using js-ipfs-swarm-key-gen
    const swarmKeyObj = await generator();
    const key = swarmKeyObj.key;

    // Find available bootstrap
    const bootstrap = await Bootstrap.findOne({ isUsed: false });
    if (!bootstrap) return res.status(400).json({ error: 'No bootstrap nodes available' });

    const hashed = await bcrypt.hash(password, 10);
    const swarm = await Swarm.create({
      swarmkey: key,
      password: hashed,
      members: [req.user.id],
      bootstrapId: bootstrap._id
    });

    await Auth.findByIdAndUpdate(req.user.id, {
      $addToSet: { swarms: swarm._id }
    });

    await Bootstrap.findByIdAndUpdate(bootstrap._id, { isUsed: true, swarm: swarm._id });

    // Send key to bootstrap node
    // const socket = bootstrapController.getSocket(bootstrap.peerId);
    // if (socket && socket.readyState === 1) {
    //   socket.send(`swarmkey|${key}`);
    // }

    res.json({ message: 'Swarm created', swarmId: swarm._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Swarm creation failed' });
  }
};

const joinSwarm = async (req, res) => {
  const { swarmId, password } = req.body;
  if (!swarmId || !password) {
    return res.status(400).json({ error: 'Swarm ID and password are required' });
  }

  try {
    const swarm = await Swarm.findById(swarmId);
    if (!swarm) return res.status(404).json({ error: 'Swarm not found' });

    const match = await bcrypt.compare(password, swarm.password);
    if (!match) return res.status(403).json({ error: 'Incorrect password' });

    // Check if user is already a member
    const alreadyMember = swarm.members.includes(req.user.id);
    const user = await Auth.findById(req.user.id);
    const hasSwarm = user.swarms.includes(swarmId);

    if (!alreadyMember) {
      await Swarm.findByIdAndUpdate(swarmId, { $addToSet: { members: req.user.id } });
    }

    const updates = {};
    if (!hasSwarm) updates.$addToSet = { ...updates.$addToSet, swarms: swarmId };

    if (Object.keys(updates).length > 0) {
      await Auth.findByIdAndUpdate(req.user.id, updates);
    }

    res.json({ message: 'Joined swarm successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join swarm' });
  }
};


const setRole = async (req, res) => {
  const { role } = req.body;
  console.log(role);
  if (!['user', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = await Auth.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role) {
      return res.status(400).json({ error: 'Role already set' });
    }

    user.role = role;
    await user.save();

    res.json({ message: 'Role set successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to set role' });
  }
};


export default { createSwarm, joinSwarm, setRole };
