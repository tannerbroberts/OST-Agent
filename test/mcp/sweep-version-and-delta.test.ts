/**
 * The instrument for "One sweep per pass by contract, and a pass that re-reads
 * must say what changed" — via its assumption test, "Read past re-reads and judge
 * how many caught something the caller did not already know".
 *
 * **What the node asks for, in its own words.** Green means the sweep can say
 * whether anything changed: it carries a version, an unchanged tree returns the
 * same version with an empty delta, and a re-read after a write reports which
 * buckets moved. That is the PRECONDITION for the contract — a sweep that cannot
 * express "nothing changed" gives a caller no reason not to re-ask, so a rule
 * telling it to re-ask less is a rule telling it to be less careful.
 *
 * **What green here does NOT settle, stated because the node states it.** The
 * assumption test's own question is whether the 82 re-reads on the day this was
 * measured caught anything the caller did not already know. That is a person's
 * read of a historical trace and nothing in this file touches it. Green says the
 * contract is expressible and stated; it says nothing about whether the re-reads
 * it would remove were doing real work, and nothing about whether a caller
 * offered `since` will actually use it.
 *
 * **Where the assertions are taken.** Through the real `ost_next_work` tool, not
 * through `computeNextWork` directly, because the contract is a promise to a
 * caller on the MCP surface and the argument (`since`) has to exist there. The
 * one exception is the display-cap case, which needs `listLimit` and reaches the
 * function under it.
 *
 * **Non-vacuity.** Every property here can be passed by a wrong implementation
 * that the others catch. A constant version passes "unchanged" and fails
 * "changed"; a random version passes "changed" and fails "unchanged"; a
 * counts-only version passes both and fails the equal-sized turnover; a version
 * taken over the CAPPED lists passes all three and fails the display-cap case.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { buildOstTools } from "../../src/security/tools.js";
import { computeNextWork, type NextWork } from "../../src/mcp/next-work.js";
import { SWEEP_BUCKETS, parseSweepVersion } from "../../src/ost/sweep-version.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";
import type { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-sweep-version-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The sweep as a caller on the MCP surface actually gets it. */
async function sweep(since?: string): Promise<NextWork> {
  const ctx = buildPassContext(dir);
  const tools = buildOstTools({ vault: ctx.vault, dir, remote: { enabled: false }, passContext: ctx });
  const nextWork = tools.find((t) => t.name === "ost_next_work")!;
  return JSON.parse(await nextWork.run(since === undefined ? {} : { since })) as NextWork;
}

function vault(): Vault {
  return buildPassContext(dir).vault;
}

