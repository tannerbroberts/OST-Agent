import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseUsage, readSessionTokens } from "../../src/adapters/tokens.js";

const line = (usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { usage: { ...usage, server_tool_use: { web_search_requests: 0 } } } });

function sessionFile(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tokens-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

describe("parseUsage", () => {
  test("lifts all four tiers separately", () => {
    expect(parseUsage(JSON.parse(line({
      input_tokens: 2, output_tokens: 85, cache_creation_input_tokens: 11208, cache_read_input_tokens: 22024,
    })))).toEqual({ input: 2, output: 85, cacheCreate: 11208, cacheRead: 22024 });
  });

  test("treats a missing tier as zero rather than dropping the record", () => {
    expect(parseUsage(JSON.parse(line({ input_tokens: 5, output_tokens: 6 }))))
      .toEqual({ input: 5, output: 6, cacheCreate: 0, cacheRead: 0 });
  });

  test("an entry with no usage is not a cost record", () => {
    expect(parseUsage({ type: "user", message: { content: "hi" } })).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage("nonsense")).toBeNull();
  });

  test("a non-numeric tier is read as zero, never NaN — a poisoned trace must not corrupt cost", () => {
    expect(parseUsage(JSON.parse(line({ input_tokens: "lots" as unknown as number }))))
      .toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
  });
});

describe("readSessionTokens", () => {
  test("sums each tier across a session, keeping them unmixed", () => {
    const file = sessionFile([
      line({ input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
      line({ input_tokens: 2, output_tokens: 20, cache_creation_input_tokens: 200, cache_read_input_tokens: 2000 }),
    ]);
    expect(readSessionTokens(file)).toEqual({ input: 3, output: 30, cacheCreate: 300, cacheRead: 3000 });
  });

  test("skips corrupt and usage-free lines without failing the read", () => {
    const file = sessionFile(["{broken", JSON.stringify({ type: "user" }), line({ input_tokens: 7 })]);
    expect(readSessionTokens(file).input).toBe(7);
  });

  test("a missing file is zero cost, not a throw", () => {
    expect(readSessionTokens("/nonexistent/session.jsonl")).toEqual({
      input: 0, output: 0, cacheCreate: 0, cacheRead: 0,
    });
  });
});
