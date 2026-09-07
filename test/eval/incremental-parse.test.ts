/**
 * The instrument for **"Check a partial artifact is rejected at the offending
 * line rather than at submission"**.
 *
 * The assumption under it is a feasibility question and it decides whether the
 * solution above it can be built at all: *can an artefact be meaningfully
 * checked while it is incomplete?* A parser that only accepts whole, well-formed
 * input cannot help a composer three lines in — an artefact three lines in is by
 * definition not complete, and if partial input comes back rejected as malformed
 * rather than checked for dialect, incremental validation has nothing to stand
 * on. So the threshold has two clauses and the second one is the load-bearing
 * half: a dialect violation in a partial artefact is reported **at its own
 * line**, with **no requirement that the artefact be complete or submittable**.
 *
 * The design the node states, implemented here:
 *
 *  1. Feed the parse-only entry point a three-line fragment containing a type
 *     annotation. Assert the violation is at its own line and that incompleteness
 *     is not itself an error.
 *  2. Repeat against the submissions the surface actually refused, truncated at
 *     the line it refused them on, and assert the same defect is found there.
 *
 * The node's design says "the 172-line rejection truncated at line 24", which
 * mixes the two records — `4ff7b605` was refused at 172:33 and `516fdfb8` at
 * 24:12. Both are done below, each truncated at *its own* offending line, which
 * is the check the design was reaching for and is stronger for using both.
 *
 * **What makes this non-vacuous.** A checker that answers "nothing wrong" to
 * everything passes clause two and fails the point, so the controls run the
 * other way: every prefix of a legal skeleton, and every prefix of a script
 * written to contain every awkward shape a composer produces — an open template
 * spanning lines, `try` before its `catch`, a `switch` mid-case, a `do` before
 * its `while` — must come back clean at every line boundary. Those are the false
 * alarms that would make an early check worse than the late one it replaces.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  blankNonCode,
  firstRejectionWhileComposing,
  validateWorkflowPrefix,
} from "../../src/knowledge/incremental-validation.js";
import { parseWorkflowScript, renderWorkflowSkeleton } from "../../src/knowledge/workflow-grammar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS = path.join(root, "test/fixtures/corrections");

const META = "export const meta = { name: 'sample', description: 'a fragment' }";

/** Every Workflow submission the surface refused, with the position it named. */
function recordedRefusals(): Array<{ session: string; script: string; line: number; column: number }> {
  const out: Array<{ session: string; script: string; line: number; column: number }> = [];
  for (const name of fs.readdirSync(CORPUS).filter((n) => n.endsWith(".jsonl"))) {
    const scripts = new Map<string, string>();
    for (const line of fs.readFileSync(path.join(CORPUS, name), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as { message?: { content?: unknown } };
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Array<Record<string, unknown>>) {
        if (block.type === "tool_use" && block.name === "Workflow") {
          const input = block.input as { script?: unknown } | undefined;
          if (typeof input?.script === "string") scripts.set(String(block.id), input.script);
        }
        if (block.type === "tool_result" && block.is_error === true && scripts.has(String(block.tool_use_id))) {
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          const at = /Script parse error:[^\n]*\((\d+):(\d+)\)/.exec(text);
          if (at) {
            out.push({
              session: name.slice(0, 8),
              script: scripts.get(String(block.tool_use_id))!,
              line: Number(at[1]),
              column: Number(at[2]),
            });
          }
        }
      }
    }
  }
  return out;
}

/**
 * Every awkward shape a composer writes, laid out so that each line boundary is
 * a place a naive prefix check would fire. It is legal in full, so every one of
 * its prefixes must come back clean.
 */
