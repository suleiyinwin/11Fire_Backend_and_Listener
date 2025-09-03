import bcrypt from "bcryptjs";
import Swarm from "../models/Swarm.js";
import Bootstrap from "../models/Bootstrap.js";
import Auth from "../models/Auth.js";
import { upsertMembershipForUser } from "../utils/membershipUtils.js";
import { setActiveSwarmBackend } from "../controllers/authController.js";
import generator from "js-ipfs-swarm-key-gen";

const createSwarm = async (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !password || !role) {
    return res.status(400).json({ error: 'name, password, and role are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  if (!["user", "provider"].includes(role)) {
    return res
      .status(400)
      .json({ error: "Valid role (user|provider) required" });
  }

  try {
    // check unique swarm name
    const existing = await Swarm.findOne({ name });
    if (existing) return res.status(400).json({ error: 'Group name already exists' });

    // Generate swarm key using js-ipfs-swarm-key-gen
    const swarmKeyObj = await generator();
    const key = swarmKeyObj.key;

    // Find available bootstrap
    const bootstrap = await Bootstrap.findOne({ isUsed: false });
    if (!bootstrap)
      return res.status(400).json({ error: "No bootstrap nodes available" });

    const hashed = await bcrypt.hash(password, 10);
    const swarm = await Swarm.create({
      name,
      swarmkey: key,
      password: hashed,
      members: [req.user.uid],
      bootstrapId: bootstrap._id,
    });

    // Link this swarm to user's swarms[] (legacy)
    await Auth.findByIdAndUpdate(req.user.uid, {
      $addToSet: { swarms: swarm._id },
    });

    // Assign membership (role per swarm)
    const user = await Auth.findById(req.user.uid);
    await upsertMembershipForUser(user, { swarmId: swarm._id, role });

    // Put it in activeSwarm
    await setActiveSwarmBackend(req.user.uid, swarm._id);

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

    res.json({ message: "Group created", swarmId: swarm._id, name: swarm.name});
  } catch (err) {
    console.error("Group creation failed:", err);
    res.status(500).json({ error: "Group creation failed" });
  }
};

const joinSwarm = async (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !password || !role) {
    return res.status(400).json({ error: 'name, password, and role are required' });
  }
  if (!['user', 'provider'].includes(role)) {
    return res.status(400).json({ error: 'Valid role (user|provider) required' });
  }

  try {
    const swarm = await Swarm.findOne({name});
    if (!swarm) return res.status(404).json({ error: "Group not found" });

    const match = await bcrypt.compare(password, swarm.password);
    if (!match) return res.status(403).json({ error: "Incorrect password" });

    const user = await Auth.findById(req.user.uid);

    // Check if user is already a member
    const isAlreadyMember = swarm.members.includes(req.user.uid);

    if (!isAlreadyMember) {
      await Swarm.findByIdAndUpdate(swarm._id, {
        $addToSet: { members: req.user.uid },
      });
    }

    // Upsert membership with role
    await upsertMembershipForUser(user, { swarmId : swarm._id, role });

    // Put it in activeSwarm
    await setActiveSwarmBackend(req.user.uid, swarm._id);

    res.json({ ok: true, message: 'Joined group successfully', name: swarm.name });
  } catch (err) {
    console.error("Join group failed:", err);
    res.status(500).json({ error: "Failed to join group" });
  }
};

const setRole = async (req, res) => {
  const { role } = req.body;
  // console.log(role);
  if (!["user", "provider"].includes(role)) {
    return res.status(400).json({ error: "Invalid role" });
  }

  try {
    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "User not found" });

    if (user.role) {
      return res.status(400).json({ error: "Role already set" });
    }

    user.role = role;
    await user.save();

    res.json({ message: "Role set successfully" });
  } catch (err) {
    console.error("Set role failed:", err);
    res.status(500).json({ error: "Failed to set role" });
  }
};

const listMySwarms = async (req, res) => {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid).populate(
      "memberships.swarm"
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    const items = (user.memberships || []).map((m) => ({
      swarmId: String(m.swarm?._id || m.swarm),
      swarmName: m.swarm?.name || null,
      role: m.role,
      quotaBytes: m.quotaBytes,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      bootstrapId: m.swarm?.bootstrapId || null,
    }));

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("listMyGroups failed:", err);
    return res.status(500).json({ error: "Failed to list groups" });
  }
};

const swarmNameCheck = async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }

  try {
    const swarm = await Swarm.findOne({ name });
    if (!swarm) {
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Group name already exists' });
  } catch (err) {
    console.error("Gruop name check failed:", err);
    return res.status(500).json({ error: "Failed to check group name" });
  }
}

const swarmPasswordCheck = async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) {
    return res.status(400).json({ error: "Name and password are required" });
  }

  try {
    const swarm = await Swarm.findOne({ name });
    if (!swarm) {
      return res.status(404).json({ error: "Group not found" });
    }

    const match = await bcrypt.compare(password, swarm.password);
    if (!match) {
      return res.status(403).json({ error: "Incorrect password" });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("Group password check failed:", err);
    return res.status(500).json({ error: "Failed to check group password" });
  }
}

export default { createSwarm, joinSwarm, setRole, listMySwarms, swarmNameCheck, swarmPasswordCheck };
