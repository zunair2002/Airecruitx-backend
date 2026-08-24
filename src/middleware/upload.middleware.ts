import multer from "multer";
import { AppError } from "../utils/AppError";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_RESUME_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const storage = multer.memoryStorage(); // buffer only — never touches disk

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!ALLOWED_RESUME_MIME_TYPES.includes(file.mimetype)) {
    cb(new AppError("Only PDF or DOCX resumes are allowed", 400));
    return;
  }
  cb(null, true);
};

export const uploadResumeFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single("resume");
