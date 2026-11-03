import cloudinary from "../../../config/cloudinary";
import { Resume, IResume } from "../model/resume.model";
import { AppError } from "../../../utils/AppError";
import { extractTextFromFile } from "../../../shared/util/extractTextFromFile";

const uploadToCloudinary = (
  buffer: Buffer,
  filename: string,
): Promise<{ fileUrl: string; publicId: string }> => {
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
        resolve({ fileUrl: result.secure_url, publicId: result.public_id });
      }
    );
    uploadStream.end(buffer);
  });
};

const getLegacyPublicId = (fileUrl: string): string => {
  let pathname: string;
  try {
    pathname = new URL(fileUrl).pathname;
  } catch {
    throw new AppError("Stored resume URL is invalid; it cannot be deleted safely", 502);
  }

  const uploadIndex = pathname.indexOf("/upload/");
  if (uploadIndex < 0) {
    throw new AppError("Stored resume URL is invalid; it cannot be deleted safely", 502);
  }

  const assetPath = pathname.slice(uploadIndex + "/upload/".length);
  const segments = assetPath.split("/").filter(Boolean);
  const versionIndex = segments.findIndex((segment) => /^v\d+$/.test(segment));
  const publicId = segments.slice(versionIndex >= 0 ? versionIndex + 1 : 0).join("/");
  if (!publicId) {
    throw new AppError("Stored resume URL is invalid; it cannot be deleted safely", 502);
  }
  try {
    return decodeURIComponent(publicId);
  } catch {
    throw new AppError("Stored resume URL is invalid; it cannot be deleted safely", 502);
  }
};

const destroyResumeAsset = async (publicId: string): Promise<void> => {
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
  });
  if (result.result !== "ok" && result.result !== "not found") {
    throw new AppError("Failed to remove resume from storage", 502);
  }
};

const cleanupPreviousResume = async (publicId: string | undefined) => {
  if (!publicId) return;
  try {
    await destroyResumeAsset(publicId);
  } catch (error) {
    console.error("[resume.service] Failed to remove replaced resume:", error);
  }
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

  const previous = await Resume.findOne({ userId }).select("+publicId");
  const oldPublicId =
    previous?.publicId ??
    (previous ? getLegacyPublicId(previous.fileUrl) : undefined);
  const storedFile = await uploadToCloudinary(
    file.buffer,
    `${userId}-${Date.now()}`,
  );
  const originalName =
    file.originalname.split(/[\\/]/).pop()?.trim().slice(0, 255) || "resume";

  let resume: IResume | null;
  try {
    resume = await Resume.findOneAndUpdate(
      { userId },
      {
        userId,
        fileUrl: storedFile.fileUrl,
        publicId: storedFile.publicId,
        originalName,
        fileSize: file.size,
        mimeType: file.mimetype,
        status: "parsed",
      },
      { upsert: true, new: true, runValidators: true },
    );
  } catch (error) {
    await cleanupPreviousResume(storedFile.publicId);
    throw error;
  }
  if (!resume) {
    await cleanupPreviousResume(storedFile.publicId);
    throw new AppError("Failed to save uploaded resume", 500);
  }

  if (oldPublicId !== storedFile.publicId) {
    await cleanupPreviousResume(oldPublicId);
  }

  return resume;
};

// Lets the candidate know whether they already have a resume on file (and its link)
// before deciding to upload — without this, the frontend has no way to tell "no
// resume yet" apart from "one exists but hasn't been re-checked this session".
export const getMyResume = async (userId: string): Promise<IResume | null> => {
  return Resume.findOne({ userId });
};

export const deleteMyResume = async (userId: string): Promise<boolean> => {
  const resume = await Resume.findOne({ userId }).select("+publicId");
  if (!resume) return false;

  const publicId = resume.publicId ?? getLegacyPublicId(resume.fileUrl);
  await destroyResumeAsset(publicId);
  await Resume.deleteOne({ _id: resume._id, userId });
  return true;
};
