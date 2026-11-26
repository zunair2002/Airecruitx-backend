// Practice interview question bank (src/ai/practice_questions.json). Practice rounds take their
// questions from here, never from the model: the model only evaluates answers and writes the report.
//
//   Round 1 (basic, 5):      intro, 3 generic questions on 3 different topics, closing
//   Round 2 (technical, 8):  selected track only: 2 easy, 4 medium, 2 hard
//
// Repeats are avoided against the candidate's recent practice sessions (see selectPracticeQuestions).
import practiceData from "./practice_questions.json";
import { isTrack, TRACKS, TrackId } from "./topics";

export type PracticeLevel = "general" | "easy" | "medium" | "hard";
type BasicSlot = "intro" | "generic" | "closing";
type TechLevel = "easy" | "medium" | "hard";

interface PracticeQuestion {
  stage: "basic" | "technical";
  slot?: BasicSlot;
  track?: TrackId;
  topic: string;
  level: PracticeLevel;
  question: string;
  key_points: string[];
}

export interface PickedPracticeQuestion {
  question: string;
  stage: "basic" | "technical";
  topic: string;
  keyPoints: string[];
  level: PracticeLevel;
  source: "bank";
}

/** Level sent to the evaluator. The model was trained on beginner/intermediate/expert, but our
 * "hard" questions are fresher level, so they are graded as "intermediate", not "expert". */
export const EVAL_LEVEL: Record<PracticeLevel, string> = {
  general: "general",
  easy: "beginner",
  medium: "intermediate",
  hard: "intermediate",
};

export const TECH_PLAN: ReadonlyArray<{ level: TechLevel; count: number }> = [
  { level: "easy", count: 2 },
  { level: "medium", count: 4 },
  { level: "hard", count: 2 },
];
const GENERIC_COUNT = 3;
const EXPECTED_BASIC: Record<BasicSlot, number> = { intro: 3, generic: 69, closing: 6 };
const EXPECTED_TECH: Record<TechLevel, number> = { easy: 30, medium: 40, hard: 20 };
// When a technical level runs short: try these levels next (closest difficulty first)
const ADJACENT: Record<TechLevel, TechLevel[]> = { easy: ["medium"], medium: ["easy", "hard"], hard: ["medium"] };

const SLOTS: BasicSlot[] = ["intro", "generic", "closing"];
const TECH_LEVELS: TechLevel[] = ["easy", "medium", "hard"];
const normQ = (q: string) => String(q).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------------ load + validate (once)
interface LoadedBank {
  intro: PracticeQuestion[];
  generic: PracticeQuestion[];
  closing: PracticeQuestion[];
  tech: Record<TrackId, Record<TechLevel, PracticeQuestion[]>>;
  errors: string[];
  warnings: string[];
}
let loaded: LoadedBank | null = null;

