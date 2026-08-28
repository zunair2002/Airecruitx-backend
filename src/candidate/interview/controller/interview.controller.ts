import { Request, Response } from "express";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as interviewService from "../service/interview.service";

const VALID_LEVELS = ["beginner", "intermediate", "expert"];

export const startInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { level } = req.body ?? {};

  if (level && !VALID_LEVELS.includes(level)) {
    throw new AppError(`level must be one of: ${VALID_LEVELS.join(", ")}`, 400);
  }

  const session = await interviewService.startInterview(userId, undefined, { level });

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

export const submitAnswerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, answer } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }
  if (!answer || typeof answer !== "string") {
    throw new AppError("answer is required", 400);
  }

  const userId = req.user!._id.toString();
  const session = await interviewService.submitAnswer(userId, sessionId, answer);

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const session = await interviewService.getSession(userId, req.params.sessionId);

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

const VALID_HISTORY_TYPES = ["practice", "ai_interview", "organizational"];

export const listMySessionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { type } = req.query;

  if (type !== undefined && (typeof type !== "string" || !VALID_HISTORY_TYPES.includes(type))) {
    throw new AppError(`type must be one of: ${VALID_HISTORY_TYPES.join(", ")}`, 400);
  }

  const sessions = await interviewService.listSessionsForCandidate(userId, type as any);

  res.status(200).json({ success: true, data: sessions });
});
