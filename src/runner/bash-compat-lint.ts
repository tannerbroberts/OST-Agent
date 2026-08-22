/**
 * The bash version-floor lint: every helper this project installs, read
 * against the oldest bash that is actually present on the machines in play.
 *
 * The recorded failure it is aimed at is one line long. A helper was installed
 * into `~/.local/bin`, was executable, was on the PATH, and died at its first
 * real statement: `/Users/tanner/.local/bin/ost-reports: line 21: mapfile:
 * command not found` (session `3d729ebc`, pinned in
 * `test/fixtures/path-failure-attribution/failures.jsonl`). `mapfile` is a bash
 * 4.0 builtin and macOS ships `/bin/bash` 3.2. Nothing between authoring and
 * running compared the two, so the incompatibility was decided at the keyboard
 * and discovered on the author's own hardware.
 *
 * ## The floor is a commitment, not a measurement
 *
 * {@link BASH_32_FLOOR} fixes the floor at **bash 3.2** because that is the
 * bash Apple ships and has shipped since 2007 — the licence change to GPLv3 in
 * bash 4.0 is why it has not moved and is not going to. A floor picked any
 * higher would be a guess about a machine nobody has checked; picked lower it
 * would be POSIX `sh`, which is a different check (see the limits below).
 *
 * The floor is declared here, in source, before anything is counted — the same
 * discipline `src/runner/shell-necessity.ts` follows. A rule chosen after
 * reading the findings is a rule fitted to the findings.
 *
 * ## Why this is not `shellcheck -s sh`
 *
 * The obvious move is to reach for the off-the-shelf linter, and the obvious
 * move does not work. ShellCheck 0.11.0 selects a dialect by **family**
 * (`sh`, `bash`, `dash`, `ksh`, `busybox`) and has no option anywhere that
 * names a bash *version*. That leaves two settings and neither is a floor:
 *
 * - `-s bash` — the dialect these helpers actually declare — says nothing at
 *   all about `mapfile`. The known failure is **missed**, silently.
 * - `-s sh` catches it (SC3044) and catches sixteen other things with it. Run
 *   over this project's own two helpers it raises 15 SC3xxx findings, and
 *   every one of them — `set -o pipefail`, `BASH_SOURCE`, array references,
 *   process substitution, `$'…'` — is a construct **bash 3.2 has had for
 *   twenty years**. At the floor that matters they are 15 false alarms against
 *   a bar of 2.
 *
 * Both runs are recorded in `test/fixtures/bash-compat/shellcheck.json` with
 * the tool version that produced them, re-derivable by
 * `scripts/harvest-shellcheck-floor-corpus.ts`, and asserted against
 * {@link SHELLCHECK_POSIX_CODES} in the spec — so the claim "the off-the-shelf
 * linter cannot express this floor" is a committed measurement rather than a
 * remark. What ShellCheck supplies is a parser and a catalogue of
 * non-POSIX constructs; what it cannot supply is the version table below,
 * which is the only thing that turns that catalogue into a floor.
 *
 * ## The false-alarm half is the load-bearing half
 *
 * Flagging `mapfile` is nearly certain — the rule reads what the script does
 * rather than what someone declared. What kills a check like this is people
 * learning to ignore it, so {@link lintBashCompat} is written to stay silent
 * on everything bash 3.2 can run, and the spec asserts that silence in both
 * directions on real helpers rather than only asserting the catch. Three
 * quiet-side rules do most of that work:
 *
 * - **Comments are not code.** The fixed `ost-reports` explains its own
 *   workaround with the word `mapfile` in a comment. A linter that flags that
 *   line punishes the person who fixed the bug.
 * - **A quoted heredoc body is data.** `<<'PROMPT'` is expanded by nothing, so
 *   nothing in it can be a version hazard. `build-pass.sh` ships a heredoc of
 *   English prose; the check does not read it as shell.
 * - **An unquoted heredoc body is half data.** `<<PROMPT` still runs parameter
 *   expansion and command substitution, so `${v,,}` in one is a real 4.0
 *   dependency while `mapfile` in one is a word in a sentence. Only the
 *   expansion-class rules apply there.
 *
 * ## What green does NOT settle
 *
 * It protects against **version drift and nothing else**. A command that is
 * simply absent on the target machine — present at every bash version, just
 * not installed — is invisible here; that is what an install-time preflight is
 * for. Neither does it check POSIX `sh` compliance: the generated pre-commit
 * hook declares `#!/bin/sh`, and this lint holds it to bash 3.2, which is a
 * *superset* of what `/bin/sh` guarantees. A bashism in that hook passes here
 * and would fail under `dash`. The spec closes that one gap the only way that
 * stays offline — by pinning ShellCheck's own `-s sh` verdict on the generated
 * hook (zero SC3xxx) as a recorded fixture — and the gap reopens the moment a
 * second `#!/bin/sh` helper is added.
 */
