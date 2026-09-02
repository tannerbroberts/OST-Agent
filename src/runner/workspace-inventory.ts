/**
 * The startup workspace inventory, and the census that asks whether one can be
 * small enough to carry and still name the places this project's own commands
 * actually missed.
 *
 * The candidate this measures: "The run is handed the workspace layout at
 * startup, before it composes anything." The run receives a generated
 * description of the workspace — which directories exist, whether this is a git
 * repository, where the tests live, which declared roots are readable at all —
 * as part of its opening context, so it composes against a description rather
 * than a belief. It is the *push* form of the parent opportunity's three
 * candidates; {@link "../fs/near-miss.js"} is the answer-on-failure form.
 *
 * The assumption test beneath it fixed both halves of the bar before anything
 * was generated, and they pull in opposite directions on purpose: **the
 * inventory must render under {@link INVENTORY_RULE.tokenBudget} tokens AND
 * name the parent directory of every path that failed in the captured corpus.
 * Both, not either.** An inventory that fits and does not cover, or covers and
 * does not fit, refutes the solution as written. Which condition breaks decides
 * whether the solution narrows to a scoped inventory or gives way to a sibling.
 *
 * ## The budget figure is a judgement and is published as one
 *
 * 4,000 tokens is the assumption test's number, not a measurement: roughly the
 * largest fixed startup charge that still leaves an unattended pass its working
 * context. It is inherited here unchanged and named in one place so a reader who
 * thinks the real budget is 1,000 or 10,000 can move it and re-run rather than
 * argue with prose. {@link WorkspaceInventoryCensus.budgetDecides} says on the
 * report's face whether the verdict would have differed at either of those.
 *
 * ## Fit is measured in estimated tokens, and the estimate is biased against fit
 *
 * There is no tokenizer in this repository and adding one to answer a sizing
 * question would be a dependency bought with a guess. {@link estimateTokens}
 * uses characters ÷ {@link INVENTORY_RULE.charsPerToken}, which for the text an
 * inventory actually renders — slash-separated path segments, not prose —
 * *understates* the count, because a path tokenizes worse than English. The
 * error therefore runs toward reporting the inventory as smaller than it is,
 * which is the direction that favours the solution under test. A fit result
 * reached this way is the generous one; a fit *failure* would be beyond
 * argument.
 *
 * ## The corpus is historical and the workspace is not
 *
 * The corpus is the same 719 failing calls
 * `test/friction/path-failure-attribution.test.ts` already reads, so this census
 * and that one cannot disagree about what failed. But those failures were
 * suffered against the workspace *as it was*, and an inventory generated today
 * describes the workspace *as it is*. Four of the directories a failing path
 * addressed have since been deleted — `src/genome` went in `8261a6f`. An
 * inventory that named them today would be lying about the filesystem, so
 * {@link MissReason} separates `gone` from `truncated`: only the second is a
 * defect of the artefact, and reporting them as one number would blame the
 * budget for the calendar.
 *
 * ## Absolute subjects are re-rooted, because the corpus is pinned to one checkout
 *
 * Subjects in the record are absolute paths on the machine that produced them
 * (`/Users/tanner/dev/OST-Agent/test/mcp`). Resolved literally, a clone at any
 * other location scores every one of them out of reach and the census reports a
 * different number per checkout. {@link INVENTORY_RULE.corpusWorkspaceRoot}
 * names that origin so such subjects can be read relative to whatever root the
 * inventory actually describes. It is a fact about the corpus, published here
 * rather than compensated for silently.
 *
 * ## What a count out of this cannot settle
 *
 * It measures the **artefact**, not the behaviour. That a run handed the
 * inventory reads it, or that reading it changes which command it composes, is
 * not in reach of any assertion here and needs the run's own transcripts after
 * the fact. The assumption test says so itself.
 *
 * It also cannot say what a run is **allowed** to read. The solution node names
 * this limit against itself and it survives the build: a layout description says
 * what exists, and this project's largest recorded path-refusal population is
 * paths that existed and whose grant was missing. {@link ProbedRoot.readable}
 * records readability for the roots the generator was handed, which converts the
 * limit from prose into a field, and covers only those roots.
 */
