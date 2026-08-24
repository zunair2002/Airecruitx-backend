import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { dashboardHandler } from "../controller/dashboard.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/", dashboardHandler);

export default router;
