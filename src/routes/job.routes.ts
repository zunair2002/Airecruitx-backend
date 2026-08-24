import { Router } from "express";
import { createJobHandler, listJobsHandler } from "../controllers/job.controller";
import { requireAuth, requireRole } from "../middleware/auth.middleware";

const router = Router();

router.post("/", requireAuth, requireRole("hr"), createJobHandler);
router.get("/", requireAuth, listJobsHandler);

export default router;