import fs from "node:fs";
import path from "node:path";
import {
  classifyFailure,
  subjectOf,
  type ClassifiedFailure,
  type FailingCall,
} from "../telemetry/path-failure-attribution.js";

/**
 * The rule, written down before an inventory was generated or a corpus counted.
 *
 * Everything here is a judgement someone can disagree with, which is why it is
 * one object rather than constants scattered through the code: a bar moved after
 * seeing the number it decides is not a bar.
 */
export const INVENTORY_RULE = {
  /**
   * The assumption test's figure, inherited unchanged. Estimated tokens for the
   * rendered inventory, as a fixed charge on every run.
   */
  tokenBudget: 4000,

  /**
   * "…names the parent directory of *every* path that failed." The threshold
   * admits no partial credit, and that is the assumption test's choice: a
   * layout the run must still double-check is a layout it will compose around
   * rather than against.
   */
  coverageBar: 1,

  /**
   * Budgets the verdict is re-taken at, so a reader who rejects 4,000 can read
   * the answer at their own figure instead of re-running. The narrow one is the
   * assumption test's own stated alternative.
   */
  alternativeBudgets: [1000, 10000] as number[],

  /**
   * Characters per estimated token. Four is the usual English approximation and
   * is wrong for paths in the direction named in this file's header: it
   * understates. See {@link estimateTokens}.
   */
  charsPerToken: 4,

  /**
   * Directories never descended into. Each is either not the workspace's own
   * content (`node_modules`), or a store whose internal layout no command is
   * composed against (`.git`). Excluding them is the difference between an
   * inventory and a filesystem dump, and it is the first place a coverage
   * failure would be manufactured, so the list is short and fixed.
   */
  skipDirectories: ["node_modules", ".git"] as string[],

  /** Depth cap, counted in path segments below the root. */
  maxDepth: 6,

  /** Child directories listed under any one parent before the rest are summarised. */
  maxChildrenPerDirectory: 40,

  /** Hard ceiling on directories named, whatever the depth and breadth caps allow. */
  maxDirectories: 600,

  /**
   * Where the committed corpus was recorded. Absolute subjects beneath it are
   * read relative to the root the inventory describes; see this file's header.
   */
  corpusWorkspaceRoot: "/Users/tanner/dev/OST-Agent",

  /**
   * Subjects that are not paths anyone addressed and are excluded before
   * coverage is asked, each published with a count rather than dropped.
   *
   * A shell glob that expanded to nothing (`no matches found: /Users/tanner/dev/ost*`)
   * is recorded by the path-failure census as path-shaped, correctly — the
   * shell's message is. But it has no parent directory an inventory could name,
   * because the operand was a pattern rather than a place. Counting these in the
   * denominator would refute the solution for failing to do something no layout
   * description can do.
   */
  notAPath: [
    { name: "glob-pattern", pattern: /[*?]|\[[^\]]*\]/ },
  ] as { name: string; pattern: RegExp }[],

  /**
   * The four defensible denominators, **widest last**. Monotone: a later reading
   * may only admit more failures, so coverage may only fall between them.
   *
   * `every-path-shaped` is the mirror of a vacuous reading and is here to be
   * excluded by name: eleven failures in this corpus name nothing at all
   * (`File does not exist.`), so that reading cannot reach the bar however good
   * the inventory is. A reading that cannot come out in the solution's favour
   * tests nothing, and must not be the one the verdict rests on.
   */
  readings: [
    { name: "in-workspace", admits: ["in-workspace"] },
    { name: "named-a-path", admits: ["in-workspace", "elsewhere"] },
    { name: "named-anything", admits: ["in-workspace", "elsewhere", "not-a-path"] },
    { name: "every-path-shaped", admits: ["in-workspace", "elsewhere", "not-a-path", "unnamed"] },
  ] as { name: string; admits: SubjectKind[] }[],

  /**
   * The reading the verdict is taken on: the plain sense of "every path that
   * failed". It admits every failure whose message named a path, in this
   * workspace or any other, and excludes only subjects that were not paths and
   * messages that named nothing.
   *
   * Deliberately not `in-workspace`, which is the flattering choice — narrowing
   * the denominator to the places the inventory already describes scores the
   * artefact against the sample it was cut from.
   */
  verdictReading: "named-a-path",
} as const;

