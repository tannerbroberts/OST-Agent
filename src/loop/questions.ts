/**
 * The question budget — how many times a run may interrupt its operator, spent
 * down across the firing and stated before it begins.
 *
 * The bound exists because "how many times will this thing stop and ask me
 * something?" has had no answer at all. `loop.spend` bounds what a firing costs
 * in tokens; nothing bounded what it costs in attention, and attention is the
 * resource an unattended loop was supposed to stop consuming.
 *
 * ## The budget is declared and measured, never enforced in-line
 *
 * OST-Agent does not call the model — Claude Code does — so nothing here can sit
 * in front of an `AskUserQuestion` and refuse it. That is the same constraint
 * `loop/spend.ts` is built around, and the answer is the same shape: the operator
 * DECLARES a bound, the loop STATES it before the firing, and the interruptions
 * actually taken are MEASURED afterwards out of the session transcript, which is
 * a record no agent in this system can write.
 *
 * A budget the run cannot enforce on itself is still worth having: the operator
 * knows the number before the run starts, and the number is checkable after it.
 * What is NOT claimed is that a run held to this bound will ask better questions.
 *
 * ## Two rules, both committed here, both fixed before the corpus was counted
 *
 * {@link QUESTION_CONSEQUENCE_RULE} scores a question from what is visible at ask
 * time. {@link HINDSIGHT_RULE} reads what the operator actually did with it. They
 * are deliberately kept apart and deliberately given different inputs: the whole
 * question this module exists to answer is whether the first can predict the
 * second, and a scorer allowed to see the answer would answer it trivially.
 *
 * `test/loop/question-budget-ordering.test.ts` replays four harvested sessions
 * through both. Read its fixture's `PROVENANCE.md` before believing the number.
 */
import fs from "node:fs";
import path from "node:path";
import { sessionCwd } from "../adapters/tokens.js";

/** How many answered clarifying questions a session needs to be harvested at all. */
export const MIN_QUESTIONS_PER_SESSION = 3;

/**
 * How many times a session had to stop the operator to be in the headline corpus.
 *
 * The budget's unit is the interruption, not the question — one ask carrying six
 * questions stopped the operator once — so this is the count that decides whether
 * a session is one the budget would have had to ration at all. Three or more, on
 * every transcript this machine holds, is exactly four sessions, which is the four
 * the assumption test names.
 *
 * Sessions below the bar are harvested anyway and replayed as the wider corpus, so
 * "why those four" is answerable by running the same replay over the rest rather
 * than by trusting the cut. See `test/fixtures/question-budget/PROVENANCE.md`.
 */
export const MIN_INTERRUPTIONS_PER_SESSION = 3;

/** One clarifying question as it was asked, plus what came back. */
export interface HarvestedQuestion {
  /** Index of the transcript entry that issued the ask, so a line can be checked by hand. */
  entry: number;
  /** The `tool_use` id — several questions can share one, and one ask is one interruption. */
  askId: string;
  header: string;
  question: string;
  /** Option labels verbatim, `(Recommended)` suffix and all. */
  options: string[];
  /** The tool_result verbatim, redacted and clipped. Absent when the run ended first. */
  answer?: string;
}

export interface HarvestedSession {
  id: string;
  project: string;
  entries: number;
  /** Distinct `AskUserQuestion` calls — how many times the operator was actually stopped. */
  interruptions: number;
  /** Questions asked whose answer never arrived — outside the replay, counted here. */
  askedButUnanswered: number;
  questions: HarvestedQuestion[];
}

/** The four the assumption test names: every session that stopped its operator repeatedly. */
export function headlineCorpus(sessions: readonly HarvestedSession[]): HarvestedSession[] {
  return sessions.filter((s) => s.interruptions >= MIN_INTERRUPTIONS_PER_SESSION);
}

/** What a scorer is allowed to see: the question as asked, and nothing after it. */
export type AskedQuestion = Pick<HarvestedQuestion, "header" | "question" | "options">;

// ---------------------------------------------------------------------------
// Ask-time consequence
// ---------------------------------------------------------------------------

/**
 * The ranking rule, derived from the solution's own argument rather than from the
 * corpus, and written down in full so it can be disagreed with by name.
 *
 * The argument is: a run "takes a stated default on everything else". So the
 * questions worth an interruption are the ones where taking a default is worst —
 * either because there is no default to take, or because the wrong one cannot be
 * undone, or because the run never narrowed the space enough for its default to
 * mean much. Each criterion below is one of those three, in that order of weight.
 *
 * **What is deliberately not scored.** Question length, header wording, and
 * position in the session. Those are facts about how the run phrased itself, not
 * about what turns on the answer, and a scorer that used them would be reading its
 * own voice back.
 */
