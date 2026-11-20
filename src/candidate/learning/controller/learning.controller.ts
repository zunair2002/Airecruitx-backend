import { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { BASIC_TOPICS, TECH_TOPICS } from "../../../ai/topics";
import { AppError } from "../../../utils/AppError";
import { asyncHandler } from "../../../utils/asyncHandler";
import { COURSE_TIERS, CourseTier } from "../model/course.model";
import * as learningService from "../service/learning.service";

const VALID_TOPICS = new Set<string>([...TECH_TOPICS, ...BASIC_TOPICS, "general_cs"]);

const parseCourseInput = (body: Record<string, unknown> = {}): learningService.CourseInput => {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  const topics = Array.isArray(body.topics) ? body.topics : [];
  const tier = (body.tier ?? "free") as CourseTier;

  if (!title) throw new AppError("title is required", 400);
  if (!description) throw new AppError("description is required", 400);
  if (!/^https:\/\/\S+$/i.test(videoUrl)) throw new AppError("videoUrl must be an https:// link", 400);
  const invalid = topics.filter((topic) => typeof topic !== "string" || !VALID_TOPICS.has(topic));
  if (invalid.length) throw new AppError(`Unknown topics: ${invalid.join(", ")}`, 400);
  if (!COURSE_TIERS.includes(tier)) throw new AppError(`tier must be one of: ${COURSE_TIERS.join(", ")}`, 400);

  return { title, description, videoUrl, topics: [...new Set(topics as string[])], tier };
};

const courseIdOf = (req: Request): string => {
  const { courseId } = req.params;
  if (!isValidObjectId(courseId)) throw new AppError("Invalid courseId", 400);
  return courseId;
};

export const listCandidateCoursesHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await learningService.listCoursesForCandidate(req.user!._id.toString());
  res.status(200).json({ success: true, data });
});

export const listActiveCoursesHandler = listCandidateCoursesHandler;

export const listHrCoursesHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await learningService.listCoursesForHr(req.user!._id.toString());
  res.status(200).json({ success: true, data });
});

export const createCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  const course = await learningService.createCourse(
    parseCourseInput(req.body),
    req.user!._id.toString()
  );
  res.status(201).json({ success: true, data: course });
});

export const updateCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  const course = await learningService.updateCourse(
    req.user!._id.toString(),
    courseIdOf(req),
    parseCourseInput(req.body)
  );
  res.status(200).json({ success: true, data: course });
});

export const deleteCourseHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await learningService.deleteCourse(
    req.user!._id.toString(),
    courseIdOf(req)
  );
  res.status(200).json({ success: true, data });
});
