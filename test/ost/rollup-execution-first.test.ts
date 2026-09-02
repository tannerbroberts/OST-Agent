/**
 * The rollup must not report an unrun test as progress.
 *
 * Every bucket line used to open `built 13% (3/24 runnable), tested 0`. Two
 * things are wrong with that and they compound. The word `built` is the strongest
 * claim this vocabulary has — the work is done — and it was being applied to a
 * ratio over instrument coverage, which says only that a spec exists and exits
 * zero. And the count of tests anybody actually answered was put last, where a
 * reader's eye finishes, as a bare `0`.
 *
 * The compounding is the point. Writing a test, attaching a command and watching
 * an exit code are all reachable by an unattended pass; recording a result is a
 * human's `ost-agent result` and nothing else can do it. So the percentage was
 * the one figure free to move, and it moved — while `tested 0` held on every
 * bucket for the life of the tree. A day of instrumenting rendered as a day of
 * progress.
 *
 * So the properties here are about the SHAPE of the report rather than about any
 * behaviour of the tree, and they are three:
 *
 *   1. No line calls instrument coverage `built`.
 *   2. Every bucket's executed count is at least as prominent as its readiness
 *      count — measured as position, because that is what prominence is in a
 *      plain-text line a script pastes into a prompt.
 *   3. Both survive. Readiness is real work and the honest accounting is not
 *      achieved by hiding it; a rollup that dropped readiness would trade one
 *      distortion for another and this file fails it for that too.
 *
 * The load-bearing test is the last one in the file: instrumenting a test and
 * then observing it green moves readiness and moves the green count, and leaves
 * the executed count at zero. That is the accounting claim stated as an
 * assertion — an unrun test is not progress, however ready it is.
 */
import { describe, expect, test } from "vitest";
import { renderRollup, rollupTree } from "../../src/eval/rollup.js";
import type { OstNode } from "../../src/ost/node.js";

const INSTRUMENT = "npx vitest run test/shim.test.ts";

const node = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: [],
  links: [],
  body: "prose",
  ...extra,
});

/** Outcome → two buckets, each with a solution and a test, so "every bucket" has something to quantify over. */
function tree(overrides: Partial<Record<string, Partial<OstNode>>> = {}): OstNode[] {
  const mk = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode =>
    node(title, layer, { links, ...(overrides[title] ?? {}) });
  return [
    mk("Root", "Outcome", ["Tools fail", "Nobody can tell what happened"]),
    mk("Tools fail", "Opportunity", ["My shell breaks"]),
    mk("My shell breaks", "Opportunity", ["Ship a shim"]),
    mk("Ship a shim", "Solution", ["Run it on five machines"]),
    mk("Run it on five machines", "AssumptionTest"),
    mk("Nobody can tell what happened", "Opportunity", ["Write a log"]),
    mk("Write a log", "Solution", ["Read the log back a week later"]),
    mk("Read the log back a week later", "AssumptionTest"),
  ];
}

/** The per-bucket rows — indented four spaces and carrying the layer counts. */
function bucketLines(rendered: string): string[] {
  return rendered.split("\n").filter((l) => /^ {4}\d+ opportunity, /.test(l));
}

const recordedResult = (verdict: "supported" | "refuted") => ({
  body: `prose\n\n## Results\n- 2026-01-01 **${verdict}** (ran by Tanner) — it went that way`,
});

const observedGreen = {
  instrument: INSTRUMENT,
  body: `prose\n\n## Instrument Log\n- 2026-01-01 **green** (exit 0) \`${INSTRUMENT}\``,
};

describe("the rollup does not call instrument coverage built", () => {
  test("no line anywhere in the render uses the word", () => {
    // Asserted over the whole render rather than over the bucket rows, because
    // the word migrating to a summary line would be the same claim in a quieter
    // place. `built` means the work is done; nothing here has standing to say so.
    const rendered = renderRollup(rollupTree(tree({ "Run it on five machines": observedGreen })));
    expect(rendered).not.toMatch(/\bbuilt\b/i);
  });

  test("and no line expresses instrument coverage as a percentage at all", () => {
    // The percentage was the moving part. Renaming it would leave a reader with
    // the same number rising for the same reason under a politer label.
    const rendered = renderRollup(rollupTree(tree({ "Run it on five machines": observedGreen })));
    for (const line of bucketLines(rendered)) expect(line).not.toMatch(/\d+%/);
  });
});

