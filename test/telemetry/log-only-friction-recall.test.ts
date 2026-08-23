/**
 * "Thirty-day log sample for existing signal" — the assumption test beneath
 * "Mine tool errors and retries from run logs".
 *
 * The solution proposes deriving friction from machine records instead of prose:
 * failed tool calls, retries, validation rejections, aggregated across runs. Its
 * feasibility assumption is that **the logs already contain enough signal without
 * new instrumentation**, and the test fixed a threshold before anything was counted:
 * ≥3 recurring patterns found, AND ≥2 of them mapping to a product problem a human
 * agrees is worth fixing.
 *
 * This file settles the first clause and refuses the second, which is a ranking the
 * assumption test assigns to a person.
 *
 * ## What it proves, and what it does not
 *
 * The synthetic corpora below prove that the derivation and the two readers behave —
 * a class under the floor is not called recurring, a call with no session is left out
 * of retry detection rather than pooled, a known class on a tool this product does
 * not hold is reported as out of reach rather than as a miss.
 *
 * The reading that bears on the world is `describe("the corpus")`, over
 * `test/fixtures/log-only-friction` — thirty days of one real vault's trace (6,234
 * calls) beside the transcript channel's own account of the same window (1,747
 * friction events across 431 sessions). Its finding is a number the node did not
 * have: **7 of the 27 recurring friction classes the transcript channel found come
 * back from the trace alone**, and of the four that are missing on tools the trace
 * *could* have recorded, every one is a grant refusal the host issued before the
 * call ever reached the process that writes the trace.
 *
 * ## The controls are what keep it honest
 *
 * A derivation that answered "recurring friction" to every event would satisfy any
 * assertion about a corpus made of failures, which is why the fixture carries all
 * 6,234 calls and not the 100 failing ones, and why the class the trace names and
 * the transcript channel does not (`unmatched`) is asserted alongside recall. Both
 * directions are asserted on the synthetic corpora too, and the rule's own shape is
 * pinned, so a later edit to a bar shows up here as a changed expectation rather
 * than as a quietly different finding.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TranscriptSource } from "../../src/adapters/transcript.js";
import {
  classKey,
  declaredFrictionCount,
  deriveFrictionClasses,
  evidenceDirOf,
  formatLogOnlyFrictionRecall,
  knownFrictionClasses,
  LOG_ONLY_FRICTION_RULE,
  logOnlyFrictionRecall,
  normalizeToolName,
  parseKnownFriction,
  readKnownFriction,
  TRACEABLE_TOOLS,
  windowEndingOn,
  type KnownFrictionEvent,
} from "../../src/telemetry/log-only-friction.js";
import type { UsageEvent } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "log-only-friction");

const WINDOW = windowEndingOn("2026-02-28");

function ev(partial: Partial<UsageEvent> & { tool: string; ts: string }): UsageEvent {
  return { ok: true, ms: 1, surface: "mcp", argBytes: 2, ...partial };
}

function known(partial: Partial<KnownFrictionEvent> & { kind: KnownFrictionEvent["kind"] }): KnownFrictionEvent {
  return { tool: "", detail: "", session: "s", timestamp: "2026-02-20T00:00:00.000Z", ...partial };
}

/** The census over hand-built inputs, with a coverage block that matches them. */
function census(trace: UsageEvent[], knownEvents: KnownFrictionEvent[]) {
  return logOnlyFrictionRecall(
    deriveFrictionClasses(trace, WINDOW),
    { events: knownEvents, coverage: { items: 1, events: knownEvents.length, declared: knownEvents.length } },
    WINDOW,
  );
}

