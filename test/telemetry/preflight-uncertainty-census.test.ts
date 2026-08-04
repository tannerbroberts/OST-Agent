/**
 * The preflight-uncertainty census: did the callers whose calls failed already
 * know they were unsure?
 *
 * The solution under test is a validate-only twin of every mutating call — same
 * arguments, every check run, nothing written, a verdict returned. It helps
 * exactly one caller: the one who thinks to use it. So the assumption underneath
 * it is not that the twin is buildable, it is that failing callers were
 * hesitating, and this file takes that count over a corpus committed beside it.
 *
 * **The controls are what carry this file.** A classifier that answered "doubt"
 * to everything would satisfy every assertion about the real corpus that came out
 * high, and one that answered "confident" to everything would satisfy every
 * assertion about a corpus that came out low. So the synthetic cases below run
 * first and in both directions: each signal kind fires on a window built to carry
 * it, and each fails to fire on a window built to look like it and not be it.
 * Only then is the number over the real corpus worth reading.
 *
 * The rule the classifier uses is `UNCERTAINTY_RULE`, committed in
 * `src/telemetry/preflight.ts` before this corpus was counted — including which
 * hedges it deliberately refuses. A proxy tuned after the count is a number that
 * means nothing, and this test asserts the shape of the rule, not just its output,
 * so a later edit to the lists shows up here as a changed expectation rather than
 * a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  formatPreflightCensus,
  preflightUncertaintyCensus,
  readTranscriptSessions,
  UNCERTAINTY_RULE,
  type TranscriptSession,
} from "../../src/telemetry/preflight.js";
import type { UsageEvent } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "preflight");

/**
 * How many entries before each failing call the committed transcript slices keep.
 * Recorded in `test/fixtures/preflight/PROVENANCE.md` and asserted below: a
 * lookback wider than the cut would read across a gap the cut created and report
 * adjacency that never existed.
 */
const FIXTURE_WINDOW_BEFORE = 26;

// ── synthetic corpus builders ────────────────────────────────────────────────

let clock = 0;
/** Entries a second apart, so a lookback counted in entries is unambiguous. */
function at(): string {
  clock += 1000;
  return new Date(Date.UTC(2026, 0, 1) + clock).toISOString();
}

function assistant(...blocks: Record<string, unknown>[]): Record<string, unknown> {
  return { type: "assistant", timestamp: at(), message: { content: blocks } };
}

function user(text: string): Record<string, unknown> {
  return { type: "user", timestamp: at(), message: { content: [{ type: "text", text }] } };
}

function session(id: string, entries: Record<string, unknown>[]): TranscriptSession {
  return { id, jsonl: entries.map((e) => JSON.stringify(e)).join("\n") };
}

/** The usage event for the call issued by `entry`, so the join is exact. */
function failureOf(entry: Record<string, unknown>, tool: string): UsageEvent {
  return {
    ts: entry.timestamp as string,
    tool,
    ok: false,
    ms: 3,
    surface: "mcp",
    argBytes: 100,
    err: "refused",
  };
}

/**
 * A session whose last entry issues a failing `ost_create_node`, preceded by
 * whatever `before` supplies. One builder for every control, so the cases differ
 * only in the thing under test.
 */
function windowEndingInFailure(before: Record<string, unknown>[], own: Record<string, unknown>[] = []) {
  const call = assistant(...own, { type: "tool_use", id: "t1", name: "mcp__ost-agent__ost_create_node", input: { a: 1 } });
  const entries = [...before, call];
  return {
    sessions: [session("synthetic", entries)],
    events: [failureOf(call, "ost_create_node")],
  };
}

function censusOf(built: { sessions: TranscriptSession[]; events: UsageEvent[] }) {
  return preflightUncertaintyCensus(built.events, built.sessions);
}

