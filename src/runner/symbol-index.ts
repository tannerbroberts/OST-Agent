/**
 * The project's symbol surface, extracted from source so a run can be handed it
 * *before* it writes rather than being told about it by the compiler afterwards.
 *
 * The candidate this serves: "Hand the run the project's symbol surface before it
 * writes, not after it compiles." A run edits several files, then runs
 * `npx tsc --noEmit` and learns that one of the edits referenced something that
 * does not exist. The signal is correct and far too late — it arrives detached from
 * the edit that caused it, after the rest of the batch has been written on top of the
 * mistake. The captured failures are this product's own sessions:
 *
 *   - `src/cli/index.ts(108,26): error TS2552: Cannot find name 'reconcileWithUsage'.
 *     Did you mean 'reconcileWithGit'?`
 *   - `src/security/tools.ts(744,63): error TS2339: Property 'configProblem' does not
 *     exist on type 'ToolContext'`
 *
 * The `TS2552` is the argument for building this at all: the compiler supplied the
 * correction, which means the right name was derivable from the same source files the
 * whole time. The run did not lack the information; it lacked it *at the moment it was
 * writing the call*. So the index answers exactly the two questions those errors
 * answered too late — **is this name exported anywhere in the project**, and **does
 * this type carry this member** — and, when the answer is no, offers the near-misses
 * the compiler would have offered.
 *
 * ## What it reads, and what it deliberately is not
 *
 * It reads source *text*, with no TypeScript program and no type checker. That is a
 * deliberate trade and the reason it can run before a write: a checker needs a
 * resolvable program, which is precisely what a half-written batch does not have, and
 * `typescript` is a devDependency this product does not ship. A text scan answers
 * "what does this repository declare" on the repository as it sits, including mid-edit.
 *
 * What that costs is stated rather than hidden. This is **not** a type checker and its
 * answers are declaration-level:
 *
 *   - Inherited members are not resolved. `interface A extends B` reports A's own
 *     members and names B on {@link ExportedSymbol.extends}; it does not flatten B in.
 *   - A type alias to something other than an object literal (a union, a mapped type,
 *     `Pick<…>`) records the alias text, not a member list.
 *   - Locally declared, non-exported names are invisible by construction — the index is
 *     the *exported* surface, which is what a cross-module call needs.
 *   - `export * from "./x"` is recorded as a re-export edge, not followed.
 *
 * Every one of those is a place the index says "I don't know" rather than "absent", and
 * {@link NameLookup.present} / {@link MemberLookup.present} are only ever set from what
 * was actually seen. The failure mode this must not have is confidently reporting a
 * name absent that is really there, because a run acting on that would delete a correct
 * call — hence {@link MemberLookup.inheritedFrom}, which withholds a member verdict for
 * a type that extends something.
 *
 * ## The bar this was built against
 *
 * {@link SYMBOL_INDEX_CASES} pins the three lookups verbatim from the transcript, and
 * `test/runner/symbol-index.test.ts` rebuilds the index over the whole of `src/` at the
 * commit the session started from and asserts all three. Feasibility only: a green run
 * says the surface can be extracted mechanically and is right on the three cases that
 * actually went wrong. It says nothing about whether a run handed the index consults
 * it, nothing about whether the briefing is small enough to be worth its context, and
 * nothing about whether anyone outside this project wants it.
 */

import fs from "node:fs";
import path from "node:path";

/** What kind of declaration an exported name is. */
export type SymbolKind =
  | "function"
  | "const"
  | "let"
  | "var"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "namespace"
  | "re-export";

/** One member of an exported type, interface, class or enum. */
export interface TypeMember {
  /** The member's name as written (`configProblem`, `"quoted-key"`, `[index: string]`). */
  name: string;
  /** True for `name?: T` — declared but not required. */
  optional: boolean;
  /** True for `readonly name: T`. Mutability is load-bearing and is recorded, never inferred. */
  readonly: boolean;
  /** True when the member is a call signature (`run(): void`) rather than a property. */
  method: boolean;
  /**
   * The declared type as written, collapsed to one line; `""` when there is no
   * annotation (a method signature, or an enum member). Kept verbatim because
   * `readonly OstNode[]` vs `OstNode[]` is one of the three captured failures' shape
   * and normalising it away would lose exactly the distinction that broke.
   */
  type: string;
}

