import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listAllJobsHandler,
  closeJobHandler,
  deleteJobHandler,
  listAllApplicationsHandler,
} from "../controller/content-management.controller";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/jobs", listAllJobsHandler);
router.patch("/jobs/:jobId/close", closeJobHandler);
router.delete("/jobs/:jobId", deleteJobHandler);

router.get("/applications", listAllApplicationsHandler);

export default router;
