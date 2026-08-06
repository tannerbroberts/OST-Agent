/**
 * The shipping condition for an interpretive transcript read.
 *
 * The solution node this pins ("A model reads the raw transcript and files what the
 * pattern scan cannot see") states one condition for any version of it shipping at
 * all: *the quotes are attached, so a human can check the reading against the
 * transcript.* A model's account of what an agent was confused about is an
 * assertion about observed material, and without that check a pass can launder the
 * one into the other — permanently, since the vault is append-only.
 *
 * So this file asserts exactly that guard, in both directions: every filed item
 * carries a verbatim quote, and every such quote is locatable in the transcript the
 * item claims to come from. It deliberately asserts NOTHING about the quality of
 * the reading — whether an interpretive read surfaces anything the regex missed is
 * a blind-rating question that needs a person, and green here does not answer it.
 */
import { describe, expect, test } from "vitest";
import {
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  READING_QUESTIONS,
  type ReadingCandidate,
  type TranscriptReader,
  locateQuote,
  readSession,
  renderTranscriptForReading,
  toEvidenceItem,
  verifyReading,
} from "../../src/adapters/transcript-model-reader.js";

/** One JSONL transcript line, in the shape Claude Code writes. */
function line(entry: Record<string, unknown>): string {
  return JSON.stringify({ timestamp: "2026-08-05T12:00:00.000Z", ...entry });
}

function assistantText(text: string): string {
  return line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
}

function userText(text: string): string {
  return line({ type: "user", message: { role: "user", content: text } });
}

function assistantTool(name: string, input: unknown, id = "t1"): string {
  return line({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
}

function toolResult(content: string, isError = false, id = "t1"): string {
  return line({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content }] },
  });
}

/**
 * A session whose real friction is conceptual: the agent adopts a framing, works
 * under it, and abandons it — and nothing in it fails, so the mechanical scan sees
 * an entirely clean session.
 */
const SESSION = [
  userText("Make the rollup count only validated nodes."),
  assistantText(
    "I will treat every node without a recorded result as unvalidated, so the rollup can filter on that field alone.",
  ),
  assistantTool("Read", { file_path: "src/eval/rollup.ts" }),
  toolResult("export function rollup(nodes: Node[]) { … }"),
  assistantText(
    "That was the wrong framing. Validation is a property of the assumption test beneath a node, not of the node itself, so filtering on the node's own field cannot express it.",
  ),
  assistantTool("Read", { file_path: "src/ost/results.ts" }),
  toolResult("export function recordedResult(node: Node) { … }"),
  assistantText("Dropping the node-field approach entirely and reading the test's recorded result instead."),
].join("\n");

const RENDERED = renderTranscriptForReading(SESSION);

/** The exact words the agent used, as they appear in the session. */
const REAL_QUOTE =
  "That was the wrong framing. Validation is a property of the assumption test beneath a node, not of the node itself";

/** The same claim, rewritten. This is what an unchecked reader files. */
const PARAPHRASE =
  "The agent realised that validation belongs to the assumption test rather than to the node, and changed course";

function candidate(over: Partial<ReadingCandidate> = {}): ReadingCandidate {
  return {
    question: "changed_mind",
    finding: "The agent reframed validation from a node field to a property of the test beneath it, mid-session.",
    quote: REAL_QUOTE,
    ...over,
  };
}

function readerReturning(...candidates: ReadingCandidate[]): TranscriptReader {
  return async () => candidates;
}

describe("the transcript the reader is handed", () => {
  test("renders the conceptual turns a pattern scan has no expression for", () => {
    // Nothing in this session errored, retried or asked a question — the three
    // things the mechanical harvester can find. The material is all here.
    expect(RENDERED).toContain("That was the wrong framing");
    expect(RENDERED).toContain("Dropping the node-field approach entirely");
    expect(RENDERED).toContain("[assistant → Read]");
  });

  test("is the same text the quotes are checked against", async () => {
    let handed = "";
    const reading = await readSession("s1", SESSION, async ({ transcript }) => {
      handed = transcript;
      return [candidate()];
    });

    expect(handed).toBe(reading.rendered);
    expect(reading.items).toHaveLength(1);
  });

  test("asks the same fixed questions of every session", async () => {
    let asked: readonly { id: string }[] = [];
    await readSession("s1", SESSION, async ({ questions }) => {
      asked = questions;
      return [];
    });

    expect(asked.map((q) => q.id)).toEqual(READING_QUESTIONS.map((q) => q.id));
  });
});

