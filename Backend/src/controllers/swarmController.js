import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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
    // Generate swarm key
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

    await Auth.findByIdAndUpdate(req.user.id, { $push: { swarms: swarm._id } });
    await Bootstrap.findByIdAndUpdate(bootstrap._id, { isUsed: true, swarm: swarm._id });

    // Send key to bootstrap node
    const socket = bootstrapController.getSocketById(bootstrap.peerId);
    if (socket && socket.readyState === 1) {
      socket.send(`swarmkey|${key}`);
    }

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

    // Add user to swarm and vice versa
    await Swarm.findByIdAndUpdate(swarmId, { $addToSet: { members: req.user.id } });
    await Auth.findByIdAndUpdate(req.user.id, { $addToSet: { swarms: swarmId } });

    res.json({ message: 'Joined swarm successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to join swarm' });
  }
};

export default { createSwarm, joinSwarm };
