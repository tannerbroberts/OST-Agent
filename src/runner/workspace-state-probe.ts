/**
 * The workspace-state probe, and the census that asks whether a *small fixed* set
 * of state questions covers the environment failures this project actually hit.
 *
 * The candidate this measures: "One workspace-state probe the run makes before it
 * plans, not one failing command at a time" — one call, made before the run commits
 * to a plan, returning the **state** facts a plan depends on rather than the path
 * facts a directory listing already gives. Is this a git repository, does it have a
 * remote, which of the binaries this plan will invoke are on PATH, is there a
 * lockfile, has a build ever run here.
 *
 * The node named the risk itself, and it is the whole of what is measured here: *a
 * probe is a guess about which facts will matter.* If covering the failures that
 * actually happened takes twenty questions, the probe is the wrong shape and the
 * plan should declare what it needs instead. So the bar is a **count of questions**,
 * fixed before anything was counted: at most {@link WORKSPACE_STATE_RULE.maxQuestions}
 * questions must cover every captured environment failure, and no failure may require
 * one outside the set.
 *
 * ## Question granularity is part of the rule, because the bar is meaningless without it
 *
 * A count of questions can be made to come out any way at all by changing what
 * counts as one question. "What is the git state here?" is one question if you let it
 * be, and it swallows four of the residuals below. The node did **not** fix this, and
 * fixing it is the one place this census had to decide something the node left open.
 *
 * {@link WORKSPACE_STATE_RULE.granularity} pins it at the granularity **the node's own
 * five questions use**: one question is one fact with a single answer of bounded size.
 * The node split "is this a git repository" from "does it have a remote" — two facts
 * about the same `.git` directory, asked separately — so an aggregate like "what is
 * the git state" is coarser than the thing being measured and would be scoring a
 * different product.
 *
 * The alternative is not hidden. {@link WorkspaceStateCensus.aggregateReading} takes
 * the whole count again under the coarsest defensible grouping — one question per
 * *subsystem* rather than per fact — and reports what the bar does there, so a reader
 * who thinks the granularity call is wrong can read the other number off the report
 * instead of having to re-run the census. That the two readings disagree is itself the
 * finding: **the bar as the node stated it is not decidable until granularity is
 * pinned, and the node did not pin it.**
 *
 * ## Where the corpus comes from, and the direction its errors run
 *
 * The corpus is frozen in `test/fixtures/workspace-state-probe/`, cut by
 * `scripts/harvest-workspace-state-corpus.ts` from the committed
 * `test/fixtures/path-failure-attribution/failures.jsonl` — 719 failing tool calls
 * from this machine's own sessions, already redacted and bounded. Starting there
 * rather than re-reading transcripts means this census and the path-failure census
 * cannot disagree about what failed.
 *
 * Every arguable attribution is resolved **in the solution's favour**. A failure that
 * one of the five questions could plausibly have predicted is credited to it even
 * when the case is thin (see `bare-package-unresolvable` below). That is deliberate:
 * this census came out refuted, and a refutation reached by a harsh classifier is
 * worth nothing. It has to be the generous count that fails.
 *
 * ## What a count out of this cannot settle
 *
 * - **It is bounded by failures that happened, not failures that can happen.** A
 *   question absent from this history may be the one that matters next week. The node
 *   says so; it is the limit that makes the result an argument rather than a proof.
 * - **It counts questions, not cost.** Six questions that are cheap and six that each
 *   cost a subprocess are different products. {@link probeWorkspaceState} is written
 *   to answer all five without spawning anything, which is evidence about cost but is
 *   not what the bar measures.
 * - **It says nothing about whether anyone wants a probe** — only whether one could be
 *   small enough to be worth wanting.
 * - **One machine, one operator.** Every failure here was caused by this project's own
 *   passes.
 */
import type { FailingCall } from "../telemetry/path-failure-attribution.js";

/** A question the probe asks, at the granularity the rule pins. */
export interface StateQuestion {
  /** Stable id, used to attribute a failure to the question that would have predicted it. */
  id: string;
  /** The question in the words a probe would ask it. */
  ask: string;
  /** True for the five the solution node named; false for a question history demanded. */
  fromNode: boolean;
}

