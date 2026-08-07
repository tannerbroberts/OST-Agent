/**
 * The search-literality census: were the searches this project issued over node
 * text literal lookups wearing a pattern language's clothes?
 *
 * The solution under test is a search entry point that takes text as data and
 * nothing else — no glob, no regex, no shell word-splitting — so that no escaping
 * question can arise. It covers the work only if the work is mostly literal, and
 * the assumption test beneath it fixed the bar before anyone counted: **at least
 * 90% of tree-derived search arguments must be expressible as literal lookups.**
 * Below that, a literal-only interface just moves those calls to an escape hatch
 * and the failures come back through it.
 *
 * **The controls are what carry this file.** A classifier that answered "literal"
 * to everything would satisfy every assertion about a corpus that came out high.
 * So the synthetic cases below run first and in both directions: each class fires
 * on an argument built to carry it, and fails to fire on one built to look like it
 * and not be it. Only then is the number over the real corpus worth reading.
 *
 * The rule is `LITERALITY_RULE`, committed in `src/telemetry/search-literality.ts`
 * before this corpus was counted — including the two judgement calls it refuses to
 * be trusted on, which are published as ladders rather than defended. This test
 * asserts the shape of the rule as well as its output, so a later edit shows up
 * here as a changed expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readTranscriptSessions } from "../../src/telemetry/preflight.js";
import {
  breToRegex,
  classifyLiterality,
  classifyProvenance,
  expandRegex,
  formatSearchLiteralityCensus,
  globCompiles,
  globQuestion,
  literalRuns,
  LITERALITY_RULE,
  readSearchArguments,
  searchLiteralityCensus,
  type SearchArgument,
  type UnreadSearch,
} from "../../src/telemetry/search-literality.js";
import type { TranscriptSession } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "search-literality");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(LITERALITY_RULE.bar).toBe(0.9);
  });

  test("the readings of 'literal' are monotone, so a rung can only admit more", () => {
    const rungs = LITERALITY_RULE.readings.map((r) => r.classes);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]).toEqual(expect.arrayContaining([...rungs[i - 1]]));
      expect(rungs[i].length).toBeGreaterThan(rungs[i - 1].length);
    }
    // The strictest rung is a single literal lookup; the headline admits an
    // argument that never compiled. Both are stated, neither is hidden.
    expect(rungs[0]).toEqual(["literal"]);
    expect(rungs[rungs.length - 1]).toContain("malformed");
  });

  test("the provenance ladder brackets the threshold the headline uses", () => {
    expect(LITERALITY_RULE.provenanceLadder).toContain(LITERALITY_RULE.minMatchChars);
    expect(Math.min(...LITERALITY_RULE.provenanceLadder)).toBeLessThan(LITERALITY_RULE.minMatchChars);
    expect(Math.max(...LITERALITY_RULE.provenanceLadder)).toBeGreaterThan(LITERALITY_RULE.minMatchChars);
  });
});

// ── literality: the classifier fires, and fails to fire ──────────────────────

describe("an argument a literal lookup would have answered", () => {
  test("text with no syntax in it at all", () => {
    const c = classifyLiterality("A model reads the raw transcript", "regex");
    expect(c.literality).toBe("literal");
    expect(c.literals).toEqual(["A model reads the raw transcript"]);
  });

  test("a title whose punctuation was escaped — the quoter's output is still a literal", () => {
    const c = classifyLiterality("\\[\\[Rank every node by how many blocked tests one build would unblock\\]\\]", "regex");
    expect(c.literality).toBe("literal");
    expect(c.literals).toEqual(["[[Rank every node by how many blocked tests one build would unblock]]"]);
  });

  test("an alternation of titles is several literal lookups, not a pattern", () => {
    const c = classifyLiterality("First title|Second title|Third title", "regex");
    expect(c.literality).toBe("union-of-literals");
    expect(c.literals).toEqual(["First title", "Second title", "Third title"]);
  });

  test("a group inside a literal frame expands to the frames it stands for", () => {
    const c = classifyLiterality("\\[\\[(One test|Another test)\\]\\]", "regex");
    expect(c.literality).toBe("union-of-literals");
    expect(c.literals).toEqual(["[[One test]]", "[[Another test]]"]);
  });

  test("a glob that is a name with wildcards only at its ends is a contains lookup", () => {
    const c = classifyLiterality("**/A third of my calls*.md", "glob");
    expect(c.literality).toBe("contains");
    expect(c.literals).toEqual(["A third of my calls"]);
  });

  test("a brace group of titles is a union, even when each branch ends in a wildcard", () => {
    const c = classifyLiterality("{Charge for the maintained tree*,Charge nothing for the tool*}.md", "glob");
    expect(c.literality).toBe("union-of-literals");
    expect(c.literals).toEqual(["Charge for the maintained tree", "Charge nothing for the tool"]);
  });

  test("an argument that never compiled is counted at the literal end, with its reason", () => {
    // The failure this whole opportunity comes from. `{Charge` is the first seven
    // characters of a node title; pattern semantics did nothing for it but turn a
    // question into an error.
    const c = classifyLiterality("{Charge", "glob");
    expect(c.literality).toBe("malformed");
    expect(c.reason).toBe("glob did not compile");
    expect(globCompiles("{Charge")).toBe(false);
  });
});

