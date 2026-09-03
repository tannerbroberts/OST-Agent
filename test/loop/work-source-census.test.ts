/**
 * The instrument for "The loop sleeps on a signal and is woken by the event,
 * instead of deciding when to look."
 *
 * **What it is scoring, taken from the assumption test's pre-committed threshold
 * rather than from what got built.** That threshold, in full: *"Every source found
 * is watchable directly, or has a proxy costing under an hour to build."* The
 * solution node fixes the subject the threshold ranges over — "every channel that
 * can put new work in front of a pass is enumerated in one place and each exposes
 * a watchable event source rather than only a poll — the six ingest adapters
 * (`inbox`, `friction`, `transcript`, `usage`, `atlassian`, `slack`) and the
 * human-initiated mutations a sleeping loop must not miss (`result`, `promote`,
 * `lane`, `retract`)."
 *
 * So there are two claims and they are tested apart, because the enumeration can
 * pass while the demanding one fails:
 *
 *   1. **Enumeration.** Every source is in one place — and *derived*, so a source
 *      added to the repository tomorrow cannot be missing from it.
 *   2. **Watchability, and not merely declared.** The census names a target for
 *      each source; {@link describe} "the declared target is the one that actually
 *      changes" runs the real mutation and asserts the named target moved. A
 *      census whose targets were plausible rather than true would be the exact
 *      failure the candidate is about — a loop asleep on a watcher pointed at the
 *      wrong file, reporting itself healthy — one level up.
 *
 * **What a green here does not settle**, restating the node's own list so nobody
 * reads more out of this file than it measured: it does not say the watcher fires
 * when it should in production, nor that waking costs less than the poll it
 * replaces, nor that any of it is wired into the firing path (it is not — `loop
 * due` still reads a clock). The proxy costs it scores are estimates written by
 * hand in `work-sources.ts`, not measurements, so the "under an hour" clause is
 * checked against a guess; the first proxy built should be timed and the number
 * replaced. And the census is bounded by what this repository contains, which is
 * the node's own caveat in its other form: a source nobody has built yet is
 * absent here too.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { allChannels, commissionedChannels } from "../../src/adapters/channels.js";
import { Vault } from "../../src/ost/vault.js";
import { promoteNode, recordResult, retractNode } from "../../src/ost/results.js";
import { setLane } from "../../src/ost/lanes.js";
import { usageLogPath } from "../../src/telemetry/usage.js";
import { TEMP_WRITE_SUFFIX } from "../../src/fs/atomic-write.js";
import {
  HUMAN_MUTATIONS,
  PROXY_BUDGET_MINUTES,
  renderWorkSourceCensus,
  unwatchableSources,
  watchTargetSignature,
  watchWorkSources,
  workSourceCensus,
  type WorkSource,
} from "../../src/loop/work-sources.js";

let dir: string;
let sessions: string;
let drop: string;

/** A vault whose config is whatever the test needs, with the tree already in it. */
function writeConfig(yaml: string): void {
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), yaml, "utf8");
}

function census(): WorkSource[] {
  return workSourceCensus(dir, loadConfig(dir), { env: {} }).sources;
}

function source(name: string): WorkSource {
  const found = census().find((s) => s.name === name);
  expect(found, `no source named "${name}" in the census`).toBeDefined();
  return found!;
}

beforeEach(() => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-work-sources-"));
  dir = path.join(root, "vault");
  sessions = path.join(root, "sessions");
  drop = path.join(root, "drop");
  fs.mkdirSync(dir);
  fs.mkdirSync(sessions);
  fs.mkdirSync(drop);
  writeConfig("outcome: X\n");

  const vault = new Vault(dir);
  vault.createNode({ title: "Outcome", layer: "Outcome", tags: [], links: ["Opp"], body: "o", evidence: "assertion" });
  vault.createNode({ title: "Opp", layer: "Opportunity", tags: [], links: ["Sol"], body: "b", evidence: "stated" });
  vault.createNode({ title: "Sol", layer: "Solution", tags: [], links: ["Asm"], body: "b", evidence: "assertion" });
  vault.createNode({ title: "Asm", layer: "AssumptionTest", tags: [], links: [], body: "the plan", evidence: "assertion" });
});
afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  vi.useRealTimers();
});