const AWKWARD_BUT_LEGAL = [
  "export const meta = {",
  "  name: 'awkward',",
  "  description: 'every shape whose prefix looks broken to a parser',",
  "}",
  "",
  "const S = {",
  "  type: 'object',",
  "  properties: { a: { type: 'string' } },",
  "}",
  "",
  "function pick(xs) {",
  "  return xs[0]",
  "}",
  "",
  "class Box {",
  "  constructor(v) {",
  "    this.v = v",
  "  }",
  "  get value() {",
  "    return this.v",
  "  }",
  "}",
  "",
  "const long = `line one",
  "line two",
  "line three`",
  "",
  "const nested = `outer ${pick([1])} tail`",
  "",
  "try {",
  "  log('a')",
  "}",
  "catch (err) {",
  "  log('b')",
  "}",
  "finally {",
  "  log('c')",
  "}",
  "",
  "switch (args && args.length) {",
  "  case 0:",
  "    log('none')",
  "    break",
  "  default:",
  "    log('some')",
  "}",
  "",
  "do {",
  "  log('once')",
  "}",
  "while (false)",
  "",
  "for (const x of [1, 2]) {",
  "  log('x' + x)",
  "}",
  "",
  "const f = async (x) =>",
  "  x + 1",
  "",
  "if (args) {",
  "  log('yes')",
  "}",
  "else {",
  "  log('no')",
  "}",
  "",
  "const t = args",
  "  ? 1",
  "  : 2",
  "",
  "const arr = [",
  "  1,",
  "  2,",
  "]",
  "",
  "const { a = 1, ...rest } = S",
  "const [first, ...more] = arr",
  "",
  "const chained = arr",
  "  .filter(Boolean)",
  "  .map((n) => n * 2)",
  "",
  "return { long, nested, t, first, more, rest, a, chained, f, Box, S }",
].join("\n");

/** Every prefix of a source, one line at a time, as a composer would produce them. */
function prefixes(source: string): Array<{ atLine: number; text: string }> {
  const lines = source.split("\n");
  return lines.map((_line, i) => ({ atLine: i + 1, text: lines.slice(0, i + 1).join("\n") }));
}

describe("a partial artefact is checked for dialect, not rejected for being partial", () => {
  test("a three-line fragment with a type annotation is refused at line three", () => {
    // The design, verbatim: three lines, a type annotation, and nothing after
    // it. The artefact is not complete and cannot be submitted; the violation is
    // still reported, and at its own line.
    const fragment = [META, "const findings = []", "const count: number = findings.length"].join("\n");
    const violations = validateWorkflowPrefix(fragment);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(3);
    expect(violations[0].column).toBe(11);
    expect(violations[0].kind).toBe("parser");
  });

  test("the same three lines without the annotation are clean, so it is the dialect being judged", () => {
    const fragment = [META, "const findings = []", "const count = findings.length"].join("\n");
    expect(validateWorkflowPrefix(fragment)).toEqual([]);
  });

  test("incompleteness is not itself an error", () => {
    // Each of these is a legal script cut off mid-construct. A whole-input
    // parser refuses every one of them, which is why a whole-input parser is no
    // use here: refusing all of them is the same as refusing none.
    const unfinished = [
      `${META}\nconst found = await agent(`,
      `${META}\nconst FINDINGS = {\n  type: 'object',`,
      `${META}\nconst prompt = \`read the file and list every`,
      `${META}\nif (args) {`,
      `${META}\nclass Box {`,
      "export const meta = {\n  name: 'x',",
    ];
    for (const prefix of unfinished) {
      expect(parseWorkflowScript(prefix).ok).toBe(false);
      expect(validateWorkflowPrefix(prefix)).toEqual([]);
    }
  });

  test("a fragment nobody has started is not a violation either", () => {
    expect(validateWorkflowPrefix("")).toEqual([]);
    expect(validateWorkflowPrefix("// deciding what this workflow should do")).toEqual([]);
  });
});

