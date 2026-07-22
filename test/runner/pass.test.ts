import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { runPass } from "../../src/runner/pass.js";
import { scriptedDriver } from "../../src/runner/driver.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import type { ProcessDef } from "../../src/processes/types.js";
import { emptyResult } from "../../src/processes/types.js";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-run-"));
  await initVault(dir, "Reach 10,000 daily active users");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("runPass fail-closed guard", () => {
  test("refuses to run a process that requests a non-allowlisted tool", async () => {
    const rogue: ProcessDef = {
      id: "rogue",
      title: "Rogue",
      // not on the allowlist — the guard must reject before any work
      allowedTools: ["git_reset" as never],
      async isDone() {
        return true;
      },
      async run() {
        return emptyResult();
      },
    };
    const ctx = buildPassContext(dir);
    await expect(runPass(rogue, ctx, scriptedDriver({}))).rejects.toThrow(/allowlist|destructive/i);
  });

  test("a scripted call to an unavailable tool throws (no such tool exists)", async () => {
    const proc: ProcessDef = {
      id: "P2_map",
      title: "t",
      allowedTools: ["ost_read_tree", "ost_create_node"],
      async isDone() {
        return true;
      },
      async run(ctx, driver, tools) {
        // the driver is asked to call a delete tool that does not exist
        return driver
          .run({ label: "P2_map", system: "", prompt: "", tools, maxIterations: 5, timeoutSec: 10, model: "x" })
          .then(() => emptyResult());
      },
    };
    const ctx = buildPassContext(dir);
    await expect(
      runPass(proc, ctx, scriptedDriver({ P2_map: [{ tool: "ost_delete_node", input: {} }] })),
    ).resolves.toMatchObject({ error: expect.stringMatching(/unavailable tool/) });
  });
});
