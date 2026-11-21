/**
 * End-to-end QA suite for the backend.   npm run test:qa
 *
 * Starts everything it needs, isolated from your real setup:
 *   - an in-memory MongoDB (mongodb-memory-server)  -> your MONGO_URI database is never touched
 *     (or QA_ATLAS_TEST_DB=1: a new temporary database on the .env cluster, dropped at the end)
 *   - scripts/mock-ai.js on :8001                    -> no Modal credits are spent
 *   - the backend (src/server.ts via ts-node) on :5055, several times with different env
 * All overrides go through the child process env; .env is not modified, and no env value is
 * printed. Backend logs go to <os tmp>/airecruitx-qa/.
 *
 * Takes about 6-8 minutes (timer tests wait for real expiry; retry tests wait for real backoff).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const API_PORT = 5055;
const MOCK_PORT = Number(process.env.MOCK_PORT || 8001);
const API = `http://localhost:${API_PORT}`;
const MOCK = `http://localhost:${MOCK_PORT}`;
const LOG_DIR = path.join(os.tmpdir(), "airecruitx-qa");
fs.mkdirSync(LOG_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let current = "";
function record(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
async function test(name, fn) {
  current = name;
  try {
    const r = await fn();
    if (r === undefined || r === true) record(name, true);
    else if (r === false) record(name, false);
    else record(name, r.ok, r.detail);
  } catch (err) {
    record(name, false, `error: ${err?.message ?? err}`);
  }
}
const near = (v, target, tol) => typeof v === "number" && Math.abs(v - target) <= tol;

// Auth routes are rate limited per IP. Tests give each simulated client its own address through
// X-Forwarded-For (the backend runs with TRUST_PROXY_HOPS=1), so unrelated tests don't share limits.
let ipSeq = 0;
const nextIp = () => { ipSeq++; return `10.77.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };

async function api(method, p, { body, token, base = API, ip } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { "X-Forwarded-For": ip } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, data: json.data, headers: res.headers };
}

// ------------------------------------------------------------ processes
const children = new Set();
function spawnNode(name, args, env) {
  const logFile = path.join(LOG_DIR, `${name}.log`);
  fs.writeFileSync(logFile, "");
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  child.log = "";
  const onData = (d) => { child.log += d; fs.appendFileSync(logFile, d); };
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.exited = false;
  child.on("exit", (code) => { child.exited = true; child.exitCode = code; children.delete(child); });
  child.logFile = logFile;
  children.add(child);
  return child;
}
async function stopChild(child) {
  if (!child || child.exited) return;
  child.kill();
  for (let i = 0; i < 50 && !child.exited; i++) await sleep(100);
}
async function waitFor(url, ms, child) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child?.exited) throw new Error(`process exited early (code ${child.exitCode}); see ${child.logFile}`);
    try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${url} not up after ${ms}ms`);
}

let mongoUri;
const BASE_ENV = () => ({
  PORT: String(API_PORT),
  MONGO_URI: mongoUri,
  NODE_ENV: "test",
  AI_BASE_URL: MOCK,
  AI_API_KEY: "", // never send the real key to the mock
  AI_JSON_SCHEMA: "true",
  SMTP_USER: "", SMTP_PASS: "", // no real emails from tests
  INTERVIEW_BASIC_QUESTIONS: "5", INTERVIEW_TECHNICAL_QUESTIONS: "8",
  ROUND2_UNLOCK_SCORE: "50", CERTIFICATE_PASS_SCORE: "70",
  BASIC_INTERVIEW_MINUTES: "10", TECHNICAL_INTERVIEW_MINUTES: "20", ORG_INTERVIEW_MINUTES: "20",
  SCORE_SCALE: "1.15", SCORE_OFFSET: "0.8", SCORE_FLOOR_CORRECT: "6",
  TRUST_PROXY_HOPS: "1", // lets tests set the client IP with X-Forwarded-For
});
async function startBackend(name, extra = {}) {
  const env = { ...process.env, ...BASE_ENV(), ...extra };
  const child = spawnNode(`backend-${name}`, ["-r", "ts-node/register/transpile-only", "src/server.ts"], env);
  await waitFor(`${API}/health`, 90_000, child);
  return child;
}
async function startMock(extra = {}) {
  const child = spawnNode("mock-ai", ["scripts/mock-ai.js"], { ...process.env, PORT: String(MOCK_PORT), MOCK_DELAY_MS: "30", ...extra });
  await waitFor(`${MOCK}/__mock/stats`, 15_000, child);
  return child;
}

// ------------------------------------------------------------ helpers
let userSeq = 0;
async function makeUser(role = "candidate", tag = "u") {
  const email = `qa-${tag}-${Date.now()}-${userSeq++}@example.com`;
  const password = "Passw0rd!qa";
  const ip = nextIp();
  const s = await api("POST", "/api/auth/signup", { ip, body: { name: `QA ${tag}`, email, password, role } });
  if (s.status !== 201) throw new Error(`signup ${s.status}: ${s.json.message}`);
  // The API never returns the OTP (it is only emailed), so read it from the test database.
  const stored = await db.collection("users").findOne({ email: email.toLowerCase() }, { projection: { emailOtp: 1 } });
  const v = await api("POST", "/api/auth/verify-email", { ip, body: { email, otp: stored?.emailOtp } });
  if (v.status !== 200) throw new Error(`verify ${v.status}: ${v.json.message}`);
  return { email, password, ip, token: v.data.token, id: String(v.data.user.id) };
}
const answerText = (tag, n, raw) => `${tag} answer for question ${n}: I would explain the main idea clearly with an example [raw=${raw}]`;

/** Answers every question; returns { final, statuses, answers } */
async function runRound(user, stage, raw, { track = "fullstack", tag = user.email } = {}) {
  const start = await api("POST", "/api/interview/start", { token: user.token, body: { stage, track } });
  if (start.status !== 200) throw new Error(`start ${stage} -> ${start.status}: ${start.json.message}`);
  let s = start.data;
  const statuses = [];
  const answers = [];
  while (s.status === "in_progress") {
    const a = answerText(tag, s.questionNumber, typeof raw === "function" ? raw(s.questionNumber) : raw);
    answers.push({ n: s.questionNumber, a });
    const r = await api("POST", "/api/interview/answer", { token: user.token, body: { sessionId: s.sessionId, answer: a } });
    statuses.push(r.status);
    if (r.status !== 200) throw new Error(`answer Q${s.questionNumber} -> ${r.status}: ${r.json.message}`);
    s = r.data;
  }
  return { start: start.data, final: s, statuses, answers };
}

let db;
async function connectDb() {
  const mongoose = require("mongoose");
  const conn = await mongoose.createConnection(mongoUri).asPromise();
  db = conn.db;
  return conn;
}
const oid = (id) => new (require("mongoose").Types.ObjectId)(String(id));
const sessionDoc = (id) => db.collection("interviewsessions").findOne({ _id: oid(id) });
async function waitDoc(id, pred, ms) {
  const until = Date.now() + ms;
  for (;;) {
    const d = await sessionDoc(id);
    if (pred(d) || Date.now() > until) return d;
    await sleep(1000);
  }
}

