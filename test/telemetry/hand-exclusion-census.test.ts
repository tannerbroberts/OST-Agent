/**
 * The hand-exclusion census: how many distinct test files this project has ever
 * suppressed by typing an exclusion into a runner invocation.
 *
 * The solution under test is a quarantine list committed to the repository, so a
 * known-flaky file is declared once instead of retyped. That is infrastructure,
 * and the assumption test beneath it fixed the bar before anyone counted: **at
 * least 3 distinct test files** must have been hand-excluded across the captured
 * sessions. At one or two the honest answer is to fix the flake and build
 * nothing, so a red here is a live possibility rather than a formality — the
 * record was known to contain one file, excluded ten times in one session.
 *
 * **The controls are what carry this file.** A reader that answered "suppressed
 * test" to every `--exclude` would clear the bar on a corpus that is mostly
 * `rsync --exclude node_modules` and `grep --exclude-dir=dist`. So the synthetic
 * cases below run first and in both directions: each class fires on a command
 * built to carry it, and fails to fire on one built to look like it and not be
 * it. Only then is the number over the real corpus worth reading.
 *
 * The rule is `HAND_EXCLUSION_RULE`, committed in `src/telemetry/hand-exclusion.ts`
 * before this corpus was counted. This test asserts the shape of the rule as well
 * as its output, so a later edit shows up here as a changed expectation rather
 * than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  classifyExclusion,
  formatHandExclusionCensus,
  HAND_EXCLUSION_RULE,
  handExclusionCensus,
  readHandExclusions,
  type HandExclusion,
  type UnreadInvocation,
} from "../../src/telemetry/hand-exclusion.js";
import { readTranscriptSessions, type TranscriptSession } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "hand-exclusion");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    // "At least 3 distinct test files were hand-excluded across the captured
    // sessions; at one or two, a committed list is over-engineering."
    expect(HAND_EXCLUSION_RULE.bar).toBe(3);
  });

  test("only a test runner's exclusion is read — the flag alone means nothing", () => {
    expect(HAND_EXCLUSION_RULE.runners).toEqual(["vitest", "jest"]);
    expect(HAND_EXCLUSION_RULE.runners as readonly string[]).not.toContain("rsync");
    expect(HAND_EXCLUSION_RULE.runners as readonly string[]).not.toContain("grep");
  });

  test("a test file is this repository's own convention, checked against its own files", () => {
    const own = fs.readdirSync(path.join(repoRoot, "test", "telemetry"));
    expect(own.length).toBeGreaterThan(0);
    for (const name of own) expect(HAND_EXCLUSION_RULE.testFile.test(name)).toBe(true);
    expect(HAND_EXCLUSION_RULE.testFile.test("src/telemetry/hand-exclusion.ts")).toBe(false);
  });
});

// ── the classifier: it fires, and it fails to fire ──────────────────────────

describe("a value that names a suppressed test", () => {
  test("the file the record is known to contain", () => {
    const c = classifyExclusion("test/mcp/wall-clock-budget.test.ts");
    expect(c.subject).toBe("test-file");
    expect(c.file).toBe("test/mcp/wall-clock-budget.test.ts");
  });

  test("a leading `./` or `**/` is scope, not a different file", () => {
    expect(classifyExclusion("./test/a.test.ts").file).toBe("test/a.test.ts");
    expect(classifyExclusion("**/test/a.test.ts").file).toBe("test/a.test.ts");
  });
});

describe("a value that does not name a suppressed test", () => {
  test("the runner's own default, restated by hand beside a real exclusion", () => {
    // Four of the corpus's nineteen exclusions are this. It is evidence about the
    // hand-typed form's cost and it is reported as such — but nobody quarantined
    // node_modules, and counting it would inflate the number the bar is read off.
    const c = classifyExclusion("node_modules/**");
    expect(c.subject).toBe("not-a-test-file");
    expect(c.reason).toBe("the runner's own default, restated by hand");
    expect(classifyExclusion("dist").subject).toBe("not-a-test-file");
  });

  test("a directory is not a named file, however many tests are under it", () => {
    expect(classifyExclusion("test/release").subject).toBe("not-a-test-file");
    expect(classifyExclusion("test/release").reason).toBe("a directory or glob, not a named test file");
  });

  test("a source file is not a test file", () => {
    expect(classifyExclusion("src/telemetry/usage.ts").subject).toBe("not-a-test-file");
  });
});

// ── the reader: which invocations are test runs at all ──────────────────────

const CWD = "/Users/tanner/dev/OST-Agent";

function entry(cwd: string, command: string): string {
  return JSON.stringify({
    type: "assistant",
    cwd,
    timestamp: "2026-08-06T00:00:00.000Z",
    message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
  });
}

function readFrom(command: string, cwd = CWD) {
  const sessions: TranscriptSession[] = [{ id: "synthetic", jsonl: entry(cwd, command) }];
  return readHandExclusions(sessions);
}

describe("the reader lifts a runner's exclusions and leaves the rest", () => {
  test("the invocation the whole opportunity comes from", () => {
    const r = readFrom(
      'npx vitest run --exclude "test/mcp/wall-clock-budget.test.ts" 2>&1 | grep -E "^ FAIL|Tests  " | sort -u',
    );
    expect(r.invocations).toBe(1);
    expect(r.exclusions.map((e) => [e.runner, e.flag, e.value, e.subject])).toEqual([
      ["vitest", "--exclude", "test/mcp/wall-clock-budget.test.ts", "test-file"],
    ]);
    // `2>&1` tokenises as `2` `>` `&` `1`. A reader that kept the `2` would record
    // this — and every other pipeline in the corpus — as an invocation that named
    // a file to run, and the narrowed count would be the shell's, not the caller's.
    expect(r.narrowed).toBe(0);
  });

  test("two exclusions on one invocation are two exclusions", () => {
    const r = readFrom(
      "npx vitest run --exclude 'test/release/module-reachability.test.ts' --exclude 'test/release/readiness-tiers.test.ts' --exclude 'node_modules/**' 2>&1 | tail -6",
    );
    expect(r.exclusions.filter((e) => e.subject === "test-file")).toHaveLength(2);
    expect(r.exclusions.filter((e) => e.subject === "not-a-test-file")).toHaveLength(1);
  });

  test("the `=` form is the same flag", () => {
    const r = readFrom("npx vitest run --exclude=test/a.test.ts");
    expect(r.exclusions.map((e) => e.value)).toEqual(["test/a.test.ts"]);
  });

  test("`npm test -- --exclude` is a suite invocation", () => {
    const r = readFrom("npm test -- --exclude test/a.test.ts");
    expect(r.exclusions.map((e) => [e.runner, e.value])).toEqual([["npm test", "test/a.test.ts"]]);
  });

  test("`npm run gen:skill` on the same line is not the suite", () => {
    // Verbatim from the record. A reader that took any `npm run` for a test run
    // would put this line's `--exclude` on the wrong invocation and count it twice.
    const r = readFrom(
      'npm run gen:skill >/dev/null 2>&1; npx tsc --noEmit && npx vitest run --exclude "test/mcp/wall-clock-budget.test.ts" 2>&1 | sort -u',
    );
    expect(r.invocations).toBe(1);
    expect(r.exclusions).toHaveLength(1);
  });
});

describe("an `--exclude` that suppressed no test", () => {
  test("rsync copying a tree is not a test run", () => {
    const r = readFrom("rsync -a --exclude node_modules --exclude .git --exclude dist ./ /tmp/mirror/");
    expect(r.invocations).toBe(0);
    expect(r.exclusions).toEqual([]);
  });

  test("grep skipping directories is not a test run", () => {
    const r = readFrom("grep -rn 'tokenSplit' --exclude-dir=node_modules --exclude-dir=dist . | head -40");
    expect(r.exclusions).toEqual([]);
  });

  test("a harvest script excluding its own session is not a quarantined test", () => {
    // In the corpus verbatim. It is a census refusing to count itself, and reading
    // it as a suppression would be this census counting one.
    const r = readFrom(
      "npx tsx scripts/harvest-path-failure-corpus.ts ~/.claude/projects test/fixtures/x --exclude 598061c2-bd9c-4964-b0d3-017cb5f78f2a",
    );
    expect(r.invocations).toBe(0);
    expect(r.exclusions).toEqual([]);
  });

  test("a quoted flag is a word, not a flag", () => {
    const r = readFrom(`npx vitest run -t '--exclude test/a.test.ts'`);
    expect(r.exclusions).toEqual([]);
  });
});

describe("what the reader will not guess at", () => {
  test("a command whose text depends on evaluation is unread, never counted either way", () => {
    // The corpus's one real case: a `gh pr create` whose body quotes a
    // `vitest run --exclude` that was never run. It is refused, not read.
    const r = readFrom(`gh pr create --body "$(cat <<'EOF'\nran: npx vitest run --exclude test/a.test.ts\nEOF\n)"`);
    expect(r.exclusions).toEqual([]);
    expect(r.unread.map((u) => u.cause)).toEqual(["unparseable-shell"]);
  });

  test("unbalanced quoting is refused rather than half-parsed", () => {
    const r = readFrom(`npx vitest run --exclude "test/a.test.ts`);
    expect(r.exclusions).toEqual([]);
    expect(r.unread).toHaveLength(1);
  });

  test("a command that names no runner is not an unread test run", () => {
    const r = readFrom(`echo "$(ls)"`);
    expect(r.unread).toEqual([]);
  });
});