describe("an argument that genuinely needs pattern semantics", () => {
  test("an anchor is a position, and a literal lookup has no positions", () => {
    expect(classifyLiterality("^type: Opportunity", "regex").literality).toBe("pattern");
    expect(classifyLiterality("^instrument:", "regex").literality).toBe("pattern");
  });

  test("a wildcard inside the argument, not at its ends", () => {
    expect(classifyLiterality('"title": ".*(shell|glob|cwd)', "regex").literality).toBe("pattern");
    expect(classifyLiterality("*/*.md", "glob").literality).toBe("pattern");
  });

  test("a quantifier, a class and a repeat are all patterns", () => {
    expect(classifyLiterality("WEB:[a-zA-Z0-9.-]+", "regex").literality).toBe("pattern");
    expect(classifyLiterality("(ab)+", "regex").literality).toBe("pattern");
    expect(classifyLiterality("\\bword\\b", "regex").literality).toBe("pattern");
  });

  test("an unescaped period is a pattern, however plainly it was meant as text", () => {
    // Deliberately strict, and it costs the solution its one exception in the real
    // corpus: `bash 3.2` inside a pasted title is read as a wildcard here.
    expect(classifyLiterality("Run a bash 3.2 linter", "regex").literality).toBe("pattern");
    expect(expandRegex("Run a bash 3.2 linter")).toBeNull();
  });

  test("an expansion wider than the cap is a pattern, not a thousand lookups", () => {
    const wide = Array.from({ length: LITERALITY_RULE.expansionCap + 1 }, (_, i) => `t${i}`).join("|");
    expect(classifyLiterality(wide, "regex").literality).toBe("pattern");
  });
});

describe("the dialect an argument was written in changes what it says", () => {
  test("plain grep reads a backslashed pipe as an alternation", () => {
    expect(breToRegex("5e5c119d\\|8fc8d6e3")).toBe("5e5c119d|8fc8d6e3");
    const c = classifyLiterality("5e5c119d\\|8fc8d6e3", "bre");
    expect(c.literality).toBe("union-of-literals");
    expect(c.literals).toEqual(["5e5c119d", "8fc8d6e3"]);
  });

  test("…and a bare pipe as the character itself", () => {
    const c = classifyLiterality("a|b", "bre");
    expect(c.literality).toBe("literal");
    expect(c.literals).toEqual(["a|b"]);
  });

  test("the same two arguments say the opposite thing to a modern regex engine", () => {
    expect(classifyLiterality("a|b", "regex").literality).toBe("union-of-literals");
    expect(classifyLiterality("5e5c119d\\|8fc8d6e3", "regex").literality).toBe("literal");
  });

  test("a caller that declared -F had already asked for a literal interface", () => {
    expect(classifyLiterality("{", "literal-flag").literality).toBe("literal");
    expect(literalRuns("{", "literal-flag")).toEqual(["{"]);
  });
});

