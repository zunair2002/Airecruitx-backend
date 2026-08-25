import { Router } from "express";
import {
  applyToJobHandler,
  listMyApplicationsHandler,
  startOrgInterviewHandler,
} from "../controller/application.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/:jobId/apply", requireAuth, requireRole("candidate"), applyToJobHandler);
router.get("/mine", requireAuth, requireRole("candidate"), listMyApplicationsHandler);
router.post(
  "/:applicationId/org-interview/start",
  requireAuth,
  requireRole("candidate"),
  startOrgInterviewHandler
);

export default router;
