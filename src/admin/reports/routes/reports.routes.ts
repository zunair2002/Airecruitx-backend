import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { reportsSummaryHandler } from "../controller/reports.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/summary", reportsSummaryHandler);

export default router;
