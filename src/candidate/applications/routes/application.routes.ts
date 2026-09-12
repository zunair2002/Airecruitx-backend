import { Router } from "express";
import { applyToJobHandler, listMyApplicationsHandler } from "../controller/application.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { validate } from "../../../middleware/validate.middleware";
import { jobIdParamSchema } from "./application.schema";

const router = Router();

router.post(
  "/:jobId/apply",
  requireAuth,
  requireRole("candidate"),
  validate({ params: jobIdParamSchema }),
  applyToJobHandler
);
router.get("/mine", requireAuth, requireRole("candidate"), listMyApplicationsHandler);

export default router;
