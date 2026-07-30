import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { serialize } from "../../src/ost/node.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import { recordAttention } from "../../src/telemetry/attention.js";

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
   * Written straight to disk rather than through `createNode`, which now refuses a
   * wrapped link at the write boundary (R1). That refusal closes the tool surface, not
   * the vault: a human editing in Obsidian, an import, or a node that predates the
   * guard can all still put one on disk — so the detector has to keep finding them, and
   * the only honest fixture is one the vault did not author.
   */
  function writeNodeFile(node: Parameters<typeof serialize>[0]): void {
    fs.writeFileSync(path.join(dir, fileNameForTitle(node.title)), serialize(node), "utf8");
  }

  /**
   * The defect this covers is one the agent itself causes: a node title long
   * enough to cross a column boundary in a hard-wrapped paragraph. It is
   * invisible to the dangling-link detector, because a split `[[…]]` never
   * becomes a link, so there is nothing dangling to find.
   */
  test("surfaces a link a wrapped paragraph split in two, and names the title the author meant", () => {
    const ctx = buildPassContext(dir);
    writeNodeFile({
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

  test("an ## Answer recording an absence is still work, and STILL does not block done", () => {
    const work = withUnknown(`${CONTRACT}\n\n## Answer\nn/a`);
    expect(work.openUnknowns).toHaveLength(1);
    // The load-bearing line: openUnknowns is deliberately not a term of `done`,
    // so reclassifying answered unknowns as open can never wedge a pass.
    expect(work.done).toBe(true);
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

describe("hygiene suppression is structural, not textual", () => {
  /**
   * `done` is the only gate the unattended loop reads, and hygiene issues are one of
   * its four terms. Suppression used to be `node.body.includes(issue)` over the whole
   * body — which made every free-text write parameter a `done`-forging primitive: an
   * agent that could not fix an issue could always describe it, and describing it
   * cleared it. The suppressing text now has to be the structural line `ost_annotate`
   * writes, so the only thing that clears a hygiene issue is the tool for clearing one.
   */
  const ISSUE = "dangling link: [[Ghost]] has no node";

  /** `linkNodes` does not check the child exists, so this is how a dangle appears. */
  function withDanglingLink() {
    const ctx = buildPassContext(dir);
    ctx.vault.linkNodes("Retention", "Ghost");
    return ctx;
  }
  const dangling = () =>
    computeNextWork(buildPassContext(dir).vault, dir, 1).hygieneIssues.filter(
      (i) => i.issue === ISSUE,
    );

  test("the issue is surfaced to begin with", () => {
    withDanglingLink();
    expect(dangling()).toHaveLength(1);
  });

  test("prose quoting the issue verbatim does NOT clear it", () => {
    const ctx = withDanglingLink();
    ctx.vault.appendToNode("Retention", `We looked into this: "${ISSUE}", and it is expected.`);
    expect(dangling()).toHaveLength(1);
  });

  test("a real annotation DOES clear it — idempotency still holds", () => {
    const ctx = withDanglingLink();
    ctx.vault.annotate("Retention", ISSUE);
    expect(dangling()).toEqual([]);
  });

  test("an annotation about something else leaves the issue standing", () => {
    const ctx = withDanglingLink();
    ctx.vault.annotate("Retention", "orphan opportunity: not linked under the outcome");
    expect(dangling()).toHaveLength(1);
  });

  test("undated prose parked under ## Issues does not count as an annotation", () => {
    // The section heading alone is not the signal — the dated entry is. Otherwise
    // appending a `## Issues` section of free text would forge `done` just as before.
    const ctx = withDanglingLink();
    ctx.vault.appendToNode("Retention", `## Issues\n${ISSUE}`);
    expect(dangling()).toHaveLength(1);
  });

  test("an annotation dated on an earlier day still suppresses", () => {
    // `ost_annotate` stamps today; a tree read tomorrow must not re-raise everything
    // annotated yesterday, or the sweep never reaches done twice.
    const ctx = withDanglingLink();
    ctx.vault.appendToNode("Retention", `## Issues\n- 2026-01-01 ${ISSUE}`);
    expect(dangling()).toEqual([]);
  });
});
