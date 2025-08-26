import express from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/authMiddleware.js";
import { uploadAndReplicate } from "../controllers/fileController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 },
}); // 1 GiB cap example

const router = express.Router();

router.post(
  "/upload",
  requireAuth,
  upload.fields([
    { name: "file", maxCount: 1 },
    { name: "upload", maxCount: 1 },
  ]),
  (req, res, next) => {
    const f = req.files?.file?.[0] || req.files?.upload?.[0];
    if (!f)
      return res
        .status(400)
        .json({ error: 'No file provided (use form-data key "file")' });
    req.file = f; // normalize for controller
    next();
  },
  uploadAndReplicate
);

export default router;
