import { InterviewSession, IInterviewSession } from "../model/interviewSession.model";
import { AppError } from "../../../utils/AppError";
import * as ollamaService from "./ollama.service";
import { ChatMessage } from "./ollama.service";

const OVERALL_VERDICTS = ["Good", "Average", "Needs Improvement"] as const;
type OverallVerdict = (typeof OVERALL_VERDICTS)[number];

// Safety net: the model is expected to say "Interview complete." on its own, but small
// local models sometimes get stuck re-asking the same question. Force completion once
// this many questions have been answered so a session can never loop forever.
const MAX_QUESTIONS = 5;

interface ParsedReply {
  feedbackText: string;
  score?: number;
  nextQuestionNumber?: number;
  nextQuestionText?: string;
  isComplete: boolean;
  overallVerdict?: OverallVerdict;
}

// The model (see OllamaLLM/Modelfile) always replies in a predictable shape:
// an optional "<feedback>. Score: X/10." for the answer just given, followed by
// either "Question N: <text>" or, on the final turn, "Interview complete." plus
// an "Overall performance: <verdict>" line. We parse that structured text here
// instead of asking the model for JSON, since small local models follow a fixed
// narrative template far more reliably than they follow a JSON schema.
const parseAssistantReply = (reply: string): ParsedReply => {
  const questionMatch = reply.match(/Question\s*(\d+)\s*:\s*([^\n]+)/i);
  const completeIndex = reply.search(/interview\s+complete/i);
  const verdictMatch = reply.match(/Overall performance:\s*(Good|Average|Needs Improvement)/i);
  const scoreMatch = reply.match(/(\d{1,2})\s*\/\s*10/);

  const cutIndex = questionMatch
    ? questionMatch.index ?? reply.length
    : completeIndex >= 0
      ? completeIndex
      : reply.length;

  const feedbackText = reply.slice(0, cutIndex).trim() || reply.trim();

  return {
    feedbackText,
    score: scoreMatch ? Math.min(10, Math.max(0, parseInt(scoreMatch[1], 10))) : undefined,
    nextQuestionNumber: questionMatch ? parseInt(questionMatch[1], 10) : undefined,
    nextQuestionText: questionMatch ? questionMatch[2].trim() : undefined,
    isComplete: completeIndex >= 0,
    overallVerdict: verdictMatch ? (verdictMatch[1] as OverallVerdict) : undefined,
  };
};

const hasNextStep = (parsed: ParsedReply): boolean =>
  parsed.isComplete || (!!parsed.nextQuestionNumber && !!parsed.nextQuestionText);

// Sends `messages`, and if the model's reply doesn't move the interview forward
// (no next question, no completion — small local models occasionally stop short
// after giving feedback) nudges it once to continue. Returns the full list of
// {message, reply} exchanges so the caller can persist them all to session history.
const runTurn = async (
  history: ChatMessage[],
  userMessage: ChatMessage
): Promise<{ exchanges: ChatMessage[]; parsed: ParsedReply }> => {
  const exchanges: ChatMessage[] = [userMessage];
  let reply = await ollamaService.chat([...history, ...exchanges]);
  exchanges.push({ role: "assistant", content: reply });
  let parsed = parseAssistantReply(reply);

  if (!hasNextStep(parsed)) {
    const nudge: ChatMessage = { role: "user", content: "Continue: give the next question now." };
    exchanges.push(nudge);
    const reply2 = await ollamaService.chat([...history, ...exchanges]);
    exchanges.push({ role: "assistant", content: reply2 });
    const parsed2 = parseAssistantReply(reply2);

    parsed = {
      feedbackText: parsed.feedbackText || parsed2.feedbackText,
      score: parsed.score ?? parsed2.score,
      nextQuestionNumber: parsed2.nextQuestionNumber,
      nextQuestionText: parsed2.nextQuestionText,
      isComplete: parsed2.isComplete,
      overallVerdict: parsed2.overallVerdict ?? parsed.overallVerdict,
    };
  }

  return { exchanges, parsed };
};

interface StartInterviewContext {
  level?: "beginner" | "intermediate" | "expert";
  jobTitle?: string;
}

export const startInterview = async (
  userId: string,
  applicationId?: string,
  context: StartInterviewContext = {}
): Promise<IInterviewSession> => {
  // Scoped by applicationId so a candidate's private practice session (no applicationId)
  // and an HR-scheduled real interview (tied to a specific application) never collide.
  const existing = await InterviewSession.findOne({
    userId,
    applicationId: applicationId ?? { $exists: false },
    status: { $ne: "completed" },
  });
  if (existing) return existing;

  const session = await InterviewSession.create({
    userId,
    applicationId,
    level: context.level,
    status: "in_progress",
    messages: [],
    turns: [],
  });

  // Fold difficulty level (practice) or the role being hired for (real interview) into
  // the opening message so the model's questions are tailored, without needing a
  // separate "system" message type.
  const openingMessage = context.jobTitle
    ? `Begin the interview for the position: ${context.jobTitle}. Tailor your questions to this role.`
    : context.level
      ? `Begin the interview. Candidate selected difficulty level: ${context.level}. Adjust question difficulty and scenario depth accordingly.`
      : "Begin the interview.";

  const { exchanges, parsed } = await runTurn([], { role: "user", content: openingMessage });

  if (!parsed.nextQuestionNumber || !parsed.nextQuestionText) {
    throw new AppError("The interview model did not return a valid opening question", 502);
  }

  session.messages.push(...exchanges);
  session.currentQuestionNumber = parsed.nextQuestionNumber;
  session.currentQuestion = parsed.nextQuestionText;

  await session.save();
  return session;
};

export const submitAnswer = async (
  userId: string,
  sessionId: string,
  answer: string
): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.status === "completed") {
    throw new AppError("This interview is already completed", 400);
  }
  if (!session.currentQuestionNumber || !session.currentQuestion) {
    throw new AppError("Interview session is in an invalid state", 500);
  }

  const questionNumber = session.currentQuestionNumber;
  const questionText = session.currentQuestion;

  const { exchanges, parsed } = await runTurn(session.messages, { role: "user", content: answer });
  session.messages.push(...exchanges);
  session.turns.push({
    questionNumber,
    question: questionText,
    answer,
    feedback: parsed.feedbackText,
    score: parsed.score ?? 0,
  });

  const reachedQuestionCap = session.turns.length >= MAX_QUESTIONS;

  if (parsed.isComplete || reachedQuestionCap) {
    const totalScore = session.turns.reduce((sum, t) => sum + t.score, 0);
    const averageOutOf10 = session.turns.length ? totalScore / session.turns.length : 0;
    const passScoreOutOf10 = Number(process.env.CERTIFICATE_PASS_SCORE ?? 80) / 10;

    session.status = "completed";
    session.score = Math.round(averageOutOf10 * 10); // normalize /10 average to a /100 score
    session.result = parsed.overallVerdict
      ? parsed.overallVerdict === "Needs Improvement"
        ? "fail"
        : "pass"
      : averageOutOf10 >= passScoreOutOf10
        ? "pass"
        : "fail";
    session.feedback = parsed.isComplete
      ? exchanges[exchanges.length - 1].content
      : `Interview ended after ${session.turns.length} questions. ${parsed.feedbackText}`;
    session.currentQuestionNumber = undefined;
    session.currentQuestion = undefined;
  } else if (parsed.nextQuestionNumber && parsed.nextQuestionText) {
    session.currentQuestionNumber = parsed.nextQuestionNumber;
    session.currentQuestion = parsed.nextQuestionText;
  } else {
    throw new AppError("The interview model returned an unexpected response", 502);
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
