import express from "express";
import multer from "multer";
import { requireAuth } from "../middlewares/authMiddleware.js";
import {
  uploadAndReplicate,
  downloadFile,
  deleteFile,
  downloadMultipleFiles,
  deleteMultipleFiles, 
  listMyFilesInActiveSwarm,
  renameFile
} from "../controllers/fileController.js";

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

// download by CID
router.get("/download/:cid", requireAuth, downloadFile);
router.post("/download-multiple", requireAuth, downloadMultipleFiles);

// Delete a file by CID (owner-only)
router.delete("/delete/:cid", requireAuth, deleteFile);
router.delete("/delete-multiple", requireAuth, deleteMultipleFiles);

// List my files in active swarm
router.get("/mine", requireAuth, listMyFilesInActiveSwarm);

// Rename a file by CID (owner-only)
router.patch("/rename/:cid", requireAuth, renameFile);



export default router;