describe("the classifier fires on doubt it was built to see", () => {
  test("a first-person hedge in the caller's own message", () => {
    const c = censusOf(
      windowEndingInFailure([], [{ type: "text", text: "I'm not sure this rung is allowed, but here goes." }]),
    );
    expect(c.readable).toBe(1);
    expect(c.uncertain).toBe(1);
    expect(c.readings[0].signals.map((s) => s.kind)).toContain("hedge");
    expect(c.readings[0].signals[0].marker).toBe("not sure");
  });

  test("a hedge in the caller's reasoning, when the reasoning still has text", () => {
    const c = censusOf(
      windowEndingInFailure([assistant({ type: "thinking", thinking: "I wonder if inbox can carry 'stated'." })]),
    );
    expect(c.uncertain).toBe(1);
    expect(c.readings[0].signals[0].kind).toBe("hedge");
  });

  test("the caller announcing a check before it acts", () => {
    const c = censusOf(windowEndingInFailure([], [{ type: "text", text: "Let me check what that channel earned." }]));
    expect(c.uncertain).toBe(1);
    expect(c.readings[0].signals[0].kind).toBe("check");
  });

  test("a read issued before the write", () => {
    const c = censusOf(
      windowEndingInFailure([
        assistant({ type: "tool_use", id: "r1", name: "mcp__ost-agent__ost_read_tree", input: {} }),
        user("tree"),
      ]),
    );
    expect(c.uncertain).toBe(1);
    expect(c.readings[0].signals[0].kind).toBe("read");
    expect(c.readings[0].signals[0].marker).toBe("mcp__ost-agent__ost_read_tree");
  });

  test("a clarifying question rather than an assumption", () => {
    const c = censusOf(
      windowEndingInFailure([assistant({ type: "tool_use", id: "q1", name: "AskUserQuestion", input: { q: "which rung?" } })]),
    );
    expect(c.uncertain).toBe(1);
    expect(c.readings[0].signals[0].kind).toBe("question");
  });
});

describe("the classifier refuses what only looks like doubt", () => {
  /**
   * The control that decides whether any count out of this file means anything:
   * a caller that said nothing, checked nothing and read nothing must come out
   * confident. Without it every assertion here passes against a classifier that
   * always answers "doubt".
   */
  test("a caller that hedged nothing, checked nothing and read nothing is confident", () => {
    const c = censusOf(windowEndingInFailure([user("go on"), assistant({ type: "text", text: "Filing the next one." })]));
    expect(c.readable).toBe(1);
    expect(c.uncertain).toBe(0);
    expect(c.confident).toBe(1);
    expect(c.readings[0].signals).toEqual([]);
  });

  test("the bare hedges of ordinary prose are not doubt about the call", () => {
    for (const excluded of UNCERTAINTY_RULE.excludedMarkers) {
      const c = censusOf(windowEndingInFailure([], [{ type: "text", text: `This ${excluded} work out fine.` }]));
      expect(c.uncertain, excluded).toBe(0);
    }
  });

  test("a shell command is not a read — the census cannot tell a read from a write", () => {
    const c = censusOf(
      windowEndingInFailure([assistant({ type: "tool_use", id: "b1", name: "Bash", input: { command: "cat x" } })]),
    );
    expect(c.uncertain).toBe(0);
  });

  test("a read issued after the failing call, in the same message, did not precede it", () => {
    const call = assistant(
      { type: "tool_use", id: "t1", name: "ost_create_node", input: {} },
      { type: "tool_use", id: "r1", name: "Read", input: { file: "x" } },
    );
    const c = preflightUncertaintyCensus([failureOf(call, "ost_create_node")], [session("s", [call])]);
    expect(c.readable).toBe(1);
    expect(c.uncertain).toBe(0);
  });

  test("a read further back than the window is not a check on this call", () => {
    const read = assistant({ type: "tool_use", id: "r1", name: "ost_read_tree", input: {} });
    const filler = Array.from({ length: UNCERTAINTY_RULE.lookbackEntries + 1 }, (_, i) => user(`turn ${i}`));
    const c = censusOf(windowEndingInFailure([read, ...filler]));
    expect(c.uncertain).toBe(0);
  });

  test("a user's words are not the caller's — only the caller can hedge", () => {
    const c = censusOf(windowEndingInFailure([user("I'm not sure this will be allowed")]));
    expect(c.uncertain).toBe(0);
  });
});