export const QUESTION_CONSEQUENCE_RULE = {
  /**
   * The marker a run appends to the option it would take on its own. No option
   * carries it ⇒ the run stated no default, and banking the question means
   * inventing an answer rather than falling back on one. Weighted highest for
   * that reason: it is the one case where not asking is not an option.
   */
  defaultMarker: "(recommended)",
  undefaultableWeight: 4,

  /**
   * Option labels naming something that cannot be walked back. A wrong default
   * here is permanent, so the expected cost of banking is high even when the
   * probability of being wrong is not.
   *
   * Matched case-insensitively as whole words against option labels only — never
   * against the question text, where these verbs routinely describe the situation
   * being asked about rather than an action the answer authorises.
   */
  unrecoverableMarkers: [
    "delete",
    "drop",
    "cut",
    "remove",
    "publish",
    "deprecate",
    "permanently",
    "rewrite",
    "migrate",
    "rename",
    "force",
    "overwrite",
    "ship",
  ],
  unrecoverableWeight: 2,

  /**
   * How many options make a question "unnarrowed". At four or more the run has
   * not reduced the space itself, so its default is one guess among many.
   * Weighted lowest: breadth is weak evidence, and a run that lists options
   * generously would otherwise buy itself interruptions.
   */
  unnarrowedOptions: 4,
  unnarrowedWeight: 1,
} as const;

export interface ConsequenceScore {
  score: number;
  /** Which criteria fired, so a ranking can be argued with rather than trusted. */
  reasons: string[];
}

function hasDefault(options: readonly string[]): boolean {
  return options.some((o) => o.toLowerCase().includes(QUESTION_CONSEQUENCE_RULE.defaultMarker));
}

function unrecoverableIn(options: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const option of options) {
    for (const marker of QUESTION_CONSEQUENCE_RULE.unrecoverableMarkers) {
      if (new RegExp(`\\b${marker}\\b`, "i").test(option)) hits.add(marker);
    }
  }
  return [...hits].sort();
}

/** Score one question on what was visible when it was asked. */
export function scoreQuestion(q: AskedQuestion): ConsequenceScore {
  const reasons: string[] = [];
  let score = 0;

  if (!hasDefault(q.options)) {
    score += QUESTION_CONSEQUENCE_RULE.undefaultableWeight;
    reasons.push("undefaultable: no option marked (Recommended), so there is nothing to bank");
  }
  const unrecoverable = unrecoverableIn(q.options);
  if (unrecoverable.length > 0) {
    score += QUESTION_CONSEQUENCE_RULE.unrecoverableWeight;
    reasons.push(`unrecoverable: an option names ${unrecoverable.join(", ")}`);
  }
  if (q.options.length >= QUESTION_CONSEQUENCE_RULE.unnarrowedOptions) {
    score += QUESTION_CONSEQUENCE_RULE.unnarrowedWeight;
    reasons.push(`unnarrowed: ${q.options.length} options, the run narrowed nothing`);
  }
  return { score, reasons };
}

export interface RankedQuestion extends ConsequenceScore {
  /** Where the question actually arrived, 0-based. The order a budget would meet it in. */
  arrival: number;
}

/**
 * Questions in the order a budget would spend on them: highest score first, and
 * arrival order among equals.
 *
 * The tie-break is forced rather than chosen. A budget spends in real time and has
 * not seen the later question yet, so at equal score it can only buy the one in
 * front of it. That is the same limitation the solution node states about itself.
 */
export function rankByConsequence(questions: readonly AskedQuestion[]): RankedQuestion[] {
  return questions
    .map((q, arrival) => ({ arrival, ...scoreQuestion(q) }))
    .sort((a, b) => b.score - a.score || a.arrival - b.arrival);
}

// ---------------------------------------------------------------------------
// Hindsight
// ---------------------------------------------------------------------------

/**
 * How the operator's recorded answer is turned into a consequence tier.
 *
 * This is the answer key, and it is derived rather than authored: every input is
 * something the operator did, recorded by Claude Code in a file no agent in this
 * system can write. Nobody sat down and nominated a most-consequential question
 * per session, which is the failure this whole spec would otherwise have — a
 * ranking function graded against its own author's opinion proves nothing.
 *
 * The tiers ask one question: did interrupting change the outcome?
 *
 * - `reframed` — the operator declined the tool, or answered in their own words
 *   rather than picking an option. Every option the run offered was wrong, so the
 *   default it would have banked was wrong too, and wrong about the framing.
 * - `overridden` — the operator picked an option, but not the one the run had
 *   marked as its default. Banking would have taken the other branch.
 * - `confirmed` — the operator picked the run's own stated default. The
 *   interruption cost attention and changed nothing.
 */
