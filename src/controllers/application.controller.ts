import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import * as applicationService from "../services/application.service";

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

export const listApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicationService.listApplicationsForJob(hrId, req.params.jobId);

  res.status(200).json({ success: true, data: applications });
});

export const listMatchedApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicationService.listMatchedApplicationsForJob(hrId, req.params.jobId);

  res.status(200).json({ success: true, data: applications });
});

export const getApplicationReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const report = await applicationService.getApplicationReport(hrId, req.params.applicationId);

  res.status(200).json({ success: true, data: report });
});

export const updateApplicationStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { status } = req.body ?? {};

  if (!status || typeof status !== "string") {
    throw new AppError("status is required", 400);
  }

  const application = await applicationService.updateApplicationStatus(
    hrId,
    req.params.applicationId,
    status as any
  );

  res.status(200).json({ success: true, data: application });
});

export const scheduleOrgInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { dateTime, location, notes } = req.body ?? {};

  const application = await applicationService.scheduleOrgInterview(hrId, req.params.applicationId, {
    dateTime,
    location,
    notes,
  });

  res.status(200).json({ success: true, data: application });
});
