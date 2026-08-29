/**
 * `ost-agent loop` through the real CLI — the exit codes are the interface.
 *
 * A wrapper script sees nothing but a number, so the number has to carry the
 * distinction: `10` is the routine "not yet", and every other refusal means the
 * vault is not going to fire until somebody changes something. Collapsing them
 * would make a vault that has never fired once look exactly like a healthy one,
 * which is criterion S2's failure statement verbatim.
 *
 * These run the CLI end to end rather than the modules, because the wiring is
 * what is being asserted — that `loop due` really consults the cadence gate and
 * the spend ceiling, in that order, and really refuses.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

// The local tsx binary, invoked directly rather than through `npx` — `npx`
// takes npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
let vault: string;
let sessions: string;

interface Ran {
  code: number;
  out: string;
}

/** Any git command against the fixture vault, output captured. */
function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * `--vault` goes before any `--`, or commander hands it to the child command.
 *
 * `out` is stdout AND stderr, on every exit path — several loop signals are
 * warnings on `console.error` (the future-stamp notice, the dirty-tree refusal,
 * the stall escalation) and a cron reads them because it mails stderr. A helper
 * that captured only stdout on a code-0 command would be blind to exactly those.
 */
function loop(subcommand: string, ...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function config(loopBlock: string): void {
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), `outcome: "ship it"\n${loopBlock}`, "utf8");
}

/**
 * Make the vault's tool trace a tracked, empty file — the state every vault is in
 * after `ost-agent init`, which records its own `vault_init` event.
 *
 * Called BEFORE the first `loop start` of a bracket, and both halves matter.
 * Tracked, so the appends `traceToolCall` makes show up as a modified file under
 * `.ost-agent/usage/` and are covered by the firing-residue exemption instead of
 * collapsing into an untracked `?? .ost-agent/` that D5 refuses. Committed
 * outside the bracket, so creating it cannot move HEAD mid-firing and turn a
 * `no-op` into a `healthy`.
 */
function traceEnabled(): void {
  const trace = path.join(vault, ".ost-agent", "usage", "events.jsonl");
  fs.mkdirSync(path.dirname(trace), { recursive: true });
  fs.writeFileSync(trace, "", "utf8");
  git("add", "-A");
  git("commit", "--quiet", "-m", "trace");
}

/**
 * One traced tool invocation, exactly as `withUsageTracing` writes them.
 *
 * A firing whose pass phase traces nothing never reached the tree, and now seals
 * `degraded` rather than `no-op` (`src/loop/degraded.ts`). The brackets below run
 * `true` as their pass step, so this line is what stands for the pass they are
 * simulating — without it they would be asserting the verdict of a pass that did
 * not happen.
 */
function traceToolCall(): void {
  fs.appendFileSync(
    path.join(vault, ".ost-agent", "usage", "events.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), tool: "ost_next_work", ok: true, ms: 2, surface: "mcp", argBytes: 8 }) +
      "\n",
    "utf8",
  );
}

/** A firing's worth of spend in this vault, at a timestamp inside the window. */
function spend(outputTokens: number): void {
  fs.writeFileSync(
    path.join(sessions, "s.jsonl"),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      cwd: fs.realpathSync(vault),
      message: { usage: { output_tokens: outputTokens } },
    }) + "\n",
    "utf8",
  );
}

const FULL_LOOP = [
  "loop:",
  '  cadence: "6h"',
  // The shipped default is fifteen MINUTES: a second firing waits for the
  // holder rather than skipping its slot, and waiting is also the only posture
  // from which a hung holder can be told apart from a working one
  // (`src/loop/lock.ts`). Every test in this file that contends for the lock
  // would therefore spend that quarter of an hour in real time, so the fixture
  // buys the same behaviour for three seconds. The wait itself is measured
  // against a simulated clock in `test/git/stale-lock-recovery.test.ts`.
  "  lockWaitMinutes: 0.05",
  "  spend:",
  "    ceilingWeightedTokens: 1000",
  "    windowHours: 24",
  '    sessionsDir: "../sessions"',
  "",
].join("\n");

