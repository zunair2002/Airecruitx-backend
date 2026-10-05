// Deterministic report text, used when the model is unavailable and for HR question-set
// interviews (which have no basic round, so they don't match the model's report format).
import { ReportResultLine, ReportText } from "./ai.service";

const LABEL: Record<string, string> = {
  dsa: "data structures and algorithms", oop: "object-oriented programming", dbms: "databases and SQL",
  os: "operating systems", networks: "computer networks", web: "web development", programming: "programming fundamentals",
  software_engineering: "software engineering practices", cloud_devops: "cloud and DevOps", security: "security",
  ai_ml: "AI and machine learning", architecture: "software architecture", big_data: "big data and data pipelines",
  emerging_tech: "emerging technologies", system_design: "system design", general_cs: "general computer science",
  self_introduction: "self-introduction", strengths_weaknesses: "discussing strengths and weaknesses",
  pressure_time_management: "handling pressure and deadlines", education_projects: "explaining projects and education",
  adaptability: "adaptability", career_goals: "career goals", conflict_resolution: "conflict resolution",
  culture_fit: "culture fit", leadership: "leadership", motivation: "motivation", team_collaboration: "teamwork",
  work_style: "work style and organisation",
};
export const topicLabel = (t: string): string => LABEL[t] ?? t.replace(/_/g, " ");

const ADVICE: Record<string, string> = {
  dsa: "Revise arrays, linked lists, stacks, queues and trees, then solve 3-4 easy problems per topic.",
  oop: "Review the four OOP pillars and write a small class hierarchy that uses each one.",
  dbms: "Revise normalization, keys, joins and indexing with small SQL exercises.",
  os: "Review processes vs threads, scheduling, deadlocks and memory management.",
  networks: "Revise the OSI/TCP-IP layers, TCP vs UDP, DNS and HTTP basics.",
  web: "Review HTTP methods, REST principles, cookies vs sessions and CORS.",
  programming: "Revise core concepts such as functions, recursion, exceptions and memory basics in your main language.",
  software_engineering: "Review SDLC models, Agile/Scrum ceremonies and types of testing.",
  cloud_devops: "Learn the basics of Docker, CI/CD pipelines and one cloud provider.",
  security: "Review authentication vs authorization, hashing, encryption and the OWASP Top 10.",
  ai_ml: "Revise supervised vs unsupervised learning, overfitting and evaluation metrics.",
  architecture: "Study monolith vs microservices, event-driven design and caching trade-offs.",
  system_design: "Practise designing simple systems like a URL shortener, covering storage, scaling and caching.",
  communication: "Practise answering out loud and recording yourself to reduce filler words.",
  star_structure: "Use the STAR method (Situation, Task, Action, Result) for behavioural questions.",
};
export const adviceFor = (t: string): string =>
  ADVICE[t] ?? `Prepare a short, structured answer with a real example about ${topicLabel(t)}.`;

export function fallbackReport(p: {
  reportType: "candidate" | "hr"; role: string; overall: number; basicScore: number | null; technicalScore: number | null;
  passed: boolean; decision: string; passMark10: number; results: ReportResultLine[]; weakTopics: string[];
}): ReportText {
  const good = [...new Set(p.results.filter((r) => r.score >= 7).sort((a, b) => b.score - a.score).map((r) => r.topic))];
  const bad = [...new Set(p.results.filter((r) => r.score < 5.5).sort((a, b) => a.score - b.score).map((r) => r.topic))];
  const strengths = good.slice(0, 3).map((t) => `Good performance on ${topicLabel(t)}.`);
  if (!strengths.length) strengths.push("Completed the full interview.");
  const weak = bad.slice(0, 4).map((t) => `Answers on ${topicLabel(t)} need more depth and accuracy.`);
  if (!weak.length) weak.push("Could add more depth and real examples in some answers.");

  const who = p.reportType === "candidate" ? "You" : "The candidate";
  const parts = [`${who} scored ${p.overall.toFixed(1)}/10 overall`];
  if (p.basicScore !== null && p.technicalScore !== null) {
    parts.push(`with ${p.basicScore.toFixed(1)}/10 in the basic round and ${p.technicalScore.toFixed(1)}/10 in the technical round`);
  }
  const head = parts.join(", ") + ".";

  if (p.reportType === "candidate") {
    const dec = p.passed
      ? "You have passed this practice level and can claim your certificate."
      : `You have not reached the ${p.passMark10.toFixed(1)} pass mark yet; the learning plan below will help you prepare for another attempt.`;
    const planTopics = [...new Set([...bad, ...p.weakTopics])].slice(0, 3);
    return {
      summary: `${head} ${dec}`, strengths, areasToImprove: weak,
      learningPlan: (planTopics.length ? planTopics : ["communication"]).map(adviceFor),
    };
  }
  const rec = { shortlist: `Shortlist for the next stage for the ${p.role} role.`,
    hold: `Hold: borderline for the ${p.role} role; consider a follow-up discussion.`,
    reject: `Not recommended for the ${p.role} role at this time.` }[p.decision] ?? p.decision;
  return { summary: head, strengths, concerns: weak, recommendation: rec };
}
