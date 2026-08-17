/**
 * The three operations that walked back append-only, and the one property that
 * makes them safe to hand an unattended pass.
 *
 * `detach`, `editProse` and `mergeNodes` can each remove something, which the
 * vault could not do before. The risk they introduce is not that a node is lost
 * — git holds every one — but that a MEASUREMENT is: a `## Results` block is a
 * human's recorded finding and the permit that clears `gateSolution`, and an
 * `## Instrument Log` line is the red observation that releases a build. An
 * agent that can delete either has the power it was denied when it was refused
 * permission to write one. Authoring a permit and revoking a human's are the
 * same act pointed in opposite directions.
 *
 * So the reserved sections are the subject of most of what follows: they must
 * survive an edit that rewrites everything around them, and survive the deletion
 * of the very file they lived in.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-mutate-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (title: string, layer: OstNode["layer"], body = "Original prose."): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body,
});

describe("detach", () => {
  test("removes the edge and records why in the parent's History", () => {
    vault.createNode(node("Root", "Outcome"));
    vault.createNode(node("A need", "Opportunity"));
    vault.linkNodes("Root", "A need");

    vault.detach("Root", "A need", "re-parented under a bucket");

    const root = vault.read("Root");
    expect(root.links).not.toContain("A need");
    expect(root.body).toContain('unlinked "A need"');
    // Quoted, not linked: a History line naming the node in brackets would be a
    // second wikilink to it (`single-backlink`).
    expect(root.body).not.toContain("[[A need]]");
    expect(root.body).toContain("re-parented under a bucket");
  });

  test("leaves the child's file untouched — unlinking is not deleting", () => {
    vault.createNode(node("Root", "Outcome"));
    vault.createNode(node("A need", "Opportunity", "The need's own prose."));
    vault.linkNodes("Root", "A need");

    vault.detach("Root", "A need", "moving it");

    expect(vault.has("A need")).toBe(true);
    expect(vault.read("A need").body).toContain("The need's own prose.");
  });

  test("refuses an edge that is not there, rather than silently succeeding", () => {
    vault.createNode(node("Root", "Outcome"));
    vault.createNode(node("A need", "Opportunity"));
    expect(() => vault.detach("Root", "A need", "why")).toThrow(/does not link to/);
  });
});

describe("editProse", () => {
  test("replaces the prose", () => {
    vault.createNode(node("A need", "Opportunity", "Stale framing."));
    vault.editProse("A need", "Sharper framing.", "the original conflated two needs");

    const after = vault.read("A need");
    expect(after.body).toContain("Sharper framing.");
    expect(after.body).not.toContain("Stale framing.");
    expect(after.body).toContain("the original conflated two needs");
  });

  test("carries a recorded result through verbatim, though the caller never supplied it", () => {
    // The whole safety argument in one case: the agent hands over prose, and the
    // human's measurement is still there afterwards because it was never the
    // agent's to hand over.
    vault.createNode(node("A need", "Opportunity", "Stale framing."));
    vault.appendUnderSection("A need", "## Results", "- 2026-01-01 supported — five of five said so");

    vault.editProse("A need", "Sharper framing.", "rewrite");

    const after = vault.read("A need");
    expect(after.body).toContain("## Results");
    expect(after.body).toContain("five of five said so");
  });

  test("carries an instrument log through — the build permit outlives a rewrite", () => {
    vault.createNode(node("A test", "AssumptionTest", "Old wording."));
    vault.appendUnderSection("A test", "## Instrument Log", "- 2026-01-01 **red** (exit 1) `npx vitest run x.test.ts`");

    vault.editProse("A test", "New wording.", "clarified the threshold");

    expect(vault.read("A test").body).toContain("**red** (exit 1)");
  });

  test("carries an ordinary ## section across too, not just the reserved ones — the History loss this closes", () => {
    vault.createNode(node("A need", "Opportunity", "Stale framing.\n\n## Provenance\nFirst-party observation."));
    vault.editProse("A need", "Sharper framing.", "rewrite");

    const after = vault.read("A need").body;
    expect(after).toContain("## Provenance");
    expect(after).toContain("First-party observation.");
  });

  test("replaces a section outright when the new prose names it, rather than duplicating it", () => {
    vault.createNode(node("A need", "Opportunity", "Stale.\n\n## Provenance\nOld provenance."));
    vault.editProse("A need", "Fresh.\n\n## Provenance\nNew provenance.", "rewrote provenance too");

    const after = vault.read("A need").body;
    expect(after).toContain("New provenance.");
    expect(after).not.toContain("Old provenance.");
    expect(after.split("\n").filter((l) => l.trim() === "## Provenance")).toHaveLength(1);
  });

  test("still refuses prose that declares a reserved heading", () => {
    vault.createNode(node("A need", "Opportunity"));
    expect(() => vault.editProse("A need", "## Results\n- supported", "sneaking one in")).toThrow(/reserved heading/);
  });

  test("refuses empty prose — an edit is not a delete", () => {
    vault.createNode(node("A need", "Opportunity"));
    expect(() => vault.editProse("A need", "   ", "why")).toThrow(/empty/);
  });
});

describe("mergeNodes", () => {
  const twoDuplicates = (): void => {
    vault.createNode(node("Root", "Outcome"));
    vault.createNode(node("Tools break on my machine", "Opportunity", "First framing."));
    vault.createNode(node("My tools fail locally", "Opportunity", "Second framing."));
    vault.linkNodes("Root", "Tools break on my machine");
    vault.linkNodes("Root", "My tools fail locally");
  };

  test("deletes the loser's file and keeps the survivor", () => {
    twoDuplicates();
    vault.mergeNodes("My tools fail locally", "Tools break on my machine", {
      prose: "One framing covering both.",
      why: "same need, said twice",
    });

    expect(vault.has("My tools fail locally")).toBe(false);
    expect(vault.has("Tools break on my machine")).toBe(true);
    expect(vault.read("Tools break on my machine").body).toContain("One framing covering both.");
  });

  test("carries the loser's recorded result onto the survivor", () => {
    // The case that would otherwise destroy evidence: the duplicate is the one a
    // human happened to test against.
    twoDuplicates();
    vault.appendUnderSection("My tools fail locally", "## Results", "- 2026-01-01 supported — three operators hit it");

    vault.mergeNodes("My tools fail locally", "Tools break on my machine", {
      prose: "One framing.",
      why: "duplicate",
    });

    const survivor = vault.read("Tools break on my machine");
    expect(survivor.body).toContain("three operators hit it");
    expect(survivor.body).toContain("carried 1 reserved section(s) across");
  });

  test("repoints every inbound edge, leaving no dangling link", () => {
    twoDuplicates();
    vault.createNode(node("Another need", "Opportunity"));
    vault.linkNodes("Another need", "My tools fail locally");

    vault.mergeNodes("My tools fail locally", "Tools break on my machine", { prose: "One.", why: "dupe" });

    expect(vault.read("Another need").links).toContain("Tools break on my machine");
    expect(vault.read("Another need").links).not.toContain("My tools fail locally");
    expect(vault.read("Root").links).not.toContain("My tools fail locally");

    const dangling = checkInvariants(vault.readTree()).filter((v) => v.rule === "dangling-link");
    expect(dangling).toEqual([]);
  });

  test("unions the loser's outbound edges onto the survivor, so its children are not orphaned", () => {
    twoDuplicates();
    vault.createNode(node("A way to fix it", "Solution"));
    vault.linkNodes("My tools fail locally", "A way to fix it");

    vault.mergeNodes("My tools fail locally", "Tools break on my machine", { prose: "One.", why: "dupe" });

    expect(vault.read("Tools break on my machine").links).toContain("A way to fix it");
    const orphans = checkInvariants(vault.readTree()).filter((v) => v.rule === "solution-mapped");
    expect(orphans).toEqual([]);
  });

  test("does not leave the survivor linking to the node it absorbed", () => {
    twoDuplicates();
    vault.linkNodes("My tools fail locally", "Tools break on my machine");

    vault.mergeNodes("My tools fail locally", "Tools break on my machine", { prose: "One.", why: "dupe" });

    expect(vault.read("Tools break on my machine").links).not.toContain("Tools break on my machine");
    expect(vault.read("Tools break on my machine").links).not.toContain("My tools fail locally");
  });

  test("refuses to merge a node into itself", () => {
    twoDuplicates();
    expect(() =>
      vault.mergeNodes("My tools fail locally", "My tools fail locally", { prose: "x", why: "y" }),
    ).toThrow(/into itself/);
  });

  test("refuses to merge across layers — a need is not a way to meet it", () => {
    twoDuplicates();
    vault.createNode(node("A way to fix it", "Solution"));
    expect(() =>
      vault.mergeNodes("A way to fix it", "Tools break on my machine", { prose: "x", why: "y" }),
    ).toThrow(/different\s+kinds of claim|Merge is for duplicates within a layer/);
  });

  test("refuses to merge away the Outcome", () => {
    twoDuplicates();
    vault.createNode(node("Second root", "Outcome"));
    expect(() => vault.mergeNodes("Root", "Second root", { prose: "x", why: "y" })).toThrow(/Outcome/);
  });

  test("carrying a result onto a node that had none is refused at the tool surface, not here", () => {
    // The vault layer performs the merge it is told to; the refusal lives beside
    // R6 in security/tools.ts because it is the same judgement — a node may not
    // acquire someone else's evidence in one agent call. Pinned from this side
    // too, so that moving the guard cannot silently drop it: what the WRITER
    // does is carry the section, and that is only safe because something above
    // decides whether the merge happens at all.
    twoDuplicates();
    vault.appendUnderSection("My tools fail locally", "## Results", "- 2026-01-01 supported — a real run");
    vault.mergeNodes("My tools fail locally", "Tools break on my machine", { prose: "One.", why: "dupe" });
    expect(vault.read("Tools break on my machine").body).toContain("a real run");
  });

  test("records the merge in the survivor's History with the reason", () => {
    twoDuplicates();
    vault.mergeNodes("My tools fail locally", "Tools break on my machine", {
      prose: "One.",
      why: "same need, said twice",
    });
    const body = vault.read("Tools break on my machine").body;
    expect(body).toContain('merged "My tools fail locally"');
    expect(body).not.toContain("[[My tools fail locally]]");
    expect(body).toContain("same need, said twice");
  });
});
