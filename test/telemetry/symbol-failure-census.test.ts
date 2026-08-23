/**
 * The symbol-failure census: when a run called a symbol the compiler could not
 * find, had it *meant to add* that symbol — or was the symbol already there?
 *
 * The solution under test is a declaration ledger: before referencing a symbol it
 * has not written, a run declares it, and a batch that ends with the declaration
 * still open reports a dropped intention by name. The assumption test beneath it
 * fixed the bar before anyone counted: **at least 3 in 10 of these failures must
 * be dropped intentions.** Below that, the mechanism addresses a case that barely
 * occurs and the effort belongs with its two siblings.
 *
 * **The controls are what carry this file.** A classifier that answered "dropped
 * intention" to everything would satisfy any assertion about a corpus that came
 * out high — and the cheap reading of this corpus *does* come out at 92%. So the
 * synthetic cases below run first and in both directions: each class fires on a
 * repair built to carry it and fails to fire on one built to look like it and not
 * be it. Only then is the number over the real corpus worth reading.
 *
 * The rule is `SYMBOL_FAILURE_RULE`, committed in `src/telemetry/symbol-failure.ts`
 * before this corpus was counted, including the two judgement calls it refuses to
 * be trusted on — what counts as a dropped intention, and what to do with the
 * failures nobody repaired. Both are published as ladders rather than defended,
 * and on this corpus they disagree about the bar, which the report says on its
 * face.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readTranscriptSessions } from "../../src/telemetry/preflight.js";
import {
  classifyResolution,
  formatSymbolFailureCensus,
  isTypecheckCommand,
  parseSymbolErrors,
  readEditIntent,
  readEdits,
  readSymbolFailures,
  resolveSymbolFailures,
  symbolFailureCensus,
  SYMBOL_FAILURE_RULE,
  type CitedFailure,
  type ResolvedFailure,
} from "../../src/telemetry/symbol-failure.js";
import type { TranscriptSession } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "symbol-failure");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(SYMBOL_FAILURE_RULE.bar).toBe(0.3);
  });

  test("both halves of the symbol-error family are read, suggestion and no suggestion", () => {
    // TS2552 and TS2551 only fire when the compiler has a near-match to offer.
    // Reading those without their suggestionless twins — TS2304 and TS2339 —
    // would put a thumb on the very axis one of the two readings turns on.
    expect([...SYMBOL_FAILURE_RULE.codes].sort()).toEqual(["TS2304", "TS2339", "TS2551", "TS2552"]);
  });

  test("the repair window is unbounded, because a cap would flatter the solution", () => {
    // `unresolved` is the bucket the most generous denominator counts as dropped
    // intentions, so any rule that manufactures unresolved failures moves the
    // number toward a green.
    expect(SYMBOL_FAILURE_RULE.repairWindow).toBe(Number.POSITIVE_INFINITY);
  });
});

// ── the parser: the compiler fires, and fails to fire ────────────────────────

describe("lifting a symbol error out of compiler output", () => {
  test("a bare name with a suggestion carries both", () => {
    const [error] = parseSymbolErrors(
      "src/cli/index.ts(108,26): error TS2552: Cannot find name 'reconcileWithUsage'. Did you mean 'reconcileWithGit'?",
    );
    expect(error).toMatchObject({ code: "TS2552", symbol: "reconcileWithUsage", suggestion: "reconcileWithGit", onType: "" });
  });

  test("a bare name without one carries a null suggestion, not an empty string", () => {
    const [error] = parseSymbolErrors("src/x.ts(1,1): error TS2304: Cannot find name 'LoopConfig'.");
    expect(error).toMatchObject({ code: "TS2304", symbol: "LoopConfig", suggestion: null });
  });

  test("a missing property carries the type it was looked for on", () => {
    const [error] = parseSymbolErrors(
      "src/security/tools.ts(744,63): error TS2339: Property 'configProblem' does not exist on type 'ToolContext'.",
    );
    expect(error).toMatchObject({ code: "TS2339", symbol: "configProblem", onType: "ToolContext", suggestion: null });
  });

  test("an inline union spends hundreds of characters being a type, and is clipped to one", () => {
    const union = `{ ts: string; kind: "web" | "channel"; ${"id: string; ".repeat(40)}}`;
    const [error] = parseSymbolErrors(`src/x.ts(1,1): error TS2339: Property 'node' does not exist on type '${union}'.`);
    expect(error.symbol).toBe("node");
    expect(error.onType.length).toBeLessThanOrEqual(121);
    expect(error.onType.startsWith("{ ts: string; kind:")).toBe(true);
  });

  test("several errors in one block are several errors", () => {
    const errors = parseSymbolErrors(
      ["a.ts(1,1): error TS2304: Cannot find name 'hostRung'.", "b.ts(2,2): error TS2304: Cannot find name 'rankHost'."].join("\n"),
    );
    expect(errors.map((e) => e.symbol)).toEqual(["hostRung", "rankHost"]);
  });

  test("a type error that is not about a symbol is not one", () => {
    // The third capture under the parent opportunity. It is a real failure and it
    // is not this class: nothing was missing, a `readonly` was.
    expect(
      parseSymbolErrors("error TS4104: The type 'readonly OstNode[]' is 'readonly' and cannot be assigned to the mutable type 'OstNode[]'"),
    ).toEqual([]);
    expect(parseSymbolErrors("error TS2322: Type 'string' is not assignable to type 'number'.")).toEqual([]);
  });
});

// ── the scope rule: a compiler ran, or the record was read back ──────────────

describe("whether the text came from a compiler or from the record", () => {
  test("the commands that run one", () => {
    expect(isTypecheckCommand("npx tsc --noEmit")).toBe(true);
    expect(isTypecheckCommand("cd /repo && npx tsc --noEmit 2>&1 | head -20")).toBe(true);
    expect(isTypecheckCommand("npm run build 2>&1 | head -10")).toBe(true);
    expect(isTypecheckCommand("npx vitest run test/x.test.ts")).toBe(true);
    // The idiom this project actually uses: edit through a heredoc, typecheck on
    // the end of the same command line.
    expect(isTypecheckCommand("python3 - <<'PY'\ns=s.replace('a','b')\nPY\nnpx tsc --noEmit && npx vitest run")).toBe(true);
  });

  test("…and the commands that only read a record that mentions one", () => {
    expect(isTypecheckCommand('grep -rn "configProblem" src/ test/')).toBe(false);
    expect(isTypecheckCommand('cd ~/.claude/projects && grep -rho "error TS2552"')).toBe(false);
    expect(isTypecheckCommand("cat .ost-agent/evidence/TRANSCRIPT_e335a680.md")).toBe(false);
  });

  test("the rule is about the command, never about the text around it", () => {
    // The defect this pins. An earlier draft matched the word `typecheck`
    // anywhere, and this vault holds a node titled "I call a symbol I never
    // wrote, and a whole-project typecheck at the end of the batch is what tells
    // me" — whose body quotes both captures verbatim. Reading four `Read`s of it
    // as four compiler runs would have doubled the corpus with its own echo.
    const title = "I call a symbol I never wrote, and a whole-project typecheck at the end of the batch is what tells me";
    expect(isTypecheckCommand(title)).toBe(false);
    expect(isTypecheckCommand(`cat "${title}.md"`)).toBe(false);
  });
});

// ── the edit reader: every carrier this project actually edits through ───────

describe("the substitutions a tool call performs", () => {
  test("a structured edit is one pair", () => {
    expect(readEdits("Edit", { old_string: "before", new_string: "after" })).toEqual([{ removed: "before", added: "after" }]);
  });

  test("a write is added text with nothing removed", () => {
    expect(readEdits("Write", { content: "export const x = 1;" })).toEqual([{ removed: "", added: "export const x = 1;" }]);
  });

  test("a multi-edit is one pair per edit", () => {
    const pairs = readEdits("MultiEdit", { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }] });
    expect(pairs).toEqual([{ removed: "a", added: "b" }, { removed: "c", added: "d" }]);
  });

  test("a python heredoc's replace is read, single-quoted and triple-quoted alike", () => {
    // The coverage that decides whether this census can read its corpus at all.
    // A reader that understood only `Edit` scored fourteen of twenty-five
    // failures unresolved; five of them had been repaired by exactly this.
    const triple = readEdits("Bash", {
      command: "python3 - <<'PY'\np='x.ts'\ns=open(p).read()\ns=s.replace('''const klass = spendClass();''','''''')\nPY",
    });
    expect(triple).toContainEqual({ removed: "const klass = spendClass();", added: "" });

    const single = readEdits("Bash", {
      command: `python3 - <<'PY'\ns=s.replace("const { Shared_GRID_GAP_RATIO } = c;","const { GRID_GAP_RATIO } = c;")\nPY`,
    });
    expect(single).toContainEqual({
      removed: "const { Shared_GRID_GAP_RATIO } = c;",
      added: "const { GRID_GAP_RATIO } = c;",
    });
  });

  test("…and the same substitution written as two variables", () => {
    const pairs = readEdits("Bash", {
      command: 'python3 - <<\'PY\'\nold="""const a = 1;"""\nnew="""const a = 2;"""\ns=s.replace(old,new)\nPY',
    });
    expect(pairs).toContainEqual({ removed: "const a = 1;", added: "const a = 2;" });
  });

  test("a command that is not a substitution is added text, so a heredoc can still define", () => {
    const pairs = readEdits("Bash", { command: "cat > x.ts <<'EOF'\nexport function isHeadingLine() {}\nEOF" });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].removed).toBe("");
    expect(pairs[0].added).toContain("isHeadingLine");
  });

  test("a tool that does not edit performs no substitution", () => {
    expect(readEdits("Read", { file_path: "/x.ts" })).toEqual([]);
    expect(readEdits("Grep", { pattern: "configProblem" })).toEqual([]);
  });
});

// ── the classifier: each repair fires, and fails to fire ─────────────────────

describe("a repair that writes the symbol — the case the ledger covers", () => {
  test("a function, a const, a type and an interface all count as defining it", () => {
    expect(readEditIntent("isHeadingLine", "", "export function isHeadingLine(l: string) {}")).toBe("defined");
    expect(readEditIntent("HOST_RUNGS", "", "const HOST_RUNGS = [1, 2];")).toBe("defined");
    expect(readEditIntent("LoopConfig", "", "export interface LoopConfig { n: number }")).toBe("defined");
  });

  test("a property added to a type is defining it — the shape of the one real case", () => {
    // `configProblem` on `ToolContext`: the run referenced a property it meant to
    // add, and then added it. This is the whole of the corpus's dropped-intention
    // cell, so the assertion that the classifier catches it is load-bearing.
    expect(readEditIntent("configProblem", "", "interface ToolContext {\n  configProblem?: string;\n}")).toBe("defined");
  });

  test("a definition that was already there is not a new one", () => {
    // Reformatting a file that already defines the symbol must not read as the
    // run having just written it.
    const both = "export function mapped() {}";
    expect(readEditIntent("mapped", both, `${both}\n`)).not.toBe("defined");
  });
});

describe("a repair that shows the symbol already existed", () => {
  test("adding it to an import clause is scope, not absence", () => {
    expect(
      readEditIntent(
        "reconcileWithUsage",
        'import { formatCensus, reconcileWithGit } from "../ost/census.js";',
        'import { formatCensus, reconcileWithGit, reconcileWithUsage } from "../ost/census.js";',
      ),
    ).toBe("imported");
  });

  test("a type-only import is still an import", () => {
    expect(readEditIntent("OstNode", 'import { LAYERS } from "../ost/node.js";', 'import { LAYERS, type OstNode } from "../ost/node.js";')).toBe(
      "imported",
    );
  });

  test("an import that was already there is not a new one", () => {
    const clause = 'import { OstNode } from "./node.js";';
    expect(readEditIntent("OstNode", clause, `${clause}\nconst x = 1;`)).toBeNull();
  });
});

describe("a repair that changes the call rather than the project", () => {
  test("replacing the reference is a wrong name", () => {
    expect(readEditIntent("Shared_GRID_GAP_RATIO", "const { Shared_GRID_GAP_RATIO } = c;", "const { GRID_GAP_RATIO } = c;")).toBe("renamed");
  });

  test("deleting the reference outright is the same verdict — the run did not want it", () => {
    expect(readEditIntent("spendClass", "const klass = spendClass();\nif (!b.take(klass))", "if (!b.take())")).toBe("renamed");
  });

  test("keeping the name and changing what it is asked of is a wrong receiver", () => {
    // Neither a dropped intention nor a wrong name: `processes` was never
    // missing, and it was never misspelled. The parent solution's binary
    // taxonomy has no cell for this, and it is the second-largest one here.
    expect(
      readEditIntent("processes", 'readConfig(dir).processes["P3"]', 'readConfig(dir).config.processes["P3"]'),
    ).toBe("rehomed");
  });

  test("an edit that never mentions the symbol says nothing about it", () => {
    expect(readEditIntent("configProblem", "const a = 1;", "const a = 2;")).toBeNull();
  });
});

// ── the reader: which errors are failures, and which are the record talking ──

function entry(...blocks: Record<string, unknown>[]): string {
  return JSON.stringify({ type: "assistant", timestamp: "2026-08-06T00:00:00.000Z", message: { content: blocks } });
}

function sessionOf(...entries: string[]): TranscriptSession[] {
  return [{ id: "synthetic", jsonl: entries.join("\n") }];
}

const TSC_ERROR = "src/x.ts(1,1): error TS2304: Cannot find name 'widget'.";

describe("the reader separates a compiler's verdict from the record being read back", () => {
  test("a typecheck's output is a failure", () => {
    const read = readSymbolFailures(
      sessionOf(
        entry({ type: "tool_use", id: "t1", name: "Bash", input: { command: "npx tsc --noEmit" } }),
        entry({ type: "tool_result", tool_use_id: "t1", content: TSC_ERROR }),
      ),
    );
    expect(read.failures.map((f) => f.symbol)).toEqual(["widget"]);
    expect(read.cited).toEqual([]);
  });

  test("a node file quoting the same error is a citation, counted neither way", () => {
    const read = readSymbolFailures(
      sessionOf(
        entry({ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/vault/I call a symbol I never wrote.md" } }),
        entry({ type: "tool_result", tool_use_id: "t1", content: TSC_ERROR }),
      ),
    );
    expect(read.failures).toEqual([]);
    expect(read.cited.map((c) => c.tool)).toEqual(["Read"]);
    expect(read.errorsSeen).toBe(1);
  });

  test("a tree dump carrying it is the same — this is how most of it travels", () => {
    const read = readSymbolFailures(
      sessionOf(
        entry({ type: "tool_use", id: "t1", name: "mcp__ost-agent__ost_read_tree", input: {} }),
        entry({ type: "tool_result", tool_use_id: "t1", content: TSC_ERROR }),
      ),
    );
    expect(read.failures).toEqual([]);
    expect(read.cited[0]).toMatchObject({ tool: "mcp__ost-agent__ost_read_tree", errors: 1 });
  });

  test("a second typecheck re-emitting the same error is the same failure, not a second one", () => {
    // A run that fixes a symbol and re-runs `tsc` sees the error again if the fix
    // did not take. Counting emissions would report this corpus as several times
    // its real size, all of it weighted toward whichever failure took longest to
    // repair.
    const read = readSymbolFailures(
      sessionOf(
        entry({ type: "tool_use", id: "t1", name: "Bash", input: { command: "npx tsc --noEmit" } }),
        entry({ type: "tool_result", tool_use_id: "t1", content: TSC_ERROR }),
        entry({ type: "tool_use", id: "t2", name: "Bash", input: { command: "npx tsc --noEmit" } }),
        entry({ type: "tool_result", tool_use_id: "t2", content: TSC_ERROR }),
      ),
    );
    expect(read.failures).toHaveLength(1);
    expect(read.errorsSeen).toBe(2);
  });

  test("a result whose call is not in the transcript is a citation, never a failure", () => {
    const read = readSymbolFailures(sessionOf(entry({ type: "tool_result", tool_use_id: "gone", content: TSC_ERROR })));
    expect(read.failures).toEqual([]);
    expect(read.cited[0].tool).toBe("(unpaired)");
  });
});

describe("the resolution is read forward from the failure, never backward", () => {
  const jsonl = [
    entry({ type: "tool_use", id: "t0", name: "Edit", input: { old_string: "x", new_string: "const widget = 1;" } }),
    entry({ type: "tool_use", id: "t1", name: "Bash", input: { command: "npx tsc --noEmit" } }),
    entry({ type: "tool_result", tool_use_id: "t1", content: TSC_ERROR }),
    entry({ type: "tool_use", id: "t2", name: "Edit", input: { old_string: "y", new_string: "const widget = 2;" } }),
  ].join("\n");

  test("the edit that came before the compiler ran is not the repair", () => {
    const [failure] = readSymbolFailures([{ id: "s", jsonl }]).failures;
    expect(failure.entry).toBe(2);
    expect(classifyResolution(failure, jsonl)).toMatchObject({ resolution: "defined", resolvedBy: "Edit e3" });
  });

  test("a session that never touches the symbol again is unresolved, not repaired", () => {
    const short = jsonl.split("\n").slice(0, 3).join("\n");
    const [failure] = readSymbolFailures([{ id: "s", jsonl: short }]).failures;
    expect(classifyResolution(failure, short)).toMatchObject({ resolution: "unresolved", resolvedBy: "" });
  });
});

// ── the corpus this test exists to count ─────────────────────────────────────

/**
 * The committed corpus, cut from every session transcript on the machine that
 * produced this vault. `PROVENANCE.md` records how, including the session it
 * excludes — the one that built this census — and what the cut cannot support.
 */
