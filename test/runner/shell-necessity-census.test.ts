/**
 * The shell-necessity census: of every command this machine's sessions ever
 * handed to a shell, how many needed a shell at all — and the argv path that
 * runs the ones that did not, with no shell involved.
 *
 * The assumption test fixed the bar before anything was counted: **at least 70%
 * of harvested commands must need no shell feature at all** for "A
 * shell-agnostic execution path that never hands a string to a shell at all" to
 * be worth building as the default. The count is in, and the answer is **12.3%
 * — NOT MET, by nearly six to one.** Recorded usage is composition: `sequence`
 * touches 9,970 of 14,608 readable invocations, `pipeline` 9,109, and 10,523
 * shell-bound invocations depend on several features at once. The solution
 * node's own hazard clause — "a lot of real work is a pipeline" — is what the
 * corpus shows.
 *
 * A second finding contradicts the node's aside that the recorded failures
 * (`== not found`, the no-match globs) "are all in the second class". The real
 * commands behind them, read out of the surviving transcripts and pinned below,
 * are `;`-and-pipe compositions: the `==` errors came from `echo ===`
 * separators inside multi-command lines, and the glob failures rode inside
 * pipelines. The *failing ingredient* is argv-expressible — `echo ===` and
 * `/bin/[ a == a ]` both run clean on the argv path, asserted below — but the
 * commands as written would not have been offered to an argv path at all.
 *
 * **The controls carry the partition.** A classifier that answered
 * "needs a shell" to every quote would sink the census on its most ordinary
 * commands, so the controls run in both directions: quoting alone is not a
 * shell feature, `[` and `echo` are executables rather than builtins, and an
 * unquoted glob or `$` IS a feature even inside double quotes.
 *
 * The rule is `SHELL_NECESSITY_RULE`, committed in
 * `src/runner/shell-necessity.ts` before the corpus was counted. This test
 * asserts the shape of the rule as well as its output, so a later edit shows up
 * here as a changed expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  classifyShellNecessity,
  formatShellNecessityCensus,
  readBashCommands,
  runArgv,
  SHELL_NECESSITY_RULE,
  shellNecessityCensus,
  type HarvestedCommand,
} from "../../src/runner/shell-necessity.js";
import type { TranscriptSession } from "../../src/telemetry/preflight.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "shell-necessity");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    // "At least 70% of commands need no shell feature at all."
    expect(SHELL_NECESSITY_RULE.bar).toBe(0.7);
  });

  test("words an executable provides are not builtins, so the argv path keeps them", () => {
    // `/bin/[` accepts `==` — checked by hand on the machine that recorded the
    // failures, and asserted live further down. `echo` produced four of them.
    for (const word of ["[", "echo", "printf", "test", "pwd", "true", "false", "kill"]) {
      expect(SHELL_NECESSITY_RULE.builtins as readonly string[]).not.toContain(word);
    }
    expect(SHELL_NECESSITY_RULE.builtins as readonly string[]).toContain("cd");
    expect(SHELL_NECESSITY_RULE.builtins as readonly string[]).toContain("export");
  });
});

// ── the classifier: it fires, and it fails to fire ──────────────────────────

describe("a command that needs no shell feature at all", () => {
  test("a bare program and arguments", () => {
    const c = classifyShellNecessity("git status --porcelain");
    expect(c.verdict).toBe("argv");
    expect(c.argv).toEqual(["git", "status", "--porcelain"]);
  });

  test("quoting alone is not a shell feature — the quotes are how the string was written down", () => {
    const c = classifyShellNecessity('grep -rn "writeEvidence\\|readEvidence" src/ost/results.ts');
    expect(c.verdict).toBe("argv");
    expect(c.argv).toEqual(["grep", "-rn", "writeEvidence\\|readEvidence", "src/ost/results.ts"]);
  });

  test("a pipe inside quotes belongs to the program, not the shell", () => {
    // Verbatim from the corpus: the second-most-issued argv command.
    const c = classifyShellNecessity(
      `gh run view 31106631747 --json jobs --jq '.jobs[] | "\\(.name): \\(.status) \\(.conclusion // "")"'`,
    );
    expect(c.verdict).toBe("argv");
    expect(c.argv?.[0]).toBe("gh");
  });

  test("`echo ===` — the text behind four recorded `== not found` failures — is plain argv", () => {
    // zsh read the leading `=` as its `=command` expansion and errored before
    // echo ever ran. There is no shell feature here, only a shell in the way.
    const c = classifyShellNecessity("echo ===");
    expect(c).toEqual({ verdict: "argv", argv: ["echo", "==="] });
  });

  test("`[ a == b ]` is the test EXECUTABLE, not a bracket glob or a builtin", () => {
    const c = classifyShellNecessity('[ "ok" == "ok" ]');
    expect(c.verdict).toBe("argv");
    expect(c.argv).toEqual(["[", "ok", "==", "ok", "]"]);
  });

  test("a glob inside quotes is a literal the program will expand or match itself", () => {
    expect(classifyShellNecessity("find . -name '*.test.ts'").verdict).toBe("argv");
  });
});

describe("a command that depends on the shell", () => {
  test("the composition idiom that dominates the corpus", () => {
    const c = classifyShellNecessity("npx tsc --noEmit 2>&1 | head -20");
    expect(c.verdict).toBe("needs-shell");
    expect(c.features).toEqual(["pipeline", "redirection"]);
  });

  test("the `cd <repo> &&` prefix the harness's directory reset makes ubiquitous", () => {
    const c = classifyShellNecessity("cd /Users/tanner/dev/OST-Agent && cat CLAUDE.md");
    expect(c.features).toEqual(["sequence", "builtin"]);
  });

  test("the verbatim command behind a recorded `== not found` failure was composition, not comparison", () => {
    // From transcript a615eb46-…: the failing ingredient is `echo ===`, but the
    // command as written is two `;`-joined segments and a pipe — the node's
    // claim that the recorded failures are argv-expressible does not survive
    // contact with the record they were recorded from.
    const c = classifyShellNecessity(
      `sed -n '1,60p' src/config/schema.ts; echo ===; grep -rn "ost.config.yaml" src --include="*.ts" | head -20`,
    );
    expect(c.verdict).toBe("needs-shell");
    expect(c.features).toEqual(["pipeline", "sequence"]);
  });

  test("the verbatim command behind a recorded no-match glob failure", () => {
    // From transcript 8fc8d6e3-…: `~` and `*` are the features zsh refused on,
    // and the line is also a pipeline and a `;` sequence with a redirect.
    const c = classifyShellNecessity("ls ~ | head -40; ls -d ~/ost* ~/dev/ost* ~/dev/*vault* 2>/dev/null");
    expect(c.verdict).toBe("needs-shell");
    expect(c.features).toEqual(["glob", "tilde", "pipeline", "sequence", "redirection"]);
  });

  test("an unquoted glob is a feature the caller asked for", () => {
    const c = classifyShellNecessity("grep -rn writeEvidence src/ --include=*.ts");
    expect(c.features).toEqual(["glob"]);
  });

  test("`$` expands inside double quotes too", () => {
    expect(classifyShellNecessity('echo "$HOME"').features).toEqual(["expansion"]);
    expect(classifyShellNecessity('echo "$(date)"').features).toEqual(["substitution"]);
  });

  test("…but not inside single quotes", () => {
    expect(classifyShellNecessity("echo '$HOME and $(date)'").verdict).toBe("argv");
  });

  test("a heredoc, an assignment prefix, control flow, a subshell", () => {
    expect(classifyShellNecessity("cat > f.txt <<'EOF'\nhello\nEOF").features).toContain("heredoc");
    expect(classifyShellNecessity("OST_VAULT=/tmp/v node run.mjs").features).toEqual(["assignment"]);
    expect(classifyShellNecessity("for f in a b; do cat $f; done").features).toContain("keyword");
    expect(classifyShellNecessity("(cd /tmp && ls)").features).toContain("grouping");
  });

  test("a bracket that closes inside its own word is a glob; the test command's bracket is not", () => {
    expect(classifyShellNecessity("ls file[0-9].txt").features).toEqual(["glob"]);
    expect(classifyShellNecessity("[ -f package.json ]").verdict).toBe("argv");
  });
});

describe("what the classifier will not guess at", () => {
  test("unbalanced quoting is refused rather than half-read", () => {
    expect(classifyShellNecessity('echo "unclosed').verdict).toBe("unreadable");
  });
});

// ── the argv path: no shell involved, asserted by what arrives ──────────────

describe("the argv path runs the argv class with no shell involved", () => {
  test("every recorded failure class arrives byte-for-byte instead of failing in the intermediary", () => {
    // Each argument below is one of the corpus's recorded killers: `==` and
    // `====` (zsh `=command` expansion), the two no-match globs (zsh aborts the
    // whole command), a newline inside an argument (`parse error near '\n'`),
    // and a command substitution that must NOT execute. A shell mangles every
    // one of them; the argv path has no layer in which that could happen.
    const args = ["==", "====", "/Users/tanner/dev/ost*", "test/tmp*", "line one\nline two", "$(echo pwned)"];
    const run = runArgv(["node", "-e", "console.log(JSON.stringify(process.argv.slice(1)))", ...args]);
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(args);
  });

  test("the `==` comparison the shell could not parse runs clean as an executable", () => {
    expect(runArgv(["[", "a", "==", "a", "]"]).status).toBe(0);
    expect(runArgv(["[", "a", "==", "b", "]"]).status).toBe(1);
  });

  test("`echo ===` — four recorded failures — is one working command here", () => {
    const run = runArgv(["echo", "==="]);
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("===");
  });

  test("an unmatched glob reaches the program as a literal instead of aborting the command", () => {
    // zsh under `nomatch` refused these before the program ran. Here `ls` runs,
    // receives the star, and says so itself — a diagnosable error from the
    // program that owns it, not a shell's refusal.
    const run = runArgv(["ls", "test/tmp*"], { cwd: repoRoot });
    expect(run.status).not.toBe(0);
    expect(run.status).not.toBeNull();
    expect(run.stderr).toContain("test/tmp*");
  });

  test("a real corpus command, classified and executed end to end", () => {
    const c = classifyShellNecessity("git status --porcelain");
    expect(c.verdict).toBe("argv");
    expect(runArgv(c.argv!, { cwd: repoRoot }).status).toBe(0);
  });

  test("what cannot run says so instead of guessing", () => {
    expect(runArgv([]).error).toBe("empty argv");
    const missing = runArgv(["a-program-that-does-not-exist-anywhere"]);
    expect(missing.status).toBeNull();
    expect(missing.error).toBeTruthy();
  });
});

// ── the reader: what the corpus was cut with ────────────────────────────────

function entry(command: string): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command } }] },
  });
}

describe("the reader lifts Bash commands and only Bash commands", () => {
  test("identical texts aggregate; the invocation count keeps the weight", () => {
    const sessions: TranscriptSession[] = [
      { id: "a", jsonl: [entry("git status"), entry("git status"), entry("ls")].join("\n") },
      { id: "b", jsonl: entry("git status") },
    ];
    const { commands, invocations } = readBashCommands(sessions);
    expect(invocations).toBe(4);
    expect(commands).toEqual([
      { command: "git status", count: 3, sessions: 2 },
      { command: "ls", count: 1, sessions: 1 },
    ]);
  });

  test("another tool's input is not a command, and a corrupt line costs one entry", () => {
    const grep = JSON.stringify({
      message: { content: [{ type: "tool_use", name: "Grep", input: { command: "not-a-shell-line" } }] },
    });
    const { invocations } = readBashCommands([{ id: "a", jsonl: [grep, "{corrupt", entry("ls")].join("\n") }]);
    expect(invocations).toBe(1);
  });
});

// ── the census over the committed corpus ────────────────────────────────────

/**
 * The committed corpus, cut from every session transcript on the machine that
 * produced this vault. `PROVENANCE.md` records how, including the session it
 * excludes — the one that built this census — and what the cut cannot support.
 */
