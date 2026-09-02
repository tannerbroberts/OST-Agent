/**
 * Is the accepted grammar retrievable without submitting anything, and does it
 * name every construct the parser rejects — and stay that way?
 *
 * The assumption test this file instruments ("Check the accepted grammar is
 * retrievable without submitting anything, and names every rejected construct")
 * asks three things: every rejected construct appears in the published grammar,
 * the grammar is obtainable without handing an artifact over, and a drift
 * assertion fails if grammar and parser diverge. Each is held below, plus the
 * mutation controls that prove the checks can come out red.
 *
 * **What "retrievable without submitting anything" is held to mean here.** Three
 * assertions, none of them a paraphrase of the sentence: the renderer takes zero
 * arguments, so no call site can be asked for a script; the document is a
 * committed file, so obtaining it costs one read; and `CLAUDE.md` names that
 * path, so the composer is pointed at it before writing rather than after being
 * refused.
 *
 * **What green does NOT mean.** That the surface published anything. It does
 * not, and cannot be made to — `docs/reference/workflow-grammar.md` is a
 * reconstruction this repository maintains from the tool's description, the
 * parser in `src/knowledge/workflow-grammar.ts`, and the two refusals on record.
 * The drift check therefore runs in one direction only: a construct this
 * repository claims the parser refuses is checked against the parser, and a
 * construct the surface quietly began accepting is invisible until a refusal
 * records the change. Nor does green mean any composer read the page — the node
 * concedes that is the weakest thing about this shape, and only watching
 * composers would show it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { WORKFLOW_GRAMMAR_PATH, renderCheckedGrammar } from "../../scripts/gen-skill.js";
import {
  grammarProblems,
  parseWorkflowScript,
  RECORDED_REFUSALS,
  refusalFor,
  refusalForReject,
  rejectClaimProblems,
  renderWorkflowGrammar,
  WORKFLOW_CONSTRUCTS,
  WORKFLOW_GRAMMAR_ADDRESS,
  WORKFLOW_REJECTS,
  WORKFLOW_SKELETON_ADDRESS,
} from "../../src/knowledge/workflow-grammar.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CORPUS = path.join(root, "test/fixtures/corrections");

const grammar = renderWorkflowGrammar();

/** Every Workflow submission in the corpus that came back refused, with its refusal. */
function recordedRefusals(): Array<{ session: string; script: string; refusal: string }> {
  const out: Array<{ session: string; script: string; refusal: string }> = [];
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
          if (/Script parse error/.test(text)) {
            out.push({ session: name.slice(0, 8), script: scripts.get(String(block.tool_use_id))!, refusal: text });
          }
        }
      }
    }
  }
  return out;
}

describe("the grammar is obtainable without submitting anything", () => {
  test("the renderer takes no argument — there is no script to hand over to get it", () => {
    // The whole node in one assertion: a signature that asked for a submission
    // would be discovery-by-violation with a friendlier name on it.
    expect(renderWorkflowGrammar.length).toBe(0);
    expect(grammar.length).toBeGreaterThan(2000);
  });

  test("it is a committed file at a fixed address, so obtaining it costs one read", () => {
    expect(WORKFLOW_GRAMMAR_PATH).toBe(path.join(root, "docs", "reference", "workflow-grammar.md"));
    expect(WORKFLOW_GRAMMAR_ADDRESS).toBe("docs/reference/workflow-grammar.md");
    expect(fs.existsSync(WORKFLOW_GRAMMAR_PATH)).toBe(true);
  });

  test("CLAUDE.md names the address, so a composer meets it before writing rather than after being refused", () => {
    // A complete grammar nobody is pointed at is the failure the node names
    // about itself. The pointer is the only part of "before writing" a test
    // here can hold.
    const claude = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
    expect(claude).toContain(WORKFLOW_GRAMMAR_ADDRESS);
    expect(claude).toContain(WORKFLOW_SKELETON_ADDRESS);
  });

  test("the skeleton hands the reader on to the grammar for what it does not show", () => {
    const skeleton = fs.readFileSync(path.join(root, WORKFLOW_SKELETON_ADDRESS), "utf8");
    expect(skeleton).toContain(WORKFLOW_GRAMMAR_ADDRESS);
  });
});

