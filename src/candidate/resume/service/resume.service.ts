import cloudinary from "../../../config/cloudinary";
import { Resume, IResume } from "../model/resume.model";
import { AppError } from "../../../utils/AppError";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";

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
          console.error("[resume.service] Failed to upload to Cloudinary:", error);
          reject(new AppError("Failed to upload resume to storage", 502));
          return;
        }
        resolve(result.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
};

// Text is extracted only to confirm the file is actually parseable (reject empty/
// image-only PDFs) — it's never persisted. Job-match scoring re-extracts it from
// Cloudinary on demand instead (see application.service.ts), so the database never
// holds a second, duplicate copy of the resume's contents.
export const uploadAndParseResume = async (
  userId: string,
  file: Express.Multer.File
): Promise<IResume> => {
  const text = await extractTextFromFile(file.buffer, file.mimetype);
  if (!text.trim()) {
    throw new AppError("Could not extract any text from the resume", 422);
  }

  const fileUrl = await uploadToCloudinary(file.buffer, `${userId}-${Date.now()}`);

  return Resume.findOneAndUpdate(
    { userId },
    { userId, fileUrl, mimeType: file.mimetype, status: "parsed" },
    { upsert: true, new: true }
  );
};
