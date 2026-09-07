/**
 * Can a rule fixed in advance tell a meaningful external write from churn?
 *
 * The candidate under test watches the working tree and tells the run its copy of
 * a file has gone stale the moment somebody else writes it. Its risk is not the
 * watcher process, it is the filtering: editors write scratch beside the file they
 * save, formatters touch everything, and a `git checkout` looks like a thousand
 * external writes inside one second. The assumption test beneath it fixed both
 * clauses before anything was captured — **at least 90% of external write events
 * classified correctly, and no more than 3 unnecessary invalidations per session**
 * — and the second is the binding one, because a 90% rate still allows enough
 * spurious interruptions for a run to start ignoring the signal.
 *
 * **The controls are what carry this file.** A rule that called everything churn
 * would raise no unnecessary invalidations at all, and a corpus of nothing but
 * `.git` writes would clear 90% on a watcher that never got a real case right. So
 * the synthetic cases below run first and in both directions — each filter fires on
 * an event built to carry it and fails to fire on one built to look like it and not
 * be it — and the census then states, over the committed corpus, what a rule with
 * no filters at all would have scored.
 *
 * `FS_EVENT_RULE` is committed in `src/runner/fs-event-classification.ts`, in a
 * commit that predates the fixture; this file asserts its shape as well as its
 * output, so a later edit shows up here as a changed expectation rather than as a
 * quietly better finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  FS_EVENT_RULE,
  classifyCapture,
  fsEventCensus,
  formatFsEventCensus,
  parseCapture,
  scoreSession,
  writeTime,
  type CaptureEntry,
  type CommandEntry,
  type EventTruth,
  type FsEventEntry,
  type ReadEntry,
  type SelfWriteEntry,
  type SessionCapture,
} from "../../src/runner/fs-event-classification.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "fs-event-classification");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the bar was fixed before the corpus was captured", () => {
  test("it is the one the assumption test states: 90% correct, 3 unnecessary per session", () => {
    expect(FS_EVENT_RULE.minAccuracy).toBe(0.9);
    expect(FS_EVENT_RULE.maxUnnecessaryPerSession).toBe(3);
  });

  test("a burst is more than eight distinct paths inside one second", () => {
    expect(FS_EVENT_RULE.burstFiles).toBe(8);
    expect(FS_EVENT_RULE.burstWindowMs).toBe(1000);
    expect(FS_EVENT_RULE.coalesceMs).toBe(250);
  });

  test("the ladder brackets the burst threshold, so the verdict can be read either side of it", () => {
    expect(FS_EVENT_RULE.burstLadder).toContain(FS_EVENT_RULE.burstFiles);
    expect(Math.min(...FS_EVENT_RULE.burstLadder)).toBeLessThan(FS_EVENT_RULE.burstFiles);
    expect(Math.max(...FS_EVENT_RULE.burstLadder)).toBeGreaterThan(FS_EVENT_RULE.burstFiles);
  });

  test("only `.git` and `node_modules` are ignored outright, whatever else git says", () => {
    expect([...FS_EVENT_RULE.alwaysIgnoredDirs]).toEqual([".git", "node_modules"]);
  });
});

// ── the classifier: synthetic events, in both directions ─────────────────────

const HASH_READ = "aaaaaaaaaaaaaaaa";
const HASH_NEW = "bbbbbbbbbbbbbbbb";

const read = (seq: number, ms: number, p: string, hash = HASH_READ): ReadEntry => ({ t: "read", seq, ms, path: p, hash });
const wrote = (seq: number, ms: number, p: string): SelfWriteEntry => ({ t: "write", seq, ms, path: p });
const cmd = (seq: number, ms: number, phase: "start" | "end", id: string, command = "npx tsc"): CommandEntry => ({
  t: "cmd",
  seq,
  ms,
  phase,
  id,
  command,
});
const fsev = (seq: number, ms: number, p: string, extra: Partial<FsEventEntry> = {}): FsEventEntry => ({
  t: "fs",
  seq,
  ms,
  path: p,
  kind: "change",
  gitignored: false,
  hash: null,
  mtimeMs: ms,
  source: "poll",
  ...extra,
});

const capture = (...entries: CaptureEntry[]): SessionCapture => ({ sessionId: "synthetic", label: "synthetic", entries });
const verdictOf = (c: SessionCapture, seq: number) => classifyCapture(c).verdicts.find((v) => v.seq === seq)!;

describe("an event the rule keeps", () => {
  test("somebody else changing a file the run is holding", () => {
    const c = capture(read(0, 100, "src/a.ts"), fsev(1, 900, "src/a.ts", { hash: HASH_NEW }));
    expect(verdictOf(c, 1)).toMatchObject({ verdict: "meaningful", reason: null, invalidation: 0 });
    expect(classifyCapture(c).invalidations).toEqual([{ id: 0, ms: 900, paths: ["src/a.ts"], burst: false }]);
  });

  test("a file the run read after the session began, not only before it", () => {
    const c = capture(fsev(0, 100, "src/a.ts", { hash: HASH_NEW }), read(1, 200, "src/a.ts"), fsev(2, 900, "src/a.ts", { hash: HASH_NEW }));
    // The first write landed before the run had read anything, so there was no copy
    // of it to go stale; the second is the one worth interrupting for.
    expect(verdictOf(c, 0).reason).toBe("not-held");
    expect(verdictOf(c, 2).verdict).toBe("meaningful");
  });
});

describe("an event that looks meaningful and is not", () => {
  test("a file the run has never read", () => {
    expect(verdictOf(capture(fsev(0, 100, "src/never-read.ts")), 0).reason).toBe("not-held");
  });

  test("a held file rewritten with the bytes it already had — a formatter's no-op save", () => {
    const c = capture(read(0, 100, "src/a.ts"), fsev(1, 900, "src/a.ts", { hash: HASH_READ }));
    expect(verdictOf(c, 1).reason).toBe("unchanged-content");
    expect(classifyCapture(c).invalidations).toEqual([]);
  });

  test("the run's own write, through its own tools", () => {
    const c = capture(read(0, 100, "src/a.ts"), wrote(1, 500, "src/a.ts"), fsev(2, 600, "src/a.ts", { hash: HASH_NEW }));
    expect(verdictOf(c, 2).reason).toBe("self-issued");
  });

  test("a write by a command the run started, three subprocesses down", () => {
    const c = capture(
      read(0, 100, "dist/ost-agent.mjs"),
      cmd(1, 200, "start", "c1", "npm run bundle"),
      fsev(2, 3_000, "dist/ost-agent.mjs", { hash: HASH_NEW }),
      cmd(3, 5_000, "end", "c1", "npm run bundle"),
    );
    expect(verdictOf(c, 2).reason).toBe("self-issued");
  });

  test("…but not the same write once that command has finished", () => {
    const c = capture(
      read(0, 100, "dist/ost-agent.mjs"),
      cmd(1, 200, "start", "c1"),
      cmd(2, 5_000, "end", "c1"),
      fsev(3, 6_000, "dist/ost-agent.mjs", { hash: HASH_NEW }),
    );
    expect(verdictOf(c, 3).verdict).toBe("meaningful");
  });

  test("git's own internals, which no run holds a copy of", () => {
    const c = capture(read(0, 100, "src/a.ts"), fsev(1, 900, ".git/index"), fsev(2, 950, ".git/objects/ab/cdef"));
    expect(verdictOf(c, 1).reason).toBe("ignored-dir");
    expect(verdictOf(c, 2).reason).toBe("ignored-dir");
  });

  test("a path git ignores", () => {
    expect(verdictOf(capture(fsev(0, 100, "dist/meta.json", { gitignored: true })), 0).reason).toBe("gitignored");
  });

  test("the same path again inside the coalesce window", () => {
    const c = capture(read(0, 50, "src/a.ts"), fsev(1, 900, "src/a.ts", { hash: HASH_NEW }), fsev(2, 1_000, "src/a.ts", { hash: HASH_NEW }));
    expect(verdictOf(c, 2).reason).toBe("coalesced");
    // …and it is folded into the notification the first one raised, not lost.
    expect(verdictOf(c, 2).invalidation).toBe(0);
    expect(classifyCapture(c).invalidations).toHaveLength(1);
  });

  test("…but a second write outside that window is a second write", () => {
    const c = capture(read(0, 50, "src/a.ts"), fsev(1, 900, "src/a.ts", { hash: HASH_NEW }), fsev(2, 1_400, "src/a.ts", { hash: HASH_NEW }));
    expect(classifyCapture(c).invalidations).toHaveLength(2);
  });
});

describe("scratch an editor writes beside the file it is saving", () => {
  const scratch = [
    "src/.a.ts.swp",
    "src/4913",
    "src/.#a.ts",
    "src/#a.ts#",
    "src/a.ts~",
    ".DS_Store",
    "src/a.ts.orig",
    "src/a.ts.rej",
    "src/.a.ts.tmp.4711",
    "src/build.tmp",
    "src/index.lock",
  ];
  test.each(scratch)("%s is scratch", (p) => {
    expect(verdictOf(capture(fsev(0, 100, p)), 0).reason).toBe("scratch-file");
  });

  const real = ["src/temporary.ts", "src/4913.ts", "src/swap.ts", "src/orig.ts", "docs/DS_Store.md", "src/lockfile.ts"];
  test.each(real)("%s is a real file with a name that looks like scratch", (p) => {
    // Every one of these matches a naive substring test for the same patterns. The
    // filter is anchored to the basename's ending for exactly this reason.
    expect(verdictOf(capture(fsev(0, 100, p)), 0).reason).toBe("not-held");
  });

  test("an atomic save is one meaningful write and one piece of scratch", () => {
    const c = capture(
      read(0, 100, "src/a.ts"),
      fsev(1, 900, "src/.a.ts.tmp.4711"),
      fsev(2, 950, "src/a.ts", { kind: "rename", hash: HASH_NEW }),
    );
    expect(verdictOf(c, 1).reason).toBe("scratch-file");
    expect(verdictOf(c, 2).verdict).toBe("meaningful");
  });
});

describe("a wave of writes is one branch operation, not that many edits", () => {
  const wave = (n: number, spacingMs = 20) => {
    const entries: CaptureEntry[] = [];
    for (let i = 0; i < n; i++) entries.push(read(i, 10, `src/f${i}.ts`));
    for (let i = 0; i < n; i++) entries.push(fsev(n + i, 5_000 + i * spacingMs, `src/f${i}.ts`, { hash: HASH_NEW }));
    return capture(...entries);
  };

  test("eight held files changing inside a second raise one notification, not eight", () => {
    const c = classifyCapture(wave(8));
    expect(c.invalidations).toHaveLength(1);
    expect(c.invalidations[0].burst).toBe(true);
    expect(c.invalidations[0].paths).toHaveLength(8);
    // Every one of them is still a write the run was told about.
    expect(c.verdicts.filter((v) => v.invalidation !== null)).toHaveLength(8);
  });

  test("seven is under the threshold and stays seven notifications", () => {
    expect(classifyCapture(wave(7)).invalidations).toHaveLength(7);
  });

  test("the same eight files spread over four seconds are eight separate edits", () => {
    expect(classifyCapture(wave(8, 500)).invalidations).toHaveLength(8);
  });

  test("a checkout of thirty files the run holds three of is one notification", () => {
    const entries: CaptureEntry[] = [read(0, 10, "src/f1.ts"), read(1, 10, "src/f2.ts"), read(2, 10, "src/f3.ts")];
    for (let i = 0; i < 30; i++) {
      entries.push(fsev(3 + i, 5_000 + i * 10, `src/f${i}.ts`, { hash: i >= 1 && i <= 3 ? HASH_NEW : null }));
    }
    const c = classifyCapture(capture(...entries));
    expect(c.invalidations).toHaveLength(1);
    expect(c.invalidations[0].paths.sort()).toEqual(["src/f1.ts", "src/f2.ts", "src/f3.ts"]);
    // `src/f0.ts` is in the wave but was never read, so it is in the burst and not
    // in the notification: the run is told what *it* was holding, not what moved.
    expect(c.verdicts.find((v) => v.path === "src/f0.ts")!.reason).toBe("not-held");
  });
});

// ── the apparatus: which clock the rule is read on ──────────────────────────

describe("timing comes off the write, never off the delivery", () => {
  test("writeTime prefers the mtime and falls back to arrival", () => {
    expect(writeTime(fsev(0, 9_000, "a", { mtimeMs: 500 }))).toBe(500);
    expect(writeTime(fsev(0, 9_000, "a", { mtimeMs: null }))).toBe(9_000);
  });

  test("a write inside a command, delivered long after that command ended, is still the run's own", () => {
    // macOS hands filesystem events over in coalesced batches seconds after the
    // fact. Read off arrival, this write lands after `npm run bundle` returned and
    // the rule calls somebody else's edit; read off the mtime it is what it is.
    const c = capture(
      read(0, 100, "dist/ost-agent.mjs"),
      cmd(1, 200, "start", "c1", "npm run bundle"),
      cmd(2, 5_000, "end", "c1", "npm run bundle"),
      fsev(3, 12_000, "dist/ost-agent.mjs", { mtimeMs: 3_000, hash: HASH_NEW }),
    );
    expect(verdictOf(c, 3).reason).toBe("self-issued");
    expect(verdictOf(c, 3).ms).toBe(3_000);
  });

  test("a wave delivered in one flush is a wave only if it was written as one", () => {
    // Eight files handed over in a single batch at 9s, written 700ms apart across
    // six seconds. Off arrival that is a branch operation; off the mtimes it is
    // eight people saving eight files, and the run should hear about all eight.
    const entries: CaptureEntry[] = [];
    for (let i = 0; i < 8; i++) entries.push(read(i, 10, `src/f${i}.ts`));
    for (let i = 0; i < 8; i++) {
      entries.push(fsev(8 + i, 9_000, `src/f${i}.ts`, { mtimeMs: 1_000 + i * 700, hash: HASH_NEW }));
    }
    expect(classifyCapture(capture(...entries)).invalidations).toHaveLength(8);
  });
});

// ── the score ───────────────────────────────────────────────────────────────

describe("scoring asks whether the run was told, and against a truth it cannot see", () => {
  const truth = (rows: [number, "session" | "external", "meaningful" | "churn"][]): EventTruth[] =>
    rows.map(([seq, writer, label]) => ({ seq, writer, label, why: "fixture" }));

  test("a session's own writes are not in the denominator the threshold names", () => {
    const c = capture(read(0, 10, "src/a.ts"), wrote(1, 100, "src/a.ts"), fsev(2, 200, "src/a.ts", { hash: HASH_NEW }));
    const s = scoreSession(c, classifyCapture(c), truth([[2, "session", "churn"]]));
    expect(s.externalEvents).toBe(0);
    expect(s.accuracy).toBe(1);
  });

  test("a meaningful write nothing notified about is a miss", () => {
    const c = capture(read(0, 10, "run.log"), fsev(1, 900, "run.log", { gitignored: true, hash: HASH_NEW }));
    const s = scoreSession(c, classifyCapture(c), truth([[1, "external", "meaningful"]]));
    expect(s.missed.map((v) => v.reason)).toEqual(["gitignored"]);
    expect(s.accuracy).toBe(0);
  });

  test("a notification over nothing the run held is unnecessary", () => {
    // A held file whose bytes the capture could not read: the rule cannot prove it
    // unchanged, so it interrupts, and the truth says nothing had changed.
    const c = capture(read(0, 10, "src/a.ts"), fsev(1, 900, "src/a.ts", { hash: null }));
    const s = scoreSession(c, classifyCapture(c), truth([[1, "external", "churn"]]));
    expect(s.invalidations).toBe(1);
    expect(s.unnecessary).toBe(1);
    expect(s.falseAlarms).toHaveLength(1);
  });

  test("a burst covering one real change is a necessary notification, not eleven wrong ones", () => {
    const entries: CaptureEntry[] = [read(0, 10, "src/f0.ts")];
    for (let i = 0; i < 12; i++) entries.push(fsev(1 + i, 5_000 + i * 10, `src/f${i}.ts`, { hash: i === 0 ? HASH_NEW : null }));
    const c = capture(...entries);
    const rows = truth([[1, "external", "meaningful"], ...Array.from({ length: 11 }, (_, i) => [2 + i, "external", "churn"] as [number, "external", "churn"])]);
    const s = scoreSession(c, classifyCapture(c), rows);
    expect(s.invalidations).toBe(1);
    expect(s.unnecessary).toBe(0);
  });

  test("the contested denominator drops the `.git` mass the rule gets right for free", () => {
    const entries: CaptureEntry[] = [read(0, 10, "src/a.ts")];
    for (let i = 0; i < 50; i++) entries.push(fsev(1 + i, 100 + i, `.git/objects/${i}`));
    entries.push(fsev(51, 900, "src/a.ts", { gitignored: true, hash: HASH_NEW }));
    const c = capture(...entries);
    const rows = truth([
      ...Array.from({ length: 50 }, (_, i) => [1 + i, "external", "churn"] as [number, "external", "churn"]),
      [51, "external", "meaningful"],
    ]);
    const s = scoreSession(c, classifyCapture(c), rows);
    expect(s.externalEvents).toBe(51);
    expect(s.accuracy).toBeCloseTo(50 / 51, 3); // 98% — and it got the only real case wrong
    expect(s.contestedEvents).toBe(1);
    expect(s.contestedAccuracy).toBe(0);
  });
});

// ── the corpus this test exists to count ────────────────────────────────────

/**
 * The committed capture. `PROVENANCE.md` records how it was taken, what it is a
 * reenactment of, and the two instruments that recorded it.
 */