describe("it names every construct the parser rejects", () => {
  test("the criterion finds nothing missing from the published page", () => {
    expect(grammarProblems(grammar)).toEqual([]);
  });

  test.each(WORKFLOW_REJECTS.map((r) => [r.name, r] as const))("names %s", (_name, r) => {
    expect(grammar).toContain(r.name);
    const refusal = refusalForReject(r);
    if (refusal) expect(grammar).toContain(refusal);
  });

  test.each(WORKFLOW_CONSTRUCTS.map((c) => [c.name, c] as const))("names the offered construct %s", (_name, c) => {
    expect(grammar).toContain(c.name);
    expect(grammar).toContain(c.what);
  });

  test("the reject list is not a token one — it covers what the refusal text blames and what the corpus recorded", () => {
    // Anti-vacuity for the list itself: "every entry appears" over three
    // entries would be a subset check wearing the criterion's name. The floor
    // is the three causes the surface's own refusal names plus the one the
    // corpus actually holds.
    const names = WORKFLOW_REJECTS.map((r) => r.name);
    for (const must of [
      "a type annotation",
      "an interface",
      "a generic type parameter on a function",
      "a backtick inside a template-literal prompt",
    ]) {
      expect(names).toContain(must);
    }
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(WORKFLOW_REJECTS.some((r) => r.why === "the parser refuses it")).toBe(true);
    expect(WORKFLOW_REJECTS.some((r) => r.why !== "the parser refuses it")).toBe(true);
  });

  test("both groups are published, because a parse check cannot see the second", () => {
    expect(grammar).toContain("Refused by the parser");
    expect(grammar).toContain("Parses, then throws when the script runs");
  });

  test("the page says what it cannot promise, rather than reading as the surface's own word", () => {
    // The honest limit is load-bearing: this is a reconstruction, and a reader
    // who takes it for a published contract will trust it past where it holds.
    expect(grammar).toContain("The surface does not publish a grammar; this is a reconstruction.");
    expect(grammar).toContain("It can only be checked against refusals already issued.");
  });
});

describe("grammar and parser cannot diverge silently", () => {
  test("the committed page is byte-for-byte what the generator renders (run `npm run gen:skill`)", () => {
    expect(fs.readFileSync(WORKFLOW_GRAMMAR_PATH, "utf8")).toBe(grammar);
  });

  test("the generator publishes only a grammar it has checked, and refuses otherwise", () => {
    expect(renderCheckedGrammar()).toBe(grammar);
  });

  test("every construct the page says the parser refuses, the parser refuses", () => {
    // The drift check with teeth: an acorn upgrade that started accepting `as
    // const` makes this red, rather than leaving a page that teaches a rule
    // nobody enforces.
    expect(rejectClaimProblems()).toEqual([]);
    for (const r of WORKFLOW_REJECTS.filter((x) => x.why === "the parser refuses it")) {
      expect(r.sample, `${r.name} claims a parser refusal with no sample`).toBeDefined();
      expect(parseWorkflowScript(r.sample!).ok, r.name).toBe(false);
    }
  });

  test("every refusal the page quotes is the text the parser issues today, to the column", () => {
    for (const r of WORKFLOW_REJECTS) {
      const quoted = refusalForReject(r);
      if (!quoted) continue;
      expect(quoted).toMatch(/^Script parse error: .*\(\d+:\d+\)$/);
      expect(grammar).toContain(quoted);
    }
  });

  test("the refusals the page cites are the ones the corpus recorded, session and position", () => {
    // RECORDED_REFUSALS is data in the module; the corpus is the evidence. A
    // refusal the corpus gains and the module does not carry fails here, which
    // is the only direction in which this page can learn the surface changed.
    const recorded = recordedRefusals();
    expect(recorded.length).toBeGreaterThanOrEqual(2);
    expect(recorded.map((r) => r.session).sort()).toEqual(RECORDED_REFUSALS.map((r) => r.session).sort());
    for (const r of recorded) {
      const cited = RECORDED_REFUSALS.find((c) => c.session === r.session)!;
      expect(cited, `no citation for session ${r.session}`).toBeDefined();
      expect(r.refusal).toContain(`Script parse error: ${cited.message}`);
      expect(cited.message).toBe(`Unexpected token (${cited.line}:${cited.column})`);
      // …and the parser this page is rendered from still reproduces it.
      const parsed = parseWorkflowScript(r.script);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) return;
      expect(parsed.line).toBe(cited.line);
      expect(parsed.column).toBe(cited.column);
      expect(refusalFor(parsed)).toBe(`Script parse error: ${cited.message}`);
      // The cause the page prints is the one the script actually tripped: an
      // open backtick to the left of the reported column, not the TypeScript
      // the refusal text guesses at.
      expect(cited.cause).toBe("a backtick inside a template-literal prompt");
      expect(r.script.split("\n")[parsed.line - 1].slice(0, parsed.column)).toMatch(/`[^`]*$/);
      expect(grammar).toContain(`| \`${cited.session}\` | \`Script parse error: ${cited.message}\` |`);
    }
  });
});

