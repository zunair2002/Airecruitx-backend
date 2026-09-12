import { Router } from "express";
import { uploadResumeHandler, getMyResumeHandler } from "../controller/resume.controller";
import { requireAuth } from "../../../middleware/auth.middleware";
import { uploadResumeFile } from "../../../middleware/upload.middleware";

const router = Router();

// requireAuth first — reject unauthenticated requests before doing any file work.
router.post("/upload", requireAuth, uploadResumeFile, uploadResumeHandler);
router.get("/mine", requireAuth, getMyResumeHandler);

export default router;
