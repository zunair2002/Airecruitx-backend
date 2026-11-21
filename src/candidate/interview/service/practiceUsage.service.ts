import { InterviewSession } from "../model/interviewSession.model";
import { User, UserPlan, effectivePlan } from "../../../shared/user/model/user.model";
import { AppError } from "../../../utils/AppError";

// Daily practice-interview allowance per plan. Free users who use up their allowance
// wait FREE_COOLDOWN_MS from the session that hit the limit (like chat-assistant usage
// caps); premium users get a plain rolling 24-hour window.
export const PRACTICE_LIMITS: Record<UserPlan, number> = { free: 5, premium: 10 };
const DAY_MS = 24 * 60 * 60 * 1000;
const FREE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// Look back far enough to see a lockout that is still in effect.
const LOOKBACK_MS = 2 * DAY_MS;

export type PracticeUsage = {
  plan: UserPlan;
  limit: number;
  used: number;
  remaining: number;
  /** When a slot frees up next (ISO); null while nothing has been used. */
  resetsAt: string | null;
  /** Set only while the limit is reached: the earliest time a new session can start. */
  nextAvailableAt: string | null;
};

/**
 * Pure usage maths over the start times of practice sessions (any order).
 * Free: rolling 24h count; reaching the limit locks for 6h from the limit-hitting
 * session, after which the count starts over. Premium: rolling 24h window.
 */
export function computePracticeUsage(plan: UserPlan, startTimes: number[], now = Date.now()): PracticeUsage {
  const limit = PRACTICE_LIMITS[plan];
  const sorted = startTimes.filter((t) => t > now - LOOKBACK_MS && t <= now).sort((a, b) => a - b);

  let windowTimes: number[] = [];
  let lockedUntil = 0;
  for (const t of sorted) {
    windowTimes = windowTimes.filter((x) => x > t - DAY_MS);
    windowTimes.push(t);
    if (plan === "free" && windowTimes.length >= limit) {
      lockedUntil = t + FREE_COOLDOWN_MS;
      windowTimes = [];
    }
  }

  if (lockedUntil > now) {
    const at = new Date(lockedUntil).toISOString();
    return { plan, limit, used: limit, remaining: 0, resetsAt: at, nextAvailableAt: at };
  }

  const inWindow = windowTimes.filter((x) => x > now - DAY_MS);
  const used = Math.min(inWindow.length, limit);
  const resetsAt = inWindow.length ? new Date(inWindow[0] + DAY_MS).toISOString() : null;
  return {
    plan,
    limit,
    used,
    remaining: limit - used,
    resetsAt,
    nextAvailableAt: used >= limit ? resetsAt : null,
  };
}

// Enough history for the 2-day lookback at the premium limit, with headroom.
const MAX_TRACKED_STARTS = 50;

export async function getPracticeUsage(userId: string): Promise<PracticeUsage> {
  const [user, sessions] = await Promise.all([
    User.findById(userId).select("plan planExpiresAt +practiceStarts").lean(),
    InterviewSession.find({
      userId,
      applicationId: { $exists: false },
      visibility: "candidate",
      createdAt: { $gt: new Date(Date.now() - LOOKBACK_MS) },
    })
      .select("createdAt")
      .lean(),
  ]);
  const plan: UserPlan = effectivePlan(user);

  // Usage comes from the recorded start times, which survive the session being deleted
  // when the candidate abandons it for a new one. Sessions created before tracking
  // began (no recorded start yet) are still counted from their own createdAt.
  const tracked = (user?.practiceStarts ?? []).map((d) => new Date(d).getTime());
  const firstTracked = tracked.length ? Math.min(...tracked) : Infinity;
  const legacy = sessions
    .map((s) => new Date(s.createdAt).getTime())
    .filter((t) => t < firstTracked);

  return computePracticeUsage(plan, [...legacy, ...tracked]);
}

/** Records a brand-new practice session against the allowance. Call with the session's createdAt. */
export async function recordPracticeStart(userId: string, at: Date): Promise<void> {
  await User.updateOne(
    { _id: userId },
    { $push: { practiceStarts: { $each: [at], $slice: -MAX_TRACKED_STARTS } } }
  );
}

/** Throws 429 (with `nextAvailableAt` in the body) when no practice session can be started now. */
export async function assertPracticeAllowed(userId: string): Promise<void> {
  const usage = await getPracticeUsage(userId);
  if (usage.remaining > 0) return;
  const wait = usage.nextAvailableAt ? formatWait(new Date(usage.nextAvailableAt).getTime() - Date.now()) : "later";
  const upgrade = usage.plan === "free" ? ` Upgrade to Premium for ${PRACTICE_LIMITS.premium} a day.` : "";
  throw new AppError(
    `You've used all ${usage.limit} practice interviews for now. You can practise again in ${wait}.${upgrade}`,
    429,
    { nextAvailableAt: usage.nextAvailableAt, usage }
  );
}

function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
