/**
 * The drift window: on the collisions already recorded, how many run steps stood
 * between the moment the ground moved and the moment the run acted on stale text?
 *
 * The solution under test is a sentinel that samples `HEAD` and the mtimes of the
 * files a run has read *between steps*, and interrupts when the fingerprint moves.
 * Sampling between steps only helps if there were steps to sample in, so the
 * assumption test beneath it fixed the bar before anyone counted: **in at least 3
 * of the recorded collision sessions, two or more run steps must separate the
 * first detectable movement from the first act on stale content.** Fewer than that
 * and the sentinel is sampling into a window too narrow to help.
 *
 * **The controls are what carry this file.** A reader that called every session a
 * collision, or every step a movement, would satisfy any assertion about a corpus
 * that came out well. So the synthetic cases below run first and in both
 * directions: each signal fires on an entry built to carry it, and fails to fire on
 * one built to look like it and not be it. Only then is the number over the real
 * corpus worth reading.
 *
 * `DRIFT_WINDOW_RULE` is committed in `src/runner/drift-window.ts`, and this test
 * asserts its shape as well as its output, so a later edit shows up here as a
 * changed expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readTranscriptSessions } from "../../src/telemetry/preflight.js";
import {
  COLLISION_PHRASE,
  DRIFT_WINDOW_RULE,
  driftWindowCensus,
  formatDriftWindowCensus,
  measureWindow,
  replaySession,
  type SessionMention,
} from "../../src/runner/drift-window.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "drift-window");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the bar was fixed before the corpus was counted", () => {
  test("it is the one the assumption test states: 3 sessions, 2 steps apart", () => {
    expect(DRIFT_WINDOW_RULE.minSteps).toBe(2);
    expect(DRIFT_WINDOW_RULE.bar).toBe(3);
  });

  test("the ladder brackets the bar, so the verdict can be read either side of it", () => {
    expect(DRIFT_WINDOW_RULE.stepLadder).toContain(DRIFT_WINDOW_RULE.minSteps);
    expect(Math.min(...DRIFT_WINDOW_RULE.stepLadder)).toBeLessThan(DRIFT_WINDOW_RULE.minSteps);
    expect(Math.max(...DRIFT_WINDOW_RULE.stepLadder)).toBeGreaterThan(DRIFT_WINDOW_RULE.minSteps);
  });

  test("only tools that write a file through held text can record a collision", () => {
    // The scoping that separates 8 real collisions from 42 sessions that merely
    // say the words. A tool that cannot write cannot fail this way.
    expect([...DRIFT_WINDOW_RULE.editTools]).toEqual(["Edit", "MultiEdit", "NotebookEdit", "Write"]);
  });
});

// ── the reader: synthetic entries, in both directions ────────────────────────

function toolUse(id: string, name: string, file?: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, ...(file ? { input: { file_path: file } } : {}) }] },
  });
}

function toolResult(id: string, content: string, isError = false): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] },
  });
}

function externalEdit(filename: string): string {
  return JSON.stringify({ type: "attachment", attachment: { type: "edited_text_file", filename, snippet: "1\tirrelevant" } });
}

function replay(...entries: string[]) {
  return replaySession({ session: { id: "synthetic", jsonl: entries.join("\n") }, origin: "synthetic" });
}

const DRIFTED = "The file /repo/a.md has been updated successfully. (note: the file had been modified on disk since you last read it — the edit applied cleanly, but the file contains other changes not in your context.)";
const CURRENT = "The file /repo/a.md has been updated successfully. (file state is current in your context — no need to Read it back)";
const REFUSED = "File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.";
const FAILED_MATCH = "<tool_use_error>String to replace not found in file.\nString: (`src/security/tools.ts:504`)</tool_use_error>";

describe("a step the record proves the ground moved at", () => {
  test("the harness reporting a tracked file edited outside the run", () => {
    const r = replay(toolUse("1", "Read", "/repo/a.md"), toolResult("1", "..."), externalEdit("/repo/a.md"));
    expect(r.movements).toEqual([{ step: 1, kind: "external-edit", file: "/repo/a.md" }]);
  });

  test("an edit that applied over changes the run had never seen", () => {
    const r = replay(toolUse("1", "Edit", "/repo/a.md"), toolResult("1", DRIFTED));
    expect(r.movements).toEqual([{ step: 0, kind: "applied-over-drift", file: "/repo/a.md" }]);
  });

  test("an edit refused outright because the file moved after the read", () => {
    const r = replay(toolUse("1", "Edit", "/repo/a.md"), toolResult("1", REFUSED, true));
    expect(r.movements).toEqual([{ step: 0, kind: "refused-stale-read", file: "/repo/a.md" }]);
  });
});

describe("a step that looks like movement and is not", () => {
  test("the ordinary success note, which says the opposite", () => {
    const r = replay(toolUse("1", "Edit", "/repo/a.md"), toolResult("1", CURRENT));
    expect(r.movements).toEqual([]);
  });

  test("a Bash result quoting the drift note — output about drift is not drift", () => {
    const r = replay(toolUse("1", "Bash"), toolResult("1", `grep -rn "..." .\n${DRIFTED}`));
    expect(r.movements).toEqual([]);
  });

  test("an attachment of some other kind", () => {
    const other = JSON.stringify({ type: "attachment", attachment: { type: "read_truncation_notice", banner: "..." } });
    expect(replay(toolUse("1", "Read", "/repo/a.md"), toolResult("1", "..."), other).movements).toEqual([]);
  });
});

describe("a step the run acted on stale content at", () => {
  test("an edit that failed to find the text it was holding", () => {
    const r = replay(toolUse("1", "Edit", "/repo/a.md"), toolResult("1", FAILED_MATCH, true));
    expect(r.staleActs).toEqual([{ step: 0, file: "/repo/a.md" }]);
  });
});

describe("a step that carries the phrase and is not a collision", () => {
  test("the tree handing its own node text back — 51 of the 91 matches in this corpus", () => {
    // `ost_next_work` returns nodes, and this vault has nodes *about* this failure.
    // A reader that scanned text would count the tree describing the bug as the bug.
    const r = replay(toolUse("1", "mcp__ost-agent__ost_next_work"), toolResult("1", `title: ${FAILED_MATCH}`));
    expect(r.staleActs).toEqual([]);
    expect(r.mentions).toEqual([{ step: 0, tool: "mcp__ost-agent__ost_next_work" }]);
  });

  test("a grep that went looking for the phrase and found it", () => {
    const r = replay(toolUse("1", "Bash"), toolResult("1", FAILED_MATCH));
    expect(r.staleActs).toEqual([]);
    expect(r.mentions).toHaveLength(1);
  });

  test("an edit result that mentions the phrase without failing", () => {
    const r = replay(toolUse("1", "Edit", "/repo/a.md"), toolResult("1", `updated. was: ${FAILED_MATCH}`, false));
    expect(r.staleActs).toEqual([]);
  });
});

describe("the window is measured in run steps, and only in run steps", () => {
  test("entries that are not tool calls do not move the count", () => {
    const noise = JSON.stringify({ type: "system", subtype: "turn_duration", content: null });
    const r = replay(
      toolUse("1", "Read", "/repo/a.md"),
      toolResult("1", "..."),
      externalEdit("/repo/a.md"),
      noise,
      noise,
      toolUse("2", "Bash"),
      toolResult("2", "..."),
      toolUse("3", "Edit", "/repo/a.md"),
      toolResult("3", FAILED_MATCH, true),
    );
    expect(r.stepCount).toBe(3);
    expect(measureWindow(r)?.windowSteps).toBe(1);
  });

  test("movement after the stale act is not a warning, and is not counted as one", () => {
    const r = replay(
      toolUse("1", "Edit", "/repo/a.md"),
      toolResult("1", FAILED_MATCH, true),
      externalEdit("/repo/a.md"),
    );
    const w = measureWindow(r)!;
    expect(w.movement).toBeNull();
    expect(w.verdict).toBe("unseen");
  });

  test("movement one step ahead is movement the sentinel had no room for", () => {
    const r = replay(
      toolUse("1", "Edit", "/repo/a.md"),
      toolResult("1", DRIFTED),
      toolUse("2", "Edit", "/repo/a.md"),
      toolResult("2", FAILED_MATCH, true),
    );
    expect(measureWindow(r)!.verdict).toBe("too-late");
  });

  test("a session with no failed edit has no window to measure", () => {
    expect(measureWindow(replay(toolUse("1", "Bash"), toolResult("1", "ok")))).toBeNull();
  });

  test("the same-file reading ignores movement in a file that never failed", () => {
    const r = replay(
      toolUse("1", "Read", "/repo/other.ts"),
      toolResult("1", "..."),
      externalEdit("/repo/other.ts"),
      toolUse("2", "Bash"),
      toolResult("2", "..."),
      toolUse("3", "Bash"),
      toolResult("3", "..."),
      toolUse("4", "Edit", "/repo/a.md"),
      toolResult("4", FAILED_MATCH, true),
    );
    const w = measureWindow(r)!;
    // An external edit is reported before the next call, so it anchors to the step
    // a sentinel sampling ahead of that call would have caught it at.
    expect(w.movement).toEqual({ step: 1, kind: "external-edit", file: "/repo/other.ts" });
    expect(w.windowSteps).toBe(2);
    expect(w.verdict).toBe("room");
    expect(w.sameFileWindowSteps).toBeNull();
  });
});

// ── the corpus this test exists to count ─────────────────────────────────────

/**
 * The committed corpus, cut from every transcript on the machine that produced
 * this vault by `scripts/harvest-drift-corpus.ts`. `PROVENANCE.md` records how,
 * including the session it excludes — the one that built this census — and what
 * the cut cannot support.
 */