/**
 * The five questions the solution node named, in its own words, written down here
 * before the corpus was counted.
 *
 * Nothing has been added to this list. The node's budget is six and it named five,
 * and the empty sixth slot is left empty on purpose: filling it with something read
 * off the corpus is exactly the tuning that would make the count meaningless.
 */
export const NODE_QUESTIONS: StateQuestion[] = [
  { id: "is-git-repo", ask: "Is this directory inside a git repository?", fromNode: true },
  { id: "has-remote", ask: "Does that repository have a remote, and does the current branch track one?", fromNode: true },
  { id: "binaries-on-path", ask: "Which of the binaries this plan will invoke are on PATH?", fromNode: true },
  { id: "has-lockfile", ask: "Is there a dependency lockfile, and are the dependencies it names installed?", fromNode: true },
  { id: "build-has-run", ask: "Has a build ever run here — do the build outputs exist?", fromNode: true },
];

/**
 * Questions this project's own history demanded that the node's five do not ask.
 *
 * These were named **after** reading the corpus, and that ordering is unavoidable: you
 * cannot name what history required without reading history. It is also why they are
 * kept in a separate list with `fromNode: false` rather than mixed in — the thing under
 * test is the node's five, and these are the measurement of what they missed. Each is
 * pitched at the same granularity as the node's own, one fact with one bounded answer.
 */
export const RESIDUAL_QUESTIONS: StateQuestion[] = [
  { id: "ref-name-free", ask: "Is the branch or worktree path this plan will create still free?", fromNode: false },
  { id: "tree-clean-and-in-sync", ask: "Is the working tree clean, and is the current branch ahead of, behind, or diverged from its upstream?", fromNode: false },
  { id: "path-tracked", ask: "Is the path this plan will name to git tracked in the index at this revision?", fromNode: false },
  { id: "shell-version-floor", ask: "Which shell will run this, and does its version have the builtins this plan uses?", fromNode: false },
  { id: "what-is-at-this-path", ask: "What is actually at the path this plan will address?", fromNode: false },
];

/**
 * How a failure's error text is recognised, and which question would have predicted
 * it. First match wins, in this order, so a message carrying two signatures is
 * counted once.
 *
 * `question: null` never appears — a signature that no question answers is attributed
 * to a residual question by name, so "not covered" is always "covered by a question
 * outside the set", which is the form the bar is stated in.
 */
export interface StateSignature {
  /** Stable id for the failure shape. */
  id: string;
  /** What the shape looks like in the error text. */
  pattern: RegExp;
  /** The question that would have predicted it, by id. */
  question: string;
  /**
   * True when the failure names a *path* rather than a state fact. The solution node
   * distinguishes these explicitly — "state facts a plan depends on rather than the
   * path facts a directory listing already gives" — while the assumption test's design
   * sentence asks for "the missing-path failures" too. Both readings are taken; see
   * {@link WorkspaceStateCensus.readings}.
   */
  pathShaped?: boolean;
}

