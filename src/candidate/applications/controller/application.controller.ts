import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import * as applicationService from "../service/application.service";

export const applyToJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const candidateId = req.user!._id.toString();
  const application = await applicationService.applyToJob(candidateId, req.params.jobId);

  res.status(201).json({ success: true, data: application });
});

export const listMyApplicationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const candidateId = req.user!._id.toString();
  const applications = await applicationService.listApplicationsForCandidate(candidateId);

  res.status(200).json({ success: true, data: applications });
});
