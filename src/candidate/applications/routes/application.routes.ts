import { Router } from "express";
import { applyToJobHandler, listMyApplicationsHandler } from "../controller/application.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";

const router = Router();

router.post("/:jobId/apply", requireAuth, requireRole("candidate"), applyToJobHandler);
router.get("/mine", requireAuth, requireRole("candidate"), listMyApplicationsHandler);

export default router;
