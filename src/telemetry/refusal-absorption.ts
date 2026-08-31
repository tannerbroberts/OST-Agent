/**
 * The refusal-absorption census: of the refusal classes that recur most, how
 * many exist for a reason that could be accommodated rather than enforced — and
 * how much of the refusal volume do those cover?
 *
 * The solution under test is "Refusals the tool can prevent become refusals the
 * tool never issues": for the classes that fire most often, stop correcting the
 * caller and remove the occasion for the correction, so a lesson nobody has to
 * learn cannot be forgotten. Its own body names the risk that decides whether it
 * is worth doing — *some refusals are load-bearing safety, and accommodating the
 * wrong form is how a guardrail becomes decorative* — and the assumption test
 * fixed the bar in advance: **at least 4 of the top 10 classes judged safe to
 * absorb, covering 30% or more of all refusals fired.**
 *
 * Both halves have to clear, and they fail in opposite directions: four classes
 * that are each rare clear the count and fail the coverage, and one heavy class
 * clears the coverage and fails the count. {@link AbsorptionReading} reports each
 * half separately for that reason.
 *
 * ## The verdict is derived from two prose fields, never written down as a verdict
 *
 * A census whose answer is a `safe: true` column is a census that can be tuned by
 * whoever writes the column. So no judgement in {@link ABSORPTION_RULE} states a
 * verdict. Each states two things a reader can disagree with individually:
 *
 * - {@link AbsorptionJudgement.protects} — what real harm the refusal prevents,
 *   or `null` when it enforces only a convention;
 * - {@link AbsorptionJudgement.absorption} — the specific behaviour that would
 *   honour the call as made, or `null` when there is nothing to honour it with.
 *
 * {@link verdictOf} derives the verdict from the pair, and the test beside this
 * file requires every `protects` and every `absorption` to be a sentence rather
 * than a flag. A class that protects nothing and has no accommodation is neither
 * safe nor load-bearing — it is `nothing-to-absorb`, and collapsing that third
 * answer into either of the other two is how this count would have been wrong.
 *
 * ## Two readings, because the judge is the interested party
 *
 * The assumption test names its own bias: "the judgements are made by the person
 * who wrote most of these refusals, which biases toward believing each was
 * necessary". A single reading would leave that unanswerable, so the census takes
 * the count twice:
 *
 * - **`strict`** — safe means the refusal protects nothing real AND an
 *   accommodation exists. This is the reading the assumption test's own sentence
 *   describes, and {@link AbsorptionCensus.verdict} is taken on it.
 * - **`could-have-honoured`** — safe means only that an accommodation exists,
 *   whatever the refusal defends. This is the reading a judge with the opposite
 *   bias would take, and it is deliberately generous: it counts absorbing a
 *   guardrail as absorbable.
 *
 * If both readings agree, the judgement did not decide the answer and nobody has
 * to trust the judge. {@link AbsorptionCensus.judgementDecides} says on the
 * report's face when they do not.
 *
 * ## Who issues the refusal is reported before any share
 *
 * A refusal can only be absorbed by the surface that issues it. This census
 * therefore leads with {@link AbsorptionCensus.byIssuer}, for the same reason the
 * refusal-coverage census leads with reach: a share taken over classes this
 * repository cannot change reads as work it could do.
 *
 * ## The load-bearing column is not ratified
 *
 * `ABSORPTION_RULE.ratifiedBy` is `null`, and the solution node is explicit about
 * what that means: "which classes are safe to absorb is a human's call, not a
 * pass's", and "a human should read the load-bearing column before anything is
 * built from the safe column". The judgements below were composed by a build pass
 * from the corpus and from this repository's own committed guards. They are a
 * proposal a person can check line by line, and until one has, a green run of the
 * instrument means the count has been taken — never that anything may be removed.
 */
import type { FailingCall } from "./path-failure-attribution.js";
import { REFUSAL_RULE } from "./refusal-coverage.js";
import {
  classifyRefusal as classifyUsageRefusal,
  REFUSAL_CLASSES,
  type RecordedRefusal,
} from "./refusal-precondition-coverage.js";

/** Whose surface issues the refusal — the only surface that could absorb it. */
export type Issuer =
  /** This repository's MCP tools or CLI. */
  | "this-repository"
  /** The harness, or a third-party tool: not ours to change. */
  | "another-surface";