describe("what a glob says about the corpus rather than about the question", () => {
  test("a recursive prefix and a vault's own file extension are scope, not syntax", () => {
    expect(globQuestion("**/A title.md")).toBe("A title");
    expect(globQuestion("*.md")).toBe("*");
  });

  test("an all-wildcard glob asks nothing and needs no pattern language for it", () => {
    const c = classifyLiterality("*.md", "glob");
    expect(c.literality).toBe("contains");
    expect(c.reason).toBe("selects the whole corpus and asks nothing");
  });
});

// ── provenance: the classifier fires, and fails to fire ──────────────────────

const TITLES = [
  "Rank every node by how many blocked tests one build would unblock",
  "Charge for the maintained tree, not the tool that maintains it",
  "A model reads the raw transcript",
];

describe("whether an argument came out of the tree", () => {
  test("a title quoted in full is tree text", () => {
    const p = classifyProvenance(["A model reads the raw transcript"], TITLES, LITERALITY_RULE.minMatchChars);
    expect(p.provenance).toBe("tree");
    expect(p.matched).toBe("A model reads the raw transcript");
  });

  test("a long fragment of a title is tree text — the caller still copied it", () => {
    expect(classifyProvenance(["how many blocked tests one build"], TITLES, 16).provenance).toBe("tree");
  });

  test("schema knowledge is not tree text, however often the word appears in nodes", () => {
    // `Opportunity` and `instrument:` are typed from knowing the format. Counting
    // them as tree-derived would put the whole frontmatter vocabulary in the
    // denominator and make the share a fact about YAML.
    expect(classifyProvenance(["type: Opportunity"], TITLES, 16).provenance).toBe("hand");
    expect(classifyProvenance(["instrument:"], TITLES, 16).provenance).toBe("hand");
  });

  test("a short run that happens to appear in a title is not enough", () => {
    expect(classifyProvenance(["Charge for"], TITLES, 16).provenance).toBe("hand");
    expect(classifyProvenance(["Charge for the maintained"], TITLES, 16).provenance).toBe("tree");
  });

  test("provenance is read off a pattern's literal runs, not only off literals", () => {
    // The cell the design turns on is tree-derived AND patterned; an argument
    // built around a quoted title has to be able to land in it.
    const runs = literalRuns('"title": "(A model reads the raw transcript|Something else)', "regex");
    expect(classifyProvenance(runs, TITLES, 16).provenance).toBe("tree");
  });
});

// ── the reader: which calls are searches over node text ──────────────────────

const VAULT = "/vault";

function entry(cwd: string, ...blocks: Record<string, unknown>[]): string {
  return JSON.stringify({ type: "assistant", cwd, timestamp: "2026-08-06T00:00:00.000Z", message: { content: blocks } });
}

function sessionOf(...entries: string[]): TranscriptSession[] {
  return [{ id: "synthetic", jsonl: entries.join("\n") }];
}

function readFrom(...entries: string[]) {
  return readSearchArguments(sessionOf(...entries), { vaultDir: VAULT });
}

