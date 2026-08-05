import { Schema, model, Document, Types } from "mongoose";

export interface ICertificate extends Document {
  userId: Types.ObjectId;
  sessionId: Types.ObjectId;
  score: number;
  certId: string;
  fileUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

const certificateSchema = new Schema<ICertificate>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "InterviewSession",
      required: true,
      unique: true, // one certificate per completed interview session
    },
    score: {
      type: Number,
      required: true,
    },
    certId: {
      type: String,
      required: true,
      unique: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

export const Certificate = model<ICertificate>("Certificate", certificateSchema);
