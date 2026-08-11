/**
 * The shell-necessity census, and the argv path it sizes.
 *
 * The candidate this measures: "A shell-agnostic execution path that never
 * hands a string to a shell at all" — commands given as a program and a list of
 * arguments, executed directly, so there is no quoting layer to get wrong, no
 * glob expanded by rules the caller did not expect, and no difference between
 * shells because no shell is involved. The recorded failures it is aimed at are
 * all the intermediary's: `(eval):1: == not found` four times over, two
 * `no matches found` globs, a `parse error near '\n'`.
 *
 * The assumption test beneath it fixed the bar before anything was counted:
 * **at least 70% of harvested commands must need no shell feature at all**,
 * weighted by how often each was issued. Below that, most real work is a
 * pipeline, and rebuilding composition above a shell-less exec means
 * reimplementing a shell badly.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * {@link SHELL_NECESSITY_RULE} fixes what counts as a shell feature and what a
 * shell builtin is. The refusals carry weight in both directions:
 *
 * - **Quoting alone is not a shell feature.** `grep -n "a|b" file` needs no
 *   shell: the quotes are how the *string* was written down, and an argv caller
 *   simply passes the word. A classifier that read every quote as shell-need
 *   would sink the census on the corpus's most ordinary commands.
 * - **`[` and `echo` are not builtins.** They exist as executables (`/bin/[`
 *   accepts `==`, checked by hand on the machine that produced the record), so
 *   `[ a == b ]` runs on the argv path even though the shell that recorded the
 *   failure could not parse it. Only words no executable provides — `cd`,
 *   `export`, `source` — make a command shell-bound by themselves.
 * - **An unquoted glob IS a shell feature.** The caller who typed
 *   `ls /Users/tanner/dev/ost*` wanted expansion, and an argv path would hand
 *   `ls` the literal star. The recorded no-match failures are therefore *not*
 *   automatically in the argv class — where they land is read off their real
 *   command text, not off the failure message.
 *
 * ## What a count out of this cannot settle
 *
 * It counts commands **as written** by callers who knew a shell was there. A
 * caller who knew the default was shell-less would compose differently, and
 * nothing here predicts how. It also does not settle what happens to the
 * commands that genuinely need a shell — only how many they are.
 */
import { spawnSync } from "node:child_process";
import type { TranscriptSession } from "../telemetry/preflight.js";
import { shellWords, SHELL_OPERATORS } from "../telemetry/shell.js";

/** One shell capability a recorded command depends on. */
export type ShellFeature =
  | "substitution" // $(…), `…`, <(…), >(…) — text that depends on evaluation
  | "expansion" // $VAR, ${…}, positional/special parameters, {a,b} braces
  | "glob" // unquoted *, ?, [set] the caller wanted expanded
  | "tilde" // unquoted leading ~
  | "pipeline" // |
  | "sequence" // && || ; or a newline between commands
  | "redirection" // > >> <
  | "heredoc" // <<
  | "background" // a bare &
  | "grouping" // ( … ) or { … }
  | "builtin" // a head word only a shell provides: cd, export, source…
  | "keyword" // control flow: if, for, while, [[ …
  | "assignment"; // a leading VAR=value prefix

/** Where one command lands in the partition. */
export type ShellVerdict = "argv" | "needs-shell" | "unreadable";

export interface CommandClassification {
  verdict: ShellVerdict;
  /** The program and arguments, present only when {@link verdict} is `argv`. */
  argv?: string[];
  /** Present only when {@link verdict} is `needs-shell`, in {@link SHELL_NECESSITY_RULE.features} order. */
  features?: ShellFeature[];
}

/**
 * What this census counts, fixed before the corpus was read.
 *
 * Each field is here rather than inline so a later edit shows up as a changed
 * expectation in `test/runner/shell-necessity-census.test.ts` rather than as a
 * quietly different finding.
 */
