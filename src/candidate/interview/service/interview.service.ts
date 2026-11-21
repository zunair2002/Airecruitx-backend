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
import { basicTopicsFor, isTrack, keyPointsFromReference, shuffle, technicalTopicsFor, topicFromText, TRACKS, TrackId } from "../../../ai/topics";
import { adviceFor, fallbackReport } from "../../../ai/report";
import { estimateEvaluation } from "../../../ai/calibration";
import {
  AI_FINAL_WAIT_MS, AI_RETRY_WINDOW_MS, BASIC_INTERVIEW_MINUTES, BASIC_QUESTIONS, INTERVIEW_GRACE_MS, ORG_INTERVIEW_MINUTES,
  ORG_WARMUP_MINUTES, ROUND2_UNLOCK_SCORE, TECHNICAL_INTERVIEW_MINUTES, TECHNICAL_QUESTIONS, passScore100,
} from "../../../config/ai";
import { CLOSING_MESSAGE, isWarmup, warmupSelectedQuestions } from "../../../ai/warmupQuestions";
import { emitToUser } from "../../../config/socket";
import { assertPracticeAllowed, recordPracticeStart } from "./practiceUsage.service";

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

// ---------------------------------------------------------------- time limit
// The timer starts when the candidate starts (session created) and is enforced here, never
// trusted from the client. When it runs out the interview is finished with the answers given
// so far; unanswered questions score 0.
const timerFields = (minutes: number) => {
  const startedAt = new Date();
  return { startedAt, expiresAt: new Date(startedAt.getTime() + minutes * 60_000) };
};

const isFinished = (status: IInterviewSession["status"]): boolean => status === "completed" || status === "expired";
const UNFINISHED = { $nin: ["completed", "expired"] };

const isExpired = (s: Pick<IInterviewSession, "status" | "expiresAt">): boolean =>
  !isFinished(s.status) && !!s.expiresAt && Date.now() > s.expiresAt.getTime() + INTERVIEW_GRACE_MS;

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | "timeout"> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), ms); }),
  ]).finally(() => clearTimeout(timer));
};

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
export const deriveElearningTips = (turns: { question: string; score?: number; kind?: "warmup" | "pool" }[]): string[] => {
  const weakTopics = turns
    .filter((t) => !isWarmup(t) && typeof t.score === "number" && t.score <= 4)
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
    status: UNFINISHED,
    cancelledAt: { $exists: false }, // a cancelled org interview is never resumed
  });
  if (existing) {
    // Time ran out: it is being finished with the answers given (no fresh attempt)
    if (isExpired(existing)) {
      expireInBackground(existing);
      return existing;
    }
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

  const [basic, technical] = await Promise.all([
    ai.generateQuestions({ stage: "basic", role, topics: basicTopicsFor(), count: BASIC_QUESTIONS }),
    ai.generateQuestions({
      stage: "technical",
      level,
      role,
      topics: technicalTopicsFor(context.jobTitle, context.requiredSkills),
      count: TECHNICAL_QUESTIONS,
    }),
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
    stage: "combined",
    visibility,
    status: "in_progress",
    messages: [],
    turns: [],
    selectedQuestions,
    currentQuestionNumber: 1,
    currentQuestion: selectedQuestions[0].question,
    // HR-invite interviews are timed; the job AI interview is created on apply / by HR long
    // before the candidate opens it, so it has no time limit.
    ...(visibility === "hidden" ? timerFields(ORG_INTERVIEW_MINUTES) : {}),
  });
};

// ---------------------------------------------------------------- practice: two separate rounds
// Round 1 = basic interview (5 questions). Round 2 = technical interview (8 questions on the
// chosen track), only unlocked when Round 1 scored at least ROUND2_UNLOCK_SCORE. The final
// report and the certificate come from Round 2 and combine both rounds.
export interface StartPracticeContext {
  stage?: "basic" | "technical";
  track?: string;
  level?: "beginner" | "intermediate" | "expert"; // optional, only fine-tunes technical question difficulty
  basicSessionId?: string;
}

