import { InterviewSession, IInterviewSession } from "../model/interviewSession.model";
import { AppError } from "../../../utils/AppError";
import * as ollamaService from "./ollama.service";
import { ChatMessage } from "./ollama.service";

const OVERALL_VERDICTS = ["Good", "Average", "Needs Improvement"] as const;
type OverallVerdict = (typeof OVERALL_VERDICTS)[number];

// Fixed two-round structure: Round 1 is general/basic questions, Round 2 shifts to
// role-specific scenario questions. Also acts as a safety net — the model is expected
// to say "Interview complete." on its own, but small local models sometimes get stuck
// re-asking the same question, so completion is forced once ROUND_2_QUESTIONS total
// questions have been answered.
const ROUND_1_QUESTIONS = 4;
const ROUND_2_QUESTIONS = 4;
const MAX_QUESTIONS = ROUND_1_QUESTIONS + ROUND_2_QUESTIONS;

export const questionRound = (questionNumber: number): 1 | 2 =>
  questionNumber <= ROUND_1_QUESTIONS ? 1 : 2;

// A candidate who fails gets a couple of generic interview tips plus one pointer per
// weak answer (score <= 4/10), so the "retry after learning" loop has something concrete
// to react to instead of just a bare pass/fail.
const GENERAL_TIPS = [
  "Use the STAR method (Situation, Task, Action, Result) to structure behavioral answers.",
  "Lead with a short summary before diving into details.",
];

export const deriveElearningTips = (turns: { question: string; score: number }[]): string[] => {
  const weakTopics = turns
    .filter((t) => t.score <= 4)
    .map((t) => `Review this topic before retrying: "${t.question}"`);
  return [...GENERAL_TIPS, ...weakTopics];
};

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
  visibility?: "candidate" | "hidden";
}

export const startInterview = async (
  userId: string,
  applicationId?: string,
  context: StartInterviewContext = {}
): Promise<IInterviewSession> => {
  const visibility = context.visibility ?? "candidate";

  // Scoped by applicationId + visibility so a candidate's private practice session
  // (no applicationId), the auto-triggered AI interview, and an HR-scheduled
  // organizational interview — the latter two sharing the same applicationId — never
  // collide with each other.
  const existing = await InterviewSession.findOne({
    userId,
    applicationId: applicationId ?? { $exists: false },
    visibility,
    status: { $ne: "completed" },
  });
  if (existing) return existing;

  const session = await InterviewSession.create({
    userId,
    applicationId,
    level: context.level,
    visibility,
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

  // Just answered the last Round 1 question — steer the model into Round 2
  // (role-specific scenario questions) for the next one instead of letting it continue
  // in whatever direction it was already going.
  const enteringRound2 = questionNumber === ROUND_1_QUESTIONS;
  const answerMessage = enteringRound2
    ? `${answer}\n\n[Round 1 (general questions) is now complete. Begin Round 2 — ask a role-specific, scenario-based question tailored to this position, as Question ${ROUND_1_QUESTIONS + 1}.]`
    : answer;

  const { exchanges, parsed } = await runTurn(session.messages, { role: "user", content: answerMessage });
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

// Shapes a session into what the candidate-facing API returns: the current question
// plus the history of answered questions while in progress, or the final report once
// completed. For a "hidden" (organizational) interview, the candidate can still see
// which questions were asked and what they answered — but never the AI's feedback,
// per-turn score, overall score/result, or e-learning tips; those are for HR only.
export const buildSessionView = (session: IInterviewSession) => {
  const isHidden = session.visibility === "hidden";

  const turnsWithRound = session.turns.map((t) => ({
    questionNumber: t.questionNumber,
    question: t.question,
    answer: t.answer,
    feedback: isHidden ? undefined : t.feedback,
    score: isHidden ? undefined : t.score,
    round: questionRound(t.questionNumber),
  }));

  if (session.status === "completed") {
    return {
      sessionId: session._id,
      status: session.status,
      score: isHidden ? undefined : session.score,
      result: isHidden ? undefined : session.result,
      feedback: isHidden ? undefined : session.feedback,
      turns: turnsWithRound,
      certificatePaid: session.certificatePayment?.paid ?? false,
      elearningTips:
        !isHidden && session.result === "fail" ? deriveElearningTips(session.turns) : undefined,
    };
  }

  return {
    sessionId: session._id,
    status: session.status,
    questionNumber: session.currentQuestionNumber,
    question: session.currentQuestion,
    round: session.currentQuestionNumber ? questionRound(session.currentQuestionNumber) : undefined,
    turns: turnsWithRound,
  };
};
