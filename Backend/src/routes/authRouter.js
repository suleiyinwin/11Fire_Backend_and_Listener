import express from 'express';
import { initSession, testCookies, startLogin, callback, upsertMembership, setActiveSwarm, me, logout, mintProviderClaimToken, setActiveSwarmQuota, refreshToken } from '../controllers/authController.js';
import { attachUser, requireAuth } from '../middlewares/authMiddleware.js';
const router = express.Router();

router.post('/init-session', initSession); // Safari cookie initialization
router.get('/test-cookies', testCookies); // Cookie debugging endpoint
router.get('/login', startLogin);
router.get('/callback', callback);
router.post('/refresh-token', requireAuth, refreshToken);

router.use(attachUser); //Middleware that attaches the user from the session cookie
router.get('/me', me);
router.post('/provider-claim-token', requireAuth, mintProviderClaimToken); //Mint a new provider claim token for the user
router.post('/memberships/upsert', requireAuth, upsertMembership); //add or update the user's membership
router.post('/active-swarm', requireAuth, setActiveSwarm); //Sets the user's active swarm.
router.post('/memberships/active/quota', requireAuth, setActiveSwarmQuota);
router.post('/logout', requireAuth, logout);


export default router;