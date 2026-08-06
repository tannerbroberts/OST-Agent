/**
 * Text that came out of the tree, carried so that it cannot reach a command as a
 * bare string. There is no unquoted form: every route out names a destination.
 *
 * **The failure this exists to stop.** `rg: error parsing glob '{Charge':
 * unclosed alternate group` and `rg: error parsing glob '*{threshold'` are two
 * recorded searches that never ran, because a brace in a sentence a person wrote
 * stopped being a character and became an operator. The shell does the same and
 * worse: `no matches found: test/tmp*` is zsh declining to run the command at
 * all, in the caller's favour, with nothing printed that a sweep would read as a
 * failure. In every one of these the run meant a literal and the interpreter
 * found an instruction.
 *
 * **Why a type and not a quoter.** A helper callers are supposed to remember is a
 * convention, and this repository has already concluded in writing that
 * convention was not enough — the wrapped-wikilink rule exists because asking
 * people to keep links on one line did not work. The hole in a convention is
 * silent and asymmetric: it sits unexercised until a title with a brace in it
 * happens to travel that one path, at which point the failure is identical to
 * having no scheme at all, except that everyone now believes there is one. That
 * is strictly worse than the status quo, which at least produced a visible parse
 * error rather than a false belief in coverage.
 *
 * So the bare form is absent rather than discouraged. {@link TreeText} holds its
 * value in a `#private` field and has no `toString`, no `valueOf`, no `toJSON`
 * and no `Symbol.toPrimitive` that yields it — those four are present only to
 * throw, because the interesting failure is `` `${title}` `` succeeding quietly,
 * not a caller who wanted to be stopped. The four ways out are
 * {@link TreeText.forSearchPattern}, {@link TreeText.forPathUnder},
 * {@link TreeText.forMessage} and {@link TreeText.equalsLiteral}, one per
 * destination this repository actually sends tree text to, and each either quotes
 * for that destination or refuses.
 *
 * **What this does not cover, stated rather than designed around.** Provenance
 * only holds where the value is wrapped at the boundary it enters — a title read
 * into a plain `string` field elsewhere in the codebase is outside the scheme and
 * this type cannot tell. And the two recorded failures were globs an *agent*
 * composed in a tool call, not values this codebase interpolated; nothing here
 * reaches inside a session's own tool use.
 */

/** Where a value entered the scheme. A label about the source, never the value. */
export interface TreeOrigin {
  /** The file the value was read from, as the reader named it. */
  readonly file: string;
  /** Which part of that file — a frontmatter key, `body`, `title`. */
  readonly field: string;
}

/**
 * A path built for a tree value, or the reason no path was built.
 *
 * Returned rather than thrown, and never silently repaired. `sanitizeTitle`
 * rewrites `a/b` into `a b`, which is right when *creating* a file and a lie when
 * *reading* one — the caller would be handed bytes from a different node than the
 * one it named, and no exit code reports that. So a value that is not already a
 * single safe segment gets a refusal carrying what was wrong with it.
 */
export type PathForTreeText =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly reason: string };

// C0 controls + DEL, written as escapes so this file holds no literal control byte.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]");
const CONTROL_CHARS_GLOBAL = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/**
 * The characters `compileGlob` reads as syntax rather than as themselves.
 *
 * `*` and `?` are wildcards, `{` `}` open and close an alternate group, `,`
 * separates inside one, and `\` is the escape itself — which is why it is in the
 * set: a title containing a backslash must arrive as a backslash, not as an
 * escape for whatever followed it.
 */
const GLOB_SYNTAX = /[\\*?{},]/g;

/**
 * Tree text, wrapped at the boundary it entered and unwrappable only by naming
 * where it is going.
 */
export class TreeText {
  readonly #value: string;
  readonly #origin: TreeOrigin;

  private constructor(value: string, origin: TreeOrigin) {
    this.#value = value;
    this.#origin = origin;
  }

  /**
   * Wrap a value read out of a node's frontmatter.
   *
   * Takes `unknown` because YAML hands back whatever was written: a title field
   * holding a list or a number is a malformed node, and the place to find that
   * out is the read, not the call three frames later that expected a string.
   */
  static fromFrontmatter(file: string, field: string, value: unknown): TreeText {
    if (typeof value !== "string") {
      throw new TypeError(`${field} of ${file} is ${value === null ? "null" : typeof value}, not text`);
    }
    return new TreeText(value, { file, field });
  }

  /** Wrap a value that came from the tree by some other route — a body, a title read off a filename. */
  static fromTree(value: string, origin: TreeOrigin): TreeText {
    if (typeof value !== "string") {
      throw new TypeError(`${origin.field} of ${origin.file} is not text`);
    }
    return new TreeText(value, origin);
  }

  /**
   * Where this came from. Safe to print: it names the file and field, not the value.
   */
  get origin(): TreeOrigin {
    return this.#origin;
  }

  /** How long the value is, for a size check that does not need to read it. */
  get length(): number {
    return this.#value.length;
  }

