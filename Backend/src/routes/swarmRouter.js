import express from 'express';
import swarmController from '../controllers/swarmController.js';
import { requireAuth } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/create', requireAuth, swarmController.createSwarm);
router.post('/join', requireAuth, swarmController.joinSwarm);
router.post('/set-role', requireAuth, swarmController.setRole); // optional legacy role setter
router.get('/my-swarms', requireAuth, swarmController.listMySwarms);
router.post('/name-check', requireAuth, swarmController.swarmNameCheck);
router.post('/password-check', swarmController.swarmPasswordCheck);
router.post('/leave', requireAuth, swarmController.leaveSwarm);
router.post('/leave-test', swarmController.leaveSwarmtest); // Test endpoint

export default router;