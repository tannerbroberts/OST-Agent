/**
 * The search-literality census: of the searches a pass actually issued over node
 * text, how many were literal lookups wearing a pattern language's clothes — and
 * did the argument come out of the tree or out of the caller's head?
 *
 * The question decides a design. A search entry point that takes text as data and
 * nothing else — no glob, no regex, no shell word-splitting — makes
 * `rg: error parsing glob '{Charge'` unavailable rather than survivable, because
 * there is no syntax left to malform. But it only covers the work if the work is
 * mostly literal. If passes routinely need real pattern semantics over node text,
 * a literal-only interface just moves those calls to an escape hatch and the
 * failures come back through it.
 *
 * So this module counts, over the record of searches that were issued. It sorts
 * every argument on two axes at once, because the parent assumption turns on
 * their interaction:
 *
 * - **Literality.** Would a literal lookup — or a finite set of them — have
 *   returned the same set? {@link classifyLiterality}.
 * - **Provenance.** Did the argument originate in the tree (a title, a phrase
 *   from a body) or was it written by hand? {@link classifyProvenance}.
 *
 * The cell that decides the design is tree-derived-and-pattern. If tree-derived
 * arguments are overwhelmingly literal while hand-written ones are freely
 * patterned, the interface should be drawn on provenance rather than on
 * literalness.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * "Expressible as a literal lookup" is a judgement, and a judgement made after
 * the count is a number that means nothing. {@link LITERALITY_RULE} is that
 * judgement written down in full — which characters count as syntax, how far an
 * alternation may be expanded, and how much text a match against the tree needs
 * before it is provenance rather than coincidence.
 *
 * Two of those calls are genuinely arguable, so the census does not ask to be
 * trusted on either. It publishes what each defensible reading would have said:
 *
 * - **How generous "literal" is** — {@link SearchLiteralityCensus.readings} takes
 *   the same count at four rungs, from single-literal-only up to the headline.
 * - **How much text makes an argument tree-derived** —
 *   {@link SearchLiteralityCensus.provenanceLadder} does the same for the match
 *   length.
 *
 * If a rung disagrees with the headline about the pre-committed bar,
 * {@link SearchLiteralityCensus.ruleDecides} is true and the report says so on
 * its face. A share that crosses the bar depending on where the reader draws
 * "literal" is not a fact about the searches.
 *
 * ## What a count out of this cannot settle
 *
 * It reads searches that were **issued**, not searches that were **wanted**. A
 * pass that avoided a pattern search because the last one failed is recorded as
 * never having needed one, which biases the census toward the answer the
 * literal-only interface wants. Nothing here can correct for that; it is stated
 * so a reader can discount it.
 *
 * And it is bounded by what survives. A search whose argument could not be read —
 * a shell pipeline this module refuses to guess at — is UNREAD, never "literal":
 * see {@link SearchLiteralityCensus.unread}, reported ahead of the share, because
 * a sweep that cannot read its subject must not report a clean result.
 */
import fs from "node:fs";
import path from "node:path";
import type { TranscriptSession } from "./preflight.js";

/**
 * Which language an argument was written in, and therefore what may malform it.
 *
 * `bre` is not pedantry. Plain `grep` reads basic regular expressions, where
 * `\|` is an alternation and a bare `|` is the pipe character — exactly the
 * reverse of every other dialect here. A census that read `5e5c119d\|8fc8d6e3`
 * as one literal would report a single lookup where the caller asked two
 * questions, and the strictest rung of the ladder is the rung that reading
 * moves.
 */
export type SearchLanguage = "regex" | "bre" | "glob" | "literal-flag";

/**
 * How close an argument is to a literal lookup.
 *
 * Ordered from most to least literal. The four rungs of
 * {@link SearchLiteralityCensus.readings} are prefixes of this order, so "how
 * generous is the reading" is the same question as "how far down this list does
 * literal-expressible reach".
 *
 * `malformed` sits inside the literal end on purpose: an argument that did not
 * compile never ran as a pattern at all. `{Charge` is the first seven characters
 * of a node title, and the only thing pattern semantics did for it was turn a
 * question into an error. Counting it as "needed patterns" would credit the
 * pattern language with the very call it destroyed.
 */
export type Literality = "literal" | "contains" | "union-of-literals" | "malformed" | "pattern";

/** Where an argument came from. The axis the design may end up being drawn on. */
export type Provenance = "tree" | "hand";

/** One search argument, lifted out of the record of a call that was issued. */
export interface SearchArgument {
  /** Transcript session id — with `entry`, how a reader goes and looks at it. */
  session: string;
  entry: number;
  /** The transcript's timestamp for the entry that issued the call. */
  ts: string;
  /** `Grep`, `Glob`, `Bash` — the tool that carried the argument. */
  tool: string;
  /** Which field of the call it was: `pattern`, `glob`, `--include`, … */
  field: string;
  language: SearchLanguage;
  /** The argument exactly as it was sent. */
  value: string;
  /** What was being searched, as the caller named it. */
  subject: string;
}

/** A search this module found but would not classify, and why. */
export interface UnreadSearch {
  session: string;
  entry: number;
  tool: string;
  /** The command or field that could not be read, clipped. */
  excerpt: string;
  /** Why it was not read — a shell construct this module refuses to guess at. */
  cause: "unparseable-shell" | "interpolated-argument" | "no-argument-recorded";
}

