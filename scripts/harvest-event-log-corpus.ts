/**
 * Re-derive the event-log-projection corpus from a vault's own git history.
 *
 * The fixture at `test/fixtures/event-log-projection/` is this vault's whole
 * tree-changing history decomposed into events, plus the digest of every file the
 * projection has to reproduce — see that directory's PROVENANCE.md for the cut and
 * what it does and does not show.
 *
 *   npx tsx scripts/harvest-event-log-corpus.ts /path/to/vault [outDir]
 *
 * **What crosses into the fixture, and what does not.** The event log crosses in
 * whole, payloads included, because those payloads *are* the subject: a log whose
 * contents were summarised could not be projected, and a test handed a
 * pre-computed verdict would be reading the harvester's homework rather than
 * checking it. What does not cross in is the answer — the fixture carries no
 * residue count and no projected tree. The test folds the log itself with
 * `projectEvents` and compares the result to per-file SHA-256 digests taken from
 * the real vault, so an event this script mislabelled surfaces there as a
 * mismatch instead of being carried past.
 *
 * **The cut.** Per the assumption test's method: every commit touching a `.md`
 * file outside `.ost-agent/`, excluding merge commits. `.ost-agent/usage/` sweeps
 * are excluded by that filter already, since they touch no node.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  declaredWriter,
  expressCommit,
  projectEvents,
  projectionMismatches,
  residueCensus,
  type CommitChange,
  type FileChange,
  type OstEvent,
} from "../src/ost/event-log.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = path.resolve(process.argv[2] ?? ".");
const outDir = path.resolve(process.argv[3] ?? path.join(here, "../test/fixtures/event-log-projection"));

function git(args: string[], input?: string): string {
  const r = spawnSync("git", ["-C", vault, ...args], {
    encoding: "utf8",
    input,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/** Is this a path the tree is made of? `.md` outside the agent's own bookkeeping. */
function isTreeFile(file: string): boolean {
  return file.endsWith(".md") && !file.startsWith(".ost-agent/");
}

/**
 * Read many blobs in one `git cat-file --batch`, keyed by the `<sha>:<path>` spec
 * asked for. A spec that does not resolve comes back absent rather than throwing —
 * that is how "the file did not exist at this commit" arrives.
 *
 * Chunked because the batch's whole output is buffered, and this vault's history
 * is several hundred megabytes of blob when taken at once.
 */
