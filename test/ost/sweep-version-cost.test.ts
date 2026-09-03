/**
 * "Time a candidate version computation against producing the full sweep" — the
 * AssumptionTest beneath "The sweep returns a version, and re-asking an unchanged
 * tree costs nothing", and the one whose answer decides whether that solution is
 * worth building at all.
 *
 * **The pre-committed threshold, verbatim from the node's frontmatter:** "A
 * candidate costs under 10% of producing the sweep and detects 20 of 20
 * changes." Both halves are load-bearing and the second is the one that can lose
 * quietly: a version that is cheap but coarse tells a caller the tree is current
 * when it is not, which is worse than the re-reading it was meant to save.
 *
 * **The design, also from the node:** implement two candidates — one over file
 * modification times, one over content hashes — time each against producing the
 * full sweep on a vault at realistic size, then make twenty representative
 * changes and check whether each candidate detects every one.
 *
 * **What the threshold is asking, and why it is an existential.** The node's
 * risk category is `feasibility` and its body states the assumption as "a version
 * can be both cheap and honest". The question is therefore whether such a
 * candidate EXISTS, and the frontmatter says so in the singular: *a* candidate.
 * That reading is what the verdict below asserts. Both candidates' numbers are
 * reported either way — the losing one's ratio is the finding, not a detail —
 * and both are held to the detection half, because a candidate that misses a
 * change is not a cheaper answer to the question, it is a wrong one.
 *
 * **Why a ratio and not a millisecond bound.** A wall-clock number is a property
 * of the machine, and this repository has already lost a week to a timing gate
 * that fired on load (`src/telemetry/operation-budget.ts` records it). Running
 * the candidate and the sweep over the same fixture in the same process cancels
 * the machine out, which is `test/ost/dedupe-scale.test.ts`'s argument and this
 * file borrows it.
 *
 * **What this does NOT settle**, in the node's own words: one vault at one size.
 * The cheap candidate's cost may grow differently from the sweep's as the tree
 * gets larger, so the ratio is the finding and neither absolute number is. The
 * fixture below is shaped after this project's own vault — its node count, its
 * average body length, its evidence-record-to-node ratio — because that is the
 * vault the node was written about; a fixture of one-byte bodies would make the
 * content candidate look far cheaper against the sweep than it is against real
 * prose, which is the exact comparison at issue.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools } from "../../src/security/tools.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { contentVersion, mtimeVersion, treeVersion, type TreeVersion } from "../../src/ost/tree-version.js";
import type { Layer } from "../../src/ost/node.js";
import type { Vault } from "../../src/ost/vault.js";
import { phraseFrom, seededRandom } from "./fixture-vault.js";

const OUTCOME = "Retention";

/**
 * The fixture's shape, taken off this project's own vault on 2026-09-02 rather
 * than chosen: 1,636 node files averaging ~2.7 KB of prose, and 705 evidence
 * records under `.ost-agent/evidence/`. Scaled down to keep the suite quick,
 * holding fixed the two things the ratio is actually sensitive to — bytes per
 * node, and records per node.
 */
const NODES = 900;
const EVIDENCE_RECORDS = 390;
const BODY_BYTES = 2_700;

/**
 * The size the response-shape half of this file builds at.
 *
 * Nothing down there is a measurement — it checks that a sweep carries a
 * version, that presenting it back collapses the response, and that a stale or
 * cross-scheme one does not. None of those need a realistic vault, and building
 * a second one did: this file's two fixtures wrote ~2,600 files of real prose
 * into a suite that runs test files in parallel, beside
 * `test/adapters/ingest-backpressure-provenance.test.ts`, whose 25 s budget is
 * pure filesystem throughput. Adding I/O to a shared box to assert something
 * that does not need it is the cost this constant removes.
 */
const SHAPE_NODES = 60;
const SHAPE_RECORDS = 20;

/** How many interleaved rounds the timing takes. See {@link timeInterleaved}. */
const ROUNDS = 9;

/** The bar, from the node's `threshold:` field. */
const COST_CEILING = 0.1;

/** Deterministic prose of about `bytes` characters — seeded, never `Math.random`. */
function prose(rnd: () => number, bytes: number): string {
  const out: string[] = [];
  let len = 0;
  while (len < bytes) {
    const phrase = phraseFrom(rnd);
    out.push(phrase);
    len += phrase.length + 1;
    if (out.length % 12 === 0) out.push("\n\n");
  }
  return out.join(" ");
}

interface Fixture {
  vault: Vault;
  dir: string;
  /** Titles in creation order, so a mutation can name one without re-reading the tree. */
  titles: string[];
}