const nonEmptyString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function load(): LoadedBank {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tech = Object.fromEntries(
    Object.keys(TRACKS).map((t) => [t, { easy: [], medium: [], hard: [] }]),
  ) as unknown as LoadedBank["tech"];
  const bank: LoadedBank = { intro: [], generic: [], closing: [], tech, errors, warnings };

  const raw: unknown = practiceData;
  if (!Array.isArray(raw)) {
    errors.push("practice_questions.json must be a JSON array of questions");
    return bank;
  }
  raw.forEach((q: any, i: number) => {
    const bad = (why: string) => errors.push(`entry #${i} skipped: ${why}`);
    if (!q || typeof q !== "object") return bad("not an object");
    if (!nonEmptyString(q.question)) return bad("missing question");
    if (!nonEmptyString(q.topic)) return bad("missing topic");
    if (!Array.isArray(q.key_points) || !q.key_points.length || !q.key_points.every(nonEmptyString)) {
      return bad("key_points must be a non-empty list of strings");
    }
    const item: PracticeQuestion = {
      stage: q.stage, slot: q.slot, track: q.track, topic: q.topic.trim(), level: q.level,
      question: q.question.trim(), key_points: q.key_points.map((k: string) => k.trim()),
    };
    if (q.stage === "basic") {
      if (!SLOTS.includes(q.slot)) return bad(`basic slot must be one of ${SLOTS.join("/")}`);
      if (q.level !== "general") return bad('basic level must be "general"');
      bank[q.slot as BasicSlot].push(item);
    } else if (q.stage === "technical") {
      if (!isTrack(q.track)) return bad(`unknown track "${q.track}"`);
      if (!TECH_LEVELS.includes(q.level)) return bad(`technical level must be one of ${TECH_LEVELS.join("/")}`);
      tech[q.track as TrackId][q.level as TechLevel].push(item);
    } else {
      return bad(`unknown stage "${q.stage}"`);
    }
  });

  // duplicate question text within one slot / track (a session never repeats a question either way)
  const groups: Array<[string, PracticeQuestion[]]> = [
    ...SLOTS.map((s) => [`basic/${s}`, bank[s]] as [string, PracticeQuestion[]]),
    ...Object.keys(tech).map((t) => [t, TECH_LEVELS.flatMap((l) => tech[t as TrackId][l])] as [string, PracticeQuestion[]]),
  ];
  for (const [name, list] of groups) {
    const seen = new Set<string>();
    for (const q of list) {
      const k = normQ(q.question);
      if (seen.has(k)) warnings.push(`duplicate question in ${name}: "${q.question}"`);
      seen.add(k);
    }
  }

  // counts: below what one session needs is an error, different from the expected size a warning
  const genericTopics = new Set(bank.generic.map((q) => q.topic)).size;
  for (const s of SLOTS) {
    if (bank[s].length !== EXPECTED_BASIC[s]) warnings.push(`basic/${s}: ${bank[s].length} questions (expected ${EXPECTED_BASIC[s]})`);
  }
  if (!bank.intro.length) errors.push("basic/intro: no questions");
  if (!bank.closing.length) errors.push("basic/closing: no questions");
  if (genericTopics < GENERIC_COUNT) errors.push(`basic/generic: ${genericTopics} topics (need at least ${GENERIC_COUNT})`);
  for (const t of Object.keys(tech) as TrackId[]) {
    for (const { level, count } of TECH_PLAN) {
      const n = tech[t][level].length;
      if (n !== EXPECTED_TECH[level]) warnings.push(`${t}/${level}: ${n} questions (expected ${EXPECTED_TECH[level]})`);
      if (n < count) errors.push(`${t}/${level}: ${n} questions (a session needs ${count})`);
    }
  }
  return bank;
}

const bank = (): LoadedBank => (loaded ??= load());

/** Called once at server start: loads the bank and logs any problem clearly. Returns true when usable. */
export function validatePracticeBank(): boolean {
  const b = bank();
  for (const w of b.warnings) console.warn(`[practiceBank] ${w}`);
  for (const e of b.errors) console.error(`[practiceBank] ${e}`);
  const total = b.intro.length + b.generic.length + b.closing.length
    + Object.values(b.tech).reduce((s, levels) => s + TECH_LEVELS.reduce((n, l) => n + levels[l].length, 0), 0);
  console.log(`[practiceBank] loaded ${total} practice questions (${b.errors.length} error(s), ${b.warnings.length} warning(s))`);
  return b.errors.length === 0;
}

// ------------------------------------------------------------------ selection
export interface PracticeHistory {
  /** Questions of the candidate's last 5 practice sessions of this stage (avoided for generic + technical). */
  recent: string[];
  /** Questions of the most recent session of this stage (avoided for intro + closing when possible). */
  last: string[];
}

export interface PracticeSelection {
  questions: PickedPracticeQuestion[];
  warnings: string[];
}