// ============================================================ suites
function unitTests() {
  console.log("\n=== Unit: calibration + scoring ===");
  for (const k of ["SCORE_SCALE", "SCORE_OFFSET", "SCORE_FLOOR_CORRECT"]) delete process.env[k]; // code defaults
  require("ts-node").register({ transpileOnly: true, project: path.join(ROOT, "tsconfig.json") });
  const { calibrateScores } = require(path.join(ROOT, "src/ai/calibration"));
  const sc = require(path.join(ROOT, "src/ai/scoring"));
  const cfg = require(path.join(ROOT, "src/config/ai"));
  const long = "this answer has more than five words in it";
  const c = (raw, verdict = "partially_correct", ans = long) => calibrateScores({ a: raw }, verdict, ans).a;
  return Promise.all([
    test("calibrateScores: raw 4 -> 5.4", () => ({ ok: c(4) === 5.4, detail: `got ${c(4)}` })),
    test("calibrateScores: raw 6 -> 7.7", () => ({ ok: c(6) === 7.7, detail: `got ${c(6)}` })),
    test("calibrateScores: max 10 (raw 10 / raw 9)", () => ({ ok: c(10) === 10 && c(9) === 10, detail: `${c(10)}, ${c(9)}` })),
    test("calibrateScores: verdict correct -> floor 6", () => ({ ok: c(2, "correct") === 6 && c(2, "strong") === 6 && c(2, "incorrect") === 3.1, detail: `${c(2, "correct")} / ${c(2, "strong")} / ${c(2, "incorrect")}` })),
    test("calibrateScores: < 5 words -> raw unchanged", () => ({ ok: c(4, "correct", "four words only here") === 4 && c(0, "no_answer", "") === 0 })),
    test("overall = 0.4*basic + 0.6*technical", () => ({ ok: sc.overallScore(5, 8) === 6.8 && sc.overallScore(7.5, 6.5) === 6.9, detail: `${sc.overallScore(5, 8)}, ${sc.overallScore(7.5, 6.5)}` })),
    test("HR decision: shortlist >=7, hold 5-7, reject <5", () => ({
      ok: sc.hrDecision(7) === "shortlist" && sc.hrDecision(6.9) === "hold" && sc.hrDecision(5) === "hold" && sc.hrDecision(4.9) === "reject",
    })),
    test("thresholds: unlock 50, certificate 70", () => ({ ok: cfg.ROUND2_UNLOCK_SCORE === 50 && cfg.passScore100() === 70 })),
  ]).then(practiceBankUnitTests);
}