/** One argument, classified on both axes, with the evidence for each. */
export interface ClassifiedArgument extends SearchArgument {
  literality: Literality;
  /** The literal strings a literal-only interface would have had to look up. */
  literals: string[];
  /** Why it was not literal, when it was not. Empty otherwise. */
  reason: string;
  provenance: Provenance;
  /** The tree text a literal run of this argument matched, when it did. */
  matched?: string;
}

/** The fourfold table the assumption turns on. */
export interface LiteralityCells {
  treeLiteral: number;
  treePattern: number;
  handLiteral: number;
  handPattern: number;
}

/** The same count taken under a different reading of "literal". */
export interface LiteralityReading {
  /** What the rung admits, in the reader's words. */
  name: string;
  classes: Literality[];
  treeDerived: number;
  treeLiteral: number;
  /** treeLiteral / treeDerived, or null when nothing was tree-derived. */
  share: number | null;
  meetsBar: boolean;
}

/** The same count taken with a different threshold for "came from the tree". */
export interface ProvenanceReading {
  minMatchChars: number;
  treeDerived: number;
  treeLiteral: number;
  share: number | null;
  meetsBar: boolean;
}

export interface SearchLiteralityCensus {
  /** Sessions offered to the reader — the corpus, before scope. */
  sessionsRead: number;
  /** Search calls over node text found in them. */
  calls: number;
  /** Arguments lifted out of those calls. One call may carry two. */
  args: number;
  /** Searches found and not classified. Counted neither way, reported first. */
  unread: UnreadSearch[];
  cells: LiteralityCells;
  /** Arguments whose literal content came out of the tree. The denominator. */
  treeDerived: number;
  /** Of those, how many a literal-only interface would have covered. */
  treeLiteral: number;
  /** treeLiteral / treeDerived under the headline reading, null when empty. */
  share: number | null;
  /** The pre-committed bar, carried in the result so a reader need not look it up. */
  bar: number;
  meetsBar: boolean;
  /** How the count moves with how generous "literal" is. */
  readings: LiteralityReading[];
  /** How the count moves with how much text makes an argument tree-derived. */
  provenanceLadder: ProvenanceReading[];
  /**
   * True when some rung of either ladder disagrees with the headline about the
   * bar. The share is then a property of the rule rather than of the searches,
   * and the report says so instead of standing on its own number.
   */
  ruleDecides: boolean;
  /** Every classified argument, in the order the calls were issued. */
  classified: ClassifiedArgument[];
  /** How many arguments fell in each literality class, headline reading. */
  byLiterality: Record<Literality, number>;
}

/**
 * The classifier, fixed in source before the corpus was counted.
 *
 * Exported so a test can assert against it and a reader can disagree with it by
 * name rather than by suspicion. Changing a value here changes the finding, which
 * is why it is one object and not constants scattered through the reader.
 */
export const LITERALITY_RULE = {
  /**
   * The pre-committed bar: at least this share of tree-derived arguments must be
   * expressible as literal lookups for a literal-only interface to cover the work.
   */
  bar: 0.9,

  /**
   * Tools whose calls are searches over text, and the fields that carry an
   * argument. `Bash` is handled separately — a shell command is not a field.
   */
  searchTools: {
    Grep: [
      { field: "pattern", language: "regex" },
      { field: "glob", language: "glob" },
    ],
    Glob: [{ field: "pattern", language: "glob" }],
  },

  /**
   * Shell commands that are searches. `ls` is here because `ls | grep -i quoter`
   * is how this project searches node *titles* from a shell, and the title is the
   * text most likely to carry the brace that breaks the call.
   */
  searchCommands: ["rg", "grep", "egrep", "fgrep", "ls", "find"],

  /**
   * Flags that consume the next word, so a pattern is never confused with a
   * flag's value. `-e` and `-g`/`--glob`/`--include` also *carry* arguments the
   * census wants, and are picked up as their own fields.
   */
  valueFlags: [
    "-e",
    "--regexp",
    "-g",
    "--glob",
    "--include",
    "--exclude",
    "-t",
    "--type",
    "-m",
    "--max-count",
    "-A",
    "-B",
    "-C",
    "--context",
    "-name",
    "-iname",
    "-path",
    "--path",
  ],

  /**
   * Flags that declare the argument is a literal. A caller that wrote `-F` had
   * already asked for the interface this census exists to size, in the one
   * language that offered it.
   */
  literalFlags: ["-F", "--fixed-strings"],

  /**
   * How many literal strings an alternation may expand to before it stops being
   * "a few literal lookups" and becomes a pattern.
   *
   * 64 is above every alternation in this corpus (the widest is thirteen node
   * titles) and far below the point where looping a literal interface over the
   * branches would be an absurd way to ask the question.
   */
  expansionCap: 64,

  /**
   * How much text a literal run must share with tree text before the argument is
   * called tree-derived.
   *
   * Sixteen characters is long enough that `Opportunity` — a word that appears in
   * node text and in every frontmatter block, and that a caller types from
   * knowledge of the schema rather than by copying — does not make an argument
   * tree-derived, and short enough that a quoted title fragment does.
   */
  minMatchChars: 16,

  /**
   * Other lengths the same count is taken at, reported beside the headline.
   * There is no principled threshold, so the census publishes what each one would
   * have said. See {@link SearchLiteralityCensus.provenanceLadder}.
   */
  provenanceLadder: [8, 12, 16, 24],

  /**
   * The readings of "literal", from strictest to the headline. Each rung admits
   * everything the rung before it did, so the ladder is monotone and a reader can
   * see exactly which judgement moved the share.
   */
  readings: [
    { name: "one literal lookup only", classes: ["literal"] },
    { name: "+ a literal with wildcards only at its ends", classes: ["literal", "contains"] },
    { name: "+ an alternation of literals", classes: ["literal", "contains", "union-of-literals"] },
    {
      name: "+ an argument that never compiled (headline)",
      classes: ["literal", "contains", "union-of-literals", "malformed"],
    },
  ],
} as const;