/**
 * The fixture is a REAL repository with a committed baseline, and both halves of
 * that matter now that `loop start` refuses a dirty working tree (criterion D5).
 *
 * It used to be `mkdir .git` — enough for the loop to record into, not enough to
 * answer a status query — which meant every test in this file exercised the
 * firing bracket against a vault git could not describe. That is not a state a
 * real vault is ever in, and it hid the entire question D5 asks.
 *
 * The transcripts live OUTSIDE the vault (`../sessions`), which is also what a
 * real vault looks like: Claude Code writes them under `~/.claude/projects/…`.
 * Keeping them inside would have made every `spend()` call dirty the tree and
 * turned this fixture into a demonstration of the bug instead of a control.
 */
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-loop-"));
  vault = path.join(dir, "vault");
  sessions = path.join(dir, "sessions");
  fs.mkdirSync(vault);
  fs.mkdirSync(sessions);
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  // Signing is a global setting on plenty of workstations and would fail every
  // commit below with a message about gpg rather than about this repo.
  git("config", "commit.gpgsign", "false");
  config(FULL_LOOP);
  git("add", "-A");
  git("commit", "--quiet", "-m", "baseline");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("loop due", () => {
  test("no cadence declared: exit 11, and it says the vault will never fire", () => {
    config("");
    const r = loop("due");
    expect(r.code).toBe(11);
    expect(r.out).toMatch(/never fire on its own/);
  });

  test("no spend ceiling declared: exit 12, and it will not pick one", () => {
    config('loop:\n  cadence: "6h"\n');
    const r = loop("due");
    expect(r.code).toBe(12);
    expect(r.out).toMatch(/will not pick a ceiling/);
  });

  test("over the ceiling: exit 13, distinct from the undeclared case", () => {
    spend(500); // ×5 weighting = 2500, over the 1000 ceiling
    const r = loop("due");
    expect(r.code).toBe(13);
    expect(r.out).toMatch(/ceiling/);
  });

  test("cadence and ceiling both satisfied: exit 0", () => {
    spend(1);
    const r = loop("due");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^due:/m);
  });

  test("a vault that has never fired says so, on every invocation", () => {
    spend(1);
    expect(loop("due").out).toMatch(/last record: none — this vault has never fired/);
  });

  test("inside the window: exit 10, the one refusal a wrapper may treat as routine", () => {
    spend(1);
    traceEnabled();
    expect(loop("start").code).toBe(0);
    expect(loop("step", "--phase", "pass", "--", "true").code).toBe(0);
    traceToolCall();
    expect(loop("step", "--phase", "check", "--", "true").code).toBe(0);
    expect(loop("seal").code).toBe(0);

    const r = loop("due");
    expect(r.code).toBe(10);
    expect(r.out).toMatch(/not due: next due/);
  });
});