/** One exported declaration in one module. */
export interface ExportedSymbol {
  name: string;
  kind: SymbolKind;
  /** 1-based line of the `export` keyword in the module. */
  line: number;
  /** True for `export async function`. */
  async: boolean;
  /** The declaration head, collapsed to one line — the signature a caller has to satisfy. */
  signature: string;
  /** Members, for the kinds that carry a surface. Empty for a function, a scalar const, or an alias to a non-object type. */
  members: TypeMember[];
  /** Supertypes named by `extends`/`implements`, unresolved. Non-empty means a member verdict is incomplete. */
  extends: string[];
  /** For `export * from "./x"` / `export { a } from "./x"`, the module specifier. */
  from?: string;
}

/** Everything one module exports. */
export interface ModuleSymbols {
  /** The module's path as the caller supplied it — repo-relative, by convention. */
  module: string;
  exports: ExportedSymbol[];
}

/** The whole project's exported surface. */
export interface SymbolIndex {
  modules: ModuleSymbols[];
}

/** A source file to index. */
export interface SourceFile {
  path: string;
  source: string;
}

/**
 * The three lookups this index was built to answer, taken verbatim from
 * `TRANSCRIPT:e335a680-ee48-4171-b8ad-4cfb526e4129`.
 *
 * They are pinned in source rather than typed into the test so the bar is a committed
 * artifact: the assumption test's threshold is "all three, no misses", and a bar a test
 * carries privately is a bar the next edit can quietly restate. `expect` is what
 * *reads* these; it does not get to choose them.
 */
export const SYMBOL_INDEX_CASES = {
  /** `TS2552: Cannot find name 'reconcileWithUsage'.` — the name the run wrote. */
  absentName: "reconcileWithUsage",
  /** `Did you mean 'reconcileWithGit'?` — the name the compiler volunteered. */
  presentName: "reconcileWithGit",
  /** `TS2339: Property 'configProblem' does not exist on type 'ToolContext'`. */
  absentMember: { type: "ToolContext", member: "configProblem" },
} as const;

// ── masking: read structure without reading comments, strings or regexes ─────

/**
 * Two blanked copies of a source file, both the same length as the original so any
 * offset found in one indexes the others.
 *
 * `structural` blanks comments, string bodies and regex bodies — braces inside a
 * template literal must not move the depth counter, and a `"}"` in a message must not
 * close an interface. `commentFree` blanks only comments, so type text lifted out of it
 * keeps its string-literal unions (`surface?: "mcp" | "cli-tool"`) intact.
 *
 * A template's `${…}` is code rather than text, so {@link endOfString} hands it to
 * {@link endOfInterpolation} and resumes after the matching `}`. That is not a nicety:
 * this file previously stopped a template at the first backtick inside an
 * interpolation, and the first module in `src/` to write one — an error message
 * building `` `\`${key}\`` `` — desynchronised the scan for the rest of the file and
 * lost fourteen exports. The header used to call that a truncated member list; it is a
 * FALSE ABSENCE, which is the one answer `test/runner/symbol-index.test.ts` says this
 * index must never give, and the parity test caught it on the commit that introduced
 * the construct.
 *
 * That limit was reached and closed. `src/loop/compute-lane.ts` shell-quotes a node
 * title with a `/'/g` inside an interpolation, the parity test named the export it lost
 * on the commit that introduced it, and {@link endOfInterpolation} now walks regex
 * literals and comments the same way this function does. A `/` inside an interpolation
 * whose pattern holds an unbalanced brace or quote is no longer a false absence.
 */
