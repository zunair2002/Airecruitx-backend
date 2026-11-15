// Score calibration: the fine-tuned evaluator scores fresh graduates harshly, so its raw 0-10
// criterion scores are lifted here before the question score / overall score are computed.
// Also the "estimated" score used when the evaluator is still unavailable at report time.
import { SCORE_FLOOR_CORRECT, SCORE_OFFSET, SCORE_SCALE } from "../config/ai";
import { criteriaFor, questionScore, round1, Stage } from "./scoring";
import type { AnswerEvaluation } from "./ai.service";

// "correct" (technical) and "strong" (basic) are the model's top verdicts; "good" is kept for safety.
const CORRECT_VERDICTS = new Set(["correct", "good", "strong"]);
const MIN_WORDS = 5;

const wordCount = (s: string): number => String(s || "").trim().split(/\s+/).filter(Boolean).length;

/**
 * calibrated = min(10, round((raw * SCORE_SCALE + SCORE_OFFSET) * 10) / 10), with a floor of
 * SCORE_FLOOR_CORRECT per criterion for a correct answer. Empty / very short answers
 * (and "no_answer") are returned unchanged.
 */
export function calibrateScores(raw: Record<string, number>, verdict: string, answer: string): Record<string, number> {
  if (wordCount(answer) < MIN_WORDS || verdict === "no_answer") return { ...raw };
  const out: Record<string, number> = {};
  for (const [c, v] of Object.entries(raw)) {
    let s = Math.min(10, Math.round((Number(v) * SCORE_SCALE + SCORE_OFFSET) * 10) / 10);
    if (CORRECT_VERDICTS.has(verdict)) s = Math.max(s, SCORE_FLOOR_CORRECT);
    out[c] = Math.min(10, s);
  }
  return out;
}

const STOP = new Set(["that", "this", "with", "from", "they", "their", "there", "which", "when", "what", "where",
  "have", "will", "into", "than", "then", "them", "also", "such", "each", "used", "uses", "using", "about", "like"]);
const keywords = (s: string): string[] =>
  String(s || "").toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * Rough score when the model never evaluated the answer: key-point keyword coverage plus a
 * small length bonus. Only used as a last resort and always flagged as "estimated".
 */
export function estimateEvaluation(p: { stage: Stage; keyPoints: string[]; answer: string }): AnswerEvaluation {
  const words = wordCount(p.answer);
  let score: number;
  if (words === 0) score = 0;
  else if (words < MIN_WORDS) score = 1;
  else {
    const kw = [...new Set(p.keyPoints.flatMap(keywords))];
    const said = new Set(keywords(p.answer));
    const coverage = kw.length ? kw.filter((k) => said.has(k)).length / kw.length : 0.5;
    score = round1(Math.min(10, 2 + coverage * 6 + (Math.min(words, 60) / 60) * 2));
  }
  const scores = Object.fromEntries(criteriaFor(p.stage).map((c) => [c, score]));
  const verdict = p.stage === "technical"
    ? (words === 0 ? "no_answer" : score >= 7 ? "correct" : score >= 4 ? "partially_correct" : "incorrect")
    : (words === 0 ? "no_answer" : score >= 7 ? "strong" : score >= 4 ? "adequate" : "weak");
  return {
    verdict,
    scores,
    rawScores: {},
    feedback: "AI evaluation was unavailable for this answer, so this score is estimated from the key points it covers.",
    improvementTip: "",
    weakTopics: [],
    questionScore: questionScore(scores, p.stage),
  };
}
