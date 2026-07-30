/**
 * The denominator every count in this product is taken over.
 *
 * `readTree()` returns a list, and every command downstream reports its length as a
 * bare integer: "Nodes: 240", "invariants: PASS (0 violations)". Neither number says
 * what it was taken over, so a file that the walk enumerated and silently dropped —
 * a misspelled `type`, frontmatter that will not parse — subtracts itself from every
 * count in the product without leaving a trace. The operator reads a confident
 * integer over a set that quietly shrank.
 *
 * Guards catch the failures somebody predicted. A denominator catches the ones
 * nobody did: it shows "240 of 244 examined, 4 dropped" without anyone having had to
 * think of the specific defect in advance.
 *
 * There are two different blindnesses here and they need two different instruments:
 *
 *   1. Files the walk SAW and dropped. Same-traversal accounting is exactly right for
 *      these — the walk is the only thing that knows it skipped something, and why.
 *
 *   2. Files the walk NEVER ENUMERATED. Same-traversal accounting is worthless here,
 *      and this is the trap the idea was written against: a denominator computed by
 *      the same broken walk excludes the same files the counter excluded, so the
 *      ratio reads 100% and says nothing. Catching these requires a denominator from
 *      a genuinely DIFFERENT source, which is why `reconcileWithGit` shells out to
 *      git's index rather than walking the directory a second time.
 *
 * Only the second one costs anything, and it is the one that does the work.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { INIT_TRACE_TOOL, usageLogPath } from "../telemetry/usage.js";
import type { NodeStatus, OstNode } from "./node.js";

/** A markdown file the walk enumerated but did not turn into a node. */
export interface CensusDrop {
  /** Basename as it appeared on disk. */
  file: string;
  /** Why it did not become a node, in words an operator can act on. */
  reason: string;
}

/**
 * The subdirectory a human moves a node into to take it out of the live tree.
 *
 * Nothing in the product can put a file here. `Vault.nodePath` refuses any name
 * that resolves to more than one path segment, and there is no rename, move or
 * delete anywhere in the class — so archiving is an act at a shell, by a person,
 * recorded as a git rename. **That is the whole reason this half of retirement
 * is allowed to apply to every pass:** an unforgeable retirement cannot become
 * the agent's way of making a violation go away.
 *
 * The walk already never descended, so these files were *invisible* rather than
 * excluded. The difference this makes is that they are now counted and named
 * (`TreeCensus.retired`) instead of silently absent, which is the same argument
 * the census itself is built on.
 */
export const ARCHIVE_DIRNAME = "archive";

/**
 * The statuses that take a node out of the live tree.
 *
 * Taken from the `NodeStatus` union in `ost/node.ts` rather than invented here,
 * and it is deliberately one value. Walking the vocabulary: `unvalidated` is the
 * marker stamped on *everything* the agent creates, so retiring it would retire
 * the tree; `validated` and `shipped` are the two outcomes of work that
 * succeeded, which is the opposite of retirement; `in-discovery` is work in
 * flight. `deferred` is the only word in the vocabulary that means "we are not
 * working on this" — `ost_set_status`'s own description offers it as the way to
 * "record abandonment" — and there is no `abandoned` or `resolved` status to add
 * beside it, whatever the readiness entry's prose called them.
 *
 * **`deferred` IS agent-settable** (`AGENT_SETTABLE_STATUSES`), which is exactly
 * why {@link withoutRetiredNodes} is not applied to the gates. See its comment.
 */
export const RETIRED_STATUSES: readonly NodeStatus[] = ["deferred"];

const RETIRED = new Set<string>(RETIRED_STATUSES);

/** Is this node retired by its declared status? */
export function isRetiredNode(node: { status?: string }): boolean {
  return node.status !== undefined && RETIRED.has(node.status);
}

/**
 * The census with status-retired nodes withheld from `nodes` and named in
 * `retired` instead — the status half of Z4's filter, as a pure function over a
 * census that has already been read, so nothing has to parse the vault twice.
 *
 * **Where this may be used, and why the boundary is narrow.** `deferred` is a
 * status the agent can set on itself, in one call, on any node. If a retirement
 * removed a node from `checkInvariants` or from `done`, then "retire it" would
 * be a tool for making a dangling link, an orphan, an unearned rung or a
 * self-validation contradiction *disappear* — a gate the constrained actor can
 * clear on its own authority, which is the failure B1 and B2 exist to prevent.
 * So this filter feeds exactly one consumer: the near-duplicate scan.
 *
 * That one is safe, and not by accident. `near-duplicate` is the single hygiene
 * rule with no invariant behind it (`HYGIENE_ONLY_RULES`), it reports a
 * *suspicion* rather than a defect, and the honest resolution for a real
 * duplicate in an append-only vault is precisely to abandon the redundant node —
 * there is no delete. Marking a duplicate `deferred` is therefore the remedy the
 * issue is asking for, recorded in the node's History with a date, and it costs
 * the agent the same one call that annotating the issue would. It buys no
 * shortcut to `done` that P5's own instruction does not already grant.
 *
 * The archive half needs no such argument and is applied unconditionally at the
 * read (see {@link ARCHIVE_DIRNAME}).
 */
