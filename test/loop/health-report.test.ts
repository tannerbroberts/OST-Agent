/**
 * `ost-agent loop health` — a reporter, and deliberately not a decision.
 *
 * It exists because the build loop was telling the operator "the discovery loop
 * is working through exactly that queue. No action needed", hourly, on a vault
 * whose discovery loop had not fired in 21 hours because it sat over its spend
 * ceiling. Nothing checked that sentence, because nothing could: `loop due`
 * answers "may I fire?", which is the discovery loop's question and single-tenant,
 * so a second loop asking it reads as that loop claiming the window.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/ost-agent.mjs");
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-health-"));
  await initVault(dir, "Reach ten thousand daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function health(): { out: string; status: number } {
  try {
    const out = execFileSync("node", [CLI, "loop", "health", "--vault", dir], { encoding: "utf8" });
    return { out, status: 0 };
  } catch (e) {
    const err = e as { stdout?: string; status?: number };
    return { out: err.stdout ?? "", status: err.status ?? 1 };
  }
}

describe("loop health", () => {
  test("a vault that has never fired says so", () => {
    expect(health().out).toMatch(/last-fired: never/);
  });

  test("it reports a block without failing — a paused loop is not this command erroring", () => {
    // This vault declares no spend ceiling, so the loop cannot fire.
    const r = health();
    expect(r.out).toMatch(/^blocked: /m);
    // A caller reading the exit code would otherwise have to treat "discovery is
    // paused" as an error of its own, which is how a reporter becomes a gate.
    expect(r.status).toBe(0);
  });

  test("it decides nothing and touches nothing — two runs are identical", () => {
    const before = health().out;
    const after = health().out;
    expect(after).toBe(before);
  });

  test("either blocking:none or blocked: is always printed, so a caller can grep one line", () => {
    expect(health().out).toMatch(/^(blocking: none|blocked: )/m);
  });
});