describe("the join from trace to transcript", () => {
  test("a failed call with no session record is unread, never confident", () => {
    const orphan: UsageEvent = {
      ts: "2020-01-01T00:00:00.000Z", tool: "ost_annotate", ok: false, ms: 1, surface: "cli-tool", argBytes: 10,
    };
    const c = preflightUncertaintyCensus([orphan], []);
    expect(c.failed).toBe(1);
    expect(c.unread).toBe(1);
    expect(c.readable).toBe(0);
    expect(c.confident).toBe(0);
    expect(c.share).toBeNull();
    expect(c.readings[0].unread).toBe("no session record");
    expect(c.readings[0].uncertain).toBeUndefined();
  });

  test("identical failures seconds apart stay distinct calls", () => {
    // Four refusals nine seconds apart is the real corpus's signature; without a
    // consumed-once join the nearest transcript call would answer for all four.
    const calls = [0, 1, 2, 3].map((i) =>
      assistant({ type: "tool_use", id: `t${i}`, name: "ost_create_node", input: { i } }),
    );
    const c = preflightUncertaintyCensus(
      calls.map((call) => failureOf(call, "ost_create_node")),
      [session("s", calls)],
    );
    expect(c.readable).toBe(4);
    expect(new Set(c.readings.map((r) => r.entry)).size).toBe(4);
  });

  test("an MCP-prefixed transcript name is the same tool as the bare traced one", () => {
    const c = censusOf(windowEndingInFailure([]));
    expect(c.readable).toBe(1);
  });

  test("a call that succeeded is not in the denominator", () => {
    const call = assistant({ type: "tool_use", id: "t1", name: "ost_create_node", input: {} });
    const ok: UsageEvent = { ...failureOf(call, "ost_create_node"), ok: true };
    const c = preflightUncertaintyCensus([ok], [session("s", [call])]);
    expect(c.calls).toBe(1);
    expect(c.failed).toBe(0);
    expect(c.readable).toBe(0);
  });

  test("a call outside the join window is not the same call", () => {
    const call = assistant({ type: "tool_use", id: "t1", name: "ost_create_node", input: {} });
    const late = failureOf(call, "ost_create_node");
    late.ts = new Date(Date.parse(late.ts) + UNCERTAINTY_RULE.joinWindowMs + 1).toISOString();
    const c = preflightUncertaintyCensus([late], [session("s", [call])]);
    expect(c.unread).toBe(1);
  });
});

describe("what the census admits it could not see", () => {
  test("an emptied reasoning block is reported as no prose, not as no hedge", () => {
    const c = censusOf(windowEndingInFailure([assistant({ type: "thinking", thinking: "", signature: "abc" })]));
    expect(c.readings[0].prose).toEqual({ chars: 0, thinkingBlocks: 1, redactedThinkingBlocks: 1 });
    expect(c.proseless).toBe(1);
    expect(formatPreflightCensus(c)).toContain("carried no caller prose at all");
  });

  test("prose the caller did write is counted, and the window is not called blind", () => {
    const c = censusOf(windowEndingInFailure([], [{ type: "text", text: "Filing four opportunities." }]));
    expect(c.readings[0].prose?.chars).toBeGreaterThan(0);
    expect(c.proseless).toBe(0);
  });

  test("a share that moves with the window says so instead of standing on its bound", () => {
    // A read sitting between two rungs of the ladder: inside the widest window,
    // outside the narrowest.
    const read = assistant({ type: "tool_use", id: "r1", name: "ost_read_tree", input: {} });
    const gap = Array.from({ length: 9 }, (_, i) => user(`turn ${i}`));
    const c = censusOf(windowEndingInFailure([read, ...gap]));
    expect(c.boundDecides).toBe(true);
    expect(c.sensitivity.map((s) => s.lookbackEntries)).toEqual([...UNCERTAINTY_RULE.sensitivityLadder]);
    expect(new Set(c.sensitivity.map((s) => s.uncertain)).size).toBeGreaterThan(1);
    expect(formatPreflightCensus(c)).toContain("THE WINDOW DECIDES THIS");
  });

  test("a share that does not move with the window says that too", () => {
    const c = censusOf(windowEndingInFailure([], [{ type: "text", text: "I'm not sure, but here goes." }]));
    expect(c.boundDecides).toBe(false);
    expect(formatPreflightCensus(c)).toContain("Bound: stable");
  });

  test("the report leads with coverage and never claims to settle desirability", () => {
    const rendered = formatPreflightCensus(censusOf(windowEndingInFailure([])));
    expect(rendered).toContain("Coverage:");
    expect(rendered).toContain("whether a validating call would have been MADE");
  });
});

