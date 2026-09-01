/**
 * Scores mutation testing against the one population where the answer is
 * already known: the three files named in "A guard derived the rule it was
 * checking, so it agreed with the bug for 23 releases" (vault, 2026-08-06).
 * Each derived the MCP tool-name prefix from `.claude-plugin/plugin.json`, all
 * three the same wrong way, and all three shipped green for 23 releases.
 *
 * The vault solution — "Require every guard to demonstrate it can fail, by
 * mutating the thing it claims to protect" — predicts that mutating the
 * manifest's server name makes each of those guards follow the mutation and
 * stay green, and its assumption test sets the bar at **three of three, not a
 * majority**. That prediction is what this file settles. It is not a bar the
 * technique is expected to clear, and the numbers below are the measurement,
 * not a target: the sibling `provenance-census-scores-against-known-defects.test.ts`
 * scored 0 of 3 for the syntactic census and this file is the same experiment
 * with the expensive technique.
 *
 * **The result, up front.** Under the arm that follows the shared source, the
 * technique flags **one** of the three, and it is not one of the two guards —
 * it is the generator, which has no assertion to score in the first place. The
 * two real guards are killed by the mutant, which scores them healthy. And the
 * *repaired* tree behaves identically to the defective one on every arm, so this
 * technique's verdict does not move when the bug is fixed.
 *
 * **Two arms, because the parent assumption says the arm decides the answer.**
 * It is explicit: "the technique only detects the disease if the mutation is
 * applied at the point the two sides share, and knowing where that is requires
 * already knowing which guards are self-derived — which is the thing being
 * detected."
 *
 *   - **Arm A — manifest only.** The naive mutation. `SKILL.md` and
 *     `.claude/commands/ost-setup.md` are *generated* from the manifest, so
 *     leaving them alone puts the tree in a state `CLAUDE.md` forbids (a
 *     generator input changed and `npm run gen:skill` was not run). Every red it
 *     produces is staleness.
 *   - **Arm B — manifest, then re-derive.** The same tree as arm A with
 *     `scripts/gen-skill.ts` re-run over it, which is what a real rename would
 *     look like on a commit a reviewer would accept. This is the mutation "at
 *     the point the two sides share".
 *
 * Arm B is run over the tree arm A left behind rather than over a fresh one, so
 * the re-derivation is the *only* difference between the two verdicts.
 *
 * **Two eras, because the ground truth is historical.** `4521f06^` is the commit
 * before `fix(plugin): every grant named a tool no plugin session mints`, where
 * all three files are still defective — the same commit
 * `test/fixtures/provenance-census/PROVENANCE.md` cut its blobs from. Whole tree
 * from `git archive` rather than the three blobs, because a guard has to be
 * *run*, and running it needs the repository it reads. The second era is the
 * working tree as it stands, which turns "did the fix change this property?"
 * from a reading into a measurement.
 *
 * **On the word "red".** The vault test's threshold — "all three prefix guards
 * go red under a mutation" — reads two ways, and the two are opposites. Taken
 * literally (the spec file exits non-zero) it is a statement that the guards are
 * *sensitive*, which is a clean bill of health and the technique finding
 * nothing. Taken as the solution body means it ("a guard that derives its
 * expectation from that same manifest follows the mutation and **stays
 * green**"), a flagged guard is a green run. Both readings are scored below,
 * separately and by name, because the wording is satisfied by the arm that
 * detects nothing and refuted by the arm that detects something — which is
 * itself the sharpest thing this pass found.
 *
 * **Non-vacuity, and how it was proved.** A file whose subject is "make every
 * guard demonstrate it can fail" owes the demonstration first, and none of it
 * rests on the six subprocess runs being green. The baseline block fails if any
 * scratch tree could not run a guard; `applyMutation` is driven with a cut that
 * matches nothing and a cut that matches too much and must refuse both; and
 * `scoreReport` is scored against constructed reports whose verdicts are known.
 * The last of those replaced a hand mutation run while this was being written —
 * forcing `killedTheMutant` to `false` in the harness turned three of these
 * assertions red, the score among them — so the proof is committed rather than
 * remembered.
 */
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import {
  applyMutation,
  discard,
  materialiseCommit,
  materialiseWorkingTree,
  rederive,
  runGuards,
  scoreReport,
  type GuardVerdict,
  type Mutation,
  type VitestJsonReport,
} from "../../scripts/mutation-harness.js";