/** The headline reading is the last rung: everything except a real pattern. */
const HEADLINE_CLASSES: readonly Literality[] = LITERALITY_RULE.readings[LITERALITY_RULE.readings.length - 1].classes;

const MAX_EXCERPT_CHARS = 160;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_EXCERPT_CHARS ? `${flat.slice(0, MAX_EXCERPT_CHARS)}…` : flat;
}

// ── literality ───────────────────────────────────────────────────────────────

/**
 * Expand a regular expression into the finite set of strings it matches, or
 * `null` when it needs pattern semantics no set of literals reproduces.
 *
 * Only two constructs survive expansion: an escaped metacharacter, which is a
 * literal wearing a backslash, and an alternation, which is several literals
 * wearing a group. Everything else — a quantifier, a class, a wildcard, an
 * anchor, a lookaround, a backreference — makes the matched set infinite or
 * position-dependent, and a literal lookup cannot stand in for it.
 */
export function expandRegex(pattern: string): string[] | null {
  let i = 0;

  function branches(depth: number): string[] | null {
    const alternatives: string[][] = [];
    let current: string[] = [""];

    const push = (text: string) => {
      current = current.map((c) => c + text);
    };

    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === ")") {
        if (depth === 0) return null; // unbalanced — `new RegExp` would have refused
        break;
      }
      if (ch === "|") {
        i++;
        alternatives.push(current);
        current = [""];
        continue;
      }
      if (ch === "\\") {
        const next = pattern[i + 1];
        // `\d`, `\b`, `\w`, `\1` and friends are classes and assertions, not text.
        if (next === undefined || /[A-Za-z0-9]/.test(next)) return null;
        push(next);
        i += 2;
        continue;
      }
      if (ch === "(") {
        // A capturing or non-capturing group is a set of literals. A lookaround
        // is an assertion about position and never expands.
        const isGroup = pattern.startsWith("(?:", i) || !pattern.startsWith("(?", i);
        if (!isGroup) return null;
        i += pattern.startsWith("(?:", i) ? 3 : 1;
        const inner = branches(depth + 1);
        if (inner === null) return null;
        if (pattern[i] !== ")") return null;
        i++;
        // A quantified group repeats, and a repeat is not a finite literal set.
        if (i < pattern.length && "*+?{".includes(pattern[i])) return null;
        const combined: string[] = [];
        for (const prefix of current) {
          for (const suffix of inner) combined.push(prefix + suffix);
        }
        if (combined.length > LITERALITY_RULE.expansionCap) return null;
        current = combined;
        continue;
      }
      if ("[]{}.*+?^$".includes(ch)) return null;
      push(ch);
      i++;
    }

    alternatives.push(current);
    const all = alternatives.flat();
    return all.length > LITERALITY_RULE.expansionCap ? null : all;
  }

  const expanded = branches(0);
  if (expanded === null || i !== pattern.length) return null;
  return expanded;
}

/**
 * Rewrite a basic regular expression into the extended syntax the expander reads.
 *
 * The two dialects differ only in which side of the backslash the operator is on:
 * in BRE, `\|`, `\(`, `\)`, `\{`, `\}`, `\+` and `\?` are operators and the bare
 * characters are text. Swapping them is the whole translation — `.`, `*`, `[`,
 * `^` and `$` mean the same thing in both.
 */
export function breToRegex(pattern: string): string {
  const swappable = "|(){}+?";
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) {
        out += "\\\\";
        break;
      }
      out += swappable.includes(next) ? next : `\\${next}`;
      i++;
      continue;
    }
    out += swappable.includes(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/** The characters ripgrep's glob parser reads as syntax rather than as themselves. */
const GLOB_SYNTAX = "*?[]{}";

/**
 * Whether a glob compiles at all.
 *
 * This is the check the two recorded failures failed: `{Charge` and `*{threshold`
 * open an alternate group that nothing closes, and ripgrep refuses the search
 * rather than running it. A refusal is not a pattern need — see
 * {@link Literality}.
 */
export function globCompiles(glob: string): boolean {
  let brace = false;
  let bracket = false;
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (bracket) {
      if (ch === "]") bracket = false;
      continue;
    }
    if (ch === "[") bracket = true;
    else if (ch === "{") {
      if (brace) return false; // ripgrep does not nest alternate groups
      brace = true;
    } else if (ch === "}") {
      if (!brace) return false;
      brace = false;
    }
  }
  return !brace && !bracket;
}

