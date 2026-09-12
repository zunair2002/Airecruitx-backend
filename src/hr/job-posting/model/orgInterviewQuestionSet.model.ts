import { Schema, model, Document, Types } from "mongoose";

// HR-authored question bank for a job's organizational interview: fixed questions
// asked in order, each graded against its own reference answer — as opposed to the
// practice/AI-interview flow, where the fine-tuned Ollama model freely invents both
// the questions and the grading criteria. referenceAnswer is never sent to the
// candidate at any point (see interview.service.ts's buildSessionView).
export interface IOrgInterviewQuestion {
  question: string;
  referenceAnswer: string;
  marks: number;
}

export interface IOrgInterviewQuestionSet extends Document {
  jobId: Types.ObjectId;
  hrId: Types.ObjectId;
  questions: IOrgInterviewQuestion[];
  // How many questions each candidate is actually asked, randomly drawn from the pool
  // above and shuffled per-candidate — e.g. a 20-question pool with this set to 10
  // means every candidate gets a different random 10, in a different order, so
  // candidates interviewing at the same time can't just compare notes.
  // Unset/0 means "ask the whole pool".
  questionsPerInterview?: number;
  createdAt: Date;
  updatedAt: Date;
}

const questionSchema = new Schema<IOrgInterviewQuestion>(
  {
    question: { type: String, required: true },
    referenceAnswer: { type: String, required: true },
    marks: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const orgInterviewQuestionSetSchema = new Schema<IOrgInterviewQuestionSet>(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      unique: true, // one question set per job — HR replaces it wholesale, doesn't append
      index: true,
    },
    hrId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    questions: {
      type: [questionSchema],
      required: true,
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
        message: "questions must be a non-empty array",
      },
    },
    questionsPerInterview: { type: Number, required: false, min: 1 },
  },
  { timestamps: true }
);

export const OrgInterviewQuestionSet = model<IOrgInterviewQuestionSet>(
  "OrgInterviewQuestionSet",
  orgInterviewQuestionSetSchema
);
