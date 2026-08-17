/**
 * The elimination tournament — candidates run against each other in rounds,
 * and every round shrinks the consideration set instead of crowning anything.
 *
 * The node this serves is explicit about the alternative it rejects: a tree
 * that only accumulates turns cheap, disposable candidates into permanent
 * obligations. Vibes-based removal — "I don't like this one anymore" — is the
 * failure mode named in its own provenance caveat, so this pass is not allowed
 * to invent a verdict. It reads exactly one signal the tree already treats as
 * unforgeable: a `## Results` entry a human recorded on an AssumptionTest,
 * through {@link RESULTS_HEADING} — the same reserved heading `evidence-debt.ts`
 * and `critic.ts` already trust, because the agent that would run this
 * tournament cannot write one itself.
 *
 * A candidate is eliminated when a test beneath it (through its Assumptions,
 * the same walk `testsUnderSolution` already defines) has recorded a
 * `refuted` verdict. The elimination cites the verbatim result line, so
 * "grounded" is checkable by a reader without trusting this module's summary
 * of it. Two properties make this a tournament rather than a ranking with
 * extra ceremony, and `test/eval/tournament-elimination.test.ts` pins both:
 *
 * 1. **Every elimination cites a specific recorded result.** Never a
 *    preference, never a score — the cited line is copied out of the node's
 *    own `## Results` section.
 * 2. **No round crowns anything.** The report type has no "winner" field
 *    anywhere in it; a round only ever removes candidates from
 *    {@link TournamentRound.remaining}, and the last candidate standing is
 *    still a survivor, not a winner — declaring one stays a human's call.
 *
 * What a run of this does NOT settle, same caveat the node states about
 * itself: whether the bracket was fair. A candidate never offered to this
 * pass cannot be eliminated by it, and a candidate with no test beneath it
 * yet survives by silence rather than by strength.
 */
import type { OstNode } from "../ost/node.js";
import { entriesUnder, RESULTS_HEADING, type Verdict } from "../ost/headings.js";
import { recordedVerdict } from "../knowledge/actor-trust.js";
import { byTitle, testsUnderSolution } from "../processes/tree.js";

export interface Elimination {
  readonly candidate: string;
  /** The AssumptionTest whose recorded result grounds this elimination. */
  readonly against: string;
  /** The verbatim `## Results` line cited — the specific recorded result. */
  readonly evidence: string;
  readonly verdict: Verdict;
}

export interface TournamentRound {
  readonly round: number;
  /** Titles entering this round. */
  readonly entering: readonly string[];
  /** Eliminated this round — grounded, never a preference. */
  readonly eliminated: readonly Elimination[];
  /** Titles left after this round. Only ever shrinks; never names a winner. */
  readonly remaining: readonly string[];
}

export interface TournamentReport {
  /** Sweep discipline: a tournament over nothing must be visible as such. */
  readonly subject: { readonly offered: number; readonly read: number };
  readonly rounds: readonly TournamentRound[];
  /** What is left standing. Deliberately not a "winner" — see module doc. */
  readonly survivors: readonly string[];
  readonly eliminated: readonly Elimination[];
}

/**
 * The one recorded-result line that grounds a refutation, or null if the
 * test's latest verdict is not `refuted`. Reads the same heading
 * `recordedVerdict` reads to decide THAT a test was refuted, then pulls the
 * matching line back out so the elimination can cite it verbatim rather than
 * restate it.
 */
function refutingLine(test: OstNode): string | null {
  if (recordedVerdict(test) !== "refuted") return null;
  const entries = entriesUnder(test.body, RESULTS_HEADING);
  const refuting = [...entries].reverse().find((e) => /\brefuted\b/i.test(e));
  return refuting ?? entries[entries.length - 1] ?? null;
}

/**
 * Run the tournament over one bracket of Solution candidates against the
 * tree that carries their tests' recorded results.
 *
 * One round per grounded elimination found, in candidate order — deterministic
 * so the same tree produces the same rounds on a re-run. A candidate with no
 * refuted test beneath it is never touched: silence is not evidence, so it
 * survives by default rather than by a judgement this pass is not licensed to
 * make.
 */
export function runTournament(candidates: readonly OstNode[], tree: readonly OstNode[]): TournamentReport {
  const index = byTitle([...tree]);

  const eliminations: Elimination[] = [];
  for (const candidate of candidates) {
    for (const test of testsUnderSolution(candidate, index)) {
      const line = refutingLine(test);
      if (!line) continue;
      eliminations.push({ candidate: candidate.title, against: test.title, evidence: line, verdict: "refuted" });
      break; // one grounded refutation is enough to eliminate a candidate
    }
  }

  let remaining = candidates.map((c) => c.title);
  const rounds: TournamentRound[] = eliminations.map((elimination, i) => {
    const entering = remaining;
    remaining = remaining.filter((title) => title !== elimination.candidate);
    return { round: i + 1, entering, eliminated: [elimination], remaining };
  });

  return {
    subject: { offered: candidates.length, read: candidates.length },
    rounds,
    survivors: remaining,
    eliminated: eliminations,
  };
}

/** The report as an operator reads it — every elimination in full, no silent caps. */
export function renderTournament(report: TournamentReport): string {
  const { offered, read } = report.subject;
  if (read === 0) {
    return `tournament: BLIND — read 0 of ${offered} candidate(s), so nothing was run.`;
  }
  const lines: string[] = [];
  lines.push(
    `tournament: ${report.eliminated.length} elimination(s) over ${report.rounds.length} round(s); ` +
      `${report.survivors.length} of ${read} candidate(s) still standing.`,
  );
  for (const round of report.rounds) {
    const e = round.eliminated[0];
    lines.push(`\n- round ${round.round}: eliminated "${e.candidate}" — refuted by "${e.against}"`);
    lines.push(`    evidence: ${e.evidence}`);
  }
  lines.push(`\nstill standing: ${report.survivors.length ? report.survivors.map((s) => `"${s}"`).join(", ") : "(none)"}`);
  lines.push("declaring a winner among them stays a human's call — this pass only shrinks the set.");
  return lines.join("\n");
}
