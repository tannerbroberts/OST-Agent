/**
 * What `init` writes into the root of a brand-new vault.
 *
 * The rung assertion below used to live in `test/processes/bootstrap.test.ts`,
 * against the P0_bootstrap process. That process is gone, but the claim did not
 * go with it — it moved into `initVault`, which now writes the Outcome node
 * directly. The tree invariants only check that a node declares *some* evidence
 * class, so nothing else in the suite would notice this becoming `verified`.
 *
 * It matters because the mandate is a decision made inside the building, not a
 * finding about the world. Anything above the ladder's floor here would let a
 * reader mistake the goal someone chose for evidence that it is the right goal.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { FLOOR_RUNG } from "../../src/knowledge/believability.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-init-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("the root Outcome node sits at the believability floor, never above it", async () => {
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
  const root = buildPassContext(dir).vault.read("Retention");
  expect(root.layer).toBe("Outcome");
  expect(root.evidence).toBe("assertion");
  // and the floor is what "assertion" means — pinned so renaming the rung cannot
  // quietly promote every mandate ever created
  expect(FLOOR_RUNG).toBe("assertion");
});
