/**
 * End-to-end QA suite for the backend.   npm run test:qa
 *
 * Starts everything it needs, isolated from your real setup:
 *   - an in-memory MongoDB (mongodb-memory-server)  -> your MONGO_URI database is never touched
 *     (or QA_ATLAS_TEST_DB=1: a new temporary database on the .env cluster, dropped at the end)
 *   - scripts/mock-ai.js on :8001                    -> no Modal credits are spent
 *   - a tiny Redis-compatible server on :6399        -> or set QA_REDIS_URL to use a real Redis
 *   - the backend (src/server.ts via ts-node) on :5055, several times with different env
 * All overrides go through the child process env; .env is not modified, and no env value is
 * printed. Backend logs go to <os tmp>/airecruitx-qa/.
 *
 * Takes about 6-8 minutes (timer tests wait for real expiry; retry tests wait for real backoff).
 */
const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const API_PORT = 5055;
const MOCK_PORT = Number(process.env.MOCK_PORT || 8001);
const MINI_REDIS_PORT = 6399;
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

async function api(method, p, { body, token, base = API } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json, data: json.data };
}

// ------------------------------------------------------------ tiny Redis (RESP) server
// Enough of the protocol for ioredis + the commands the backend uses (GET/SET PX NX/DEL).
function startMiniRedis(port) {
  const store = new Map(); // key -> { v, exp }
  const live = (k) => {
    const e = store.get(k);
    if (e && e.exp && e.exp <= Date.now()) store.delete(k);
    return store.get(k);
  };
  const bulk = (s) => (s === null ? "$-1\r\n" : `$${Buffer.byteLength(s)}\r\n${s}\r\n`);
  const handle = (args) => {
    const cmd = String(args[0] || "").toUpperCase();
    switch (cmd) {
      case "PING": return "+PONG\r\n";
      case "INFO": return bulk("# Server\r\nredis_version:7.0.0-qa\r\n# Persistence\r\nloading:0\r\n");
      case "SELECT": case "CLIENT": case "QUIT": return "+OK\r\n";
      case "COMMAND": return "*0\r\n";
      case "GET": return bulk(live(args[1])?.v ?? null);
      case "SET": {
        const [, k, v, ...opts] = args;
        let exp = 0, nx = false;
        for (let i = 0; i < opts.length; i++) {
          const o = opts[i].toUpperCase();
          if (o === "PX") exp = Date.now() + Number(opts[++i]);
          else if (o === "EX") exp = Date.now() + Number(opts[++i]) * 1000;
          else if (o === "NX") nx = true;
        }
        if (nx && live(k)) return "$-1\r\n";
        store.set(k, { v, exp });
        return "+OK\r\n";
      }
      case "DEL": { let n = 0; for (const k of args.slice(1)) if (store.delete(k)) n++; return `:${n}\r\n`; }
      case "PTTL": { const e = live(args[1]); return `:${!e ? -2 : e.exp ? e.exp - Date.now() : -1}\r\n`; }
      default: return `-ERR unknown command '${cmd}'\r\n`;
    }
  };
  const parse = (buf) => {
    if (buf[0] !== 42) return null; // '*'
    let i = buf.indexOf("\r\n");
    if (i < 0) return null;
    const n = Number(buf.slice(1, i).toString());
    let pos = i + 2;
    const args = [];
    for (let k = 0; k < n; k++) {
      const j = buf.indexOf("\r\n", pos);
      if (j < 0) return null;
      const len = Number(buf.slice(pos + 1, j).toString());
      if (buf.length < j + 2 + len + 2) return null;
      args.push(buf.slice(j + 2, j + 2 + len).toString());
      pos = j + 2 + len + 2;
    }
    return { args, len: pos };
  };
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      let r;
      while (buf.length && (r = parse(buf))) {
        buf = buf.slice(r.len);
        sock.write(handle(r.args));
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise((resolve) => server.listen(port, () => resolve({
    server, url: `redis://127.0.0.1:${port}`,
    pttl: async (k) => { const e = live(k); return !e ? -2 : e.exp ? e.exp - Date.now() : -1; },
    get: async (k) => live(k)?.v ?? null,
    close: () => new Promise((r) => server.close(() => r())),
  })));
}

async function realRedisProbe(url) {
  const { Redis } = require("ioredis");
  const r = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await r.connect();
  return { url, pttl: (k) => r.pttl(k), get: (k) => r.get(k), close: async () => r.disconnect() };
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
  REDIS_URL: "",
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
  const s = await api("POST", "/api/auth/signup", { body: { name: `QA ${tag}`, email, password, role } });
  if (s.status !== 201) throw new Error(`signup ${s.status}: ${s.json.message}`);
  const v = await api("POST", "/api/auth/verify-email", { body: { email, otp: s.data.devOtp } });
  if (v.status !== 200) throw new Error(`verify ${v.status}: ${v.json.message}`);
  return { email, password, token: v.data.token, id: String(v.data.user.id) };
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
  ]);
}

