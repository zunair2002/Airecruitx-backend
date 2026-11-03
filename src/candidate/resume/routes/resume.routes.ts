import { Router } from "express";
import {
  uploadResumeHandler,
  getMyResumeHandler,
  deleteMyResumeHandler,
} from "../controller/resume.controller";
import {
  requireAuth,
  requireRole,
} from "../../../middleware/auth.middleware";
import { uploadResumeFile } from "../../../middleware/upload.middleware";

const router = Router();

// requireAuth first — reject unauthenticated requests before doing any file work.
router.post(
  "/upload",
  requireAuth,
  requireRole("candidate"),
  uploadResumeFile,
  uploadResumeHandler,
);
router.get("/mine", requireAuth, requireRole("candidate"), getMyResumeHandler);
router.delete(
  "/mine",
  requireAuth,
  requireRole("candidate"),
  deleteMyResumeHandler,
);

export default router;
