import {
  InterviewSession,
  IInterviewSession,
  IInterviewReport,
  ISelectedQuestion,
  InterviewStage,
} from "../model/interviewSession.model";
import { IOrgInterviewQuestionSet } from "../../../hr/job-posting/model/orgInterviewQuestionSet.model";
import { Application } from "../../../shared/application/model/application.model";
import { AppError } from "../../../utils/AppError";
import * as ai from "../../../ai/ai.service";
import { hrDecision, overallScore, round1, stageScore } from "../../../ai/scoring";
import { basicTopicsFor, keyPointsFromReference, shuffle, technicalTopicsFor, topicFromText } from "../../../ai/topics";
import { adviceFor, fallbackReport } from "../../../ai/report";
import { AI_FINAL_WAIT_MS, BASIC_QUESTIONS, passScore100, questionSplit } from "../../../config/ai";

// ---------------------------------------------------------------------------------
// Interview flow (fine-tuned AIRecruitX model):
//   start  -> all questions generated up front (basic round + technical round), each with
//             key points; the question bank fills in if the model is slow/unavailable
//   answer -> stored immediately, the next question is returned at once, and the answer is
//             evaluated in the background (scores per criterion + feedback)
//   last   -> waits for outstanding evaluations, computes the scores deterministically,
//             then the model writes the report narrative (deterministic fallback if not)
// ---------------------------------------------------------------------------------

const DEFAULT_ROLE = "Software Engineer";

// Round 1 = basic questions, Round 2 = technical. Sessions created before this change have
// no stage on their questions, so they fall back to the old "first N questions" rule.
export const questionRound = (questionNumber: number, selected?: ISelectedQuestion[]): 1 | 2 => {
  const stage = selected?.[questionNumber - 1]?.stage;
  if (stage) return stage === "basic" ? 1 : 2;
  return questionNumber <= BASIC_QUESTIONS ? 1 : 2;
};

// Generic tips + one pointer per weak answer — kept for sessions that have no AI report.
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

const elearningTipsFor = (session: IInterviewSession): string[] => {
  const r = session.report;
  if (!r) return deriveElearningTips(session.turns);
  const fromTopics = (r.weakTopics ?? []).slice(0, 4).map(adviceFor);
  return [...new Set([...(r.learningPlan ?? []), ...fromTopics])];
};

// ---------------------------------------------------------------- start
interface StartInterviewContext {
  level?: "beginner" | "intermediate" | "expert";
  jobTitle?: string;
  requiredSkills?: string[];
  visibility?: "candidate" | "hidden";
}

const toSelected = (qs: ai.GeneratedQuestion[], stage: InterviewStage): ISelectedQuestion[] =>
  qs.map((q) => ({ question: q.question, stage, topic: q.topic, keyPoints: q.keyPoints, source: q.source }));

export const startInterview = async (
  userId: string,
  applicationId?: string,
  context: StartInterviewContext = {}
): Promise<IInterviewSession> => {
  const visibility = context.visibility ?? "candidate";

  // Scoped by applicationId + visibility so a private practice session, the auto-triggered
  // AI interview and an HR-scheduled organizational interview never collide.
  const existing = await InterviewSession.findOne({
    userId,
    applicationId: applicationId ?? { $exists: false },
    visibility,
    status: { $ne: "completed" },
  });
  if (existing) {
    // Reuse a usable in-progress session. Anything else (a leftover from a failed start, or
    // a session from the old chat-based flow, which has no selectedQuestions) is discarded.
    if (existing.currentQuestionNumber && existing.currentQuestion && existing.selectedQuestions?.length) {
      return existing;
    }
    await existing.deleteOne();
  }

  const role = context.jobTitle || DEFAULT_ROLE;
  const level = context.level ?? "intermediate";

  // Wake the GPU server now so it is warm by the time the first answer is evaluated.
  ai.warmUp().catch(() => undefined);

  const split = questionSplit(level);
  const [basic, technical] = await Promise.all([
    split.basic
      ? ai.generateQuestions({ stage: "basic", role, topics: basicTopicsFor(), count: split.basic })
      : Promise.resolve([]),
    split.technical
      ? ai.generateQuestions({
          stage: "technical",
          level,
          role,
          topics: technicalTopicsFor(context.jobTitle, context.requiredSkills),
          count: split.technical,
        })
      : Promise.resolve([]),
  ]);

  const selectedQuestions = [...toSelected(basic, "basic"), ...toSelected(technical, "technical")];
  if (!selectedQuestions.length) {
    throw new AppError("Could not prepare interview questions", 502);
  }

  return InterviewSession.create({
    userId,
    applicationId,
    level: context.level,
    role,
    visibility,
    status: "in_progress",
    messages: [],
    turns: [],
    selectedQuestions,
    currentQuestionNumber: 1,
    currentQuestion: selectedQuestions[0].question,
  });
};

