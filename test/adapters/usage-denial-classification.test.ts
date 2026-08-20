/**
 * The instrument attached to "Every refusal a surface returns is recorded as
 * tree evidence, not just as a failed call" — specifically the feasibility
 * assumption beneath it, "A permission denial is distinguishable from a tool
 * failing on its own terms".
 *
 * The risk the assumption names: if a denial is told apart from an ordinary
 * error by pattern-matching the message a host or broker happened to write,
 * the classifier is wearing wording it does not own, and it goes quietly wrong
 * the moment that wording changes. So every check here rewrites the message
 * strings of both a denied call and a failing call and re-asserts the same
 * verdict — proving the classification came from the `denied` field stamped at
 * capture, never from the prose.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { classifyUsageEvent, UsageSource } from "../../src/adapters/usage.js";
import {
  PermissionDeniedError,
  usageLogPath,
  withUsageTracing,
  type UsageEvent,
} from "../../src/telemetry/usage.js";
import { brokeredFetch } from "../../src/security/brokered-fetch.js";
import type { CredentialBroker } from "../../src/security/broker.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-usage-denial-"));
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

const BASE: UsageEvent = {
  ts: "2026-08-05T10:00:00.000Z",
  tool: "ost_read_web",
  ok: false,
  ms: 4,
  surface: "mcp",
  argBytes: 20,
};

/** The real specimen this assumption names: 2026-08-05, `ost_read_repo`. */
const REAL_ERROR_SPECIMEN = "no product repos configured";

describe("classifyUsageEvent — a denial and a tool error land as different records", () => {
  test("a denied call and a tool's own error classify into different kinds", () => {
    const denied: UsageEvent = { ...BASE, denied: true, err: "credential broker denied GET https://x (out-of-scope): target not in grant" };
    const error: UsageEvent = { ...BASE, tool: "ost_read_repo", err: REAL_ERROR_SPECIMEN };

    expect(classifyUsageEvent(denied)).toBe("denied");
    expect(classifyUsageEvent(error)).toBe("error");
  });

  test("the verdict does not move when both messages are rewritten — it was never read from the prose", () => {
    // The denial's message is rewritten to carry NONE of the words a naive
    // matcher would look for ("denied", "grant", "permission").
    const denied: UsageEvent = { ...BASE, denied: true, err: "the upstream said something unrelated entirely" };
    // The error's message is rewritten to carry ALL of those words, which is
    // exactly the trap a wording-based classifier falls into.
    const error: UsageEvent = {
      ...BASE,
      tool: "ost_read_repo",
      err: "permission denied: this request needed a grant nobody gave it",
    };

    expect(classifyUsageEvent(denied)).toBe("denied");
    expect(classifyUsageEvent(error)).toBe("error");
  });

  test("a successful call is neither", () => {
    expect(classifyUsageEvent({ ...BASE, ok: true, err: undefined })).toBe("ok");
  });
});

describe("withUsageTracing — denial is stamped from the thrown error's type, not its text", () => {
  test("a PermissionDeniedError is captured as denied; a plain Error with similar wording is not", async () => {
    const [deniedTool, errorTool] = withUsageTracing(
      [
        {
          name: "ost_read_web",
          run: async () => {
            throw new PermissionDeniedError("credential broker denied GET https://x (out-of-scope): target not in grant");
          },
        },
        {
          name: "ost_read_repo",
          run: async () => {
            // Deliberately words this like a denial. It must not classify as one:
            // this thrower has no structural knowledge that it was refused for
            // lack of a grant, so it is honestly a plain Error.
            throw new Error("permission denied: no grant covers this");
          },
        },
      ],
      dir,
      "mcp",
    );

    await expect(deniedTool.run(undefined as never)).rejects.toThrow(PermissionDeniedError);
    await expect(errorTool.run(undefined as never)).rejects.toThrow(Error);

    const [deniedEvent, errorEvent] = readEvents();
    expect(classifyUsageEvent(deniedEvent)).toBe("denied");
    expect(classifyUsageEvent(errorEvent)).toBe("error");
  });
});

describe("brokeredFetch — the real specimen: a broker refusal is structurally a denial", () => {
  function fakeDeniedBroker(): CredentialBroker {
    return {
      names: [],
      holds: () => false,
      handle: () => {
        throw new Error("not held");
      },
      request: async () => ({ status: "denied", reason: "out-of-scope", why: "target not in grant" }),
    };
  }

  test("brokeredFetch throws PermissionDeniedError, not a plain Error, when the broker denies", async () => {
    const fetchFn = brokeredFetch(fakeDeniedBroker(), "adapter:test");
    await expect(fetchFn("https://evil.example/api/x")).rejects.toThrow(PermissionDeniedError);
  });

  test("that denial, traced end to end, lands in the usage log as denied — and the classification survives a reworded `why`", async () => {
    for (const why of ["target not in grant", "this string has nothing to do with permissions or grants at all"]) {
      const broker: CredentialBroker = {
        names: [],
        holds: () => false,
        handle: () => {
          throw new Error("not held");
        },
        request: async () => ({ status: "denied", reason: "out-of-scope", why }),
      };
      const [tool] = withUsageTracing(
        [{ name: "ost_read_web", run: () => brokeredFetch(broker, "adapter:test")("https://evil.example/api/x") }],
        dir,
        "mcp",
      );
      await expect(tool.run(undefined as never)).rejects.toThrow();
    }

    const events = readEvents();
    expect(events).toHaveLength(2);
    for (const event of events) expect(classifyUsageEvent(event)).toBe("denied");
  });
});

describe("UsageSource — a day's rollup reports denied and failed calls as different records", () => {
  const TODAY = "2026-08-07";

  test("denied and failed calls are counted, tabled, and sampled separately, naming the tool and surface", async () => {
    const file = path.join(dir, "events.jsonl");
    const events: UsageEvent[] = [
      { ...BASE, ts: "2026-08-05T10:00:00.000Z", denied: true, err: "credential broker denied GET https://x (out-of-scope): target not in grant" },
      { ...BASE, ts: "2026-08-05T10:00:01.000Z", tool: "ost_read_repo", err: REAL_ERROR_SPECIMEN },
      { ...BASE, ts: "2026-08-05T10:00:02.000Z", ok: true, err: undefined },
    ];
    fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");

    const { items } = await new UsageSource({ file, minEvents: 2, today: () => TODAY }).fetchSince(null);
    expect(items).toHaveLength(1);
    const body = items[0].body;

    expect(body).toContain("1 denied");
    expect(body).toContain("1 failed");
    expect(body).toContain("Denied calls");
    expect(body).toMatch(/ost_read_web.*mcp.*target not in grant/);
    expect(body).toContain("Failed calls");
    expect(body).toContain(REAL_ERROR_SPECIMEN);
  });
});
