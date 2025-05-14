import express from 'express';
import swarmController from '../controllers/swarmController.js';
const router = express.Router();

router.post('/create', swarmController.createSwarm);

export default router;