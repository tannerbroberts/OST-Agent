/**
 * The path-failure attribution census: of the path failures this project's passes
 * actually hit, how many arrived through a tool this repository controls?
 *
 * The solution under test is "a path failure answers with the layout it was
 * addressed against" — let the wrong guess happen, and make the first failure
 * carry back the nearest existing ancestor and its contents instead of a
 * negation. It is the cheapest of its three siblings and the only one that needs
 * no foreknowledge, but it can only improve a message the product writes. The
 * assumption test beneath it fixed the bar before anyone counted: **at least 40%
 * of path-shaped failures must arrive through tools this repository controls.**
 * Below that the solution improves the error surface of a minority of calls and
 * must narrow to a named subset or give way to a sibling.
 *
 * **The controls are what carry this file.** A classifier that answered "path
 * failure" to everything would satisfy every assertion about a corpus that came
 * out high, and one that answered "foreign" to everything would satisfy every
 * assertion about a corpus that came out low. So the synthetic cases below run
 * first and in both directions: each shape fires on a message built to carry it
 * and fails to fire on one built to look like it and not be it, and each surface
 * is claimed for a call that is ours and refused for one that only resembles it.
 * Only then is the number over the real corpus worth reading.
 *
 * The rule is `ATTRIBUTION_RULE`, committed in
 * `src/telemetry/path-failure-attribution.ts` — including the shape it declines to
 * count and the two refusals it excludes, which are published as numbers rather
 * than defended. This test asserts the shape of the rule as well as its output, so
 * a later edit shows up here as a changed expectation rather than as a quietly
 * different finding.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**: 0 of 76, against a bar of 40. The command is green
 * because the count has been taken and pinned, which is what an instrument on a
 * measurement can mean — the same convention
 * `test/telemetry/preflight-uncertainty-census.test.ts` runs under, whose census
 * also came out 0 and whose node is still `#unvalidated`. Whoever reads this exit
 * code must read `census.meetsBar` with it, which is why it is asserted `false` by
 * name below rather than left to be inferred from a share.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  ATTRIBUTION_RULE,
  attributeSurface,
  classifyFailure,
  classifyPathFailure,
  clip,
  commandSegments,
  formatPathFailureCensus,
  invokesProductCli,
  MAX_COMMAND_CHARS,
  MAX_ERROR_CHARS,
  pathFailureCensus,
  readPathFailures,
  subjectOf,
  type FailingCall,
} from "../../src/telemetry/path-failure-attribution.js";
import { readTranscriptSessions } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "path-failure-attribution");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(ATTRIBUTION_RULE.bar).toBe(0.4);
  });

  test("the readings of 'path-shaped' are monotone, so a rung can only admit more", () => {
    const rungs = ATTRIBUTION_RULE.readings.map((r) => r.classes);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i]).toEqual(expect.arrayContaining([...rungs[i - 1]]));
      expect(rungs[i].length).toBeGreaterThan(rungs[i - 1].length);
    }
    // The narrow rung is layout alone; the widest adds the one class the assumption
    // test said it could not settle. Both are reported, neither is hidden.
    expect(rungs[0]).not.toContain("denied-path");
    expect(rungs[rungs.length - 1]).toContain("denied-path");
  });

  test("the four shapes are the four the assumption test named", () => {
    expect(new Set(ATTRIBUTION_RULE.shapes.map((s) => s.cls))).toEqual(
      new Set(["missing-path", "no-matches", "not-a-repo", "denied-path"]),
    );
  });
});

// ── shape: each fires on its own, and not on its lookalike ───────────────────

describe("a message that is about a path that was not there", () => {
  test("coreutils naming the path it could not open", () => {
    expect(classifyPathFailure("sed: src/cli/index.ts: No such file or directory")).toBe("missing-path");
    expect(subjectOf("sed: src/cli/index.ts: No such file or directory")).toBe("src/cli/index.ts");
  });

  test("zsh's `cd`, which puts the path last", () => {
    expect(classifyPathFailure("(eval):cd:1: no such file or directory: docs/reference")).toBe("missing-path");
    expect(subjectOf("(eval):cd:1: no such file or directory: docs/reference")).toBe("docs/reference");
  });

  test("Claude Code's Grep refusal, which names the path", () => {
    const err = "<tool_use_error>Path does not exist: /Users/tanner/ost-agent-meta/src.</tool_use_error>";
    expect(classifyPathFailure(err)).toBe("missing-path");
    expect(subjectOf(err)).toBe("/Users/tanner/ost-agent-meta/src");
  });

  test("Claude Code's Read refusal, which names nothing at all", () => {
    // The failure the solution under test exists to replace, in its purest form:
    // it reports that something is absent without saying what, or where it looked.
    const err = "File does not exist. Note: your current working directory is /Users/tanner/ost-agent-meta.";
    expect(classifyPathFailure(err)).toBe("missing-path");
    expect(subjectOf(err)).toBeNull();
  });

  test("a raw errno, quoted by whatever surfaced it", () => {
    const err = "FileNotFoundError: [Errno 2] No such file or directory: '.ost-agent/state/mapped.json'";
    expect(classifyPathFailure(err)).toBe("missing-path");
    // The quotes are python's punctuation, not part of what was addressed.
    expect(subjectOf(err)).toBe(".ost-agent/state/mapped.json");
  });
});

describe("a message that looks like a path failure and is not one", () => {
  test("a type error that happens to say 'does not exist'", () => {
    expect(
      classifyPathFailure("src/security/tools.ts(744,63): error TS2339: Property 'configProblem' does not exist on type 'ToolContext'."),
    ).toBeNull();
  });

  test("a shell that could not find a COMMAND, which no layout would have fixed", () => {
    expect(classifyPathFailure("(eval):1: == not found")).toBeNull();
    expect(classifyPathFailure("/Users/tanner/.local/bin/ost-reports: line 21: mapfile: command not found")).toBeNull();
  });

  test("an Edit whose old_string was not in the file", () => {
    expect(classifyPathFailure("<tool_use_error>String to replace not found in file.</tool_use_error>")).toBeNull();
  });

  test("a session that was never granted one of this repository's own tools", () => {
    // The largest excluded population and the one that would have decided the
    // census: 122 in the corpus, 83 of them against tools this repository owns.
    // It is a refusal about a tool, not about a path.
    expect(
      classifyPathFailure("Claude requested permissions to use mcp__ost-agent__ost_check, but you haven't granted it yet."),
    ).toBeNull();
  });

  test("a human declining the call", () => {
    expect(
      classifyPathFailure("The user doesn't want to proceed with this tool use. The tool use was rejected."),
    ).toBeNull();
  });

  test("the exclusion runs before the shapes, so 'denied' cannot leak in on a word", () => {
    // Both of these carry a word that `denied-path` matches. Neither is one.
    expect(classifyPathFailure("permission was denied by the user")).toBeNull();
    expect(classifyPathFailure("cat: /etc/master.passwd: Permission denied")).toBe("denied-path");
  });
});

describe("a glob that matched nothing is not always a path that was not there", () => {
  test("a glob over a directory is a layout question", () => {
    const err = "(eval):1: no matches found: /Users/tanner/dev/ost*";
    const c = classifyFailure({ session: "s", tool: "Bash", command: "ls -d /Users/tanner/dev/ost*", error: err })!;
    expect(c.cls).toBe("no-matches");
    expect(c.flagNotPath).toBe(false);
  });

  test("a glob over a command-line FLAG is a quoting question, and is marked as one", () => {
    // `grep --include=*.ts` in a directory with no `.ts` file: zsh expands the
    // flag and refuses the command. Counted as path-shaped because the shell's
    // message is, flagged because no layout answer would ever have helped it.
    const err = "(eval):1: no matches found: --include=*.ts";
    const c = classifyFailure({ session: "s", tool: "Bash", command: 'grep -rn "x" src --include=*.ts', error: err })!;
    expect(c.cls).toBe("no-matches");
    expect(c.flagNotPath).toBe(true);
  });
});

// ── surface: claimed for ours, refused for its lookalikes ────────────────────

describe("a call this repository controls", () => {
  test("its MCP tools, however the session reached them", () => {
    expect(attributeSurface("mcp__ost-agent__ost_next_work", "")).toEqual({ surface: "mcp", certainty: "certain" });
    expect(attributeSurface("mcp__plugin_ost-agent_ost-agent__ost_read_tree", "")).toEqual({
      surface: "mcp",
      certainty: "certain",
    });
  });

  test("its CLI, however a command spells it", () => {
    for (const command of [
      "ost-agent status --vault .",
      "/Users/tanner/.local/bin/ost-agent rollup",
      "npx ost-agent check",
      "node dist/ost-agent.mjs verify",
      "npx tsx src/cli/index.ts init /tmp/v",
      "node --import tsx src/cli/index.ts init /tmp/v",
      "OST_VAULT=/tmp/v ost-agent status",
    ]) {
      expect(invokesProductCli(command), command).toBe(true);
      expect(attributeSurface("Bash", command), command).toEqual({ surface: "cli", certainty: "certain" });
    }
  });
});

describe("a call that only resembles one this repository controls", () => {
  test("standing in a directory named after the product is not running it", () => {
    // The false positive a substring match makes, and it is not hypothetical:
    // the corpus contains `cd ~/.claude/plugins/marketplaces/ost-agent && ls
    // node_modules`, whose failure belongs to `ls`.
    const command = "cd /Users/tanner/.claude/plugins/marketplaces/ost-agent && ls -d node_modules";
    expect(invokesProductCli(command)).toBe(false);
    expect(attributeSurface("Bash", command)).toEqual({ surface: "foreign", certainty: "certain" });
  });

  test("naming the product as an ARGUMENT is not running it", () => {
    expect(invokesProductCli("cat /Users/tanner/dev/OST-Agent/dist/ost-agent.mjs")).toBe(false);
    expect(invokesProductCli("ls -d ~/dev/ost-agent-meta")).toBe(false);
  });

  test("another tool's failure is never this repository's, whatever it says", () => {
    expect(attributeSurface("Read", "")).toEqual({ surface: "foreign", certainty: "certain" });
    expect(attributeSurface("Grep", "")).toEqual({ surface: "foreign", certainty: "certain" });
  });
});

describe("a compound command runs several programs and the record keeps one exit code", () => {
  test("every segment ours makes the attribution certain", () => {
    const command = "ost-agent status --vault . && ost-agent rollup --vault .";
    expect(commandSegments(command)).toHaveLength(2);
    expect(attributeSurface("Bash", command)).toEqual({ surface: "cli", certainty: "certain" });
  });

  test("one segment ours makes it possible, never certain", () => {
    // Which program failed is not recorded, so the census carries this as an
    // upper bound rather than deciding on its behalf.
    const command = "cd ~/ost-agent-meta && ost-agent tool ost_next_work --vault . | python3 -c 'x'";
    expect(attributeSurface("Bash", command)).toEqual({ surface: "cli", certainty: "possible" });
  });

  test("a segment cut in the wrong place falls toward foreign, not toward ours", () => {
    // `commandSegments` is crude by design. The direction it errs in is the one
    // that runs against the assumption under test.
    const command = "cat > /tmp/x.sh <<'EOF'\nost-agent status\nEOF";
    expect(attributeSurface("Bash", command).surface).toBe("cli");
    expect(attributeSurface("Bash", command).certainty).toBe("possible");
  });
});

// ── clipping ─────────────────────────────────────────────────────────────────

describe("clipping keeps the end of the output, not only the beginning", () => {
  test("a compound command's signature line is its last line, and survives", () => {
    const noise = "x".repeat(2000);
    const clipped = clip(`${noise} ls: docs/reference: No such file or directory`, MAX_ERROR_CHARS);
    expect(clipped.length).toBeLessThanOrEqual(MAX_ERROR_CHARS + 3);
    expect(classifyPathFailure(clipped)).toBe("missing-path");
  });

  test("text within the bound is kept whole", () => {
    expect(clip("ls: a: No such file or directory", MAX_COMMAND_CHARS)).toBe("ls: a: No such file or directory");
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

function committedCorpus(): { failures: FailingCall[]; meta: Record<string, number> } {
  const failures = fs
    .readFileSync(path.join(fixtureDir, "failures.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FailingCall);
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, number>;
  return { failures, meta };
}

describe("the census over the committed corpus", () => {
  const { failures, meta } = committedCorpus();
  const census = pathFailureCensus(failures, {
    sessionsRead: meta.transcriptsRead,
    calls: meta.calls,
    errors: meta.errors,
  });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(census.sessionsRead).toBe(646);
    expect(census.calls).toBe(26132);
    expect(census.errors).toBe(719);
    expect(failures).toHaveLength(719);
    expect(census.unread).toBe(0);
  });

  test("clipping the fixture did not change what the classifier sees", () => {
    // Written by the harvest script, which alone has the unbounded text.
    expect(meta.pathShapedBounded).toBe(meta.pathShapedUnbounded);
    expect(census.pathShaped).toBe(meta.pathShapedBounded);
  });

  test("76 of the 719 failures are path-shaped, and the rest are not counted", () => {
    expect(census.pathShaped).toBe(76);
    expect(census.byClass).toEqual({
      "missing-path": 47,
      "no-matches": 23,
      "not-a-repo": 6,
      "denied-path": 0,
    });
  });

  test("not one of them arrived through a tool this repository controls", () => {
    expect(census.byTool).toEqual([
      { tool: "Bash", n: 69 },
      { tool: "Read", n: 5 },
      { tool: "Grep", n: 2 },
    ]);
    expect(census.owned).toBe(0);
    expect(census.share).toBe(0);
  });

  test("THE ASSUMPTION IS REFUTED — 0% against a pre-committed 40% bar", () => {
    // Read this with the exit code. The command is green because the count has
    // been taken; the count says the solution above it does not cover the work.
    expect(census.meetsBar).toBe(false);
    expect(formatPathFailureCensus(census)).toContain("REFUTED");
  });

  test("the generous bound does not rescue it either", () => {
    // Credit every call where any segment was ours, without asking which program
    // failed: two calls, and neither failure was actually this repository's — one
    // is `ls: /tmp/w6probe/v`, the other a `python3` reading `mapped.json`.
    expect(census.ownedUpperBound).toBe(2);
    expect(census.shareUpperBound).toBeCloseTo(0.026, 3);
    expect(census.boundDecides).toBe(false);
  });

  test("the permission-denial reading moves the number by exactly nothing", () => {
    // The assumption test predicted the opposite in advance — "this sweep hit
    // several of them … whichever way the classifier treats them will move the
    // number". There is not one filesystem permission denial on a path in 719
    // recorded failures. What the record calls `permission_denied` is a human
    // declining a call, and what looks like one on this repository's own tools is
    // a session that was never granted them.
    expect(census.byClass["denied-path"]).toBe(0);
    expect(census.readings.map((r) => [r.pathShaped, r.owned])).toEqual([
      [76, 0],
      [76, 0],
    ]);
    expect(census.permissionDecides).toBe(false);
  });

  test("the shape the rule declined to count would not have changed the verdict", () => {
    const [moduleNotFound] = census.excludedByRule;
    expect(moduleNotFound.name).toBe("module-not-found");
    expect(moduleNotFound.n).toBe(10);
    // Counting all ten AND crediting every one to this repository: 11.6%.
    expect(moduleNotFound.shareIfCountedAndOwned).toBeLessThan(ATTRIBUTION_RULE.bar);
  });

  test("10 of the 'no matches' failures are a glob-expanded flag, not a path", () => {
    // A third of the glob failures the parent opportunity's census counted as
    // layout failures are `--include=*.ts` word-splitting in a directory with no
    // `.ts` file. No answer describing the layout would have helped any of them.
    expect(census.flagNotPath).toBe(10);
  });

  test("most path failures never name what they were looking for, or name it relatively", () => {
    // The finding that redirects rather than kills: the messages are poor, and
    // 11 of 76 report an absence without naming a subject at all. They are just
    // not this repository's messages to improve.
    expect(census.bySubjectRoot).toEqual({ project: 6, foreign: 18, unrooted: 41, unnamed: 11 });
  });

  test("the report leads with coverage and says the verdict in words", () => {
    const report = formatPathFailureCensus(census);
    expect(report).toContain("646 session(s)");
    expect(report).toContain("against a pre-committed bar of 40%");
    expect(report).toContain("still does not clear the bar");
  });
});

// ── the reader against the real record, not a synthetic one ──────────────────

describe("the reader against two sessions kept raw", () => {
  const sessions = readTranscriptSessions(fixtureDir).filter((s) => s.id !== "failures");
  const { failures } = readPathFailures(sessions);
  const classified = failures.map(classifyFailure).filter((c) => c !== null);

  test("both committed slices are read, and every entry in them is a path failure", () => {
    expect(sessions.map((s) => s.id)).toEqual([
      "0d27cebf-9b5d-4cff-906c-0134512573bc",
      "d0008f2c-86ea-4db8-90cf-364ce6047c99",
    ]);
    expect(failures).toHaveLength(5);
    expect(classified).toHaveLength(5);
  });

  test("the session that reached for a clone that was not there", () => {
    // `rm -rf ~/dev/ost-agent-meta && ls -d ~/dev/ost-agent-meta` — the run
    // checking its own work, and the answer naming the path it addressed.
    const row = classified.find((c) => c!.subject === "/Users/tanner/dev/ost-agent-meta")!;
    expect(row.cls).toBe("missing-path");
    expect(row.subjectRoot).toBe("project");
    expect(row.surface).toBe("foreign");
  });

  test("the one call in the slices where a segment was ours is possible, not certain", () => {
    const row = classified.find((c) => c!.surface !== "foreign")!;
    expect(row.certainty).toBe("possible");
    expect(row.command).toContain("ost-agent tool ost_next_work");
    // …and the failure was `python3`'s, which is what the bound is protecting
    // against: attributing on presence would have called this one ours.
    expect(row.error).toContain("FileNotFoundError");
  });
});
