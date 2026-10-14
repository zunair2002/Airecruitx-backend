import { Request, Response } from "express";
import { isValidObjectId } from "mongoose";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";
import * as interviewService from "../service/interview.service";
import { isTrack, TRACKS } from "../../../ai/topics";

const VALID_LEVELS = ["beginner", "intermediate", "expert"];
const VALID_STAGES = ["basic", "technical"];
const MAX_ANSWER_CHARS = 5000;

// Practice interview: Round 1 (basic) or Round 2 (technical, unlocked by Round 1's score).
// Body: { stage?: "basic" | "technical", track?: TrackId, basicSessionId?, level? }
export const startInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const { level, stage, track, basicSessionId } = req.body ?? {};

  if (level && !VALID_LEVELS.includes(level)) {
    throw new AppError(`level must be one of: ${VALID_LEVELS.join(", ")}`, 400);
  }
  if (stage && !VALID_STAGES.includes(stage)) {
    throw new AppError(`stage must be one of: ${VALID_STAGES.join(", ")}`, 400);
  }
  if (track && !isTrack(track)) {
    throw new AppError(`track must be one of: ${Object.keys(TRACKS).join(", ")}`, 400);
  }
  if (basicSessionId !== undefined && !isValidObjectId(basicSessionId)) {
    throw new AppError("Invalid sessionId", 400);
  }

  const session = await interviewService.startPracticeRound(userId, { stage, track, level, basicSessionId });

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

export const submitAnswerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, answer } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }
  if (!isValidObjectId(sessionId)) {
    throw new AppError("Invalid sessionId", 400);
  }
  const trimmed = typeof answer === "string" ? answer.trim() : "";
  if (!trimmed) {
    throw new AppError("answer is required", 400);
  }
  if (trimmed.length > MAX_ANSWER_CHARS) {
    throw new AppError(`Answer is too long (max ${MAX_ANSWER_CHARS} characters)`, 400);
  }

  const userId = req.user!._id.toString();
  const session = await interviewService.submitAnswer(userId, sessionId, trimmed);

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  if (!isValidObjectId(req.params.sessionId)) {
    throw new AppError("Invalid sessionId", 400);
  }
  const userId = req.user!._id.toString();
  const session = await interviewService.getSession(userId, req.params.sessionId);

  res.status(200).json({ success: true, data: interviewService.buildSessionView(session) });
});

// Practice tracks for the "choose your track" screen
export const listTracksHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    data: Object.entries(TRACKS).map(([id, t]) => ({ id, label: t.label, topics: t.topics })),
  });
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