/** A vault shaped like this project's own, at the size the constants above name. */
async function buildFixture(prefix: string, nodes = NODES, records = EVIDENCE_RECORDS): Promise<Fixture> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  const { vault } = buildPassContext(dir);
  const rnd = seededRandom(11);
  const titles: string[] = [];
  const opportunities: string[] = [];
  const solutions: string[] = [];

  for (let i = 0; i < nodes; i++) {
    // Roughly the live vault's mix — one opportunity per four other nodes — and
    // wide-vocabulary titles, because the near-duplicate scan's cost is a
    // function of how many pairs clear its threshold and a fixture of
    // near-identical titles would measure the size of the answer rather than the
    // cost of producing the sweep (`test/ost/fixture-vault.ts` says the same).
    const kind = i % 5;
    const layer: Layer = kind === 0 ? "Opportunity" : kind <= 2 ? "Solution" : "AssumptionTest";
    const title = `${layer} ${phraseFrom(rnd)} n${i}`;
    vault.createNode({
      title,
      layer,
      evidence: "observed",
      source: `INBOX:n${i}.md`,
      body: prose(rnd, BODY_BYTES),
      tags: [],
      links: [],
    });
    titles.push(title);
    if (layer === "Opportunity") opportunities.push(title);
    else if (layer === "Solution") solutions.push(title);
  }
  for (const t of opportunities) vault.linkNodes(OUTCOME, t);
  for (let i = 0; i < solutions.length; i++) vault.linkNodes(opportunities[i % opportunities.length], solutions[i]);

  const evidenceDir = path.join(dir, ".ost-agent", "evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  for (let i = 0; i < records; i++) {
    fs.writeFileSync(
      path.join(evidenceDir, `rec-${i}.md`),
      `---\nid: 'INBOX:rec-${i}.md'\nsource: 'INBOX:rec-${i}.md'\ntitle: record ${i}\ntimestamp: '2026-08-0${(i % 9) + 1}'\nactor: channel:inbox\n---\n\n${prose(rnd, BODY_BYTES)}\n`,
      "utf8",
    );
  }
  return { vault, dir, titles };
}

/**
 * Time several things against each other, interleaved, and report the cheapest
 * reading each one managed.
 *
 * **Both halves of that are load defences, and this file needs them.** Timing one
 * series to completion and then the next hands a load spike entirely to whichever
 * series was running; interleaving spreads it across all of them, so a busy
 * window inflates the ratio's numerator and denominator together. And the
 * statistic is the MINIMUM rather than the median because the two series here are
 * not the same shape: producing the sweep is ~65 ms of CPU, and the mtime
 * candidate is ~4 ms of syscalls, so a single scheduler preemption is noise on
 * one and a doubling on the other — a median over a contended box measures the
 * contention, not the code. The cheapest run of each is the one the machine
 * interfered with least, which is what the ratio is supposed to be about.
 *
 * Measured, not asserted: on a full-suite run with fifteen other files executing
 * in parallel, median-of-7 taken series-at-a-time put the mtime candidate at
 * 10.2% of the sweep against 5.7% alone — a gate that fires on load, which is
 * the failure `src/telemetry/operation-budget.ts` records this repository
 * already paying for once.
 */
function timeInterleaved<K extends string>(work: Record<K, () => unknown>): Record<K, number> {
  const names = Object.keys(work) as K[];
  for (const n of names) work[n](); // warm the caches, and pay module init once
  const best = Object.fromEntries(names.map((n) => [n, Infinity])) as Record<K, number>;
  for (let round = 0; round < ROUNDS; round++) {
    for (const n of names) {
      const t = performance.now();
      work[n]();
      best[n] = Math.min(best[n], performance.now() - t);
    }
  }
  return best;
}

/**
 * The filesystem's observed timestamp resolution, in nanoseconds, measured by
 * writing the same file twice in a row.
 *
 * Reported, never asserted on. It is not part of the threshold, but it is the
 * one property of the environment that decides whether the mtime candidate CAN
 * see a same-length edit — so a failure of that mutation on a filesystem that
 * stamps whole seconds is a fact about the box, and a reader should not have to
 * guess that from a bare "the version did not change".
 */
function timestampResolutionNs(dir: string): bigint {
  const probe = path.join(dir, ".mtime-probe");
  fs.writeFileSync(probe, "a", "utf8");
  const first = fs.statSync(probe, { bigint: true }).mtimeNs;
  fs.writeFileSync(probe, "b", "utf8");
  const second = fs.statSync(probe, { bigint: true }).mtimeNs;
  fs.rmSync(probe);
  return second > first ? second - first : 0n;
}

