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
import path from "node:path";
import { simpleGit } from "simple-git";
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
