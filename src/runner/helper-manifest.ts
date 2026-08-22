/**
 * Helper manifests: what a helper says it needs, checked against the machine
 * it is about to be installed on, at install time rather than at line 21.
 *
 * The failure this is aimed at is the same one line as its sibling module
 * {@link ./bash-compat-lint.js}: `/Users/tanner/.local/bin/ost-reports: line
 * 21: mapfile: command not found` (session `3d729ebc`). The two answer
 * different halves of it. The lint reads what a script *does* and refuses to
 * ship a construct the floor cannot run — it is a rule about authoring, and it
 * is blind to a command that is simply absent on the target machine. This
 * module reads what a script *declares* and refuses to install it where the
 * declaration is not satisfied. Install time is the last moment when the
 * machine and the requirements are both in view.
 *
 * ## The declaration lives in the helper
 *
 * A manifest is a block of `# ost-requires:` comments in the helper's own
 * header:
 *
 * ```sh
 * # ost-requires: interpreter bash — arrays and process substitution
 * # ost-requires: command git — reads the staged index
 * # ost-requires: builtin mapfile — reads the archive listing into an array
 * ```
 *
 * It is a comment inside the script rather than a sidecar file on purpose:
 * installing a helper is copying one file, and a requirement that does not
 * travel in that file is a requirement the install cannot read. It is also why
 * {@link PRE_COMMIT_HOOK} — the one helper this product writes onto a machine
 * without it ever being a file in the repo — can carry one at all.
 *
 * Every directive states a reason. A declaration with no reason is the first
 * one deleted when it becomes inconvenient, and the reason is what tells the
 * next author whether their change still needs it.
 *
 * **A `builtin` does not have to name a version, and that is the point.** The
 * author of `ost-reports` did not know `mapfile` was bash 4.0; they knew they
 * used it. So a `builtin` requirement is resolved against
 * {@link BASH_FEATURES} — the version table the compat lint already commits —
 * and the preflight compares that release against the interpreter the machine
 * actually has. The author declares usage; the table supplies the version.
 *
 * ## What green does NOT settle, and it is the whole hazard
 *
 * A manifest covers only what somebody remembered to declare. A script that
 * grows a dependency six months after its manifest was written installs
 * cleanly and fails at run time exactly as before — the original problem with
 * an extra file to maintain. That is why {@link manifestOmissions} exists and
 * why the spec weights it above the catch: it diffs the declared set against
 * the commands the script genuinely invokes, so the rot is measurable rather
 * than assumed away. The catch is nearly free once manifests exist at all; the
 * omission diff is the clause a careless author can fail.
 *
 * The measurement has a bias that no green run removes: manifests written now,
 * by someone who knows this class of problem exists, are more careful than
 * manifests written routinely. What is measured is the manifests this project
 * happens to have, not the discipline holding.
 *
 * ## Limits of the usage extraction, stated with it
 *
 * {@link usedCommands} is textual, built on the same `activeLines` scanner the
 * compat lint uses, so it inherits that scanner's honesty about comments,
 * quoting and heredocs — and its blindness:
 *
 * - A command assembled at runtime (`$CMD`, `eval`) is not read.
 * - A command reached through a wrapper (`xargs foo`, `sudo foo`, `env foo`)
 *   is attributed to the wrapper.
 * - A word after a `case` pattern's `)` on the same line is not read.
 *
 * Each of those is a way a real dependency escapes the diff, so the omission
 * count this produces is a floor on what a manifest misses, never a ceiling.
 */
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import {
  aboveFloor,
  BASH_FEATURES,
  bashVersion,
  formatBashVersion,
  shebangInterpreter,
  type BashVersion,
  type Helper,
} from "./bash-compat-lint.js";

// ── the declaration ──────────────────────────────────────────────────────────

/** What kind of thing a helper is declaring a need for. */
export type RequirementKind = "interpreter" | "command" | "builtin";

