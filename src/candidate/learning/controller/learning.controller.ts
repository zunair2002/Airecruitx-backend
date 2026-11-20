import { Request, Response } from "express";
import { AppError } from "../../../utils/AppError";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as learningService from "../service/learning.service";

const courseInput = (body: Record<string, unknown>): learningService.CourseInput => {
  const { title, description, videoUrl, topics } = body;
  if (
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof videoUrl !== "string" ||
    !Array.isArray(topics) ||
    !topics.every((topic): topic is string => typeof topic === "string")
  ) {
    throw new AppError("title, description, videoUrl, and topics are required", 400);
  }
  return { title, description, videoUrl, topics };
};

export const createCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  const course = await learningService.createCourse(req.user!._id.toString(), courseInput(req.body ?? {}));
  res.status(201).json({ success: true, data: course });
});

export const listHrCoursesHandler = asyncHandler(async (_req: Request, res: Response) => {
  const courses = await learningService.listHrCourses();
  res.status(200).json({ success: true, data: courses });
});

export const updateCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  const course = await learningService.updateCourse(req.params.courseId, courseInput(req.body ?? {}));
  res.status(200).json({ success: true, data: course });
});

export const deleteCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  await learningService.deleteCourse(req.params.courseId);
  res.status(200).json({ success: true, data: { deleted: true } });
});

export const listActiveCoursesHandler = asyncHandler(async (_req: Request, res: Response) => {
  const courses = await learningService.listActiveCourses();
  res.status(200).json({ success: true, data: courses });
});