function committedCorpus() {
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as {
    transcriptsRead: number;
    duplicateTranscripts: number;
    excludedSessions: string[];
    sessions: SessionMention[];
  };
  const origins = new Map(meta.sessions.map((s) => [s.sessionId, s.origin]));
  const replays = readTranscriptSessions(fixtureDir).map((session) =>
    replaySession({ session, origin: origins.get(session.id) ?? "unlabelled" }),
  );
  return { meta, replays };
}

describe("the census over the committed corpus", () => {
  const { meta, replays } = committedCorpus();
  const census = driftWindowCensus(replays, { transcriptsRead: meta.transcriptsRead, mentioned: meta.sessions });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.transcriptsRead).toBe(561);
    expect(census.mentioningSessions).toBe(42);
    expect(census.collisionSessions).toBe(8);
    expect(replays).toHaveLength(8);
  });

  test("34 of the 42 sessions say the words without the failure ever happening", () => {
    // The finding that decides what the denominator is. Scanning transcript text
    // for the error would have counted this vault's own nodes about the error, and
    // the greps that went looking for them, as five times more collisions than
    // occurred.
    const collisions = meta.sessions.filter((s) => s.collision);
    expect(collisions).toHaveLength(8);
    expect(meta.sessions.length - collisions.length).toBe(34);
    expect(census.mentionsByTool).toEqual({
      "mcp__ost-agent__ost_next_work": 51,
      Read: 25,
      Edit: 11,
      Bash: 4,
    });
    // Every match from a tool that cannot write a file is the record talking about
    // the failure. Only the `Edit` ones can be the failure.
    const cannotWrite = 51 + 25 + 4;
    expect(cannotWrite).toBeGreaterThan(census.mentionsByTool.Edit * 7);
  });

  test("the threshold the assumption test fixed is met: 4 sessions, not 3", () => {
    expect(census.withRoom).toBe(4);
    expect(census.withRoom).toBeGreaterThanOrEqual(DRIFT_WINDOW_RULE.bar);
    expect(census.meetsBar).toBe(true);
  });

  test("the four windows are wide, not marginal — 8, 14, 21 and 97 steps", () => {
    const rooms = census.windows.filter((w) => w.verdict === "room");
    expect(rooms.map((w) => w.windowSteps).sort((a, b) => a! - b!)).toEqual([8, 14, 21, 97]);
    // Not one collision was warned about too late to sample. The failure mode the
    // threshold guards against — movement arriving inside the last step — is absent
    // from this corpus entirely.
    expect(census.tooLate).toBe(0);
  });

  test("half the collisions record no movement at all, and that is coverage", () => {
    // A transcript is not an mtime log; it shows drift only when a tool happened to
    // report it. These four say nothing either way and are counted in the
    // denominator rather than against the sentinel.
    expect(census.unseen).toBe(4);
    const unseen = census.windows.filter((w) => w.verdict === "unseen");
    expect(unseen.filter((w) => w.origin.startsWith("subagent"))).toHaveLength(3);
    // The subagent blind spot: the harness files its external-edit notice with the
    // parent session, so a subagent has no movement signal in the record at all.
    expect(unseen.every((w) => w.movement === null)).toBe(true);
  });

  test("the verdict survives every rung up to eight steps, then stops", () => {
    expect(census.stepLadder.map((r) => [r.minSteps, r.withRoom, r.meetsBar])).toEqual([
      [1, 4, true],
      [2, 4, true],
      [4, 4, true],
      [8, 4, true],
      [16, 2, false],
    ]);
  });

  test("THE READING DECIDES THIS, and the census says so rather than picking one", () => {
    // The sentinel under test interrupts on any movement — it samples every file
    // the run has read, not only the one it is about to write — so the headline is
    // the unrestricted reading. But had the bar been written about movement in the
    // failing file, the same corpus would answer 2 and miss the bar. That is a
    // fact about the threshold's wording, and it belongs next to the green.
    expect(census.withRoomSameFile).toBe(2);
    expect(census.meetsBarSameFile).toBe(false);
    expect(census.readingDecides).toBe(true);
    expect(formatDriftWindowCensus(census)).toContain("THE READING DECIDES THIS");
  });

  test("the report leads with coverage and never claims firing would have helped", () => {
    const rendered = formatDriftWindowCensus(census);
    expect(rendered).toContain("Coverage:");
    expect(rendered).toContain("that is coverage, not a still ground");
    expect(rendered).toContain("It does not say firing helps");
  });
});

