/**
 * The overlap lock (F2) — two firings must not run against one vault, and a
 * stale lock must never need a human.
 *
 * The bug this replaced was not in the logic, it was in the syscalls:
 * `fs.writeFileSync(p, rec, {flag:"wx"})` is create-then-write, and between the
 * two the lock exists and is ZERO BYTES. Measured over 20,000 trials, a second
 * firing lands in that window, reads `""`, calls the lock unreadable, breaks it
 * and proceeds — and both firings run. `linkSync` publishes the name only when
 * the content is already complete.
 *
 * **What the tests below can and cannot prove.** The last one spawns four real
 * processes and asserts exactly one wins, which pins mutual exclusion across
 * process boundaries. It does *not* reliably catch the zero-byte window:
 * reverting `linkSync` to `writeFileSync(…,{flag:"wx"})` leaves it green on
 * every run, because the window is a few microseconds wide and four spawns do
 * not land in it. Recorded here rather than dressed up — the atomicity is an
 * argument about the syscalls, and the test is a regression guard around it.
 * The rest pin the contract: a live lock is not breakable, and every way a lock
 * can go stale clears itself.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  acquireFiringLock,
  firingLockPath,
  readFiringLock,
  releaseFiringLock,
  stampFiringLock,
  staleness,
} from "../../src/loop/lock.js";

const MINUTE = 60_000;
const TTL = 60 * MINUTE;

let vault: string;
beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-lock-"));
  fs.mkdirSync(path.join(vault, ".git"));
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

const lockFile = () => firingLockPath(vault)!;

describe("one holder at a time", () => {
  test("a second acquire is refused while the first is live", () => {
    const first = acquireFiringLock(vault, { ttlMs: TTL });
    expect(first.ok).toBe(true);
    const second = acquireFiringLock(vault, { ttlMs: TTL });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toMatch(/another firing holds the lock/);
  });

  test("the lock on disk is a complete record the moment it exists", () => {
    acquireFiringLock(vault, { ttlMs: TTL });
    expect(fs.statSync(lockFile()).size).toBeGreaterThan(0);
    expect(readFiringLock(vault)?.pid).toBe(process.pid);
  });

  test("releasing lets the next firing in", () => {
    const first = acquireFiringLock(vault, { ttlMs: TTL });
    if (!first.ok) throw new Error("setup");
    expect(releaseFiringLock(vault, { pid: first.record.pid, acquiredAt: first.record.acquiredAt })).toBe(true);
    expect(acquireFiringLock(vault, { ttlMs: TTL }).ok).toBe(true);
  });

  test("a run id survives the process boundary, so `loop seal` can release what `loop start` took", () => {
    const first = acquireFiringLock(vault, { ttlMs: TTL });
    if (!first.ok) throw new Error("setup");
    stampFiringLock(vault, first.record, "run-1");
    expect(readFiringLock(vault)?.runId).toBe("run-1");
    // A seal that is not this run's must not release somebody else's lock.
    expect(releaseFiringLock(vault, { runId: "run-2" })).toBe(false);
    expect(releaseFiringLock(vault, { runId: "run-1" })).toBe(true);
  });
});

describe("stale locks break themselves — a lock that needs a human is worse than no lock", () => {
  const held = (over: Partial<{ pid: number; holderPid: number; host: string; acquiredAt: string }> = {}) => ({
    pid: process.pid, host: os.hostname(), acquiredAt: new Date(Date.now()).toISOString(), ...over,
  });
  /** Above every default pid_max, so nothing is ever running there. */
  const DEAD_PID = 4_194_303;

  test("a live holder inside the TTL is not stale", () => {
    expect(staleness(held({ holderPid: process.pid }), { now: Date.now(), ttlMs: TTL, host: os.hostname() }).stale).toBe(false);
  });

  test("past the TTL it is stale, whoever holds it and wherever they are", () => {
    const s = staleness(held({ host: "some-other-host" }), { now: Date.now() + TTL, ttlMs: TTL, host: os.hostname() });
    expect(s.stale).toBe(true);
    expect(s.why).toMatch(/TTL/);
  });

  test("a dead holder pid on this host is stale immediately — the TTL is the backstop, not the rule", () => {
    const s = staleness(held({ holderPid: DEAD_PID }), { now: Date.now(), ttlMs: TTL, host: os.hostname() });
    expect(s.stale).toBe(true);
    expect(s.why).toMatch(/is gone/);
  });

  test("a dead holder pid on ANOTHER host is not stale on pid grounds — pid liveness does not cross machines", () => {
    const s = staleness(held({ holderPid: DEAD_PID, host: "elsewhere" }), { now: Date.now(), ttlMs: TTL, host: os.hostname() });
    expect(s.stale).toBe(false);
  });

  test("a lock that named no holder is judged on the TTL alone, never on the writer's pid", () => {
    // `loop start` exits in milliseconds. If its own pid counted as the holder,
    // every lock would be breakable from the moment it was taken.
    const s = staleness(held({ pid: DEAD_PID }), { now: Date.now(), ttlMs: TTL, host: os.hostname() });
    expect(s.stale).toBe(false);
  });

  test("an unreadable record is stale, so a truncated lock cannot deadlock the vault forever", () => {
    fs.mkdirSync(path.dirname(lockFile()), { recursive: true });
    fs.writeFileSync(lockFile(), "");
    const r = acquireFiringLock(vault, { ttlMs: TTL });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.broke?.why).toMatch(/unreadable/);
  });

  test("an expired lock is broken and the new firing runs", () => {
    const first = acquireFiringLock(vault, { ttlMs: TTL });
    if (!first.ok) throw new Error("setup");
    const later = acquireFiringLock(vault, { ttlMs: TTL, now: Date.now() + TTL + MINUTE });
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.broke?.why).toMatch(/past the 60m TTL/);
  });
});

describe("under real concurrency, exactly one firing wins", () => {
  test("four overlapping processes race for one vault", async () => {
    const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
    const worker = path.join(vault, "race.ts");
    const lockModule = path.resolve(__dirname, "../../src/loop/lock.ts");
    // Each winner HOLDS for a moment before exiting. Without that the processes
    // would not overlap, every predecessor's pid would be dead by the time the
    // next looked, and each would legitimately break a stale lock and win —
    // correct behaviour, and not the property under test.
    fs.writeFileSync(
      worker,
      `import { acquireFiringLock } from ${JSON.stringify(lockModule)};\n` +
        `const r = acquireFiringLock(process.argv[2], { ttlMs: 3_600_000 });\n` +
        `console.log(r.ok ? "won" : "lost");\n` +
        // A pending timer, not a top-level await: the worker is written outside
        // the repo, so it inherits no `"type": "module"` and tsx treats it as CJS.
        `if (r.ok) setTimeout(() => {}, 1500);\n`,
      "utf8",
    );

    const results = await Promise.all(
      ["a", "b", "c", "d"].map(
        () =>
          new Promise<string>((resolve, reject) => {
            const child = spawn(tsx, [worker, vault], { stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            child.stdout.on("data", (d) => (out += String(d)));
            child.on("error", reject);
            child.on("close", () => resolve(out.trim()));
          }),
      ),
    );
    expect(results.filter((r) => r === "won")).toHaveLength(1);
    expect(results.filter((r) => r === "lost")).toHaveLength(3);
  }, 60_000);
});
