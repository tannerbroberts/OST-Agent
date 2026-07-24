import { describe, expect, test } from "vitest";
import {
  SlackSource,
  HttpSlackClient,
  tsToIso,
  type SlackClient,
  type SlackMessage,
} from "../../src/adapters/slack.js";

function fakeClient(messages: SlackMessage[]): SlackClient {
  return {
    async fetchMessages() {
      return messages;
    },
  };
}

const msg = (channel: string, ts: string, text: string): SlackMessage => ({ channel, ts, text });

describe("SlackSource mapping + incremental cursor", () => {
  test("maps messages to normalized EvidenceItems (id, title, ISO timestamp)", async () => {
    const src = new SlackSource(fakeClient([msg("C1", "1626170400.000100", "Users keep asking for a daily reason\nsecond line")]), {
      channels: ["C1"],
    });
    const { items } = await src.fetchSince(null);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("SLACK:C1:1626170400.000100");
    expect(items[0].source).toBe("SLACK:C1:1626170400.000100");
    expect(items[0].title).toBe("#C1: Users keep asking for a daily reason"); // first line only
    expect(items[0].body).toContain("second line");
    expect(items[0].timestamp).toBe(tsToIso("1626170400.000100"));
  });

  test("drops empty / whitespace-only messages", async () => {
    const src = new SlackSource(fakeClient([msg("C1", "1", "   "), msg("C1", "2", "real content")]), { channels: ["C1"] });
    const { items } = await src.fetchSince(null);
    expect(items.map((i) => i.id)).toEqual(["SLACK:C1:2"]);
  });

  test("advances the cursor and does not re-emit already-seen boundary items", async () => {
    const src = new SlackSource(
      fakeClient([msg("C1", "1626170400.000100", "first"), msg("C1", "1626170500.000200", "second")]),
      { channels: ["C1"] },
    );
    const first = await src.fetchSince(null);
    expect(first.items.map((i) => i.id).sort()).toEqual(["SLACK:C1:1626170400.000100", "SLACK:C1:1626170500.000200"]);

    const second = await src.fetchSince(first.cursor);
    expect(second.items).toHaveLength(0);
  });

  test("emits only genuinely newer messages on the next run", async () => {
    const src1 = new SlackSource(fakeClient([msg("C1", "1626170400.000100", "first")]), { channels: ["C1"] });
    const first = await src1.fetchSince(null);

    const src2 = new SlackSource(
      fakeClient([msg("C1", "1626170400.000100", "first"), msg("C1", "1626180000.000000", "later")]),
      { channels: ["C1"] },
    );
    const second = await src2.fetchSince(first.cursor);
    expect(second.items.map((i) => i.id)).toEqual(["SLACK:C1:1626180000.000000"]);
  });

  test("skips a source with no channels configured (no client call)", async () => {
    let called = false;
    const client: SlackClient = {
      async fetchMessages() {
        called = true;
        return [];
      },
    };
    const src = new SlackSource(client, { channels: [] });
    const { items } = await src.fetchSince(null);
    expect(items).toHaveLength(0);
    expect(called).toBe(false);
  });
});

describe("HttpSlackClient request shape (injected fetch)", () => {
  test("issues GET requests with Bearer auth, an oldest filter, and skips system subtypes", async () => {
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    const fetchFn = async (url: string, init: { method: string; headers: Record<string, string> }) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            messages: [
              { ts: "1626170400.000100", user: "U1", text: "a real message" },
              { ts: "1626170500.000200", subtype: "channel_join", text: "U2 has joined" },
            ],
          };
        },
        async text() {
          return "";
        },
      };
    };
    const client = new HttpSlackClient({ token: "xoxb-test", fetchFn });

    const out = await client.fetchMessages({ channels: ["C0123ABCD"], since: "1626170000.000000" });

    expect(calls).toHaveLength(1); // an id passes straight through — no conversations.list lookup
    expect(calls[0].method).toBe("GET"); // read-only
    expect(calls[0].url).toContain("/api/conversations.history");
    expect(calls[0].url).toContain("channel=C0123ABCD");
    expect(calls[0].url).toContain("oldest=1626170000.000000");
    expect(calls[0].headers.Authorization).toBe("Bearer xoxb-test");
    // system-event subtype dropped; only the human message remains
    expect(out.map((m) => m.ts)).toEqual(["1626170400.000100"]);
  });

  test("resolves a #channel-name to an id via conversations.list, then reads that id's history", async () => {
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      const body = url.includes("conversations.list")
        ? { ok: true, channels: [{ id: "C0999XYZ", name: "discovery" }, { id: "C0111AAA", name: "random" }] }
        : { ok: true, messages: [{ ts: "1626170400.000100", text: "an insight" }] };
      return { ok: true, status: 200, async json() { return body; }, async text() { return ""; } };
    };
    const client = new HttpSlackClient({ token: "xoxb-test", fetchFn });

    const out = await client.fetchMessages({ channels: ["#discovery"], since: null });

    expect(calls.some((u) => u.includes("conversations.list"))).toBe(true);
    const history = calls.find((u) => u.includes("conversations.history"))!;
    expect(history).toContain("channel=C0999XYZ"); // resolved name → id
    expect(out[0].channel).toBe("C0999XYZ"); // evidence keys on the stable id, not the name
  });

  test("throws a clear error when a channel name cannot be resolved", async () => {
    const fetchFn = async (url: string) => ({
      ok: true,
      status: 200,
      async json() {
        return url.includes("conversations.list") ? { ok: true, channels: [{ id: "C1", name: "general" }] } : { ok: true, messages: [] };
      },
      async text() {
        return "";
      },
    });
    const client = new HttpSlackClient({ token: "xoxb-test", fetchFn });
    await expect(client.fetchMessages({ channels: ["#nonexistent"], since: null })).rejects.toThrow(/nonexistent.*not found/);
  });

  test("throws on a Slack API-level error (ok:false)", async () => {
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      async json() {
        return { ok: false, error: "not_in_channel" };
      },
      async text() {
        return "";
      },
    });
    const client = new HttpSlackClient({ token: "xoxb-test", fetchFn });
    await expect(client.fetchMessages({ channels: ["C1"], since: null })).rejects.toThrow(/not_in_channel/);
  });
});
