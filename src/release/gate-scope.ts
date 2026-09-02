/**
 * A gate records the capability it was set against, and refuses to pass a
 * smaller one.
 *
 * **The loophole, and where it differs from the sibling that is already built.**
 * {@link ./gate-coverage.ts} stops a run from *editing* what a gate covers: the
 * argv, the suite exclusions, the type-check roots. It cannot see the other
 * narrowing, which changes no declaration at all — the gate runs exactly the
 * command it always ran, and is simply asked about less. A generator gate that
 * compares one of the two artefacts its generator writes has not been edited; it
 * was set against two and answered about one, and it reports green. The tree
 * files this under "The agent narrows its own capability to get past a gate I
 * set", and the principle is the one `vacuous-red.ts` already applies to a
 * missing spec, extended from *nothing* to *less than agreed*: a check with an
 * empty subject is a failure rather than a pass, and so is a check with a
 * shrunken one.
 *
 * **What a scope is, mechanically.** Two lists and a number. The population that
 * existed to be judged ({@link GateSubject.eligible}), the members the gate was
 * actually asked about ({@link GateSubject.units}), and for each member how much
 * happened inside it ({@link SubjectUnit.work}). That shape is not decoration:
 * it is what makes {@link hollow} a *mechanical* transformation rather than a
 * per-gate judgement. Keep every path, set every `work` to zero, and you have
 * the evasion the solution names — the boundary intact, the inside emptied — for
 * any gate, without the author of a scope getting to decide what hollowing means
 * for their own gate.
 *
 * **A clause may be prose, and that is the finding rather than a gap.** The
 * assumption test beneath this asks whether a gate's coverage can be written
 * down at all, and expects some to resist: "easy for files and hard for
 * behaviours". A clause that could only be written as a sentence carries
 * `shortfall: null`, {@link scopeShortfall} skips it, and {@link expressibility}
 * reports the scope as not evaluable. The skip is the point — a vague clause
 * does not refuse anything, so a scope containing one passes subjects it was
 * meant to catch, which is exactly what "satisfied vacuously" means and exactly
 * what the census must not count as a success.
 *
 * **What a green census here does not settle**, in the node's own words: whether
 * a written scope stays current as the gate's purpose evolves. Nothing here
 * observes that; it is a habit over months and no exit code sees it. What this
 * does buy is that a scope which has rotted is a *file a person can read*
 * against the gate beside it, rather than a property nobody ever wrote down.
 */
import fs from "node:fs";
import path from "node:path";

/** One member of a gate's subject, and how much of it was actually judged. */
export interface SubjectUnit {
  /** Repository-relative, as the gate names it. */
  readonly path: string;
  /**
   * How much happened inside this member — cases executed, bytes compared,
   * lines the checker was allowed to judge. Zero means the boundary was kept
   * and the inside was emptied, which is the narrowing this file exists to
   * refuse.
   */
  readonly work: number;
}

/** What one gate run was asked about, against what there was to ask about. */
export interface GateSubject {
  readonly gate: string;
  /** Every member that existed to be judged. The population. */
  readonly eligible: readonly string[];
  /** The members the gate actually took in, with the work done inside each. */
  readonly units: readonly SubjectUnit[];
}

/** What a subject is missing against one clause. Empty means the clause is met. */
export type ScopeShortfall = (subject: GateSubject) => readonly string[];

/** One requirement a subject must meet for a gate to have covered its scope. */
export interface ScopeClause {
  readonly id: string;
  /** For a reader. Never consulted by the evaluator — a clause IS its program. */
  readonly requires: string;
  /**
   * The program, or `null` when the requirement could only be written as a
   * sentence. A prose clause is the exercise's negative result, carried as data
   * rather than as an omission so the census can count it.
   */
  readonly shortfall: ScopeShortfall | null;
}

/** Where a real run's subject can be read from, which is not always anywhere. */
export type SubjectSource =
  /** The gate prints it: counts or names in its own output. */
  | "run-output"
  /** Read off the working tree — file sizes, file lists — after the gate ran. */
  | "repository"
  /** Neither: the gate is silent on success and the tree does not hold the answer. */
  | "unobservable";

/** What one gate was set against, in a form two runs of it can be compared in. */
export interface DeclaredGateScope {
  /** The gate's name in `gates.declared.ts`, or the function that refuses. */
  readonly gate: string;
  /** What the gate is for, in one line — the capability, not the command. */
  readonly why: string;
  /** What one member of the subject is. */
  readonly unit: string;
  /** What `work` counts for this gate, so a reader can check a subject by hand. */
  readonly work: string;
  readonly observedFrom: SubjectSource;
  readonly clauses: readonly ScopeClause[];
  /**
   * A subject that covers this scope: the witness that the clauses are
   * satisfiable at all. Without it a clause set of `() => ["never"]` would score
   * as non-vacuous, and a scope nothing can meet is as useless as one everything
   * meets.
   */
  readonly covering: GateSubject;
  /** Why the scope could not be written as a program, when it could not. */
  readonly resists?: string;
}