/** How the occasion for the correction would be removed. */
export type AbsorptionMode =
  /** Accept the wrong form and do the right thing. */
  | "accommodate"
  /** Change the surface so the wrong form cannot be composed in the first place. */
  | "make-uncomposable";

export type AbsorptionVerdict = "safe-to-absorb" | "load-bearing" | "nothing-to-absorb";

/** One class, judged. Both fields are prose; the verdict is derived from them. */
export interface AbsorptionJudgement {
  /** The class id, as {@link REFUSAL_RULE} or {@link REFUSAL_CLASSES} names it. */
  cls: string;
  issuedBy: Issuer;
  /**
   * What the refusal defends, in one line, or `null` when it enforces a
   * convention the surface could simply have honoured.
   */
  protects: string | null;
  /** The behaviour that would honour the call, or `null` when none exists. */
  absorption: { mode: AbsorptionMode; behaviour: string } | null;
  /**
   * Where this repository already does the thing, as `file.ts:symbol`. Present
   * only where a shipped instance exists — a judgement backed by running code is
   * worth more than one backed by an argument, and the test requires the file to
   * exist.
   */
  precedent?: string;
}

/**
 * The judgements, and the bar, committed in source.
 *
 * Order is by the class id's own taxonomy, not by frequency, so two runs over
 * different corpora are read side by side.
 */
