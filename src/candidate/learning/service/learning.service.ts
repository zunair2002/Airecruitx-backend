import { Course, CourseTier, ICourse } from "../model/course.model";
import { User, effectivePlan } from "../../../shared/user/model/user.model";
import { AppError } from "../../../utils/AppError";

export type CourseInput = {
  title: string;
  description: string;
  videoUrl: string;
  topics: string[];
  tier: CourseTier;
};

/**
 * Active courses for a candidate, newest first. Free-plan candidates still see premium
 * courses (so they know what upgrading unlocks) but with the video URL stripped.
 */
export const listCoursesForCandidate = async (userId: string) => {
  const [user, courses] = await Promise.all([
    User.findById(userId).select("plan planExpiresAt").lean(),
    Course.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
  ]);
  const premium = effectivePlan(user) === "premium";
  return courses.map((course) => {
    const tier = course.tier ?? "free";
    if (tier === "premium" && !premium) {
      const { videoUrl: _hidden, ...rest } = course;
      return { ...rest, tier, videoUrl: "", locked: true };
    }
    return { ...course, tier, locked: false };
  });
};

// HR users only ever see and manage the courses they authored. Another HR's course is
// reported as 404 (not 403) so its existence isn't revealed.
export const listCoursesForHr = (hrId: string) =>
  Course.find({ createdBy: hrId }).sort({ createdAt: -1 }).lean();

export const createCourse = (input: CourseInput, createdBy: string) => Course.create({ ...input, createdBy });

export const updateCourse = async (hrId: string, courseId: string, input: CourseInput): Promise<ICourse> => {
  const course = await Course.findOne({ _id: courseId, createdBy: hrId });
  if (!course) throw new AppError("Course not found", 404);
  Object.assign(course, input);
  await course.save();
  return course;
};

export const deleteCourse = async (hrId: string, courseId: string) => {
  const result = await Course.deleteOne({ _id: courseId, createdBy: hrId });
  if (!result.deletedCount) throw new AppError("Course not found", 404);
  return { deleted: true };
};
