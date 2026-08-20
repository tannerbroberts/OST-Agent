/**
 * Do the three reflection questions reach every pass output, each bound to a
 * named node in that pass?
 *
 * The assumption test this file instruments ("Do the three reflection questions
 * catch a builder misunderstanding the pass output missed") says what green
 * means and what it does not. Green: all three questions reach the pass output,
 * each bound to the solution and test of THAT pass rather than asked in the
 * abstract, and an output that omits one or asks it unbound fails. Green does
 * NOT mean the questions catch anything — a real builder misreading a real
 * brief is a person's measurement and stays with a human.
 *
 * Two surfaces are covered, the same division the neighbouring files keep:
 * the renderer and its audit (`src/loop/reflection.ts`) are exercised directly,
 * and `examples/automation/build-pass.sh` — the one pass output a builder in
 * this loop actually reads — is read off disk, because no generator stands
 * behind it and this file is the only thing between it and a silent regression.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { OstNode } from "../../src/ost/node.js";
import {
  auditReflection,
  REFLECTION_QUESTIONS,
  reflectionBinding,
  renderReflectionGauge,
  type ReflectionBinding,
} from "../../src/loop/reflection.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SOLUTION = "Retry classifier for the desktop client";
const TEST = "Does a classified retry cut duplicate submissions";
const INSTRUMENT = "npx vitest run test/retry/classifier.test.ts";

const bound: ReflectionBinding = { solution: SOLUTION, test: TEST, permit: "instrument", instrument: INSTRUMENT };

describe("the gauge asks all three questions, each bound to this pass's nodes", () => {
  const gauge = renderReflectionGauge(bound);

  test("there are exactly three questions, in the order the founder stated them", () => {
    expect(REFLECTION_QUESTIONS.map((q) => q.key)).toEqual(["target", "environment", "human"]);
    expect(gauge.match(/^\s+\d\. /gm)).toHaveLength(3);
  });

  test("every question reaches the output and names its node", () => {
    const audit = auditReflection(gauge, bound);
    expect(audit.missing).toEqual([]);
    expect(audit.unbound).toEqual([]);
    expect(audit.asked).toEqual(["target", "environment", "human"]);
    expect(audit.complete).toBe(true);
  });

  test("question 1 says what to build AND why — the permit, not just the title", () => {
    expect(gauge).toContain(`"${SOLUTION}"`);
    expect(gauge).toContain(`"${TEST}" is red`);
    expect(gauge).toContain(`\`${INSTRUMENT}\``);
  });

  test("a recorded-result permit binds to the test that carries it, and says so", () => {
    const byResult = renderReflectionGauge({ solution: SOLUTION, test: TEST, permit: "result" });
    expect(auditReflection(byResult, bound).complete).toBe(true);
    expect(byResult).toMatch(/a result a human recorded/);
    expect(byResult).not.toContain("is red");
  });

  test("the builder is told to answer, so the questions are answerable rather than decorative", () => {
    expect(gauge).toMatch(/Answer all three/);
  });
});

describe("an output that omits a question, or asks it unbound, fails", () => {
  const gauge = renderReflectionGauge(bound);
  const lines = gauge.split("\n");

  test.each(REFLECTION_QUESTIONS.map((q) => [q.key, q] as const))("omitting %s is reported as missing", (key, q) => {
    const without = lines.filter((l) => !q.stem.test(l)).join("\n");
    const audit = auditReflection(without, bound);
    expect(audit.missing).toEqual([key]);
    expect(audit.complete).toBe(false);
  });

  test.each(REFLECTION_QUESTIONS.map((q) => [q.key, q] as const))(
    "asking %s in the abstract is reported as unbound, not missing",
    (key, q) => {
      // The same question with its nodes stripped out — the form a builder
      // answers "yes" to by reflex.
      const abstract = lines
        .map((l) => (q.stem.test(l) ? l.replaceAll(`"${SOLUTION}"`, "this solution").replaceAll(`"${TEST}"`, "its test") : l))
        .join("\n");
      const audit = auditReflection(abstract, bound);
      expect(audit.unbound).toEqual([key]);
      expect(audit.missing).toEqual([]);
      expect(audit.complete).toBe(false);
    },
  );

  test("a question bound to a DIFFERENT pass's node is unbound here", () => {
    const audit = auditReflection(gauge, { solution: "Some other solution", test: TEST });
    expect(audit.unbound).toEqual(["target", "environment", "human"]);
  });

  test("a hard-wrapped question still audits as one question", () => {
    const wrapped = gauge.replace(`"${SOLUTION}" — and why`, `"${SOLUTION}"\n— and why`);
    expect(auditReflection(wrapped, bound).complete).toBe(true);
  });

  test("the render refuses a binding that would leave a question unbound", () => {
    expect(() => renderReflectionGauge({ ...bound, solution: "" })).toThrow(/refusing to render/);
    expect(() => renderReflectionGauge({ ...bound, test: "   " })).toThrow(/refusing to render/);
    expect(() => renderReflectionGauge({ ...bound, solution: "undefined" })).toThrow(/literal string "undefined"/);
  });
});

describe("the binding is read off the tree, from whichever permit cleared the solution", () => {
  const node = (partial: Partial<OstNode> & Pick<OstNode, "title" | "layer">): OstNode => ({
    tags: [],
    links: [],
    body: "",
    ...partial,
  });

  const redTest = node({
    title: TEST,
    layer: "AssumptionTest",
    instrument: INSTRUMENT,
    body: `x\n\n## Instrument Log\n- 2026-08-05 **red** (exit 1) \`${INSTRUMENT}\` — 1 failed`,
  });
  const resultTest = node({
    title: "A human ran the desktop session",
    layer: "AssumptionTest",
    body: "x\n\n## Results\n- 2026-08-01 three of five sessions duplicated",
  });
  const unrunTest = node({ title: "Nobody ran this", layer: "AssumptionTest", body: "x" });

  test("a red instrument binds to the test carrying it and carries the command", () => {
    const tree = [node({ title: SOLUTION, layer: "Solution", links: [TEST] }), redTest];
    const b = reflectionBinding(tree, SOLUTION);
    expect(b).toEqual({ solution: SOLUTION, test: TEST, permit: "instrument", instrument: INSTRUMENT });
    expect(auditReflection(renderReflectionGauge(b!), b!).complete).toBe(true);
  });

  test("a recorded result — the gate's permit, which buildable calls BLOCKED — still binds", () => {
    const tree = [node({ title: SOLUTION, layer: "Solution", links: [unrunTest.title, resultTest.title] }), unrunTest, resultTest];
    expect(reflectionBinding(tree, SOLUTION)).toEqual({ solution: SOLUTION, test: resultTest.title, permit: "result" });
  });

  test("a solution nothing cleared has no binding — no pass, no questions", () => {
    const tree = [node({ title: SOLUTION, layer: "Solution", links: [unrunTest.title] }), unrunTest];
    expect(reflectionBinding(tree, SOLUTION)).toBeNull();
    expect(reflectionBinding(tree, "not in the tree")).toBeNull();
  });
});

describe("the build pass carries the gauge in the prompt the builder actually reads", () => {
  const source = fs.readFileSync(path.join(root, "examples/automation/build-pass.sh"), "utf8");
  const executable = source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const prompt = source.slice(source.indexOf('cat >"$PROMPT_FILE" <<PROMPT'), source.indexOf("\nPROMPT\n"));

  test("the gauge is rendered by the CLI for THIS target, not typed into the script", () => {
    // Bound to `$TARGET` by construction: a copy of the questions in the heredoc
    // would be the abstract form this whole file exists to refuse.
    expect(executable).toMatch(/REFLECTION="\$\(node "\$CLI" reflection "\$TARGET" --vault \./);
    expect(prompt).toMatch(/^\$REFLECTION$/m);
    for (const q of REFLECTION_QUESTIONS) expect(prompt).not.toMatch(q.stem);
  });

  test("a gauge that cannot be rendered degrades to a named gap, never a dead firing", () => {
    expect(executable).toMatch(/REFLECTION=[\s\S]{0,200}\|\| printf '\(the reflection gauge could not be rendered this firing\)'/);
  });

  test("the gauge reaches the prompt before the report instructions, so it is read before the builder composes", () => {
    expect(prompt.indexOf("$REFLECTION")).toBeGreaterThan(-1);
    expect(prompt.indexOf("$REFLECTION")).toBeLessThan(prompt.indexOf("FINALLY, and this is required"));
  });
});
