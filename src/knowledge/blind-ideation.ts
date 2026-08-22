/**
 * Blind parallel ideation — candidates generated from separate contexts that
 * never see each other, merged only afterwards.
 *
 * Asked for three solutions in one breath, a model returns three phrasings of
 * one idea: candidate two is written while candidate one is still on the page,
 * so it anchors on it, and candidate three anchors on both. Elimination is
 * bounded above by generation, so a disciplined kill process over that set
 * converges precisely and wrongly. `forced-variation.ts` attacks the same
 * narrowness at the prompt level by naming a dimension each candidate must
 * differ on; this module attacks it structurally, at what the founder's note
 * calls its cause — the shared context itself.
 *
 * The shape is one **round**. A round fixes a shared context once (the target
 * opportunity and the solutions already under it, as of the round's start) and
 * assembles every ideator's prompt from that and nothing else. In a `blind`
 * round each ideator asks for one candidate and there are N of them; in the
 * `anchored` round there is one ideator asking for all N, which is the "one
 * agent asked for three" arm the assumption test needs a person to rate the
 * blind set against.
 *
 * **What "blind" is allowed to mean here.** Exactly one thing, checkable by
 * reading: no ideator's prompt contains a sibling ideator's candidate text, and
 * no ideator is told which dimension a sibling took. Two checks carry it, and
 * they are deliberately different in kind:
 *
 * - {@link checkRoundIsolation} runs before any model does, and needs no
 *   candidates. It rebuilds every prompt from the round's recorded shared
 *   context and refuses one that does not come out identical. A prompt with a
 *   sibling's candidate spliced into it cannot survive that, and neither can a
 *   round assembled by accumulating as it goes — the failure mode this module
 *   exists to make impossible, because it is the natural way to write the loop.
 * - {@link checkBlindness} runs after, over what the ideators returned, and
 *   asserts the property in its own words rather than by proxy.
 *
 * Three honest limits, stated here because the nodes that asked for this state
 * them too:
 *
 * - It costs N times the generation budget. That is the whole price of removing
 *   the anchoring, and nothing here makes it cheaper.
 * - Independent draws collide by coincidence. {@link mergeIdeationRound}
 *   reports near-duplicates rather than hiding them: a blind round that returns
 *   the same idea twice is a real result about the opportunity, not a bug in
 *   the round.
 * - **It settles nothing about distinctness.** Green here means the blindness
 *   the solution is named for actually held. Whether a blind set is *more*
 *   distinct than an anchored one is a person blind-rating shuffled sets on
 *   three opportunities, and it stays with that person — which is what
 *   `arm: "anchored"` is for and the only thing it is for.
 */

import { similarity } from "../ost/dedupe.js";
import {
  buildIdeationPrompt,
  variationAssignments,
  VARIATION_DIMENSIONS,
  type IdeationPrompt,
  type VariationAssignment,
  type VariationDimensionId,
} from "./forced-variation.js";

/**
 * `blind` fans one opportunity out to N ideators that never meet; `anchored`
 * asks one ideator for N candidates in a single context. The second exists as
 * the control arm of the assumption test and for nothing else.
 *
 * Named `arm` rather than `method` on purpose. `test/release/outward-mutation.test.ts`
 * proves P6 — the tree senses the world and does not act on it — by scanning
 * every file under `src/` for a `method` key with a string-literal value and
 * failing any whose value is not GET. It is a text scan with no notion of
 * whether a fetch is nearby, so a domain field with that name anywhere in the
 * source reads as an eighth HTTP call site issuing a verb nobody allowed. `arm`
 * is also the word the assumption test uses, so nothing was given up for it.
 */
export type IdeationArm = "blind" | "anchored";

/**
 * Everything every ideator in a round is allowed to see. Frozen at the round's
 * start: a candidate produced during the round is not in here, which is the
 * whole of the guarantee.
 */
