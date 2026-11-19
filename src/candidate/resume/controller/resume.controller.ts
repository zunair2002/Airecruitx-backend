import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as resumeService from "../service/resume.service";
import type { IResume } from "../model/resume.model";

// What the candidate sees about their resume: the link, parse status, original
// filename + size (for display and as the download name) and timestamps.
const toResumeResponse = (resume: IResume) => ({
  fileUrl: resume.fileUrl,
  status: resume.status,
  mimeType: resume.mimeType,
  originalName: resume.originalName,
  fileSize: resume.fileSize,
  createdAt: resume.createdAt,
  updatedAt: resume.updatedAt,
});

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
    data: toResumeResponse(resume),
  });
});

export const getMyResumeHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const resume = await resumeService.getMyResume(userId);

  res.status(200).json({
    success: true,
    data: resume ? toResumeResponse(resume) : null,
  });
});

export const deleteMyResumeHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const deleted = await resumeService.deleteMyResume(userId);
  res.status(200).json({ success: true, data: { deleted } });
});
