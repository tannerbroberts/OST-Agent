import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  TranscriptSource,
  defaultTranscriptDir,
  extractFriction,
  redactSecrets,
} from "../../src/adapters/transcript.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-transcript-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One JSONL transcript line, in the shape Claude Code writes. */
function line(entry: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: "2026-07-24T20:00:00.000Z", ...entry });
}

function assistantTool(name: string, input: unknown): string {
  return line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input }] },
  });
}

function toolResult(content: string, isError: boolean): string {
  return line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", is_error: isError, content }],
    },
  });
}

/** Write a transcript file and backdate it so it counts as a finished session. */
function writeSession(id: string, lines: string[], ageMinutes = 120): void {
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  const when = new Date(Date.now() - ageMinutes * 60_000);
  fs.utimesSync(file, when, when);
}

describe("extractFriction", () => {
  test("reports a failed tool call with the tool that failed", () => {
    const jsonl = [assistantTool("Bash", { command: "ls /nope" }), toolResult("Exit code 1: no such file", true)].join(
      "\n",
    );

    const events = extractFriction(jsonl);

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("tool_error");
    expect(events[0].tool).toBe("Bash");
    expect(events[0].detail).toContain("no such file");
  });

  test("quotes the error line rather than the stdout that preceded it", () => {
    const noisy = [
      "Exit code 1",
      ...Array.from({ length: 12 }, (_, i) => `drwxr-xr-x  tanner  staff  ordinary-listing-line-${i}`),
      "zsh: no matches found: /Users/tanner/dev/ost*",
    ].join("\n");
    const jsonl = [assistantTool("Bash", { command: "ls ~/dev/ost*" }), toolResult(noisy, true)].join("\n");

    const events = extractFriction(jsonl);

    expect(events[0].detail).toContain("no matches found");
  });

  test("ignores tool calls that succeed", () => {
    const jsonl = [assistantTool("Read", { file_path: "/a" }), toolResult("file contents", false)].join("\n");

    expect(extractFriction(jsonl)).toHaveLength(0);
  });

  test("reports a repeated identical tool call as a retry", () => {
    const jsonl = [
      assistantTool("Bash", { command: "npm test" }),
      toolResult("ok", false),
      assistantTool("Bash", { command: "npm test" }),
      toolResult("ok", false),
    ].join("\n");

    const events = extractFriction(jsonl);

    expect(events.map((e) => e.kind)).toEqual(["retry"]);
    expect(events[0].tool).toBe("Bash");
  });

  test("reports an interruption by the user", () => {
    const jsonl = line({
      type: "user",
      message: { role: "user", content: "[Request interrupted by user for tool use]" },
    });

    const events = extractFriction(jsonl);

    expect(events.map((e) => e.kind)).toEqual(["interruption"]);
  });

  test("reports a denied permission separately from an ordinary error", () => {
    const jsonl = [
      assistantTool("Bash", { command: "rm -rf /" }),
      toolResult("The user doesn't want to proceed with this tool use.", true),
    ].join("\n");

    const events = extractFriction(jsonl);

    expect(events.map((e) => e.kind)).toEqual(["permission_denied"]);
  });

  test("reports the agent stopping to ask the user a question", () => {
    const jsonl = assistantTool("AskUserQuestion", { questions: [{ question: "Which vault?" }] });

    const events = extractFriction(jsonl);

    expect(events.map((e) => e.kind)).toEqual(["clarifying_question"]);
    expect(events[0].detail).toContain("Which vault?");
  });

  test("survives malformed lines without losing the rest of the session", () => {
    const jsonl = ["not json at all", assistantTool("Bash", { command: "x" }), toolResult("boom", true)].join("\n");

    expect(extractFriction(jsonl).map((e) => e.kind)).toEqual(["tool_error"]);
  });
});

