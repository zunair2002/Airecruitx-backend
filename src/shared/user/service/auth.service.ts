import jwt from "jsonwebtoken";
import { firebaseAuth } from "../../../config/firebase";
import { User, IUser, UserRole } from "../model/user.model";
import { AppError } from "../../../utils/AppError";
import { sendOtpEmail } from "../../email/email.service";

interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}

interface LoginInput {
  email: string;
  password: string;
}

const generateToken = (userId: string) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new AppError("JWT_SECRET is not defined in the environment", 500);
  }
  return jwt.sign({ id: userId }, secret, {
    expiresIn: "1d", // Token expires in 1 day
  });
};

const OTP_VALIDITY_MS = 10 * 60 * 1000; // 10 minutes

const generateOtp = (): string => String(Math.floor(100000 + Math.random() * 900000));

// Best-effort: a bounced/slow OTP email shouldn't turn into a 500 for the candidate —
// the OTP is already saved, so resendOtp covers the case where the first email never
// arrives.
const sendOtpBestEffort = async (user: IUser, otp: string) => {
  try {
    await sendOtpEmail(user.email, user.name, otp);
  } catch (error) {
    console.error(`[auth] Failed to send OTP email to ${user.email}:`, error);
  }
};

// Creates the account but does NOT log the candidate in — password-based signups must
// verify ownership of the email (via the OTP just sent) before they get a session; see
// verifyEmail below, which is where the token is actually issued. Google accounts skip
// all of this (see googleLogin) since Google has already verified the email.
//
// The OTP is returned here (not just emailed) so the controller can echo it back in
// non-production environments — purely a local-dev convenience for when the SMTP
// account is unreachable/rate-limited (e.g. Gmail's daily send cap), so testing the
// signup flow never has to block on that. Never exposed when NODE_ENV=production.
export const signup = async (input: SignupInput): Promise<{ user: IUser; otp: string }> => {
  const { name, email, password, role } = input;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new AppError("Email already registered", 409);
  }

  const otp = generateOtp();

  // Password is hashed automatically by the pre-save hook on the User model.
  const user = await User.create({
    name,
    email,
    password,
    role,
    authProvider: "password",
    emailVerified: false,
    emailOtp: otp,
    emailOtpExpiresAt: new Date(Date.now() + OTP_VALIDITY_MS),
  });

  await sendOtpBestEffort(user, otp);

  user.password = undefined;
  user.emailOtp = undefined;
  return { user, otp };
};

export const verifyEmail = async (
  email: string,
  otp: string
): Promise<{ token: string; user: IUser }> => {
  const user = await User.findOne({ email: email.toLowerCase() }).select("+emailOtp +emailOtpExpiresAt");
  if (!user) {
    throw new AppError("Invalid email or code", 400);
  }
  if (user.emailVerified) {
    throw new AppError("Email is already verified", 409);
  }
  if (!user.emailOtp || !user.emailOtpExpiresAt || user.emailOtpExpiresAt.getTime() < Date.now()) {
    throw new AppError("Code has expired. Request a new one.", 410);
  }
  if (user.emailOtp !== otp) {
    throw new AppError("Invalid email or code", 400);
  }

  user.emailVerified = true;
  user.emailOtp = undefined;
  user.emailOtpExpiresAt = undefined;
  await user.save();

  const token = generateToken(user._id.toString());
  return { token, user };
};

export const resendOtp = async (email: string): Promise<{ otp: string }> => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new AppError("Invalid email or code", 400);
  }
  if (user.emailVerified) {
    throw new AppError("Email is already verified", 409);
  }

  const otp = generateOtp();
  user.emailOtp = otp;
  user.emailOtpExpiresAt = new Date(Date.now() + OTP_VALIDITY_MS);
  await user.save();

  await sendOtpBestEffort(user, otp);
  return { otp };
};

export const login = async (
  input: LoginInput
): Promise<{ token: string; user: IUser }> => {
  const { email, password } = input;

  // Find the user and explicitly select the password field (it's select:false by default)
  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+password"
  );

  if (!user || !user.password) {
    // No user, or user signed up via Google and has no password to compare against
    throw new AppError("Invalid email or password", 401);
  }
  if (!user.isActive) {
    throw new AppError("Account is deactivated", 403);
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError("Invalid email or password", 401);
  }
  if (!user.emailVerified) {
    throw new AppError("Please verify your email before logging in", 403);
  }

  const token = generateToken(user._id.toString());

  user.password = undefined;
  return { token, user };
};

export const googleLogin = async (
  idToken: string,
  role: UserRole = "candidate"
): Promise<{ token: string; user: IUser }> => {
  let decoded;
  try {
    decoded = await firebaseAuth.verifyIdToken(idToken);
  } catch (error) {
    throw new AppError("Invalid or expired Google ID token", 401);
  }

  if (!decoded.email) {
    throw new AppError("Google account has no email", 400);
  }

  const existing = await User.findOne({ email: decoded.email.toLowerCase() });

  if (existing) {
    if (existing.authProvider !== "google") {
      throw new AppError(
        "This email is already registered with a password. Please log in manually.",
        409
      );
    }
    if (!existing.isActive) {
      throw new AppError("Account is deactivated", 403);
    }
    // Existing Google user: no password involved, just issue our own session token.
    const token = generateToken(existing._id.toString());
    return { token, user: existing };
  }

  // New Google user: no password field is ever set, matching the schema's optional
  // password. Google has already verified this email, so no OTP step is needed.
  const newUser = await User.create({
    firebaseUid: decoded.uid,
    name: decoded.name || decoded.email.split("@")[0],
    email: decoded.email,
    role,
    authProvider: "google",
    avatarUrl: decoded.picture,
    emailVerified: true,
  });

  const token = generateToken(newUser._id.toString());
  return { token, user: newUser };
};

export const getProfile = async (userId: string): Promise<IUser> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new AppError("User profile not found", 404);
  }
  return user;
};