const shuffled = <T,>(items: readonly T[]): T[] => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const toPicked = (q: PracticeQuestion): PickedPracticeQuestion => ({
  question: q.question, stage: q.stage, topic: q.topic, keyPoints: [...q.key_points], level: q.level, source: "bank",
});

/**
 * Picks one practice round. Never repeats a question inside the session.
 * - generic + technical: avoid the last 5 sessions; if a slot runs short, previously asked
 *   questions are allowed, then (technical only) an adjacent level is used — each fallback is
 *   reported in `warnings`.
 * - intro + closing (only 3 / 6 questions): just avoid the previous session's question if possible.
 */
export function selectPracticeQuestions(
  stage: "basic" | "technical",
  track: TrackId,
  history: PracticeHistory = { recent: [], last: [] },
): PracticeSelection {
  const b = bank();
  const used = new Set<string>(); // this session
  const recent = new Set(history.recent.map(normQ));
  const last = new Set(history.last.map(normQ));
  const warnings: string[] = [];
  const out: PracticeQuestion[] = [];
  const take = (q: PracticeQuestion) => { used.add(normQ(q.question)); out.push(q); };
  const unused = (list: PracticeQuestion[]) => list.filter((q) => !used.has(normQ(q.question)));

  /** Up to n questions from list: first those not in `avoid`, then (if allowed) the rest. */
  const pick = (list: PracticeQuestion[], n: number, avoid: Set<string>, allowAvoided: boolean): PracticeQuestion[] => {
    const pool = unused(list);
    const fresh = shuffled(pool.filter((q) => !avoid.has(normQ(q.question))));
    const picked = fresh.slice(0, n);
    if (picked.length < n && allowAvoided) {
      picked.push(...shuffled(pool.filter((q) => avoid.has(normQ(q.question)))).slice(0, n - picked.length));
    }
    picked.forEach(take);
    return picked;
  };

  if (stage === "basic") {
    pick(b.intro, 1, last, true);

    // 3 generic questions from 3 different topics
    const topics = shuffled([...new Set(b.generic.map((q) => q.topic))]);
    const chosenTopics = new Set<string>();
    for (const t of topics) {
      if (chosenTopics.size >= GENERIC_COUNT) break;
      if (pick(b.generic.filter((q) => q.topic === t), 1, recent, false).length) chosenTopics.add(t);
    }
    if (chosenTopics.size < GENERIC_COUNT) {
      warnings.push(`basic/generic: only ${chosenTopics.size} topic(s) with fresh questions; reusing questions from recent sessions`);
      for (const t of topics) {
        if (chosenTopics.size >= GENERIC_COUNT) break;
        if (chosenTopics.has(t)) continue;
        if (pick(b.generic.filter((q) => q.topic === t), 1, recent, true).length) chosenTopics.add(t);
      }
    }

    pick(b.closing, 1, last, true);
  } else {
    for (const { level, count } of TECH_PLAN) {
      const levels = b.tech[track];
      const got = pick(levels[level], count, recent, false);
      let missing = count - got.length;
      if (missing > 0) {
        warnings.push(`${track}/${level}: ${got.length}/${count} fresh questions; reusing questions from recent sessions`);
        missing -= pick(levels[level], missing, recent, true).length;
      }
      for (const adj of ADJACENT[level]) {
        if (missing <= 0) break;
        warnings.push(`${track}/${level}: ${missing} question(s) short; taking them from ${adj}`);
        missing -= pick(levels[adj], missing, recent, true).length;
      }
      if (missing > 0) warnings.push(`${track}/${level}: still ${missing} question(s) short`);
    }
  }
  return { questions: out.map(toPicked), warnings };
}

/** Expected number of questions in a round (5 basic, 8 technical). */
export const practiceRoundSize = (stage: "basic" | "technical"): number =>
  stage === "basic" ? 1 + GENERIC_COUNT + 1 : TECH_PLAN.reduce((s, p) => s + p.count, 0);
