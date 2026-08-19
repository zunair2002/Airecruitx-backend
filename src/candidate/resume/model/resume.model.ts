import { Schema, model, Document, Types } from "mongoose";

export type ResumeStatus = "parsed" | "failed";

export interface IResume extends Document {
  userId: Types.ObjectId;
  fileUrl: string;
  rawText: string;
  skills: string[];
  status: ResumeStatus;
  createdAt: Date;
  updatedAt: Date;
}

const resumeSchema = new Schema<IResume>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one resume per user — new uploads overwrite the old one
      index: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    rawText: {
      type: String,
      required: false,
      default: "",
    },
    skills: {
      type: [String],
      default: [],
    },
    status: {
      type: String,
      enum: ["parsed", "failed"],
      required: true,
      default: "parsed",
    },
  },
  { timestamps: true }
);

export const Resume = model<IResume>("Resume", resumeSchema);
