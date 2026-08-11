/**
 * The question bank — how a run writes a fork down instead of stopping at it.
 *
 * When a pass reaches a question only its operator can answer, today it has two
 * moves: interrupt (spend the budget `loop/questions.ts` measures) or stop. The
 * bank is the third: write the question down — the question, the options seen,
 * the option the run would pick and why — together with a PARTITION of the
 * run's remaining work into what can proceed without the answer and what turns
 * on it. The run then carries on with the can-proceed side, and the banked
 * record states exactly how much work the unanswered question is holding up.
 *
 * ## The dependency call is the whole risk, so the rule is committed
 *
 * The load-bearing judgement is not banking (trivial) but deciding what is
 * independent of an answer the run has just proved it does not know. Work built
 * on a wrong independence call is worse than a stall, because it looks
 * finished. So the rule lives here as {@link QUESTION_DEPENDENCE_RULE}, written
 * down in full so it can be disagreed with by name, and it is deliberately
 * CONSERVATIVE: every criterion errs toward "turns on the answer". The failure
 * mode this buys — banking too little and proceeding on less than it could —
 * costs throughput; the failure mode it avoids — a false-independent call —
 * costs correctness.
 *
 * `test/loop/question-stop-independence-replay.test.ts` replays this rule
 * against the seventeen recorded AskUserQuestion stops in the meta vault's nine
 * captured transcripts, blind (nothing after each ask is shown to the rule),
 * against a pre-committed bar: at least 12 of 17 stops must agree with what the
 * session actually did, with at most 2 false-independent calls across the whole
 * set. Read `test/fixtures/question-stops/PROVENANCE.md` before believing the
 * number — the rule was authored against that same corpus, so what the test
 * certifies is on-corpus agreement pinned as a regression bar, not
 * generalization. Generalization is the sibling holdout test's question
 * (`test/loop/authority-class-holdout.test.ts`, which drafts the authority
 * contract's decision classes from the oldest eight stops and places the nine
 * newest against them — see `src/loop/authority-contract.ts`).
 */
import fs from "node:fs";
import path from "node:path";

/** One fork as it was asked: what a blind judge is allowed to see. */
export interface AskedFork {
  /** Header(s) of the question(s) in the ask, joined for a multi-question stop. */
  header: string;
  /** The question text(s), verbatim. */
  question: string;
  /** Every option offered, as `label — description`, all questions pooled. */
  options: string[];
}

/**
 * The rule, stated as named criteria rather than as a model call, so a wrong
 * call can be argued with instead of shrugged at.
 *
 * **What is deliberately not used.** Option descriptions are excluded from
 * subject matching. An option description is the run enumerating consequences,
 * and it routinely names half the repository — matched against it, everything
 * overlaps everything and the partition collapses to "all dependent", which is
 * safe and useless. The question text is where the run names what actually
 * turns on the answer. Options are consulted only for the footing criterion,
 * where their *shape* (every option a different way to proceed with the same
 * work) is the signal.
 */
export const QUESTION_DEPENDENCE_RULE = {
  /**
   * Subject overlap: an item that shares a content term with the question text
   * is about the thing being asked, so it turns on the answer. Matching is
   * exact-token, no stemming — deliberately, because inflection carries
   * identity here ("merge PR #25" is not about a question whose text says
   * "merging PR #3", and `reviewer` is not `review`). Compound tokens
   * (file paths, `origin/main`, `v1-readiness.md`) match only as wholes for
   * the same reason.
   */
  subjectOverlap: true,

  /**
   * Decision artifacts: an item that writes a design, spec, plan or ruling is
   * a synthesis of decisions, and a synthesis cannot be finished around a
   * hole — whatever the answer turns out to be, the artifact has to contain
   * it. Dependent on every open question, whatever the subject overlap says.
   */
  artifactMarkers: /\b(design|spec|plan|ruling)s?\b/i,

  /**
   * Footing forks: when the options are not different work but different ways
   * of proceeding with the same work — a worktree here, wait for the other
   * session, carry on in place — the question is about the run's own footing,
   * and nothing stands on ground the answer does not choose. Detected by
   * option shape: at least {@link footingMinOptions} options carrying a
   * procedural marker.
   */
  footingMarkers: ["worktree", "wait", "proceed", "this session"],
  footingMinOptions: 2,

  /**
   * Broken toolchain: a question that names a broken repository state
   * (a committed conflict, a tree that does not compile) gates every item
   * that has to run the toolchain — a bundle cannot be rebuilt over conflict
   * markers however unrelated its content is.
   */
  brokenStateMarkers: /\b(conflict|conflicts|compile|compiles|broken|unbuildable)\b/i,
  toolchainMarkers: /\b(build|builds|rebuild|bundle|compile|tsc|typecheck|vitest|release|ship)\b/i,
} as const;

/**
 * Words that carry no subject. Beyond ordinary English function words this
 * includes the verbs any item in this repository could contain ("work", "run",
 * "make") — a match on one of those is a match on nothing.
 */
const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can could did do does doing done for from had has have how i if in into is it its " +
    "just may me mean means might more most much must my next no nor not now of off on once one only or other our out over " +
    "own same set should so some such than that the their them then there these they this those to too under until up upon " +
    "us was we were what when where which while who whose why will with would you your yet also both each ever every still " +
    "since about after again against before below between during through very don doesn isn wasn won " +
    "work works working run runs running make makes made making thing things way ways use used using new real right first " +
    "get gets getting go goes going keep keeps let lets need needs want wants"
  ).split(/\s+/),
);

