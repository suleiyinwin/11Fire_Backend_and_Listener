import express from 'express';
import { startLogin, callback, upsertMembership, setActiveSwarm, me, logout } from '../controllers/authController.js';
import { attachUser, requireAuth } from '../middlewares/authMiddleware.js';
import { requireMembership } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.get('/login', startLogin);
router.get('/callback', callback);

router.use(attachUser); //Middleware that attaches the user from the session cookie
router.get('/me', me);
router.post('/memberships/upsert', requireAuth, upsertMembership); //add or update the user's membership
router.post('/active-swarm', requireAuth, setActiveSwarm); //Sets the user's active swarm.
router.post('/logout', requireAuth, logout);


export default router;