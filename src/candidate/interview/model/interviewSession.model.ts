import { Schema, model, Document, Types } from "mongoose";

export type InterviewStatus = "in_progress" | "completed";
export type InterviewResult = "pass" | "fail";
export type InterviewLevel = "beginner" | "intermediate" | "expert";

export interface ICertificatePayment {
  paid: boolean;
  stripeSessionId?: string;
}

export interface IInterviewMessage {
  role: "user" | "assistant";
  content: string;
}

export type InterviewStage = "basic" | "technical";
export type EvalStatus = "pending" | "done" | "failed";

export interface IInterviewTurn {
  questionNumber: number;
  question: string;
  answer: string;
  feedback: string; // "" until the background evaluation finishes
  score: number; // 0-10, weighted from the criterion scores below (computed by the backend)
  stage?: InterviewStage;
  topic?: string;
  verdict?: string; // model verdict, e.g. correct / partially_correct / strong / weak
  criteria?: Record<string, number>; // per-criterion 0-10 scores from the model
  improvementTip?: string;
  weakTopics?: string[];
  evalStatus?: EvalStatus;
  // Only set for structured (HR question-set) org-interview turns — the raw marks
  // behind the normalized `score` above, for HR's exact grading view. Never surfaced
  // to the candidate (buildSessionView's turn projection omits these fields).
  marksEarned?: number;
  marksPossible?: number;
}

// "candidate": practice sessions and the auto-triggered AI interview — the
// candidate can see their own feedback/score.
// "hidden": HR-scheduled organizational interviews — results are for HR's eyes
// only; the candidate can answer questions but never sees feedback/score/result.
export type InterviewVisibility = "candidate" | "hidden";

// A single question snapshotted onto a session at start time — this candidate's own
// random draw + shuffle from the job's question pool, frozen so it's unaffected by
// later pool edits and independent of every other candidate's draw.
export interface ISelectedQuestion {
  question: string;
  // HR question-set fields (structured org interviews)
  referenceAnswer?: string;
  marks?: number;
  // AI interview fields
  stage?: InterviewStage;
  topic?: string;
  keyPoints?: string[]; // what a good answer contains — sent to the evaluator, never to the candidate
  source?: "model" | "bank" | "hr";
}

// Final report: numbers + decision computed by the backend, narrative written by the model
// (or by the deterministic fallback when the model is unavailable).
export interface IInterviewReport {
  reportType: "candidate" | "hr";
  basicScore?: number; // 0-10
  technicalScore?: number; // 0-10
  overallScore: number; // 0-10 (session.score = overallScore * 10)
  decision: string; // candidate: pass | needs_improvement ; hr: shortlist | hold | reject
  summary: string;
  strengths: string[];
  areasToImprove?: string[];
  learningPlan?: string[];
  concerns?: string[];
  recommendation?: string;
  weakTopics: string[];
  generatedBy: "model" | "fallback";
}

export interface IInterviewSession extends Document {
  userId: Types.ObjectId;
  applicationId?: Types.ObjectId;
  level?: InterviewLevel; // practice-mode difficulty; unset for HR-scheduled real interviews
  role?: string; // job title (or "Software Engineer" for practice) — used in prompts
  // Set only for an org interview graded against an HR-authored question set
  // (see OrgInterviewQuestionSet) — its presence is what routes submitAnswer to the
  // HR question set instead of AI-generated questions. Traceability only —
  // the actual walk-through uses selectedQuestions below, not a live lookup into the
  // (possibly since-edited) shared pool.
  questionSetId?: Types.ObjectId;
  // This session's own randomly-drawn, shuffled subset of the question pool — each
  // concurrent candidate gets an independent draw, so simultaneous interviews don't
  // ask the same questions in the same order.
  selectedQuestions?: ISelectedQuestion[];
  visibility: InterviewVisibility;
  status: InterviewStatus;
  messages: IInterviewMessage[];
  turns: IInterviewTurn[];
  currentQuestionNumber?: number;
  currentQuestion?: string;
  score?: number; // overall, 0-100
  result?: InterviewResult;
  feedback?: string;
  report?: IInterviewReport;
  certificatePayment: ICertificatePayment;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IInterviewMessage>(
  {
    role: { type: String, enum: ["user", "assistant"], required: true },
    content: { type: String, required: true },
  },
  { _id: false }
);

const turnSchema = new Schema<IInterviewTurn>(
  {
    questionNumber: { type: Number, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
    feedback: { type: String, default: "" },
    score: { type: Number, default: 0 },
    stage: { type: String, enum: ["basic", "technical"], required: false },
    topic: { type: String, required: false },
    verdict: { type: String, required: false },
    criteria: { type: Schema.Types.Mixed, required: false },
    improvementTip: { type: String, required: false },
    weakTopics: { type: [String], default: undefined },
    evalStatus: { type: String, enum: ["pending", "done", "failed"], required: false },
    marksEarned: { type: Number, required: false },
    marksPossible: { type: Number, required: false },
  },
  { _id: false }
);

const selectedQuestionSchema = new Schema<ISelectedQuestion>(
  {
    question: { type: String, required: true },
    referenceAnswer: { type: String, required: false },
    marks: { type: Number, required: false },
    stage: { type: String, enum: ["basic", "technical"], required: false },
    topic: { type: String, required: false },
    keyPoints: { type: [String], default: undefined },
    source: { type: String, enum: ["model", "bank", "hr"], required: false },
  },
  { _id: false }
);

const reportSchema = new Schema<IInterviewReport>(
  {
    reportType: { type: String, enum: ["candidate", "hr"], required: true },
    basicScore: { type: Number, required: false },
    technicalScore: { type: Number, required: false },
    overallScore: { type: Number, required: true },
    decision: { type: String, required: true },
    summary: { type: String, default: "" },
    strengths: { type: [String], default: [] },
    areasToImprove: { type: [String], default: undefined },
    learningPlan: { type: [String], default: undefined },
    concerns: { type: [String], default: undefined },
    recommendation: { type: String, required: false },
    weakTopics: { type: [String], default: [] },
    generatedBy: { type: String, enum: ["model", "fallback"], required: true },
  },
  { _id: false }
);

const certificatePaymentSchema = new Schema<ICertificatePayment>(
  {
    paid: { type: Boolean, required: true, default: false },
    stripeSessionId: { type: String, required: false },
  },
  { _id: false }
);

const interviewSessionSchema = new Schema<IInterviewSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "Application",
      required: false,
    },
    level: {
      type: String,
      enum: ["beginner", "intermediate", "expert"],
      required: false,
    },
    role: { type: String, required: false },
    questionSetId: {
      type: Schema.Types.ObjectId,
      ref: "OrgInterviewQuestionSet",
      required: false,
    },
    selectedQuestions: {
      type: [selectedQuestionSchema],
      required: false,
    },
    visibility: {
      type: String,
      enum: ["candidate", "hidden"],
      required: true,
      default: "candidate",
    },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      required: true,
      default: "in_progress",
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    turns: {
      type: [turnSchema],
      default: [],
    },
    currentQuestionNumber: { type: Number, required: false },
    currentQuestion: { type: String, required: false },
    score: { type: Number, required: false },
    result: { type: String, enum: ["pass", "fail"], required: false },
    feedback: { type: String, required: false },
    report: { type: reportSchema, required: false },
    certificatePayment: {
      type: certificatePaymentSchema,
      default: () => ({ paid: false }),
    },
  },
  { timestamps: true }
);

export const InterviewSession = model<IInterviewSession>(
  "InterviewSession",
  interviewSessionSchema
);