function blank(source: string): { structural: string; commentFree: string } {
  const structural = [...source];
  const commentFree = [...source];
  const wipe = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to && k < arr.length; k++) if (arr[k] !== "\n") arr[k] = " ";
  };

  let i = 0;
  // The previous significant character, used to tell a regex literal from a division.
  let prev = "";
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];

    if (c === "/" && d === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j++;
      wipe(structural, i, j);
      wipe(commentFree, i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      let j = i + 2;
      while (j < source.length && !(source[j] === "*" && source[j + 1] === "/")) j++;
      j = Math.min(source.length, j + 2);
      wipe(structural, i, j);
      wipe(commentFree, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const end = endOfString(source, i);
      // Keep the delimiters so the token still reads as a string in `structural`.
      wipe(structural, i + 1, end - 1);
      i = end;
      prev = c;
      continue;
    }
    if (c === "/" && isRegexStart(source, i, prev)) {
      const end = endOfRegex(source, i);
      wipe(structural, i + 1, end - 1);
      i = end;
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { structural: structural.join(""), commentFree: commentFree.join("") };
}

/** Index just past the closing quote of the string starting at `start`. */
function endOfString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    // `${…}` inside a template is code, and a backtick in there opens a NESTED
    // template rather than closing this one. Skipping to the matching `}` is what
    // keeps the scan in phase; see this section's header for what happens when it
    // does not.
    if (quote === "`" && c === "$" && source[i + 1] === "{") {
      i = endOfInterpolation(source, i + 1);
      continue;
    }
    if (c === quote) return i + 1;
    // A non-template string does not span lines; bail rather than swallow the file.
    if (c === "\n" && quote !== "`") return i;
    i++;
  }
  return source.length;
}

/**
 * Index just past the `}` that closes the interpolation whose `{` is at `start`.
 *
 * Braces are counted and strings inside are delegated back to {@link endOfString},
 * so `` `${a ? `${b}` : "}"}` `` is walked correctly: the nested template and the
 * `"}"` are both consumed as strings and neither moves the depth counter.
 *
 * **Regex literals are walked here too, and that is the limit the header used to
 * say remained.** A regex body is text: `` `'${s.replace(/'/g, "x")}'` `` read the
 * `/` as division, so the `'` inside the pattern opened a string and the scan
 * resumed somewhere downstream — every export below it in the file vanished,
 * which is a FALSE ABSENCE and the one answer this index must never give. The
 * construct arrived in `src/loop/compute-lane.ts`, shell-quoting a node title for
 * a pasted command; the parity test against TypeScript's own parser caught it on
 * that commit, exactly as the header promised it would. {@link blank} already had
 * this branch — it was missing only on the path that walks *inside* an
 * interpolation, where the same characters mean the same thing.
 */
function endOfInterpolation(source: string, start: number): number {
  let depth = 0;
  let i = start;
  // The previous significant character, on {@link blank}'s rule: it is what tells
  // a regex literal from a division.
  let prev = "";
  while (i < source.length) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i = Math.min(source.length, i + 2);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = endOfString(source, i);
      prev = c;
      continue;
    }
    if (c === "/" && isRegexStart(source, i, prev)) {
      i = endOfRegex(source, i);
      prev = "/";
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return source.length;
}

/**
 * Keywords a regex literal may directly follow. After one of these a `/` cannot be
 * division, because a keyword does not produce a value to divide.
 */
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "yield",
  "await",
  "case",
  "throw",
]);

/**
 * A `/` starts a regex literal when what precedes it cannot end an expression.
 * After an identifier, a number, `)` or `]`, a `/` is division — *unless* that
 * identifier is a keyword.
 *
 * The keyword arm is load-bearing rather than pedantic: `return /(^|[\s;&|(])set…/`
 * in `src/loop/exitLaundering.ts` read as division under the character rule, so the
 * brackets inside the pattern moved the depth counter and the two `export function`s
 * below it fell out of the index. A missed export is reported as an absent name, which
 * is the one wrong answer this index must not give.
 */