describe("the firing bracket", () => {
  test("a firing appends exactly one record, and its verdict is not the caller's to choose", () => {
    spend(1);
    traceEnabled();
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    traceToolCall();
    loop("step", "--phase", "check", "--", "true");
    const sealed = loop("seal");
    // HEAD is the baseline commit before and after — nothing moved — so a green
    // firing that changed nothing is `no-op` rather than `healthy`. The traced
    // call is what makes `no-op` the honest verdict rather than `degraded`: this
    // pass reached the tree and found nothing to do.
    expect(sealed.out).toMatch(/sealed: no-op/);
    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8").trim().split("\n");
    expect(ledger).toHaveLength(1);
  });

  test("a red phase seals unhealthy and exits non-zero", () => {
    spend(1);
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    expect(loop("step", "--phase", "check", "--", "false").code).toBe(1);
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.code).toBe(1);
  });

  test("a skipped phase seals unhealthy — omission does not read as healthy", () => {
    spend(1);
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    expect(loop("seal").out).toMatch(/sealed: unhealthy/);
  });

  test("a firing that never sealed is recorded `crashed` by the next one", () => {
    spend(1);
    // A holder pid above every default pid_max: this firing's owner is already
    // gone, which is what the machine dying looks like to the next firing.
    loop("start", "--holder-pid", "4194303");
    loop("step", "--phase", "pass", "--", "true");
    // The next firing breaks the dead firing's lock and sweeps its open marker.
    expect(loop("start").code).toBe(0);
    const ledger = fs.readFileSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"), "utf8").trim().split("\n");
    expect(ledger).toHaveLength(1);
    expect(JSON.parse(ledger[0]).verdict).toBe("crashed");
  });

  test("the overlap lock refuses a second firing with its own exit code", () => {
    spend(1);
    expect(loop("start").code).toBe(0);
    const second = loop("start");
    expect(second.code).toBe(15);
    // Still the operator's question — *who has it* — even though the answer now
    // arrives after a wait rather than instead of one.
    expect(second.out).toMatch(/another firing holds the lock/);
    expect(second.out).toMatch(/gave up after \d+s of waiting/);
  });

  test("wait: 0 restores the fail-fast refusal, with no wait reported", () => {
    // The knob really is a knob. An operator whose cadence is shorter than the
    // wait wants the old behaviour back, and gets it — same exit code, same
    // sentence, and nothing claiming a wait that did not happen.
    config(FULL_LOOP.replace("lockWaitMinutes: 0.05", "lockWaitMinutes: 0"));
    git("add", "-A");
    git("commit", "--quiet", "-m", "no wait");
    spend(1);
    expect(loop("start").code).toBe(0);
    const second = loop("start");
    expect(second.code).toBe(15);
    expect(second.out).toMatch(/another firing holds the lock/);
    expect(second.out).not.toMatch(/gave up after/);
  });

  test("a live holder pid keeps the lock held, so it is not simply refusing everything", () => {
    spend(1);
    expect(loop("start", "--holder-pid", String(process.pid)).code).toBe(0);
    expect(loop("start", "--holder-pid", String(process.pid)).code).toBe(15);
  });

  test("a step whose exit code cannot report failure is refused before anything is recorded", () => {
    spend(1);
    loop("start");
    const r = loop("step", "--phase", "check", "--", "bash", "-c", "false | tail -1");
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/exit code cannot report failure/);
    // Nothing recorded: the open run still has no steps.
    const open = JSON.parse(fs.readFileSync(path.join(vault, ".git", "ost-agent", "open-run.json"), "utf8"));
    expect(open.steps).toEqual([]);
  });
});

describe("nothing the loop writes lands in the working tree", () => {
  test("the ledger, the marker and the lock are all under .git", () => {
    // Every mutating MCP tool commits with `git add -A`. A record in the
    // working tree would be swept into the next `mcp: <tool>` commit — W2's
    // failure and D5's, manufactured on every firing.
    //
    // The snapshot is taken BEFORE `loop start`, which is the command most likely
    // to create something: it takes the lock and opens the run record. An earlier
    // version captured it after `start` and after the first `step`, so anything
    // those two wrote was baked into the baseline and compared against itself.
    spend(1);
    const before = fs.readdirSync(vault).sort();
    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("step", "--phase", "check", "--", "true");
    loop("seal");
    expect(fs.readdirSync(vault).sort()).toEqual(before);

    // Named directories as well as the listing, because a bracket that wrote
    // nothing at all would satisfy the equality above for the wrong reason.
    expect(fs.existsSync(path.join(vault, ".ost-agent"))).toBe(false);
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(true);
  });

  test("git sees a clean working tree across the whole bracket", () => {
    // The listing check above cannot see a *modified* tracked file, and criterion
    // D5 is stated in terms of `git status --porcelain` being empty at the start of
    // a firing. Assert the thing the criterion actually says, against the real
    // repository the fixture now builds.
    spend(1);
    expect(git("status", "--porcelain").trim()).toBe("");

    loop("start");
    loop("step", "--phase", "pass", "--", "true");
    loop("step", "--phase", "check", "--", "true");
    loop("seal");

    // The bracket really recorded — otherwise a no-op would satisfy this trivially.
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(true);
    expect(git("status", "--porcelain").trim()).toBe("");
  });
});