describe("every filed item carries a quote locatable in its own transcript", () => {
  test("a reading with a verbatim quote is filed, and the quote is found in the transcript", async () => {
    const reading = await readSession("s1", SESSION, readerReturning(candidate()));

    expect(reading.items).toHaveLength(1);
    for (const item of reading.items) {
      expect(item.quote.length).toBeGreaterThanOrEqual(MIN_QUOTE_CHARS);
      expect(locateQuote(item.quote, reading.rendered)).toBe(true);
      expect(RENDERED.replace(/\s+/g, " ")).toContain(item.quote);
    }
  });

  test("a paraphrase is refused, however true it is", async () => {
    const reading = await readSession("s1", SESSION, readerReturning(candidate({ quote: PARAPHRASE })));

    expect(reading.items).toEqual([]);
    expect(reading.rejected.map((r) => r.reason)).toEqual(["quote-not-found"]);
  });

  test("a mixed batch files the traceable claims and refuses the rest", async () => {
    const reading = await readSession(
      "s1",
      SESSION,
      readerReturning(
        candidate(),
        candidate({ question: "abandoned", quote: PARAPHRASE }),
        candidate({
          question: "abandoned",
          finding: "It abandoned the node-field approach and never returned to it.",
          quote: "Dropping the node-field approach entirely and reading the test's recorded result instead.",
        }),
        candidate({ question: "invented_question" }),
      ),
    );

    expect(reading.items.map((i) => i.question)).toEqual(["changed_mind", "abandoned"]);
    expect(reading.rejected.map((r) => r.reason).sort()).toEqual(["quote-not-found", "unknown-question"]);
    // The property the node makes the condition of shipping, over the whole batch.
    for (const item of reading.items) {
      expect(locateQuote(item.quote, reading.rendered)).toBe(true);
    }
  });

  test("a quote is compared word for word, not loosely", () => {
    const nearly = REAL_QUOTE.replace("wrong framing", "wrong framing here");
    const { items, rejected } = verifyReading([candidate({ quote: nearly })], RENDERED);

    expect(items).toEqual([]);
    expect(rejected[0].reason).toBe("quote-not-found");
  });

  test("line breaks and indentation are the only difference tolerated", () => {
    const rewrapped = REAL_QUOTE.replace(/ /g, "\n   ");
    const { items } = verifyReading([candidate({ quote: rewrapped })], RENDERED);

    expect(items).toHaveLength(1);
    expect(locateQuote(items[0].quote, RENDERED)).toBe(true);
  });

  test("a quote too short to trace anything is refused", () => {
    const { items, rejected } = verifyReading([candidate({ quote: "the wrong framing" })], RENDERED);

    expect(items).toEqual([]);
    expect(rejected[0].reason).toBe("quote-too-short");
  });

  test("a missing quote is refused — there is no such thing as a filed item without one", () => {
    const { items, rejected } = verifyReading(
      [candidate({ quote: "" }), candidate({ quote: "   \n  " })],
      RENDERED,
    );

    expect(items).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual(["missing-quote", "missing-quote"]);
  });

  test("an over-long quote is cut to a prefix that is still locatable", async () => {
    const long = [assistantText("A ".repeat(400) + "tail")].join("\n");
    const rendered = renderTranscriptForReading(long);
    const { items } = verifyReading(
      [candidate({ quote: rendered.replace("[assistant] ", "") })],
      rendered,
    );

    expect(items).toHaveLength(1);
    expect(items[0].quote.length).toBe(MAX_QUOTE_CHARS);
    expect(locateQuote(items[0].quote, rendered)).toBe(true);
  });

  test("a quote drawn from an elided middle cannot be filed", async () => {
    const bulk = Array.from({ length: 200 }, (_, i) => assistantText(`Middle turn number ${i} of this long session.`));
    const jsonl = [assistantText("The opening framing of this session."), ...bulk, assistantText("The closing note.")]
      .join("\n");
    const rendered = renderTranscriptForReading(jsonl, 2_000);

    expect(rendered).toContain("characters omitted");
    const { items, rejected } = verifyReading(
      [candidate({ quote: "Middle turn number 120 of this long session." })],
      rendered,
    );

    expect(items).toEqual([]);
    expect(rejected[0].reason).toBe("quote-not-found");
  });

  test("a credential-shaped quote is refused rather than filed masked", () => {
    const jsonl = assistantTool("Bash", { command: "curl -H 'Authorization: Bearer ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012'" });
    const rendered = renderTranscriptForReading(jsonl);
    const { items, rejected } = verifyReading(
      [candidate({ question: "repeated", quote: rendered.replace(/^\[[^\]]+\] /, "") })],
      rendered,
    );

    // Masking it would file a quote that is no longer the text it cites; verbatim
    // and redacted cannot both hold, so the fail-closed answer is to drop it.
    expect(items).toEqual([]);
    expect(rejected[0].reason).toBe("quote-holds-secret");
  });
});

describe("filing", () => {
  test("the filed body carries every quote, and calls the reading an assertion", async () => {
    const reading = await readSession("s1", SESSION, readerReturning(candidate()));
    const item = toEvidenceItem(reading, "2026-08-05T12:00:00.000Z");

    expect(item).not.toBeNull();
    expect(item!.source).toBe("TRANSCRIPT:s1#reading");
    expect(item!.body).toContain(REAL_QUOTE);
    expect(item!.body).toMatch(/assertion/i);
    // The laundering this guard exists to stop: the reading is not observed behavior.
    expect(item!.body).toMatch(/must not be counted as observed/i);
  });

  test("filing re-checks the quotes and refuses one that does not hold", async () => {
    const reading = await readSession("s1", SESSION, readerReturning(candidate()));
    reading.items.push({ question: "abandoned", finding: "Smuggled past verification.", quote: PARAPHRASE });

    expect(() => toEvidenceItem(reading, "2026-08-05T12:00:00.000Z")).toThrow(/not in that transcript/i);
  });

  test("a reading that produced nothing files nothing", async () => {
    const reading = await readSession("s1", SESSION, readerReturning(candidate({ quote: PARAPHRASE })));

    expect(toEvidenceItem(reading, "2026-08-05T12:00:00.000Z")).toBeNull();
  });

  test("a reader that fails costs no items and throws nothing", async () => {
    const reading = await readSession("s1", SESSION, async () => {
      throw new Error("model call failed");
    });

    expect(reading.items).toEqual([]);
    expect(toEvidenceItem(reading, "2026-08-05T12:00:00.000Z")).toBeNull();
  });
});
