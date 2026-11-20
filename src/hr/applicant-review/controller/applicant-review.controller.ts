import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as applicantReviewService from "../service/applicant-review.service";

const parseMinMatchScore = (query: Request["query"]): number | undefined => {
  const { minMatchScore } = query;
  if (minMatchScore === undefined) return undefined;
  const parsed = Number(minMatchScore);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new AppError("minMatchScore must be a number between 0 and 100", 400);
  }
  return parsed;
};

export const listApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicantReviewService.listApplicationsForJob(
    hrId,
    req.params.jobId,
    parseMinMatchScore(req.query)
  );

  res.status(200).json({ success: true, data: applications });
});

export const listMatchedApplicationsForJobHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applications = await applicantReviewService.listMatchedApplicationsForJob(
    hrId,
    req.params.jobId,
    parseMinMatchScore(req.query)
  );

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

export const inviteToOrgInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const { validityDays } = req.body ?? {};

  const application = await applicantReviewService.inviteToOrgInterview(
    hrId,
    req.params.applicationId,
    validityDays !== undefined ? Number(validityDays) : undefined
  );

  res.status(200).json({ success: true, data: application });
});

const requireApplicationIds = (body: any): string[] => {
  const { applicationIds } = body ?? {};
  if (!Array.isArray(applicationIds) || applicationIds.length === 0 || !applicationIds.every((id) => typeof id === "string")) {
    throw new AppError("applicationIds must be a non-empty array of strings", 400);
  }
  return applicationIds;
};

export const bulkUpdateStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applicationIds = requireApplicationIds(req.body);
  const { status } = req.body ?? {};

  if (!status || typeof status !== "string") {
    throw new AppError("status is required", 400);
  }

  const applications = await applicantReviewService.bulkUpdateApplicationStatus(
    hrId,
    applicationIds,
    status as any
  );

  res.status(200).json({ success: true, data: applications });
});

export const bulkAiInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applicationIds = requireApplicationIds(req.body);

  const applications = await applicantReviewService.bulkTriggerAiInterview(hrId, applicationIds);

  res.status(200).json({ success: true, data: applications });
});

export const bulkOrgInterviewInviteHandler = asyncHandler(async (req: Request, res: Response) => {
  const hrId = req.user!._id.toString();
  const applicationIds = requireApplicationIds(req.body);
  const { validityDays } = req.body ?? {};

  const applications = await applicantReviewService.bulkInviteToOrgInterview(
    hrId,
    applicationIds,
    validityDays !== undefined ? Number(validityDays) : undefined
  );

  res.status(200).json({ success: true, data: applications });
});