// HR question set: HR's own questions (random draw + shuffle per candidate), graded by the
// same fine-tuned evaluator using HR's reference answer as the key points, then scaled to marks.
export const startStructuredInterview = async (
  userId: string,
  applicationId: string,
  questionSet: IOrgInterviewQuestionSet
): Promise<IInterviewSession> => {
  const existing = await InterviewSession.findOne({
    userId,
    applicationId,
    visibility: "hidden",
    status: { $ne: "completed" },
  });
  if (existing) return existing;

  const poolSize = questionSet.questions.length;
  const count =
    questionSet.questionsPerInterview && questionSet.questionsPerInterview > 0
      ? Math.min(questionSet.questionsPerInterview, poolSize)
      : poolSize;
  const selectedQuestions: ISelectedQuestion[] = shuffle(questionSet.questions)
    .slice(0, count)
    .map((q) => ({
      question: q.question,
      referenceAnswer: q.referenceAnswer,
      marks: q.marks,
      stage: "technical" as const,
      topic: topicFromText(q.question),
      keyPoints: keyPointsFromReference(q.referenceAnswer),
      source: "hr" as const,
    }));

  ai.warmUp().catch(() => undefined);

  return InterviewSession.create({
    userId,
    applicationId,
    questionSetId: questionSet._id,
    role: undefined,
    selectedQuestions,
    visibility: "hidden",
    status: "in_progress",
    messages: [],
    turns: [],
    currentQuestionNumber: 1,
    currentQuestion: selectedQuestions[0].question,
  });
};

// ---------------------------------------------------------------- background evaluation
// In-memory handles of running evaluations, so the final answer can wait for them.
// If the server restarts, finalizeSession re-runs anything still "pending".
const runningEvaluations = new Map<string, Map<number, Promise<void>>>();

const evaluateTurn = (
  sessionId: string,
  questionNumber: number,
  selected: ISelectedQuestion,
  answer: string,
  level?: string
): Promise<void> => {
  const stage: InterviewStage = selected.stage ?? "technical";
  const job = (async () => {
    const filter = { _id: sessionId };
    const opts = { arrayFilters: [{ "t.questionNumber": questionNumber }] };
    try {
      const ev = await ai.evaluateAnswer({
        stage,
        level,
        topic: selected.topic || topicFromText(selected.question),
        question: selected.question,
        keyPoints: selected.keyPoints?.length ? selected.keyPoints : keyPointsFromReference(selected.referenceAnswer ?? ""),
        answer,
      });
      const set: Record<string, unknown> = {
        "turns.$[t].feedback": ev.feedback,
        "turns.$[t].score": ev.questionScore,
        "turns.$[t].verdict": ev.verdict,
        "turns.$[t].criteria": ev.scores,
        "turns.$[t].improvementTip": ev.improvementTip,
        "turns.$[t].weakTopics": ev.weakTopics,
        "turns.$[t].evalStatus": "done",
      };
      if (selected.marks) {
        set["turns.$[t].marksEarned"] = round1((ev.questionScore / 10) * selected.marks);
        set["turns.$[t].marksPossible"] = selected.marks;
      }
      await InterviewSession.updateOne(filter, { $set: set }, opts);
    } catch (err: any) {
      console.error(`[interview] evaluation failed (session ${sessionId}, Q${questionNumber}):`, err?.message ?? err);
      await InterviewSession.updateOne(
        filter,
        {
          $set: {
            "turns.$[t].evalStatus": "failed",
            "turns.$[t].feedback": "Automatic evaluation was not available for this answer.",
          },
        },
        opts
      );
    }
  })();

  const perSession = runningEvaluations.get(sessionId) ?? new Map<number, Promise<void>>();
  perSession.set(questionNumber, job);
  runningEvaluations.set(sessionId, perSession);
  return job;
};

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);