/**
 * The same subject with its boundary intact and its inside emptied.
 *
 * Mechanical and gate-agnostic on purpose. The vacuity check is the load-bearing
 * half of the assumption test, and a hollowing each scope defined for itself
 * would let the author of a weak scope also author the test that lets it
 * through.
 */
export function hollow(subject: GateSubject): GateSubject {
  return {
    gate: subject.gate,
    eligible: [...subject.eligible],
    units: subject.units.map((u) => ({ path: u.path, work: 0 })),
  };
}

/** Everything this subject is missing against this scope. Empty means covered. */
export function scopeShortfall(scope: DeclaredGateScope, subject: GateSubject): string[] {
  const found: string[] = [];
  for (const clause of scope.clauses) {
    // A prose clause refuses nothing. Skipping it is what makes a scope holding
    // one *pass* a subject it should have caught, which is the failure the
    // census reports rather than a leniency it hides.
    if (!clause.shortfall) continue;
    for (const missing of clause.shortfall(subject)) found.push(`${clause.id}: ${missing}`);
  }
  return found;
}

/** Does this subject cover what the gate was set against? */
export function covers(scope: DeclaredGateScope, subject: GateSubject): boolean {
  return scopeShortfall(scope, subject).length === 0;
}

/* ------------------------------------------------------------------ *
 * The two programs every file-shaped scope in this repository reduced to.
 *
 * They are shared rather than rewritten per gate because the exercise's finding
 * is that they ARE the same two questions everywhere the subject is a set of
 * files — "was the gate asked about everything there was" and "did anything
 * happen inside each thing it was asked about". A gate whose subject is not a
 * set of files does not get a third program here; it gets a prose clause and a
 * place in the census's failing column.
 * ------------------------------------------------------------------ */

/** Members of the population the gate was never asked about. */
export function unaskedMembers(subject: GateSubject): string[] {
  const asked = new Set(subject.units.map((u) => u.path));
  return subject.eligible.filter((p) => !asked.has(p)).map((p) => `${p} was never asked about`);
}

/** Members the gate took in and did no work inside. */
export function hollowMembers(subject: GateSubject): string[] {
  return subject.units.filter((u) => u.work <= 0).map((u) => `${u.path} was taken in and nothing happened inside it`);
}

/** What the exercise found when it tried to write one gate's scope down. */
export interface ScopeVerdict {
  readonly gate: string;
  /** Every clause is a program, and there is at least one. */
  readonly evaluable: boolean;
  /** The covering witness meets every programmed clause. */
  readonly satisfiable: boolean;
  /** Hollowing the witness makes the scope go red. */
  readonly nonVacuous: boolean;
  /** All three. The count the assumption test's threshold is over. */
  readonly expressible: boolean;
  /** Clauses that could only be written as a sentence, by id. */
  readonly proseClauses: readonly string[];
  /** Why, in one line, for a reader who is not going to run this. */
  readonly why: string;
}

/** Try one declared scope against the three things a usable scope must be. */
export function expressibility(scope: DeclaredGateScope): ScopeVerdict {
  const prose = scope.clauses.filter((c) => !c.shortfall).map((c) => c.id);
  const evaluable = scope.clauses.length > 0 && prose.length === 0;
  const satisfiable = scopeShortfall(scope, scope.covering).length === 0;
  const nonVacuous = scopeShortfall(scope, hollow(scope.covering)).length > 0;
  const expressible = evaluable && satisfiable && nonVacuous;

  let why: string;
  if (expressible) why = "written as a program, satisfiable, and red when its subject is hollowed";
  else if (!evaluable && prose.length > 0) why = `needs a clause no program reads: ${prose.join(", ")}`;
  else if (!evaluable) why = "no clauses — the coverage could not be written down at all";
  else if (!satisfiable) why = "no subject can meet it, so it refuses everything rather than the narrowings";
  else why = "survives hollowing: keep the boundary, empty the inside, and it still reads green";

  return { gate: scope.gate, evaluable, satisfiable, nonVacuous, expressible, proseClauses: prose, why };
}

/** The exercise's result across a set of gates. */
export interface ExpressibilityCensus {
  readonly verdicts: readonly ScopeVerdict[];
  readonly expressible: number;
  readonly attempted: number;
}