/** The bar, the questions, and the shapes — all fixed before the corpus was counted. */
export const WORKSPACE_STATE_RULE = {
  /**
   * The node's bar: at most this many questions must cover every captured
   * environment failure, with none requiring one more.
   */
  maxQuestions: 6,

  /**
   * What counts as one question, pinned because the bar cannot be decided without it.
   * Stated as prose because it is a judgement, and asserted in the spec so an edit to
   * it shows up as a changed expectation rather than a quietly different finding.
   */
  granularity:
    "one fact with a single, plan-independent answer of bounded size — the granularity the node's own five use, " +
    "evidenced by it asking 'is this a git repository' and 'does it have a remote' as two questions rather than one",

  /**
   * The coarsest defensible alternative: one question per subsystem. Published as a
   * counter-reading rather than argued against — see {@link WorkspaceStateCensus.aggregateReading}.
   */
  subsystemOf: {
    "is-git-repo": "git",
    "has-remote": "git",
    "ref-name-free": "git",
    "tree-clean-and-in-sync": "git",
    "path-tracked": "git",
    "binaries-on-path": "tooling",
    "shell-version-floor": "tooling",
    "has-lockfile": "dependencies",
    "build-has-run": "dependencies",
    "what-is-at-this-path": "filesystem",
  } as Record<string, string>,

  /**
   * Failures that are **not** about workspace state and are dropped before any
   * signature is tested, each because another mechanism in this repository already
   * owns it. Published as counts rather than silently filtered.
   */
  notAboutState: [
    // A literal-match `Edit` failure — the file's content, not the workspace's state.
    // Owned by the failed-literal-match answer in `src/fs/`.
    { id: "literal-match", pattern: /String to replace not found in file/ },
    // A tool the session was never granted. Owned by `src/runner/grant-preflight.ts`,
    // and the larger population in this record — counting it here would swamp the census.
    { id: "tool-not-granted", pattern: /but you haven't granted it yet|user rejected|user doesn't want to (?:proceed|take this action)/i },
    // A wall-clock kill. Transient by definition: no state question predicts it.
    { id: "timed-out", pattern: /Exit code 143|timed out after/i },
    // A worktree-isolation refusal by this repository's own hook, not a workspace fact.
    { id: "worktree-refusal", pattern: /This session is isolated in the worktree/ },
  ] as { id: string; pattern: RegExp }[],

  /**
   * The failure shapes, and the question each one would have been predicted by.
   *
   * Every pattern matches the error message's *text*, which is the only thing a
   * tool-agnostic classifier has. `program-not-on-path` is not here: a bare
   * `X not found` is ambiguous between a missing program and a missing anything-else
   * (`gh release view` answers `release not found`), so it needs the command as well
   * as the error and is decided by {@link namesMissingProgram}.
   */
  signatures: [
    { id: "not-a-repo", pattern: /not a git repository/i, question: "is-git-repo" },
    { id: "no-upstream", pattern: /no upstream branch|no upstream configured/i, question: "has-remote" },
    {
      id: "ref-already-exists",
      pattern: /a branch named '[^']*' already exists|fatal: '[^']*' already exists/,
      question: "ref-name-free",
    },
    {
      id: "tree-dirty-or-diverged",
      pattern: /unstaged changes|divergent branches|Please commit or stash|cannot pull with rebase/i,
      question: "tree-clean-and-in-sync",
    },
    {
      id: "path-not-in-index",
      pattern: /did not match any file|unknown revision or path not in the working tree/,
      question: "path-tracked",
    },
    /**
     * A bare package specifier that would not resolve — `Cannot find package 'yaml'`
     * from a script written into `/tmp`, `Cannot find module '@tetrix/validation'`
     * in a workspace whose sibling was never built.
     *
     * Crediting this to `has-lockfile` is the **generous** call and is flagged as such:
     * a lockfile answers "which package manager, and are dependencies declared", not
     * "will module resolution reach them from where I am writing". The strict reading
     * would send all of these to a residual question and deepen the refutation. The
     * generous one is taken because a refutation reached by a harsh classifier proves
     * nothing.
     */
    {
      id: "bare-package-unresolvable",
      pattern: /Cannot find (?:module|package) '(?![.\\/])[^']+'/,
      question: "has-lockfile",
    },
    {
      id: "missing-path",
      pattern: /no such file or directory|\bPath does not exist\b|\bFile does not exist\b|\bENOENT\b/i,
      question: "what-is-at-this-path",
      pathShaped: true,
    },
  ] as StateSignature[],

  /**
   * Shell builtins that are not programs. `which mapfile` answers nothing whether or
   * not the running bash has it, so the PATH question genuinely cannot predict these
   * — they belong to a shell-version question, which is why `shell-version-floor` is
   * a residual rather than a fold into `binaries-on-path`.
   *
   * Kept short and to bash builtins that a version floor actually decides; this
   * repository's own `src/runner/bash-compat-lint.ts` holds the full version table.
   */
  bashBuiltins: ["mapfile", "readarray", "declare", "typeset", "shopt", "coproc", "local"] as string[],
} as const;

// ── recognising a missing program, which needs the command as well as the error ──

