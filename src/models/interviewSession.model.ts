import { Schema, model, Document, Types } from "mongoose";

export type InterviewStatus = "round1" | "round2" | "completed";
export type InterviewResult = "pass" | "fail";

export interface IInterviewAnswer {
  round: 1 | 2;
  questionIndex: number;
  question: string;
  answer: string;
}

export interface IInterviewSession extends Document {
  userId: Types.ObjectId;
  status: InterviewStatus;
  answers: IInterviewAnswer[];
  score?: number;
  result?: InterviewResult;
  feedback?: string;
  createdAt: Date;
  updatedAt: Date;
}

const answerSchema = new Schema<IInterviewAnswer>(
  {
    round: { type: Number, enum: [1, 2], required: true },
    questionIndex: { type: Number, required: true },
    question: { type: String, required: true },
    answer: { type: String, required: true },
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
    status: {
      type: String,
      enum: ["round1", "round2", "completed"],
      required: true,
      default: "round1",
    },
    answers: {
      type: [answerSchema],
      default: [],
    },
    score: { type: Number, required: false },
    result: { type: String, enum: ["pass", "fail"], required: false },
    feedback: { type: String, required: false },
  },
  { timestamps: true }
);

export const InterviewSession = model<IInterviewSession>(
  "InterviewSession",
  interviewSessionSchema
);