// ── the inventory ────────────────────────────────────────────────────────────

/** A declared place the generator was asked to check, and what it found there. */
export interface ProbedRoot {
  name: string;
  location: string;
  exists: boolean;
  /**
   * Whether this process could actually list it. Distinct from `exists` on
   * purpose: the two failure modes share an error surface and have different
   * remedies, and this project's record is mostly the second.
   */
  readable: boolean;
}

/** What the generator dropped, and why. Never silent; see {@link renderWorkspaceInventory}. */
export interface Truncation {
  /** The directory whose children were cut, relative to the root. */
  under: string;
  reason: "breadth" | "depth" | "ceiling";
  dropped: number;
}

/**
 * A directory that holds its own `.git` and is therefore a different workspace.
 *
 * Named and not descended into. This repository keeps git worktrees under
 * `.worktrees/`, and each one is a complete second copy of the tree: descending
 * into a single worktree adds 65 directories and 932 estimated tokens — 42% of
 * this workspace's whole inventory — every line of which describes paths that
 * belong to a checkout the run is not standing in. Three worktrees would put the
 * inventory over any budget the assumption test could reasonably have named, and
 * the tokens would all have been spent saying the same thing three more times.
 *
 * The boundary is read off the filesystem rather than from a list of directory
 * names, so it cannot drift from what is actually a repository.
 */
export interface NestedWorkspace {
  /** Relative to this inventory's root. */
  directory: string;
}

export interface WorkspaceInventory {
  /** Absolute path of the workspace this describes. */
  root: string;
  /** Every directory named, relative to the root, sorted. `.` is always first. */
  directories: string[];
  /** Files directly in each named directory, for the ones that hold any. */
  fileCounts: Record<string, number>;
  git: { repository: boolean; root: string | null };
  /** Directories holding at least one `*.test.*` file, and how many. */
  testLayout: { directory: string; tests: number }[];
  /** The scripts a command might be composed against, from `package.json`. */
  scripts: string[];
  roots: ProbedRoot[];
  truncations: Truncation[];
  /** Nested checkouts, named as boundaries rather than described. */
  nested: NestedWorkspace[];
  /** Directories that exist and were not named, by the caps. Reported, not hidden. */
  omitted: number;
}

export interface InventoryOptions {
  /** Declared places to probe for existence and readability. */
  roots?: { name: string; location: string }[];
  maxDepth?: number;
  maxChildrenPerDirectory?: number;
  maxDirectories?: number;
  skipDirectories?: string[];
}

function isTestFile(name: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
}

/**
 * Read the workspace and describe it.
 *
 * Deterministic by construction — every listing is sorted, nothing is timed, and
 * no process is spawned — because an inventory that varies between two runs over
 * an unchanged workspace is a second statement of the layout that has already
 * started drifting from the first.
 *
 * A directory that cannot be listed is recorded as present and unreadable rather
 * than skipped. The two are different facts and the whole point of handing a run
 * a layout is that it stops having to guess which one it hit.
 */
