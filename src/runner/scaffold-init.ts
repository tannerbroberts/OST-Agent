/**
 * The scaffold-init census: would initialising **only the directories this tool
 * scaffolded** have prevented the exit-128 failures this project actually suffered,
 * and is initialising safe everywhere it would have run?
 *
 * The candidate this measures is "Scaffolding initialises unconditionally, so the
 * state is never in question" — remove the variance rather than detect it, so "is this
 * a repository?" stops being a question anybody has to ask, probe for, or record. Its
 * two siblings under the same opportunity make the reader pay
 * (`src/runner/workspace-state-probe.ts`) or the writer pay once (a manifest); this one
 * claims nobody pays.
 *
 * The node did **not** ask for the broad rule to be built, and neither does this. Its
 * own text narrows it before the definition of done: *"initialise unconditionally when
 * scaffolding a new directory this tool created, and never touch a directory it did not
 * create"*, because the broad form is an unrequested write to the operator's disk in a
 * product whose trust story is that it does not take irreversible actions unprompted.
 * The assumption test then asks the two questions that narrowing raises, and they are
 * the whole of what is measured here:
 *
 *   1. **Coverage.** Would the narrowed rule have prevented the captured failures? If
 *      it only works in the broad form, the candidate works only in a shape it should
 *      not ship in, and that is a kill rather than a shortfall.
 *   2. **Safety where it would run.** A `git init` inside a directory that is already
 *      inside another working tree creates a nested repository that is genuinely
 *      confusing to unpick. Does any scaffold target in the record sit inside one?
 *
 * Both clauses must pass. {@link SCAFFOLD_INIT_RULE} fixes them, and every term either
 * clause turns on is pinned there before a single row was counted.
 *
 * ## Two things a reader of the exit code has to be told
 *
 * **The census came out refuted, and the command is green anyway.** That is this
 * repository's convention for a census — `test/runner/workspace-state-probe-coverage.test.ts`
 * and `test/runner/workspace-map-coverage.test.ts` both pin a refuted count the same
 * way. The exit code says the count has been taken and has not moved; it does not say
 * the assumption held. {@link ScaffoldInitCensus.headline}`.meetsBar` is the verdict,
 * and the spec asserts it `false` by name so it cannot be skimmed past.
 *
 * **The solution node's "red today" is wrong about this repository.** It says
 * "scaffolding does not initialise". `initVault` in `src/runner/init.ts` has called
 * `gitInitIfAbsent` on every scaffold since the command existed, with no flag to skip
 * it — the narrowed rule is not a proposal here, it is shipped behaviour. What the
 * census therefore measures is not whether the mechanism could be built but whether it
 * is *aimed at these failures*, and the answer is that it is not: not one captured
 * failure happened in a directory this tool scaffolded. {@link ScaffoldInitCensus.alreadyShipped}
 * carries this so the finding travels with the number.
 *
 * ## What this census cannot settle
 *
 * - **Consent.** Whether an operator accepts an unrequested write to their disk at all
 *   is not a coverage question and no count answers it. The assumption test says so
 *   itself: if the answer is no at any scope, the candidate is dead however this comes
 *   out.
 * - **The second clause passes on an empty room.** Every scaffold target in the record
 *   is a throwaway under `/tmp` or a `mktemp -d`, so "no target lies inside an existing
 *   working tree" is a fact about what has been *tried*, not about what is safe. It is
 *   reported as {@link NestingClause.vacuous} rather than as a clean pass, and the
 *   record's own nested repositories — created by `git worktree add`, not by scaffolding
 *   — are counted beside it to show the shape is not hypothetical.
 * - **One machine, one operator.** Every failure counted here was caused by this
 *   project's own passes.
 */
import path from "node:path";
import type { FailingCall } from "../telemetry/path-failure-attribution.js";

// ── the rule, fixed before the corpus was counted ────────────────────────────

/**
 * What "a directory this tool created" is allowed to mean.
 *
 * The bar cannot be decided without this and the node did not pin it, which is the one
 * place this census had to close something the node left open. Both readings are run
 * and both are published: the strict one is the bar, the generous one is the
 * counter-reading that runs in the candidate's favour.
 */
export type CreatorReading = "scaffolder" | "any-agent-tool";

