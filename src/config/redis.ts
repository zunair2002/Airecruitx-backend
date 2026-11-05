import { Redis } from "ioredis";

// Optional Redis connection (REDIS_URL). Redis only holds small shared, short-lived state that
// must be the same on every backend instance; MongoDB stays the source of truth for all data.
// Without REDIS_URL, or while Redis is down, every helper below falls back to process memory
// (the single-instance behaviour), so the backend never crashes because of Redis.

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
const memGet = (key: string): string | null => {
  const e = memory.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return e.value;
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
