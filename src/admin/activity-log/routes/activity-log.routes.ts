import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { listActivityLogsHandler } from "../controller/activity-log.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", listActivityLogsHandler);

export default router;