/**
 * Criterion D5 — a firing does not begin against a dirty vault (`loop start`).
 *
 * The failure this prevents is not untidiness. Every mutating tool commits with
 * `git add -A` (`src/git/safe-git.ts:49`), so a file somebody left behind is
 * committed by the *next* tool to run, under that tool's name — W2's "a node file
 * no tool invocation explains", manufactured on schedule rather than by accident.
 * It was demonstrated live: an audit for `docs/reference/v1-readiness.md` left
 * `?? test/zz-probe.test.ts` in a working tree, one `git add -A` from being
 * attributed to an allowlisted append-only tool.
 *
 * It is also what F4's verdict rests on. `computeVerdict` calls a firing
 * `healthy` only when HEAD moved; the leftover is what moves HEAD next time, so
 * verdicts shift by one and one stale untracked file keeps a dead vault reading
 * healthy forever.
 *
 * **Non-vacuity, proved rather than asserted.** The branch in `loop start` was
 * disabled (`if (false && tree.kind !== "clean")`) and this block re-run: six of
 * the eight rows failed, every one of them because the CLI returned exit 0 where
 * a refusal was expected. The two that stayed green are the two that expect a
 * firing to *proceed* — the clean vault and the ignored file — which is the
 * control this needs: the check is not simply refusing everything. The wedge test
 * carries its own control inline, in the same fixture and the same state.
 *
 * **One exemption, and it is stated rather than folded in.** Paths under
 * `.ost-agent/usage/` do not refuse a firing: the vault's own call trace is
 * appended by read-only tools that never commit, so a literal gate would refuse
 * the second firing of every vault that ever fired a first one. The argument is
 * at `FIRING_TRACE_PREFIX` in `src/cli/loop.ts`; the pin — including the control
 * that a stray file is still refused with the trace present — is in
 * `test/loop/firing-residue.test.ts`. Every row in this block uses ordinary
 * vault paths, so none of them is touched by that exemption.
 */
