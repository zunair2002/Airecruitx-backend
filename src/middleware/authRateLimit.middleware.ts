import { createHash } from "crypto";
import { Request } from "express";
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

type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

// In-memory fixed-window counters (single backend instance). Expired entries are swept every
// minute, and immediately if the map grows unusually large between sweeps.
const counters = new Map<string, { count: number; expiresAt: number }>();
const SWEEP_INTERVAL_MS = 60_000;
const MAX_ENTRIES_BEFORE_SWEEP = 10_000;

const sweepExpired = (now = Date.now()): void => {
  for (const [key, entry] of counters) {
    if (entry.expiresAt <= now) counters.delete(key);
  }
};
setInterval(sweepExpired, SWEEP_INTERVAL_MS).unref(); // unref: never keeps the process alive

const incrementRateLimit = (key: string, limit: number, windowMs: number): RateLimitResult => {
  const now = Date.now();
  if (counters.size > MAX_ENTRIES_BEFORE_SWEEP) sweepExpired(now);

  let entry = counters.get(key);
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + windowMs };
    counters.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)),
  };
};

/** Applies IP and/or account limits and responds with HTTP 429 on excess. */
export const authRateLimit = (...rules: LimitRule[]) =>
  asyncHandler(async (req, res, next) => {
    const results = rules.flatMap((rule) => {
      const value = identifierValue(req, rule.identifier);
      return value ? [incrementRateLimit(keyFor(rule, value), rule.limit, rule.windowMs)] : [];
    });
    const blocked = results.filter((result) => !result.allowed);
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