/**
 * The first clause: one place, and derived rather than listed.
 */
describe("every source of new work is enumerated in one place", () => {
  test("every channel this vault has is in the census, read off the channel layer rather than restated", () => {
    // `allChannels` is what `ost-agent channels` reports from. If the census
    // enumerated its own list, a channel added there would be a source the loop
    // sleeps through — silently, which is the failure this whole node is about.
    const declared = allChannels(dir, loadConfig(dir), { env: {} }).channels.map((c) => c.name);
    const enumerated = census()
      .filter((s) => s.kind === "channel")
      .map((s) => s.name);

    expect(enumerated.sort()).toEqual([...declared].sort());

    // Non-vacuity: a channel the operator adds shows up in both, so the equality
    // above is a derivation and not two hardcoded lists that happen to match.
    writeConfig("outcome: X\nadapters:\n  inbox:\n    channels:\n      - name: support\n        path: ../drop\n");
    expect(census().map((s) => s.name)).toContain("support");
  });

  test("the six channels the node named are all there — and so are the three its list predates", () => {
    const names = census().map((s) => s.name);
    // The node's own list, verbatim.
    for (const named of ["inbox", "friction", "transcript", "usage", "atlassian", "slack"]) {
      expect(names, `the node named ${named} and the census omits it`).toContain(named);
    }
    // And what the list was already missing when it was written down. This is the
    // reason the enumeration is derived: `deposit`, `retrospective` and `actions`
    // are channels of this vault today, they can each put new work in front of a
    // pass, and a census hardcoded to the six would have been born blind to them.
    for (const later of ["deposit", "retrospective", "actions"]) {
      expect(names, `${later} is a channel of this vault and is not in the census`).toContain(later);
    }
  });

  test("a channel the operator turned off is enumerated anyway, with its switch reported", () => {
    // A source that produces nothing today produces work the moment somebody
    // flips it, and a census that listed only live sources would read as
    // complete. Same precedent `ost_ingest_inbox` sets for disabled channels.
    expect(source("slack").enabled).toBe(false);

    // Non-vacuity: the flag tracks config rather than always being false.
    writeConfig("outcome: X\nadapters:\n  slack:\n    enabled: true\n    channels: [\"#eng\"]\n");
    expect(source("slack").enabled).toBe(true);
    // Enabled and not runnable is a third fact, kept apart from both.
    expect(source("slack").unavailable).toMatch(/credential/i);
  });

  test("the human-initiated mutations a sleeping loop must not miss each carry a target", () => {
    for (const named of ["result", "promote", "lane", "retract"]) {
      const s = source(named);
      expect(s.kind).toBe("human-mutation");
      expect(s.watch.mode).toBe("direct");
      expect(s.watch.targets.length, `${named} names no target to watch`).toBeGreaterThan(0);
    }
    // The table is wider than the node's four on purpose: these are the same kind
    // of write under the same rule, and a loop that slept through them would be
    // just as asleep.
    expect(census().map((s) => s.name)).toEqual(expect.arrayContaining(["outcome-signal", "prerequisite"]));
    expect(HUMAN_MUTATIONS.every((m) => m.command.startsWith("ost-agent "))).toBe(true);
  });
});

/**
 * The threshold, as one assertion that names its failures.
 */
