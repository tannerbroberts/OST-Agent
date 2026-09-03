/**
 * Would a curated set of first-class forms have expressed what callers actually
 * wrote — and, separately, what they wrote that failed?
 *
 * The candidate is "The tool surface offers the correct form so prominently that
 * the failing form is not reached for". Its assumption test fixed two bars before
 * anything was counted: **the safe forms fully express at least 60% of all
 * harvested commands, and at least 80% of the failing ones.** The node is
 * explicit about why the second one exists: "covering most commands while missing
 * most *failures* would be a set that is popular and useless, and a single
 * blended number would hide it."
 *
 * ## The count is in, and the two bars part company
 *
 * - **All commands: 83.8% — the 60% bar is MET, comfortably.**
 * - **Failing commands: 64.9% — the 80% bar is NOT MET.**
 *
 * The divergence the node built the two-bar design for is what the corpus shows.
 * A blended number would have been 83.8% and would have cleared both bars while
 * hiding the entire finding.
 *
 * Three further things fall out of the count, and the third contradicts the
 * node's own framing:
 *
 * 1. **The residue is where failure lives.** A command the forms express fails on
 *    2.21% of its invocations; one they do not fails on 6.18% — nearly three
 *    times the rate. The node's hazard clause ("the caller falls back to the form
 *    that fails, having now paid for both") is reproduced here as a measurement
 *    rather than asserted.
 * 2. **What blocks the failing bar is not quoting.** The uncovered failing weight
 *    is `expansion` (232 of 311), `builtin` (161) and `substitution` (81) — and
 *    read out, the dearest of them are one idiom repeated: `source
 *    "$HOME/.cargo/env" 2>/dev/null; which cargo || ls ~/.cargo/bin` — probing
 *    for a tool on `PATH`. Commands of that shape carry 154 of the 311 uncovered
 *    failing invocations — half the miss from one shape of question. That is
 *    environment *discovery*, and no form in the candidate set is aimed at it.
 * 3. **The `comparison` form is never reached for. Not once in 31,519
 *    invocations.** It is the form the node names first, and it is named for the
 *    founding failure — five `(eval):1: == not found` in one session. But a
 *    bracket test is already a program and a list of arguments: `[ "a" == "b" ]`
 *    is fully expressible under the plainest form in the set, and so is
 *    `echo ===`, which the sibling census established was the real text behind
 *    those errors. The comparison form buys **zero** coverage. Whatever it is
 *    worth, it is not worth what this test measures.
 *
 * ## Why this file is green while one bar is missed
 *
 * The same reason `test/runner/shell-necessity-census.test.ts` is green while its
 * bar is missed by six to one: the instrument's job is to *make the measurement
 * and pin it*, not to be the verdict. Every number below is asserted exactly
 * rather than as an inequality, so a later change that moves one shows up here as
 * a broken expectation instead of as a quietly different finding — and
 * `meetsFailingBar` is asserted `false`, in as many words, so nobody can read
 * this suite passing as the assumption holding. Recording the result is a
 * human's `ost-agent result`.
 *
 * What would have been the dishonest move is naming a seventh form for
 * environment discovery *now*, after seeing that it is what stands between 64.9%
 * and 80%. That is the fitted set the ordering in `PROVENANCE.md` exists to
 * prevent, and it is also the node's own "wrong pick" clause arriving: a form per
 * class that only ever covers the classes somebody thought to cover.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  classifySafeForm,
  formatSafeFormCoverage,
  readBashOutcomes,
  SAFE_FORM_RULE,
  safeFormCoverageCensus,
  type HarvestedOutcome,
} from "../../src/knowledge/safe-forms.js";
import type { TranscriptSession } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "safe-form-coverage");

// ── the set, before any number is read off it ────────────────────────────────

describe("the candidate set was named before the corpus was counted", () => {
  test("the bars are the ones the assumption test fixed, not ones chosen after the count", () => {
    // "The safe forms fully express at least 60% of all commands, and at least
    // 80% of the failing ones."
    expect(SAFE_FORM_RULE.bars).toEqual({ all: 0.6, failing: 0.8 });
  });

  test("six forms — the five the design names, plus the composition one it licenses", () => {
    expect(SAFE_FORM_RULE.forms).toEqual(["command", "comparison", "wait", "glob", "text", "pipeline", "sequence"]);
    // `command` is the substrate rather than a candidate form: a program and its
    // arguments, which is what every other form is built out of.
    for (const named of ["comparison", "wait", "glob", "text", "pipeline"]) {
      expect(SAFE_FORM_RULE.forms as readonly string[]).toContain(named);
    }
  });

  test("evaluation is refused: no form absorbs substitution, expansion, grouping or backgrounding", () => {
    // A form is a structure the caller fills in; evaluation is a shell running.
    // These four are counted uncovered however common they turn out to be, and
    // they turn out to be very common — which is the point of refusing them here
    // rather than after the count.
    const absorbed = Object.keys(SAFE_FORM_RULE.absorbs);
    for (const evaluated of ["substitution", "expansion", "grouping", "background", "keyword", "builtin"]) {
      expect(absorbed).not.toContain(evaluated);
    }
  });

  test("only `cd` is a field on the command form; the rest of the builtins are shell state", () => {
    expect(SAFE_FORM_RULE.fieldBuiltins).toEqual(["cd"]);
    for (const stateful of ["export", "source", "eval", "exec", "set"]) {
      expect(SAFE_FORM_RULE.fieldBuiltins as readonly string[]).not.toContain(stateful);
    }
  });

  test("the module cannot have read what it is scored against", () => {
    // The defence against a set fitted to its sample is an ordering, and an
    // ordering is only as good as the module's inability to peek. No `fs`, no
    // fixture path.
    const source = fs.readFileSync(path.join(repoRoot, "src", "knowledge", "safe-forms.ts"), "utf8");
    expect(source).not.toMatch(/from "node:fs"/);
    expect(source).not.toMatch(/test\/fixtures/);
  });
});

// ── the classifier: it fires, and it fails to fire ──────────────────────────

describe("a command every ingredient of which a form expresses", () => {
  test("a bare program and arguments needs no form at all beyond the substrate", () => {
    expect(classifySafeForm("git status --porcelain")).toEqual({ verdict: "full", forms: ["command"], uncovered: [] });
  });

  test("the composition idiom that dominates the corpus", () => {
    expect(classifySafeForm("npx tsc --noEmit 2>&1 | head -20")).toEqual({
      verdict: "full",
      forms: ["command", "pipeline"],
      uncovered: [],
    });
  });

  test("`cd <dir> && <cmd>` is a working-directory field, and says so", () => {
    const c = classifySafeForm("cd /Users/tanner/dev/OST-Agent && npx vitest run");
    expect(c.verdict).toBe("full");
    expect(c.forms).toEqual(["command", "sequence"]);
    // Flagged rather than folded in silently, so the census can report the weight
    // that rests on this judgement and a stricter reader can subtract it.
    expect(c.cwdField).toBe(true);
  });

  test("a leading `VAR=value` is an environment field", () => {
    const c = classifySafeForm("FOO=bar npm test");
    expect(c.verdict).toBe("full");
    expect(c.envField).toBe(true);
  });

  test("an unquoted glob is the glob form, which states its own no-match behaviour", () => {
    // `(eval):1: no matches found: /Users/tanner/dev/ost*`, twice in two sessions
    // a day apart, is zsh aborting the command rather than passing the pattern
    // through. A form that says what no-match means cannot produce it.
    expect(classifySafeForm("ls /Users/tanner/dev/ost*")).toEqual({
      verdict: "full",
      forms: ["command", "glob"],
      uncovered: [],
    });
  });

  test("a heredoc is literal text handed to a program — the text form exactly", () => {
    const c = classifySafeForm("cat > f.txt <<'EOF'\nhello\nEOF");
    expect(c.verdict).toBe("full");
    expect(c.forms).toContain("text");
  });

  test("a polling loop is a wait, because `sleep` is what makes it one", () => {
    expect(classifySafeForm("until gh pr checks 17; do sleep 5; done")).toEqual({
      verdict: "full",
      forms: ["command", "wait", "sequence"],
      uncovered: [],
    });
  });

  test("a bracket test is the comparison form", () => {
    expect(classifySafeForm("[[ -f package.json ]]").forms).toContain("comparison");
  });
});

describe("a command the forms cannot express", () => {
  test("parameter expansion is the shell reading its own state back", () => {
    expect(classifySafeForm('echo "$VAR"')).toEqual({ verdict: "none", forms: ["command"], uncovered: ["expansion"] });
  });

  test("a stateful builtin is not a field however much `cd` looks like one", () => {
    expect(classifySafeForm("source ~/.profile")).toEqual({ verdict: "none", forms: ["command"], uncovered: ["builtin"] });
  });

  test("backgrounding has no form and is not given one", () => {
    expect(classifySafeForm("npm test &")).toEqual({ verdict: "none", forms: ["command"], uncovered: ["background"] });
  });

  test("an iterating loop is a program, not a wait — `sleep` is the discriminator", () => {
    // `while read line; do …; done` uses the same keywords as a poll. Without a
    // `sleep` it stays uncovered, or `wait` would swallow every loop in the
    // corpus and the coverage number would be about the rule, not the record.
    const c = classifySafeForm("while read line; do echo $line; done");
    expect(c.verdict).toBe("partial");
    expect(c.forms).not.toContain("wait");
    expect(c.uncovered).toContain("keyword");
  });

  test("partial is a real verdict: some ingredients land, one does not", () => {
    const c = classifySafeForm("for f in *.ts; do echo $f; done");
    expect(c.verdict).toBe("partial");
    expect(c.forms).toEqual(["command", "glob", "sequence"]);
    expect(c.uncovered).toEqual(["expansion", "keyword"]);
  });

  test("unbalanced quoting is refused rather than guessed at", () => {
    expect(classifySafeForm("ls 'unbalanced")).toEqual({ verdict: "unreadable", forms: [], uncovered: [] });
  });

  test("quoting alone is not an ingredient — the quotes are how the string was written down", () => {
    // A classifier that read every quote as needing a shell would report a
    // coverage number about its own timidity.
    expect(classifySafeForm("grep -rn 'a|b' src/").verdict).toBe("full");
  });
});

// ── the reader: what the corpus was cut with ────────────────────────────────

function call(id: string, command: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", id, input: { command } }] },
  });
}

function result(id: string, isError: boolean): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: "…" }] },
  });
}

describe("the reader pairs every call to its outcome", () => {
  test("identical texts aggregate, and the failures aggregate with them", () => {
    const sessions: TranscriptSession[] = [
      { id: "a", jsonl: [call("1", "ls"), result("1", false), call("2", "ls"), result("2", true)].join("\n") },
      { id: "b", jsonl: [call("3", "ls"), result("3", true)].join("\n") },
    ];
    const read = readBashOutcomes(sessions);
    expect(read.invocations).toBe(3);
    expect(read.failures).toBe(2);
    expect(read.commands).toEqual([{ command: "ls", count: 3, sessions: 2, failures: 2, unpaired: 0 }]);
  });

  test("`is_error` is the only signal — an error-shaped result text is not one", () => {
    const jsonl = [
      call("1", "ls"),
      JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: "1", content: "Error: no such file" }] } }),
    ].join("\n");
    // Reading the text would make this census score its own idea of what an
    // error message looks like.
    expect(readBashOutcomes([{ id: "a", jsonl }]).failures).toBe(0);
  });

  test("a call whose result never arrives is unpaired, never a success", () => {
    const read = readBashOutcomes([{ id: "a", jsonl: call("1", "ls") }]);
    expect(read.unpaired).toBe(1);
    expect(read.failures).toBe(0);
    expect(read.commands[0]).toEqual({ command: "ls", count: 1, sessions: 1, failures: 0, unpaired: 1 });
  });

  test("another tool's result is not a Bash outcome, and a corrupt line costs one entry", () => {
    const grep = JSON.stringify({
      message: { content: [{ type: "tool_use", name: "Grep", id: "9", input: { command: "not-a-shell-line" } }] },
    });
    const read = readBashOutcomes([{ id: "a", jsonl: [grep, result("9", true), "{corrupt", call("1", "ls"), result("1", false)].join("\n") }]);
    expect(read.invocations).toBe(1);
    expect(read.failures).toBe(0);
  });
});

// ── the census over the committed corpus ────────────────────────────────────

/**
 * The committed corpus, cut from every session transcript on the machine that
 * produced this vault. `PROVENANCE.md` records how, including the session it
 * excludes — the one that built this census — and what the cut cannot support.
 */
