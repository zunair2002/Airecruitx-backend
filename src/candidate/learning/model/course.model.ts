import { Schema, model, Document, Types } from "mongoose";

export type CourseTier = "free" | "premium";
export const COURSE_TIERS: CourseTier[] = ["free", "premium"];

// An HR-authored learning video. Premium courses are only playable by candidates on the
// premium plan; free-plan candidates see them as locked (no videoUrl).
export interface ICourse extends Document {
  title: string;
  description: string;
  videoUrl: string;
  topics: string[];
  tier: CourseTier;
  isActive: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const courseSchema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    videoUrl: { type: String, required: true, trim: true },
    topics: { type: [String], default: [] },
    tier: { type: String, enum: COURSE_TIERS, required: true, default: "free" },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

courseSchema.index({ isActive: 1, createdAt: -1 });

export const Course = model<ICourse>("Course", courseSchema);