export function withoutRetiredNodes(census: TreeCensus): TreeCensus {
  const kept: OstNode[] = [];
  const retired = [...census.retired];
  for (const n of census.nodes) {
    if (isRetiredNode(n)) {
      retired.push({ file: `${n.title}.md`, reason: `status: ${n.status} — retired, withheld from the duplicate scan` });
    } else {
      kept.push(n);
    }
  }
  return { ...census, nodes: kept, retired };
}

/** A denominator taken from somewhere other than the walk that produced the count. */
export interface IndependentDenominator {
  source: "git";
  /** Markdown files this source believes exist in the vault. */
  tracked: number;
  /**
   * Files the independent source knows about that the walk never enumerated.
   * Non-empty means the walk is blind, and every count in the product is short
   * by at least this much.
   */
  unseenByWalk: string[];
}

export interface TreeCensus {
  /** What the counter counted. The same array `readTree()` returns. */
  nodes: OstNode[];
  /** Markdown files the walk enumerated — the denominator the count was taken over. */
  examined: number;
  /**
   * The enumerated filenames themselves, which is what makes reconciliation against
   * an independent source possible: comparing two integers can only tell you THAT
   * they disagree, never which file went missing.
   */
  seenFiles: string[];
  /** Enumerated, readable, but not an OST node. */
  skipped: CensusDrop[];
  /** Enumerated but could not be read or parsed at all. */
  unreadable: CensusDrop[];
  /**
   * Real nodes that were withheld from `nodes` because they have left the live
   * tree — archived into `archive/`, or (only when the caller asked for the
   * status filter) carrying a retired status.
   *
   * A separate list from `skipped` on purpose. A skipped file is something that
   * was never a node; a retired one is a node that *was* one, and conflating the
   * two would report a deliberate retirement as a malformed file. Both are
   * named rather than counted, for the reason {@link formatCensus} states.
   */
  retired: CensusDrop[];
  /** Absent when no independent source was available (e.g. the vault is not a repo). */
  independent?: IndependentDenominator;
  /** Absent when the trace cannot speak for this vault's whole life. See {@link reconcileWithUsage}. */
  unexplained?: UsageAccounting;
}

/** What the usage trace says about where the tree's files came from. */
export interface UsageAccounting {
  source: "usage-trace";
  /** The file the finding was computed from, named so an operator can open it. */
  basis: string;
  /** Node files on disk that no recorded invocation claims to have created. */
  unexplained: string[];
}

/**
 * Ask git — not the filesystem walk — how many markdown files this vault has.
 *
 * `git ls-files` reads the index, a structure maintained by a different program
 * through a different code path than `fs.readdirSync`. That independence is the
 * entire value: a walk that cannot see a file for whatever reason (an encoding it
 * mishandles, a name it mangles, a directory it never descends into) does not get to
 * define the denominator that would have exposed it.
 *
 * `-z` because vault filenames legitimately contain quotes, spaces and em-dashes —
 * the very characters that produced the failure this instrument exists to catch. Git
 * would otherwise C-quote them and the reconciliation would report phantom
 * discrepancies on exactly the files that matter most.
 *
 * Returns undefined rather than throwing when there is no repo. An absent source is
 * not a discrepancy, and a vault is not required to be under version control.
 */
export async function reconcileWithGit(
  vaultRoot: string,
  census: TreeCensus,
): Promise<IndependentDenominator | undefined> {
  const root = path.resolve(vaultRoot);
  let raw: string;
  try {
    const g = simpleGit(root);
    if (!(await g.checkIsRepo())) return undefined;
    raw = await g.raw(["ls-files", "-z", "--", "*.md"]);
  } catch {
    // No repo, no git binary, or a repo we cannot read. The walk's own accounting
    // still stands; we simply have no second opinion to offer.
    return undefined;
  }

  // NUL-delimited, so nothing here needs unquoting.
  const tracked = raw.split("\0").filter((f) => f.length > 0);

  // Only files directly in the vault root are nodes; the walk never descends, so
  // comparing against nested paths would manufacture a discrepancy that is not one.
  const topLevel = tracked.filter((f) => !f.includes("/"));

  const seen = new Set(census.seenFiles);
  const unseenByWalk = topLevel.filter((f) => !seen.has(f)).sort();

  return { source: "git", tracked: topLevel.length, unseenByWalk };
}

