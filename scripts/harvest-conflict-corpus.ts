/**
 * Cut the conflict-mechanicality corpus out of a vault's git history.
 *
 * Run by hand, output committed to `test/fixtures/conflict-mechanicality/`. It
 * exists so the cut is a rule anyone can re-run and disagree with, rather than a
 * selection somebody made — see that directory's `PROVENANCE.md`.
 *
 *   npx tsx scripts/harvest-conflict-corpus.ts ~/ost-agent-meta test/fixtures/conflict-mechanicality
 *
 * **Two passes over the same history, because they answer different questions.**
 *
 *  - Every **merge commit that actually happened** is replayed from its two
 *    parents. This is the rate an operator really pays: how often the work as it
 *    was actually sequenced stopped on a conflict.
 *  - Every **pair of branches that existed at the same time** is replayed from
 *    its merge base. This is the corpus the assumption test's design asked for —
 *    "generate realistic conflicts by replaying concurrent work" — and it is the
 *    only way to see conflicts at all in a history whose merges were sequenced
 *    promptly enough never to produce one.
 *
 * **The subject is never written to.** The history is read out of a
 * `git clone --mirror` in a temp directory and every merge is replayed there.
 * `git merge-tree --write-tree` does not move a ref or touch a working tree, but
 * it does put its result trees in the object database of whatever repository it
 * runs in — 861 replays leaving 861 dangling trees in a vault somebody else is
 * using. The mirror makes "this only reads the vault" true rather than nearly
 * true, and `--mirror` copies `refs/remotes/*` verbatim, so pass two sees the
 * same branches it would have seen in place.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  classifyFileConflict,
  conflictMechanicalityCensus,
  formatConflictMechanicalityCensus,
  parseDiff3,
  type FileConflict,
} from "../src/git/conflict-mechanicality.js";

const [, , repoArg, outArg, ...rest] = process.argv;
if (!repoArg || !outArg) {
  console.error("usage: harvest-conflict-corpus.ts <repo-dir> <out-dir>");
  process.exit(2);
}
const subject = path.resolve(repoArg);
const out = path.resolve(outArg);
void rest;

const mirror = fs.mkdtempSync(path.join(os.tmpdir(), "ost-conflict-mirror-"));
const repo = path.join(mirror, "vault.git");
execFileSync("git", ["clone", "--quiet", "--mirror", subject, repo], { stdio: "inherit" });
process.on("exit", () => fs.rmSync(mirror, { recursive: true, force: true }));

function git(args: string[], allowFailure = false): { out: string; code: number } {
  try {
    const stdout = execFileSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    return { out: stdout, code: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    if (!allowFailure) throw err;
    return { out: e.stdout ?? "", code: e.status ?? 1 };
  }
}

function blob(oid: string): string {
  if (!oid) return "";
  return git(["cat-file", "blob", oid]).out;
}

function commitDate(ref: string): string {
  return git(["show", "-s", "--format=%cI", ref]).out.trim();
}

/**
 * Replay one merge and return a conflict per unmerged path, in diff3 form.
 *
 * `git merge-tree --write-tree` performs the whole merge in the object database:
 * it never touches a working tree, never moves `HEAD`, and never leaves a
 * repository in a conflicted state — which is what makes it safe to run 861
 * times against a vault somebody else is using. On a conflict it exits non-zero
 * and prints, before the messages, a "conflicted file info" table of
 * `<mode> <oid> <stage>\t<path>` rows: stage 1 is the base, 2 ours, 3 theirs.
 * Those three blobs go straight to `git merge-file --diff3`, which is the same
 * text git would have written into the working tree.
 */
/** A conflict plus the exact bytes git produced for it, kept so a slice can be committed verbatim. */
type RawConflict = FileConflict & { raw: string };

