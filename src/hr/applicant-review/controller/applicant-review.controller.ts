import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as applicantReviewService from "../service/applicant-review.service";

export const listApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicantReviewService.listApplicationsForJob(hrId, req.params.jobId);

  res.status(200).json({ success: true, data: applications });
});

export const listMatchedApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicantReviewService.listMatchedApplicationsForJob(hrId, req.params.jobId);

  res.status(200).json({ success: true, data: applications });
});

export const getApplicationReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const report = await applicantReviewService.getApplicationReport(hrId, req.params.applicationId);

  res.status(200).json({ success: true, data: report });
});

export const updateApplicationStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { status } = req.body ?? {};

  if (!status || typeof status !== "string") {
    throw new AppError("status is required", 400);
  }

  const application = await applicantReviewService.updateApplicationStatus(
    hrId,
    req.params.applicationId,
    status as any
  );

  res.status(200).json({ success: true, data: application });
});

export const scheduleAiInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { dateTime, message } = req.body ?? {};

  const application = await applicantReviewService.scheduleAiInterview(hrId, req.params.applicationId, {
    dateTime,
    message,
  });

  res.status(200).json({ success: true, data: application });
});

export const scheduleOrgInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { dateTime, location, notes } = req.body ?? {};

  const application = await applicantReviewService.scheduleOrgInterview(hrId, req.params.applicationId, {
    dateTime,
    location,
    notes,
  });

  res.status(200).json({ success: true, data: application });
});
