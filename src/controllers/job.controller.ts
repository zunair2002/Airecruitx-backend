import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import * as jobService from "../services/job.service";

export const createJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { title, description, requiredSkills } = req.body ?? {};

  const job = await jobService.createJob(hrId, { title, description, requiredSkills });

  res.status(201).json({ success: true, data: job });
});

export const listJobsHandler = asyncHandler(async (req: Request, res: Response) => {
  const jobs =
    req.user!.role === "hr"
      ? await jobService.listJobsForHr(req.user!._id.toString())
      : await jobService.listOpenJobs();

  res.status(200).json({ success: true, data: jobs });
});
