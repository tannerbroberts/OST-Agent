import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseUsage, readSessionTokens, readSessionUsage, sessionCwd } from "../../src/adapters/tokens.js";

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

/**
 * A transcript line in the shape Claude Code actually writes: the top-level
 * envelope carrying `cwd`, `sessionId`, `timestamp`, `uuid` and `requestId`,
 * with the `usage` object nested under `message`. Passing `timestamp: undefined`
 * in `top` removes the key, because JSON.stringify drops undefined values.
 */
const entryLine = (usage: Record<string, unknown>, top: Record<string, unknown> = {}): string =>
  JSON.stringify({
    type: "assistant",
    cwd: "/Users/tanner/ost-agent-vault",
    sessionId: "16e91f12-961b-4ff9-9e25-c04319461cb5",
    timestamp: "2026-07-24T15:54:24.465Z",
    uuid: "a1b2c3d4-0000-4000-8000-000000000001",
    requestId: "req_011CdM9r3kkZcDDFE8X2ZoER",
    ...top,
    message: { usage },
  });

describe("readSessionUsage", () => {
  test("keeps the timestamp each usage record arrived with — a whole-file total cannot be split in time", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 1, output_tokens: 10 }, { timestamp: "2026-07-24T15:54:24.465Z" }),
      entryLine({ input_tokens: 2, output_tokens: 20 }, { timestamp: "2026-07-24T15:59:01.002Z" }),
    ]);
    const entries = readSessionUsage(file);
    expect(entries.map((e) => e.ts)).toEqual([
      "2026-07-24T15:54:24.465Z",
      "2026-07-24T15:59:01.002Z",
    ]);
    expect(entries[0].tiers).toEqual({ input: 1, output: 10, cacheCreate: 0, cacheRead: 0 });
    expect(entries[1].tiers).toEqual({ input: 2, output: 20, cacheCreate: 0, cacheRead: 0 });
  });

  test("the iterations array is IGNORED — its per-iteration tiers duplicate the top level, and summing both double-counts every token", () => {
    const observed = {
      input_tokens: 2,
      output_tokens: 125,
      cache_creation_input_tokens: 5703,
      cache_read_input_tokens: 15152,
    };
    const file = sessionFile([entryLine({ ...observed, iterations: [{ ...observed }] })]);
    const entries = readSessionUsage(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].tiers).toEqual({ input: 2, output: 125, cacheCreate: 5703, cacheRead: 15152 });
    expect(readSessionTokens(file)).toEqual({ input: 2, output: 125, cacheCreate: 5703, cacheRead: 15152 });
  });

  test("carries uuid and requestId when the transcript has them, and omits them rather than inventing them", () => {
    const withIds = sessionFile([entryLine({ input_tokens: 1 })]);
    expect(readSessionUsage(withIds)[0].uuid).toBe("a1b2c3d4-0000-4000-8000-000000000001");
    expect(readSessionUsage(withIds)[0].requestId).toBe("req_011CdM9r3kkZcDDFE8X2ZoER");

    const bare = sessionFile([entryLine({ input_tokens: 1 }, { uuid: undefined, requestId: undefined })]);
    expect(readSessionUsage(bare)[0].uuid).toBeUndefined();
    expect(readSessionUsage(bare)[0].requestId).toBeUndefined();
  });

  test("an undated record still counts its tokens — uncorrelatable is NOT uncounted", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 7 }, { timestamp: undefined, uuid: undefined, requestId: undefined }),
    ]);
    expect(readSessionUsage(file)).toEqual([{ ts: "", tiers: { input: 7, output: 0, cacheCreate: 0, cacheRead: 0 } }]);
    expect(readSessionTokens(file).input).toBe(7);
  });

  test("usage-free and corrupt lines contribute no entry and do not end the read", () => {
    const file = sessionFile([
      "{broken",
      JSON.stringify({ type: "user", cwd: "/Users/tanner/ost-agent-vault", message: { content: "hi" } }),
      entryLine({ input_tokens: 4 }),
    ]);
    const entries = readSessionUsage(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].tiers.input).toBe(4);
  });

  test("a missing file is an empty account, not a throw — this reads a file no OST-Agent process wrote", () => {
    expect(readSessionUsage("/nonexistent/session.jsonl")).toEqual([]);
  });
});

describe("sessionCwd", () => {
  test("reads the directory the session ran in — the ONLY join key between a transcript and a vault", () => {
    const file = sessionFile([
      JSON.stringify({ type: "user", cwd: "/Users/tanner/ost-agent-vault", message: { content: "hi" } }),
      entryLine({ input_tokens: 1 }),
    ]);
    expect(sessionCwd(file)).toBe("/Users/tanner/ost-agent-vault");
  });

  test("a corrupt first line does not hide the cwd on the second", () => {
    const file = sessionFile(["{broken", entryLine({ input_tokens: 1 })]);
    expect(sessionCwd(file)).toBe("/Users/tanner/ost-agent-vault");
  });

  test("a transcript that names no cwd, and a file that is not there, are both undefined rather than a throw", () => {
    const anonymous = sessionFile([entryLine({ input_tokens: 1 }, { cwd: undefined })]);
    expect(sessionCwd(anonymous)).toBeUndefined();
    expect(sessionCwd("/nonexistent/session.jsonl")).toBeUndefined();
  });
});

describe("readSessionTokens — folded over readSessionUsage", () => {
  test("the whole-file total equals the sum of the per-record tiers — one account, two views, unable to drift", () => {
    const file = sessionFile([
      entryLine({ input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
      entryLine({ input_tokens: 2, output_tokens: 20, cache_creation_input_tokens: 200, cache_read_input_tokens: 2000 }),
    ]);
    const folded = readSessionUsage(file).reduce(
      (acc, e) => ({
        input: acc.input + e.tiers.input,
        output: acc.output + e.tiers.output,
        cacheCreate: acc.cacheCreate + e.tiers.cacheCreate,
        cacheRead: acc.cacheRead + e.tiers.cacheRead,
      }),
      { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 },
    );
    expect(readSessionTokens(file)).toEqual(folded);
    expect(folded).toEqual({ input: 3, output: 30, cacheCreate: 300, cacheRead: 3000 });
  });
});
