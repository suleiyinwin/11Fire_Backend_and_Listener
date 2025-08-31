import ProviderUptimeEvent from "../models/ProviderUptimeEvent.js";
import ProviderUptimeDaily from "../models/ProviderUptimeDaily.js";
import Auth from "../models/Auth.js";
import Swarm from "../models/Swarm.js";
import FileModel from "../models/FileModel.js";
import { bytesToGb } from "../utils/units.js";

function dayStrUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export async function getActiveQuotaUsage(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid).select(
      "_id activeSwarm memberships"
    );
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });

    const mem = user.getMembership
      ? user.getMembership(user.activeSwarm)
      : (user.memberships || []).find(
          (m) => String(m.swarm) === String(user.activeSwarm)
        );
    if (!mem)
      return res
        .status(403)
        .json({ error: "Not a member of the active swarm" });

    const quotaBytes = mem.quotaBytes ?? null;

    const r = await FileModel.aggregate([
      {
        $match: {
          swarm: user.activeSwarm,
          storedIds: { $elemMatch: { $eq: user._id } },
        },
      },
      { $group: { _id: null, total: { $sum: "$size" } } },
    ]);
    const usedBytes = r?.[0]?.total || 0;

    const SwarmModel = (await import("../models/Swarm.js")).default;
    const swarm = await SwarmModel.findById(user.activeSwarm)
      .select("name")
      .lean();

    const quotaGB = quotaBytes == null ? null : bytesToGb(quotaBytes);
    const usedGB = bytesToGb(usedBytes);
    const percentUsed =
      quotaBytes == null || quotaBytes === 0
        ? null
        : Math.round((usedBytes / quotaBytes) * 10000) / 100;

    return res.json({
      ok: true,
      swarmId: String(user.activeSwarm),
      swarmName: swarm?.name || null,
      quotaBytes,
      quotaGB,
      usedBytes,
      usedGB,
      percentUsed,
    });
  } catch (err) {
    console.error("getActiveQuotaUsage failed:", err);
    return res.status(500).json({ error: "Failed to compute quota usage" });
  }
}

export async function getActiveSwarmPeers(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    // Load user and ensure they have an active swarm
    const user = await Auth.findById(req.user.uid).select(
      "_id activeSwarm peerId memberships"
    );
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active group first" });

    // Ensure membership in the active swarm
    const mem = user.getMembership
      ? user.getMembership(user.activeSwarm)
      : (user.memberships || []).find(
          (m) => String(m.swarm) === String(user.activeSwarm)
        );
    if (!mem)
      return res
        .status(403)
        .json({ error: "Not a member of the active swarm" });

    // Fetch swarm to get name and members list (count includes self if they are a member)
    const SwarmModel = (await import("../models/Swarm.js")).default;
    const swarm = await SwarmModel.findById(user.activeSwarm)
      .select("name members")
      .lean();
    if (!swarm)
      return res.status(404).json({ error: "Active group not found" });

    const totalPeers = Array.isArray(swarm.members) ? swarm.members.length : 0;

    return res.json({
      ok: true,
      swarmId: String(user.activeSwarm),
      swarmName: swarm?.name || null,
      selfPeerId: user.peerId ?? null,
      totalPeers,
    });
  } catch (err) {
    console.error("getActiveGroupPeers failed:", err);
    return res.status(500).json({ error: "Failed to query active peers" });
  }
}

export async function getActiveUptime(req, res) {
  try {
    if (!req.user?.uid) return res.status(401).json({ error: "Unauthorized" });

    const user = await Auth.findById(req.user.uid).select("_id activeSwarm");
    if (!user?.activeSwarm)
      return res.status(400).json({ error: "Set an active swarm first" });

    const swarm = await Swarm.findById(user.activeSwarm).select("name").lean();

    const days = Math.max(1, Math.min(90, parseInt(req.query.window) || 30));
    const sinceDate = new Date(Date.now() - days * 24 * 3600 * 1000);
    const sinceDay = dayStrUTC(sinceDate);

    // 1) Sum daily buckets in the window
    const rows = await ProviderUptimeDaily.find({
      userId: user._id,
      swarm: user.activeSwarm,
      day: { $gte: sinceDay },
    }).lean();

    let online = 0,
      offline = 0;
    for (const r of rows) {
      online += r.onlineSeconds || 0;
      offline += r.offlineSeconds || 0;
    }

    // 2) Add the currently-open interval (if any) from max(open.start, since) -> now
    const open = await ProviderUptimeEvent.findOne({
      userId: user._id,
      swarm: user.activeSwarm,
      end: null,
    })
      .sort({ start: -1 })
      .lean();
    if (open) {
      const s = Math.max(new Date(open.start).getTime(), sinceDate.getTime());
      const delta = Math.max(0, (Date.now() - s) / 1000);
      if (open.state === "online") online += delta;
      else offline += delta;
    }

    const total = online + offline;
    const uptimePercent = total > 0 ? (online / total) * 100 : 0;

    const down = Math.round(offline);
    const dh = Math.floor(down / 3600);
    const dm = Math.floor((down % 3600) / 60);
    const downtimeText = `${dh}h ${dm}m`;

    return res.json({
      ok: true,
      swarmId: String(user.activeSwarm),
      swarmName: swarm?.name || null,
      uptimePercent: Math.round(uptimePercent * 10) / 10, // one decimal for a steady UI
      downtime: downtimeText,
    });
  } catch (err) {
    console.error("getActiveUptime failed:", err);
    res.status(500).json({ error: "Failed to compute uptime" });
  }
}

