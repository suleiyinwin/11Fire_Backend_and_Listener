import express from 'express';
import uploadController from '../controllers/uploadController.js';
import multer from 'multer';

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/upload', upload.single('file'), uploadController.handleUpload);
router.get('/files', uploadController.listFiles);


export default router;