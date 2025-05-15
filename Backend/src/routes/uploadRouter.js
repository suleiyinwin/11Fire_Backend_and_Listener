import express from 'express';
import uploadController from '../controllers/uploadController.js';
import multer from 'multer';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/upload', authMiddleware, upload.single('file'), uploadController.handleUpload);
router.get('/files', authMiddleware, uploadController.listFiles);
router.get('/download/:cid', authMiddleware, uploadController.downloadFile);


export default router;