// Practice question bank (src/ai/practice_questions.json): selection rules, checked on many random draws.
async function practiceBankUnitTests() {
  console.log("\n=== Unit: practice question bank ===");
  const pb = require(path.join(ROOT, "src/ai/practiceBank"));
  const data = require(path.join(ROOT, "src/ai/practice_questions.json"));
  const norm = (q) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byQ = new Map();
  for (const q of data) { const k = norm(q.question); byQ.set(k, [...(byQ.get(k) || []), q]); }
  const entry = (q, pred) => (byQ.get(norm(q.question)) || []).find(pred);
  const TRACK_IDS = ["frontend", "backend", "fullstack", "data_ai", "software_engineer"];
  const RUNS = 40;

  await test("practice bank: loads + validates (528 questions, no errors)", () => {
    const logs = [];
    const orig = { log: console.log, warn: console.warn, error: console.error };
    console.log = console.warn = console.error = (m) => logs.push(String(m));
    let ok;
    try { ok = pb.validatePracticeBank(); } finally { Object.assign(console, orig); }
    return { ok: ok === true && logs.some((l) => /loaded 528 practice questions \(0 error/.test(l)), detail: logs.join(" | ") };
  });
  await test(`practice bank: basic order intro / 3 generic (different topics) / closing (${RUNS} draws)`, () => {
    let bad = "";
    for (let i = 0; i < RUNS && !bad; i++) {
      const { questions: qs } = pb.selectPracticeQuestions("basic", "backend");
      const slots = qs.map((q) => entry(q, (e) => e.stage === "basic")?.slot);
      const genericTopics = new Set(qs.slice(1, 4).map((q) => q.topic));
      if (qs.length !== 5 || slots.join() !== "intro,generic,generic,generic,closing") bad = `slots ${slots}`;
      else if (genericTopics.size !== 3) bad = `generic topics ${[...genericTopics]}`;
      else if (!qs.every((q) => q.level === "general" && q.source === "bank" && q.stage === "basic" && q.keyPoints.length)) bad = "fields";
      else if (new Set(qs.map((q) => norm(q.question))).size !== 5) bad = "duplicate";
    }
    return { ok: !bad, detail: bad || "all draws ok" };
  });
  await test(`practice bank: technical 2 easy / 4 medium / 2 hard, selected track only, no duplicates (${RUNS} draws x 5 tracks)`, () => {
    let bad = "";
    for (const track of TRACK_IDS) {
      for (let i = 0; i < RUNS && !bad; i++) {
        const { questions: qs, warnings } = pb.selectPracticeQuestions("technical", track);
        const levels = qs.map((q) => q.level).join();
        if (levels !== "easy,easy,medium,medium,medium,medium,hard,hard") bad = `${track}: levels ${levels}`;
        else if (!qs.every((q) => entry(q, (e) => e.track === track && e.level === q.level && e.topic === q.topic))) bad = `${track}: question from another track/level`;
        else if (new Set(qs.map((q) => norm(q.question))).size !== 8) bad = `${track}: duplicate`;
        else if (warnings.length) bad = `${track}: unexpected warnings ${warnings}`;
      }
    }
    return { ok: !bad, detail: bad || "all draws ok" };
  });
  await test("practice bank: no repeats from the last 5 sessions (generic + technical); intro/closing differ from the last session", () => {
    let bad = "";
    for (const stage of ["basic", "technical"]) {
      const sessions = [];
      for (let i = 0; i < 12 && !bad; i++) {
        const prev = sessions.slice(-5);
        const recent = prev.flat();
        const last = prev.length ? prev[prev.length - 1] : [];
        const { questions, warnings } = pb.selectPracticeQuestions(stage, "fullstack", { recent, last });
        const qs = questions.map((q) => q.question);
        const checked = stage === "basic" ? qs.slice(1, 4) : qs;
        const repeated = checked.filter((q) => recent.map(norm).includes(norm(q)));
        if (repeated.length) bad = `${stage} session ${i}: repeated ${repeated[0]}`;
        else if (stage === "basic" && last.length && (norm(qs[0]) === norm(last[0]) || norm(qs[4]) === norm(last[4]))) bad = `basic session ${i}: intro/closing same as last session`;
        else if (warnings.length) bad = `${stage} session ${i}: warnings ${warnings}`;
        sessions.push(qs);
      }
    }
    return { ok: !bad, detail: bad || "12 consecutive sessions per stage" };
  });
  await test("practice bank: whole track already asked -> reuses recent questions with a warning, order kept", () => {
    const all = data.filter((q) => q.track === "backend").map((q) => q.question);
    const { questions: qs, warnings } = pb.selectPracticeQuestions("technical", "backend", { recent: all, last: [] });
    const levels = qs.map((q) => q.level).join();
    return {
      ok: levels === "easy,easy,medium,medium,medium,medium,hard,hard" && new Set(qs.map((q) => norm(q.question))).size === 8
        && warnings.length === 3 && warnings.every((w) => /reusing questions from recent sessions/.test(w)),
      detail: `levels ${levels}, warnings ${warnings.length}`,
    };
  });
  await test("practice bank: evaluator level easy->beginner, medium->intermediate, hard->intermediate, basic general", () => ({
    ok: pb.EVAL_LEVEL.easy === "beginner" && pb.EVAL_LEVEL.medium === "intermediate" && pb.EVAL_LEVEL.hard === "intermediate" && pb.EVAL_LEVEL.general === "general",
    detail: JSON.stringify(pb.EVAL_LEVEL),
  }));
}

// End to end: practice rounds take their questions from the bank (no question-generation call)
// and every evaluation request carries the mapped level.
async function practiceFlowTests() {
  const u = await makeUser("candidate", "pbank");
  const levelCount = (reqs) => reqs.reduce((m, r) => ({ ...m, [r.level]: (m[r.level] || 0) + 1 }), {});
  const stats = async () => (await api("GET", "/__mock/stats", { base: MOCK })).json;

  await api("POST", "/__mock/reset", { base: MOCK });
  const basic = await runRound(u, "basic", 8, { track: "backend", tag: "pbank" });
  const sBasic = await stats();
  const basicDoc = await sessionDoc(basic.start.sessionId);
  await test(`[${current_phase}] practice basic: bank questions, no generateQuestions call, eval level "general"`, () => {
    const levels = levelCount(sBasic.evalRequests);
    return {
      ok: sBasic.qgen === 0 && basic.final.status === "completed" && basic.start.level === "general"
        && basicDoc.selectedQuestions.length === 5 && basicDoc.selectedQuestions.every((q) => q.source === "bank" && q.level === "general")
        && basicDoc.turns.every((t) => t.level === "general") && sBasic.evalRequests.length === 5 && levels.general === 5,
      detail: `qgen ${sBasic.qgen}, view level ${basic.start.level}, eval levels ${JSON.stringify(levels)}, score ${basic.final.score}`,
    };
  });

  const techRuns = [];
  for (let i = 0; i < 2; i++) {
    await api("POST", "/__mock/reset", { base: MOCK });
    const run = await runRound(u, "technical", 8, { track: "backend", tag: `pbank-t${i}` });
    techRuns.push({ run, st: await stats(), doc: await sessionDoc(run.start.sessionId) });
  }
  await test(`[${current_phase}] practice technical: 2 easy / 4 medium / 2 hard from the track, eval beginner x2 + intermediate x6, no qgen`, () => {
    const { run, st, doc } = techRuns[0];
    const levels = doc.selectedQuestions.map((q) => q.level).join();
    const evalLevels = levelCount(st.evalRequests);
    return {
      ok: st.qgen === 0 && run.final.status === "completed" && run.start.level === "easy" && levels === "easy,easy,medium,medium,medium,medium,hard,hard"
        && doc.turns.map((t) => t.level).join() === levels && st.evalRequests.length === 8 && evalLevels.beginner === 2 && evalLevels.intermediate === 6
        && !evalLevels.expert && doc.track === "backend",
      detail: `qgen ${st.qgen}, levels ${levels}, eval levels ${JSON.stringify(evalLevels)}, view level ${run.start.level}`,
    };
  });
  await test(`[${current_phase}] practice technical: next session repeats no question, still no qgen`, () => {
    const a = techRuns[0].doc.selectedQuestions.map((q) => q.question);
    const b = techRuns[1].doc.selectedQuestions.map((q) => q.question);
    const overlap = b.filter((q) => a.includes(q));
    return { ok: overlap.length === 0 && new Set(b).size === 8 && techRuns[1].st.qgen === 0, detail: `overlap ${overlap.length}, qgen ${techRuns[1].st.qgen}` };
  });
}

async function authTests() {
  const u = await makeUser("candidate", "auth");
  await test(`[${current_phase}] auth: login correct password -> 200`, async () => {
    const r = await api("POST", "/api/auth/login", { ip: u.ip, body: { email: u.email, password: u.password } });
    return { ok: r.status === 200 && !!r.data?.token, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] auth: login wrong password -> 401`, async () => {
    const r = await api("POST", "/api/auth/login", { ip: u.ip, body: { email: u.email, password: "wrong-pass" } });
    return { ok: r.status === 401, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] auth: protected route without token -> 401`, async () => {
    const a = await api("GET", "/api/auth/me");
    const b = await api("POST", "/api/interview/start", { body: { stage: "basic" } });
    return { ok: a.status === 401 && b.status === 401, detail: `me ${a.status}, start ${b.status}` };
  });
}

const RATE_LIMIT_MESSAGE = /^Too many requests\. Please try again in (\d+) seconds\.$/;
const is429 = (r, maxSeconds) => {
  const m = RATE_LIMIT_MESSAGE.exec(r.json.message ?? "");
  const retryAfter = Number(r.headers.get("retry-after"));
  return r.status === 429 && r.json.success === false && !!m
    && Number(m[1]) === retryAfter && retryAfter >= 1 && retryAfter <= maxSeconds;
};

async function rateLimitTests() {
  const u = await makeUser("candidate", "rl");
  await test(`[${current_phase}] rate limit: 11th login for one email -> 429 + Retry-After, same message as before`, async () => {
    const codes = [];
    let last;
    for (let i = 0; i < 11; i++) {
      // a new IP every time, so only the per-email limit (10 / 15 min) can trigger
      last = await api("POST", "/api/auth/login", { ip: nextIp(), body: { email: u.email, password: "wrong-pass" } });
      codes.push(last.status);
    }
    const okCodes = codes.slice(0, 10).every((c) => c === 401);
    return { ok: okCodes && is429(last, 15 * 60), detail: `codes ${codes.join(",")}, retry-after ${last.headers.get("retry-after")}, "${last.json.message}"` };
  });
  await test(`[${current_phase}] rate limit: 11th signup from one IP -> 429 (per-IP limit)`, async () => {
    const ip = nextIp();
    const codes = [];
    let last;
    for (let i = 0; i < 11; i++) {
      last = await api("POST", "/api/auth/signup", {
        ip, body: { name: "QA rl", email: `qa-rlip-${Date.now()}-${i}@example.com`, password: "Passw0rd!qa", role: "candidate" },
      });
      codes.push(last.status);
    }
    const okCodes = codes.slice(0, 10).every((c) => c === 201);
    return { ok: okCodes && is429(last, 15 * 60), detail: `codes ${codes.join(",")}` };
  });
  await test(`[${current_phase}] rate limit: other IPs/emails are not affected`, async () => {
    const r = await api("POST", "/api/auth/login", { ip: nextIp(), body: { email: `qa-unknown-${Date.now()}@example.com`, password: "x" } });
    return { ok: r.status !== 429, detail: `status ${r.status}` };
  });
}

async function answerValidationTests() {
  const u = await makeUser("candidate", "val");
  const s = (await api("POST", "/api/interview/start", { token: u.token, body: { stage: "basic", track: "backend" } })).data;
  await test(`[${current_phase}] answer: valid -> 200`, async () => {
    const r = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("v", 1, 7) } });
    return { ok: r.status === 200 && r.data.questionNumber === 2, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] answer: same question twice at once -> one 200, one 409`, async () => {
    const body = { sessionId: s.sessionId, questionNumber: 2, answer: answerText("dup", 2, 7) };
    const rs = await Promise.all([1, 2].map(() => api("POST", "/api/interview/answer", { token: u.token, body })));
    const codes = rs.map((r) => r.status).sort();
    const doc = await sessionDoc(s.sessionId);
    const q2 = doc.turns.filter((t) => t.questionNumber === 2).length;
    return { ok: codes[0] === 200 && codes[1] === 409 && q2 === 1, detail: `codes ${codes.join(",")}, Q2 turns ${q2}` };
  });
  await test(`[${current_phase}] answer: empty -> 400`, async () => {
    const a = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: "   " } });
    const b = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId } });
    return { ok: a.status === 400 && b.status === 400, detail: `${a.status}, ${b.status}` };
  });
  await test(`[${current_phase}] answer: 5001 chars -> 400`, async () => {
    const r = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: "a".repeat(5001) } });
    return { ok: r.status === 400, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] invalid sessionId -> 400 (not 500)`, async () => {
    const a = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: "not-an-id", answer: "hello there my answer" } });
    const b = await api("GET", "/api/interview/report/not-an-id", { token: u.token });
    const c = await api("POST", "/api/interview/start", { token: u.token, body: { stage: "technical", basicSessionId: "xyz" } });
    return { ok: a.status === 400 && b.status === 400 && c.status === 400, detail: `answer ${a.status}, report ${b.status}, start ${c.status}` };
  });
  return { user: u, session: s };
}

