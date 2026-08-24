import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import * as interviewService from "../services/interview.service";
import { IInterviewSession } from "../models/interviewSession.model";

// Shapes a session into what the frontend needs: the current question plus the
// history of answered questions while in progress, or the final report once completed.
const toSessionView = (session: IInterviewSession) => {
  if (session.status === "completed") {
    return {
      sessionId: session._id,
      status: session.status,
      score: session.score,
      result: session.result,
      feedback: session.feedback,
      turns: session.turns,
    };
  }

  return {
    sessionId: session._id,
    status: session.status,
    questionNumber: session.currentQuestionNumber,
    question: session.currentQuestion,
    turns: session.turns,
  };
};

export const startInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const session = await interviewService.startInterview(userId);

  res.status(200).json({ success: true, data: toSessionView(session) });
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

  res.status(200).json({ success: true, data: toSessionView(session) });
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const session = await interviewService.getSession(userId, req.params.sessionId);

  res.status(200).json({ success: true, data: toSessionView(session) });
});
