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
    expect(cfg.model).toBe("claude-opus-4-8");
    expect(cfg.processes["P3_ideate"].minSolutionsPerOpportunity).toBe(3);
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
    expect(cfg.adapters.inbox.path).toBe("inbox");
    expect(cfg.adapters.atlassian.enabled).toBe(false);
  });
});
