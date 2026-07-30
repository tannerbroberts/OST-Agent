/**
 * The `loop:` block must not be able to take the tool surface down.
 *
 * The shape this is guarding against was verified by running it: YAML gives
 * `null` for a bare key, and `z.object({…}).optional()` REJECTS null. So an
 * operator who typed `loop:` and went to look up the syntax would throw out of
 * `loadConfig` — which every tool calls — and lose `ost_read_tree`,
 * `ost_status`, everything, over a key none of them read. That is criterion
 * G1's failure mode: a malformed file at the vault root degrading the whole
 * surface instead of one capability.
 *
 * `.nullish()` is why the first two tests below pass. They fail on `.optional()`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/load.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-loopcfg-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(yaml: string): void {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), `outcome: "ship it"\n${yaml}`, "utf8");
}

describe("a half-written loop block degrades nothing", () => {
  test("a bare `loop:` key loads, and means no loop", () => {
    write("loop:\n");
    expect(loadConfig(dir).loop ?? null).toBeNull();
  });

  test("a bare `loop:\\n  spend:` loads, and means no ceiling", () => {
    write("loop:\n  spend:\n");
    const cfg = loadConfig(dir);
    expect(cfg.loop?.spend ?? null).toBeNull();
    // The lock TTL still gets its default, so the rest of the block is usable.
    expect(cfg.loop?.lockTtlMinutes).toBe(60);
  });

  test("no `loop:` key at all loads, and means no loop", () => {
    write("");
    expect(loadConfig(dir).loop ?? null).toBeNull();
  });
});

describe("what a declared loop block carries", () => {
  test("a full block round-trips", () => {
    write(
      [
        "loop:",
        '  cadence: "6h"',
        "  lockTtlMinutes: 15",
        "  spend:",
        "    ceilingWeightedTokens: 4000000",
        "    windowHours: 24",
        '    sessionsDir: ".claude-sessions"',
        "",
      ].join("\n"),
    );
    expect(loadConfig(dir).loop).toEqual({
      cadence: "6h",
      lockTtlMinutes: 15,
      spend: { ceilingWeightedTokens: 4_000_000, windowHours: 24, sessionsDir: ".claude-sessions" },
    });
  });

  /**
   * A half-typed `spend:` block must NOT throw, and this test used to assert the
   * opposite. Throwing looked right — a mistake to report rather than a default to
   * invent — and the second half of that sentence is still the rule: nothing here
   * invents a number. But the throw came out of `loadConfig`, which every context
   * build calls (`src/runner/context.ts:68`), so an operator partway through
   * writing the three required keys took down `ost-agent status`, `ost-agent
   * check` and the entire MCP tool surface over a key none of them read.
   *
   * That is criterion G1's failure mode exactly, reproduced by the block whose own
   * schema comment cites G1 as the reason its wrappers are `.nullish()`. The
   * wrappers were right and the leaves were not: `loop:` and `spend:` tolerated a
   * bare key while the three fields inside did not.
   *
   * So incompleteness fails the *loop* closed without failing anything else open.
   */
  test("a half-typed spend block loads, so it cannot take the tool surface down with it", () => {
    write("loop:\n  cadence: \"6h\"\n  spend:\n    ceilingWeightedTokens: 100\n");
    const cfg = loadConfig(dir);
    expect(cfg.loop?.spend?.ceilingWeightedTokens).toBe(100);
    expect(cfg.loop?.spend?.windowHours ?? null).toBeNull();
    // …and the unrelated capabilities are still readable, which is the whole point.
    expect(cfg.loop?.cadence).toBe("6h");
  });

  test("a half-typed spend block still refuses to fire, naming what is missing", () => {
    write('loop:\n  cadence: "6h"\n  spend:\n    ceilingWeightedTokens: 100\n');
    let code = 0;
    let out = "";
    try {
      out = execFileSync(TSX, [CLI, "loop", "due", "--vault", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number | null; stdout?: string; stderr?: string };
      code = err.status ?? -1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // 12 = ceilingUndeclared. An incomplete ceiling is no ceiling: no default grant.
    expect(code, out).toBe(12);
    expect(out).toMatch(/windowHours/);
    expect(out).toMatch(/sessionsDir/);
  });

  /**
   * `sessionsDir` is the one field an operator cannot avoid writing a `~` into:
   * Claude Code keeps transcripts under `~/.claude/projects/<slug>`, and that is
   * verbatim what `autonomous-pass.sh`'s header tells them to paste.
   *
   * `path.resolve(vaultDir, "~/x")` produces `<vault>/~/x` without complaining,
   * so the ceiling read an unmeasurable spend and the loop refused to fire — exit
   * 13, forever, on the exact configuration the documentation hands out. A
   * refusal that cannot be cleared by following the instructions is R2's shape,
   * and it was reachable on the first firing of every vault set up as documented.
   *
   * HOME is overridden rather than read, so this never touches the developer's
   * real transcript directory.
   */
  test("a `~`-relative sessionsDir resolves against HOME, not against the vault", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ost-home-"));
    fs.mkdirSync(path.join(home, ".claude", "projects", "slug"), { recursive: true });
    write(
      'loop:\n  cadence: "6h"\n  spend:\n    ceilingWeightedTokens: 4000000\n' +
        '    windowHours: 24\n    sessionsDir: "~/.claude/projects/slug"\n',
    );
    let code = 0;
    let out = "";
    try {
      out = execFileSync(TSX, [CLI, "loop", "due", "--vault", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, HOME: home },
      });
    } catch (e) {
      const err = e as { status: number | null; stdout?: string; stderr?: string };
      code = err.status ?? -1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    // 13 = ceilingBlocked, which is what an unresolvable path produced. Due (0) is
    // the correct answer: the directory exists, spend measures zero, nothing bars it.
    expect(code, out).toBe(0);
    expect(out).not.toMatch(/unmeasurable/);
    fs.rmSync(home, { recursive: true, force: true });
  });
});
