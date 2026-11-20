import { Document, model, Schema, Types } from "mongoose";

export interface ICourse extends Document {
  title: string;
  description: string;
  videoUrl: string;
  topics: string[];
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    videoUrl: { type: String, required: true, trim: true },
    topics: { type: [String], required: true, validate: [(topics: string[]) => topics.length > 0, "At least one topic is required"] },
    isActive: { type: Boolean, default: true, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  },
  { timestamps: true }
);

courseSchema.index({ isActive: 1, topics: 1 });

export const Course = model<ICourse>("Course", courseSchema);
