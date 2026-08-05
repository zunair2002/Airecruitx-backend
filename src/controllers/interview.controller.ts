import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/AppError";
import * as interviewService from "../services/interview.service";
import { questionsForRound, roundForStatus } from "../services/interview.service";
import { IInterviewSession } from "../models/interviewSession.model";

// Shapes a session into what the frontend needs: current round's questions (with
// answered state) while in progress, or the final report once completed.
const toSessionView = (session: IInterviewSession) => {
  if (session.status === "completed") {
    return {
      sessionId: session._id,
      status: session.status,
      score: session.score,
      result: session.result,
      feedback: session.feedback,
    };
  }

  const round = roundForStatus(session.status);
  const questions = questionsForRound(round).map((question, index) => {
    const answered = session.answers.find(
      (a) => a.round === round && a.questionIndex === index
    );
    return { index, question, answer: answered?.answer ?? null };
  });

  return {
    sessionId: session._id,
    status: session.status,
    round,
    questions,
  };
};

export const startInterviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const session = await interviewService.startInterview(userId);

  res.status(200).json({ success: true, data: toSessionView(session) });
});

export const submitAnswerHandler = asyncHandler(async (req: Request, res: Response) => {
  const { sessionId, questionIndex, answer } = req.body ?? {};

  if (!sessionId || typeof sessionId !== "string") {
    throw new AppError("sessionId is required", 400);
  }
  if (typeof questionIndex !== "number") {
    throw new AppError("questionIndex is required", 400);
  }
  if (!answer || typeof answer !== "string") {
    throw new AppError("answer is required", 400);
  }

  const userId = req.user!._id.toString();
  const session = await interviewService.submitAnswer(userId, sessionId, questionIndex, answer);

  res.status(200).json({ success: true, data: toSessionView(session) });
});

export const getReportHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!._id.toString();
  const session = await interviewService.getSession(userId, req.params.sessionId);

  res.status(200).json({ success: true, data: toSessionView(session) });
});