  /**
   * The value as a glob that matches itself and nothing else.
   *
   * Every character `compileGlob` would read as syntax is escaped, so `{Charge`
   * arrives as a pattern for the six characters `{Charge` rather than as an
   * alternate group that was never closed. The invariant a caller can rely on:
   * `compileGlob(t.forSearchPattern())` compiles, and matches the original value.
   */
  forSearchPattern(): string {
    return this.#value.replace(GLOB_SYNTAX, "\\$&");
  }

  /**
   * A path to this value's file under `root`, or a refusal saying why not.
   *
   * Refuses rather than repairs, for the reason on {@link PathForTreeText}. The
   * four refusals are the four ways a sentence stops being a filename: a
   * separator, a traversal, a control byte (`\n` in a title makes one path into
   * two), and nothing left at all.
   */
  forPathUnder(root: string, opts: { extension?: string } = {}): PathForTreeText {
    const value = this.#value;
    const extension = opts.extension ?? ".md";

    if (value.trim().length === 0) {
      return { ok: false, reason: `${this.#describe()} is empty or blank, so it names no file` };
    }
    if (/[/\\]/.test(value)) {
      return { ok: false, reason: `${this.#describe()} contains a path separator, so it is not one file name` };
    }
    if (value === "." || value === ".." || value.includes("..")) {
      return { ok: false, reason: `${this.#describe()} contains a traversal, so the path it builds may leave ${root}` };
    }
    if (CONTROL_CHARS.test(value)) {
      return { ok: false, reason: `${this.#describe()} contains a control character, so it does not name one line or one file` };
    }

    const sep = root.endsWith("/") ? "" : "/";
    return { ok: true, path: `${root}${sep}${value}${extension}` };
  }

  /**
   * The value as one line of output, quoted, with nothing left that an
   * interpreter downstream would read as an instruction.
   *
   * Quoted and not merely escaped, because the recorded shell failures include
   * `(eval):1: == not found` — a separator line from output being executed. A
   * value printed bare can become a command in whatever reads the log next; a
   * value in quotes with its controls escaped is visibly a value. `JSON.stringify`
   * is exactly this transformation and is used rather than reimplemented.
   */
  forMessage(): string {
    return JSON.stringify(this.#value);
  }

  /**
   * Is this value the literal `expected`?
   *
   * The comparison route yields a boolean and never the string, which is the
   * whole point: an equality check is the boundary where a wrapper is most
   * tempting to unwrap, and it does not need the value to be in circulation to
   * answer. Exact, not canonicalising — a caller that wants to compare node
   * titles the way the filesystem does should compare the paths
   * {@link forPathUnder} builds, so that "equal" means "the same file".
   */
  equalsLiteral(expected: string): boolean {
    return this.#value === expected;
  }

  /** The value and its origin, for a refusal message. Names the field, quotes the value. */
  #describe(): string {
    return `${this.#origin.field} of ${this.#origin.file} (${JSON.stringify(this.#value)})`;
  }

  /**
   * The four implicit conversions, present only to fail.
   *
   * `` `${title}` ``, `String(title)`, `title + ""` and `JSON.stringify({title})`
   * are the ways a bare string gets back into circulation without anyone writing
   * anything that looks wrong. Each throws naming the alternative, because a
   * caller here has a real destination in mind and needs to say which.
   */
  toString(): never {
    throw new TypeError(TreeText.#refusal("String()"));
  }

  valueOf(): never {
    throw new TypeError(TreeText.#refusal("valueOf()"));
  }

  toJSON(): never {
    throw new TypeError(TreeText.#refusal("JSON.stringify()"));
  }

  [Symbol.toPrimitive](): never {
    throw new TypeError(TreeText.#refusal("string interpolation"));
  }

  static #refusal(how: string): string {
    return (
      `tree text has no bare form: ${how} would hand it to a command unquoted. ` +
      `Name a destination — forSearchPattern(), forPathUnder(), forMessage() or equalsLiteral().`
    );
  }
}

/**
 * Every value in a frontmatter block, wrapped, for a caller that reads a node
 * file and wants none of it loose.
 *
 * Non-string values are skipped rather than coerced: a `created` date or a
 * numeric threshold is not text that could reach a command as syntax, and
 * stringifying it here would invent tree text that was never written.
 */
export function wrapFrontmatter(file: string, data: Record<string, unknown>): Map<string, TreeText> {
  const out = new Map<string, TreeText>();
  for (const [field, value] of Object.entries(data)) {
    if (typeof value === "string") out.set(field, TreeText.fromFrontmatter(file, field, value));
  }
  return out;
}

/**
 * Strip control characters out of a line of output that is not tree text.
 *
 * Here because {@link TreeText.forMessage} is the wrapped case and a report also
 * prints strings this scheme does not cover — a filesystem error message, a
 * ripgrep complaint. Those get the same treatment minus the quoting.
 */
export function oneLine(text: string): string {
  return text.replace(CONTROL_CHARS_GLOBAL, " ");
}