describe("the checks can come out red — mutation controls", () => {
  test("a rejected construct dropped from the page is reported", () => {
    const mutated = grammar.replace(/#### an `as` cast[\s\S]*?(?=#### |### )/, "");
    expect(mutated).not.toBe(grammar);
    expect(grammarProblems(mutated).join("\n")).toMatch(/an `as` cast/);
  });

  test("an offered construct dropped from the page is reported", () => {
    const mutated = grammar.replace(/^\| `budget\.remaining\(\)` \|.*$/m, "");
    expect(mutated).not.toBe(grammar);
    expect(grammarProblems(mutated).join("\n")).toMatch(/budget\.remaining\(\)/);
  });

  test("a stale refusal — the page quoting a position the parser no longer issues — is reported", () => {
    const real = refusalForReject(WORKFLOW_REJECTS.find((r) => r.name === "a type annotation")!)!;
    const mutated = grammar.replace(real, real.replace(/\(\d+:\d+\)/, "(2:99)"));
    expect(mutated).not.toBe(grammar);
    expect(grammarProblems(mutated).join("\n")).toMatch(/the refusal the parser issues for a type annotation/);
  });

  test("a parse option changed without republishing is reported", () => {
    const mutated = grammar.replace("- `sourceType`: `module`", "- `sourceType`: `script`");
    expect(mutated).not.toBe(grammar);
    expect(grammarProblems(mutated).join("\n")).toMatch(/parse option/);
  });

  test("a page that no longer says where it can be had without submitting is reported", () => {
    const mutated = grammar.replace("**submitting nothing**", "**a submission**");
    expect(mutated).not.toBe(grammar);
    expect(grammarProblems(mutated).join("\n")).toMatch(/costs no submission/);
    const addressless = grammar.replaceAll(WORKFLOW_SKELETON_ADDRESS, "somewhere");
    expect(grammarProblems(addressless).join("\n")).toMatch(/the skeleton it sits beside/);
  });

  test("a claim the parser contradicts is reported, so the generator can refuse to publish it", () => {
    // The check run over a list that lies in each of the three ways it can:
    // a parser refusal the parser does not issue, a parser refusal with no
    // sample to show it, and a runtime claim the parser actually refuses.
    const accepted = `export const meta = { name: 'x', description: 'y' }\nconst n = 1\nreturn { n }\n`;
    expect(parseWorkflowScript(accepted).ok).toBe(true);
    expect(rejectClaimProblems([{ name: "a control", why: "the parser refuses it", sample: accepted }])).toEqual([
      expect.stringMatching(/the parser accepts its sample/),
    ]);
    expect(rejectClaimProblems([{ name: "an unbacked claim", why: "the parser refuses it" }])).toEqual([
      expect.stringMatching(/no sample to show it/),
    ]);
    expect(
      rejectClaimProblems([
        {
          name: "a miscategorised one",
          why: "it parses, then throws when the script runs",
          sample: `export const meta = { name: 'x', description: 'y' }\nconst n: number = 1\n`,
        },
      ]),
    ).toEqual([expect.stringMatching(/the parser refuses its sample/)]);
    // …and the real list says nothing the parser disagrees with.
    expect(rejectClaimProblems()).toEqual([]);
  });
});
