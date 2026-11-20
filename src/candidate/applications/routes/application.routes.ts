import { Router } from "express";
import {
  applyToJobHandler,
  listMyApplicationsHandler,
  getOrgInterviewInviteHandler,
  startOrgInterviewByTokenHandler,
  submitOrgInterviewAnswerByTokenHandler,
} from "../controller/application.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/:jobId/apply", requireAuth, requireRole("candidate"), applyToJobHandler);
router.get("/mine", requireAuth, requireRole("candidate"), listMyApplicationsHandler);

// Public/token-authenticated — reached from the emailed invite link, not a login
// session. See the comment on resolveActiveOrgInterviewInvite in application.service.ts.
router.get("/org-interview/:token", getOrgInterviewInviteHandler);
router.post("/org-interview/:token/start", startOrgInterviewByTokenHandler);
router.post("/org-interview/:token/answer", submitOrgInterviewAnswerByTokenHandler);

export default router;
