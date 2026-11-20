import { isValidObjectId } from "mongoose";
import { TECH_TOPICS, BASIC_TOPICS } from "../../../ai/topics";
import { AppError } from "../../../utils/AppError";
import { Course } from "../model/course.model";

const ALLOWED_TOPICS = new Set<string>([...TECH_TOPICS, ...BASIC_TOPICS, "general_cs"]);

export interface CourseInput {
  title: string;
  description: string;
  videoUrl: string;
  topics: string[];
}

const validateCourse = (input: CourseInput): CourseInput => {
  const title = input.title?.trim();
  const description = input.description?.trim();
  const videoUrl = input.videoUrl?.trim();
  const topics = Array.isArray(input.topics)
    ? [...new Set(input.topics.filter((topic) => typeof topic === "string").map((topic) => topic.trim()))]
    : [];

  if (!title || title.length > 120) throw new AppError("Title is required (max 120 characters)", 400);
  if (!description || description.length > 1000) throw new AppError("Description is required (max 1000 characters)", 400);
  if (!videoUrl) throw new AppError("videoUrl is required", 400);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(videoUrl);
  } catch {
    throw new AppError("videoUrl must be a valid HTTPS URL", 400);
  }
  if (parsedUrl.protocol !== "https:") throw new AppError("videoUrl must use HTTPS", 400);
  if (!topics.length || topics.some((topic) => !ALLOWED_TOPICS.has(topic))) {
    throw new AppError(`topics must contain one or more supported topics: ${[...ALLOWED_TOPICS].join(", ")}`, 400);
  }
  return { title, description, videoUrl, topics };
};

export const createCourse = async (hrId: string, input: CourseInput) => {
  const course = validateCourse(input);
  return Course.create({ ...course, createdBy: hrId });
};

export const listHrCourses = async () => Course.find().sort({ createdAt: -1 });

export const listActiveCourses = async () =>
  Course.find({ isActive: true }).sort({ createdAt: -1 }).lean();

export const updateCourse = async (courseId: string, input: CourseInput) => {
  if (!isValidObjectId(courseId)) throw new AppError("Invalid courseId", 400);
  const course = await Course.findByIdAndUpdate(courseId, validateCourse(input), {
    new: true,
    runValidators: true,
  });
  if (!course) throw new AppError("Course not found", 404);
  return course;
};

export const deleteCourse = async (courseId: string): Promise<void> => {
  if (!isValidObjectId(courseId)) throw new AppError("Invalid courseId", 400);
  const course = await Course.findByIdAndDelete(courseId);
  if (!course) throw new AppError("Course not found", 404);
};