describe("the rule this census counts against", () => {
  test("is the one the assumption test fixed, and is pinned so an edit is visible", () => {
    expect(LOG_ONLY_FRICTION_RULE.windowDays).toBe(30);
    expect(LOG_ONLY_FRICTION_RULE.recurrenceFloor).toBe(3);
    expect(LOG_ONLY_FRICTION_RULE.patternsFloor).toBe(3);
    expect(LOG_ONLY_FRICTION_RULE.productProblemFloor).toBe(2);
    expect(LOG_ONLY_FRICTION_RULE.refuses).toMatch(/product problem/);
  });

  test("the window is taken from a supplied day, never from the clock", () => {
    expect(windowEndingOn("2026-02-28")).toEqual({ from: "2026-01-30", to: "2026-02-28" });
    expect(windowEndingOn("2026-02-28", 1)).toEqual({ from: "2026-02-28", to: "2026-02-28" });
  });

  test("the traceable vocabulary is the tool allowlist, not a list restated here", () => {
    expect(TRACEABLE_TOOLS.has("ost_create_node")).toBe(true);
    expect(TRACEABLE_TOOLS.has("ost_flag_humans_required")).toBe(true);
    expect(TRACEABLE_TOOLS.has("vault_init")).toBe(true);
    // The tools the agent spends most of its failures in are not this product's.
    expect(TRACEABLE_TOOLS.has("Bash")).toBe(false);
    expect(TRACEABLE_TOOLS.has("Edit")).toBe(false);
  });
});

describe("naming the same tool the same way", () => {
  test("strips the host's MCP prefix, plugin route included", () => {
    expect(normalizeToolName("mcp__ost-agent__ost_next_work")).toBe("ost_next_work");
    expect(normalizeToolName("mcp__plugin_ost-agent_ost-agent__ost_read_tree")).toBe("ost_read_tree");
    expect(normalizeToolName("ost_next_work")).toBe("ost_next_work");
    // Not an MCP name: left exactly as the transcript saw it.
    expect(normalizeToolName("Bash")).toBe("Bash");
  });
});

describe("deriving classes from the trace alone", () => {
  test("counts failures, denials and repeat calls, and honours the recurrence floor", () => {
    const trace: UsageEvent[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        ev({ tool: "ost_annotate", ts: `2026-02-1${i}T00:00:00.000Z`, ok: false, err: "empty note", session: "a" }),
      ),
      // Twice only — under the floor, so a pattern this census must NOT call recurring.
      ...Array.from({ length: 2 }, (_, i) =>
        ev({ tool: "ost_edit_node", ts: `2026-02-1${i}T01:00:00.000Z`, ok: false, err: "reserved heading", session: "a" }),
      ),
      ev({ tool: "ost_check", ts: "2026-02-11T00:00:00.000Z", ok: false, denied: true, err: "no grant", session: "a" }),
    ];
    const { classes } = deriveFrictionClasses(trace, WINDOW);
    const byKey = new Map(classes.map((c) => [classKey(c), c]));

    expect(byKey.get("tool_error|ost_annotate")).toMatchObject({ occurrences: 3, recurring: true });
    expect(byKey.get("tool_error|ost_edit_node")).toMatchObject({ occurrences: 2, recurring: false });
    expect(byKey.get("permission_denied|ost_check")).toMatchObject({ occurrences: 1, recurring: false });
    // A denial is never also counted as a plain error.
    expect(byKey.has("tool_error|ost_check")).toBe(false);
  });

  test("a repeat is the same tool at the same input SIZE in the same session", () => {
    const trace: UsageEvent[] = [
      ev({ tool: "ost_next_work", ts: "2026-02-10T00:00:00.000Z", session: "a", argBytes: 2 }),
      ev({ tool: "ost_next_work", ts: "2026-02-10T00:01:00.000Z", session: "a", argBytes: 2 }),
      ev({ tool: "ost_next_work", ts: "2026-02-10T00:02:00.000Z", session: "a", argBytes: 2 }),
      // Same tool, same size, DIFFERENT session — a first call, not a repeat.
      ev({ tool: "ost_next_work", ts: "2026-02-10T00:03:00.000Z", session: "b", argBytes: 2 }),
      // Same tool and session, different size — a different call.
      ev({ tool: "ost_next_work", ts: "2026-02-10T00:04:00.000Z", session: "a", argBytes: 99 }),
    ];
    const { classes } = deriveFrictionClasses(trace, WINDOW);
    expect(classes.find((c) => classKey(c) === "retry|ost_next_work")).toMatchObject({ occurrences: 2 });
  });

  test("a call with no session is left out of retry detection and counted saying so", () => {
    const trace: UsageEvent[] = [
      ev({ tool: "ost_status", ts: "2026-02-10T00:00:00.000Z", surface: "cli-tool" }),
      ev({ tool: "ost_status", ts: "2026-02-10T00:01:00.000Z", surface: "cli-tool" }),
      ev({ tool: "ost_status", ts: "2026-02-10T00:02:00.000Z", surface: "cli-tool" }),
    ];
    const { classes, coverage } = deriveFrictionClasses(trace, WINDOW);
    // Pooling them under one blank key would invent two retries across unrelated
    // CLI invocations, which is the number this refusal exists to not report.
    expect(classes.find((c) => c.kind === "retry")).toBeUndefined();
    expect(coverage.retryUnattributable).toBe(3);
  });

  test("events outside the window are not read", () => {
    const trace: UsageEvent[] = [
      ev({ tool: "ost_annotate", ts: "2026-01-29T23:59:59.000Z", ok: false, session: "a" }),
      ev({ tool: "ost_annotate", ts: "2026-01-30T00:00:00.000Z", ok: false, session: "a" }),
    ];
    const { coverage } = deriveFrictionClasses(trace, WINDOW);
    expect(coverage.events).toBe(1);
  });
});