/**
 * Every name a shell said it could not find, read out of one error message.
 *
 * Two tiers, because the two forms carry different amounts of evidence:
 *
 * - **Conclusive.** `command not found: pnpm` (zsh) and `…: line 21: mapfile: command
 *   not found` (bash) are the shell saying it tried to *run* the name. No corroboration
 *   is needed and none is asked for.
 * - **Ambiguous.** A bare `tmux not found` is `which`'s output, and `gh release view`
 *   answers `release not found` in exactly the same shape. These are returned only
 *   when the command shows the name being looked up — see {@link namesMissingProgram}.
 */
export function shellNotFoundNames(error: string): { conclusive: string[]; ambiguous: string[] } {
  const conclusive = new Set<string>();
  const ambiguous = new Set<string>();

  // zsh: `(eval):4: command not found: timeout`
  for (const m of error.matchAll(/command not found:\s*([^\s;]+)/gi)) conclusive.add(m[1]);
  // bash: `/path/to/script: line 21: mapfile: command not found`
  for (const m of error.matchAll(/([A-Za-z_][A-Za-z0-9_.+-]*):\s*command not found/gi)) conclusive.add(m[1]);
  // `which` and friends: a bare `NAME not found`. "command" is excluded because it is
  // the tail of the conclusive forms above, not a program anyone invoked.
  for (const m of error.matchAll(/(?:^|\s)([a-zA-Z][A-Za-z0-9_.+-]*) not found(?=\s|$)/g)) {
    if (m[1] !== "command" && !conclusive.has(m[1])) ambiguous.add(m[1]);
  }
  return { conclusive: [...conclusive], ambiguous: [...ambiguous] };
}

