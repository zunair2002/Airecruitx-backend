import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";
import {
  createCourseHandler,
  deleteCourseHandler,
  listCandidateCoursesHandler,
  listHrCoursesHandler,
  updateCourseHandler,
} from "../controller/learning.controller";

const router = Router();

router.get("/courses/hr", requireAuth, requireRole("hr"), listHrCoursesHandler);
router.get("/courses", requireAuth, requireRole("candidate"), listCandidateCoursesHandler);
router.post("/courses", requireAuth, requireRole("hr"), createCourseHandler);
router.put("/courses/:courseId", requireAuth, requireRole("hr"), updateCourseHandler);
router.delete("/courses/:courseId", requireAuth, requireRole("hr"), deleteCourseHandler);

export default router;