export const ABSORPTION_RULE = {
  /** The bar the assumption test fixed before anything was counted. Both halves. */
  bar: { classes: 4, coverage: 0.3 },

  /** How many classes the assumption test looks at. */
  topN: 10,

  /**
   * The corpus the verdict is taken on, and why it rather than the other.
   *
   * The transcript record is the one the parent opportunity was harvested from
   * and the one the solution node points at ("the candidates are visible directly
   * in the friction record"). It is also the corpus where the assumption test's
   * declared bias does not apply: this repository wrote almost none of the
   * refusals in it, so a finding that comes out low there cannot be explained by
   * the judge defending their own guards.
   */
  verdictCorpus: "transcript",

  /**
   * Nobody has ratified the load-bearing column. See the module note; the test
   * asserts this by name so that ratifying it is a deliberate edit rather than a
   * thing that happens by drift.
   */
  ratifiedBy: null as string | null,

  judgements: [
    // ── the harness's handshakes ──────────────────────────────────────────────
    {
      cls: "read-before-write",
      issuedBy: "another-surface",
      protects:
        "a write composed without seeing the file's current bytes overwrites work the caller never read; this refusal is the only thing making an edit informed",
      absorption: {
        mode: "accommodate",
        behaviour: "read the file first and then apply the write, so the call succeeds without the caller asking twice",
      },
      // This repository enforces the same rule on itself rather than absorbing it.
      precedent: "git/read-write-hash-guard.ts:writeWithHash",
    },
    {
      cls: "stale-read",
      issuedBy: "another-surface",
      protects:
        "a write computed against bytes that have since changed silently discards whatever the other writer put there",
      absorption: {
        mode: "accommodate",
        behaviour: "re-read and re-apply the edit against the new bytes when the anchor is still unique in them",
      },
      precedent: "git/read-write-hash-guard.ts:writeWithHash",
    },
    {
      cls: "wrong-worktree",
      issuedBy: "another-surface",
      protects:
        "a command that addresses outside the worktree it was pinned to writes into a tree another agent owns",
      absorption: null,
    },

    // ── grants: what the user has said yes to ─────────────────────────────────
    {
      cls: "tool-not-granted",
      issuedBy: "another-surface",
      protects:
        "the user's consent to run the tool at all; a surface that granted itself the tool would make the permission prompt decorative",
      absorption: null,
    },
    {
      cls: "path-not-granted",
      issuedBy: "another-surface",
      protects: "the user's consent to read or write that path; the same prompt, over a different noun",
      absorption: null,
    },
    {
      cls: "sensitive-file",
      issuedBy: "another-surface",
      protects: "paths whose contents must not enter a context window whatever grant the run holds",
      absorption: null,
    },

    // ── the argument itself ───────────────────────────────────────────────────
    {
      cls: "closed-parameter-set",
      issuedBy: "another-surface",
      protects:
        "an unlisted parameter is usually a misspelled one, and accepting it silently makes the call do something other than what was asked",
      absorption: {
        mode: "accommodate",
        behaviour: "drop the unlisted parameter, or resolve it to the nearest declared name, and run the call",
      },
    },
    {
      cls: "output-schema-violation",
      issuedBy: "another-surface",
      protects:
        "the schema is the contract the consumer parses against; accepting a violation moves the failure downstream to code that cannot report it",
      absorption: {
        mode: "accommodate",
        behaviour: "accept the body unvalidated and let the consumer cope with whatever arrived",
      },
    },
    {
      cls: "malformed-body",
      issuedBy: "another-surface",
      protects:
        "a body that does not parse was not received; a repair that happens to succeed executes a call nobody composed",
      absorption: {
        mode: "accommodate",
        behaviour: "repair the common JSON damage — a trailing comma, an unescaped newline — and parse again",
      },
    },
    {
      cls: "argument-content-rejected",
      issuedBy: "another-surface",
      protects: "control bytes inside an argument change what the command is by the time a shell has read it",
      absorption: null,
    },
    {
      cls: "blocked-command-form",
      issuedBy: "another-surface",
      // Every one of the 30 in the corpus is `sleep N` followed by a check, and
      // the refusal text names the form that would have worked. Nothing is
      // defended: the blocked form costs wall-clock and nothing else.
      protects: null,
      absorption: {
        mode: "accommodate",
        behaviour:
          "run the permitted form the refusal already names — a `sleep N; <check>` becomes the until-loop the message asks the caller to write",
      },
    },
    {
      cls: "script-parse-error",
      issuedBy: "another-surface",
      // The guess in the refusal text is TypeScript, and stripping annotations
      // would be a real accommodation. Both rejections this repository has on
      // record were something else — a backtick inside a template literal, which
      // ends the string a hundred and seventy lines early (CLAUDE.md). There is
      // no honest reconstruction of a program that means two different things.
      protects: null,
      absorption: null,
    },
    {
      cls: "malformed-argument",
      issuedBy: "another-surface",
      protects: null,
      absorption: null,
    },
    {
      cls: "no-op-edit",
      issuedBy: "another-surface",
      protects:
        "an edit whose two strings are identical means the caller's model of the file is wrong; performing it would report success for a change that did not happen",
      absorption: {
        mode: "accommodate",
        behaviour: "accept it and change nothing, reporting success",
      },
    },

    // ── the world the call lands in ───────────────────────────────────────────
    {
      cls: "response-size-cap",
      issuedBy: "another-surface",
      // The cap is real and the accommodation keeps it: a bounded prefix protects
      // the context window exactly as a refusal does, and answers the question.
      // This repository already does it for its own reads rather than refusing.
      protects: null,
      absorption: {
        mode: "accommodate",
        behaviour: "return a bounded prefix, name what was withheld and how to ask for the rest, in the same call",
      },
      precedent: "product/repo.ts:MAX_FILE_CHARS",
    },
    {
      cls: "evidence-rung-ceiling",
      issuedBy: "this-repository",
      protects:
        "the ladder's meaning: a declaration is a claim a caller makes, and a surface that quietly rewrote it to what the sources support would record a claim nobody made and remove the moment that sends the caller after better evidence",
      absorption: {
        mode: "accommodate",
        behaviour: "clamp the declared rung down to the one the cited sources have earned and write the node anyway",
      },
    },
    {
      cls: "missing-config",
      issuedBy: "this-repository",
      protects: null,
      absorption: null,
    },
    {
      cls: "missing-path",
      issuedBy: "another-surface",
      protects: null,
      absorption: null,
      // The nearest-thing answer improves the refusal; it does not remove it.
      precedent: "fs/near-miss.ts:nearMiss",
    },
    {
      cls: "stale-anchor",
      issuedBy: "another-surface",
      protects:
        "an anchor that is gone means the file is not what the caller thinks it is; applying the edit anywhere else puts a change where nobody asked for one",
      absorption: null,
    },
    {
      cls: "ambiguous-anchor",
      issuedBy: "another-surface",
      protects:
        "which of the several matches was meant is not recoverable from the call, and picking one edits a place the caller did not name",
      absorption: null,
    },
    {
      cls: "cwd-deleted",
      issuedBy: "another-surface",
      protects:
        "a command that runs somewhere other than the directory it was composed for writes in the wrong place",
      absorption: {
        mode: "accommodate",
        behaviour: "recover to the nearest surviving ancestor and run the command there",
      },
    },
    {
      cls: "destructive-confirmation",
      issuedBy: "another-surface",
      protects: "an irreversible action needs a person's assent, and the first call is where that is asked for",
      absorption: null,
    },

    // ── the schema that was there and said the wrong thing ────────────────────
    {
      cls: "conditionally-required-parameter",
      issuedBy: "another-surface",
      // The schema marks the parameter optional and the server requires it unless
      // remote state supplies it. Nothing is defended by refusing rather than by
      // declaring it required in the first place.
      protects: null,
      absorption: {
        mode: "make-uncomposable",
        behaviour: "declare the parameter required in the schema, so the call that gets refused cannot be composed",
      },
    },

    // ── the surface this process was started with ─────────────────────────────
    {
      cls: "tool-not-available",
      issuedBy: "another-surface",
      protects: null,
      absorption: null,
    },
    {
      cls: "schema-not-discovered",
      issuedBy: "another-surface",
      protects: null,
      absorption: {
        mode: "accommodate",
        behaviour: "fetch the schema the call needs and then make the call, instead of refusing it once",
      },
    },
    {
      cls: "unknown-skill",
      issuedBy: "another-surface",
      protects: null,
      absorption: null,
    },

    // ── this repository's own surface, as its usage trace records it ──────────
    {
      cls: "no-such-node",
      issuedBy: "this-repository",
      // The heaviest class in the vault's own trace, and the one whose
      // accommodation this repository has already built and deliberately declined
      // to act on: `near-miss.ts` answers a miss with the nearest thing that does
      // exist and refuses to follow its own suggestion, because a run that wrote
      // `report2.txt`, died, and then read the `report.txt` beside it is one
      // character of edit distance and completely wrong.
      protects:
        "a write applied to a node the caller did not name is a silent corruption of the tree, and the nearest title is routinely the wrong one",
      absorption: {
        mode: "accommodate",
        behaviour: "resolve the title to the one node that is a near-miss for it, and write there",
      },
      precedent: "fs/near-miss.ts:nearMiss",
    },
    {
      cls: "repo-path-missing",
      issuedBy: "this-repository",
      protects: null,
      absorption: null,
      precedent: "fs/near-miss.ts:nearMiss",
    },
    {
      cls: "instrument-not-a-spec-file",
      issuedBy: "this-repository",
      protects:
        "an instrument that carries a `-t` filter or a pipe reports green for a subset nobody declared, so the verdict stops meaning what the test says it means",
      absorption: {
        mode: "accommodate",
        behaviour: "strip the shell punctuation and keep the spec file the command names",
      },
    },
    {
      cls: "unearned-measurement-rung",
      issuedBy: "this-repository",
      protects:
        "'observed' and 'money' assert that something was measured; a surface that granted them on request would let the tree claim measurements nobody took",
      absorption: null,
    },
    {
      cls: "no-product-repo",
      issuedBy: "this-repository",
      protects: null,
      absorption: null,
    },
    {
      cls: "above-source-standing",
      issuedBy: "this-repository",
      protects:
        "a rung above what the cited actor has earned is the whole trust ledger defeated by one caller's assertion",
      absorption: null,
    },
    {
      cls: "threshold-not-a-bar",
      issuedBy: "this-repository",
      protects:
        "a threshold with no comparator next to a number is a test that cannot come out a failure, which is the defect the tree already carries a whole bucket about",
      absorption: null,
    },
    {
      cls: "no-evidence-class",
      issuedBy: "this-repository",
      protects:
        "the rung is a claim someone makes; defaulting an unrecognised one to the floor would record a claim nobody chose and skip the moment the caller has to think about evidence",
      absorption: {
        mode: "accommodate",
        behaviour: "record the floor rung `assertion` when the declared class is not one of the five, since the floor can only understate",
      },
    },
    {
      cls: "instrument-spec-missing",
      issuedBy: "this-repository",
      // Already absorbed, and the waiver is the interesting half: a spec file that
      // does not exist yet is exactly what a red instrument on a buildable test
      // names, so the surface accepts it when the test carries a bound threshold
      // and refuses it otherwise.
      protects:
        "a red that comes from a missing file fails identically whatever question was written on it, so it grants no build permit",
      absorption: {
        mode: "accommodate",
        behaviour: "accept a spec path that does not exist yet when the test carries a bound threshold to build to",
      },
      precedent: "security/tools.ts:specResolves",
    },
    {
      cls: "humans-required-lane",
      issuedBy: "this-repository",
      protects:
        "a test in the humans-required lane says a person is the measurement, and a command attached to it is compute standing in for the verdict the lane exists to reserve",
      absorption: null,
    },
    {
      cls: "reserved-heading",
      issuedBy: "this-repository",
      protects:
        "the reserved sections are read by the gates as proof something happened outside the tree, so a caller that could write one could manufacture that proof",
      absorption: {
        mode: "accommodate",
        behaviour: "escape the heading in the caller's prose and write the rest of the content",
      },
    },
  ] as readonly AbsorptionJudgement[],
} as const;