export const SHELL_NECESSITY_RULE = {
  /**
   * The share of recorded invocations that must need no shell feature at all.
   * Set by the assumption test "Take the harvested commands and count how many
   * genuinely need a shell to do their work", before anything was counted.
   */
  bar: 0.7,

  /** Every feature the classifier can name, so a new one is a visible edit. */
  features: [
    "substitution",
    "expansion",
    "glob",
    "tilde",
    "pipeline",
    "sequence",
    "redirection",
    "heredoc",
    "background",
    "grouping",
    "builtin",
    "keyword",
    "assignment",
  ] as const satisfies readonly ShellFeature[],

  /**
   * Head words only a shell can run. `echo`, `printf`, `test`, `[`, `pwd`,
   * `true`, `false` and `kill` are deliberately absent: each exists as an
   * executable, so the argv path runs them.
   */
  builtins: [
    "cd",
    "export",
    "unset",
    "set",
    "source",
    ".",
    "alias",
    "unalias",
    "eval",
    "exec",
    "exit",
    "return",
    "shift",
    "trap",
    "ulimit",
    "umask",
    "read",
    "local",
    "declare",
    "typeset",
    "let",
    "pushd",
    "popd",
    "dirs",
    "hash",
    "builtin",
    "command",
    "shopt",
    "setopt",
    "unsetopt",
    "jobs",
    "fg",
    "bg",
    "disown",
    "wait",
    "getopts",
  ],

  /**
   * A leading `cd <dir> && ` prefix, for the census's one context measure: the
   * harness resets the shell's directory between calls, so a caller prefixes
   * almost everything with `cd`. A command that is argv-expressible once that
   * prefix is stripped is served by {@link runArgv}'s `cwd` option directly —
   * but as written it still needed the shell, and the bar is read off as-written.
   */
  cdPrefix: /^cd\s+([^\s;&|<>'"]+)\s*&&\s*/,

  /** Control-flow words that make the line a shell program, not an invocation. */
  keywords: [
    "if",
    "then",
    "else",
    "elif",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "select",
    "function",
    "coproc",
    "[[",
    "]]",
    "!",
  ],
} as const;

const BUILTINS = new Set<string>(SHELL_NECESSITY_RULE.builtins);
const KEYWORDS = new Set<string>(SHELL_NECESSITY_RULE.keywords);

/** `$` introduces evaluation when followed by one of these. */
const DOLLAR_EXPANSION = /^[A-Za-z_{(0-9@#?*!$-]/;

/**
 * Character scan for the features quoting decides: evaluation (`$`, backticks),
 * globs, tildes, braces, grouping parens. Single quotes suppress everything;
 * double quotes suppress globs and tildes but not `$` or backticks — which is
 * exactly the distinction `shellWords` flattens away, so this pass reads the
 * raw text with its own quote state.
 */
function scanQuoteSensitiveFeatures(command: string, features: Set<ShellFeature>): void {
  let quote: '"' | "'" | null = null;
  let wordStart = true;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      i++; // an escaped character is literal text whatever it is
      wordStart = false;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') {
        quote = null;
        continue;
      }
      if (ch === "$" && DOLLAR_EXPANSION.test(command.slice(i + 1, i + 2))) {
        if (command[i + 1] === "(") {
          features.add("substitution");
          i++;
        } else features.add("expansion");
      } else if (ch === "`") {
        features.add("substitution");
      }
      continue;
    }

    // unquoted
    if (ch === "'" || ch === '"') {
      quote = ch;
      wordStart = false;
      continue;
    }
    if (ch === "$" && DOLLAR_EXPANSION.test(command.slice(i + 1, i + 2))) {
      if (command[i + 1] === "(") {
        features.add("substitution");
        i++; // the paren is the substitution's, not a subshell's
      } else features.add("expansion");
    } else if (ch === "`") {
      features.add("substitution");
    } else if ((ch === "<" || ch === ">") && command[i + 1] === "(") {
      features.add("substitution"); // process substitution
      i++;
    } else if (ch === "*" || ch === "?") {
      features.add("glob");
    } else if (ch === "[") {
      // `[ a = b ]` is the test program; `file[0-9].txt` is a glob. The
      // difference is whether the bracket closes inside its own word.
      const word = command.slice(i, wordEnd(command, i));
      if (word.length > 1 && word.includes("]")) features.add("glob");
    } else if (ch === "~" && wordStart) {
      const next = command[i + 1];
      if (next === undefined || next === "/" || /[\sA-Za-z0-9_]/.test(next)) features.add("tilde");
    } else if (ch === "{") {
      // Brace expansion needs a `,` or `..` before the close; find's bare `{}`
      // and JSON that leaked out of quotes do not expand.
      const body = command.slice(i + 1, wordEnd(command, i));
      const close = body.indexOf("}");
      const inside = close === -1 ? body : body.slice(0, close);
      if (/,|\.\./.test(inside)) features.add("expansion");
    } else if (ch === "(" || ch === ")") {
      features.add("grouping");
    }

    wordStart = /\s/.test(ch);
  }
}

function wordEnd(command: string, from: number): number {
  for (let i = from; i < command.length; i++) {
    if (/[\s'"|;&<>]/.test(command[i])) return i;
  }
  return command.length;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * Classify one recorded command: expressible as a bare program-plus-arguments,
 * or dependent on at least one shell feature, or unreadable (unbalanced
 * quoting — this module will not guess, and the census counts it neither way).
 */
export function classifyShellNecessity(command: string): CommandClassification {
  const parsed = shellWords(command);
  if (!parsed) return { verdict: "unreadable" };

  const features = new Set<ShellFeature>();
  scanQuoteSensitiveFeatures(command, features);

  let segmentStart = true;
  for (let i = 0; i < parsed.words.length; i++) {
    const word = parsed.words[i];
    if (!parsed.quoted[i] && SHELL_OPERATORS.includes(word)) {
      if (word === "|") features.add("pipeline");
      else if (word === "&&" || word === "||" || word === ";" || word === "\n") features.add("sequence");
      else if (word === "<" && parsed.words[i + 1] === "<" && !parsed.quoted[i + 1]) {
        features.add("heredoc");
        i++;
      } else if (word === ">" || word === ">>" || word === "<") features.add("redirection");
      else if (word === "&") {
        // `2>&1` tokenises as `2` `>` `&` `1`; the `&` belongs to the
        // redirection in front of it, and only a bare `&` backgrounds.
        if (parsed.words[i - 1] === ">" || parsed.words[i - 1] === ">>") features.add("redirection");
        else features.add("background");
      }
      segmentStart = true;
      continue;
    }
    if (segmentStart && !parsed.quoted[i]) {
      if (ASSIGNMENT.test(word)) {
        features.add("assignment");
        continue; // the head of the command is still to come
      }
      if (KEYWORDS.has(word)) {
        features.add("keyword");
        continue; // `if cmd` — the next word is a command head too
      }
      if (BUILTINS.has(word)) features.add("builtin");
    }
    segmentStart = false;
  }

  if (features.size > 0) {
    const ordered = SHELL_NECESSITY_RULE.features.filter((f) => features.has(f));
    return { verdict: "needs-shell", features: ordered };
  }
  const argv = parsed.words.filter((w, i) => parsed.quoted[i] || w !== "\n");
  if (argv.length === 0) return { verdict: "unreadable" };
  return { verdict: "argv", argv };
}

export interface ArgvRunResult {
  /** The process's exit status, or null if it could not be started or was signalled. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Present only when the process could not run at all. */
  error?: string;
}

/**
 * The execution path itself: a program and its arguments, run directly.
 *
 * No `shell` option is ever passed, so there is no layer between the caller and
 * the process — an argument that looks like `==`, `$(…)` or `test/tmp*` reaches
 * the program byte-for-byte, which is the entire point. Every recorded failure
 * this candidate answers happened in the layer this function does not have.
 */
export function runArgv(
  argv: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): ArgvRunResult {
  const [program, ...args] = argv;
  if (!program) return { status: null, stdout: "", stderr: "", error: "empty argv" };
  const run = spawnSync(program, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: run.status,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    ...(run.error ? { error: String(run.error) } : {}),
  };
}

/** One distinct command as harvested: its text and how often it was issued. */
export interface HarvestedCommand {
  command: string;
  /** Recorded invocations of exactly this text — the frequency weight. */
  count: number;
  /** Distinct sessions it appeared in. */
  sessions: number;
}

/** Every `Bash` tool command in a corpus of transcripts, deduplicated with counts. */
export function readBashCommands(sessions: readonly TranscriptSession[]): {
  commands: HarvestedCommand[];
  /** Total tool calls read, before deduplication — the invocation denominator. */
  invocations: number;
} {
  const byText = new Map<string, { count: number; sessions: Set<string> }>();
  let invocations = 0;

  for (const session of sessions) {
    for (const line of session.jsonl.split("\n")) {
      if (!line.trim() || !line.includes('"Bash"')) continue;
      let parsed: { message?: { content?: unknown } };
      try {
        parsed = JSON.parse(line) as { message?: { content?: unknown } };
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      const content = parsed.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block.type !== "tool_use" || block.name !== "Bash") continue;
        const command = (block.input as Record<string, unknown> | undefined)?.command;
        if (typeof command !== "string" || !command.trim()) continue;
        invocations++;
        const seen = byText.get(command);
        if (seen) {
          seen.count++;
          seen.sessions.add(session.id);
        } else {
          byText.set(command, { count: 1, sessions: new Set([session.id]) });
        }
      }
    }
  }

  const commands = [...byText.entries()]
    .map(([command, { count, sessions: s }]) => ({ command, count, sessions: s.size }))
    .sort((a, b) => b.count - a.count || (a.command < b.command ? -1 : 1));
  return { commands, invocations };
}

/** How often one feature was the reason a command needed a shell. */
export interface FeatureShare {
  feature: ShellFeature;
  invocations: number;
  distinct: number;
}

export interface ShellNecessityCensus {
  /** Transcripts read. Leads the report: a census of nothing is not a clean result. */
  sessionsRead: number;
  /** Recorded invocations, the frequency weight — distinct texts weigh what they cost. */
  invocations: number;
  distinct: number;
  /** Invocations expressible as a bare program and arguments. */
  argvInvocations: number;
  argvDistinct: number;
  /** Invocations depending on at least one shell feature. */
  shellInvocations: number;
  shellDistinct: number;
  /** Unbalanced quoting the classifier refused; counted neither way. */
  unreadableInvocations: number;
  unreadableDistinct: number;
  /** argv share of the readable invocations — the number the bar reads. */
  share: number;
  meetsBar: boolean;
  /** Shell-needing invocations that depend on exactly one feature. */
  oneFeatureInvocations: number;
  /** …and on more than one. */
  multiFeatureInvocations: number;
  /** Every feature seen, by the invocations that depend on it, descending. */
  features: FeatureShare[];
  /** The argv class's head programs, by invocations, descending. */
  programs: { program: string; invocations: number }[];
  /**
   * Shell-bound invocations whose only shell need is a leading `cd <dir> && `.
   * Context, not evidence: the argv path's `cwd` option serves these directly,
   * but the bar is read off commands as written, and this number is reported so
   * the reader can see how little even that recovery moves the share.
   */
  cdRecoverableInvocations: number;
  cdRecoverableDistinct: number;
}

/** The count the assumption test reads: the partition, weighted by frequency. */
export function shellNecessityCensus(
  commands: readonly HarvestedCommand[],
  input: { sessionsRead: number },
): ShellNecessityCensus {
  let argvInvocations = 0;
  let argvDistinct = 0;
  let shellInvocations = 0;
  let shellDistinct = 0;
  let unreadableInvocations = 0;
  let unreadableDistinct = 0;
  let oneFeatureInvocations = 0;
  let multiFeatureInvocations = 0;
  let cdRecoverableInvocations = 0;
  let cdRecoverableDistinct = 0;
  const byFeature = new Map<ShellFeature, { invocations: number; distinct: number }>();
  const byProgram = new Map<string, number>();

  for (const { command, count } of commands) {
    const c = classifyShellNecessity(command);
    if (c.verdict === "unreadable") {
      unreadableInvocations += count;
      unreadableDistinct++;
      continue;
    }
    if (c.verdict === "argv") {
      argvInvocations += count;
      argvDistinct++;
      const program = c.argv![0].split("/").pop() ?? c.argv![0];
      byProgram.set(program, (byProgram.get(program) ?? 0) + count);
      continue;
    }
    shellInvocations += count;
    shellDistinct++;
    const cd = SHELL_NECESSITY_RULE.cdPrefix.exec(command);
    if (cd && classifyShellNecessity(command.slice(cd[0].length)).verdict === "argv") {
      cdRecoverableInvocations += count;
      cdRecoverableDistinct++;
    }
    if (c.features!.length === 1) oneFeatureInvocations += count;
    else multiFeatureInvocations += count;
    for (const feature of c.features!) {
      const seen = byFeature.get(feature);
      if (seen) {
        seen.invocations += count;
        seen.distinct++;
      } else {
        byFeature.set(feature, { invocations: count, distinct: 1 });
      }
    }
  }

  const readable = argvInvocations + shellInvocations;
  const share = readable === 0 ? 0 : argvInvocations / readable;
  return {
    sessionsRead: input.sessionsRead,
    invocations: argvInvocations + shellInvocations + unreadableInvocations,
    distinct: commands.length,
    argvInvocations,
    argvDistinct,
    shellInvocations,
    shellDistinct,
    unreadableInvocations,
    unreadableDistinct,
    share,
    meetsBar: readable > 0 && share >= SHELL_NECESSITY_RULE.bar,
    oneFeatureInvocations,
    multiFeatureInvocations,
    features: [...byFeature.entries()]
      .map(([feature, v]) => ({ feature, ...v }))
      .sort((a, b) => b.invocations - a.invocations || (a.feature < b.feature ? -1 : 1)),
    programs: [...byProgram.entries()]
      .map(([program, invocations]) => ({ program, invocations }))
      .sort((a, b) => b.invocations - a.invocations || (a.program < b.program ? -1 : 1)),
    cdRecoverableInvocations,
    cdRecoverableDistinct,
  };
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * The census as an operator reads it: coverage first, then the partition, then
 * what the count cannot support.
 */
export function formatShellNecessityCensus(census: ShellNecessityCensus): string {
  const lines: string[] = [];
  lines.push(
    `Coverage: ${census.sessionsRead} session(s) read, ${census.invocations} recorded command invocation(s) ` +
      `(${census.distinct} distinct), ${census.unreadableInvocations} unreadable and counted neither way.`,
  );
  if (census.invocations === 0) {
    lines.push("Shell necessity: UNREAD — no recorded command was found at all, so no share is available.");
    return lines.join("\n");
  }
  lines.push(
    `Shell necessity: ${pct(census.share)} of readable invocations need no shell feature at all ` +
      `(${census.argvInvocations} argv vs ${census.shellInvocations} shell-bound) — ` +
      `bar is ${pct(SHELL_NECESSITY_RULE.bar)}, ${census.meetsBar ? "MET" : "NOT MET"}.`,
  );
  lines.push(
    `Of the shell-bound: ${census.oneFeatureInvocations} invocation(s) hang on a single feature, ` +
      `${census.multiFeatureInvocations} on several.`,
  );
  for (const f of census.features) {
    lines.push(`  ${f.feature} — ${f.invocations} invocation(s), ${f.distinct} distinct command(s)`);
  }
  if (census.cdRecoverableInvocations > 0) {
    const withCd = census.argvInvocations + census.cdRecoverableInvocations;
    const readable = census.argvInvocations + census.shellInvocations;
    lines.push(
      `Context: ${census.cdRecoverableInvocations} shell-bound invocation(s) need the shell only for a leading ` +
        `\`cd <dir> &&\` — counting those as served lifts the share to ${pct(withCd / readable)}, still read against the same bar.`,
    );
  }
  lines.push(
    "Not settled: commands are counted AS WRITTEN by callers who knew a shell was there; " +
      "a caller composing for an argv default would write differently, and nothing here predicts how.",
  );
  return lines.join("\n");
}