function committedCorpus(): { commands: HarvestedOutcome[]; meta: Record<string, unknown> } {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, "commands.jsonl.gz"))).toString("utf8");
  const commands = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as HarvestedOutcome);
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, unknown>;
  return { commands, meta };
}

describe("the census over the committed corpus", () => {
  const { commands, meta } = committedCorpus();
  const census = safeFormCoverageCensus(commands, { sessionsRead: meta.sessionsRead as number });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(meta.transcriptsFound).toBe(1263);
    expect(meta.transcriptsNested).toBe(390);
    expect(meta.excludedSessions).toEqual(["62543b0f-3666-4ac3-91cd-50a86c67e143"]);
    expect(census.sessionsRead).toBe(1262);
    expect(census.invocations).toBe(31519);
    expect(census.distinct).toBe(27959);
    expect(commands.reduce((n, c) => n + c.count, 0)).toBe(31519);
    // Every call on this record got a result. The reader's unpaired branch never
    // fires here, so nothing is missing from the failing denominator.
    expect(meta.unpairedInvocations).toBe(0);
    expect(commands.reduce((n, c) => n + c.unpaired, 0)).toBe(0);
  });

  // ── the two counts the assumption test reads ──────────────────────────────

  test("all commands: 83.8% are fully expressible — the 60% bar IS met", () => {
    expect(census.fullInvocations).toBe(26122);
    expect(census.partialInvocations).toBe(5016);
    expect(census.noneInvocations).toBe(17);
    expect(census.allShare).toBe(26122 / 31155);
    expect(census.meetsAllBar).toBe(true);
  });

  test("failing commands: 64.9% are fully expressible — the 80% bar is NOT met", () => {
    // The finding. Read this line next to the one above it: the two bars part
    // company by nineteen points, and the node's whole reason for weighting them
    // separately was that a blended number would hide exactly this.
    expect(census.failingInvocations).toBe(898);
    expect(census.failingUnreadableInvocations).toBe(11);
    expect(census.failingFullInvocations).toBe(576);
    expect(census.failingShare).toBe(576 / 887);
    expect(census.meetsFailingBar).toBe(false);
    expect(census.meetsBothBars).toBe(false);
  });

  test("a blended number would have cleared both bars and hidden the whole result", () => {
    // 83.8% against 60% and against 80%. This is the arithmetic the node
    // predicted and asked to be protected from, done out loud.
    expect(census.allShare).toBeGreaterThan(SAFE_FORM_RULE.bars.failing);
    expect(census.failingShare).toBeLessThan(SAFE_FORM_RULE.bars.failing);
  });

  test("the residue is where failure lives: 6.18% against 2.21%, nearly three to one", () => {
    // The node's hazard clause is that a caller the forms miss falls back to the
    // form that fails. On this record the miss and the failures coincide, and
    // the ratio is the size of the coincidence.
    let fullInv = 0;
    let fullFail = 0;
    let restInv = 0;
    let restFail = 0;
    for (const entry of commands) {
      const c = classifySafeForm(entry.command);
      if (c.verdict === "unreadable") continue;
      if (c.verdict === "full") {
        fullInv += entry.count;
        fullFail += entry.failures;
      } else {
        restInv += entry.count;
        restFail += entry.failures;
      }
    }
    expect(fullInv).toBe(26122);
    expect(restInv).toBe(5033);
    expect(fullFail).toBe(576);
    expect(restFail).toBe(311);
    expect(fullFail / fullInv).toBeCloseTo(0.0221, 4);
    expect(restFail / restInv).toBeCloseTo(0.0618, 4);
  });

  // ── what the miss is actually made of ─────────────────────────────────────

  test("what blocks the failing bar is evaluation, not quoting", () => {
    const by = new Map(census.uncovered.map((u) => [u.feature, u]));
    expect(by.get("expansion")).toEqual({ feature: "expansion", invocations: 3200, distinct: 2831, failingInvocations: 232 });
    expect(by.get("builtin")).toEqual({ feature: "builtin", invocations: 1587, distinct: 1312, failingInvocations: 161 });
    expect(by.get("substitution")?.failingInvocations).toBe(81);
    expect(by.get("grouping")?.failingInvocations).toBe(107);
    expect(by.get("keyword")?.failingInvocations).toBe(86);
    expect(by.get("background")?.failingInvocations).toBe(14);
    // Not one of these is the quoting-and-globbing class the candidate set was
    // designed against. Every failure the node's opportunity quotes is already
    // fully expressible; what is left over is a different problem.
  });

  test("the dearest uncovered failing idiom is environment discovery, which no form is aimed at", () => {
    // `source "$HOME/.cargo/env" 2>/dev/null; which cargo || ls ~/.cargo/bin` —
    // "is this tool here, and where". A set of forms for comparisons, waits,
    // globs, text and pipelines has nothing to offer it, and it is the single
    // largest block of uncovered failing weight in the corpus.
    const probing = commands.filter((entry) => {
      const c = classifySafeForm(entry.command);
      return c.verdict !== "full" && c.verdict !== "unreadable" && /\b(source|which|command -v)\b|\$PATH|\$HOME/.test(entry.command);
    });
    expect(probing.length).toBe(1494);
    expect(probing.reduce((n, c) => n + c.count, 0)).toBe(1780);
    expect(probing.reduce((n, c) => n + c.failures, 0)).toBe(154);
    // Half the uncovered failing weight, from one shape of question.
    expect(154 / 311).toBeCloseTo(0.495, 3);
  });

  test("the finding survives the classifier's one known bias", () => {
    // A heredoc body is scanned as if it were shell — a `(` or a `$` in the
    // literal text counts as `grouping` or `expansion` — so the census
    // understates coverage wherever a heredoc appears. The ceiling: count every
    // heredoc-bodied command fully expressible and the failing share reaches
    // 73.3%, still short of 80%. The miss is not an artefact of the bias.
    let heredocFailures = 0;
    for (const entry of commands) {
      const c = classifySafeForm(entry.command);
      if (c.verdict === "full" || c.verdict === "unreadable") continue;
      if (entry.command.includes("<<")) heredocFailures += entry.failures;
    }
    expect(heredocFailures).toBe(74);
    expect((576 + 74) / 887).toBeCloseTo(0.733, 3);
    expect((576 + 74) / 887).toBeLessThan(SAFE_FORM_RULE.bars.failing);
  });

  // ── which forms carry the coverage, and which carries none ────────────────

  test("the coverage is carried by composition, not by the quoting-safe forms", () => {
    const by = new Map(census.forms.map((f) => [f.form, f]));
    expect(by.get("command")?.invocations).toBe(31155);
    expect(by.get("sequence")?.invocations).toBe(23880);
    expect(by.get("pipeline")?.invocations).toBe(20884);
    // The four forms the node names for quoting safety together touch a small
    // fraction of what `sequence` alone does.
    expect(by.get("glob")?.invocations).toBe(2426);
    expect(by.get("text")?.invocations).toBe(1553);
    expect(by.get("wait")?.invocations).toBe(130);
  });

  test("the `comparison` form is never reached for — not once in 31,519 invocations", () => {
    // The form the node names first, named for the founding failure, and it
    // covers nothing: a bracket test is already a program and a list of
    // arguments, and so is `echo ===`, which the sibling census established was
    // the real text behind the `== not found` errors. Whatever a comparison form
    // is worth, it is not worth coverage.
    expect(census.forms.some((f) => f.form === "comparison")).toBe(false);
    expect(classifySafeForm('[ "a" == "b" ]')).toEqual({ verdict: "full", forms: ["command"], uncovered: [] });
    expect(classifySafeForm("echo ===")).toEqual({ verdict: "full", forms: ["command"], uncovered: [] });
  });

  test("the coverage that rests on a field rather than a form is reported, not folded in", () => {
    // 14,639 of the 26,122 fully-expressible invocations needed the command
    // form's working-directory field — the harness resets the directory between
    // calls, so callers prefix nearly everything with `cd`. A reader who thinks
    // a `cwd` parameter is cheating can subtract it here rather than take this
    // module's word for it.
    expect(census.cwdFieldFullInvocations).toBe(14639);
    expect(census.envFieldInvocations).toBe(1529);
    expect((26122 - 14639) / 31155).toBeCloseTo(0.3686, 3);
    // And that is the honest strict floor: without the field, the all-commands
    // bar of 60% would NOT be met either.
    expect((26122 - 14639) / 31155).toBeLessThan(SAFE_FORM_RULE.bars.all);
  });

  test("the report states both bars on their own line, which is the point of having two", () => {
    const rendered = formatSafeFormCoverage(census);
    expect(rendered.startsWith("Coverage:")).toBe(true);
    expect(rendered).toContain("bar is 60.0%, met");
    expect(rendered).toContain("bar is 80.0%, NOT MET");
    expect(rendered).toContain("AS WRITTEN");
  });

  test("a census that read nothing reports UNREAD rather than a clean zero", () => {
    const empty = safeFormCoverageCensus([], { sessionsRead: 0 });
    expect(empty.meetsAllBar).toBe(false);
    expect(empty.meetsFailingBar).toBe(false);
    expect(formatSafeFormCoverage(empty)).toContain("UNREAD");
  });
});
