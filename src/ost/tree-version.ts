/**
 * A version for the tree state a sweep was taken over — cheap enough to ask for
 * on every call, and honest enough that "unchanged" means unchanged.
 *
 * **The cost this exists to remove.** `ost_next_work` recomputes the whole
 * outstanding list from scratch on every call and hands the caller nothing to
 * compare against, so a session that wants to confirm nothing moved has exactly
 * one move available: ask for the whole list again. The machine-recorded usage
 * traces put a number on that — `ost_next_work` was 82 of 240 calls on
 * 2026-08-02, 111 of 356 on 2026-08-04, 143 of 580 on 2026-08-18 — and the
 * re-ask rate rises as the work gets more granular, which is exactly the shape of
 * the maintenance passes this product runs most.
 *
 * The fix here treats the re-reading as reasonable rather than wrong. A pass that
 * re-reads after a batch of writes is being careful; carefulness gets made cheap
 * instead of being asked to stop.
 *
 * **Two candidates, and the one that was chosen.** The assumption test beneath
 * this ("Time a candidate version computation against producing the full sweep")
 * pre-committed a bar — a candidate costs under 10% of producing the sweep, and
 * detects 20 of 20 representative changes — and named two candidates to time
 * against it: one over file modification times, one over content hashes.
 * `test/ost/sweep-version-cost.test.ts` is that measurement. Measured against
 * this project's own vault at 1,636 nodes and 705 evidence records:
 *
 *   producing the sweep   127.6 ms
 *   {@link mtimeVersion}    6.8 ms   5.4% of the sweep
 *   {@link contentVersion} 29.8 ms  23.4% of the sweep
 *
 * So the content candidate is 2.3× over the bar, and there is a structural
 * reason it always will be rather than a tuning failure: it reads every byte the
 * sweep reads, so its cost is bounded BELOW by the sweep's own I/O and can only
 * approach 10% on a tree whose parsing and analysis dwarf its reading. The
 * mtime candidate clears the bar by ~2× because it opens no file at all. It is
 * therefore what {@link treeVersion} — the version the sweep actually returns —
 * is built from, and the content candidate stays exported as what it is: the
 * measured alternative, and the thing to reach for if the blind spot below ever
 * turns out to matter.
 *
 * **The blind spot, named rather than discovered later.** A version derived from
 * modification times cannot see a file replaced with content of the same size at
 * the same timestamp. Nothing this product does can produce that state — every
 * write goes through {@link ../ost/vault.ts}, which rewrites the file and moves
 * its mtime, and `git checkout` stamps the files it writes with the time it wrote
 * them — but `rsync -a`, `tar -p` and a restore-from-backup all preserve mtimes
 * by design. A caller that restores a vault from an archive and then presents an
 * old version would be told the tree is current when it is not, which the
 * solution node correctly calls worse than the re-reading it replaces. Additions,
 * removals and renames are never in that blind spot: the file NAMES are hashed
 * too, so the shape of the subject is part of the version.
 *
 * **What the version is taken over.** {@link SWEEP_INPUTS} — the files
 * `computeNextWork` actually reads, enumerated rather than approximated. Both
 * directions of getting that wrong cost something and only one of them is quiet:
 * an input left out means a change the version cannot see, and an extra input
 * means a version that churns for reasons the sweep's answer does not share. The
 * second is the reason `.ost-agent/usage/` and `.ost-agent/census-history/` are
 * NOT here even though they sit beside the ledgers that are — the usage trace is
 * appended to on every tool call, including this one, so a version that covered
 * it would change between two calls with nothing in between and buy the caller
 * nothing at all.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ARCHIVE_DIRNAME } from "./census.js";

/**
 * The files a sweep's answer is a function of, relative to the vault root.
 *
 * Declared as data so the enumeration can be read by a person and pinned by a
 * test, rather than living as three loops that have to be found before anyone
 * can say what the version covers. `test/ost/sweep-version-cost.test.ts` asserts
 * a mutation to each class moves the version.
 */
