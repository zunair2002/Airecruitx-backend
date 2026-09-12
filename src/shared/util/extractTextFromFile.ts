import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { AppError } from "../../utils/AppError";
import { logger } from "../../config/logger";

// Shared PDF/DOCX text extraction — used by both resume parsing and job-description parsing.
export const extractTextFromFile = async (buffer: Buffer, mimetype: string): Promise<string> => {
  if (mimetype === "application/pdf") {
    try {
      const parsed = await pdfParse(buffer);
      return parsed.text;
    } catch (error) {
      logger.error({ err: error }, "Error parsing PDF");
      throw new AppError("The uploaded PDF appears to be corrupted or invalid. Please try a different file.", 422);
    }
  }

  // DOCX
  const parsed = await mammoth.extractRawText({ buffer });
  return parsed.value;
};
