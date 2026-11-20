import { isValidObjectId } from "mongoose";
import { TECH_TOPICS, BASIC_TOPICS } from "../../../ai/topics";
import { AppError } from "../../../utils/AppError";
import { Course, CourseTier, ICourse } from "../model/course.model";
import { User } from "../../../shared/user/model/user.model";

const ALLOWED_TOPICS = new Set<string>([...TECH_TOPICS, ...BASIC_TOPICS, "general_cs"]);

export type CourseInput = {
  title: string;
  description: string;
  videoUrl: string;
  topics: string[];
  tier: CourseTier;
};

const validateCourse = (input: CourseInput): CourseInput => {
  const title = input.title?.trim();
  const description = input.description?.trim();
  const videoUrl = input.videoUrl?.trim();
  const topics = Array.isArray(input.topics)
    ? [...new Set(input.topics.filter((topic) => typeof topic === "string").map((topic) => topic.trim()))]
    : [];
  const tier = input.tier ?? "free";

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
  if (!["free", "premium"].includes(tier)) throw new AppError("tier must be free or premium", 400);
  return { title, description, videoUrl, topics, tier };
};

/**
 * Active courses for a candidate, newest first. Free-plan candidates still see premium
 * courses (so they know what upgrading unlocks) but with the video URL stripped.
 */
export const listCoursesForCandidate = async (userId: string) => {
  const [user, courses] = await Promise.all([
    User.findById(userId).select("plan").lean(),
    Course.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
  ]);
  const premium = user?.plan === "premium";
  return courses.map((course) => {
    const tier = course.tier ?? "free";
    if (tier === "premium" && !premium) {
      const { videoUrl: _hidden, ...rest } = course;
      return { ...rest, tier, videoUrl: "", locked: true };
    }
    return { ...course, tier, locked: false };
  });
};

// HR users only see and manage courses they authored.
export const listCoursesForHr = (hrId: string) =>
  Course.find({ createdBy: hrId }).sort({ createdAt: -1 }).lean();

export const createCourse = (input: CourseInput, createdBy: string) =>
  Course.create({ ...validateCourse(input), createdBy });

export const updateCourse = async (hrId: string, courseId: string, input: CourseInput): Promise<ICourse> => {
  if (!isValidObjectId(courseId)) throw new AppError("Invalid courseId", 400);
  const course = await Course.findOne({ _id: courseId, createdBy: hrId });
  if (!course) throw new AppError("Course not found", 404);
  Object.assign(course, validateCourse(input));
  await course.save();
  return course;
};

export const deleteCourse = async (hrId: string, courseId: string) => {
  if (!isValidObjectId(courseId)) throw new AppError("Invalid courseId", 400);
  const result = await Course.deleteOne({ _id: courseId, createdBy: hrId });
  if (!result.deletedCount) throw new AppError("Course not found", 404);
  return { deleted: true };
};
