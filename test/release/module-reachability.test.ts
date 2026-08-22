/**
 * No module ships with zero non-test callers. (V1 readiness, G3.)
 *
 * A module reachable only from its own tests is a module whose tests are the
 * only thing that has ever run it. That is not merely tidiness: the harness was
 * this repo's one prediction/outcome/score triple, and a harness varying a gene
 * that reached no consumer would have reported a fitness delta for a policy
 * nobody applied — corroboration manufactured out of noise, which is the exact
 * pathology earned believability (DEC-2) exists to prevent. `src/eval/correlate.ts`
 * was that module, and it shipped for months because nothing looked.
 *
 * **Reachability, not "is imported once."** A pair of dead modules that import
 * each other passes the weaker check, so the walk starts at the package's real
 * entry points and follows the import graph. Entry points are *derived*, not
 * listed: any `src/**.ts` path named in `package.json`'s scripts (the esbuild
 * bundle entry and the `tsx` dev entry are both `src/cli/index.ts`), plus
 * whatever `scripts/` imports directly. Nothing under `test/` is a caller.
 *
 * **On the known-unreachable list below.** The criterion warns that "excluding
 * dead modules" as a manual carve-out lets whoever runs the check make it pass
 * by declaring more modules dead. So this asserts **exact equality**, not
 * absence-of-new: widening the list is a visible commit that has to argue for
 * itself, and deleting or wiring up a module on it fails this test until the
 * entry comes off. The list is a debt register, not an exemption.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");

/**
 * Modules with no live caller today, each with the reason it is still here.
 *
 * **The register is empty, and an empty register is the strongest form of this
 * test** — `toEqual` below now asserts that nothing in `src/` is unreachable at
 * all, so the next dead module fails CI on the commit that strands it rather
 * than on the audit that eventually notices.
 *
 * The two entries it used to carry were both retired by the `loop` command:
 *
 *   - `src/loop/exitLaundering.ts` (H3). Its refusal message named
 *     `ost-agent loop step`, a command that did not exist. It exists now, and
 *     `loop step` calls the detector before it runs or records anything.
 *   - `src/adapters/tokens.ts`. It reads token spend out of Claude Code's
 *     session JSONL, which is the only place that number exists. `loop/spend.ts`
 *     reads it to enforce the ceiling, so `loop due` calls it before every
 *     firing.
 *
 * Note what "reachable" does and does not prove. Registering a `commander`
 * subcommand makes a module import-reachable, so this walk would let a module
 * off the register on the strength of a command nobody runs — the carve-out G3
 * warns about. Both of these are on the path
 * `examples/automation/autonomous-pass.sh` takes on every firing, which is why
 * they came off.
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  /*
   * The interpretive transcript read: a model answers a fixed question set about
   * a whole session, and every candidate it files must carry a verbatim span
   * located in the text it was handed, or it is dropped. Written, tested (19
   * tests, offline against an injected fake), and deliberately not wired.
   *
   * It is here rather than deleted, and unwired rather than shipped, because the
   * tree says so. Its node — "A model reads the raw transcript and files what the
   * pattern scan cannot see" — is `unvalidated`, and its definition of done is
   * "Blind-rate a model's reading of five already-harvested sessions", which needs
   * a person. The node also states the trade it asks the operator to accept:
   * every session read costs money in proportion to how much the product is used,
   * and this vault's operator has already recorded credential-and-cost as the
   * binding constraint on unattended work. Wiring it would be answering that
   * question with a commit instead of with the test that was designed to answer
   * it.
   *
   * What the register is for is exactly this: a module that is finished but
   * parked, named, with the reason and the thing that would unpark it. It comes
   * off when the blind rating is recorded, or the module goes when the node is
   * deferred.
   */
  "src/adapters/transcript-model-reader.ts":
    "built and tested; parked pending its node's blind-rating test, which is human-only",
  /*
   * Classifies a run's steps as credentialed or not and derives how much of a
   * run sat upstream of the first one — the assumption test beneath "Do
   * everything that needs no credential first, and bank the rest into one
   * approval", replayed against ten of this repository's own past runs
   * (`test/loop/credentialed-step-independence.test.ts`). The replay came back
   * short of the bar the solution node pre-committed (5 of 10 runs clear it,
   * not 6), which is the buildable permit this task held and discharged — a
   * red instrument made real, not a decision to build the reorder itself.
   * Nothing in this repository queues credentialed work or reorders a run yet;
   * that is a separate, still-unvalidated commitment. It comes off when the
   * reorder is built and this module becomes its classifier, or goes when the
   * node is deferred.
   */
  "src/loop/credentialedSteps.ts":
    "built and tested; parked pending a decision to build the reorder itself, which this assumption test did not clear",
  /*
   * The early-push cadence: replay the recorded 2026-07-26 collision with
   * skeleton pushes at an interval and measure when git's non-fast-forward
   * rejection first arrives. Its instrument is green — a 30-minute cadence
   * bounds the loss at 30 minutes from the colliding commit, against the eight
   * hours actually spent (`test/loop/early-push-collision-window.test.ts`).
   *
   * It is parked rather than wired because wiring it means the build loop
   * pushes unfinished work to a shared branch on a timer, and the solution
   * node itself names that a policy question for people — some repositories
   * refuse WIP on shared branches outright, and nobody has answered for this
   * one. The measurement the tree cleared is done; the adoption is a decision
   * the vault records, not one this register should smuggle in. It comes off
   * when the loop harness adopts `pushSchedule`, or goes when the node is
   * deferred.
   */
  "src/loop/early-push.ts":
    "built and tested; parked pending the operator's call on pushing WIP to a shared branch on a cadence",
  /*
   * Derives the next release number from the registry and origin's tags
   * rather than the local package.json — built and replayed against every
   * real ost-agent release (`test/release/registry-derived-version.test.ts`).
   * Not wired into a release script because there is no release script that
   * calls a registry left to call: RELEASING.md was rewritten on 2026-07-27
   * ("docs: one install path, and it isn't npm") to say plainly "There is no
   * publish step. There is no npm package," and package.json has carried
   * `"private": true` since that same commit. The registry this module
   * queries is npm's, and this package fully unpublished from it on
   * 2026-07-28 — a fact the replay test bakes in as a fixture rather than
   * a live call, since there is nothing left there to reach. The near-miss
   * this solution targets was real and the derivation is sound, but the
   * mechanism it would coordinate — two trains racing to publish the same
   * package — no longer exists in this repository's release path. It comes
   * off when a release path that publishes anywhere calls it, or goes when
   * the node is deferred because the coordination it solves has no release
   * left to apply to.
   */
  "src/release/next-version.ts":
    "built and replayed against real release history; parked because RELEASING.md's release path no longer publishes anywhere for it to coordinate",
  /*
   * Classifies a failed string replacement as stale-file, bad-quote, or
   * cannot-say against a run's own record of what it has read. Built and
   * tested to the assumption test's three-arm bar (`test/runner/failed-match-attribution.test.ts`),
   * but the run journal it consults — `ReadJournal.recordRead` — has to be
   * fed by whatever intercepts a tool call in the live runner, and no such
   * interception surface exists in this repository: there is no hook that
   * sees a Read or a failed Edit before this module could act on it. The
   * node's own text draws the same line — "lives in this product's runner
   * rather than in the host" — but the runner side of that split has not
   * been built. It comes off when a live tool-call surface exists to journal
   * reads and hand a failed match to `classifyFailedMatch`, or goes when the
   * node is deferred.
   */
  "src/runner/failed-match-attribution.ts":
    "built and tested; parked pending a live tool-call interception surface to feed its read journal, which does not exist in this repository yet",
  /*
   * The no-TTY prompt policy: given a run with no attached terminal and a
   * prompt's text, decide must-stop / answered-from-policy / outside-the-
   * policy, and journal the question, the answer and the citing policy line
   * for the ones it answers. Built and tested against the node's definition
   * of done (`test/runner/no-tty-policy-answer.test.ts`), including that a
   * destructive overwrite or a force push stops the run even when a policy
   * line is written to try to cover it.
   *
   * Not wired, because this repository never spawns the subprocess whose
   * stdin this module would answer for. `src/git/safe-git.ts` shells out
   * through `simple-git`, which never inherits a real terminal in the first
   * place, and there is no other place in `src/` that runs an external
   * command a human might otherwise sit and answer. The gap this module
   * closes is real — it is this vault's own session transcripts, this
   * product's own coding sessions, that hit it — but the process doing the
   * shelling-out there is the calling agent's shell tool, outside this
   * repository entirely. It comes off when something in `src/` spawns a
   * command with an inheritable stdin, or goes when the node is deferred.
   */
  "src/runner/no-tty-policy.ts":
    "built and tested; parked because this repository has no subprocess call site with an inheritable stdin for it to answer on behalf of",
  /*
   * Branch isolation and reviewable merge: `createAgentBranch` gives one pass
   * its own checkout via `git worktree add -b`, and `mergeAgentBranch` brings a
   * branch back as one real merge commit, never resolving a genuine collision by
   * picking a side (`test/git/branch-isolation-merge.test.ts`) — the buildable
   * permit `ost-agent buildable "Each agent writes on its own branch, and
   * merging is a deliberate, reviewable step"` held and discharged.
   *
   * Not wired, because nothing in this repository runs more than one build pass
   * against a vault at a time. Today a pass's own branch is one `git checkout -b`
   * a human or an agent runs by convention (CLAUDE.md), and the one merge that
   * exists — landing that single branch — already lives in `src/release/
   * ship-repo.ts`'s inline git calls, which sync-and-abort-on-conflict exactly as
   * this module does, for the one branch there is. Wiring this module means
   * deciding to run passes concurrently against isolated worktrees rather than
   * sequentially against one checkout, which is a scheduling decision for the
   * operator, not a git-layer one. It comes off when the loop runs concurrent
   * passes and adopts `createAgentBranch`/`mergeAgentBranch` as the mechanism, or
   * goes when the node is deferred.
   */
  "src/git/branch-isolation.ts":
    "built and tested; parked pending a decision to run more than one build pass concurrently, which nothing in this repository does yet",
  /*
   * Reads a commit subject and says whether that commit built structure or wrote
   * commentary about structure that already existed — the detection half of
   * "Idle down when a pass produces commentary instead of structure". Measured
   * against 2,950 commits of the meta vault labelled from their diffs, at 91.12%
   * against a bar of 90% pre-committed before the corpus was cut
   * (`test/loop/pass-shape-classifier.test.ts`).
   *
   * Parked because the assumption test that cleared this build measures
   * *detection*, and its own text refuses to carry further: "a green exit says the
   * classifier agrees with the fixture; it does not say the hand labels were
   * right, and it does not say throttling on that signal is a good idea." The
   * solution node names the counter-example itself — the most valuable artefact of
   * the run that first showed the decay was a builder briefing, it was
   * commentary-only, and it was last, so a classifier at 100% agreement would have
   * idled the loop immediately after the best thing the agent did. Wiring this to
   * `loop/cadence.ts` would answer a question about value with a commit instead of
   * with the evidence that was meant to answer it.
   *
   * It comes off when a schedule-backoff policy adopts `classifyPassShape` — which
   * needs the "commentary that repeats the previous pass's commentary" comparison
   * the solution node says the real rule requires, and which this module does not
   * attempt — or goes when the node is deferred.
   */
  "src/loop/pass-shape.ts":
    "built and measured at 91.12% against its pre-committed 90% bar; parked because that bar licenses detection, and the throttle it would feed is a spend decision the assumption test explicitly does not settle",
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