/**
 * Ask the usage trace — not git, and not the walk — which node files something asked
 * for.
 *
 * This is the third instrument, for the blindness the other two share. The walk cannot
 * tell a node the tree grew from a node that appeared beside it: both are files with
 * valid frontmatter. Neither can git, and git is worse than silent here — every
 * mutating tool call runs `git add -A` and commits as `mcp: <tool> — …`, so a file
 * written out of band does not merely go unnoticed, it *acquires* a commit message
 * attributing it to an allowlisted append-only tool (W2). `reconcileWithGit` compares
 * the walk against an index that the same `add -A` has already reconciled, so the two
 * agree precisely when they are both wrong.
 *
 * The trace is the one record written *before* the file exists, by the code path that
 * asked for it. A node file no event claims is a node file no tool invocation explains.
 *
 * **Returns undefined unless the trace can speak for the vault's whole life**, which
 * it can only do from an `init` marker onwards (see `recordInitInTrace`). A vault older
 * than this mechanism has nodes no event could ever claim, and reporting all of them as
 * unexplained would be a wall of noise that trains an operator to ignore the one line
 * that matters. An absent basis is not a discrepancy — the same answer
 * `reconcileWithGit` gives a vault that is not a repository.
 *
 * *The honest limit, stated because it is the boundary and not a loophole:* anyone who
 * can write a node file out of band can also delete this trace, and a deleted trace
 * reads as "no basis" rather than as an alarm. What it cannot do is delete the trace
 * quietly — the file is tracked, so its removal is a diff. This detects the write
 * nobody was hiding, which is the one the criterion is about.
 */
export function reconcileWithUsage(vaultRoot: string, census: TreeCensus): UsageAccounting | undefined {
  const file = usageLogPath(vaultRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  const claimed = new Set<string>();
  let covered = false;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: { tool?: unknown; wrote?: unknown };
    try {
      event = JSON.parse(line) as { tool?: unknown; wrote?: unknown };
    } catch {
      // A torn final line loses itself, never the reconciliation — the same rule the
      // usage rollup reads this file under. It can only cost coverage, never invent it.
      continue;
    }
    if (event.tool === INIT_TRACE_TOOL) covered = true;
    if (Array.isArray(event.wrote)) for (const f of event.wrote) if (typeof f === "string") claimed.add(f);
  }
  if (!covered) return undefined;

  return {
    source: "usage-trace",
    basis: path.relative(path.resolve(vaultRoot), file) || file,
    unexplained: census.seenFiles.filter((f) => !claimed.has(f)).sort(),
  };
}

/**
 * One line for `status`, plus a named line per dropped file.
 *
 * Named, not counted. "4 dropped" tells an operator a number is wrong; "Stray.md —
 * unrecognised type" tells them which file to open. The first is a statistic and the
 * second is a repair, and the cost of printing the filename is one line.
 */
export function formatCensus(census: TreeCensus, nodeCount: number): string {
  const lines: string[] = [];
  const dropped = census.skipped.length + census.unreadable.length;

  lines.push(
    `Counted over: ${nodeCount} node(s) of ${census.examined} markdown file(s) examined` +
      (dropped > 0 ? `, ${dropped} dropped` : ""),
  );

  for (const s of census.skipped) lines.push(`  – dropped ${s.file}: ${s.reason}`);
  for (const u of census.unreadable) lines.push(`  – unreadable ${u.file}: ${u.reason}`);

  // A retired node leaves the denominator, and this is the line that stops that
  // from being the same thing as vanishing. Before the archive directory was
  // read at all, a node moved out of the root simply stopped existing as far as
  // every count in the product was concerned — the exact silence this file was
  // written against, one directory level down.
  if (census.retired.length > 0) {
    lines.push(`  – retired: ${census.retired.length} node(s) out of the live tree, excluded from the counts above`);
    for (const r of census.retired) lines.push(`    · ${r.file}: ${r.reason}`);
  }

  const ind = census.independent;
  if (ind && ind.unseenByWalk.length > 0) {
    lines.push(
      `  ✗ ${ind.source} tracks ${ind.tracked} markdown file(s); the walk enumerated ${census.examined}.`,
    );
    lines.push(
      `    The walk never saw: ${ind.unseenByWalk.join(", ")}` +
        `\n    Every count in this vault is short by at least that much. This is not a` +
        `\n    tree problem — it is the reader failing to read, and no invariant will catch it.`,
    );
  }

  return lines.join("\n");
}