describe("reading the transcript channel's own account back", () => {
  let vault: string;

  beforeEach(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-log-only-friction-"));
  });
  afterEach(() => {
    fs.rmSync(vault, { recursive: true, force: true });
  });

  test("parses the bullet the transcript source actually writes", async () => {
    // Round-tripped through the real writer rather than against a hand-typed line:
    // the reader and the renderer live in different halves of the tree, and a change
    // to `renderBody` has to show up here as a failed parse rather than as a known
    // set that silently shrank.
    const dir = path.join(vault, "sessions");
    fs.mkdirSync(dir, { recursive: true });
    const session = "11111111-2222-3333-4444-555555555555";
    const entries = [
      { message: { content: [{ type: "tool_use", id: "t1", name: "mcp__ost-agent__ost_annotate", input: { a: 1 } }] }, timestamp: "2026-02-10T00:00:00.000Z" },
      { message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "refusing: empty note" }] }, timestamp: "2026-02-10T00:00:01.000Z" },
      { message: { content: [{ type: "tool_use", id: "t2", name: "mcp__ost-agent__ost_annotate", input: { a: 1 } }] }, timestamp: "2026-02-10T00:00:02.000Z" },
    ];
    const file = path.join(dir, `${session}.jsonl`);
    fs.writeFileSync(file, `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
    // The source only harvests sessions that have been quiet for a while.
    const old = Date.now() - 60 * 60_000;
    fs.utimesSync(file, old / 1000, old / 1000);

    const { items } = await new TranscriptSource({ dirs: [{ dir, origin: "a test" }] }).fetchSince(undefined);
    expect(items).toHaveLength(1);

    const parsed = parseKnownFriction(items[0].body, session, items[0].timestamp);
    expect(parsed.map((e) => ({ kind: e.kind, tool: e.tool }))).toEqual([
      { kind: "tool_error", tool: "ost_annotate" },
      { kind: "retry", tool: "ost_annotate" },
    ]);
    expect(declaredFrictionCount(items[0].body)).toBe(2);
  });

  test("a vault that never harvested a transcript reads as no known friction, not a crash", () => {
    const empty = readKnownFriction(evidenceDirOf(vault));
    expect(empty.events).toEqual([]);
    expect(empty.coverage).toEqual({ items: 0, events: 0, declared: 0 });
  });

  test("reads only TRANSCRIPT items out of an evidence folder", () => {
    const dir = evidenceDirOf(vault);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "TRANSCRIPT_abc.md"),
      ["---", "timestamp: '2026-02-20T00:00:00.000Z'", "---", "Session `abc` (x) produced 1 friction events (retry ×1).", "", "- **retry** (Bash): npm test"].join("\n"),
      "utf8",
    );
    // A neighbouring evidence item that is not a transcript, carrying a line shaped
    // like a friction bullet. It must not enter the known set.
    fs.writeFileSync(path.join(dir, "INBOX_note.md"), "- **retry** (Bash): not a session\n", "utf8");

    const read = readKnownFriction(dir);
    expect(read.coverage).toEqual({ items: 1, events: 1, declared: 1 });
    expect(read.events[0]).toMatchObject({ kind: "retry", tool: "Bash", session: "abc" });
  });
});

describe("scoring one record against the other", () => {
  test("a known class on a tool the trace holds, and the trace has it, is recovered", () => {
    const trace = Array.from({ length: 3 }, (_, i) =>
      ev({ tool: "ost_annotate", ts: `2026-02-1${i}T00:00:00.000Z`, ok: false, session: "a" }),
    );
    const c = census(trace, Array.from({ length: 3 }, () => known({ kind: "tool_error", tool: "ost_annotate" })));
    expect(c.recovered).toBe(1);
    expect(c.recall).toBe(1);
    expect(c.inScopeRecall).toBe(1);
    expect(c.missedInScope).toHaveLength(0);
  });

  test("a known class on a tool the trace holds and does not name is a MISS, not out of reach", () => {
    const c = census([], Array.from({ length: 3 }, () => known({ kind: "tool_error", tool: "ost_check" })));
    expect(c.missedInScope.map((v) => v.known.tool)).toEqual(["ost_check"]);
    expect(c.recall).toBe(0);
    expect(c.inScopeRecall).toBe(0);
  });

  test("a known class on a tool this product does not hold is out of reach, not a miss", () => {
    // The distinction is the whole point: counting `Bash` against the derivation
    // would measure the tool allowlist rather than the signal in the trace.
    const c = census([], Array.from({ length: 3 }, () => known({ kind: "tool_error", tool: "Bash" })));
    expect(c.missedInScope).toHaveLength(0);
    expect(c.outOfReach.map((v) => v.reason)).toEqual(["the tool is outside the traced allowlist"]);
    expect(c.recall).toBe(0);
    // No class was in scope at all, so there is no in-scope share to take.
    expect(c.inScopeRecall).toBeNull();
  });

  test("a kind no tool wrapper can observe is out of reach for that reason", () => {
    const c = census([], Array.from({ length: 3 }, () => known({ kind: "interruption", tool: "" })));
    expect(c.outOfReach.map((v) => v.reason)).toEqual(["the trace records no such kind"]);
  });

  test("only recurring classes are compared, on both sides", () => {
    // Two of each: a pattern neither record is willing to call recurring.
    const trace = Array.from({ length: 2 }, (_, i) =>
      ev({ tool: "ost_annotate", ts: `2026-02-1${i}T00:00:00.000Z`, ok: false, session: "a" }),
    );
    const c = census(trace, Array.from({ length: 2 }, () => known({ kind: "tool_error", tool: "ost_annotate" })));
    expect(c.derivedRecurring).toHaveLength(0);
    expect(c.verdicts).toHaveLength(0);
    expect(c.recall).toBeNull();
    expect(c.meetsPatternsFloor).toBe(false);
  });

  test("a derivation that names everything scores a perfect recall and is caught by `unmatched`", () => {
    // The control that matters. This trace fails on four tools the transcript
    // channel never recorded friction on; recall is 1/1 and the census says out
    // loud that four of its five recurring classes have no counterpart.
    const noisy = ["ost_annotate", "ost_create_node", "ost_read_tree", "ost_read_repo", "ost_edit_node"].flatMap((tool) =>
      Array.from({ length: 3 }, (_, i) => ev({ tool, ts: `2026-02-1${i}T00:00:00.000Z`, ok: false, session: "a" })),
    );
    const c = census(noisy, Array.from({ length: 3 }, () => known({ kind: "tool_error", tool: "ost_annotate" })));
    expect(c.recall).toBe(1);
    expect(c.unmatched).toHaveLength(4);
    expect(formatLogOnlyFrictionRecall(c)).toMatch(/Named by the trace and not by the transcript channel: 4/);
  });

  test("the report always prints the clause this census refuses", () => {
    const tools = ["ost_annotate", "ost_create_node", "ost_edit_node"];
    const trace = tools.flatMap((tool) =>
      Array.from({ length: 3 }, (_, i) => ev({ tool, ts: `2026-02-1${i}T00:00:00.000Z`, ok: false, session: "a" })),
    );
    const c = census(
      trace,
      tools.flatMap((tool) => Array.from({ length: 3 }, () => known({ kind: "tool_error", tool }))),
    );
    // Every clause it can compute is met, and it still refuses the one it cannot.
    expect(c.meetsPatternsFloor).toBe(true);
    expect(c.recall).toBe(1);
    expect(formatLogOnlyFrictionRecall(c)).toContain("Not settled: ");
    expect(formatLogOnlyFrictionRecall(c)).toContain(LOG_ONLY_FRICTION_RULE.refuses);
  });

  test("a window with no traced call reports a null recall rather than a clean sweep", () => {
    const c = census([], []);
    expect(c.derivation.events).toBe(0);
    expect(c.recall).toBeNull();
    expect(formatLogOnlyFrictionRecall(c)).toMatch(/no recurring class in this window/);
  });
});

/**
 * The reading that bears on the world. Thirty days of one real vault, both records,
 * cut by `scripts/harvest-log-only-friction-corpus.ts` — see the fixture's
 * `PROVENANCE.md` for what was taken and what it cannot support.
 */
describe("the corpus", () => {
  const readJsonl = <T,>(name: string): T[] =>
    fs
      .readFileSync(path.join(fixtureDir, name), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);

  const corpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as {
    window: { from: string; to: string };
    traceEventsInWindow: number;
    evidenceItemsRead: number;
    knownEventsDeclared: number;
    knownEventsShown: number;
    knownEventsInWindow: number;
  };

  const scored = () => {
    const trace = readJsonl<UsageEvent>("trace.jsonl");
    const knownEvents = readJsonl<KnownFrictionEvent>("known-friction.jsonl");
    return logOnlyFrictionRecall(
      deriveFrictionClasses(trace, corpus.window),
      {
        events: knownEvents,
        coverage: {
          items: corpus.evidenceItemsRead,
          events: corpus.knownEventsShown,
          declared: corpus.knownEventsDeclared,
        },
      },
      corpus.window,
    );
  };

  test("is the thirty-day window it says it is, and carries the successes too", () => {
    expect(corpus.window).toEqual(windowEndingOn("2026-08-23"));
    const trace = readJsonl<UsageEvent>("trace.jsonl");
    expect(trace).toHaveLength(corpus.traceEventsInWindow);
    // All 6,234 calls, not the 100 failing ones. A derivation tuned to answer
    // "recurring friction" to everything would sail through a corpus of positives.
    expect(trace.filter((e) => !e.ok)).toHaveLength(100);
    expect(readJsonl<KnownFrictionEvent>("known-friction.jsonl")).toHaveLength(corpus.knownEventsInWindow);
  });

  test("no evidence item in the known set was capped, so the denominator is not a clipped one", () => {
    expect(corpus.knownEventsShown).toBe(corpus.knownEventsDeclared);
  });

  test("the trace alone yields well over the three recurring patterns the bar asks for", () => {
    const c = scored();
    expect(c.derivedRecurring).toHaveLength(14);
    expect(c.meetsPatternsFloor).toBe(true);
  });

  test("7 of the 27 recurring classes the transcript channel found come back from the trace", () => {
    const c = scored();
    expect(c.verdicts).toHaveLength(27);
    expect(c.recovered).toBe(7);
    expect(c.recall).toBeCloseTo(7 / 27, 10);
    expect(c.outOfReach).toHaveLength(16);
    expect(c.missedInScope).toHaveLength(4);
    // Two thirds of what the trace could in principle have seen, and a quarter of
    // the agent's known friction. The gap between those two numbers is the tool
    // allowlist, not the derivation.
    expect(c.inScopeRecall).toBeCloseTo(7 / 11, 10);
  });

  test("the classes out of reach are dominated by tools this product does not hold", () => {
    const c = scored();
    const byTool = c.outOfReach.filter((v) => v.reason === "the tool is outside the traced allowlist");
    expect(byTool).toHaveLength(15);
    expect(byTool.map((v) => v.known.tool)).toEqual(
      expect.arrayContaining(["Bash", "Edit", "Write", "Glob", "Grep", "Read"]),
    );
    // The one that is out of reach for the other reason: nothing about a clarifying
    // question reaches a tool's `run`, so no wrapper around one could record it.
    expect(c.outOfReach.filter((v) => v.reason === "the trace records no such kind")).toHaveLength(1);
  });

  test("every in-scope miss is a refusal the trace is structurally unable to hold", () => {
    const c = scored();
    // The finding this corpus produced and the node did not have. All four are OST
    // tools on the allowlist — the trace could have recorded them — and every one
    // is a grant refusal issued by the host before the call reached the process
    // that writes the trace.
    expect(c.missedInScope.map((v) => v.known.tool).sort()).toEqual([
      "ost_check",
      "ost_debt",
      "ost_flag_humans_required",
      "ost_status",
    ]);
    for (const v of c.missedInScope) {
      expect(TRACEABLE_TOOLS.has(v.known.tool)).toBe(true);
      expect(v.known.sample).toMatch(/requested permissions to use/);
    }
    // And the field that exists for exactly this — `UsageEvent.denied` — is set on
    // none of the 6,234 calls, because a refused call never reaches the wrapper
    // that would set it. 89 friction events, and the trace holds not one.
    expect(c.derivation.denials).toBe(0);
    expect(c.missedInScope.reduce((n, v) => n + v.known.occurrences, 0)).toBe(89);
    expect(formatLogOnlyFrictionRecall(c)).toMatch(/refusal the host issues before the call reaches it/);
  });

  test("the weaker retry key over-counts rather than under-counts, and the census shows where", () => {
    const c = scored();
    // `session + tool + argBytes` collides where the exact input would not, so the
    // trace reports retry classes the transcript channel never called recurring.
    // The error runs toward over-detection, which costs precision and cannot cost
    // recall — so a retry class the trace fails to name is a real absence.
    expect(c.unmatched.map(classKey)).toContain("retry|ost_read_tree");
    const readTree = c.unmatched.find((x) => classKey(x) === "retry|ost_read_tree");
    const knownEvents = readJsonl<KnownFrictionEvent>("known-friction.jsonl");
    const knownReadTreeRetries = knownFrictionClasses(knownEvents, corpus.window).find(
      (x) => classKey(x) === "retry|ost_read_tree",
    );
    expect(readTree!.occurrences).toBeGreaterThan(knownReadTreeRetries!.occurrences);
  });

  test("166 traced calls carry no session, and the report says so rather than pooling them", () => {
    const c = scored();
    expect(c.derivation.retryUnattributable).toBe(166);
    expect(formatLogOnlyFrictionRecall(c)).toMatch(/166 traced call\(s\) carry no session/);
  });

  test("the report over the real corpus still refuses the human clause", () => {
    // A census that ended on 26% would read as the feasibility question settled.
    // It is not: whether these patterns are product problems is a person's call.
    expect(formatLogOnlyFrictionRecall(scored())).toContain(LOG_ONLY_FRICTION_RULE.refuses);
  });
});
