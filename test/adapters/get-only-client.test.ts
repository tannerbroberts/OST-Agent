/**
 * Every request an adapter makes is a GET, and a write is refused HERE — in this
 * process, by the client — rather than out there by whatever scope the operator's
 * token happened to have.
 *
 * ## The clause this file decides, and the one it does not
 *
 * The assumption is "read-only, GET-only access is enough to gather the evidence
 * the tree needs", and its threshold has two halves. Whether GET-only is
 * *sufficient* — whether a real project's evidence is fully retrievable without
 * write scope — needs a real Jira/Confluence corpus and belongs to a human
 * running the ingest against it. Nothing here touches that.
 *
 * What is mechanical is the other half: **no ingestion task needs write scope**.
 * That is a claim about this codebase, and it is asserted at the client boundary
 * rather than at the remote, because a remote's refusal is not evidence about the
 * code. An over-scoped token — the case least-privilege is *for*, and the case
 * that actually happens — would let a write through with a 200, and every test
 * that reasons about response codes would stay green while the claim was false.
 * So the fake remote in this file is deliberately **permissive**: it answers 200
 * to any verb it is handed, exactly like a token with more scope than it should
 * have. Every refusal below therefore comes from the client, or it does not
 * happen at all — and a control asserts the remote really would have said yes.
 *
 * ## Why the client list is derived rather than written down
 *
 * `s5-adapter-reachability` records what a hand-written list of adapters costs: a
 * channel that nobody wired stayed invisible because the list did not know about
 * it. The same failure is available here — a fourth HTTP client, unguarded,
 * shipping past a file that only knows three names. So the clients are read off
 * `src/adapters/` by pattern, and the driving table is asserted to cover exactly
 * what was found. A new `export class Http…Client` fails this file on the commit
 * that adds it, and stays failing until somebody decides how it reads.
 *
 * ## The four things asserted, and why none of them alone is enough
 *
 *  1. **The guard refuses.** Every write verb, in any casing, throws before the
 *     transport is reached. Alone this proves only that a function nobody has to
 *     call works.
 *  2. **Every shipped client holds the guard.** Read from the client instance
 *     itself, not from the source text, so a client that imports `getOnlyFetch`
 *     and then quietly keeps a second raw transport does not pass.
 *  3. **A full ingest issues only GETs.** All three sources driven end to end
 *     over their real HTTP clients, with the verb recorded at the transport. This
 *     is the property the criterion words; (1) and (2) are why it cannot be
 *     evaded by a path this fixture did not happen to walk.
 *  4. **The fallback is guarded too.** A client constructed with no transport at
 *     all is the live path for the `actions` adapter — a public repository needs
 *     no credential, so `context.ts` passes it nothing — and that is precisely
 *     the path that used to reach `globalThis.fetch` unguarded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ActionsSource, HttpActionsClient } from "../../src/adapters/actions.js";
import { AtlassianSource, HttpAtlassianClient } from "../../src/adapters/atlassian.js";
import { SlackSource, HttpSlackClient } from "../../src/adapters/slack.js";
import {
  NonGetRequestError,
  getOnlyFetch,
  type ReadOnlyFetch,
  type ReadResponse,
  type UnderlyingFetch,
} from "../../src/adapters/get-only-client.js";
import type { Source } from "../../src/adapters/source.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const adapterDir = path.join(repoRoot, "src", "adapters");

/**
 * Everything but GET, including the two that are usually called harmless.
 *
 * HEAD and OPTIONS read nothing and change nothing, and they are still refused:
 * the claim the tree is resting on is "GET-only", not "probably-harmless-only",
 * and a boundary with a judgement call in it is a boundary somebody will argue
 * with later. If an adapter ever needs a HEAD, that is a deliberate commit to
 * this constant and a re-reading of the node.
 */
const WRITE_VERBS = ["POST", "PUT", "PATCH", "DELETE", "post", "Patch", "dElEtE", "HEAD", "OPTIONS", "TRACE"];

interface Call {
  url: string;
  verb: string;
}

