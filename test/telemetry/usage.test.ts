import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { recordUsageEvent, usageLogPath, withUsageTracing, type UsageEvent } from "../../src/telemetry/usage.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-usage-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readEvents(): UsageEvent[] {
  const file = usageLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEvent);
}

describe("recordUsageEvent", () => {
  test("appends JSONL under .ost-agent/usage, creating the directory", () => {
    recordUsageEvent(dir, { ts: "2026-07-24T10:00:00.000Z", tool: "ost_annotate", ok: true, ms: 12, surface: "cli-tool", argBytes: 40 });
    recordUsageEvent(dir, { ts: "2026-07-24T10:00:01.000Z", tool: "ost_create_node", ok: false, ms: 5, surface: "mcp", argBytes: 900, err: "no such parent" });

    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].tool).toBe("ost_annotate");
    expect(events[1].ok).toBe(false);
    expect(events[1].err).toBe("no such parent");
  });

  test("never throws when the log location is unwritable (fail-open)", () => {
    // occupy the .ost-agent/usage path with a FILE so mkdir/append must fail
    fs.mkdirSync(path.join(dir, ".ost-agent"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ost-agent", "usage"), "not a directory", "utf8");

    expect(() =>
      recordUsageEvent(dir, { ts: "2026-07-24T10:00:00.000Z", tool: "ost_annotate", ok: true, ms: 1, surface: "cli-tool", argBytes: 2 }),
    ).not.toThrow();
  });
});

describe("withUsageTracing", () => {
  test("passes results through and records a success event with timing and size", async () => {
    const [tool] = withUsageTracing(
      [{ name: "ost_read_tree", run: async (input: never) => `ok:${JSON.stringify(input)}` }],
      dir,
      "mcp",
    );

    const result = await tool.run({ hello: "world" } as never);

    expect(result).toBe('ok:{"hello":"world"}');
    const [event] = readEvents();
    expect(event.tool).toBe("ost_read_tree");
    expect(event.ok).toBe(true);
    expect(event.surface).toBe("mcp");
    expect(event.argBytes).toBe(Buffer.byteLength('{"hello":"world"}'));
    expect(event.ms).toBeGreaterThanOrEqual(0);
  });

  test("rethrows errors untouched while recording a redacted failure event", async () => {
    const [tool] = withUsageTracing(
      [
        {
          name: "ost_set_status",
          run: async () => {
            throw new Error("boom: token=ghp_abcdefghijklmnopqrstuvwxyz0123456789");
          },
        },
      ],
      dir,
      "pass:P5_hygiene",
    );

    await expect(tool.run({} as never)).rejects.toThrow(/^boom/);
    const [event] = readEvents();
    expect(event.ok).toBe(false);
    expect(event.surface).toBe("pass:P5_hygiene");
    expect(event.err).toBeDefined();
    expect(event.err).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("records only size, never input content", async () => {
    const [tool] = withUsageTracing([{ name: "ost_annotate", run: async () => "annotated" }], dir, "cli-tool");
    await tool.run({ title: "Secret Roadmap Node", issue: "very private detail" } as never);

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    expect(raw).not.toContain("Secret Roadmap Node");
    expect(raw).not.toContain("very private detail");
    expect((JSON.parse(raw) as UsageEvent).argBytes).toBeGreaterThan(0);
  });
});
