import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  recordUsageEvent,
  usageLogPath,
  withAttribution,
  withUsageTracing,
  type UsageEvent,
} from "../../src/telemetry/usage.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-usage-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readEvents(): UsageEvent[] {
  const file = usageLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEvent);
}

describe("recordUsageEvent", () => {
  test("appends JSONL under .ost-agent/usage, creating the directory", () => {
    recordUsageEvent(dir, { ts: "2026-07-24T10:00:00.000Z", tool: "ost_annotate", ok: true, ms: 12, surface: "cli-tool", argBytes: 40 });
    recordUsageEvent(dir, { ts: "2026-07-24T10:00:01.000Z", tool: "ost_create_node", ok: false, ms: 5, surface: "mcp", argBytes: 900, err: "no such parent" });

    const events = readEvents();
    expect(events).toHaveLength(2);
    expect(events[0].tool).toBe("ost_annotate");
    expect(events[1].ok).toBe(false);
    expect(events[1].err).toBe("no such parent");
  });

  test("never throws when the log location is unwritable (fail-open)", () => {
    // occupy the .ost-agent/usage path with a FILE so mkdir/append must fail
    fs.mkdirSync(path.join(dir, ".ost-agent"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".ost-agent", "usage"), "not a directory", "utf8");

    expect(() =>
      recordUsageEvent(dir, { ts: "2026-07-24T10:00:00.000Z", tool: "ost_annotate", ok: true, ms: 1, surface: "cli-tool", argBytes: 2 }),
    ).not.toThrow();
  });
});

describe("withUsageTracing", () => {
  test("passes results through and records a success event with timing and size", async () => {
    const [tool] = withUsageTracing(
      [{ name: "ost_read_tree", run: async (input: never) => `ok:${JSON.stringify(input)}` }],
      dir,
      "mcp",
    );

    const result = await tool.run({ hello: "world" } as never);

    expect(result).toBe('ok:{"hello":"world"}');
    const [event] = readEvents();
    expect(event.tool).toBe("ost_read_tree");
    expect(event.ok).toBe(true);
    expect(event.surface).toBe("mcp");
    expect(event.argBytes).toBe(Buffer.byteLength('{"hello":"world"}'));
    expect(event.ms).toBeGreaterThanOrEqual(0);
  });

  test("rethrows errors untouched while recording a redacted failure event", async () => {
    const [tool] = withUsageTracing(
      [
        {
          name: "ost_set_status",
          run: async () => {
            throw new Error("boom: token=ghp_abcdefghijklmnopqrstuvwxyz0123456789");
          },
        },
      ],
      dir,
      "pass:P5_hygiene",
    );

    await expect(tool.run({} as never)).rejects.toThrow(/^boom/);
    const [event] = readEvents();
    expect(event.ok).toBe(false);
    expect(event.surface).toBe("pass:P5_hygiene");
    expect(event.err).toBeDefined();
    expect(event.err).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
  });

  test("records only size, never input content", async () => {
    const [tool] = withUsageTracing([{ name: "ost_annotate", run: async () => "annotated" }], dir, "cli-tool");
    await tool.run({ title: "Secret Roadmap Node", issue: "very private detail" } as never);

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    expect(raw).not.toContain("Secret Roadmap Node");
    expect(raw).not.toContain("very private detail");
    expect((JSON.parse(raw) as UsageEvent).argBytes).toBeGreaterThan(0);
  });
});

/**
 * H5 — attribution comes from the surface, never from the environment.
 *
 * The pairing in this block is the whole test: each "the environment cannot
 * author this" assertion sits beside a "but a surface that declares it CAN"
 * assertion on the same field. Without the second, every one of these would pass
 * on a build where attribution was simply never recorded at all — which is how a
 * green suite hides a broken feature rather than a fixed one.
 */
const DARK = "How many users hit the export path";