function committedCorpus(): { commands: HarvestedCommand[]; meta: Record<string, unknown> } {
  const text = zlib.gunzipSync(fs.readFileSync(path.join(fixtureDir, "commands.jsonl.gz"))).toString("utf8");
  const commands = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as HarvestedCommand);
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, unknown>;
  return { commands, meta };
}

describe("the census over the committed corpus", () => {
  const { commands, meta } = committedCorpus();
  const census = shellNecessityCensus(commands, { sessionsRead: meta.sessionsRead as number });

  test("the corpus is the size PROVENANCE.md says it is", () => {
    expect(meta.transcriptsFound).toBe(680);
    expect(meta.transcriptsNested).toBe(347);
    expect(meta.excludedSessions).toEqual(["32d756a5-c91b-4801-945e-3cf0e764c156"]);
    expect(census.sessionsRead).toBe(679);
    expect(census.invocations).toBe(14802);
    expect(census.distinct).toBe(13933);
    expect(commands.reduce((n, c) => n + c.count, 0)).toBe(14802);
  });

  // ── the count the assumption test reads ───────────────────────────────────

  test("12.3% of recorded invocations need no shell feature — the bar of 70% is NOT met", () => {
    expect(census.argvInvocations).toBe(1795);
    expect(census.shellInvocations).toBe(12813);
    expect(census.share).toBe(1795 / 14608);
    expect(census.meetsBar).toBe(false);
  });

  test("the shell-bound bulk is composition, and mostly several features at once", () => {
    // The solution node's own hazard clause — "a lot of real work is a
    // pipeline" — is what the corpus shows: sequences and pipelines dwarf every
    // quoting-and-globbing feature the recorded failures came from.
    const by = new Map(census.features.map((f) => [f.feature, f]));
    expect(by.get("sequence")).toEqual({ feature: "sequence", invocations: 9970, distinct: 9529 });
    expect(by.get("pipeline")).toEqual({ feature: "pipeline", invocations: 9109, distinct: 8605 });
    expect(by.get("redirection")?.invocations).toBe(6197);
    expect(by.get("builtin")?.invocations).toBe(5244);
    expect(census.oneFeatureInvocations).toBe(2290);
    expect(census.multiFeatureInvocations).toBe(10523);
  });

  test("even forgiving the harness's own `cd` prefix, the share reaches only 15.6%", () => {
    // The directory resets between calls, so callers prefix nearly everything
    // with `cd <repo> &&`. These 486 invocations are argv once that prefix is
    // stripped, and the argv path's `cwd` option serves them directly — and the
    // share still lands nowhere near the bar.
    expect(census.cdRecoverableInvocations).toBe(486);
    expect(census.cdRecoverableDistinct).toBe(435);
    expect((census.argvInvocations + census.cdRecoverableInvocations) / 14608).toBeCloseTo(0.1561, 3);
  });

  test("unreadable commands are counted neither way, and they are 1.3% of the record", () => {
    expect(census.unreadableInvocations).toBe(194);
    expect(census.unreadableDistinct).toBe(185);
  });

  test("what the argv class actually is: file reads, not work", () => {
    // sed, grep and cat carry over half the argv invocations. The class the
    // argv path serves directly is single-file inspection — the composition
    // that surrounds real work is exactly what it cannot express.
    const top = census.programs.slice(0, 4).map((p) => p.program);
    expect(top).toEqual(["sed", "grep", "cat", "git"]);
    expect(census.programs[0].invocations).toBe(919);
  });

  test("the report leads with coverage and states the miss in one line", () => {
    const rendered = formatShellNecessityCensus(census);
    expect(rendered.startsWith("Coverage:")).toBe(true);
    expect(rendered).toContain("bar is 70.0%, NOT MET");
    expect(rendered).toContain("AS WRITTEN");
  });

  test("a census that read nothing reports UNREAD rather than a clean zero", () => {
    const empty = shellNecessityCensus([], { sessionsRead: 0 });
    expect(empty.meetsBar).toBe(false);
    expect(formatShellNecessityCensus(empty)).toContain("UNREAD");
  });
});
