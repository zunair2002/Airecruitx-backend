import { Schema, model, Document, Types } from "mongoose";

export type JobStatus = "open" | "closed";

export interface IJob extends Document {
  hrId: Types.ObjectId;
  title: string;
  description: string;
  requiredSkills: string[];
  status: JobStatus;
  createdAt: Date;
  updatedAt: Date;
}

const jobSchema = new Schema<IJob>(
  {
    hrId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    requiredSkills: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["open", "closed"],
      required: true,
      default: "open",
    },
  },
  { timestamps: true }
);

export const Job = model<IJob>("Job", jobSchema);