/** Does this command look the name up (`which x`, `command -v x`, `type x`, `hash x`)? */
export function looksUpProgram(command: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:which|command\\s+-v|type|hash)\\s+(?:[^\\n;&|]*?\\s)?${escaped}(?=\\s|$)`).test(command);
}

/**
 * The programs this failure says were not on PATH, and the bash builtins it says the
 * running shell does not have.
 *
 * Split rather than merged because they are answered by different questions, and
 * merging them would credit `binaries-on-path` with a failure it cannot predict.
 */
export function namesMissingProgram(call: FailingCall): { programs: string[]; builtins: string[] } {
  const { conclusive, ambiguous } = shellNotFoundNames(call.error);
  const names = [...conclusive, ...ambiguous.filter((n) => looksUpProgram(call.command, n))];
  const programs: string[] = [];
  const builtins: string[] = [];
  for (const n of names) {
    // A purely numeric token is zsh's line number caught by the bash form, never a program.
    if (/^\d+$/.test(n)) continue;
    (WORKSPACE_STATE_RULE.bashBuiltins.includes(n) ? builtins : programs).push(n);
  }
  return { programs, builtins };
}

// ── classification ───────────────────────────────────────────────────────────

/** One captured environment failure, with the question that would have predicted it. */
export interface ClassifiedEnvironmentFailure {
  session: string;
  /** The failure shape, by {@link StateSignature.id} or `program-not-on-path`/`shell-builtin-missing`. */
  signature: string;
  /** The question that would have predicted it, by {@link StateQuestion.id}. */
  question: string;
  /** True when the failure names a path rather than a state fact. */
  pathShaped: boolean;
  /**
   * True when the failing call was **itself** a state lookup — a `which`/`command -v`
   * asking the very question the probe would have answered.
   *
   * These are not failures the probe would have *predicted*; they are the probe being
   * performed by hand, one binary and one tool call at a time, which is the behaviour
   * the solution's own title names. The node argues from a different case entirely
   * (the failure that arrives after the plan is already made), so this is counted
   * separately rather than folded into either side.
   */
  probedItself: boolean;
  /** The error text, kept so a row can be read rather than trusted. */
  error: string;
}

/** Why a failing call is not in the census, when it is not. */
export type StateExclusion = string;

/**
 * Which environment failure this is, or an exclusion id, or `null` for a failure that
 * is not about the environment at all.
 *
 * The missing-program tiers run **first**: a shell's `command not found` is the most
 * specific thing an error can say about the environment, and letting the generic
 * `missing-path` shape reach it first would file `cat: report2.txt: No such file or
 * directory` and lose the `command not found: timeout` sitting beside it in the same
 * compound command's output.
 */
export function classifyEnvironmentFailure(
  call: FailingCall,
): ClassifiedEnvironmentFailure | { excluded: StateExclusion } | null {
  for (const { id, pattern } of WORKSPACE_STATE_RULE.notAboutState) {
    if (pattern.test(call.error)) return { excluded: id };
  }

  const { programs, builtins } = namesMissingProgram(call);
  const probedItself = [...programs, ...builtins].some((n) => looksUpProgram(call.command, n));
  if (programs.length > 0) {
    return { session: call.session, signature: "program-not-on-path", question: "binaries-on-path", pathShaped: false, probedItself, error: call.error };
  }
  if (builtins.length > 0) {
    return { session: call.session, signature: "shell-builtin-missing", question: "shell-version-floor", pathShaped: false, probedItself, error: call.error };
  }

  for (const sig of WORKSPACE_STATE_RULE.signatures) {
    if (sig.pattern.test(call.error)) {
      return {
        session: call.session,
        signature: sig.id,
        question: sig.question,
        pathShaped: sig.pathShaped === true,
        probedItself: false,
        error: call.error,
      };
    }
  }
  return null;
}

// ── the census ───────────────────────────────────────────────────────────────

/** One reading of "environment failure", widest last. */
export interface StateReading {
  name: string;
  /** Failures scored under this reading. */
  failures: number;
  /** Failures a question from the node's five would have predicted. */
  covered: number;
  /** Distinct questions the reading needs — the node's that fired, plus every residual. */
  questionsNeeded: number;
  /** The residual questions, by id, in the order the rule lists them. */
  residualsUsed: string[];
  /** True when `questionsNeeded` is within the node's budget and nothing needs a seventh. */
  meetsBar: boolean;
}

export interface WorkspaceStateCensus {
  /** Coverage, reported before any verdict: the corpus this was read out of. */
  callsRead: number;
  excluded: { id: string; n: number }[];

  /** Every environment failure, classified. */
  classified: ClassifiedEnvironmentFailure[];
  byQuestion: { question: string; n: number; fromNode: boolean }[];

  /**
   * Questions the node named that predicted **nothing** in this record. Reported
   * because the budget is six and a question that fires on no failure is a slot spent.
   */
  nodeQuestionsUnused: string[];

  /**
   * Failures whose own command was a hand-rolled state lookup. See
   * {@link ClassifiedEnvironmentFailure.probedItself} — a count the node's argument
   * does not use and which points the same way.
   */
  handRolledProbes: number;

  readings: StateReading[];
  /** The headline reading: state-shaped only, the solution node's own words. */
  headline: StateReading;
  /** True when the narrow/wide choice changes the verdict. */
  readingDecides: boolean;

  /**
   * The whole count again with questions grouped by subsystem — the coarsest
   * defensible granularity. Published so a reader who rejects the granularity call can
   * read the other verdict rather than re-derive it.
   */
  aggregateReading: { subsystems: string[]; questionsNeeded: number; meetsBar: boolean };

  /**
   * The two objections to the headline count that run in the solution's favour, each
   * answered with a number rather than an argument:
   *
   * - `trimmed` — drop the node questions that predicted nothing, so the probe carries
   *   only what history asked for. The most favourable set the node's own list allows.
   * - `strict` — the reverse direction, for completeness: withdraw the one generous
   *   attribution ({@link StateSignature} `bare-package-unresolvable` → `has-lockfile`)
   *   and see how much worse the refutation gets.
   */
  counterReadings: {
    trimmed: { dropped: string[]; questionsNeeded: number; meetsBar: boolean };
    strict: { withdrawn: string; failures: number; questionsNeeded: number; meetsBar: boolean };
  };
}

/**
 * The one attribution taken on a thin case, named here so it can be withdrawn and
 * re-counted rather than argued about. See the `bare-package-unresolvable` signature.
 */
export const GENEROUS_ATTRIBUTION = { signature: "bare-package-unresolvable", question: "has-lockfile" } as const;

function readingOf(name: string, rows: ClassifiedEnvironmentFailure[]): StateReading {
  const used = new Set(rows.map((r) => r.question));
  const residualsUsed = RESIDUAL_QUESTIONS.filter((q) => used.has(q.id)).map((q) => q.id);
  const nodeUsed = NODE_QUESTIONS.filter((q) => used.has(q.id));
  const covered = rows.filter((r) => nodeUsed.some((q) => q.id === r.question)).length;
  // The set a probe would have to ask is every node question it keeps (the node's five
  // are a fixed set — an unused one is still carried) plus every residual history forced.
  const questionsNeeded = NODE_QUESTIONS.length + residualsUsed.length;
  return {
    name,
    failures: rows.length,
    covered,
    questionsNeeded,
    residualsUsed,
    meetsBar: questionsNeeded <= WORKSPACE_STATE_RULE.maxQuestions && residualsUsed.length === 0,
  };
}

export function workspaceStateCoverage(
  classified: ClassifiedEnvironmentFailure[],
  meta: { callsRead: number; excluded: { id: string; n: number }[] },
): WorkspaceStateCensus {
  const stateShaped = classified.filter((c) => !c.pathShaped);

  const counts = new Map<string, number>();
  for (const c of classified) counts.set(c.question, (counts.get(c.question) ?? 0) + 1);
  const all = [...NODE_QUESTIONS, ...RESIDUAL_QUESTIONS];
  const byQuestion = all
    .filter((q) => counts.has(q.id))
    .map((q) => ({ question: q.id, n: counts.get(q.id) ?? 0, fromNode: q.fromNode }));

  const narrow = readingOf("state-shaped only (the solution node's wording)", stateShaped);
  const wide = readingOf("with missing-path failures (the assumption test's wording)", classified);
  const readings = [narrow, wide];

  // The aggregate counter-reading: how many questions if one question may cover a whole
  // subsystem. Scored over the headline reading so the two verdicts are comparable.
  const subsystems = [
    ...new Set(stateShaped.map((c) => WORKSPACE_STATE_RULE.subsystemOf[c.question] ?? c.question)),
  ].sort();

  // Trim: carry only the node questions this history actually asked for.
  const dropped = NODE_QUESTIONS.filter((q) => !counts.has(q.id)).map((q) => q.id);
  const trimmedNeeded = NODE_QUESTIONS.length - dropped.length + narrow.residualsUsed.length;

  // Strict: withdraw the generous attribution and send those failures to a residual.
  const strictRows = stateShaped.map((c) =>
    c.signature === GENEROUS_ATTRIBUTION.signature ? { ...c, question: "deps-resolvable-from-here" } : c,
  );
  const strictUsed = new Set(strictRows.map((r) => r.question));
  const strictNeeded =
    NODE_QUESTIONS.length + [...strictUsed].filter((id) => !NODE_QUESTIONS.some((q) => q.id === id)).length;

  return {
    callsRead: meta.callsRead,
    excluded: meta.excluded,
    classified,
    byQuestion,
    nodeQuestionsUnused: NODE_QUESTIONS.filter((q) => !counts.has(q.id)).map((q) => q.id),
    handRolledProbes: classified.filter((c) => c.probedItself).length,
    readings,
    headline: narrow,
    readingDecides: narrow.meetsBar !== wide.meetsBar,
    aggregateReading: {
      subsystems,
      questionsNeeded: subsystems.length,
      meetsBar: subsystems.length <= WORKSPACE_STATE_RULE.maxQuestions,
    },
    counterReadings: {
      trimmed: {
        dropped,
        questionsNeeded: trimmedNeeded,
        meetsBar: trimmedNeeded <= WORKSPACE_STATE_RULE.maxQuestions && narrow.residualsUsed.length === 0,
      },
      strict: {
        withdrawn: GENEROUS_ATTRIBUTION.signature,
        failures: stateShaped.filter((c) => c.signature === GENEROUS_ATTRIBUTION.signature).length,
        questionsNeeded: strictNeeded,
        meetsBar: strictNeeded <= WORKSPACE_STATE_RULE.maxQuestions,
      },
    },
  };
}

/**
 * The census as an operator reads it: what was read, then the verdict in words, then
 * the numbers that could overturn it.
 *
 * The verdict says CLEARS or REFUTED rather than leaving a reader to compare two
 * integers, because this census exists to license the solution or kill it and an exit
 * code cannot carry that distinction — the command is green when the count has been
 * taken, whichever way it came out.
 */
export function formatWorkspaceStateCensus(census: WorkspaceStateCensus): string {
  const lines: string[] = [];
  const h = census.headline;
  lines.push(
    `Workspace-state question coverage: ${h.meetsBar ? "CLEARS" : "REFUTED"} — covering the ` +
      `${h.failures} captured environment failure(s) takes ${h.questionsNeeded} question(s), ` +
      `against a pre-committed budget of ${WORKSPACE_STATE_RULE.maxQuestions}.`,
  );
  lines.push(
    `Read from ${census.callsRead} failing call(s): ${census.classified.length} are about workspace state, ` +
      `${h.covered} of the ${h.failures} state-shaped ones predicted by a question the node named.`,
  );

  lines.push("");
  lines.push("By question:");
  for (const q of census.byQuestion) {
    lines.push(`  ${q.question.padEnd(24)} ${String(q.n).padStart(3)}  ${q.fromNode ? "(node)" : "OUTSIDE THE SET"}`);
  }
  if (census.nodeQuestionsUnused.length > 0) {
    lines.push(
      `Named by the node and predicted nothing: ${census.nodeQuestionsUnused.join(", ")} — ` +
        `a slot of the ${WORKSPACE_STATE_RULE.maxQuestions} spent on a question this history never asked.`,
    );
  }
  if (census.handRolledProbes > 0) {
    lines.push(
      `${census.handRolledProbes} of these failing call(s) WERE the probe — a bare \`which\`, run for its own sake, ` +
        `one binary at a time. The probe would not have predicted them; it would have replaced them.`,
    );
  }

  lines.push("");
  for (const r of census.readings) {
    lines.push(
      `  ${r.name.padEnd(52)} ${r.failures} failure(s), ${r.questionsNeeded} question(s) — ` +
        `${r.meetsBar ? "clears" : "over"} the budget`,
    );
  }
  lines.push(
    census.readingDecides
      ? "  THE READING DECIDES THIS."
      : "  Both readings agree; the missing-path choice does not decide the verdict.",
  );

  const { trimmed, strict } = census.counterReadings;
  lines.push("");
  lines.push(
    `Counter-reading — drop the ${trimmed.dropped.length} node question(s) that predicted nothing ` +
      `(${trimmed.dropped.join(", ") || "none"}): ${trimmed.questionsNeeded} question(s), ` +
      `${trimmed.meetsBar ? "which clears the budget" : "which still does not clear the budget"}.`,
  );
  lines.push(
    `Counter-reading — withdraw the one generous attribution (${strict.withdrawn}, ${strict.failures} failure(s)): ` +
      `${strict.questionsNeeded} question(s), ` +
      `${strict.meetsBar ? "which clears the budget" : "which does not clear the budget either"}.`,
  );
  lines.push(
    `Counter-reading — one question per subsystem (${census.aggregateReading.subsystems.join(", ")}): ` +
      `${census.aggregateReading.questionsNeeded} question(s), ` +
      `${census.aggregateReading.meetsBar ? "which clears the budget" : "which still does not clear the budget"}. ` +
      `The bar is not decidable without pinning granularity; this census pins it at "${WORKSPACE_STATE_RULE.granularity}".`,
  );

  if (census.excluded.length > 0) {
    lines.push("");
    lines.push("Not about workspace state, dropped before any signature was tested:");
    for (const e of census.excluded) lines.push(`  ${e.id.padEnd(24)} ${e.n}`);
  }
  return lines.join("\n");
}

