import cloudinary from "../../../config/cloudinary";
import { Resume, IResume } from "../model/resume.model";
import { SKILLS_DICTIONARY } from "../../../data/skills";
import { AppError } from "../../../utils/AppError";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";
import { logger } from "../../../config/logger";

const uploadToCloudinary = (buffer: Buffer, filename: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "resumes",
        resource_type: "raw",
        public_id: filename,
      },
      (error, result) => {
        if (error || !result) {
          logger.error({ err: error, filename }, "Failed to upload resume to Cloudinary");
          reject(new AppError("Failed to upload resume to storage", 502));
          return;
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

const extractSkills = (text: string): string[] => {
  const lowerText = text.toLowerCase();
  return SKILLS_DICTIONARY.filter((skill) => lowerText.includes(skill));
};

export const uploadAndParseResume = async (
  userId: string,
  file: Express.Multer.File
): Promise<IResume> => {
  const rawText = await extractTextFromFile(file.buffer, file.mimetype);
  if (!rawText.trim()) {
    logger.warn({ userId }, "No text could be extracted from the resume");
    throw new AppError("Could not extract any text from the resume", 422);
  }

  const fileUrl = await uploadToCloudinary(file.buffer, `${userId}-${Date.now()}`);
  const skills = extractSkills(rawText);

  const resume = await Resume.findOneAndUpdate(
    { userId },
    { userId, fileUrl, rawText, skills, status: "parsed" },
    { upsert: true, new: true }
  );
  logger.debug({ userId, skillCount: skills.length }, "Resume uploaded and parsed");

  return resume;
};
