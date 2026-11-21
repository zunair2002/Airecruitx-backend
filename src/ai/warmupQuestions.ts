import type { ISelectedQuestion } from "../candidate/interview/model/interviewSession.model";

// Fixed warm-up questions asked before the HR question pool in a structured (proctored)
// org interview. Always this text, always this order. They are never sent to the model,
// never scored and never counted in marks; HR sees them as the "introduction".
export const WARMUP_QUESTIONS: readonly string[] = Object.freeze([
  "Hello, welcome to your interview! How are you today?",
  "Could you briefly introduce yourself?",
  "What interests you about this role?",
]);

export const CLOSING_MESSAGE =
  "Thank you for your time. Your interview is complete. The HR team will review your responses and contact you.";

/** Missing kind (sessions created before warm-ups existed) means "pool". */
export const isWarmup = (item?: { kind?: "warmup" | "pool" } | null): boolean => item?.kind === "warmup";

export const warmupSelectedQuestions = (): ISelectedQuestion[] =>
  WARMUP_QUESTIONS.map((question) => ({ question, kind: "warmup" as const }));
