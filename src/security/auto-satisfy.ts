/**
 * Which of this surface's preconditions the surface may satisfy on the caller's
 * behalf, and which it may never satisfy no matter how cheap it looks.
 *
 * The need is recorded in the meta vault as "Every precondition is discovered by
 * violating it, so a pass pays a turn per rule it did not know" — twenty
 * occurrences in eleven sessions of one refusal, `File has not been read yet`,
 * each one a turn spent learning a rule by colliding with it. The solution node
 * this file implements is "The surface satisfies a precondition it could have
 * satisfied itself": where the surface can discharge a precondition itself, it
 * does, and there is no longer a rule for the caller to know.
 *
 * ## The narrowing is the whole design, and it was written before the code
 *
 * The assumption beneath that solution is that the handshake was ceremony. It is
 * not, and the vault says so in the same breath: read-before-write is *what makes
 * "modified since read" detectable*. A surface that auto-reads immediately before
 * writing satisfies the letter of the precondition and destroys the staleness
 * check, because the read it performs is always fresh. That trade — remove a
 * refusal, acquire a silent overwrite — is strictly worse than the friction it
 * removes.
 *
 * So auto-satisfaction is scoped, and {@link AUTO_SATISFY_RULE} is the scope,
 * stated as three conditions that must all hold:
 *
 * 1. **Held.** The surface already holds everything needed to comply. It does not
 *    go and get anything, and it does not ask.
 * 2. **Unique.** Exactly one compliant form exists. Where two repairs are
 *    available the surface is choosing on the caller's behalf, which is a guess
 *    laundered into an answer.
 * 3. **No detection duty.** Nothing else's answer depends on the *caller* having
 *    satisfied it. A precondition whose satisfaction is itself evidence — a read
 *    receipt, which is the only record of what the caller saw and when — carries a
 *    detection duty and may never be discharged here.
 *
 * Condition 3 is the one that does the work, and it is why {@link DISCHARGE}
 * classifies `survivor-body-read` as `refuse` rather than as the obvious win it
 * looks like. Auto-reading the survivor would clear the refusal that fires most
 * often on this surface and would, in the same call, make
 * {@link ../security/tools.ts assertSurvivorUnchanged} unable to ever fire.
 *
 * ## What this file is not
 *
 * It is not a second statement of the rules. The preconditions are declared once,
 * in `call-preconditions.ts`; this says only what may be done about each, keyed by
 * the id that module already publishes. `test/preflight/auto-satisfy-preserves-staleness-guard.test.ts`
 * requires every published precondition to carry a verdict here, so a precondition
 * added later cannot arrive unclassified and read as "not auto-satisfied" by
 * accident rather than by decision.
 */
import { nearestName } from "../fs/near-miss.js";
import type { ToolSchema } from "./validateToolInput.js";
import { validateToolInput } from "./validateToolInput.js";

/** What the surface is allowed to do about a precondition the caller has tripped. */
export type DischargeVerdict =
  /** The surface brings the call into compliance itself and proceeds. */
  | "auto"
  /** The surface refuses, as it always has. Satisfying it is the caller's to do. */
  | "refuse";

/** The rule, written down before any precondition was classified against it. */
export const AUTO_SATISFY_RULE = {
  conditions: [
    {
      id: "held",
      statement: "The surface already holds everything the compliant form needs. It fetches nothing and asks nothing.",
    },
    {
      id: "unique",
      statement: "Exactly one compliant form exists. Two candidate repairs means the surface would be guessing.",
    },
    {
      id: "no-detection-duty",
      statement:
        "No other check's answer depends on the CALLER having satisfied it. A precondition whose satisfaction is the only record of what the caller saw carries a detection duty and is never discharged.",
    },
  ],
  /**
   * The bar, restated as the thing that must not happen. Taken verbatim from the
   * assumption test's threshold so the code and the tree cannot drift on it.
   */
  bar: "With auto-satisfaction enabled, a write whose target changed after the caller's own read is still refused. One silent overwrite is a failure.",
} as const;

/**
 * The one precondition this surface enforces that is NOT a `CallPrecondition`.
 *
 * A closed parameter set is refused at the MCP dispatch point by
 * `validateToolInput`, before any tool's `run` is reached, so it has no entry in
 * `call-preconditions.ts` and would otherwise be classified nowhere. It is named
 * here rather than left implicit, because it is the only entry in {@link DISCHARGE}
 * carrying an `auto` verdict and a policy whose single exception is invisible is
 * not a policy anyone can audit.
 */
export const DISPATCH_PRECONDITIONS = ["closed-parameter-set"] as const;

/** One precondition's verdict, with the reason stated so it can be argued with. */
export interface DischargePolicy {
  /** A `CallPrecondition.id`, or one of {@link DISPATCH_PRECONDITIONS}. */
  readonly id: string;
  readonly verdict: DischargeVerdict;
  /**
   * What the caller's own act of satisfying this precondition makes detectable.
   * `null` exactly when the verdict is `auto` — a precondition with a detection
   * duty is not auto-satisfiable, and one without a duty has nothing to state.
   */
  readonly detectionDuty: string | null;
  /** Which of {@link AUTO_SATISFY_RULE}'s conditions decided it. */
  readonly because: string;
}

/**
 * Every precondition this surface enforces, and what may be done about it.
 *
 * **One `auto` out of twenty-four**, and that ratio is the finding rather than an
 * accident of effort. The solution node this implements reads as a broad idea —
 * "where a precondition is one the tool could discharge on its own, it does" —
 * and the table below is what happens when the idea is applied to a real surface
 * one rule at a time. Nearly every precondition here is either a claim about what
 * is true outside the process (`fails held`), a rule with more than one honest
 * repair (`fails unique`), or a check whose whole value is that the caller had to
 * satisfy it (`fails no-detection-duty`). The friction the parent opportunity
 * counted — twenty read-before-write refusals in eleven sessions — falls squarely
 * in the third class and cannot be removed by this route at all.
 *
 * Each `refuse` still states its duty. "Nobody got round to it" and "this one
 * must never be discharged" are different facts and a reader has to be able to
 * tell them apart, so the field is required and a test holds every entry to it.
 */
