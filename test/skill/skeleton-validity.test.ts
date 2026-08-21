/**
 * Does the handed-back Workflow skeleton parse clean against the same parser
 * that accepts submissions — and stay that way?
 *
 * The assumption test this file instruments ("Check the handed-back skeleton
 * parses clean against the same parser that accepts submissions") asks three
 * things: the skeleton parses against the submission parser, a drift check
 * fails if the two ever diverge, and the skeleton shows one example of each
 * permitted construct rather than a subset. Each is held below, plus the
 * mutation controls that prove the checks can come out red.
 *
 * "The same parser" is the claim that needs evidence, because the surface's
 * parser is not importable from here. What IS available is every refusal it
 * has issued: the corrections corpus holds two Workflow submissions and the
 * `Script parse error: Unexpected token (line:col)` each one got back. The
 * parser in `src/knowledge/workflow-grammar.ts` must refuse every one of them
 * at the recorded line AND column. That is the drift check made against the
 * only evidence the surface hands out; a new recorded refusal that this parser
 * does not reproduce is the divergence it exists to catch.
 *
 * What green does NOT mean: that the surface accepts the skeleton. The corpus
 * holds no accepted submission, so the positive direction rests on the tool's
 * own documentation (top-level `await`/`return`, `export const meta` first).
 * Nor does it mean a composer starting from the skeleton stays in the dialect
 * once past it — that is the scope limitation the node itself names.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { WORKFLOW_SKELETON_PATH, renderCheckedSkeleton } from "../../scripts/gen-skill.js";
import {
  codeOnly,
  metaProblems,
  parseWorkflowScript,
  refusalFor,
  renderWorkflowSkeleton,
  skeletonProblems,
  WORKFLOW_CONSTRUCTS,
  WORKFLOW_REJECTS,
} from "../../src/knowledge/workflow-grammar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS = path.join(root, "test/fixtures/corrections");

const skeleton = renderWorkflowSkeleton();

/** Every Workflow submission in the corpus, paired with the refusal it got back (if any). */
interface RecordedSubmission {
  session: string;
  script: string;
  refusal: string | null;
}

function recordedSubmissions(): RecordedSubmission[] {
  const out: RecordedSubmission[] = [];
  for (const name of fs.readdirSync(CORPUS).filter((n) => n.endsWith(".jsonl"))) {
    const scripts = new Map<string, string>();
    const refusals = new Map<string, string | null>();
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
        if (block.type === "tool_result" && scripts.has(String(block.tool_use_id))) {
          const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
          refusals.set(String(block.tool_use_id), block.is_error === true ? text : null);
        }
      }
    }
    for (const [id, script] of scripts) out.push({ session: name.slice(0, 8), script, refusal: refusals.get(id) ?? null });
  }
  return out;
}

describe("the skeleton is handed back generated, and the committed copy is in sync", () => {
  test("the committed skeleton is byte-for-byte what the generator renders (run `npm run gen:skill`)", () => {
    expect(WORKFLOW_SKELETON_PATH).toBe(path.join(root, ".claude", "workflows", "skeleton.js"));
    expect(fs.existsSync(WORKFLOW_SKELETON_PATH)).toBe(true);
    expect(fs.readFileSync(WORKFLOW_SKELETON_PATH, "utf8")).toBe(skeleton);
  });

  test("the generator writes only a skeleton it has checked, and refuses otherwise", () => {
    expect(renderCheckedSkeleton()).toBe(skeleton);
  });

  test("CLAUDE.md hands the composer the skeleton by path, so it is found before composing", () => {
    // The hand-off is the mechanism: a legal skeleton nobody is pointed at is
    // the published-grammar sibling wearing a different name.
    const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain(".claude/workflows/skeleton.js");
  });
});

describe("the skeleton parses clean against the submission parser", () => {
  test("it parses, and the criterion finds nothing wrong with it", () => {
    expect(parseWorkflowScript(skeleton).ok).toBe(true);
    expect(skeletonProblems(skeleton)).toEqual([]);
  });

  test("it begins with a pure-literal `export const meta` carrying name and description", () => {
    const parsed = parseWorkflowScript(skeleton);
    if (!parsed.ok) throw new Error(refusalFor(parsed)!);
    expect(metaProblems(skeleton, parsed.program)).toEqual([]);
    expect(skeleton.startsWith("export const meta = {")).toBe(true);
  });

  test("a bare run spawns nothing: the args guard returns before the first agent() call", () => {
    // Textual order only — nothing here runs the script. What it pins is that
    // the free parse check the skeleton's header promises is at least shaped
    // to be free.
    const parsed = parseWorkflowScript(skeleton);
    const code = parsed.ok ? codeOnly(skeleton, parsed.comments) : "";
    const guard = code.indexOf("Array.isArray(args)");
    const firstAgent = code.indexOf("agent(");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstAgent);
    expect(code.slice(guard, firstAgent)).toMatch(/return \{ skeleton: true/);
  });
});