export interface SharedContext {
  /** The target opportunity's title, as the tree spells it. */
  opportunity: string;
  /** Solutions already under it when the round began. Shared, so quoting one is not a leak. */
  existingSolutions: readonly string[];
}

export interface RoundIdeator {
  /** 1-based. In a blind round these run in parallel and never meet. */
  ideator: number;
  /** How many candidates this one prompt asks for — 1 in a blind round, all of them in the anchored arm. */
  candidates: number;
  /** The dimension offset this prompt was assembled at. Recorded so the prompt is reproducible from {@link SharedContext} alone. */
  offset: number;
  prompt: IdeationPrompt;
}

export interface IdeationRound {
  arm: IdeationArm;
  /** Total candidates the round asks for, across every ideator. */
  candidates: number;
  forcedVariation: boolean;
  shared: SharedContext;
  ideators: RoundIdeator[];
}

export interface IdeationRoundRequest {
  opportunity: string;
  /** Solutions already under the opportunity. Shared context — every ideator sees the same list. */
  existingSolutions?: readonly string[];
  /** How many candidates the round wants in total. Must be ≥ 1. */
  candidates: number;
  /** Defaults to `blind`. `anchored` is the control arm; see {@link IdeationArm}. */
  arm?: IdeationArm;
  /** Composed with the named-dimension constraint by default; see `forced-variation.ts`. */
  forcedVariation?: boolean;
  /** Where in {@link VARIATION_DIMENSIONS} the first candidate starts. Defaults to the number of existing siblings. */
  offset?: number;
}

/** What one ideator came back with. The `ideator` number ties it to its prompt. */
export interface IdeatorReturn {
  ideator: number;
  candidates: readonly string[];
}

export interface MergedCandidate {
  /** 1-based position in the merged set, in ideator order. */
  candidate: number;
  /** Which ideator produced it. Kept so a collision names two independent draws rather than one confused one. */
  ideator: number;
  text: string;
  /** The dimension its prompt asked it to differ on, or `null` in an unconstrained round. */
  dimension: VariationDimensionId | null;
}

/**
 * Two candidates in one merged set that say the same thing. `coincidence` is
 * two ideators landing on one idea independently — expected, and reported so a
 * reader knows the set is narrower than its count suggests. `restates-shared-context`
 * is a candidate that reproduces a solution already in the tree, which is a
 * result about the ideator rather than about the round.
 */
export interface CandidateCollision {
  kind: "coincidence" | "restates-shared-context";
  /** The later candidate, in merged order. */
  candidate: number;
  /** The earlier merged candidate it duplicates, or `null` when it duplicates shared context. */
  duplicateOf: number | null;
  /** Token-set similarity in [0, 1], by the same measure the hygiene scan uses. */
  score: number;
  detail: string;
}

export interface MergedRound {
  opportunity: string;
  arm: IdeationArm;
  /** Every candidate the round produced, in ideator order, with its provenance. */
  candidates: MergedCandidate[];
  /** Near-duplicates within the merged set. Reported, never dropped — a human decides. */
  collisions: CandidateCollision[];
}

export type IsolationViolationKind =
  /** A prompt is not what the shared context yields — something entered it from outside. */
  | "context-drift"
  /** A prompt carries a sibling ideator's candidate text verbatim. */
  | "sibling-candidate-in-prompt"
  /** A prompt names a dimension assigned to a sibling, so the ideators were told about each other. */
  | "sibling-dimension-in-prompt"
  /** A return names an ideator the round does not have. */
  | "unknown-ideator"
  /** An ideator returned nothing, so its prompt cannot be cleared or condemned. */
  | "missing-return"
  /** A candidate too short to tell a leak from a coincidence. Unverifiable is not verified. */
  | "uncheckable-candidate";

export interface IsolationViolation {
  /** The ideator the violation is about — the one whose prompt is compromised, or whose return is bad. */
  ideator: number;
  kind: IsolationViolationKind;
  detail: string;
}