function replayMerge(label: string, ours: string, theirs: string): RawConflict[] | null {
  const res = git(["merge-tree", "--write-tree", "-z", ours, theirs], true);
  if (res.code === 0) return null;

  // With `-z` the output is NUL-separated: tree-oid, then the conflicted-file
  // info block, then an empty field, then the messages block.
  const fields = res.out.split("\0");
  const stages = new Map<string, { base?: string; ours?: string; theirs?: string }>();
  for (let i = 1; i < fields.length; i++) {
    const field = fields[i];
    if (field === "") break; // end of the conflicted-file info block
    const tab = field.indexOf("\t");
    if (tab === -1) continue;
    const [, oid, stage] = field.slice(0, tab).split(" ");
    const file = field.slice(tab + 1);
    if (!stage) continue;
    const entry = stages.get(file) ?? {};
    if (stage === "1") entry.base = oid;
    else if (stage === "2") entry.ours = oid;
    else if (stage === "3") entry.theirs = oid;
    stages.set(file, entry);
  }
  if (stages.size === 0) return null;

  const date = [commitDate(ours), commitDate(theirs)].sort().pop() ?? "";
  const conflicts: RawConflict[] = [];
  for (const [file, entry] of stages) {
    // A path present on only one side is an add/add or a modify/delete that has
    // no three-way text to read. Recorded as a one-sided hunk so the count stays
    // honest, and classified below as the rewrite it is.
    if (!entry.ours || !entry.theirs) {
      const one = (present: boolean) => (present ? ["<added on one side only>"] : []);
      conflicts.push({
        merge: label,
        file,
        date,
        raw: "",
        hunks: [{ ours: one(!!entry.ours), base: [], theirs: one(!!entry.theirs) }],
      });
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "ost-conflict-"));
    try {
      const paths = { ours: path.join(tmp, "ours"), base: path.join(tmp, "base"), theirs: path.join(tmp, "theirs") };
      fs.writeFileSync(paths.ours, blob(entry.ours));
      fs.writeFileSync(paths.base, entry.base ? blob(entry.base) : "");
      fs.writeFileSync(paths.theirs, blob(entry.theirs));
      // `-L` fixes the marker labels. Without it git names the temp files, and a
      // committed fixture would carry this machine's `/var/folders/…` path in
      // every conflict marker — different on the next run, on the next machine,
      // and not something a reader should have to look past.
      const args = ["merge-file", "-p", "--diff3", "-L", "ours", "-L", "base", "-L", "theirs"];
      const merged = execFileSync("git", [...args, paths.ours, paths.base, paths.theirs], {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
      }).toString();
      conflicts.push({ merge: label, file, date, raw: merged, hunks: parseDiff3(merged) });
    } catch (err) {
      const e = err as { stdout?: string };
      // `git merge-file` exits with the conflict count, which execFileSync
      // throws on; its stdout is the merged text and is exactly what we want.
      const raw = e.stdout ?? "";
      conflicts.push({ merge: label, file, date, raw, hunks: parseDiff3(raw) });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return conflicts;
}

// ── pass one: the merges that actually happened ─────────────────────────────

const mergeShas = git(["log", "--merges", "--format=%H"]).out.split("\n").filter(Boolean);
const observed: RawConflict[] = [];
let observedConflicted = 0;
for (const sha of mergeShas) {
  const parents = git(["rev-list", "--parents", "-n", "1", sha]).out.trim().split(" ").slice(1);
  if (parents.length !== 2) continue;
  const found = replayMerge(`merge ${sha.slice(0, 8)}`, parents[0], parents[1]);
  if (found) {
    observedConflicted++;
    observed.push(...found);
  }
}

// ── pass two: every pair of branches that coexisted ─────────────────────────

const branches = git(["branch", "-r", "--format=%(refname:short)"])
  .out.split("\n")
  .map((b) => b.trim())
  .filter((b) => b && !b.includes("HEAD") && b.includes("/"));

const generated: RawConflict[] = [];
let pairs = 0;
let pairsConflicted = 0;
for (let i = 0; i < branches.length; i++) {
  for (let j = i + 1; j < branches.length; j++) {
    pairs++;
    const found = replayMerge(`${branches[i]} x ${branches[j]}`, branches[i], branches[j]);
    if (found) {
      pairsConflicted++;
      generated.push(...found);
    }
  }
}

// ── the span of the history, for the per-week rate ──────────────────────────

const first = git(["log", "--reverse", "--format=%cI"]).out.split("\n").filter(Boolean)[0] ?? "";
const last = git(["log", "-1", "--format=%cI"]).out.trim();
const weeks = first && last ? (Date.parse(last) - Date.parse(first)) / (7 * 24 * 3600 * 1000) : 0;

// ── write it out ────────────────────────────────────────────────────────────

fs.mkdirSync(out, { recursive: true });

const observedVerdicts = observed.map(classifyFileConflict);
const generatedVerdicts = generated.map(classifyFileConflict);

const write = (name: string, rows: unknown[]) =>
  fs.writeFileSync(path.join(out, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

write("observed-verdicts.jsonl", observedVerdicts);
write("generated-verdicts.jsonl", generatedVerdicts);

/**
 * One conflict per distinct verdict-and-reason, committed as the **verbatim**
 * `git merge-file --diff3` output.
 *
 * The verdict files above are this harvester's answers, and a test that only
 * read them would be checking that JSON round-trips. The slices are the link
 * back to the bytes: the census test parses each one with `parseDiff3`,
 * classifies it, and asserts it reproduces the committed verdict — so the
 * classifier is exercised against real conflicted text on every run, and a
 * change to the rule shows up as a changed expectation rather than as a quietly
 * different number.
 *
 * The smallest example of each class is taken, because the whole reason the raw
 * hunks are not committed wholesale is that these files are briefings thousands
 * of lines long.
 *
 * **Only the conflicted regions are written, byte for byte.** The merged text
 * git produces is the whole file, and on this vault's corpus that is 75–120 kB
 * apiece of which 6–20% is inside a `<<<<<<<` block; committing the rest puts
 * ~260 kB of an agent's own scratch briefing into this repository's history to
 * carry three conflicts. What is dropped is exactly what `parseDiff3` skips —
 * the text outside a block never reaches a verdict — so the slice classifies
 * identically to the file it came from, which is what the census test asserts.
 */
function conflictBlocksOnly(merged: string): string {
  const kept: string[] = [];
  let inside = false;
  for (const line of merged.split("\n")) {
    if (/^<{7}(?:\s|$)/.test(line)) inside = true;
    if (inside) kept.push(line);
    if (/^>{7}(?:\s|$)/.test(line)) inside = false;
  }
  return kept.length === 0 ? "" : kept.join("\n") + "\n";
}

const sliceDir = path.join(out, "slices");
fs.rmSync(sliceDir, { recursive: true, force: true });
fs.mkdirSync(sliceDir, { recursive: true });

const bestByClass = new Map<string, { conflict: RawConflict; verdict: ReturnType<typeof classifyFileConflict> }>();
for (const [conflicts, verdicts, corpusName] of [
  [observed, observedVerdicts, "observed"],
  [generated, generatedVerdicts, "generated"],
] as const) {
  conflicts.forEach((conflict, i) => {
    if (!conflict.raw) return;
    const verdict = verdicts[i];
    const key = `${corpusName}:${verdict.verdict}:${verdict.reason}`;
    const held = bestByClass.get(key);
    const size = conflictBlocksOnly(conflict.raw).length;
    if (!held || size < conflictBlocksOnly(held.conflict.raw).length) {
      bestByClass.set(key, { conflict, verdict });
    }
  });
}

const slices = [...bestByClass.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([key, { conflict, verdict }], i) => {
    const name = `${String(i).padStart(2, "0")}-${verdict.verdict}.diff3`;
    const blocks = conflictBlocksOnly(conflict.raw);
    fs.writeFileSync(path.join(sliceDir, name), blocks);
    return {
      slice: name,
      class: key,
      merge: conflict.merge,
      file: conflict.file,
      bytes: blocks.length,
      wholeFileBytes: conflict.raw.length,
      expect: { verdict: verdict.verdict, reason: verdict.reason, hunks: verdict.hunks, hesitations: verdict.hesitations },
    };
  });
write("slices.jsonl", slices);

const corpus = {
  repo: path.basename(subject),
  head: git(["rev-parse", "HEAD"]).out.trim(),
  commits: Number(git(["rev-list", "--count", "HEAD"]).out.trim()),
  firstCommit: first,
  lastCommit: last,
  weeks,
  mergesObserved: mergeShas.length,
  mergesConflicted: observedConflicted,
  branchPairs: pairs,
  branchPairsConflicted: pairsConflicted,
  branches: branches.length,
  slices: slices.length,
};
fs.writeFileSync(path.join(out, "corpus.json"), JSON.stringify(corpus, null, 2) + "\n");

const census = conflictMechanicalityCensus(generatedVerdicts, {
  mergesObserved: pairs,
  mergesConflicted: pairsConflicted,
  weeks,
});
console.log(JSON.stringify(corpus, null, 2));
console.log("\n— concurrent branch pairs —");
console.log(formatConflictMechanicalityCensus(census));
console.log("\n— merges that actually happened —");
console.log(
  formatConflictMechanicalityCensus(
    conflictMechanicalityCensus(observedVerdicts, {
      mergesObserved: mergeShas.length,
      mergesConflicted: observedConflicted,
      weeks,
    }),
  ),
);