export function generateWorkspaceInventory(root: string, opts: InventoryOptions = {}): WorkspaceInventory {
  const maxDepth = opts.maxDepth ?? INVENTORY_RULE.maxDepth;
  const maxChildren = opts.maxChildrenPerDirectory ?? INVENTORY_RULE.maxChildrenPerDirectory;
  const maxDirectories = opts.maxDirectories ?? INVENTORY_RULE.maxDirectories;
  const skip = new Set(opts.skipDirectories ?? INVENTORY_RULE.skipDirectories);

  const directories: string[] = ["."];
  const fileCounts: Record<string, number> = {};
  const testLayout: { directory: string; tests: number }[] = [];
  const truncations: Truncation[] = [];
  const nested: NestedWorkspace[] = [];
  let omitted = 0;

  // Breadth-first, so a ceiling cuts the deepest directories rather than an
  // arbitrary subtree: a run composes against `src/cli` far more often than
  // against something six levels down, and a cut has to fall somewhere.
  const queue: { rel: string; depth: number }[] = [{ rel: ".", depth: 0 }];
  while (queue.length > 0) {
    const { rel, depth } = queue.shift()!;
    // A nested checkout is named as a boundary and not described; see
    // {@link NestedWorkspace} for what descending into one costs.
    if (rel !== "." && fs.existsSync(path.join(root, rel, ".git"))) {
      nested.push({ directory: rel });
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue; // unreadable: recorded by `roots` when declared, never invented here
    }

    const files = entries.filter((e) => e.isFile());
    if (files.length > 0) fileCounts[rel] = files.length;
    const tests = files.filter((e) => isTestFile(e.name)).length;
    if (tests > 0) testLayout.push({ directory: rel, tests });

    const children = entries
      .filter((e) => e.isDirectory() && !skip.has(e.name))
      .map((e) => e.name)
      .sort();
    if (children.length === 0) continue;

    if (depth >= maxDepth) {
      truncations.push({ under: rel, reason: "depth", dropped: children.length });
      omitted += children.length;
      continue;
    }

    let kept = children;
    if (children.length > maxChildren) {
      kept = children.slice(0, maxChildren);
      truncations.push({ under: rel, reason: "breadth", dropped: children.length - maxChildren });
      omitted += children.length - maxChildren;
    }

    for (const name of kept) {
      if (directories.length >= maxDirectories) {
        const remaining = kept.length - kept.indexOf(name);
        truncations.push({ under: rel, reason: "ceiling", dropped: remaining });
        omitted += remaining;
        break;
      }
      const childRel = rel === "." ? name : `${rel}/${name}`;
      directories.push(childRel);
      queue.push({ rel: childRel, depth: depth + 1 });
    }
  }

  directories.sort((a, b) => (a === "." ? -1 : b === "." ? 1 : a.localeCompare(b)));
  testLayout.sort((a, b) => a.directory.localeCompare(b.directory));
  nested.sort((a, b) => a.directory.localeCompare(b.directory));

  return {
    root,
    directories,
    fileCounts,
    git: gitOf(root),
    testLayout,
    scripts: scriptsOf(root),
    roots: (opts.roots ?? []).map(probeRoot),
    truncations,
    nested,
    omitted,
  };
}

/**
 * Is this a git working tree, and where is its top?
 *
 * Walks for a `.git` entry rather than shelling out, both because
 * `CONTRIBUTING.md` keeps subprocesses out of the tested paths and because the
 * failure this answers — `git` returning 128 from a directory holding only
 * `bin/` and `vaults/` — must be answerable without running `git`.
 */
function gitOf(root: string): { repository: boolean; root: string | null } {
  let dir = path.resolve(root);
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return { repository: true, root: dir };
    const parent = path.dirname(dir);
    if (parent === dir) return { repository: false, root: null };
    dir = parent;
  }
}

function scriptsOf(root: string): string[] {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return Object.keys(pkg.scripts ?? {}).sort();
  } catch {
    return [];
  }
}

function probeRoot(declared: { name: string; location: string }): ProbedRoot {
  const exists = fs.existsSync(declared.location);
  let readable = false;
  if (exists) {
    try {
      fs.readdirSync(declared.location);
      readable = true;
    } catch {
      readable = false;
    }
  }
  return { ...declared, exists, readable };
}

/**
 * The inventory as a run receives it.
 *
 * Two properties the format has to hold and the assertions beside this file
 * hold it to. Every line is a fact read off the filesystem — the renderer may
 * report and may never author, the same anti-drift rule
 * `src/security/preflight-manifest.ts` runs under. And what was cut is stated in
 * the text: an inventory that lists directories without saying it stopped
 * listing reads as complete, which is the failure mode "A sweep that cannot read
 * its subject reports a clean result" names.
 */