function committedCorpus() {
  const jsonl = <T,>(name: string): T[] =>
    fs
      .readFileSync(path.join(fixtureDir, name), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as T);
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as {
    sessionsRead: number;
    errorsSeen: number;
    excludedSessions: string[];
  };
  return { classified: jsonl<ResolvedFailure>("resolutions.jsonl"), cited: jsonl<CitedFailure>("citations.jsonl"), meta };
}

describe("the census over the committed corpus", () => {
  const { classified, cited, meta } = committedCorpus();
  const census = symbolFailureCensus(classified, { sessionsRead: meta.sessionsRead, errorsSeen: meta.errorsSeen, cited });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.sessionsRead).toBe(1426);
    expect(census.failures).toBe(25);
    expect(meta.excludedSessions).toEqual(["c2cc5547-780a-41f9-861f-2ef9b5f9fb52"]);
  });

  test("most of the symbol-error text in the record is the record quoting itself", () => {
    // 36 of the 69 errors seen reached a run through a `Read` of a node, a tree
    // dump or a grep — not through a compiler. Counting text rather than
    // compiler runs would have reported this two-symbol echo as the corpus.
    expect(census.errorsSeen).toBe(69);
    expect(census.cited).toHaveLength(30);
    expect(census.cited.reduce((total, citation) => total + citation.errors, 0)).toBe(36);
    expect(census.cited.every((citation) => citation.tool !== "")).toBe(true);
  });

  test("the failures fall into five repairs, and two of them are dropped intentions", () => {
    expect(census.cells).toEqual({ defined: 2, imported: 4, renamed: 6, rehomed: 4, unresolved: 9 });
    expect(census.resolved).toBe(16);
  });

  test("the pre-committed 3-in-10 bar is MISSED, and generously so", () => {
    // The losing branch the assumption test wrote down before the count: below
    // the bar, the declaration ledger should be deferred in favour of its two
    // siblings. This is that branch.
    //
    // "Generously" is exact. One of the two dropped intentions is `hits` in
    // `e6e8542c`, where the run added `get hits()` to `src/ost/search.ts` as a
    // *mutation probe* and restored the file from a backup twelve entries later.
    // A rule that could see a `cp -f` undo a definition would score it 1 of 16.
    // The census does not model file restores, so it counts the probe — an error
    // in the direction that helps the solution under test, which still misses
    // the bar by a factor of two and a half.
    expect(census.dropped).toBe(2);
    expect(census.share).toBeCloseTo(0.125, 4);
    expect(census.meetsBar).toBe(false);
  });

  test("half the repairs are cases the parent's two-value taxonomy has no cell for", () => {
    // `imported` and `rehomed` are both "the symbol existed, under exactly this
    // name". Neither is a dropped intention and neither is a wrong name, and a
    // declaration ledger does nothing for either.
    expect(census.cells.imported + census.cells.rehomed).toBe(8);
    expect(census.cells.imported + census.cells.rehomed).toBeGreaterThan(census.cells.defined);
  });

  test("the cheap reading the solution's own framing implies says the opposite", () => {
    // "No `Did you mean`" would call 23 of 25 a dropped intention and clear the
    // bar three times over. It is wrong for a reason the corpus can show: see
    // the `reconcileWithUsage` case below, where the compiler *did* suggest a
    // near-match and the symbol was neither missing nor misspelled.
    expect(census.readings.map((r) => [r.dropped, r.denominator, r.meetsBar])).toEqual([
      [2, 16, false],
      [23, 25, true],
    ]);
  });

  test("the verdict moves with what is done about the failures nobody repaired, and the census says so", () => {
    expect(census.denominators.map((r) => [r.dropped, r.denominator, r.meetsBar])).toEqual([
      [2, 16, false],
      [11, 25, true],
      [2, 25, false],
    ]);
    expect(census.ruleDecides).toBe(true);
    expect(formatSymbolFailureCensus(census)).toContain("THE RULE DECIDES THIS");
  });

  test("the only rung that clears the bar does so by calling `URL` a symbol somebody meant to write", () => {
    // The generous denominator turns all nine unrepaired failures into dropped
    // intentions. Three of the nine are `AbortSignal`, `URL` and `ImportMeta.url`
    // — standard library names missing from a `lib` setting, which nobody
    // intended to add and no declaration ledger would have caught. Naming them
    // here is how a reader discounts that rung without having to trust a curated
    // list of globals in the rule.
    const unresolved = census.classified.filter((failure) => failure.resolution === "unresolved");
    expect(unresolved).toHaveLength(9);
    expect(unresolved.map((f) => f.symbol)).toEqual(expect.arrayContaining(["URL", "AbortSignal", "url"]));
    expect(census.denominators[1].meetsBar).toBe(true);
    expect(census.denominators.filter((rung) => rung.meetsBar)).toHaveLength(1);

    // The remaining six are subagents whose transcript ends after the failing
    // typecheck. "Never repaired" there is a fact about where the recording
    // stops, so the whole bucket has an explanation that is not intention.
    expect(unresolved.filter((failure) => failure.session.startsWith("agent-"))).toHaveLength(6);
  });

  test("the report leads with coverage and never claims to have counted what was wanted", () => {
    const rendered = formatSymbolFailureCensus(census);
    expect(rendered).toContain("Coverage:");
    expect(rendered).toContain("it counts failures that REACHED A TYPECHECK");
  });
});

