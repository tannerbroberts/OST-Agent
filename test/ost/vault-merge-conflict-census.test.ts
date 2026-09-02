/**
 * "Merge two real vaults as a dry run and count the conflicts a person has to
 * settle" — the assumption test under "Instances federate by exchanging trees
 * with each other, with no centre at all".
 *
 * The claim on trial is that peer exchange is cheap IN PRACTICE. Raw conflict
 * count does not answer that: a merge with two hundred collisions a rule
 * resolves is cheap, and a merge with six that each need a ruling is not. The
 * bar the node fixed is **at most 5 conflicts require human judgement**, and
 * this file holds the census to it.
 *
 * ## Where the fixture's shape comes from
 *
 * There is exactly ONE real vault on the machine this was built on, so "two real
 * vaults" was not available and the honest substitute is one vault against its
 * own past: this repository's tree at `HEAD`, and the same tree at an earlier
 * commit, each re-rooted as an independent git repository so the merge has no
 * common ancestor — which is what a peer exchange is. Measured on 2026-08-22
 * with {@link censusPeerMerge}, the counts came out:
 *
 * | peer is N commits behind | conflicts | settled by rule | needs a person |
 * | ---: | ---: | ---: | ---: |
 * |  25 |  26 |  17 |  1 |
 * | 100 |  55 |  44 |  3 |
 * | 300 | 105 |  87 | 10 |
 * | 600 | 131 | 118 |  7 |
 * | a 3-week-old branch tip | 222 | 207 | 10 |
 *
 * Two things follow and both are load-bearing here. **The bar holds for a
 * frequent exchange and breaks for a rare one** — the judgement count crosses 5
 * somewhere between 100 and 300 commits of divergence, roughly two days at this
 * vault's rate. And **the dominant collision is not disagreement at all**: at
 * the widest pair, 39 of the 52 conflicts no other rule could settle differed
 * only in whether a cited node title was written `[[Title]]` or `"Title"`, a
 * dialect this project's own tree changed mid-life. A two-character diff in an
 * eight-thousand-character body.
 *
 * So the fixture below reproduces ONE exchange at the frequency the bar holds
 * at — about sixty colliding nodes carrying the measured mix of divergences —
 * rather than a worst case. Green here says the mechanism works on a routine
 * exchange between two vaults sharing an author, a schema and a naming style,
 * which is the easiest input that exists; it does not say a rare exchange is
 * cheap, and the table above says it is not.
 *
 * ## Why a green census cannot be reached by loosening a rule
 *
 * A classifier that settled everything would pass the census and be worthless,
 * so the census is not alone in this file. Three of the sixty colliding nodes
 * are things the two operators genuinely disagree about — a promotion, a
 * rewritten body, two different bars for the same test — and the census test
 * names all three and demands the census name them back. Measured, they are the
 * ONLY three it names: the number the bar is met with is 3, not 0. `no rule
 * swallows a real disagreement` plants ten more, one per shape, and `every
 * settlement is lossless` demands each resolution still carry every ledger
 * entry, tag and edge both sides wrote. A rule widened far enough to shrink the
 * census breaks one of those three long before it reaches five.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { censusPeerMerge, settleNodeCollision, type MergeCensus } from "../../src/ost/vault-merge.js";

/** The bar the assumption test fixed. */
const JUDGEMENT_BAR = 5;

/**
 * How long one exchange may take before vitest abandons it.
 *
 * Stated here rather than left at the framework's 20s default, and it is not a
 * bar: the bar in this file is {@link JUDGEMENT_BAR}, and nothing here measures
 * time. The default was acting as an unrecorded wall-clock limit that these
 * tests — 8–12 s each on an idle machine, a full git merge over sixty colliding
 * files — crossed whenever the machine was busy, on `main`, three times now
 * (2026-08-22, 2026-08-28, 2026-09-02). Twice that was repaired by making the
 * exchange cheaper, which is the right repair and has run out of room; this
 * says out loud what the file was silently being held to.
 */
