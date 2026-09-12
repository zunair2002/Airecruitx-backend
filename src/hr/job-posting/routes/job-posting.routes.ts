import { Router } from "express";
import { createJobHandler, listMyJobsHandler } from "../controller/job-posting.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import { uploadJdFile } from "../../../middleware/upload.middleware";
import { validate } from "../../../middleware/validate.middleware";
import { createJobSchema } from "./job-posting.schema";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireRole("hr"),
  uploadJdFile,
  validate({ body: createJobSchema }),
  createJobHandler
);
router.get("/mine", requireAuth, requireRole("hr"), listMyJobsHandler);

export default router;
