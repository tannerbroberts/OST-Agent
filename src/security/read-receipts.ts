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
 *
 * ## A receipt carries WHICH body, not just that there was one
 *
 * It did not, once, and that was the hole. A receipt that says only "served"
 * cannot tell a caller composing against the body it read from a caller composing
 * against a body that has since moved — and a merge is written against prose, so
 * the difference is the whole of what the guard is worth. Each receipt now carries
 * a {@link stamp}: a digest of the node's file at the instant it was served. The
 * caller never sees it, never echoes it back, and cannot be asked for it, so the
 * admitted bypass in `test/tools/merge-read-guard-bypass.test.ts` stays exactly as
 * open as it was — the stamp is the surface's own bookkeeping about what it
 * handed over, not a new obligation on the caller.
 *
 * This is also the reason auto-satisfaction stops at this book's door. See
 * {@link ./auto-satisfy.ts}: a surface that performed the read itself would stamp
 * the body as it is at write time, the stamps would agree by construction, and
 * "modified since read" would become undetectable.
 */
import { canonicalTitle } from "../ost/sanitize.js";

/** The session's record of which node bodies the surface has served it. */
export interface ReadReceipts {
  /**
   * Record that this session was served the body of `title`, as it stood.
   *
   * Called with the RESOLVED node's own title rather than the caller's spelling,
   * so a receipt cannot be minted for a node that does not exist. `stamp` is a
   * digest of what was served; it is required rather than optional because an
   * unstamped receipt is one no staleness check can speak to, and a guard with a
   * silent hole in it is the shape this repository has withdrawn findings over.
   */
  record(title: string, stamp: string): void;
  /** Has this session been served that node's body? */
  wasRead(title: string): boolean;
  /** The stamp of the body this session was served, or `undefined` if none was. */
  stampFor(title: string): string | undefined;
  /** Every node read so far, canonically spelled — for publication and for tests. */
  titles(): readonly string[];
}

export function createReadReceipts(): ReadReceipts {
  const seen = new Map<string, string>();
  return {
    record(title, stamp) {
      const key = canonicalTitle(title);
      // A title that reduces to nothing names no file, so there is no node it
      // could be a receipt for. Silently not recording it is right: `record` is
      // called on a successful read's own output, and throwing here would turn a
      // served body into an error after the fact.
      //
      // The LAST read wins. A caller that reads, watches the node change, and
      // reads again has seen the new body — re-stamping is the caller doing the
      // thing the guard asks for, and refusing to update would make the second
      // read useless.
      if (key) seen.set(key, stamp);
    },
    wasRead(title) {
      const key = canonicalTitle(title);
      return key !== null && seen.has(key);
    },
    stampFor(title) {
      const key = canonicalTitle(title);
      return key === null ? undefined : seen.get(key);
    },
    titles() {
      return [...seen.keys()];
    },
  };
}