export class BlindIdeationError extends Error {
  constructor(
    message: string,
    readonly violations: readonly IsolationViolation[] = [],
  ) {
    super(message);
    this.name = "BlindIdeationError";
  }
}

/**
 * The fewest significant words a candidate needs before a substring test can
 * tell a leak from a coincidence.
 *
 * "Logging" appearing in two prompts says nothing; a seven-word candidate
 * appearing verbatim in a sibling's prompt says exactly one thing. Below the
 * floor the round is not cleared — it is reported `uncheckable-candidate`,
 * because a check that cannot see is not a check that passed.
 */
export const MIN_CHECKABLE_WORDS = 3;

/**
 * How alike two independently drawn candidates have to be before the merge
 * calls them one idea. The hygiene scan's threshold, deliberately: a pair a
 * reader would file as a duplicate in the tree is a pair that was a duplicate
 * in the round.
 */
export const COLLISION_THRESHOLD = 0.7;

/**
 * Assemble one ideation round.
 *
 * Every prompt is built from `shared` and the ideator's own offset — there is
 * no parameter through which one ideator's output could enter another's prompt,
 * which is the point. A blind round is N single-candidate prompts; an anchored
 * round is one N-candidate prompt.
 */
export function buildIdeationRound(req: IdeationRoundRequest): IdeationRound {
  const arm = req.arm ?? "blind";
  const forced = req.forcedVariation !== false;
  const existingSolutions = [...(req.existingSolutions ?? [])];
  if (!Number.isInteger(req.candidates) || req.candidates < 1) {
    throw new BlindIdeationError(`an ideation round asks for at least one candidate; got ${req.candidates}`);
  }
  const n = VARIATION_DIMENSIONS.length;
  if (forced && req.candidates > n) {
    throw new BlindIdeationError(
      `cannot give ${req.candidates} candidates distinct variation dimensions: only ${n} are named. ` +
        `Ask for at most ${n} per round, or name a new dimension in VARIATION_DIMENSIONS.`,
    );
  }
  const base = ((req.offset ?? existingSolutions.length) % n + n) % n;
  const shared: SharedContext = { opportunity: req.opportunity, existingSolutions };

  const ideators: RoundIdeator[] =
    arm === "blind"
      ? Array.from({ length: req.candidates }, (_, i) => assemble(shared, i + 1, 1, base + i, forced))
      : [assemble(shared, 1, req.candidates, base, forced)];

  return { arm, candidates: req.candidates, forcedVariation: forced, shared, ideators };
}

/** One ideator's prompt, from the shared context and nothing else. Also the rebuild {@link checkRoundIsolation} compares against. */
function assemble(
  shared: SharedContext,
  ideator: number,
  candidates: number,
  offset: number,
  forcedVariation: boolean,
): RoundIdeator {
  return {
    ideator,
    candidates,
    offset,
    prompt: buildIdeationPrompt({
      opportunity: shared.opportunity,
      existingSolutions: shared.existingSolutions,
      candidates,
      forcedVariation,
      offset,
    }),
  };
}

/**
 * Whether the round is assembled the way it claims — checkable before a single
 * model runs, because it needs no candidates.
 *
 * Each prompt is rebuilt from the round's own shared context and compared
 * verbatim. That refuses two things at once: a prompt with foreign text spliced
 * into it, and a round built by accumulating candidates as it goes, since an
 * accumulating loop's later prompts are not a function of the shared context.
 * It also refuses a blind prompt that names a sibling's dimension — the prompts
 * would still rebuild, but the ideators would have been told about each other.
 *
 * Empty for an anchored round beyond the rebuild: that arm promises no
 * isolation, so there is nothing there to break.
 */
