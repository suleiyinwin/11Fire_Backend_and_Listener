import jwt from "jsonwebtoken";

const COOKIE_NAME = "sid";

export function attachUser(req, _res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  // console.log("Incoming cookies:", req.cookies);
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, process.env.APP_JWT_SECRET);
    
    // Ensure tenant information exists
    if (!decoded.ms?.tid) {
      return _res.status(401).json({ error: "Invalid session - missing tenant info" });
    }
    
    req.user = decoded;
    console.log("Decoded JWT:", req.user); 
  } catch (err) {
    console.error("JWT verification failed:", err);
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  next();
}

/**
 * Ensure the user has ANY membership in the (resolved) swarm.
 * swarmId is resolved in this order: req.params.swarmId → req.query.swarmId → req.user.activeSwarm
 */
export function requireMembership(role) {
  return async (req, res, next) => {
    const swarmId = req.params.swarmId || req.query.swarmId || req.user?.activeSwarm;
    if (!swarmId) return res.status(400).json({ error: 'Missing swarm context' });

    const Auth = (await import('../models/Auth.js')).default;
    const user = await Auth.findById(req.user.uid);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const mem = user.getMembership(swarmId);
    if (!mem) return res.status(403).json({ error: 'Not a member of this swarm' });

    if (role && mem.role !== role) return res.status(403).json({ error: `Requires role ${role}` });

    // attach for downstream handlers
    req.authz = { swarmId, role: mem.role, peerId: (req.user?.peerId || null) };
    next();
  };
}