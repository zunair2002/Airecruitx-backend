import { createHash } from "crypto";
import { Request } from "express";
import { incrementRateLimit } from "../config/redis";
import { asyncHandler } from "../utils/asyncHandler";

type Identifier = "ip" | "email";

type LimitRule = {
  name: string;
  identifier: Identifier;
  limit: number;
  windowMs: number;
};

const identifierValue = (req: Request, identifier: Identifier): string | null => {
  if (identifier === "ip") {
    return req.ip || req.socket.remoteAddress || null;
  }
  const email = req.body?.email;
  return typeof email === "string" && email.trim()
    ? email.trim().toLowerCase()
    : null;
};

const keyFor = (rule: LimitRule, value: string): string => {
  const digest = createHash("sha256").update(value).digest("hex");
  return `auth:rate-limit:${rule.name}:${digest}`;
};

/** Applies shared IP and/or account limits and responds with HTTP 429 on excess. */
export const authRateLimit = (...rules: LimitRule[]) =>
  asyncHandler(async (req, res, next) => {
    const counters = await Promise.all(
      rules.flatMap((rule) => {
        const value = identifierValue(req, rule.identifier);
        return value
          ? [
              incrementRateLimit(
                keyFor(rule, value),
                rule.limit,
                rule.windowMs,
              ),
            ]
          : [];
      }),
    );
    const blocked = counters.filter((counter) => !counter.allowed);
    if (blocked.length > 0) {
      const retryAfterSeconds = Math.max(
        ...blocked.map((counter) => counter.retryAfterSeconds),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        success: false,
        message: `Too many requests. Please try again in ${retryAfterSeconds} seconds.`,
      });
      return;
    }
    next();
  });

const MINUTE = 60_000;

export const signupRateLimit = authRateLimit(
  { name: "signup:ip", identifier: "ip", limit: 10, windowMs: 15 * MINUTE },
  { name: "signup:email", identifier: "email", limit: 3, windowMs: 60 * MINUTE },
);

export const loginRateLimit = authRateLimit(
  { name: "login:ip", identifier: "ip", limit: 60, windowMs: 15 * MINUTE },
  { name: "login:email", identifier: "email", limit: 10, windowMs: 15 * MINUTE },
);

export const googleLoginRateLimit = authRateLimit({
  name: "google-login:ip",
  identifier: "ip",
  limit: 60,
  windowMs: 15 * MINUTE,
});

export const verifyEmailRateLimit = authRateLimit(
  { name: "verify-email:ip", identifier: "ip", limit: 30, windowMs: 15 * MINUTE },
  { name: "verify-email:email", identifier: "email", limit: 10, windowMs: 15 * MINUTE },
);

export const resendOtpRateLimit = authRateLimit(
  { name: "resend-otp:ip", identifier: "ip", limit: 10, windowMs: 15 * MINUTE },
  { name: "resend-otp:email", identifier: "email", limit: 3, windowMs: 15 * MINUTE },
);
