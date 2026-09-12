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

export interface IInterviewTurn {
  questionNumber: number;
  question: string;
  answer: string;
  feedback: string;
  score: number; // out of 10 (normalized), as scored live by the model
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
  referenceAnswer: string;
  marks: number;
}

export interface IInterviewSession extends Document {
  userId: Types.ObjectId;
  applicationId?: Types.ObjectId;
  level?: InterviewLevel; // practice-mode difficulty; unset for HR-scheduled real interviews
  // Set only for an org interview graded against an HR-authored question set
  // (see OrgInterviewQuestionSet) — its presence is what routes submitAnswer to the
  // structured evaluator instead of the free-form Ollama Q&A loop. Traceability only —
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
    feedback: { type: String, required: true },
    score: { type: Number, required: true },
    marksEarned: { type: Number, required: false },
    marksPossible: { type: Number, required: false },
  },
  { _id: false }
);

const selectedQuestionSchema = new Schema<ISelectedQuestion>(
  {
    question: { type: String, required: true },
    referenceAnswer: { type: String, required: true },
    marks: { type: Number, required: true },
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