/** The verdict, derived from the two prose fields. Never stored. */
export function verdictOf(j: AbsorptionJudgement): AbsorptionVerdict {
  if (j.protects !== null) return "load-bearing";
  return j.absorption !== null ? "safe-to-absorb" : "nothing-to-absorb";
}

export function judgementOf(cls: string): AbsorptionJudgement | undefined {
  return ABSORPTION_RULE.judgements.find((j) => j.cls === cls);
}

/** One class in the ranked tally, with its judgement attached. */
export interface RankedClass {
  cls: string;
  occurrences: number;
  /** Null when the corpus holds a class no judgement covers — the census's blind spot. */
  judgement: AbsorptionJudgement | null;
  verdict: AbsorptionVerdict | null;
  /** Rank in the tally, 1-based, so a reader can see what the top-N cut hid. */
  rank: number;
}

export type ReadingName = "strict" | "could-have-honoured";

export interface AbsorptionReading {
  name: ReadingName;
  /** What "safe" admits under this reading, in the reader's terms. */
  admits: string;
  /** Classes inside the top N this reading calls safe. */
  safe: string[];
  /** Refusals those classes account for. */
  covered: number;
  /** `covered` over every refusal in the corpus, which is what the bar names. */
  coverage: number;
  /** Did the count half clear — at least `bar.classes` of the top N? */
  meetsCountBar: boolean;
  /** Did the coverage half clear? */
  meetsCoverageBar: boolean;
  /** Both halves. */
  meetsBar: boolean;
}