// ---------------------------------------------------------------- answer
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
  const selected = session.selectedQuestions;
  if (!selected?.length) {
    throw new AppError("This interview was started with an older version of the platform. Please start a new interview.", 409);
  }

  const questionNumber = session.currentQuestionNumber;
  const current = selected[questionNumber - 1];
  if (!current) {
    throw new AppError("Interview session is in an invalid state", 500);
  }
  if (session.turns.some((t) => t.questionNumber === questionNumber)) {
    throw new AppError("This question has already been answered", 409); // double submit
  }

  session.turns.push({
    questionNumber,
    question: current.question,
    answer,
    feedback: "",
    score: 0,
    stage: current.stage,
    topic: current.topic,
    evalStatus: "pending",
    marksPossible: current.marks,
  });

  const isLast = questionNumber >= selected.length;
  if (!isLast) {
    session.currentQuestionNumber = questionNumber + 1;
    session.currentQuestion = selected[questionNumber].question;
  }
  await session.save(); // the turn must exist before the background job updates it

  const evaluation = evaluateTurn(session._id.toString(), questionNumber, current, answer, session.level);
  if (!isLast) {
    evaluation.catch(() => undefined);
    return session;
  }
  return finalizeSession(session._id.toString());
};

// ---------------------------------------------------------------- finish + report
const finalizeSession = async (sessionId: string): Promise<IInterviewSession> => {
  // 1) wait for this session's evaluations (re-run any that were lost, e.g. after a restart)
  let session = await InterviewSession.findById(sessionId);
  if (!session) throw new AppError("Interview session not found", 404);
  const running = runningEvaluations.get(sessionId) ?? new Map<number, Promise<void>>();
  for (const t of session.turns) {
    if (t.evalStatus === "pending" && !running.has(t.questionNumber)) {
      const sq = session.selectedQuestions?.[t.questionNumber - 1];
      if (sq) running.set(t.questionNumber, evaluateTurn(sessionId, t.questionNumber, sq, t.answer, session.level));
    }
  }
  await withTimeout(Promise.allSettled([...running.values()]), AI_FINAL_WAIT_MS);
  runningEvaluations.delete(sessionId);

  session = await InterviewSession.findById(sessionId);
  if (!session) throw new AppError("Interview session not found", 404);
  for (const t of session.turns) {
    if (t.evalStatus === "pending") {
      t.evalStatus = "failed";
      t.feedback = "Automatic evaluation timed out for this answer.";
    }
  }

  // 2) deterministic scores (failed evaluations are excluded rather than counted as zero)
  const scored = session.turns.filter((t) => t.evalStatus === "done" || t.evalStatus === undefined);
  const basicTurns = scored.filter((t) => t.stage === "basic");
  const techTurns = scored.filter((t) => t.stage !== "basic");
  const basicScore = basicTurns.length ? stageScore(basicTurns.map((t) => t.score)) : null;
  const technicalScore = techTurns.length ? stageScore(techTurns.map((t) => t.score)) : null;

  let overall = overallScore(basicScore, technicalScore);
  if (session.questionSetId) {
    // HR question set: marks-weighted, same as HR's mark scheme
    const earned = scored.reduce((s, t) => s + (t.marksEarned ?? 0), 0);
    const possible = scored.reduce((s, t) => s + (t.marksPossible ?? 0), 0);
    overall = possible > 0 ? round1((earned / possible) * 10) : 0;
  }

  const isHidden = session.visibility === "hidden";
  const reportType: "candidate" | "hr" = isHidden ? "hr" : "candidate";
  const passMark = passScore100();
  const passed = scored.length > 0 && overall * 10 >= passMark;
  const decision = reportType === "candidate" ? (passed ? "pass" : "needs_improvement") : hrDecision(overall);
  const role = session.role || DEFAULT_ROLE;
  const weakTopics: string[] = [...new Set<string>(scored.flatMap((t) => t.weakTopics ?? []))];
  const results: ai.ReportResultLine[] = [...basicTurns, ...techTurns].map((t) => ({
    stage: (t.stage ?? "technical") as InterviewStage,
    topic: t.topic || "general_cs",
    score: t.score,
    verdict: t.verdict || "",
    feedback: t.feedback,
  }));

  // 3) report narrative: model when the session matches its training format, else fallback
  let text: ai.ReportText | null = null;
  let generatedBy: "model" | "fallback" = "fallback";
  if (basicScore !== null && technicalScore !== null && !session.questionSetId) {
    try {
      text = await ai.writeReportText({
        reportType, role, level: session.level ?? "intermediate", basicScore, technicalScore,
        overall, decision, results, passMark10: passMark / 10,
      });
      generatedBy = "model";
    } catch (err: any) {
      console.error(`[interview] report generation failed (session ${sessionId}):`, err?.message ?? err);
    }
  }
  if (!text) {
    text = fallbackReport({
      reportType, role, overall, basicScore, technicalScore, passed, decision,
      passMark10: passMark / 10, results, weakTopics,
    });
  }
  if (!scored.length) {
    text.summary = "The answers could not be evaluated automatically. Please try the interview again later.";
  }

  const report: IInterviewReport = {
    reportType,
    basicScore: basicScore ?? undefined,
    technicalScore: technicalScore ?? undefined,
    overallScore: overall,
    decision,
    summary: text.summary,
    strengths: text.strengths,
    areasToImprove: text.areasToImprove,
    learningPlan: text.learningPlan,
    concerns: text.concerns,
    recommendation: text.recommendation,
    weakTopics,
    generatedBy,
  };

  session.status = "completed";
  session.score = Math.round(overall * 10); // 0-100, as used by certificates and HR views
  session.result = passed ? "pass" : "fail";
  session.feedback = report.summary;
  session.report = report;
  session.messages = [];
  session.currentQuestionNumber = undefined;
  session.currentQuestion = undefined;
  await session.save();
  return session;
};

