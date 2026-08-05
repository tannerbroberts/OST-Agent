/**
 * One way to parse frontmatter, with gray-matter's process-global cache off.
 *
 * **The bug this exists to close, observed rather than reasoned about.**
 * `gray-matter` writes its cache entry BEFORE it parses (`index.js:46`, above the
 * `parseMatter` call). So a file whose YAML throws is left in the cache as a
 * half-built object — `data: {}`, `content` still holding the whole raw string
 * including the delimiters. The throw propagates, the caller treats the file as
 * unreadable, and every subsequent `matter()` on that same content in the same
 * process returns the cached object instead: no throw, empty frontmatter, the raw
 * text as the body.
 *
 * The consequence is that the same directory reads differently on the second pass
 * over it, in the same process, with nothing having changed on disk:
 *
 *   - `readEvidenceScan` drops the file the first time (one record short) and
 *     admits it the second, as a record whose `id` defaults to its filename and
 *     whose body is its own broken frontmatter;
 *   - `Vault.readTreeCensus` files it under `unreadable` the first time and under
 *     `skipped` ("no frontmatter `type`") the second.
 *
 * That is a subject count that moves under a sweep while it is running, which is
 * the failure this whole area is about — a check cannot report what it read if
 * what it read depends on how many times it has looked. Passing any options
 * object disables the cache (gray-matter caches only when `options` is falsy,
 * because it does not key the cache on them), so the parse is a pure function of
 * the bytes and a file that will not parse will not parse every time.
 *
 * The cache buys nothing here in exchange: it is keyed on whole file contents,
 * and a vault's files are distinct by construction.
 */
import matter from "gray-matter";

/** Parse `raw` as frontmatter + content. Throws on frontmatter that will not parse — every time. */
export function parseFrontmatter(raw: string): matter.GrayMatterFile<string> {
  return matter(raw, {});
}