export const startPracticeRound = async (userId: string, context: StartPracticeContext = {}): Promise<IInterviewSession> => {
  const stage = context.stage ?? "basic";

  // Round 2 needs a completed Round 1 that reached the unlock score
  let basicSession: IInterviewSession | null = null;
  if (stage === "technical") {
    basicSession = context.basicSessionId
      ? await InterviewSession.findOne({ _id: context.basicSessionId, userId, stage: "basic", status: { $in: ["completed", "expired"] } })
      : await InterviewSession.findOne({ userId, stage: "basic", status: { $in: ["completed", "expired"] }, applicationId: { $exists: false } })
          .sort({ createdAt: -1 });
    if (!basicSession) {
      throw new AppError("Complete Round 1 (basic interview) before starting Round 2", 400);
    }
    if ((basicSession.score ?? 0) < ROUND2_UNLOCK_SCORE) {
      throw new AppError(
        `Round 2 unlocks at ${ROUND2_UNLOCK_SCORE}% in Round 1 (you scored ${basicSession.score ?? 0}%). Review the tips and retake Round 1.`,
        403
      );
    }
  }
  const track: TrackId = isTrack(context.track) ? context.track : isTrack(basicSession?.track) ? (basicSession!.track as TrackId) : "software_engineer";

  // Reuse an in-progress session of the same round only if it still matches the request (same
  // track, and for Round 2 the same Round 1 it was unlocked by); otherwise replace it.
  // Also drop leftovers from the old combined flow.
  const inProgress = await InterviewSession.findOne({
    userId, applicationId: { $exists: false }, visibility: "candidate", stage, status: UNFINISHED,
  });
  const sameTrack = !context.track || context.track === inProgress?.track;
  const sameBasicSession = stage !== "technical" || String(inProgress?.basicSessionId ?? "") === String(basicSession?._id ?? "");
  const expired = Boolean(inProgress && isExpired(inProgress));
  if (inProgress && expired) expireInBackground(inProgress); // keep the timed-out attempt (scored)
  if (!expired && inProgress?.currentQuestion && inProgress.selectedQuestions?.length && sameTrack && sameBasicSession) return inProgress;
  // Resuming (above) is free; a brand-new session counts against the plan's daily allowance.
  await assertPracticeAllowed(userId);
  if (inProgress && !expired) await inProgress.deleteOne();
  const legacy = await InterviewSession.findOne({
    userId, applicationId: { $exists: false }, visibility: "candidate", stage: { $exists: false }, status: UNFINISHED,
  });
  if (legacy) await legacy.deleteOne();

  const role = TRACKS[track].role;
  ai.warmUp().catch(() => undefined);
  const questions = stage === "basic"
    ? await ai.generateQuestions({ stage: "basic", role, topics: basicTopicsFor(), count: BASIC_QUESTIONS })
    : await ai.generateQuestions({
        stage: "technical", level: context.level ?? "intermediate", role, topics: [...TRACKS[track].topics], count: TECHNICAL_QUESTIONS,
      });
  const selectedQuestions = toSelected(questions, stage);
  if (!selectedQuestions.length) throw new AppError("Could not prepare interview questions", 502);

  const session = await InterviewSession.create({
    userId,
    level: context.level,
    role,
    stage,
    track,
    basicSessionId: basicSession?._id,
    visibility: "candidate",
    status: "in_progress",
    messages: [],
    turns: [],
    selectedQuestions,
    currentQuestionNumber: 1,
    currentQuestion: selectedQuestions[0].question,
    ...timerFields(stage === "basic" ? BASIC_INTERVIEW_MINUTES : TECHNICAL_INTERVIEW_MINUTES),
  });
  // Recorded on the user, not just as this session, so deleting the session later
  // (abandon + restart) doesn't hand the slot back.
  await recordPracticeStart(userId, session.createdAt);
  return session;
};

// HR question set: HR's own questions (random draw + shuffle per candidate), graded by the
// same fine-tuned evaluator using HR's reference answer as the key points, then scaled to marks.
// The pool questions are preceded by the 3 fixed warm-up questions (never evaluated or scored).
export const startStructuredInterview = async (
  userId: string,
  applicationId: string,
  questionSet: IOrgInterviewQuestionSet
): Promise<IInterviewSession> => {
  const existing = await InterviewSession.findOne({
    userId,
    applicationId,
    visibility: "hidden",
    status: UNFINISHED,
    cancelledAt: { $exists: false }, // a cancelled org interview is never resumed
  });
  if (existing) {
    if (isExpired(existing)) expireInBackground(existing);
    return existing;
  }

  const poolSize = questionSet.questions.length;
  const count =
    questionSet.questionsPerInterview && questionSet.questionsPerInterview > 0
      ? Math.min(questionSet.questionsPerInterview, poolSize)
      : poolSize;
  const poolQuestions: ISelectedQuestion[] = shuffle(questionSet.questions)
    .slice(0, count)
    .map((q) => ({
      question: q.question,
      referenceAnswer: q.referenceAnswer,
      marks: q.marks,
      stage: "technical" as const,
      topic: topicFromText(q.question),
      keyPoints: keyPointsFromReference(q.referenceAnswer),
      source: "hr" as const,
      kind: "pool" as const,
    }));
  const selectedQuestions: ISelectedQuestion[] = [...warmupSelectedQuestions(), ...poolQuestions];

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
    ...timerFields(ORG_INTERVIEW_MINUTES + ORG_WARMUP_MINUTES),
  });
};

// ---------------------------------------------------------------- background evaluation
const keyPointsOf = (selected: ISelectedQuestion): string[] =>
  selected.keyPoints?.length ? selected.keyPoints : keyPointsFromReference(selected.referenceAnswer ?? "");

