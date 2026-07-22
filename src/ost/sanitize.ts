/**
 * Filename sanitization for OST node files.
 *
 * Node titles come (indirectly) from untrusted evidence, so a title must never be
 * able to escape the vault directory or collide with path syntax. `sanitizeTitle`
 * returns a safe basename (WITHOUT the `.md` extension) confined to a single path
 * segment. It throws on input that cannot be reduced to a usable name.
 */

const MAX_TITLE_LENGTH = 200;

// C0 control chars + DEL. Built from an escape string so the source contains no
// literal control bytes.
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]", "g");

/**
 * Reduce an arbitrary node title to a safe, separator-free basename.
 *
 * - strips path separators (`/`, `\`) and `..` traversal
 * - strips control characters and characters illegal on common filesystems
 * - collapses whitespace runs to single spaces and trims
 * - clamps to {@link MAX_TITLE_LENGTH} characters
 *
 * Unicode letters/marks are preserved. Throws if the result is empty.
 */
export function sanitizeTitle(title: string): string {
  if (typeof title !== "string") {
    throw new TypeError("title must be a string");
  }

  let s = title
    // control chars first (incl. newlines/tabs)
    .replace(CONTROL_CHARS, " ")
    // path separators
    .replace(/[/\\]+/g, " ")
    // traversal: collapse any run of dots to a single dot
    .replace(/\.{2,}/g, ".")
    // characters illegal in filenames on Windows/macOS
    .replace(/[<>:"|?*]/g, " ")
    // collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
    // no leading dots (hidden files / current-dir tricks)
    .replace(/^\.+/, "")
    .trim();

  if (s.length > MAX_TITLE_LENGTH) {
    s = s.slice(0, MAX_TITLE_LENGTH).trim();
  }

  if (s.length === 0) {
    throw new Error(`title sanitizes to an empty name: ${JSON.stringify(title)}`);
  }

  return s;
}

/** The on-disk filename (basename + `.md`) for a node title. */
export function fileNameForTitle(title: string): string {
  return `${sanitizeTitle(title)}.md`;
}