describe("redactSecrets", () => {
  test("masks API-key-shaped strings", () => {
    const masked = redactSecrets("export ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(masked).not.toContain("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(masked).toContain("[redacted]");
  });

  test("masks bearer tokens and leaves ordinary prose alone", () => {
    expect(redactSecrets("Authorization: Bearer abcDEF123456ghijkl")).toContain("[redacted]");
    expect(redactSecrets("the build failed on line 12")).toBe("the build failed on line 12");
  });

  /**
   * The keyword rule (`secret: <8+ chars>`) is the only pattern here that can fire on
   * English, and the inbox carries customer verbatims into append-only records the
   * model then reasons from — a mangled sentence is permanent and load-bearing. The
   * value's terminator is what separates an assignment from a sentence: an assignment
   * runs to the end of the line or to a structural delimiter, a sentence's next word
   * is followed by more words.
   */
  describe("the keyword rule does not eat customer prose", () => {
    test.each([
      "secret: customers do not trust us",
      "Their password = something memorable",
      "api_key: documentation is the thing they cannot find",
      "One admin told us the secret = onboarding is broken",
      "The secret: patience.", // a sentence-final period is not a value terminator
      "Password: Requirements are the top support ticket",
    ])("leaves %j exactly as written", (prose) => {
      expect(redactSecrets(prose)).toBe(prose);
    });
  });

  describe("the keyword rule still masks assignments", () => {
    test.each([
      ["a dictionary-word password at end of line", "password: swordfish", "swordfish"],
      ["a hex value", "api_key: 8f3a9c2b1d4e5f6a", "8f3a9c2b1d4e5f6a"],
      ["a quoted value", 'password: "hunter22"', "hunter22"],
      ["an inline JSON field", '{"password": "hunter22", "user": "bob"}', "hunter22"],
      ["a base64 value with padding", "secret: aGVsbG8gd29ybGQxMjM0NQ==", "aGVsbG8"],
      ["one line of many", "user: bob\nPASSWORD=Tr0ub4dor3xy\nhost: db", "Tr0ub4dor3xy"],
    ])("masks %s", (_label, input, leaked) => {
      const masked = redactSecrets(input);
      expect(masked).not.toContain(leaked);
      expect(masked).toContain("[redacted]");
    });

    test("keeps the key and its quotes so a masked JSON field stays parseable", () => {
      expect(redactSecrets('{"password": "hunter22", "user": "bob"}')).toBe(
        '{"password": "[redacted]", "user": "bob"}',
      );
    });
  });

  test("masking twice is a no-op", () => {
    // Every adapter that already redacts hands its body to writeEvidence, which
    // redacts again. A second pass that re-matched its own output would mangle all
    // of them.
    const once = redactSecrets(`export KEY=sk-ant-api03-${"A".repeat(36)}\npassword: swordfish\n`);
    expect(redactSecrets(once)).toBe(once);
  });
});

describe("defaultTranscriptDir", () => {
  test("derives Claude Code's session directory from a project path", () => {
    expect(defaultTranscriptDir("/Users/tanner/dev/OST-Agent")).toBe(
      path.join(os.homedir(), ".claude", "projects", "-Users-tanner-dev-OST-Agent"),
    );
  });
});

describe("TranscriptSource", () => {
  test("emits one evidence item per finished session that contained friction", async () => {
    writeSession("sess-a", [assistantTool("Bash", { command: "ls /nope" }), toolResult("no such file", true)]);
    const src = new TranscriptSource({ dir });

    const { items } = await src.fetchSince(null);

    expect(items.map((i) => i.id)).toEqual(["TRANSCRIPT:sess-a"]);
    expect(items[0].source).toBe("TRANSCRIPT:sess-a");
    expect(items[0].body).toContain("tool_error");
    expect(items[0].body).toContain("no such file");
  });

  test("does not re-emit a session it has already harvested", async () => {
    writeSession("sess-a", [assistantTool("Bash", { command: "ls /nope" }), toolResult("no such file", true)]);
    const src = new TranscriptSource({ dir });

    const first = await src.fetchSince(null);
    const second = await src.fetchSince(first.cursor);

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(0);
  });

  test("skips a session that is still being written to", async () => {
    writeSession("live", [assistantTool("Bash", { command: "ls /nope" }), toolResult("no such file", true)], 0);
    const src = new TranscriptSource({ dir });

    const { items } = await src.fetchSince(null);

    expect(items).toHaveLength(0);
  });

  test("emits nothing for a session with no friction", async () => {
    writeSession("clean", [assistantTool("Read", { file_path: "/a" }), toolResult("contents", false)]);
    const src = new TranscriptSource({ dir });

    expect((await src.fetchSince(null)).items).toHaveLength(0);
  });

  test("redacts secrets and never mutates the transcript", async () => {
    writeSession("sess-secret", [
      assistantTool("Bash", { command: "curl -H 'Authorization: Bearer abcDEF123456ghijkl'" }),
      toolResult("401 with Bearer abcDEF123456ghijkl", true),
    ]);
    const before = fs.readFileSync(path.join(dir, "sess-secret.jsonl"), "utf8");
    const src = new TranscriptSource({ dir });

    const { items } = await src.fetchSince(null);

    expect(items[0].body).not.toContain("abcDEF123456ghijkl");
    expect(fs.readFileSync(path.join(dir, "sess-secret.jsonl"), "utf8")).toBe(before);
  });

  test("caps how many friction events one session can contribute", async () => {
    const noisy: string[] = [];
    for (let i = 0; i < 40; i++) {
      noisy.push(assistantTool("Bash", { command: `try-${i}` }), toolResult(`failure ${i}`, true));
    }
    writeSession("noisy", noisy);
    const src = new TranscriptSource({ dir, maxEventsPerSession: 5 });

    const { items } = await src.fetchSince(null);

    expect(items[0].body.match(/^- /gm) ?? []).toHaveLength(5);
    expect(items[0].body).toContain("40 friction events");
  });

  test("missing transcript directory yields no items", async () => {
    const src = new TranscriptSource({ dir: path.join(dir, "does-not-exist") });
    expect((await src.fetchSince(null)).items).toHaveLength(0);
  });
});
