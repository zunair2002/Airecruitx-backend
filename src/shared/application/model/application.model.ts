import { Schema, model, Document, Types } from "mongoose";

export type ApplicationStatus = "pending" | "selected" | "rejected";

// No fixed date/time — HR invites the candidate with a unique link valid for a
// configurable window; the candidate takes the (AI-conducted) interview whenever they
// like within that window. "invited" -> "completed" (finished in time) or "expired"
// (window passed before they finished) are the only transitions; there's no separate
// "scheduled" state since the invite itself is immediately usable.
export type OrgInterviewStatus = "invited" | "completed" | "expired";

export interface IOrgInterview {
  status?: OrgInterviewStatus;
  token?: string;
  expiresAt?: Date;
  invitedAt?: Date;
  completedAt?: Date;
  notes?: string;
  // "Add to Calendar" link for the validity window (an all-day range, not a fixed
  // slot, since the candidate can take the interview any time within it).
  calendarLink?: string;
}

export interface IAiInterview {
  scheduled: boolean;
  dateTime?: Date;
  message?: string;
  calendarLink?: string;
}

export interface IApplication extends Document {
  jobId: Types.ObjectId;
  candidateId: Types.ObjectId;
  resumeSnapshotSkills: string[];
  matchScore: number;
  matched: boolean;
  status: ApplicationStatus;
  interviewSessionId?: Types.ObjectId;
  // Separate from interviewSessionId (the candidate-visible AI interview) since an
  // organizational interview's session is HR-only visibility, per InterviewVisibility.
  orgInterviewSessionId?: Types.ObjectId;
  aiInterview: IAiInterview;
  orgInterview: IOrgInterview;
  createdAt: Date;
  updatedAt: Date;
}

const orgInterviewSchema = new Schema<IOrgInterview>(
  {
    status: { type: String, enum: ["invited", "completed", "expired"], required: false },
    token: { type: String, required: false },
    expiresAt: { type: Date, required: false },
    invitedAt: { type: Date, required: false },
    completedAt: { type: Date, required: false },
    notes: { type: String, required: false },
    calendarLink: { type: String, required: false },
  },
  { _id: false }
);

const aiInterviewSchema = new Schema<IAiInterview>(
  {
    scheduled: { type: Boolean, required: true, default: false },
    dateTime: { type: Date, required: false },
    message: { type: String, required: false },
    calendarLink: { type: String, required: false },
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
    orgInterviewSessionId: {
      type: Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: false,
    },
    aiInterview: {
      type: aiInterviewSchema,
      default: () => ({ scheduled: false }),
    },
    orgInterview: {
      type: orgInterviewSchema,
      default: () => ({}),
    },
  },
  { timestamps: true }
);

// One application per candidate per job.
applicationSchema.index({ jobId: 1, candidateId: 1 }, { unique: true });
// Fast, collision-safe lookup for the public token-based org-interview link.
// Sparse so the many applications with no invite yet (token undefined) don't conflict.
applicationSchema.index({ "orgInterview.token": 1 }, { unique: true, sparse: true });

export const Application = model<IApplication>("Application", applicationSchema);
