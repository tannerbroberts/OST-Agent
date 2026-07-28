/**
 * The unknown model — what darkness declares about itself.
 *
 * An unknown carries a contract in three body sections: Format (the shape a
 * valid answer takes), Methodology (how it would be collected), Rationale
 * (which node and metric it serves). Format is the stopping condition: an
 * unknown that can state what an answer looks like knows when it is done.
 *
 * The class is DERIVED from contract completeness, never stored. That is
 * deliberate on two counts: replacing the classifier reclassifies every
 * existing node with no migration, and completeness is mechanically checkable
 * rather than a judgement about how mysterious something feels — the same
 * crudeness as `hasRecordedResult`. This classifier is one allele, shipped as
 * the v1 default and expected to lose to something with better predictive
 * power over cost-to-resolve.
 */
import type { OstNode } from "../ost/node.js";

export type UnknownClass = "bounded" | "unreached" | "unbounded";

export const UNKNOWN_CLASSES: readonly UnknownClass[] = ["bounded", "unreached", "unbounded"] as const;

export type ResolutionState = "open" | "satisfied" | "abandoned";

/** The contract's sections, in the order a session should declare them. */
const CONTRACT_SECTIONS = ["Format", "Methodology", "Rationale"] as const;

/** True when the body carries a `## <heading>` section. Anchored to a heading so prose cannot fake one. */
function hasSection(body: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${heading}\b`, "im").test(body);
}

/** Which contract sections this unknown has not declared. */
export function contractGaps(node: OstNode): string[] {
  return CONTRACT_SECTIONS.filter((s) => !hasSection(node.body, s));
}

/**
 * Class by contract completeness:
 * - no Format          → unbounded (you cannot say what an answer looks like)
 * - Format, no Method  → unreached (you know the answer's shape; nothing emits it)
 * - both               → bounded   (open the cabinet)
 */
export function classifyUnknown(node: OstNode): UnknownClass {
  if (!hasSection(node.body, "Format")) return "unbounded";
  return hasSection(node.body, "Methodology") ? "bounded" : "unreached";
}

/**
 * A mechanical presence check, on the same precedent as `hasRecordedResult`
 * (`eval/evidence-debt.ts`): satisfied means an `## Answer` heading exists or a
 * human moved the node to `validated`, never that the answer was checked
 * against its declared Format. That is a floor, not a verdict — an agent can
 * still write `## Answer` on nothing, or set `status: validated` on its own
 * node, and this function will call it satisfied either way. Abandonment is
 * checked first so that a deferred unknown reads as abandoned even if an
 * answer was drafted — the human's call outranks the draft.
 */
export function resolutionState(node: OstNode): ResolutionState {
  if (node.status === "deferred") return "abandoned";
  if (node.status === "validated" || hasSection(node.body, "Answer")) return "satisfied";
  return "open";
}
