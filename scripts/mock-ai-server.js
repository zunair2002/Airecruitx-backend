/**
 * Mock AIRecruitX model server — same API as the real vLLM deployment (OpenAI-compatible),
 * so the whole backend can be developed and tested without a GPU.
 *
 *   node scripts/mock-ai-server.js            # http://localhost:8001
 *   PORT=8001 MOCK_API_KEY=dev-key MOCK_DELAY_MS=300 MOCK_FAIL_RATE=0 node scripts/mock-ai-server.js
 *
 * In .env:  AI_BASE_URL=http://localhost:8001   AI_API_KEY=dev-key (only if MOCK_API_KEY is set)
 *
 * Evaluations are heuristic (key-point overlap + answer length), NOT the real model —
 * good enough to exercise scoring, reports, pass/fail and e-learning paths.
 */
const http = require("http");
const path = require("path");

const PORT = Number(process.env.PORT || 8001);
const API_KEY = process.env.MOCK_API_KEY || "";
const DELAY = Number(process.env.MOCK_DELAY_MS || 300);
const FAIL_RATE = Number(process.env.MOCK_FAIL_RATE || 0); // e.g. 0.2 = 20% of calls return 500
const BANK = require(path.join(__dirname, "..", "src", "ai", "question_bank.json"));

const STOP = new Set("a an the is are was were be of to in on for and or but with as by at from that this it its into so can will do does not no what when where how why their they you we".split(" "));
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => w.length > 2 && !STOP.has(w));
const field = (u, name) => (u.match(new RegExp(`^${name}: (.*)$`, "m")) || [])[1] || "";
const clamp = (x) => Math.max(0, Math.min(10, Math.round(x)));

