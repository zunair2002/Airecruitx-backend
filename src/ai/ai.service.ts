// Client for the fine-tuned AIRecruitX model (Phi-4-mini on vLLM, OpenAI-compatible API).
// The user-message layouts below MUST match the training data exactly — do not reformat them.
import { AI_API_KEY, AI_BASE_URL, AI_CONCURRENCY, AI_JSON_SCHEMA, AI_MODEL, AI_RETRY_WINDOW_MS, AI_TIMEOUT_MS } from "../config/ai";
import { EVAL_FAIRNESS, EVAL_SYSTEM, QGEN_DIFFICULTY, QGEN_SYSTEM, REPORT_SYSTEM } from "./prompts";
import { calibrateScores } from "./calibration";
import { acquireLock, cacheDel, cacheGet, cacheSet, releaseLock } from "../config/redis";
import { AIQueue } from "./aiQueue";
import { criteriaFor, questionScore, round1, Stage, verdictsFor } from "./scoring";
import bankData from "./question_bank.json";

export interface GeneratedQuestion {
  question: string;
  topic: string;
  keyPoints: string[];
  source: "model" | "bank";
}

export interface AnswerEvaluation {
  verdict: string;
  scores: Record<string, number>; // calibrated (src/ai/calibration.ts)
  rawScores: Record<string, number>; // as returned by the model
  feedback: string;
  improvementTip: string;
  weakTopics: string[];
  questionScore: number; // 0-10, computed by the backend from the calibrated scores
}

export interface ReportResultLine {
  stage: Stage;
  topic: string;
  score: number;
  verdict: string;
  feedback: string;
}

export interface ReportText {
  summary: string;
  strengths: string[];
  areasToImprove?: string[]; // candidate report
  learningPlan?: string[]; // candidate report
  concerns?: string[]; // hr report
  recommendation?: string; // hr report
}

export const aiQueue = new AIQueue(AI_CONCURRENCY);
let useSchema = AI_JSON_SCHEMA;

// ------------------------------------------------------------------ prompt builders (training format)
const oneLine = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();
const fmt1 = (x: number): string => round1(x).toFixed(1);

export function evalUserMessage(p: { stage: Stage; level?: string; topic: string; question: string; keyPoints: string[]; answer: string }): string {
  const kp = p.keyPoints.map((k) => `- ${oneLine(k)}`).join("\n");
  const level = p.stage === "basic" ? "general" : p.level || "intermediate";
  return `stage: ${p.stage}\nlevel: ${level}\ntopic: ${p.topic}\nquestion: ${oneLine(p.question)}\n`
    + `key_points:\n${kp}\nanswer: ${oneLine(p.answer) || "..."}`;
}

export function qgenUserMessage(p: { stage: Stage; level?: string; role: string; topics: string[]; count: number }): string {
  const level = p.stage === "basic" ? "general" : p.level || "intermediate";
  return `stage: ${p.stage}\nlevel: ${level}\nrole: ${p.role}\ntopics: ${p.topics.join(", ")}\ncount: ${p.count}`;
}

const INTERJ = /^(hmm|not quite|that'?s|that’s|close|almost|you'?re|you’re|good try|nice try|oops|excellent|great|good job|nice|exactly|correct|well done|spot on|perfect)\b/i;
export function firstSentence(text: string): string {
  const sents = String(text || "").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  const keep = sents.filter((s) => !(INTERJ.test(s) && s.split(/\s+/).length <= 7));
  const words = (keep[0] || sents[0] || String(text || "")).split(/\s+/);
  return words.slice(0, 22).join(" ") + (words.length > 22 ? "..." : "");
}