/**
 * Strip the parts of a glob that name the corpus rather than ask a question.
 *
 * `**​/` is "anywhere under here" and `/**` is "everything below": both say where
 * to look, not what to look for, and a search interface has that as a parameter
 * rather than as syntax. A trailing `.md` is the same thing once — as here — every
 * node in the vault is a `.md` file: it selects nothing, so leaving it in would
 * make a title lookup read as a pattern because of the file extension the vault
 * happens to use. Recorded rather than folded in silently, because it is the
 * assumption most specific to this corpus.
 */
export function globQuestion(glob: string): string {
  const scoped = glob.replace(/^\*\*\//, "").replace(/\/\*\*$/, "");
  return scoped.endsWith(".md") ? scoped.slice(0, -".md".length) : scoped;
}

/**
 * A glob that is one literal run with wildcards only at its ends — `*a title*` —
 * asks "which names contain this text", which is the question a literal-only
 * interface answers. Returns the literal core, or `null` when the wildcards are
 * load-bearing somewhere in the middle.
 *
 * An all-wildcard glob returns `""`: it selects the whole corpus and asks nothing,
 * so it needs no pattern language either.
 */
function containsCore(glob: string): string | null {
  const core = glob.replace(/^\*+/, "").replace(/\*+$/, "");
  if (core.split("").some((c) => GLOB_SYNTAX.includes(c))) return null;
  if (core === glob && core !== "") return null; // no wildcards at the ends: not this shape
  // A core of nothing but separators — `*/*` — asks about the shape of the path,
  // not about any text in it, and no literal lookup answers that.
  if (core && !/[^/]/.test(core)) return null;
  return core;
}

/**
 * Expand `{a,b}` groups into the literal lookups they stand for; `null` when the
 * glob needs real matching.
 *
 * A branch may itself be contains-shaped (`{A title*,Another title*}` is how this
 * project asks for several nodes at once), so the branches are run through
 * {@link containsCore}. That makes the union rung strictly above the contains
 * rung in {@link LITERALITY_RULE.readings}, which is why it is admitted later.
 */
function expandGlob(glob: string): string[] | null {
  /** A branch is a literal, or a literal with wildcards at its ends. */
  const branchCore = (part: string): string | null =>
    part.split("").some((c) => GLOB_SYNTAX.includes(c)) ? containsCore(part) : part;

  const open = glob.indexOf("{");
  if (open === -1) {
    const core = branchCore(glob);
    return core === null ? null : [core];
  }
  const close = glob.indexOf("}", open);
  if (close === -1) return null;
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  if (/[?[\]]/.test(head) || /[?[\]]/.test(tail)) return null;
  const parts = glob.slice(open + 1, close).split(",");
  const rest = expandGlob(tail);
  if (rest === null) return null;
  const out: string[] = [];
  for (const part of parts) {
    if (/[?[\]{}]/.test(part)) return null;
    const core = branchCore(part);
    if (core === null) return null;
    for (const suffix of rest) out.push(head.replace(/\*+$/, "") + core + suffix);
  }
  return out.length > LITERALITY_RULE.expansionCap ? null : out;
}

/** The literal runs in an argument — the text between whatever the syntax is. */
export function literalRuns(value: string, language: SearchLanguage): string[] {
  if (language === "literal-flag") return value ? [value] : [];
  if (language === "bre") return literalRuns(breToRegex(value), "regex");
  const syntax = language === "regex" ? /[\\^$.|?*+()[\]{}]/ : /[*?[\]{},]/;
  const runs: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (language === "regex" && ch === "\\" && i + 1 < value.length && !/[A-Za-z0-9]/.test(value[i + 1])) {
      current += value[i + 1]; // an escaped metacharacter is text
      i++;
      continue;
    }
    if (syntax.test(ch)) {
      if (current) runs.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) runs.push(current);
  return runs;
}

/** How literal one argument is, and the literal lookups that would replace it. */
export function classifyLiterality(
  value: string,
  language: SearchLanguage,
): { literality: Literality; literals: string[]; reason: string } {
  if (language === "literal-flag") {
    return { literality: "literal", literals: [value], reason: "" };
  }

  if (language === "regex" || language === "bre") {
    const source = language === "bre" ? breToRegex(value) : value;
    try {
      new RegExp(source);
    } catch (err) {
      return { literality: "malformed", literals: [value], reason: `regex did not compile: ${String(err)}` };
    }
    const expanded = expandRegex(source);
    if (expanded === null) {
      return { literality: "pattern", literals: literalRuns(source, "regex"), reason: "needs regex semantics" };
    }
    if (expanded.length === 1) return { literality: "literal", literals: expanded, reason: "" };
    return { literality: "union-of-literals", literals: expanded, reason: `${expanded.length} literal branches` };
  }

  if (!globCompiles(value)) {
    return { literality: "malformed", literals: literalRuns(value, language), reason: "glob did not compile" };
  }
  const question = globQuestion(value);
  if (!question.split("").some((c) => GLOB_SYNTAX.includes(c))) {
    return { literality: "literal", literals: [question], reason: "" };
  }
  const expanded = expandGlob(question);
  if (expanded === null) {
    return { literality: "pattern", literals: literalRuns(value, language), reason: "needs glob semantics" };
  }
  if (expanded.length === 1) {
    return {
      literality: "contains",
      literals: expanded,
      reason: expanded[0] ? "wildcards only at the ends" : "selects the whole corpus and asks nothing",
    };
  }
  return { literality: "union-of-literals", literals: expanded, reason: `${expanded.length} literal branches` };
}

// ── provenance ───────────────────────────────────────────────────────────────

/** Curly and straight apostrophes are the same character in a title a person typed. */
function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Did this argument's text come out of the tree?
 *
 * The test is containment in either direction against known tree text, over a
 * literal run long enough that the match is provenance and not coincidence. An
 * argument the caller composed out of schema knowledge — `^type: Opportunity`,
 * `^instrument:` — shares no such run with a title, which is the distinction the
 * whole design question rests on.
 */
export function classifyProvenance(
  literals: readonly string[],
  treeText: readonly string[],
  minMatchChars: number,
): { provenance: Provenance; matched?: string } {
  const normalized = treeText.map(normalize);
  for (const literal of literals) {
    const run = normalize(literal);
    if (run.length < minMatchChars) continue;
    for (let i = 0; i < normalized.length; i++) {
      const text = normalized[i];
      if (text.includes(run) || (text.length >= minMatchChars && run.includes(text))) {
        return { provenance: "tree", matched: treeText[i] };
      }
    }
  }
  return { provenance: "hand" };
}

// ── reading the searches out of the record ───────────────────────────────────

/** The unquoted operators that end one command and begin another. */
const SHELL_OPERATORS = ["||", "&&", "|", ";", "&", "\n", ">>", ">", "<"];

/**
 * Split a shell command into words, or refuse it. Quoting is preserved as data,
 * and an operator is its own word whether or not spaces were typed around it —
 * `ls|grep x` is two commands, and a reader that missed that would hand `grep`'s
 * flags to `ls`.
 */
function shellWords(command: string): { words: string[]; quoted: boolean[] } | null {
  const words: string[] = [];
  const quoted: boolean[] = [];
  let current = "";
  let started = false;
  let wasQuoted = false;
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (!started) return;
    words.push(current);
    quoted.push(wasQuoted);
    current = "";
    started = false;
    wasQuoted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      // Inside double quotes a backslash escapes only these four; before anything
      // else it is a backslash, and `"\|"` reaching grep as `\|` is the difference
      // between an alternation and a literal pipe.
      if (ch === "\\" && quote === '"' && '$`"\\'.includes(command[i + 1] ?? "")) {
        current += command[++i];
        started = true;
        continue;
      }
      current += ch;
      started = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      wasQuoted = true;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      current += command[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch) && ch !== "\n") {
      flush();
      continue;
    }
    const operator = SHELL_OPERATORS.find((op) => command.startsWith(op, i));
    if (operator) {
      flush();
      words.push(operator);
      quoted.push(false);
      i += operator.length - 1;
      continue;
    }
    current += ch;
    started = true;
  }
  if (quote) return null; // unbalanced quoting: this module will not guess
  flush();
  return { words, quoted };
}

