import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import * as resumeService from "../services/resume.service";

export const uploadResumeHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) {
    throw new AppError("Resume file is required", 400);
  }

  const userId = req.user!._id.toString();
  const resume = await resumeService.uploadAndParseResume(userId, req.file);

  res.status(200).json({
    success: true,
    data: {
      fileUrl: resume.fileUrl,
      skills: resume.skills,
      status: resume.status,
    },
  });
});