export function reportUserMessage(p: {
  reportType: "candidate" | "hr"; role: string; level: string; basicScore: number; technicalScore: number;
  overall: number; decision: string; results: ReportResultLine[];
}): string {
  const lines = p.results.map((r) => `- [${r.stage}][${r.topic}] ${fmt1(r.score)}/10 ${r.verdict}: ${firstSentence(r.feedback)}`);
  return `report_type: ${p.reportType}\nrole: ${p.role}\nlevel: ${p.level}\nbasic_score: ${fmt1(p.basicScore)}\n`
    + `technical_score: ${fmt1(p.technicalScore)}\noverall_score: ${fmt1(p.overall)}\ndecision: ${p.decision}\nresults:\n${lines.join("\n")}`;
}

// ------------------------------------------------------------------ JSON schemas (vLLM structured output)
const strArr = { type: "array", items: { type: "string" } };
const evalSchema = (stage: Stage) => {
  const crits = criteriaFor(stage);
  return {
    type: "object",
    properties: {
      verdict: { type: "string", enum: verdictsFor(stage) },
      scores: {
        type: "object",
        properties: Object.fromEntries(crits.map((c) => [c, { type: "integer", minimum: 0, maximum: 10 }])),
        required: crits, additionalProperties: false,
      },
      feedback: { type: "string" }, improvement_tip: { type: "string" }, weak_topics: strArr,
    },
    required: ["verdict", "scores", "feedback", "improvement_tip", "weak_topics"], additionalProperties: false,
  };
};
const QGEN_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, topic: { type: "string" }, key_points: strArr },
        required: ["question", "topic", "key_points"], additionalProperties: false,
      },
    },
  },
  required: ["questions"], additionalProperties: false,
};
const reportSchema = (type: "candidate" | "hr") => {
  const p: Record<string, unknown> = type === "candidate"
    ? { summary: { type: "string" }, strengths: strArr, areas_to_improve: strArr, learning_plan: strArr }
    : { summary: { type: "string" }, strengths: strArr, concerns: strArr, recommendation: { type: "string" } };
  return { type: "object", properties: p, required: Object.keys(p), additionalProperties: false };
};

// ------------------------------------------------------------------ HTTP
class AIHttpError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Sampling = Record<string, number>;
// attempt 0: greedy (consistent scores); retries: light sampling so a repetition loop is not repeated
const defaultSampling = (attempt: number): Sampling =>
  attempt === 0 ? { temperature: 0 } : { temperature: 0.3, top_p: 0.9, repetition_penalty: 1.05 };

