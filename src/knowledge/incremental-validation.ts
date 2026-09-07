/**
 * Checking a `Workflow` submission **while it is being written**, so a dialect
 * violation is answered at the line that caused it rather than at the line the
 * composer happened to stop on.
 *
 * The opportunity ("I compose a hundred and seventy lines before the surface
 * tells me it does not accept that dialect") has two rejections on record, at
 * `(172:33)` and `(24:12)`. Both are the same defect and they differ by an order
 * of magnitude in what they wasted, and the difference is *not* the defect — it
 * is how many lines existed before anybody looked. {@link parseWorkflowScript}
 * already answers "would the surface refuse this?", but only about a whole
 * artefact: a script three lines in is by construction unfinished, and a parser
 * that answers "unfinished" to everything partial has nothing to offer a
 * composer mid-composition. This module is the part that separates *unfinished*
 * from *wrong*.
 *
 * **The rule, and the direction it errs in.** A prefix is refused only when the
 * defect cannot be repaired by writing more. Everything else — an open brace, a
 * call with no closing paren, a template literal running onto the next line —
 * comes back clean, because incompleteness is not an error. That asymmetry is
 * deliberate and it is the whole design: a false rejection at line three costs
 * the composer more than the late rejection this replaces, since it sends them
 * hunting for a defect that is not there in an artefact they cannot yet run. So
 * where this module cannot tell, it says nothing. It is a check that catches
 * early, never one that catches everything.
 *
 * **How "cannot be repaired by writing more" is decided.** Three signals, and
 * each was chosen against the parser rather than guessed at:
 *
 *  1. **The frontier.** Appending text can only change the parse from the point
 *     where the written text runs out — or, if the prefix ends inside a string,
 *     template or block comment, from where that region opened, because
 *     everything after the opener is still up for revision. An error at or after
 *     the frontier is truncation. `const count: number = 1` errors at column 11
 *     with eleven more characters written, so it is not.
 *  2. **A backward-pointing message.** `Missing catch or finally clause` is
 *     reported at the `try`, not at the end, and a `catch` on the next line
 *     removes it. It is the only such message the controls in
 *     `test/eval/incremental-parse.test.ts` found across a script written to
 *     contain every awkward shape, and it is named rather than pattern-matched
 *     so that a second one shows up as a failing control instead of as a false
 *     rejection in front of a composer.
 *  3. **The reject patterns**, from {@link WORKFLOW_REJECTS}, scanned over code
 *     with comments and literal contents blanked. These matter most for the
 *     group that *parses* — `Date.now()`, `require()`, a type argument on a call
 *     — which no parse check catches at any moment, at submission or before. For
 *     those the incremental answer is not merely earlier than the surface's, it
 *     is the only one there is: the surface accepts them and the script dies
 *     spending tokens.
 *
 * **What it does not do.** It cannot see anything the reject list does not name,
 * it judges an append-only composer (a defect fixed by going back and editing an
 * earlier line is not modelled), and — the one worth stating plainly — it says
 * nothing about whether composing actually happens a line at a time. The
 * assumption node under this solution names that openly: if artefacts are
 * written whole in a single act there is no line three at which to check and this
 * reduces to a dry run before submission. That is a question about the composing
 * surface and nothing here can answer it.
 */
import {
  WORKFLOW_REJECTS,
  metaProblems,
  parseWorkflowScript,
  type WorkflowReject,
} from "./workflow-grammar.js";

/** Why a prefix was refused, in the terms the composer can act on. */
export type ViolationKind =
  /** The parser refuses it; the surface would never run this submission. */
  | "parser"
  /** It parses and throws when the script runs — invisible to any parse check, at any moment. */
  | "runtime"
  /** The `meta` rules the tool states, checkable as soon as the first statement closes. */
  | "meta";

export interface PrefixViolation {
  /** 1-based, and the point of the whole module: the line that caused it. */
  readonly line: number;
  /** 0-based, as the surface's own `(line:column)` refusals report it. */
  readonly column: number;
  readonly kind: ViolationKind;
  /** What is wrong, in the grammar's words where the grammar has words for it. */
  readonly message: string;
}

