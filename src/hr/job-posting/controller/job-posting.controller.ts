import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as jobPostingService from "../service/job-posting.service";

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { title, description, requiredSkills } = req.body ?? {};

  // multipart form fields always arrive as strings — accept either a comma-separated
  // string (from the JD-upload form) or an array (plain JSON callers).
  const requiredSkillsArray = Array.isArray(requiredSkills)
    ? requiredSkills
    : typeof requiredSkills === "string" && requiredSkills.length > 0
      ? requiredSkills.split(",")
      : [];

  const job = await jobPostingService.createJob(hrId, {
    title,
    description,
    requiredSkills: requiredSkillsArray,
    jdFile: req.file,
  });

  res.status(201).json({ success: true, data: job });
});

export const listMyJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const jobs = await jobPostingService.listJobsForHr(hrId);

  res.status(200).json({ success: true, data: jobs });
});