function isRegexStart(source: string, at: number, prev: string): boolean {
  if (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev)) return true;
  let end = at - 1;
  while (end >= 0 && /\s/.test(source[end])) end--;
  if (end < 0) return true;
  if (!/[A-Za-z_$]/.test(source[end])) return false;
  let begin = end;
  while (begin >= 0 && /[A-Za-z0-9_$]/.test(source[begin])) begin--;
  return REGEX_PRECEDING_KEYWORDS.has(source.slice(begin + 1, end + 1));
}

/** Index just past the closing `/` of the regex starting at `start`. */
function endOfRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "\n") return i;
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    i++;
  }
  return source.length;
}

// ── scanning one module ──────────────────────────────────────────────────────

const IDENT = "[A-Za-z_$][A-Za-z0-9_$]*";

/** Collapse a declaration fragment to one line of single-spaced text. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 1-based line number of `offset` in `source`. */
function lineAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) if (source[i] === "\n") line++;
  return line;
}

/**
 * Offsets of every `export` keyword that begins a top-level statement.
 *
 * Top-level means all three bracket depths are zero, which is what keeps a re-export
 * inside a namespace or an `export` in a nested declaration block from being read as a
 * module-level export. The keyword must also start its line: `export` appearing inside
 * a longer expression is not a declaration.
 */
function topLevelExports(structural: string): number[] {
  const starts: number[] = [];
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let lineStart = true;

  for (let i = 0; i < structural.length; i++) {
    const c = structural[i];
    if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);

    if (c === "\n") {
      lineStart = true;
      continue;
    }
    if (!lineStart || /[ \t]/.test(c)) continue;
    lineStart = false;
    if (brace !== 0 || paren !== 0 || bracket !== 0) continue;
    if (!structural.startsWith("export", i)) continue;
    // `export` must be a whole keyword, and `exports.x = …` is not one.
    if (/[A-Za-z0-9_$]/.test(structural[i + 6] ?? "")) continue;
    starts.push(i);
  }
  return starts;
}

/** Index of the `}` matching the `{` at `open`, or `-1`. */
function matchBrace(structural: string, open: number): number {
  let depth = 0;
  for (let i = open; i < structural.length; i++) {
    if (structural[i] === "{") depth++;
    else if (structural[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** True when a chunk ends mid-expression and the next line continues it. */
function continues(chunk: string, next: string): boolean {
  if (/[|&:=<,(+\-*/?]$/.test(chunk)) return true;
  if (/\b(extends|implements|keyof|typeof|in|of)$/.test(chunk)) return true;
  return /^[|&)?>\]}]|^extends\b/.test(next);
}

/**
 * Split a declaration body into member chunks.
 *
 * Members separate on `;` and `,` at depth zero, and on a newline only when the line
 * so far reads as complete — a multi-line union (`kind:\n  | "a"\n  | "b";`) must stay
 * one member, or the index would report a member with no type and invent three more.
 */
function memberChunks(structuralBody: string): { start: number; end: number }[] {
  const chunks: { start: number; end: number }[] = [];
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let angle = 0;
  let start = 0;

  const push = (end: number) => {
    if (structuralBody.slice(start, end).trim().length > 0) chunks.push({ start, end });
    start = end + 1;
  };

  for (let i = 0; i < structuralBody.length; i++) {
    const c = structuralBody[i];
    if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);
    else if (c === "<" && /[A-Za-z0-9_$>)\]]/.test(structuralBody[i - 1] ?? "")) angle++;
    else if (c === ">" && angle > 0 && structuralBody[i - 1] !== "=") angle--;

    const flat = brace === 0 && paren === 0 && bracket === 0 && angle === 0;
    if (!flat) continue;

    if (c === ";" || c === ",") {
      push(i);
      continue;
    }
    if (c === "\n") {
      const chunk = structuralBody.slice(start, i).trim();
      if (chunk.length === 0) {
        start = i + 1;
        continue;
      }
      const rest = structuralBody.slice(i + 1);
      const next = rest.replace(/^\s+/, "");
      if (continues(chunk, next)) continue;
      push(i);
    }
  }
  if (structuralBody.slice(start).trim().length > 0) chunks.push({ start, end: structuralBody.length });
  return chunks;
}

