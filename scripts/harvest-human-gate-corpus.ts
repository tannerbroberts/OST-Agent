/**
 * Re-derive the human-gate corpus: every artefact in this project that reached a
 * state where the only remaining work was one action by a person, with both ends
 * of the wait.
 *
 * The assumption test "Measure how long the last human-gated release actually
 * waited" says the data is already on disk and names the three classes it wants
 * — the unpublished/untagged releases, the `ost-agent result` filings sitting
 * unrun across the vault's assumption tests, and the paste-ready verdict commands
 * a briefing recorded as unrun. This script is that sentence, executed, so
 * `test/fixtures/human-gate-latency/corpus.json` can be checked against its
 * sources rather than trusted:
 *
 *   npx tsx scripts/harvest-human-gate-corpus.ts [/path/to/vault]
 *
 * The cut, one class at a time:
 *
 *   1. **release** — `git log -p -- package.json` over this repository, keeping
 *      every commit that ADDS a `"version": "X.Y.Z"` line. That is a release
 *      prepared, whether or not anybody tagged it. Ready is the commit's
 *      *committer* date (when it landed on `main`); acted is the tag `vX.Y.Z`,
 *      if one exists. Every tag in this repository is lightweight, so it carries
 *      no date of its own — a tagged release is recorded at a LOWER BOUND of the
 *      commit instant and flagged, never presented as a measured zero.
 *   2. **result-filing** — every AssumptionTest in the vault whose instrument has
 *      been observed **green** at least once. Ready is that first green's own
 *      recorded date: at that moment there is a run outcome and the only work
 *      left is one `ost-agent result` call. Acted is the first line under the
 *      node's `## Results` heading. Tests observed only red are NOT gates —
 *      those wait on a builder, not on a person.
 *   3. **verdict-draft** — every `ost-agent result "<test>"` command drafted in
 *      `.ost-agent/drafts/`. Ready is the committer date of the vault commit that
 *      first introduced that command string; acted is the `## Results` line on
 *      the test it names.
 *
 * Nothing here reaches the network. `asOf` is stamped at harvest time and stored,
 * so open waits score to the same running duration on every later run of the
 * test rather than growing with the wall clock.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault } from "../src/ost/vault.js";
import { instrumentLog } from "../src/ost/instrument.js";
import { RESULTS_HEADING } from "../src/ost/headings.js";
import { scoreGates, scoreGatesByKind, summarise, type HumanGate } from "../src/release/human-gate-latency.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(repoRoot, "test/fixtures/human-gate-latency");

const vaultDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "../../ost-agent-meta"));

function git(cwd: string, args: string[]): string {
  const out = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${out.stderr}`);
  return out.stdout;
}

/** Marks a commit header in `git log` output; nothing in a diff starts with it. */
const HEADER = "@@ost-commit@@";

// ---------------------------------------------------------------- 1. releases

interface ReleaseGate {
  version: string;
  commit: string;
  committedAt: string;
  tagged: boolean;
}

/**
 * Every commit that introduced a new `"version"` line into `package.json`,
 * newest first, paired with whether a `vX.Y.Z` tag names it.
 *
 * A version is recorded at the FIRST commit that added it; a later commit
 * re-adding the same string (a revert, a merge resolution) is not a second cut.
 * Bumps rather than tags are the unit for the same reason the propagation corpus
 * gives: most of this history was never tagged, so scoring on tags alone would
 * drop exactly the releases that are the finding.
 */
function readReleaseGates(): ReleaseGate[] {
  const raw = git(repoRoot, ["log", `--format=${HEADER}%H\t%cI`, "-p", "--", "package.json"]);
  const tags = new Set(
    git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/tags"])
      .split("\n")
      .map((t) => t.trim())
      .filter(Boolean),
  );

  const gates: ReleaseGate[] = [];
  const seen = new Set<string>();
  let current: { commit: string; committedAt: string } | null = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith(HEADER)) {
      const [commit, committedAt] = line.slice(HEADER.length).split("\t");
      current = { commit, committedAt: new Date(committedAt).toISOString() };
      continue;
    }
    const added = /^\+\s*"version":\s*"(\d+\.\d+\.\d+)"/.exec(line);
    if (!added || !current) continue;
    const version = added[1];
    if (seen.has(version)) continue;
    seen.add(version);
    gates.push({ version, ...current, tagged: tags.has(`v${version}`) });
  }
  return gates;
}