describe("D5 — a firing refuses to begin against a dirty vault", () => {
  test("an untracked leftover refuses with its own exit code, and names the file", () => {
    spend(1);
    // The audit probe, reproduced: a file nobody's firing created, sitting in
    // the tree in front of the next `git add -A`.
    fs.writeFileSync(path.join(vault, "zz-probe.md"), "left behind by an audit\n", "utf8");

    const r = loop("start");
    expect(r.code).toBe(14);
    expect(r.out).toMatch(/\?\? zz-probe\.md/);
    // 14 is not 15 (locked) and not 0: a wrapper can tell this apart from every
    // other reason a firing did not happen, which is the whole point of the codes.
    expect(r.code).not.toBe(15);

    // "Nothing was recorded and no lock was taken" is a claim the message makes,
    // so it is asserted rather than trusted. A refusal that left a lock behind
    // would wedge the next firing on a second, unrelated mechanism.
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "open-run.json"))).toBe(false);
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "firing.lock"))).toBe(false);
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(false);
  });

  test("a modified tracked file refuses too — dirty is not only about untracked files", () => {
    spend(1);
    // The listing-based check in the block above is blind to this case; only a
    // real `git status` sees it, which is why the criterion is stated in those terms.
    fs.appendFileSync(path.join(vault, "ost.config.yaml"), "# edited by hand\n", "utf8");
    const r = loop("start");
    expect(r.code).toBe(14);
    expect(r.out).toMatch(/ost\.config\.yaml/);
  });

  test("the refusal names the way out concretely, in commands", () => {
    // The wedge rule at the head of Gate F: a stopping state must name its way
    // out. Here the way out is deliberately a human — only the person who left
    // the file knows what it is — so the message has to carry the whole remedy.
    spend(1);
    fs.writeFileSync(path.join(vault, "zz-probe.md"), "x\n", "utf8");
    const out = loop("start").out;
    expect(out).toMatch(/git -C .* status/);
    // `add -A && commit -m`, not `commit -am`: the untracked case is the one
    // that actually happens, and `-am` does not stage it — an operator following
    // that advice would commit nothing and be refused again by the same file.
    expect(out).toMatch(/git -C .* add -A && git -C .* commit -m/);
    expect(out).toMatch(/git -C .* restore/);
    expect(out).toMatch(/\.gitignore/);
    // And it says WHY, not just what — this is the sentence that stops an
    // operator from deleting the check when it fires at 3am.
    expect(out).toMatch(/git add -A/);
  });

  test("a long dirty list is truncated but the count stays exact", () => {
    spend(1);
    for (let i = 0; i < 25; i += 1) fs.writeFileSync(path.join(vault, `zz-${i}.md`), "x\n", "utf8");
    const r = loop("start");
    expect(r.code).toBe(14);
    expect(r.out).toMatch(/^not firing: 25 path\(s\) are already dirty/m);
    expect(r.out).toMatch(/… and 15 more/);
    // Truncated, not merely long: the listing itself must be bounded, or a vault
    // mid-conflict mails a cron operator thousands of lines.
    expect(r.out.split("\n").filter((l) => /^ {4}\?\? zz-/.test(l))).toHaveLength(10);
  });

  test("an ignored file is not dirty — the way out the message offers actually works", () => {
    // One of the three remedies the refusal names is `.gitignore`. If git's own
    // ignore rules did not clear this gate, that advice would be a lie and the
    // operator following it would be wedged with no route left.
    spend(1);
    fs.writeFileSync(path.join(vault, ".gitignore"), "scratch/\n", "utf8");
    git("add", "-A");
    git("commit", "--quiet", "-m", "ignore scratch");
    fs.mkdirSync(path.join(vault, "scratch"));
    fs.writeFileSync(path.join(vault, "scratch", "notes.md"), "x\n", "utf8");

    expect(loop("start").code).toBe(0);
  });

  test("a clean vault fires — the check is not simply refusing everything", () => {
    spend(1);
    const r = loop("start");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/loop run .* open/);
  });

  test("a vault git cannot describe refuses with a DIFFERENT code", () => {
    // Not folded into 14. "Deal with your files" and "this is not a usable
    // checkout" are different mistakes with different fixes, and an operator
    // sent hunting for stray files on a machine that has no repository is the
    // kind of refusal that gets a cron deleted.
    spend(1);
    fs.rmSync(path.join(vault, ".git"), { recursive: true, force: true });
    fs.mkdirSync(path.join(vault, ".git")); // a stub: the loop could record here, git cannot answer
    const r = loop("start");
    expect(r.code).toBe(16);
    expect(r.code).not.toBe(14);
    expect(r.out).toMatch(/cannot tell whether/);
    expect(r.out).toMatch(/ost-agent init/);
  });

  test("THE WEDGE TEST: the LOOP's own leavings do not refuse the firing after it", () => {
    // The reason this check is safe to make fail-closed with a human-only way
    // out. If anything the loop wrote — the run ledger, the open marker, the
    // lock — landed in the working tree, the FIRST firing would refuse every
    // firing after it, permanently, and the only way out would be a human
    // deleting files inside `.git`. That is R2 exactly, on the mechanism meant
    // to protect the record. It does not happen because the loop's records live
    // under `<vault>/.git/ost-agent/`, which git refuses to track by
    // construction — but "by construction" is an argument, and this is the test.
    //
    // **Scope, because the title used to claim more than the body proves.** The
    // steps here are `true`: no MCP tool runs, so this says nothing about what a
    // *pass* leaves behind. It leaves behind an uncommitted line in
    // `.ost-agent/usage/events.jsonl` — every conforming pass ends on a read-only
    // call, which traces and never commits — and that DID wedge the next firing
    // until an explicit exemption landed. The version of this test that stopped
    // at `true` was green throughout. `test/loop/firing-residue.test.ts` drives
    // the real MCP server and is where that half is pinned.
    spend(1);
    expect(loop("start").code).toBe(0);
    expect(loop("step", "--phase", "pass", "--", "true").code).toBe(0);
    expect(loop("step", "--phase", "check", "--", "true").code).toBe(0);
    // 17, not 0, and for the reason the scope note above already gives: the steps
    // are `true`, so no tool ran and this firing genuinely did not reach the tree.
    // It seals `degraded` (`src/loop/degraded.ts`). Left as a toolless bracket on
    // purpose — this test is about what the LOOP leaves in the working tree, and
    // a traced call would add a modified file to the very tree it is inspecting.
    expect(loop("seal").code).toBe(17);
    // The firing really happened — otherwise this test proves only that doing
    // nothing dirties nothing.
    expect(fs.existsSync(path.join(vault, ".git", "ost-agent", "runs.jsonl"))).toBe(true);

    const second = loop("start");
    expect(second.code).toBe(0);
    expect(second.out).toMatch(/loop run .* open/);
    expect(git("status", "--porcelain").trim()).toBe("");

    // Control, in the same fixture and the same state: the assertion above CAN
    // fail. Drop one stray file into the tree the second firing just accepted
    // and the third is refused — so "not refused" above is a fact about the
    // loop's leavings, not about the check being asleep.
    loop("seal");
    fs.writeFileSync(path.join(vault, "zz-probe.md"), "x\n", "utf8");
    expect(loop("start").code).toBe(14);
  });
});