export const DISCHARGE: readonly DischargePolicy[] = Object.freeze([
  // ── the one that clears all three conditions ───────────────────────────────
  {
    id: "closed-parameter-set",
    verdict: "auto",
    detectionDuty: null,
    because:
      "held (the schema names every accepted property), unique (repaired only when exactly one accepted property is a typo's distance away and the caller did not also supply it), and nothing downstream reads whether the caller spelled a property correctly.",
  },

  // ── the handshake this work exists to argue about ──────────────────────────
  {
    id: "survivor-body-read",
    verdict: "refuse",
    detectionDuty:
      "The receipt is the only record of WHICH body the caller composed against. Discharging it mints a receipt stamped with the body as it is now, which is what makes a survivor that moved under the caller undetectable — the exact trade the assumption beneath this work says is worse than the friction it removes.",
    because: "fails no-detection-duty.",
  },
  {
    id: "survivor-body-unchanged",
    verdict: "refuse",
    detectionDuty:
      "This IS the detection. Re-reading on the caller's behalf would make the two stamps agree by construction and the check vacuous.",
    because: "fails no-detection-duty.",
  },

  // ── claims about state the surface does not hold ───────────────────────────
  {
    id: "node-exists",
    verdict: "refuse",
    detectionDuty:
      "A title that does not resolve is usually a caller working from a stale listing. Silently steering it to the nearest node would write to whichever node the typo happened to land near.",
    because: "fails unique — `ost_read_tree`'s own miss already offers a suggestion the caller may accept or reject.",
  },
  {
    id: "parent-exists",
    verdict: "refuse",
    detectionDuty: "Same as node-exists: a missing parent is a caller pointing at a tree it has not read.",
    because: "fails held — creating the parent would invent a node nobody wrote.",
  },
  {
    id: "product-repo-configured",
    verdict: "refuse",
    detectionDuty: "The operator has not said where the product is. Nothing the surface holds could answer that.",
    because: "fails held.",
  },
  {
    id: "instrument-spec-resolves",
    verdict: "refuse",
    detectionDuty:
      "A spec file that does not exist is what a red instrument on a buildable test looks like, and the tool already waives this where the threshold is bound. Creating the file would be authoring the measurement.",
    because: "fails held.",
  },
  {
    id: "repo-path-exists",
    verdict: "refuse",
    detectionDuty: "A path in a checkout this surface does not own; the branch under construction moves it.",
    because: "fails held.",
  },
  {
    id: "write-succeeds-on-disk",
    verdict: "refuse",
    detectionDuty: "A full disk or a concurrent writer is not a precondition anything can discharge in advance.",
    because: "fails held — there is no answer before the call.",
  },
  {
    id: "remote-lookup-returns-something",
    verdict: "refuse",
    detectionDuty: "Whether a host is up is state outside this process.",
    because: "fails held — there is no answer before the call.",
  },

  // ── rules with more than one honest repair ─────────────────────────────────
  {
    id: "layer-may-attach",
    verdict: "refuse",
    detectionDuty:
      "An edge the hierarchy forbids is usually a caller that has the two nodes' kinds backwards. Repointing it would decide which of them was wrong.",
    because: "fails unique.",
  },
  {
    id: "field-belongs-to-layer",
    verdict: "refuse",
    detectionDuty:
      "A `threshold` on a Solution is either the wrong field or the wrong layer. Dropping the field and changing the layer are different nodes.",
    because: "fails unique.",
  },
  {
    id: "title-is-a-filename",
    verdict: "refuse",
    detectionDuty:
      "The sanitizer that makes a stored title safe is forgiving by design; applied to a title the caller CHOSE, that forgiveness is a rename nobody asked for.",
    because: "fails unique.",
  },
  {
    id: "sections-accounted-for",
    verdict: "refuse",
    detectionDuty:
      "An unaccounted section is prose about to disappear. Choosing between reproducing it and dropping it is the entire judgement the rule exists to force.",
    because: "fails unique, and it is the one rule here whose discharge would be destructive.",
  },
  {
    id: "no-reserved-heading-in-content",
    verdict: "refuse",
    detectionDuty:
      "A reserved heading inside free text is a caller about to author a measurement. Stripping it would leave the surrounding prose claiming a result that is no longer there.",
    because: "fails unique.",
  },
  {
    id: "threshold-fixes-a-bar",
    verdict: "refuse",
    detectionDuty:
      "A threshold with no comparator is a test that cannot come out a failure — the defect this tree names in its own rollup. Inventing the bar would be inventing the finding.",
    because: "fails held.",
  },
  {
    id: "instrument-is-a-spec-file",
    verdict: "refuse",
    detectionDuty:
      "A command that does not parse is a command nobody has run. Repairing it would attach an instrument whose red nobody has seen.",
    because: "fails held — the surface cannot know what the caller meant to measure.",
  },
  {
    id: "solution-states-its-kill-criteria",
    verdict: "refuse",
    detectionDuty:
      "A kill condition supplied by the surface is one nobody committed to, which is how a tree fills with candidates nothing can end.",
    because: "fails held.",
  },
  {
    id: "unknown-states-its-format",
    verdict: "refuse",
    detectionDuty: "The format is the stopping condition. Only the author knows what an answer would look like.",
    because: "fails held.",
  },

  // ── checks whose whole value is that the caller had to satisfy them ────────
  {
    id: "evidence-class-declared",
    verdict: "refuse",
    detectionDuty:
      "The rung is the author's own statement of how much is known. A default supplied by the surface would be a claim with no one behind it.",
    because: "fails no-detection-duty.",
  },
  {
    id: "within-source-standing",
    verdict: "refuse",
    detectionDuty:
      "A rung above what the source has earned is the node overstating itself. Quietly demoting it publishes a node whose author still believes it says more than it does.",
    because: "fails no-detection-duty, and fails unique — demote, or bring better provenance.",
  },
  {
    id: "unearned-measurement-rung",
    verdict: "refuse",
    detectionDuty: "Same claim, one rung up: 'observed' asserts a measurement happened. Only a recorded result can discharge it.",
    because: "fails no-detection-duty.",
  },
  {
    id: "status-is-agent-settable",
    verdict: "refuse",
    detectionDuty: "'validated' is a human's word. A surface that supplied it would be the agent grading itself.",
    because: "fails no-detection-duty.",
  },
  {
    id: "outcome-achievement-needs-an-external-signal",
    verdict: "refuse",
    detectionDuty:
      "The one gate nothing beneath it can catch. Discharging it is the definition of grading your own homework.",
    because: "fails no-detection-duty.",
  },
  {
    id: "humans-required-takes-no-instrument",
    verdict: "refuse",
    detectionDuty:
      "A person is the measurement. There is no command to supply, and supplying one would let a machine answer a question labelled for a human.",
    because: "fails held.",
  },
]);

/** The verdict for one precondition id, or `undefined` if it carries none. */
export function dischargeOf(id: string): DischargePolicy | undefined {
  return DISCHARGE.find((d) => d.id === id);
}

/** May the surface satisfy this precondition itself? Unclassified reads as no. */
export function mayAutoSatisfy(id: string): boolean {
  return dischargeOf(id)?.verdict === "auto";
}

/** One thing the surface did on the caller's behalf, so the absorbed signal is counted. */
export interface Discharge {
  /** The tool whose call was repaired. */
  readonly tool: string;
  /** The `CallPrecondition.id` that was discharged. */
  readonly precondition: string;
  /** What was actually done, in the caller's own vocabulary. */
  readonly did: string;
}

