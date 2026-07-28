/**
 * The genome loader is the one place a policy can enter the kernel from
 * outside, so its two failure directions are opposite on purpose and both are
 * pinned here: an ABSENT genome is silently the default (every vault that
 * exists today has none, and behaviour must not change), while a PRESENT but
 * wrong genome is fatal (a misspelled allele that read as "behaviour
 * unchanged" would corrupt a fitness record without announcing itself).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GENOME_FILENAME, defaultGenome, genomePath, loadGenome } from "../../src/genome/load.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-"));

function write(dir: string, yaml: string): void {
  fs.writeFileSync(genomePath(dir), yaml, "utf8");
}

describe("defaultGenome", () => {
  test("materialises every gene from an empty document — the defaults live in the schema, nowhere else", () => {
    const g = defaultGenome();
    expect(g.version).toBe(1);
    expect(g.tokenWeights).toEqual({ input: 1, output: 5, cacheCreate: 1.25, cacheRead: 0.1 });
    expect(g.classifier.contractSections).toEqual(["Format", "Methodology", "Rationale"]);
    expect(g.classifier.classes).toEqual(["bounded", "unreached", "unbounded"]);
    expect(g.classifier.fallback).toBe("unbounded");
    expect(g.classifier.rules).toEqual([
      { class: "unbounded", present: [], absent: ["Format"] },
      { class: "bounded", present: ["Format", "Methodology"], absent: [] },
      { class: "unreached", present: ["Format"], absent: [] },
    ]);
    expect(g.resolution.answerSection).toBe("Answer");
    expect(g.resolution.fallback).toBe("open");
    expect(g.resolution.rules).toEqual([
      { state: "abandoned", status: ["deferred"] },
      { state: "satisfied", status: ["validated"], section: "Answer" },
    ]);
    expect(g.budgets.perClass).toEqual({});
    expect(g.budgets.onExhaustion).toBe("instruct");
    expect(g.pivot).toEqual({
      unknownsBlockDone: false,
      maxOpenUnknownsSurfaced: 0,
      ranking: "tree-order",
      classPriority: [],
    });
    expect(g.attribution.staleAttribution).toBe("drop");
    expect(g.tokenSplit.source).toBe("transcript");
    expect(g.tokenSplit.method).toBe("proportional-by-calls");
    expect(g.tokenSplit.residual).toBe("unattributed");
    expect(g.tokenSplit.costBasis).toBe("tokens");
  });

  test("sharedPool defaults to null — the operator's configured budget stays THE number until a genome says otherwise", () => {
    expect(defaultGenome().budgets.sharedPool).toBeNull();
  });

  test("tokenSplit is OFF by default — nothing correlates tokens today, and identity means today", () => {
    expect(defaultGenome().tokenSplit.enabled).toBe(false);
  });

  test("the resolution order IS the precedence — abandonment is checked before any drafted answer", () => {
    expect(defaultGenome().resolution.rules[0].state).toBe("abandoned");
  });
});

describe("loadGenome — an absent file", () => {
  test("an absent genome.yaml IS the default genome, silently — every vault alive today has none", () => {
    expect(loadGenome(tmp())).toEqual(defaultGenome());
  });

  test("reading a vault with no genome writes nothing — the file is NEVER scaffolded", () => {
    const dir = tmp();
    loadGenome(dir);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  test("an empty genome.yaml is the default genome too — a file of comments declares nothing", () => {
    const dir = tmp();
    write(dir, "# a genome that overrides nothing\n");
    expect(loadGenome(dir)).toEqual(defaultGenome());
  });
});

describe("loadGenome — a partial genome", () => {
  test("one stated allele leaves every other gene at its default", () => {
    const dir = tmp();
    write(dir, "tokenWeights:\n  output: 9\n");
    const g = loadGenome(dir);
    expect(g.tokenWeights.output).toBe(9);
    expect(g.tokenWeights.input).toBe(1);
    expect(g.tokenWeights.cacheRead).toBe(0.1);
    expect(g.pivot.ranking).toBe("tree-order");
    expect(g.classifier.rules).toHaveLength(3);
  });

  test("an explicit sharedPool is the override the null default exists to allow", () => {
    const dir = tmp();
    write(dir, "budgets:\n  sharedPool: 4\n  perClass: { bounded: 3, unbounded: 1 }\n");
    const g = loadGenome(dir);
    expect(g.budgets.sharedPool).toBe(4);
    expect(g.budgets.perClass).toEqual({ bounded: 3, unbounded: 1 });
    expect(g.budgets.onExhaustion).toBe("instruct");
  });

  test("a two-class classifier parses — the vocabulary is data, so dropping `unreached` is an allele, not a rewrite", () => {
    const dir = tmp();
    write(
      dir,
      [
        "classifier:",
        "  classes: [bounded, unbounded]",
        "  fallback: unbounded",
        "  rules:",
        "    - { class: bounded, present: [Format] }",
        "",
      ].join("\n"),
    );
    const g = loadGenome(dir);
    expect(g.classifier.classes).toEqual(["bounded", "unbounded"]);
    expect(g.classifier.rules).toEqual([{ class: "bounded", present: ["Format"], absent: [] }]);
  });
});

describe("loadGenome — a wrong genome is fatal", () => {
  test("a misspelled gene throws rather than reading as `behaviour unchanged`", () => {
    const dir = tmp();
    write(dir, "tokenWeigths:\n  output: 9\n");
    expect(() => loadGenome(dir)).toThrow(/tokenWeigths/);
  });

  test("a misspelled allele inside a gene throws too — strictness goes all the way down", () => {
    const dir = tmp();
    write(dir, "pivot:\n  ranking: tree-order\n  maxOpen: 3\n");
    expect(() => loadGenome(dir)).toThrow(/maxOpen/);
  });

  test("a rule emitting a class outside `classes` throws — the guard that replaces the lost compile-time union", () => {
    const dir = tmp();
    write(
      dir,
      [
        "classifier:",
        "  classes: [bounded, unbounded]",
        "  fallback: unbounded",
        "  rules:",
        "    - { class: unreached, present: [Format] }",
        "",
      ].join("\n"),
    );
    expect(() => loadGenome(dir)).toThrow(/classes/);
  });

  test("a fallback outside `classes` throws — the floor must be a class something can read", () => {
    const dir = tmp();
    write(dir, "classifier:\n  classes: [bounded]\n  fallback: nope\n  rules: []\n");
    expect(() => loadGenome(dir)).toThrow(/classes/);
  });

  test("a classifier rule matching on nothing throws — it would fire on every node", () => {
    const dir = tmp();
    write(dir, "classifier:\n  rules:\n    - { class: unbounded }\n");
    expect(() => loadGenome(dir)).toThrow(/present/);
  });

  test("a resolution rule matching on nothing throws — satisfaction is NEVER claimed on absence of evidence", () => {
    const dir = tmp();
    write(dir, "resolution:\n  rules:\n    - { state: satisfied }\n");
    expect(() => loadGenome(dir)).toThrow(/status/);
  });

  test("an unparseable file names itself in the error — a vault carries more than one YAML", () => {
    const dir = tmp();
    write(dir, "classifier: [unclosed\n");
    expect(() => loadGenome(dir)).toThrow(new RegExp(GENOME_FILENAME));
  });

  test("a wrongly-typed leaf throws, naming the path to the gene", () => {
    const dir = tmp();
    write(dir, "tokenWeights:\n  output: heavy\n");
    expect(() => loadGenome(dir)).toThrow(/tokenWeights\.output/);
  });
});