describe("the submissions the surface actually refused, truncated at the line it named", () => {
  const refusals = recordedRefusals();

  test("the corpus still holds both refusals this is measured against", () => {
    // The evidence, not a fixture written for the test: if the corpus stops
    // carrying refused submissions, everything below passes over an empty list
    // and says nothing.
    expect(refusals.length).toBeGreaterThanOrEqual(2);
    expect(refusals.map((r) => `${r.session} ${r.line}:${r.column}`)).toEqual(
      expect.arrayContaining(["4ff7b605 172:33", "516fdfb8 24:12"]),
    );
  });

  test.each(refusals.map((r) => [`${r.session} at ${r.line}:${r.column}`, r] as const))(
    "%s is refused at the same position with the rest of the script never written",
    (_name, refusal) => {
      const lines = refusal.script.split("\n");
      const truncated = lines.slice(0, refusal.line).join("\n");
      const violations = validateWorkflowPrefix(truncated);
      expect(violations.length).toBeGreaterThan(0);
      expect({ line: violations[0].line, column: violations[0].column }).toEqual({
        line: refusal.line,
        column: refusal.column,
      });
      // The point of the node, as a number: this is how many lines were composed
      // after the answer was available and before the surface gave one.
      expect(lines.length).toBeGreaterThan(refusal.line);
    },
  );

  test.each(refusals.map((r) => [r.session, r] as const))(
    "composing %s a line at a time answers at the line the surface named, not at submission",
    (_session, refusal) => {
      const found = firstRejectionWhileComposing(refusal.script);
      expect(found).not.toBeNull();
      expect(found!.atLine).toBe(refusal.line);
      expect(found!.violation.column).toBe(refusal.column);
      expect(found!.linesSaved).toBeGreaterThan(0);
    },
  );

  test("the recorded refusals were longer than the position they came back with", () => {
    // A finding this file is the first thing to look at: the opportunity is
    // written as "a hundred and seventy lines composed before anybody said so",
    // and the position the surface reports is the FIRST parse error, not the end
    // of the submission. Both scripts kept going well past it — so the lines
    // wasted are the ones after the defect, and there are more of them than the
    // refusal's line number suggests.
    for (const refusal of refusals) {
      const total = refusal.script.split("\n").length;
      expect(total).toBeGreaterThan(refusal.line);
    }
  });
});

describe("defects the parser never catches are caught at their own line too", () => {
  test.each([
    ["Date.now()", "const started = Date.now()", "runtime"],
    ["require()", "const fs = require('node:fs')", "runtime"],
    ["an import", "import fs from 'node:fs'", "runtime"],
    ["an argless new Date()", "const now = new Date()", "runtime"],
    ["an as const cast", "const S = { type: 'object' } as const", "parser"],
    ["an interface", "interface Finding { file }", "parser"],
  ])("%s on line three is reported at line three", (_name, offending, kind) => {
    const fragment = [META, "const findings = []", offending].join("\n");
    const violations = validateWorkflowPrefix(fragment);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(3);
    expect(violations.some((v) => v.kind === kind)).toBe(true);
  });

  test("the runtime group is the half no parse check answers at any moment", () => {
    // `Date.now()` is legal JavaScript: the surface accepts the submission and
    // the script dies partway through spending tokens. For this group the
    // incremental answer is not merely earlier than the surface's — it is the
    // only one there is.
    const script = [META, "const started = Date.now()", "return { started }"].join("\n");
    expect(parseWorkflowScript(script).ok).toBe(true);
    expect(validateWorkflowPrefix(script).map((v) => v.line)).toContain(2);
  });
});

describe("the meta rules are answerable as soon as the meta statement closes", () => {
  test("a computed meta is refused where it is written, not after everything under it", () => {
    const fragment = ["export const meta = { name: 'x'.toUpperCase(), description: 'y' }", "const findings = []"].join(
      "\n",
    );
    const violations = validateWorkflowPrefix(fragment);
    expect(violations.some((v) => v.kind === "meta" && v.message.includes("pure literal"))).toBe(true);
    expect(violations[0].line).toBe(1);
  });

  test("a meta that is not the first statement is refused at the statement that displaced it", () => {
    const fragment = ["const NAME = 'x'", "export const meta = { name: NAME, description: 'y' }"].join("\n");
    const violations = validateWorkflowPrefix(fragment);
    expect(violations.some((v) => v.kind === "meta")).toBe(true);
    expect(violations[0].line).toBe(1);
  });

  test("a leading comment is not treated as a missing meta", () => {
    // No recorded refusal says the surface minds a header comment, and refusing
    // one at line one is precisely the false alarm that would make an early
    // check worse than a late one.
    const fragment = ["// what this workflow does", META].join("\n");
    expect(validateWorkflowPrefix(fragment)).toEqual([]);
  });
});