/**
 * Tokenize for subject matching. Compound tokens — anything holding an
 * internal `/`, `.` or `-` — survive whole, so `src/runner/tool.ts` never
 * yields a bare `tool` and `keyless-search` never yields `search`. Ordinal
 * identifiers are fused (`Task 6` → `task-6`, `PR #25` → `pr-25`) so two items
 * about different tasks share no token through the word "task" alone.
 */
export function subjectTokens(text: string): Set<string> {
  const fused = text
    .toLowerCase()
    .replace(/\b(task|tasks|pr|prs|phase|step|criterion|vault)s?\s*#?\s*(\d+)/g, "$1-$2");
  const tokens = new Set<string>();
  for (const match of fused.matchAll(/[a-z0-9_]+(?:[./-][a-z0-9_]+)*/g)) {
    const token = match[0].replace(/^[./-]+|[./-]+$/g, "");
    if (token.length < 3) continue;
    if (STOPWORDS.has(token)) continue;
    if (/^\d+$/.test(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

export interface DependenceCall {
  work: string;
  /** True when this item turns on the unanswered question. */
  turnsOnAnswer: boolean;
  /** Which criterion decided, so a partition can be argued with. */
  why: string;
}

export interface Partition {
  /** Work the run may carry on with while the question is banked. */
  canProceed: string[];
  /** Work held up by the answer — the banked question's stated cost. */
  turnsOnAnswer: string[];
  calls: DependenceCall[];
}

function isFootingFork(fork: AskedFork): boolean {
  const marked = fork.options.filter((option) => {
    const lower = option.toLowerCase();
    return QUESTION_DEPENDENCE_RULE.footingMarkers.some((m) => lower.includes(m));
  });
  return marked.length >= QUESTION_DEPENDENCE_RULE.footingMinOptions;
}

/** Classify one outstanding item against one unanswered fork. */
export function classifyWork(fork: AskedFork, work: string): DependenceCall {
  if (isFootingFork(fork)) {
    return {
      work,
      turnsOnAnswer: true,
      why: "footing: the options are different ways of proceeding with the same work, so everything stands on the answer",
    };
  }
  if (QUESTION_DEPENDENCE_RULE.artifactMarkers.test(work)) {
    return {
      work,
      turnsOnAnswer: true,
      why: "artifact: the item writes a design/spec/plan/ruling, which must contain whatever the answer is",
    };
  }
  const questionText = `${fork.header} ${fork.question}`;
  if (
    QUESTION_DEPENDENCE_RULE.brokenStateMarkers.test(questionText) &&
    QUESTION_DEPENDENCE_RULE.toolchainMarkers.test(work)
  ) {
    return {
      work,
      turnsOnAnswer: true,
      why: "toolchain: the question names a broken repository state and this item has to run the toolchain over it",
    };
  }
  const question = subjectTokens(questionText);
  const item = subjectTokens(work);
  const shared = [...item].filter((t) => question.has(t));
  if (shared.length > 0) {
    return {
      work,
      turnsOnAnswer: true,
      why: `subject: shares ${shared.slice(0, 4).join(", ")} with the question`,
    };
  }
  return { work, turnsOnAnswer: false, why: "no criterion ties this item to the answer" };
}

/** Partition a run's outstanding work against one unanswered fork. */
export function partitionOutstanding(fork: AskedFork, outstanding: readonly string[]): Partition {
  const calls = outstanding.map((work) => classifyWork(fork, work));
  return {
    canProceed: calls.filter((c) => !c.turnsOnAnswer).map((c) => c.work),
    turnsOnAnswer: calls.filter((c) => c.turnsOnAnswer).map((c) => c.work),
    calls,
  };
}

// ---------------------------------------------------------------------------
// The write side — banking a question instead of asking it
// ---------------------------------------------------------------------------

/** What a run writes down at the fork. Everything here is visible at ask time. */
export interface BankedQuestion {
  askedAt: string;
  fork: AskedFork;
  /** The option the run would take on its own, verbatim, when one exists. */
  wouldPick?: string;
  why?: string;
  partition: Partition;
  /** How much work the unanswered question is holding up. */
  cost: number;
}

/** File name of the bank, under the loop's state directory. */
export const QUESTION_BANK_FILENAME = "question-bank.jsonl";

/**
 * Bank one question: classify the outstanding work, append the record, return
 * it. Append-only JSONL for the same reason the health ledger is — a banked
 * question is a fact about a moment, and later moments do not edit it.
 */
export function bankQuestion(
  stateDir: string,
  input: {
    askedAt: string;
    fork: AskedFork;
    wouldPick?: string;
    why?: string;
    outstanding: readonly string[];
  },
): BankedQuestion {
  const partition = partitionOutstanding(input.fork, input.outstanding);
  const record: BankedQuestion = {
    askedAt: input.askedAt,
    fork: input.fork,
    wouldPick: input.wouldPick,
    why: input.why,
    partition,
    cost: partition.turnsOnAnswer.length,
  };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(path.join(stateDir, QUESTION_BANK_FILENAME), `${JSON.stringify(record)}\n`);
  return record;
}

/** Every banked question, oldest first. Corrupt lines cost themselves, never the bank. */
export function readQuestionBank(stateDir: string): BankedQuestion[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(stateDir, QUESTION_BANK_FILENAME), "utf8");
  } catch {
    return [];
  }
  const records: BankedQuestion[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as BankedQuestion);
    } catch {
      continue;
    }
  }
  return records;
}
