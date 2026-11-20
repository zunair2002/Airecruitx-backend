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

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

const extensionFor = (mimeType: string, originalName: string): string => {
  const fromMime = MIME_EXTENSIONS[mimeType];
  if (fromMime) return fromMime;
  const match = /\.[a-z0-9]{1,5}$/i.exec(originalName);
  return match ? match[0].toLowerCase() : "";
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

  // Cloudinary "raw" resources keep whatever public_id we give them verbatim — with
  // no extension the stored file (and its URL) had none, so browsers downloaded it as
  // an extension-less blob. Append the real extension so the URL ends in .pdf/.docx.
  const extension = extensionFor(file.mimetype, file.originalname);
  const fileUrl = await uploadToCloudinary(file.buffer, `${userId}-${Date.now()}${extension}`);

  return Resume.findOneAndUpdate(
    { userId },
    {
      userId,
      fileUrl,
      mimeType: file.mimetype,
      originalName: file.originalname,
      // multer's memoryStorage reports the byte length; fall back to the buffer itself.
      fileSize: file.size ?? file.buffer.length,
      status: "parsed",
    },
    { upsert: true, new: true }
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

// Removes the candidate's resume record. The Cloudinary file is left in place — it is
// unreferenced once the record is gone, and job applications already submitted keep
// their own resume-skill snapshot.
export const deleteMyResume = async (userId: string): Promise<boolean> => {
  const result = await Resume.deleteOne({ userId });
  return result.deletedCount > 0;
};
