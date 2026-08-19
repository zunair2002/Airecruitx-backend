import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { monitoringHandler } from "../controller/monitoring.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", monitoringHandler);

export default router;