const evaluationFields = (ev: ai.AnswerEvaluation, selected: ISelectedQuestion, evalStatus: "done" | "estimated") => {
  const fields: Record<string, unknown> = {
    feedback: ev.feedback,
    score: ev.questionScore,
    verdict: ev.verdict,
    criteria: ev.scores,
    rawScores: evalStatus === "done" ? ev.rawScores : undefined,
    improvementTip: ev.improvementTip,
    weakTopics: ev.weakTopics,
    evalStatus,
  };
  if (selected.marks) {
    fields.marksEarned = round1((ev.questionScore / 10) * selected.marks);
    fields.marksPossible = selected.marks;
  }
  return fields;
};

// In-process background tasks (single backend instance). Each answer evaluation and each
// finalization runs at most once at a time: a second request for the same work joins the running
// promise, and the map entry is removed as soon as the task settles. Model calls go through
// ai.aiQueue, so at most AI_CONCURRENCY requests are in flight. After a restart MongoDB still
// holds the "pending" turns, and recoverPendingInterviewJobs (startup + every 30 s) restarts them.
interface AnswerEvaluationTask { sessionId: string; questionNumber: number }
interface InterviewFinalizationTask { sessionId: string; timeUp: boolean }

const runningEvaluations = new Map<string, Promise<void>>();
const runningFinalizations = new Map<string, Promise<void>>();
const evaluationKey = ({ sessionId, questionNumber }: AnswerEvaluationTask): string => `${sessionId}:${questionNumber}`;

/** Starts (or joins) the background evaluation of one answer. Never rejects: failures mark the turn "pending_eval". */
const evaluateTurn = (task: AnswerEvaluationTask): Promise<void> => {
  const key = evaluationKey(task);
  const running = runningEvaluations.get(key);
  if (running) return running;
  const promise: Promise<void> = processAnswerEvaluation(task)
    .catch(async (err: any) => {
      console.error(`[interview] evaluation failed (session ${task.sessionId}, Q${task.questionNumber}):`, err?.message ?? err);
      await markAnswerEvaluationFailed(task);
    })
    .catch((err: any) => {
      console.error(`[interview] could not record failed evaluation (session ${task.sessionId}, Q${task.questionNumber}):`, err?.message ?? err);
    })
    .finally(() => {
      if (runningEvaluations.get(key) === promise) runningEvaluations.delete(key);
    });
  runningEvaluations.set(key, promise);
  return promise;
};

/** Finishes a session once; concurrent callers (last answer, timer sweep, page reload) share the same run. */
const finalizeOnceOrWait = (sessionId: string, timeUp: boolean): Promise<void> => {
  const running = runningFinalizations.get(sessionId);
  if (running) return running;
  const promise: Promise<void> = processInterviewFinalization({ sessionId, timeUp })
    .then(() => undefined)
    .finally(() => {
      if (runningFinalizations.get(sessionId) === promise) runningFinalizations.delete(sessionId);
    });
  runningFinalizations.set(sessionId, promise);
  return promise;
};

const finalizeInBackground = (sessionId: string, timeUp: boolean): void => {
  finalizeOnceOrWait(sessionId, timeUp).catch((err: any) => {
    console.error(`[interview] finalizing session ${sessionId} failed:`, err?.message ?? err);
  });
};

export const processAnswerEvaluation = async ({
  sessionId,
  questionNumber,
}: AnswerEvaluationTask): Promise<void> => {
  const session = await InterviewSession.findById(sessionId);
  if (!session) return;
  const turn = session.turns.find((item) => item.questionNumber === questionNumber);
  const selected = session.selectedQuestions?.[questionNumber - 1];
  if (!turn || !selected || turn.evalStatus === "done" || turn.evalStatus === "estimated") return;
  if (isWarmup(selected) || isWarmup(turn)) return; // warm-up answers are never sent to the model

  const stage: InterviewStage = selected.stage ?? "technical";
  const ev = await ai.evaluateAnswer({
    stage,
    level: session.level,
    topic: selected.topic || topicFromText(selected.question),
    question: selected.question,
    keyPoints: keyPointsOf(selected),
    answer: turn.answer,
  });
  const set = Object.fromEntries(
    Object.entries(evaluationFields(ev, selected, "done")).map(([key, value]) => [
      `turns.$[t].${key}`,
      value,
    ]),
  );
  await InterviewSession.updateOne(
    { _id: sessionId },
    { $set: set },
    { arrayFilters: [{ "t.questionNumber": questionNumber }] },
  );
};

export const markAnswerEvaluationFailed = async ({
  sessionId,
  questionNumber,
}: AnswerEvaluationTask): Promise<void> => {
  await InterviewSession.updateOne(
    { _id: sessionId, "turns.questionNumber": questionNumber },
    { $set: { "turns.$[t].evalStatus": "pending_eval" } },
    { arrayFilters: [{ "t.questionNumber": questionNumber }] },
  );
};