/**
 * F4's escalation half, end to end through the CLI — the wiring, not the fold.
 * `stall.test.ts` pins `assessStall`; this pins that `loop seal` and `loop due`
 * actually consult it, that the signal appears where a `no-op` used to read as
 * success, and — the positive control — that a firing which really moves the
 * tree clears it.
 *
 * A firing seals `healthy` only when HEAD moves between `start` and `seal`. The
 * pass phase here makes an empty commit: it moves HEAD and leaves the tree clean,
 * so D5's dirty-tree refusal never fires and the verdict turns on the delta
 * alone. The dry firings run `true`, so HEAD is the baseline before and after and
 * each seals `no-op`.
 */
describe("a run of dry firings escalates", () => {
  /**
   * One firing bracket; `pass` defaults to a no-op step. Returns `loop seal`'s
   * output.
   *
   * The traced call stands for the pass the `true` step is simulating. Without it
   * every firing here would seal `degraded` — correctly, since nothing reached
   * the tree — and this block would be measuring the wrong streak: it is about a
   * vault that fires, does its job, and finds nothing, which is a different
   * failure from a vault that cannot do its job at all.
   */
  function fire(pass: string[] = ["true"]): Ran {
    loop("start");
    loop("step", "--phase", "pass", "--", ...pass);
    traceToolCall();
    loop("step", "--phase", "check", "--", "true");
    return loop("seal");
  }

  /** A pass step that advances the tree: an empty commit moves HEAD, leaving no dirt. */
  const advance = (): string[] => ["sh", "-c", `git -C "${vault}" commit --allow-empty -qm advance`];

  test("the third dry firing escalates where the first two do not", () => {
    spend(1);
    traceEnabled();
    expect(fire().out).not.toMatch(/stalled/);
    expect(fire().out).not.toMatch(/stalled/);
    const third = fire();
    // Still a `no-op` seal — the per-firing verdict is unchanged and honest.
    expect(third.out).toMatch(/sealed: no-op/);
    // …but no longer reading as success: the run of them is called out.
    expect(third.out).toMatch(/⚠ stalled: 3 consecutive firing\(s\)/);
    // Escalation reports; it does not refuse. A `no-op` is not `unhealthy`, so
    // the exit code stays 0 — the wrapper keeps firing.
    expect(third.code).toBe(0);
  });

  test("a firing that advances the tree clears the escalation — the positive control", () => {
    spend(1);
    traceEnabled();
    fire();
    fire();
    expect(fire().out).toMatch(/⚠ stalled/); // stuck

    const recovered = fire(advance());
    expect(recovered.out).toMatch(/sealed: healthy/);
    expect(recovered.out).not.toMatch(/stalled/);

    // And the signal is gone from `due` too — cleared by the firing, not by any
    // human editing a file, which is what "does not latch" means.
    const d = loop("due");
    expect(d.out).not.toMatch(/stalled/);
  });

  test("the stall also rides on `loop due`, before the gates and without changing the decision", () => {
    spend(1);
    traceEnabled();
    fire();
    fire();
    fire();
    const d = loop("due");
    expect(d.out).toMatch(/⚠ stalled/);
    // The decision is untouched: within the 6h cadence, `due` is the routine
    // not-elapsed (exit 10). Escalation warned and then got out of the way.
    expect(d.code).toBe(10);
  });
});
