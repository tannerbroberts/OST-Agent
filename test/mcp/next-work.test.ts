import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { defaultGenome } from "../../src/genome/load.js";
import { GenomeSchema } from "../../src/genome/schema.js";
import type { Genome } from "../../src/genome/schema.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-nextwork-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("computeNextWork — mapped detection", () => {
  test("evidence cited as a node's source counts as mapped even without mapped.json (the MCP-driven path)", () => {
    const ctx = buildPassContext(dir);
    writeEvidence(dir, {
      id: "INBOX:note.md",
      source: "INBOX:note.md",
      title: "note",
      timestamp: "2026-07-22T00:00:00Z",
      body: "Players want a daily reason to return.",
    });

    // Before mapping: the evidence is outstanding, and no state file was ever written.
    expect(fs.existsSync(path.join(dir, ".ost-agent", "state", "mapped.json"))).toBe(false);
    const before = computeNextWork(ctx.vault, dir, 3);
    expect(before.unmappedEvidence.map((e) => e.id)).toContain("INBOX:note.md");

    // Map it the way the MCP path does: create an Opportunity whose source is the evidence id.
    // (No mapped.json update — that only happens in the batch P2_map runner.)
    ctx.vault.createNode({
      title: "I want a reason to come back",
      layer: "Opportunity",
      source: "INBOX:note.md",
      body: "b",
      tags: [],
      links: [],
    });
    ctx.vault.linkNodes("Retention", "I want a reason to come back");

    const after = computeNextWork(buildPassContext(dir).vault, dir, 3);
    expect(after.unmappedEvidence).toHaveLength(0);
  });
});

describe("computeNextWork — wrapped wikilinks", () => {
  /**
   * The defect this covers is one the agent itself causes: a node title long
   * enough to cross a column boundary in a hard-wrapped paragraph. It is
   * invisible to the dangling-link detector, because a split `[[…]]` never
   * becomes a link, so there is nothing dangling to find.
   */
  test("surfaces a link a wrapped paragraph split in two, and names the title the author meant", () => {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "I want a reason to come back",
      layer: "Opportunity",
      body: "This leans on [[Retention\nas a whole]] rather than on any one release.",
      tags: [],
      links: [],
    });
    ctx.vault.linkNodes("Retention", "I want a reason to come back");

    const work = computeNextWork(buildPassContext(dir).vault, dir, 3);
    const wrapped = work.hygieneIssues.filter((i) => i.issue.startsWith("wrapped wikilink"));
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].title).toBe("I want a reason to come back");
    expect(wrapped[0].issue).toContain("[[Retention as a whole]]");
    // Not reported as dangling — the point of the rule.
    expect(work.hygieneIssues.some((i) => i.issue.startsWith("dangling link"))).toBe(false);
  });

  test("a node whose links all sit on their own line raises nothing", () => {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "I want a reason to come back",
      layer: "Opportunity",
      body: "Plain prose that mentions [[Retention]] inline and wraps\nafter the brackets.",
      tags: [],
      links: [],
    });
    ctx.vault.linkNodes("Retention", "I want a reason to come back");

    const work = computeNextWork(buildPassContext(dir).vault, dir, 3);
    expect(work.hygieneIssues.filter((i) => i.issue.startsWith("wrapped wikilink"))).toEqual([]);
  });
});

describe("open unknowns", () => {
  const CONTRACT = "## Format\na count per day\n\n## Rationale\nserves [[Retention]]";

  /** Attach an Unknown under the opportunity `initVault` creates, and return fresh work. */
  function withUnknown(body: string, status?: "validated" | "deferred") {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      body,
      tags: [],
      links: [],
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
    ctx.vault.linkNodes("Retention", "How many users hit the export path");
    return computeNextWork(buildPassContext(dir).vault, dir, 1);
  }

  test("surfaces an open unknown with its class, what it darkens, and its gaps", () => {
    const work = withUnknown(CONTRACT);
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].title).toBe("How many users hit the export path");
    expect(work.openUnknowns[0].klass).toBe("unreached");
    expect(work.openUnknowns[0].darkens).toBe("Retention");
    expect(work.openUnknowns[0].gaps).toEqual(["Methodology"]);
  });

  test("a satisfied unknown is no longer offered as work", () => {
    expect(withUnknown(`${CONTRACT}\n\n## Answer\n412 per day`).openUnknowns).toHaveLength(0);
  });

  test("an abandoned unknown is no longer offered as work", () => {
    expect(withUnknown(CONTRACT, "deferred").openUnknowns).toHaveLength(0);
  });

  test("an open unknown does NOT block done — an unbounded one would wedge the loop forever", () => {
    const work = withUnknown("nothing declared at all");
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].klass).toBe("unbounded");
    // A freshly-initialized vault has no outstanding maintenance at min=1.
    expect(work.unmappedEvidence).toHaveLength(0);
    expect(work.hygieneIssues).toHaveLength(0);
    expect(work.done).toBe(true);
  });

  test("the summary names outstanding darkness even when maintenance is done", () => {
    expect(withUnknown(CONTRACT).summary).toContain("unknown");
  });

  test("an Unknown is never counted as a solution missing assumptions", () => {
    const work = withUnknown(CONTRACT);
    expect(work.solutionsMissingAssumptions.map((s) => s.title))
      .not.toContain("How many users hit the export path");
  });
});

