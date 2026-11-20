import { Router } from "express";
import {
  listApplicationsForJobHandler,
  listMatchedApplicationsForJobHandler,
  getApplicationReportHandler,
  updateApplicationStatusHandler,
  scheduleAiInterviewHandler,
  inviteToOrgInterviewHandler,
  bulkUpdateStatusHandler,
  bulkAiInterviewHandler,
  bulkOrgInterviewInviteHandler,
} from "../controller/applicant-review.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";

const router = Router();

router.get("/job/:jobId", requireAuth, requireRole("hr"), listApplicationsForJobHandler);
router.get("/job/:jobId/matched", requireAuth, requireRole("hr"), listMatchedApplicationsForJobHandler);

// Registered before the "/:applicationId/..." routes below — otherwise e.g.
// PATCH /bulk/status would match "/:applicationId/status" with applicationId="bulk".
router.patch("/bulk/status", requireAuth, requireRole("hr"), bulkUpdateStatusHandler);
router.post("/bulk/ai-interview", requireAuth, requireRole("hr"), bulkAiInterviewHandler);
router.post("/bulk/org-interview-invite", requireAuth, requireRole("hr"), bulkOrgInterviewInviteHandler);

router.get("/:applicationId/report", requireAuth, requireRole("hr"), getApplicationReportHandler);
router.patch("/:applicationId/status", requireAuth, requireRole("hr"), updateApplicationStatusHandler);
router.post(
  "/:applicationId/ai-interview",
  requireAuth,
  requireRole("hr"),
  scheduleAiInterviewHandler
);
router.post(
  "/:applicationId/org-interview-invite",
  requireAuth,
  requireRole("hr"),
  inviteToOrgInterviewHandler
);

export default router;
