/**
 * How buried was each of the three firings, and does the wording hypothesis survive it?
 *
 * The assumption test: *"Count how buried each of the three firings was before
 * assuming the wording was at fault."* Its lane is compute-only — how much output
 * surrounded a line in a recorded session is a count over a file, and nobody's
 * recollection improves on it. Its pre-committed bar, fixed by a human before
 * anything was measured:
 *
 * > the content hypothesis survives only if all three fired with **fewer than 10
 * > unrelated output lines** in the surrounding window. At 10 or more for any of
 * > them, that firing was buried, wording was never the binding constraint for
 * > it, and the solution should be re-aimed at placement.
 *
 * ## What this file asserts, and why that is not the bar itself
 *
 * The bar is a decision rule, not a pass condition. A test that went red when the
 * hypothesis died would be a gate on the hypothesis rather than an experiment
 * about it — and the assumption test says outright that killing the hypothesis is
 * the outcome worth the whole cost, because the placement remedy and the wording
 * remedy do not overlap and building the wrong one costs a full cycle. So what is
 * asserted here is the **measurement** and the **verdict the bar yields from it**,
 * each pinned to an exact number rather than an inequality. That follows
 * `test/knowledge/corrections-file-size.test.ts`, whose finding was also "over the
 * bar": pinning the number is what makes a later drift a failure instead of a
 * silent re-reading.
 *
 * ## The answer
 *
 * **All three firings were buried, and the wording hypothesis is falsified for
 * all three.** At the primary window — the reader's screen, 12 lines each side —
 * the unrelated-line counts are **22, 12 and 13** against a bar of 10.
 *
 * Three things came out of the count that the node did not say:
 *
 * 1. **They agree on the verdict and disagree sharply on degree.** The assumption
 *    test expected the interesting outcome to be disagreement — "one buried firing
 *    and two isolated ones would mean neither hypothesis explains all three". What
 *    happened is neither: all three are buried, but the corrections-ledger firing
 *    crosses the bar at a radius of **6** and the wall-clock one only at **10**.
 *    The first was buried by *other gates* — its own report is 2 lines inside a
 *    6-line block naming three different failing test files. The second was buried
 *    by *arrival*: eleven of the twelve lines above it are task-notification
 *    plumbing and a `gh run list` result.
 * 2. **One firing's verdict depends on the attribution rule and the file says so.**
 *    Under the generous rule — every line of a block holding a related line counts
 *    as related — the ENOTEMPTY firing scores 8 at the primary radius and crosses
 *    only at 14. It is the one firing whose burial is arguable, and it is left
 *    arguable here rather than resolved by picking the rule that answers it.
 * 3. **The distance to the next thing the reader had to decide spans two orders of
 *    magnitude:** 203 lines, 14 lines, 2 lines. The corrections-ledger firing had
 *    203 reader lines of output between it and the next moment the session said
 *    anything in prose. Nothing in the node predicted that spread, and it is the
 *    measure that most directly names what placement would have to fix.
 *
 * What a falsified verdict does **not** settle: it establishes that the messages
 * were competing with a screenful of unrelated output, not that better wording
 * would have made no difference on an empty screen. This test can kill the
 * content hypothesis; it cannot confirm it, and it cannot rank the remedies.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  BURIAL_BAR,
  GATE_FIRINGS_2026_08_06,
  SCREEN_RADIUS,
  attributeLines,
  densityCurve,
  findFiring,
  measureFiring,
  readerLines,
  verdict,
} from "../../src/telemetry/gate-signal-density.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test/fixtures/gate-signal-density");
const SESSION = "89ac8277-29ce-4d80-827e-cefea0bebabf";

const transcript = fs.readFileSync(path.join(fixtureDir, `${SESSION}.jsonl`), "utf8");
const corpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as {
  sessionId: string;
  readerLines: number;
  readerLinesInOriginal: number;
  screenRadius: number;
  firings: { key: string; index: number; linesToNextProse: number }[];
};
const lines = readerLines(transcript);
const spec = (key: string) => {
  const found = GATE_FIRINGS_2026_08_06.find((f) => f.key === key);
  if (!found) throw new Error(`no firing spec named ${key}`);
  return found;
};

describe("the reader stream this counts over", () => {
  test("flattening keeps only what a reader read", () => {
    const synthetic = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "not output" },
            { type: "text", text: "one\n\ntwo" },
            { type: "tool_use", name: "Bash", input: { command: "ls" } },
          ],
        },
      }),
      "{ not json",
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", content: "test\tRun npm test -- x\t2026-08-06T13:39:04.1152666Z [31mred[0m" },
          ],
        },
      }),
    ].join("\n");
    const flat = readerLines(synthetic);
    // Thinking is gone, the blank line is gone, the torn record is skipped, the
    // CI prefix and the ANSI escape are stripped, and the tool call is one line.
    expect(flat.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "assistant_text:one",
      "assistant_text:two",
      'tool_use:$ Bash {"command":"ls"}',
      "tool_result:red",
    ]);
    // Every content block is its own block, so continuation cannot cross from a
    // header into the next tool's output.
    expect(new Set(flat.map((l) => l.block)).size).toBe(3);
  });

  test("the committed reduction moved not one line of the session", () => {
    // The harvester flattens the original transcript and the reduction with the
    // same function and records both counts. Line counts are the measurement, so
    // a reduction that truncated a tool result would be a census over a different
    // session. 2,349,408 bytes became 644,933 with the reader stream identical.
    expect(corpus.sessionId).toBe(SESSION);
    expect(corpus.readerLines).toBe(corpus.readerLinesInOriginal);
    expect(lines.length).toBe(corpus.readerLines);
    expect(lines.length).toBe(6554);
  });

  test("each firing is located by its failing line, not by a line number", () => {
    // The wall-clock gate prints a green line for the same test file 287 reader
    // lines before it fires. A pattern written against the file name would have
    // found that one.
    const green = lines.findIndex((l) => /✓ test\/mcp\/wall-clock-budget\.test\.ts/.test(l.text));
    expect(green).toBe(3555);
    const found = GATE_FIRINGS_2026_08_06.map((f) => findFiring(lines, f));
    expect(found).toEqual([3336, 3842, 6312]);
    expect(found).toEqual(corpus.firings.map((f) => f.index));
  });
});

describe("the pre-committed bar, and the window it is applied in", () => {
  test("the bar is the human's 10 and the window is a 25-line screen", () => {
    // Pinned so that moving either is a visible commit rather than a tuning. The
    // bar came from the assumption test before anything was measured; the radius
    // is the classic 24-line terminal, the smallest screen anyone reads on, which
    // makes it the choice most favourable to the hypothesis under test.
    expect(BURIAL_BAR).toBe(10);
    expect(SCREEN_RADIUS).toBe(12);
    expect(corpus.screenRadius).toBe(SCREEN_RADIUS);
  });

  test("burial only ever grows with the window, so the flip radius is well defined", () => {
    for (const f of GATE_FIRINGS_2026_08_06) {
      for (const mode of ["strict", "generous"] as const) {
        const curve = densityCurve(lines, f, 40, mode);
        expect(curve.length).toBe(40);
        for (let i = 1; i < curve.length; i++) {
          expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
        }
      }
    }
  });

  test("the generous rule never counts more noise than the strict one", () => {
    // If it did, the robustness check would not be a robustness check.
    for (const f of GATE_FIRINGS_2026_08_06) {
      const strict = measureFiring(lines, f, { mode: "strict" });
      const generous = measureFiring(lines, f, { mode: "generous" });
      expect(generous.unrelated).toBeLessThanOrEqual(strict.unrelated);
    }
  });
});

describe("how buried each of the three firings was", () => {
  test("corrections-ledger quiet-window — 22 unrelated lines, buried by two other gates", () => {
    const d = measureFiring(lines, spec("corrections-ledger-quiet-window"));
    expect([d.unrelatedBefore, d.unrelatedAfter, d.unrelated]).toEqual([12, 10, 22]);
    // Every one of the twelve lines above it is unrelated: the tail of a
    // full-suite run that failed three files. Its own report is two lines inside
    // a six-line block naming three different failing test files, which is why it
    // crosses the bar at a radius of 6 — the tightest burial of the three.
    //
    // Worth naming, because it is a placement fault the window measure only
    // implies: this firing was never visible in the run that produced it. That
    // run was piped through `tail -30`, so the reader saw "Test Files 3 failed"
    // and nothing about which three. Everything above the firing is the tail of a
    // different command's output, and the firing itself only exists because the
    // session then ran a second command to grep the names back out.
    expect(d.flipRadius).toBe(6);
    expect(measureFiring(lines, spec("corrections-ledger-quiet-window"), { mode: "generous" }))
      .toMatchObject({ unrelated: 16, flipRadius: 6 });
    expect(verdict(d)).toBe("falsified");
  });

  test("wall-clock budget (Z3) — 12 unrelated lines, buried by how it arrived", () => {
    const d = measureFiring(lines, spec("wall-clock-budget-z3"));
    expect([d.unrelatedBefore, d.unrelatedAfter, d.unrelated]).toEqual([11, 1, 12]);
    // Asymmetric, and the asymmetry is the story: eleven of the twelve lines above
    // it are Monitor task-notification plumbing and a `gh run list` result, while
    // the twelve below are its own report and the diagnosis. It was not buried in
    // its own output — it was buried in the noise of the notification that
    // delivered it. This is the firing that then cost a week.
    expect(d.flipRadius).toBe(10);
    expect(measureFiring(lines, spec("wall-clock-budget-z3"), { mode: "generous" }))
      .toMatchObject({ unrelated: 12, flipRadius: 10 });
    expect(verdict(d)).toBe("falsified");
  });

  test("commit.test.ts ENOTEMPTY — 13 strict, 8 generous: the one firing whose burial is arguable", () => {
    const strict = measureFiring(lines, spec("commit-enotempty"));
    expect([strict.unrelatedBefore, strict.unrelatedAfter, strict.unrelated]).toEqual([12, 1, 13]);
    expect(strict.flipRadius).toBe(9);
    expect(verdict(strict)).toBe("falsified");
    // Under the generous rule the four `question(s), budget` CI log lines sitting
    // directly above the error join the block that contains it, and the count
    // drops to 8 — under the bar. This is the whole disagreement between the two
    // rules, it lands on one firing, and it is recorded rather than resolved.
    const generous = measureFiring(lines, spec("commit-enotempty"), { mode: "generous" });
    expect([generous.unrelated, generous.flipRadius]).toEqual([8, 14]);
    expect(verdict(generous)).toBe("survives");
  });

  test("the verdict on the wording hypothesis: falsified for all three", () => {
    const verdicts = GATE_FIRINGS_2026_08_06.map((f) => verdict(measureFiring(lines, f)));
    expect(verdicts).toEqual(["falsified", "falsified", "falsified"]);
    // Reported as three, never as an average — the assumption test asked for that
    // explicitly, because an average of 22, 12 and 13 would hide that one of them
    // is buried twice as deep as the others.
    expect(GATE_FIRINGS_2026_08_06.map((f) => measureFiring(lines, f).unrelated)).toEqual([
      22, 12, 13,
    ]);
    // And they cross the bar at three different radii. The bar's verdict is the
    // same for all three; the degree is not, and a solution re-aimed at placement
    // has three different amounts of work to do.
    const flips = GATE_FIRINGS_2026_08_06.map((f) => measureFiring(lines, f).flipRadius);
    expect(flips).toEqual([6, 10, 9]);
    // The sensitivity, stated rather than left for a reader to derive: the
    // smallest flip radius is 6, so all three survive the bar together only at a
    // radius of 5 or less — an 11-line screen, which is not a screen anyone has.
    // There is no plausible window in which the wording hypothesis lives.
    expect(Math.min(...(flips as number[]))).toBe(6);
  });
});

describe("how far each firing stood from the next thing the reader had to decide", () => {
  test("203 lines, 14 lines, 2 lines", () => {
    const distances = GATE_FIRINGS_2026_08_06.map((f) => measureFiring(lines, f).linesToNextProse);
    expect(distances).toEqual([203, 14, 2]);
    expect(distances).toEqual(corpus.firings.map((f) => f.linesToNextProse));
    // The second measure the assumption test asked for, and the one the node did
    // not predict. The corrections-ledger firing scrolled past 203 further lines
    // of output before the session said anything in prose at all — no wording
    // survives that. The ENOTEMPTY firing was two lines from a reading, and got
    // one: "a different failure this time", filed as a flake.
  });
});

describe("the attribution rules do what the corpus says they do", () => {
  test("strict continuation runs forward inside a block and never backward", () => {
    // The four CI log lines above the ENOTEMPTY error are in the same tool result
    // as the error itself and belong to a different test's stdout. Backward
    // propagation would hand them to this gate and halve its burial score.
    const f = spec("commit-enotempty");
    const at = findFiring(lines, f);
    const related = attributeLines(lines, f, "strict");
    expect(lines.slice(at - 4, at).every((l) => /question\(s\), budget/.test(l.text))).toBe(true);
    expect(related.slice(at - 4, at)).toEqual([false, false, false, false]);
    // Forward, the FAIL header's indented detail is claimed.
    expect(related[at]).toBe(true);
    expect(related[at + 1]).toBe(true);
  });

  test("a line naming another test file is never absorbed into this gate's report", () => {
    const f = spec("corrections-ledger-quiet-window");
    const at = findFiring(lines, f);
    const related = attributeLines(lines, f, "generous");
    const neighbours = lines.slice(at + 1, at + 3);
    expect(neighbours.map((l) => l.text.match(/test\/[\w/.-]+\.test\.ts/)![0])).toEqual([
      "test/release/readiness-counts.test.ts",
      "test/release/module-reachability.test.ts",
    ]);
    expect(related.slice(at + 1, at + 3)).toEqual([false, false]);
  });

  test("a firing the stream does not contain is an error, not a zero", () => {
    // A census that cannot read its subject must not report a clean result.
    expect(() =>
      measureFiring(readerLines(""), GATE_FIRINGS_2026_08_06[0]),
    ).toThrow(/is not in this stream/);
  });
});