export const HINDSIGHT_RULE = {
  /**
   * Claude Code's wording when the operator dismissed the ask instead of
   * answering it. Matched case-insensitively against the tool_result.
   */
  declinedMarkers: ["the user doesn't want to proceed with this tool use", "the tool use was rejected"],
  tiers: { confirmed: 1, overridden: 2, reframed: 3 } as const,
} as const;

export type HindsightTier = keyof typeof HINDSIGHT_RULE.tiers;

export interface HindsightReading {
  tier: HindsightTier;
  /** The option label the answer was matched to, absent when it matched none. */
  chose?: string;
  why: string;
}

/**
 * Read one answer against the options it was offered.
 *
 * The match is "the tool_result contains this option's label", because Claude Code
 * echoes the chosen label into the result verbatim. Longest label first, so an
 * option whose label is a prefix of another cannot claim the other's answer.
 */
export function readHindsight(q: HarvestedQuestion): HindsightReading {
  const answer = (q.answer ?? "").toLowerCase();

  if (HINDSIGHT_RULE.declinedMarkers.some((m) => answer.includes(m))) {
    return { tier: "reframed", why: "the operator declined the ask rather than answering it" };
  }

  const byLength = [...q.options].sort((a, b) => b.length - a.length);
  const chose = byLength.find((option) => option.length > 0 && answer.includes(option.toLowerCase()));
  if (chose === undefined) {
    return { tier: "reframed", why: "the operator answered in their own words; no offered option was taken" };
  }
  if (chose.toLowerCase().includes(QUESTION_CONSEQUENCE_RULE.defaultMarker)) {
    return { tier: "confirmed", chose, why: "the operator took the run's own stated default" };
  }
  return { tier: "overridden", chose, why: "the operator took an option other than the run's stated default" };
}

/**
 * Which question hindsight says mattered most, as an arrival index.
 *
 * Ties break toward the LATEST question, and that direction is the point. When
 * hindsight cannot single one out, the honest reading is the one hardest for a
 * budget spending in arrival order to have caught — a test that broke its own ties
 * in its own favour would not be measuring anything. Returns null when no question
 * rose above `confirmed`, i.e. when the session's interruptions all changed nothing
 * and there is no most-consequential question to have caught.
 */
export function hindsightTop(questions: readonly HarvestedQuestion[]): number | null {
  let best: { arrival: number; rank: number } | null = null;
  questions.forEach((q, arrival) => {
    const rank = HINDSIGHT_RULE.tiers[readHindsight(q).tier];
    if (rank === HINDSIGHT_RULE.tiers.confirmed) return;
    if (best === null || rank > best.rank || (rank === best.rank && arrival > best.arrival)) {
      best = { arrival, rank };
    }
  });
  return best === null ? null : (best as { arrival: number }).arrival;
}

// ---------------------------------------------------------------------------
// Spending the budget
// ---------------------------------------------------------------------------

/**
 * How many of `total` questions a budget of "half" buys.
 *
 * Rounded UP, and the rounding is not incidental: for an odd-length session there
 * is no exact half, and on the harvested corpus the two roundings disagree about
 * whether the assumption holds. Up is the operational reading — an operator
 * budgeting half of three interruptions grants two, not one — and
 * {@link replaySession} reports what down would have said rather than leaving the
 * choice buried here.
 */
export function halfBudget(total: number): number {
  return Math.ceil(total / 2);
}

export interface SessionReplay {
  session: string;
  questions: number;
  budget: number;
  /** Arrival indices the budget buys, in the order it would buy them. */
  spent: number[];
  /** Arrival index hindsight names, or null when nothing rose above `confirmed`. */
  top: number | null;
  /** Did the budget buy the question hindsight named? */
  caught: boolean;
  /** What plain arrival order — no ranking at all — would have caught. The baseline. */
  caughtByArrivalOrder: boolean;
  /** The same verdict at the other rounding of "half", so the bound is visible. */
  caughtAtFloorBudget: boolean;
}

/**
 * Replay one harvested session: rank its questions, spend half the count on them
 * in ranked order, and ask whether the question hindsight named was bought.
 *
 * `caughtByArrivalOrder` is computed alongside deliberately. If ranking and
 * arrival order agree, the ranking function is not what a green here is showing,
 * and the reader should be told that in the same breath as the result.
 */