// ── the reader against the real record, not a synthetic one ──────────────────

describe("the two committed transcript slices are the captures the tree names", () => {
  const slices = readTranscriptSessions(fixtureDir).filter((session) => /^[0-9a-f-]{36}$/.test(session.id));
  const { classified } = resolveSymbolFailures(slices);
  const bySymbol = new Map(classified.map((failure) => [failure.symbol, failure]));

  test("both slices are read, and they carry three failures between them", () => {
    expect(slices.map((s) => s.id).sort()).toEqual([
      "10002eba-85b9-4400-92dd-6fc8f5e4333f",
      "e335a680-ee48-4171-b8ad-4cfb526e4129",
    ]);
    expect([...bySymbol.keys()].sort()).toEqual(["configProblem", "processes", "reconcileWithUsage"]);
  });

  test("`configProblem` is the dropped intention — the one the whole solution is built on", () => {
    expect(bySymbol.get("configProblem")).toMatchObject({ code: "TS2339", onType: "ToolContext", resolution: "defined" });
    // The repair adds the property to `ToolContext` with a doc comment on it —
    // the clipped evidence catches the comment before the declaration, which is
    // itself the tell: the run was not fixing a typo, it was writing the thing.
    expect(bySymbol.get("configProblem")?.evidence).toContain("could not be read");
  });

  test("`reconcileWithUsage` — the tree's wrong-name exemplar — was a missing import", () => {
    // The finding this slice exists to hold. The opportunity node reads the
    // compiler's `Did you mean 'reconcileWithGit'?` as proof that "the correct
    // name was recoverable from the project the whole time". It was not the
    // correct name: the run had written `reconcileWithUsage` into
    // `src/ost/census.ts` earlier in the same session, and the repair was to add
    // it to `src/cli/index.ts`'s import clause. The compiler's suggestion was a
    // near-match to a *different* function, and following it would have been the
    // bug.
    const failure = bySymbol.get("reconcileWithUsage");
    expect(failure).toMatchObject({ code: "TS2552", suggestion: "reconcileWithGit", resolution: "imported" });
    expect(failure?.evidence).toContain("reconcileWithGit, reconcileWithUsage");
  });

  test("`processes` is the wrong-receiver case, read end to end off a real transcript", () => {
    expect(bySymbol.get("processes")).toMatchObject({ code: "TS2339", onType: "ConfigLoad", resolution: "rehomed" });
    expect(bySymbol.get("processes")?.evidence).toContain("readConfig(dir).config.processes");
  });

  test("the slices' classifications are the ones the committed corpus records", () => {
    // The fixture is pre-classified for speed; this is the check that it was not
    // classified by a different reader than the one shipping in `src/`.
    const { classified: corpus } = committedCorpus();
    for (const [symbol, failure] of bySymbol) {
      const recorded = corpus.find((candidate) => candidate.symbol === symbol && candidate.session === failure.session);
      expect(recorded?.resolution, symbol).toBe(failure.resolution);
      expect(recorded?.resolvedBy, symbol).toBe(failure.resolvedBy);
    }
  });
});