const estimatedNote = (n: number): string =>
  n ? ` Note: ${n} answer score${n > 1 ? "s are" : " is"} estimated because AI evaluation was unavailable.` : "";

// ---------------------------------------------------------------- answer
export const submitAnswer = async (
  userId: string,
  sessionId: string,
  answer: string,
  // Optional: the question the client is answering. When sent, a stale or repeated submit
  // (double click, retry) gets 409 instead of being recorded as the next question's answer.
  expectedQuestionNumber?: number
): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (session.status === "completed") {
    throw new AppError("This interview is already completed", 400);
  }
  if (session.cancelledAt) {
    throw new AppError("This interview was cancelled and no longer accepts answers", 409);
  }
  // Time is up: this answer is not recorded; the interview is finished with the answers given
  if (session.status === "expired" || isExpired(session)) {
    expireInBackground(session);
    throw new AppError("Interview time expired", 410);
  }
  if (!session.currentQuestionNumber || !session.currentQuestion) {
    throw new AppError("Interview session is in an invalid state", 500);
  }
  const selected = session.selectedQuestions;
  if (!selected?.length) {
    throw new AppError("This interview was started with an older version of the platform. Please start a new interview.", 409);
  }

  const questionNumber = session.currentQuestionNumber;
  if (expectedQuestionNumber !== undefined && expectedQuestionNumber !== questionNumber) {
    throw new AppError("This question has already been answered", 409);
  }
  const current = selected[questionNumber - 1];
  if (!current) {
    throw new AppError("Interview session is in an invalid state", 500);
  }
  // Warm-up answers go through the same atomic guard below (409 duplicate / 410 time-up) but
  // are stored as final at once: no evaluation, no score, no marks.
  const warmup = isWarmup(current);
  const newTurn = warmup
    ? {
        questionNumber,
        question: current.question,
        answer,
        feedback: "",
        kind: "warmup" as const,
        evalStatus: "done" as const,
      }
    : {
        questionNumber,
        question: current.question,
        answer,
        feedback: "",
        score: 0,
        stage: current.stage,
        topic: current.topic,
        evalStatus: "pending" as const,
        marksPossible: current.marks,
        ...(current.kind ? { kind: current.kind } : {}),
      };

  const isLast = questionNumber >= selected.length;
  // Atomic push: the filter only matches while this question is still current and unanswered,
  // so two concurrent submits can't both add a turn (the loser gets null -> 409).
  // The turn must exist before the background evaluation updates it.
  const updated = await InterviewSession.findOneAndUpdate(
    {
      _id: sessionId,
      userId,
      status: "in_progress",
      cancelledAt: { $exists: false },
      currentQuestionNumber: questionNumber,
      "turns.questionNumber": { $ne: questionNumber },
      // re-checked atomically so an answer can't slip in after the deadline
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date(Date.now() - INTERVIEW_GRACE_MS) } }],
    },
    {
      $push: { turns: newTurn },
      $set: isLast
        ? { currentQuestionNumber: questionNumber, currentQuestion: current.question }
        : { currentQuestionNumber: questionNumber + 1, currentQuestion: selected[questionNumber].question },
    },
    { new: true }
  );
  if (!updated) {
    if (isExpired(session)) {
      expireInBackground(session); // deadline passed meanwhile
      throw new AppError("Interview time expired", 410);
    }
    throw new AppError("This question has already been answered", 409); // double submit
  }

  // Respond at once; the answer is evaluated in the background (warm-up answers never are).
  if (!warmup) void evaluateTurn({ sessionId: updated._id.toString(), questionNumber });
  if (!isLast) {
    return updated;
  }
  await finalizeOnceOrWait(updated._id.toString(), false);
  const finalized = await InterviewSession.findById(updated._id);
  if (!finalized) throw new AppError("Interview session not found", 404);
  return finalized;
};

export const processInterviewFinalization = async ({
  sessionId,
  timeUp,
}: InterviewFinalizationTask): Promise<string> => {
  const session = await InterviewSession.findById(sessionId);
  if (!session) throw new AppError("Interview session not found", 404);
  if (isFinished(session.status)) return sessionId;
  if ((timeUp || isExpired(session)) && session.turns.length < (session.selectedQuestions?.length ?? 0)) {
    await closeUnansweredQuestions(session);
  }
  const finalized = await finalizeSession(sessionId);
  if (!isFinished(finalized.status)) {
    throw new Error(`Interview finalization did not complete for session ${sessionId}`);
  }
  return sessionId;
};

