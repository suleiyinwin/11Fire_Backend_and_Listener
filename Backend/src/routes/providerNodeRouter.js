import express from "express";
import { getActiveQuotaUsage } from "../controllers/providerNodeController.js";
import { requireAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// Provider's quota usage for active swarm (cookie auth)
router.get("/active/quota-usage", requireAuth, getActiveQuotaUsage);

export default router;