/** Commands whose text this module refuses to read as a fixed argument. */
const SHELL_UNREADABLE = /\$\(|`|\$\{|<\(/;

interface ShellSearch {
  /** The words of one `rg`/`grep`/`ls`/`find` invocation, without the command name. */
  argv: string[];
  command: string;
  /**
   * The dialect this invocation's pattern is in: `bre` for plain `grep`, `regex`
   * for `rg`, `egrep` and `grep -E`/`-P`, `literal-flag` when the caller said `-F`.
   */
  dialect: SearchLanguage;
  /**
   * The directory this invocation ran in — the entry's own, or wherever a `cd`
   * earlier in the same command line moved it.
   *
   * Load-bearing for scope, not decoration. A pass whose session sits in the
   * vault routinely writes `cd <repo> && grep -rn "compileGlob" src`, and a reader
   * that took the session's directory for the subject would count a search over
   * TypeScript as a search over node text. That mistake inflates the hand-written
   * cells with source-code patterns and quietly reframes what the census is about.
   */
  cwd: string;
}

/** Split a command line into the search invocations inside it. */
function shellSearches(command: string, cwd: string): ShellSearch[] | null {
  if (SHELL_UNREADABLE.test(command)) return null;
  const parsed = shellWords(command);
  if (!parsed) return null;

  const searches: ShellSearch[] = [];
  let argv: string[] | null = null;
  let name = "";
  let here = cwd;
  let segmentStart = true;
  const flush = () => {
    if (argv) searches.push({ argv, command: name, dialect: dialectOf(name, argv), cwd: here });
    argv = null;
    name = "";
  };

  for (let i = 0; i < parsed.words.length; i++) {
    const word = parsed.words[i];
    if (!parsed.quoted[i] && (SHELL_OPERATORS.includes(word) || ["(", ")", "{", "}"].includes(word))) {
      flush();
      segmentStart = true;
      continue;
    }
    if (argv) {
      argv.push(word);
      segmentStart = false;
      continue;
    }
    if (segmentStart && word === "cd") {
      const target = parsed.words[i + 1];
      // A bare `cd` goes home and a `cd -` goes back; neither is a directory this
      // reader can follow, so the search after it is left where it was.
      if (target && !SHELL_OPERATORS.includes(target) && target !== "-") {
        here = path.isAbsolute(target) ? target : path.resolve(here, target);
        i++;
      }
      segmentStart = false;
      continue;
    }
    const base = word.split("/").pop() ?? word;
    if (!parsed.quoted[i] && (LITERALITY_RULE.searchCommands as readonly string[]).includes(base)) {
      argv = [];
      name = base;
    }
    segmentStart = false;
  }
  flush();
  return searches;
}

function hasShortFlag(word: string, letter: string): boolean {
  if (word === `-${letter}`) return true;
  // Bundled short flags: `-rF`, `-nE`.
  return /^-[A-Za-z]+$/.test(word) && !word.startsWith("--") && word.includes(letter);
}

/** Which dialect one invocation's pattern is in. See {@link SearchLanguage}. */
function dialectOf(command: string, argv: readonly string[]): SearchLanguage {
  const literal =
    command === "fgrep" ||
    argv.some((w) => (LITERALITY_RULE.literalFlags as readonly string[]).includes(w) || hasShortFlag(w, "F"));
  if (literal) return "literal-flag";
  if (command === "grep" && !argv.some((w) => hasShortFlag(w, "E") || hasShortFlag(w, "P") || w === "--extended-regexp")) {
    return "bre";
  }
  return "regex";
}

function takesValue(word: string): boolean {
  return (LITERALITY_RULE.valueFlags as readonly string[]).includes(word);
}

/**
 * What a shell search asked for: the pattern, any glob filters, and the paths it
 * was pointed at.
 *
 * `ls` and `find` carry no pattern of their own — `ls | grep …` puts the question
 * in the grep, and `find -name X` puts it in a flag — so only their flag
 * arguments are lifted. The operands are returned because they are what says
 * whether this search was over node text at all.
 */
function shellArguments(
  search: ShellSearch,
): { args: { field: string; language: SearchLanguage; value: string }[]; operands: string[] } | null {
  const out: { field: string; language: SearchLanguage; value: string }[] = [];
  const operands: string[] = [];
  let pattern: string | undefined;
  let sawExplicitPattern = false;

  for (let i = 0; i < search.argv.length; i++) {
    const word = search.argv[i];
    if (word === "-e" || word === "--regexp") {
      const value = search.argv[++i];
      if (value === undefined) return null;
      out.push({ field: "-e", language: search.dialect, value });
      sawExplicitPattern = true;
      continue;
    }
    if (word === "-g" || word === "--glob" || word === "-name" || word === "-iname" || word === "-path") {
      const value = search.argv[++i];
      if (value === undefined) return null;
      out.push({ field: word, language: "glob", value });
      continue;
    }
    if (word.startsWith("--include=") || word.startsWith("--exclude=") || word.startsWith("--glob=")) {
      out.push({ field: word.slice(0, word.indexOf("=")), language: "glob", value: word.slice(word.indexOf("=") + 1) });
      continue;
    }
    if (word === "--include" || word === "--exclude") {
      const value = search.argv[++i];
      if (value === undefined) return null;
      out.push({ field: word, language: "glob", value });
      continue;
    }
    if (takesValue(word)) {
      i++;
      continue;
    }
    if (word.startsWith("-") && word !== "-") continue;
    if (pattern === undefined && !sawExplicitPattern && search.command !== "ls" && search.command !== "find") {
      pattern = word;
      continue;
    }
    operands.push(word);
  }

  if (pattern !== undefined) {
    out.unshift({ field: "pattern", language: search.dialect, value: pattern });
  }
  return { args: out, operands };
}

/** Where a call was searching, resolved against the entry's working directory. */
function subjectOf(input: Record<string, unknown>, cwd: string): string {
  const target = typeof input.path === "string" ? input.path : "";
  if (!target) return cwd;
  return path.isAbsolute(target) ? target : path.resolve(cwd, target);
}

/**
 * Whether a subject is node text.
 *
 * The vault itself, obviously. Also a tool-result file holding the output of an
 * `ost_` tool: a pass that greps a dumped tree is searching node text through a
 * file, and the arguments it uses there are the same arguments it would send to a
 * search interface. Source files under the code repository are not node text and
 * are out of scope — the assumption is about searches over the tree.
 */
function isNodeText(subject: string, vaultDir: string): boolean {
  const vault = path.resolve(vaultDir);
  if (subject === vault || subject.startsWith(`${vault}${path.sep}`)) return true;
  return /tool-results\/.*ost[-_]/.test(subject);
}

export interface ReadSearchesOptions {
  /** The vault whose node text is in scope. */
  vaultDir: string;
}

/** Every search over node text in a corpus of transcripts, plus what it could not read. */
export function readSearchArguments(
  sessions: readonly TranscriptSession[],
  options: ReadSearchesOptions,
): { args: SearchArgument[]; unread: UnreadSearch[]; calls: number } {
  const args: SearchArgument[] = [];
  const unread: UnreadSearch[] = [];
  let calls = 0;

  for (const session of sessions) {
    let entryIndex = -1;
    for (const line of session.jsonl.split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      entryIndex++;
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      const cwd = typeof parsed.cwd === "string" ? parsed.cwd : options.vaultDir;
      const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";

      for (const block of content as Record<string, unknown>[]) {
        if (block.type !== "tool_use") continue;
        const tool = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        const base = { session: session.id, entry: entryIndex, ts, tool };

        if (tool === "Grep" || tool === "Glob") {
          const subject = tool === "Glob" && typeof input.pattern === "string" && path.isAbsolute(input.pattern)
            ? path.dirname(input.pattern)
            : subjectOf(input, cwd);
          if (!isNodeText(subject, options.vaultDir)) continue;
          calls++;
          const fields = LITERALITY_RULE.searchTools[tool];
          let lifted = 0;
          for (const { field, language } of fields) {
            const value = input[field];
            if (typeof value !== "string" || !value) continue;
            lifted++;
            args.push({ ...base, field, language: language as SearchLanguage, value, subject });
          }
          if (!lifted) unread.push({ ...base, excerpt: clip(JSON.stringify(input)), cause: "no-argument-recorded" });
          continue;
        }

        if (tool !== "Bash") continue;
        const command = typeof input.command === "string" ? input.command : "";
        if (!command) continue;
        // Cheap reject first: most Bash calls are not searches at all.
        if (!LITERALITY_RULE.searchCommands.some((c) => new RegExp(`(^|[|&;( ])${c}\\b`).test(command))) continue;
        // …and a command that can reach neither the vault from where it stands nor
        // by naming it is not a search over node text however it is written.
        if (!isNodeText(cwd, options.vaultDir) && !command.includes(path.resolve(options.vaultDir))) continue;

        const searches = shellSearches(command, cwd);
        if (searches === null) {
          calls++;
          unread.push({ ...base, excerpt: clip(command), cause: "unparseable-shell" });
          continue;
        }
        for (const search of searches) {
          const lifted = shellArguments(search);
          if (lifted === null) {
            calls++;
            unread.push({ ...base, excerpt: clip(command), cause: "unparseable-shell" });
            continue;
          }
          if (!lifted.args.length) continue; // `ls` with no filter asks nothing
          // Where this invocation actually looked: what it was pointed at, or the
          // directory it stood in when it was pointed at nothing.
          const subjects = lifted.operands.length
            ? lifted.operands.map((o) => (path.isAbsolute(o) ? o : path.resolve(search.cwd, o)))
            : [search.cwd];
          if (!subjects.some((s) => isNodeText(s, options.vaultDir))) continue;
          calls++;
          for (const arg of lifted.args) {
            args.push({
              ...base,
              field: `${search.command} ${arg.field}`,
              language: arg.language,
              value: arg.value,
              subject: subjects.find((s) => isNodeText(s, options.vaultDir)) ?? search.cwd,
            });
          }
        }
      }
    }
  }

  return { args, unread, calls };
}

// ── the census ───────────────────────────────────────────────────────────────

function shareOf(literal: number, derived: number): number | null {
  return derived ? literal / derived : null;
}

/**
 * Take the census: every search argument in `args`, sorted on both axes against
 * `treeText`.
 *
 * Both inputs are passed in rather than read from disk, so the reading is
 * testable against a committed corpus offline — which is the only way this number
 * is the same number next year.
 */
export function searchLiteralityCensus(
  args: readonly SearchArgument[],
  treeText: readonly string[],
  extra: { sessionsRead: number; calls: number; unread: readonly UnreadSearch[] },
): SearchLiteralityCensus {
  const classified: ClassifiedArgument[] = args.map((arg) => {
    const { literality, literals, reason } = classifyLiterality(arg.value, arg.language);
    // Provenance is read off the literal runs whatever the literality, because a
    // pattern built around a quoted title is still an argument that came from the
    // tree — and that cell is the one the design turns on.
    const runs = literals.length ? literals : literalRuns(arg.value, arg.language);
    const { provenance, matched } = classifyProvenance(runs, treeText, LITERALITY_RULE.minMatchChars);
    return { ...arg, literality, literals, reason, provenance, matched };
  });

  const isLiteral = (c: ClassifiedArgument, classes: readonly Literality[]) => classes.includes(c.literality);
  const tree = classified.filter((c) => c.provenance === "tree");
  const hand = classified.filter((c) => c.provenance === "hand");
  const treeLiteral = tree.filter((c) => isLiteral(c, HEADLINE_CLASSES)).length;

  const readings: LiteralityReading[] = LITERALITY_RULE.readings.map((reading) => {
    const literal = tree.filter((c) => isLiteral(c, reading.classes)).length;
    const share = shareOf(literal, tree.length);
    return {
      name: reading.name,
      classes: [...reading.classes],
      treeDerived: tree.length,
      treeLiteral: literal,
      share,
      meetsBar: share !== null && share >= LITERALITY_RULE.bar,
    };
  });

  const provenanceLadder: ProvenanceReading[] = LITERALITY_RULE.provenanceLadder.map((minMatchChars) => {
    const rung = classified.filter((c) => {
      const runs = c.literals.length ? c.literals : literalRuns(c.value, c.language);
      return classifyProvenance(runs, treeText, minMatchChars).provenance === "tree";
    });
    const literal = rung.filter((c) => isLiteral(c, HEADLINE_CLASSES)).length;
    const share = shareOf(literal, rung.length);
    return {
      minMatchChars,
      treeDerived: rung.length,
      treeLiteral: literal,
      share,
      meetsBar: share !== null && share >= LITERALITY_RULE.bar,
    };
  });

  const byLiterality: Record<Literality, number> = {
    literal: 0,
    contains: 0,
    "union-of-literals": 0,
    malformed: 0,
    pattern: 0,
  };
  for (const c of classified) byLiterality[c.literality]++;

  const share = shareOf(treeLiteral, tree.length);
  const meetsBar = share !== null && share >= LITERALITY_RULE.bar;
  const verdicts = new Set([...readings.map((r) => r.meetsBar), ...provenanceLadder.map((r) => r.meetsBar)]);

  return {
    sessionsRead: extra.sessionsRead,
    calls: extra.calls,
    args: args.length,
    unread: [...extra.unread],
    cells: {
      treeLiteral,
      treePattern: tree.length - treeLiteral,
      handLiteral: hand.filter((c) => isLiteral(c, HEADLINE_CLASSES)).length,
      handPattern: hand.filter((c) => !isLiteral(c, HEADLINE_CLASSES)).length,
    },
    treeDerived: tree.length,
    treeLiteral,
    share,
    bar: LITERALITY_RULE.bar,
    meetsBar,
    readings,
    provenanceLadder,
    ruleDecides: verdicts.size > 1,
    classified,
    byLiterality,
  };
}

/** Read a vault's node titles — the tree text an argument may have been copied from. */
export function readTreeTitles(vaultDir: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(vaultDir);
  } catch {
    return [];
  }
  return names.filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, "")).sort();
}

function pct(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: coverage first, then the four cells, then
 * the ladders, and only then a verdict against the bar.
 *
 * Coverage leads because it is the number most likely to invalidate the other
 * ones, and the ladders lead the verdict because a share that crosses the bar
 * only under the reading its author chose is not a finding.
 */
export function formatSearchLiteralityCensus(census: SearchLiteralityCensus): string {
  const lines: string[] = [];

  if (census.args === 0) {
    lines.push(
      `Search literality: UNREAD — ${census.calls} search(es) over node text found, and not one ` +
        `argument could be read from them.`,
    );
  } else {
    lines.push(
      `Search literality: ${census.treeLiteral} of ${census.treeDerived} tree-derived argument(s) ` +
        `(${pct(census.share)}) are expressible as literal lookups; the bar is ${pct(census.bar)}.`,
    );
  }
  lines.push(
    `  Coverage: ${census.args} argument(s) from ${census.calls} search(es) over ${census.sessionsRead} session(s); ` +
      `${census.unread.length} search(es) could not be read and are counted neither way.`,
  );
  lines.push(
    `  Cells: tree×literal ${census.cells.treeLiteral}, tree×pattern ${census.cells.treePattern}, ` +
      `hand×literal ${census.cells.handLiteral}, hand×pattern ${census.cells.handPattern}.`,
  );
  lines.push(
    `  Classes: literal ${census.byLiterality.literal}, contains ${census.byLiterality.contains}, ` +
      `union ${census.byLiterality["union-of-literals"]}, malformed ${census.byLiterality.malformed}, ` +
      `pattern ${census.byLiterality.pattern}.`,
  );

  lines.push("");
  lines.push("  How literal counts, rung by rung:");
  for (const reading of census.readings) {
    lines.push(
      `    ${reading.treeLiteral}/${reading.treeDerived} (${pct(reading.share)}) ${reading.meetsBar ? "meets" : "MISSES"} ` +
        `the bar — ${reading.name}`,
    );
  }
  lines.push("  How much text makes an argument tree-derived:");
  for (const rung of census.provenanceLadder) {
    lines.push(
      `    ≥${rung.minMatchChars} chars: ${rung.treeLiteral}/${rung.treeDerived} (${pct(rung.share)}) ` +
        `${rung.meetsBar ? "meets" : "MISSES"} the bar`,
    );
  }
  lines.push(
    census.ruleDecides
      ? `  Rule: THE RULE DECIDES THIS. The rungs above do not agree about the ${pct(census.bar)} bar, so the ` +
          `verdict is as much a property of where "literal" was drawn as of the searches.`
      : `  Rule: stable — every rung above reaches the same verdict against the ${pct(census.bar)} bar.`,
  );

  const treePatterns = census.classified.filter((c) => c.provenance === "tree" && c.literality === "pattern");
  lines.push("");
  lines.push(`Tree-derived arguments that need real pattern semantics (${treePatterns.length}) — the deciding cell:`);
  if (!treePatterns.length) lines.push("  (none)");
  for (const c of treePatterns) {
    lines.push(`  ${c.tool} ${c.field} [${c.language}] ${clip(c.value)}`);
    lines.push(`      matched tree text: ${clip(c.matched ?? "")}`);
  }

  if (census.unread.length) {
    lines.push("");
    lines.push(`Unread — searches whose argument this census would not guess at (${census.unread.length}):`);
    const byCause = new Map<string, number>();
    for (const u of census.unread) byCause.set(u.cause, (byCause.get(u.cause) ?? 0) + 1);
    for (const [cause, n] of [...byCause.entries()].sort((a, b) => b[1] - a[1])) lines.push(`  ${cause} ×${n}`);
  }

  lines.push("");
  lines.push(
    "What this does not settle: it counts searches that were ISSUED, not searches that were WANTED. " +
      "A pass that avoided a pattern search because the last one failed is recorded here as never having " +
      "needed one, which biases the count toward the interface this census exists to size. It also covers " +
      "only searches over node text; a path globbed by a shell or a flag read as a filename is outside it.",
  );
  return lines.join("\n");
}