describe("a run that named files instead of excluding any", () => {
  test("naming a file is narrowing, and narrowing is not a quarantine", () => {
    const r = readFrom("npx vitest run test/telemetry/usage.test.ts");
    expect(r.exclusions).toEqual([]);
    expect(r.narrowed).toBe(1);
  });

  test("a name filter narrows too, and its value is not a file", () => {
    const r = readFrom("npx vitest run -t 'the bar is the one the assumption test fixed'");
    expect(r.narrowed).toBe(1);
    expect(r.exclusions).toEqual([]);
  });

  test("the bare suite is not narrowed", () => {
    expect(readFrom("npx vitest run --reporter=dot").narrowed).toBe(0);
  });
});

describe("where an invocation ran", () => {
  test("a `cd` earlier on the line moves it", () => {
    const r = readFrom("cd /Users/tanner/dev/OST-Agent && npx vitest run --exclude test/a.test.ts", "/Users/tanner/ost-agent-meta");
    expect(r.exclusions[0].cwd).toBe("/Users/tanner/dev/OST-Agent");
  });
});

// ── the corpus this test exists to count ────────────────────────────────────

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
    transcriptsFound: number;
    transcriptsNested: number;
    sessionsRead: number;
    invocations: number;
    narrowed: number;
    unread: number;
    unreadableMentioningExclude: number;
    excludedSessions: string[];
  };
  return {
    exclusions: jsonl<HandExclusion>("exclusions.jsonl"),
    unread: jsonl<UnreadInvocation>("unread-invocations.jsonl"),
    meta,
  };
}

