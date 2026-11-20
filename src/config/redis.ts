import { Redis } from "ioredis";

// Optional shared Redis connection for small, short-lived state. MongoDB remains the source
// of truth. These helpers keep their process-memory fallback; BullMQ queues use their own
// Redis connections and fail explicitly because in-memory jobs cannot survive a restart.

let warned = false;
const warnFallback = (): void => {
  if (warned) return;
  warned = true;
  console.warn("[redis] not available, using memory fallback");
};

export const redis: Redis | null = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false, // fail fast (-> memory fallback) instead of queueing while down
      connectTimeout: 5000,
      retryStrategy: (times) => Math.min(times * 2000, 30_000), // keep reconnecting in the background
    })
  : null;

if (redis) {
  redis.on("error", warnFallback); // reconnect errors repeat; one warning is enough
  redis.on("ready", () => {
    warned = false;
    console.log("[redis] connected");
  });
} else {
  warnFallback();
}

const available = (): boolean => {
  if (redis?.status === "ready") return true;
  warnFallback();
  return false;
};

// ---- memory fallback: key -> value with expiry
const memory = new Map<string, { value: string; expiresAt: number }>();
const memoryRateLimits = new Map<string, { count: number; expiresAt: number }>();
let nextRateLimitSweep = 0;

const memGet = (key: string): string | null => {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const rateLimitResult = (
  count: number,
  limit: number,
  expiresAt: number,
): RateLimitResult => ({
  allowed: count <= limit,
  remaining: Math.max(0, limit - count),
  retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)),
});

const incrementMemoryRateLimit = (
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult => {
  const now = Date.now();
  if (now >= nextRateLimitSweep || memoryRateLimits.size > 10_000) {
    for (const [storedKey, entry] of memoryRateLimits) {
      if (entry.expiresAt <= now) memoryRateLimits.delete(storedKey);
    }
    nextRateLimitSweep = now + 60_000;
  }

  const current = memoryRateLimits.get(key);
  if (!current || current.expiresAt <= now) {
    const expiresAt = now + windowMs;
    memoryRateLimits.set(key, { count: 1, expiresAt });
    return rateLimitResult(1, limit, expiresAt);
  }

  current.count += 1;
  return rateLimitResult(current.count, limit, current.expiresAt);
};

/**
 * Atomically increments a fixed-window counter. Redis shares limits between
 * instances; the in-process fallback matches the other Redis helpers.
 */
export const incrementRateLimit = async (
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> => {
  if (available()) {
    try {
      const result = await redis!.eval(
        [
          "local count = redis.call('INCR', KEYS[1])",
          "local ttl = redis.call('PTTL', KEYS[1])",
          "if count == 1 or ttl < 0 then",
          "  redis.call('PEXPIRE', KEYS[1], ARGV[1])",
          "  ttl = tonumber(ARGV[1])",
          "end",
          "return { count, ttl }",
        ].join("\n"),
        1,
        key,
        windowMs,
      );
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error("Unexpected Redis rate-limit response");
      }
      const count = Number(result[0]);
      const ttlMs = Number(result[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttlMs) || ttlMs < 0) {
        throw new Error("Invalid Redis rate-limit response");
      }
      return rateLimitResult(count, limit, Date.now() + ttlMs);
    } catch {
      warnFallback();
    }
  }
  return incrementMemoryRateLimit(key, limit, windowMs);
};

export const cacheGet = async (key: string): Promise<string | null> => {
  if (available()) {
    try {
      return await redis!.get(key);
    } catch { warnFallback(); }
  }
  return memGet(key);
};

export const cacheSet = async (key: string, value: string, ttlMs: number): Promise<void> => {
  if (available()) {
    try {
      await redis!.set(key, value, "PX", ttlMs);
      return;
    } catch { warnFallback(); }
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlMs });
};

export const cacheDel = async (key: string): Promise<void> => {
  memory.delete(key);
  if (available()) {
    try {
      await redis!.del(key);
    } catch { warnFallback(); }
  }
};

/** Set-if-absent with expiry: true if this caller got the lock. */
export const acquireLock = async (key: string, ttlMs: number): Promise<boolean> => {
  if (available()) {
    try {
      return (await redis!.set(key, "1", "PX", ttlMs, "NX")) === "OK";
    } catch { warnFallback(); }
  }
  if (memGet(key) !== null) return false;
  memory.set(key, { value: "1", expiresAt: Date.now() + ttlMs });
  return true;
};

export const releaseLock = cacheDel;