export const SWEEP_INPUTS = {
  /** Directories whose `.md` files are nodes — the live tree and the archive the census names. */
  nodeDirs: ["", ARCHIVE_DIRNAME],
  /** Directories whose `.md` files are evidence records (`unmappedEvidence`). */
  recordDirs: [path.join(".ost-agent", "evidence")],
  /**
   * Single files, each an append-only ledger a bucket of the sweep consults.
   * Listed one by one on purpose: the directories holding them also hold files
   * the sweep does not read, and a directory glob would drag those in.
   */
  ledgers: [
    path.join(".ost-agent", "dispositions", "dispositions.jsonl"),
    path.join(".ost-agent", "suppressions", "suppressions.jsonl"),
    path.join(".ost-agent", "asks", "asks.jsonl"),
    path.join(".ost-agent", "trust", "actors.jsonl"),
  ],
} as const;

/**
 * Which rule produced a version string, carried in the string itself.
 *
 * Two versions are comparable only when they were computed the same way, and a
 * caller holding one from an older build has no way to know which rule it came
 * from. Prefixing makes a cross-scheme comparison come out "changed" — the safe
 * answer — instead of matching by luck on a truncated hash.
 */
export type VersionScheme = "m1" | "c1";

export interface TreeVersion {
  /** `<scheme>:<hex>` — the whole string, and the only thing a caller should ever compare. */
  readonly version: string;
  readonly scheme: VersionScheme;
  /** How many of the subject's files the walk actually reached. */
  readonly files: number;
}

/** One file the version is taken over: what it is called, and where it lives. */
export interface SweepInput {
  /** Vault-relative, and the only part that is hashed — an absolute path is a fact about the machine. */
  readonly rel: string;
  /** Where to go and look. Built here, once, rather than re-joined per candidate. */
  readonly abs: string;
}

/**
 * Every file the version is taken over, sorted within each class and in a fixed
 * class order.
 *
 * Sorted because `readdirSync` order is a property of the filesystem, and a
 * version that depended on it would differ between two machines looking at
 * identical trees. A directory that does not exist contributes nothing and is
 * not an error — an archive, a disposition ledger and an evidence folder are all
 * absent from a fresh vault.
 */
export function sweepInputFiles(root: string, dir: string = root): SweepInput[] {
  const files: SweepInput[] = [];
  forEachSweepInput(root, dir, (rel, abs) => files.push({ rel, abs }));
  return files;
}

/**
 * {@link sweepInputFiles} without the array — the form both candidates walk.
 *
 * A generator or a materialized list would allocate one object per file, and at
 * 10,000 nodes that allocation showed up against a criterion budget
 * (`test/mcp/wall-clock-budget.test.ts`, 2,000 ms for `ost_next_work`). Paths
 * are concatenated rather than `path.join`ed for the same reason: the bases are
 * already normalized here, and the join was being paid ten thousand times to
 * re-learn that.
 */
function forEachSweepInput(root: string, dir: string, visit: (rel: string, abs: string) => void): void {
  const listMarkdown = (base: string, group: string): void => {
    const absBase = group ? path.join(base, group) : base;
    let names: string[];
    try {
      names = fs.readdirSync(absBase);
    } catch {
      return;
    }
    names.sort();
    const relPrefix = group ? `${group}/` : "";
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      visit(relPrefix + name, absBase + path.sep + name);
    }
  };
  for (const group of SWEEP_INPUTS.nodeDirs) listMarkdown(root, group);
  for (const group of SWEEP_INPUTS.recordDirs) listMarkdown(dir, group);
  // Ledgers are named rather than listed, so a missing one still occupies its
  // slot: "this ledger does not exist" and "this ledger is empty" have to hash
  // differently, or creating one would be invisible.
  for (const rel of SWEEP_INPUTS.ledgers) visit(rel, path.join(dir, rel));
}

