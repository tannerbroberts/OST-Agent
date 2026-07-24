import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { p0Bootstrap } from "../../src/processes/registry.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { checkInvariants } from "../../src/eval/invariants.js";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-bootstrap-"));
  await initVault(dir, "Reach 10,000 daily active users");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("P0 bootstrap", () => {
  test("the root it creates declares its own rung, so a fresh vault passes its invariants", () => {
    const ctx = buildPassContext(dir);
    const root = ctx.vault.readTree().find((n) => n.layer === "Outcome")!;

    // the mandate is a decision from inside the building — the ladder's floor
    expect(root.evidence).toBe("assertion");
    expect(checkInvariants(ctx.vault.readTree()).filter((v) => v.rule === "evidence-class")).toEqual([]);
  });

  test("is done once the outcome exists", async () => {
    expect(await p0Bootstrap.isDone(buildPassContext(dir))).toBe(true);
  });
});