/**
 * The three subjects, at the paths they occupy in the tree.
 *
 * `scripts/gen-skill.ts` is the third of the three files the vault names, and it
 * contains no `expect(…)` — it computed the wrong prefix and wrote it into
 * `SKILL.md`, and nothing in it ever agreed or disagreed with anything. The
 * nearest standing check over its output is `test/skill/drift.test.ts`, which
 * re-renders in memory and compares byte for byte, so that is what is run in its
 * place. Saying so out loud matters: the vault counts "three prefix guards" and
 * the repository has **two guards and one unguarded generator**, which means a
 * three-of-three bar cannot be met by any technique that scores guards.
 */
const ALLOWLISTS = "test/release/command-allowlists.test.ts";
const PARITY = "test/skill/surface-parity.test.ts";
const DRIFT = "test/skill/drift.test.ts";
const SPECS = [ALLOWLISTS, PARITY, DRIFT] as const;

/**
 * Rename the MCP server the plugin declares.
 *
 * The `mcpServers` key, not the plugin `name`: it is the field named by the
 * assumption test, and it is in both the defective derivation
 * (`mcp__<server>__`) and the repaired one (`mcp__plugin_<plugin>_<server>__`),
 * so one mutation reaches both eras. Exactly one site in the file, which
 * `applyMutation` enforces rather than trusts — `"ost-agent"` also appears as
 * the plugin's own `name`, and cutting both would be a different experiment
 * wearing this one's write-up.
 */
const RENAME_SERVER: Mutation = {
  file: ".claude-plugin/plugin.json",
  find: '"ost-agent": {',
  replace: '"ost-mutant": {',
};

/** The commit before the repair. See the header for why the whole tree is needed. */
const DEFECTIVE_ERA = "4521f06^";

interface Era {
  readonly label: string;
  /** Unmutated. Must be green, or nothing else in the era means anything. */
  baseline: GuardVerdict[];
  /** Manifest cut, generated files left stale. */
  armA: GuardVerdict[];
  /** Same tree, generator re-run. */
  armB: GuardVerdict[];
  /** Which generated files the re-derivation actually moved. */
  rederived: string[];
}

const eras = new Map<string, Era>();
const scratch: string[] = [];

function verdict(era: Era, arm: "baseline" | "armA" | "armB", spec: string): GuardVerdict {
  const found = era[arm].find((v) => v.spec === spec);
  if (!found) throw new Error(`no verdict for ${spec} in ${era.label}/${arm}`);
  return found;
}

/** Did the spec stay green under the mutant — i.e. did the harness flag it as unable to fail? */
function flagged(era: Era, arm: "armA" | "armB", spec: string): boolean {
  return !verdict(era, arm, spec).killedTheMutant;
}

/**
 * Whether one named assertion inside a spec survived the mutant.
 *
 * Matched on a distinctive fragment of the assertion's own title rather than on
 * a line number, and the baseline is consulted first so that "it did not fail"
 * cannot be returned for a spec that ran nothing. If the fragment ever stops
 * naming an assertion — renamed, deleted — the caller's expectation flips and
 * this file says so, which is the intended behaviour: the finding is about a
 * specific assertion, not about a file.
 */
function assertionSurvived(era: Era, arm: "armA" | "armB", spec: string, fragment: string): boolean {
  if (verdict(era, "baseline", spec).passed === 0) throw new Error(`${spec} measured nothing in ${era.label}`);
  return !verdict(era, arm, spec).failedTests.some((name) => name.includes(fragment));
}

/**
 * Six vitest runs, in two groups of three. Synchronous on purpose: every step
 * mutates the tree the next one reads, so ordering is the experiment, and the
 * hook timeout is the honest bound on the whole thing rather than on one run.
 *
 * ~30 s of the suite's wall clock. Measured against the alternative rather than
 * asserted: this file present, the full suite finished in 413 s; removed, the
 * same suite on the same commit and machine finished in 428 s and 437 s. The
 * cost is real but it is inside the load-dependent spread D1 already records
 * (207 s and 341 s with no code between the runs), which is why it is stated
 * here as a measurement someone can repeat and not as "negligible".
 */
beforeAll(() => {
  for (const [label, make] of [
    ["defective", () => materialiseCommit(DEFECTIVE_ERA, "defective")],
    ["repaired", () => materialiseWorkingTree("repaired")],
  ] as const) {
    const dir = make();
    scratch.push(dir);
    const baseline = runGuards(dir, SPECS);
    applyMutation(dir, RENAME_SERVER);
    const armA = runGuards(dir, SPECS);
    const rederived = rederive(dir);
    const armB = runGuards(dir, SPECS);
    eras.set(label, { label, baseline, armA, armB, rederived });
  }
}, 300_000);

