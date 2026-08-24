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
  score: number; // out of 10, as scored live by the model
}

export interface IInterviewSession extends Document {
  userId: Types.ObjectId;
  applicationId?: Types.ObjectId;
  level?: InterviewLevel; // practice-mode difficulty; unset for HR-scheduled real interviews
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
