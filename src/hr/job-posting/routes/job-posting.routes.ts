import { Router } from "express";
import {
  createJobHandler,
  listMyJobsHandler,
  updateJobStatusHandler,
  uploadQuestionSetHandler,
  getQuestionSetHandler,
} from "../controller/job-posting.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { uploadJdFile, uploadQuestionPoolFile } from "../../../middleware/upload.middleware";

const router = Router();

router.post("/", requireAuth, requireRole("hr"), uploadJdFile, createJobHandler);
router.get("/mine", requireAuth, requireRole("hr"), listMyJobsHandler);
router.patch("/:jobId/status", requireAuth, requireRole("hr"), updateJobStatusHandler);
router.put(
  "/:jobId/interview-questions",
  requireAuth,
  requireRole("hr"),
  uploadQuestionPoolFile,
  uploadQuestionSetHandler
);
router.get("/:jobId/interview-questions", requireAuth, requireRole("hr"), getQuestionSetHandler);

export default router;
