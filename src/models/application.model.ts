import { Schema, model, Document, Types } from "mongoose";

export type ApplicationStatus = "pending" | "selected" | "rejected";

export interface IOrgInterview {
  scheduled: boolean;
  dateTime?: Date;
  location?: string;
  notes?: string;
}

export interface IApplication extends Document {
  jobId: Types.ObjectId;
  candidateId: Types.ObjectId;
  resumeSnapshotSkills: string[];
  matchScore: number;
  matched: boolean;
  status: ApplicationStatus;
  interviewSessionId?: Types.ObjectId;
  orgInterview: IOrgInterview;
  createdAt: Date;
  updatedAt: Date;
}

const orgInterviewSchema = new Schema<IOrgInterview>(
  {
    scheduled: { type: Boolean, required: true, default: false },
    dateTime: { type: Date, required: false },
    location: { type: String, required: false },
    notes: { type: String, required: false },
  },
  { _id: false }
);

const applicationSchema = new Schema<IApplication>(
  {
    jobId: {
      type: Schema.Types.ObjectId,
      ref: "Job",
      required: true,
      index: true,
    },
    candidateId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    resumeSnapshotSkills: {
      type: [String],
      default: [],
    },
    matchScore: {
      type: Number,
      required: true,
      default: 0,
    },
    matched: {
      type: Boolean,
      required: true,
      default: false,
    },
    status: {
      type: String,
      enum: ["pending", "selected", "rejected"],
      required: true,
      default: "pending",
    },
    interviewSessionId: {
      type: Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: false,
    },
    orgInterview: {
      type: orgInterviewSchema,
      default: () => ({ scheduled: false }),
    },
  },
  { timestamps: true }
);

// One application per candidate per job.
applicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });

export const Application = model<IApplication>("Application", applicationSchema);