/** The two clauses, and every term they turn on. */
export const SCAFFOLD_INIT_RULE = {
  /**
   * Clause one, in the assumption test's own words: the narrowed rule must cover
   * **all** the captured failures. Not most, not the ones the node happened to cite —
   * a rule that covers some of them is a rule that leaves the failure mode in place.
   */
  coverageMustBeTotal: true,

  /**
   * What counts as "created by this tool", pinned because clause one is undecidable
   * without it.
   *
   * `scaffolder` is the bar. "This tool" is OST-Agent, and OST-Agent has exactly one
   * thing that creates a workspace: `initVault` in `src/runner/init.ts`, reached by
   * `ost-agent init`. A directory is tool-created when the record shows that command
   * pointed at it.
   *
   * `any-agent-tool` is the generous reading, and it is generous on purpose: it counts
   * a directory as tool-created if *any* tool call in the record brought it into
   * existence — a `Write` to a file inside it, a `mkdir`, a `git worktree add`. That
   * reading credits the candidate with directories OST-Agent has never heard of, which
   * is why it is a counter-reading and not the bar. It is run because if even the
   * generous reading does not clear, no argument about definitions can rescue the
   * count.
   */
  creatorReadings: {
    scaffolder:
      "created by this tool's own scaffolder — the record shows `ost-agent init` pointed at this directory. " +
      "OST-Agent has exactly one workspace-creating command and this is it.",
    "any-agent-tool":
      "created by any tool call in the record — a Write to a file inside it, a mkdir, a git worktree add. " +
      "Generous: it credits the rule with directories the scaffolder has never been pointed at.",
  } as Record<CreatorReading, string>,

  /** The reading the bar is decided on. The other is published beside it. */
  bar: "scaffolder" as CreatorReading,

  /**
   * Clause two: no scaffold target in the record may lie **strictly** inside an
   * existing working tree.
   *
   * Strictly, because a target that *is* a repository root is not a nested repository —
   * `gitInitIfAbsent` returns false there and nothing happens. The harm the node names
   * is a fresh `.git` appearing *under* another one.
   */
  nestingIsStrictContainment: true,

  /**
   * How a captured failure is recognised. One shape, deliberately: this is the exact
   * failure the parent opportunity was cut from — a command that assumed a repository
   * and learned otherwise from git's own words.
   */
  failureSignature: /fatal: not a git repository \(or any of the parent directories\)/,
} as const;

/**
 * The sessions the solution node cites, in its own words: "all four captured exit-128
 * sessions were freshly-scaffolded folders".
 *
 * Written down so the census can say whether the node was counting the same thing it
 * was. It was not: the record holds six, in four directories, and two of the six are
 * not in the node's list at all.
 */
export const CITED_SESSIONS = [
  "ac007b7b-ac18-4a19-94f1-cb5f3c93ca42",
  "748498c4-31fb-4110-9012-464c441a463f",
  "9a406570-323c-453a-b4ca-a29b4aa01f18",
  "35566d8b-a635-49b1-acc8-6bfbeeb134e7",
];

/**
 * Directories where initialising would have been **worse than doing nothing**, with the
 * evidence from the record that says so.
 *
 * This is the distinction the coverage count on its own cannot draw. "The rule would not
 * have fired here" is a shortfall; "the rule would have fired here and made things worse"
 * is an argument against the rule. Only a directory with a creating call in the record
 * that *intended* it to be a repository can be in this map — otherwise the claim would be
 * a guess about intent.
 */
export const HARMFUL_TARGETS: Record<string, string> = {
  "/tmp/ost-main":
    "the directory was the carcass of a pruned worktree — `git worktree add /tmp/ost-main main` had just answered " +
    "`fatal: '/tmp/ost-main' already exists`, and `ls -la` found twelve top-level entries of checked-out content with " +
    "no .git among them. A fresh `git init` there produces a repository holding a whole tree of untracked files, " +
    "disconnected from the history the run believed it was standing on, and the run's next act would have been to " +
    "commit against it. The probe's `fatal:` is the cheaper answer.",
};

// ── recognising the failures, and where each one happened ────────────────────