const MEMBER_HEAD = new RegExp(
  "^(?:(?:public|private|protected|declare|abstract|static|override|async|get|set)\\s+)*" +
    "(readonly\\s+)?" +
    `(\\[[^\\]]*\\]|"[^"]*"|'[^']*'|#?${IDENT})` +
    "(\\?)?\\s*(!)?\\s*([:(<=]|$)",
);

/** Parse the members of one `{ … }` body. */
function parseMembers(structural: string, commentFree: string, open: number, close: number): TypeMember[] {
  const structuralBody = structural.slice(open + 1, close);
  const textBody = commentFree.slice(open + 1, close);
  const members: TypeMember[] = [];

  for (const { start, end } of memberChunks(structuralBody)) {
    const structuralChunk = structuralBody.slice(start, end).trim();
    // A class body's method implementations arrive here too; their bodies were already
    // held at depth by `memberChunks`, so only the head needs matching.
    const head = MEMBER_HEAD.exec(structuralChunk);
    if (!head) continue;
    const name = head[2];
    // `private` members are not surface. Neither is a `#`-private field. Note that a
    // member may legitimately BE named `async`, `get` or `static` — `ExportedSymbol`
    // in this very file has an `async` field — so the exclusion tests the modifier
    // position in the chunk, never the captured name.
    if (name.startsWith("#")) continue;
    if (/^\s*(?:private|protected)\s/.test(structuralChunk)) continue;

    const sep = head[5];
    const offset = structuralBody.indexOf(structuralChunk, start);
    const textChunk = textBody.slice(offset, offset + structuralChunk.length);
    const colon = sep === ":" ? textChunk.indexOf(":", head[0].length - 1) : -1;
    members.push({
      name,
      optional: head[3] === "?",
      readonly: head[1] !== undefined,
      method: sep === "(" || sep === "<",
      type: colon >= 0 ? oneLine(textChunk.slice(colon + 1)) : "",
    });
  }
  return members;
}