import fs from "node:fs";
import path from "node:path";

/** A bash release, as the major.minor pair the manual's compatibility notes use. */
export interface BashVersion {
  readonly major: number;
  readonly minor: number;
}

export function bashVersion(text: string): BashVersion {
  const [major, minor] = text.split(".").map((n) => Number.parseInt(n, 10));
  return { major, minor: minor ?? 0 };
}

export function formatBashVersion(v: BashVersion): string {
  return `${v.major}.${v.minor}`;
}

/** Is `v` newer than `floor` — i.e. does depending on it break at the floor? */
export function aboveFloor(v: BashVersion, floor: BashVersion): boolean {
  return v.major > floor.major || (v.major === floor.major && v.minor > floor.minor);
}

/**
 * Where a construct can appear and still be evaluated.
 *
 * `command` rules are builtins, options and operators — things the shell reads
 * as code. `expansion` rules are `${…}` and variable references, which an
 * unquoted heredoc body still evaluates. The distinction is the whole reason a
 * 500-line English prompt heredoc does not light this check up.
 */
export type BashConstructClass = "command" | "expansion";

/** One bash feature that does not exist at or below the floor. */
export interface BashFeature {
  /** Stable id — this is what the expected-findings fixture keys on. */
  readonly id: string;
  /** The release that introduced it. */
  readonly introducedIn: BashVersion;
  readonly kind: BashConstructClass;
  /** What a reader of the finding needs in order to act on it. */
  readonly describe: string;
  /** What to write instead, at the floor. */
  readonly insteadAtFloor: string;
  readonly pattern: RegExp;
}

function feature(
  id: string,
  version: string,
  kind: BashConstructClass,
  pattern: RegExp,
  describe: string,
  insteadAtFloor: string,
): BashFeature {
  return { id, introducedIn: bashVersion(version), kind, describe, insteadAtFloor, pattern };
}

/**
 * The table. Every entry is a construct bash 3.2 does not have, with the
 * release that added it.
 *
 * It is deliberately a list of things that *break loudly* — a missing builtin,
 * an expansion the older parser rejects — rather than everything that changed
 * between 3.2 and 5.3. A version floor whose findings are mostly stylistic is
 * the check that gets ignored, and being ignored is the failure mode this
 * whole approach is being tested for.
 */