describe("execution is at least as prominent as readiness", () => {
  test("every bucket states both, with the executed count first", () => {
    const rendered = renderRollup(rollupTree(tree({ "Run it on five machines": observedGreen })));
    const rows = bucketLines(rendered);
    expect(rows).toHaveLength(2); // control: the fixture really did file two buckets

    for (const line of rows) {
      const executed = line.search(/\bexecuted \d+ of \d+/);
      const readiness = line.search(/\bready to run \d+ of \d+/);
      expect(executed, `no executed count in: ${line}`).toBeGreaterThanOrEqual(0);
      expect(readiness, `no readiness count in: ${line}`).toBeGreaterThanOrEqual(0);
      expect(executed, `readiness outranks execution in: ${line}`).toBeLessThan(readiness);
    }
  });

  test("the tree's executed count is stated above the buckets, not at the end of each line", () => {
    const rendered = renderRollup(rollupTree(tree({ "Run it on five machines": observedGreen })));
    const executedAt = rendered.search(/^Executed: \d+ of \d+ test\(s\)/m);
    const firstBucket = rendered.indexOf(bucketLines(rendered)[0]);
    expect(executedAt).toBeGreaterThanOrEqual(0);
    expect(executedAt).toBeLessThan(firstBucket);
  });
});

describe("readiness survives — it is real work and is reported as itself", () => {
  test("both numbers appear with the values the nodes carry", () => {
    const r = rollupTree(tree({ "Run it on five machines": observedGreen }));
    const rendered = renderRollup(r);

    // The bucket holding the instrumented test: one of one ready, one green.
    expect(rendered).toContain("ready to run 1 of 1 (1 observed green)");
    // Its sibling has a test and no instrument, which is not readiness of zero
    // quality — it is a test nobody has defined a command for, and the line says
    // so rather than reporting it as a failure to build.
    expect(rendered).toContain("ready to run 0 of 1 (0 observed green)");

    expect(r.execution.instrumented).toBe(1);
    expect(r.execution.green).toBe(1);
  });

  test("the tree-level line names readiness and refuses to call it an answer", () => {
    const rendered = renderRollup(rollupTree(tree({ "Run it on five machines": observedGreen })));
    expect(rendered).toMatch(/Readiness, kept separate: 1 of 2 name a runnable command, 1 of those observed green/);
  });
});

describe("what moves the executed count, and what does not", () => {
  test("a recorded result moves it, and refuted dissent is still execution", () => {
    const supported = rollupTree(tree({ "Run it on five machines": recordedResult("supported") }));
    expect(supported.execution.executed).toBe(1);
    expect(renderRollup(supported)).toContain("Executed: 1 of 2 test(s) carry a result somebody recorded");

    const refuted = rollupTree(tree({ "Run it on five machines": recordedResult("refuted") }));
    expect(refuted.execution.executed).toBe(1);
    expect(refuted.execution.refuted).toBe(1);
    // A test that came back against its claim was run. It counts, and the
    // dissent is named rather than folded away.
    expect(renderRollup(refuted)).toContain("Executed: 1 of 2 test(s) carry a result somebody recorded (1 refuted)");
  });

  test("attaching a command does not, and neither does the command passing", () => {
    // This is the whole node, as one assertion. Both steps below are things an
    // unattended pass can do; neither answers the question the test asks.
    const bare = rollupTree(tree());
    expect(bare.execution.instrumented).toBe(0);
    expect(bare.execution.executed).toBe(0);

    const instrumented = rollupTree(tree({ "Run it on five machines": { instrument: INSTRUMENT } }));
    expect(instrumented.execution.instrumented).toBe(1);
    expect(instrumented.execution.executed).toBe(0);

    const green = rollupTree(tree({ "Run it on five machines": observedGreen }));
    expect(green.execution.green).toBe(1);
    expect(green.execution.executed).toBe(0);

    // And the report says it, rather than leaving it to be inferred from a zero.
    expect(renderRollup(green)).toContain("not one test in this tree has been executed");
  });

  test("a tree with nothing executed says so once, and stops saying it when something is", () => {
    expect(renderRollup(rollupTree(tree()))).toContain("not one test in this tree has been executed");
    expect(renderRollup(rollupTree(tree({ "Run it on five machines": recordedResult("supported") })))).not.toContain(
      "not one test in this tree has been executed",
    );
  });
});

describe("the tree-level census counts each node once", () => {
  test("a test reachable from two buckets is not counted twice", () => {
    // `subtree` is multi-parent safe on purpose and both buckets count the
    // shared node, so summing the rows would inflate the total. The census is
    // computed over the tree instead, and this pins the difference.
    const shared = [
      node("Root", "Outcome", { links: ["Tools fail", "Nobody can tell what happened"] }),
      node("Tools fail", "Opportunity", { links: ["Ship a shim"] }),
      node("Nobody can tell what happened", "Opportunity", { links: ["Ship a shim"] }),
      node("Ship a shim", "Solution", { links: ["Run it on five machines"] }),
      node("Run it on five machines", "AssumptionTest", recordedResult("supported")),
    ];
    const r = rollupTree(shared);
    expect(r.buckets.map((b) => b.tested)).toEqual([1, 1]); // counted under both, correctly
    expect(r.execution.tests).toBe(1);
    expect(r.execution.executed).toBe(1); // and once at the top
  });
});
