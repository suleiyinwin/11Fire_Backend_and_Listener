import bcrypt from "bcryptjs";
import Swarm from "../models/Swarm.js";
import Bootstrap from "../models/Bootstrap.js";
import Auth from "../models/Auth.js";
import FileModel from "../models/FileModel.js";
import { upsertMembershipForUser } from "../utils/membershipUtils.js";
import { setActiveSwarmBackend } from "../controllers/authController.js";
import crypto from "crypto";
import {
  deleteAllFilesForOwnerInSwarm,
  migrateAllFilesFromProviderInSwarm,
} from "../helpers/migrationHelper.js";
import {
  emitSwarmCreated,
  emitSwarmJoined,
  emitSwarmLeft,
  emitUserRoleSet,
} from "../utils/eventSystem.js";
import { calculateAndEmitStorageMetrics } from "../utils/eventSystem.js";


function generateSwarmKeyV1() {
  const hex = crypto.randomBytes(32).toString("hex");
  return `/key/swarm/psk/1.0.0/\n/base16\n${hex}`;
}

const createSwarm = async (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !password || !role) {
    return res
      .status(400)
      .json({ error: "name, password, and role are required" });
  }
  if (password.length < 8) {
    return res
      .status(400)
      .json({ error: "Password must be at least 8 characters" });
  }

  if (!["user", "provider"].includes(role)) {
    return res
      .status(400)
      .json({ error: "Valid role (user|provider) required" });
  }

  try {
    const tenantId = req.user.ms?.tid;
    if (!tenantId) {
      return res.status(400).json({ error: "User tenant information missing" });
    }

    // check unique swarm name
    const existing = await Swarm.findOne({ name, tenantId });
    if (existing)
      return res.status(400).json({ error: "Group name already exists" });

    // Use same swarm keys for same tenant
    let key;
    const existingSwarm = await Swarm.findOne({ tenantId });
    if (existingSwarm) {
      key = existingSwarm.swarmkey;
    } else {
      key = generateSwarmKeyV1();
    }
    // Generate swarm key using js-ipfs-swarm-key-gen

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
      tenantId,
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

    // Emit swarm created event
    emitSwarmCreated({
      swarmId: swarm._id,
      name: swarm.name,
      creator: {
        userId: req.user.uid,
        username: user.username,
      },
    });

    await calculateAndEmitStorageMetrics(swarm._id, "swarm_created");

    res.json({
      message: "Group created",
      swarmId: swarm._id,
      name: swarm.name,
    });
  } catch (err) {
    console.error("Group creation failed:", err);
    res.status(500).json({ error: "Group creation failed" });
  }
};

const joinSwarm = async (req, res) => {
  const { name, password, role } = req.body;
  if (!name || !password || !role) {
    return res
      .status(400)
      .json({ error: "name, password, and role are required" });
  }
  if (!["user", "provider"].includes(role)) {
    return res
      .status(400)
      .json({ error: "Valid role (user|provider) required" });
  }

  try {
    const tenantId = req.user.ms?.tid;
    if (!tenantId) {
      return res.status(400).json({ error: "User tenant information missing" });
    }

    const swarm = await Swarm.findOne({ name, tenantId });
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
    await upsertMembershipForUser(user, { swarmId: swarm._id, role });

    // Put it in activeSwarm
    await setActiveSwarmBackend(req.user.uid, swarm._id);

    // Emit swarm joined event
    emitSwarmJoined(
      {
        userId: req.user.uid,
        username: user.username,
        role: role,
      },
      {
        swarmId: swarm._id,
        name: swarm.name,
      }
    );

    await calculateAndEmitStorageMetrics(swarm._id, "member_joined");

    res.json({
      ok: true,
      message: "Joined group successfully",
      name: swarm.name,
    });
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

    emitUserRoleSet(
      {
        userId: user._id,
        username: user.username,
      },
      role
    );

    res.json({ message: "Role set successfully" });
  } catch (err) {
    console.error("Set role failed:", err);
    res.status(500).json({ error: "Failed to set role" });
  }
};