// ── the reader against the real record, not a synthetic one ──────────────────

describe("the session this opportunity was written from", () => {
  const { meta, replays } = committedCorpus();
  const observed = replays.find((r) => r.sessionId === "424486ec-3489-4b53-8e2b-012232d221ab")!;

  test("it is the collision the tree recorded, with the window it was reconstructed by hand from", () => {
    const w = measureWindow(observed)!;
    expect(w.staleAct).toBe(47);
    expect(w.movement).toEqual({ step: 39, kind: "applied-over-drift", file: expect.stringContaining("v1-readiness.md") });
    expect(w.windowSteps).toBe(8);
    // Same file, so this one is a window under either reading.
    expect(w.sameFileWindowSteps).toBe(8);
  });

  test("the corpus excludes the session that built it", () => {
    expect(meta.excludedSessions).toEqual(["768f36cf-a860-4353-b789-9643cd30397a"]);
    expect(meta.sessions.map((s) => s.sessionId)).not.toContain(meta.excludedSessions[0]);
  });

  test("the committed transcripts are reductions of the real ones, not summaries of them", () => {
    // Every tool call keeps its position, so the step distance measured here is the
    // distance in the original run. The reduction only truncates result text to the
    // window the reader looks at.
    expect(observed.stepCount).toBe(74);
    const jsonl = fs.readFileSync(path.join(fixtureDir, `${observed.sessionId}.jsonl`), "utf8");
    const results = jsonl
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
      .filter((b: { type: string }) => b.type === "tool_result");
    expect(results.every((b: { content: string }) => b.content.length <= DRIFT_WINDOW_RULE.resultHeadChars)).toBe(true);
    // …and the truncation costs nothing: every marker sits in the first line of a
    // result, so a cut at 300 characters loses no signal the reader would have read.
    expect(results.some((b: { content: string }) => COLLISION_PHRASE.test(b.content))).toBe(true);
  });
});
