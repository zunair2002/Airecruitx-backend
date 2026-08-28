import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as resumeService from "../service/resume.service";

export const uploadResumeHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError("Resume file is required", 400);
  }

  const userId = req.user!._id.toString();
  const resume = await resumeService.uploadAndParseResume(userId, req.file);

  // Deliberately just a confirmation + the file link — parsed text/skills are an
  // internal matching detail the candidate doesn't need to see. To update their
  // resume, they simply upload again; this same endpoint overwrites the old one.
  res.status(200).json({
    success: true,
    data: {
      fileUrl: resume.fileUrl,
      status: resume.status,
    },
  });
});
