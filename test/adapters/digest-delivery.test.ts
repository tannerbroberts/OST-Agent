/**
 * The digest arrives.
 *
 * This is the instrument on "Three-week digest engagement run", and its scope is
 * narrower than that test's name. Engagement — what a stakeholder does with a
 * digest once it lands — takes three weeks and real people, and nothing here
 * touches it. What is asserted is the precondition that run cannot happen
 * without, and which nothing in this repository did before:
 *
 *   1. a digest is produced on the DECLARED cadence, and on no cadence at all
 *      when none is declared;
 *   2. it is PUSHED to the configured destination rather than left in the vault
 *      — a destination inside the vault is refused, by name;
 *   3. it names what changed SINCE THE PREVIOUS DIGEST rather than restating the
 *      whole ledger, so the second digest of a quiet week is not the first one
 *      again;
 *   4. a cadence window that elapses with nothing sent is reported as a MISS,
 *      through a value a caller branches on and an exit code a cron can see —
 *      never by passing silently.
 *
 * Green here means the pipe is real. It does not mean anyone read it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  composeDigest,
  deliverDigest,
  evaluateDigestCadence,
  fileDropTransport,
  isInsideVault,
  readDeliveries,
  renderDigest,
  type DigestDelivery,
  type DigestTransport,
} from "../../src/adapters/digest.js";
import type { LoopRunRecord } from "../../src/loop/health.js";
import type { PendingAsk } from "../../src/ost/pending-asks.js";

let root: string;
let vault: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-digest-"));
  vault = path.join(root, "vault");
  outside = path.join(root, "stakeholder-drop");
  fs.mkdirSync(vault, { recursive: true });
  // The delivery ledger lives under `.git/ost-agent/`, for the reason the loop's
  // own ledger does: git will not track anything inside its own directory, so a
  // record of what was sent cannot be swept into the next `git add -A` commit.
  // No repo, no delivery — asserted below.
  execFileSync("git", ["init", "-q"], { cwd: vault });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.parse("2026-08-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

const run = (id: string, offsetMs: number, verdict?: LoopRunRecord["verdict"]): LoopRunRecord => ({
  runId: id,
  startedAt: at(offsetMs),
  loopVersion: "test",
  cliVersion: "test",
  steps: [],
  ...(verdict ? { verdict } : {}),
});

const ask = (title: string): PendingAsk => ({
  test: title,
  lane: "humans-required",
  askedAt: at(0),
  ageDays: 3,
  why: "needs five real stakeholders",
  command: `ost-agent record-result "${title}"`,
});

const delivery = (over: Partial<DigestDelivery> = {}): DigestDelivery => ({
  at: at(0),
  coveredThrough: at(0),
  transport: "file-drop",
  destination: path.join(outside, "prior-digest.md"),
  changes: 0,
  ...over,
});

/** A transport that records instead of sending, so the assertions are about content. */
const capturing = (): DigestTransport & { sent: { subject: string; body: string }[] } => {
  const sent: { subject: string; body: string }[] = [];
  return {
    name: "capture",
    sent,
    send(message) {
      sent.push(message);
      return `capture://${sent.length}`;
    },
  };
};

const seedLedger = (records: DigestDelivery[]): void => {
  const dir = path.join(vault, ".git", "ost-agent");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "digests.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
};