/** What the fake remote answers, keyed by the endpoint each client actually calls. */
function bodyFor(url: string): unknown {
  if (url.includes("/rest/api/3/search/jql")) {
    return {
      issues: [
        {
          key: "PROJ-1",
          fields: {
            summary: "an issue",
            description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body text" }] }] },
            updated: "2026-07-20T10:00:00.000Z",
            comment: { comments: [] },
          },
        },
      ],
    };
  }
  if (url.includes("/wiki/rest/api/content/search")) {
    return {
      results: [
        {
          id: "9001",
          title: "a page",
          body: { storage: { value: "<p>page text</p>" } },
          version: { when: "2026-07-20T11:00:00.000Z" },
          _links: { webui: "/spaces/SPACE/pages/9001" },
        },
      ],
    };
  }
  if (url.includes("/api/conversations.history")) {
    return { ok: true, messages: [{ ts: "1626170400.000100", user: "U1", text: "a real message" }] };
  }
  if (url.includes("/actions/runs")) {
    return {
      workflow_runs: [
        {
          id: 1,
          name: "CI",
          path: ".github/workflows/ci.yml",
          run_attempt: 1,
          event: "push",
          status: "completed",
          conclusion: "success",
          head_branch: "main",
          head_sha: "abc1234",
          created_at: "2026-07-20T10:00:00Z",
          run_started_at: "2026-07-20T10:01:00Z",
          updated_at: "2026-07-20T10:09:00Z",
        },
      ],
    };
  }
  // Loud rather than empty: a client that grew a call this fixture does not know
  // about would otherwise be "covered" by a silent `{}`.
  throw new Error(`the fixture has no answer for ${url} — a client is making a call this file does not cover`);
}

/**
 * A remote with more scope than it should have: 200 for anything, any verb.
 *
 * This is the whole point of the fixture. A remote that refused writes would make
 * every assertion below pass without the client doing anything, which is the
 * confusion the criterion exists to end.
 */
function permissiveRemote(calls: Call[]): UnderlyingFetch {
  return async (url, init): Promise<ReadResponse> => {
    calls.push({ url, verb: (init as { method?: string } | undefined)?.method ?? "<none>" });
    return {
      ok: true,
      status: 200,
      async json() {
        return bodyFor(url);
      },
      async text() {
        return "";
      },
    };
  };
}

/* ------------------------------------------------------------------ *
 * The shipped clients, read off disk
 * ------------------------------------------------------------------ */

/** `export class Http…Client` — the concrete transports, not the interfaces they implement. */
const CLIENT_DECLARATION = /export class (Http\w*Client)\b/g;

function shippedClientNames(): string[] {
  const names: string[] = [];
  for (const entry of fs.readdirSync(adapterDir)) {
    if (!entry.endsWith(".ts")) continue;
    const src = fs.readFileSync(path.join(adapterDir, entry), "utf8");
    for (const m of src.matchAll(CLIENT_DECLARATION)) names.push(m[1]);
  }
  return names.sort();
}

/** The field each client keeps its transport in, named once so a rename fails loudly. */
const TRANSPORT_FIELD = "fetchFn";

interface Driven {
  /** Build the client over an injected transport. */
  client: (fetchFn: UnderlyingFetch) => object;
  /** Build the client over NOTHING — the path that used to reach `globalThis.fetch` raw. */
  unconfigured: () => object;
  /** The source that drives it, for the full-ingest pass. */
  source: (fetchFn: UnderlyingFetch) => Source;
  /** How many requests one cold `fetchSince(null)` should issue. */
  requests: number;
}

const DRIVE: Record<string, Driven> = {
  HttpAtlassianClient: {
    client: (fetchFn) => new HttpAtlassianClient({ baseUrl: "https://x.atlassian.net", email: "me@x.com", apiToken: "tok", fetchFn }),
    unconfigured: () => new HttpAtlassianClient({ baseUrl: "https://x.atlassian.net", email: "me@x.com", apiToken: "tok" }),
    source: (fetchFn) =>
      new AtlassianSource(new HttpAtlassianClient({ baseUrl: "https://x.atlassian.net", email: "me@x.com", apiToken: "tok", fetchFn }), {
        projects: ["PROJ"],
        spaces: ["SPACE"],
      }),
    // one Jira search, one Confluence search
    requests: 2,
  },
  HttpSlackClient: {
    client: (fetchFn) => new HttpSlackClient({ token: "xoxb-test", fetchFn }),
    unconfigured: () => new HttpSlackClient({ token: "xoxb-test" }),
    // A channel ID rather than a #name, so the ingest is one history read and does
    // not depend on the fixture answering conversations.list as well.
    source: (fetchFn) => new SlackSource(new HttpSlackClient({ token: "xoxb-test", fetchFn }), { channels: ["C0123ABCD"] }),
    requests: 1,
  },
  HttpActionsClient: {
    client: (fetchFn) => new HttpActionsClient({ repo: "owner/repo", token: "ghp_test", fetchFn }),
    // No token on purpose: an unauthenticated public-repo read is what
    // `context.ts` builds when no GitHub credential is held, and it is the one
    // live path in this product that gets no brokered transport at all.
    unconfigured: () => new HttpActionsClient({ repo: "owner/repo" }),
    source: (fetchFn) =>
      new ActionsSource(new HttpActionsClient({ repo: "owner/repo", fetchFn }), {
        repo: "owner/repo",
        today: () => "2026-07-21",
      }),
    // one page; the fixture returns fewer runs than the page size, so paging stops
    requests: 1,
  },
};

