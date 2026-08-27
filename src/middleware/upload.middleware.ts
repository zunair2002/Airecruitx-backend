import multer from "multer";
import { AppError } from "../utils/AppError";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const ALLOWED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const storage = multer.memoryStorage(); // buffer only — never touches disk

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
    cb(new AppError("Only PDF or DOCX files are allowed", 400));
    return;
  }
  cb(null, true);
};

export const uploadResumeFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single("resume");

// Optional — HR may post a job with just typed-in required skills and no JD file.
export const uploadJdFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single("jd");

// HR's organizational-interview question pool (Q/A/marks), authored as a PDF or DOCX
// document rather than typed in one-by-one — see orgInterviewQuestionSet.service.ts
// for the expected "Q: / A: / Marks:" text format.
export const uploadQuestionPoolFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single("questionsFile");