describe("a digest goes out on the declared cadence, and on no other", () => {
  test("no declared cadence is never due — the vault sends nothing it was not asked to send", () => {
    const verdict = evaluateDigestCadence({ deliveries: [], now: T0 + 400 * DAY, cadenceMs: null });
    expect(verdict.status).toBe("undeclared");
    // Not a miss. Nothing was promised, so nothing was skipped — a default here
    // would be this repository choosing how often to interrupt somebody's team.
    expect(verdict.missed).toBe(0);
  });

  test("a vault that has never sent one is due immediately", () => {
    expect(evaluateDigestCadence({ deliveries: [], now: T0, cadenceMs: 7 * DAY }).status).toBe("due");
  });

  test("inside the window it is not due, and says when it will be", () => {
    const verdict = evaluateDigestCadence({ deliveries: [delivery()], now: T0 + 2 * DAY, cadenceMs: 7 * DAY });
    expect(verdict.status).toBe("not-elapsed");
    expect(verdict.nextDueAt).toBe(at(7 * DAY));
    expect(verdict.missed).toBe(0);
  });

  test("one window past the last delivery it is due, and nothing was missed", () => {
    const verdict = evaluateDigestCadence({ deliveries: [delivery()], now: T0 + 7 * DAY, cadenceMs: 7 * DAY });
    expect(verdict.status).toBe("due");
    expect(verdict.missed).toBe(0);
  });

  test("a delivery stamped in the future does not bound the window", () => {
    // R2's wedge: one future stamp would otherwise answer "when did this last go
    // out" until the clock caught up, and the way out cannot be hand-editing a
    // JSONL file. The record is ignored for the window and counted separately.
    const verdict = evaluateDigestCadence({
      deliveries: [delivery({ at: at(90 * DAY) }), delivery({ at: at(0) })],
      now: T0 + 8 * DAY,
      cadenceMs: 7 * DAY,
    });
    expect(verdict.status).toBe("due");
    expect(verdict.lastDeliveredAt).toBe(at(0));
    expect(verdict.ignoredFuture).toBe(1);
  });

  test("`digest.cadence` is what decides it — the same string the config takes", () => {
    const settings = { cadence: "7d", destination: outside };
    const early = deliverDigest({ dir: vault, settings, runs: [], asks: [], now: new Date(T0) });
    expect(early.outcome).toBe("delivered");
    const soon = deliverDigest({ dir: vault, settings, runs: [], asks: [], now: new Date(T0 + DAY) });
    expect(soon.outcome).toBe("not-elapsed");
    const later = deliverDigest({ dir: vault, settings, runs: [], asks: [], now: new Date(T0 + 8 * DAY) });
    expect(later.outcome).toBe("delivered");
  });
});

describe("it is pushed where the stakeholder is, not left in the vault", () => {
  test("a due digest lands at the configured destination, outside the vault", () => {
    const result = deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [run("r1", -DAY, "healthy")],
      asks: [],
      now: new Date(T0),
    });
    expect(result.outcome).toBe("delivered");
    const landed = result.destination!;
    expect(fs.existsSync(landed)).toBe(true);
    expect(isInsideVault(vault, landed)).toBe(false);
    expect(fs.readFileSync(landed, "utf8")).toContain("r1");
  });

  test("nothing about the digest is written into the vault tree", () => {
    // The failure mode this whole node exists against: a "digest" that is one
    // more file in the vault is the problem restated as its solution. The tree
    // is byte-identical after a delivery — only `.git/ost-agent/` moves.
    const before = fs.readdirSync(vault).filter((e) => e !== ".git");
    deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [],
      asks: [],
      now: new Date(T0),
    });
    expect(fs.readdirSync(vault).filter((e) => e !== ".git")).toEqual(before);
  });

  test("a destination inside the vault is REFUSED, and says why", () => {
    const result = deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: ".ost-agent/digests" },
      runs: [],
      asks: [],
      now: new Date(T0),
    });
    expect(result.outcome).toBe("refused");
    expect(result.reason).toMatch(/inside the vault/);
    // Refused means NOT sent: the ledger stays empty, so the next run is still due.
    expect(readDeliveries(vault)).toHaveLength(0);
  });

  test("the vault root itself counts as inside, and so does a `..` that comes back", () => {
    expect(isInsideVault(vault, ".")).toBe(true);
    expect(isInsideVault(vault, "sub/dir")).toBe(true);
    expect(isInsideVault(vault, "../out/../vault/inner")).toBe(true);
    expect(isInsideVault(vault, "../stakeholder-drop")).toBe(false);
    expect(isInsideVault(vault, outside)).toBe(false);
  });

  test("the transport, not config, says where it landed — and the ledger records that", () => {
    const transport = capturing();
    const result = deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [],
      asks: [],
      transport,
      now: new Date(T0),
    });
    expect(result.destination).toBe("capture://1");
    expect(readDeliveries(vault)[0]).toMatchObject({ transport: "capture", destination: "capture://1" });
  });

  test("a transport that throws delivers nothing, and the ledger does not claim otherwise", () => {
    const exploding: DigestTransport = {
      name: "broken",
      send() {
        throw new Error("no route to host");
      },
    };
    expect(() =>
      deliverDigest({
        dir: vault,
        settings: { cadence: "7d", destination: outside },
        runs: [],
        asks: [],
        transport: exploding,
        now: new Date(T0),
      }),
    ).toThrow(/no route to host/);
    // The window stays open. A send that failed must not close it, or the failure
    // is laundered into a delivery nobody received.
    expect(readDeliveries(vault)).toHaveLength(0);
  });

  test("the file-drop transport names files from the DELIVERY stamp, not its own clock", () => {
    // Regression: naming from `new Date()` collided whenever two deliveries
    // covering different windows ran inside one millisecond of wall time — which
    // is every test run and any backfill. Two logical stamps, two files.
    const transport = fileDropTransport(outside);
    const first = transport.send({ subject: "s1", body: "b1", at: at(0) });
    const second = transport.send({ subject: "s2", body: "b2", at: at(7 * DAY) });
    expect(first).not.toBe(second);
    expect(fs.readFileSync(first, "utf8")).toContain("s1");
    expect(fs.readFileSync(second, "utf8")).toContain("s2");
    // A genuine same-stamp collision throws rather than clobbering an unread digest.
    expect(() => transport.send({ subject: "s3", body: "b3", at: at(0) })).toThrow(/EEXIST/);
  });
});