describe("the skeleton shows one example of each permitted construct, not a subset", () => {
  const parsed = parseWorkflowScript(skeleton);
  const code = parsed.ok ? codeOnly(skeleton, parsed.comments) : "";

  test("the construct list is the tool's surface, not a token one", () => {
    // Anti-vacuity for the list itself: "one of each" over three constructs
    // would be a subset check wearing the criterion's name.
    const names = WORKFLOW_CONSTRUCTS.map((c) => c.name);
    for (const must of ["meta", "phase()", "agent()", "pipeline()", "parallel()", "log()", "args", "workflow()", "budget.total"]) {
      expect(names).toContain(must);
    }
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  test.each(WORKFLOW_CONSTRUCTS.map((c) => [c.name, c] as const))("shows %s", (_name, c) => {
    expect(code).toMatch(c.evidence);
  });

  test("the evidence is read off code, not comments — a comment naming a construct is not an example of it", () => {
    const onlyComments = `export const meta = { name: 'x', description: 'y' }\n// agent( pipeline( parallel( log( phase('Find') workflow('x')\nreturn {}\n`;
    const problems = skeletonProblems(onlyComments);
    expect(problems.join("\n")).toMatch(/shows no example of agent\(\)/);
    expect(problems.join("\n")).toMatch(/shows no example of pipeline\(\)/);
  });

  test.each(WORKFLOW_REJECTS.filter((r) => r.pattern).map((r) => [r.name, r] as const))(
    "contains no %s",
    (_name, r) => {
      expect(code).not.toMatch(r.pattern!);
    },
  );
});

describe("the parser is the submission parser's, to the column — every recorded refusal reproduces", () => {
  const submissions = recordedSubmissions();
  const refused = submissions.filter((s) => s.refusal && /Script parse error/.test(s.refusal));

  test("the corpus holds Workflow submissions with recorded parse refusals, so the check below is not vacuous", () => {
    expect(refused.length).toBeGreaterThanOrEqual(2);
    expect(refused.map((s) => s.session).sort()).toEqual(["4ff7b605", "516fdfb8"]);
  });

  test.each(refused.map((s) => [s.session, s] as const))(
    "session %s: refused at the same line and column the surface reported",
    (_session, s) => {
      const recorded = s.refusal!.match(/Script parse error: (Unexpected token \((\d+):(\d+)\))/);
      expect(recorded, "the recorded refusal names no position").not.toBeNull();
      const parsed = parseWorkflowScript(s.script);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.message).toBe(recorded![1]);
      expect(parsed.line).toBe(Number(recorded![2]));
      expect(parsed.column).toBe(Number(recorded![3]));
      expect(refusalFor(parsed)).toBe(`Script parse error: ${recorded![1]}`);
    },
  );

  test("neither recorded rejection was TypeScript — both are a backtick inside a template literal", () => {
    // The refusal text guesses TypeScript; the corpus says otherwise. Pinned
    // because the skeleton's one prose-with-backticks example exists for this.
    for (const s of refused) {
      const parsed = parseWorkflowScript(s.script);
      if (parsed.ok) throw new Error("expected a refusal");
      const line = s.script.split("\n")[parsed.line - 1];
      expect(line.slice(0, parsed.column)).toMatch(/`[^`]*$/);
      expect(s.script).not.toMatch(/^\s*interface\s|\b(?:const|let)\s+\w+\s*:\s*\w+\s*=/m);
    }
  });

  test("any accepted submission in the corpus parses here too", () => {
    // There are none today, and the assertion says so rather than passing
    // silently over an empty list.
    const accepted = submissions.filter((s) => s.refusal === null);
    for (const s of accepted) expect(parseWorkflowScript(s.script).ok).toBe(true);
    expect(accepted.length).toBe(0);
  });
});