describe("attribution to an unknown", () => {
  test("a surface that declares an unknown gets it stamped on every event", async () => {
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp", { unknown: DARK });
    await tool.run(undefined as never);
    expect(readEvents()[0].unknown).toBe(DARK);
  });

  test("omits the field entirely when the surface declares no unknown", async () => {
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
    await tool.run(undefined as never);
    expect("unknown" in readEvents()[0]).toBe(false);
  });

  test("attributes a failed call too — a wasted attempt is the point", async () => {
    const [tool] = withUsageTracing(
      [{ name: "ost_read_tree", run: async () => { throw new Error("nope"); } }],
      dir,
      "mcp",
      { unknown: "U" },
    );
    await expect(tool.run(undefined as never)).rejects.toThrow("nope");
    const event = readEvents()[0];
    expect(event.ok).toBe(false);
    expect(event.unknown).toBe("U");
  });

  test("resolves the declaration per invocation, not at wrap time — a surface may work a different unknown next call", async () => {
    // The function form is what the per-call surfaces use. Wrapping happens once;
    // the answer is asked for again on every call.
    let current: string | undefined;
    const [tool] = withUsageTracing(
      [{ name: "ost_read_tree", run: async () => "ok" }],
      dir,
      "mcp",
      () => (current ? { unknown: current } : undefined),
    );

    current = "First unknown";
    await tool.run(undefined as never);
    current = "Second unknown";
    await tool.run(undefined as never);
    current = undefined;
    await tool.run(undefined as never);

    const events = readEvents();
    expect(events).toHaveLength(3);
    expect(events[0].unknown).toBe("First unknown");
    expect(events[1].unknown).toBe("Second unknown");
    expect("unknown" in events[2]).toBe(false);
  });

  test("an unrelated shell's OST_UNKNOWN/OST_SESSION reach the trace in no form at all", async () => {
    // The criterion's check, verbatim: distinctive values, a real call through a
    // wrapped surface, and neither value in the record. Distinctive so that a
    // substring scan of the raw JSONL is meaningful — the assertion is not just
    // "the field differs" but "this string is nowhere in the event".
    process.env.OST_UNKNOWN = "AMBIENT-UNKNOWN-b7f1e2";
    process.env.OST_SESSION = "AMBIENT-SESSION-9c4a08";
    try {
      const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
      await tool.run(undefined as never);
    } finally {
      delete process.env.OST_UNKNOWN;
      delete process.env.OST_SESSION;
    }

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    expect(raw).not.toContain("AMBIENT-UNKNOWN-b7f1e2");
    expect(raw).not.toContain("AMBIENT-SESSION-9c4a08");
    const event = readEvents()[0];
    expect("unknown" in event).toBe(false);
    expect("session" in event).toBe(false);
    // NON-VACUITY: the same wrapper, the same call, the same log — with the
    // surface declaring instead of the shell. Proven by reintroducing the removed
    // fallback in `resolveAttribution` (`?? { session: process.env.OST_SESSION,
    // unknown: process.env.OST_UNKNOWN }`) and re-running: this test, and only
    // this test, went red. So the `not.toContain` assertions are about where a
    // value came from, not about a trace that happens to record nothing.
    const [declaring] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp", {
      session: "SURFACE-SESSION-114477",
      unknown: "SURFACE-UNKNOWN-556699",
    });
    await declaring.run(undefined as never);
    const stamped = readEvents()[1];
    expect(stamped.session).toBe("SURFACE-SESSION-114477");
    expect(stamped.unknown).toBe("SURFACE-UNKNOWN-556699");
  });

  test("a blank declaration is absence, not a group of its own", async () => {
    // A surface that computes attribution and comes up empty must not create a
    // `session: ""` bucket that later grouping would count as a real run.
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp", {
      session: "   ",
      unknown: "",
    });
    await tool.run(undefined as never);
    const event = readEvents()[0];
    expect("session" in event).toBe(false);
    expect("unknown" in event).toBe(false);
  });
});