export const BASH_FEATURES: readonly BashFeature[] = [
  // ── 4.0 ────────────────────────────────────────────────────────────────────
  feature(
    "mapfile",
    "4.0",
    "command",
    /(?<![\w$./-])(?:mapfile|readarray)\b/,
    "`mapfile`/`readarray` is a bash 4.0 builtin",
    "`while IFS= read -r line; do arr+=(\"$line\"); done < <(…)`",
  ),
  feature(
    "associative-array",
    "4.0",
    "command",
    /(?<![\w$./-])(?:declare|typeset|local|readonly)\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*A/,
    "associative arrays (`declare -A`) arrived in bash 4.0",
    "parallel indexed arrays, or a `key=value` stream through `awk`",
  ),
  feature(
    "case-modification",
    "4.0",
    "expansion",
    /\$\{[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?(?:\^\^?|,,?)[^}]*\}/,
    "case-modifying expansion (`${v^^}`, `${v,,}`) arrived in bash 4.0",
    "`tr '[:lower:]' '[:upper:]'`",
  ),
  feature(
    "append-both-redirect",
    "4.0",
    "command",
    /&>>/,
    "`&>>` (append stdout and stderr) arrived in bash 4.0",
    "`>>file 2>&1`",
  ),
  feature(
    "pipe-both",
    "4.0",
    "command",
    /(?<![|&])\|&(?!&)/,
    "`|&` (pipe stdout and stderr) arrived in bash 4.0",
    "`2>&1 |`",
  ),
  feature("coproc", "4.0", "command", /(?<![\w$./-])coproc\b/, "`coproc` arrived in bash 4.0", "a named pipe, or a background job with explicit fds"),
  feature(
    "globstar",
    "4.0",
    "command",
    /(?<![\w$./-])shopt\s+(?:-\w+\s+)*globstar\b/,
    "`shopt -s globstar` (`**`) arrived in bash 4.0",
    "`find … -name`",
  ),
  // ── 4.2 ────────────────────────────────────────────────────────────────────
  feature(
    "declare-g",
    "4.2",
    "command",
    /(?<![\w$./-])(?:declare|typeset)\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*g/,
    "`declare -g` arrived in bash 4.2",
    "assign without `declare` inside the function",
  ),
  feature(
    "test-v",
    "4.2",
    "command",
    /(?<![\w$./-])(?:\[\[|\[|test)\s+(?:-\w+\s+)*-v\s/,
    "`test -v` / `[[ -v ]]` arrived in bash 4.2",
    "`[ -n \"${v+x}\" ]`",
  ),
  feature(
    "printf-time",
    "4.2",
    "command",
    /%\([^)]*\)T/,
    "`printf '%(fmt)T'` arrived in bash 4.2",
    "`date '+fmt'`",
  ),
  feature(
    "lastpipe",
    "4.2",
    "command",
    /(?<![\w$./-])shopt\s+(?:-\w+\s+)*lastpipe\b/,
    "`shopt -s lastpipe` arrived in bash 4.2",
    "restructure so the last stage is not a subshell (`< <(…)`)",
  ),
  // ── 4.3 ────────────────────────────────────────────────────────────────────
  feature(
    "nameref",
    "4.3",
    "command",
    /(?<![\w$./-])(?:declare|typeset|local)\s+(?:-[A-Za-z]+\s+)*-[A-Za-z]*n(?:\s|=)/,
    "namerefs (`declare -n`) arrived in bash 4.3",
    "pass the value, or `eval` a fully-quoted assignment",
  ),
  feature(
    "negative-array-index",
    "4.3",
    "expansion",
    /\$\{[A-Za-z_][A-Za-z0-9_]*\[\s*-/,
    "negative array subscripts (`${a[-1]}`) arrived in bash 4.3",
    "`${a[$(( ${#a[@]} - 1 ))]}`",
  ),
  feature("wait-n", "4.3", "command", /(?<![\w$./-])wait\s+(?:-\w+\s+)*-n\b/, "`wait -n` arrived in bash 4.3", "`wait` for every job, or poll with `kill -0`"),
  // ── 4.4 ────────────────────────────────────────────────────────────────────
  feature(
    "parameter-transform",
    "4.4",
    "expansion",
    /\$\{[^{}]*@[QEPAa]\}/,
    "parameter transformations (`${v@Q}`) arrived in bash 4.4",
    "`printf %q`",
  ),
  // ── 5.0 ────────────────────────────────────────────────────────────────────
  feature(
    "epoch-variables",
    "5.0",
    "expansion",
    /\$\{?(?:EPOCHSECONDS|EPOCHREALTIME)\b/,
    "`$EPOCHSECONDS` / `$EPOCHREALTIME` arrived in bash 5.0",
    "`date +%s`",
  ),
  feature("bash-argv0", "5.0", "expansion", /\$\{?BASH_ARGV0\b/, "`$BASH_ARGV0` arrived in bash 5.0", "`$0`"),
  // ── 5.1 ────────────────────────────────────────────────────────────────────
  feature(
    "srandom",
    "5.1",
    "expansion",
    /\$\{?SRANDOM\b/,
    "`$SRANDOM` arrived in bash 5.1",
    "`$RANDOM`, or read `/dev/urandom`",
  ),
  feature(
    "case-transform",
    "5.1",
    "expansion",
    /\$\{[^{}]*@[ULK]\}/,
    "`${v@U}` / `${v@L}` / `${v@K}` arrived in bash 5.1",
    "`tr '[:lower:]' '[:upper:]'`",
  ),
  feature("wait-p", "5.1", "command", /(?<![\w$./-])wait\s+(?:-\w+\s+)*-p\b/, "`wait -p` arrived in bash 5.1", "`wait` for a known pid"),
];

/** The rule, committed before any helper was read. */
export const BASH_32_FLOOR = {
  floor: bashVersion("3.2"),
  /** Why 3.2 and not something else. */
  why:
    "macOS ships /bin/bash 3.2.57 and has since 2007 — bash 4.0 moved to GPLv3, so Apple's copy is not going to advance. " +
    "3.2 is therefore the lowest bash actually present on the machines this project's helpers are installed on.",
  /** What the check does not cover, stated with the rule rather than after a green run. */
  limits: [
    "Version drift only. A command absent at every bash version (jq, gh) is invisible here.",
    "Not a POSIX-sh check. A `#!/bin/sh` helper is held to bash 3.2, which is a superset of what /bin/sh guarantees.",
    "Textual, not a full parse. A construct built at runtime out of `eval` and string concatenation is not read.",
  ],
  features: BASH_FEATURES,
} as const;

// ── reading a script: which characters the shell will actually evaluate ──────

/**
 * Blank out everything the shell will not evaluate as code, keeping every
 * line and column so a finding still points at the real place in the file.
 *
 * Returns one entry per line: the surviving text, and which construct classes
 * that line's surviving text may be judged by. An unquoted heredoc body keeps
 * only `expansion`, because that is exactly what such a body still evaluates.
 */
export interface ActiveLine {
  readonly line: number;
  readonly text: string;
  readonly classes: readonly BashConstructClass[];
}

const ALL_CLASSES: readonly BashConstructClass[] = ["command", "expansion"];
const EXPANSION_ONLY: readonly BashConstructClass[] = ["expansion"];
const NOTHING: readonly BashConstructClass[] = [];

interface PendingHeredoc {
  readonly delimiter: string;
  readonly quoted: boolean;
  readonly stripTabs: boolean;
}

export function activeLines(source: string): ActiveLine[] {
  const lines = source.split("\n");
  const out: ActiveLine[] = [];
  let openHeredoc: PendingHeredoc | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    if (openHeredoc) {
      const candidate = openHeredoc.stripTabs ? raw.replace(/^\t+/, "") : raw;
      if (candidate === openHeredoc.delimiter) {
        openHeredoc = null;
        out.push({ line: i + 1, text: blank(raw), classes: NOTHING });
      } else {
        // A quoted delimiter means no expansion at all: the body is inert data.
        out.push({
          line: i + 1,
          text: openHeredoc.quoted ? blank(raw) : raw,
          classes: openHeredoc.quoted ? NOTHING : EXPANSION_ONLY,
        });
      }
      continue;
    }

    const scanned = scanLine(raw);
    out.push({ line: i + 1, text: scanned.text, classes: ALL_CLASSES });
    openHeredoc = scanned.heredoc;
  }
  return out;
}

function blank(text: string): string {
  return " ".repeat(text.length);
}

/**
 * One line of shell, with comments and literal-quoted spans blanked.
 *
 * Single quotes and `$'…'` are literal, so nothing inside them can be a
 * construct. Double quotes are NOT blanked: `"${v,,}"` is still a 4.0
 * expansion. A `#` opens a comment only where the shell would treat it as one
 * — at the start of a word — which is why `"$#"` and `${#a[@]}` survive.
 */
function scanLine(raw: string): { text: string; heredoc: PendingHeredoc | null } {
  const chars = raw.split("");
  let inSingle = false;
  let inDouble = false;
  let heredoc: PendingHeredoc | null = null;

  for (let i = 0; i < chars.length; i++) {
    const c = raw[i];

    if (inSingle) {
      chars[i] = " ";
      if (c === "'") inSingle = false;
      continue;
    }
    if (c === "\\" && (inDouble || !inSingle)) {
      i++; // the escaped character is literal either way
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      chars[i] = " ";
      continue;
    }
    if (c === '"') {
      inDouble = true;
      continue;
    }
    if (c === "$" && raw[i + 1] === "'") {
      // ANSI-C quoting: literal, like a single-quoted string.
      chars[i] = " ";
      chars[i + 1] = " ";
      inSingle = true;
      i++;
      continue;
    }
    if (c === "#" && startsWord(raw, i)) {
      for (let j = i; j < chars.length; j++) chars[j] = " ";
      break;
    }
    // `<<` opens a heredoc; `<<<` is a here-string, and its second `<` must not
    // be mistaken for the start of one — that would swallow the rest of the file.
    if (c === "<" && raw[i + 1] === "<" && raw[i + 2] !== "<" && raw[i - 1] !== "<" && !heredoc) {
      const parsed = parseHeredocDelimiter(raw, i);
      if (parsed) {
        heredoc = parsed.heredoc;
        i = parsed.end - 1;
      }
      continue;
    }
  }
  return { text: chars.join(""), heredoc };
}

/** `#` opens a comment only at the start of a word — not in `a#b` or `${#a}`. */
function startsWord(raw: string, i: number): boolean {
  if (i === 0) return true;
  return /[\s;&|(]/.test(raw[i - 1]);
}

/** Parse `<<WORD`, `<<-WORD`, `<<'WORD'`, `<<"WORD"` starting at the `<<`. */
function parseHeredocDelimiter(raw: string, at: number): { heredoc: PendingHeredoc; end: number } | null {
  let i = at + 2;
  let stripTabs = false;
  if (raw[i] === "-") {
    stripTabs = true;
    i++;
  }
  while (raw[i] === " " || raw[i] === "\t") i++;
  const quote = raw[i] === "'" || raw[i] === '"' ? raw[i] : null;
  if (quote) i++;
  const start = i;
  while (i < raw.length && (quote ? raw[i] !== quote : /[A-Za-z0-9_]/.test(raw[i]))) i++;
  const delimiter = raw.slice(start, i);
  if (!delimiter) return null;
  if (quote) i++;
  return { heredoc: { delimiter, quoted: quote !== null, stripTabs }, end: i };
}

// ── the lint ─────────────────────────────────────────────────────────────────

/** One construct a helper depends on that the floor does not provide. */
export interface BashCompatFinding {
  readonly helper: string;
  readonly line: number;
  readonly column: number;
  readonly feature: string;
  readonly introducedIn: string;
  readonly describe: string;
  readonly insteadAtFloor: string;
  /** The evaluated text of the line, so a reader can judge the finding without opening the file. */
  readonly evidence: string;
}

/** A shell artefact this project puts on a machine. */
export interface Helper {
  /** Stable id, repo-relative where the helper is a file. */
  readonly name: string;
  /** `shipped` = a file in the repo; `generated` = source this project writes out at runtime. */
  readonly origin: "shipped" | "generated" | "recorded";
  /** The interpreter its shebang names, or `""` if it has none. */
  readonly interpreter: string;
  readonly source: string;
}

export function lintBashCompat(helper: Helper, floor: BashVersion = BASH_32_FLOOR.floor): BashCompatFinding[] {
  const findings: BashCompatFinding[] = [];
  for (const { line, text, classes } of activeLines(helper.source)) {
    if (classes.length === 0) continue;
    for (const f of BASH_FEATURES) {
      if (!classes.includes(f.kind)) continue;
      if (!aboveFloor(f.introducedIn, floor)) continue;
      const re = new RegExp(f.pattern.source, f.pattern.flags.includes("g") ? f.pattern.flags : f.pattern.flags + "g");
      for (const m of text.matchAll(re)) {
        findings.push({
          helper: helper.name,
          line,
          column: (m.index ?? 0) + 1,
          feature: f.id,
          introducedIn: formatBashVersion(f.introducedIn),
          describe: f.describe,
          insteadAtFloor: f.insteadAtFloor,
          evidence: text.trim(),
        });
      }
    }
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

// ── finding the subject ──────────────────────────────────────────────────────

/** Directories a sweep of the working tree must not descend into. */
const NOT_THE_SUBJECT = new Set([".git", "node_modules", "dist", ".worktrees", "coverage"]);

/**
 * Repo-relative paths that hold shell on purpose but install nothing.
 *
 * `test/fixtures` is the corpus this very check is measured against — the
 * recorded `mapfile` helper lives there. Sweeping it as if it were shipped
 * would make the check's own subject part of its answer.
 */
const NOT_INSTALLED = ["test/fixtures", "examples/vaults"];

const SHEBANG = /^#!\s*(\S+)(?:\s+(\S+))?/;

/** The interpreter a shebang names — `/usr/bin/env bash` resolves to `bash`. */
export function shebangInterpreter(source: string): string {
  const m = SHEBANG.exec(source.split("\n", 1)[0] ?? "");
  if (!m) return "";
  const first = path.basename(m[1]);
  if (first === "env" && m[2]) return path.basename(m[2]);
  return first;
}

export function isShellHelper(source: string): boolean {
  return ["sh", "bash", "dash", "ksh", "zsh"].includes(shebangInterpreter(source));
}

/**
 * Every shell helper this project installs, discovered by walking the working
 * tree rather than by listing names.
 *
 * The list is not hard-coded on purpose. A census whose subject is a constant
 * stops covering the repository the first time somebody adds a file to it, and
 * reports a clean run while doing so — which is the failure this check exists
 * to avoid in the helpers themselves.
 *
 * `generated` covers the one shell script this project writes onto a machine
 * without it ever being a file in the repo: the pre-commit hook in
 * `src/git/conflict-guard.ts`. It is passed in rather than imported so this
 * module stays free of the git layer.
 */
export function discoverShippedHelpers(repoRoot: string): Helper[] {
  const found: Helper[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (NOT_THE_SUBJECT.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (NOT_INSTALLED.includes(rel)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      // Read only what could plausibly be one: a shebang is the first line.
      if (!/\.(sh|bash)$/.test(entry.name) && path.extname(entry.name) !== "") continue;
      const source = fs.readFileSync(full, "utf8");
      if (!isShellHelper(source)) continue;
      found.push({
        name: path.relative(repoRoot, full).split(path.sep).join("/"),
        origin: "shipped",
        interpreter: shebangInterpreter(source),
        source,
      });
    }
  };
  walk(repoRoot);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

export function generatedHelper(name: string, source: string): Helper {
  return { name, origin: "generated", interpreter: shebangInterpreter(source), source };
}

// ── the ShellCheck comparison, as a table rather than as a remark ────────────

/**
 * ShellCheck's POSIX-portability codes, mapped to the bash release that
 * introduced the construct each one names.
 *
 * This table is what makes "`-s sh` is not a bash 3.2 floor" checkable rather
 * than arguable. Two things fall out of writing it down, and the second is the
 * more damaging of the two:
 *
 * 1. **Most SC3xxx codes sit far below the floor.** Process substitution,
 *    `$'…'`, array references, `set -o pipefail`, `BASH_SOURCE` — every SC3xxx
 *    ShellCheck raises against this project's own helpers is a construct bash
 *    3.2 has. At the floor that matters they are false alarms, and there are 15
 *    of them against a bar of 2.
 * 2. **Two codes cannot be resolved from the code at all.** `SC3044` is
 *    "in POSIX sh, X is undefined" for *any* builtin: it is the code that fires
 *    on `mapfile` (4.0, a real hazard) and equally on `declare` (2.0, fine at
 *    the floor). `SC3028` does the same for variables — `EPOCHSECONDS` (5.0)
 *    and `BASH_SOURCE` (3.0) arrive under one number. The version lives in the
 *    English of the message, not in the classification, so a consumer wanting a
 *    floor has to re-derive it from a table like this one anyway.
 *
 * Versions are from the bash CHANGES/NEWS files. A construct older than bash
 * 2.0 is recorded as 2.0; nothing older is in play.
 */
export interface ShellcheckCode {
  readonly construct: string;
  /** The release, when the code alone determines it. `null` when it does not. */
  readonly introducedIn: string | null;
  /** For codes that name a symbol in their message: that symbol's release. */
  readonly perSymbol?: Readonly<Record<string, string>>;
}

export const SHELLCHECK_POSIX_CODES: Readonly<Record<string, ShellcheckCode>> = {
  SC3001: { construct: "process substitution `<(…)`", introducedIn: "2.0" },
  SC3003: { construct: "`$'…'` ANSI-C quoting", introducedIn: "2.0" },
  SC3010: { construct: "`[[ … ]]`", introducedIn: "2.0" },
  SC3011: { construct: "here-strings `<<<`", introducedIn: "2.05b" },
  SC3018: { construct: "`++`/`--` arithmetic", introducedIn: "2.0" },
  SC3020: { construct: "`&>` redirection", introducedIn: "2.0" },
  SC3024: { construct: "`+=` append assignment", introducedIn: "3.1" },
  SC3030: { construct: "array assignment `a=(…)`", introducedIn: "2.0" },
  SC3037: { construct: "`echo` flags", introducedIn: "2.0" },
  SC3039: { construct: "`local`", introducedIn: "2.0" },
  SC3040: { construct: "`set -o pipefail`", introducedIn: "3.0" },
  SC3043: { construct: "`local`", introducedIn: "2.0" },
  SC3045: { construct: "`printf -v`", introducedIn: "3.1" },
  SC3054: { construct: "array references `${a[i]}`", introducedIn: "2.0" },
  SC3057: { construct: "string indexing `${v:0:2}`", introducedIn: "2.0" },
  SC3059: { construct: "case modification `${v,,}`", introducedIn: "4.0" },
  SC3028: {
    construct: "a variable POSIX sh does not define — the release depends on which one",
    introducedIn: null,
    perSymbol: { BASH_SOURCE: "3.0", BASH_VERSION: "2.0", RANDOM: "2.0", SECONDS: "2.0", EPOCHSECONDS: "5.0", EPOCHREALTIME: "5.0", BASH_ARGV0: "5.0", SRANDOM: "5.1" },
  },
  SC3044: {
    construct: "a builtin POSIX sh does not define — the release depends on which one",
    introducedIn: null,
    perSymbol: { declare: "2.0", typeset: "2.0", local: "2.0", shopt: "2.0", source: "2.0", mapfile: "4.0", readarray: "4.0", coproc: "4.0" },
  },
};

/** What release a recorded ShellCheck finding actually implicates, if it can be told. */
export interface ShellcheckFloorVerdict {
  readonly code: string;
  readonly introducedIn: string | null;
  /** `code` — the number was enough. `symbol` — the message had to be read. `unknown` — neither. */
  readonly resolvedBy: "code" | "symbol" | "unknown";
  readonly aboveFloor: boolean;
}

/**
 * Resolve one recorded `-s sh` finding to a bash release.
 *
 * The `symbol` path is the finding: a caller who wants a version floor cannot
 * get one from ShellCheck's classification, only from its prose. Quoting in
 * the message is `'like this'`, so the symbol is read out of the quotes and
 * falls back to whole-word matching for the variable codes, which do not quote.
 */
export function shellcheckFloorVerdict(
  code: string,
  message: string,
  floor: BashVersion = BASH_32_FLOOR.floor,
): ShellcheckFloorVerdict {
  const entry = SHELLCHECK_POSIX_CODES[code];
  if (!entry) return { code, introducedIn: null, resolvedBy: "unknown", aboveFloor: false };
  if (entry.introducedIn) {
    return {
      code,
      introducedIn: entry.introducedIn,
      resolvedBy: "code",
      aboveFloor: aboveFloor(bashVersion(entry.introducedIn), floor),
    };
  }
  const quoted = /'([^']+)'/.exec(message)?.[1];
  const symbol =
    (quoted && entry.perSymbol?.[quoted] ? quoted : undefined) ??
    Object.keys(entry.perSymbol ?? {}).find((s) => new RegExp(`\\b${s}\\b`).test(message));
  const version = symbol ? entry.perSymbol?.[symbol] : undefined;
  if (!version) return { code, introducedIn: null, resolvedBy: "unknown", aboveFloor: false };
  return { code, introducedIn: version, resolvedBy: "symbol", aboveFloor: aboveFloor(bashVersion(version), floor) };
}

// ── the report a human reads ─────────────────────────────────────────────────

export interface BashCompatReport {
  readonly floor: string;
  readonly helpers: readonly { name: string; origin: string; interpreter: string; findings: number }[];
  readonly findings: readonly BashCompatFinding[];
}

export function bashCompatReport(helpers: readonly Helper[], floor: BashVersion = BASH_32_FLOOR.floor): BashCompatReport {
  const findings = helpers.flatMap((h) => lintBashCompat(h, floor));
  return {
    floor: formatBashVersion(floor),
    helpers: helpers.map((h) => ({
      name: h.name,
      origin: h.origin,
      interpreter: h.interpreter,
      findings: findings.filter((f) => f.helper === h.name).length,
    })),
    findings,
  };
}

export function formatBashCompatReport(report: BashCompatReport): string {
  const out: string[] = [`bash ${report.floor} floor — ${report.helpers.length} helper(s), ${report.findings.length} finding(s)`];
  for (const h of report.helpers) {
    out.push(`  ${h.findings === 0 ? "ok  " : "FAIL"} ${h.name} (${h.origin}, #!${h.interpreter}) — ${h.findings}`);
  }
  for (const f of report.findings) {
    out.push(`  ${f.helper}:${f.line}:${f.column}  ${f.describe}`);
    out.push(`      at the floor: ${f.insteadAtFloor}`);
  }
  return out.join("\n");
}