/** One thing a helper says must be present on the machine that runs it. */
export interface HelperRequirement {
  readonly kind: RequirementKind;
  /** `bash`, `git`, `mapfile` — the name as the shell would resolve it. */
  readonly symbol: string;
  /** An explicit minimum version, when the author stated one. */
  readonly minimum: BashVersion | null;
  /** Why the helper needs it. Required — a declaration with no reason rots first. */
  readonly why: string;
  /** 1-indexed line of the directive in the helper's source. */
  readonly line: number;
}

/** A `# ost-requires:` line that could not be read as a directive. */
export interface MalformedDirective {
  readonly line: number;
  readonly text: string;
  readonly problem: string;
}

export interface HelperManifest {
  readonly helper: string;
  readonly requires: readonly HelperRequirement[];
  /**
   * Directives that did not parse. Never silently dropped: a manifest whose
   * unreadable lines are ignored is a manifest that reports a clean preflight
   * because it could not read its own subject.
   */
  readonly malformed: readonly MalformedDirective[];
}

const DIRECTIVE = /^#\s*ost-requires:\s*(.*)$/;
const REQUIREMENT =
  /^(interpreter|command|builtin)\s+([A-Za-z_][A-Za-z0-9_.+-]*)(?:\s*>=\s*([0-9][0-9.]*))?\s*(?:—|--)\s*(\S.*?)\s*$/;

/**
 * Read a helper's manifest out of its own source.
 *
 * Comments are the carrier, so the directives are found by scanning raw lines
 * rather than `activeLines` — the scanner blanks comments, which is exactly
 * where a manifest lives.
 */
export function parseHelperManifest(name: string, source: string): HelperManifest {
  const requires: HelperRequirement[] = [];
  const malformed: MalformedDirective[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const directive = DIRECTIVE.exec(lines[i].trim());
    if (!directive) continue;
    const body = directive[1].trim();
    const m = REQUIREMENT.exec(body);
    if (!m) {
      malformed.push({
        line: i + 1,
        text: lines[i].trim(),
        problem: /—|--/.test(body)
          ? "expected `<interpreter|command|builtin> <symbol> [>= x.y] — <why>`"
          : "no reason given: every requirement states why the helper needs it, after an em dash",
      });
      continue;
    }
    requires.push({
      kind: m[1] as RequirementKind,
      symbol: m[2],
      minimum: m[3] ? bashVersion(m[3]) : null,
      why: m[4],
      line: i + 1,
    });
  }
  return { helper: name, requires, malformed };
}

/** Does this helper carry a manifest at all? */
export function hasManifest(manifest: HelperManifest): boolean {
  return manifest.requires.length > 0;
}

// ── what the script actually invokes ─────────────────────────────────────────

/**
 * Shell keywords and the builtins bash 3.2 already has.
 *
 * Nothing here is a dependency on the machine — the interpreter supplies it —
 * so nothing here has to be declared. `mapfile`, `readarray` and `coproc` are
 * deliberately absent: they are builtins the *floor* does not have, which is
 * exactly the kind of thing a manifest is for.
 */
const FLOOR_BUILTINS = new Set([
  ".", ":", "[", "alias", "bg", "bind", "break", "builtin", "caller", "cd", "command", "compgen",
  "complete", "continue", "declare", "dirs", "disown", "echo", "enable", "eval", "exec", "exit",
  "export", "false", "fc", "fg", "getopts", "hash", "help", "history", "jobs", "kill", "let",
  "local", "logout", "popd", "printf", "pushd", "pwd", "read", "readonly", "return", "set",
  "shift", "shopt", "source", "suspend", "test", "times", "trap", "true", "type", "typeset",
  "ulimit", "umask", "unalias", "unset", "wait",
]);

const KEYWORDS_BEFORE_COMMAND = new Set(["if", "then", "else", "elif", "while", "until", "do", "time", "!", "{", "}"]);
const KEYWORDS_ENDING_SEARCH = new Set(["case", "for", "select", "in", "esac", "fi", "done", "function", "[[", "]]"]);