export function renderWorkspaceInventory(inv: WorkspaceInventory): string {
  const lines: string[] = [];
  lines.push(`WORKSPACE INVENTORY — ${inv.root}`);
  lines.push(
    inv.git.repository
      ? `git: repository, top at ${inv.git.root}`
      : "git: NOT a repository — a git command here exits 128",
  );
  if (inv.scripts.length > 0) lines.push(`package scripts: ${inv.scripts.join(", ")}`);

  lines.push("");
  lines.push(`DIRECTORIES (${inv.directories.length}, relative to the root; file counts in parentheses)`);
  for (const dir of inv.directories) {
    const files = inv.fileCounts[dir];
    lines.push(`  ${dir}${files ? ` (${files})` : ""}`);
  }

  if (inv.testLayout.length > 0) {
    lines.push("");
    lines.push("TESTS live in:");
    for (const { directory, tests } of inv.testLayout) lines.push(`  ${directory} (${tests})`);
  }

  if (inv.nested.length > 0) {
    lines.push("");
    lines.push("NESTED CHECKOUTS — separate repositories, named but not described:");
    for (const n of inv.nested) lines.push(`  ${n.directory}`);
  }

  if (inv.roots.length > 0) {
    lines.push("");
    lines.push("DECLARED ROOTS");
    for (const r of inv.roots) {
      const state = !r.exists ? "MISSING" : r.readable ? "readable" : "PRESENT BUT NOT READABLE";
      lines.push(`  ${r.name}: ${r.location} — ${state}`);
    }
  }

  lines.push("");
  lines.push("WHAT THIS DOES NOT TELL YOU");
  lines.push("  - Which of these you are permitted to read. A path that exists and is");
  lines.push("    ungranted fails with the same shape as one that is not there.");
  lines.push("  - Anything outside this root, including sibling repositories and /tmp.");
  if (inv.nested.length > 0) {
    lines.push(`  - The contents of ${inv.nested.length} nested checkout(s) named above.`);
  }
  lines.push("  - Individual filenames. Directories are named; their contents are counted.");
  if (inv.omitted > 0) {
    lines.push(`  - ${inv.omitted} director(ies) that exist and are NOT listed above:`);
    for (const t of inv.truncations) lines.push(`      ${t.dropped} under ${t.under} (${t.reason} cap)`);
  } else {
    lines.push("  - Nothing was cut for size: every directory under this root is listed.");
  }
  lines.push("  - It was true when generated. A run that edits files diverges from it.");

  return lines.join("\n");
}

/**
 * Estimated tokens, characters ÷ {@link INVENTORY_RULE.charsPerToken}.
 *
 * Understates for path-dense text, which is the direction that favours the
 * solution under test. See this file's header.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / INVENTORY_RULE.charsPerToken);
}

/** Does the inventory name this directory, given relative to the root? */
export function inventoryNames(inv: WorkspaceInventory, relative: string): boolean {
  return inv.directories.includes(relative);
}

// ── reaching the corpus ──────────────────────────────────────────────────────

/** What a failing message's subject turned out to be. */
export type SubjectKind = "in-workspace" | "elsewhere" | "not-a-path" | "unnamed";

/** Why a failure's parent directory was not named. `null` when it was. */
export type MissReason = "elsewhere" | "not-a-path" | "unnamed" | "gone" | "truncated";

export interface ResolvedSubject {
  kind: SubjectKind;
  /** The subject as written in the error message. */
  subject: string | null;
  /** Relative to the inventory's root, when it lands inside it. */
  relative: string | null;
  /** The parent directory the inventory would have to name. */
  parent: string | null;
}

/**
 * Read a failing message's subject as a place in this workspace, or say why it
 * is not one.
 *
 * Absolute subjects under {@link INVENTORY_RULE.corpusWorkspaceRoot} are re-rooted
 * onto `root` so the census gives the same answer from any checkout. Everything
 * else absolute is `elsewhere`, and so is a relative path that climbs out with
 * `..` — the record does not say what it was relative *to*, so a climbing path
 * cannot be placed and must not be credited to this root.
 */