/** A captured exit-128 failure, with the directory it happened in. */
export interface UninitialisedRepoFailure extends FailingCall {
  /**
   * The directory the command ran in, read off its own leading `cd`. Null when the
   * command does not say — a row whose directory is unknown cannot be attributed to a
   * creator either way, and is counted as uncovered rather than dropped.
   */
  dir: string | null;
  /** How many times the error appears in this one call — a compound command can hit it twice. */
  occurrences: number;
}

/**
 * A compound command split into the segments a shell would run in order.
 *
 * Crude on purpose — it does not understand quoting or subshells. It is used for two
 * things only: finding the `cd`s, and finding the `init`s. Both are the first token of
 * their segment in every row in this record, and a splitter that got a heredoc wrong
 * would still find them in the right order.
 */
export function shellSegments(command: string): string[] {
  return command
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The path a `cd` segment moves to, or null when the segment is not a `cd`. */
function cdTarget(segment: string): string | null {
  const m = /^cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))\s*$/.exec(segment);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
}

/**
 * The directory the segment at `index` ran in, folding every `cd` before it.
 *
 * A tool call has no persistent shell, so the cwd has to be re-stated inside the
 * command every time — which makes the command its own record of where it ran. Reading
 * only the *leading* `cd` gets that wrong for the shape this record is full of,
 * `cd /tmp && mkdir x && cd x && …`, where the interesting directory is the second one.
 *
 * Returns null when no `cd` before `index` lands on an absolute path: the command does
 * not say where it ran, and a census that guessed would be inventing the fact it counts.
 */
