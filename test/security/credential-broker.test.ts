/**
 * The credential broker's spec — the instrument attached to "A broker holds the
 * credential and answers scoped, audited requests from the run".
 *
 * The node's argument is that a broker beats both of its siblings (short-lived
 * scoped tokens, batched approvals) on exactly one thing: it leaves a record of
 * what the credential was actually used for. So the three properties asserted
 * here are the three the argument rests on — the run gets the result and never
 * the secret, a request outside the written scope does not happen at all, and
 * every request lands in the log with who asked, for what, and what came back.
 *
 * What a green here does NOT settle, stated in the node and repeated here so
 * nobody reads this file as more than it is: whether an operator would hand a
 * long-lived secret to a process that acts for a run. That is a desirability
 * question, it is the assumption this spec hangs beneath, and no test can answer
 * it. This file says the containment is real, not that anybody wants it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  createCredentialBroker,
  isCredentialHandle,
  memoryAuditSink,
  type AuditRecord,
  type Grant,
} from "../../src/security/broker.js";
import { brokeredFetch, httpGetAction, HTTP_GET } from "../../src/security/brokered-fetch.js";
import { credentialAuditPath, fileAuditSink, readCredentialAudit } from "../../src/security/credential-audit.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { credentialBrokerFromEnv, ASKER_SLACK, CREDENTIAL_SLACK } from "../../src/runner/credentials.js";

const SECRET = "xoxb-the-real-slack-token-9999";
const OTHER_SECRET = "brave-key-abcdefghijklmnop";

/** A fixed clock: audit timestamps are data, and data in tests must not drift. */
const clock = () => "2026-08-05T00:00:00.000Z";

function grants(over: Partial<Grant> = {}): Grant[] {
  return [
    {
      asker: "adapter:slack",
      action: "read",
      credential: "slack",
      targets: ["https://slack.com/api/*", "https://slack.com/exact"],
      ...over,
    },
  ];
}

describe("containment — the run gets the result and never the secret", () => {
  test("the action sees the secret; the caller sees only what came back", async () => {
    let seenBySecretHolder = "";
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      now: clock,
      actions: {
        read: ({ secret, target }) => {
          seenBySecretHolder = secret;
          return { messages: 2, target };
        },
      },
    });

    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });

    expect(seenBySecretHolder).toBe(SECRET);
    expect(res.status).toBe("performed");
    expect(JSON.stringify(res)).not.toContain(SECRET);
    // The request never named a credential — the grant table decided which one answers.
    expect(res).toEqual({ status: "performed", result: { messages: 2, target: "https://slack.com/api/x" } });
  });

  test("a result that echoes the secret is scrubbed before the run sees it", async () => {
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      now: clock,
      // The whole point: the broker does not trust the action not to leak.
      actions: { read: ({ secret }) => ({ echoed: `used ${secret}`, nested: [{ deep: secret }] }) },
    });

    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/exact" });

    expect(JSON.stringify(res)).not.toContain(SECRET);
    expect(res).toMatchObject({ result: { echoed: "used [redacted]", nested: [{ deep: "[redacted]" }] } });
  });

  test("a failure that names the secret is scrubbed too", async () => {
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      now: clock,
      actions: {
        read: () => {
          throw new Error(`401 rejecting token ${SECRET}`);
        },
      },
    });

    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/y" });

    expect(res.status).toBe("failed");
    expect(JSON.stringify(res)).not.toContain(SECRET);
    if (res.status === "failed") expect(res.why).toBe("401 rejecting token [redacted]");
  });

  test("the broker hands out no accessor for a secret, and a handle is not one", () => {
    const broker = createCredentialBroker({
      credentials: { slack: SECRET, search: OTHER_SECRET },
      grants: grants(),
      now: clock,
      actions: { read: () => "ok" },
    });

    // Names, never values — this is the entire introspection surface.
    expect([...broker.names].sort()).toEqual(["search", "slack"]);
    expect(JSON.stringify(broker)).not.toContain(SECRET);
    expect(Object.values(broker).join(" ")).not.toContain(SECRET);

    const handle = broker.handle("slack");
    expect(handle).not.toContain(SECRET);
    expect(isCredentialHandle(handle)).toBe(true);
    expect(() => broker.handle("nope")).toThrow(/no credential named "nope"/);
  });

  test("a secret too short to redact is refused rather than held unscrubbable", () => {
    expect(() =>
      createCredentialBroker({ credentials: { slack: "tok" }, grants: [], actions: {} }),
    ).toThrow(/shorter than 8 characters/);
  });
});

