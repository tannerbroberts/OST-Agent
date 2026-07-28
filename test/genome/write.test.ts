import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { defaultGenome, loadGenome } from "../../src/genome/load.js";
import { serializeGenome, validateGenome, writeGenome } from "../../src/genome/write.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-genome-write-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("writeGenome", () => {
  test("a written genome round-trips through the real loader", () => {
    const g = defaultGenome();
    g.budgets.sharedPool = 7;
    g.weightedTokenSpend.output = 9;
    writeGenome(dir, g);
    expect(loadGenome(dir)).toEqual(g);
  });

  test("round-trips a resolution rule that omits the optional section", () => {
    const g = defaultGenome();
    g.resolution.rules = [{ state: "abandoned", status: ["deferred"] }];
    writeGenome(dir, g);
    expect(loadGenome(dir).resolution.rules).toEqual([{ state: "abandoned", status: ["deferred"] }]);
  });

  test("omits an absent optional rather than writing null, which the schema would reject", () => {
    const g = defaultGenome();
    g.resolution.rules = [{ state: "abandoned", status: ["deferred"] }];
    expect(serializeGenome(g)).not.toContain("section:");
  });

  test("every default-genome value survives serialization unchanged", () => {
    writeGenome(dir, defaultGenome());
    expect(loadGenome(dir)).toEqual(defaultGenome());
  });
});

describe("validateGenome", () => {
  test("catches a fallback outside the class vocabulary BEFORE it reaches disk", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    const v = validateGenome(g);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.join("\n")).toContain("classes");
  });

  test("catches a classifier rule predicated on nothing", () => {
    const g = defaultGenome();
    g.classifier.rules = [{ class: "bounded", present: [], absent: [] }];
    expect(validateGenome(g).ok).toBe(false);
  });

  test("accepts a genome the loader would accept", () => {
    expect(validateGenome(defaultGenome()).ok).toBe(true);
  });
});

describe("writeGenome refuses to plant an invalid genome", () => {
  test("throws rather than writing a file the next buildPassContext would die on", () => {
    const g = defaultGenome();
    g.classifier.fallback = "nonesuch";
    expect(() => writeGenome(dir, g)).toThrow(/genome/i);
    expect(fs.existsSync(path.join(dir, "genome.yaml"))).toBe(false);
  });
});