/** One representative change, and the name it is reported under. */
interface Mutation {
  name: string;
  apply: (f: Fixture) => void;
}

/** Rewrite a node file through `fs`, the way a person at an editor would. */
function editNodeFile(f: Fixture, title: string, edit: (raw: string) => string): void {
  const p = f.vault.pathFor(title);
  const before = fs.readFileSync(p, "utf8");
  const after = edit(before);
  if (after === before) throw new Error(`mutation on "${title}" changed nothing — the fixture moved out from under it`);
  fs.writeFileSync(p, after, "utf8");
}

/** Swap the first adjacent pair of differing characters past `from`. Changes no byte count. */
function swapAdjacent(raw: string, from: number): string {
  for (let i = from; i < raw.length - 1; i++) {
    if (raw[i] !== raw[i + 1] && raw[i] !== "\n" && raw[i + 1] !== "\n") {
      return raw.slice(0, i) + raw[i + 1] + raw[i] + raw.slice(i + 2);
    }
  }
  throw new Error("no adjacent differing characters to swap");
}

/** One line onto a ledger the sweep consults, creating the file if it is the first. */
function appendLedger(f: Fixture, rel: string): void {
  const p = path.join(f.dir, ".ost-agent", rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, `{"at":"2026-09-02T00:00:00.000Z","note":"${path.basename(rel)}"}\n`, "utf8");
}

/**
 * Twenty representative changes, applied in order.
 *
 * Representative of what a vault actually undergoes rather than of what is easy
 * to detect: writes through the product's own surface, edits by a person in
 * Obsidian, a file moved to the archive, a record dropped into the evidence
 * folder, and the first line appended to each of the four ledgers the sweep
 * consults. Number 10 is deliberately the hard one — an edit that changes no
 * byte count — because that is the only shape a timestamp rule could plausibly
 * miss, and twenty changes that all moved a file's size would be twenty easy
 * questions.
 */