function opportunity(v: Vault, title: string, parent = OUTCOME): void {
  v.createNode({ title, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(parent, title);
}

function solution(v: Vault, title: string, parent: string): void {
  v.createNode({ title, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(parent, title);
}

function evidence(id: string, body: string): void {
  writeEvidence(dir, { id, source: id, title: id, timestamp: "2026-08-02T00:00:00Z", body }, "inbox");
}

/** Where `writeEvidence` put a record, so a fixture can take one back off disk. */
function evidenceFileFor(id: string): string {
  const evidenceDir = path.join(dir, ".ost-agent", "evidence");
  const file = fs
    .readdirSync(evidenceDir)
    .map((name) => path.join(evidenceDir, name))
    .find((p) => fs.readFileSync(p, "utf8").includes(id));
  if (!file) throw new Error(`no stored evidence file for ${id}`);
  return file;
}

describe("the sweep carries a version", () => {
  test("every response has one, and it is a token this surface can read back", async () => {
    opportunity(vault(), "Checking on progress means digging through files");
    const work = await sweep();

    expect(typeof work.version).toBe("string");
    expect(work.version.length).toBeGreaterThan(0);

    // Readable back into a count per bucket — which is what makes a delta
    // computable with nothing stored server-side.
    const counts = parseSweepVersion(work.version);
    expect(counts).not.toBeNull();
    expect(Object.keys(counts!).sort()).toEqual([...SWEEP_BUCKETS].sort());

    // Non-vacuity: the counts in the token are the sweep's real counts, not zeroes.
    // This opportunity owes three solutions, so one bucket is provably non-empty.
    expect(work.underservedOpportunities.length).toBeGreaterThan(0);
    expect(counts!.underservedOpportunities).toBe(work.underservedOpportunities.length);
  });

  test("a sweep with no `since` says so, rather than reporting nothing moved", async () => {
    const work = await sweep();
    expect(work.delta.state).toBe("not-asked");
    expect(work.delta.since).toBeNull();
    expect(work.delta.moved).toEqual([]);
  });
});

describe("an unchanged tree returns the same version with an empty delta", () => {
  test("re-reading without writing anything costs the caller nothing new", async () => {
    const v = vault();
    opportunity(v, "The pass never says it is done");
    solution(v, "Emit a terminal line naming what remains", "The pass never says it is done");
    evidence("INBOX:one.md", "A pass that never says it is done keeps burning compute.");

    const first = await sweep();
    const second = await sweep(first.version);

    expect(second.version).toBe(first.version);
    expect(second.delta.state).toBe("unchanged");
    expect(second.delta.since).toBe(first.version);
    expect(second.delta.moved).toEqual([]);
    expect(second.delta.changedWithoutCountMoving).toBe(false);
    // The sentence a caller reads when it is not going to read the fields.
    expect(second.summary).toContain("Nothing has changed since the version you presented");

    // Non-vacuity: the tree the two sweeps agreed on is not an empty one.
    expect(first.done).toBe(false);
    expect(first.unmappedEvidence).toHaveLength(1);
  });

  test("a version this surface did not issue is refused, never read as unchanged", async () => {
    opportunity(vault(), "Trust an unmonitored agent enough to walk away");
    const work = await sweep("not-a-version-anybody-issued");

    expect(work.delta.state).toBe("unreadable");
    expect(work.delta.since).toBe("not-a-version-anybody-issued");
    expect(work.delta.moved).toEqual([]);
    // The empty `moved` must not be readable as "nothing moved".
    expect(work.delta.note).toContain("NOTHING was compared");
    // And the sweep itself still came back in full — an unreadable token is not
    // a refusal to answer.
    expect(work.underservedOpportunities.length).toBeGreaterThan(0);
  });
});

describe("a re-read after a write reports which buckets moved and by how much", () => {
  test("the delta names the bucket, the two numbers, and the signed difference", async () => {
    const v = vault();
    opportunity(v, "I have a tree full of unvalidated nodes");
    solution(v, "Rank the tree by what a build would settle", "I have a tree full of unvalidated nodes");

    const before = await sweep();
    const bareBefore = before.solutionsMissingAssumptions.length;
    expect(bareBefore).toBeGreaterThan(0);

    // The write: two more solutions with no assumption test beneath them.
    solution(vault(), "Sort by cheapest instrument first", "I have a tree full of unvalidated nodes");
    solution(vault(), "Sort by which opportunity is least served", "I have a tree full of unvalidated nodes");

    const after = await sweep(before.version);

    expect(after.version).not.toBe(before.version);
    expect(after.delta.state).toBe("changed");
    expect(after.delta.changedWithoutCountMoving).toBe(false);

    const moved = after.delta.moved.find((m) => m.bucket === "solutionsMissingAssumptions");
    expect(moved).toBeDefined();
    expect(moved!.was).toBe(bareBefore);
    expect(moved!.now).toBe(bareBefore + 2);
    expect(moved!.change).toBe(2);

    // Only buckets that actually moved are listed — a delta that named every
    // bucket would be the full re-read it exists to replace.
    expect(after.delta.moved.every((m) => m.change !== 0)).toBe(true);
    expect(after.delta.moved.map((m) => m.bucket)).not.toContain("outstandingAsks");

    // The summary carries it too, for the reader who does not open the fields.
    expect(after.summary).toContain("solutionsMissingAssumptions");
  });

  test("work leaving a bucket is a negative change, not an absent one", async () => {
    const v = vault();
    opportunity(v, "Nothing kills a candidate");
    solution(v, "Retire a candidate when its assumption is refuted", "Nothing kills a candidate");

    const before = await sweep();
    const bareBefore = before.solutionsMissingAssumptions.length;

    // Attach a test beneath the bare solution: it leaves the queue.
    const v2 = vault();
    v2.createNode({
      title: "Refuted candidates are actually refuted, not merely unfashionable",
      layer: "AssumptionTest",
      evidence: "assertion",
      body: "x",
      tags: [],
      links: [],
      instrument: "npx vitest run test/ost/retire.test.ts",
    });
    v2.linkNodes("Retire a candidate when its assumption is refuted", "Refuted candidates are actually refuted, not merely unfashionable");

    const after = await sweep(before.version);
    const moved = after.delta.moved.find((m) => m.bucket === "solutionsMissingAssumptions");
    expect(moved).toBeDefined();
    expect(moved!.was).toBe(bareBefore);
    expect(moved!.now).toBe(bareBefore - 1);
    expect(moved!.change).toBe(-1);
  });
});

describe("the version is exact over the picture, not merely over its size", () => {
  /**
   * The failure a counts-only version would ship, and the reason this file
   * exists rather than a `Object.keys(work).length` check: one item leaves a
   * bucket as another enters it, every count is identical, and a caller told
   * "unchanged" acts on a list whose every member has been replaced.
   */
  test("an equal-sized turnover is `changed`, and says the counts could not show it", async () => {
    opportunity(vault(), "Fresh outside findings never reach the tree");
    evidence("INBOX:first.md", "One record, in the unmapped queue.");

    const before = await sweep();
    expect(before.unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:first.md"]);

    // Swap the record for a different one of the same shape. Done on disk rather
    // than through a tool because no tool deletes — which is precisely why the
    // vault can still reach this state (a human in Obsidian, an import, a
    // channel re-keying its ids) and why the version has to survive it.
    fs.rmSync(evidenceFileFor("INBOX:first.md"));
    evidence("INBOX:second.md", "One record, in the unmapped queue.");

    const after = await sweep(before.version);
    expect(after.unmappedEvidence.map((e) => e.id)).toEqual(["INBOX:second.md"]);

    expect(after.version).not.toBe(before.version);
    expect(after.delta.state).toBe("changed");
    expect(after.delta.moved).toEqual([]);
    expect(after.delta.changedWithoutCountMoving).toBe(true);
    expect(after.delta.note).toContain("no bucket changed SIZE");

    // Non-vacuity: the counts really were identical, so this case would have
    // read as `unchanged` on a version built from counts alone.
    expect(parseSweepVersion(after.version)).toEqual(parseSweepVersion(before.version));
  });

  test("the display cap does not move the version — it is taken over the full sets", () => {
    const v = vault();
    opportunity(v, "The agent has to guess what resources it is working with");
    for (let i = 0; i < 30; i++) {
      solution(v, `Candidate resource probe ${i}`, "The agent has to guess what resources it is working with");
    }

    // Same tree, two different display caps. `truncated` must differ (proving the
    // caps really bit) while the version must not.
    const capped = computeNextWork(vault(), dir, 3, undefined, undefined, undefined, 5);
    const uncapped = computeNextWork(vault(), dir, 3, undefined, undefined, undefined, Infinity);

    expect(capped.solutionsMissingAssumptions.length).toBe(5);
    expect(uncapped.solutionsMissingAssumptions.length).toBe(30);
    expect(capped.truncated.length).toBeGreaterThan(0);
    expect(uncapped.truncated).toEqual([]);

    // Asserted before the equality, or a build with no `version` at all would
    // pass this case on `undefined === undefined` — the one shape of vacuity
    // that survives an equality test.
    expect(parseSweepVersion(capped.version)).not.toBeNull();
    expect(capped.version).toBe(uncapped.version);
  });

  test("a scoped sweep is a different version from the whole-tree sweep it narrows", () => {
    const v = vault();
    opportunity(v, "A sweep that cannot read its subject");
    solution(v, "Declare the subject before the findings", "A sweep that cannot read its subject");
    opportunity(v, "Two release trains picked the same version number");

    const whole = computeNextWork(vault(), dir, 3);
    const scoped = computeNextWork(vault(), dir, 3, undefined, "A sweep that cannot read its subject");

    // Not a formality: a version blind to scope would tell a caller holding the
    // whole-tree answer that a narrower answer to a narrower question was the
    // same picture.
    expect(scoped.version).not.toBe(whole.version);
  });
});

describe("the contract itself, on the surface the pass reads", () => {
  /**
   * The solution is a RULE, and the version/delta above is what makes the rule
   * reasonable to follow. A pass reads `OST_RULESET` (rendered into `SKILL.md`)
   * and the tool's own description; if the expectation is stated in neither, the
   * machinery is built and the contract does not exist.
   */
  test("the ruleset states the one-sweep-per-pass expectation and what a re-read must say", () => {
    const rule = OST_RULESET.agentMust.find((r) => r.includes("Read the sweep ONCE at the start of a pass"));
    expect(rule).toBeDefined();
    // A rule that only says "read it once" is the version of this that was
    // already available and already ignored. It has to name the cheaper form of
    // being careful, or it is asking for less care rather than less cost.
    expect(rule!).toContain("since");
    expect(rule!).toContain("unchanged");
  });

  test("the tool a caller actually holds tells it how to present the version back", async () => {
    const ctx = buildPassContext(dir);
    const tools = buildOstTools({ vault: ctx.vault, dir, remote: { enabled: false }, passContext: ctx });
    const nextWork = tools.find((t) => t.name === "ost_next_work")!;

    expect(nextWork.input_schema.properties).toHaveProperty("since");
    expect(nextWork.description).toContain("since");
    expect(nextWork.description).toContain("version");
  });
});