async function fullFlowTests() {
  const a = await makeUser("candidate", "flow");
  const other = await makeUser("candidate", "other");

  await test(`[${current_phase}] Round 2 without Round 1 -> blocked (400)`, async () => {
    const r = await api("POST", "/api/interview/start", { token: a.token, body: { stage: "technical", track: "fullstack" } });
    return { ok: r.status === 400, detail: `status ${r.status}: ${r.json.message}` };
  });

  let r1;
  await test(`[${current_phase}] basic start: questions + expiresAt + remainingSeconds ~600`, async () => {
    r1 = await runRound(a, "basic", 8);
    const st = r1.start;
    return {
      ok: !!st.question && st.totalQuestions === 5 && !!st.expiresAt && near(st.remainingSeconds, 600, 5),
      detail: `total ${st.totalQuestions}, remaining ${st.remainingSeconds}`,
    };
  });
  await test(`[${current_phase}] Round 1 complete -> report + Round 2 unlocked (>=50)`, async () => {
    const f = r1.final;
    return { ok: f.status === "completed" && f.round2Unlocked === true && f.score >= 50 && !!f.report?.summary, detail: `score ${f.score}` };
  });
  let r2;
  await test(`[${current_phase}] technical start: remainingSeconds ~1200`, async () => {
    r2 = await runRound(a, "technical", 7);
    return { ok: near(r2.start.remainingSeconds, 1200, 5) && r2.start.totalQuestions === 8, detail: `remaining ${r2.start.remainingSeconds}` };
  });
  await test(`[${current_phase}] full interview -> report by: model, overall = 0.4*basic + 0.6*tech`, async () => {
    const f = r2.final;
    const rep = f.report || {};
    const expected = Math.round((0.4 * rep.basicScore + 0.6 * rep.technicalScore) * 10) / 10;
    return {
      ok: f.status === "completed" && rep.generatedBy === "model" && Math.abs(rep.overallScore - expected) <= 0.05 && f.score === Math.round(rep.overallScore * 10),
      detail: `by ${rep.generatedBy}, basic ${rep.basicScore}, tech ${rep.technicalScore}, overall ${rep.overallScore}`,
    };
  });
  await test(`[${current_phase}] certificate: pass iff score >= 70`, async () => {
    const f = r2.final;
    return { ok: (f.score >= 70) === (f.result === "pass") && f.certificateEligible === (f.score >= 70), detail: `score ${f.score}, result ${f.result}` };
  });
  await test(`[${current_phase}] rawScores saved in DB, criteria calibrated`, async () => {
    const d = await sessionDoc(r2.final.sessionId);
    const t = d.turns[0];
    const rawOk = d.turns.every((x) => x.rawScores && Object.values(x.rawScores).every((v) => v === 7));
    const calOk = d.turns.every((x) => Object.values(x.criteria).every((v) => v === 8.9)); // 7*1.15+0.8
    return { ok: rawOk && calOk, detail: `raw ${JSON.stringify(t.rawScores)} -> ${JSON.stringify(t.criteria)}` };
  });
  await test(`[${current_phase}] other user's session -> 403/404`, async () => {
    const x = await api("GET", `/api/interview/report/${r2.final.sessionId}`, { token: other.token });
    const y = await api("POST", "/api/interview/answer", { token: other.token, body: { sessionId: r1.start.sessionId, answer: "trying to answer someone else's interview" } });
    return { ok: [403, 404].includes(x.status) && [403, 404].includes(y.status), detail: `report ${x.status}, answer ${y.status}` };
  });

  const weak = await makeUser("candidate", "weak");
  await test(`[${current_phase}] Round 1 below 50 -> Round 2 locked (403)`, async () => {
    const w = await runRound(weak, "basic", 2);
    const r = await api("POST", "/api/interview/start", { token: weak.token, body: { stage: "technical" } });
    return { ok: w.final.score < 50 && w.final.round2Unlocked === false && r.status === 403, detail: `score ${w.final.score}, start ${r.status}` };
  });
}

async function orgInviteTests() {
  const hr = await makeUser("hr", "hr");
  const cand = await makeUser("candidate", "orgc");
  const cand2 = await makeUser("candidate", "orgc2");
  const job = await api("POST", "/api/jobs", { token: hr.token, body: { title: "Backend Developer", description: "Node.js APIs", requiredSkills: ["Node.js", "MongoDB"] } });
  if (job.status !== 201 && job.status !== 200) throw new Error(`create job ${job.status}: ${job.json.message}`);
  const jobId = job.data._id || job.data.id;
  // HR must upload a question pool before inviting anyone to an org interview.
  await db.collection("orginterviewquestionsets").insertOne({
    jobId: oid(jobId), hrId: oid(hr.id), questionsPerInterview: 3,
    questions: [1, 2, 3, 4].map((n) => ({
      question: `Explain concept ${n} of building Node.js APIs.`,
      referenceAnswer: `Concept ${n}: routing, validation, error handling and tests.`,
      marks: 10,
    })),
    createdAt: new Date(), updatedAt: new Date(),
  });
  const apps = db.collection("applications");
  const mk = async (c) => (await apps.insertOne({
    jobId: oid(jobId), candidateId: oid(c.id), resumeSnapshotSkills: ["Node.js"], matchScore: 100, matched: true,
    status: "selected", aiInterview: { scheduled: false }, orgInterview: {}, createdAt: new Date(), updatedAt: new Date(),
  })).insertedId;
  const appId = await mk(cand);
  const appId2 = await mk(cand2);
  const invite = async (id) => api("POST", `/api/applications/${id}/org-interview-invite`, { token: hr.token, body: {} });
  const i1 = await invite(appId);
  const i2 = await invite(appId2);
  const token1 = (await apps.findOne({ _id: appId })).orgInterview?.token;
  const token2 = (await apps.findOne({ _id: appId2 })).orgInterview?.token;

  await test(`[${current_phase}] org invite: timer 20 + 3 warm-up min (remainingSeconds ~1380)`, async () => {
    const g = await api("GET", `/api/applications/org-interview/${token1}`);
    const s = await api("POST", `/api/applications/org-interview/${token1}/start`);
    return {
      ok: i1.status === 200 && g.status === 200 && s.status === 200 && near(s.data.remainingSeconds, 1380, 5),
      detail: `invite ${i1.status}, landing ${g.status}, start ${s.status}, remaining ${s.data?.remainingSeconds}`,
    };
  });
  await test(`[${current_phase}] org invite: expired link -> 410, still works when valid`, async () => {
    await apps.updateOne({ _id: appId2 }, { $set: { "orgInterview.expiresAt": new Date(Date.now() - 60_000) } });
    const g = await api("GET", `/api/applications/org-interview/${token2}`);
    const s = await api("POST", `/api/applications/org-interview/${token2}/start`);
    const status = (await apps.findOne({ _id: appId2 })).orgInterview.status;
    return { ok: i2.status === 200 && g.status === 410 && s.status === 410 && status === "expired", detail: `landing ${g.status}, start ${s.status}, invite ${status}` };
  });
}