// ----------------------------------------------------------- 2. result filings

/** `- 2026-08-17 **green** (exit 0) `cmd` — …` — the shape `ost-agent instrument` writes. */
const OBSERVATION = /^-\s+(\d{4}-\d{2}-\d{2})\s+\*\*([a-z-]+)\*\*/i;
/** `- 2026-07-24 **supported** (ran by Tanner) — …` — the shape `ost-agent result` writes. */
const RESULT_LINE = /^-\s+(\d{4}-\d{2}-\d{2})\s+\*\*([a-z-]+)\*\*/i;

/** The dated lines under a node's `## Results` heading, in filing order. */
function resultLines(body: string): { on: string; verdict: string }[] {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase().startsWith(RESULTS_HEADING.toLowerCase()));
  if (start === -1) return [];
  const out: { on: string; verdict: string }[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    const m = RESULT_LINE.exec(line.trim());
    if (m) out.push({ on: m[1], verdict: m[2].toLowerCase() });
  }
  return out;
}

interface ResultGate {
  test: string;
  /** Date of the first green observation — when a verdict became fileable. */
  firstGreenOn: string;
  /** Date of the first recorded result, or null while nobody has filed one. */
  resultOn: string | null;
}

function readResultGates(vault: Vault): ResultGate[] {
  const gates: ResultGate[] = [];
  for (const node of vault.readTree()) {
    if (node.layer !== "AssumptionTest") continue;
    const greens = instrumentLog(node)
      .map((l) => OBSERVATION.exec(l))
      .filter((m): m is RegExpExecArray => m !== null && m[2].toLowerCase() === "green")
      .map((m) => m[1])
      .sort();
    if (greens.length === 0) continue;
    const results = resultLines(node.body ?? "");
    gates.push({ test: node.title, firstGreenOn: greens[0], resultOn: results[0]?.on ?? null });
  }
  return gates.sort((a, b) => a.test.localeCompare(b.test));
}

// ----------------------------------------------------------- 3. verdict drafts

interface DraftGate {
  test: string;
  draftPath: string;
  /** Committer date of the vault commit that first carried this command. */
  draftedAt: string;
  resultOn: string | null;
}

/**
 * Every `ost-agent result "<test>"` command drafted under `.ost-agent/drafts/`,
 * dated by the vault commit that first introduced it. The pickaxe (`-S`) over
 * the exact command prefix is what gives each command its own ready instant —
 * the drafts file grew over three commits, so the file's own creation date would
 * backdate the two commands added later.
 */
function readDraftGates(vault: Vault, resultsByTest: Map<string, string | null>): DraftGate[] {
  const draftsDir = path.join(vaultDir, ".ost-agent/drafts");
  if (!fs.existsSync(draftsDir)) return [];
  const gates: DraftGate[] = [];
  const seen = new Set<string>();
  for (const file of fs.readdirSync(draftsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const rel = path.posix.join(".ost-agent/drafts", file);
    const body = fs.readFileSync(path.join(draftsDir, file), "utf8");
    for (const m of body.matchAll(/ost-agent result "([^"]+)"/g)) {
      const test = m[1];
      if (seen.has(test)) continue;
      seen.add(test);
      const needle = `ost-agent result "${test}"`;
      // Oldest-first, so the first line is the commit that introduced it.
      const log = git(vaultDir, ["log", "--reverse", "--format=%cI", "-S", needle, "--", rel])
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (log.length === 0) throw new Error(`no vault commit introduces ${needle} in ${rel}`);
      gates.push({
        test,
        draftPath: rel,
        draftedAt: new Date(log[0]).toISOString(),
        resultOn: resultsByTest.get(test) ?? null,
      });
    }
  }
  // A drafted command names a test that must still exist for the pairing to mean
  // anything; a rename since the draft would otherwise read as "never filed".
  for (const g of gates) {
    if (!vault.has(g.test)) throw new Error(`drafted command names a test the vault no longer has: "${g.test}"`);
  }
  return gates;
}