function committedCorpus() {
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "ground-truth.json"), "utf8")) as {
    capturedAgainst: string;
    preregistration: string;
    kind: string;
    sessions: { id: string; label: string; events: number; external: number; watcherCoverage: Record<string, number> }[];
    truth: Record<string, EventTruth[]>;
  };
  const scored = meta.sessions.map((s) => ({
    capture: parseCapture(s.id, s.label, fs.readFileSync(path.join(fixtureDir, `${s.id}.jsonl`), "utf8")),
    truth: meta.truth[s.id],
  }));
  return { meta, scored };
}

describe("the census over the committed corpus", () => {
  const { meta, scored } = committedCorpus();
  const census = fsEventCensus(scored);

  test("it is three sessions, and it says it is a reenactment", () => {
    expect(scored).toHaveLength(3);
    expect(scored.map((s) => s.capture.sessionId)).toEqual(["gate-run", "merge-lands", "unattended-loop"]);
    // Not a hedge in prose: the fixture carries the word, so a later capture cannot
    // quietly be presented as three sessions somebody was having.
    expect(meta.kind).toBe("reenactment");
  });

  test("every file event carries a ground-truth row, and none of them was derived from the rule", () => {
    for (const { capture: c, truth } of scored) {
      const events = c.entries.filter((e) => e.t === "fs");
      expect(truth).toHaveLength(events.length);
      expect(new Set(truth.map((t) => t.seq)).size).toBe(events.length);
      // Provenance, which the classifier never sees, is what every label turns on.
      expect(truth.every((t) => t.writer === "session" || t.writer === "external")).toBe(true);
    }
  });

  test("the rule was committed before the capture it is scored on", () => {
    expect(meta.preregistration).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.capturedAgainst).toMatch(/^[0-9a-f]{40}$/);
  });

  test("THE BAR IS MET: 97.3% of external write events, and no unnecessary invalidations", () => {
    expect(census.externalEvents).toBe(74);
    expect(census.correct).toBe(72);
    expect(census.accuracy).toBeGreaterThanOrEqual(FS_EVENT_RULE.minAccuracy);
    expect(census.meetsAccuracy).toBe(true);
    // The binding clause. Three sessions, none of them over the cap, and none of
    // them anywhere near it.
    expect(census.worstUnnecessary).toBe(0);
    expect(census.meetsInvalidationCap).toBe(true);
    expect(census.meetsBar).toBe(true);
  });

  test("the rate survives having the `.git` mass taken out of the denominator", () => {
    // A branch switch writes git's internals as well as the files, and the rule
    // gets every one of those right for nothing. With them removed the rate barely
    // moves, so the headline is not being carried by noise.
    expect(census.contestedEvents).toBe(71);
    expect(census.contestedAccuracy).toBeGreaterThanOrEqual(FS_EVENT_RULE.minAccuracy);
    expect(census.readingDecides).toBe(false);
  });

  test("the two it gets wrong are both cases the candidate exists for", () => {
    const gate = census.sessions.find((s) => s.sessionId === "gate-run")!;
    expect(gate.missed.map((m) => [m.path, m.reason])).toEqual([
      // The shape of session 424486ec: another writer's edit landing while the run
      // is inside a command of its own. The rule attributes writes during a command
      // to the run that started it, because a subprocess three levels down leaves no
      // other trace — and that is exactly when somebody else's edit is most costly.
      ["src/runner/context.ts", "self-issued"],
      // A file git ignores that the run had nonetheless read. "Ignore paths matched
      // by .gitignore" is the rule the assumption test names, and logs are both
      // ignored and read.
      ["run.log", "gitignored"],
    ]);
    expect(gate.falseAlarms).toEqual([]);
    // Both misses are silence, never a false alarm. On this corpus the rule fails
    // by not interrupting, which is the failure the invalidation cap does not catch.
    expect(census.sessions.every((s) => s.falseAlarms.length === 0)).toBe(true);
  });

  test("a rule with no filters would blow the cap in every session", () => {
    // The control that makes the green worth reading. "Tell the run about every
    // event" is a classifier too, and on this corpus it raises 38, 26 and 65
    // notifications over nothing at all, against a cap of 3.
    const naive = scored.map(({ capture: c, truth }) => ({
      id: c.sessionId,
      overNothing: truth.filter((t) => t.label === "churn").length,
    }));
    expect(naive).toEqual([
      { id: "gate-run", overNothing: 38 },
      { id: "merge-lands", overNothing: 26 },
      { id: "unattended-loop", overNothing: 65 },
    ]);
    for (const n of naive) expect(n.overNothing).toBeGreaterThan(FS_EVENT_RULE.maxUnnecessaryPerSession * 8);
    // The rule raises one notification per session, and every one of them is real.
    expect(census.sessions.map((s) => s.invalidations)).toEqual([1, 1, 1]);
  });

  test("the checkout is one notification covering five held files, not five", () => {
    const merge = classifyCapture(scored.find((s) => s.capture.sessionId === "merge-lands")!.capture);
    expect(merge.invalidations).toHaveLength(1);
    expect(merge.invalidations[0].burst).toBe(true);
    expect(merge.invalidations[0].paths).toHaveLength(5);
  });

  test("the verdict does not turn on where the burst threshold was put", () => {
    // Including at 64, where nothing is ever a burst. Collapsing waves is not what
    // is keeping this corpus under the cap — the held-file test is.
    expect(census.burstLadder.every((r) => r.meetsInvalidationCap)).toBe(true);
    expect(census.burstLadder.map((r) => r.worstUnnecessary)).toEqual([0, 0, 0, 0, 0]);
  });

  test("every filter in the rule fires on the corpus, and the two biggest are the cheap ones", () => {
    // If a clause never fired, the corpus would not be testing it. `not-held` and
    // `ignored-dir` do most of the work, which is worth knowing: the expensive part
    // of the rule — content comparison — settled 3 events.
    expect(Object.keys(census.churnByReason).sort()).toEqual([
      "burst-collapsed",
      "coalesced",
      "gitignored",
      "ignored-dir",
      "not-held",
      "scratch-file",
      "self-issued",
      "unchanged-content",
    ]);
    expect(census.churnByReason["ignored-dir"]).toBe(60);
    expect(census.churnByReason["not-held"]).toBe(53);
    expect(census.churnByReason["unchanged-content"]).toBe(3);
  });

  test("the report says what it does not show", () => {
    const rendered = formatFsEventCensus(census);
    expect(rendered).toContain("THE BINDING CLAUSE");
    expect(rendered).toContain("It does not say the run acts better for being told");
  });
});

