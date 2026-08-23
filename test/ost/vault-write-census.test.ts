/**
 * Every node-file write reports its field census — enforced on the file, not on
 * the fifteen call sites that happened to exist when it was written.
 *
 * The census this guards (`lost` / `dropped` on a usage event) is what lets the
 * mechanical trace see a defect that leaves every call green — the 2026-07-24
 * serializer strip, and anything shaped like it. Its detection point is the
 * before/after field comparison at the moment a node file's bytes change, so a
 * write that skips that comparison is not merely unmeasured: it is a hole the
 * census cannot report, since a field nobody watched leaves nothing behind.
 *
 * `Vault` had fifteen `fs.writeFileSync` calls when this was added and it gains
 * one every time a new typed transition does. A census wired into fifteen of them
 * is a census that is wrong at the sixteenth, silently, and forever. So the rule
 * is checked against the source text: inside `src/ost/vault.ts`, the only raw
 * write is the one inside `writeNodeFile` itself.
 *
 * The scan is deliberately crude — a regex over the file — because the property is
 * syntactic and a crude check that runs is worth more than a precise one nobody
 * writes. It fails loudly with the offending lines rather than a bare count, so
 * the next author sees what to change rather than that something is wrong.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { drainNodeWrites } from "../../src/telemetry/usage.js";
import type { OstNode } from "../../src/ost/node.js";

const VAULT_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/ost/vault.ts");

describe("the single write door", () => {
  test("vault.ts contains no raw node write outside writeNodeFile", () => {
    const lines = fs.readFileSync(VAULT_SOURCE, "utf8").split("\n");
    const raw = lines
      .map((text, i) => ({ text, line: i + 1 }))
      .filter(({ text }) => /^\s*fs\.writeFileSync\(/.test(text));

    // Exactly one, and it is the one inside `writeNodeFile`. Asserted by content
    // rather than by line number so ordinary edits above it do not redden this.
    expect(
      raw.map((r) => `${r.line}: ${r.text.trim()}`),
      "a raw fs.writeFileSync in vault.ts skips the field census — route it through this.writeNodeFile",
    ).toHaveLength(1);
    const [only] = raw;
    const enclosing = lines
      .slice(0, only.line)
      .reverse()
      .find((l) => /^\s{2}(private |)[a-zA-Z]+\(/.test(l));
    expect(enclosing).toContain("writeNodeFile");
  });

  test("the one write that legitimately bypasses it — editProse's drift guard — reports by hand", () => {
    // `editProse` must carry a content hash into its write, so it calls
    // `writeWithHash` rather than `writeNodeFile`. That is a real exemption and
    // this is what stops it from becoming a silent one: the call and the report
    // are pinned as a pair, so removing the report reddens here.
    const source = fs.readFileSync(VAULT_SOURCE, "utf8");
    const hashWrites = [...source.matchAll(/writeWithHash\(/g)];
    expect(hashWrites, "a new writeWithHash call site needs its own reportNodeWrite").toHaveLength(1);
    expect(source).toMatch(/writeWithHash\(p, rendered, read\);\s*\n\s*reportNodeWrite\(/);
  });
});

describe("what the writer reports", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-write-census-"));
    vault = new Vault(dir);
    drainNodeWrites(); // the array is module-level; start from a known state
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const node = (title: string): OstNode => ({
    title,
    layer: "Opportunity",
    status: "unvalidated",
    evidence: "assertion",
    tags: ["unvalidated"],
    links: [],
    body: "A need.",
  });

  test("a merge reports one record per file it rewrote, not one for the merge", () => {
    // The write site with the worst ratio of calls to files, and the reason the
    // pending-write array is bounded at all: `mergeNodes` rewrites the survivor
    // plus every node in the tree that linked to the loser.
    vault.createNode(node("Survivor"));
    vault.createNode(node("Loser"));
    vault.createNode(node("Pointer one"));
    vault.createNode(node("Pointer two"));
    vault.linkNodes("Pointer one", "Loser");
    vault.linkNodes("Pointer two", "Loser");
    drainNodeWrites();

    vault.mergeNodes("Loser", "Survivor", { prose: "The merged need.", why: "duplicates" });

    const files = drainNodeWrites().map((w) => w.file);
    expect(files.sort()).toEqual(["Pointer one.md", "Pointer two.md", "Survivor.md"]);
  });

  test("a file whose frontmatter will not parse never reaches the census, because no write reaches it either", () => {
    // Why `tracedFields` returns `undefined` rather than `[]` for unparseable
    // frontmatter, and why that branch is defence rather than a live path.
    //
    // Distinguishing the two matters: a file holding fields nobody can enumerate
    // is not a file holding none, and treating it as the latter would report every
    // one of them lost on the very write that repaired it — a defect report
    // generated by the fix. What this pins is that the situation cannot arise
    // through `Vault` today, for a reason worth stating rather than assuming:
    // every write path here deserializes the node first, so the broken file makes
    // the READ throw and no write happens at all. The census records nothing
    // because there was nothing to record.
    const p = path.join(dir, "Broken.md");
    fs.writeFileSync(p, "---\ntype: Opportunity\nevidence: [unclosed\n---\n#Opportunity\n\nA need.\n", "utf8");
    drainNodeWrites();

    expect(() => vault.annotate("Broken", "the frontmatter would not parse")).toThrow();
    expect(drainNodeWrites()).toEqual([]);
  });
});