export function checkRoundIsolation(round: IdeationRound): IsolationViolation[] {
  const out: IsolationViolation[] = [];
  const numbers = round.ideators.map((i) => i.ideator);
  const expected = Array.from({ length: round.ideators.length }, (_, i) => i + 1);
  if (numbers.join(",") !== expected.join(",")) {
    out.push({
      ideator: 0,
      kind: "context-drift",
      detail: `ideators are numbered ${numbers.join(", ") || "(none)"}; a round is numbered 1..${round.ideators.length} with no gaps`,
    });
    return out;
  }

  for (const it of round.ideators) {
    const rebuilt = assemble(round.shared, it.ideator, it.candidates, it.offset, round.forcedVariation);
    if (rebuilt.prompt.text !== it.prompt.text) {
      out.push({
        ideator: it.ideator,
        kind: "context-drift",
        detail:
          "the prompt is not what the round's shared context yields at this offset, so something entered it from outside " +
          "the context every ideator shares — a sibling's candidate is the way that happens",
      });
    }
  }

  if (round.arm !== "blind" || !round.forcedVariation) return out;

  // Own dimension is fine and required; a sibling's is the ideators being told
  // about each other, which is coordination wearing blindness's name.
  for (const it of round.ideators) {
    const own = new Set(it.prompt.candidates.map((c) => c.dimension?.id).filter((id): id is string => !!id));
    for (const other of round.ideators) {
      if (other.ideator === it.ideator) continue;
      for (const slot of other.prompt.candidates) {
        const id = slot.dimension?.id;
        if (!id || own.has(id)) continue;
        if (it.prompt.text.includes(id)) {
          out.push({
            ideator: it.ideator,
            kind: "sibling-dimension-in-prompt",
            detail: `names "${id}", which is ideator ${other.ideator}'s dimension — a blind ideator is not told what its siblings were asked`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Whether any ideator's prompt carries a sibling's candidate text — the
 * property in its own words, over what the round actually returned.
 *
 * Comparison is on normalized text (case, punctuation and runs of whitespace
 * folded), so a leak that survived a reformat is still a leak. A candidate that
 * merely restates something in the shared context is not a leak: every prompt
 * carries the shared context by design, and reproducing it is a finding about
 * that ideator, which {@link mergeIdeationRound} reports instead.
 *
 * Empty for an anchored round — the arm exists to have no isolation, and
 * reporting its single prompt as leaky would be condemning it for being what it
 * is.
 */
export function checkBlindness(round: IdeationRound, returns: readonly IdeatorReturn[]): IsolationViolation[] {
  if (round.arm !== "blind") return [];
  const out: IsolationViolation[] = [];

  const byIdeator = new Map<number, IdeatorReturn>();
  for (const r of returns) {
    if (!round.ideators.some((i) => i.ideator === r.ideator)) {
      out.push({
        ideator: r.ideator,
        kind: "unknown-ideator",
        detail: `the round has ideators 1..${round.ideators.length}; nothing was assembled for ${r.ideator}`,
      });
      continue;
    }
    byIdeator.set(r.ideator, r);
  }
  for (const it of round.ideators) {
    if (!byIdeator.has(it.ideator)) {
      out.push({
        ideator: it.ideator,
        kind: "missing-return",
        detail: "returned nothing, so its prompt can be neither cleared nor condemned against the set",
      });
    }
  }

  const sharedTexts = round.shared.existingSolutions.map(normalize);
  const prompts = new Map(round.ideators.map((i) => [i.ideator, normalize(i.prompt.text)]));

  for (const source of byIdeator.values()) {
    for (const raw of source.candidates) {
      const text = normalize(raw);
      if (sharedTexts.includes(text)) continue; // shared context, in every prompt by design
      if (text.split(" ").filter(Boolean).length < MIN_CHECKABLE_WORDS) {
        out.push({
          ideator: source.ideator,
          kind: "uncheckable-candidate",
          detail: `"${raw}" is under ${MIN_CHECKABLE_WORDS} words, so a match in a sibling's prompt cannot be told from a coincidence`,
        });
        continue;
      }
      for (const [ideator, promptText] of prompts) {
        if (ideator === source.ideator) continue;
        if (promptText.includes(text)) {
          out.push({
            ideator,
            kind: "sibling-candidate-in-prompt",
            detail: `carries ideator ${source.ideator}'s candidate "${raw}", so the two were not independent`,
          });
        }
      }
    }
  }
  return out;
}

/** {@link checkRoundIsolation} and {@link checkBlindness} together, as a refusal. */
export function assertBlindIdeation(round: IdeationRound, returns?: readonly IdeatorReturn[]): void {
  const violations = [...checkRoundIsolation(round), ...(returns ? checkBlindness(round, returns) : [])];
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  ideator ${v.ideator}: ${v.kind} — ${v.detail}`);
  throw new BlindIdeationError(
    `ideation round for "${round.shared.opportunity}" does not carry the isolation it claims:\n${lines.join("\n")}`,
    violations,
  );
}

/**
 * The round's variation assignments in the compact form `ost_next_work` carries,
 * numbered by merged position rather than by position within one prompt.
 *
 * Refuses an unsound round first, so no surface can publish assignments the
 * isolation check would not pass.
 */
export function roundAssignments(round: IdeationRound): VariationAssignment[] {
  assertBlindIdeation(round);
  const out: VariationAssignment[] = [];
  for (const it of round.ideators) {
    for (const a of variationAssignments(it.prompt)) {
      out.push({ ...a, candidate: out.length + 1 });
    }
  }
  return out;
}

/**
 * Merge what the ideators returned — the only step at which the candidates meet.
 *
 * Refuses first: a set that reached the merge through a leaked prompt is not a
 * blind set, and merging it would launder that. Then it reports collisions
 * rather than resolving them, because two independent draws landing on one idea
 * is a fact about the opportunity and a human's call, not a dedupe.
 */
export function mergeIdeationRound(round: IdeationRound, returns: readonly IdeatorReturn[]): MergedRound {
  assertBlindIdeation(round, returns);

  const candidates: MergedCandidate[] = [];
  for (const it of round.ideators) {
    const returned = returns.find((r) => r.ideator === it.ideator)?.candidates ?? [];
    returned.forEach((text, i) => {
      candidates.push({
        candidate: candidates.length + 1,
        ideator: it.ideator,
        text,
        dimension: (it.prompt.candidates[i]?.dimension?.id as VariationDimensionId | undefined) ?? null,
      });
    });
  }

  const collisions: CandidateCollision[] = [];
  for (const c of candidates) {
    const existing = round.shared.existingSolutions
      .map((s) => ({ s, score: similarity(c.text, s) }))
      .filter(({ score }) => score >= COLLISION_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];
    if (existing) {
      collisions.push({
        kind: "restates-shared-context",
        candidate: c.candidate,
        duplicateOf: null,
        score: existing.score,
        detail: `ideator ${c.ideator} restated "${existing.s}", which was already under the opportunity`,
      });
      continue;
    }
    const prior = candidates
      .filter((o) => o.candidate < c.candidate)
      .map((o) => ({ o, score: similarity(c.text, o.text) }))
      .filter(({ score }) => score >= COLLISION_THRESHOLD)
      .sort((a, b) => b.score - a.score)[0];
    if (prior) {
      collisions.push({
        kind: "coincidence",
        candidate: c.candidate,
        duplicateOf: prior.o.candidate,
        score: prior.score,
        detail:
          `ideator ${c.ideator} and ideator ${prior.o.ideator} landed on the same idea from separate contexts ` +
          `(similarity ${prior.score.toFixed(2)}); the set is narrower than its count`,
      });
    }
  }

  return { opportunity: round.shared.opportunity, arm: round.arm, candidates, collisions };
}

/** Case, punctuation and whitespace folded, so a leak that survived a reformat is still a leak. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