export interface AbsorptionCensus {
  corpus: string;
  /** Every refusal counted, across every class. The denominator the bar names. */
  refusals: number;
  /**
   * Refusals the corpus held that no class could be read off, reported beside the
   * denominator rather than folded into it. A census that quietly narrowed its own
   * corpus would look identical to one that read all of it.
   */
  unclassified: number;
  /** The ranked tally, heaviest first. */
  ranked: RankedClass[];
  /** The first `topN` of it — the population the assumption test judges. */
  top: RankedClass[];
  /** Classes in the corpus that no judgement covers. Reported before any share. */
  unjudged: string[];
  /**
   * Refusals by the surface that issued them, over the top N and out of
   * {@link AbsorptionCensus.topOccurrences}. A class this repository does not
   * issue cannot be absorbed by anything it ships.
   */
  byIssuer: Record<Issuer, { classes: number; occurrences: number }>;
  /** Refusals accounted for by the top N — the denominator `byIssuer` is read against. */
  topOccurrences: number;
  readings: AbsorptionReading[];
  /** The reading the bar is taken on — see {@link ABSORPTION_RULE.verdictCorpus}. */
  verdict: AbsorptionReading;
  meetsBar: boolean;
  /** True when the two readings disagree, i.e. the judgement decided the answer. */
  judgementDecides: boolean;
  /** Classes that protect nothing and have no accommodation either. */
  nothingToAbsorb: string[];
  /** Whether a person has read the load-bearing column. */
  ratifiedBy: string | null;
}

const READINGS: { name: ReadingName; admits: string; safe: (j: AbsorptionJudgement) => boolean }[] = [
  {
    name: "strict",
    admits: "the refusal protects nothing real and an accommodation exists",
    safe: (j) => verdictOf(j) === "safe-to-absorb",
  },
  {
    name: "could-have-honoured",
    admits: "an accommodation exists, whatever the refusal defends",
    safe: (j) => j.absorption !== null,
  },
];