// ── the probe itself ─────────────────────────────────────────────────────────

/**
 * The filesystem facts the probe reads. Injected so the probe is tested offline
 * against a fake tree rather than against whatever machine the suite runs on.
 */
export interface ProbeFs {
  /** Does this absolute path exist (file or directory)? */
  exists(path: string): boolean;
  /** Read a file, or `null` when it is not there. */
  read(path: string): string | null;
}

/** What the probe was asked to look at. */
export interface ProbeRequest {
  /** Absolute directory the run is about to plan in. */
  cwd: string;
  /** The binaries this plan intends to invoke. The one plan-dependent input. */
  binaries: readonly string[];
  /** PATH, split into directories. */
  pathDirs: readonly string[];
}

/** One answer per question, in the order {@link NODE_QUESTIONS} asks them. */
export interface WorkspaceState {
  /** The repository root, or `null` when nothing above `cwd` is a repository. */
  gitRoot: string | null;
  /** Remote names read out of `.git/config`, empty when there are none. */
  remotes: string[];
  /** Binaries the plan named, each with the PATH directory it was found in or `null`. */
  binaries: { name: string; foundIn: string | null }[];
  /** The lockfile found at the repository root or `cwd`, or `null`. */
  lockfile: string | null;
  /** Build outputs that exist — evidence a build has run here. */
  buildOutputs: string[];
}

