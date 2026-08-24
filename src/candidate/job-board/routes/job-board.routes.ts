import { Router } from "express";
import { listOpenJobsHandler } from "../controller/job-board.controller";
import { requireAuth } from "../../../middleware/auth.middleware";

const router = Router();

router.get("/open", requireAuth, listOpenJobsHandler);

export default router;
