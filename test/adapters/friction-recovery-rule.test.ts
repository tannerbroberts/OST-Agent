/**
 * "Blind-rate ten records as typo or friction and compare against the recovery rule"
 *
 * Ten session fixtures below, each labelled by reading the scenario in plain English
 * — did the session recover within a turn or two, or did it cost several attempts,
 * change what the session did next, or end the work outright — before checking what
 * {@link extractFriction}'s mechanical rule says about it. The label is the blind
 * rating; the assertion is the comparison.
 *
 * The rule only ever sees "did the same tool succeed within the next couple of
 * calls" — it cannot read intent, so a session that quietly abandoned a goal and one
 * that deliberately changed direction both come out "friction" the same way a session
 * that truly gave up would. That is the blind spot this tree already names under
 * "The friction that matters leaves no error behind"; it is not something a green
 * suite here settles.
 */
import { describe, expect, test } from "vitest";
import { extractFriction, type FrictionEvent } from "../../src/adapters/transcript.js";

function line(entry: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: "2026-08-19T00:00:00.000Z", ...entry });
}

function toolUse(id: string, name: string, input: unknown): string {
  return line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
  });
}

function toolResult(id: string, content: string, isError: boolean): string {
  return line({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] },
  });
}

/** One failed-then-maybe-recovered call, with a fresh tool_use id per attempt. */
function call(id: string, name: string, input: unknown, ok: boolean, resultText: string): string[] {
  return [toolUse(id, name, input), toolResult(id, resultText, !ok)];
}

type Rating = "typo" | "friction";

interface Record_ {
  label: string;
  rating: Rating;
  jsonl: string[];
}

const RECORDS: Record_[] = [
  {
    label: "T1 — same tool, next call, succeeds immediately",
    rating: "typo",
    jsonl: [...call("1", "Bash", { command: "ls /nope" }, false, "no such file"), ...call("2", "Bash", { command: "ls /correct" }, true, "file.txt")],
  },
  {
    label: "T2 — an unrelated tool intervenes, then the same tool succeeds on turn two",
    rating: "typo",
    jsonl: [
      ...call("1", "Bash", { command: "ls /nope" }, false, "no such file"),
      ...call("2", "Read", { file_path: "/README.md" }, true, "readme contents"),
      ...call("3", "Bash", { command: "ls /correct" }, true, "file.txt"),
    ],
  },
  {
    label: "T3 — a bad Edit corrected on the very next call",
    rating: "typo",
    jsonl: [
      ...call("1", "Edit", { old_string: "foo", new_string: "bar" }, false, "old_string not found in file"),
      ...call("2", "Edit", { old_string: "food", new_string: "bard" }, true, "edited"),
    ],
  },
  {
    label: "T4 — recovers exactly at the edge of the window (second subsequent call)",
    rating: "typo",
    jsonl: [
      ...call("1", "Bash", { command: "npm test" }, false, "1 test failed"),
      ...call("2", "Bash", { command: "npm test" }, false, "1 test failed"),
      ...call("3", "Bash", { command: "npm test -- --fix" }, true, "all green"),
    ],
  },
  {
    label: "T5 — Read fails, an unrelated check runs, then the corrected Read succeeds",
    rating: "typo",
    jsonl: [
      ...call("1", "Read", { file_path: "/src/idnex.ts" }, false, "no such file"),
      ...call("2", "Bash", { command: "ls /src" }, true, "index.ts"),
      ...call("3", "Read", { file_path: "/src/index.ts" }, true, "file contents"),
    ],
  },
  {
    label: "F1 — costs several attempts: succeeds only on the third subsequent call",
    rating: "friction",
    jsonl: [
      ...call("1", "Bash", { command: "npm run build" }, false, "type error at line 1"),
      ...call("2", "Bash", { command: "npm run build" }, false, "type error at line 1"),
      ...call("3", "Bash", { command: "npm run build" }, false, "type error at line 2"),
      ...call("4", "Bash", { command: "npm run build" }, true, "build succeeded"),
    ],
  },
  {
    label: "F2 — ends the work: the failed call is the last thing in the session",
    rating: "friction",
    jsonl: [...call("1", "Bash", { command: "deploy prod" }, false, "connection refused")],
  },
  {
    label: "F3 — abandoned: the session moves on to different tools and never retries",
    rating: "friction",
    jsonl: [
      ...call("1", "Bash", { command: "psql -c 'select 1'" }, false, "connection refused"),
      ...call("2", "Read", { file_path: "/config.yaml" }, true, "config contents"),
      ...call("3", "Grep", { pattern: "db_host" }, true, "db_host: localhost"),
      ...call("4", "Write", { file_path: "/notes.md" }, true, "written"),
    ],
  },
  {
    label: "F4 — costs four attempts before the session gives up on that path entirely",
    rating: "friction",
    jsonl: [
      ...call("1", "Bash", { command: "curl https://api.example.com" }, false, "timeout"),
      ...call("2", "Bash", { command: "curl https://api.example.com" }, false, "timeout"),
      ...call("3", "Bash", { command: "curl https://api.example.com" }, false, "timeout"),
      ...call("4", "Bash", { command: "curl https://api.example.com" }, false, "timeout"),
      ...call("5", "Read", { file_path: "/README.md" }, true, "readme contents"),
    ],
  },
  {
    label: "F5 — two different tools fail back to back and neither recovers before the session ends",
    rating: "friction",
    jsonl: [
      ...call("1", "Bash", { command: "ls /nope" }, false, "no such file"),
      ...call("2", "Read", { file_path: "/also-missing" }, false, "no such file"),
    ],
  },
];

describe("the recovery rule against ten blind-rated records", () => {
  // Judged by the FIRST error in each record — the one the blind rating is about.
  // A story like F1 (several attempts) or T4 (recovers right at the window edge)
  // necessarily contains later tool_errors of its own, each correctly judged
  // against what follows *it*; asserting on those too would check the window
  // arithmetic twice under a different name rather than the rule against the
  // rating.
  test.each(RECORDS)("$label rates as $rating", ({ rating, jsonl }) => {
    const events = extractFriction(jsonl.join("\n"));
    const first = events.find((e) => e.kind === "tool_error");

    expect(first).toBeDefined();
    expect(first!.recovery).toBe(rating === "typo" ? "recovered" : "friction");
  });

  test("agreement across all ten records is total", () => {
    const disagreements: string[] = [];
    for (const r of RECORDS) {
      const first = extractFriction(r.jsonl.join("\n")).find((e) => e.kind === "tool_error");
      const ruleSaysTypo = first?.recovery === "recovered";
      const blindSaysTypo = r.rating === "typo";
      if (ruleSaysTypo !== blindSaysTypo) disagreements.push(r.label);
    }
    expect(disagreements).toEqual([]);
  });
});

describe("recovery only classifies tool_error — other kinds are untouched", () => {
  test("a denied permission carries no recovery verdict", () => {
    const jsonl = [
      toolUse("1", "Bash", { command: "rm -rf /" }),
      toolResult("1", "The user doesn't want to proceed with this tool use.", true),
    ].join("\n");

    const events = extractFriction(jsonl);

    expect(events.map((e) => e.kind)).toEqual(["permission_denied"]);
    expect(events[0].recovery).toBeUndefined();
  });
});