/** Names listed in an `extends`/`implements` clause, before the body opens. */
function supertypes(head: string): string[] {
  const clause = /\b(?:extends|implements)\s+([^{]*)/.exec(head);
  if (!clause) return [];
  return clause[1]
    .split(",")
    .map((t) => oneLine(t).replace(/<.*$/, ""))
    .filter((t) => t.length > 0 && /^[A-Za-z_$]/.test(t));
}

/**
 * Extract the exported surface of one module from its text.
 *
 * `modulePath` is recorded verbatim and never resolved — the caller decides whether it
 * is a repo-relative path or something else, and the index only ever reports it back.
 */
export function indexModule(modulePath: string, source: string): ModuleSymbols {
  const { structural, commentFree } = blank(source);
  const exports: ExportedSymbol[] = [];

  for (const start of topLevelExports(structural)) {
    // A declaration head runs to the body brace, the initialiser, or the statement end,
    // whichever comes first. 600 characters is well past the longest head in `src/`.
    const window = structural.slice(start, start + 600);
    // The same span with only comments blanked. Structure is read off `window`, but any
    // text lifted out — a module specifier, a signature — comes from here, because
    // `window` has had every string body wiped and a specifier IS a string body.
    const textWindow = commentFree.slice(start, start + 600);
    const line = lineAt(source, start);

    const reExport = new RegExp(
      `^export\\s*(\\*(?:\\s+as\\s+(${IDENT}))?|\\{([^}]*)\\})\\s*(?:from\\s*['"]([^'"]*)['"])?`,
      "d",
    ).exec(window);
    const specifier = reExport?.indices?.[4] ? textWindow.slice(reExport.indices[4][0], reExport.indices[4][1]) : undefined;
    const reExportText = reExport ? oneLine(textWindow.slice(0, reExport[0].length)) : "";
    const decl = new RegExp(
      // `\b(?:\s*\*)?\s*` after the keyword, not `\s+`, so `export function* gen()` —
      // a generator, whose star binds to the keyword with no space — is still a
      // declaration. Two of this repository's exports are written that way.
      `^export\\s+(?:default\\s+)?(?:declare\\s+)?(abstract\\s+)?(async\\s+)?(function|class|interface|type|const\\s+enum|enum|namespace|module|const|let|var)\\b(?:\\s*\\*)?\\s*(${IDENT})`,
    ).exec(window);

    if (decl) {
      const kindWord = decl[3].replace(/\s+/g, " ");
      const kind: SymbolKind =
        kindWord === "const enum" ? "enum" : kindWord === "module" ? "namespace" : (kindWord as SymbolKind);
      const name = decl[4];

      // The body, when the declaration has one: an interface/class/enum opens directly,
      // and a type alias only counts when its right-hand side is an object literal.
      let open = -1;
      if (kind === "interface" || kind === "class" || kind === "enum" || kind === "namespace") {
        open = structural.indexOf("{", start + decl[0].length - name.length);
      } else if (kind === "type") {
        const eq = structural.indexOf("=", start);
        const semi = structural.indexOf(";", start);
        if (eq >= 0 && (semi < 0 || eq < semi)) {
          const after = /\S/.exec(structural.slice(eq + 1));
          if (after && after[0] === "{") open = eq + 1 + (after.index ?? 0);
        }
      } else if (kind === "const" || kind === "let" || kind === "var") {
        // `export const X = { … } as const` is a surface too — the same shape an
        // interface has, declared as a value.
        const eq = structural.indexOf("=", start);
        const semi = structural.indexOf(";", start);
        if (eq >= 0 && (semi < 0 || eq < semi)) {
          const after = /\S/.exec(structural.slice(eq + 1));
          if (after && after[0] === "{") open = eq + 1 + (after.index ?? 0);
        }
      }

      const close = open >= 0 ? matchBrace(structural, open) : -1;
      const headEnd = open >= 0 ? open : Math.min(structural.length, start + decl[0].length);
      const head = oneLine(commentFree.slice(start, headEnd));

      exports.push({
        name,
        kind,
        line,
        async: decl[2] !== undefined,
        signature: signatureOf(kind, commentFree, structural, start, decl[0].length, head),
        members: open >= 0 && close > open ? parseMembers(structural, commentFree, open, close) : [],
        extends: supertypes(head),
      });
      continue;
    }

    if (reExport) {
      const spec = specifier;
      if (reExport[3] !== undefined) {
        // `export { a, b as c }` — each name enters the surface under its exported name.
        for (const entry of reExport[3].split(",")) {
          const named = new RegExp(`(${IDENT})(?:\\s+as\\s+(${IDENT}))?`).exec(oneLine(entry));
          if (!named) continue;
          exports.push({
            name: named[2] ?? named[1],
            kind: "re-export",
            line,
            async: false,
            signature: reExportText,
            members: [],
            extends: [],
            ...(spec ? { from: spec } : {}),
          });
        }
      } else if (reExport[2] !== undefined) {
        exports.push({
          name: reExport[2],
          kind: "namespace",
          line,
          async: false,
          signature: reExportText,
          members: [],
          extends: [],
          ...(spec ? { from: spec } : {}),
        });
      } else if (spec) {
        // A bare `export * from` contributes no name of its own. It is recorded so a
        // lookup can say the surface is incomplete rather than say "absent".
        exports.push({
          name: "*",
          kind: "re-export",
          line,
          async: false,
          signature: reExportText,
          members: [],
          extends: [],
          from: spec,
        });
      }
    }
  }

  return { module: modulePath, exports };
}

/**
 * The signature a caller has to satisfy: for a function, the head through its return
 * type; for anything else, the declaration head.
 *
 * A function's parameters are the half of the surface a name lookup alone will not
 * give, and they are where `readonly OstNode[]` vs `OstNode[]` — the third captured
 * failure — actually lives, so they are kept verbatim rather than summarised.
 */
function signatureOf(
  kind: SymbolKind,
  commentFree: string,
  structural: string,
  start: number,
  declLength: number,
  head: string,
): string {
  if (kind !== "function") return head;
  const open = structural.indexOf("(", start + declLength - 1);
  if (open < 0) return head;
  let depth = 0;
  let close = -1;
  for (let i = open; i < structural.length; i++) {
    if (structural[i] === "(") depth++;
    else if (structural[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return head;
  const body = structural.indexOf("{", close);
  const semi = structural.indexOf(";", close);
  const end = body >= 0 && (semi < 0 || body < semi) ? body : semi >= 0 ? semi : close + 1;
  return oneLine(commentFree.slice(start, end));
}

/** Index every file handed in. Order is the caller's; nothing is sorted or deduped. */
export function buildSymbolIndex(files: readonly SourceFile[]): SymbolIndex {
  return { modules: files.map((f) => indexModule(f.path, f.source)) };
}

/**
 * Every TypeScript source under `root`, paths relative to it, sorted.
 *
 * Skips `node_modules`, build output and dotted directories, and skips `.d.ts` — a
 * declaration file re-states a surface that is already indexed from the source it was
 * generated from, and indexing both would report every export twice. Sorted so two runs
 * over the same tree produce the same briefing; an index that reorders between runs is
 * one a caller cannot diff.
 */
export function readProjectSources(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push({ path: path.relative(root, abs), source: fs.readFileSync(abs, "utf8") });
      }
    }
  };
  walk(root);
  return files;
}

// ── the two lookups the compiler answered too late ───────────────────────────

/** Where one exported name was found. */
export interface SymbolSite {
  module: string;
  kind: SymbolKind;
  line: number;
  signature: string;
}

/** The answer to "is this name exported anywhere in the project?" */
export interface NameLookup {
  name: string;
  /** True only when a declaration was actually seen. */
  present: boolean;
  sites: SymbolSite[];
  /** Near-miss exported names, nearest first — the `Did you mean …?` the compiler gives. */
  suggestions: string[];
}

/** The answer to "does this type carry this member?" */
export interface MemberLookup {
  type: string;
  member: string;
  /** True when a declaration of `type` was found at all. When false, `present` is meaningless. */
  typePresent: boolean;
  /** The module declaring `type`, or null. */
  module: string | null;
  /** True only when the member was seen on the type's own declaration. */
  present: boolean;
  /** Every member the type declares — what a run needed to see. */
  members: string[];
  /** Near-miss member names, nearest first. */
  suggestions: string[];
  /**
   * Supertypes whose members were not resolved. Non-empty means a `present: false` is
   * "not on its own declaration", not "not on the type" — the index refuses to report
   * an absence it cannot stand behind.
   */
  inheritedFrom: string[];
}

/** Levenshtein distance, iterative, two rows. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The near-misses for a name, nearest first.
 *
 * The cutoff is a third of the name's length (minimum two edits), which is the
 * neighbourhood a typo or a half-remembered name lands in and tight enough that an
 * unrelated export does not get volunteered. Ties break alphabetically so the output is
 * stable — a suggestion list that reorders between runs is a suggestion list a test
 * cannot pin.
 */
export function nearestNames(target: string, candidates: Iterable<string>, limit = 3): string[] {
  const cutoff = Math.max(2, Math.floor(target.length / 3));
  const scored: { name: string; d: number }[] = [];
  const seen = new Set<string>();
  for (const name of candidates) {
    if (name === target || seen.has(name)) continue;
    seen.add(name);
    const d = distance(target.toLowerCase(), name.toLowerCase());
    if (d <= cutoff) scored.push({ name, d });
  }
  scored.sort((x, y) => x.d - y.d || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  return scored.slice(0, limit).map((s) => s.name);
}

/** Is this name exported anywhere in the indexed project? */
export function lookupName(index: SymbolIndex, name: string): NameLookup {
  const sites: SymbolSite[] = [];
  const all: string[] = [];
  for (const mod of index.modules) {
    for (const sym of mod.exports) {
      if (sym.name === "*") continue;
      all.push(sym.name);
      if (sym.name === name) sites.push({ module: mod.module, kind: sym.kind, line: sym.line, signature: sym.signature });
    }
  }
  return {
    name,
    present: sites.length > 0,
    sites,
    suggestions: sites.length > 0 ? [] : nearestNames(name, all),
  };
}

/** Does this exported type carry this member? */
export function lookupMember(index: SymbolIndex, typeName: string, member: string): MemberLookup {
  for (const mod of index.modules) {
    for (const sym of mod.exports) {
      if (sym.name !== typeName || sym.members.length === 0) continue;
      const names = sym.members.map((m) => m.name);
      const hit = names.includes(member);
      return {
        type: typeName,
        member,
        typePresent: true,
        module: mod.module,
        present: hit,
        members: names,
        suggestions: hit ? [] : nearestNames(member, names),
        inheritedFrom: sym.extends,
      };
    }
  }
  // The type may still exist as an alias to a non-object type, which carries no member
  // list; that is reported as "type not found for member purposes", not as absence.
  return {
    type: typeName,
    member,
    typePresent: false,
    module: null,
    present: false,
    members: [],
    suggestions: [],
    inheritedFrom: [],
  };
}

// ── the briefing ─────────────────────────────────────────────────────────────

/**
 * The index as a run is handed it: one line per module, exported names in declaration
 * order, and each type's members inline.
 *
 * `maxChars` truncates rather than silently dropping — the trailing line names how many
 * modules did not fit, because a briefing that looks complete and is not would answer a
 * lookup wrongly, which is worse than the run knowing to go and read.
 */
export function formatSymbolBriefing(index: SymbolIndex, opts: { maxChars?: number } = {}): string {
  const lines: string[] = [];
  for (const mod of index.modules) {
    if (mod.exports.length === 0) continue;
    const parts = mod.exports.map((sym) => {
      if (sym.members.length === 0) return sym.name;
      const members = sym.members.map((m) => `${m.readonly ? "readonly " : ""}${m.name}${m.optional ? "?" : ""}`);
      return `${sym.name}{${members.join(" ")}}`;
    });
    lines.push(`${mod.module}: ${parts.join(" ")}`);
  }

  const max = opts.maxChars;
  if (max === undefined) return lines.join("\n");

  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > max) break;
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length < lines.length) kept.push(`… ${lines.length - kept.length} more module(s) not shown`);
  return kept.join("\n");
}