export function workingDirectoryAt(segments: string[], index: number): string | null {
  let cwd: string | null = null;
  for (let i = 0; i < index && i < segments.length; i++) {
    const target = cdTarget(segments[i]);
    if (target === null) continue;
    if (/[$`]/.test(target)) return null; // a cd nobody can resolve poisons everything after it
    cwd = target.startsWith("/") ? path.resolve(target) : cwd === null ? null : path.resolve(cwd, target);
  }
  return cwd;
}

/** Where a command ended up, folding every `cd` it contains. */
export function workingDirectoryOf(command: string): string | null {
  const segments = shellSegments(command);
  return workingDirectoryAt(segments, segments.length);
}

/**
 * Recognise the one failure shape this census counts, or return null.
 *
 * Matched on git's own message rather than on the exit code: `Exit code 128` covers
 * divergent branches, an already-existing branch name, a bad pathspec and a missing
 * upstream too, and none of those is a question about whether the directory is a
 * repository at all.
 */
export function classifyUninitialisedRepoFailure(call: FailingCall): UninitialisedRepoFailure | null {
  const hits = call.error.match(new RegExp(SCAFFOLD_INIT_RULE.failureSignature, "g"));
  if (!hits) return null;
  return { ...call, dir: workingDirectoryOf(call.command), occurrences: hits.length };
}

// ── the scaffold targets, and whether any of them nests ──────────────────────

/** A directory `ost-agent init` was pointed at, as the record shows it. */
export interface ScaffoldTarget {
  /** The resolved absolute path, or null when the target is a shell variable. */
  dir: string | null;
  /** The `init` invocation, bounded, so a row can be read rather than trusted. */
  command: string;
  /** Session the invocation came from. */
  session: string;
  /**
   * Why an unresolved target is unresolved. A `mktemp -d` or a `$V` cannot be turned
   * into a path after the fact, and pretending otherwise would let the safety clause
   * pass on rows nobody checked.
   */
  unresolved?: string;
}

/**
 * A directory the record shows to be **inside** a git working tree, because a git read
 * succeeded there.
 *
 * Deliberately not "a repository root". A successful `git status` in
 * `.../tetrix-game-monorepo/apps/frontend` proves that directory is inside a working
 * tree; it does not prove it is the top of one. Clause two asks about containment, and
 * containment is exactly what this establishes — so the weaker, provable fact is the
 * one recorded, rather than a root the record cannot actually name.
 *
 * Only *reads* count. `git init`, `git clone` and `git worktree add` can create the
 * repository they run against, and a working tree established by one of those would be
 * the census assuming its own conclusion.
 */
export interface WorkingTreeDir {
  dir: string;
  /** How many successful git reads the record has in this directory. */
  reads: number;
}

/**
 * The nearest directory known to be inside a working tree that strictly contains `dir`,
 * or null.
 *
 * Longest match wins, so a target under `.../OST-Agent/.worktrees/x` is attributed to
 * the worktree rather than to the repository the worktree hangs off — the nearer tree
 * is the one a fresh `.git` would sit inside.
 *
 * Strict: a directory does not contain itself. A scaffold target that *is* an existing
 * working tree is not a nested repository — `gitInitIfAbsent` returns false there and
 * nothing happens.
 */
export function enclosingWorkingTree(dir: string, trees: WorkingTreeDir[]): string | null {
  let best: string | null = null;
  for (const tree of trees) {
    if (dir === tree.dir) continue;
    const rel = path.relative(tree.dir, dir);
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (best === null || tree.dir.length > best.length) best = tree.dir;
  }
  return best;
}

/** Clause two's result. */
export interface NestingClause {
  /** Targets checked — the resolved ones. */
  checked: number;
  /** Targets that could not be resolved to a path, and so were not checked. */
  unresolved: number;
  /** Any target that would produce a nested repository, with the root it sits inside. */
  nested: { target: string; inside: string }[];
  /** True when nothing nests. */
  passes: boolean;
  /**
   * True when it passes only because nothing real was tried: every checked target is a
   * throwaway under a temp root. A pass on an empty room is not evidence of safety, and
   * this is what stops it being read as one.
   */
  vacuous: boolean;
  /** The temp roots that make it vacuous, and how many targets sit under them. */
  underTempRoot: number;
  /**
   * Repositories the record *does* contain inside another working tree — every one made
   * by `git worktree add`, never by scaffolding. Counted so the safety question is not
   * dismissed as theoretical on the strength of the scaffolder never having been aimed
   * at one.
   *
   * A **floor**, not a total: the only nested repositories countable here are the ones a
   * `git worktree add` in a Bash call created. The harness's own worktree-isolation tool
   * makes them too and leaves no such command in the record, so the record shows more
   * nested working trees than this count can attribute.
   */
  nestedWorkingTreesInRecord: { dir: string; inside: string }[];
}

/** Prefixes under which a directory is a throwaway rather than an operator's workspace. */
const TEMP_ROOTS = ["/tmp/", "/private/tmp/", "/private/var/folders/", "/var/folders/"];

function isThrowaway(dir: string): boolean {
  return TEMP_ROOTS.some((p) => dir.startsWith(p));
}

export function nestingClause(
  targets: ScaffoldTarget[],
  trees: WorkingTreeDir[],
  worktreesAdded: string[] = [],
): NestingClause {
  const resolved = targets.filter((t): t is ScaffoldTarget & { dir: string } => t.dir !== null);
  const nested: { target: string; inside: string }[] = [];
  for (const t of resolved) {
    const inside = enclosingWorkingTree(t.dir, trees);
    if (inside) nested.push({ target: t.dir, inside });
  }
  const underTempRoot = resolved.filter((t) => isThrowaway(t.dir)).length;
  const nestedWorkingTreesInRecord: { dir: string; inside: string }[] = [];
  for (const dir of worktreesAdded) {
    const inside = enclosingWorkingTree(dir, trees);
    if (inside) nestedWorkingTreesInRecord.push({ dir, inside });
  }
  return {
    checked: resolved.length,
    unresolved: targets.length - resolved.length,
    nested: dedupe(nested, (n) => `${n.target} ${n.inside}`),
    passes: nested.length === 0,
    vacuous: nested.length === 0 && underTempRoot === resolved.length,
    underTempRoot,
    nestedWorkingTreesInRecord: dedupe(nestedWorkingTreesInRecord, (n) => n.dir),
  };
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(row);
  }
  return out;
}

// ── the creation evidence ────────────────────────────────────────────────────

/** What the record says brought a directory into existence. */
export interface CreationEvidence {
  dir: string;
  /**
   * The tool call that created it, as the record shows it. Null when no creating call
   * survives — two of the sessions this census counts are no longer on disk, and a
   * missing transcript is recorded as a missing transcript rather than as a "no".
   */
  creator: { session: string; tool: string; command: string } | null;
  /** True when the creator was `ost-agent init`. Decides the bar reading. */
  byScaffolder: boolean;
  /** Why no creator was found, when none was. */
  absent?: "transcript-gone" | "no-creating-call-found";
}

// ── the census ───────────────────────────────────────────────────────────────

/** One directory the captured failures happened in. */
export interface DirectoryRow {
  dir: string;
  /** Failures the record has in this directory. */
  failures: number;
  /** Distinct sessions that hit them. */
  sessions: string[];
  /** Would the narrowed rule have initialised this directory, on the bar reading? */
  coveredByScaffolder: boolean;
  /** …and on the generous one? */
  coveredByAnyTool: boolean;
  /** What the record says created it. */
  evidence: CreationEvidence;
  /**
   * True when initialising here would have been **wrong**, not merely inapplicable —
   * the directory was supposed to be a repository by some other mechanism, and a fresh
   * `.git` would have hidden that it was not.
   */
  initWouldHarm: boolean;
  /** Why, in a sentence, when it would. */
  harm?: string;
}

export interface ScaffoldInitCensus {
  headline: {
    /** Captured failures counted. */
    failures: number;
    /** Distinct directories they happened in. */
    directories: number;
    /** Failures the narrowed rule would have prevented, on the bar reading. */
    covered: number;
    /** Both clauses pass. */
    meetsBar: boolean;
  };
  /** Clause one, on each reading of "tool-created". */
  coverage: Record<CreatorReading, { covered: number; failures: number; passes: boolean }>;
  /** Clause two. */
  nesting: NestingClause;
  /** One row per directory. */
  byDirectory: DirectoryRow[];
  /**
   * The sessions the node cited, and the sessions the record actually holds. The node
   * says four; the record says six. Published because a count taken over the node's
   * four would come out differently from a count taken over the record, and the reader
   * is entitled to know which one they are reading.
   */
  citedVersusFound: { cited: string[]; found: string[]; uncited: string[] };
  /**
   * The mechanism the candidate proposes, already shipped. See the module header — the
   * node's "red today" is wrong about this repository, and the shipped call is why.
   */
  alreadyShipped: { where: string; call: string; skippable: boolean };
  /** Directories where initialising would have been actively wrong. */
  harmful: DirectoryRow[];
  /** Failures whose directory the record does not name. */
  directoryUnknown: number;
}

export function scaffoldInitCoverage(
  failures: UninitialisedRepoFailure[],
  targets: ScaffoldTarget[],
  trees: WorkingTreeDir[],
  evidence: CreationEvidence[],
  opts: { citedSessions: string[]; harm: Record<string, string>; worktreesAdded?: string[] },
): ScaffoldInitCensus {
  const byDir = new Map<string, UninitialisedRepoFailure[]>();
  let directoryUnknown = 0;
  for (const f of failures) {
    if (f.dir === null) {
      directoryUnknown++;
      continue;
    }
    const rows = byDir.get(f.dir) ?? [];
    rows.push(f);
    byDir.set(f.dir, rows);
  }

  const evidenceFor = new Map(evidence.map((e) => [e.dir, e]));
  const byDirectory: DirectoryRow[] = [...byDir.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, rows]) => {
      const ev = evidenceFor.get(dir) ?? { dir, creator: null, byScaffolder: false, absent: "no-creating-call-found" as const };
      const harm = opts.harm[dir];
      return {
        dir,
        failures: rows.length,
        sessions: [...new Set(rows.map((r) => r.session))].sort(),
        coveredByScaffolder: ev.byScaffolder,
        coveredByAnyTool: ev.creator !== null,
        evidence: ev,
        initWouldHarm: harm !== undefined,
        ...(harm !== undefined ? { harm } : {}),
      };
    });

  const countFailures = (pick: (row: DirectoryRow) => boolean): number =>
    byDirectory.filter(pick).reduce((n, row) => n + row.failures, 0);

  const total = failures.length;
  const coverage: ScaffoldInitCensus["coverage"] = {
    scaffolder: { covered: countFailures((r) => r.coveredByScaffolder), failures: total, passes: false },
    "any-agent-tool": { covered: countFailures((r) => r.coveredByAnyTool), failures: total, passes: false },
  };
  for (const reading of Object.keys(coverage) as CreatorReading[]) {
    coverage[reading].passes = coverage[reading].covered === total;
  }

  const nesting = nestingClause(targets, trees, opts.worktreesAdded ?? []);
  const found = [...new Set(failures.map((f) => f.session))].sort();

  return {
    headline: {
      failures: total,
      directories: byDirectory.length,
      covered: coverage[SCAFFOLD_INIT_RULE.bar].covered,
      meetsBar: coverage[SCAFFOLD_INIT_RULE.bar].passes && nesting.passes,
    },
    coverage,
    nesting,
    byDirectory,
    citedVersusFound: {
      cited: [...opts.citedSessions].sort(),
      found,
      uncited: found.filter((s) => !opts.citedSessions.includes(s)),
    },
    alreadyShipped: {
      where: "src/runner/init.ts",
      call: "gitInitIfAbsent(abs)",
      skippable: false,
    },
    harmful: byDirectory.filter((r) => r.initWouldHarm),
    directoryUnknown,
  };
}

// ── the report ───────────────────────────────────────────────────────────────

export function formatScaffoldInitCensus(census: ScaffoldInitCensus): string {
  const h = census.headline;
  const lines: string[] = [];
  lines.push(
    `Scaffold-init coverage: ${h.meetsBar ? "MET" : "REFUTED"} — the narrowed rule would have prevented ` +
      `${h.covered} of ${h.failures} captured failure(s), across ${h.directories} directory(ies).`,
  );
  lines.push("");
  lines.push("Clause 1 — would the narrowed rule have covered them?");
  for (const reading of Object.keys(census.coverage) as CreatorReading[]) {
    const c = census.coverage[reading];
    lines.push(
      `  ${reading === SCAFFOLD_INIT_RULE.bar ? "[bar]     " : "[generous]"} ${reading}: ` +
        `${c.covered}/${c.failures} — ${c.passes ? "covers all" : "does not cover all"}`,
    );
  }
  lines.push("");
  for (const row of census.byDirectory) {
    const creator = row.evidence.creator
      ? `${row.evidence.creator.tool}: ${row.evidence.creator.command}`
      : `no creating call in the record (${row.evidence.absent})`;
    lines.push(`  ${row.dir} — ${row.failures} failure(s) in ${row.sessions.length} session(s)`);
    lines.push(`      created by: ${creator}`);
    if (row.initWouldHarm) lines.push(`      INITIALISING HERE WOULD HAVE BEEN WRONG: ${row.harm}`);
  }
  lines.push("");
  lines.push("Clause 2 — would any scaffold target produce a nested repository?");
  lines.push(
    `  ${census.nesting.nested.length} of ${census.nesting.checked} checked target(s) nest` +
      `${census.nesting.unresolved > 0 ? `, ${census.nesting.unresolved} unresolvable and not checked` : ""}.`,
  );
  if (census.nesting.vacuous) {
    lines.push(
      `  This clause PASSES VACUOUSLY: all ${census.nesting.checked} checked target(s) are throwaways under a ` +
        `temp root, so the record says what has been tried, not what is safe.`,
    );
    lines.push(
      `  The record does hold ${census.nesting.nestedWorkingTreesInRecord.length} nested repository(ies), all made by ` +
        `git worktree add rather than by scaffolding — the shape is not hypothetical.`,
    );
  }
  lines.push("");
  lines.push(
    `The node cited ${census.citedVersusFound.cited.length} session(s); the record holds ` +
      `${census.citedVersusFound.found.length}. Uncited: ${census.citedVersusFound.uncited.join(", ") || "none"}.`,
  );
  lines.push(
    `The mechanism this candidate proposes already ships: ${census.alreadyShipped.where} calls ` +
      `${census.alreadyShipped.call} on every scaffold, with no flag to skip it. What the count says is not that it ` +
      `cannot be built — it is that it is not aimed at these failures.`,
  );
  if (census.harmful.length > 0) {
    lines.push(
      `In ${census.harmful.length} of the ${census.headline.directories} directory(ies) initialising would have been ` +
        `worse than doing nothing, because something else was supposed to have made it a repository.`,
    );
  }
  return lines.join("\n");
}
