import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as applicationService from "../service/application.service";
import * as interviewService from "../../interview/service/interview.service";

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

// The three handlers below are token-authenticated, not requireAuth-gated — the
// candidate reaches them from an emailed link, possibly without an active login
// session on that device. See resolveActiveOrgInterviewInvite in application.service.ts.

const requireToken = (params: Request["params"]): string => {
  const { token } = params;
  if (!token || typeof token !== "string") {
    throw new AppError("A valid interview token is required", 400);
  }
  return token;
};

export const getOrgInterviewInviteHandler = asyncHandler(async (req: Request, res: Response) => {
  const invite = await applicationService.getOrgInterviewInvite(requireToken(req.params));

  res.status(200).json({ success: true, data: invite });
});

export const startOrgInterviewByTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const session = await applicationService.startOrgInterviewByToken(requireToken(req.params));

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

export const submitOrgInterviewAnswerByTokenHandler = asyncHandler(async (req: Request, res: Response) => {
  const { answer } = req.body ?? {};
  if (!answer || typeof answer !== "string") {
    throw new AppError("answer is required", 400);
  }

  const session = await applicationService.submitOrgInterviewAnswerByToken(requireToken(req.params), answer);

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});