/** The transport an already-constructed client is holding. */
function transportOf(client: object): ReadOnlyFetch {
  const held = (client as Record<string, unknown>)[TRANSPORT_FIELD];
  expect(typeof held, `${client.constructor.name} no longer keeps its transport on "${TRANSPORT_FIELD}"`).toBe("function");
  return held as ReadOnlyFetch;
}

/* ------------------------------------------------------------------ *
 * 0 — the fixture is a permissive remote, so a refusal means something
 * ------------------------------------------------------------------ */

describe("the control: the fake remote really does accept a write", () => {
  test("a write reaches it and comes back 200 — so nothing below is the remote's doing", async () => {
    const calls: Call[] = [];
    const remote = permissiveRemote(calls);
    const res = await remote("https://slack.com/api/conversations.history?channel=C1", {
      method: "POST",
      headers: {},
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ url: "https://slack.com/api/conversations.history?channel=C1", verb: "POST" }]);
  });
});

/* ------------------------------------------------------------------ *
 * 1 — the guard itself
 * ------------------------------------------------------------------ */

describe("getOnlyFetch refuses every verb but GET, before anything is sent", () => {
  for (const verb of WRITE_VERBS) {
    test(`${verb} is refused in this process and the transport is never reached`, async () => {
      const calls: Call[] = [];
      const guarded = getOnlyFetch(permissiveRemote(calls));
      await expect(guarded("https://api.github.com/repos/o/r/actions/runs", { method: verb, headers: {} })).rejects.toBeInstanceOf(
        NonGetRequestError,
      );
      expect(calls, `${verb} left this process — the refusal would have been the remote's to make`).toEqual([]);
    });
  }

  test("GET passes through — the guard is a discriminator, not an alarm that is always on", async () => {
    const calls: Call[] = [];
    const guarded = getOnlyFetch(permissiveRemote(calls));
    const res = await guarded("https://api.github.com/repos/o/r/actions/runs", { method: "GET", headers: { Accept: "x" } });
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.verb)).toEqual(["GET"]);
  });

  test("an omitted verb is a read, not a guess — the guard puts GET on the wire itself", async () => {
    const calls: Call[] = [];
    const guarded = getOnlyFetch(permissiveRemote(calls));
    await guarded("https://slack.com/api/conversations.history", {} as never);
    expect(calls.map((c) => c.verb)).toEqual(["GET"]);
  });

  test("a body is refused even under GET — a payload is how a write dresses as a read", async () => {
    const calls: Call[] = [];
    const guarded = getOnlyFetch(permissiveRemote(calls));
    await expect(
      guarded("https://slack.com/api/chat.postMessage", { method: "GET", headers: {}, body: '{"text":"hi"}' } as never),
    ).rejects.toBeInstanceOf(NonGetRequestError);
    expect(calls).toEqual([]);
  });

  test("the refusal names itself, so a failed ingest can tell 'we did not ask' from 'they said no'", async () => {
    const guarded = getOnlyFetch(permissiveRemote([]));
    const error = await guarded("https://slack.com/api/chat.postMessage", { method: "POST", headers: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(NonGetRequestError);
    expect((error as NonGetRequestError).verb).toBe("POST");
    expect((error as NonGetRequestError).url).toBe("https://slack.com/api/chat.postMessage");
  });
});

/* ------------------------------------------------------------------ *
 * 2 — every shipped client holds it
 * ------------------------------------------------------------------ */