describe("the checks can come out red — mutation controls", () => {
  test.each(WORKFLOW_REJECTS.filter((r) => r.sample).map((r) => [r.name, r] as const))(
    "the parser refuses %s",
    (_name, r) => {
      const parsed = parseWorkflowScript(r.sample!);
      expect(parsed.ok).toBe(false);
      // The wording varies by construct (`interface` is "The keyword
      // 'interface' is reserved"); the position suffix is what every refusal
      // carries, and what the corpus check above matches on.
      if (!parsed.ok) expect(parsed.message).toMatch(/\(\d+:\d+\)$/);
    },
  );

  test("a type argument on a call is NOT a parse error — it is a comparison chain — so it is caught by pattern", () => {
    // What the controls found while this file was being written: the
    // refusal text blames "generics", but `agent<Finding>('x')` parses.
    const generic = `export const meta = { name: 'x', description: 'y' }\nconst found = await agent<Finding>('Find one thing.')\nreturn { found }\n`;
    expect(parseWorkflowScript(generic).ok).toBe(true);
    expect(skeletonProblems(generic).join("\n")).toMatch(/type argument on a call.*throws when the script runs/);
  });

  test("a type annotation slipped into the skeleton is refused by the parser, as the surface would", () => {
    const mutated = skeleton.replace("let related = null", "let related: any = null");
    expect(mutated).not.toBe(skeleton);
    expect(skeletonProblems(mutated)).toEqual([expect.stringMatching(/does not parse: Script parse error: Unexpected token \(\d+:\d+\)/)]);
  });

  test("a backtick inside a template-literal prompt — the recorded mistake — is refused", () => {
    const mutated = skeleton.replace(
      '"Read " + item + " and list every claim it makes about `done` or `input_schema`.",',
      "`Read ${item} and list every claim it makes about `done` or `input_schema`.`,",
    );
    expect(mutated).not.toBe(skeleton);
    expect(skeletonProblems(mutated)[0]).toMatch(/does not parse/);
  });

  test("a runtime-forbidden call parses but is reported, because a parse check alone would miss it", () => {
    const mutated = skeleton.replace("return { confirmed, related, synthesis }", "return { confirmed, related, synthesis, at: Date.now() }");
    expect(mutated).not.toBe(skeleton);
    expect(parseWorkflowScript(mutated).ok).toBe(true);
    expect(skeletonProblems(mutated)).toEqual([expect.stringMatching(/Date\.now\(\).*throws when the script runs/)]);
  });

  test("a construct removed is reported as missing — the subset a skeleton must not be", () => {
    const mutated = skeleton.replace("  related = await workflow('related-findings', { confirmed })\n", "  related = { confirmed }\n");
    expect(mutated).not.toBe(skeleton);
    expect(skeletonProblems(mutated)).toEqual([expect.stringMatching(/shows no example of workflow\(\)/)]);
  });

  test("a meta that is not a pure literal is reported", () => {
    const mutated = skeleton.replace("  name: 'skeleton',", "  name: 'skel' + 'eton',");
    expect(mutated).not.toBe(skeleton);
    expect(skeletonProblems(mutated)).toEqual([expect.stringMatching(/not a pure literal/)]);
    const spread = skeleton.replace("  name: 'skeleton',", "  name: 'skeleton', ...args,");
    expect(skeletonProblems(spread)).toEqual([expect.stringMatching(/not a pure literal/)]);
  });

  test("a meta missing a required key, or not first, is reported", () => {
    const noDescription = skeleton.replace(/^  description: .*\n/m, "");
    expect(noDescription).not.toBe(skeleton);
    expect(skeletonProblems(noDescription)).toEqual([expect.stringMatching(/no `description`/)]);
    const commentFirst = `// a leading comment\n${skeleton}`;
    expect(skeletonProblems(commentFirst)).toEqual([expect.stringMatching(/does not begin with/)]);
    const logFirst = `log('first')\n${skeleton}`;
    expect(skeletonProblems(logFirst).join("\n")).toMatch(/first statement is not/);
  });

  test("the refusal reconstructed here is the surface's text, so a reader can match it to a transcript", () => {
    const parsed = parseWorkflowScript(`export const meta = { name: 'x', description: 'y' }\nconst n: number = 1\n`);
    expect(refusalFor(parsed)).toBe("Script parse error: Unexpected token (2:7)");
    expect(refusalFor(parseWorkflowScript(skeleton))).toBeNull();
  });
});
