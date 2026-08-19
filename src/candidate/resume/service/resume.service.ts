import cloudinary from "../../../config/cloudinary";
import { Resume, IResume } from "../model/resume.model";
import { SKILLS_DICTIONARY } from "../../../data/skills";
import { AppError } from "../../../utils/AppError";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";

const uploadToCloudinary = (buffer: Buffer, filename: string): Promise<string> => {
  console.log(`[Service] Uploading ${filename} to Cloudinary...`);
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "resumes",
        resource_type: "raw",
        public_id: filename,
      },
      (error, result) => {
        if (error || !result) {
          console.error("[Service] Failed to upload to Cloudinary:", error);
          reject(new AppError("Failed to upload resume to storage", 502));
          return;
        }
        console.log("[Service] Successfully uploaded to Cloudinary.");
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

const extractSkills = (text: string): string[] => {
  console.log("[Service] Extracting skills from raw text...");
  const lowerText = text.toLowerCase();
  const skills = SKILLS_DICTIONARY.filter((skill) => lowerText.includes(skill));
  console.log(`[Service] Found ${skills.length} skills.`);
  return skills;
};

export const uploadAndParseResume = async (
  userId: string,
  file: Express.Multer.File
): Promise<IResume> => {
  console.log("[Service] Starting uploadAndParseResume process...");
  const rawText = await extractTextFromFile(file.buffer, file.mimetype);
  if (!rawText.trim()) {
    console.error("[Service] No text could be extracted from the resume.");
    throw new AppError("Could not extract any text from the resume", 422);
  }
  console.log("[Service] Text extracted successfully.");

  const fileUrl = await uploadToCloudinary(file.buffer, `${userId}-${Date.now()}`);
  const skills = extractSkills(rawText);

  console.log(`[Service] Saving resume to database for user: ${userId}`);
  const resume = await Resume.findOneAndUpdate(
    { userId },
    { userId, fileUrl, rawText, skills, status: "parsed" },
    { upsert: true, new: true }
  );
  console.log("[Service] Resume saved successfully.");

  return resume;
};