async function postChat(system: string, user: string, maxTokens: number, schema: object | null, name: string, sampling: Sampling, timeoutMs: number): Promise<string> {
  const body: Record<string, unknown> = {
    model: AI_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    temperature: 0,
    max_tokens: maxTokens,
    ...sampling,
  };
  if (useSchema && schema) body.response_format = { type: "json_schema", json_schema: { name, schema } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new AIHttpError(`AI server ${res.status}: ${text.slice(0, 300)}`, res.status);
    return JSON.parse(text).choices[0].message.content as string;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): any {
  const i = text.indexOf("{");
  const j = text.lastIndexOf("}");
  if (i < 0 || j < i) throw new Error("no JSON object in model output");
  return JSON.parse(text.slice(i, j + 1));
}

// Serverless GPU cold start: the gateway answers 502/503/504 or "no upstreams available" until a
// worker is up. Those are retried with this backoff (last value repeats) for AI_RETRY_WINDOW_MS.
const UNAVAILABLE_BACKOFF_MS = [3000, 5000, 10_000, 15_000, 15_000];
const isUnavailable = (err: any): boolean =>
  [429, 502, 503, 504].includes(err?.status)
  || /no upstreams available/i.test(String(err?.message ?? ""))
  || (err instanceof TypeError && /fetch failed/i.test(err.message)); // connection refused/reset while starting

async function callModel<T>(opts: {
  system: string; user: string; maxTokens: number; schema: object; schemaName: string;
  validate: (o: any) => T; sampling?: (attempt: number) => Sampling; retries?: number; timeoutMs?: number;
  unavailableWindowMs?: number;
}): Promise<T> {
  const retries = opts.retries ?? 2; // retries for bad model output (invalid JSON, missing fields)
  const sampling = opts.sampling ?? defaultSampling;
  const deadline = Date.now() + (opts.unavailableWindowMs ?? AI_RETRY_WINDOW_MS);
  let attempt = 0;
  let waits = 0;
  for (;;) {
    try {
      const raw = await postChat(opts.system, opts.user, opts.maxTokens, opts.schema, opts.schemaName, sampling(attempt), opts.timeoutMs ?? AI_TIMEOUT_MS);
      return opts.validate(extractJson(raw));
    } catch (err: any) {
      if (err?.status === 400 && useSchema && /response_format|json_schema|guided/i.test(err.message)) {
        useSchema = false; // server without structured-output support -> plain JSON
        continue;
      }
      if (isUnavailable(err)) {
        cacheDel(WARM_KEY).catch(() => undefined); // server went cold: let the next warmUp poll again
        const delay = UNAVAILABLE_BACKOFF_MS[Math.min(waits, UNAVAILABLE_BACKOFF_MS.length - 1)];
        if (Date.now() + delay > deadline) throw err;
        waits++;
        console.warn(`[ai] server unavailable (${err?.status ?? err?.message}), retry ${waits} in ${delay / 1000}s`);
        await sleep(delay);
        continue;
      }
      if (err?.status >= 400 && err?.status < 500) throw err; // bad request / wrong API key: retrying will not help
      if (attempt >= retries) throw err;
      attempt++;
      await sleep(attempt === 1 ? 2000 : 6000);
    }
  }
}

// ------------------------------------------------------------------ question bank (fallback / top-up)
interface BankQuestion { stage: Stage; topic: string; level: string; question: string; key_points: string[] }
const BANK = bankData as BankQuestion[];
const normQ = (q: string) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function pickFromBank(p: { stage: Stage; level?: string; topics: string[]; count: number; exclude?: string[] }): GeneratedQuestion[] {
  const ex = new Set((p.exclude ?? []).map(normQ));
  let pool = BANK.filter((q) => q.stage === p.stage && p.topics.includes(q.topic) && !ex.has(normQ(q.question)));
  if (pool.length < p.count) pool = BANK.filter((q) => q.stage === p.stage && !ex.has(normQ(q.question))); // widen
  if (p.stage === "technical" && p.level !== "expert") {
    const easier = pool.filter((q) => q.level !== "expert"); // keep fresh-graduate difficulty
    if (easier.length >= p.count) pool = easier;
  }
  if (p.stage === "technical" && p.level) {
    const same = pool.filter((q) => q.level === p.level);
    if (same.length >= p.count) pool = same;
  }
  pool = [...pool].sort(() => Math.random() - 0.5);
  const byTopic = p.topics.map((t) => pool.filter((q) => q.topic === t));
  const out: BankQuestion[] = [];
  while (out.length < p.count && byTopic.some((l) => l.length)) {
    for (const l of byTopic) if (l.length && out.length < p.count) out.push(l.shift()!);
  }
  for (const q of pool) if (out.length < p.count && !out.includes(q)) out.push(q);
  return out.map((q) => ({ question: q.question, topic: q.topic, keyPoints: q.key_points, source: "bank" as const }));
}

// ------------------------------------------------------------------ public API
// Redis: the "GPU is warm" flag and the warm-up lock are shared by all backend instances, so
// only one instance polls the GPU server and none polls while it is known to be warm.
const WARM_KEY = "ai:warm";
const WARM_LOCK = "ai:warmup:lock";
const WARM_TTL_MS = 2 * 60_000; // serverless GPU scales down after a few idle minutes
let warming: Promise<boolean> | null = null;

/** Wake the GPU server (call at interview start; do not await). Polls /v1/models every 5s. */
export function warmUp(maxWaitMs = AI_RETRY_WINDOW_MS): Promise<boolean> {
  if (warming) return warming; // one poller is enough for all interviews starting together
  warming = (async () => {
    if (await cacheGet(WARM_KEY)) return true;
    if (!(await acquireLock(WARM_LOCK, maxWaitMs))) return false; // another instance is polling
    try {
      const until = Date.now() + maxWaitMs;
      while (Date.now() < until) {
        try {
          const res = await fetch(`${AI_BASE_URL}/v1/models`, {
            headers: { Authorization: `Bearer ${AI_API_KEY}` },
            signal: AbortSignal.timeout(Math.max(1000, Math.min(60_000, until - Date.now()))),
          });
          if (res.ok) {
            await cacheSet(WARM_KEY, "1", WARM_TTL_MS);
            return true;
          }
        } catch { /* still starting */ }
        await sleep(5000);
      }
      console.warn(`[ai] warm-up: server not ready after ${maxWaitMs / 1000}s`);
      return false;
    } finally {
      await releaseLock(WARM_LOCK);
    }
  })().finally(() => { warming = null; });
  return warming;
}

const MAX_QUESTION_WORDS = 24; // questions must be under 25 words
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Generate `count` unique questions. Basic round: easy questions from the local bank first, the
 * model only fills in when the bank runs out. Technical round: model first, topped up from the
 * bank (also used if the model is down).
 */
export async function generateQuestions(p: {
  stage: Stage; level?: string; role: string; topics: string[]; count: number; exclude?: string[];
}): Promise<GeneratedQuestion[]> {
  const fromBankFirst = p.stage === "basic" ? pickFromBank(p) : [];
  if (fromBankFirst.length >= p.count) return fromBankFirst.slice(0, p.count);
  const need = p.count - fromBankFirst.length;
  const excludeList = [...(p.exclude ?? []), ...fromBankFirst.map((q) => q.question)];
  const exclude = new Set(excludeList.map(normQ));
  let qs: GeneratedQuestion[] = [];
  try {
    const timeoutMs = Number(process.env.AI_QGEN_TIMEOUT_MS ?? 30_000);
    qs = await aiQueue.add(() => callModel({
      system: QGEN_SYSTEM + QGEN_DIFFICULTY[p.stage],
      user: qgenUserMessage({ ...p, count: need }),
      maxTokens: 900, schema: QGEN_SCHEMA, schemaName: "questions",
      sampling: () => ({ temperature: 0.7, top_p: 0.9, repetition_penalty: 1.1 }),
      retries: 0,
      // the candidate is waiting on "Start": if the GPU is cold, fall back to the bank quickly
      timeoutMs,
      unavailableWindowMs: timeoutMs,
      validate: (o) => {
        if (!o || !Array.isArray(o.questions)) throw new Error("questions: bad format");
        const seen = new Set<string>();
        const list: GeneratedQuestion[] = [];
        for (const q of o.questions) {
          const k = normQ(q?.question ?? "");
          if (!k || seen.has(k) || exclude.has(k)) continue;
          if (wordCount(String(q.question)) > MAX_QUESTION_WORDS) continue; // too long / multi-part
          seen.add(k);
          list.push({ question: String(q.question), topic: String(q.topic || p.topics[0]), keyPoints: (q.key_points || []).map(String), source: "model" });
        }
        if (!list.length) throw new Error("questions: none");
        return list.slice(0, need);
      },
    }));
  } catch (err: any) {
    console.warn("[ai] question generation failed, using question bank:", err?.message ?? err);
  }
  qs = [...fromBankFirst, ...qs];
  if (qs.length < p.count) {
    qs = qs.concat(pickFromBank({ ...p, count: p.count - qs.length, exclude: [...(p.exclude ?? []), ...qs.map((q) => q.question)] }));
  }
  if (!qs.length) throw new Error("no questions available for these topics");
  return qs.slice(0, p.count);
}

const clampInt = (v: unknown) => Math.max(0, Math.min(10, Math.round(Number(v))));

// The served model has a 2048-token context, so only the start of a long answer is sent for
// evaluation (the full answer is still stored on the session).
const MAX_EVAL_ANSWER_CHARS = 4000;

/** Evaluate one answer (goes through the shared queue). */
export async function evaluateAnswer(p: {
  stage: Stage; level?: string; topic: string; question: string; keyPoints: string[]; answer: string;
}): Promise<AnswerEvaluation> {
  const started = Date.now();
  const ev = await aiQueue.add(() => callModel({
    system: EVAL_SYSTEM + EVAL_FAIRNESS,
    user: evalUserMessage({ ...p, answer: p.answer.slice(0, MAX_EVAL_ANSWER_CHARS) }),
    maxTokens: 320, schema: evalSchema(p.stage), schemaName: "evaluation",
    // 503 while the serverless GPU starts is retried inside callModel (AI_RETRY_WINDOW_MS);
    // these retries are for malformed model output.
    retries: 2,
    validate: (o): AnswerEvaluation => {
      if (!o || typeof o !== "object" || !o.scores) throw new Error("evaluation: missing scores");
      const rawScores: Record<string, number> = {};
      for (const c of criteriaFor(p.stage)) {
        if (!Number.isFinite(Number(o.scores[c]))) throw new Error(`evaluation: missing score ${c}`);
        rawScores[c] = clampInt(o.scores[c]);
      }
      if (!verdictsFor(p.stage).includes(o.verdict)) throw new Error(`evaluation: bad verdict ${o.verdict}`);
      const scores = calibrateScores(rawScores, o.verdict, p.answer);
      return {
        verdict: o.verdict,
        scores,
        rawScores,
        feedback: String(o.feedback || ""),
        improvementTip: String(o.improvement_tip || ""),
        weakTopics: Array.isArray(o.weak_topics) ? o.weak_topics.map(String) : [],
        questionScore: questionScore(scores, p.stage),
      };
    },
  }));
  const crit = Object.entries(ev.scores).map(([c, v]) => `${c}=${ev.rawScores[c]}->${v}`).join(" ");
  console.log(`[ai] evaluate ${p.stage}/${p.topic}: ${ev.verdict} ${ev.questionScore}/10 (${crit}) ${Date.now() - started}ms`);
  return ev;
}

/** Model-written narrative for the report. Numbers/decision must already be computed by the caller. */
export function writeReportText(p: {
  reportType: "candidate" | "hr"; role: string; level: string; basicScore: number; technicalScore: number;
  overall: number; decision: string; results: ReportResultLine[]; passMark10: number;
}): Promise<ReportText> {
  return aiQueue.add(() => callModel({
    system: REPORT_SYSTEM,
    user: reportUserMessage(p),
    maxTokens: 600, schema: reportSchema(p.reportType), schemaName: "report",
    validate: (o): ReportText => {
      const keys = p.reportType === "candidate"
        ? ["summary", "strengths", "areas_to_improve", "learning_plan"]
        : ["summary", "strengths", "concerns", "recommendation"];
      for (const k of keys) if (!(k in o)) throw new Error(`report: missing ${k}`);
      // The training data used a 6.0/10 pass mark in its wording; replace it with the configured one.
      const fixPass = (s: string) => String(s).replace(/\b\d+(?:\.\d)? pass mark\b/g, `${p.passMark10.toFixed(1)} pass mark`);
      const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => fixPass(String(x))) : []);
      return p.reportType === "candidate"
        ? { summary: fixPass(o.summary), strengths: arr(o.strengths), areasToImprove: arr(o.areas_to_improve), learningPlan: arr(o.learning_plan) }
        : { summary: fixPass(o.summary), strengths: arr(o.strengths), concerns: arr(o.concerns), recommendation: fixPass(o.recommendation) };
    },
  }));
}