/**
 * The pivot gene is the one allele that can change what `done` MEANS, so its
 * default is tested as an identity rather than as a behaviour: the 4-argument
 * call with the default genome must be indistinguishable from the 3-argument
 * call that every vault without a genome.yaml makes.
 *
 * Ordering assertions never hard-code a title sequence. Tree order is
 * `fs.readdirSync` order over the vault root (src/ost/vault.ts:110), which is
 * filesystem-dependent; each ranking test derives its expectation from the
 * tree-order baseline it just observed, so it tests the ranking rather than the
 * filesystem.
 */
describe("computeNextWork — the pivot gene", () => {
  const BOUNDED = "## Format\na count per day\n\n## Methodology\nquery the export log\n\n## Rationale\nserves [[Retention]]";
  const UNREACHED = "## Format\na count per day\n\n## Rationale\nserves [[Retention]]";
  const UNBOUNDED = "nothing declared at all";

  /** Attach an Unknown under the Outcome `initVault` creates. */
  function addUnknown(title: string, body: string, status?: "validated" | "deferred") {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title,
      layer: "Unknown",
      body,
      tags: [],
      links: [],
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
    ctx.vault.linkNodes("Retention", title);
  }

  /** Fresh read of the work, optionally under a non-default genome. */
  const work = (genome?: Genome) => computeNextWork(buildPassContext(dir).vault, dir, 1, genome);

  /** A genome that differs from the default in the pivot section only. */
  const pivot = (allele: Record<string, unknown>): Genome => GenomeSchema.parse({ pivot: allele });

  test("the default genome never pivots — passing it explicitly is indistinguishable from not passing one", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    const implicit = work();
    const explicit = work(defaultGenome());
    expect(implicit.done).toBe(true);
    expect(explicit).toEqual(implicit);
    expect(explicit.summary).toContain("does not block done");
    expect(explicit.summary).not.toContain("Showing");
  });

  test("unknownsBlockDone makes darkness outstanding — a tree is not maintained while it cannot see", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    const blocked = work(pivot({ unknownsBlockDone: true }));
    expect(blocked.openUnknowns).toHaveLength(1);
    expect(blocked.done).toBe(false);
    expect(blocked.summary).toContain("blocks done");
  });

  test("unknownsBlockDone changes NOTHING once the darkness is resolved — it blocks on open unknowns, not on unknowns", () => {
    addUnknown("How many users hit the export path", `${BOUNDED}\n\n## Answer\n412 per day`);
    const blocked = work(pivot({ unknownsBlockDone: true }));
    expect(blocked.openUnknowns).toHaveLength(0);
    expect(blocked.done).toBe(true);
  });

  test("maxOpenUnknownsSurfaced caps the list AND the summary says what it hid — a silent cap reads as 'that is all the darkness there is'", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNBOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    expect(treeOrder).toHaveLength(3);

    const capped = work(pivot({ maxOpenUnknownsSurfaced: 2 }));
    expect(capped.openUnknowns.map((u) => u.title)).toEqual(treeOrder.slice(0, 2));
    expect(capped.summary).toContain("Showing 2 of 3");
    expect(capped.summary).toContain("1 more");
  });

  test("a cap truncates the list ONLY — done is still computed over every open unknown, never the visible ones", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNBOUNDED);

    const capped = work(pivot({ unknownsBlockDone: true, maxOpenUnknownsSurfaced: 1 }));
    expect(capped.openUnknowns).toHaveLength(1);
    expect(capped.done).toBe(false);
    expect(capped.summary).toContain("3 open unknown(s)");
  });

  test("class-priority orders by the genome's list and puts an unlisted class last", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", UNREACHED);
    addUnknown("Whether the weekly digest is ever opened", BOUNDED);

    const ranked = work(pivot({ ranking: "class-priority", classPriority: ["bounded", "unreached"] }));
    expect(ranked.openUnknowns.map((u) => u.klass)).toEqual(["bounded", "unreached", "unbounded"]);
  });

  test("class-priority is stable within a class — two equally-ranked unknowns keep the order the tree gave them", () => {
    addUnknown("How many users hit the export path", BOUNDED);
    addUnknown("Which cohort abandons at the second step", UNBOUNDED);
    addUnknown("Whether the weekly digest is ever opened", BOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    const boundedInTreeOrder = treeOrder.filter((t) => t !== "Which cohort abandons at the second step");

    const ranked = work(pivot({ ranking: "class-priority", classPriority: ["bounded"] }));
    expect(ranked.openUnknowns.map((u) => u.klass)).toEqual(["bounded", "bounded", "unbounded"]);
    expect(ranked.openUnknowns.slice(0, 2).map((u) => u.title)).toEqual(boundedInTreeOrder);
  });

  test("tree-order is today's order — naming it explicitly reorders nothing", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", BOUNDED);
    addUnknown("Whether the weekly digest is ever opened", UNREACHED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    expect(work(pivot({ ranking: "tree-order" })).openUnknowns.map((u) => u.title)).toEqual(treeOrder);
  });

  test("cost-to-resolve is not implemented here — it lists in tree order and SAYS so rather than pretending it ranked", () => {
    addUnknown("How many users hit the export path", UNBOUNDED);
    addUnknown("Which cohort abandons at the second step", BOUNDED);

    const treeOrder = work().openUnknowns.map((u) => u.title);
    const attempted = work(pivot({ ranking: "cost-to-resolve" }));
    expect(attempted.openUnknowns.map((u) => u.title)).toEqual(treeOrder);
    expect(attempted.summary).toContain("cost-to-resolve");
    expect(attempted.summary).toContain("tree order");
  });
});
