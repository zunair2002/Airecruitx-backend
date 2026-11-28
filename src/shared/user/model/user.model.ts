import { Schema, model, Document, Types } from "mongoose";
import bcrypt from "bcrypt";

export type UserRole = "candidate" | "hr" | "admin";
export type AuthProvider = "password" | "google";
export type UserPlan = "free" | "premium";
export const USER_PLANS: UserPlan[] = ["free", "premium"];
export type PlanSource = "stripe" | "admin";

// Premium bought through Stripe Billing (kept in sync by the billing webhook and the
// post-checkout confirm call). Stripe stays the source of truth for the subscription itself.
export interface IUserSubscription {
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status?: string; // Stripe subscription status: active, trialing, past_due, canceled, ...
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  updatedAt?: Date;
}

export interface IUser extends Document {
  firebaseUid?: string;
  name: string;
  email: string;
  password?: string;
  role: UserRole;
  orgId?: Types.ObjectId;
  authProvider: AuthProvider;
  avatarUrl?: string;
  avatarPublicId?: string;
  headline?: string;
  about?: string;
  interests: string[];
  isActive: boolean;
  // Candidate subscription tier: gates premium courses and the daily practice-interview limit.
  plan: UserPlan;
  // When premium ends (Stripe: end of the paid period; admin grant: optional end date).
  // Unset means no end date. Read the plan through effectivePlan() so a lapsed date counts as free.
  planExpiresAt?: Date;
  planSource?: PlanSource;
  subscription?: IUserSubscription;
  // Start times of brand-new practice sessions, kept apart from the sessions themselves
  // (which get deleted when replaced) so the daily allowance can't be reset by
  // abandoning a session. Capped to the most recent entries; see practiceUsage.service.ts.
  practiceStarts?: Date[];
  // Google accounts are verified by Google itself (true from creation). Password
  // accounts start false and must confirm ownership of the email via OTP before they
  // can log in — see auth.service.ts's verifyEmail/resendOtp.
  emailVerified: boolean;
  sessionVersion?: number;
  resetCodeHash?: string;
  resetGrantHash?: string;
  resetExpiresAt?: Date;
  resetRequestedAt?: Date;
  resetAttempts?: number;
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
    avatarPublicId: {
      type: String,
      required: false,
      select: false,
    },
    headline: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },
    about: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    interests: {
      type: [String],
      default: [],
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
    planExpiresAt: { type: Date, required: false },
    planSource: { type: String, enum: ["stripe", "admin"], required: false },
    subscription: {
      type: new Schema<IUserSubscription>(
        {
          stripeCustomerId: { type: String },
          stripeSubscriptionId: { type: String },
          status: { type: String },
          currentPeriodEnd: { type: Date },
          cancelAtPeriodEnd: { type: Boolean },
          updatedAt: { type: Date },
        },
        { _id: false }
      ),
      required: false,
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
    sessionVersion: { type: Number, default: 0 },
    resetCodeHash: { type: String, select: false },
    resetGrantHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    resetRequestedAt: { type: Date, select: false },
    resetAttempts: { type: Number, select: false },
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

// Billing webhooks look a user up by their Stripe customer / subscription id.
userSchema.index({ "subscription.stripeCustomerId": 1 }, { sparse: true });
userSchema.index({ "subscription.stripeSubscriptionId": 1 }, { sparse: true });
// Hourly sweep for premium plans whose end date has passed (config/planExpiryScheduler.ts).
userSchema.index({ plan: 1, planExpiresAt: 1 });

export const User = model<IUser>("User", userSchema);

/** The plan in force right now: premium only while planExpiresAt (if any) is in the future. */
export const effectivePlan = (user: Pick<IUser, "plan" | "planExpiresAt"> | null | undefined): UserPlan => {
  if (user?.plan !== "premium") return "free";
  if (user.planExpiresAt && new Date(user.planExpiresAt).getTime() <= Date.now()) return "free";
  return "premium";
};