/** What a census run may be re-pointed at. Everything defaults to the real thing. */
export interface CensusOptions {
  topN?: number;
  /** Refusals in the corpus that no classifier could read. Reported, never counted. */
  unclassified?: number;
  /**
   * The judgements to read verdicts out of.
   *
   * The default is the committed column and the real runs use it. It is a
   * parameter so the test beside this file can drive the same code path with a
   * fabricated column and show that the census reports MET as readily as it
   * reports NOT MET — a census that could only come out one way would satisfy
   * every assertion about a corpus that came out that way.
   */
  judgements?: readonly AbsorptionJudgement[];
}

/**
 * Take the census over a ranked tally.
 *
 * The tally is passed in rather than read from disk, for the reason every census
 * in this repository does it: a reading that goes and finds its own input is one
 * nobody can re-point at a different corpus to check what it would have said.
 */
export function refusalAbsorptionCensus(
  counts: readonly { cls: string; occurrences: number }[],
  corpus: string,
  opts: CensusOptions = {},
): AbsorptionCensus {
  const topN = opts.topN ?? ABSORPTION_RULE.topN;
  const column = opts.judgements ?? ABSORPTION_RULE.judgements;
  const ranked: RankedClass[] = [...counts]
    .sort((a, b) => b.occurrences - a.occurrences || a.cls.localeCompare(b.cls))
    .map((c, i) => {
      const judgement = column.find((j) => j.cls === c.cls) ?? null;
      return {
        cls: c.cls,
        occurrences: c.occurrences,
        judgement,
        verdict: judgement ? verdictOf(judgement) : null,
        rank: i + 1,
      };
    });

  const refusals = ranked.reduce((n, c) => n + c.occurrences, 0);
  const top = ranked.slice(0, topN);

  const byIssuer: Record<Issuer, { classes: number; occurrences: number }> = {
    "this-repository": { classes: 0, occurrences: 0 },
    "another-surface": { classes: 0, occurrences: 0 },
  };
  for (const c of top) {
    if (!c.judgement) continue;
    const slot = byIssuer[c.judgement.issuedBy];
    slot.classes++;
    slot.occurrences += c.occurrences;
  }

  const readings: AbsorptionReading[] = READINGS.map((r) => {
    const safe = top.filter((c) => c.judgement && r.safe(c.judgement));
    const covered = safe.reduce((n, c) => n + c.occurrences, 0);
    const coverage = refusals === 0 ? 0 : covered / refusals;
    const meetsCountBar = safe.length >= ABSORPTION_RULE.bar.classes;
    const meetsCoverageBar = coverage >= ABSORPTION_RULE.bar.coverage;
    return {
      name: r.name,
      admits: r.admits,
      safe: safe.map((c) => c.cls),
      covered,
      coverage,
      meetsCountBar,
      meetsCoverageBar,
      meetsBar: meetsCountBar && meetsCoverageBar,
    };
  });

  const verdict = readings.find((r) => r.name === "strict")!;
  return {
    corpus,
    refusals,
    unclassified: opts.unclassified ?? 0,
    ranked,
    top,
    unjudged: ranked.filter((c) => !c.judgement).map((c) => c.cls),
    byIssuer,
    topOccurrences: top.reduce((n, c) => n + c.occurrences, 0),
    readings,
    verdict,
    meetsBar: verdict.meetsBar,
    judgementDecides: new Set(readings.map((r) => r.meetsBar)).size > 1,
    nothingToAbsorb: top.filter((c) => c.verdict === "nothing-to-absorb").map((c) => c.cls),
    ratifiedBy: ABSORPTION_RULE.ratifiedBy,
  };
}

// ── the two records this repository holds ────────────────────────────────────

/**
 * Rank the transcript record: refusals this project's passes hit, whoever issued
 * them, classified by {@link REFUSAL_RULE}.
 */
export function rankTranscriptRefusals(failures: readonly FailingCall[]): { cls: string; occurrences: number }[] {
  const counts = new Map<string, number>();
  for (const f of failures) {
    if (REFUSAL_RULE.consideredAndExcluded.some((e) => e.match.test(f.error))) continue;
    const cls = REFUSAL_RULE.classes.find((c) => c.match.test(f.error))?.id;
    if (!cls) continue;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()].map(([cls, occurrences]) => ({ cls, occurrences }));
}