// HR question-pool interview: 3 fixed warm-up questions first (never evaluated or scored),
// then exactly questionsPerInterview pool questions, then the closing message.
const WARMUPS = [
  "Hello, welcome to your interview! How are you today?",
  "Could you briefly introduce yourself?",
  "What interests you about this role?",
];
const CLOSING = "Thank you for your time. Your interview is complete. The HR team will review your responses and contact you.";

async function warmupTests() {
  const hr = await makeUser("hr", "whr");
  const job = await api("POST", "/api/jobs", { token: hr.token, body: { title: "API Engineer", description: "REST APIs", requiredSkills: ["Node.js"] } });
  if (job.status !== 201 && job.status !== 200) throw new Error(`create job ${job.status}: ${job.json.message}`);
  const jobId = job.data._id || job.data.id;
  const PER_INTERVIEW = 3;
  const pool = [4, 6, 10, 5, 7].map((marks, i) => ({
    question: `Pool question ${i + 1}: how do you design a reliable REST endpoint?`,
    referenceAnswer: `Validation, idempotency, status codes, error handling and tests (${i + 1}).`,
    marks,
  }));
  await db.collection("orginterviewquestionsets").insertOne({
    jobId: oid(jobId), hrId: oid(hr.id), questionsPerInterview: PER_INTERVIEW, questions: pool,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const poolBefore = JSON.stringify((await db.collection("orginterviewquestionsets").findOne({ jobId: oid(jobId) })).questions);
  const apps = db.collection("applications");
  const invited = async (tag) => {
    const c = await makeUser("candidate", tag);
    const id = (await apps.insertOne({
      jobId: oid(jobId), candidateId: oid(c.id), resumeSnapshotSkills: ["Node.js"], matchScore: 100, matched: true,
      status: "selected", aiInterview: { scheduled: false }, orgInterview: {}, createdAt: new Date(), updatedAt: new Date(),
    })).insertedId;
    const inv = await api("POST", `/api/applications/${id}/org-interview-invite`, { token: hr.token, body: {} });
    if (inv.status !== 200) throw new Error(`invite ${inv.status}: ${inv.json.message}`);
    return { c, appId: id, token: (await apps.findOne({ _id: id })).orgInterview.token };
  };
  const answer = (token, text, questionNumber) =>
    api("POST", `/api/applications/org-interview/${token}/answer`, { body: { answer: text, questionNumber } });

  // ---- full run
  const run = await invited("wflow");
  const start = await api("POST", `/api/applications/org-interview/${run.token}/start`);
  const s0 = start.data;
  await api("POST", "/__mock/reset", { base: MOCK });
  const views = [s0];
  const warmStatuses = [];
  let dup;
  for (let n = 1; n <= 3; n++) {
    const r = await answer(run.token, n === 1 ? "I am fine, thank you." : `Warm-up answer ${n}: I am a backend developer who enjoys APIs.`, n);
    warmStatuses.push(r.status);
    if (n === 1) dup = await answer(run.token, "I am fine, thank you.", 1); // same question again
    views.push(r.data);
  }
  await sleep(1500);
  const evalsAfterWarmup = (await api("GET", "/__mock/stats", { base: MOCK })).json.eval;
  const afterWarmupDoc = await sessionDoc(s0.sessionId);

  await test(`[${current_phase}] warm-up: first 3 questions are the fixed warm-ups, in order`, () => {
    const qs = views.slice(0, 3).map((v) => v.question);
    const kinds = views.slice(0, 3).map((v) => v.kind).join();
    const nums = views.slice(0, 3).map((v) => v.warmupNumber).join();
    const ok = start.status === 200 && JSON.stringify(qs) === JSON.stringify(WARMUPS) && kinds === "warmup,warmup,warmup"
      && nums === "1,2,3" && views.slice(0, 3).every((v) => v.totalWarmup === 3 && v.totalPoolQuestions === PER_INTERVIEW && v.poolQuestionNumber === undefined)
      && JSON.stringify(afterWarmupDoc.selectedQuestions.slice(0, 3).map((q) => q.question)) === JSON.stringify(WARMUPS);
    return { ok, detail: `kinds ${kinds}, warmupNumber ${nums}, totalQuestions ${s0.totalQuestions}` };
  });
  await test(`[${current_phase}] warm-up: no AI evaluation call, turns saved as done without score/marks`, () => {
    const w = afterWarmupDoc.turns.filter((t) => t.kind === "warmup");
    const ok = evalsAfterWarmup === 0 && w.length === 3 && w.every((t) => t.evalStatus === "done" && t.score === undefined
      && t.marksPossible === undefined && t.marksEarned === undefined && t.criteria === undefined);
    return { ok, detail: `mock eval calls ${evalsAfterWarmup}, warm-up turns ${w.length}, statuses ${w.map((t) => t.evalStatus)}, scores ${w.map((t) => t.score)}` };
  });
  await test(`[${current_phase}] warm-up: same atomic guard (duplicate answer -> 409)`, () => ({
    ok: warmStatuses.join() === "200,200,200" && dup.status === 409, detail: `answers ${warmStatuses}, duplicate ${dup.status}`,
  }));
  await test(`[${current_phase}] warm-up: then the pool starts at poolQuestionNumber 1 (kind pool)`, () => {
    const v = views[3];
    return { ok: v.kind === "pool" && v.poolQuestionNumber === 1 && v.warmupNumber === undefined && v.questionNumber === 4,
      detail: `kind ${v.kind}, pool# ${v.poolQuestionNumber}, questionNumber ${v.questionNumber}` };
  });

  let final;
  for (let p = 1; p <= PER_INTERVIEW; p++) {
    const r = await answer(run.token, `Pool answer ${p}: validation, idempotency, status codes, error handling and tests [raw=${5 + p}]`, 3 + p);
    if (r.status !== 200) throw new Error(`pool answer ${p} -> ${r.status}: ${r.json.message}`);
    final = r.data;
  }
  const doc = await sessionDoc(s0.sessionId);
  const evalsTotal = (await api("GET", "/__mock/stats", { base: MOCK })).json.eval;
  const poolTurns = doc.turns.filter((t) => t.kind !== "warmup");
  const poolSelected = doc.selectedQuestions.filter((q) => q.kind !== "warmup");

  await test(`[${current_phase}] warm-up: pool count = questionsPerInterview, HR pool unchanged`, async () => {
    const poolAfter = JSON.stringify((await db.collection("orginterviewquestionsets").findOne({ jobId: oid(jobId) })).questions);
    return { ok: poolSelected.length === PER_INTERVIEW && poolTurns.length === PER_INTERVIEW && doc.selectedQuestions.length === 3 + PER_INTERVIEW && poolAfter === poolBefore,
      detail: `pool selected ${poolSelected.length}, pool turns ${poolTurns.length}, total ${doc.selectedQuestions.length}, pool unchanged ${poolAfter === poolBefore}` };
  });
  await test(`[${current_phase}] warm-up: marks and score count only pool questions`, () => {
    const possible = poolTurns.reduce((s, t) => s + (t.marksPossible ?? 0), 0);
    const earned = poolTurns.reduce((s, t) => s + (t.marksEarned ?? 0), 0);
    const expectedPossible = poolSelected.reduce((s, q) => s + q.marks, 0);
    const expectedOverall = Math.round((earned / possible) * 10 * 10) / 10;
    const ok = evalsTotal === PER_INTERVIEW && possible === expectedPossible && doc.report.overallScore === expectedOverall
      && doc.score === Math.round(expectedOverall * 10) && doc.report.basicScore === undefined && !Number.isNaN(doc.score);
    return { ok, detail: `eval calls ${evalsTotal}, marks ${earned}/${possible} (pool ${expectedPossible}), overall ${doc.report.overallScore}, score ${doc.score}` };
  });
  await test(`[${current_phase}] warm-up: closingMessage on completion, results still hidden from candidate`, async () => {
    const view = await api("POST", `/api/applications/org-interview/${run.token}/start`).catch(() => null);
    return { ok: final.status === "completed" && final.closingMessage === CLOSING && final.score === undefined && final.report === undefined && final.turns.length === 0,
      detail: `status ${final.status}, closingMessage ${JSON.stringify(final.closingMessage)}, score ${final.score}, reopen ${view?.status}` };
  });
  const rep = await api("GET", `/api/applications/${run.appId}/report`, { token: hr.token });
  await test(`[${current_phase}] HR report: introduction (no score) + pool turns with poolQuestionNumber`, () => {
    const o = rep.data?.orgInterviewSession;
    const intro = o?.introduction ?? [];
    const ok = rep.status === 200 && intro.length === 3 && JSON.stringify(intro.map((x) => x.question)) === JSON.stringify(WARMUPS)
      && intro.every((x) => typeof x.answer === "string" && x.score === undefined && x.marksEarned === undefined)
      && o.turns.length === PER_INTERVIEW && o.turns.map((t) => t.poolQuestionNumber).join() === "1,2,3" && o.turns.every((t) => t.kind === "pool");
    return { ok, detail: `status ${rep.status}, introduction ${intro.length}, turns ${o?.turns?.length}, pool# ${o?.turns?.map((t) => t.poolQuestionNumber)}` };
  });
  warmupReportExample = rep.data?.orgInterviewSession;

  // ---- proctoring during the warm-up: 2 warnings, cancelled on the 3rd
  const pr = await invited("wproc");
  await api("POST", `/api/applications/org-interview/${pr.token}/start`);
  await answer(pr.token, "I am fine, thank you.", 1);
  const vio = [];
  for (const type of ["tab_hidden", "window_blur", "fullscreen_exit"]) {
    vio.push((await api("POST", `/api/applications/org-interview/${pr.token}/violation`, { body: { type } })).data);
    await sleep(2100); // past the 2 s de-duplication window
  }
  const afterCancel = await answer(pr.token, "Warm-up answer 2: I build APIs.", 2);
  await test(`[${current_phase}] proctoring during warm-up: 2 warnings, 3rd cancels, answers refused`, () => ({
    ok: vio[0]?.violationCount === 1 && !vio[0].cancelled && vio[1]?.violationCount === 2 && !vio[1].cancelled
      && vio[2]?.violationCount === 3 && vio[2].cancelled === true && afterCancel.status === 409,
    detail: `counts ${vio.map((v) => v?.violationCount)}, cancelled ${vio.map((v) => v?.cancelled)}, answer after ${afterCancel.status}`,
  }));

  // ---- time up during the warm-up: 410, unanswered warm-ups are not turned into 0-mark pool questions
  const tu = await invited("wtime");
  const ts = (await api("POST", `/api/applications/org-interview/${tu.token}/start`)).data;
  await answer(tu.token, "I am fine, thank you.", 1);
  await db.collection("interviewsessions").updateOne({ _id: oid(ts.sessionId) }, { $set: { expiresAt: new Date(Date.now() - 10_000) } });
  const late = await answer(tu.token, "Warm-up answer 2: too late.", 2);
  const ex = await waitDoc(ts.sessionId, (d) => d.status === "expired", 30_000);
  await test(`[${current_phase}] time up during warm-up: 410, only pool questions get 0 marks`, () => {
    const unanswered = ex.turns.filter((t) => t.unanswered);
    const ok = late.status === 410 && ex.status === "expired" && unanswered.length === PER_INTERVIEW
      && unanswered.every((t) => t.kind === "pool" && t.marksEarned === 0) && ex.turns.filter((t) => t.kind === "warmup").length === 1
      && ex.score === 0 && /answered 0 of 3 questions/.test(ex.report.summary);
    return { ok, detail: `answer ${late.status}, status ${ex.status}, unanswered ${unanswered.length} (${unanswered.map((t) => t.kind)}), warm-up turns ${ex.turns.filter((t) => t.kind === "warmup").length}, score ${ex.score}` };
  });
}
let warmupReportExample = null;

async function retryTest() {
  const u = await makeUser("candidate", "retry");
  const s = (await api("POST", "/api/interview/start", { token: u.token, body: { stage: "basic" } })).data;
  await api("POST", "/__mock/reset", { base: MOCK });
  await api("POST", "/__mock/config", { base: MOCK, body: { failFirst: 3 } });
  const t0 = Date.now();
  await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("retry", 1, 7) } });
  await test(`[${current_phase}] AI 503 x3 (no upstreams available) -> retried, evaluation done, no fallback`, async () => {
    const d = await waitDoc(s.sessionId, (x) => x.turns[0]?.evalStatus && x.turns[0].evalStatus !== "pending", 90_000);
    const st = (await api("GET", "/__mock/stats", { base: MOCK })).json;
    const t = d.turns[0];
    return {
      ok: t.evalStatus === "done" && st.failed === 3 && st.eval >= 1 && t.rawScores?.relevance === 7,
      detail: `evalStatus ${t.evalStatus}, mock failed ${st.failed}, eval calls ${st.eval}, ${((Date.now() - t0) / 1000).toFixed(0)}s`,
    };
  });
}