afterAll(() => {
  for (const dir of scratch) discard(dir);
});

const DEFECTIVE = () => eras.get("defective") as Era;
const REPAIRED = () => eras.get("repaired") as Era;

// ── controls: the experiment happened, and it could have come out either way ──

describe("the harness is measuring something", () => {
  test("both eras are green before the mutation, so a red afterwards is the mutation", () => {
    // Without this the whole file is unreadable: a scratch tree missing a file,
    // an old `package.json` against today's `node_modules`, a spec that failed
    // to collect — each of those makes every guard "go red under mutation" while
    // measuring nothing at all.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      for (const spec of SPECS) {
        const v = verdict(era, "baseline", spec);
        expect(v.killedTheMutant, `${era.label} baseline ${spec} failed: ${v.failedTests.join("; ")}`).toBe(false);
        expect(v.passed, `${era.label} baseline ${spec} ran no assertions`).toBeGreaterThan(0);
      }
    }
  });

  test("a mutation that cuts no site, or more than one, is refused rather than run", async () => {
    // The two ways a mutation arm becomes a lie. Cut nothing and every guard
    // "stays green", which this file would report as every guard being blind —
    // a false accusation delivered by a clean run. Cut two sites and the verdict
    // belongs to an experiment nobody wrote up.
    const dir = materialiseWorkingTree("control");
    scratch.push(dir);
    expect(() => applyMutation(dir, { ...RENAME_SERVER, find: '"not-in-this-file": {' })).toThrow(
      /must cut exactly one site.*found 0/s,
    );
    // Bare `ost-agent` also matches the plugin's own `name` and its prose
    // description — the over-broad cut this guard exists to refuse.
    expect(() => applyMutation(dir, { ...RENAME_SERVER, find: "ost-agent" })).toThrow(
      /must cut exactly one site.*found [2-9]/s,
    );
  });

  test("the harness itself demonstrates it can fail, by mutating the thing it reads", () => {
    // The one instrument in this file that is not a subprocess: the arithmetic
    // that turns a vitest report into an accusation. A version of it stuck on
    // "nothing killed the mutant" would flag every guard in the repository and
    // every other control here would stay green, which is this whole
    // opportunity's disease reappearing inside the technique built to detect it.
    // So it is scored against two constructed reports whose answers are known.
    const report = (status: string): VitestJsonReport => ({
      testResults: [
        {
          name: `/tmp/scratch/${DRIFT}`,
          status,
          assertionResults: [{ fullName: "generated skill in sync", status }],
        },
      ],
    });
    expect(scoreReport(report("passed"), [DRIFT])[0].killedTheMutant).toBe(false);
    expect(scoreReport(report("failed"), [DRIFT])[0].killedTheMutant).toBe(true);
    // And a spec the runner never reported on is a throw, not a green: "measured
    // nothing" must not reach a caller wearing the shape of "stayed green".
    expect(() => scoreReport(report("passed"), [PARITY])).toThrow(/it was not collected/);
  });

  test("re-deriving actually moved bytes, so arm B is not a second copy of arm A", () => {
    // If the generator wrote the same file back, the two arms would agree for a
    // reason that has nothing to do with the property under test.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      expect(era.rederived, `${era.label} re-derivation changed nothing`).toEqual([
        ".claude/skills/opportunity-solution-tree/SKILL.md",
        ".claude/commands/ost-setup.md",
      ]);
    }
  });
});

// ── arm A: the mutation applied at the wrong place ───────────────────────────

describe("arm A — manifest cut, generated files left stale", () => {
  test("all three subjects go red, which is the vault threshold met and nothing detected", () => {
    // This is the literal reading of "all three prefix guards go red under a
    // mutation of the manifest field they derive from" — and it is satisfied
    // here, in the arm that finds nothing. Every red is staleness: the guards
    // are comparing a mutated derivation against generated files the mutation
    // did not regenerate, which `CLAUDE.md` already forbids as a tree state.
    // Reported as sensitivity, it would clear all three guards on the day the
    // bug was live.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      for (const spec of SPECS) {
        expect(flagged(era, "armA", spec), `${era.label} armA ${spec}`).toBe(false);
      }
    }
  });
});

// ── arm B: the mutation applied at the point the two sides share ─────────────

