import bcrypt from 'bcryptjs';
import Swarm from '../models/Swarm.js';
import Bootstrap from '../models/Bootstrap.js';
import Auth from '../models/Auth.js';
import { upsertMembershipForUser } from '../utils/membershipUtils.js';
import generator from 'js-ipfs-swarm-key-gen';

const createSwarm = async (req, res) => {
  const { password, role } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!['user', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'Valid role (user|provider) required' });
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
      members: [req.user.uid],
      bootstrapId: bootstrap._id
    });

    // Link this swarm to user's swarms[] (legacy)
    await Auth.findByIdAndUpdate(req.user.uid, {
      $addToSet: { swarms: swarm._id }
    });

    // Assign membership (role per swarm)
    const user = await Auth.findById(req.user.uid);
    await upsertMembershipForUser(user, { swarmId: swarm._id, role });

    // Mark bootstrap node as used
    await Bootstrap.findByIdAndUpdate(bootstrap._id, {
      isUsed: true,
      swarm: swarm._id,
    });

    // Send key to bootstrap node
    // const socket = bootstrapController.getSocket(bootstrap.peerId);
    // if (socket && socket.readyState === 1) {
    //   socket.send(`swarmkey|${key}`);
    // }
    // Optionally notify bootstrap socket (disabled)
    // const socket = bootstrapController.getSocket(bootstrap.peerId);
    // if (socket?.readyState === 1) socket.send(`swarmkey|${key}`);

    res.json({ message: 'Swarm created', swarmId: swarm._id });
  } catch (err) {
    console.error('Swarm creation failed:', err);
    res.status(500).json({ error: 'Swarm creation failed' });
  }
};

const joinSwarm = async (req, res) => {
  const { swarmId, password, role } = req.body;
  if (!swarmId || !password || !['user', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'swarmId, password, and valid role are required' });
  }

  try {
    const swarm = await Swarm.findById(swarmId);
    if (!swarm) return res.status(404).json({ error: 'Swarm not found' });

    const match = await bcrypt.compare(password, swarm.password);
    if (!match) return res.status(403).json({ error: 'Incorrect password' });

    const user = await Auth.findById(req.user.uid);

    // Check if user is already a member
    const isAlreadyMember = swarm.members.includes(req.user.uid);

    if (!isAlreadyMember) {
      await Swarm.findByIdAndUpdate(swarmId, { $addToSet: { members: req.user.uid } });
    }

    // Upsert membership with role
    await upsertMembershipForUser(user, { swarmId, role });

    res.json({ message: 'Joined swarm successfully' });
  } catch (err) {
    console.error('Join swarm failed:', err);
    res.status(500).json({ error: 'Failed to join swarm' });
  }
};


const setRole = async (req, res) => {
  const { role } = req.body;
  // console.log(role);
  if (!['user', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role) {
      return res.status(400).json({ error: 'Role already set' });
    }

    user.role = role;
    await user.save();

    res.json({ message: 'Role set successfully' });
  } catch (err) {
    console.error('Set role failed:', err);
    res.status(500).json({ error: 'Failed to set role' });
  }
};


export default { createSwarm, joinSwarm, setRole };
