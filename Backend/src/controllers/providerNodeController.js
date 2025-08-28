import Auth from "../models/Auth.js";
import FileModel from "../models/FileModel.js";
import { bytesToGb } from "../utils/units.js";

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

    const quotaGB = quotaBytes == null ? null : bytesToGb(quotaBytes);
    const usedGB = bytesToGb(usedBytes);
    const percentUsed =
      quotaBytes == null || quotaBytes === 0
        ? null
        : Math.round((usedBytes / quotaBytes) * 10000) / 100;

    return res.json({
      ok: true,
      swarmId: String(user.activeSwarm),
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