describe("the reader lifts searches over node text and leaves the rest", () => {
  test("a Grep over the vault carries both its pattern and its glob filter", () => {
    const r = readFrom(
      entry(VAULT, { type: "tool_use", name: "Grep", input: { pattern: "^type:", glob: "{A title*,B title*}.md" } }),
    );
    expect(r.calls).toBe(1);
    expect(r.args.map((a) => [a.field, a.language])).toEqual([
      ["pattern", "regex"],
      ["glob", "glob"],
    ]);
  });

  test("a search over the code repository is not a search over node text", () => {
    const r = readFrom(entry("/repo", { type: "tool_use", name: "Grep", input: { pattern: "compileGlob", path: "/repo/src" } }));
    expect(r.calls).toBe(0);
    expect(r.args).toEqual([]);
  });

  test("a shell that cd's out of the vault before searching is not searching the vault", () => {
    // The defect this pins: the session's directory is the vault, so a reader that
    // did not follow the `cd` counted a grep over TypeScript as a grep over nodes.
    const r = readFrom(
      entry(VAULT, { type: "tool_use", name: "Bash", input: { command: 'cd /repo && grep -rn "compileGlob" src' } }),
    );
    expect(r.args).toEqual([]);
  });

  test("…and one that stays in the vault is", () => {
    const r = readFrom(
      entry(VAULT, { type: "tool_use", name: "Bash", input: { command: 'grep -rl "A model reads the raw transcript" --include=*.md .' } }),
    );
    expect(r.args.map((a) => [a.field, a.language, a.value])).toEqual([
      ["grep pattern", "bre", "A model reads the raw transcript"],
      ["grep --include", "glob", "*.md"],
    ]);
  });

  test("a pipeline is split at the pipe, whether or not spaces were typed around it", () => {
    const r = readFrom(entry(VAULT, { type: "tool_use", name: "Bash", input: { command: "ls|grep -iF '{Charge'" } }));
    expect(r.args.map((a) => [a.field, a.language, a.value])).toEqual([["grep pattern", "literal-flag", "{Charge"]]);
  });

  test("a path operand outside the vault takes the search out of scope with it", () => {
    const r = readFrom(entry(VAULT, { type: "tool_use", name: "Bash", input: { command: 'grep -rn "x" /repo/src' } }));
    expect(r.args).toEqual([]);
  });

  test("a command this reader will not guess at is unread, never literal", () => {
    const r = readFrom(
      entry(VAULT, { type: "tool_use", name: "Bash", input: { command: 'grep -l "$(cat /tmp/title)" *.md' } }),
    );
    expect(r.args).toEqual([]);
    expect(r.unread.map((u) => u.cause)).toEqual(["unparseable-shell"]);
  });

  test("a grep over a dumped tree is a search over node text, file or not", () => {
    const r = readFrom(
      entry("/anywhere", {
        type: "tool_use",
        name: "Grep",
        input: { pattern: "A model reads the raw transcript", path: "/x/tool-results/mcp-ost-agent-ost_read_tree-1.txt" },
      }),
    );
    expect(r.calls).toBe(1);
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
    calls: number;
    vaultDir: string;
  };
  return {
    args: jsonl<SearchArgument>("search-arguments.jsonl"),
    unread: jsonl<UnreadSearch>("unread-searches.jsonl"),
    titles: fs.readFileSync(path.join(fixtureDir, "tree-titles.txt"), "utf8").trim().split("\n"),
    meta,
  };
}

describe("the census over the committed corpus", () => {
  const { args, unread, titles, meta } = committedCorpus();
  const census = searchLiteralityCensus(args, titles, {
    sessionsRead: meta.sessionsRead,
    calls: meta.calls,
    unread,
  });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.args).toBe(850);
    expect(census.calls).toBe(708);
    expect(census.sessionsRead).toBe(214);
    expect(titles).toHaveLength(1072);
  });

  test("39 searches could not be read, and are counted neither way", () => {
    expect(census.unread).toHaveLength(39);
    expect(census.unread.every((u) => u.cause === "unparseable-shell")).toBe(true);
  });

  test("it reports the four cells the assumption turns on", () => {
    expect(census.cells).toEqual({ treeLiteral: 125, treePattern: 1, handLiteral: 478, handPattern: 246 });
    expect(census.treeDerived).toBe(126);
  });

  test("tree-derived arguments clear the pre-committed 90% bar", () => {
    expect(census.share).toBeCloseTo(0.992, 3);
    expect(census.meetsBar).toBe(true);
  });

  test("hand-written arguments are freely patterned — the axes really do differ", () => {
    // 34% of hand-written arguments need pattern semantics against 0.8% of
    // tree-derived ones. That gap is the finding: the interface could as well be
    // drawn on provenance as on literalness.
    const handShare = census.cells.handPattern / (census.cells.handLiteral + census.cells.handPattern);
    expect(handShare).toBeGreaterThan(0.3);
    expect(census.cells.treePattern / census.treeDerived).toBeLessThan(0.01);
  });

  test("exactly one tree-derived argument needs real pattern semantics, and it is a pasted title", () => {
    const deciding = census.classified.filter((c) => c.provenance === "tree" && c.literality === "pattern");
    expect(deciding).toHaveLength(1);
    // Four node titles joined by `|`. Its only metacharacter is the period in
    // "bash 3.2" — inside a title, where the caller meant a period.
    expect(deciding[0].value).toContain("Run a bash 3.2 linter over every helper");
    expect(deciding[0].matched).toBe(
      "Maintain a sweep from returned deltas alone across a full pass and compare against a fresh read",
    );
  });

  test("not one recorded argument was malformed as it was written", () => {
    // The two ripgrep refusals in this vault are in the corpus, and both compile:
    // `{Charge for the maintained tree*,…}.md` is a well-formed brace group. What
    // reached ripgrep was `{Charge` — the argument was word-split in transport, so
    // the escaping question the solution removes was never the whole failure.
    expect(census.byLiterality.malformed).toBe(0);
    const braces = census.classified.filter((c) => c.value.startsWith("{Charge") || c.value.startsWith("*{threshold"));
    expect(braces.length).toBeGreaterThanOrEqual(2);
    expect(braces.every((c) => c.literality === "union-of-literals" || c.literality === "malformed")).toBe(true);
    expect(braces.filter((c) => c.language === "glob").every((c) => globCompiles(c.value))).toBe(true);
  });

  test("the verdict moves with how generous 'literal' is, and the census says so", () => {
    // Half the tree-derived arguments would need a second call from a strictly
    // one-lookup-at-a-time interface. Whatever a reader concludes from the 99%,
    // this is the sentence that has to be read with it.
    expect(census.readings.map((r) => [r.treeLiteral, r.meetsBar])).toEqual([
      [62, false],
      [76, false],
      [125, true],
      [125, true],
    ]);
    expect(census.ruleDecides).toBe(true);
    expect(formatSearchLiteralityCensus(census)).toContain("THE RULE DECIDES THIS");
  });

  test("the count does not turn on where the provenance threshold was put", () => {
    expect(census.provenanceLadder.map((r) => [r.minMatchChars, r.treeDerived, r.treeLiteral])).toEqual([
      [8, 180, 164],
      [12, 138, 135],
      [16, 126, 125],
      [24, 108, 107],
    ]);
    expect(census.provenanceLadder.every((r) => r.meetsBar)).toBe(true);
  });

  test("the report leads with coverage and never claims to have counted what was wanted", () => {
    const rendered = formatSearchLiteralityCensus(census);
    expect(rendered).toContain("Coverage:");
    expect(rendered).toContain("counts searches that were ISSUED, not searches that were WANTED");
  });
});