const EXCHANGE_TIMEOUT_MS = 90_000;

/** Stamped on the `## History` lines a rule writes — never read from the clock. */
const AT = "2026-08-22";

let temps: string[];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/**
 * Directories the SHARED exchange owns, torn down once when the file is done.
 *
 * Separate from {@link temps}, and the separation is the repair for a failure
 * that cost four tests at once on `main` on 2026-09-02. {@link baselineCensus}
 * memoises a promise across tests; its directories came from `tempDir`, so they
 * belonged to whichever test happened to call it first. When that test timed
 * out, vitest abandoned the await and ran `afterEach` — which deleted the
 * vaults the merge was still reading. The promise then resolved against a
 * half-removed scratch and every later test awaited that answer.
 *
 * The damage was not the failure, it was the NUMBER: the poisoned census
 * reported **7** conflicts needing human judgement over a fixture built to
 * produce exactly 3, so a bar of 5 was breached by a census that had lost its
 * subject rather than by a merge that was expensive. A sweep that cannot read
 * its subject must not report a result, and this one reported a worse one.
 */
const sharedTemps: string[] = [];

function sharedTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  sharedTemps.push(dir);
  return dir;
}

beforeEach(() => {
  temps = [];
});

afterEach(() => {
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
});

afterAll(() => {
  for (const d of sharedTemps) fs.rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixture vaults
// ---------------------------------------------------------------------------

/** Mulberry32, written out so the fixture cannot drift with a dependency upgrade. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FixtureNode {
  title: string;
  layer: "Opportunity" | "Solution" | "AssumptionTest";
  status: string;
  created: string;
  source: string;
  evidence: string;
  links: string[];
  prose: string[];
  history: string[];
  extra?: Record<string, string>;
}

function render(n: FixtureNode): string {
  const front = [
    "---",
    `type: ${n.layer}`,
    `status: ${n.status}`,
    `created: '${n.created}'`,
    `source: ${n.source}`,
    `evidence: ${n.evidence}`,
    ...Object.entries(n.extra ?? {}).map(([k, v]) => `${k}: ${v}`),
    "---",
  ];
  const parts = [
    front.join("\n"),
    `#${n.layer} #${n.status} #evidence/${n.evidence}`,
    ...n.links.map((l) => `[[${l}]]`),
    "",
    n.prose.join("\n\n"),
    "",
    "## History",
    ...n.history,
  ];
  return `${parts.join("\n")}\n`;
}

const LAYERS = ["Opportunity", "Solution", "AssumptionTest"] as const;

/**
 * The tree both peers start from — the copy each of them was given before they
 * went their separate ways. 200 nodes, so the merge has a real denominator and
 * the untouched majority exercises the clean path.
 */
function seedTree(): FixtureNode[] {
  const rnd = seededRandom(11);
  const nodes: FixtureNode[] = [];
  for (let i = 0; i < 200; i++) {
    const layer = LAYERS[i % LAYERS.length];
    nodes.push({
      title: `Shared node ${i}`,
      layer,
      status: "unvalidated",
      created: "2026-07-01",
      source: `INBOX:seed-${i}.md`,
      evidence: "assertion",
      links: [`Shared node ${(i * 7 + 3) % 200}`],
      prose: [
        `The ${layer.toLowerCase()} this node states, written once and copied to both peers.`,
        `It cites [[Shared node ${(i * 13 + 5) % 200}]] because the argument depends on it.`,
        `Detail ${Math.floor(rnd() * 1000)} that neither side has cause to rewrite.`,
      ],
      history: [`- 2026-07-01 created — seeded into the shared tree`],
    });
  }
  return nodes;
}

async function writeVault(dir: string, nodes: FixtureNode[], extraFiles: Record<string, string> = {}): Promise<void> {
  for (const n of nodes) fs.writeFileSync(path.join(dir, `${n.title}.md`), render(n));
  for (const [rel, body] of Object.entries(extraFiles)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  const g = simpleGit(dir);
  await g.init();
  await g.addConfig("user.email", "peer@localhost");
  await g.addConfig("user.name", "Peer");
  await g.add(["-A"]);
  await g.commit("vault");
}

function clone(nodes: FixtureNode[]): FixtureNode[] {
  return nodes.map((n) => ({ ...n, links: [...n.links], prose: [...n.prose], history: [...n.history] }));
}

/** Rewrite every inline `[[Title]]` as `"Title"` — the older dialect this tree used. */
function oldDialect(prose: string[]): string[] {
  return prose.map((p) => p.replace(/\[\[([^[\]\n]+)\]\]/g, (_m, t: string) => `"${t}"`));
}

/**
 * Two peers who each did an ordinary stretch of work on their own copy.
 *
 * The divergences and their rates are the ones the real measurement found (see
 * the file header): both sides append to `## History`, both add child edges,
 * one side writes more prose into a body, one side is on the older citation
 * dialect, and one side fills a field the other left blank. Sixty nodes are
 * touched — the size of one exchange at the frequency the bar holds at.
 *
 * **Three of the sixty are genuine disagreements, and that rate is measured
 * too.** At the real 100-commit pair, 3 of 52 in-scope collisions needed a
 * person, and they were the same two shapes: one side had promoted a node the
 * other still called unvalidated, and one side had rewritten a body. A fixture
 * without them would meet the bar by having nothing to count, so the census
 * test also demands that all three come back NAMED — the bar is met from above
 * and the disagreements are pinned from below.
 */
const CONTESTED = ["Shared node 4", "Shared node 21", "Shared node 47"] as const;

function diverge(seed: FixtureNode[]): { local: FixtureNode[]; peer: FixtureNode[] } {
  const local = clone(seed);
  const peer = clone(seed);
  const rnd = seededRandom(29);

  for (let i = 0; i < 60; i++) {
    const l = local[i];
    const p = peer[i];
    const roll = rnd();

    // Both sides keep working the node's own ledger.
    l.history.push(`- 2026-08-10 status note from the local operator on node ${i}`);
    if (roll < 0.6) p.history.push(`- 2026-08-11 the peer's own note on node ${i}`);

    // Both sides re-parent or add edges. Edges are a set, and a set has a union.
    if (roll < 0.5) l.links.push(`Shared node ${(i * 3 + 11) % 200}`);
    if (roll > 0.3) p.links.push(`Shared node ${(i * 5 + 17) % 200}`);

    // The peer is on the older inline-citation dialect for a third of them.
    if (i % 3 === 0) p.prose = oldDialect(p.prose);

    // The local side wrote more into a body the peer left as it was.
    if (roll < 0.35) l.prose.push(`A paragraph the local operator added on ${i}, citing [[Shared node ${i}]].`);

    // One side filled a field the other never got to.
    if (i % 7 === 0) l.extra = { ...l.extra, lane: "compute-only" };
    if (i % 11 === 0) p.extra = { ...p.extra, threshold: "at least three of five" };
  }

  // The three the two operators actually disagree about.
  local[4].status = "shipped";
  peer[4].status = "unvalidated";
  local[21].prose = ["The local operator's account of what this node claims, rewritten from scratch."];
  peer[21].prose = ["The peer's account of the same node, which shares no sentence with it."];
  local[47].extra = { ...local[47].extra, threshold: "at least eight of ten" };
  peer[47].extra = { ...peer[47].extra, threshold: "at least two of ten" };

  return { local, peer };
}

/**
 * `mkdir` is injected so a census whose result OUTLIVES the test that asked for
 * it can own directories the per-test teardown will not remove — see
 * {@link sharedTemps}. A private census keeps the default and is cleaned up with
 * the test that ran it.
 */
async function runCensus(
  local: FixtureNode[],
  peer: FixtureNode[],
  extra?: Record<string, string>,
  mkdir: (prefix: string) => string = tempDir,
): Promise<MergeCensus> {
  const localDir = mkdir("ost-vm-local-");
  const peerDir = mkdir("ost-vm-peer-");
  const scratch = mkdir("ost-vm-scratch-");
  await writeVault(localDir, local, extra);
  await writeVault(peerDir, peer, extra);
  return censusPeerMerge({ localDir, peerDir, scratchDir: scratch, at: AT, peerLabel: "peer" });
}

/**
 * The plain exchange over the standard fixture, run once for the whole file.
 *
 * `seedTree`/`diverge` are deterministic and `censusPeerMerge` writes to neither
 * vault, so a second identical exchange costs a full git merge over fifty-odd
 * conflicting files and returns the same object. Two tests wanted it, and the
 * second was paying for it: "state the exchange does not carry…" ran this AND its
 * own exchange, which made it the heaviest test in the heaviest file in the suite
 * and the one that crossed the 20s cap under parallel load (6.3s idle, timing out
 * at 20s beside 294 other files — twice on 2026-08-22, and a sibling in this same
 * file on the run before). Sharing the result is the repair that costs no
 * assertion; nothing here mutates what it returns.
 *
 * **Three callers now, because fixing two of them left the third holding the
 * problem.** "which side ran the exchange…" ran two private exchanges and became
 * the heaviest test in turn — 6.3s idle, timing out at 20s in a full run on
 * `main` on 2026-08-28. Its forward direction is this exchange, so it takes it
 * from here and pays only for the reversed one. The general lesson, since this is
 * twice: an exchange written privately in a test in THIS file is a 3s bill and a
 * share of the cap, and the default should be to reach for this function.
 *
 * A caller must not sort what it returns in place. `Array.sort` mutates, the
 * object is shared, and a reordered field is the one way this optimisation could
 * change another test's meaning.
 */
let plainExchange: Promise<MergeCensus> | undefined;
function baselineCensus(): Promise<MergeCensus> {
  const { local, peer } = diverge(seedTree());
  // `sharedTempDir`, never `tempDir`: this promise is awaited by four tests, so
  // its vaults must survive the teardown of whichever one reached it first.
  plainExchange ??= runCensus(local, peer, undefined, sharedTempDir);
  return plainExchange;
}

// ---------------------------------------------------------------------------

describe("peer exchange — counting the conflicts a person has to settle", () => {
  test("an ordinary exchange leaves at most five conflicts needing human judgement", async () => {
    const census = await baselineCensus();

    // The census has to have had work to do. A merge that conflicted on nothing
    // would pass the bar by measuring nothing, which is the failure mode this
    // whole tree calls "a sweep that cannot read its subject reports a clean
    // result".
    expect(census.conflicted.length).toBeGreaterThanOrEqual(50);

    const named = census.judgement.map((j) => `${j.file} [${j.reasons.join(",")}] ${j.detail.join("; ")}`);
    expect(census.judgement.length, `needs a person:\n${named.join("\n")}`).toBeLessThanOrEqual(JUDGEMENT_BAR);

    // ...and the three the operators really do disagree about are all there. A
    // classifier that reached the bar by settling a disagreement fails here
    // rather than passing quietly, which is the only reason the number above is
    // worth anything.
    for (const title of CONTESTED) {
      expect(census.judgement.map((j) => j.file), `settled a real disagreement:\n${named.join("\n")}`).toContain(
        `${title}.md`,
      );
    }

    // And every conflict is accounted for in exactly one bucket.
    expect(census.settled.length + census.judgement.length + census.outOfScope.length).toBe(
      census.conflicted.length,
    );
  }, EXCHANGE_TIMEOUT_MS);

  test("the exchange never writes to either vault", async () => {
    const { local, peer } = diverge(seedTree());
    const localDir = tempDir("ost-vm-local-");
    const peerDir = tempDir("ost-vm-peer-");
    const scratch = tempDir("ost-vm-scratch-");
    await writeVault(localDir, local);
    await writeVault(peerDir, peer);

    const before = await Promise.all(
      [localDir, peerDir].map(async (d) => ({
        head: (await simpleGit(d).revparse(["HEAD"])).trim(),
        status: (await simpleGit(d).status()).files.length,
        files: fs.readdirSync(d).sort().join(","),
      })),
    );
    await censusPeerMerge({ localDir, peerDir, scratchDir: scratch, at: AT });
    const after = await Promise.all(
      [localDir, peerDir].map(async (d) => ({
        head: (await simpleGit(d).revparse(["HEAD"])).trim(),
        status: (await simpleGit(d).status()).files.length,
        files: fs.readdirSync(d).sort().join(","),
      })),
    );
    expect(after).toEqual(before);
  }, EXCHANGE_TIMEOUT_MS);

  test("which side ran the exchange does not change the partition", async () => {
    const { local, peer } = diverge(seedTree());
    // The forward direction IS the plain exchange, so it is the shared one — the
    // same repair `baselineCensus` above was written for, applied to the test that
    // inherited the problem when its sibling gave it up. This ran two full
    // exchanges (four `git init`s over sixty files, two scratch merges over fifty
    // conflicts) and was the file's most expensive test at 6.3s idle; beside 308
    // other files it crossed the 20s cap and timed out, on `main` as well as on
    // the branch that found it. Only the REVERSED direction is unique to this
    // test, and only it is still paid for. No assertion changes: `censusPeerMerge`
    // writes to neither vault and the fixture is deterministic, so the shared
    // result is the same object the private call built.
    const ours = await baselineCensus();
    const theirs = await runCensus(peer, local);

    // Copied before sorting, because `ours` is now shared and `Array.sort` is in
    // place: sorting it here would reorder a field another test reads.
    expect([...theirs.conflicted].sort()).toEqual([...ours.conflicted].sort());
    expect(theirs.judgement.map((j) => j.file).sort()).toEqual(ours.judgement.map((j) => j.file).sort());
    expect(theirs.settled.map((s) => s.file).sort()).toEqual(ours.settled.map((s) => s.file).sort());
  }, EXCHANGE_TIMEOUT_MS);

  test("state the exchange does not carry is counted and named, never silently dropped", async () => {
    const { local, peer } = diverge(seedTree());
    const census = await baselineCensus();

    const localDir = tempDir("ost-vm-local2-");
    const peerDir = tempDir("ost-vm-peer2-");
    const scratch = tempDir("ost-vm-scratch2-");
    await writeVault(localDir, local, { ".ost-agent/state/usage.json": '{"runs":1}\n' });
    await writeVault(peerDir, peer, { ".ost-agent/state/usage.json": '{"runs":9}\n' });
    const withState = await censusPeerMerge({ localDir, peerDir, scratchDir: scratch, at: AT });

    expect(withState.outOfScope.map((o) => o.file)).toContain(".ost-agent/state/usage.json");
    // It is a conflict, and it is reported as one — just not as a settled one.
    expect(withState.conflicted).toContain(".ost-agent/state/usage.json");
    expect(withState.judgement.length).toBe(census.judgement.length);
  }, EXCHANGE_TIMEOUT_MS);
});

describe("no rule swallows a real disagreement", () => {
  const base: FixtureNode = {
    title: "Contested node",
    layer: "AssumptionTest",
    status: "unvalidated",
    created: "2026-07-01",
    source: "INBOX:seed.md",
    evidence: "assertion",
    links: ["Parent"],
    prose: ["The claim under test, as both peers received it."],
    history: ["- 2026-07-01 created"],
    // Both peers received the bar, the command and the lane already filled in.
    // A field only ONE side ever set is a different case — nothing is lost by
    // adopting it — and it is settled by rule on purpose.
    extra: {
      threshold: "at least three of five",
      instrument: "npx vitest run test/contested.test.ts",
      lane: "compute-only",
    },
  };

  /** Each case is one thing two operators can genuinely disagree about. */
  const CASES: [string, (n: FixtureNode) => void, string][] = [
    ["a verdict", (n) => void (n.status = "shipped"), "status-diverged"],
    ["what kind of node it is", (n) => void (n.layer = "Solution"), "layer-diverged"],
    ["the pre-committed bar", (n) => void (n.extra!.threshold = "at least nine of ten"), "threshold-diverged"],
    [
      "the command that answers it",
      (n) => void (n.extra!.instrument = "npx vitest run test/other.test.ts"),
      "instrument-diverged",
    ],
    ["what it costs to run", (n) => void (n.extra!.lane = "one-command"), "lane-diverged"],
    ["the argument itself", (n) => void (n.prose = ["A completely different account of the same claim."]), "prose-diverged"],
  ];

  for (const [what, mutate, reason] of CASES) {
    test(`two peers disagreeing about ${what} needs a person`, () => {
      const ours = { ...base, extra: { ...base.extra } };
      const theirs = { ...base, extra: { ...base.extra }, prose: [...base.prose], links: [...base.links] };
      mutate(theirs);
      const verdict = settleNodeCollision(base.title, render(ours), render(theirs), { at: AT });
      expect(verdict.settleable).toBe(false);
      if (verdict.settleable) return;
      expect(verdict.reasons).toContain(reason);
    });
  }

  test("a retraction on one side only is never unioned away", () => {
    const ours = render(base);
    const theirs = `${render(base)}\n## Retraction\n- 2026-08-01 superseded by a better statement\n`;
    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT });
    expect(verdict.settleable).toBe(false);
    if (!verdict.settleable) expect(verdict.reasons).toContain("retraction-diverged");
  });

  test("frontmatter this schema does not know about is never guessed at", () => {
    const ours = render({ ...base, extra: { owner: "ana" } });
    const theirs = render({ ...base, extra: { owner: "sam" } });
    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT });
    expect(verdict.settleable).toBe(false);
    if (!verdict.settleable) expect(verdict.reasons).toContain("unknown-field-diverged");
  });

  test("a file that is not a node is not settled by a node rule", async () => {
    const { local, peer } = diverge(seedTree());
    const localDir = tempDir("ost-vm-local3-");
    const peerDir = tempDir("ost-vm-peer3-");
    const scratch = tempDir("ost-vm-scratch3-");
    await writeVault(localDir, local, { "ost.config.yaml": "outcome: ours\n" });
    await writeVault(peerDir, peer, { "ost.config.yaml": "outcome: theirs\n" });
    const census = await censusPeerMerge({ localDir, peerDir, scratchDir: scratch, at: AT });
    const call = census.judgement.find((j) => j.file === "ost.config.yaml");
    expect(call?.reasons).toEqual(["not-a-node"]);
  }, EXCHANGE_TIMEOUT_MS);

  test("prose that only looks the same is not treated as the same", () => {
    // Same length, same shape, one word changed. The citation rule normalises
    // sigils and nothing else, and this is the case that proves it.
    const ours = render({ ...base, prose: ["The gate refuses a stale bundle."] });
    const theirs = render({ ...base, prose: ["The gate accepts a stale bundle."] });
    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT });
    expect(verdict.settleable).toBe(false);
    if (!verdict.settleable) expect(verdict.reasons).toContain("prose-diverged");
  });
});