export function resolveSubject(subject: string | null, root: string): ResolvedSubject {
  if (subject === null) return { kind: "unnamed", subject, relative: null, parent: null };
  if (INVENTORY_RULE.notAPath.some((r) => r.pattern.test(subject))) {
    return { kind: "not-a-path", subject, relative: null, parent: null };
  }

  let relative: string | null = null;
  if (subject.startsWith("/")) {
    const origin = INVENTORY_RULE.corpusWorkspaceRoot;
    if (subject === origin || subject.startsWith(`${origin}/`)) {
      relative = path.relative(origin, subject) || ".";
    } else if (subject === root || subject.startsWith(`${root}/`)) {
      relative = path.relative(root, subject) || ".";
    }
  } else if (!subject.startsWith("~") && !subject.startsWith("../") && subject !== "..") {
    relative = path.normalize(subject);
  }

  if (relative === null) return { kind: "elsewhere", subject, relative: null, parent: null };
  return { kind: "in-workspace", subject, relative, parent: path.dirname(relative) };
}

export interface CoverageRow extends ResolvedSubject {
  session: string;
  tool: string;
  error: string;
  covered: boolean;
  missReason: MissReason | null;
  /**
   * The parent is the root itself, which every inventory names by construction.
   * A bare filename (`report2.txt`) and an extraction artefact (`-d`, from
   * `ls: -d: No such file`) both land here and both score as covered.
   */
  trivialRoot: boolean;
  /**
   * The subject is present in the workspace **now**. The run was told it was
   * not there, and it is: the directory was never the fact it had wrong — it
   * was standing somewhere else, or reached before the file was written. A
   * layout description answers neither.
   */
  subjectPresentToday: boolean;
}

/**
 * How much of the coverage numerator is credit the proxy grants for free.
 *
 * The assumption test's proxy is "the inventory names the parent directory,
 * because that is the resolution at which it would actually have helped". These
 * are the covered rows for which that sentence is false, counted rather than
 * argued: a hit on `.` is a hit every possible inventory scores, and a hit on a
 * path that is sitting in the workspace right now is a hit on a failure a layout
 * description would not have prevented.
 *
 * Published beside the verdict and not folded into it. The verdict stays on the
 * assumption test's own definition — bending the numerator after seeing it would
 * be scoring against a bar nobody committed to.
 */
export interface ProxyCredit {
  covered: number;
  trivialRoot: number;
  subjectPresentToday: number;
  /** Rows that are either, deduplicated. */
  free: number;
  /** Covered rows where the inventory named a real parent for a genuinely absent subject. */
  strict: number;
  strictShare: number | null;
}

export interface CoverageReading {
  name: string;
  admits: SubjectKind[];
  denominator: number;
  covered: number;
  share: number | null;
  meetsBar: boolean;
  /**
   * True when the reading admits subjects no inventory of any workspace could
   * name, so it cannot reach the bar however good the artefact is.
   */
  vacuous: boolean;
}

export interface WorkspaceInventoryCensus {
  /** Coverage of the subject, reported before any verdict. */
  failures: number;
  pathShaped: number;

  fits: boolean;
  tokens: number;
  budget: number;
  /** Directories named, and how many exist and were cut for size. */
  named: number;
  omitted: number;

  rows: CoverageRow[];
  bySubjectKind: Record<SubjectKind, number>;
  byMissReason: Record<MissReason, number>;
  proxy: ProxyCredit;

  readings: CoverageReading[];
  verdict: CoverageReading;
  /** Fit AND coverage, which is what the assumption test asked. */
  meetsBar: boolean;
  /** True when the readings disagree about the coverage verdict. */
  readingDecides: boolean;
  /** True when the verdict would differ at one of the alternative budgets. */
  budgetDecides: boolean;
  budgetReadings: { budget: number; fits: boolean; meetsBar: boolean }[];
}

/**
 * Take the count.
 *
 * `failures` is the whole committed corpus, unfiltered — the classifier in
 * `path-failure-attribution.ts` is what selects, so this census and that one
 * cannot disagree about which calls were path failures.
 */