async function authTests() {
  const u = await makeUser("candidate", "auth");
  await test(`[${current_phase}] auth: login correct password -> 200`, async () => {
    const r = await api("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
    return { ok: r.status === 200 && !!r.data?.token, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] auth: login wrong password -> 401`, async () => {
    const r = await api("POST", "/api/auth/login", { body: { email: u.email, password: "wrong-pass" } });
    return { ok: r.status === 401, detail: `status ${r.status}` };
  });
  await test(`[${current_phase}] auth: protected route without token -> 401`, async () => {
    const a = await api("GET", "/api/auth/me");
    const b = await api("POST", "/api/interview/start", { body: { stage: "basic" } });
    return { ok: a.status === 401 && b.status === 401, detail: `me ${a.status}, start ${b.status}` };
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
    const body = { sessionId: s.sessionId, answer: answerText("dup", 2, 7) };
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

async function fullFlowTests(redisProbe) {
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
  if (redisProbe) {
    await test(`[${current_phase}] redis: interview:expire:<id> set with TTL ~ time limit, removed when finished`, async () => {
      const u2 = await makeUser("candidate", "rkey");
      const st = (await api("POST", "/api/interview/start", { token: u2.token, body: { stage: "basic" } })).data;
      const ttl = await redisProbe.pttl(`interview:expire:${st.sessionId}`);
      const afterFinish = await redisProbe.pttl(`interview:expire:${r1.final.sessionId}`);
      const warm = await redisProbe.get("ai:warm");
      return { ok: near(ttl, 603_000, 5_000) && afterFinish === -2 && warm === "1", detail: `ttl ${ttl}ms, finished ${afterFinish}, ai:warm ${warm}` };
    });
  }
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

  await test(`[${current_phase}] org invite: timer 20 min (remainingSeconds ~1200)`, async () => {
    const g = await api("GET", `/api/applications/org-interview/${token1}`);
    const s = await api("POST", `/api/applications/org-interview/${token1}/start`);
    return {
      ok: i1.status === 200 && g.status === 200 && s.status === 200 && near(s.data.remainingSeconds, 1200, 5),
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
  let mongo, miniRedis, redisProbe, mock, backend;
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

    if (process.env.QA_REDIS_URL) redisProbe = await realRedisProbe(process.env.QA_REDIS_URL);
    else redisProbe = miniRedis = await startMiniRedis(MINI_REDIS_PORT);

    // ---------------- A: normal (Redis up, mock up)
    current_phase = "A redis";
    console.log(`\n=== Phase A: Redis ${process.env.QA_REDIS_URL ? "(real)" : "(mini stand-in)"} + mock AI ===`);
    mock = await startMock({ MOCK_FAIL_FIRST: "2" });
    await test(`[${current_phase}] mock: MOCK_FAIL_FIRST=2 -> 503 "no upstreams available" twice, then 200`, async () => {
      const codes = [];
      let body;
      for (let i = 0; i < 3; i++) { const r = await fetch(`${MOCK}/v1/models`); codes.push(r.status); if (i === 0) body = await r.text(); }
      return { ok: codes.join() === "503,503,200" && /no upstreams available/.test(body), detail: codes.join(",") };
    });
    backend = await startBackend("A", { REDIS_URL: redisProbe.url });
    await authTests();
    await answerValidationTests();
    await fullFlowTests(redisProbe);
    await orgInviteTests();
    await retryTest();
    await concurrencyTest(5);
    await test(`[${current_phase}] mock: every model output matched the backend json_schema`, async () => {
      const st = (await api("GET", "/__mock/stats", { base: MOCK })).json;
      return { ok: st.schemaErrors.length === 0, detail: JSON.stringify(st.schemaErrors.slice(0, 2)) };
    });
    await test(`[${current_phase}] no 500 responses and no crash in backend log`, () => {
      const fiveHundreds = (backend.log.match(/ 5\d\d \d+ms/g) || []).length;
      return { ok: fiveHundreds === 0 && !backend.exited, detail: `5xx lines ${fiveHundreds}` };
    });
    await stopChild(backend);

    // ---------------- B: timer (1-minute basic round)
    current_phase = "B timer";
    console.log("\n=== Phase B: timer (BASIC_INTERVIEW_MINUTES=1) ===");
    backend = await startBackend("B", { REDIS_URL: redisProbe.url, BASIC_INTERVIEW_MINUTES: "1" });
    await timerTests();
    await stopChild(backend);

    // ---------------- C: no REDIS_URL, AI down, short retry windows
    current_phase = "C no-redis ai-down";
    console.log("\n=== Phase C: REDIS_URL removed + mock AI stopped ===");
    await stopChild(mock);
    backend = await startBackend("C", { REDIS_URL: "", AI_RETRY_WINDOW_MS: "20000", AI_FINAL_WAIT_MS: "30000", AI_QGEN_TIMEOUT_MS: "5000" });
    await test(`[${current_phase}] no REDIS_URL -> starts, one warning "[redis] not available, using memory fallback"`, () => {
      const n = (backend.log.match(/\[redis\] not available, using memory fallback/g) || []).length;
      return { ok: n === 1 && !backend.exited, detail: `warnings ${n}` };
    });
    await mockDownTest(backend);
    await stopChild(backend);

    // ---------------- D: wrong REDIS_URL, everything else normal
    current_phase = "D bad-redis";
    console.log("\n=== Phase D: wrong REDIS_URL (nothing listening) ===");
    mock = await startMock();
    backend = await startBackend("D", { REDIS_URL: "redis://127.0.0.1:6390" });
    await authTests();
    await answerValidationTests();
    await fullFlowTests(null);
    await concurrencyTest(5);
    await test(`[${current_phase}] wrong REDIS_URL -> no crash, single warning, no 500s`, () => {
      const n = (backend.log.match(/\[redis\] not available, using memory fallback/g) || []).length;
      const fiveHundreds = (backend.log.match(/ 5\d\d \d+ms/g) || []).length;
      return { ok: n === 1 && fiveHundreds === 0 && !backend.exited, detail: `warnings ${n}, 5xx ${fiveHundreds}` };
    });
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
    if (miniRedis) await miniRedis.close();
    else if (redisProbe) await redisProbe.close();
    if (mongo) await mongo.stop();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed in ${((Date.now() - started) / 60000).toFixed(1)} min. Logs: ${LOG_DIR}`);
  for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
})();
