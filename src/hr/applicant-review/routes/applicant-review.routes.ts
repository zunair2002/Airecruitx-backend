import { Router } from "express";
import {
  listApplicationsForJobHandler,
  listMatchedApplicationsForJobHandler,
  getApplicationReportHandler,
  updateApplicationStatusHandler,
  scheduleAiInterviewHandler,
  scheduleOrgInterviewHandler,
} from "../controller/applicant-review.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate.middleware";
import {
  jobIdParamSchema,
  applicationIdParamSchema,
  updateStatusSchema,
  scheduleAiInterviewSchema,
  scheduleOrgInterviewSchema,
} from "./applicant-review.schema";

const router = Router();

router.get(
  "/job/:jobId",
  requireAuth,
  requireRole("hr"),
  validate({ params: jobIdParamSchema }),
  listApplicationsForJobHandler
);
router.get(
  "/job/:jobId/matched",
  requireAuth,
  requireRole("hr"),
  validate({ params: jobIdParamSchema }),
  listMatchedApplicationsForJobHandler
);
router.get(
  "/:applicationId/report",
  requireAuth,
  requireRole("hr"),
  validate({ params: applicationIdParamSchema }),
  getApplicationReportHandler
);
router.patch(
  "/:applicationId/status",
  requireAuth,
  requireRole("hr"),
  validate({ params: applicationIdParamSchema, body: updateStatusSchema }),
  updateApplicationStatusHandler
);
router.post(
  "/:applicationId/ai-interview",
  requireAuth,
  requireRole("hr"),
  validate({ params: applicationIdParamSchema, body: scheduleAiInterviewSchema }),
  scheduleAiInterviewHandler
);
router.post(
  "/:applicationId/org-interview",
  requireAuth,
  requireRole("hr"),
  validate({ params: applicationIdParamSchema, body: scheduleOrgInterviewSchema }),
  scheduleOrgInterviewHandler
);

export default router;
