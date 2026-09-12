import { Router } from "express";
import {
  startInterviewHandler,
  submitAnswerHandler,
  getReportHandler,
} from "../controller/interview.controller";
import { requireAuth } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate.middleware";
import { startInterviewSchema, submitAnswerSchema, sessionIdParamSchema } from "./interview.schema";

const router = Router();

router.post("/start", requireAuth, validate({ body: startInterviewSchema }), startInterviewHandler);
router.post("/answer", requireAuth, validate({ body: submitAnswerSchema }), submitAnswerHandler);
router.get(
  "/report/:sessionId",
  requireAuth,
  validate({ params: sessionIdParamSchema }),
  getReportHandler
);

export default router;