const SRC_FILES = tsFiles(srcRoot);
const rel = (p: string) => path.relative(repoRoot, p);

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  if (SRC_FILES.includes(base)) return base;
  const asIndex = base.replace(/\.ts$/, "/index.ts");
  return SRC_FILES.includes(asIndex) ? asIndex : null;
}

/** Static and dynamic imports alike — `await import(…)` is a caller too. */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = [
    ...[...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  return specifiers.map((s) => resolveSpecifier(file, s)).filter((p): p is string => p !== null);
}

/** Entry points, derived: every `src/**.ts` path package.json's scripts name. */
function packageEntryPoints(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    main?: string;
    bin?: string | Record<string, string>;
  };
  const declared = [
    ...Object.values(pkg.scripts ?? {}),
    pkg.main ?? "",
    ...(typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {})),
  ].join(" ");
  const named = [...declared.matchAll(/\bsrc\/[A-Za-z0-9/_.-]+\.ts\b/g)].map((m) => path.join(repoRoot, m[0]));
  return [...new Set(named)].filter((p) => SRC_FILES.includes(p));
}

/** Build tooling that consumes `src/` without being part of it. */
function scriptEntryPoints(): string[] {
  const dir = path.join(repoRoot, "scripts");
  if (!fs.existsSync(dir)) return [];
  return [...new Set(tsFiles(dir).flatMap(importsOf))];
}