describe("every source found is watchable directly, or by a proxy under an hour", () => {
  test("nothing in the census is a source a sleeping loop would simply miss", () => {
    const failing = unwatchableSources(census());
    expect(
      failing.map((s) => `${s.name}: ${s.watch.why ?? `${s.watch.proxy?.estimateMinutes} min`}`),
      "a source with no affordance refutes the candidate — the loop would sleep through it and look healthy",
    ).toEqual([]);
  });

  test("the three HTTP pipelines are honest about being proxies rather than counted as watchable", () => {
    // Atlassian, Slack and Actions have no local artefact that moves when work
    // appears at the far end. Calling them "direct" would be the census lying in
    // the one direction that costs — so they are proxied, priced, and the price
    // is what the threshold reads.
    for (const remote of ["atlassian", "slack", "actions"]) {
      const s = source(remote);
      expect(s.watch.mode).toBe("proxy");
      expect(s.watch.targets).toEqual([]);
      expect(s.watch.proxy?.estimateMinutes).toBeLessThan(PROXY_BUDGET_MINUTES);
      expect(s.watch.proxy?.build).toMatch(/cursor/);
    }
  });

  test("the scorer really can fail — an unaffordable source and a costly proxy are both caught", () => {
    // Non-vacuity for the assertion above, which is the one that decides this
    // node: if `unwatchableSources` returned [] for everything, green would mean
    // nothing at all.
    const none: WorkSource = {
      name: "smoke-signal",
      kind: "channel",
      delivers: "nothing observable",
      enabled: true,
      watch: { mode: "none", targets: [], how: "-", why: "nothing local changes and no emitter exists" },
    };
    const dear: WorkSource = {
      name: "webhook",
      kind: "channel",
      delivers: "events over a public endpoint",
      enabled: true,
      watch: { mode: "proxy", targets: [], how: "-", proxy: { build: "stand up an endpoint", estimateMinutes: 480 } },
    };
    expect(unwatchableSources([none, dear]).map((s) => s.name)).toEqual(["smoke-signal", "webhook"]);
  });

  test("the report says which sources are proxied, and that their prices are guesses", () => {
    const report = renderWorkSourceCensus(workSourceCensus(dir, loadConfig(dir), { env: {} })).join("\n");
    expect(report).toMatch(/watchable directly/);
    expect(report).toMatch(/estimates written by hand, not measurements/);
    // The caveat that decides how a wakeup may be used, stated once.
    expect(report).toMatch(/a wakeup on one means look, not work/);
  });
});

/**
 * The demanding clause. A declared target is worth nothing; this runs the real
 * mutation and asks whether the thing the census named actually moved.
 */
describe("the declared target is the one that actually changes", () => {
  /** Run `mutate`, and report whether every target the census named for `name` moved. */
  function moved(name: string, mutate: () => void): boolean[] {
    const targets = source(name).watch.targets;
    expect(targets.length, `${name} declares no target`).toBeGreaterThan(0);
    const before = targets.map((t) => watchTargetSignature(t));
    mutate();
    return targets.map((t, i) => watchTargetSignature(t) !== before[i]);
  }

  test("recording a result moves the target the census points `result` at", () => {
    // The CLI is a thin wrapper over this function (src/cli/index.ts:950), so the
    // write path under test is the one a person's `ost-agent result` takes.
    expect(
      moved("result", () =>
        recordResult(dir, {
          test: "Asm",
          verdict: "supported",
          note: "ran it",
          by: "Tanner",
          uncovered: "nothing about repeat runs",
        }),
      ),
    ).toEqual([true]);
  });

  test("promote, lane and retract each move theirs too", () => {
    expect(moved("promote", () => promoteNode(dir, { node: "Sol", by: "Tanner", why: "the result" }))).toEqual([true]);
    expect(
      moved("lane", () => setLane(dir, { test: "Asm", lane: "compute-only", by: "Tanner", why: "replays only" })),
    ).toEqual([true]);
    expect(moved("retract", () => retractNode(dir, { node: "Opp", by: "Tanner", why: "duplicate" }))).toEqual([true]);
  });

  test("a drop into the inbox folder moves the inbox target, and a quiet vault moves nothing", () => {
    fs.mkdirSync(path.join(dir, ".ost-agent", "inbox"), { recursive: true });
    expect(moved("inbox", () => fs.writeFileSync(path.join(dir, ".ost-agent", "inbox", "note.md"), "hi", "utf8"))).toEqual([
      true,
    ]);
    // The other half of the claim, and the one that makes the first mean
    // something: a signature that changed on its own would report work that never
    // arrived, and a loop woken by it would never sleep.
    expect(moved("inbox", () => {})).toEqual([false]);
  });

  test("an appended tool call moves the usage target", () => {
    const log = usageLogPath(dir);
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.writeFileSync(log, "");
    expect(
      moved("usage", () =>
        fs.appendFileSync(log, JSON.stringify({ ts: "2026-08-10T00:00:00Z", tool: "ost_status", ok: true }) + "\n"),
      ),
    ).toEqual([true]);
  });

  test("a session file appearing moves the transcript target", () => {
    writeConfig(`outcome: X\nloop:\n  cadence: "6h"\n  spend:\n    sessionsDir: "${sessions}"\n`);
    expect(moved("transcript", () => fs.writeFileSync(path.join(sessions, "s.jsonl"), "{}\n", "utf8"))).toEqual([true]);
  });

  test("an atomic write's staged file is not mistaken for a change of its own", () => {
    // `Vault.writeNodeFile` stages beside the target and renames. A signature that
    // counted the temporary would report a change the instant a write began and
    // again when it finished, and the second is the only one that is true.
    const target = source("result").watch.targets[0];
    const before = watchTargetSignature(target);
    const staged = path.join(dir, `.Asm.md.${process.pid}${TEMP_WRITE_SUFFIX}`);
    fs.writeFileSync(staged, "half a node", "utf8");
    expect(watchTargetSignature(target)).toEqual(before);
    fs.rmSync(staged);
  });
});

