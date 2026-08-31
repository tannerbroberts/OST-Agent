/**
 * What this session has actually fetched, so a write can require that a fetch
 * happened first.
 *
 * The shape is borrowed, deliberately and without improvement, from the file
 * tools every session already carries: an editor that refuses to write a file the
 * session has not read. `File has not been read yet` is one of the most frequent
 * refusals in this project's own friction corpus — it is annoying, it fires
 * constantly, and it stops exactly one class of mistake, which is composing over
 * prose you have never seen.
 *
 * ## What a receipt is evidence of, and what it is not
 *
 * A receipt says the session asked for a node's body and the surface served it.
 * It does NOT say the caller read what came back, and nothing on this side of a
 * tool boundary could. The assumption node under this guard states the weakness
 * as the point rather than as a caveat — "a caller under pressure can issue the
 * fetch, discard the result, and compose from the title exactly as before" — and
 * `test/tools/merge-read-guard-bypass.test.ts` asserts that the bypass is open,
 * because a guard that quietly stopped being defeatable would be claiming a
 * property it does not have.
 *
 * So this is a speed bump with a message on it, not a proof. Its value is the
 * refusal text: the caller learns the rule at the moment it is about to break it,
 * and the cheapest way past it is the thing it wanted the caller to do anyway.
 *
 * ## Session scope
 *
 * One receipt book per tool set — created in `buildOstTools` beside the lookup
 * budget and the instrument ration, for the same reason those are: a caller that
 * forgot to pass one gets a fresh one rather than an absent one, so the bound
 * holds on every surface. Two servers are two sessions and neither inherits the
 * other's reads; a receipt never reaches disk and never outlives the process.
 *
 * Titles are keyed through {@link canonicalTitle}, because a node's title IS its
 * filename: `Unknown: what we cannot see` and `Unknown what we cannot see` are one
 * node on disk, and a receipt book that treated them as two would refuse a merge
 * on a node the session had demonstrably read.
 */
import { canonicalTitle } from "../ost/sanitize.js";

/** The session's record of which node bodies the surface has served it. */
export interface ReadReceipts {
  /**
   * Record that this session was served the body of `title`.
   *
   * Called with the RESOLVED node's own title rather than the caller's spelling,
   * so a receipt cannot be minted for a node that does not exist.
   */
  record(title: string): void;
  /** Has this session been served that node's body? */
  wasRead(title: string): boolean;
  /** Every node read so far, canonically spelled — for publication and for tests. */
  titles(): readonly string[];
}

export function createReadReceipts(): ReadReceipts {
  const seen = new Set<string>();
  return {
    record(title) {
      const key = canonicalTitle(title);
      // A title that reduces to nothing names no file, so there is no node it
      // could be a receipt for. Silently not recording it is right: `record` is
      // called on a successful read's own output, and throwing here would turn a
      // served body into an error after the fact.
      if (key) seen.add(key);
    },
    wasRead(title) {
      const key = canonicalTitle(title);
      return key !== null && seen.has(key);
    },
    titles() {
      return [...seen];
    },
  };
}