export const recoverPendingInterviewJobs = async (): Promise<number> => {
  let recovered = 0;
  const now = new Date(Date.now() - INTERVIEW_GRACE_MS);
  const cursor = InterviewSession.find({
    status: "in_progress",
    $or: [
      { "turns.evalStatus": "pending" },
      { expiresAt: { $lt: now } },
      {
        $expr: {
          $and: [
            { $gt: [{ $size: { $ifNull: ["$selectedQuestions", []] } }, 0] },
            {
              $gte: [
                { $size: { $ifNull: ["$turns", []] } },
                { $size: { $ifNull: ["$selectedQuestions", []] } },
              ],
            },
          ],
        },
      },
    ],
  })
    .select("_id userId status expiresAt selectedQuestions turns")
    .limit(500)
    .cursor();

  for await (const session of cursor) {
    const sessionId = session._id.toString();
    if (isExpired(session)) {
      if (!runningFinalizations.has(sessionId)) recovered++;
      finalizeInBackground(sessionId, true);
      continue;
    }

    const allQuestionsAnswered = Boolean(
      session.selectedQuestions?.length
      && session.turns.length >= session.selectedQuestions.length,
    );
    if (allQuestionsAnswered) {
      if (!runningFinalizations.has(sessionId)) recovered++;
      finalizeInBackground(sessionId, false);
      continue;
    }

    for (const turn of session.turns) {
      if (turn.evalStatus !== "pending" || isWarmup(turn)) continue;
      const task = { sessionId, questionNumber: turn.questionNumber };
      if (runningEvaluations.has(evaluationKey(task))) continue;
      void evaluateTurn(task);
      recovered++;
    }
  }
  return recovered;
};

// Time ran out: every question without an answer becomes a 0-score "no_answer" turn, so it
// counts in the round average (answering a few questions and letting the timer run out
// must not give a high score). Unanswered warm-up questions are skipped: they never score.
const closeUnansweredQuestions = async (session: IInterviewSession): Promise<void> => {
  const answered = new Set(session.turns.map((t) => t.questionNumber));
  const missing = (session.selectedQuestions ?? [])
    .map((q, i) => ({ q, questionNumber: i + 1 }))
    .filter(({ q, questionNumber }) => !isWarmup(q) && !answered.has(questionNumber))
    .map(({ q, questionNumber }) => ({
      questionNumber,
      question: q.question,
      answer: "(not answered: time expired)",
      feedback: "Time expired before this question was answered.",
      score: 0,
      stage: q.stage,
      topic: q.topic,
      verdict: "no_answer",
      evalStatus: "done" as const,
      unanswered: true,
      marksEarned: q.marks ? 0 : undefined,
      marksPossible: q.marks,
      ...(q.kind ? { kind: q.kind } : {}),
    }));
  await InterviewSession.updateOne(
    { _id: session._id, status: "in_progress" },
    { $push: { turns: { $each: missing } }, $set: { timedOut: true } }
  );
};

const expireInBackground = (session: Pick<IInterviewSession, "_id" | "userId">): void => {
  const sessionId = session._id.toString();
  finalizeOnceOrWait(sessionId, true)
    .then(async () => {
      const finished = await InterviewSession.findById(sessionId);
      if (finished?.status === "expired") {
        emitToUser(session.userId.toString(), "interview:time-up", { sessionId });
      }
    })
    .catch((err) => console.error(`[interview] finishing timed-out session ${sessionId} failed:`, err));
};

/** Expiry sweep (src/config/interviewTimerScheduler.ts): finish sessions whose time ran out. */
export const finalizeExpiredSessions = async (): Promise<number> => {
  const due = await InterviewSession.find({
    status: "in_progress",
    expiresAt: { $lt: new Date(Date.now() - INTERVIEW_GRACE_MS) },
  })
    .select("_id userId")
    .limit(50);
  due.forEach(expireInBackground);
  return due.length;
};

const timeUpNote = (session: IInterviewSession): string => {
  if (!session.timedOut) return "";
  // warm-up questions are not part of the scored interview, so they are not counted here
  const total = session.selectedQuestions
    ? session.selectedQuestions.filter((q) => !isWarmup(q)).length
    : session.turns.filter((t) => !isWarmup(t)).length;
  const answered = session.turns.filter((t) => !t.unanswered && !isWarmup(t)).length;
  return ` Time expired: answered ${answered} of ${total} questions; unanswered questions scored 0.`;
};