// ── the instrument the candidate depends on, which is not the one that recorded this ──

describe("what Node's recursive fs.watch actually delivered", () => {
  const { meta } = committedCorpus();
  const coverage = Object.fromEntries(meta.sessions.map((s) => [s.id, s.watcherCoverage]));

  test("it missed a quarter of the writes, and one whole session", () => {
    // The assumption test measures classification. It says nothing about delivery,
    // and delivery is where this candidate is in trouble: the rule clears both of
    // its clauses on a corpus the watcher could not have produced. `merge-lands` is
    // the case the opportunity was written from — a checkout of 26 files — and the
    // watcher emitted no events at all for the whole session.
    const writes = meta.sessions.reduce((n, s) => n + s.watcherCoverage.writes, 0);
    const delivered = meta.sessions.reduce((n, s) => n + s.watcherCoverage.deliveredByWatcher, 0);
    expect(writes).toBe(127);
    expect(delivered).toBe(96);
    expect(coverage["merge-lands"].writes).toBe(22);
    expect(coverage["merge-lands"].deliveredByWatcher).toBe(0);
    expect(coverage["merge-lands"].watcherEventsSeen).toBe(0);
  });

  test("and almost everything it did emit was history, not writes", () => {
    const seen = meta.sessions.reduce((n, s) => n + s.watcherCoverage.watcherEventsSeen, 0);
    const stale = meta.sessions.reduce((n, s) => n + s.watcherCoverage.watcherEventsForOlderWrites, 0);
    expect(seen).toBe(2275);
    expect(stale).toBe(2161);
    // 95% of what the watcher said was a file last written before the session even
    // started. A watcher wired straight to the rule would spend its first seconds
    // invalidating everything the run had read.
    expect(stale / seen).toBeGreaterThan(0.94);
  });

  test("the corpus is the poller's, and says so", () => {
    const { scored } = committedCorpus();
    const bySource: Record<string, number> = {};
    for (const { capture: c } of scored) {
      for (const e of c.entries) if (e.t === "fs") bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }
    expect(bySource).toEqual({ poll: 138 });
    // Not one event in this fixture came from the watcher. The instrument the
    // solution proposes contributed nothing the 150ms poll had not already seen,
    // and the poll is the cheaper approximation the solution names as its fallback.
    expect(bySource.watch).toBeUndefined();
  });
});
