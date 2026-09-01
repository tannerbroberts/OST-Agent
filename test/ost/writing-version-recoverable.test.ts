/**
 * "Check whether the writing version is recoverable from vault state at all."
 *
 * **The threshold, from the assumption test, unchanged.** The writing version is
 * recoverable for at least 95 of the last 100 vault states in git history. The
 * node fixes both halves of that bar and both are asserted separately below:
 * *"The earliest commits predate most conventions and are allowed to be
 * ambiguous"*, and *"a gap in the recent tail would be disqualifying and this
 * threshold would catch it, since 5 misses cannot cover a recent run."*
 *
 * **Recoverable means correct, not merely unambiguous.** The node asks how many
 * states are unambiguous, and a resolver that answered `"0.23.0"` unconditionally
 * would be unambiguous a hundred times out of a hundred. So the walk asserts the
 * resolved version equals the version that actually wrote each state — the test
 * drives the history, so it knows.
 *
 * **The measurement against real history is the first block and it comes out
 * zero.** `test/fixtures/writing-version/` holds the last 100 states of this
 * repository's own vault. Not one of them is recoverable, and the reason is the
 * finding: the single machine-written version signal those states carry
 * (`.ost-agent/health/runs.jsonl`) has been 35 days and two minor releases stale
 * across every one of them, because the loop that wrote it stopped on 2026-07-27
 * and nothing noticed. That block is not a failure of the bar — the bar is about
 * a vault this product stamps, and stamping is what the node says the honest
 * first move is. It is here so the negative is machine-checked rather than
 * remembered, and so that the day someone deletes the freshness clause, the test
 * that goes red says exactly which hundred states it would have lied about.
 *
 * **Non-vacuity.** `CONTROL — a stamp that stops in the recent tail` reruns the
 * same construction with the last six states written by a build that stopped
 * stamping. Recoverability drops to 90 and the bar refuses it. Without that, the
 * ≥95 assertion would pass just as happily against a threshold nothing can fail.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  ACCOUNTING_RULES,
  LEGACY_HEALTH_LOG,
  STAMP_REFRESH_AFTER_MS,
  accountingFingerprint,
  formatWritingVersion,
  readWritingVersion,
  resolveWritingVersion,
  stampWritingVersion,
  writingVersionPath,
} from "../../src/ost/writing-version.js";
import { gitCommit } from "../../src/git/safe-git.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/writing-version");

/** The node's own bar, in the two numbers it is stated in. */
const STATES = 100;
const MUST_RECOVER = 95;

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(d);
  return d;
}

// ---------------------------------------------------------------------------
// The real vault's last hundred states.
// ---------------------------------------------------------------------------

interface CapturedCommit {
  sha: string;
  at: string;
  files: Record<string, string>;
  oversize: { path: string; bytes: number; namesAVersion: boolean }[];
}
const captured = JSON.parse(fs.readFileSync(path.join(fixtureDir, "commits.json"), "utf8")) as {
  vault: string;
  commits: CapturedCommit[];
};

/** Write one captured state out as a vault directory, real bytes, nothing added. */
function materialize(commit: CapturedCommit): string {
  const dir = tmp("ost-wv-real-");
  for (const [rel, blob] of Object.entries(commit.files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(fixtureDir, "blobs", blob), target);
  }
  return dir;
}