describe("withAttribution — the scope a surface enters around one dispatched call", () => {
  test("stamps tools that were wrapped with no attribution of their own", async () => {
    // This is the MCP server's shape: `buildOstTools` wraps once, knowing
    // nothing, and the dispatcher declares per call.
    const [tool] = withUsageTracing([{ name: "ost_annotate", run: async () => "ok" }], dir, "mcp");

    await withAttribution({ session: "mcp-fixed-for-test", unknown: DARK }, () => tool.run(undefined as never));
    // …and a second call outside the scope, which must carry nothing. Same tool
    // object, so a stale value would show up here.
    await tool.run(undefined as never);

    const events = readEvents();
    expect(events[0].session).toBe("mcp-fixed-for-test");
    expect(events[0].unknown).toBe(DARK);
    expect("session" in events[1]).toBe(false);
    expect("unknown" in events[1]).toBe(false);
  });

  test("survives the tool's own awaits and does not leak past a throw", async () => {
    const [tool] = withUsageTracing(
      [
        {
          name: "ost_read_web",
          run: async () => {
            await new Promise((r) => setTimeout(r, 5));
            throw new Error("upstream said no");
          },
        },
      ],
      dir,
      "mcp",
    );

    await expect(
      withAttribution({ session: "S1", unknown: "U1" }, () => tool.run(undefined as never)),
    ).rejects.toThrow("upstream said no");
    // Same tool object, same failure, no scope: a declaration that outlived its
    // scope would show up on this second record.
    await expect(tool.run(undefined as never)).rejects.toThrow("upstream said no");

    const events = readEvents();
    expect(events[0].ok).toBe(false);
    expect(events[0].unknown).toBe("U1");
    expect("unknown" in events[1]).toBe(false);
  });

  test("two concurrent calls each keep their own attribution", async () => {
    // Each call parks on a promise until both are in flight, so they are
    // genuinely interleaved rather than merely started in the same tick.
    //
    // HONEST LIMIT, because this test alone does not prove what it looks like it
    // proves: it passes on a plain module-global implementation of
    // `withAttribution` too (verified by substituting one — `let ambient; set;
    // try { return fn(); } finally { ambient = prev; }` — and watching all 26
    // tests stay green). `resolveAttribution` runs synchronously at the top of
    // the wrapped `run`, still inside the setter's own tick, so the global is
    // never observed stale HERE. The next test is the one that separates the two
    // implementations.
    let releaseFirst: () => void = () => {};
    const firstParked = new Promise<void>((r) => (releaseFirst = r));
    const [slow] = withUsageTracing([{ name: "ost_read_tree", run: async () => { await firstParked; return "ok"; } }], dir, "mcp");
    const [fast] = withUsageTracing([{ name: "ost_annotate", run: async () => "ok" }], dir, "mcp");

    const a = withAttribution({ unknown: "Unknown A" }, () => slow.run(undefined as never));
    await withAttribution({ unknown: "Unknown B" }, () => fast.run(undefined as never));
    releaseFirst();
    await a;

    const events = readEvents();
    // B finished first, so it is the first line; A's record must still say A.
    expect(events[0].tool).toBe("ost_annotate");
    expect(events[0].unknown).toBe("Unknown B");
    expect(events[1].tool).toBe("ost_read_tree");
    expect(events[1].unknown).toBe("Unknown A");
  });

  test("the declaration survives an await INSIDE the scope, which is the property only a per-context store has", async () => {
    // The shape any surface takes the moment it does work between declaring and
    // dispatching — awaiting a lock, a queue, a commit — and the shape that
    // tells `AsyncLocalStorage` apart from a module-level variable. With a
    // global, `withAttribution` returns as soon as the callback yields its
    // promise, and the `finally` restores the previous value long before the
    // parked continuation reaches the tool; the second dispatch then runs and
    // clears it again. So the resumed call reads nothing.
    //
    // NON-VACUITY, proven not asserted: substituting the module-global
    // implementation described in the previous test's comment reddens exactly
    // this test's last assertion (`unknown` absent, expected "Unknown A"), and
    // nothing else in the file. Reverted.
    let releaseA: () => void = () => {};
    const aParked = new Promise<void>((r) => (releaseA = r));
    const [slow] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
    const [fast] = withUsageTracing([{ name: "ost_annotate", run: async () => "ok" }], dir, "mcp");

    const a = withAttribution({ unknown: "Unknown A" }, async () => {
      await aParked;
      return slow.run(undefined as never);
    });
    // B declares, dispatches and finishes entirely while A sits mid-scope.
    await withAttribution({ unknown: "Unknown B" }, () => fast.run(undefined as never));
    releaseA();
    await a;

    const events = readEvents();
    expect(events[0].tool).toBe("ost_annotate");
    expect(events[0].unknown).toBe("Unknown B");
    expect(events[1].tool).toBe("ost_read_tree");
    expect(events[1].unknown).toBe("Unknown A");
  });

  test("an explicit declaration at wrap time beats the ambient scope rather than blending with it", async () => {
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp", {
      unknown: "Declared by the wrapper",
    });
    await withAttribution({ session: "scope-session", unknown: "Declared by the scope" }, () =>
      tool.run(undefined as never),
    );

    const event = readEvents()[0];
    expect(event.unknown).toBe("Declared by the wrapper");
    // Not half-stamped from two authorities: the scope's session does not ride
    // along on the wrapper's unknown.
    expect("session" in event).toBe(false);
  });
});
