import { Schema, model, Document } from "mongoose";

export interface ISettings extends Document<string> {
  siteName: string;
  matchThreshold: number;
  allowSignups: boolean;
  maxResumeSizeMB: number;
  createdAt: Date;
  updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
  {
    _id: {
      type: String,
      required: true,
    },
    siteName: {
      type: String,
      required: true,
      default: "Airecruitx",
    },
    matchThreshold: {
      type: Number,
      required: true,
      default: 50,
    },
    allowSignups: {
      type: Boolean,
      required: true,
      default: true,
    },
    maxResumeSizeMB: {
      type: Number,
      required: true,
      default: 5,
    },
  },
  { timestamps: true }
);

export const Settings = model<ISettings>("Settings", settingsSchema);