describe("the reader against the real record, not a synthetic one", () => {
  const { meta } = committedCorpus();
  // The fixture directory also holds the corpus itself as `.jsonl`; only the two
  // session slices are transcripts.
  const slices = readTranscriptSessions(fixtureDir).filter((s) => /^[0-9a-f-]{36}$/.test(s.id));
  const read = readSearchArguments(slices, { vaultDir: meta.vaultDir });

  test("the two committed transcript slices are the two recorded ripgrep refusals", () => {
    expect(slices.map((s) => s.id).sort()).toEqual([
      "6e66c934-24d8-4200-b6f2-7af23002c478",
      "8a9777ad-a1ca-47fc-ab8e-3bd4b001a5cd",
    ]);
    expect(read.calls).toBe(2);
  });

  test("the glob field ripgrep rejected is lifted whole, as the caller sent it", () => {
    const globs = read.args.filter((a) => a.field === "glob").map((a) => a.value);
    expect(globs).toHaveLength(2);
    expect(globs.some((g) => g.startsWith("{Charge for the maintained tree*,"))).toBe(true);
    expect(globs.some((g) => g.startsWith("*{threshold a field,"))).toBe(true);
    // Both are well-formed. ripgrep saw `{Charge` and `*{threshold` because the
    // argument was split at its first space before it ever reached the parser.
    expect(globs.every((g) => globCompiles(g))).toBe(true);
    expect(globs.every((g) => g.includes(" "))).toBe(true);
  });
});
