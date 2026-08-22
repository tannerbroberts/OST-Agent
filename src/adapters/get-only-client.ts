/**
 * The one transport every adapter HTTP client is built over: a wrapper that
 * refuses any verb but GET, in this process, before a request leaves it.
 *
 * **Why a wrapper at all, when the three clients already hardcode GET.** They
 * do, and that is the weaker fact it looks like. `HttpSlackClient.get()`,
 * `HttpAtlassianClient.get()` and `HttpActionsClient.get()` each compose their
 * own init literal against their own private copy of the transport, so
 * "read-only" is three independent habits and nothing holds them. A fourth
 * method on any of them — or a fourth client — writes without anything
 * objecting, and the failure would be invisible locally: the request goes out,
 * the *remote* decides, and whether it is refused depends on how narrowly the
 * operator happened to scope their token. A least-privilege token that turns out
 * to be over-scoped is the case where nothing refuses anything, which is exactly
 * the case the claim is supposed to cover.
 *
 * So the verb is decided HERE, once, at the boundary the clients are constructed
 * with — and the decision is a refusal in this process rather than a status code
 * from a vendor. What an over-scoped token would have permitted is no longer
 * reachable, because the code that would have asked cannot get past this
 * function.
 *
 * **Three things it does, and each closes a different way in:**
 *
 *  - **A declared verb that is not GET is refused,** whatever case it arrives in
 *    and however it was spelled at the call site. `test/release/
 *    outward-mutation.test.ts` scans the source for a literal verb, and says
 *    plainly that a verb arriving in a variable, a quoted key or an assignment is
 *    invisible to it. This is the runtime half of that check: a spelling no scan
 *    can read still arrives here as a value, and is refused on its value.
 *  - **The outgoing verb is not the caller's to choose.** The init handed
 *    downstream carries GET because this function put it there, not because the
 *    caller asked nicely. A caller that omits the verb entirely gets a read.
 *  - **A request body is refused.** GET with a payload is how a write disguises
 *    itself as a read on APIs that route on the body; nothing in this repository
 *    sends one, and the day something starts is a day worth failing on.
 *
 * **The fallback to `globalThis.fetch` lives here and nowhere else.** It used to
 * be written out once per client (`cfg.fetchFn ?? globalThis.fetch`), which is
 * three places where an unguarded transport could be reached — and the `actions`
 * adapter really does take that path in the commonest case, because a public
 * repository needs no credential and so gets no brokered fetch. Collapsing the
 * fallback into this module means a client with no injected transport is guarded
 * on the same terms as one with a brokered one.
 */

/** What every adapter client reads back. `globalThis.fetch`'s Response satisfies it. */
export interface ReadResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/**
 * The init this wrapper accepts and passes on. The verb is declared because the
 * clients declare it; `redirect` and `signal` are carried through untouched for
 * the brokered transport, which reads both.
 */
export interface ReadRequestInit {
  method: string;
  headers: Record<string, string>;
  redirect?: "manual";
  signal?: AbortSignal;
}

/** The guarded transport an adapter client holds. */
export type ReadOnlyFetch = (url: string, init: ReadRequestInit) => Promise<ReadResponse>;

/**
 * The transport underneath the guard — `globalThis.fetch`, or the credential
 * broker's `brokeredFetch`, or a test's recorder. Deliberately looser than
 * {@link ReadOnlyFetch} so anything fetch-shaped can sit below it.
 */
export type UnderlyingFetch = (url: string, init: ReadRequestInit) => Promise<ReadResponse>;

/** The verb this process is willing to send. There is no list; there is one. */
export const READ_ONLY_VERB = "GET";

/**
 * Thrown when an adapter asks for a write. A named class, not a bare `Error`,
 * so a caller tracing a failed ingest can tell "we refused to ask" apart from
 * "we asked and the remote said no" — which are the two states this whole module
 * exists to stop being the same state.
 */
export class NonGetRequestError extends Error {
  constructor(
    readonly verb: string,
    readonly url: string,
  ) {
    super(
      `the adapter transport sends ${READ_ONLY_VERB} only — it refused ${verb} ${url} in this process, ` +
        `before anything was sent. Adapters read the systems of record; they never write back.`,
    );
    this.name = "NonGetRequestError";
  }
}

/**
 * Wrap a transport so only reads can leave through it.
 *
 * `injected` is optional for the same reason the clients' `fetchFn` was: every
 * test in this repository stays offline, and production passes either a brokered
 * fetch or nothing. Nothing resolves to `globalThis.fetch` — guarded, which is
 * the change.
 */
export function getOnlyFetch(injected?: UnderlyingFetch): ReadOnlyFetch {
  const raw = injected ?? (globalThis as unknown as { fetch: UnderlyingFetch }).fetch;
  return async (url: string, init: ReadRequestInit): Promise<ReadResponse> => {
    // Read defensively: a caller reaching this from untyped code can hand over
    // anything, and the whole point is to judge the value that actually arrived
    // rather than the one the types promised.
    const asked = init as unknown as { method?: unknown; body?: unknown } | undefined;
    const verb = typeof asked?.method === "string" ? asked.method.trim() : "";
    if (verb && verb.toUpperCase() !== READ_ONLY_VERB) {
      throw new NonGetRequestError(verb.toUpperCase(), url);
    }
    if (asked?.body !== undefined && asked?.body !== null) {
      throw new NonGetRequestError(`${READ_ONLY_VERB}-with-a-body`, url);
    }
    return raw(url, { ...init, method: "GET" });
  };
}