/**
 * The mtime candidate: a hash over each input's path, modification time and
 * size. Opens no file, so its cost is one `stat` per input and nothing else.
 *
 * `mtimeNs` rather than `mtimeMs` because the resolution is the whole risk: two
 * writes inside one tick of the clock the filesystem exposes are one write as
 * far as this rule can tell, and a millisecond is a long time in a loop that
 * writes a node per call. Every filesystem this runs on (APFS, ext4, NTFS)
 * stores nanoseconds; asking for milliseconds would be discarding the precision
 * that makes the rule safe.
 *
 * A missing input hashes as a distinct absent-marker rather than being skipped,
 * so creating the file it names moves the version.
 *
 * **Why the lines are accumulated and hashed in blocks** rather than fed to the
 * hash one file at a time. Every `ost_next_work` pays for this walk, and at
 * 10,000 nodes a `h.update()` per file cost more than the `stat` did: the first
 * draft added 125 ms to a 940 ms sweep, enough on a busy box to push
 * `test/mcp/wall-clock-budget.test.ts` past the 2,000 ms the Z3 criterion names.
 * `throwIfNoEntry: false` is the same argument for the absent case — the four
 * ledgers are usually missing on a young vault, and building an exception for
 * each is real work to learn something a null already says.
 */
export function mtimeVersion(root: string, dir: string = root): TreeVersion {
  const h = createHash("sha256");
  let files = 0;
  let block = "";
  forEachSweepInput(root, dir, (rel, abs) => {
    const stat = fs.statSync(abs, { bigint: true, throwIfNoEntry: false });
    if (stat === undefined) {
      block += `${rel.length}:${rel}:absent\n`;
    } else {
      block += `${rel.length}:${rel}:${stat.mtimeNs}:${stat.size}\n`;
      files++;
    }
    if (block.length >= HASH_BLOCK_CHARS) {
      h.update(block);
      block = "";
    }
  });
  h.update(block);
  return { version: `m1:${h.digest("hex").slice(0, 32)}`, scheme: "m1", files };
}

/**
 * How much line text {@link mtimeVersion} accumulates before handing it to the
 * hash. Large enough that the per-call overhead disappears against the string,
 * small enough that a 10,000-node vault never holds a megabyte of it.
 */
const HASH_BLOCK_CHARS = 64 * 1024;

/**
 * The content candidate: a hash over each input's path and its bytes. Exact —
 * it cannot be fooled by a preserved timestamp — and measured at 23% of the cost
 * of producing the sweep, against a bar of 10%.
 *
 * Kept, exported and tested rather than deleted with its measurement, because
 * the reason it lost is a ratio and a ratio is a property of one tree at one
 * size. The node this was built for says so itself: "the cheap candidate's cost
 * may grow differently from the sweep's as the tree gets larger, so the ratio is
 * the finding and neither absolute number is."
 */
export function contentVersion(root: string, dir: string = root): TreeVersion {
  const h = createHash("sha256");
  let files = 0;
  forEachSweepInput(root, dir, (rel, abs) => {
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(abs);
    } catch {
      h.update(`${rel.length}:${rel}:absent\n`);
      return;
    }
    // Length-prefixed path, then byte count, then the bytes — the same encoding
    // {@link mtimeVersion} uses, and both lengths are there for the same reason.
    // Without them two files concatenate into a stream that a different pair of
    // files also produces, and a hash over an ambiguous encoding is one that can
    // be made to collide by choosing a filename. No block buffering here: the
    // bytes dominate, so an update per file is already lost in them.
    h.update(`${rel.length}:${rel}:${bytes.length}:`);
    h.update(bytes);
    h.update("\n");
    files++;
  });
  return { version: `c1:${h.digest("hex").slice(0, 32)}`, scheme: "c1", files };
}

/**
 * The version a sweep carries, and the one a caller presents back to ask whether
 * its copy is still current.
 *
 * One function, so the version stamped on a response and the version a probe
 * compares against are the same rule by construction rather than by two
 * implementations agreeing. It is {@link mtimeVersion} — see this file's header
 * for the measurement that chose it and the one class of change it cannot see.
 */
export function treeVersion(root: string, dir: string = root): string {
  return mtimeVersion(root, dir).version;
}
