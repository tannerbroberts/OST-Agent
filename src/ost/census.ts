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
import type { OstNode } from "./node.js";

/** A markdown file the walk enumerated but did not turn into a node. */
export interface CensusDrop {
  /** Basename as it appeared on disk. */
  file: string;
  /** Why it did not become a node, in words an operator can act on. */
  reason: string;
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
