import { InterviewSession, IInterviewSession } from "../models/interviewSession.model";
import { ROUND1_QUESTIONS, ROUND2_QUESTIONS } from "../data/interviewQuestions";
import { AppError } from "../utils/AppError";

const MIN_MEANINGFUL_ANSWER_LENGTH = 15; // chars — a lazy/empty-ish answer won't count as "good"
const PASS_SCORE = 60;

const questionsForRound = (round: 1 | 2): string[] =>
  round === 1 ? ROUND1_QUESTIONS : ROUND2_QUESTIONS;

const roundForStatus = (status: IInterviewSession["status"]): 1 | 2 =>
  status === "round1" ? 1 : 2;

// Simple placeholder evaluation: an answer "counts" if it shows a real attempt (length-based).
// Kept intentionally basic since the practice module only needs a pass/fail result for now.
const evaluate = (session: IInterviewSession): { score: number; result: "pass" | "fail"; feedback: string } => {
  const total = session.answers.length;
  const goodAnswers = session.answers.filter(
    (a) => a.answer.trim().length >= MIN_MEANINGFUL_ANSWER_LENGTH
  ).length;

  const score = total === 0 ? 0 : Math.round((goodAnswers / total) * 100);
  const result: "pass" | "fail" = score >= PASS_SCORE ? "pass" : "fail";
  const feedback =
    result === "pass"
      ? "Great job! Your answers were clear and well thought out. Certificate unlocked."
      : "Some answers need more detail and clarity. Review the questions, practice explaining your thinking out loud, and try again.";

  return { score, result, feedback };
};

export const startInterview = async (userId: string): Promise<IInterviewSession> => {
  const existing = await InterviewSession.findOne({
    userId,
    status: { $ne: "completed" },
  });
  if (existing) return existing;

  return InterviewSession.create({ userId, status: "round1", answers: [] });
};

export const submitAnswer = async (
  userId: string,
  sessionId: string,
  questionIndex: number,
  answer: string
): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.status === "completed") {
    throw new AppError("This interview is already completed", 400);
  }

  const round = roundForStatus(session.status);
  const questions = questionsForRound(round);

  if (questionIndex < 0 || questionIndex >= questions.length) {
    throw new AppError("Invalid question index", 400);
  }

  // Save immediately, overwriting any previous answer for the same question so progress is never lost.
  const existingAnswerIdx = session.answers.findIndex(
    (a) => a.round === round && a.questionIndex === questionIndex
  );
  const entry = { round, questionIndex, question: questions[questionIndex], answer };
  if (existingAnswerIdx >= 0) {
    session.answers[existingAnswerIdx] = entry;
  } else {
    session.answers.push(entry);
  }

  const answeredInRound = session.answers.filter((a) => a.round === round).length;
  const roundComplete = answeredInRound >= questions.length;

  if (roundComplete && round === 1) {
    session.status = "round2";
  } else if (roundComplete && round === 2) {
    const { score, result, feedback } = evaluate(session);
    session.status = "completed";
    session.score = score;
    session.result = result;
    session.feedback = feedback;
  }

  await session.save();
  return session;
};

export const getSession = async (
  userId: string,
  sessionId: string
): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  return session;
};

export { questionsForRound, roundForStatus };