/** One command a helper's script really invokes, with where it first does. */
export interface UsedCommand {
  readonly command: string;
  readonly line: number;
}

/**
 * Blank every character the shell will not run as a command, keeping lines and
 * columns so a finding still points at the real place in the file.
 *
 * This is NOT `activeLines` from the compat lint, and the difference is not
 * duplication. That scanner keeps double-quoted spans on purpose, because
 * `"${v,,}"` inside one is a real 4.0 dependency — correct for a version lint
 * and wrong here, where a double-quoted span is English prose. Two of this
 * project's own helpers are mostly English: run through `activeLines`, the
 * report sentence "Build loop ran N instrument(s)" yields commands named
 * `instrument` and `s`. That scanner also resets its quote state at each line
 * ending, so the pre-commit hook's multi-line single-quoted `awk` program is
 * read as shell and contributes `sub`, `next` and `prevfile`.
 *
 * The rule here is one sentence: **data is blanked, and a command substitution
 * is never data.** `$(…)` and backticks re-enter code from inside a
 * double-quoted string or an unquoted heredoc body, because that is exactly
 * what the shell does — `report "$(cat "$FILE")"` really does invoke `cat`.
 */
export interface EvaluatedLine {
  readonly line: number;
  /** The characters the shell will run, with everything else blanked. */
  readonly text: string;
  /**
   * True when the previous line ended in a backslash, so this line's first word
   * continues that command rather than starting one. `git … \` newline `commit`
   * is one invocation of `git`, not an invocation of `commit`.
   */
  readonly continuesPrevious: boolean;
}

/** Where the scanner is: `code` is the only mode whose characters survive. */
type ScanMode = "code" | "dquote" | "data" | "raw" | "arith";

