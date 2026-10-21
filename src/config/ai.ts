// Fine-tuned AIRecruitX model (Phi-4-mini) served by vLLM — OpenAI-compatible API.
// For local development point AI_BASE_URL at the mock server: `node scripts/mock-ai-server.js`.
export const AI_BASE_URL = (process.env.AI_BASE_URL || "http://localhost:8001").replace(/\/+$/, "");
export const AI_API_KEY = process.env.AI_API_KEY || "";
export const AI_MODEL = process.env.AI_MODEL || "airecruitx";
export const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 180_000); // a cold start can take 1-3 min
export const AI_JSON_SCHEMA = (process.env.AI_JSON_SCHEMA ?? "true") !== "false";
export const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY ?? 8);
// How long the final answer waits for outstanding evaluations + the report before
// completing with whatever has been evaluated (the rest are marked "failed").
export const AI_FINAL_WAIT_MS = Number(process.env.AI_FINAL_WAIT_MS ?? 240_000);

// Interview structure
export const BASIC_QUESTIONS = Number(process.env.INTERVIEW_BASIC_QUESTIONS ?? 5);
export const TECHNICAL_QUESTIONS = Number(process.env.INTERVIEW_TECHNICAL_QUESTIONS ?? 8);

// Practice mode: score (0-100) needed in Round 1 (basic) to unlock Round 2 (technical).
export const ROUND2_UNLOCK_SCORE = Number(process.env.ROUND2_UNLOCK_SCORE ?? 50);

// Practice pass mark on the 0-100 session score (same variable the certificate flow uses).
export const passScore100 = (): number => {
  const v = Number(process.env.CERTIFICATE_PASS_SCORE ?? 70);
  return Number.isNaN(v) ? 70 : v;
};
