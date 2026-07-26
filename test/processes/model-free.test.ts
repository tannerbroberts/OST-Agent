/**
 * `drivesModel` decides which commands are gated behind a credential. It is
 * derived from a process's allowlist rather than declared, so it can go wrong in
 * exactly one way: a process that says it needs no tools but reaches for the
 * driver anyway. That would put a credential wall in front of work that does not
 * need one — the precise failure the guard exists to remove.
 *
 * So prove it against the real implementations: hand every model-free process a
 * driver that explodes if anyone calls it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { PROCESSES } from "../../src/processes/registry.js";
import { drivesModel } from "../../src/processes/types.js";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { runPass } from "../../src/runner/pass.js";
import type { PassDriver } from "../../src/runner/driver.js";

const explodingDriver: PassDriver = {
  async run() {
    throw new Error("a model-free process reached for the driver");
  },
};

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-model-free-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("drivesModel", () => {
  test("splits the registry the way the docs claim: ingest/bootstrap/hygiene are model-free", () => {
    const free = PROCESSES.filter((p) => !drivesModel(p)).map((p) => p.id).sort();
    const driven = PROCESSES.filter(drivesModel).map((p) => p.id).sort();
    expect(free).toEqual(["P0_bootstrap", "P1_ingest", "P5_hygiene"]);
    expect(driven).toEqual(["P2_map", "P3_ideate", "P4_assumptions"]);
  });

  for (const proc of PROCESSES.filter((p) => !drivesModel(p))) {
    test(`${proc.id} completes a pass without ever touching the driver`, async () => {
      // an inbox note so ingest has something to do rather than trivially no-opping
      fs.writeFileSync(path.join(dir, ".ost-agent", "inbox", "note.md"), "A player said the daily board is the reason they open it.\n");
      const outcome = await runPass(proc, buildPassContext(dir), explodingDriver);
      expect(outcome.error).toBeUndefined();
    });
  }
});