describe("every settlement is lossless, and is a node rather than a claim", () => {
  const base: FixtureNode = {
    title: "Agreed node",
    layer: "Solution",
    status: "unvalidated",
    created: "2026-07-01",
    source: "INBOX:seed.md",
    evidence: "assertion",
    links: ["Parent"],
    prose: ["The shared account, citing [[Another node]]."],
    history: ["- 2026-07-01 created"],
  };

  test("a settled node keeps every ledger entry, tag and edge from both sides", () => {
    const ours = render({
      ...base,
      links: ["Parent", "Local child"],
      history: ["- 2026-07-01 created", "- 2026-08-10 the local operator's note"],
    });
    const theirs = render({
      ...base,
      links: ["Parent", "Peer child"],
      prose: oldDialect(base.prose),
      history: ["- 2026-07-01 created", "- 2026-08-11 the peer's note"],
    });

    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT, peerLabel: "peer" });
    expect(verdict.settleable).toBe(true);
    if (!verdict.settleable) return;

    const merged = verdict.resolved;
    expect(merged.links).toEqual(expect.arrayContaining(["Parent", "Local child", "Peer child"]));
    expect(merged.body).toContain("the local operator's note");
    expect(merged.body).toContain("the peer's note");
    // The shared entry is carried once, not twice, even across dialects.
    expect(merged.body.match(/created — |2026-07-01 created/g)?.length ?? 0).toBe(1);
  });

  test("a rule that drops a value writes down what it dropped", () => {
    const ours = render({ ...base, evidence: "observed", created: "2026-07-01", source: "JIRA:PROJ-1" });
    const theirs = render({ ...base, evidence: "assertion", created: "2026-06-01", source: "INBOX:hunch.md" });

    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT, peerLabel: "peer" });
    expect(verdict.settleable).toBe(true);
    if (!verdict.settleable) return;

    const merged = verdict.resolved;
    // A conclusion is only as believable as its weakest input, and the node
    // exists from when the first peer wrote it.
    expect(merged.evidence).toBe("assertion");
    expect(merged.created).toBe("2026-06-01");
    expect(merged.source).toBe("INBOX:hunch.md");
    // Everything not adopted is in the History rather than gone.
    expect(merged.body).toContain("evidence observed / assertion");
    expect(merged.body).toContain("JIRA:PROJ-1");
    expect(merged.body).toContain("2026-07-01");
  });

  test("every settlement in a whole exchange is a usable node, named by the rules that made it", async () => {
    const { local, peer } = diverge(seedTree());
    const census = await runCensus(local, peer);
    expect(census.settled.length).toBeGreaterThan(0);
    for (const s of census.settled) {
      const where = `${s.file}: ${s.rules.join(",")}`;
      // A settlement nobody can name is a resolution nobody can review.
      expect(s.rules.length, where).toBeGreaterThan(0);
      // The node has to be one the rest of the codebase would accept: a real
      // layer, its own title, and a body that still declares its ledger.
      expect(s.resolved.title, where).toBe(path.basename(s.file, ".md"));
      expect(LAYERS, where).toContain(s.resolved.layer);
      expect(s.resolved.body, where).toContain("## History");
      expect(new Set(s.resolved.links).size, where).toBe(s.resolved.links.length);
    }
  }, EXCHANGE_TIMEOUT_MS);

  test("two files that differ only in bytes are settled under a name of their own", () => {
    // Found on the real pairs, not imagined: two versions of the vault writer
    // emit the same frontmatter keys in a different order, so 17 of 44 settled
    // collisions differed in nothing this schema reads. An empty rule list would
    // have reported them as settled by nobody.
    const ours = render({ ...base });
    const theirs = ours.replace(/^source: (.*)\nevidence: (.*)$/m, "evidence: $2\nsource: $1");
    expect(theirs).not.toBe(ours);
    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT });
    expect(verdict.settleable).toBe(true);
    if (!verdict.settleable) return;
    expect(verdict.rules).toEqual(["identical-after-parsing"]);
  });

  test("nothing this module produces is a node file — only Vault renders one", () => {
    // The complement of `test/ost/serialize-single-writer.test.ts` from this
    // side: a settlement is a node, not bytes, so no caller can be tempted to
    // write it out without going through the vault's guards.
    const ours = render({ ...base, links: ["Parent", "Local child"], history: ["- 2026-08-10 ours"] });
    const theirs = render({ ...base, links: ["Parent", "Peer child"], history: ["- 2026-08-11 theirs"] });
    const verdict = settleNodeCollision(base.title, ours, theirs, { at: AT });
    expect(verdict.settleable).toBe(true);
    if (!verdict.settleable) return;
    expect(typeof verdict.resolved).toBe("object");
    expect(verdict.resolved.title).toBe(base.title);
    expect(verdict.extraFrontmatter).toEqual({});
  });
});