export function inventoryCoverageCensus(
  failures: FailingCall[],
  inv: WorkspaceInventory,
): WorkspaceInventoryCensus {
  const classified = failures
    .map(classifyFailure)
    .filter((c): c is ClassifiedFailure => c !== null);

  const rows: CoverageRow[] = classified.map((c) => {
    const resolved = resolveSubject(c.subject ?? subjectOf(c.error), inv.root);
    const base = { session: c.session, tool: c.tool, error: c.error };
    if (resolved.kind !== "in-workspace") {
      return {
        ...resolved,
        ...base,
        covered: false,
        missReason: resolved.kind,
        trivialRoot: false,
        subjectPresentToday: false,
      };
    }
    const covered = inventoryNames(inv, resolved.parent!);
    // A directory the inventory omits is either one it cut for size — the
    // defect a budget causes — or one that is not there to name. Only the first
    // is the artefact's fault, and collapsing them would blame the budget for
    // the calendar.
    const exists = fs.existsSync(path.join(inv.root, resolved.parent!));
    return {
      ...resolved,
      ...base,
      covered,
      missReason: covered ? null : exists ? "truncated" : "gone",
      trivialRoot: resolved.parent === ".",
      subjectPresentToday: fs.existsSync(path.join(inv.root, resolved.relative!)),
    };
  });

  const bySubjectKind: Record<SubjectKind, number> = {
    "in-workspace": 0,
    elsewhere: 0,
    "not-a-path": 0,
    unnamed: 0,
  };
  const byMissReason: Record<MissReason, number> = {
    elsewhere: 0,
    "not-a-path": 0,
    unnamed: 0,
    gone: 0,
    truncated: 0,
  };
  for (const row of rows) {
    bySubjectKind[row.kind]++;
    if (row.missReason) byMissReason[row.missReason]++;
  }

  const text = renderWorkspaceInventory(inv);
  const tokens = estimateTokens(text);

  const readingOf = (name: string, admits: SubjectKind[]): CoverageReading => {
    const admitted = rows.filter((r) => admits.includes(r.kind));
    const covered = admitted.filter((r) => r.covered).length;
    const share = admitted.length === 0 ? null : covered / admitted.length;
    return {
      name,
      admits,
      denominator: admitted.length,
      covered,
      share,
      meetsBar: share !== null && share >= INVENTORY_RULE.coverageBar,
      // `unnamed` names no place at all and `not-a-path` names a pattern; a
      // reading admitting either is asking the inventory for something no
      // layout description holds.
      vacuous: admits.some((k) => k === "unnamed" || k === "not-a-path"),
    };
  };

  const readings = INVENTORY_RULE.readings.map((r) => readingOf(r.name, [...r.admits]));
  const verdict = readings.find((r) => r.name === INVENTORY_RULE.verdictReading)!;
  const fits = tokens <= INVENTORY_RULE.tokenBudget;

  const coveredRows = rows.filter((r) => r.covered);
  const free = coveredRows.filter((r) => r.trivialRoot || r.subjectPresentToday).length;
  const proxy: ProxyCredit = {
    covered: coveredRows.length,
    trivialRoot: coveredRows.filter((r) => r.trivialRoot).length,
    subjectPresentToday: coveredRows.filter((r) => r.subjectPresentToday).length,
    free,
    strict: coveredRows.length - free,
    strictShare: verdict.denominator === 0 ? null : (coveredRows.length - free) / verdict.denominator,
  };

  const budgetReadings = [INVENTORY_RULE.tokenBudget, ...INVENTORY_RULE.alternativeBudgets]
    .sort((a, b) => a - b)
    .map((budget) => ({ budget, fits: tokens <= budget, meetsBar: tokens <= budget && verdict.meetsBar }));

  return {
    failures: failures.length,
    pathShaped: classified.length,
    fits,
    tokens,
    budget: INVENTORY_RULE.tokenBudget,
    named: inv.directories.length,
    omitted: inv.omitted,
    rows,
    bySubjectKind,
    byMissReason,
    proxy,
    readings,
    verdict,
    meetsBar: fits && verdict.meetsBar,
    readingDecides: new Set(readings.filter((r) => !r.vacuous).map((r) => r.meetsBar)).size > 1,
    budgetDecides: new Set(budgetReadings.map((b) => b.meetsBar)).size > 1,
    budgetReadings,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * The census as an operator reads it: what was read, then the verdict in words,
 * then the numbers that could overturn it.
 *
 * The verdict says REFUTED or CLEARS out loud because an exit code cannot carry
 * that distinction — the command is green when the count has been taken,
 * whichever way it came out.
 */
export function formatInventoryCoverageCensus(census: WorkspaceInventoryCensus): string {
  const lines: string[] = [];

  if (census.pathShaped === 0) {
    lines.push(
      `Workspace inventory: UNREAD — ${census.failures} failed call(s) and not one of them is path-shaped. ` +
        "No coverage claim can be made from this.",
    );
    return lines.join("\n");
  }

  lines.push(
    `Reach: ${census.bySubjectKind["in-workspace"]} of ${census.pathShaped} path-shaped failure(s) name a place ` +
      `inside this workspace at all. ${census.bySubjectKind.elsewhere} are elsewhere, ` +
      `${census.bySubjectKind["not-a-path"]} named a glob rather than a path, and ` +
      `${census.bySubjectKind.unnamed} named nothing.`,
  );
  lines.push(
    `Workspace inventory: ${census.meetsBar ? "CLEARS" : "REFUTED"} — it must fit AND cover, and it ` +
      `${census.fits ? "FITS" : "DOES NOT FIT"} / ${census.verdict.meetsBar ? "COVERS" : "DOES NOT COVER"}.`,
  );
  lines.push(
    `  fit:      ${census.tokens} estimated token(s) against a budget of ${census.budget} ` +
      `(${census.named} director(ies) named, ${census.omitted} cut for size).`,
  );
  lines.push(
    `  coverage: ${census.verdict.covered}/${census.verdict.denominator} (${pct(census.verdict.share ?? 0)}) ` +
      `on the "${census.verdict.name}" reading, against a bar of ${pct(INVENTORY_RULE.coverageBar)}.`,
  );

  lines.push(
    `  proxy:    ${census.proxy.free} of those ${census.proxy.covered} hit(s) are FREE CREDIT — ` +
      `${census.proxy.trivialRoot} name the root, which every inventory holds, and ` +
      `${census.proxy.subjectPresentToday} name a path that is in this workspace today. ` +
      `Strictly: ${census.proxy.strict}/${census.verdict.denominator} (${pct(census.proxy.strictShare ?? 0)}).`,
  );

  lines.push("");
  lines.push("Coverage by reading (widest last):");
  for (const r of census.readings) {
    lines.push(
      `  ${r.name.padEnd(20)} ${r.covered}/${r.denominator} (${pct(r.share ?? 0)})` +
        `${r.vacuous ? "  VACUOUS — admits subjects no inventory can name" : ""}`,
    );
  }
  lines.push(
    census.readingDecides
      ? "  THE READING DECIDES THIS."
      : "  No reading of the threshold clears the bar; the choice does not decide it.",
  );

  lines.push("");
  lines.push("Why each uncovered failure was uncovered:");
  for (const [reason, n] of Object.entries(census.byMissReason)) {
    if (n > 0) lines.push(`  ${reason.padEnd(12)} ${n}`);
  }
  lines.push(
    census.byMissReason.truncated === 0
      ? "  Nothing was missed for size. The budget is not what this coverage failure is about."
      : `  ${census.byMissReason.truncated} were cut for size — the budget and the coverage do pull against each other here.`,
  );

  lines.push("");
  for (const b of census.budgetReadings) {
    lines.push(`  at a budget of ${String(b.budget).padStart(6)}: ${b.fits ? "fits" : "does not fit"} — ${b.meetsBar ? "CLEARS" : "REFUTED"}`);
  }
  lines.push(
    census.budgetDecides
      ? "  THE BUDGET FIGURE DECIDES THIS."
      : "  The verdict is the same at every budget considered, so the 4,000 figure did not decide it.",
  );

  lines.push("");
  lines.push("What this does not settle: that a run handed the inventory reads it, or that");
  lines.push("reading it changes which command it composes. This measures the artefact.");

  return lines.join("\n");
}
