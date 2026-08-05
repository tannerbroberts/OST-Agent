/**
 * The one action the broker ships with: an authenticated read-only GET.
 *
 * **Why the credential travels as a handle rather than as an argument.** Every
 * HTTP client in this repository already takes a token and puts it in a header —
 * `Authorization: Bearer <token>` for Slack, `Basic base64(email:token)` for
 * Atlassian, `X-Subscription-Token` for search. Rewriting all three to ask a
 * broker for permission would be a large change to code whose read-only-ness is
 * the thing most worth not disturbing. So the clients are handed a
 * {@link CredentialHandle} in place of the token and left otherwise untouched:
 * they compose the same header they always did, and {@link brokeredFetch}
 * substitutes the real secret at the last moment, after the URL has been checked
 * against the grant and the request has been recorded.
 *
 * Two properties fall out of that, and both are why it is worth doing this way:
 *
 *  - **A path that forgets the broker fails loudly.** Code that keeps a raw
 *    `fetch` sends `ost-credential:slack` as its token and gets a 401. The
 *    alternative failure — a real token going out through an unaudited path —
 *    would have looked like success.
 *  - **A handle in a leak is worth nothing.** Handles reach transcripts, error
 *    messages and vault notes the same way tokens used to. They are names.
 *
 * The response is read eagerly and returned as a plain object, so the broker's
 * own scrubber walks the body before any caller sees it: a vendor that echoes
 * the credential back cannot launder it through the response. Bodies here are
 * small JSON documents and capped pages; nothing streams.
 */
import type { Action, CredentialBroker, CredentialHandle, PerformInput } from "./broker.js";
import { isCredentialHandle } from "./broker.js";

/** The action name the grant table uses. */
export const HTTP_GET = "http.get";

/** The structural slice of `fetch` this module calls. `globalThis.fetch` satisfies it. */
export type RawFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; redirect?: "manual"; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null } | undefined;
  text(): Promise<string>;
}>;

/** What the action returns — deliberately plain, so the broker can scrub it. */
interface RawResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The response shape callers get back: satisfies both the adapters' `FetchFn`
 * (`ok`/`status`/`json()`/`text()`) and `web/reader.ts`'s `WebFetchFn`
 * (`headers.get()`), so a brokered fetch is a drop-in for either.
 */
export interface BrokeredResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type BrokeredFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; redirect?: "manual"; signal?: AbortSignal },
) => Promise<BrokeredResponse>;

/**
 * Put the secret where the caller put the handle.
 *
 * Plain substring substitution covers `Bearer <handle>` and bare-value headers.
 * HTTP Basic is the one form where the credential is not visible in the header
 * text at all — RFC 7617 base64s `user:password` — so it is decoded, substituted
 * and re-encoded. That is not a special case for one adapter's convenience; a
 * broker that could not see through the one encoding the standard defines would
 * quietly send handles to every Basic-auth API there is.
 */
function substituteValue(value: string, handle: CredentialHandle, secret: string): string {
  if (value.includes(handle)) return value.split(handle).join(secret);
  const basic = /^(Basic\s+)([A-Za-z0-9+/=]+)$/i.exec(value);
  if (basic) {
    let decoded: string;
    try {
      decoded = Buffer.from(basic[2], "base64").toString("utf8");
    } catch {
      return value;
    }
    if (decoded.includes(handle)) {
      const filled = decoded.split(handle).join(secret);
      return `${basic[1]}${Buffer.from(filled, "utf8").toString("base64")}`;
    }
  }
  return value;
}

/**
 * The GET action. Injected `fetchFn` so every test in this repository stays
 * offline; `globalThis.fetch` in production.
 */
export function httpGetAction(fetchFn?: RawFetch): Action {
  return async (input: PerformInput): Promise<RawResponse> => {
    const fetcher = fetchFn ?? (globalThis.fetch as unknown as RawFetch);
    const args = (input.args ?? {}) as {
      headers?: Record<string, string>;
      redirect?: "manual";
      signal?: AbortSignal;
      /**
       * What the caller ASKED for, carried under its own name so it can be
       * refused. It is deliberately not called `method`: `test/release/
       * outward-mutation.test.ts` reads this repository for a declared HTTP verb
       * whose value is not a literal, on the grounds that a verb arriving in a
       * variable is a verb the scan cannot judge. That check is right, and the
       * way to satisfy it is to never write one — not to widen the pattern.
       */
      requestedMethod?: string;
    };
    if (args.requestedMethod && args.requestedMethod.toUpperCase() !== "GET") {
      // The broker performs reads. A write is a different grant and a different
      // action, and it does not exist yet — so it is refused here rather than
      // waved through on the strength of an argument the caller chose.
      throw new Error(`the brokered HTTP action performs GET only, not ${args.requestedMethod}`);
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(args.headers ?? {})) {
      headers[name] = substituteValue(value, input.handle, input.secret);
    }
    // Fail closed on a handle that survived substitution: it names a credential
    // this grant did not resolve, and sending it would hand a vendor a string
    // that identifies a secret we hold.
    for (const [name, value] of Object.entries(headers)) {
      if (isCredentialHandle(value) || value.includes("ost-credential:")) {
        throw new Error(
          `header "${name}" still carries a credential handle after substitution — ` +
            `it names a credential this grant did not resolve, so the request was not sent`,
        );
      }
    }

    const res = await fetcher(input.target, {
      method: "GET",
      headers,
      redirect: args.redirect ?? "manual",
      ...(args.signal ? { signal: args.signal } : {}),
    });
    const out: Record<string, string> = {};
    const location = res.headers?.get("location");
    if (location) out.location = location;
    const contentType = res.headers?.get("content-type");
    if (contentType) out["content-type"] = contentType;
    return { ok: res.ok, status: res.status, headers: out, body: await res.text() };
  };
}

/**
 * A fetch-shaped function that routes every request through the broker.
 *
 * A denial becomes a thrown error rather than a synthetic HTTP status: the
 * caller asked for something it is not allowed to ask for, which is a bug in the
 * grant table or in the caller, and a 403 shaped like the vendor's would be
 * indistinguishable from the vendor saying no.
 */
export function brokeredFetch(broker: CredentialBroker, asker: string, action = HTTP_GET): BrokeredFetch {
  return async (url, init = {}) => {
    const response = await broker.request({
      asker,
      action,
      target: url,
      args: {
        ...(init.headers ? { headers: init.headers } : {}),
        ...(init.method ? { requestedMethod: init.method } : {}),
        ...(init.redirect ? { redirect: init.redirect } : {}),
        ...(init.signal ? { signal: init.signal } : {}),
      },
    });

    if (response.status === "denied") {
      throw new Error(`credential broker denied GET ${url} (${response.reason}): ${response.why}`);
    }
    if (response.status === "failed") {
      throw new Error(`brokered GET ${url} failed: ${response.why}`);
    }

    const raw = response.result as RawResponse;
    const headers = new Map(Object.entries(raw.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      ok: raw.ok,
      status: raw.status,
      headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
      text: async () => raw.body,
      json: async () => JSON.parse(raw.body || "null"),
    };
  };
}
