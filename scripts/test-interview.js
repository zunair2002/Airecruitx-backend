/**
 * Runs a full interview against the running backend — no Postman needed.
 *
 *   node scripts/test-interview.js <email> <password> [track] [good|weak]
 *   e.g. node scripts/test-interview.js candidate@test.com 123456 fullstack good
 *   tracks: frontend, backend, fullstack, data_ai, software_engineer
 *   Runs Round 1 (basic) and, if unlocked, Round 2 (technical).
 *
 * Needs: backend running (npm run dev) and the model or mock running (npm run mock-ai).
 */
const BASE = process.env.API_URL || "http://localhost:5000";
const [email, password, track = "fullstack", mode = "good"] = process.argv.slice(2);
if (!email || !password) {
  console.log("Usage: node scripts/test-interview.js <email> <password> [frontend|backend|fullstack|data_ai|software_engineer] [good|weak]");
  process.exit(1);
}

const GOOD = "In my final year project I worked on this directly. The main idea is to keep the design simple, explain the key concept clearly, and give a real example with the result we achieved.";
const WEAK = ["I don't know", "maybe it is something", "not sure about this"];

async function call(method, path, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json.data;
}

(async () => {
  const login = await call("POST", "/api/auth/login", { email, password });
  console.log(`✓ logged in as ${login.user.email}`);

  async function round(stage) {
    const t0 = Date.now();
    let s = await call("POST", "/api/interview/start", { stage, track }, login.token);
    console.log(`\n=== ROUND ${s.round} (${stage}) started in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${s.totalQuestions} questions, track: ${s.track} ===`);
    while (s.status !== "completed") {
      const answer = mode === "weak" ? WEAK[s.questionNumber % 3] : GOOD;
      console.log(`Q${s.questionNumber}/${s.totalQuestions}: ${s.question}`);
      s = await call("POST", "/api/interview/answer", { sessionId: s.sessionId, answer }, login.token);
    }
    const r = s.report || {};
    console.log(`\nRESULT: score ${s.score}/100 -> ${s.result.toUpperCase()} | report by: ${r.generatedBy}`);
    console.log("Summary:", r.summary);
    if (r.strengths) console.log("Strengths:", r.strengths);
    if (r.areasToImprove) console.log("Areas to improve:", r.areasToImprove);
    if (r.learningPlan) console.log("Learning plan:", r.learningPlan);
    for (const t of s.turns) console.log(`  Q${t.questionNumber} [${t.stage}] ${t.score}/10 ${t.verdict ?? ""} — ${t.feedback}`);
    return s;
  }

  const r1 = await round("basic");
  if (!r1.round2Unlocked) {
    console.log("\nRound 2 is locked (Round 1 below the unlock score). E-learning tips:", r1.elearningTips);
    return;
  }
  const r2 = await round("technical");
  console.log(`\nCertificate eligible: ${r2.certificateEligible}`);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });
