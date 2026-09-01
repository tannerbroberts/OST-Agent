/**
 * Break the thing a guard claims to protect, run the guard, and record whether
 * it noticed.
 *
 * A guard that computes its own expectation from the same file it is checking
 * cannot fail: both sides move together, so the two never disagree. Reading the
 * guard does not reveal that — the derivation looks like rigour, and the
 * repository's own history is the proof, since three checks derived the MCP
 * tool-name prefix from `.claude-plugin/plugin.json` and agreed with a wrong
 * answer for 23 releases with every one of them green. Mutation is the only
 * technique that interrogates the property directly: change the subject, and a
 * guard that stays green has just demonstrated it has no reachable failure.
 *
 * Read-only with respect to this repository. Every arm runs against a scratch
 * tree materialised in `os.tmpdir()`, never against the working copy — a
 * harness that mutated the manifest in place would leave a dirty tree behind on
 * any crash, and `.claude-plugin/plugin.json` is the file the whole tool surface
 * hangs from.
 *
 * **Vocabulary, stated once because the two halves of it read backwards.** A
 * mutant is *killed* when the guard goes red — the guard is sensitive to the
 * mutation and the technique found nothing wrong with it. A mutant *survives*
 * when the guard stays green — that green is the finding, and the guard is the
 * defect. "The guard went red" is therefore a clean bill of health, and "the
 * harness flagged the guard" is a green run. Every caller below says which of
 * the two it means.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A textual edit to one committed file, plus the reason it is the right place to cut. */
export interface Mutation {
  /** Repo-relative path of the file to break. */
  readonly file: string;
  /** Exact substring to replace. Must occur EXACTLY once, or the arm throws — see {@link applyMutation}. */
  readonly find: string;
  readonly replace: string;
}

/** What one guard did when it met the mutant. */
export interface GuardVerdict {
  /** Repo-relative spec path. */
  readonly spec: string;
  /** True when the spec went red — the mutant was killed and the guard is sensitive. */
  readonly killedTheMutant: boolean;
  readonly failed: number;
  readonly passed: number;
  /** `describe > test` names of the assertions that went red, in file order. */
  readonly failedTests: readonly string[];
}

/**
 * Materialise a scratch copy of this repository at a committed ref.
 *
 * `git archive` rather than a worktree or a `cp -R`: it touches nothing under
 * `.git`, so a crashed run leaves no worktree registration to prune and no
 * chance of the harness being the reason a later `git status` is dirty.
 *
 * Throws — rather than degrading to "the guard could not be run" — if the ref is
 * unreachable, which on CI means a shallow checkout. `.github/workflows/ci.yml`
 * pins `fetch-depth: 0` for a test whose subject is also the commit record; this
 * is the second such test, and a silent skip here would report a clean result on
 * a subject nothing read.
 */
export function materialiseCommit(ref: string, label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ost-mutation-${label}-`));
  const archive = spawnSync("git", ["archive", "--format=tar", ref], {
    cwd: REPO_ROOT,
    maxBuffer: 256 * 1024 * 1024,
    encoding: "buffer",
  });
  if (archive.status !== 0) {
    throw new Error(
      `git archive ${ref} failed (${archive.status}): ${archive.stderr?.toString() ?? ""}\n` +
        "If this is CI, the checkout is shallow — the harness needs history, not a tip.",
    );
  }
  const untar = spawnSync("tar", ["-x", "-C", dir], { input: archive.stdout, encoding: "buffer" });
  if (untar.status !== 0) throw new Error(`tar -x failed (${untar.status}): ${untar.stderr?.toString() ?? ""}`);
  linkNodeModules(dir);
  return dir;
}

/**
 * The parts of the working tree a guard run needs, copied to a scratch dir.
 *
 * The *working* tree and not `HEAD`, because the arm that uses this one asks
 * what the guards do **as they stand**, and a guard edited-but-not-committed is
 * still the guard the suite gate is about to run. Nothing verifies this list is
 * complete; the baseline control does, by failing if a guard cannot run.
 */
const WORKING_TREE_PATHS = [
  "src",
  "scripts",
  "test",
  ".claude",
  ".claude-plugin",
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
] as const;

export function materialiseWorkingTree(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ost-mutation-${label}-`));
  for (const entry of WORKING_TREE_PATHS) {
    fs.cpSync(path.join(REPO_ROOT, entry), path.join(dir, entry), { recursive: true, dereference: true });
  }
  linkNodeModules(dir);
  return dir;
}

/**
 * Borrow the real `node_modules` rather than installing one. A symlink, so the
 * scratch tree costs megabytes instead of a hundred of them and an `npm ci` of
 * wall-clock time. The historical arm therefore runs an old tree against
 * today's dependencies — which the baseline control is there to catch, since a
 * dependency that no longer resolves turns the unmutated run red.
 */
function linkNodeModules(dir: string): void {
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(dir, "node_modules"), "junction");
}

/**
 * Break one file, and refuse to continue unless the edit landed exactly once.
 *
 * The refusal is the whole reason this is a function rather than two lines at
 * each call site, and it fails closed in both directions:
 *
 *   - **Nothing matched.** The caller gets an *unmutated* tree, every guard
 *     stays green on it, and the harness reports that all of them are blind.
 *     A false accusation delivered with a clean run — the exact failure this
 *     repository keeps finding in other checks.
 *   - **More than one matched.** The arm is then not the mutation it is
 *     described as, and a guard that went red may have been killed by the site
 *     nobody meant to cut. A verdict is only worth reading if the thing that
 *     produced it is the thing named in the write-up.
 */
export function applyMutation(dir: string, mutation: Mutation): void {
  const target = path.join(dir, mutation.file);
  const before = fs.readFileSync(target, "utf8");
  const sites = before.split(mutation.find).length - 1;
  if (sites !== 1) {
    throw new Error(
      `mutation must cut exactly one site in ${mutation.file}, found ${sites} for ${JSON.stringify(mutation.find)}`,
    );
  }
  fs.writeFileSync(target, before.split(mutation.find).join(mutation.replace), "utf8");
}

/**
 * Re-run the generator, so files that are *derived* from the mutated source
 * follow it.
 *
 * This is the difference between the two arms, and the parent assumption is
 * explicit that it decides the result: "the technique only detects the disease
 * if the mutation is applied at the point the two sides share". `SKILL.md` and
 * `.claude/commands/ost-setup.md` are generated from the manifest — `npm run
 * gen:skill`, mandated by `CLAUDE.md` whenever a generator input changes — so a
 * mutation that stops at the manifest leaves the tree in a state the repo's own
 * rules forbid, and every red it produces is staleness rather than a guard doing
 * its job.
 *
 * Returns the bytes the generator moved. Asserting that it moved *something* is
 * a control: a re-derivation that silently changed nothing would make this arm a
 * second copy of the other one, and both would agree for the wrong reason.
 */
export function rederive(dir: string): string[] {
  const generated = [
    ".claude/skills/opportunity-solution-tree/SKILL.md",
    ".claude/commands/ost-setup.md",
  ];
  const before = generated.map((f) => readIfPresent(path.join(dir, f)));
  const r = spawnSync(path.join(REPO_ROOT, "node_modules", ".bin", "tsx"), ["scripts/gen-skill.ts"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (r.status !== 0) throw new Error(`gen-skill failed (${r.status}): ${r.stdout ?? ""}${r.stderr ?? ""}`);
  return generated.filter((f, i) => readIfPresent(path.join(dir, f)) !== before[i]);
}

function readIfPresent(file: string): string | undefined {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
}

/**
 * Run the named specs in a scratch tree and report, per spec, whether it went
 * red.
 *
 * The local `vitest` binary rather than `npx`, for the reason
 * `test/cli/loop.test.ts` records: `npx` takes npm's cacache lock and concurrent
 * spawns contend on it. `--fileParallelism=false` because this runs *inside* a
 * suite that is already using the box, and this repository has lost a week to a
 * timing gate that was called flaky while the real answer was load. (`--maxWorkers`
 * is not the flag for it: against this config vitest refuses it outright with
 * "options.minThreads and options.maxThreads must not conflict", and the refusal
 * arrives as an *unhandled error with an empty report* rather than as a red
 * suite — which is precisely why the report, and not the exit code, is what this
 * function reads.)
 */
export function runGuards(dir: string, specs: readonly string[]): GuardVerdict[] {
  const report = path.join(dir, "mutation-report.json");
  spawnSync(
    path.join(REPO_ROOT, "node_modules", ".bin", "vitest"),
    ["run", ...specs, "--fileParallelism=false", "--reporter=json", `--outputFile=${report}`],
    { cwd: dir, encoding: "utf8", timeout: 600_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  // The exit code is deliberately not read: a red suite and a crashed runner
  // share it, and the two mean opposite things here. The report file is the
  // observation — if the runner died before writing one, that is a harness
  // failure and must not be scored as "every guard stayed green".
  if (!fs.existsSync(report)) {
    throw new Error(`vitest wrote no report in ${dir} for ${specs.join(", ")} — the run did not happen`);
  }
  return scoreReport(JSON.parse(fs.readFileSync(report, "utf8")) as VitestJsonReport, specs);
}

/** The slice of vitest's JSON reporter this harness reads. */
export interface VitestJsonReport {
  testResults: {
    name: string;
    status: string;
    assertionResults: { fullName: string; status: string }[];
  }[];
}

/**
 * Turn one vitest JSON report into a verdict per spec.
 *
 * Split out from {@link runGuards} so it can be driven from a constructed
 * report, which is the only way this harness can demonstrate *itself* able to
 * fail. Everything else here is a subprocess whose green is what is being
 * judged; the arithmetic that turns a report into an accusation is the one part
 * a caller can mutate directly, and a version of it that always returned
 * `killedTheMutant: false` would accuse every guard in the repository while
 * every control in the calling test stayed green. That mutation was run by hand
 * before this was extracted — it turned three of the ten assertions in
 * `test/guards/mutation-detects-self-derivation.test.ts` red — and the controls
 * there now hold it without anyone remembering to.
 *
 * A spec vitest did not report on throws rather than scoring as green: a file
 * that failed to collect measured nothing, and "measured nothing" must never
 * reach a caller wearing the same shape as "stayed green under the mutant".
 */
export function scoreReport(parsed: VitestJsonReport, specs: readonly string[]): GuardVerdict[] {
  return specs.map((spec) => {
    const file = parsed.testResults.find((t) => t.name.endsWith(spec.split("/").join(path.sep)));
    if (!file) throw new Error(`vitest reported nothing for ${spec} — it was not collected, so it measured nothing`);
    const assertions = file.assertionResults;
    const failedTests = assertions.filter((a) => a.status === "failed").map((a) => a.fullName);
    return {
      spec,
      killedTheMutant: file.status !== "passed",
      failed: failedTests.length,
      passed: assertions.filter((a) => a.status === "passed").length,
      failedTests,
    };
  });
}

/** Best-effort cleanup. `force` so a half-materialised tree is not a thrown error on top of one. */
export function discard(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