describe("it names what changed since the last one, not the whole ledger", () => {
  test("the first digest covers everything on record", () => {
    const d = composeDigest({
      runs: [run("r1", -3 * DAY, "healthy"), run("r2", -DAY, "unhealthy")],
      asks: [],
      since: null,
      through: at(0),
      missed: 0,
    });
    expect(d.changes.map((c) => c.runId)).toEqual(["r2", "r1"]);
    expect(renderDigest(d)).toContain("everything on record");
  });

  test("the second digest names ONLY what happened after the first one's window closed", () => {
    const transport = capturing();
    const runs = [run("old", -3 * DAY, "healthy"), run("fresh", 8 * DAY, "unhealthy")];
    const settings = { cadence: "7d", destination: outside };
    deliverDigest({ dir: vault, settings, runs, asks: [], transport, now: new Date(T0) });
    deliverDigest({ dir: vault, settings, runs, asks: [], transport, now: new Date(T0 + 9 * DAY) });

    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[0].body).toContain("old");
    // The whole claim: the second digest is not the first one again.
    expect(transport.sent[1].body).toContain("fresh");
    expect(transport.sent[1].body).not.toContain("old");
    expect(transport.sent[1].body).toContain(`since ${at(0)}`);
  });

  test("a quiet window says so rather than restating the tree", () => {
    const transport = capturing();
    const runs = [run("only", -DAY, "healthy")];
    const settings = { cadence: "7d", destination: outside };
    deliverDigest({ dir: vault, settings, runs, asks: [], transport, now: new Date(T0) });
    deliverDigest({ dir: vault, settings, runs, asks: [], transport, now: new Date(T0 + 7 * DAY) });
    expect(transport.sent[1].body).toContain("nothing — no pass fired in this window");
    expect(transport.sent[1].body).not.toContain("only");
  });

  test("it carries the one or two things that need a person, and never hides the rest", () => {
    const d = composeDigest({
      runs: [],
      asks: [ask("A"), ask("B"), ask("C"), ask("D")],
      since: at(0),
      through: at(DAY),
      missed: 0,
    });
    expect(d.asks).toHaveLength(2);
    expect(d.asksTotal).toBe(4);
    const body = renderDigest(d);
    expect(body).toContain("2 more waiting");
    expect(body).toContain('ost-agent record-result "A"');
  });

  test("a future-stamped delivery does not open the window ahead of now", () => {
    // The bounding record is found by the stamp the verdict used, not by position
    // on the ledger. Reading `coveredThrough` off a future record would silently
    // empty a digest that had a full window of changes in it.
    seedLedger([delivery({ at: at(0), coveredThrough: at(0) }), delivery({ at: at(90 * DAY), coveredThrough: at(90 * DAY) })]);
    const transport = capturing();
    deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [run("in-window", 3 * DAY, "healthy")],
      asks: [],
      transport,
      now: new Date(T0 + 8 * DAY),
    });
    expect(transport.sent[0].body).toContain("in-window");
  });
});

