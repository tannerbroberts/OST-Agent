import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-vault-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const solution = (): OstNode => ({
  title: "Daily challenge mode",
  layer: "Solution",
  status: "unvalidated",
  tags: ["unvalidated"],
  links: [],
  body: "A seeded daily puzzle.",
});

describe("Vault append-only operations", () => {
  test("createNode writes a parseable node; readTree finds it", () => {
    vault.createNode(solution());
    const tree = vault.readTree();
    expect(tree).toHaveLength(1);
    expect(tree[0].title).toBe("Daily challenge mode");
    expect(tree[0].layer).toBe("Solution");
  });

  test("createNode refuses to overwrite an existing node", () => {
    vault.createNode(solution());
    expect(() => vault.createNode(solution())).toThrow(/already exists/);
  });

  test("appendToNode only grows the file (prior bytes stay a prefix)", () => {
    vault.createNode(solution());
    const p = path.join(dir, "Daily challenge mode.md");
    const before = fs.readFileSync(p, "utf8");
    vault.appendToNode("Daily challenge mode", "## Notes\n- extra context");
    const after = fs.readFileSync(p, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain("extra context");
  });

  test("linkNodes adds a wikilink once; a second call is a no-op", () => {
    vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b" });
    vault.createNode(solution());
    vault.linkNodes("Opp", "Daily challenge mode");
    vault.linkNodes("Opp", "Daily challenge mode");
    const opp = vault.read("Opp");
    expect(opp.links).toEqual(["Daily challenge mode"]);
  });

  test("setStatus updates frontmatter and preserves the prior status in History", () => {
    vault.createNode(solution());
    vault.setStatus("Daily challenge mode", "validated", "human confirmed");
    const p = path.join(dir, "Daily challenge mode.md");
    const raw = fs.readFileSync(p, "utf8");
    const node = vault.read("Daily challenge mode");
    expect(node.status).toBe("validated");
    expect(raw).toContain("## History");
    expect(raw).toContain("unvalidated → validated");
    expect(raw).toContain("human confirmed");
  });

  test("annotate adds an Issues section without deleting anything", () => {
    vault.createNode(solution());
    const p = path.join(dir, "Daily challenge mode.md");
    const before = fs.readFileSync(p, "utf8");
    vault.annotate("Daily challenge mode", "orphan: not linked to any opportunity");
    const after = fs.readFileSync(p, "utf8");
    expect(after).toContain("## Issues");
    expect(after).toContain("orphan: not linked");
    expect(after).toContain(before.split("---\n")[1]); // frontmatter preserved
  });

  test("operations never reduce the file count", () => {
    vault.createNode(solution());
    vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b" });
    const count1 = fs.readdirSync(dir).length;
    vault.appendToNode("Daily challenge mode", "more");
    vault.setStatus("Daily challenge mode", "deferred");
    vault.annotate("Opp", "check");
    const count2 = fs.readdirSync(dir).length;
    expect(count2).toBe(count1);
  });

  test("a traversal title cannot escape the vault root", () => {
    expect(() =>
      vault.createNode({ title: "../escape", layer: "Solution", tags: [], links: [], body: "x" }),
    ).not.toThrow(); // sanitized to a safe in-root name
    // the sanitized file lives inside the vault, nowhere else
    const outside = path.resolve(dir, "..", "escape.md");
    expect(fs.existsSync(outside)).toBe(false);
  });

  test("linkNodes stores the sanitized child title so the wikilink resolves (no dangling link)", () => {
    vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: [], body: "b" });
    // a child whose title contains a character the filename sanitizer strips (colon)
    vault.createNode({ title: "Reason: come back daily", layer: "Solution", tags: [], links: [], body: "b" });
    vault.linkNodes("Opp", "Reason: come back daily");

    // the child's canonical title is its sanitized filename (colon stripped)
    expect(vault.has("Reason come back daily")).toBe(true);
    const opp = vault.read("Opp");
    // the stored link must be that resolvable title, not the raw colon form that dangles
    expect(opp.links).toEqual(["Reason come back daily"]);
    // idempotency holds even when the caller passes the raw (unsanitized) title again
    vault.linkNodes("Opp", "Reason: come back daily");
    expect(vault.read("Opp").links).toEqual(["Reason come back daily"]);
  });
});