function readBlobs(specs: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const CHUNK = 2000;
  for (let start = 0; start < specs.length; start += CHUNK) {
    const batch = specs.slice(start, start + CHUNK);
    const r = spawnSync("git", ["-C", vault, "cat-file", "--batch"], {
      input: batch.join("\n") + "\n",
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (r.status !== 0) throw new Error(`git cat-file --batch failed: ${r.stderr?.toString()}`);
    const buf: Buffer = r.stdout;
    let at = 0;
    for (const spec of batch) {
      const nl = buf.indexOf(0x0a, at);
      const header = buf.subarray(at, nl).toString("utf8");
      at = nl + 1;
      if (header.endsWith(" missing")) continue;
      const size = Number(header.split(" ")[2]);
      out.set(spec, buf.subarray(at, at + size).toString("utf8"));
      at += size + 1; // trailing newline the batch writes after each object
    }
  }
  return out;
}

const head = git(["rev-parse", "HEAD"]).trim();

// ---------------------------------------------------------------------------
// One `git log` pass for the shape of every commit, oldest first — a log is a
// fold, so the order it is built in is the order it replays in.
//
// `--topo-order` and not the default: a log is linear and this history is not.
// Date order interleaves parallel branches, so a prefix of it can hold a commit
// whose own parent has not been folded yet, and the diff that commit carries
// then lands on a file that is not the one it was computed against.
// Topological order guarantees every commit's parent precedes it.
//
// Merges are walked too, though the method excludes them from the *count*. They
// cannot be excluded from the fold: a whole-file residue snapshot written on one
// branch reverts work done on another, and the merge is the only record of how
// the vault reconciled them. `residueCensus` drops them from the denominator.
// ---------------------------------------------------------------------------

// NUL as the record separator: a commit subject can contain anything else.
const RECORD = "\u0000";
const raw = git(["log", "--reverse", "--topo-order", "--format=%x00%H %P|%s", "--name-status", "-M", "--"]);

interface RawCommit {
  sha: string;
  parents: string[];
  subject: string;
  paths: string[];
}

const rawCommits: RawCommit[] = [];
for (const block of raw.split(RECORD)) {
  if (!block.trim()) continue;
  const nl = block.indexOf("\n");
  const headerLine = nl < 0 ? block : block.slice(0, nl);
  const [shas, subject] = splitOnce(headerLine, "|");
  const [sha, ...parents] = shas.trim().split(/\s+/);
  const paths = new Set<string>();
  for (const line of (nl < 0 ? "" : block.slice(nl + 1)).split("\n")) {
    if (!line.trim()) continue;
    const cols = line.split("\t");
    // A rename reads as the pair it is: the old path stops existing, the new starts.
    for (const file of cols[0][0] === "R" ? cols.slice(1, 3) : cols.slice(1, 2)) {
      if (isTreeFile(file)) paths.add(file);
    }
  }
  // `git log --name-status` prints no diff for a merge, so a merge's paths come
  // from comparing it against each parent in turn: the union, because a file the
  // first parent agrees with may still be one the second parent lost.
  if (parents.length > 1) {
    for (const parent of parents) {
      for (const file of git(["diff", "--name-only", parent, sha, "--"]).split("\n")) {
        if (isTreeFile(file)) paths.add(file);
      }
    }
  }
  if (paths.size > 0) rawCommits.push({ sha, parents, subject, paths: [...paths] });
}

function splitOnce(s: string, sep: string): [string, string] {
  const at = s.indexOf(sep);
  return at < 0 ? [s, ""] : [s.slice(0, at), s.slice(at + sep.length)];
}

// ---------------------------------------------------------------------------
// Every blob either side of every change, in two batched reads.
// ---------------------------------------------------------------------------

const specs = new Set<string>();
for (const c of rawCommits) {
  for (const p of c.paths) {
    specs.add(`${c.sha}:${p}`);
    if (c.parents[0]) specs.add(`${c.parents[0]}:${p}`);
  }
}
const blobs = readBlobs([...specs]);

const commits: CommitChange[] = [];
for (const c of rawCommits) {
  const merge = c.parents.length > 1;
  const files: FileChange[] = [];
  for (const p of c.paths) {
    const before = c.parents[0] ? (blobs.get(`${c.parents[0]}:${p}`) ?? null) : null;
    const after = blobs.get(`${c.sha}:${p}`) ?? null;
    // A merge's file list is already the set of paths some parent disagreed with
    // it about, so "same as the first parent" is not "unchanged" there.
    if (before === after && !merge) continue;
    files.push({ path: p, before: merge ? null : before, after });
  }
  if (files.length > 0) {
    commits.push({ sha: c.sha, subject: c.subject, files, ...(merge ? { writer: "git.merge" as const } : {}) });
  }
}

const expressions = commits.map((c) => expressCommit(c));
const events: OstEvent[] = expressions.flatMap((e) => [...e.events]);

// ---------------------------------------------------------------------------
// The tree at HEAD, and at checkpoints along the way. Digests only: the test has
// to recompute the content itself from the log, so handing it the answer would
// defeat the point of asking.
// ---------------------------------------------------------------------------

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

function treeDigestsAt(sha: string): Record<string, string> {
  const paths = git(["ls-tree", "-r", "--name-only", sha]).split("\n").filter(isTreeFile);
  const contents = readBlobs(paths.map((p) => `${sha}:${p}`));
  const digests: Record<string, string> = {};
  for (const p of paths) {
    const content = contents.get(`${sha}:${p}`);
    if (content !== undefined) digests[p] = sha256(content);
  }
  return digests;
}

/**
 * Is the prefix of the log ending at `i` exactly the history of `commits[i]`?
 *
 * A prefix is only comparable to a real tree when the two contain the same
 * commits. Topological order gets each commit after its own parent, but it does
 * not stop a parallel branch from being emitted before a commit that is not
 * descended from it — and at such a point the fold holds work the vault had not
 * merged yet, so it corresponds to no tree that ever existed. Those points are
 * not evidence against the projector and are skipped rather than asserted on;
 * how many get skipped is reported, because it is the shape of the history
 * rather than a detail of the cut.
 */
function prefixIsAncestryOf(i: number): boolean {
  const ancestors = new Set(git(["rev-list", commits[i].sha]).split("\n").filter(Boolean));
  for (let j = 0; j <= i; j++) if (!ancestors.has(commits[j].sha)) return false;
  return true;
}

// Roughly every 500th tree-changing commit, so a semantic event that only *looks*
// right at the end has to be right on the way there too — advanced to the next
// commit whose prefix is a real tree when the nominal one is not.
const CHECKPOINT_EVERY = 500;
const checkpoints: { sha: string; afterCommits: number; afterEvents: number; digests: Record<string, string> }[] = [];
const eventsBefore: number[] = [];
let eventCount = 0;
for (const e of expressions) {
  eventsBefore.push(eventCount);
  eventCount += e.events.length;
}
let skipped = 0;
for (let want = CHECKPOINT_EVERY; want <= expressions.length; want += CHECKPOINT_EVERY) {
  let i = want - 1;
  while (i < expressions.length && !prefixIsAncestryOf(i)) {
    i++;
    skipped++;
  }
  if (i >= expressions.length) break;
  checkpoints.push({
    sha: commits[i].sha,
    afterCommits: i + 1,
    afterEvents: eventsBefore[i] + expressions[i].events.length,
    digests: treeDigestsAt(commits[i].sha),
  });
}

const headDigests = treeDigestsAt(head);

fs.mkdirSync(outDir, { recursive: true });
writeGz(path.join(outDir, "log.json.gz"), {
  vault: path.basename(vault),
  head,
  commits: expressions.map((e) => ({ sha: e.sha, writer: e.writer, events: e.events.length })),
  events,
});
writeGz(path.join(outDir, "tree.json.gz"), { head, checkpointEvery: CHECKPOINT_EVERY, headDigests, checkpoints });

/** Gzipped, because the log carries the payloads and is 11 MB of JSON without it. */
function writeGz(file: string, value: unknown): void {
  fs.writeFileSync(file, zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 }));
}