describe("a window that went by with nothing sent is reported as a miss", () => {
  test("three windows elapsed since the last delivery is two missed, not a clean due", () => {
    const verdict = evaluateDigestCadence({ deliveries: [delivery()], now: T0 + 21 * DAY, cadenceMs: 7 * DAY });
    expect(verdict.status).toBe("due");
    expect(verdict.missed).toBe(2);
    expect(verdict.reason).toMatch(/MISSED/);
  });

  test("the miss reaches the caller on the result, not only buried in the verdict", () => {
    const result = deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [],
      asks: [],
      transport: capturing(),
      now: new Date(T0),
    });
    expect(result.missed).toBe(0);

    const late = deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [],
      asks: [],
      transport: capturing(),
      now: new Date(T0 + 30 * DAY),
    });
    expect(late.outcome).toBe("delivered");
    expect(late.missed).toBe(3);
    expect(late.reason).toMatch(/missed/i);
  });

  test("the digest that finally goes out says the earlier ones did not", () => {
    seedLedger([delivery({ at: at(0), coveredThrough: at(0) })]);
    const transport = capturing();
    deliverDigest({
      dir: vault,
      settings: { cadence: "7d", destination: outside },
      runs: [],
      asks: [],
      transport,
      now: new Date(T0 + 22 * DAY),
    });
    expect(transport.sent[0].body).toMatch(/^MISSED: 2 digest window\(s\)/);
  });

  test("a miss inside a window is not invented — skew must not read as a skipped send", () => {
    const verdict = evaluateDigestCadence({
      deliveries: [delivery()],
      now: T0 + 7 * DAY + HOUR,
      cadenceMs: 7 * DAY,
    });
    expect(verdict.missed).toBe(0);
  });

  test("`ost-agent digest` exits non-zero on a miss and on a refusal, and zero otherwise", () => {
    // Driven through the COMMITTED bundle, like `test/release/bundle.test.ts`,
    // because the exit code is the only part of this a cron can read and the
    // artefact is what a cron runs. A silent cadence has to be observable by
    // something that is not a human reading prose.
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "ost-agent.mjs");
    const write = (yaml: string) => fs.writeFileSync(path.join(vault, "ost.config.yaml"), yaml);
    const exitOf = (): number => {
      const r = spawnSync("node", [cli, "digest", "--vault", vault], { encoding: "utf8" });
      expect(r.error, String(r.error)).toBeUndefined();
      return r.status ?? 1;
    };

    // A vault that asked for no digest is not failing to send one.
    write('outcome: "test outcome"\n');
    expect(exitOf()).toBe(0);

    // A destination inside the vault is a misconfiguration a cron must see.
    write('outcome: "test outcome"\ndigest:\n  cadence: "7d"\n  destination: ".ost-agent/out"\n');
    expect(exitOf()).toBe(1);

    // Declared and reachable: sends, exits 0.
    write(`outcome: "test outcome"\ndigest:\n  cadence: "7d"\n  destination: ${JSON.stringify(outside)}\n`);
    expect(exitOf()).toBe(0);
    expect(readDeliveries(vault)).toHaveLength(1);

    // Rewrite history to a delivery long past: windows went by with nothing sent.
    // It still sends — and it still exits 1, because the miss is the finding.
    seedLedger([delivery({ at: at(-40 * DAY), coveredThrough: at(-40 * DAY) })]);
    expect(exitOf()).toBe(1);
  });
});

describe("nothing is delivered where nothing can be recorded", () => {
  test("a vault with no git checkout refuses rather than sending on every run forever", () => {
    const bare = path.join(root, "not-a-repo");
    fs.mkdirSync(bare);
    expect(() =>
      deliverDigest({
        dir: bare,
        settings: { cadence: "7d", destination: outside },
        runs: [],
        asks: [],
        transport: capturing(),
        now: new Date(T0),
      }),
    ).toThrow(/refuses to deliver where it cannot record/);
  });

  test("a junk ledger line is dropped, not repaired into a window bound", () => {
    const dir = path.join(vault, ".git", "ost-agent");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "digests.jsonl"),
      ["{not json", JSON.stringify({ at: "whenever", coveredThrough: at(0) }), JSON.stringify(delivery())].join("\n") + "\n",
    );
    expect(readDeliveries(vault)).toHaveLength(1);
  });
});
