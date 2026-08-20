/**
 * "Every path the config declares is checked when the config is read, not
 * when something reaches for it" — the narrow, load-bearing case: a
 * repository named under `adapters.transcript.projectDir` while
 * `product.repos` was never set. `product.repos` being absent has no path
 * to validate on its own, so a check that only stats declared paths sails
 * straight past it.
 *
 * This vault's own `ost.config.yaml` presented exactly this shape during
 * the 2026-08-06 sweep (see the assumption test this closes) — the fixture
 * below reproduces it directly rather than reading the live file, so the
 * test does not depend on the vault's config staying broken.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readConfig } from "../../src/config/load.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-declared-path-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(yaml: string) {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), yaml, "utf8");
}

describe("declaredPathDiagnostics (via readConfig)", () => {
  test("names product.repos as absent when transcript.projectDir names a repo and product.repos is unset", () => {
    write(
      [
        'outcome: "test outcome"',
        "adapters:",
        "  transcript:",
        "    enabled: true",
        "    projectDir: /Users/tanner/dev/OST-Agent",
        "",
      ].join("\n"),
    );
    const { diagnostics } = readConfig(dir);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].key).toBe("product.repos");
    expect(diagnostics[0].message).toContain("product.repos");
    expect(diagnostics[0].message).toContain("/Users/tanner/dev/OST-Agent");
  });

  test("stays silent when both product.repos and transcript.projectDir are set", () => {
    write(
      [
        'outcome: "test outcome"',
        "adapters:",
        "  transcript:",
        "    enabled: true",
        "    projectDir: /Users/tanner/dev/OST-Agent",
        "product:",
        "  repos:",
        "    - /Users/tanner/dev/OST-Agent",
        "",
      ].join("\n"),
    );
    const { diagnostics } = readConfig(dir);
    expect(diagnostics).toEqual([]);
  });

  test("stays silent when neither product.repos nor transcript.projectDir is configured", () => {
    write(['outcome: "test outcome"', ""].join("\n"));
    const { diagnostics } = readConfig(dir);
    expect(diagnostics).toEqual([]);
  });
});