const MUTATIONS: readonly Mutation[] = [
  {
    name: "a new Opportunity node",
    apply: (f) => {
      f.vault.createNode({ title: "A newly filed need m1", layer: "Opportunity", evidence: "assertion", body: "new", tags: [], links: [] });
      f.vault.linkNodes(OUTCOME, "A newly filed need m1");
    },
  },
  {
    name: "a new Solution node",
    apply: (f) => {
      f.vault.createNode({ title: "A newly ideated candidate m2", layer: "Solution", evidence: "assertion", body: "new", tags: [], links: [] });
      f.vault.linkNodes("A newly filed need m1", "A newly ideated candidate m2");
    },
  },
  {
    name: "a new AssumptionTest node",
    apply: (f) =>
      f.vault.createNode({ title: "A newly surfaced test m3", layer: "AssumptionTest", evidence: "assertion", body: "new", tags: [], links: [] }),
  },
  { name: "a new edge between two existing nodes", apply: (f) => f.vault.linkNodes("A newly ideated candidate m2", "A newly surfaced test m3") },
  { name: "a section appended to a node body", apply: (f) => editNodeFile(f, f.titles[3], (raw) => `${raw}\n\n## History\n- 2026-09-02 appended\n`) },
  {
    name: "an edge removed from a node body",
    apply: (f) => editNodeFile(f, "A newly ideated candidate m2", (raw) => raw.replace("[[A newly surfaced test m3]]\n", "")),
  },
  { name: "a node's status changed", apply: (f) => editNodeFile(f, f.titles[5], (raw) => raw.replace("---\n", "---\nstatus: deferred\n")) },
  { name: "a node's evidence rung changed", apply: (f) => editNodeFile(f, f.titles[7], (raw) => raw.replace("evidence: observed", "evidence: assertion")) },
  { name: "a tag added to a node", apply: (f) => editNodeFile(f, f.titles[9], (raw) => raw.replace(/^#(\S+)/m, "#$1 #reviewed")) },
  {
    // The one change that moves no byte count. See the comment above this list.
    name: "a same-length edit inside a node body",
    apply: (f) => editNodeFile(f, f.titles[11], (raw) => swapAdjacent(raw, 400)),
  },
  {
    name: "a node file renamed",
    apply: (f) => fs.renameSync(f.vault.pathFor(f.titles[13]), path.join(f.dir, "A node under its new title.md")),
  },
  { name: "a node file deleted", apply: (f) => fs.rmSync(f.vault.pathFor(f.titles[15])) },
  {
    name: "a node moved into the archive",
    apply: (f) => {
      fs.mkdirSync(path.join(f.dir, "archive"), { recursive: true });
      fs.renameSync(f.vault.pathFor(f.titles[17]), path.join(f.dir, "archive", `${f.titles[17]}.md`));
    },
  },
  {
    name: "a new evidence record",
    apply: (f) =>
      fs.writeFileSync(
        path.join(f.dir, ".ost-agent", "evidence", "rec-new.md"),
        "---\nid: 'INBOX:rec-new.md'\nsource: 'INBOX:rec-new.md'\ntitle: fresh\ntimestamp: '2026-09-02'\nactor: channel:inbox\n---\n\nfresh\n",
        "utf8",
      ),
  },
  {
    name: "an evidence record edited",
    apply: (f) => {
      const p = path.join(f.dir, ".ost-agent", "evidence", "rec-3.md");
      fs.writeFileSync(p, `${fs.readFileSync(p, "utf8")}\n\nan appended line\n`, "utf8");
    },
  },
  { name: "an evidence record deleted", apply: (f) => fs.rmSync(path.join(f.dir, ".ost-agent", "evidence", "rec-4.md")) },
  { name: "the first entry on the disposition ledger", apply: (f) => appendLedger(f, path.join("dispositions", "dispositions.jsonl")) },
  { name: "the first entry on the suppression ledger", apply: (f) => appendLedger(f, path.join("suppressions", "suppressions.jsonl")) },
  { name: "the first entry on the ask ledger", apply: (f) => appendLedger(f, path.join("asks", "asks.jsonl")) },
  { name: "the first entry on the actor-trust ledger", apply: (f) => appendLedger(f, path.join("trust", "actors.jsonl")) },
];

/** The two candidates the node's design names, by the names it gives them. */
const CANDIDATES: readonly { name: string; compute: (dir: string) => TreeVersion }[] = [
  { name: "mtime", compute: (dir) => mtimeVersion(dir) },
  { name: "content", compute: (dir) => contentVersion(dir) },
];

describe("a version can be both cheap and honest", () => {
  let f: Fixture;
  /** candidate → its cost as a fraction of producing the sweep. */
  const ratios = new Map<string, number>();
  /** candidate → how many of the twenty changes it saw. */
  const detected = new Map<string, number>();
  /** The two lines the verdict quotes, whichever way it goes. */
  const report: string[] = [];

  beforeAll(async () => {
    f = await buildFixture("ost-sweep-version-cost-");
  }, 180_000);
  afterAll(() => {
    if (f) fs.rmSync(f.dir, { recursive: true, force: true });
  });

  test("each candidate is timed against producing the full sweep", () => {
    const ms = timeInterleaved({
      sweep: () => computeNextWork(f.vault, f.dir, 3),
      mtime: () => mtimeVersion(f.dir),
      content: () => contentVersion(f.dir),
    });
    // Non-vacuity: a sweep that came back instantly would make every ratio pass
    // and measure nothing. The fixture is built to be real work.
    expect(ms.sweep, `the sweep is too cheap on this fixture for a ratio to mean anything (${ms.sweep.toFixed(2)} ms)`).toBeGreaterThan(5);
    for (const c of CANDIDATES) {
      const candidateMs = ms[c.name as "mtime" | "content"];
      ratios.set(c.name, candidateMs / ms.sweep);
      report.push(`${c.name} ${candidateMs.toFixed(2)} ms = ${((candidateMs / ms.sweep) * 100).toFixed(1)}% of the sweep`);
    }
    console.log(
      `  sweep-version cost over ${NODES} nodes / ${EVIDENCE_RECORDS} records: ` +
        `sweep ${ms.sweep.toFixed(1)} ms; ${report.join("; ")}`,
    );
  }, 180_000);

  test("each candidate detects all twenty representative changes", () => {
    const resolutionNs = timestampResolutionNs(f.dir);
    // Both candidates are scored over ONE run of the mutation list, not one run
    // each. The list is not replayable — it creates nodes that would then already
    // exist, deletes files that would then be gone — and a second pass over a
    // tree the first already changed would be scoring a different question.
    const missed = new Map<string, string[]>(CANDIDATES.map((c) => [c.name, []]));
    const previous = new Map(CANDIDATES.map((c) => [c.name, c.compute(f.dir).version]));
    for (const m of MUTATIONS) {
      m.apply(f);
      for (const c of CANDIDATES) {
        const now = c.compute(f.dir).version;
        if (now === previous.get(c.name)) missed.get(c.name)!.push(m.name);
        previous.set(c.name, now);
      }
    }
    for (const c of CANDIDATES) {
      detected.set(c.name, MUTATIONS.length - missed.get(c.name)!.length);
      expect(
        missed.get(c.name),
        `the ${c.name} candidate did not see ${missed.get(c.name)!.length} of ${MUTATIONS.length} change(s). ` +
          `This filesystem resolves two consecutive writes ${resolutionNs} ns apart, which is what decides whether ` +
          `a same-length edit is visible to a timestamp.`,
      ).toEqual([]);
    }
  }, 180_000);

  test("a candidate costs under 10% of producing the sweep and detects 20 of 20 changes", () => {
    expect(ratios.size, "the cost measurement did not run").toBe(CANDIDATES.length);
    expect(detected.size, "the detection measurement did not run").toBe(CANDIDATES.length);
    const table = CANDIDATES.map(
      (c) => `${c.name}: ${((ratios.get(c.name) ?? NaN) * 100).toFixed(1)}% of the sweep, ${detected.get(c.name)}/${MUTATIONS.length} changes detected`,
    ).join("; ");
    const clears = CANDIDATES.filter((c) => (ratios.get(c.name) ?? Infinity) < COST_CEILING && detected.get(c.name) === MUTATIONS.length);
    expect(
      clears.map((c) => c.name),
      `no candidate is both cheap and honest, so the version this solution rests on cannot be had — ${table}`,
    ).not.toEqual([]);

    // And the version `ost_next_work` actually returns has to BE one of the
    // candidates that cleared. A test that found a cheap honest candidate while
    // the product shipped a different, unmeasured one would be reporting somebody
    // else's number.
    const shipped = treeVersion(f.dir);
    expect(
      clears.map((c) => c.compute(f.dir).version).includes(shipped),
      `the version ost_next_work returns is not one of the candidates that cleared the bar — ${table}`,
    ).toBe(true);
  });
});

describe("re-asking an unchanged tree costs nothing", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await buildFixture("ost-sweep-version-reask-", SHAPE_NODES, SHAPE_RECORDS);
  }, 180_000);
  afterAll(() => {
    if (f) fs.rmSync(f.dir, { recursive: true, force: true });
  });

  /** `ost_next_work` bound to the fixture, built fresh so no state rides between calls. */
  function nextWork(): (input: { since?: string }) => Promise<string> {
    const ctx = buildPassContext(f.dir);
    const tool = buildOstTools({ vault: ctx.vault, dir: f.dir, remote: { enabled: false }, passContext: ctx }).find(
      (t) => t.name === "ost_next_work",
    )!;
    return (input) => tool.run(input) as Promise<string>;
  }

  test("the sweep carries a version, and presenting it back returns bytes instead of the list", async () => {
    const run = nextWork();
    const full = await run({});
    const sweep = JSON.parse(full);
    expect(typeof sweep.version, "every sweep carries a version").toBe("string");
    expect(sweep.version.length).toBeGreaterThan(0);

    const confirmed = await run({ since: sweep.version });
    const unchanged = JSON.parse(confirmed);
    expect(unchanged.kind).toBe("unchanged");
    expect(unchanged.version).toBe(sweep.version);
    // "Costs nothing" is a claim about what comes back, so it is asserted on
    // bytes rather than on the shape alone. The margin is deliberately loose —
    // the point is a collapse, not a particular number.
    expect(
      confirmed.length,
      `confirming an unchanged tree returned ${confirmed.length} bytes against the full sweep's ${full.length}`,
    ).toBeLessThan(full.length / 10);
  }, 180_000);

  test("presenting a version after a change returns the full sweep, never 'unchanged'", async () => {
    const run = nextWork();
    const before = JSON.parse(await run({})).version;
    f.vault.createNode({ title: "Something happened after that version", layer: "Opportunity", evidence: "assertion", body: "b", tags: [], links: [] });
    const after = JSON.parse(await run({ since: before }));
    expect(after.kind, "a stale version must never be answered 'unchanged'").toBeUndefined();
    expect(after.done, "a miss returns the whole sweep").toBeDefined();
    expect(after.version).not.toBe(before);
  }, 180_000);

  test("a version computed by a different rule is never mistaken for a match", async () => {
    const run = nextWork();
    const current = JSON.parse(await run({})).version;
    // Same digest, different rule in front of it. A caller holding a version from
    // a build that computed it another way must be re-swept, not matched by luck
    // on a truncated hash.
    const crossScheme = current.replace(/^m1:/, "c1:");
    expect(crossScheme).not.toBe(current);
    expect(JSON.parse(await run({ since: crossScheme })).kind).toBeUndefined();
  }, 180_000);
});