/** Run the exercise over every declared scope. */
export function expressibilityCensus(scopes: readonly DeclaredGateScope[]): ExpressibilityCensus {
  const verdicts = scopes.map(expressibility);
  return { verdicts, expressible: verdicts.filter((v) => v.expressible).length, attempted: verdicts.length };
}

/**
 * Why this gate run may not be counted as a pass. Empty means it may.
 *
 * A scope that is not expressible refuses nothing — it has no program to refuse
 * with, and inventing one here out of its prose is the vagueness the census
 * exists to report rather than paper over.
 */
export function scopeRefusals(scope: DeclaredGateScope, subject: GateSubject): string[] {
  if (!expressibility(scope).expressible) return [];
  const missing = scopeShortfall(scope, subject);
  if (missing.length === 0) return [];
  return [
    `refusing to pass gate "${scope.gate}": it was set against ${scope.why}, and this run was asked about less — ` +
      `${missing.join("; ")}. A gate answered about a smaller subject than it was set against reports nothing, ` +
      "the same way a check with an empty subject does. Widen what the gate is asked about; do not narrow what it was set against.",
  ];
}

/* ------------------------------------------------------------------ *
 * Readers: turning a real run into a subject.
 * ------------------------------------------------------------------ */

/**
 * How big an artefact is, or `null` when the question could not be answered.
 *
 * The `null` is load-bearing and is the same distinction `vacuous-red.ts` draws
 * for instruments: a size that could not be read is not a size of zero. Reading
 * it as zero would refuse every gate whose measurement apparatus broke, which
 * inverts the failure this module exists for — the point is to catch a gate
 * asked about less, not to convict one that could not be asked at all.
 */
export type ArtifactSize = (relPath: string) => number | null;

/** Sizes read off the working tree. A path that is not a file is zero, not null. */
export function workingTreeSize(repo: string): ArtifactSize {
  return (rel) => {
    try {
      const stat = fs.statSync(path.join(repo, rel));
      return stat.isFile() ? stat.size : 0;
    } catch {
      return 0;
    }
  };
}

/**
 * Sizes read out of the committed tree, through an injected command runner.
 *
 * The committed side rather than the working-tree side, because that is the side
 * a drift gate exists to protect, and through the runner rather than `fs` for
 * the reason the whole of `ship-repo.ts` is built that way: every decision here
 * stays testable without a repository. A `git cat-file -s` that exits non-zero
 * means the path is not in `HEAD` — an artefact that is not there — while a zero
 * exit with something that is not a number means the runner did not answer, and
 * those two are not the same fact.
 */
export function committedSize(repo: string, run: (argv: readonly string[], cwd: string) => { status: number | null; output: string }): ArtifactSize {
  return (rel) => {
    const result = run(["git", "cat-file", "-s", `HEAD:${rel}`], repo);
    if (result.status !== 0) return 0;
    const size = Number(result.output.trim());
    return Number.isFinite(size) && result.output.trim().length > 0 ? size : null;
  };
}

/**
 * The subject of a generator gate: the committed artefacts it compared.
 *
 * `work` is the artefact's size, which is the one number that separates
 * "compared this file" from "compared a path that is not there". The second is
 * not hypothetical — `GENERATED_ARTIFACT` names `SKILL.md` for the skill-drift
 * gate and the generator writes `.claude/skills/opportunity-solution-tree/SKILL.md`,
 * so `git status --porcelain -- SKILL.md` has been exiting 0 with empty output
 * against a path that has never existed. That gate could not fail.
 *
 * Returns `null` when any size could not be read: an unobserved subject is not a
 * small one, and a gate is only refused on what was actually seen.
 */
export function artifactSubject(
  gate: string,
  eligible: readonly string[],
  examined: readonly string[],
  sizeOf: ArtifactSize,
): GateSubject | null {
  const units: SubjectUnit[] = [];
  for (const rel of examined) {
    const size = sizeOf(rel);
    if (size === null) return null;
    units.push({ path: rel, work: size });
  }
  return { gate, eligible: [...eligible], units };
}

/**
 * How many test files and cases a vitest run reported, from its own output.
 *
 * Counts, not names: the default reporter prints `Test Files  271 passed (271)`
 * and nothing per file. That is the whole of what the suite gate makes visible
 * about its own subject, and the per-file half of its scope needs a reporter the
 * gate's argv does not ask for — argv being a thing only a human may change
 * (`gate-coverage.ts`). The limit is recorded on the declaration rather than
 * worked around here.
 */
export function vitestRunCounts(output: string): { files: number; tests: number } | null {
  const files = /Test Files\s+.*?\((\d+)\)/.exec(output);
  const tests = /\bTests\s+.*?\((\d+)\)/.exec(output);
  if (!files || !tests) return null;
  return { files: Number(files[1]), tests: Number(tests[1]) };
}