describe("scope — a request outside the written grant does not happen", () => {
  function spyBroker(over: Partial<Grant> = {}) {
    const calls: string[] = [];
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(over),
      audit,
      now: clock,
      actions: {
        read: ({ target }) => {
          calls.push(target);
          return "ok";
        },
      },
    });
    return { broker, calls, audit };
  }

  test("a target under the granted prefix is allowed", async () => {
    const { broker, calls } = spyBroker();
    const res = await broker.request({
      asker: "adapter:slack",
      action: "read",
      target: "https://slack.com/api/conversations.history?limit=100",
    });
    expect(res.status).toBe("performed");
    expect(calls).toEqual(["https://slack.com/api/conversations.history?limit=100"]);
  });

  test("a target outside it is denied and the action never runs", async () => {
    const { broker, calls } = spyBroker();
    const res = await broker.request({
      asker: "adapter:slack",
      action: "read",
      target: "https://slack.com/files/secret.pdf",
    });
    expect(res).toMatchObject({ status: "denied", reason: "out-of-scope" });
    expect(calls).toEqual([]);
  });

  test("the prefix does not leak sideways into a neighbouring path", async () => {
    const { broker, calls } = spyBroker();
    // "https://slack.com/api/*" must not admit "https://slack.com/apiary…" — the
    // boundary is the slash, and this is the mistake a looser pattern language makes.
    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/apiary" });
    expect(res).toMatchObject({ status: "denied", reason: "out-of-scope" });
    expect(calls).toEqual([]);
  });

  test("an asker with no grant at all is denied", async () => {
    const { broker, calls } = spyBroker();
    const res = await broker.request({ asker: "someone-else", action: "read", target: "https://slack.com/api/x" });
    expect(res).toMatchObject({ status: "denied", reason: "no-grant" });
    expect(calls).toEqual([]);
  });

  test("an action the broker was not built with is denied, not attempted", async () => {
    const { broker } = spyBroker();
    const res = await broker.request({ asker: "adapter:slack", action: "write", target: "https://slack.com/api/x" });
    expect(res).toMatchObject({ status: "denied", reason: "unknown-action" });
  });

  test("an ambiguous wildcard is refused when the broker is built, not when the request arrives", () => {
    expect(() =>
      createCredentialBroker({
        credentials: { slack: SECRET },
        grants: grants({ targets: ["https://slack.com/api*"] }),
        actions: { read: () => "ok" },
      }),
    ).toThrow(/the only wildcard form is a trailing "\/\*"/);
  });

  test("a grant naming a credential nobody holds is refused at construction", () => {
    expect(() =>
      createCredentialBroker({
        credentials: { slack: SECRET },
        grants: grants({ credential: "github" }),
        actions: { read: () => "ok" },
      }),
    ).toThrow(/names credential "github", which is not held/);
  });

  test("an empty scope is refused rather than read as a grant", () => {
    expect(() =>
      createCredentialBroker({
        credentials: { slack: SECRET },
        grants: grants({ targets: [] }),
        actions: { read: () => "ok" },
      }),
    ).toThrow(/lists no targets/);
  });
});