/**
 * The source with comments and literal *contents* replaced by spaces —
 * positions, newlines and delimiters preserved — plus where an unterminated
 * region begins, if the text ends inside one.
 *
 * {@link codeOnly} in the grammar module does the comment half of this from
 * acorn's comment list, which requires a successful parse. A prefix routinely
 * does not parse, so this is a tolerant scan instead: it needs no parse, and it
 * blanks string bodies too, so a prompt that *mentions* `Date.now()` in prose is
 * not read as a call to it.
 *
 * It does not recognise regular-expression literals, so `/["']/` reads as the
 * start of a string. Every consequence of that runs one way — a region held open
 * that should have closed suppresses findings, it does not invent them — which
 * is the direction this module is required to fail in.
 */
export function blankNonCode(source: string): { code: string; openedAt: number | null } {
  type Region = { kind: "line" | "block" | "'" | '"' | "`" | "${"; at: number };
  const out = source.split("");
  const stack: Region[] = [];
  const blank = (i: number): void => {
    if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const c = source[i];
    const d = source[i + 1];
    // Code, or the interpolated part of a template — both read as code.
    if (!top || top.kind === "${") {
      if (c === "/" && d === "/") {
        stack.push({ kind: "line", at: i });
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        stack.push({ kind: "block", at: i });
        blank(i);
        blank(i + 1);
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        stack.push({ kind: c, at: i });
        i += 1;
        continue;
      }
      if (top && c === "}") {
        stack.pop();
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (top.kind === "line") {
      if (c === "\n") {
        stack.pop();
        i += 1;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }
    if (top.kind === "block") {
      if (c === "*" && d === "/") {
        blank(i);
        blank(i + 1);
        stack.pop();
        i += 2;
        continue;
      }
      blank(i);
      i += 1;
      continue;
    }
    // Inside a string or a template literal.
    if (c === "\\") {
      blank(i);
      blank(i + 1);
      i += 2;
      continue;
    }
    if (c === top.kind) {
      stack.pop();
      i += 1;
      continue;
    }
    if (top.kind === "`" && c === "$" && d === "{") {
      stack.push({ kind: "${", at: i });
      i += 2;
      continue;
    }
    // A newline ends a quoted string whatever comes next, so the region is
    // closed rather than held open: that defect is not repairable by writing
    // more, and holding it open would hide it.
    if ((top.kind === "'" || top.kind === '"') && c === "\n") {
      stack.pop();
      i += 1;
      continue;
    }
    blank(i);
    i += 1;
    continue;
  }
  return { code: out.join(""), openedAt: stack.length > 0 ? stack[0].at : null };
}

/**
 * Acorn messages reported at the *start* of a construct that more text still
 * completes. Held as an exact list rather than a pattern: a second one arriving
 * should surface as a failing control in the suite, not as a rejection a
 * composer cannot act on.
 */
const REPAIRABLE_MESSAGES: readonly string[] = ["Missing catch or finally clause"];

/** Strip acorn's `(line:column)` suffix, which every message carries. */
function messageBody(message: string): string {
  return message.replace(/\s*\(\d+:\d+\)\s*$/, "");
}

/** 1-based line and 0-based column of an offset, in acorn's own reckoning. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, Math.max(0, offset));
  const line = before.split("\n").length;
  const column = offset - (before.lastIndexOf("\n") + 1);
  return { line, column };
}

/**
 * The point past which appending text can still change the parse: where the
 * written characters run out, or where an unterminated region opened, whichever
 * came first.
 */
function frontierOf(prefix: string, openedAt: number | null): number {
  const written = prefix.trimEnd().length;
  return openedAt === null ? written : Math.min(openedAt, written);
}

/** Every reject pattern's matches in already-blanked code, at their own positions. */
function patternViolations(prefix: string, code: string): PrefixViolation[] {
  const found: PrefixViolation[] = [];
  for (const reject of WORKFLOW_REJECTS) {
    if (!reject.pattern) continue;
    const scan = new RegExp(reject.pattern.source, withGlobal(reject.pattern.flags));
    for (const match of code.matchAll(scan)) {
      if (match.index === undefined) continue;
      const { line, column } = positionOf(prefix, match.index);
      found.push({ line, column, kind: kindOf(reject), message: `${reject.name} — ${reject.why}` });
    }
  }
  return found;
}

function withGlobal(flags: string): string {
  return flags.includes("g") ? flags : `${flags}g`;
}

function kindOf(reject: WorkflowReject): ViolationKind {
  return reject.why === "the parser refuses it" ? "parser" : "runtime";
}

/**
 * Check what has been written so far.
 *
 * The argument is a prefix of a submission — everything composed up to now, not
 * a whole script — and the answer is every violation that prefix already
 * carries, each at the line that caused it. An empty list means "nothing wrong
 * yet", which is *not* "this would be accepted": the rest is unwritten.
 *
 * Violations are returned in line order and deduplicated by position, because
 * the parser and a pattern can name the same defect (a type annotation is both
 * refused by acorn and matched by its pattern) and a composer shown the same
 * line twice reads it as two mistakes.
 */
export function validateWorkflowPrefix(prefix: string): PrefixViolation[] {
  const { code, openedAt } = blankNonCode(prefix);
  const found = patternViolations(prefix, code);
  const parsed = parseWorkflowScript(prefix);

  if (!parsed.ok) {
    // The parser's own position, converted back to an offset so it can be
    // compared with the frontier: acorn hands the failure back with a location,
    // and the location is the line the composer is owed.
    const offset = offsetOf(prefix, parsed.line, parsed.column);
    const repairable =
      offset >= frontierOf(prefix, openedAt) || REPAIRABLE_MESSAGES.includes(messageBody(parsed.message));
    if (!repairable) {
      // The parser's position wins over any pattern that named the same line:
      // a type annotation is both refused by acorn and matched by its pattern,
      // the pattern points at the `const` and the parser at the `:`, and the
      // parser's is the column the surface's own refusal would carry. Runtime
      // matches on that line survive — those are a different defect.
      const shadowed = (v: PrefixViolation): boolean => v.kind === "parser" && v.line === parsed.line;
      return order([
        ...found.filter((v) => !shadowed(v)),
        { line: parsed.line, column: parsed.column, kind: "parser", message: messageBody(parsed.message) },
      ]);
    }
    return order(found);
  }

  // `meta` is checkable the moment its statement closes, and a `meta` that is
  // not a pure literal is the kind of defect a composer would otherwise learn
  // about after writing everything under it. Nothing is checked while the
  // program is still empty: an unwritten `meta` is unwritten, not wrong.
  if (parsed.program.body.length > 0) {
    const first = parsed.program.body[0];
    const at = first.loc ? { line: first.loc.start.line, column: first.loc.start.column } : { line: 1, column: 0 };
    for (const problem of metaProblems(prefix, parsed.program)) {
      // The textual "must begin with" rule is dropped when the first *statement*
      // is a proper `meta` export: that only fires on a leading comment, no
      // recorded refusal says the surface minds one, and refusing a composer's
      // header comment at line one is exactly the false alarm this must not make.
      if (problem.startsWith("the script does not begin with") && first.type === "ExportNamedDeclaration") continue;
      found.push({ line: at.line, column: at.column, kind: "meta", message: problem });
    }
  }
  return order(found);
}

/** Offset of a 1-based line and 0-based column. */
function offsetOf(source: string, line: number, column: number): number {
  const lines = source.split("\n");
  let offset = 0;
  for (let n = 1; n < line && n <= lines.length; n += 1) offset += lines[n - 1].length + 1;
  return offset + column;
}

function order(found: PrefixViolation[]): PrefixViolation[] {
  const seen = new Set<string>();
  return found
    .slice()
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .filter((v) => {
      const key = `${v.line}:${v.column}:${v.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface ComposingRejection {
  /** How many lines existed when the defect became answerable. */
  readonly atLine: number;
  readonly violation: PrefixViolation;
  /**
   * Lines that would have been composed after the answer was available and
   * before the surface gave one. This is the quantity the opportunity is about:
   * the recorded refusals are the same defect and differ only in this number.
   */
  readonly linesSaved: number;
}

/**
 * Compose the script a line at a time and report the first line at which it
 * could have been refused.
 *
 * This is the mechanism stated as a measurement rather than as a claim: run it
 * over a submission and it answers "the composer could have been told at line
 * N", against a surface that says nothing until the last line is handed over.
 * `null` means nothing in the script is answerable early — which for the
 * runtime-throwing group means nothing is answerable at all.
 */
export function firstRejectionWhileComposing(source: string): ComposingRejection | null {
  const lines = source.split("\n");
  for (let n = 1; n <= lines.length; n += 1) {
    const violations = validateWorkflowPrefix(lines.slice(0, n).join("\n"));
    if (violations.length === 0) continue;
    return { atLine: n, violation: violations[0], linesSaved: lines.length - n };
  }
  return null;
}