export function replaySession(session: HarvestedSession): SessionReplay {
  const questions = session.questions;
  const budget = halfBudget(questions.length);
  const ranked = rankByConsequence(questions);
  const spent = ranked.slice(0, budget).map((r) => r.arrival);
  const top = hindsightTop(questions);

  return {
    session: session.id,
    questions: questions.length,
    budget,
    spent,
    top,
    caught: top !== null && spent.includes(top),
    caughtByArrivalOrder: top !== null && top < budget,
    caughtAtFloorBudget:
      top !== null && ranked.slice(0, Math.floor(questions.length / 2)).some((r) => r.arrival === top),
  };
}

// ---------------------------------------------------------------------------
// The declared bound, and what the operator sees
// ---------------------------------------------------------------------------

/** The operator's declared cap on interruptions per rolling window. */
export interface QuestionBudget {
  /** Interruptions — `AskUserQuestion` calls, not questions inside them. */
  interruptions: number;
  windowHours: number;
  /** Directory of Claude Code session transcripts. Declared, never derived. */
  sessionsDir: string;
}

export type InterruptionMeasurement =
  | { measurable: true; interruptions: number; questions: number; sessions: number }
  | { measurable: false; reason: string };

/** Same canonicalisation `loop/spend.ts` uses, and for the same `/private/var` reason. */
function canonical(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

/**
 * Count the interruptions this vault's sessions took inside the window.
 *
 * One `AskUserQuestion` call is one interruption however many questions it
 * carries, because one is what the operator experiences: the run stopped once.
 * The questions are counted too and reported beside it, since a single ask
 * bundling six questions is a different imposition from one carrying one.
 */
export function measureInterruptions(
  sessionsDir: string,
  opts: { vaultDir: string; sinceMs: number },
): InterruptionMeasurement {
  const dir = path.resolve(sessionsDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    // Fail closed, exactly as the spend ceiling does: an unreadable transcript
    // directory is an unbounded call on the operator's attention, and the honest
    // answer to "how often did this interrupt you" is not zero.
    return {
      measurable: false,
      reason: `cannot read session transcripts at ${dir} (${(e as NodeJS.ErrnoException).code ?? "unreadable"}) — interruptions are unmeasurable`,
    };
  }

  const vault = canonical(opts.vaultDir);
  let interruptions = 0;
  let questions = 0;
  let sessions = 0;
  for (const name of names.sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    const cwd = sessionCwd(file);
    if (cwd === undefined || canonical(cwd) !== vault) continue;
    sessions += 1;
    for (const ask of readAsks(file)) {
      const at = ask.ts ? Date.parse(ask.ts) : NaN;
      if (Number.isFinite(at) && at < opts.sinceMs) continue;
      interruptions += 1;
      questions += ask.questions;
    }
  }
  return { measurable: true, interruptions, questions, sessions };
}

/** Every `AskUserQuestion` in one transcript, as its timestamp and how many questions it bundled. */
function readAsks(file: string): { ts: string; questions: number }[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const asks: { ts: string; questions: number }[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // a corrupt line costs one entry, never the session
    }
    const message = entry.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== "tool_use" || !String(block.name ?? "").endsWith("AskUserQuestion")) continue;
      const input = block.input as { questions?: unknown[] } | undefined;
      asks.push({
        ts: typeof entry.timestamp === "string" ? entry.timestamp : "",
        questions: Array.isArray(input?.questions) ? input.questions.length : 1,
      });
    }
  }
  return asks;
}

/**
 * The line an operator reads before the firing begins: the upper bound on
 * interruptions, and how much of it is already gone.
 *
 * An undeclared budget prints "unbounded" rather than nothing. Unlike the spend
 * ceiling this does not refuse to fire — an unbounded question budget is exactly
 * today's behaviour, and refusing every existing vault over a key none of them
 * has would be a stopping state nobody asked for. But it is said out loud, because
 * "the operator always knows the upper bound before the run begins" is the claim,
 * and "there isn't one" is an answer to it.
 */
export function formatQuestionBudget(budget: QuestionBudget | null, measurement?: InterruptionMeasurement): string {
  if (budget === null) {
    return "questions: UNBOUNDED — no `loop.questions` in ost.config.yaml, so this firing may interrupt you any number of times";
  }
  if (!measurement || !measurement.measurable) {
    const why = measurement && !measurement.measurable ? measurement.reason : "interruptions were never measured";
    return `questions: at most ${budget.interruptions} interruption(s) per ${budget.windowHours}h — spent so far UNKNOWN (${why})`;
  }
  const left = Math.max(0, budget.interruptions - measurement.interruptions);
  const detail =
    measurement.questions === measurement.interruptions
      ? ""
      : ` carrying ${measurement.questions} question(s)`;
  return (
    `questions: ${measurement.interruptions} of ${budget.interruptions} interruption(s)${detail} spent ` +
    `in the last ${budget.windowHours}h — ${left} left before this run stops asking and starts banking`
  );
}
