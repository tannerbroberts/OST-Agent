/**
 * Crash a run holding the lock and time how long the vault stays unusable.
 *
 * The assumption under test is that a stale lock can be recovered *safely* —
 * that there is a policy which is neither so eager it breaks locks somebody
 * still holds (the concurrent write the lock existed to prevent, manufactured by
 * the thing meant to prevent it) nor so patient that a crash on a Friday costs
 * the weekend. Two bars, both fixed by the node before any of this ran:
 *
 *   1. the vault is usable again within FIFTEEN MINUTES in every scenario;
 *   2. recovery never once releases a lock that is still genuinely held.
 *
 * Four scenarios, because they are four different things a holder can stop being:
 *
 *   - **clean exit** — the process ended without releasing. `loop start` takes
 *     the lock and `loop seal` releases it; anything that ends the firing in
 *     between leaves exactly this.
 *   - **hard kill** — SIGKILL. No handler runs, nothing is cleaned up.
 *   - **hung but still holding** — SIGSTOP. The truest form: a live pid, a
 *     valid record, an owner that will never do another thing. Every rule based
 *     on liveness says this lock is fine.
 *   - **machine sleep** — the holder frozen AND the observer frozen with it,
 *     so wall-clock time runs while nothing runs. This is the trap: it
 *     manufactures, for free, every symptom a crash produces, against a holder
 *     that did nothing wrong and will resume mid-sentence.
 *
 * ## What is real here and what is simulated
 *
 * Stated plainly, because a test that measures fifteen minutes is a test nobody
 * runs, and the seam is where such a test goes wrong.
 *
 * REAL: the holder is a separate OS process holding a real lock file; the kills
 * are real signals; `kill -0` liveness, the `link`/`rename` break, and every
 * recovery decision are the shipping code paths.
 *
 * SIMULATED: elapsed wall time, and only that. Both the waiter and the holder
 * read their `now` from one clock the test advances — the holder through a file
 * it polls, so its heartbeats land on the same timeline the waiter judges them
 * against. Advancing that clock by fifteen minutes is the only thing here that
 * is not what it claims to be, and machine sleep is *modelled* by advancing it
 * across a SIGSTOP rather than by suspending a laptop.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  acquireFiringLock,
  readFiringLock,
  staleAfterFor,
  stampFiringLock,
  touchFiringLock,
  waitForFiringLock,
  type LockRecord,
  type WaitClock,
  type WaitObservation,
} from "../../src/loop/lock.js";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** The node's own bar. Not derived from anything the implementation chose. */
const RECOVERY_BAR_MS = 15 * MINUTE;

/** The cadence the holder promises. `loop.lockHeartbeatMinutes` in a real vault. */
const HEARTBEAT_EVERY_MS = 1 * MINUTE;
const STALE_AFTER_MS = staleAfterFor(HEARTBEAT_EVERY_MS);
const CONFIRM_MS = 1 * MINUTE;
const POLL_MS = 30 * SECOND;
const TTL_MS = 60 * MINUTE;

/** An arbitrary but fixed epoch, so no assertion depends on when the suite ran. */
const EPOCH = Date.parse("2026-08-28T09:00:00.000Z");

let vault: string;
let clockFile: string;
let workerFile: string;
let children: ChildProcess[] = [];
let holderPids: number[] = [];

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-stale-lock-"));
  fs.mkdirSync(path.join(vault, ".git"));
  clockFile = path.join(vault, "clock");
  workerFile = path.join(vault, "holder.ts");
  fs.writeFileSync(clockFile, String(EPOCH), "utf8");
  fs.writeFileSync(workerFile, holderSource(), "utf8");
});