describe("the census over the committed corpus", () => {
  const { exclusions, unread, meta } = committedCorpus();
  const census = handExclusionCensus(exclusions, {
    sessionsRead: meta.sessionsRead,
    invocations: meta.invocations,
    narrowed: meta.narrowed,
    unread,
  });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.sessionsRead).toBe(657);
    expect(census.invocations).toBe(1912);
    expect(exclusions).toHaveLength(19);
    expect(meta.excludedSessions).toEqual(["5bca8279-ec67-41c1-a832-b32a3dad66a0"]);
  });

  test("more than half the record is nested, and a flat read would have missed it", () => {
    // 346 of 658 transcript files are a subagent's, under `<project>/subagents/**`.
    // Three of the four distinct files below were excluded by a subagent, so a
    // one-level read finds one file and reports this census red.
    expect(meta.transcriptsNested).toBe(346);
    expect(meta.transcriptsNested / meta.transcriptsFound).toBeGreaterThan(0.5);
  });

  test("320 invocations could not be read, and not one of them held an exclusion", () => {
    // The blind spot is 14% of the runner traffic, so whether an exclusion could
    // be hiding in it is the question that decides whether the count is safe. The
    // harvester checked the unclipped text: exactly one unreadable command
    // contains `--exclude`, and it is a PR body quoting a command nobody ran.
    expect(census.unread).toHaveLength(320);
    expect(census.unread.every((u) => u.cause === "unparseable-shell")).toBe(true);
    expect(meta.unreadableMentioningExclude).toBe(1);
  });

  // ── the count the assumption test reads ───────────────────────────────────

  test("four distinct test files were hand-excluded — the pre-committed bar of three is met", () => {
    expect(census.files.map((f) => f.file)).toEqual([
      "test/mcp/wall-clock-budget.test.ts",
      "test/release/module-reachability.test.ts",
      "test/release/readiness-citations.test.ts",
      "test/release/readiness-tiers.test.ts",
    ]);
    expect(census.distinct).toBe(4);
    expect(census.meetsBar).toBe(true);
  });

  test("…and the finding is what the fourth file cost to find, not the four", () => {
    // The file the opportunity was written from carries ten of the fourteen
    // excluding invocations, retyped over 58 minutes inside one session.
    const flake = census.files[0];
    expect(flake.invocations).toBe(10);
    expect(flake.spanMinutes).toBe(58);
    expect(flake.days).toEqual(["2026-08-04"]);
    expect(census.excludingInvocations).toBe(14);
  });

  test("breadth clears the bar; repetition does not exist at all", () => {
    // The assumption is that a committed list "pays for itself across repetition
    // and breadth". Four files is breadth. But not one file was ever excluded in a
    // second session — every exclusion in this record was typed inside the session
    // that hit the failure, and a committed list is a place to declare something
    // for NEXT time. What the record supports is saving the retyping within one
    // session; what it does not support is a list outliving the session at all.
    expect(census.repeatedAcrossSessions).toBe(0);
    expect(census.files.every((f) => f.sessions.length === 1)).toBe(true);
    expect(census.files.every((f) => f.days.length === 1)).toBe(true);
  });

  test("three of the four files come from one subagent inside two minutes", () => {
    // They are not four independent flakes. Three were excluded by one agent on
    // 2026-07-30, in sequence, while it worked around failures its own untracked
    // files were causing — a state that was gone by the next commit. A quarantine
    // list is the wrong instrument for those: nobody would have committed them.
    const release = census.files.filter((f) => f.file.startsWith("test/release/"));
    expect(release).toHaveLength(3);
    expect(new Set(release.flatMap((f) => f.sessions)).size).toBe(1);
    expect(new Set(release.flatMap((f) => f.days))).toEqual(new Set(["2026-07-30"]));
  });

  test("the hand-typed form accreted an argument nobody needed", () => {
    // Every one of that session's exclusion invocations also re-typed
    // `--exclude 'node_modules/**'`, which vitest 2.1.9 excludes by default and
    // does not stop excluding when a CLI `--exclude` is passed (checked with
    // `vitest list`, with and without: the same files are collected either way).
    // The retyped workaround grew a superstition, which is a cost of the manual
    // form the opportunity did not name.
    expect(census.defaultsRestated).toBe(4);
    expect(census.exclusions.filter((e) => e.value === "node_modules/**")).toHaveLength(4);
  });

  test("hand exclusion is rare: 14 invocations in 1912", () => {
    // 0.7% of runner traffic, on two days, in two sessions, across 657
    // transcripts. Whatever a reader concludes from the four, this is the
    // sentence that has to be read with it.
    expect(census.excludingInvocations / census.invocations).toBeLessThan(0.01);
    expect(new Set(census.exclusions.map((e) => e.session)).size).toBe(2);
  });

  test("the report leads with coverage and never claims to have counted what was wanted", () => {
    const rendered = formatHandExclusionCensus(census);
    expect(rendered.startsWith("Coverage:")).toBe(true);
    expect(rendered).toContain("counts exclusions that were TYPED, not suppressions that were WANTED");
    expect(rendered).toContain("bar is 3, MET");
  });

  test("a census that read nothing reports UNREAD rather than a clean zero", () => {
    const empty = handExclusionCensus([], { sessionsRead: 0, invocations: 0, narrowed: 0, unread: [] });
    expect(empty.meetsBar).toBe(false);
    expect(formatHandExclusionCensus(empty)).toContain("UNREAD");
  });
});

