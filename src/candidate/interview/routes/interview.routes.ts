import { Router } from "express";
import {
  startInterviewHandler,
  submitAnswerHandler,
  getReportHandler,
} from "../controller/interview.controller";
import { requireAuth } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/start", requireAuth, startInterviewHandler);
router.post("/answer", requireAuth, submitAnswerHandler);
router.get("/report/:sessionId", requireAuth, getReportHandler);

export default router;