describe("controls: a legal script is clean at every line boundary", () => {
  test("every prefix of the generated skeleton is clean", () => {
    const offenders = prefixes(renderWorkflowSkeleton())
      .map((p) => ({ atLine: p.atLine, violations: validateWorkflowPrefix(p.text) }))
      .filter((p) => p.violations.length > 0);
    expect(offenders).toEqual([]);
  });

  test("every prefix of a script written to look broken while it is unfinished is clean", () => {
    expect(parseWorkflowScript(AWKWARD_BUT_LEGAL).ok).toBe(true);
    const offenders = prefixes(AWKWARD_BUT_LEGAL)
      .map((p) => ({ atLine: p.atLine, violations: validateWorkflowPrefix(p.text) }))
      .filter((p) => p.violations.length > 0);
    expect(offenders).toEqual([]);
  });

  test("nothing legal is refused, and something illegal still is — the control is not vacuous", () => {
    // The mutation: one line changed inside the awkward script, at a line
    // boundary that was clean a moment ago.
    const lines = AWKWARD_BUT_LEGAL.split("\n");
    const at = lines.findIndex((l) => l.startsWith("const S = {"));
    expect(at).toBeGreaterThan(0);
    const mutated = [...lines.slice(0, at), "const S: object = {", ...lines.slice(at + 1)].join("\n");
    const found = firstRejectionWhileComposing(mutated);
    expect(found).not.toBeNull();
    expect(found!.atLine).toBe(at + 1);
  });
});

describe("the mechanism, as the quantity the opportunity is about", () => {
  test("a defect on line three is answered at line three of a hundred and seventy", () => {
    // The node's own framing: a rejection at (24:12) and one at (172:33) are the
    // same defect and differ by an order of magnitude in what they wasted.
    const filler = Array.from({ length: 167 }, (_v, i) => `log('step ${i}')`);
    const script = [META, "const findings = []", "const count: number = findings.length", ...filler].join("\n");
    expect(script.split("\n").length).toBe(170);

    const found = firstRejectionWhileComposing(script);
    expect(found).not.toBeNull();
    expect(found!.atLine).toBe(3);
    expect(found!.linesSaved).toBe(167);

    // And the comparison that makes it a finding rather than a claim: handed over
    // whole, the surface names the same position — after all 170 lines exist.
    const whole = parseWorkflowScript(script);
    expect(whole.ok).toBe(false);
    if (!whole.ok) expect(whole.line).toBe(3);
  });

  test("a legal script has no first rejection, so the measurement is not always positive", () => {
    expect(firstRejectionWhileComposing(renderWorkflowSkeleton())).toBeNull();
    expect(firstRejectionWhileComposing(AWKWARD_BUT_LEGAL)).toBeNull();
  });
});

describe("the scanner the checks run over", () => {
  test("prose that mentions a forbidden call is not a use of it", () => {
    const fragment = [
      META,
      "// never reach for Date.now() in a script — it breaks resume",
      "const prompt = 'explain why Date.now() is unavailable'",
      "return { prompt }",
    ].join("\n");
    expect(validateWorkflowPrefix(fragment)).toEqual([]);
  });

  test("it reports where an unterminated region opened, which is what holds the frontier back", () => {
    const open = `${META}\nconst prompt = \`read the file and`;
    expect(blankNonCode(open).openedAt).toBe(open.indexOf("`"));
    expect(blankNonCode(`${META}\nconst prompt = 'closed'`).openedAt).toBeNull();
  });

  test("a quoted string broken by a newline is a violation, not an open region", () => {
    // It cannot be repaired by writing more: a newline ends a quoted string
    // whatever follows. Holding it open would hide the defect for good.
    const fragment = [META, "const prompt = 'read the file and", "list every claim'"].join("\n");
    const violations = validateWorkflowPrefix(fragment);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].line).toBe(2);
  });
});