/**
 * Rank the usage record: refusals this repository's own tools issued, classified
 * by {@link REFUSAL_CLASSES}.
 *
 * A refusal the tracer truncated past its reason is dropped from the tally and
 * would show up as a gap between this sum and the corpus size — the caller is the
 * one that can report it, so nothing is invented here.
 */
export function rankUsageRefusals(rows: readonly RecordedRefusal[]): { cls: string; occurrences: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const cls = classifyUsageRefusal(row).class?.id;
    if (!cls) continue;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  return [...counts.entries()].map(([cls, occurrences]) => ({ cls, occurrences }));
}

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

/**
 * The census as an operator reads it: ratification first, then who could absorb
 * anything at all, then the verdict, then the column a person has to check.
 */
export function formatRefusalAbsorptionCensus(c: AbsorptionCensus): string {
  const out: string[] = [];
  out.push(
    `Refusal absorption — ${c.corpus}: ${c.refusals} refusal(s) across ${c.ranked.length} class(es), ` +
      `judging the top ${c.top.length}` +
      (c.unclassified > 0 ? `, and ${c.unclassified} the corpus held that no classifier could read` : ""),
  );
  if (!c.ratifiedBy) {
    out.push(
      "  NOT RATIFIED: no person has read the load-bearing column. These verdicts are a proposal, and " +
        "nothing may be removed on the strength of them.",
    );
  }
  const mine = c.byIssuer["this-repository"];
  const theirs = c.byIssuer["another-surface"];
  const share = (n: number): string => pct(c.topOccurrences === 0 ? 0 : n / c.topOccurrences);
  out.push(
    `  of the ${c.topOccurrences} refusal(s) the top ${c.top.length} account for, this repository issued ` +
      `${mine.occurrences} (${share(mine.occurrences)}) across ${mine.classes} class(es). A surface it cannot ` +
      `change issued ${theirs.occurrences} (${share(theirs.occurrences)}) across ${theirs.classes}` +
      (theirs.occurrences > 0 ? ". Nothing this repository ships can absorb the second number." : "."),
  );
  if (c.unjudged.length > 0) out.push(`  UNJUDGED: ${c.unjudged.join(", ")} — in the corpus and in no column.`);
  out.push("");

  for (const r of c.readings) {
    out.push(
      `  ${r.name.padEnd(20)} ${r.safe.length}/${c.top.length} class(es) ` +
        `${r.meetsCountBar ? "clears" : "below"} the ${ABSORPTION_RULE.bar.classes}-class half, ` +
        `${r.covered}/${c.refusals} refusal(s) = ${pct(r.coverage)} ` +
        `${r.meetsCoverageBar ? "clears" : "below"} the ${pct(ABSORPTION_RULE.bar.coverage)} half ` +
        `— ${r.meetsBar ? "MET" : "NOT MET"}`,
    );
    out.push(`      admits: ${r.admits}`);
    out.push(`      safe: ${r.safe.join(", ") || "(none)"}`);
  }
  out.push(
    `  verdict is taken on '${c.verdict.name}': ${c.meetsBar ? "MET" : "NOT MET"}` +
      (c.judgementDecides ? " — AND THE JUDGEMENT DECIDES IT: the two readings disagree." : ""),
  );
  out.push("");

  out.push("The column a person has to check, heaviest first:");
  for (const row of c.top) {
    const j = row.judgement;
    out.push(`  ${String(row.occurrences).padStart(4)} ${(row.verdict ?? "UNJUDGED").padEnd(17)} ${row.cls}`);
    if (!j) continue;
    out.push(`       issued by ${j.issuedBy}`);
    if (j.protects) out.push(`       protects: ${j.protects}`);
    if (j.absorption) out.push(`       ${j.absorption.mode}: ${j.absorption.behaviour}`);
    if (!j.protects && !j.absorption) out.push("       protects nothing, and there is nothing to honour the call with");
    if (j.precedent) out.push(`       precedent: ${j.precedent}`);
  }
  if (c.ranked.length > c.top.length) {
    out.push("");
    out.push("Below the cut, so the bar does not see them:");
    for (const row of c.ranked.slice(c.top.length)) {
      out.push(`  ${String(row.occurrences).padStart(4)} ${(row.verdict ?? "UNJUDGED").padEnd(17)} ${row.cls}`);
    }
  }
  return out.join("\n");
}