/** A name or member lookup rendered the way the compiler renders its own answer. */
export function formatNameLookup(lookup: NameLookup): string {
  if (lookup.present) {
    const at = lookup.sites.map((s) => `${s.module}:${s.line} (${s.kind}) ${s.signature}`);
    return [`${lookup.name}: exported`, ...at.map((a) => `  ${a}`)].join("\n");
  }
  const did = lookup.suggestions.length > 0 ? ` Did you mean ${lookup.suggestions.map((s) => `'${s}'`).join(" or ")}?` : "";
  return `${lookup.name}: NOT exported by any indexed module.${did}`;
}

/** A member lookup, including the caveat when the answer is incomplete. */
export function formatMemberLookup(lookup: MemberLookup): string {
  if (!lookup.typePresent) return `${lookup.type}: no indexed declaration carries a member list for this type.`;
  const where = `${lookup.type} (${lookup.module})`;
  if (lookup.present) return `${where} carries '${lookup.member}'.`;
  const did = lookup.suggestions.length > 0 ? ` Did you mean ${lookup.suggestions.map((s) => `'${s}'`).join(" or ")}?` : "";
  const caveat =
    lookup.inheritedFrom.length > 0 ? ` Inherited members from ${lookup.inheritedFrom.join(", ")} were not resolved.` : "";
  return `${where} does NOT declare '${lookup.member}'.${did} It declares: ${lookup.members.join(", ")}.${caveat}`;
}