/**
 * What `transcript` reads is not what the channel report says it reads, and the
 * gap is the loop's own sessions.
 */
describe("the transcript source is read off what the adapter harvests, not off the channel report", () => {
  test("a vault that declares both directories gets both watched, and the report names one", () => {
    writeConfig(
      `outcome: X\nloop:\n  cadence: "6h"\n  spend:\n    sessionsDir: "${sessions}"\n` +
        `adapters:\n  transcript:\n    enabled: true\n    path: "${drop}"\n`,
    );

    const watched = source("transcript").watch.targets.map((t) => t.path);
    expect(watched).toEqual([drop, sessions]);

    // `commissionedChannels` — what `ost-agent channels` reports — names the
    // declared path alone. A watcher built from that report would sleep through
    // `loop.spend.sessionsDir`: the sessions of this vault's own unattended
    // firings, which is precisely the material an unattended loop generates.
    const reported = commissionedChannels(dir, loadConfig(dir), { env: {} }).find((c) => c.name === "transcript");
    expect(reported?.endpoint).toBe(drop);
    expect(watched).toContain(sessions);
  });

  test("a vault that declares neither says so, instead of claiming a watcher it has not got", () => {
    // "Unconfigured" and "unwatchable" are different facts. The affordance is a
    // directory watch and it is sound; there is no directory yet, and reporting
    // that as watched is how a census comes to be believed wrongly.
    const s = source("transcript");
    expect(s.watch.targets).toEqual([]);
    expect(s.pending).toMatch(/no transcript directory is declared/);
    expect(unwatchableSources([s])).toEqual([]);
  });
});

/**
 * The census hands out something real: every source either yields a watcher or is
 * named as one that did not, with no third outcome where it is quietly dropped.
 */