export const getSession = async (userId: string, sessionId: string): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  return session;
};

// ---------------------------------------------------------------- views
// Per-turn feedback/score is withheld while the interview is in progress, and for "hidden"
// (organizational) interviews the candidate never sees feedback, scores, result or report.
export const buildSessionView = (session: IInterviewSession) => {
  const isHidden = session.visibility === "hidden";
  const showTurnJudgement = !isHidden && session.status === "completed";
  const selected = session.selectedQuestions;

  const turnsWithRound = session.turns.map((t) => ({
    questionNumber: t.questionNumber,
    question: t.question,
    answer: t.answer,
    feedback: showTurnJudgement ? t.feedback : undefined,
    score: showTurnJudgement ? t.score : undefined,
    verdict: showTurnJudgement ? t.verdict : undefined,
    criteria: showTurnJudgement ? t.criteria : undefined,
    improvementTip: showTurnJudgement ? t.improvementTip : undefined,
    stage: t.stage,
    round: questionRound(t.questionNumber, selected),
  }));

  if (session.status === "completed") {
    return {
      sessionId: session._id,
      status: session.status,
      score: isHidden ? undefined : session.score,
      result: isHidden ? undefined : session.result,
      feedback: isHidden ? undefined : session.feedback,
      report: isHidden ? undefined : session.report,
      turns: turnsWithRound,
      certificatePaid: session.certificatePayment?.paid ?? false,
      elearningTips: !isHidden && session.result === "fail" ? elearningTipsFor(session) : undefined,
    };
  }

  return {
    sessionId: session._id,
    status: session.status,
    questionNumber: session.currentQuestionNumber,
    question: session.currentQuestion,
    totalQuestions: selected?.length,
    round: session.currentQuestionNumber ? questionRound(session.currentQuestionNumber, selected) : undefined,
    turns: turnsWithRound,
  };
};

export type InterviewHistoryType = "practice" | "ai_interview" | "organizational";

const classifySession = (session: IInterviewSession): InterviewHistoryType => {
  if (!session.applicationId) return "practice";
  return session.visibility === "hidden" ? "organizational" : "ai_interview";
};

const buildSessionSummary = (session: IInterviewSession, jobTitle?: string) => {
  const isHidden = session.visibility === "hidden";
  return {
    sessionId: session._id,
    type: classifySession(session),
    jobTitle,
    level: session.level,
    status: session.status,
    score: isHidden ? undefined : session.score,
    result: isHidden ? undefined : session.result,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
};

export const listSessionsForCandidate = async (userId: string, type?: InterviewHistoryType) => {
  const sessions = await InterviewSession.find({ userId }).sort({ createdAt: -1 });

  const applicationIds = sessions
    .map((s) => s.applicationId)
    .filter((id): id is NonNullable<typeof id> => Boolean(id));
  const applications = applicationIds.length
    ? await Application.find({ _id: { $in: applicationIds } }).populate("jobId", "title")
    : [];
  const jobTitleByApplicationId = new Map(
    applications.map((a) => [a._id.toString(), (a.jobId as any)?.title as string | undefined])
  );

  const summaries = sessions.map((session) =>
    buildSessionSummary(
      session,
      session.applicationId ? jobTitleByApplicationId.get(session.applicationId.toString()) : undefined
    )
  );

  return type ? summaries.filter((s) => s.type === type) : summaries;
};
