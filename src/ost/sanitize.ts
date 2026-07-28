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
    // no trailing dots or spaces (illegal on Windows; avoids "title..md")
    .replace(/[.\s]+$/, "")
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

/**
 * The name a node will actually be found under, or null if it reduces to
 * nothing.
 *
 * `sanitizeTitle` throws on a title that sanitizes empty. That is right at
 * creation — the caller asked for something impossible — and wrong at lookup,
 * where an unfindable name is a miss, not an error.
 */
export function canonicalTitle(title: string): string | null {
  try {
    return sanitizeTitle(title);
  } catch {
    return null;
  }
}

/**
 * Do these two names refer to the same node?
 *
 * A node's title IS its filename (`vault.ts` reconstructs it from the basename
 * on read), so a stored title has already been through `sanitizeTitle` — which
 * replaces `:` with a space, among others. A caller naming a node types the
 * title they created it with. Comparing the two raw makes an entire naming
 * convention permanently unaddressable — `Unknown: what we cannot see` is
 * stored as `Unknown what we cannot see` and never matches — and does it
 * silently, because a lookup that finds nothing looks exactly like a node that
 * was never created. That is how attributed spend went missing: the marker
 * resolved to no node, and `staleAttribution` dropped it as bookkeeping drift.
 *
 * Two titles differing only in characters sanitize removes are treated as one
 * node here. They already are one node — both write to the same file — so this
 * makes lookup agree with storage rather than introducing a new collision.
 */
export function titlesMatch(a: string, b: string): boolean {
  const left = canonicalTitle(a);
  return left !== null && left === canonicalTitle(b);
}
