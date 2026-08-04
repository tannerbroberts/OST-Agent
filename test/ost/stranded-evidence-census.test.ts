/**
 * The instrument for "Count stranded evidence items across both vaults that only
 * a Context node could home."
 *
 * The assumption underneath it is a desirability claim: evidence that is true,
 * useful and not a customer need recurs often enough to justify a new node
 * layer. The count that tests it is not the size of the stranded backlog — it is
 * the SPLIT. An item some node's prose already quotes is an item an appendable
 * `source` would clear, and it is evidence for the cheap fix, not the new type.
 * A census that adds the two halves together overstates the case for the layer.
 *
 * So these tests pin three things:
 *
 *   1. mapped-ness is read off frontmatter `source` and nothing else, because
 *      that is the field the ledger counts and the reason the backlog exists;
 *   2. the split is computed from citations in prose, exactly, with the citers
 *      named so the verdict can be checked rather than believed;
 *   3. the census spans more than one vault, because "the same hole in a second
 *      tree that never heard of the first" is the part that is evidence.
 *
 * Everything is a temp vault. Nothing here reads the live trees: a number taken
 * over a vault that changes daily is a number that cannot be asserted against,
 * and the count that decides the assumption is the operator's to take with
 * `ost-agent stranded`, from the same code these tests hold.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { writeEvidence } from "../../src/processes/tree.js";
import {
  formatStrandedCensus,
  quotesEvidenceId,
  strandedEvidence,
  strandedEvidenceCensus,
} from "../../src/ost/stranded.js";
import type { OstNode } from "../../src/ost/node.js";

let dirs: string[];

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-stranded-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/** An opportunity, optionally citing an evidence id in frontmatter, in prose, or both. */
function opportunity(title: string, opts: { source?: string; body?: string } = {}): OstNode {
  const node: OstNode = {
    title,
    layer: "Opportunity",
    status: "unvalidated",
    tags: ["unvalidated"],
    links: [],
    body: opts.body ?? "A body.",
  };
  if (opts.source) node.source = opts.source;
  return node;
}

function evidence(dir: string, id: string, title = `record ${id}`): void {
  writeEvidence(dir, { id, source: "fixture", title, timestamp: "2026-08-04T00:00:00Z", body: "captured." }, "transcript");
}

describe("mapped-ness, and the field that decides it", () => {
  test("an item some node names in frontmatter `source` is mapped, and never stranded", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "TRANSCRIPT:aaa");
    vault.createNode(opportunity("Sessions rediscover the same refusal", { source: "TRANSCRIPT:aaa" }));

    const census = strandedEvidenceCensus([dir]);

    expect(census.examined).toBe(1);
    expect(census.mapped).toBe(1);
    expect(census.stranded).toEqual([]);
  });

  /**
   * The whole reason the backlog exists. `source` is settable at node creation
   * only, so an item that arrives after the node it grounds can be read, used
   * and quoted and still be counted unmapped forever.
   */
  test("an item quoted in a node's prose but named by no node's `source` is stranded, not mapped", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "TRANSCRIPT:bbb");
    vault.createNode(
      opportunity("Sessions rediscover the same refusal", { body: "Third sighting, `TRANSCRIPT:bbb`, same class." }),
    );

    const census = strandedEvidenceCensus([dir]);

    expect(census.mapped).toBe(0);
    expect(census.stranded).toHaveLength(1);
  });
});

describe("the split — which fix an item is evidence for", () => {
  test("stranded items divide into what a node already quotes and what nothing quotes", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "TRANSCRIPT:quoted");
    evidence(dir, "USAGE:2026-07-27", "a quiet day: 16 calls, 0 failed");
    vault.createNode(opportunity("Shell quoting fails the same way each session", { body: "See `TRANSCRIPT:quoted`." }));

    const census = strandedEvidenceCensus([dir]);

    expect(census.stranded).toHaveLength(2);
    expect(census.attachable.map((i) => i.id)).toEqual(["TRANSCRIPT:quoted"]);
    expect(census.homeless.map((i) => i.id)).toEqual(["USAGE:2026-07-27"]);
    // The halves partition the stranded set — nothing is in both, nothing in neither.
    expect(census.attachable.length + census.homeless.length).toBe(census.stranded.length);
  });

  test("an attachable item names the nodes that quote it, so the verdict can be checked", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "USAGE:2026-07-25");
    vault.createNode(opportunity("A third of my calls re-ask what is outstanding", { body: "17 of 108 on `USAGE:2026-07-25`." }));
    vault.createNode(opportunity("Two thirds of my calls failed", { body: "`USAGE:2026-07-25` carries the failure count." }));

    const [item] = strandedEvidenceCensus([dir]).attachable;

    expect(item.citedBy).toEqual([
      "A third of my calls re-ask what is outstanding",
      "Two thirds of my calls failed",
    ]);
    expect(item.kind).toBe("attachable");
  });

  test("a homeless item carries no citers at all — the two fields cannot disagree", () => {
    const dir = makeVault();
    new Vault(dir).createNode(opportunity("Unrelated need"));
    evidence(dir, "USAGE:2026-07-27");

    const [item] = strandedEvidenceCensus([dir]).homeless;

    expect(item.citedBy).toEqual([]);
    expect(item.kind).toBe("homeless");
  });

  /**
   * Ids are keys: every other reader in the product compares them byte-exact, so
   * a prose scan that matched loosely would report an attachment that no reader
   * would honour.
   */
  test("a longer id is not found inside a shorter one, in either direction", () => {
    expect(quotesEvidenceId("measured on USAGE:2026-07-25 that day", "USAGE:2026-07-2")).toBe(false);
    expect(quotesEvidenceId("see SLACK:general:1717 for the thread", "SLACK:general")).toBe(false);
    expect(quotesEvidenceId("filed as INBOX:note.md last week", "INBOX:note")).toBe(false);
    expect(quotesEvidenceId("filed as INBOX:note.md last week", "INBOX:note.md")).toBe(true);
    // Wrapped in the backticks a node body actually uses, and at end of line.
    expect(quotesEvidenceId("see `USAGE:2026-07-25`, twice", "USAGE:2026-07-25")).toBe(true);
    expect(quotesEvidenceId("the id is USAGE:2026-07-25", "USAGE:2026-07-25")).toBe(true);
  });

  /**
   * The failure mode this census is most likely to have in the wild: the node
   * arguing for the new type wrote the backlog into its own body as a table, so
   * every id in it reads as attached to that node. Excluding a citer is how the
   * question gets asked without the answer's own paperwork in it.
   */
  test("a node that merely enumerates the backlog can be excluded from the citation scan", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "USAGE:2026-07-27");
    vault.createNode(
      opportunity("A Context node type for evidence that is not a need", {
        body: "Census: `USAGE:2026-07-27` — a quiet day, carries no need at all.",
      }),
    );

    expect(strandedEvidenceCensus([dir]).homeless).toHaveLength(0);
    const excluded = strandedEvidenceCensus([dir], {
      excludeCiters: ["A Context node type for evidence that is not a need"],
    });
    expect(excluded.homeless.map((i) => i.id)).toEqual(["USAGE:2026-07-27"]);
  });
});