/**
 * The session's record of every automatic discharge.
 *
 * The solution node's cost line requires it: absorbing a refusal absorbs the
 * signal that the caller was confused, so the discharge is counted rather than
 * lost. In-process and session-scoped, on the same terms as the receipt book —
 * and every discharge is also named in the call's own response, because a ledger
 * nothing reads is a count nobody takes.
 */
export interface DischargeLedger {
  record(d: Discharge): void;
  entries(): readonly Discharge[];
}

export function createDischargeLedger(): DischargeLedger {
  const entries: Discharge[] = [];
  return {
    record(d) {
      entries.push(d);
    },
    entries() {
      return entries;
    },
  };
}

/** What {@link autoSatisfyInput} decided about one call. */
export interface AutoSatisfied {
  /** The input as the tool should now receive it. Identical object when nothing was done. */
  readonly input: unknown;
  /** Every repair applied, in order. Empty means the input is untouched. */
  readonly discharges: readonly Discharge[];
}

/**
 * Discharge the closed-parameter-set precondition where it can be discharged.
 *
 * The only class handled here, and the narrowness is the point. A caller that
 * misspells an accepted property has tripped a rule that names its own remedy and
 * carries no information: the schema already says what the property is called, and
 * nothing anywhere reads whether the caller got it right the first time. So the
 * surface renames it and proceeds.
 *
 * The conditions are all three of {@link AUTO_SATISFY_RULE}, checked here rather
 * than promised:
 *
 * - **held** — {@link ToolSchema.properties} is the whole universe of accepted
 *   names; nothing is fetched.
 * - **unique** — {@link nearestName} is the repository's existing near-miss rule
 *   and it already refuses a tie, refuses a difference that is only a numeric
 *   series, and refuses names too short for distance to mean anything. A key with
 *   two equally close targets is not repaired. Neither is one whose target the
 *   caller also supplied — that is two values for one property, and choosing
 *   between them is not a spelling correction.
 * - **no detection duty** — asserted by {@link DISCHARGE}, and the repair is
 *   type-checked against the target property before it is applied, so a rename
 *   can never turn a refusal into a wrong write.
 *
 * A missing REQUIRED property is deliberately not touched. There is no unique
 * value to supply, and inventing one is how `ost_annotate` once appended the
 * string "undefined" to fourteen nodes, permanently.
 */
export function autoSatisfyInput(tool: string, schema: ToolSchema | undefined, input: unknown): AutoSatisfied {
  if (!mayAutoSatisfy("closed-parameter-set")) return { input, discharges: [] };
  if (!schema || schema.additionalProperties !== false || !schema.properties) return { input, discharges: [] };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { input, discharges: [] };

  const supplied = input as Record<string, unknown>;
  const accepted = Object.keys(schema.properties);
  const unexpected = Object.keys(supplied).filter((k) => !accepted.includes(k));
  if (unexpected.length === 0) return { input, discharges: [] };

  const repaired: Record<string, unknown> = { ...supplied };
  const discharges: Discharge[] = [];
  for (const key of unexpected) {
    // Only names the caller has not already used are candidates: renaming onto an
    // occupied property would silently discard one of two values.
    const free = accepted.filter((a) => supplied[a] === undefined);
    const target = nearestName(key, free);
    if (target === undefined) continue;
    // The rename has to survive the schema it is being repaired into. A `limit`
    // whose value is a string does not become valid by being called `count`, and
    // a repair that trades one refusal for another has cost the caller the turn
    // it was supposed to save.
    if (validateToolInput(schema.properties[target], supplied[key], target).length > 0) continue;
    delete repaired[key];
    repaired[target] = supplied[key];
    discharges.push({
      tool,
      precondition: "closed-parameter-set",
      did: `read \`${key}\` as \`${target}\` — one accepted property is a typo's distance from it and you did not supply that one`,
    });
  }

  return discharges.length > 0 ? { input: repaired, discharges } : { input, discharges: [] };
}

/**
 * The sentence a response carries when the surface did something for the caller.
 *
 * Named in the response rather than logged quietly, because the whole objection to
 * absorbing a refusal is that it absorbs the evidence the caller was confused. A
 * caller that reads this can fix its next call; a transcript that carries it can
 * still be counted.
 */
export function renderDischarges(discharges: readonly Discharge[]): string {
  if (discharges.length === 0) return "";
  return (
    `(the surface satisfied ${discharges.length === 1 ? "a precondition" : `${discharges.length} preconditions`} ` +
    `for you rather than refusing: ${discharges.map((d) => d.did).join("; ")}. Nothing was guessed — each repair had ` +
    `exactly one candidate. Compose the corrected form next time and this costs nothing at all.)`
  );
}
