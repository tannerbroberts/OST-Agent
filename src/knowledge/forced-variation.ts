/**
 * Forced variation — candidates that must differ from their siblings on a
 * dimension somebody named.
 *
 * Asked for three solutions, a model returns three phrasings of one idea, and
 * nothing downstream recovers from that: elimination is bounded above by
 * generation, so a disciplined kill process over a narrow set converges
 * precisely and wrongly. The ruleset already says "generate multiple competing
 * solutions", and the commands already say "genuinely distinct" — and neither
 * measures it. Distinct is hoped for, never stated.
 *
 * This module makes it a stated property of the set. An ideation prompt built
 * here gives every candidate it requests a **named** variation dimension — who
 * does the work, automated versus manual, bought versus built, what is
 * deliberately given up — and no two candidates in one request share one. The
 * dimension is written down, so whether the set honoured it is auditable by
 * reading the candidates rather than by inferring intent.
 *
 * Two honest limits, stated here because the node that asked for this states
 * them too:
 *
 * - It widens the search inside the frame someone already drew. A dimension
 *   nobody thought to name is a dimension no candidate is pushed along.
 * - It settles nothing about quality. Three genuinely different and genuinely
 *   useless candidates satisfy every check in this file. Whether the
 *   constraint buys range rather than noise is a blind rating by a person, and
 *   `forcedVariation: false` exists so that person has an unconstrained arm to
 *   rate against.
 *
 * The fail-closed rule the other vocabularies in this directory use applies:
 * a prompt that claims the constraint and carries a candidate with no
 * dimension, an unknown one, or a repeated one is refused, and a request for
 * more candidates than there are dimensions is refused rather than quietly
 * doubling one up.
 */

export interface VariationDimension {
  id: string;
  label: string;
  /** The question a candidate must answer differently from every sibling on this dimension. */
  ask: string;
}

export const VARIATION_DIMENSIONS = [
  {
    id: "who-does-the-work",
    label: "Who does the work",
    ask: "Who carries the work — the person, the agent, an outside party, or nobody because the step is removed?",
  },
  {
    id: "automated-vs-manual",
    label: "Automated versus manual",
    ask: "What is automated, and what is left deliberately manual and why?",
  },
  {
    id: "bought-vs-built",
    label: "Bought versus built",
    ask: "What is adopted from outside as it is, and what is built here?",
  },
  {
    id: "what-is-given-up",
    label: "What is deliberately given up",
    ask: "What does this candidate give up on purpose — a capability, a guarantee, a case — that its siblings keep?",
  },
  {
    id: "when-it-acts",
    label: "When it acts",
    ask: "Does it act before the problem (prevent), during (interrupt), or after (repair or report)?",
  },
  {
    id: "where-it-lives",
    label: "Where it lives",
    ask: "Which surface carries it — the CLI, the tool server, the vault's files, the repository, CI, or a person's inbox?",
  },
  {
    id: "what-it-measures",
    label: "What it measures",
    ask: "What observable fact does it read to know it worked, and what does it refuse to infer?",
  },
  {
    id: "who-decides",
    label: "Who decides",
    ask: "Where does the judgement sit — a rule fixed in advance, the agent at run time, or a person at a checkpoint?",
  },
] as const satisfies readonly VariationDimension[];

export type VariationDimensionId = (typeof VARIATION_DIMENSIONS)[number]["id"];

const BY_ID = new Map<string, VariationDimension>(VARIATION_DIMENSIONS.map((d) => [d.id, d]));

export function isVariationDimension(id: string): id is VariationDimensionId {
  return BY_ID.has(id);
}

export function variationDimension(id: VariationDimensionId): VariationDimension {
  return BY_ID.get(id)!;
}

export interface IdeationRequest {
  /** The target opportunity's title, as the tree spells it. */
  opportunity: string;
  /** Sibling solutions already under it. Listed so a candidate differs from them too, not only from the other candidates. */
  existingSolutions?: readonly string[];
  /** How many candidates to ask for. Must be ≥ 1 and, when the constraint is on, ≤ the number of dimensions. */
  candidates: number;
  /**
   * Whether each candidate carries a named dimension. Defaults to `true`; the
   * `false` arm exists for the human blind-rating that decides whether the
   * constraint is worth keeping, and for nothing else.
   */
  forcedVariation?: boolean;
  /**
   * Which dimension the first candidate takes, as an index into
   * {@link VARIATION_DIMENSIONS}. Defaults to the number of existing siblings,
   * so a second request on the same opportunity starts where the first left
   * off rather than asking for the same dimensions again.
   */
  offset?: number;
}

export interface CandidateSlot {
  /** 1-based position in the request. */
  candidate: number;
  /** The dimension this candidate must differ on; `null` only in an unconstrained prompt. */
  dimension: VariationDimension | null;
}

export interface IdeationPrompt {
  opportunity: string;
  forcedVariation: boolean;
  candidates: CandidateSlot[];
  /** The prompt as the model reads it. Every dimension in `candidates` is named in here. */
  text: string;
}

/**
 * The compact form of one slot, for surfaces that carry the assignment inside a
 * larger payload (`ost_next_work`'s `underservedOpportunities[].variation`) and
 * have a size budget to keep.
 */
export interface VariationAssignment {
  candidate: number;
  dimension: VariationDimensionId;
  ask: string;
}

export class ForcedVariationError extends Error {
  constructor(
    message: string,
    readonly violations: readonly VariationViolation[] = [],
  ) {
    super(message);
    this.name = "ForcedVariationError";
  }
}