describe("audit — who asked, for what, and what came back", () => {
  test("a performed request leaves both phases, with the credential named and the result summarized", async () => {
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit,
      now: clock,
      actions: { read: () => ({ messages: 3 }) },
    });

    await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/history" });

    expect(audit.records.map((r) => r.phase)).toEqual(["request", "outcome"]);
    const [asked, answered] = audit.records;
    expect(asked).toMatchObject({
      at: "2026-08-05T00:00:00.000Z",
      phase: "request",
      asker: "adapter:slack",
      action: "read",
      target: "https://slack.com/api/history",
      credential: "slack",
    });
    expect(answered).toMatchObject({ phase: "outcome", outcome: "performed", detail: '{"messages":3}' });
    // Both phases carry the same id, which is what joins a use to its outcome.
    expect(asked.id).toBe(answered.id);
  });

  test("a denied request is logged too — a refusal is a thing that happened", async () => {
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit,
      now: clock,
      actions: { read: () => "ok" },
    });

    await broker.request({ asker: "adapter:slack", action: "read", target: "https://evil.example/api/x" });

    expect(audit.records).toHaveLength(2);
    expect(audit.records[1]).toMatchObject({ outcome: "denied", reason: "out-of-scope" });
    // Nothing was spent, so nothing may claim a credential was.
    expect(audit.records[0].credential).toBeUndefined();
  });

  test("no audit record carries the secret, whatever the action does with it", async () => {
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit,
      now: clock,
      actions: { read: ({ secret }) => `sent ${secret}` },
    });

    await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });

    expect(JSON.stringify(audit.records)).not.toContain(SECRET);
    expect(audit.records[1].detail).toBe("sent [redacted]");
  });

  test("a use that never returns is still visible as a use", async () => {
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit,
      now: clock,
      // Stands in for the action that hangs, or the process that is killed
      // mid-flight: the outcome line is never written.
      actions: { read: () => new Promise<never>(() => {}) },
    });

    void broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });
    await Promise.resolve();

    expect(audit.records).toHaveLength(1);
    expect(audit.records[0]).toMatchObject({ phase: "request", credential: "slack" });
  });

  test("no record, no action: an unwritable log denies the request before the credential is touched", async () => {
    const calls: string[] = [];
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit: () => {
        throw new Error("disk full");
      },
      now: clock,
      actions: {
        read: ({ target }) => {
          calls.push(target);
          return "ok";
        },
      },
    });

    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });

    expect(res).toMatchObject({ status: "denied", reason: "unauditable" });
    expect(calls).toEqual([]);
  });

  test("a log that fails AFTER the action says so rather than reading clean", async () => {
    let written = 0;
    const broker = createCredentialBroker({
      credentials: { slack: SECRET },
      grants: grants(),
      audit: () => {
        if (++written > 1) throw new Error("disk full");
      },
      now: clock,
      actions: { read: () => "ok" },
    });

    const res = await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });

    // The action ran; it cannot be un-run by a failed write. What the broker
    // refuses to do is hand the result back looking fully recorded.
    expect(res).toEqual({ status: "performed", result: "ok", auditIncomplete: true });
  });

  test("the file sink appends JSONL into the vault and reads back in order", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-broker-"));
    try {
      const broker = createCredentialBroker({
        credentials: { slack: SECRET },
        grants: grants(),
        audit: fileAuditSink(dir),
        now: clock,
        actions: { read: () => "ok" },
      });

      await broker.request({ asker: "adapter:slack", action: "read", target: "https://slack.com/api/x" });
      await broker.request({ asker: "adapter:slack", action: "read", target: "https://nope.example/x" });

      expect(fs.existsSync(credentialAuditPath(dir))).toBe(true);
      const records: AuditRecord[] = readCredentialAudit(dir);
      expect(records.map((r) => `${r.phase}:${r.outcome ?? "-"}`)).toEqual([
        "request:-",
        "outcome:performed",
        "request:-",
        "outcome:denied",
      ]);
      expect(fs.readFileSync(credentialAuditPath(dir), "utf8")).not.toContain(SECRET);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the brokered fetch — how a real client stops holding a token", () => {
  const SLACK_GRANT: Grant[] = [
    { asker: ASKER_SLACK, action: HTTP_GET, credential: CREDENTIAL_SLACK, targets: ["https://slack.com/api/*"] },
  ];

  function httpBroker(respond: (url: string, headers: Record<string, string>) => { status?: number; body?: string }) {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const audit = memoryAuditSink();
    const broker = createCredentialBroker({
      credentials: { [CREDENTIAL_SLACK]: SECRET },
      grants: SLACK_GRANT,
      audit,
      now: clock,
      actions: {
        [HTTP_GET]: httpGetAction(async (url, init) => {
          seen.push({ url, headers: init.headers });
          const r = respond(url, init.headers);
          return {
            ok: (r.status ?? 200) < 400,
            status: r.status ?? 200,
            headers: { get: () => null },
            text: async () => r.body ?? "{}",
          };
        }),
      },
    });
    return { broker, seen, audit };
  }

  test("the client holds a handle; the wire carries the secret", async () => {
    const { broker, seen } = httpBroker(() => ({ body: '{"ok":true}' }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    // Exactly what HttpSlackClient composes, over the handle it was constructed with.
    const res = await fetchFn("https://slack.com/api/conversations.history?limit=2", {
      method: "GET",
      headers: { Authorization: `Bearer ${broker.handle(CREDENTIAL_SLACK)}`, Accept: "application/json" },
    });

    expect(seen[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.ok).toBe(true);
  });

  test("HTTP Basic is substituted inside the base64, not left as a handle", async () => {
    const { broker, seen } = httpBroker(() => ({ body: "{}" }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);
    const composed = Buffer.from(`me@example.com:${broker.handle(CREDENTIAL_SLACK)}`, "utf8").toString("base64");

    await fetchFn("https://slack.com/api/x", { method: "GET", headers: { Authorization: `Basic ${composed}` } });

    const sent = seen[0].headers.Authorization.replace(/^Basic /, "");
    expect(Buffer.from(sent, "base64").toString("utf8")).toBe(`me@example.com:${SECRET}`);
  });

  test("a URL outside the grant is refused and no request is made", async () => {
    const { broker, seen } = httpBroker(() => ({ body: "{}" }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    await expect(
      fetchFn("https://evil.example/api/x", { method: "GET", headers: { Authorization: "Bearer x" } }),
    ).rejects.toThrow(/denied GET https:\/\/evil\.example\/api\/x \(out-of-scope\)/);
    expect(seen).toEqual([]);
  });

  test("a handle that survives substitution is never sent — it names a credential this grant did not resolve", async () => {
    const { broker, seen } = httpBroker(() => ({ body: "{}" }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    await expect(
      fetchFn("https://slack.com/api/x", { method: "GET", headers: { Authorization: "Bearer ost-credential:github" } }),
    ).rejects.toThrow(/still carries a credential handle/);
    expect(seen).toEqual([]);
  });

  test("the brokered action performs GET and refuses anything else", async () => {
    const { broker, seen } = httpBroker(() => ({ body: "{}" }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    await expect(fetchFn("https://slack.com/api/x", { method: "POST", headers: {} })).rejects.toThrow(/GET only/);
    expect(seen).toEqual([]);
  });

  test("the body is scrubbed even when the vendor echoes the credential back", async () => {
    const { broker } = httpBroker(() => ({ body: `{"token":"${SECRET}"}` }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    const res = await fetchFn("https://slack.com/api/x", { method: "GET", headers: {} });
    expect(await res.text()).toBe('{"token":"[redacted]"}');
  });

  test("every brokered request lands in the log with the URL it was spent on", async () => {
    const { broker, audit } = httpBroker(() => ({ body: "{}" }));
    const fetchFn = brokeredFetch(broker, ASKER_SLACK);

    await fetchFn("https://slack.com/api/conversations.list", { method: "GET", headers: {} });

    expect(audit.records[0]).toMatchObject({
      asker: ASKER_SLACK,
      action: HTTP_GET,
      target: "https://slack.com/api/conversations.list",
      credential: CREDENTIAL_SLACK,
    });
  });
});

describe("the broker this product runs with", () => {
  const ENV_KEYS = ["SLACK_BOT_TOKEN", "ATLASSIAN_API_TOKEN", "ATLASSIAN_BASE_URL", "BRAVE_SEARCH_API_KEY"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("each credential is scoped to the one host and path prefix its adapter reads", async () => {
    const { broker } = credentialBrokerFromEnv({
      env: {
        SLACK_BOT_TOKEN: SECRET,
        ATLASSIAN_API_TOKEN: "atlassian-token-0123456789",
        ATLASSIAN_BASE_URL: "https://acme.atlassian.net/",
        BRAVE_SEARCH_API_KEY: OTHER_SECRET,
      },
      fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" }),
    });

    expect([...broker.names].sort()).toEqual(["atlassian", "search", "slack"]);

    const ask = (asker: string, target: string) => broker.request({ asker, action: HTTP_GET, target, args: {} });

    expect((await ask("adapter:slack", "https://slack.com/api/conversations.list")).status).toBe("performed");
    expect((await ask("adapter:slack", "https://slack.com/files/x")).status).toBe("denied");
    // One adapter's grant is not another's.
    expect((await ask("adapter:slack", "https://acme.atlassian.net/rest/api/3/x")).status).toBe("denied");
    expect((await ask("adapter:atlassian", "https://acme.atlassian.net/rest/api/3/x")).status).toBe("performed");
    expect((await ask("adapter:atlassian", "https://acme.atlassian.net/admin")).status).toBe("denied");
    expect((await ask("web:search", "https://api.search.brave.com/res/v1/web/search?q=x")).status).toBe("performed");
    expect((await ask("web:search", "https://api.search.brave.com/other")).status).toBe("denied");
  });

  test("a credential that cannot be held is reported by name and reason, never silently dropped", () => {
    const { broker, problems } = credentialBrokerFromEnv({ env: { SLACK_BOT_TOKEN: "tok" } });
    expect(broker.holds(CREDENTIAL_SLACK)).toBe(false);
    expect(problems[CREDENTIAL_SLACK]).toMatch(/too short/);
    expect(problems.search).toMatch(/BRAVE_SEARCH_API_KEY is not set/);
  });

  test("the broker is not reachable from the tool surface", () => {
    // The safety invariant is unchanged by this feature: the broker is
    // constructed by the runner and consumed by adapters. A model can ask a
    // brokered adapter for what it could already ask; it cannot ask the broker.
    expect(ALLOWED_TOOL_NAMES.filter((n) => /broker|credential|secret|token/i.test(n))).toEqual([]);
  });
});