// ---------------------------------------------------------------- finish + report
const finalizeSession = async (sessionId: string): Promise<IInterviewSession> => {
  // 1) wait for this session's evaluations (joins running ones; re-runs any lost to a restart)
  let session = await InterviewSession.findById(sessionId);
  if (!session) throw new AppError("Interview session not found", 404);
  const pending = session.turns
    .filter((t) => t.evalStatus === "pending" && !isWarmup(t) && session!.selectedQuestions?.[t.questionNumber - 1])
    .map((t) => evaluateTurn({ sessionId, questionNumber: t.questionNumber }));
  await withTimeout(Promise.allSettled(pending), AI_FINAL_WAIT_MS);

  // 1b) evaluations that failed during the interview get one more try (up to AI_RETRY_WINDOW_MS)
  session = await InterviewSession.findById(sessionId);
  if (!session) throw new AppError("Interview session not found", 404);
  const retry = session.turns.filter(
    (t) => t.evalStatus === "pending_eval" && !isWarmup(t) && session!.selectedQuestions?.[t.questionNumber - 1],
  );
  if (retry.length > 0) {
    ai.warmUp().catch(() => undefined);
    await withTimeout(
      Promise.allSettled(retry.map((turn) => evaluateTurn({ sessionId, questionNumber: turn.questionNumber }))),
      AI_RETRY_WINDOW_MS + 15_000,
    );
    session = await InterviewSession.findById(sessionId);
    if (!session) throw new AppError("Interview session not found", 404);
  }

  if (isExpired(session) && session.turns.length < (session.selectedQuestions?.length ?? 0)) {
    await closeUnansweredQuestions(session);
    session = await InterviewSession.findById(sessionId);
    if (!session) throw new AppError("Interview session not found", 404);
  }

  // 1c) still not evaluated: fallback score, flagged "estimated" in the turn and the report
  for (const t of session.turns) {
    if (isWarmup(t)) continue; // warm-up answers are never scored (no estimate, no "too short" 0)
    if (t.evalStatus !== "pending" && t.evalStatus !== "pending_eval") continue;
    const sq = session.selectedQuestions?.[t.questionNumber - 1] ?? { question: t.question, stage: t.stage };
    const est = estimateEvaluation({ stage: sq.stage ?? t.stage ?? "technical", keyPoints: keyPointsOf(sq), answer: t.answer });
    Object.assign(t, evaluationFields(est, sq, "estimated"));
  }

  // 2) deterministic scores (legacy "failed" evaluations are excluded rather than counted as zero;
  //    warm-up turns are never part of any score, average or marks total)
  const scored = session.turns.filter(
    (t) => !isWarmup(t) && (t.evalStatus === "done" || t.evalStatus === "estimated" || t.evalStatus === undefined),
  );
  const roundStage = session.stage ?? "combined";
  if (roundStage === "basic") return finalizeBasicRound(session, scored);

  // Round 2 (technical) of practice: bring in the Round 1 answers so the final report covers both
  let previousBasic: typeof scored = [];
  let linkedBasicScore: number | null = null;
  if (roundStage === "technical" && session.basicSessionId) {
    const basicSession = await InterviewSession.findById(session.basicSessionId);
    if (basicSession) {
      previousBasic = basicSession.turns.filter((t) => t.evalStatus === "done" || t.evalStatus === "estimated" || t.evalStatus === undefined);
      linkedBasicScore = basicSession.report?.basicScore ?? (typeof basicSession.score === "number" ? round1(basicSession.score / 10) : null);
    }
  }
  const basicTurns = roundStage === "technical" ? previousBasic : scored.filter((t) => t.stage === "basic");
  const techTurns = scored.filter((t) => t.stage !== "basic");
  const basicScore = roundStage === "technical" ? linkedBasicScore : basicTurns.length ? stageScore(basicTurns.map((t) => t.score)) : null;
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
  // Round 2 must have evaluated technical answers of its own to pass
  const hasEvidence = roundStage === "technical" ? techTurns.length > 0 : techTurns.length + basicTurns.length > 0;
  const passed = hasEvidence && overall * 10 >= passMark;
  const decision = reportType === "candidate" ? (passed ? "pass" : "needs_improvement") : hrDecision(overall);
  const role = session.role || DEFAULT_ROLE;
  const weakTopics: string[] = [...new Set<string>([...basicTurns, ...techTurns].flatMap((t) => t.weakTopics ?? []))];
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
    text.summary = session.timedOut && !session.turns.some((t) => !isWarmup(t))
      ? "No question was answered before the time limit."
      : "The answers could not be evaluated automatically. Please try the interview again later.";
  }
  const estimatedCount = scored.filter((t) => t.evalStatus === "estimated").length;
  text.summary += timeUpNote(session) + estimatedNote(estimatedCount);

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
    estimatedCount: estimatedCount || undefined,
  };

  const { session: finished, committed } = await commitFinalResult(session, {
    status: session.timedOut ? "expired" : "completed",
    score: Math.round(overall * 10), // 0-100, as used by certificates and HR views
    result: passed ? "pass" : "fail",
    feedback: report.summary,
    report,
  });
  if (!committed) return finished; // another caller finished it first

  // HR invite finished (also when the time ran out with no request open): mark the invite
  // completed so HR sees it, same as submitOrgInterviewAnswerByToken does.
  if (isHidden && session.applicationId) {
    await Application.updateOne(
      { _id: session.applicationId, orgInterviewSessionId: session._id, "orgInterview.status": "invited" },
      { $set: { "orgInterview.status": "completed", "orgInterview.completedAt": new Date() } }
    );
  }
  return finished;
};

