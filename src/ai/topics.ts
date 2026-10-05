// Topic slugs the model was trained on, plus helpers that map jobs/skills/text onto them.

export const TECH_TOPICS = [
  "dsa", "oop", "dbms", "os", "networks", "web", "programming", "software_engineering", "cloud_devops",
  "security", "ai_ml", "architecture", "big_data", "emerging_tech", "system_design", "general_cs",
] as const;

export const BASIC_TOPICS = [
  "self_introduction", "strengths_weaknesses", "pressure_time_management", "education_projects", "adaptability",
  "career_goals", "conflict_resolution", "culture_fit", "leadership", "motivation", "team_collaboration", "work_style",
] as const;

// Required-skill keyword -> technical topics (covers src/data/skills.ts and common extras)
const SKILL_TOPICS: Array<[RegExp, string[]]> = [
  [/react|next\.?js|angular|vue|html|css|tailwind|redux|javascript|typescript|frontend|front-end/i, ["web", "programming"]],
  [/node|express|django|flask|spring|rest|graphql|backend|back-end|api/i, ["web", "architecture"]],
  [/mongo|mysql|postgres|sql|firebase|database|redis|oracle/i, ["dbms"]],
  [/docker|kubernetes|aws|azure|gcp|cloud|devops|ci\/?cd|jenkins|terraform|linux/i, ["cloud_devops", "os"]],
  [/machine learning|deep learning|tensorflow|pytorch|\bml\b|\bai\b|nlp|computer vision/i, ["ai_ml"]],
  [/data analysis|pandas|numpy|spark|hadoop|kafka|etl|big data|data engineer/i, ["big_data", "dbms"]],
  [/python|java\b|c\+\+|c#|golang|\bgo\b|kotlin|swift|php|ruby/i, ["programming", "oop"]],
  [/git|agile|scrum|testing|qa|jira|selenium|cypress/i, ["software_engineering"]],
  [/security|owasp|penetration|cyber|auth/i, ["security"]],
  [/network|tcp|dns|cisco/i, ["networks"]],
  [/system design|microservice|distributed/i, ["system_design", "architecture"]],
];

const CORE_DEFAULT = ["dsa", "oop", "dbms", "programming", "software_engineering", "web"];

/** Topics for the technical round, from the job's title + required skills (or a CS-core default). */
export function technicalTopicsFor(jobTitle?: string, requiredSkills: string[] = []): string[] {
  const text = [jobTitle ?? "", ...requiredSkills].join(" | ");
  const found = new Set<string>();
  for (const [re, topics] of SKILL_TOPICS) if (re.test(text)) topics.forEach((t) => found.add(t));
  const list = [...found];
  // always keep some CS fundamentals in the mix, and use 3-4 topics so 8 questions spread well
  for (const t of ["dsa", "oop", "dbms"]) if (list.length < 3 && !list.includes(t)) list.push(t);
  return list.length ? list.slice(0, 4) : shuffle(CORE_DEFAULT).slice(0, 4);
}

/** Basic-round categories: always start with self-introduction, then a random mix. */
export function basicTopicsFor(): string[] {
  const rest = shuffle(BASIC_TOPICS.filter((t) => t !== "self_introduction"));
  return ["self_introduction", ...rest.slice(0, 3)];
}

const TEXT_TOPICS: Array<[RegExp, string]> = [
  [/^(design|build|architect)\b/i, "system_design"],
  [/security|encrypt|authenticat|xss|csrf|injection|vulnerab|jwt|oauth/i, "security"],
  [/machine learning|neural|overfit|regression|classification|deep learning|\bai\b|model/i, "ai_ml"],
  [/docker|kubernetes|container|microservice|cloud|ci\/?cd|devops|deploy/i, "cloud_devops"],
  [/\bsql\b|database|normaliz|\bindex|transaction|\bacid\b|\bjoin|nosql|query|primary key/i, "dbms"],
  [/thread|process|deadlock|schedul|paging|virtual memory|kernel|semaphore|mutex/i, "os"],
  [/\btcp|\budp|\bdns\b|network|\bosi\b|protocol|socket/i, "networks"],
  [/\brest|\bapi|html|\bcss|javascript|react|node|front.?end|back.?end|\bweb|cookie|session|http/i, "web"],
  [/array|linked list|\bstack\b|\bqueue|\btree|graph|hash|sort|binary search|\bheap|recurs|complexity|algorithm/i, "dsa"],
  [/object.oriented|\boop\b|polymorph|inherit|encapsul|abstract|interface|design pattern|class/i, "oop"],
  [/agile|scrum|test|sdlc|git|requirement|code review|uml/i, "software_engineering"],
  [/function|loop|variable|compil|exception|pointer|language/i, "programming"],
];

export function topicFromText(text: string): string {
  for (const [re, t] of TEXT_TOPICS) if (re.test(text)) return t;
  return "general_cs";
}

/** HR reference answer -> short key points (one per sentence/clause, max 4). */
export function keyPointsFromReference(reference: string): string[] {
  const clean = reference.replace(/\s+/g, " ").trim();
  let parts = clean.split(/(?<=[.;!?])\s+|\n+/).map((s) => s.trim().replace(/[.;]+$/, "")).filter(Boolean);
  if (parts.length < 2) parts = clean.split(/,\s+(?:and\s+|while\s+)?/).map((s) => s.trim()).filter((s) => s.split(" ").length >= 3);
  return (parts.length ? parts : [clean]).slice(0, 4);
}

export function shuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