// ── the corpus this test exists to count ─────────────────────────────────────

/**
 * The committed corpus, cut from this project's own usage trace and the session
 * transcripts that cover it. `PROVENANCE.md` records how, and the fixture was
 * verified to reproduce the live corpus's census at every rung of the ladder
 * before it was committed.
 */
function committedCorpus() {
  const events = fs
    .readFileSync(path.join(fixtureDir, "usage-events.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as UsageEvent);
  const sessions = readTranscriptSessions(fixtureDir).filter((s) => s.id !== "usage-events");
  return { events, sessions };
}

describe("the census over the committed corpus", () => {
  const { events, sessions } = committedCorpus();
  const census = preflightUncertaintyCensus(events, sessions);

  test("the fixture keeps more entries than the widest rung of the ladder reads", () => {
    // Otherwise a rung would read across a gap the cut created and report an
    // adjacency that never happened in the session.
    expect(Math.max(...UNCERTAINTY_RULE.sensitivityLadder)).toBeLessThanOrEqual(FIXTURE_WINDOW_BEFORE);
    expect(UNCERTAINTY_RULE.lookbackEntries).toBeLessThanOrEqual(FIXTURE_WINDOW_BEFORE);
  });

  test("it reports what fraction of failed calls were preceded by a hedge or a read", () => {
    expect(census.calls).toBe(1125);
    expect(census.failed).toBe(68);
    expect(census.readable).toBe(6);
    expect(census.uncertain).toBe(0);
    expect(census.confident).toBe(6);
    expect(census.share).toBe(0);
    expect(census.byKind).toEqual({ hedge: 0, check: 0, read: 0, question: 0 });
  });

  test("62 of the 68 failures have no session record and are counted neither way", () => {
    expect(census.unread).toBe(62);
    // All of them CLI calls, which is the shape of the gap: the trace records
    // every surface, the transcripts only cover the one with a session.
    expect(census.readings.filter((r) => r.unread).every((r) => r.surface === "cli-tool")).toBe(true);
  });

  test("the six readable failures are all the same refusal — a rung the caller declared", () => {
    const readable = census.readings.filter((r) => !r.unread);
    expect(readable).toHaveLength(6);
    expect(readable.every((r) => r.tool === "ost_create_node")).toBe(true);
    expect(readable.every((r) => /cannot declare/.test(r.err))).toBe(true);
  });

  test("five of the six windows carry no caller prose, so no hedge could have been seen", () => {
    expect(census.proseless).toBe(5);
    const blind = census.readings.filter((r) => !r.unread && r.prose?.chars === 0);
    expect(blind.some((r) => (r.prose?.redactedThinkingBlocks ?? 0) > 0)).toBe(true);
  });

  test("the count is decided by the window, and the census says so on its face", () => {
    // 0 at six entries back, all six at twenty-four. Whatever a reader concludes
    // from the share, this is the sentence that has to be read with it.
    expect(census.sensitivity).toEqual([
      { lookbackEntries: 2, uncertain: 0 },
      { lookbackEntries: 6, uncertain: 0 },
      { lookbackEntries: 12, uncertain: 2 },
      { lookbackEntries: 24, uncertain: 6 },
    ]);
    expect(census.boundDecides).toBe(true);
    expect(formatPreflightCensus(census)).toContain("THE WINDOW DECIDES THIS");
  });
});