// Reported, not written into the fixture: the numbers the test recomputes for
// itself. Comparing digest-to-digest here is the same comparison the test makes,
// run once at harvest so a corpus that could not possibly pass is visible before
// it is committed.
const census = residueCensus(expressions);
const projected = projectEvents(events);
const projectedDigests = new Map([...projected].map(([p, content]) => [p, sha256(content)]));
const mismatches = projectionMismatches(projectedDigests, new Map(Object.entries(headDigests)));
process.stdout.write(
  [
    `vault              ${vault}`,
    `head               ${head}`,
    `tree-changing      ${census.commits} commits`,
    `events             ${events.length}`,
    `expressible        ${census.expressible} (${(census.rate * 100).toFixed(2)}%)`,
    `residue            ${census.withResidue} commits`,
    `  by writer        ${JSON.stringify(census.byWriter, null, 2)}`,
    `unknown-writer     ${commits.filter((c) => declaredWriter(c.subject) === "unknown").length} commits`,
    `files at head      ${Object.keys(headDigests).length}`,
    `projected files    ${projected.size}`,
    `mismatches         ${mismatches.length}`,
    `  by reason        ${JSON.stringify(tally(mismatches.map((m) => m.reason)))}`,
    `checkpoints        ${checkpoints.length} (advanced past ${skipped} commit(s) whose prefix was no real tree)`,
    "",
  ].join("\n"),
);

function tally(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