export function evaluatedCommandText(source: string): EvaluatedLine[] {
  const lines = source.split("\n");
  const out = lines.map((l) => " ".repeat(l.length).split(""));
  const continues = lines.map(() => false);
  const stack: ScanMode[] = ["code"];
  let single = false;
  /** The open heredoc, and the stack depth its body sits at. */
  let heredoc: { delimiter: string; stripTabs: boolean; depth: number } | null = null;
  let pending: { delimiter: string; quoted: boolean; stripTabs: boolean } | null = null;

  for (let row = 0; row < lines.length; row++) {
    const raw = lines[row];

    // A heredoc body ends at its delimiter, but only where no command
    // substitution is open — inside `$(…)` the delimiter is just a word.
    if (heredoc && stack.length === heredoc.depth) {
      const candidate = heredoc.stripTabs ? raw.replace(/^\t+/, "") : raw;
      if (candidate.trim() === heredoc.delimiter) {
        stack.pop();
        heredoc = null;
        continue;
      }
    }

    for (let col = 0; col < raw.length; col++) {
      const c = raw[col];
      const mode = stack[stack.length - 1];

      if (single) {
        if (c === "'") single = false;
        continue;
      }
      if (c === "\\") {
        if (col === raw.length - 1 && row + 1 < lines.length) continues[row + 1] = true;
        col++;
        continue;
      }
      if (mode === "raw") continue;
      if (mode === "arith") {
        if (c === ")" && raw[col + 1] === ")") {
          stack.pop();
          col++;
        }
        continue;
      }
      if (c === "$" && raw[col + 1] === "(" && raw[col + 2] === "(") {
        stack.push("arith");
        col += 2;
        continue;
      }
      if (c === "$" && raw[col + 1] === "(") {
        stack.push("code");
        out[row][col] = "$";
        out[row][col + 1] = "(";
        col++;
        continue;
      }
      if (c === "`") {
        if (mode === "code" && stack.length > 1) stack.pop();
        else stack.push("code");
        out[row][col] = "`";
        continue;
      }
      if (mode === "dquote") {
        if (c === '"') stack.pop();
        continue;
      }
      if (mode === "data") continue;
      // From here on the mode is `code`.
      if (c === '"') {
        stack.push("dquote");
        continue;
      }
      if (c === "'") {
        single = true;
        continue;
      }
      if (c === "#" && (col === 0 || /[\s;&|(]/.test(raw[col - 1]))) break;
      if (c === ")" && stack.length > 1) {
        stack.pop();
        out[row][col] = ")";
        continue;
      }
      if (c === "<" && raw[col + 1] === "<" && raw[col + 2] !== "<" && raw[col - 1] !== "<" && !pending) {
        const parsed = parseHeredoc(raw, col);
        if (parsed) {
          pending = parsed.heredoc;
          out[row][col] = "<";
          out[row][col + 1] = "<";
          col = parsed.end - 1;
          continue;
        }
      }
      out[row][col] = c;
    }

    if (pending && !heredoc) {
      // A quoted delimiter means the body is inert; an unquoted one still runs
      // command substitutions, which is how the loop scripts embed a rollup.
      stack.push(pending.quoted ? "raw" : "data");
      heredoc = { delimiter: pending.delimiter, stripTabs: pending.stripTabs, depth: stack.length };
      pending = null;
    }
  }
  return out.map((chars, i) => ({ line: i + 1, text: chars.join(""), continuesPrevious: continues[i] }));
}

/** Parse `<<WORD`, `<<-WORD`, `<<'WORD'` starting at the `<<`. */
function parseHeredoc(
  raw: string,
  at: number,
): { heredoc: { delimiter: string; quoted: boolean; stripTabs: boolean }; end: number } | null {
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

/** Functions the script defines itself — not dependencies on the machine. */
export function definedFunctions(source: string): Set<string> {
  const names = new Set<string>();
  for (const { text } of evaluatedCommandText(source)) {
    const m = /^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*\(\s*\)/.exec(text);
    if (m) names.add(m[1]);
  }
  return names;
}

/**
 * Every command in the script that must be present on the machine.
 *
 * Reads only what the shell will run (via {@link evaluatedCommandText}), splits
 * each line at the operators that begin a new command, and takes the first word
 * of each segment once leading assignments, redirections and keywords are
 * stepped over.
 */
export function usedCommands(helper: Helper): UsedCommand[] {
  const functions = definedFunctions(helper.source);
  const seen = new Map<string, number>();
  for (const { line, text, continuesPrevious } of evaluatedCommandText(helper.source)) {
    const segments = commandSegments(text);
    // The first segment of a continued line is the tail of the previous
    // command's argument list, not a command.
    if (continuesPrevious) segments.shift();
    for (const segment of segments) {
      const word = leadingCommand(segment);
      if (!word) continue;
      if (FLOOR_BUILTINS.has(word) || functions.has(word)) continue;
      if (KEYWORDS_BEFORE_COMMAND.has(word) || KEYWORDS_ENDING_SEARCH.has(word)) continue;
      if (!seen.has(word)) seen.set(word, line);
    }
  }
  // Discovery order, which is reading order: a report of what a script needs is
  // easier to check against the script when it runs the same way down the file.
  return [...seen].map(([command, line]) => ({ command, line }));
}

/**
 * Split one evaluated line at the operators that start a fresh command.
 *
 * `$((` is stepped over rather than split: arithmetic expansion is not a
 * command substitution, and reading it as one turns `$((i+1))` into a command
 * named `i+1`.
 */
function commandSegments(text: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
      current += "$((";
      i += 2;
      continue;
    }
    if (c === "$" && text[i + 1] === "(") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    if (c === "(" || c === ")" || c === ";" || c === "|" || c === "&" || c === "`" || c === "{" || c === "}") {
      segments.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  segments.push(current);
  return segments;
}

/** The command a segment invokes, or `null` if it invokes nothing readable. */
function leadingCommand(segment: string): string | null {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  for (const raw of words) {
    const word = raw.replace(/^["']|["']$/g, "");
    if (!word) continue;
    if (KEYWORDS_ENDING_SEARCH.has(word)) return null;
    if (KEYWORDS_BEFORE_COMMAND.has(word)) continue;
    // A leading assignment (`IFS= read …`) or a redirection precedes the command.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    if (/^[0-9]*[<>]/.test(word)) continue;
    // Anything built at runtime, or spelled as a path, is not a name this can check.
    if (word.includes("$") || word.includes("/")) return null;
    if (!/^[A-Za-z_][A-Za-z0-9_.+-]*$/.test(word)) return null;
    return word;
  }
  return null;
}

// ── the honest measure: what the manifest left out ───────────────────────────

/**
 * Commands the script invokes that its manifest does not declare.
 *
 * This is the clause that decides whether declaring requirements is feasible
 * at all. An author who declares nothing passes a preflight on every machine.
 */
export function manifestOmissions(manifest: HelperManifest, helper: Helper): UsedCommand[] {
  const declared = new Set(manifest.requires.map((r) => r.symbol));
  return usedCommands(helper).filter((u) => !declared.has(u.command));
}

/** Requirements declared that the script does not appear to use — the other half of the diff. */
export function manifestOverdeclarations(manifest: HelperManifest, helper: Helper): HelperRequirement[] {
  const used = new Set(usedCommands(helper).map((u) => u.command));
  return manifest.requires.filter((r) => r.kind !== "interpreter" && !used.has(r.symbol));
}

// ── the machine ──────────────────────────────────────────────────────────────

/**
 * What the preflight is allowed to ask about the machine.
 *
 * Injected so the spec can state a machine instead of running on one — a check
 * whose answer depends on the developer's laptop is a check that reports
 * whatever that laptop happens to be.
 */
export interface MachineProbe {
  /** Absolute path of `command` on this machine's PATH, or `null` if it is not there. */
  locate(command: string): string | null;
  /**
   * The version of `interpreter`, or `null` if it could not be determined.
   * `null` is never read as "fine": an undecidable requirement blocks.
   */
  interpreterVersion(interpreter: string): BashVersion | null;
}

/**
 * The only names this module will ever execute.
 *
 * Reading a version means running something, and the name being run arrives out
 * of a *file* — a manifest directive somebody wrote. That is the shape a
 * subprocess door has to justify, so it is closed to everything but the shells
 * `isShellHelper` already recognises, with a literal argv. A manifest naming
 * anything else gets `null` back, which the preflight reads as undecidable and
 * refuses on — it fails closed rather than executing to find out.
 */
const PROBEABLE_INTERPRETERS = new Set(["bash", "sh", "dash", "ksh", "zsh"]);

/** Read PATH with the filesystem rather than by asking a shell to do it. */
export function realMachineProbe(env: NodeJS.ProcessEnv = process.env): MachineProbe {
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const located = new Map<string, string | null>();
  const versions = new Map<string, BashVersion | null>();
  return {
    locate(command: string): string | null {
      if (located.has(command)) return located.get(command) ?? null;
      let found: string | null = null;
      for (const dir of dirs) {
        const candidate = path.join(dir, command);
        try {
          fs.accessSync(candidate, fs.constants.X_OK);
          if (fs.statSync(candidate).isFile()) {
            found = candidate;
            break;
          }
        } catch {
          // Not here, or not executable by us. Both mean "keep looking".
        }
      }
      located.set(command, found);
      return found;
    },
    interpreterVersion(interpreter: string): BashVersion | null {
      if (versions.has(interpreter)) return versions.get(interpreter) ?? null;
      if (!PROBEABLE_INTERPRETERS.has(interpreter)) return null;
      const bin = this.locate(interpreter);
      let version: BashVersion | null = null;
      if (bin) {
        // argv, literal, no shell. The exit status is discarded on purpose:
        // nothing here maps a process's exit to a verdict — the version is read
        // out of the output or it is not read at all.
        const out = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
        const m = /version\s+([0-9]+\.[0-9]+)/.exec(`${out.stdout ?? ""}${out.stderr ?? ""}`);
        if (m) version = bashVersion(m[1]);
      }
      versions.set(interpreter, version);
      return version;
    },
  };
}

/** A machine stated rather than probed — what the spec runs against. */
export function statedMachine(machine: {
  commands: Readonly<Record<string, string>>;
  interpreters: Readonly<Record<string, string>>;
}): MachineProbe {
  return {
    locate: (command) => machine.commands[command] ?? null,
    interpreterVersion: (interpreter) =>
      machine.interpreters[interpreter] ? bashVersion(machine.interpreters[interpreter]) : null,
  };
}

// ── the preflight ────────────────────────────────────────────────────────────

/** Why one requirement is not satisfied here. */
export interface UnsatisfiedRequirement {
  readonly requirement: HelperRequirement;
  /** `missing` — not on this machine. `too-old` — here, but older than needed. `undecidable` — the probe could not tell. */
  readonly verdict: "missing" | "too-old" | "undecidable";
  /** What was found instead, in the words a person can act on. */
  readonly found: string;
  /** What is needed, when a version is what is needed. */
  readonly needs: string | null;
}

export interface HelperPreflight {
  readonly helper: string;
  readonly checked: number;
  readonly unsatisfied: readonly UnsatisfiedRequirement[];
  /** True only when every requirement was checked and every one was met. */
  readonly ok: boolean;
}

/** The bash release that introduced a builtin, from the table the compat lint commits. */
export function builtinIntroducedIn(symbol: string): BashVersion | null {
  const feature = BASH_FEATURES.find((f) => f.id === symbol);
  return feature ? feature.introducedIn : null;
}

/**
 * Check one helper's manifest against one machine.
 *
 * A helper with no manifest is not "fine" — it is unchecked, and the caller is
 * told so rather than handed a green result it did not earn.
 */
export function preflightHelper(manifest: HelperManifest, probe: MachineProbe): HelperPreflight {
  const unsatisfied: UnsatisfiedRequirement[] = [];

  for (const bad of manifest.malformed) {
    unsatisfied.push({
      requirement: { kind: "command", symbol: bad.text, minimum: null, why: bad.problem, line: bad.line },
      verdict: "undecidable",
      found: `line ${bad.line} could not be read as a requirement — ${bad.problem}`,
      needs: null,
    });
  }

  for (const req of manifest.requires) {
    if (req.kind === "command") {
      if (!probe.locate(req.symbol)) {
        unsatisfied.push({ requirement: req, verdict: "missing", found: "not on PATH", needs: null });
      }
      continue;
    }
    if (req.kind === "interpreter") {
      const version = probe.interpreterVersion(req.symbol);
      if (!probe.locate(req.symbol)) {
        unsatisfied.push({ requirement: req, verdict: "missing", found: "not on PATH", needs: null });
        continue;
      }
      if (!req.minimum) continue;
      if (!version) {
        unsatisfied.push({
          requirement: req,
          verdict: "undecidable",
          found: `present, but its version could not be read`,
          needs: `${req.symbol} ${formatBashVersion(req.minimum)} or newer`,
        });
        continue;
      }
      if (aboveFloor(req.minimum, version)) {
        unsatisfied.push({
          requirement: req,
          verdict: "too-old",
          found: `${req.symbol} ${formatBashVersion(version)}`,
          needs: `${req.symbol} ${formatBashVersion(req.minimum)} or newer`,
        });
      }
      continue;
    }
    // A builtin: its presence is decided by the interpreter's release, so the
    // release comes from the version table unless the author named one.
    const needed = req.minimum ?? builtinIntroducedIn(req.symbol);
    const interpreter = manifest.requires.find((r) => r.kind === "interpreter")?.symbol ?? "bash";
    if (!needed) {
      // A floor builtin nobody has to declare is met. Anything else is a symbol
      // this cannot place, and an unplaceable symbol is not a pass.
      if (FLOOR_BUILTINS.has(req.symbol)) continue;
      unsatisfied.push({
        requirement: req,
        verdict: "undecidable",
        found: `no release is known for the builtin \`${req.symbol}\``,
        needs: `state one as \`>= x.y\` in the directive`,
      });
      continue;
    }
    const version = probe.interpreterVersion(interpreter);
    if (!version) {
      unsatisfied.push({
        requirement: req,
        verdict: "undecidable",
        found: `${interpreter}'s version could not be read, so \`${req.symbol}\` cannot be placed`,
        needs: `${interpreter} ${formatBashVersion(needed)} or newer`,
      });
      continue;
    }
    if (aboveFloor(needed, version)) {
      unsatisfied.push({
        requirement: req,
        verdict: "too-old",
        found: `${interpreter} ${formatBashVersion(version)}`,
        needs: `${interpreter} ${formatBashVersion(needed)} or newer — \`${req.symbol}\` arrived in ${formatBashVersion(needed)}`,
      });
    }
  }

  return {
    helper: manifest.helper,
    checked: manifest.requires.length,
    unsatisfied,
    ok: unsatisfied.length === 0 && manifest.requires.length > 0,
  };
}

/**
 * The refusal a person reads.
 *
 * It names what is missing and what was found instead, because the whole point
 * of moving this to install time is producing something actionable rather than
 * a runtime error mentioning a builtin the reader has never heard of.
 */
export function formatHelperRefusal(preflight: HelperPreflight): string {
  if (preflight.checked === 0) {
    return `REFUSING to install ${preflight.helper}: it declares no requirements, so nothing about this machine was checked.`;
  }
  const out = [`REFUSING to install ${preflight.helper}: it cannot run on this machine.`];
  for (const u of preflight.unsatisfied) {
    out.push(`  ${u.requirement.kind} ${u.requirement.symbol} — ${u.found}`);
    if (u.needs) out.push(`      needs: ${u.needs}`);
    out.push(`      declared because: ${u.requirement.why}`);
  }
  return out.join("\n");
}

// ── the coverage report ──────────────────────────────────────────────────────

export interface ManifestCoverage {
  readonly helper: string;
  readonly interpreter: string;
  readonly declared: number;
  readonly used: number;
  readonly omitted: readonly UsedCommand[];
  readonly overdeclared: readonly string[];
  readonly malformed: readonly MalformedDirective[];
}

export function manifestCoverage(helper: Helper, manifest: HelperManifest): ManifestCoverage {
  return {
    helper: helper.name,
    interpreter: helper.interpreter || shebangInterpreter(helper.source),
    declared: manifest.requires.length,
    used: usedCommands(helper).length,
    omitted: manifestOmissions(manifest, helper),
    overdeclared: manifestOverdeclarations(manifest, helper).map((r) => r.symbol),
    malformed: manifest.malformed,
  };
}

export function formatManifestCoverage(rows: readonly ManifestCoverage[]): string {
  const out: string[] = [`${rows.length} helper(s)`];
  for (const r of rows) {
    out.push(
      `  ${r.declared === 0 ? "NO MANIFEST" : r.omitted.length === 0 ? "complete  " : `omits ${r.omitted.length}`.padEnd(10)} ` +
        `${r.helper} (#!${r.interpreter}) — ${r.declared} declared, ${r.used} used`,
    );
    for (const o of r.omitted) out.push(`      undeclared: ${o.command} (first used at line ${o.line})`);
    for (const s of r.overdeclared) out.push(`      declared but not seen in the script: ${s}`);
    for (const m of r.malformed) out.push(`      unreadable directive at line ${m.line}: ${m.problem}`);
  }
  return out.join("\n");
}
