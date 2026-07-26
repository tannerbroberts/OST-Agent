import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { computeNextWork } from "../../src/mcp/next-work.js";

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
