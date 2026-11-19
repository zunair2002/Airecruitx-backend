import { Schema, model, Document, Types } from "mongoose";
import bcrypt from "bcrypt";

export type UserRole = "candidate" | "hr" | "admin";
export type AuthProvider = "password" | "google";
export type UserPlan = "free" | "premium";
export const USER_PLANS: UserPlan[] = ["free", "premium"];

export interface IUser extends Document {
  firebaseUid?: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  orgId?: Types.ObjectId;
  authProvider: AuthProvider;
  avatarUrl?: string;
  isActive: boolean;
  // Candidate subscription tier: gates premium courses and the daily practice-interview limit.
  plan: UserPlan;
  // Start times of brand-new practice sessions, kept apart from the sessions themselves
  // (which get deleted when replaced) so the daily allowance can't be reset by
  // abandoning a session. Capped to the most recent entries; see practiceUsage.service.ts.
  practiceStarts?: Date[];
  // Google accounts are verified by Google itself (true from creation). Password
  // accounts start false and must confirm ownership of the email via OTP before they
  // can log in — see auth.service.ts's verifyEmail/resendOtp.
  emailVerified: boolean;
  emailOtp?: string;
  emailOtpExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidate: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>(
  {
    firebaseUid: {
      type: String,
      required: false, 
      unique: false,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: false, 
      select: false, 
    },
    role: {
      type: String,
      enum: ["candidate", "hr", "admin"],
      required: true,
      default: "candidate",
    },
    orgId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: false,
    },
    authProvider: {
      type: String,
      enum: ["password", "google"],
      required: true,
      default: "password",
    },
    avatarUrl: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    plan: {
      type: String,
      enum: USER_PLANS,
      required: true,
      default: "free",
    },
    practiceStarts: {
      type: [Date],
      default: undefined,
      select: false,
    },
    emailVerified: {
      type: Boolean,
      required: true,
      default: false,
    },
    emailOtp: {
      type: String,
      required: false,
      select: false,
    },
    emailOtpExpiresAt: {
      type: Date,
      required: false,
      select: false,
    },
  },
  { timestamps: true }
);

userSchema.index(
  { firebaseUid: 1 },
  {
    unique: true,
    partialFilterExpression: { firebaseUid: { $type: "string" } },
  }
);

// Only hash the password when it is set/changed, and only for the "password" auth flow.
// Google-authenticated users never have a password, so this simply skips them.
userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

export const User = model<IUser>("User", userSchema);