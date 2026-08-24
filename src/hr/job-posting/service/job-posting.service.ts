import { Job, IJob } from "../../../shared/job/model/job.model";
import { AppError } from "../../../utils/AppError";
import cloudinary from "../../../config/cloudinary";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";
import { SKILLS_DICTIONARY } from "../../../data/skills";

interface CreateJobInput {
  title: string;
  description: string;
  requiredSkills: string[];
  jdFile?: Express.Multer.File;
}

const normalizeSkills = (skills: string[]): string[] =>
  Array.from(
    new Set(
      skills
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    )
  );

// Only used as a convenience pre-fill when HR uploads a JD but doesn't type any
// required skills themselves — HR always sees/can edit the final list before saving.
const suggestSkillsFromText = (text: string): string[] => {
  const lowerText = text.toLowerCase();
  return SKILLS_DICTIONARY.filter((skill) => lowerText.includes(skill));
};

const uploadJdToCloudinary = (buffer: Buffer, filename: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: "job-descriptions", resource_type: "raw", public_id: filename },
      (error, result) => {
        if (error || !result) {
          reject(new AppError("Failed to upload job description to storage", 502));
          return;
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

export const createJob = async (hrId: string, input: CreateJobInput): Promise<IJob> => {
  if (!input.title?.trim()) {
    throw new AppError("Job title is required", 400);
  }
  if (!input.description?.trim()) {
    throw new AppError("Job description is required", 400);
  }

  let jdFileUrl: string | undefined;
  let jdRawText: string | undefined;
  if (input.jdFile) {
    jdRawText = await extractTextFromFile(input.jdFile.buffer, input.jdFile.mimetype);
    jdFileUrl = await uploadJdToCloudinary(input.jdFile.buffer, `${hrId}-${Date.now()}`);
  }

  let requiredSkills = normalizeSkills(input.requiredSkills ?? []);
  if (requiredSkills.length === 0 && jdRawText) {
    requiredSkills = suggestSkillsFromText(jdRawText);
  }
  if (requiredSkills.length === 0) {
    throw new AppError(
      "At least one required skill is needed (type them in, or upload a JD we can suggest skills from)",
      400
    );
  }

  return Job.create({
    hrId,
    title: input.title.trim(),
    description: input.description.trim(),
    requiredSkills,
    jdFileUrl,
    jdRawText,
  });
};

export const listJobsForHr = async (hrId: string): Promise<IJob[]> => {
  return Job.find({ hrId }).sort({ createdAt: -1 });
};
