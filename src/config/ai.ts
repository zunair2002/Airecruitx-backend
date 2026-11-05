// Fine-tuned AIRecruitX model (Phi-4-mini) served by vLLM — OpenAI-compatible API.
// For local development point AI_BASE_URL at the mock server: `node scripts/mock-ai-server.js`.
export const AI_BASE_URL = (process.env.AI_BASE_URL || "http://localhost:8001").replace(/\/+$/, "");
export const AI_API_KEY = process.env.AI_API_KEY || "";
export const AI_MODEL = process.env.AI_MODEL || "airecruitx";
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 180_000); // a cold start can take 1-3 min
export const AI_JSON_SCHEMA = (process.env.AI_JSON_SCHEMA ?? "true") !== "false";
export const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY ?? 8);
// How long the final answer waits for outstanding evaluations + the report before
// re-trying failed evaluations once more (anything still unevaluated gets an "estimated" score).
export const AI_FINAL_WAIT_MS = Number(process.env.AI_FINAL_WAIT_MS ?? 240_000);
// How long a request keeps retrying while the GPU server answers 502/503/504 ("no upstreams
// available" during a cold start). Also the warm-up budget and the final re-evaluation window.
export const AI_RETRY_WINDOW_MS = Number(process.env.AI_RETRY_WINDOW_MS ?? 180_000);

// Score calibration applied to the model's 0-10 criterion scores (see src/ai/calibration.ts).
const numEnv = (name: string, fallback: number): number => {
  const v = Number(process.env[name]);
  return process.env[name] === undefined || process.env[name] === "" || Number.isNaN(v) ? fallback : v;
};
export const SCORE_SCALE = numEnv("SCORE_SCALE", 1.15);
export const SCORE_OFFSET = numEnv("SCORE_OFFSET", 0.8);
export const SCORE_FLOOR_CORRECT = numEnv("SCORE_FLOOR_CORRECT", 6);

// Interview structure
export const BASIC_QUESTIONS = Number(process.env.INTERVIEW_BASIC_QUESTIONS ?? 5);
export const TECHNICAL_QUESTIONS = Number(process.env.INTERVIEW_TECHNICAL_QUESTIONS ?? 8);

// Interview time limits (minutes), enforced server side from session.expiresAt
export const BASIC_INTERVIEW_MINUTES = numEnv("BASIC_INTERVIEW_MINUTES", 10); // practice Round 1
export const TECHNICAL_INTERVIEW_MINUTES = numEnv("TECHNICAL_INTERVIEW_MINUTES", 20); // practice Round 2
export const ORG_INTERVIEW_MINUTES = numEnv("ORG_INTERVIEW_MINUTES", 20); // HR invite (org interview)
// An answer sent this long after expiresAt is still accepted (network / speech-to-text delay)
export const INTERVIEW_GRACE_MS = 3_000;

// Practice mode: score (0-100) needed in Round 1 (basic) to unlock Round 2 (technical).
export const ROUND2_UNLOCK_SCORE = Number(process.env.ROUND2_UNLOCK_SCORE ?? 50);

// Practice pass mark on the 0-100 session score (same variable the certificate flow uses).
export const passScore100 = (): number => {
  const v = Number(process.env.CERTIFICATE_PASS_SCORE ?? 70);
  return Number.isNaN(v) ? 70 : v;
};