// Practice Round 1: score the basic answers; >= ROUND2_UNLOCK_SCORE unlocks Round 2.
// The model's report format needs both rounds, so Round 1 gets the deterministic summary.
const finalizeBasicRound = async (session: IInterviewSession, scored: IInterviewSession["turns"]): Promise<IInterviewSession> => {
  const basicScore = scored.length ? stageScore(scored.map((t) => t.score)) : 0;
  const score = Math.round(basicScore * 10);
  const unlocked = scored.length > 0 && score >= ROUND2_UNLOCK_SCORE;
  const weakTopics: string[] = [...new Set<string>(scored.flatMap((t) => t.weakTopics ?? []))];
  const results: ai.ReportResultLine[] = scored.map((t) => ({
    stage: "basic" as const, topic: t.topic || "self_introduction", score: t.score, verdict: t.verdict || "", feedback: t.feedback,
  }));
  const text = fallbackReport({
    reportType: "candidate", role: session.role || DEFAULT_ROLE, overall: basicScore, basicScore: null, technicalScore: null,
    passed: unlocked, decision: unlocked ? "round2_unlocked" : "retry_round1", passMark10: ROUND2_UNLOCK_SCORE / 10, results, weakTopics,
  });
  text.summary = !scored.length
    ? session.timedOut && !session.turns.length
      ? "No question was answered before the time limit. Please try Round 1 again."
      : "The answers could not be evaluated automatically. Please try Round 1 again later."
    : unlocked
      ? `You scored ${basicScore.toFixed(1)}/10 in Round 1 (basic interview). Round 2 (technical interview) is now unlocked.`
      : `You scored ${basicScore.toFixed(1)}/10 in Round 1 (basic interview). You need ${(ROUND2_UNLOCK_SCORE / 10).toFixed(1)}/10 to unlock Round 2; use the tips below and try again.`;
  const estimatedCount = scored.filter((t) => t.evalStatus === "estimated").length;
  text.summary += timeUpNote(session) + estimatedNote(estimatedCount);

  const { session: finished } = await commitFinalResult(session, {
    status: session.timedOut ? "expired" : "completed",
    score,
    result: unlocked ? "pass" : "fail",
    feedback: text.summary,
    report: {
      reportType: "candidate", basicScore, overallScore: basicScore, decision: unlocked ? "round2_unlocked" : "retry_round1",
      summary: text.summary, strengths: text.strengths, areasToImprove: text.areasToImprove, learningPlan: text.learningPlan,
      weakTopics, generatedBy: "fallback", estimatedCount: estimatedCount || undefined,
    },
  });
  return finished;
};

/**
 * Atomic guard against double finalization: only the first writer moves the session from
 * "in_progress" to "completed"/"expired". Any later writer gets committed=false and the stored result.
 */
const commitFinalResult = async (
  session: IInterviewSession,
  result: Pick<IInterviewSession, "status" | "score" | "result" | "feedback" | "report">,
): Promise<{ session: IInterviewSession; committed: boolean }> => {
  const finished = await InterviewSession.findOneAndUpdate(
    { _id: session._id, status: "in_progress" },
    {
      $set: { ...result, turns: session.turns, messages: [] },
      $unset: { currentQuestionNumber: 1, currentQuestion: 1 },
    },
    { new: true },
  );
  if (finished) {
    console.log(`[interview] session ${session._id} finalized (${result.status})`);
    return { session: finished, committed: true };
  }
  console.log(`[interview] session ${session._id} was already finalized; duplicate result discarded`);
  const existing = await InterviewSession.findById(session._id);
  if (!existing) throw new AppError("Interview session not found", 404);
  return { session: existing, committed: false };
};

export const getSession = async (userId: string, sessionId: string): Promise<IInterviewSession> => {
  const session = await InterviewSession.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("Interview session not found", 404);
  }
  if (isExpired(session)) expireInBackground(session); // the view shows timeUp until it is finished
  return session;
};

// ---------------------------------------------------------------- views
// Progress of a structured (HR question-pool) interview: warm-up questions come first and are
// numbered on their own; pool questions are numbered 1..totalPoolQuestions after them.
const progressFor = (selected: ISelectedQuestion[], questionNumber?: number) => {
  const totalWarmup = selected.filter(isWarmup).length;
  const totalPoolQuestions = selected.length - totalWarmup;
  if (!questionNumber) return { totalWarmup, totalPoolQuestions };
  const before = selected.slice(0, questionNumber);
  const warmupCount = before.filter(isWarmup).length;
  return isWarmup(selected[questionNumber - 1])
    ? { totalWarmup, totalPoolQuestions, warmupNumber: warmupCount }
    : { totalWarmup, totalPoolQuestions, poolQuestionNumber: questionNumber - warmupCount };
};

/** Pool position (1-based) of a question number in a structured session; undefined for a warm-up. */
export const poolQuestionNumberOf = (selected: ISelectedQuestion[] | undefined, questionNumber: number): number | undefined => {
  if (!selected?.length) return questionNumber;
  if (isWarmup(selected[questionNumber - 1])) return undefined;
  return questionNumber - selected.slice(0, questionNumber).filter(isWarmup).length;
};

