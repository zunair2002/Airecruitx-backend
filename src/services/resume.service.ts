import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import cloudinary from "../config/cloudinary";
import { Resume, IResume } from "../models/resume.model";
import { SKILLS_DICTIONARY } from "../data/skills";
import { AppError } from "../utils/AppError";

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

const extractText = async (buffer: Buffer, mimetype: string): Promise<string> => {
  console.log(`[Service] Extracting text from file with mimetype: ${mimetype}`);
  if (mimetype === "application/pdf") {
    try {
      const parsed = await pdfParse(buffer);
      console.log("[Service] Successfully parsed PDF.");
      return parsed.text;
    } catch (error) {
      console.error("[Service] Error parsing PDF:", error);
      throw new AppError("The uploaded PDF appears to be corrupted or invalid. Please try a different file.", 422);
    }
  }

  // DOCX
  const parsed = await mammoth.extractRawText({ buffer });
  console.log("[Service] Successfully parsed DOCX.");
  return parsed.value;
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
  const rawText = await extractText(file.buffer, file.mimetype);
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
    { userId, fileUrl, skills, status: "parsed" },
    { upsert: true, new: true }
  );
  console.log("[Service] Resume saved successfully.");

  return resume;
};