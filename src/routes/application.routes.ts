import { Router } from "express";
import {
  applyToJobHandler,
  listMyApplicationsHandler,
  listApplicationsForJobHandler,
  listMatchedApplicationsForJobHandler,
  getApplicationReportHandler,
  updateApplicationStatusHandler,
  scheduleOrgInterviewHandler,
} from "../controllers/application.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.post("/:jobId/apply", requireAuth, requireRole("candidate"), applyToJobHandler);
router.get("/mine", requireAuth, requireRole("candidate"), listMyApplicationsHandler);
router.get("/job/:jobId", requireAuth, requireRole("hr"), listApplicationsForJobHandler);
router.get("/job/:jobId/matched", requireAuth, requireRole("hr"), listMatchedApplicationsForJobHandler);
router.get("/:applicationId/report", requireAuth, requireRole("hr"), getApplicationReportHandler);
router.patch("/:applicationId/status", requireAuth, requireRole("hr"), updateApplicationStatusHandler);
router.post(
  "/:applicationId/org-interview",
  requireAuth,
  requireRole("hr"),
  scheduleOrgInterviewHandler
);

export default router;