// ------------------------------------------------------------------- the cut

const vault = new Vault(vaultDir);
const releases = readReleaseGates();
const results = readResultGates(vault);

// Result dates for every AssumptionTest, not only the green ones — a drafted
// command can name a test whose instrument was never observed at all.
const resultsByTest = new Map<string, string | null>();
for (const node of vault.readTree()) {
  if (node.layer !== "AssumptionTest") continue;
  resultsByTest.set(node.title, resultLines(node.body ?? "")[0]?.on ?? null);
}
const drafts = readDraftGates(vault, resultsByTest);

const gates: HumanGate[] = [
  ...releases.map(
    (r): HumanGate => ({
      kind: "release",
      subject: r.version,
      readyAt: r.committedAt,
      // A lightweight tag has no date of its own, so the earliest instant the
      // human act could have happened is the commit it points at. Recorded at
      // that lower bound and flagged — the reading most favourable to a human
      // gate, and the only one this repository's refs can support.
      actedAt: r.tagged ? r.committedAt : null,
      ...(r.tagged ? { actedAtIsLowerBound: true } : {}),
      note: r.tagged ? `tagged v${r.version} (lightweight; no tagger date)` : `never tagged (${r.commit.slice(0, 8)})`,
    }),
  ),
  ...results.map(
    (r): HumanGate => ({
      kind: "result-filing",
      subject: r.test,
      readyAt: `${r.firstGreenOn}T00:00:00.000Z`,
      actedAt: r.resultOn === null ? null : `${r.resultOn}T00:00:00.000Z`,
      note: "ready at the first green observation on its own instrument",
    }),
  ),
  ...drafts.map(
    (d): HumanGate => ({
      kind: "verdict-draft",
      subject: d.test,
      readyAt: d.draftedAt,
      actedAt: d.resultOn === null ? null : `${d.resultOn}T00:00:00.000Z`,
      note: `paste-ready in ${d.draftPath}`,
    }),
  ),
];

/**
 * How many commits in the vault's whole history ever changed a `## Results`
 * heading — the section `ost-agent result` and nothing else writes.
 *
 * Harvested rather than inferred from the gate list, because "no gate has
 * closed" and "the human half of this loop has never once run" are different
 * claims and only the second one is answered by the history.
 */
function resultsHeadingCommits(): number {
  return git(vaultDir, ["log", "--format=%H", "-G", "^## Results$", "--", "*.md"])
    .split("\n")
    .filter((l) => l.trim()).length;
}

/** `Estimated involvement: **3 minutes.**` — what a draft told the human it would cost. */
function draftEstimates(): Record<string, string> {
  const draftsDir = path.join(vaultDir, ".ost-agent/drafts");
  const out: Record<string, string> = {};
  if (!fs.existsSync(draftsDir)) return out;
  for (const file of fs.readdirSync(draftsDir).sort()) {
    if (!file.endsWith(".md")) continue;
    const m = /Estimated involvement:\s*\*\*([^*]+)\*\*/.exec(fs.readFileSync(path.join(draftsDir, file), "utf8"));
    if (m) out[path.posix.join(".ost-agent/drafts", file)] = m[1].trim();
  }
  return out;
}

const asOf = new Date().toISOString();
const corpus = {
  asOf,
  repoHead: git(repoRoot, ["rev-parse", "HEAD"]).trim(),
  vaultHead: git(vaultDir, ["rev-parse", "HEAD"]).trim(),
  vaultCommits: Number(git(vaultDir, ["rev-list", "--count", "HEAD"]).trim()),
  /** Commits in the vault's whole history that ever touched a `## Results` heading. */
  resultsHeadingCommits: resultsHeadingCommits(),
  assumptionTests: [...resultsByTest.keys()].length,
  draftEstimates: draftEstimates(),
  gates,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`);

const overall = scoreGates(gates, asOf);
console.log(`wrote ${path.relative(repoRoot, path.join(outDir, "corpus.json"))}`);
console.log(`  overall: ${summarise(overall)}`);
for (const [kind, latency] of Object.entries(scoreGatesByKind(gates, asOf))) {
  console.log(`  ${kind}: ${summarise(latency)}`);
}
