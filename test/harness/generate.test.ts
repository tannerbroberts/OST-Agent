import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { generateEnvironment, makeSpec, specToNodes } from "../../src/harness/generate.js";
import { type EnvironmentSpec } from "../../src/harness/spec.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { Vault } from "../../src/ost/vault.js";
import { buildPassContext } from "../../src/runner/context.js";

const SPEC: EnvironmentSpec = {
  name: "one-of-each",
  kind: "generated",
  seed: 1,
  created: "2026-07-28",
  outcome: "Reach 10,000 daily active users",
  outcomeTitle: "Retention",
  nodes: [
    { title: "Retention", layer: "Outcome", body: "Reach 10,000 daily active users", links: [] },
  ],
  unknowns: [
    {
      title: "How many users hit the export path",
      darkens: "Retention",
      sections: ["Format", "Methodology", "Rationale"],
      findable: true,
      answer: "412 per day",
    },
    {
      title: "Why the trial converts",
      darkens: "Retention",
      sections: ["Format"],
      findable: false,
      answer: "",
    },
  ],
  evidence: [
    { id: "e1", source: "INBOX", title: "export counts", body: "412 per day through the export path" },
  ],
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const filesUnder = (root: string): string[] =>
  (fs.readdirSync(root, { recursive: true, encoding: "utf8" }) as string[])
    .map((f) => path.join(root, f))
    .filter((p) => fs.statSync(p).isFile());

describe("generateEnvironment", () => {
  test("plants a vault buildPassContext accepts without git or init", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(ctx.config.outcome).toBe("Reach 10,000 daily active users");
  });

  test("THE D1 REGRESSION: darkens resolves for every planted unknown", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    expect(work.openUnknowns).toHaveLength(2);
    for (const u of work.openUnknowns) expect(u.darkens).toBe("Retention");
  });

  test("the planted contract sections decide the class, via the real classifier", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    const byTitle = new Map(work.openUnknowns.map((u) => [u.title, u]));
    expect(byTitle.get("How many users hit the export path")?.klass).toBe("bounded");
    expect(byTitle.get("Why the trial converts")?.klass).toBe("unreached");
  });

  test("every planted unknown starts open — no stray Answer, no validated, no deferred", () => {
    generateEnvironment(SPEC, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(computeNextWork(ctx.vault, dir, 3, ctx.genome).openUnknowns).toHaveLength(2);
  });

  test("the census is clean — nothing skipped, nothing unreadable", () => {
    generateEnvironment(SPEC, dir);
    const census = new Vault(dir).readTreeCensus();
    expect(census.skipped).toEqual([]);
    expect(census.unreadable).toEqual([]);
    expect(census.examined).toBe(census.nodes.length);
  });

  test("THE LEAKAGE GUARD: the spec itself never lands on disk", () => {
    generateEnvironment(SPEC, dir);
    for (const p of filesUnder(dir)) {
      // The evidence item deliberately CONTAINS the answer — that is what
      // findable means. What must never appear is the key that says which
      // unknowns are findable at all.
      expect(fs.readFileSync(p, "utf8")).not.toContain("findable");
    }
  });

  test("an unfindable answer is in no planted channel at all", () => {
    const spec: EnvironmentSpec = {
      ...SPEC,
      unknowns: [SPEC.unknowns[1]],
      evidence: [],
    };
    generateEnvironment(spec, dir);
    const all = filesUnder(dir)
      .map((p) => fs.readFileSync(p, "utf8"))
      .join("\n");
    expect(all).not.toContain("412 per day");
  });

  test("is byte-reproducible: the same spec twice yields identical files", () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-a-"));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), "ost-harness-gen-b-"));
    try {
      generateEnvironment(SPEC, a);
      generateEnvironment(SPEC, b);
      const read = (d: string): string =>
        fs
          .readdirSync(d)
          .sort()
          .map((f) => {
            const p = path.join(d, f);
            return `${f}\n${fs.statSync(p).isFile() ? fs.readFileSync(p, "utf8") : ""}`;
          })
          .join("\n---\n");
      expect(read(a)).toBe(read(b));
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test("a generated tree carries no dangling link, which a wrong edge direction would produce", () => {
    generateEnvironment(SPEC, dir);
    const issues = checkInvariants(new Vault(dir).readTree());
    expect(issues.filter((i) => /dangling/i.test(JSON.stringify(i)))).toEqual([]);
  });
});

describe("specToNodes", () => {
  test("the parent carries the edge and the unknown carries none", () => {
    const nodes = specToNodes(SPEC);
    const parent = nodes.find((n) => n.title === "Retention");
    const unknown = nodes.find((n) => n.title === "How many users hit the export path");
    expect(parent?.links).toContain("How many users hit the export path");
    expect(unknown?.links).toEqual([]);
  });

  test("every node declares an evidence rung, so the evidence-class invariant stays quiet", () => {
    for (const n of specToNodes(SPEC)) expect(n.evidence).toBeTruthy();
  });
});

describe("makeSpec", () => {
  test("the same seed yields the same spec", () => {
    expect(makeSpec(7)).toEqual(makeSpec(7));
  });

  test("different seeds yield different specs", () => {
    expect(makeSpec(1)).not.toEqual(makeSpec(2));
  });

  test("produces a spec the schema accepts and the generator can plant", () => {
    const spec = makeSpec(3, { unknowns: 4 });
    generateEnvironment(spec, dir);
    const ctx = buildPassContext(dir, { skipSources: true });
    const work = computeNextWork(ctx.vault, dir, 3, ctx.genome);
    expect(work.openUnknowns).toHaveLength(4);
    for (const u of work.openUnknowns) expect(u.darkens).toBeTruthy();
  });

  test("honours findableRatio so a null environment can be asked for by parameter", () => {
    const spec = makeSpec(5, { unknowns: 6, findableRatio: 0 });
    expect(spec.unknowns.every((u) => !u.findable)).toBe(true);
    expect(spec.kind).toBe("null");
  });

  test("kind describes the world, not the request — a seed that draws nothing findable is null", () => {
    // Seed 1 at the default ratio draws zero findable unknowns. Labelling it
    // "generated" would put a null world in the generated arm of any later
    // comparison that groups by kind.
    const spec = makeSpec(1, { unknowns: 4, findableRatio: 0.5 });
    expect(spec.unknowns.every((u) => !u.findable)).toBe(true);
    expect(spec.kind).toBe("null");
    // Provenance survives the relabel.
    expect(spec.seed).toBe(1);
    expect(spec.name).toBe("generated-1");
  });

  test("a seed that does draw findable unknowns stays generated", () => {
    const spec = makeSpec(0, { unknowns: 4, findableRatio: 0.5 });
    expect(spec.unknowns.some((u) => u.findable)).toBe(true);
    expect(spec.kind).toBe("generated");
  });
});
