import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { setOutcome } from "../../src/runner/set-outcome.js";
import { buildPassContext } from "../../src/runner/context.js";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-setoutcome-"));
  await initVault(dir, "First mandate", "Project");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("setOutcome — retune the steering mandate", () => {
  test("updates config + root body, preserving the prior mandate in History", async () => {
    const r = await setOutcome(dir, "Second mandate, sharper");
    expect(r.title).toBe("Project");
    expect(r.previous).toBe("First mandate");

    const ctx = buildPassContext(dir);
    // config reflects the new mandate
    expect(ctx.config.outcome).toBe("Second mandate, sharper");
    // root node body leads with the new mandate and keeps the old under History
    const root = ctx.vault.read("Project");
    expect(root.body.startsWith("Second mandate, sharper")).toBe(true);
    expect(root.body).toContain("## History");
    expect(root.body).toContain("First mandate");
    // still exactly one outcome; identity (title) unchanged — no rename, no delete
    expect(ctx.vault.readTree().filter((n) => n.layer === "Outcome")).toHaveLength(1);
  });

  test("accumulates history across repeated retunes", async () => {
    await setOutcome(dir, "Second mandate");
    await setOutcome(dir, "Third mandate");
    const root = buildPassContext(dir).vault.read("Project");
    expect(root.body.startsWith("Third mandate")).toBe(true);
    expect(root.body).toContain("First mandate");
    expect(root.body).toContain("Second mandate");
  });

  test("refuses an identical or empty mandate", async () => {
    await expect(setOutcome(dir, "First mandate")).rejects.toThrow(/identical/);
    await expect(setOutcome(dir, "   ")).rejects.toThrow(/empty/);
  });

  test("each retune is a new commit (append-only history in git)", async () => {
    const before = buildPassContext(dir);
    void before;
    const r = await setOutcome(dir, "A new direction");
    expect(r.sha).toMatch(/^[0-9a-f]{7,}$/);
  });
});
