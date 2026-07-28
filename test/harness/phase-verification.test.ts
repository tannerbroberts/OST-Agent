/**
 * Phase 3's claims, made executable.
 *
 * Items that only assert sameness can all pass vacuously, so this file leans on
 * negative controls: the clock/randomness scan asserts an ABSENCE across every
 * harness source, and would fail the moment one is introduced.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { BUILT_IN_ENVIRONMENTS, nullEnvironments } from "../../src/harness/environments.js";
import { FITNESS_WEIGHTS } from "../../src/harness/fitness.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS_DIR = path.join(REPO, "src", "harness");

/** The two ways a harness source could stop being a pure function of its inputs. */
const NON_DETERMINISM = /new Date\(\)|Date\.now\(\)|Math\.random\(\)/;

/**
 * Drop block and line comments, so the scan below tests CODE rather than prose.
 * Several harness modules document at length why they must not read the clock,
 * and a scan that flagged those sentences would fire on its own rulebook.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("Phase 3 verification", () => {
  test("the allowlist did not grow — the harness is tooling, not a tool", () => {
    expect(ALLOWED_TOOL_NAMES).toHaveLength(20);
  });

  test("no harness module is reachable from the MCP server or the tool surface", () => {
    for (const f of ["src/mcp/server.ts", "src/security/tools.ts"]) {
      expect(fs.readFileSync(path.join(REPO, f), "utf8")).not.toContain("harness/");
    }
  });

  test("the fitness weights are pinned, not read from a genome", () => {
    expect(FITNESS_WEIGHTS).toEqual({ orientation: 0.5, quality: 0.5 });
    const src = fs.readFileSync(path.join(HARNESS_DIR, "fitness.ts"), "utf8");
    expect(src).not.toMatch(/genome\.\w*[Ww]eight/);
  });

  test("the built-in set always contains null environments, and they are not empty", () => {
    expect(BUILT_IN_ENVIRONMENTS.some((e) => e.kind === "null")).toBe(true);
    expect(nullEnvironments(1)[0].unknowns.length).toBeGreaterThan(0);
  });

  test("NEGATIVE CONTROL: no harness source reads the clock or unseeded randomness", () => {
    for (const f of fs.readdirSync(HARNESS_DIR)) {
      const code = stripComments(fs.readFileSync(path.join(HARNESS_DIR, f), "utf8"));
      expect(code, `${f} reads the clock`).not.toMatch(NON_DETERMINISM);
    }
  });

  test("NEGATIVE CONTROL: the scan catches a violation, and ignores prose about one", () => {
    // Without this pair the test above could pass because the regex is wrong
    // rather than because the sources are clean.
    expect(stripComments("const t = new Date();")).toMatch(NON_DETERMINISM);
    expect(stripComments("/** never call new Date() here */\nconst t = 1;")).not.toMatch(
      NON_DETERMINISM,
    );
    expect(stripComments("const r = Math.random();")).toMatch(NON_DETERMINISM);
  });

  test("the harness writes to its own sidecar, never the dead .ost-agent/runs/", () => {
    const src = fs.readFileSync(path.join(HARNESS_DIR, "record.ts"), "utf8");
    expect(src).toContain('"harness"');
    expect(src).not.toMatch(/"runs"\s*,/);
  });

  test("package.json exposes the harness as ordinary repo tooling, with no bin entry", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.harness).toBe("tsx scripts/harness.ts");
    expect(pkg.bin).toBeUndefined();
  });

  test("no new dependency was added", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@modelcontextprotocol/sdk",
      "commander",
      "gray-matter",
      "simple-git",
      "yaml",
      "zod",
    ]);
  });

  test("the answer key never reaches a generated vault", () => {
    const src = fs.readFileSync(path.join(HARNESS_DIR, "generate.ts"), "utf8");
    // The generator writes config, nodes and evidence — and never the spec.
    expect(src).not.toMatch(/writeFileSync\([^)]*spec\b[^)]*\)/);
  });
});