const listMySwarms = async (req, res) => {
  try {
    const tenantId = req.user.ms?.tid;
    if (!tenantId) {
      return res.status(400).json({ error: "User tenant information missing" });
    }

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
    return res.status(400).json({ error: "Group name already exists" });
  } catch (err) {
    console.error("Gruop name check failed:", err);
    return res.status(500).json({ error: "Failed to check group name" });
  }
};

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
};

const leaveSwarm = async (req, res) => {
  try {
    const userId = req.user?.uid;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Resolve target swarm
    const me = await Auth.findById(userId).select("memberships activeSwarm");
    const user = await Auth.findById(req.user.uid);
    if (!me) return res.status(401).json({ error: "Unauthorized" });

    const swarmId = req.body?.swarmId || me.activeSwarm;
    if (!swarmId)
      return res.status(400).json({ error: "No swarm specified/active" });

    const swarm = await Swarm.findById(swarmId);

    // Determine the caller's role inside that swarm
    const mem = (me.memberships || []).find(
      (m) => String(m.swarm) === String(swarmId)
    );
    if (!mem)
      return res.status(404).json({ error: "Not a member of this swarm" });

    const role = mem.role; // "user" | "provider"

    // 1) Always delete files *owned* by the leaver
    const deletedCount = await deleteAllFilesForOwnerInSwarm(userId, swarmId);

    let migratedFiles = 0;
    let skippedMigrations = 0;

    // 2) If provider, migrate files they were *storing* (not just owning)
    if (role === "provider") {
      const r = await migrateAllFilesFromProviderInSwarm(userId, swarmId);
      migratedFiles = r.migratedFiles;
      skippedMigrations = r.skippedMigrations;
    }

    // 3) Remove membership and clear activeSwarm if it matches
    await Auth.updateOne(
      { _id: userId },
      {
        $pull: { memberships: { swarm: swarmId } },
        ...(String(me.activeSwarm) === String(swarmId)
          ? { $set: { activeSwarm: null } }
          : {}),
      }
    );

    // Remove the user from swarm's members[]
    await Swarm.updateOne({ _id: swarmId }, { $pull: { members: userId } });

    // 4) If this user was the *last* member in the swarm, clean up the swarm & bootstrap
    // We check remaining Auth documents that still reference this swarm.
    const remaining = await Auth.countDocuments({
      "memberships.swarm": swarmId,
    });
    let swarmDeleted = false;
    if (remaining === 0) {
      // Check if there is any file left in this swarm (shouldn't be any) and delete them
      const filesLeft = await FileModel.countDocuments({ swarm: swarmId });
      if (filesLeft > 0) {
        await FileModel.deleteMany({ swarm: swarmId });
      }

      // Mark swarm's bootstrap as unused and clear its swarm field
      const swarmDoc = await Swarm.findById(swarmId).select("bootstrapId");
      if (swarmDoc?.bootstrapId) {
        try {
          await Bootstrap.updateOne(
            { _id: swarmDoc.bootstrapId },
            { $set: { isUsed: false, swarm: null } }
          );
        } catch (e) {
          console.warn("Bootstrap update after last-leave failed:", e?.message);
        }
      }

      // Finally, delete the swarm itself
      await Swarm.deleteOne({ _id: swarmId });
      swarmDeleted = true;
    }

    // Emit swarm left event
    emitSwarmLeft(
      {
        userId: userId,
        username: user.username,
        role: role,
      },
      {
        swarmId: swarmId,
        name: swarm?.name || null,
        deleted: swarmDeleted,
      }
    );

    return res.json({
      ok: true,
      details: { deletedCount, migratedFiles, skippedMigrations },
    });
  } catch (e) {
    console.error("leaveSwarm failed:", e);
    return res.status(500).json({ error: "leave failed" });
  }
};

export default {
  createSwarm,
  joinSwarm,
  setRole,
  listMySwarms,
  swarmNameCheck,
  swarmPasswordCheck,
  leaveSwarm,
};
