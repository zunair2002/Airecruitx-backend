import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  listAllJobsHandler,
  closeJobHandler,
  deleteJobHandler,
  listAllApplicationsHandler,
} from "../controller/content-management.controller";
import { validate } from "../../../middleware/validate.middleware";
import { jobIdParamSchema } from "./content-management.schema";

const router = Router();

router.use(requireAuth, requireRole("admin"));

router.get("/jobs", listAllJobsHandler);
router.patch("/jobs/:jobId/close", validate({ params: jobIdParamSchema }), closeJobHandler);
router.delete("/jobs/:jobId", validate({ params: jobIdParamSchema }), deleteJobHandler);

router.get("/applications", listAllApplicationsHandler);

export default router;
