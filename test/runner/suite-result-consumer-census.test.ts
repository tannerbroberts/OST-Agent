/**
 * The consumer census the assumption test asked for — every place that reads a
 * suite result as a pass-or-fail boolean, enumerated and held there.
 *
 * The candidate this sizes: "A result carries its own exclusion set, so a gate
 * cannot read it as full coverage." Its cost is not building the richer result —
 * it is that every consumer of a suite verdict has to be taught to read the new
 * shape, and an untaught one keeps reading the boolean beside a live exclusion
 * set and becomes MORE wrong than before. A partial rollout is worse than none,
 * so the question that decides whether to start is how many places must change,
 * and whether any of them can only move in lockstep.
 *
 * The unit is a CHANNEL, not a call site — the argument
 * `test/ost/retraction-consumers.test.ts` already made for node readers:
 * seventeen call sites that all read one function are one consumer, and
 * counting them separately fails a census on a number that says nothing about
 * the migration. A channel here is one conversion of a suite's exit status (or
 * CI conclusion) into a verdict, together with the closed set of files that
 * read the shape it produces. The closed sets are what turn "can be migrated in
 * a single change" from a judgement into a scan: a channel whose readers are
 * pinned is a channel one commit can teach.
 *
 * The answer, pinned below: FIVE channels — exactly the threshold's bar, with
 * no room left in it.
 *
 *   1. The ship gate — `runGates` reads `status === 0` on `npx vitest run`, and
 *      the merge to main turns on it.
 *   2. The instrument observation — `runInstrument` maps exit 0 to green, and a
 *      green is a spent build permit.
 *   3. The loop's own build check — `loop step` records the phase command's
 *      exit, and `computeVerdict` reads any non-zero step as unhealthy.
 *   4. GitHub CI — the `npm test` step's exit is the job's whole verdict.
 *   5. The CI-run digest — the actions adapter reads a run's `conclusion`
 *      string as pass/fail, secondhand from #4.
 *
 * Three migrate independently. The last two only in lockstep with each other:
 * GitHub's `conclusion` field is one bit wide and neither side of it can widen
 * it, so a richer result there means CI publishing the exclusion set through
 * some new channel and the digest reading it — a writer and a reader that must
 * move together. Both live in this repository, so the pair is still one commit,
 * and the threshold's second clause ("every one can be migrated in a single
 * change") holds for all five.
 *
 * What this deliberately does NOT count. Readers of suite OUTPUT rather than of
 * the boolean: a human or an agent running `npx vitest run` is shown "2
 * skipped" in the report, so the invisibility this candidate exists to fix
 * lives only in code that collapses the result to one bit. And it counts
 * consumers, not the undeclared shortfalls they would newly catch — the node
 * itself says sizing that upside needs its own replay over past runs, and
 * nothing here claims it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SRC = path.join(ROOT, "src");

/** Every `.ts` file under `src/`, read once. */
function sources(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push({ rel: path.relative(SRC, p), text: fs.readFileSync(p, "utf8") });
    }
  };
  walk(SRC);
  return out;
}

/** A repo-relative file, read as committed. */
function readRepo(rel: string): string {
  return fs.readFileSync(path.join(ROOT, ...rel.split("/")), "utf8");
}

interface Anchor {
  /** Repo-relative file the one-bit read lives in. */
  readonly file: string;
  /** The read itself. When this stops matching, the census has rotted. */
  readonly reads: RegExp;
}

interface Consumer {
  readonly name: string;
  readonly anchors: readonly Anchor[];
  /** Every file a migration to the richer shape must touch, together. */
  readonly migration: readonly string[];
  /** Census names this consumer can only migrate in lockstep with. */
  readonly lockstepWith: readonly string[];
}

