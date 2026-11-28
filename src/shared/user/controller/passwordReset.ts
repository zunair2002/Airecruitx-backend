import { createHash, createHmac, randomBytes, randomInt } from "crypto";
import bcrypt from "bcrypt";
import { User } from "../model/user.model";
import { deliverCode } from "../../email/email.service";
import { asyncHandler } from "../../../utils/asyncHandler";
import { AppError } from "../../../utils/AppError";

const lifetime = 10 * 60_000;
const eligible = { authProvider: "password", isActive: true, emailVerified: true };
const invalid = () => new AppError("Invalid or expired reset credentials. Request a new code.", 400);
function emailOf(value: unknown) {
  if (typeof value !== "string" || !/^\S+@\S+\.\S+$/.test(value.trim())) throw new AppError("Enter a valid email.", 400);
  return value.trim().toLowerCase();
}
function codeHash(email: string, code: string) {
  if (!process.env.JWT_SECRET) throw new AppError("Password recovery is unavailable.", 503);
  return createHmac("sha256", process.env.JWT_SECRET).update(`reset:${email}:${code}`).digest("hex");
}
const grantHash = (token: string) => createHash("sha256").update(token).digest("hex");

export const requestReset = asyncHandler(async (req, res) => {
  const email = emailOf(req.body?.email);
  const code = String(randomInt(100000, 1000000));
  const digest = codeHash(email, code);
  const now = Date.now();
  const issued = await User.updateOne({
    email, ...eligible, $or: [{ resetRequestedAt: { $exists: false } }, { resetRequestedAt: { $lte: new Date(now - 60_000) } }],
  }, {
    $set: { resetCodeHash: digest, resetRequestedAt: new Date(now), resetExpiresAt: new Date(now + lifetime), resetAttempts: 0 },
    $unset: { resetGrantHash: 1 },
  });
  if (issued.modifiedCount) {
    try {
      await deliverCode(email, "Reset your Airecruitx password", code, "forgot-password");
    } catch {
      await User.updateOne({ email, resetCodeHash: digest }, { $unset: { resetCodeHash: 1, resetRequestedAt: 1 } });
    }
  } else {
    console.info("[otp] SMTP not submitted", { flow: "forgot-password", elapsedMs: Date.now() - now });
  }
  res.json({ success: true, data: { message: "If your account is eligible, a reset code will be sent." } });
});

export const verifyReset = asyncHandler(async (req, res) => {
  const email = emailOf(req.body?.email);
  const otp = req.body?.otp;
  if (typeof otp !== "string" || !/^\d{6}$/.test(otp)) throw invalid();
  const digest = codeHash(email, otp);
  const filter = { email, ...eligible, resetExpiresAt: { $gt: new Date() }, resetAttempts: { $lt: 5 } };
  const token = randomBytes(32).toString("hex");
  const verified = await User.updateOne({ ...filter, resetCodeHash: digest }, {
    $set: { resetGrantHash: grantHash(token), resetExpiresAt: new Date(Date.now() + lifetime) },
    $unset: { resetCodeHash: 1 },
  });
  if (!verified.modifiedCount) {
    await User.updateOne({ ...filter, resetCodeHash: { $exists: true, $ne: digest } }, { $inc: { resetAttempts: 1 } });
    throw invalid();
  }
  res.json({ success: true, data: { resetToken: token } });
});

export const completeReset = asyncHandler(async (req, res) => {
  const email = emailOf(req.body?.email);
  const { resetToken, password } = req.body;
  if (typeof resetToken !== "string" || !/^[a-f0-9]{64}$/.test(resetToken)) throw invalid();
  if (typeof password !== "string" || password.length < 6 || Buffer.byteLength(password) > 72)
    throw new AppError("Use at least 6 characters and at most 72 bytes for your password.", 400);
  const filter = { email, ...eligible, resetGrantHash: grantHash(resetToken) };
  if (!await User.exists({ ...filter, resetExpiresAt: { $gt: new Date() } })) throw invalid();
  const hash = await bcrypt.hash(password, 10);
  const changed = await User.updateOne({ ...filter, resetExpiresAt: { $gt: new Date() } }, {
    $set: { password: hash },
    $inc: { sessionVersion: 1 },
    $unset: { resetGrantHash: 1, resetCodeHash: 1, resetRequestedAt: 1, resetExpiresAt: 1, resetAttempts: 1 },
  });
  if (!changed.modifiedCount) throw invalid();
  res.json({ success: true, data: { message: "Password updated. Sign in with your new password." } });
});
