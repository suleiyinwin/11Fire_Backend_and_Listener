import express from 'express';
import { claimPeerId } from '../controllers/providerController.js';

const router = express.Router();
router.post('/claim', claimPeerId); 
export default router;