// ── the reader against the real record, not a synthetic one ────────────────

describe("the reader against the real record", () => {
  // The fixture directory also holds the corpus itself as `.jsonl`; only the two
  // session slices are transcripts.
  const sessions = readTranscriptSessions(fixtureDir).filter(
    (s) => /^[0-9a-f-]{36}$/.test(s.id) || s.id.startsWith("agent-"),
  );

  test("the transcript reader recurses, so the nested subagent slice is found", () => {
    // The fixture is shaped like the record: one top-level session and one
    // subagent under `subagents/`. This pins the recursion the count depends on.
    expect(sessions.map((s) => s.id).sort()).toEqual([
      "785ea509-96b9-4225-b45a-babd5321aafc",
      "agent-a751ea36c857d81ec",
    ]);
  });

  test("both real slices are read, and they carry the four distinct files", () => {
    const read = readHandExclusions(sessions);
    expect(read.invocations).toBe(14);
    const census = handExclusionCensus(read.exclusions, {
      sessionsRead: sessions.length,
      invocations: read.invocations,
      narrowed: read.narrowed,
      unread: read.unread,
    });
    expect(census.distinct).toBe(4);
    expect(census.meetsBar).toBe(true);
  });

  test("a flat read of the same fixture finds one file and reports the census red", () => {
    // Not hypothetical, and the reason `readTranscriptSessions` was changed: this
    // is what the census returned before the walk recursed.
    const flat = fs
      .readdirSync(fixtureDir)
      .filter((n) => n.endsWith(".jsonl") && /^[0-9a-f-]{36}\.jsonl$/.test(n))
      .map((n) => ({ id: n.replace(/\.jsonl$/, ""), jsonl: fs.readFileSync(path.join(fixtureDir, n), "utf8") }));
    const read = readHandExclusions(flat);
    const census = handExclusionCensus(read.exclusions, {
      sessionsRead: flat.length,
      invocations: read.invocations,
      narrowed: read.narrowed,
      unread: read.unread,
    });
    expect(census.distinct).toBe(1);
    expect(census.meetsBar).toBe(false);
  });
});
