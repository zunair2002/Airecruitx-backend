import { Schema, model, Document, Types } from "mongoose";

export type ResumeStatus = "parsed" | "failed";

// The extracted text and detected skills are deliberately NOT stored here — they'd
// duplicate the source of truth (the file itself, on Cloudinary via fileUrl) and can
// run to several KB of near-duplicate text per resume for no lasting benefit. Any
// code that needs the resume's text (e.g. job-match scoring) re-extracts it from
// Cloudinary on demand — see application.service.ts's applyToJob. mimeType is kept so
// that re-extraction knows which parser (PDF vs DOCX) to use without re-sniffing.
export interface IResume extends Document {
  userId: Types.ObjectId;
  fileUrl: string;
  mimeType: string;
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
    mimeType: {
      type: String,
      required: true,
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