describe("the last 100 states of this repository's own vault", () => {
  test("the fixture is the window PROVENANCE.md describes", () => {
    // Guards every assertion below: a fixture that quietly lost half its states,
    // or was recaptured over a different window, would make them all pass while
    // measuring something else.
    expect(captured.commits).toHaveLength(STATES);
    expect(captured.commits[0].at).toBe("2026-09-01T03:43:49-05:00");
    expect(captured.commits[STATES - 1].at).toBe("2026-08-31T11:44:28-05:00");
  });

  test("NOT ONE of them is recoverable, and the reason is a stamp 35 days dead", () => {
    const resolutions = captured.commits.map((c) => resolveWritingVersion(materialize(c), { asOf: c.at }));

    expect(resolutions.filter((r) => r.resolved)).toHaveLength(0);
    for (const r of resolutions) {
      expect(r.version).toBeNull();
      expect(r.reason).toContain(LEGACY_HEALTH_LOG);
      expect(r.reason).toContain("0.21.0");
      // 35 days past a 7-day window. Asserted as a floor rather than an equality
      // because the window is a constant somebody may reasonably tune; what must
      // not change is that this stamp is nowhere near fresh.
      expect(r.staleByMs).toBeGreaterThan(25 * 24 * 60 * 60 * 1000);
    }
  });

  test("CONTROL — the naive read would have answered 0.21.0 a hundred times, and been wrong every time", () => {
    // The count above is zero because the only signal is dead, not because the
    // resolver cannot see. This reads the same fixture the way a resolver
    // without a freshness clause would: newest cliVersion, age ignored.
    const naive = captured.commits.map((c) => {
      const blob = c.files[LEGACY_HEALTH_LOG];
      const lines = fs.readFileSync(path.join(fixtureDir, "blobs", blob), "utf8").trim().split("\n");
      return JSON.parse(lines[lines.length - 1]).cliVersion as string;
    });

    expect(naive).toHaveLength(STATES);
    expect(new Set(naive)).toEqual(new Set(["0.21.0"]));
    // The build that actually wrote these states, per PROVENANCE.md: `VERSION`
    // has read 0.23.0 since 2026-07-28 and every one of these commits is from
    // 2026-08-31 or later. So the confident answer is wrong in all hundred.
    expect(naive.every((v) => v !== "0.23.0")).toBe(true);
  });

  test("CONTROL — nothing else in the machine-written state names a version", () => {
    // Including the files too large to copy: the capture records whether their
    // bytes hold a semver-shaped token, so a cursor that starts carrying one
    // fails here rather than going unnoticed.
    const oversizeNamingAVersion = captured.commits.flatMap((c) => c.oversize.filter((o) => o.namesAVersion));
    expect(oversizeNamingAVersion).toEqual([]);

    const versionish = /\b\d+\.\d+\.\d+\b/;
    for (const [rel, blob] of Object.entries(captured.commits[0].files)) {
      if (rel === LEGACY_HEALTH_LOG) continue;
      expect(versionish.test(fs.readFileSync(path.join(fixtureDir, "blobs", blob), "utf8")), rel).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The threshold, against a vault this product stamps.
// ---------------------------------------------------------------------------

/**
 * One writer in the simulated history: who they are, and whether their build
 * stamps at all.
 */
interface Writer {
  version: string;
  accounting: string;
  stamps: boolean;
}

const T0 = Date.parse("2026-01-01T00:00:00.000Z");
/** Two hours between commits — six commits per refresh interval, so the refresh is exercised, not stepped over. */
const STEP_MS = 2 * 60 * 60 * 1000;

/**
 * Build a vault with `STATES` commits and return them newest-first, the way
 * `git log` hands them over.
 *
 * `writerAt` decides who wrote each commit. Commits are dated forward from `T0`
 * with git's own author/committer dates so the walk can judge each stamp's
 * freshness against the state it sits in rather than against today.
 */
function history(writerAt: (i: number) => Writer, opts: { gapBefore?: number; gapMs?: number } = {}): {
  dir: string;
  commits: { sha: string; at: string; writer: Writer }[];
} {
  const dir = tmp("ost-wv-hist-");
  fs.mkdirSync(path.join(dir, ".ost-agent", "state"), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@localhost");
  git("config", "user.name", "test");

  const commits: { sha: string; at: string; writer: Writer }[] = [];
  for (let i = 0; i < STATES; i++) {
    const gap = opts.gapBefore !== undefined && i >= opts.gapBefore ? (opts.gapMs ?? 0) : 0;
    const at = new Date(T0 + i * STEP_MS + gap).toISOString();
    const writer = writerAt(i);
    if (writer.stamps) stampWritingVersion(dir, { now: at, version: writer.version, accounting: writer.accounting });
    // Something for the commit to carry, so history is 100 commits and not 8.
    fs.writeFileSync(path.join(dir, ".ost-agent", "state", "pass.json"), JSON.stringify({ pass: i }) + "\n", "utf8");
    git("add", "-A");
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", `pass ${i}`], {
      env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    });
    commits.push({ sha: git("rev-parse", "HEAD").trim(), at, writer });
  }
  return { dir, commits: commits.reverse() };
}

/**
 * Resolve every state by checking it out, rather than by reasoning about what
 * was written.
 *
 * One detached worktree reused across the walk: `git worktree add` a hundred
 * times costs seconds of wall clock for nothing, and a hundred checkouts of a
 * two-file repository costs almost none. The caller's own `HEAD` is never
 * touched, which is the property the same walk in
 * `queue-delta-from-git.test.ts` also has to hold.
 */
function walk(dir: string, commits: { sha: string; at: string; writer: Writer }[]) {
  const wt = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ost-wv-wt-")), "at");
  dirs.push(path.dirname(wt));
  execFileSync("git", ["-C", dir, "worktree", "add", "-q", "--detach", wt, commits[0].sha]);
  try {
    return commits.map((c) => {
      execFileSync("git", ["-C", wt, "checkout", "-q", "--detach", c.sha]);
      return { ...c, resolution: resolveWritingVersion(wt, { asOf: c.at }) };
    });
  } finally {
    execFileSync("git", ["-C", dir, "worktree", "remove", "--force", wt]);
  }
}

/**
 * The history the bar is stated against.
 *
 * Four states at the far end written by a build that predates stamping — the
 * "earliest commits predate most conventions" the node allows for — then a
 * writer that bumps its version once, and later changes what done means
 * *without* bumping its version, because that second boundary is the one this
 * repository actually produced and the one a semver stamp cannot report.
 */
const OTHER_ACCOUNTING = accountingFingerprint([...ACCOUNTING_RULES, "and a solution counts as shipped when a PR merges"]);
const LEGACY_COMMITS = 4;
function theHistory(i: number): Writer {
  if (i < LEGACY_COMMITS) return { version: "0.21.0", accounting: "", stamps: false };
  if (i < 40) return { version: "0.22.0", accounting: accountingFingerprint(), stamps: true };
  if (i < 70) return { version: "0.23.0", accounting: accountingFingerprint(), stamps: true };
  return { version: "0.23.0", accounting: OTHER_ACCOUNTING, stamps: true };
}

describe("the last 100 states of a vault this product stamps", () => {
  test("the writing version is recoverable for at least 95 of them, and correct in every one", () => {
    const { dir, commits } = history(theHistory);
    const walked = walk(dir, commits);

    expect(walked).toHaveLength(STATES);
    const recovered = walked.filter((w) => w.resolution.resolved);
    expect(recovered.length).toBeGreaterThanOrEqual(MUST_RECOVER);

    // Unambiguous is not the bar; right is. Every recovered answer names the
    // build that actually wrote that state, and its accounting with it.
    for (const w of recovered) {
      expect(w.resolution.version, w.sha).toBe(w.writer.version);
      expect(w.resolution.accounting, w.sha).toBe(w.writer.accounting);
      expect(w.resolution.source).toBe("stamp");
    }

    // And the ones it could not recover are exactly the pre-stamp states, which
    // is the only miss the node's threshold makes room for.
    const missed = walked.filter((w) => !w.resolution.resolved);
    expect(missed).toHaveLength(LEGACY_COMMITS);
    for (const m of missed) expect(m.writer.stamps).toBe(false);
  });

  test("CONTROL — a stamp that stops in the recent tail drops it below the bar", () => {
    // The node: "A gap in the recent tail would be disqualifying and this
    // threshold would catch it, since 5 misses cannot cover a recent run." Six
    // states, written 40 days after the writer last stamped, by a build that
    // stopped stamping — the shape the real vault's health log is in.
    const { dir, commits } = history(
      (i) => (i >= STATES - 6 ? { version: "0.24.0", accounting: "", stamps: false } : theHistory(i)),
      { gapBefore: STATES - 6, gapMs: 40 * 24 * 60 * 60 * 1000 },
    );
    const walked = walk(dir, commits);

    const recovered = walked.filter((w) => w.resolution.resolved).length;
    expect(recovered).toBe(STATES - LEGACY_COMMITS - 6);
    expect(recovered).toBeLessThan(MUST_RECOVER);

    // Refused for the right reason: a stale stamp is reported as stale, not as
    // an answer. This is the clause the real vault's hundred states turn on.
    const tail = walked.slice(0, 6);
    for (const t of tail) {
      expect(t.resolution.resolved).toBe(false);
      expect(t.resolution.version).toBeNull();
      expect(t.resolution.staleByMs).toBeGreaterThan(0);
      expect(t.resolution.reason).toContain("0.23.0");
    }
  });

  test("the walk leaves the caller's HEAD and working tree where it found them", () => {
    const { dir, commits } = history(theHistory);
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    const headBefore = git("rev-parse", "HEAD").trim();

    walk(dir, commits);

    expect(git("rev-parse", "HEAD").trim()).toBe(headBefore);
    expect(git("status", "--porcelain").trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The stamp itself.
// ---------------------------------------------------------------------------

describe("stamping", () => {
  test("a commit through the product's own funnel stamps the vault it commits", async () => {
    // The wiring, not the module: `gitCommit` is the one door every mutation
    // goes through, so a stamp anywhere else is one the next call site misses.
    const dir = tmp("ost-wv-commit-");
    fs.mkdirSync(path.join(dir, ".ost-agent"), { recursive: true });
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@localhost"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(dir, "note.md"), "a node\n", "utf8");

    const result = await gitCommit(dir, "test: first write");
    expect(result.committed).toBe(true);

    const stamped = readWritingVersion(dir);
    expect(stamped?.current.version).toBeTruthy();
    expect(stamped?.current.accounting).toBe(accountingFingerprint());
    // In the commit it describes, not left behind in the working tree.
    expect(execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).trim()).toBe("");
  });

  test("a second commit from the same writer leaves the clean-tree no-op a no-op", async () => {
    // A stamp rewritten on every commit would make `gitCommit`'s "nothing to
    // commit" branch unreachable, and this product commits per write — that is a
    // permanent stream of commits carrying a moved timestamp and nothing else.
    const dir = tmp("ost-wv-noop-");
    fs.mkdirSync(path.join(dir, ".ost-agent"), { recursive: true });
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@localhost"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(dir, "note.md"), "a node\n", "utf8");
    await gitCommit(dir, "test: first write");

    expect((await gitCommit(dir, "test: nothing changed")).committed).toBe(false);
  });

  test("outside a vault it writes nothing — no `.ost-agent` appears where there was none", async () => {
    const dir = tmp("ost-wv-notavault-");
    execFileSync("git", ["-C", dir, "init", "-q"]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@localhost"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    fs.writeFileSync(path.join(dir, "README.md"), "not a vault\n", "utf8");

    await gitCommit(dir, "test: someone else's repository");
    expect(fs.existsSync(path.join(dir, ".ost-agent"))).toBe(false);
  });

  test("the refresh interval bounds how often an unchanged writer rewrites the stamp", () => {
    const dir = tmp("ost-wv-refresh-");
    const v = { version: "0.23.0", accounting: accountingFingerprint() };
    expect(stampWritingVersion(dir, { now: "2026-01-01T00:00:00.000Z", ...v }).wrote).toBe(true);
    expect(stampWritingVersion(dir, { now: "2026-01-01T06:00:00.000Z", ...v }).wrote).toBe(false);

    const past = new Date(Date.parse("2026-01-01T00:00:00.000Z") + STAMP_REFRESH_AFTER_MS + 1).toISOString();
    expect(stampWritingVersion(dir, { now: past, ...v }).wrote).toBe(true);
    // Refreshing is not a change of writer: one identity, one history entry.
    expect(readWritingVersion(dir)?.history).toHaveLength(1);
  });

  test("history only grows, and a changed writer is a new entry rather than an overwrite", () => {
    const dir = tmp("ost-wv-history-");
    stampWritingVersion(dir, { now: "2026-01-01T00:00:00.000Z", version: "0.22.0", accounting: "aaa" });
    stampWritingVersion(dir, { now: "2026-01-02T00:00:00.000Z", version: "0.23.0", accounting: "aaa" });
    const changed = stampWritingVersion(dir, { now: "2026-01-03T00:00:00.000Z", version: "0.23.0", accounting: "bbb" });

    expect(changed.changedFrom).toEqual({ version: "0.23.0", accounting: "aaa", since: "2026-01-02T00:00:00.000Z" });
    const state = readWritingVersion(dir)!;
    expect(state.history.map((h) => `${h.version}/${h.accounting}`)).toEqual(["0.22.0/aaa", "0.23.0/aaa", "0.23.0/bbb"]);
    expect(state.current.since).toBe("2026-01-03T00:00:00.000Z");
  });

  test("an unreadable stamp resolves to nothing rather than throwing", () => {
    const dir = tmp("ost-wv-corrupt-");
    stampWritingVersion(dir, { now: "2026-01-01T00:00:00.000Z", version: "0.23.0", accounting: "aaa" });
    fs.writeFileSync(writingVersionPath(dir), "{ not json\n", "utf8");

    const r = resolveWritingVersion(dir, { asOf: "2026-01-01T01:00:00.000Z" });
    expect(r.resolved).toBe(false);
    expect(r.reason).toContain("nothing machine-written");
  });
});

// ---------------------------------------------------------------------------
// What the report says, which is the thing the solution node is named for.
// ---------------------------------------------------------------------------

describe("reporting the boundary rather than folding it into the counts", () => {
  test("an accounting change inside one release is named, version and all", () => {
    // The case this repository actually produced: `VERSION` frozen at 0.23.0
    // across 205 merged pull requests, several of which moved what counts as
    // done. A semver stamp would have been fresh, correct and silent.
    const dir = tmp("ost-wv-report-");
    stampWritingVersion(dir, { now: "2026-08-01T00:00:00.000Z", version: "0.23.0", accounting: "aaa" });
    stampWritingVersion(dir, { now: "2026-08-20T00:00:00.000Z", version: "0.23.0", accounting: "bbb" });

    const page = formatWritingVersion(dir, { asOf: "2026-08-20T01:00:00.000Z" });
    expect(page).toContain("the accounting changed at 2026-08-20T00:00:00.000Z");
    expect(page).toContain("0.23.0/aaa → 0.23.0/bbb");
    expect(page).toContain("the version did not move across that boundary");
  });

  test("with nothing recoverable it says so, and says what it found instead", () => {
    const dir = materialize(captured.commits[0]);
    const page = formatWritingVersion(dir, { asOf: captured.commits[0].at });

    expect(page).toContain("unresolved");
    expect(page).toContain(LEGACY_HEALTH_LOG);
    // No boundary line: it has nothing to compare, and inventing one from a dead
    // stamp is the failure the whole module is built around.
    expect(page).not.toContain("the accounting changed at");
  });
});