/**
 * Build the ideation prompt for one target opportunity.
 *
 * With the constraint on (the default), every candidate gets a distinct
 * dimension, taken in order from {@link VARIATION_DIMENSIONS} starting at
 * `offset` and wrapping. Asking for more candidates than there are dimensions
 * is refused: the only way to satisfy it would be to give two candidates the
 * same dimension, which is the constraint quietly not holding.
 */
export function buildIdeationPrompt(req: IdeationRequest): IdeationPrompt {
  const forced = req.forcedVariation !== false;
  const existing = req.existingSolutions ?? [];
  if (!Number.isInteger(req.candidates) || req.candidates < 1) {
    throw new ForcedVariationError(`an ideation prompt asks for at least one candidate; got ${req.candidates}`);
  }
  const n = VARIATION_DIMENSIONS.length;
  if (forced && req.candidates > n) {
    throw new ForcedVariationError(
      `cannot give ${req.candidates} candidates distinct variation dimensions: only ${n} are named. ` +
        `Ask for at most ${n} per request, or name a new dimension in VARIATION_DIMENSIONS.`,
    );
  }
  const offset = ((req.offset ?? existing.length) % n + n) % n;

  const candidates: CandidateSlot[] = Array.from({ length: req.candidates }, (_, i) => ({
    candidate: i + 1,
    dimension: forced ? VARIATION_DIMENSIONS[(offset + i) % n] : null,
  }));

  return {
    opportunity: req.opportunity,
    forcedVariation: forced,
    candidates,
    text: renderText(req.opportunity, existing, candidates, forced),
  };
}

function renderText(
  opportunity: string,
  existing: readonly string[],
  candidates: readonly CandidateSlot[],
  forced: boolean,
): string {
  const lines: string[] = [];
  lines.push(
    `Ideate ${candidates.length} candidate solution(s) for the opportunity "${opportunity}". Each is a candidate for a human to weigh against the others — compare-and-contrast, not implementation steps.`,
  );
  if (existing.length) {
    lines.push(`Already under it: ${existing.map((s) => `"${s}"`).join(", ")}. A new candidate must differ from these as well as from each other.`);
  }
  if (forced) {
    lines.push(
      "Distinctness is a stated property of this set, not a hope. Each candidate below carries a named variation dimension; it must take a position on that dimension that no sibling takes, and its prose must say what that position is.",
    );
    for (const c of candidates) {
      const d = c.dimension!;
      lines.push(`Candidate ${c.candidate} — vary on «${d.label}» (${d.id}): ${d.ask}`);
    }
    lines.push(
      "Three phrasings of one idea satisfy no dimension. If a candidate cannot be placed on its dimension, say so rather than inventing a position.",
    );
  } else {
    for (const c of candidates) lines.push(`Candidate ${c.candidate}.`);
  }
  return lines.join("\n");
}

export type VariationViolationKind = "missing-dimension" | "unknown-dimension" | "repeated-dimension" | "unnamed-in-text";

export interface VariationViolation {
  candidate: number;
  kind: VariationViolationKind;
  detail: string;
}

/**
 * Every way a prompt that claims the constraint fails to carry it. Empty for a
 * sound prompt, and empty for an unconstrained one — `forcedVariation: false`
 * promises nothing, so there is nothing to break.
 */
export function checkForcedVariation(prompt: IdeationPrompt): VariationViolation[] {
  if (!prompt.forcedVariation) return [];
  const out: VariationViolation[] = [];
  const seen = new Map<string, number>();
  for (const c of prompt.candidates) {
    if (!c.dimension) {
      out.push({ candidate: c.candidate, kind: "missing-dimension", detail: "the constraint is on and this candidate names no dimension" });
      continue;
    }
    if (!isVariationDimension(c.dimension.id)) {
      out.push({ candidate: c.candidate, kind: "unknown-dimension", detail: `"${c.dimension.id}" is not a named dimension` });
      continue;
    }
    const first = seen.get(c.dimension.id);
    if (first !== undefined) {
      out.push({
        candidate: c.candidate,
        kind: "repeated-dimension",
        detail: `"${c.dimension.id}" was already given to candidate ${first}; two candidates on one dimension is the constraint not holding`,
      });
    } else {
      seen.set(c.dimension.id, c.candidate);
    }
    if (!prompt.text.includes(c.dimension.id)) {
      out.push({
        candidate: c.candidate,
        kind: "unnamed-in-text",
        detail: `"${c.dimension.id}" is assigned but the prompt text never names it, so it never reaches the model`,
      });
    }
  }
  return out;
}

/** {@link checkForcedVariation}, as a refusal. */
export function assertForcedVariation(prompt: IdeationPrompt): void {
  const violations = checkForcedVariation(prompt);
  if (violations.length === 0) return;
  const lines = violations.map((v) => `  candidate ${v.candidate}: ${v.kind} — ${v.detail}`);
  throw new ForcedVariationError(`ideation prompt for "${prompt.opportunity}" does not carry the variation it claims:\n${lines.join("\n")}`, violations);
}

/**
 * The slots of a prompt in their compact form. Refuses an unsound prompt first,
 * so no surface can carry an assignment the check would not pass.
 */
export function variationAssignments(prompt: IdeationPrompt): VariationAssignment[] {
  assertForcedVariation(prompt);
  return prompt.candidates
    .filter((c): c is CandidateSlot & { dimension: VariationDimension } => c.dimension !== null)
    .map((c) => ({ candidate: c.candidate, dimension: c.dimension.id as VariationDimensionId, ask: c.dimension.ask }));
}
