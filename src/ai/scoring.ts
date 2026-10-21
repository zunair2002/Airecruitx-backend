// Deterministic scoring — computed by the backend, never by the model.
// Must stay identical to the rules used to build the training data (tools/spec.py).

export type Stage = "basic" | "technical";

export const TECH_CRITERIA = ["technical_accuracy", "completeness", "problem_solving", "communication"] as const;
export const BASIC_CRITERIA = ["relevance", "structure", "communication", "professionalism"] as const;
export const TECH_VERDICTS = ["correct", "partially_correct", "incorrect", "no_answer", "off_topic"] as const;
export const BASIC_VERDICTS = ["strong", "adequate", "weak", "no_answer", "off_topic"] as const;

export const TECH_WEIGHTS: Record<string, number> = {
  technical_accuracy: 0.4, completeness: 0.25, problem_solving: 0.2, communication: 0.15,
};
export const BASIC_WEIGHTS: Record<string, number> = {
  relevance: 0.3, structure: 0.25, communication: 0.25, professionalism: 0.2,
};
export const STAGE_WEIGHTS: Record<Stage, number> = { basic: 0.4, technical: 0.6 };
export const HR_SHORTLIST = 7.0;
export const HR_HOLD = 5.0;

export const criteriaFor = (stage: Stage): readonly string[] => (stage === "technical" ? TECH_CRITERIA : BASIC_CRITERIA);
export const verdictsFor = (stage: Stage): readonly string[] => (stage === "technical" ? TECH_VERDICTS : BASIC_VERDICTS);

/** Same result as Python's round(x, 1) (exact binary value, round-half-even). */
export function round1(x: number): number {
  const neg = x < 0;
  const [ip, fp] = Math.abs(x).toFixed(60).split(".");
  const keep = BigInt(ip + fp[0]);
  const rest = fp.slice(1);
  let up = false;
  if (/[1-9]/.test(rest)) {
    if (rest[0] > "5") up = true;
    else if (rest[0] === "5") up = /[1-9]/.test(rest.slice(1)) || keep % BigInt(2) === BigInt(1);
  }
  const n = Number(keep + (up ? BigInt(1) : BigInt(0))) / 10;
  return neg ? -n : n;
}

/** 0-10 score of one answer from its criterion scores. */
export function questionScore(scores: Record<string, number>, stage: Stage): number {
  const w = stage === "technical" ? TECH_WEIGHTS : BASIC_WEIGHTS;
  return round1(Object.entries(w).reduce((sum, [c, v]) => sum + Number(scores[c] ?? 0) * v, 0));
}

export function stageScore(scores: number[]): number {
  if (!scores.length) return 0;
  return round1(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/** 0-10 overall. If a stage has no questions (e.g. HR question sets), the other stage counts fully. */
export function overallScore(basic: number | null, technical: number | null): number {
  if (basic === null && technical === null) return 0;
  if (basic === null) return round1(technical as number);
  if (technical === null) return round1(basic);
  return round1(STAGE_WEIGHTS.basic * basic + STAGE_WEIGHTS.technical * technical);
}

export const hrDecision = (overall: number): "shortlist" | "hold" | "reject" =>
  overall >= HR_SHORTLIST ? "shortlist" : overall >= HR_HOLD ? "hold" : "reject";