const CENSUS: readonly Consumer[] = [
  {
    name: "the ship gate",
    anchors: [
      { file: "src/release/ship.ts", reads: /const passed = status === 0;/ },
      { file: "src/release/ship.ts", reads: /argv: \["npx", "vitest", "run"\]/ },
    ],
    // `runGates` converts, `shipRepo` acts on it, the CLI reads `.shipped` and
    // prints the summary. All three are asserted closed below.
    migration: ["src/release/ship.ts", "src/release/ship-repo.ts", "src/cli/index.ts"],
    lockstepWith: [],
  },
  {
    name: "the instrument observation",
    anchors: [
      { file: "src/ost/instrument.ts", reads: /if \(exitCode === 0\) \{/ },
      // This channel already reads PAST the boolean — `no-spec` is decided by
      // inspecting output, not the exit code — which is the existence proof for
      // the whole migration: one consumer was taught to read a richer result
      // and nothing downstream broke, because everything downstream reads
      // `InstrumentRun` through the one function.
      { file: "src/ost/instrument.ts", reads: /no test files found/i },
    ],
    migration: ["src/ost/instrument.ts", "src/eval/buildable.ts", "src/cli/index.ts"],
    lockstepWith: [],
  },
  {
    name: "the loop's own build check",
    anchors: [
      { file: "src/loop/health.ts", reads: /run\.steps\.some\(stepFailed\)/ },
      // The recorder: `loop step` spawns the phase command as argv and records
      // the exit it actually produced. `exitLaundering.ts` guards this channel;
      // it does not read it.
      { file: "src/cli/loop.ts", reads: /spawnSync\(command\[0\]/ },
    ],
    migration: ["src/loop/health.ts", "src/cli/loop.ts"],
    lockstepWith: [],
  },
  {
    name: "GitHub CI",
    anchors: [{ file: ".github/workflows/ci.yml", reads: /run: npm test/ }],
    migration: [".github/workflows/ci.yml"],
    lockstepWith: ["the CI-run digest"],
  },
  {
    name: "the CI-run digest",
    anchors: [{ file: "src/adapters/actions.ts", reads: /conclusion === "failure"/ }],
    migration: ["src/adapters/actions.ts"],
    lockstepWith: ["GitHub CI"],
  },
];

describe("the consumer set, enumerated and held there", () => {
  test("every subprocess door under src/ is one of eight files, and only three of them can run a suite", () => {
    // A suite verdict enters this codebase through a spawned process, so the
    // spawners bound the firsthand consumers. Exact, like the retraction
    // census's pin: a new spawner is an argument someone makes in a diff —
    // "does this read a suite verdict, and if so, which channel is it?" —
    // rather than a line that slips through.
    //
    // `runner/shell-necessity.ts` made that argument on 2026-08-11: `runArgv`
    // is the shell-necessity census's argv execution path. It hands its exit
    // status back raw, nothing maps it to a verdict, and its only callers
    // today are that census's own probes. If a consumer ever runs a suite
    // through it, that consumer joins this census then.
    //
    // `git/conflict-guard.ts` joined on 2026-08-16: `git cat-file --batch`
    // needs stdin, which `simple-git`'s `.raw()` cannot supply, so the
    // conflict scan's batched blob read spawns `git` directly. Provably
    // git-only, same argument as `loop/state.ts` below.
    //
    // `cli/index.ts` joined on 2026-08-17: the `canary` command spawns an
    // operator-named incumbent/candidate command pair over identical input so
    // a human can compare their output side by side (`runCanary`,
    // `src/eval/canary.ts`). A nonzero exit becomes `candidate.error` in the
    // printed comparison, not a boolean — nothing in this repository reduces
    // it to pass/fail, and the command never assigns `process.exitCode`.
    // Provably not a suite-verdict consumer, proven below rather than by a
    // hardcoded-argv argument, because the command IS caller-supplied here.
    //
    // `runner/helper-manifest.ts` joined on 2026-08-22: an install-time
    // preflight has to know which version of a shell this machine has, and the
    // only way to ask is to run it. The name arrives out of a *file* — a
    // helper's `# ost-requires: interpreter …` directive — which is exactly why
    // the door is narrow: `PROBEABLE_INTERPRETERS` is a literal set of five
    // shell names, the argv is the literal `["--version"]`, and any other name
    // returns null without executing anything. The exit status is discarded —
    // the version is parsed out of the output or the requirement is reported
    // undecidable and the install refuses — so nothing here reduces a process
    // to pass/fail. Asserted below.
    const doors = sources()
      .filter((f) => f.text.includes('"node:child_process"'))
      .map((f) => f.rel)
      .sort();
    expect(doors).toEqual([
      path.join("cli", "index.ts"),
      path.join("cli", "loop.ts"),
      path.join("git", "conflict-guard.ts"),
      path.join("loop", "state.ts"),
      path.join("ost", "instrument.ts"),
      path.join("release", "ship-repo.ts"),
      path.join("release", "ship.ts"),
      path.join("runner", "helper-manifest.ts"),
      path.join("runner", "shell-necessity.ts"),
    ]);

    // `runner/helper-manifest.ts` has one spawn point, and it is gated on a
    // literal allowlist before the name reaches it. The argv is a literal, and
    // the result is read through `.stdout`/`.stderr` only: `.status` is never
    // touched, so no exit code can become a verdict here.
    const manifest = readRepo("src/runner/helper-manifest.ts");
    expect((manifest.match(/spawnSync\(/g) ?? []).length).toBe(1);
    expect(manifest).toMatch(/if \(!PROBEABLE_INTERPRETERS\.has\(interpreter\)\) return null;/);
    expect(manifest).toMatch(/spawnSync\(bin, \["--version"\]/);
    expect(manifest).not.toMatch(/out\.status/);

    // `cli/index.ts` has exactly one spawn point (`shellProcess`, the
    // `canary` command's runner), and that command's action never assigns
    // `process.exitCode` — so a candidate's exit status cannot reach any
    // pass/fail decision this repository makes.
    const cliIndex = readRepo("src/cli/index.ts");
    const cliIndexSpawns = cliIndex.match(/spawnSync\(/g) ?? [];
    expect(cliIndexSpawns.length).toBe(1);
    const canaryAction = cliIndex.match(/\.command\("canary"\)[\s\S]*?\n {2}\}\);\n/)?.[0] ?? "";
    expect(canaryAction).toContain("shellProcess(opts.incumbent)");
    expect(canaryAction).not.toMatch(/process\.exitCode/);

    // `loop/state.ts` is provably git-only: every spawn names "git" as a
    // literal, so it cannot receive a suite and is not a consumer. The other
    // four are the census's channels 1–3 (`ship-repo.ts` is the ship gate's
    // injected runner, not a channel of its own).
    const state = readRepo("src/loop/state.ts");
    const spawns = state.match(/spawnSync\(/g) ?? [];
    const gitSpawns = state.match(/spawnSync\("git"/g) ?? [];
    expect(spawns.length).toBeGreaterThan(0);
    expect(gitSpawns.length).toBe(spawns.length);

    // `git/conflict-guard.ts` is provably git-only by the same argument: its
    // one spawn point always names "git" as a literal, and every argv it
    // passes is one of this file's own hardcoded git subcommands — never a
    // caller-supplied command — so it cannot receive, let alone run, a suite.
    const guard = readRepo("src/git/conflict-guard.ts");
    const guardSpawns = guard.match(/spawn\(/g) ?? [];
    const guardGitSpawns = guard.match(/spawn\("git"/g) ?? [];
    expect(guardSpawns.length).toBeGreaterThan(0);
    expect(guardGitSpawns.length).toBe(guardSpawns.length);
  });

  test("five channels — the threshold's own number — each still reading the boolean where the census says", () => {
    for (const c of CENSUS) {
      for (const a of c.anchors) {
        expect(
          readRepo(a.file),
          `${c.name}: ${a.file} no longer contains the read this census pinned (${a.reads}). ` +
            `If the read moved, move the anchor; if the channel is gone, strike it from the census.`,
        ).toMatch(a.reads);
      }
    }

    // Exact, so a sixth consumer enters the census consciously or fails here.
    expect(CENSUS.map((c) => c.name)).toEqual([
      "the ship gate",
      "the instrument observation",
      "the loop's own build check",
      "GitHub CI",
      "the CI-run digest",
    ]);

    // The assumption test's threshold, stated in its own units: at most 5
    // distinct consumers. The census lands exactly ON the bar, not under it.
    expect(CENSUS.length).toBeLessThanOrEqual(5);
  });

  test("three migrate independently, the CI pair only in lockstep, and every migration is one commit here", () => {
    const independent = CENSUS.filter((c) => c.lockstepWith.length === 0).map((c) => c.name);
    expect(independent).toEqual(["the ship gate", "the instrument observation", "the loop's own build check"]);

    // Lockstep declarations resolve and are symmetric — a one-way lockstep is a
    // consumer that believes it can move alone while another waits on it.
    for (const c of CENSUS) {
      for (const other of c.lockstepWith) {
        const o = CENSUS.find((x) => x.name === other);
        expect(o, `${c.name} declares lockstep with "${other}", which is not in the census`).toBeDefined();
        expect(o!.lockstepWith).toContain(c.name);
      }
    }

    // The threshold's second clause. "A single change" means one commit in this
    // repository, so every file a migration touches must live here — a consumer
    // whose migration reaches outside the repo (a coordinated release, someone
    // else's reader) could not be taught atomically, and would fail this line.
    for (const c of CENSUS) {
      for (const f of c.migration) {
        expect(
          fs.existsSync(path.join(ROOT, ...f.split("/"))),
          `${c.name}: ${f} left the repository without the census hearing about it`,
        ).toBe(true);
      }
    }
  });
});

describe("each channel's verdict shape has a closed reader set — the single-change claim, made mechanical", () => {
  function filesMatching(pattern: RegExp): string[] {
    return sources()
      .filter((f) => pattern.test(f.text))
      .map((f) => f.rel)
      .sort();
  }

  test("gate verdicts are read only inside the ship boundary", () => {
    // `GateRun.passed` is minted in ship.ts and consumed by ship-repo.ts;
    // nothing else touches the type or the runner, so teaching the gate to
    // carry an exclusion set is a change to two files plus the CLI that prints
    // the outcome.
    expect(filesMatching(/\b(GateRun|runGates|CORE_GATES)\b/)).toEqual([
      path.join("release", "ship-repo.ts"),
      path.join("release", "ship.ts"),
    ]);
    expect(filesMatching(/\bshipRepo\b|\bShipOutcome\b|\.shipped\b/)).toEqual([
      path.join("cli", "index.ts"),
      path.join("release", "ship-repo.ts"),
      path.join("release", "ship.ts"),
    ]);
  });

  test("instrument observations are read only by the permit and the one CLI filing door", () => {
    // `InstrumentRun` is minted by `runInstrument` and read by `confirmPermit`;
    // the only filing path is `verifyInstrument`, reached from the CLI alone.
    // An MCP tool that could read or file one would be a second door, and the
    // census's count would be wrong the day it opened.
    expect(filesMatching(/\b(InstrumentRun|runInstrument)\b/)).toEqual([
      path.join("eval", "buildable.ts"),
      path.join("ost", "instrument.ts"),
    ]);
    expect(filesMatching(/\bverifyInstrument\b/)).toEqual([
      path.join("cli", "index.ts"),
      path.join("ost", "instrument.ts"),
    ]);
  });

  test("loop step exits are compared to zero in exactly two files, and only one computes a verdict", () => {
    expect(filesMatching(/\.exit\s*[!=]==\s*0/)).toEqual([path.join("cli", "loop.ts"), path.join("loop", "health.ts")]);
    expect(filesMatching(/function computeVerdict/)).toEqual([path.join("loop", "health.ts")]);
  });

  test("the CI conclusion is read as a verdict in exactly one file, and the workflow cannot launder its own", () => {
    expect(filesMatching(/\.conclusion\b|conclusion\s*[=!]==/)).toEqual([path.join("adapters", "actions.ts")]);

    const workflow = readRepo(".github/workflows/ci.yml");
    expect(workflow).toMatch(/run: npm test/);
    // A step allowed to fail without failing the job would be this channel's
    // own exclusion set, undeclared — the exact shape the candidate exists to
    // make visible, arriving through the one consumer that cannot be taught.
    expect(workflow).not.toMatch(/continue-on-error/);
  });
});
