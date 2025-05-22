import express from 'express';
import swarmController from '../controllers/swarmController.js';
const router = express.Router();

router.post('/create', swarmController.createSwarm);
router.post('/join', swarmController.joinSwarm);
router.post('/role', swarmController.setRole);

export default router;