describe("registering interest, rather than deciding when to look", () => {
  /** A watch factory that records what was registered and can fire on demand. */
  function fakeWatch() {
    const registered: { dir: string; fire: (event: string, filename: string | null) => void }[] = [];
    return {
      registered,
      factory: (d: string, listener: (event: string, filename: string | null) => void) => {
        registered.push({ dir: d, fire: listener });
        return { close: () => {} };
      },
    };
  }

  test("a filesystem source wakes the caller when its target changes", () => {
    const woken: string[] = [];
    const { registered, factory } = fakeWatch();
    const handle = watchWorkSources(
      census().filter((s) => s.name === "result"),
      { onWake: (e) => woken.push(`${e.source}:${e.detail}`), watch: factory },
    );

    expect(handle.watching).toEqual(["result"]);
    expect(registered.map((r) => r.dir)).toEqual([dir]);
    registered[0].fire("rename", "Asm.md");
    expect(woken).toEqual(["result:rename Asm.md"]);

    // The staged half of an atomic write is not a wakeup — a loop woken twice per
    // node write would spend its wakeups on the writer's internals.
    registered[0].fire("rename", `.Asm.md.7${TEMP_WRITE_SUFFIX}`);
    expect(woken).toHaveLength(1);
    handle.close();
  });

  test("a proxied source with no probe is refused outright, by name", () => {
    // Fail closed. A proxied source silently skipped is a source the loop sleeps
    // through while every other source reports itself watched — the candidate's
    // own predicted failure, committed by its implementation.
    expect(() => watchWorkSources(census(), { onWake: () => {}, watch: fakeWatch().factory })).toThrow(
      /atlassian, slack, actions/,
    );
  });

  test("a proxied source with a probe wakes on what the probe reports, not on the clock", () => {
    vi.useFakeTimers();
    const woken: string[] = [];
    let token = "cursor-0";
    const handle = watchWorkSources(census().filter((s) => s.name === "slack"), {
      onWake: (e) => woken.push(e.source),
      probes: { slack: () => token },
      pollMs: 1000,
      watch: fakeWatch().factory,
    });

    // Time passing is not an event. This is the difference between the candidate
    // and the cadence gate it replaces.
    vi.advanceTimersByTime(10_000);
    expect(woken).toEqual([]);

    token = "cursor-1";
    vi.advanceTimersByTime(1000);
    expect(woken).toEqual(["slack"]);

    // And it does not keep firing on the same news.
    vi.advanceTimersByTime(10_000);
    expect(woken).toEqual(["slack"]);
    handle.close();
  });

  test("a source with nothing to watch here is reported, never silently dropped", () => {
    const handle = watchWorkSources(census().filter((s) => s.name === "transcript"), {
      onWake: () => {},
      watch: fakeWatch().factory,
    });
    expect(handle.watching).toEqual([]);
    expect(handle.notWatching).toEqual([{ source: "transcript", why: expect.stringMatching(/no transcript directory/) }]);
    handle.close();
  });

  test("a drop folder that does not exist yet is watched through its parent, not skipped", () => {
    // The normal state of a fresh vault: the folder is declared and nobody has
    // used it. A watcher that refused to register would sleep through the first
    // thing ever dropped there.
    const { registered, factory } = fakeWatch();
    fs.rmSync(path.join(dir, ".ost-agent"), { recursive: true, force: true });
    const handle = watchWorkSources(census().filter((s) => s.name === "inbox"), { onWake: () => {}, watch: factory });
    expect(handle.watching).toEqual(["inbox"]);
    expect(registered[0].dir).toBe(dir);
    handle.close();
  });

  test("a real watcher, on the real path a human's write takes", async () => {
    // Everything above this point runs through an injected factory, which tests
    // the wiring and not the affordance. This one registers `fs.watch` on the
    // directory the census named and records a result the way a person would —
    // the whole claim, end to end, once.
    const woken: string[] = [];
    const handle = watchWorkSources(
      census().filter((s) => s.name === "result"),
      { onWake: (e) => woken.push(e.source) },
    );
    try {
      // The write is RE-ISSUED while we wait, and that is a fix rather than a
      // flourish. This file has been convicted on a loaded box five times —
      // `docs/reference/v1-readiness.md` records four and 2026-09-02 makes five
      // — while passing alone every time, and the cause is not a watcher that
      // failed to register: on macOS `fs.watch` is FSEvents, whose stream is
      // armed asynchronously after this call returns and whose delivery is
      // coalesced through a queue the whole box shares. It took 4.3 s to deliver
      // this test's single event on an IDLE machine, measured 2026-09-02. One
      // write therefore stakes the verdict on one event surviving a queue no
      // test controls, which is precisely the "failed because the machine was
      // busy" shape this repository keeps paying for. Writing again each time
      // round the loop measures delivery from the most recent write rather than
      // from one made ten seconds ago; the deadline is unchanged and so is the
      // verdict — did a human's write, through the real path, ever wake it.
      const write = (): void =>
        recordResult(dir, {
          test: "Asm",
          verdict: "supported",
          note: "ran it",
          by: "Tanner",
          uncovered: "nothing about repeat runs",
        });
      write();
      const deadline = Date.now() + 10_000;
      while (woken.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
        if (woken.length === 0) write();
      }
      expect(woken, "fs.watch on the vault root saw nothing when a result was recorded in it").not.toEqual([]);
    } finally {
      handle.close();
    }
  });
});