/**
 * HR-side view of an org interview session: warm-up answers are split into "introduction"
 * (question + answer only, no score) and turns holds only the scored pool questions, each with
 * its poolQuestionNumber. Sessions without warm-ups come back unchanged apart from these fields.
 */
export const buildHrSessionView = (session: IInterviewSession) => {
  const obj = session.toObject() as Record<string, any>;
  const selected = session.selectedQuestions;
  obj.introduction = session.turns
    .filter(isWarmup)
    .map((t) => ({ questionNumber: t.questionNumber, question: t.question, answer: t.answer }));
  obj.turns = (obj.turns as IInterviewSession["turns"])
    .filter((t) => !isWarmup(t))
    .map((t) => ({ ...t, kind: t.kind ?? "pool", poolQuestionNumber: poolQuestionNumberOf(selected, t.questionNumber) }));
  return obj;
};

// Per-turn feedback/score is withheld while the interview is in progress, and for "hidden"
// (organizational) interviews the candidate never sees feedback, scores, result or report.
export const buildSessionView = (session: IInterviewSession) => {
  const isHidden = session.visibility === "hidden";
  const showTurnJudgement = !isHidden && isFinished(session.status);
  const selected = session.selectedQuestions;
  // A finished (completed, timed out or cancelled) organisational interview is HR's record,
  // not the candidate's: they get a status summary only — no questions or answers back.
  const hideTurns = isHidden && (isFinished(session.status) || Boolean(session.cancelledAt));
  const structured = Boolean(session.questionSetId);

  const turnsWithRound = (hideTurns ? [] : session.turns).map((t) => ({
    questionNumber: t.questionNumber,
    kind: t.kind ?? "pool",
    question: t.question,
    answer: t.answer,
    feedback: showTurnJudgement ? t.feedback : undefined,
    score: showTurnJudgement && t.evalStatus !== "failed" ? t.score : undefined,
    verdict: showTurnJudgement && t.evalStatus !== "failed" ? t.verdict : undefined,
    criteria: showTurnJudgement && t.evalStatus !== "failed" ? t.criteria : undefined,
    improvementTip: showTurnJudgement && t.evalStatus !== "failed" ? t.improvementTip : undefined,
    estimated: showTurnJudgement && t.evalStatus === "estimated" ? true : undefined,
    unanswered: t.unanswered || undefined,
    stage: t.stage,
    round: questionRound(t.questionNumber, selected),
  }));

  const roundInfo = {
    stage: session.stage,
    track: session.track,
    round: session.stage === "basic" ? 1 : session.stage === "technical" ? 2 : undefined,
  };

  if (isFinished(session.status)) {
    return {
      sessionId: session._id,
      status: session.status,
      ...roundInfo,
      round2Unlocked: session.stage === "basic" ? session.result === "pass" : undefined,
      certificateEligible: session.stage !== "basic" && !isHidden && session.result === "pass",
      score: isHidden ? undefined : session.score,
      result: isHidden ? undefined : session.result,
      feedback: isHidden ? undefined : session.feedback,
      report: isHidden ? undefined : session.report,
      turns: turnsWithRound,
      timedOut: session.timedOut ?? false,
      certificatePaid: session.certificatePayment?.paid ?? false,
      elearningTips: !isHidden && session.result === "fail" ? elearningTipsFor(session) : undefined,
      closingMessage: structured ? CLOSING_MESSAGE : undefined,
    };
  }

  if (session.cancelledAt) {
    return {
      sessionId: session._id,
      status: session.status,
      stage: session.stage,
      track: session.track,
      cancelled: true,
      cancelledAt: session.cancelledAt,
      cancelReason: session.cancelReason,
      totalQuestions: selected?.length,
      turns: turnsWithRound,
    };
  }

  return {
    sessionId: session._id,
    status: session.status,
    stage: session.stage,
    track: session.track,
    questionNumber: session.currentQuestionNumber,
    question: session.currentQuestion,
    kind: (session.currentQuestionNumber && selected?.[session.currentQuestionNumber - 1]?.kind) || "pool",
    totalQuestions: selected?.length,
    ...(structured && selected?.length ? progressFor(selected, session.currentQuestionNumber) : {}),
    round: session.currentQuestionNumber ? questionRound(session.currentQuestionNumber, selected) : undefined,
    turns: turnsWithRound,
    // timer (server clock): the client counts down from remainingSeconds
    startedAt: session.startedAt,
    expiresAt: session.expiresAt,
    timeLimitSeconds: session.startedAt && session.expiresAt
      ? Math.round((session.expiresAt.getTime() - session.startedAt.getTime()) / 1000) : undefined,
    remainingSeconds: session.expiresAt ? Math.max(0, Math.round((session.expiresAt.getTime() - Date.now()) / 1000)) : undefined,
    timeUp: session.expiresAt ? Date.now() >= session.expiresAt.getTime() : undefined,
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
    stage: session.stage,
    track: session.track,
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
