import { Router } from "express";
import {
  listCandidateCoursesHandler,
  listHrCoursesHandler,
  createCourseHandler,
  updateCourseHandler,
  deleteCourseHandler,
} from "../controller/learning.controller";
import { requireAuth, requireRole } from "../../../middleware/auth.middleware";

const router = Router();

router.get("/courses", requireAuth, requireRole("candidate"), listCandidateCoursesHandler);
router.get("/courses/hr", requireAuth, requireRole("hr"), listHrCoursesHandler);
router.post("/courses", requireAuth, requireRole("hr"), createCourseHandler);
router.put("/courses/:courseId", requireAuth, requireRole("hr"), updateCourseHandler);
router.delete("/courses/:courseId", requireAuth, requireRole("hr"), deleteCourseHandler);

export default router;