/** Lockfiles, in the order they are looked for. */
const LOCKFILES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"];

/** Directories whose presence is evidence a build has run. */
const BUILD_OUTPUTS = ["dist", "build", "out", "node_modules/.cache"];

/**
 * Answer all five questions in one call, without spawning a process.
 *
 * Every answer is read off the filesystem: the repository by walking up for `.git`,
 * the remotes by parsing `.git/config`, the binaries by scanning PATH directly rather
 * than shelling out to `which`. That is not what the bar measures — the bar counts
 * questions — but it is the evidence available about the other half of the node's own
 * caveat, that "six questions that are cheap and six that each cost a subprocess are
 * different products".
 */
export function probeWorkspaceState(req: ProbeRequest, fsLike: ProbeFs): WorkspaceState {
  const gitRoot = findGitRoot(req.cwd, fsLike);

  const remotes: string[] = [];
  if (gitRoot) {
    const config = fsLike.read(`${gitRoot}/.git/config`);
    if (config) {
      for (const m of config.matchAll(/^\s*\[remote\s+"([^"]+)"\]/gm)) remotes.push(m[1]);
    }
  }

  const binaries = req.binaries.map((name) => ({
    name,
    foundIn: req.pathDirs.find((dir) => fsLike.exists(`${dir}/${name}`)) ?? null,
  }));

  const root = gitRoot ?? req.cwd;
  const lockfile = LOCKFILES.find((f) => fsLike.exists(`${root}/${f}`)) ?? null;
  const buildOutputs = BUILD_OUTPUTS.filter((d) => fsLike.exists(`${root}/${d}`));

  return { gitRoot, remotes, binaries, lockfile, buildOutputs };
}

/** The nearest ancestor-or-self of `dir` holding a `.git`, or `null`. */
export function findGitRoot(dir: string, fsLike: ProbeFs): string | null {
  let cur = dir.length > 1 && dir.endsWith("/") ? dir.slice(0, -1) : dir;
  while (cur.length > 0) {
    if (fsLike.exists(`${cur}/.git`)) return cur;
    if (cur === "/") return null;
    const parent = cur.slice(0, cur.lastIndexOf("/"));
    cur = parent.length === 0 ? "/" : parent;
  }
  return null;
}

/**
 * The probe's answers as the run reads them: five lines, one per question, each
 * saying the fact rather than inviting a follow-up call. A `no` says what it looked
 * at, because "not a repository" and "a repository with no remote" send a plan in
 * different directions and a bare `no` would collapse them.
 */
export function renderWorkspaceState(state: WorkspaceState, req: ProbeRequest): string {
  const missing = state.binaries.filter((b) => b.foundIn === null).map((b) => b.name);
  const present = state.binaries.filter((b) => b.foundIn !== null).map((b) => b.name);
  return [
    `workspace state (${req.cwd}):`,
    `  git repository: ${state.gitRoot ?? `no — nothing above ${req.cwd} holds a .git`}`,
    `  remotes: ${state.remotes.length > 0 ? state.remotes.join(" ") : state.gitRoot ? "none configured" : "n/a — not a repository"}`,
    `  binaries: ${present.length > 0 ? `on PATH ${present.join(" ")}` : "none of the named binaries are on PATH"}` +
      (missing.length > 0 ? `; MISSING ${missing.join(" ")}` : ""),
    `  lockfile: ${state.lockfile ?? "none"}`,
    `  build outputs: ${state.buildOutputs.length > 0 ? state.buildOutputs.join(" ") : "none — no build has run here"}`,
  ].join("\n");
}
