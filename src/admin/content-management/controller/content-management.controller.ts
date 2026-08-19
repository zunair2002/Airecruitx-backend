import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as contentManagementService from "../service/content-management.service";

export const listAllJobsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const jobs = await contentManagementService.listAllJobs();
  res.status(200).json({ success: true, data: jobs });
});

export const closeJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user!._id.toString();
  const job = await contentManagementService.closeJob(adminId, req.params.jobId);
  res.status(200).json({ success: true, data: job });
});

export const deleteJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user!._id.toString();
  await contentManagementService.deleteJob(adminId, req.params.jobId);
  res.status(200).json({ success: true, message: "Job deleted" });
});

export const listAllApplicationsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const applications = await contentManagementService.listAllApplications();
  res.status(200).json({ success: true, data: applications });
});
