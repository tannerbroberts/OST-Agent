import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { defaultConfigYaml } from "../../src/config/schema.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cfg-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(yaml: string) {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), yaml, "utf8");
}

describe("loadConfig", () => {
  test("parses the scaffolded default config and applies defaults", () => {
    write(defaultConfigYaml("Reach 10,000 daily active users"));
    const cfg = loadConfig(dir);
    expect(cfg.outcome).toBe("Reach 10,000 daily active users");
    expect(cfg.remote.enabled).toBe(false); // default: no push
    expect(cfg.adapters.inbox.enabled).toBe(true);
    expect(cfg.processes["P3_ideate"].minSolutionsPerOpportunity).toBe(3);
    expect(cfg.adapters.transcript.enabled).toBe(false); // opt-in: reads session transcripts
  });

  test("the scaffolded config names no model — there is nothing here that calls one", () => {
    const yaml = defaultConfigYaml("Reach 10,000 daily active users");
    expect(yaml).not.toMatch(/^model:/m);
    expect(yaml).not.toMatch(/cron:/);
    expect(yaml).not.toMatch(/triggers:/);
  });

  /**
   * Vaults created before the API-key runner was deleted still carry `model`,
   * `cron`, `triggers`, and `limits`. The schema no longer declares them, and
   * Zod strips undeclared keys rather than rejecting them — so an old vault must
   * keep loading. A config that stops parsing is far worse than a stale field.
   */
  test("a pre-runner config still loads, with the dead fields quietly dropped", () => {
    write(
      [
        'outcome: "Reach 10,000 daily active users"',
        "model: claude-opus-4-8",
        "processes:",
        '  P1_ingest:      { cron: "*/15 * * * *", triggers: ["inbox:new"] }',
        '  P3_ideate:      { cron: "0 */6 * * *",  triggers: ["after:P2_map"], minSolutionsPerOpportunity: 5,',
        "                    limits: { maxIterations: 30, timeoutSec: 300, tokenBudget: 1000 } }",
        '  P5_hygiene:     { cron: "0 3 * * *",    triggers: [] }',
        "",
      ].join("\n"),
    );
    const cfg = loadConfig(dir);
    expect(cfg.outcome).toBe("Reach 10,000 daily active users");
    // the one knob that survived is still read from the old file
    expect(cfg.processes["P3_ideate"].minSolutionsPerOpportunity).toBe(5);
    // …and the dead ones are gone rather than fatal
    expect(cfg).not.toHaveProperty("model");
    expect(cfg.processes["P1_ingest"]).not.toHaveProperty("cron");
    expect(cfg.processes["P3_ideate"]).not.toHaveProperty("limits");
  });

  test("rejects config without an outcome", () => {
    write("model: claude-opus-4-8\n");
    expect(() => loadConfig(dir)).toThrow(/outcome/i);
  });

  test("errors clearly when no config file exists", () => {
    expect(() => loadConfig(dir)).toThrow(/ost-agent init/);
  });

  test("applies inbox defaults when adapters omitted", () => {
    write("outcome: X\n");
    const cfg = loadConfig(dir);
    expect(cfg.adapters.inbox.path).toBe(".ost-agent/inbox");
    expect(cfg.adapters.atlassian.enabled).toBe(false);
  });
});