describe("across both vaults", () => {
  test("the census spans several vaults, aggregates them, and keeps each item attributable", () => {
    const meta = makeVault();
    const other = makeVault();
    evidence(meta, "USAGE:2026-07-27");
    evidence(meta, "TRANSCRIPT:cited");
    new Vault(meta).createNode(opportunity("Shell quoting", { body: "See `TRANSCRIPT:cited`." }));
    evidence(other, "TRANSCRIPT:signed-out-visitor");

    const census = strandedEvidenceCensus([meta, other]);

    expect(census.examined).toBe(3);
    expect(census.stranded).toHaveLength(3);
    expect(census.homeless.map((i) => i.id).sort()).toEqual(["TRANSCRIPT:signed-out-visitor", "USAGE:2026-07-27"]);
    expect(census.vaults.map((v) => v.vault)).toEqual([meta, other]);
    expect(new Set(census.stranded.filter((i) => i.vault === other).map((i) => i.id))).toEqual(
      new Set(["TRANSCRIPT:signed-out-visitor"]),
    );
  });

  test("a vault's own subtotals add up to the aggregate", () => {
    const a = makeVault();
    const b = makeVault();
    evidence(a, "USAGE:2026-07-25");
    evidence(b, "USAGE:2026-07-27");
    evidence(b, "TRANSCRIPT:mapped-here");
    new Vault(b).createNode(opportunity("A need", { source: "TRANSCRIPT:mapped-here" }));

    const census = strandedEvidenceCensus([a, b]);

    expect(census.vaults.map((v) => ({ examined: v.examined, mapped: v.mapped, stranded: v.stranded.length }))).toEqual([
      { examined: 1, mapped: 0, stranded: 1 },
      { examined: 2, mapped: 1, stranded: 1 },
    ]);
    expect(census.examined).toBe(3);
    expect(census.mapped).toBe(1);
  });

  test("a vault with no evidence directory contributes nothing rather than throwing", () => {
    const empty = makeVault();
    new Vault(empty).createNode(opportunity("A need"));

    const census = strandedEvidenceCensus([empty]);

    expect(census.examined).toBe(0);
    expect(census.stranded).toEqual([]);
  });
});

describe("the pure core", () => {
  test("classifies from arrays alone, with no filesystem", () => {
    const tree: OstNode[] = [
      { title: "Quoted here", layer: "Opportunity", tags: [], links: [], body: "grounded by `TRANSCRIPT:x`" },
      { title: "Mapped here", layer: "Opportunity", tags: [], links: [], body: "b", source: "TRANSCRIPT:y" },
    ];
    const records = [
      { id: "TRANSCRIPT:x", source: "s", title: "x", timestamp: "t", body: "b", actor: "transcript" as const },
      { id: "TRANSCRIPT:y", source: "s", title: "y", timestamp: "t", body: "b", actor: "transcript" as const },
      { id: "USAGE:2026-07-27", source: "s", title: "quiet day", timestamp: "t", body: "b", actor: "usage" as const },
    ];

    const census = strandedEvidence("/nowhere", tree, records);

    expect(census.examined).toBe(3);
    expect(census.mapped).toBe(1);
    expect(census.stranded.map((i) => [i.id, i.kind])).toEqual([
      ["TRANSCRIPT:x", "attachable"],
      ["USAGE:2026-07-27", "homeless"],
    ]);
  });
});

describe("what the census says out loud", () => {
  test("it leads with the split, names the homeless half, and refuses to claim it counted needs", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    evidence(dir, "USAGE:2026-07-27", "a quiet day");
    evidence(dir, "TRANSCRIPT:cited");
    vault.createNode(opportunity("Shell quoting", { body: "See `TRANSCRIPT:cited`." }));

    const out = formatStrandedCensus(strandedEvidenceCensus([dir]));

    expect(out).toContain("2 of 2 record(s)");
    expect(out).toContain("1 an existing node already cites");
    expect(out).toContain("1 nothing in the tree cites");
    expect(out).toContain("USAGE:2026-07-27 — a quiet day");
    expect(out).toContain("TRANSCRIPT:cited → Shell quoting");
    // The census counts citations. It does not count needs, and must not read as if it did.
    expect(out).toContain("not whether an item carries a customer need");
  });
});
