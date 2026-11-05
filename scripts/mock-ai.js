/**
 * Mock AIRecruitX model server for QA (OpenAI-compatible, like the vLLM/Modal deployment),
 * so tests never spend Modal credits.
 *
 *   node scripts/mock-ai.js                     # http://localhost:8001
 *   MOCK_FAIL_FIRST=3 node scripts/mock-ai.js   # first 3 requests -> 503 "no upstreams available"
 *   PORT=8001 MOCK_DELAY_MS=50 node scripts/mock-ai.js
 *
 * Point the backend at it through the process env (not .env): AI_BASE_URL=http://localhost:8001
 *
 * Deterministic evaluation for tests: an answer containing "[raw=N]" gets N for every criterion
 * (verdict from N); other answers get a simple length/key-point heuristic.
 *
 * Test control (not part of the real API):
 *   POST /__mock/config {failFirst?, delayMs?}   GET /__mock/stats   POST /__mock/reset
 */
const path = require("path");
const express = require("express");

const PORT = Number(process.env.PORT || 8001);
const BANK = require(path.join(__dirname, "..", "src", "ai", "question_bank.json"));

let failFirst = Number(process.env.MOCK_FAIL_FIRST || 0);
let delayMs = Number(process.env.MOCK_DELAY_MS || 50);
let stats;
const resetStats = () => (stats = { requests: 0, failed: 0, models: 0, qgen: 0, eval: 0, report: 0, schemaErrors: [] });
resetStats();

const field = (u, name) => (u.match(new RegExp(`^${name}: (.*)$`, "m")) || [])[1] || "";
const clamp = (x) => Math.max(0, Math.min(10, Math.round(x)));
const TECH = ["technical_accuracy", "completeness", "problem_solving", "communication"];
const BASIC = ["relevance", "structure", "communication", "professionalism"];

function evaluate(user) {
  const stage = field(user, "stage");
  const topic = field(user, "topic");
  const answer = user.split("\nanswer: ").slice(1).join("\nanswer: ");
  const crits = stage === "technical" ? TECH : BASIC;
  const forced = answer.match(/\[raw=(\d+)\]/);
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  const raw = forced ? clamp(Number(forced[1])) : words < 3 ? 0 : clamp(2 + Math.min(words, 40) / 8);
  const verdict = stage === "technical"
    ? (raw === 0 ? "no_answer" : raw >= 7 ? "correct" : raw >= 4 ? "partially_correct" : "incorrect")
    : (raw === 0 ? "no_answer" : raw >= 7 ? "strong" : raw >= 4 ? "adequate" : "weak");
  return {
    verdict,
    scores: Object.fromEntries(crits.map((c) => [c, raw])),
    feedback: raw >= 7 ? "Good answer that covers the main idea." : "Partly correct; some key points are missing.",
    improvement_tip: "Give one concrete example.",
    weak_topics: raw >= 7 ? [] : [topic],
  };
}

function generate(user) {
  const stage = field(user, "stage");
  const topics = field(user, "topics").split(",").map((s) => s.trim());
  const count = Number(field(user, "count")) || 5;
  let pool = BANK.filter((q) => q.stage === stage && topics.includes(q.topic));
  if (pool.length < count) pool = BANK.filter((q) => q.stage === stage);
  pool = [...pool].sort(() => Math.random() - 0.5).slice(0, count);
  return { questions: pool.map((q) => ({ question: q.question, topic: q.topic, key_points: q.key_points })) };
}

function report(user) {
  const type = field(user, "report_type");
  const o = field(user, "overall_score");
  const summary = `${type === "candidate" ? "You" : "The candidate"} scored ${o}/10 overall.`;
  return type === "candidate"
    ? { summary, strengths: ["Clear answers."], areas_to_improve: ["Add more depth."], learning_plan: ["Practise one topic a day."] }
    : { summary, strengths: ["Clear answers."], concerns: ["Could add more depth."], recommendation: "Consider for the next stage." };
}

// Minimal check that our output satisfies the json_schema the backend sent (required keys + enums)
function checkSchema(schema, value, at = "$") {
  const errs = [];
  if (!schema || typeof schema !== "object") return errs;
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${at}: not an object`];
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${at}.${k}: missing`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) errs.push(...checkSchema(s, value[k], `${at}.${k}`));
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${at}: not an array`];
    value.forEach((v, i) => errs.push(...checkSchema(schema.items, v, `${at}[${i}]`)));
  } else if (schema.type === "string") {
    if (typeof value !== "string") errs.push(`${at}: not a string`);
    if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: ${value} not in enum`);
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) errs.push(`${at}: not an integer`);
  }
  return errs;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.post("/__mock/config", (req, res) => {
  if (req.body.failFirst !== undefined) failFirst = Number(req.body.failFirst);
  if (req.body.delayMs !== undefined) delayMs = Number(req.body.delayMs);
  res.json({ failFirst, delayMs });
});
app.get("/__mock/stats", (_req, res) => res.json({ ...stats, failFirst }));
app.post("/__mock/reset", (_req, res) => { resetStats(); res.json(stats); });

// Cold-start simulation: the first `failFirst` model requests get 503 like the Modal gateway
app.use("/v1", (_req, res, next) => {
  stats.requests++;
  if (failFirst > 0) {
    failFirst--;
    stats.failed++;
    return res.status(503).json({ error: "no upstreams available" });
  }
  setTimeout(next, delayMs);
});

app.get("/v1/models", (_req, res) => {
  stats.models++;
  res.json({ object: "list", data: [{ id: "airecruitx", object: "model" }] });
});

app.post("/v1/chat/completions", (req, res) => {
  const sys = req.body.messages?.[0]?.content || "";
  const user = req.body.messages?.[1]?.content || "";
  const kind = sys.includes("answer evaluator") ? "eval" : sys.includes("interviewer") ? "qgen" : "report";
  stats[kind]++;
  const out = kind === "eval" ? evaluate(user) : kind === "qgen" ? generate(user) : report(user);
  const schema = req.body.response_format?.json_schema?.schema;
  const errs = checkSchema(schema, out);
  if (errs.length) stats.schemaErrors.push({ kind, errs: errs.slice(0, 5) });
  res.json({ choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(out) }, finish_reason: "stop" }] });
});

app.listen(PORT, () => console.log(`[mock-ai] listening on http://localhost:${PORT} (failFirst ${failFirst}, delay ${delayMs}ms)`));