async function concurrencyTest(n = 5) {
  const users = await Promise.all(Array.from({ length: n }, (_, i) => makeUser("candidate", `par${i}`)));
  await test(`[${current_phase}] concurrency: ${n} interviews in parallel -> no 500, answers not mixed`, async () => {
    const runs = await Promise.allSettled(users.map((u, i) => runRound(u, "basic", 6 + (i % 3), { tag: `user${i}` })));
    const errs = runs.filter((r) => r.status === "rejected").map((r) => r.reason.message);
    if (errs.length) return { ok: false, detail: errs.join(" | ") };
    let mixed = 0;
    for (let i = 0; i < n; i++) {
      const { final, answers } = runs[i].value;
      const d = await sessionDoc(final.sessionId);
      if (String(d.userId) !== users[i].id) mixed++;
      for (const t of d.turns) {
        const sent = answers.find((x) => x.n === t.questionNumber);
        if (!sent || sent.a !== t.answer || !t.answer.startsWith(`user${i} `)) mixed++;
      }
      if (d.turns.length !== 5 || final.status !== "completed") mixed++;
    }
    const all = runs.flatMap((r) => r.value.statuses);
    return { ok: mixed === 0 && all.every((c) => c === 200), detail: `${all.length} answers, mixed ${mixed}` };
  });
}