function evaluate(user) {
  const stage = field(user, "stage");
  const topic = field(user, "topic");
  const kp = (user.split("key_points:\n")[1] || "").split("\nanswer:")[0];
  const answer = user.split("\nanswer: ").slice(1).join("\nanswer: ");
  const aw = words(answer);
  const kw = [...new Set(words(kp))];
  const overlap = kw.length ? kw.filter((w) => aw.includes(w)).length / kw.length : 0;
  const len = aw.length;
  const noAnswer = len < 3 || /(don'?t know|no idea|pata nahi|skip|not sure)/i.test(answer);

  if (stage === "technical") {
    if (noAnswer) {
      return { verdict: "no_answer", scores: { technical_accuracy: 0, completeness: 0, problem_solving: 0, communication: 2 },
        feedback: "You did not attempt an answer to this question. Even a partial explanation would earn some credit.",
        improvement_tip: `Review the key idea: ${kp.replace(/\n?- /g, "; ").replace(/^; /, "")}`, weak_topics: [topic] };
    }
    const acc = clamp(2 + overlap * 9);
    const comp = clamp(1 + overlap * 7 + Math.min(len, 40) / 20);
    const verdict = acc >= 8 ? "correct" : acc >= 4 ? "partially_correct" : "incorrect";
    return {
      verdict,
      scores: { technical_accuracy: acc, completeness: comp, problem_solving: clamp(acc - 1), communication: clamp(5 + Math.min(len, 30) / 10) },
      feedback: verdict === "correct" ? "Good answer: you covered the main idea clearly."
        : verdict === "partially_correct" ? "Partly correct, but some key points are missing." : "This answer does not match the key concept.",
      improvement_tip: verdict === "correct" ? "Go one step further: give a real-world example." : `Revisit the key idea: ${kp.split("\n")[0].replace(/^- /, "")}`,
      weak_topics: verdict === "correct" ? [] : [topic],
    };
  }
  if (noAnswer) {
    return { verdict: "no_answer", scores: { relevance: 0, structure: 0, communication: 2, professionalism: 3 },
      feedback: "You did not answer the question.", improvement_tip: "Prepare a short answer for common interview questions.", weak_topics: [topic, "confidence"] };
  }
  const rel = clamp(3 + overlap * 5 + Math.min(len, 60) / 20);
  const struct = clamp(2 + Math.min(len, 80) / 12);
  const verdict = rel >= 8 ? "strong" : rel >= 5 ? "adequate" : "weak";
  return {
    verdict,
    scores: { relevance: rel, structure: struct, communication: clamp(5 + Math.min(len, 50) / 15), professionalism: 7 },
    feedback: verdict === "strong" ? "Clear and relevant answer with good detail." : "Relevant, but add a specific example and a clear result.",
    improvement_tip: "Use the STAR method: Situation, Task, Action, Result.",
    weak_topics: verdict === "strong" ? [] : ["star_structure"],
  };
}

function generate(user) {
  const stage = field(user, "stage");
  const level = field(user, "level");
  const topics = field(user, "topics").split(",").map((s) => s.trim());
  const count = Number(field(user, "count")) || 5;
  let pool = BANK.filter((q) => q.stage === stage && topics.includes(q.topic) && (stage === "basic" || q.level === level));
  if (pool.length < count) pool = BANK.filter((q) => q.stage === stage && topics.includes(q.topic));
  pool = pool.sort(() => Math.random() - 0.5).slice(0, count);
  return { questions: pool.map((q) => ({ question: q.question, topic: q.topic, key_points: q.key_points })) };
}

function report(user) {
  const type = field(user, "report_type");
  const role = field(user, "role");
  const b = field(user, "basic_score"), t = field(user, "technical_score"), o = field(user, "overall_score");
  const decision = field(user, "decision");
  const lines = user.split("results:\n")[1].split("\n");
  const good = lines.filter((l) => Number((l.match(/\] ([\d.]+)\/10/) || [])[1]) >= 7).map((l) => l.match(/\]\[(\w+)\]/)[1]);
  const bad = lines.filter((l) => Number((l.match(/\] ([\d.]+)\/10/) || [])[1]) < 5.5).map((l) => l.match(/\]\[(\w+)\]/)[1]);
  const head = `${type === "candidate" ? "You" : "The candidate"} scored ${o}/10 overall, with ${b}/10 in the basic round and ${t}/10 in the technical round.`;
  const strengths = [...new Set(good)].slice(0, 3).map((x) => `Good understanding of ${x.replace(/_/g, " ")}.`);
  const weak = [...new Set(bad)].slice(0, 3).map((x) => `Answers on ${x.replace(/_/g, " ")} were incomplete.`);
  if (type === "candidate") {
    return { summary: `${head} ${decision === "pass" ? "You have passed this practice level and earned your certificate." : "You have not reached the 6.0 pass mark yet, so personalised learning material has been added to your dashboard."}`,
      strengths: strengths.length ? strengths : ["Completed the full interview."], areas_to_improve: weak.length ? weak : ["Add more depth to answers."],
      learning_plan: [...new Set(bad)].slice(0, 3).map((x) => `Revise ${x.replace(/_/g, " ")} with short practice exercises.`) };
  }
  return { summary: head, strengths: strengths.length ? strengths : ["Completed the full interview."], concerns: weak.length ? weak : ["Could add more depth."],
    recommendation: decision === "shortlist" ? `Shortlist for the ${role} role.` : decision === "hold" ? `Hold for the ${role} role.` : `Not recommended for the ${role} role.` };
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") { res.writeHead(200); return res.end("ok"); }
  if (req.method !== "POST" || !req.url.startsWith("/v1/chat/completions")) { res.writeHead(404); return res.end(); }
  if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) { res.writeHead(401); return res.end("unauthorized"); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => setTimeout(() => {
    if (Math.random() < FAIL_RATE) { res.writeHead(500); return res.end("mock failure"); }
    const b = JSON.parse(body);
    const sys = b.messages[0].content, user = b.messages[1].content;
    const out = sys.includes("answer evaluator") ? evaluate(user) : sys.includes("interviewer") ? generate(user) : report(user);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(out) } }] }));
  }, DELAY));
});
server.listen(PORT, () => console.log(`[mock-ai] listening on http://localhost:${PORT}  (delay ${DELAY}ms, fail rate ${FAIL_RATE})`));
module.exports = server;
