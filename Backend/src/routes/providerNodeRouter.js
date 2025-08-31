import express from "express";
import { getActiveQuotaUsage, getActiveUptime, getActiveSwarmPeers, getActiveUptimeLine24h } from "../controllers/providerNodeController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Provider's quota usage for active swarm (cookie auth)
router.get("/active/quota-usage", requireAuth, getActiveQuotaUsage);

router.get("/active/peers", requireAuth, getActiveSwarmPeers);

router.get("/active/uptime", requireAuth, getActiveUptime);

router.get("/active/uptime-line-24h", requireAuth, getActiveUptimeLine24h);

export default router;