async function timerTests() {
  const c = await makeUser("candidate", "timer");
  const d = await makeUser("candidate", "cron");
  const sc = (await api("POST", "/api/interview/start", { token: c.token, body: { stage: "basic" } })).data;
  const sd = (await api("POST", "/api/interview/start", { token: d.token, body: { stage: "basic" } })).data;
  await test(`[${current_phase}] BASIC_INTERVIEW_MINUTES=1 -> remainingSeconds ~60`, () => ({ ok: near(sc.remainingSeconds, 60, 3), detail: `${sc.remainingSeconds}` }));
  for (const n of [1, 2]) await api("POST", "/api/interview/answer", { token: c.token, body: { sessionId: sc.sessionId, answer: answerText("timer", n, 8) } });
  await api("POST", "/api/interview/answer", { token: d.token, body: { sessionId: sd.sessionId, answer: answerText("cron", 1, 8) } });
  console.log("      ... waiting 65s for the time limit");
  await sleep(65_000);
  await test(`[${current_phase}] answer after time limit -> 410 "Interview time expired"`, async () => {
    const r = await api("POST", "/api/interview/answer", { token: c.token, body: { sessionId: sc.sessionId, answer: answerText("late", 3, 8) } });
    return { ok: r.status === 410 && r.json.message === "Interview time expired", detail: `${r.status} ${r.json.message}` };
  });
  await test(`[${current_phase}] expired session: status "expired", "answered 2 of 5", unanswered questions score 0 and count`, async () => {
    let v;
    for (let i = 0; i < 60; i++) {
      v = (await api("GET", `/api/interview/report/${sc.sessionId}`, { token: c.token })).data;
      if (v.status !== "in_progress") break;
      await sleep(1000);
    }
    const doc = await sessionDoc(sc.sessionId);
    const answered = doc.turns.filter((t) => !t.unanswered);
    const unanswered = doc.turns.filter((t) => t.unanswered);
    const scores = doc.turns.map((t) => t.score);
    const expectedScore = Math.round((scores.reduce((a, b) => a + b, 0) / 5) * 10); // averaged over all 5
    return {
      ok: v.status === "expired" && /answered 2 of 5/.test(v.report?.summary ?? "") && doc.turns.length === 5
        && answered.length === 2 && answered.every((t) => t.score > 0)
        && unanswered.length === 3 && unanswered.every((t) => t.score === 0 && t.verdict === "no_answer")
        && v.score === expectedScore && v.round2Unlocked === (expectedScore >= 50),
      detail: `status ${v.status}, scores ${scores.join("/")}, score ${v.score}, "${(v.report?.summary ?? "").slice(-70)}"`,
    };
  });
  await test(`[${current_phase}] auto-close (no request sent) -> cron marks session expired`, async () => {
    const doc = await waitDoc(sd.sessionId, (x) => x.status !== "in_progress", 60_000);
    const zeros = doc.turns.filter((t) => t.unanswered && t.score === 0).length;
    return { ok: doc.status === "expired" && doc.turns.length === 5 && zeros === 4 && !!doc.report, detail: `status ${doc.status}, turns ${doc.turns.length}, zero-score ${zeros}, score ${doc.score}` };
  });
}

// The last answer is still being finalized (its evaluation is slow) when the time limit passes,
// so page reloads (GET report -> expiry path) and the 30 s sweep try to finish the same session.
async function finalizeOnceTest(backend) {
  const u = await makeUser("candidate", "race");
  const s = (await api("POST", "/api/interview/start", { token: u.token, body: { stage: "basic" } })).data;
  for (let n = 1; n <= 4; n++) {
    await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("race", n, 8) } });
  }
  await waitDoc(s.sessionId, (x) => x.turns.length === 4 && x.turns.every((t) => t.evalStatus === "done"), 30_000);
  await api("POST", "/__mock/config", { base: MOCK, body: { delayMs: 8000 } });
  // deadline (incl. 3 s grace) is now 2 s away
  await db.collection("interviewsessions").updateOne(
    { _id: oid(s.sessionId) }, { $set: { expiresAt: new Date(Date.now() - 3000 + 2000) } },
  );
  await test(`[${current_phase}] last answer + timer at the same time -> session finalized exactly once`, async () => {
    const last = api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("race", 5, 8) } });
    await sleep(3500); // deadline passed while the last answer is still being finalized
    const reloads = await Promise.all(Array.from({ length: 5 }, () => api("GET", `/api/interview/report/${s.sessionId}`, { token: u.token })));
    const r = await last;
    await sleep(2000);
    const doc = await sessionDoc(s.sessionId);
    const commits = (backend.log.match(new RegExp(`session ${s.sessionId} finalized`, "g")) || []).length;
    const failures = (backend.log.match(new RegExp(`session ${s.sessionId} failed`, "g")) || []).length;
    return {
      ok: r.status === 200 && r.data.status === "completed" && doc.status === "completed" && doc.turns.length === 5
        && reloads.every((x) => x.status === 200) && commits === 1 && failures === 0,
      detail: `answer ${r.status}/${r.data?.status}, db ${doc.status}, commits ${commits}, reloads ${reloads.map((x) => x.status).join(",")}`,
    };
  });
  await api("POST", "/__mock/config", { base: MOCK, body: { delayMs: 30 } });

  // Atomic guard on its own: three finalizations of one session at once, bypassing the
  // in-process dedup, in this process against the same database. Only one may commit.
  await test(`[${current_phase}] atomic guard: 3 parallel finalizations of one session -> 1 commit, 2 discarded`, async () => {
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 1) await mongoose.connect(mongoUri);
    const svc = require(path.join(ROOT, "src/candidate/interview/service/interview.service"));
    const src = await sessionDoc(s.sessionId);
    const copy = { ...src, _id: new mongoose.Types.ObjectId(), status: "in_progress", currentQuestionNumber: 5, currentQuestion: src.turns[4].question };
    for (const k of ["report", "score", "result", "feedback"]) delete copy[k];
    await db.collection("interviewsessions").insertOne(copy);
    const id = String(copy._id);
    const lines = [];
    const origLog = console.log;
    console.log = (...a) => { lines.push(a.join(" ")); };
    let done;
    try {
      done = await Promise.all([1, 2, 3].map(() => svc.processInterviewFinalization({ sessionId: id, timeUp: false })));
    } finally {
      console.log = origLog;
    }
    const commits = lines.filter((l) => l.includes(`session ${id} finalized`)).length;
    const discarded = lines.filter((l) => l.includes(`session ${id} was already finalized`)).length;
    const doc = await sessionDoc(id);
    return {
      ok: done.length === 3 && commits === 1 && discarded === 2 && doc.status === "completed" && !!doc.report,
      detail: `commits ${commits}, discarded ${discarded}, status ${doc.status}`,
    };
  });
}

// AI unavailable while answering: the answer is saved and the response is immediate; the
// evaluation fails into "pending_eval"; once the AI is back the final answer retries it.
async function pendingEvalRetryTest() {
  const u = await makeUser("candidate", "peval");
  const s = (await api("POST", "/api/interview/start", { token: u.token, body: { stage: "basic" } })).data;
  await api("POST", "/__mock/config", { base: MOCK, body: { failFirst: 100_000 } });
  const t0 = Date.now();
  const first = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("peval", 1, 7) } });
  const answerMs = Date.now() - t0;
  await test(`[${current_phase}] AI down: answer saved and response immediate (evaluation in background)`, async () => {
    const doc = await sessionDoc(s.sessionId);
    return {
      ok: first.status === 200 && first.data.questionNumber === 2 && answerMs < 3000 && doc.turns.length === 1 && doc.turns[0].evalStatus === "pending",
      detail: `status ${first.status}, ${answerMs}ms, evalStatus ${doc.turns[0]?.evalStatus}`,
    };
  });
  await test(`[${current_phase}] AI down: failed evaluation -> evalStatus "pending_eval"`, async () => {
    const doc = await waitDoc(s.sessionId, (x) => x.turns[0]?.evalStatus !== "pending", 60_000);
    return { ok: doc.turns[0].evalStatus === "pending_eval", detail: `evalStatus ${doc.turns[0].evalStatus}` };
  });
  await api("POST", "/__mock/config", { base: MOCK, body: { failFirst: 0 } });
  await test(`[${current_phase}] AI back: last answer retries "pending_eval" -> evaluated by the model, not estimated`, async () => {
    let v = first.data;
    for (let n = 2; v.status === "in_progress"; n++) {
      const r = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("peval", n, 7) } });
      if (r.status !== 200) return { ok: false, detail: `answer ${n} -> ${r.status} ${r.json.message}` };
      v = r.data;
    }
    const doc = await sessionDoc(s.sessionId);
    return {
      ok: v.status === "completed" && doc.turns.every((t) => t.evalStatus === "done") && doc.turns[0].rawScores?.relevance === 7 && !v.report?.estimatedCount,
      detail: `statuses ${doc.turns.map((t) => t.evalStatus).join(",")}, estimated ${v.report?.estimatedCount ?? 0}`,
    };
  });
}