function unreachableModules(): string[] {
  const seen = new Set<string>();
  const stack = [...packageEntryPoints(), ...scriptEntryPoints()];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) if (!seen.has(next)) stack.push(next);
  }
  return SRC_FILES.filter((f) => !seen.has(f)).map(rel);
}

describe("every src module has a non-test caller", () => {
  test("the entry points are derived and the graph is actually walked", () => {
    // Without this, a package.json rename would empty the root set and report
    // every module dead — or, worse, an empty SRC_FILES would report none.
    expect(packageEntryPoints().map(rel)).toContain("src/cli/index.ts");
    expect(SRC_FILES.length).toBeGreaterThan(30);
    expect(importsOf(path.join(srcRoot, "cli/index.ts")).length).toBeGreaterThan(5);
  });

  test("the unreachable set is exactly the known debt, module for module", () => {
    expect(unreachableModules()).toEqual(Object.keys(KNOWN_UNREACHABLE).sort());
  });

  test("every entry on the debt register still exists", () => {
    // A module deleted while its entry stayed would leave the register lying
    // about what the repo owes.
    for (const module of Object.keys(KNOWN_UNREACHABLE)) {
      expect(fs.existsSync(path.join(repoRoot, module)), `${module} is on the register but not on disk`).toBe(true);
    }
  });
});