describe("every HTTP client this repository ships is built over the guard", () => {
  const shipped = shippedClientNames();

  test("the scan found clients to judge, and the driving table covers exactly them", () => {
    // Zero would make every assertion below pass on an empty list, and a fourth
    // client must fail here rather than ship unguarded and untested.
    expect(shipped.length).toBeGreaterThanOrEqual(3);
    expect(Object.keys(DRIVE).sort()).toEqual(shipped);
  });

  for (const name of Object.keys(DRIVE)) {
    test(`${name}'s own transport refuses a write, with a permissive remote underneath`, async () => {
      const calls: Call[] = [];
      const transport = transportOf(DRIVE[name].client(permissiveRemote(calls)));
      for (const verb of WRITE_VERBS) {
        await expect(transport("https://example.invalid/anything", { method: verb, headers: {} })).rejects.toBeInstanceOf(
          NonGetRequestError,
        );
      }
      expect(calls, `${name} let a write reach the remote — its token's scope is now the only thing deciding`).toEqual([]);
    });

    test(`${name} constructed with no transport at all is guarded the same way`, async () => {
      // The `?? globalThis.fetch` fallback used to be written out once per client,
      // which is once per client that could be reached raw. For the actions client
      // this is not a corner: an unauthenticated public-repo read is its live path.
      const transport = transportOf(DRIVE[name].unconfigured());
      await expect(transport("https://example.invalid/anything", { method: "POST", headers: {} })).rejects.toBeInstanceOf(
        NonGetRequestError,
      );
    });
  }

  test("no adapter reaches the platform transport outside the guard's own module", () => {
    // The guard is only the single door if there is no second one. Read from
    // disk, so a client that imports `getOnlyFetch` and keeps a raw fallback
    // beside it is caught even though its constructor looks right.
    //
    // The pattern is `globalThis` alone rather than `globalThis.fetch`, and that
    // is deliberate: the cast the old fallback was written with
    // (`(globalThis as unknown as { fetch: FetchFn }).fetch`) puts thirty
    // characters between the two words, so a check spelled `globalThis\.fetch`
    // would have missed the very expression it was written to catch. No adapter
    // has any other business with the global object.
    const stray: string[] = [];
    for (const entry of fs.readdirSync(adapterDir)) {
      if (!entry.endsWith(".ts") || entry === "get-only-client.ts") continue;
      const src = fs.readFileSync(path.join(adapterDir, entry), "utf8");
      if (/\bglobalThis\b/.test(src)) stray.push(entry);
    }
    expect(stray, "an adapter reaches the platform transport directly — the guard is no longer the only door").toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — a full ingest
 * ------------------------------------------------------------------ */

describe("a full ingest issues nothing but GETs", () => {
  test("every source is driven end to end and every request that left was a GET", async () => {
    const calls: Call[] = [];
    const perSource: Record<string, number> = {};

    for (const [name, driven] of Object.entries(DRIVE)) {
      const before = calls.length;
      const source = driven.source(permissiveRemote(calls));
      const result = await source.fetchSince(null);
      perSource[name] = calls.length - before;
      // Non-vacuity per source: a client that silently made no request at all
      // would contribute nothing to the verb assertion while looking covered.
      expect(perSource[name], `${name} issued no request — it contributed nothing to this check`).toBe(driven.requests);
      expect(result.items.length, `${name} fetched nothing — the ingest it is standing in for did not happen`).toBeGreaterThan(0);
    }

    expect(calls.length).toBe(Object.values(DRIVE).reduce((n, d) => n + d.requests, 0));
    expect(
      calls.filter((c) => c.verb !== "GET").map((c) => `${c.verb} ${c.url}`),
      "an ingest issued something other than a GET",
    ).toEqual([]);
  });

  test("and the same ingest run against a remote that refuses reads still never attempts a write", async () => {
    // The other end of the permissive fixture: when the remote says no, the
    // client's error path must not retry as anything else. This is where a
    // "fall back to POST /search" would show up.
    const calls: Call[] = [];
    const refusing: UnderlyingFetch = async (url, init) => {
      calls.push({ url, verb: (init as { method?: string }).method ?? "<none>" });
      return {
        ok: false,
        status: 403,
        async json() {
          return {};
        },
        async text() {
          return "insufficient scope";
        },
      };
    };

    for (const driven of Object.values(DRIVE)) {
      await driven.source(refusing).fetchSince(null).catch(() => undefined);
    }
    expect(calls.length, "no request was made at all — the refusal path proves nothing").toBeGreaterThan(0);
    expect(calls.filter((c) => c.verb !== "GET")).toEqual([]);
  });
});