async function mockDownTest(backend) {
  const u = await makeUser("candidate", "down");
  const s = (await api("POST", "/api/interview/start", { token: u.token, body: { stage: "basic" } })).data;
  await test(`[${current_phase}] AI down -> fails within 300s, scores marked "estimated", server keeps running`, async () => {
    const t0 = Date.now();
    let v = s;
    for (let n = 1; v.status === "in_progress"; n++) {
      const r = await api("POST", "/api/interview/answer", { token: u.token, body: { sessionId: s.sessionId, answer: answerText("down", n, 7) } });
      if (r.status !== 200) return { ok: false, detail: `answer ${n} -> ${r.status} ${r.json.message}` };
      v = r.data;
    }
    const secs = (Date.now() - t0) / 1000;
    const doc = await sessionDoc(s.sessionId);
    const health = await api("GET", "/health");
    const allEst = doc.turns.every((t) => t.evalStatus === "estimated");
    return {
      ok: secs < 300 && v.status === "completed" && allEst && v.report?.estimatedCount === 5 && /estimated/.test(v.report.summary) && health.status === 200 && !backend.exited,
      detail: `${secs.toFixed(0)}s, statuses ${doc.turns.map((t) => t.evalStatus).join(",")}, health ${health.status}`,
    };
  });
}

let current_phase = "";
let dropTestDb = null;
let qaConn = null;
(async () => {
  const started = Date.now();
  let mongo, mock, backend;
  try {
    await unitTests();

    if (process.env.QA_ATLAS_TEST_DB === "1") {
      // Same cluster as .env MONGO_URI but a brand-new database (airecruitx_qa_<time>), dropped at the end.
      // The app's own database is never opened. The URI is never printed.
      const envUri = require("dotenv").parse(fs.readFileSync(path.join(ROOT, ".env"))).MONGO_URI;
      const u = new URL(envUri);
      const appDb = u.pathname.replace(/^\//, "");
      const testDb = `airecruitx_qa_${Date.now()}`;
      if (appDb === testDb) throw new Error("refusing to use the app database");
      u.pathname = `/${testDb}`;
      mongoUri = u.toString();
      dropTestDb = testDb;
      console.log(`Using temporary database ${testDb} on the .env cluster (dropped at the end)`);
    } else {
      const { MongoMemoryServer } = require("mongodb-memory-server");
      mongo = await MongoMemoryServer.create();
      mongoUri = mongo.getUri("airecruitx_qa");
    }
    const conn = await connectDb();
    qaConn = conn;

    // ---------------- A: normal (mock AI up)
    current_phase = "A normal";
    console.log("\n=== Phase A: mock AI ===");
    mock = await startMock({ MOCK_FAIL_FIRST: "2" });
    await test(`[${current_phase}] mock: MOCK_FAIL_FIRST=2 -> 503 "no upstreams available" twice, then 200`, async () => {
      const codes = [];
      let body;
      for (let i = 0; i < 3; i++) { const r = await fetch(`${MOCK}/v1/models`); codes.push(r.status); if (i === 0) body = await r.text(); }
      return { ok: codes.join() === "503,503,200" && /no upstreams available/.test(body), detail: codes.join(",") };
    });
    backend = await startBackend("A");
    await authTests();
    await rateLimitTests();
    await answerValidationTests();
    await fullFlowTests();
    await practiceFlowTests();
    await orgInviteTests();
    await warmupTests();
    await retryTest();
    await concurrencyTest(5);
    await test(`[${current_phase}] mock: every model output matched the backend json_schema`, async () => {
      const st = (await api("GET", "/__mock/stats", { base: MOCK })).json;
      return { ok: st.schemaErrors.length === 0, detail: JSON.stringify(st.schemaErrors.slice(0, 2)) };
    });
    await test(`[${current_phase}] no 500 responses and no crash in backend log`, () => {
      const fiveHundreds = (backend.log.match(/ 5\d\d \d+ms/g) || []).length;
      const unhandled = /unhandled ?rejection/i.test(backend.log);
      return { ok: fiveHundreds === 0 && !unhandled && !backend.exited, detail: `5xx lines ${fiveHundreds}, unhandled rejection ${unhandled}` };
    });
    await stopChild(backend);

    // ---------------- B: timer (1-minute basic round) + finalize-once race
    current_phase = "B timer";
    console.log("\n=== Phase B: timer (BASIC_INTERVIEW_MINUTES=1) ===");
    backend = await startBackend("B", { BASIC_INTERVIEW_MINUTES: "1" });
    await timerTests();
    await finalizeOnceTest(backend);
    await stopChild(backend);

    // ---------------- C: AI unavailable during the interview, back for the last answer
    current_phase = "C ai-retry";
    console.log("\n=== Phase C: AI unavailable, then back (pending_eval -> retry) ===");
    await api("POST", "/__mock/reset", { base: MOCK });
    backend = await startBackend("C", { AI_RETRY_WINDOW_MS: "15000", AI_FINAL_WAIT_MS: "60000" });
    await pendingEvalRetryTest();
    await test(`[${current_phase}] no crash, no unhandled rejection`, () => {
      const unhandled = /unhandled ?rejection/i.test(backend.log);
      return { ok: !unhandled && !backend.exited, detail: `unhandled rejection ${unhandled}` };
    });
    await stopChild(backend);

    // ---------------- D: AI down for the whole interview, short retry windows
    current_phase = "D ai-down";
    console.log("\n=== Phase D: mock AI stopped ===");
    await stopChild(mock);
    backend = await startBackend("D", { AI_RETRY_WINDOW_MS: "20000", AI_FINAL_WAIT_MS: "30000", AI_QGEN_TIMEOUT_MS: "5000" });
    await mockDownTest(backend);
    await stopChild(backend);
  } catch (err) {
    record(`suite aborted during "${current}"`, false, err?.message ?? String(err));
  } finally {
    for (const c of [...children]) await stopChild(c);
    if (qaConn) {
      if (dropTestDb && qaConn.db.databaseName === dropTestDb) {
        await qaConn.db.dropDatabase().catch((e) => console.log(`could not drop ${dropTestDb}: ${e.message}`));
        console.log(`Dropped temporary database ${dropTestDb}`);
      }
      await qaConn.close();
    }
    const mongoose = require("mongoose");
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (mongo) await mongo.stop();
  }

  if (warmupReportExample) {
    fs.writeFileSync(path.join(LOG_DIR, "hr-report-org-session.json"), JSON.stringify(warmupReportExample, null, 2));
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 60000).toFixed(1)} min. Logs: ${LOG_DIR}`);
  for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
})();