afterEach(() => {
  // SIGCONT first: a SIGSTOPped process cannot act on SIGKILL until it is
  // scheduled again, and a leaked frozen child outlives the suite. Both the
  // launcher and the holder it forked, because killing one never kills the other.
  for (const pid of holderPids) {
    try {
      process.kill(pid, "SIGCONT");
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  for (const c of children) {
    try {
      c.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
  children = [];
  holderPids = [];
  fs.rmSync(vault, { recursive: true, force: true });
});

/**
 * The holder, as a real process.
 *
 * It takes the lock naming its own pid, then heartbeats off the shared clock
 * file until something stops it. Written outside the repo, so it inherits no
 * `"type": "module"` and tsx treats it as CJS — hence a timer rather than a
 * top-level await, the same constraint `test/loop/lock.test.ts` works under.
 */
function holderSource(): string {
  const lockModule = path.resolve(__dirname, "../../src/loop/lock.ts");
  return (
    `const fs = require("node:fs");\n` +
    `import { acquireFiringLock, releaseFiringLock, touchFiringLock } from ${JSON.stringify(lockModule)};\n` +
    `const [vault, clockFile, everyMs] = process.argv.slice(2);\n` +
    `const clock = () => Number(fs.readFileSync(clockFile, "utf8").trim());\n` +
    `const r = acquireFiringLock(vault, {\n` +
    `  ttlMs: ${TTL_MS}, now: clock(), holderPid: process.pid, heartbeatEveryMs: Number(everyMs),\n` +
    `});\n` +
    `if (!r.ok) { console.log("lost"); process.exit(1); }\n` +
    // Its OWN pid, not the launcher's. `tsx` runs the script in a grandchild, so
    // the ChildProcess handle the test holds addresses a shim: signalling it
    // leaves the real holder running and waiting on its `close` waits for
    // inherited stdio the holder still owns. Both were live bugs in this
    // harness before the holder started saying who it actually is.
    `console.log("held " + process.pid);\n` +
    // Two jobs on one short real-time timer: prove liveness on the shared
    // timeline, and watch for the sentinel files the test uses to ask for a
    // clean end. Twenty milliseconds is a real interval; what it stamps is a
    // simulated instant.
    `setInterval(() => {\n` +
    `  if (fs.existsSync(vault + "/release")) { releaseFiringLock(vault, { pid: r.record.pid }); process.exit(0); }\n` +
    `  if (fs.existsSync(vault + "/quit")) { process.exit(0); }\n` +
    `  const n = clock();\n` +
    `  if (Number.isFinite(n)) touchFiringLock(vault, n);\n` +
    `}, 20);\n`
  );
}

/** A running holder: the pid that actually holds the lock, and the shim that launched it. */
interface Holder {
  pid: number;
  shim: ChildProcess;
}

async function startHolder(): Promise<Holder> {
  const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
  const shim = spawn(tsx, [workerFile, vault, clockFile, String(HEARTBEAT_EVERY_MS)], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  children.push(shim);
  const pid = await new Promise<number>((resolve, reject) => {
    let out = "";
    shim.stdout!.on("data", (d) => {
      out += String(d);
      const m = out.match(/held (\d+)/);
      if (m) resolve(Number(m[1]));
      if (out.includes("lost")) reject(new Error("holder could not take the lock"));
    });
    shim.on("error", reject);
    shim.on("exit", () => reject(new Error(`holder exited before holding: ${out}`)));
  });
  holderPids.push(pid);
  return { pid, shim };
}

function signalHolder(holder: Holder, signal: NodeJS.Signals): void {
  process.kill(holder.pid, signal);
}

/** Block this thread for real milliseconds — used only to let a child be scheduled. */
function realPause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Wait for the holder's pid to actually leave the process table.
 *
 * Not the shim's `exit` event: that fires when the launcher goes, and the whole
 * point of every scenario below is what the state of the *holder* is. Bounded so
 * a holder that refuses to die fails the test rather than hanging the suite.
 */
function awaitHolderGone(holder: Holder): void {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      process.kill(holder.pid, 0);
    } catch {
      return;
    }
    if (Date.now() >= deadline) throw new Error(`holder ${holder.pid} did not exit`);
    realPause(10);
  }
}

/**
 * The simulated clock, and the ground truth for bar 2.
 *
 * It also records which stretches of simulated time nobody was running for,
 * because that is the only way to say what "still genuinely held" means. A
 * holder frozen for an hour has been silent for an hour of wall time and for
 * zero seconds of its own; judging it on the former is precisely the mistake
 * the second bar forbids, so the test tracks both and asserts on the latter.
 */
class TestClock implements WaitClock {
  t = EPOCH;
  /** Simulated milliseconds during which the whole machine was frozen. */
  frozenMs = 0;
  /** How long each `sleep` should advance by, overriding the poll interval. */
  private jumps: number[] = [];

  now(): number {
    return this.t;
  }

  /** Advance, publish the new instant, and give a live holder a turn to stamp it. */
  advance(ms: number, opts: { frozen?: boolean } = {}): void {
    this.t += ms;
    if (opts.frozen) this.frozenMs += ms;
    fs.writeFileSync(clockFile, String(this.t), "utf8");
    if (opts.frozen) return; // Nothing was running; nothing gets to stamp.
    // Wait for the holder to catch up rather than guessing at a delay: a live
    // holder answers in a few milliseconds, a dead or frozen one never does and
    // costs the budget below. Bounding it is what keeps the suite deterministic
    // without making it slow.
    const deadline = Date.now() + 400;
    for (;;) {
      const held = readFiringLock(vault);
      const beat = held?.heartbeatAt === undefined ? NaN : Date.parse(held.heartbeatAt);
      if (Number.isFinite(beat) && beat >= this.t) return;
      if (Date.now() >= deadline) return;
      realPause(10);
    }
  }

  /** The next `sleep` advances by this much instead of the poll interval. */
  scheduleJump(ms: number): void {
    this.jumps.push(ms);
  }

  sleep(ms: number): void {
    const jump = this.jumps.shift();
    if (jump !== undefined) {
      // A jump models the observer being suspended too: simulated time runs and
      // nothing — waiter or holder — is scheduled inside it.
      this.advance(jump, { frozen: true });
      return;
    }
    this.advance(ms);
  }
}

interface Run {
  waitedMs: number;
  broke: boolean;
  observations: WaitObservation[];
  /** Breaks that took a lock whose holder was still keeping its promised cadence. */
  liveLocksReleased: number;
}

/**
 * Run the waiter against whatever is holding the lock, and score both bars.
 *
 * The live-lock check is made at the instant of each break, against the record
 * that was broken, measured in the holder's own frame: simulated silence minus
 * simulated time the machine was frozen. A holder inside its promised cadence by
 * that measure was genuinely held, and breaking it is a bar-2 failure however
 * defensible the reasoning that got there.
 */
function contend(clock: TestClock, waitMs = RECOVERY_BAR_MS): Run {
  const observations: WaitObservation[] = [];
  let liveLocksReleased = 0;
  const result = waitForFiringLock(vault, {
    ttlMs: TTL_MS,
    waitMs,
    pollMs: POLL_MS,
    confirmMs: CONFIRM_MS,
    heartbeatEveryMs: HEARTBEAT_EVERY_MS,
    holderPid: process.pid,
    clock,
    onObservation: (o) => {
      observations.push(o);
      if (o.verdict !== "broke" || o.held === null) return;
      const silentMs = o.at - lastAlive(o.held);
      if (silentMs - clock.frozenMs < STALE_AFTER_MS) liveLocksReleased++;
    },
  });
  return {
    waitedMs: result.ok ? result.waitedMs : Number.POSITIVE_INFINITY,
    broke: result.ok && result.broke !== null,
    observations,
    liveLocksReleased,
  };
}

function lastAlive(held: LockRecord): number {
  const beat = held.heartbeatAt === undefined ? NaN : Date.parse(held.heartbeatAt);
  return Number.isFinite(beat) ? beat : Date.parse(held.acquiredAt);
}

describe("a crashed holder leaves the vault usable again inside the fifteen minutes the node fixed", () => {
  test("clean exit — the process ended and never released", async () => {
    const holder = await startHolder();
    const clock = new TestClock();
    clock.advance(SECOND);
    expect(readFiringLock(vault)?.holderPid).toBe(holder.pid);

    fs.writeFileSync(path.join(vault, "quit"), "", "utf8");
    awaitHolderGone(holder);
    expect(readFiringLock(vault)).not.toBeNull(); // The lock outlived its holder.

    const run = contend(clock);
    expect(run.waitedMs).toBeLessThanOrEqual(RECOVERY_BAR_MS);
    expect(run.broke).toBe(true);
    expect(run.liveLocksReleased).toBe(0);
    // Recovery is immediate here, not merely inside the bar: a named pid that is
    // gone on this host is conclusive, so nothing is served by waiting on it.
    expect(run.waitedMs).toBe(0);
  }, 60_000);

  test("hard kill — SIGKILL, no handler, nothing cleaned up", async () => {
    const holder = await startHolder();
    const clock = new TestClock();
    clock.advance(SECOND);

    signalHolder(holder, "SIGKILL");
    awaitHolderGone(holder);
    expect(readFiringLock(vault)).not.toBeNull();

    const run = contend(clock);
    expect(run.waitedMs).toBeLessThanOrEqual(RECOVERY_BAR_MS);
    expect(run.broke).toBe(true);
    expect(run.liveLocksReleased).toBe(0);
  }, 60_000);

  test("hung but still holding — a live pid that will never do another thing", async () => {
    const holder = await startHolder();
    const clock = new TestClock();
    clock.advance(SECOND);

    // SIGSTOP rather than a busy loop: the process stays alive, answers `kill -0`,
    // and cannot run a line. Every liveness rule short of a heartbeat says this
    // lock is healthy, which is exactly why the heartbeat exists.
    signalHolder(holder, "SIGSTOP");

    const run = contend(clock);
    expect(run.waitedMs).toBeLessThanOrEqual(RECOVERY_BAR_MS);
    expect(run.broke).toBe(true);
    expect(run.liveLocksReleased).toBe(0);
    // It was recovered because it stopped speaking, not because it stopped
    // existing — the pid was alive throughout.
    expect(run.observations.some((o) => o.verdict === "suspect")).toBe(true);
    expect(run.observations.find((o) => o.verdict === "broke")?.why).toMatch(/silent/);
  }, 60_000);

  test("machine sleep — the holder and the observer frozen together, then resumed", async () => {
    const holder = await startHolder();
    const clock = new TestClock();
    clock.advance(SECOND);
    const before = readFiringLock(vault);

    // The laptop shuts its lid. The holder cannot run; neither can anything
    // watching it; and an hour of wall time passes for both — well past the TTL
    // and many times the promised cadence.
    signalHolder(holder, "SIGSTOP");
    clock.scheduleJump(60 * MINUTE);

    // Wake on the second poll, so the waiter's first reading after the jump sees
    // a holder that is running again, exactly as it would after a resume.
    const woken = { done: false };
    const run = (() => {
      const observations: WaitObservation[] = [];
      let liveLocksReleased = 0;
      const result = waitForFiringLock(vault, {
        ttlMs: TTL_MS,
        waitMs: 5 * MINUTE,
        pollMs: POLL_MS,
        confirmMs: CONFIRM_MS,
        heartbeatEveryMs: HEARTBEAT_EVERY_MS,
        holderPid: process.pid,
        clock,
        onObservation: (o) => {
          observations.push(o);
          if (o.verdict === "clock-jumped" && !woken.done) {
            woken.done = true;
            signalHolder(holder, "SIGCONT");
            realPause(100); // Let the resumed holder land one heartbeat.
          }
          if (o.verdict !== "broke" || o.held === null) return;
          const silentMs = o.at - lastAlive(o.held);
          if (silentMs - clock.frozenMs < STALE_AFTER_MS) liveLocksReleased++;
        },
      });
      return {
        waitedMs: result.ok ? result.waitedMs : Number.POSITIVE_INFINITY,
        broke: result.ok && result.broke !== null,
        observations,
        liveLocksReleased,
      };
    })();

    // The bar that matters in this scenario is the SECOND one. A healthy holder
    // came back from an hour of suspension and must still have its lock.
    expect(run.liveLocksReleased).toBe(0);
    expect(run.broke).toBe(false);
    expect(run.observations.some((o) => o.verdict === "clock-jumped")).toBe(true);
    const after = readFiringLock(vault);
    expect(after?.acquiredAt).toBe(before?.acquiredAt);
    expect(after?.holderPid).toBe(holder.pid);

    // And the vault is usable again the moment the holder is finished — inside
    // the bar, by the holder releasing rather than by anything breaking it.
    fs.writeFileSync(path.join(vault, "release"), "", "utf8");
    awaitHolderGone(holder);
    const second = contend(clock);
    expect(second.waitedMs).toBeLessThanOrEqual(RECOVERY_BAR_MS);
    expect(second.liveLocksReleased).toBe(0);
  }, 60_000);
});

describe("recovery never releases a lock that is still genuinely held", () => {
  test("a holder keeping its promised cadence survives a full waiting window", async () => {
    const holder = await startHolder();
    const clock = new TestClock();

    // Half an hour of contention against a holder that is simply busy. Past the
    // TTL, past every multiple of the heartbeat cadence, and it must not be
    // touched: the whole point of the lock is that this holder gets to finish.
    const run = contend(clock, 30 * MINUTE);
    expect(run.liveLocksReleased).toBe(0);
    expect(run.observations.some((o) => o.verdict === "broke")).toBe(false);
    expect(readFiringLock(vault)?.holderPid).toBe(holder.pid);
    expect(run.waitedMs).toBe(Number.POSITIVE_INFINITY); // It waited, and did not get in.
  }, 60_000);

  test("naming the run does not rewind the heartbeat the holder has been keeping", async () => {
    // `loop start` acquires, then stamps the run id onto the record it acquired.
    // Anything that heartbeats in between — an MCP commit lands within
    // milliseconds of a firing opening — is written into the lock by a different
    // process, so the in-memory copy `stampFiringLock` was handed is already out
    // of date. Writing that copy back ages the holder by however long it has
    // been working, and hands the next arrival evidence of a hang that never
    // happened. Cheap to get wrong, invisible until a firing is recovered out
    // from under itself.
    const clock = new TestClock();
    const held = acquireFiringLock(vault, {
      ttlMs: TTL_MS,
      now: clock.now(),
      holderPid: process.pid,
      heartbeatEveryMs: HEARTBEAT_EVERY_MS,
    });
    if (!held.ok) throw new Error("setup");

    const worked = clock.now() + 20 * MINUTE;
    touchFiringLock(vault, worked);
    stampFiringLock(vault, held.record, "run-1");

    const after = readFiringLock(vault);
    expect(after?.runId).toBe("run-1");
    expect(Date.parse(after!.heartbeatAt!)).toBe(worked);
  });

  test("a break is abandoned if the record moves between the verdict and the act", async () => {
    // The narrow race the whole waiting policy would otherwise have at its one
    // destructive moment: the decision is made over minutes, and the holder can
    // come back inside them.
    const clock = new TestClock();
    const held = acquireFiringLock(vault, {
      ttlMs: TTL_MS,
      now: clock.now(),
      holderPid: process.pid,
      heartbeatEveryMs: HEARTBEAT_EVERY_MS,
    });
    if (!held.ok) throw new Error("setup");

    const observations: WaitObservation[] = [];
    const result = waitForFiringLock(vault, {
      ttlMs: TTL_MS,
      waitMs: 10 * MINUTE,
      pollMs: POLL_MS,
      confirmMs: CONFIRM_MS,
      clock,
      onObservation: (o) => {
        observations.push(o);
        // Stamp a fresh heartbeat the instant a break becomes possible, standing
        // in for a holder that was descheduled and got scheduled again.
        if (o.verdict === "suspect") {
          const now = clock.now();
          const record = readFiringLock(vault);
          if (record !== null) {
            fs.writeFileSync(
              path.join(vault, ".git", "ost-agent", "firing.lock"),
              JSON.stringify({ ...record, heartbeatAt: new Date(now + POLL_MS).toISOString() }) + "\n",
            );
          }
        }
      },
    });

    // It never got in, and the lock is still the one it was watching.
    expect(result.ok).toBe(false);
    expect(observations.some((o) => o.verdict === "broke")).toBe(false);
    expect(readFiringLock(vault)?.acquiredAt).toBe(held.record.acquiredAt);
  }, 60_000);
});