describe("arm B — manifest cut, generator re-run", () => {
  test("the generator's output guard survives the mutant: SKILL.md follows the rename", () => {
    // `test/skill/drift.test.ts` compares the committed skill against a
    // re-render. Both sides read the mutated manifest, so both moved, so the
    // comparison cannot disagree. This is the shape the opportunity names,
    // caught exactly as the solution said it would be — and it is the *only*
    // one of the three caught.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      expect(flagged(era, "armB", DRIFT), `${era.label} armB ${DRIFT}`).toBe(true);
    }
  });

  test("both real guards kill the mutant, so the technique scores them healthy", () => {
    // The two files that actually contain assertions about the prefix go red,
    // which in mutation testing is a pass. On the day this measurement is taken
    // both are known-defective in the defective era — the technique clears them.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      expect(flagged(era, "armB", ALLOWLISTS), `${era.label} armB ${ALLOWLISTS}`).toBe(false);
      expect(flagged(era, "armB", PARITY), `${era.label} armB ${PARITY}`).toBe(false);
    }
  });

  test("but the assertion that names the prefix survives inside a spec that went red", () => {
    // File granularity hides this. `surface-parity.test.ts` is killed by ONE
    // assertion, and it is not a D3 assertion at all: it reads
    // `.claude/commands/ost-pass.md`, a hand-written file that no generator
    // touches. The assertion the criterion is about —
    // `expect(prefixProblems(skill, MCP_PREFIX)).toEqual([])` — has both sides
    // derived from the mutated manifest and stays green.
    //
    // So the score is granularity-dependent: 1 of 3 by spec file, 2 of 3 by the
    // assertion that encodes the prefix rule. Neither is 3, and a harness that
    // scored by file would have reported this guard as healthy on the strength
    // of a collateral assertion about a different file.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      expect(
        assertionSurvived(era, "armB", PARITY, "carries the prefix the plugin manifest mints"),
        `${era.label}: the D3 prefix assertion was killed — ${verdict(era, "armB", PARITY).failedTests.join("; ")}`,
      ).toBe(true);
      expect(
        assertionSurvived(era, "armB", PARITY, "a skill grant is not a command grant"),
        `${era.label}: the collateral /ost-pass assertion survived, so it is not what killed this spec`,
      ).toBe(false);
    }
  });

  test("command-allowlists is killed by its own prefix assertion — a literal is why", () => {
    // `expect(MCP_PREFIX).toBe("mcp__ost-agent__")`, in the defective era. The
    // expected side is a hardcoded string, so the guard is fully sensitive to
    // the manifest and mutation cannot see anything wrong with it. It was still
    // wrong for 23 releases, because what it got wrong — that a plugin session
    // mints `mcp__plugin_<plugin>_<server>__` — is not in the manifest at all.
    for (const era of [DEFECTIVE(), REPAIRED()]) {
      expect(
        assertionSurvived(era, "armB", ALLOWLISTS, "the CLI subcommand set are both populated"),
        `${era.label}: the derived-authorities assertion was expected to be killed`,
      ).toBe(false);
    }
  });
});

// ── the score, and what it settles ───────────────────────────────────────────

describe("scored against the three guards that agreed with the bug", () => {
  test("the score: 1 of 3 under the faithful arm, 0 of 3 under the naive one", () => {
    // The number the assumption test exists to settle. Its threshold was three
    // of three — "a technique that catches two of the three known cases has no
    // claim on the unknown ones" — and it is not met under either arm, so the
    // assumption is refuted rather than confirmed. What a manifest mutation
    // detects is the ONE subject with a generated counterparty; the two guards
    // whose counterparties are hand-written command files are sensitive to the
    // manifest and blind to the rule, and no mutation of a committed file
    // reaches a belief that was copied by hand into nine of them.
    const era = DEFECTIVE();
    expect(SPECS.filter((s) => flagged(era, "armB", s))).toEqual([DRIFT]);
    expect(SPECS.filter((s) => flagged(era, "armA", s))).toEqual([]);
  });

  test("the repair did not move this measurement: every arm scores identically", () => {
    // `4521f06` replaced three independent derivations with one shared import
    // from `scripts/mcp-prefix.ts` and corrected the rule. The mutation verdicts
    // are the same on both sides of it, spec for spec and arm for arm. So this
    // technique's output is not a proxy for "the bug is fixed" — it would have
    // said the same thing the day before the repair and the day after, in both
    // directions.
    for (const arm of ["armA", "armB"] as const) {
      const before = SPECS.filter((s) => flagged(DEFECTIVE(), arm, s));
      const after = SPECS.filter((s) => flagged(REPAIRED(), arm, s));
      expect(after, `${arm} moved across the repair`).toEqual(before);
    }
  });
});
