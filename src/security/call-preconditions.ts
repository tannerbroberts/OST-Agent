/**
 * The published preconditions: every condition this surface refuses a call for,
 * stated as something the caller can evaluate BEFORE it composes the call.
 *
 * The need is recorded in the meta vault as "Two thirds of my calls failed, and
 * each one only told me after I made it", and the shape of the waste is visible
 * in this project's own usage trace: three failed calls in one day, all the same
 * refusal, all about an evidence ceiling that was fully determined by the source
 * before the call was written. Nothing about those failures needed a round trip.
 *
 * ## This is a second reader of the rule, never a second statement of it
 *
 * The objection that most threatens the idea is in the solution node itself:
 * "Published preconditions are a second copy of the rules, and a second copy
 * drifts. A caller checking against a stale description will be confidently
 * wrong, which is worse than being told no." This repository has already paid
 * that price once — a guard that derived the rule it was checking agreed with the
 * bug for 23 releases.
 *
 * So nothing in this file decides anything. Every {@link CallPrecondition.check}
 * calls the SAME function the tool's `run` calls — `parseInstrument`,
 * `parseThresholdField`, `parseKillDate`, `unearnedRung`, `fileNameForTitle`,
 * `reservedHeadingIn` — over a snapshot of the same state. `CHILD_HIERARCHY`,
 * `AGENT_SETTABLE_STATUSES` and `TRUST_CEILINGS` are imported, not restated. The
 * rule has one statement; this module is a second place it is *read*, which is
 * the only form of publication that cannot go stale against enforcement.
 *
 * What that buys is checkable rather than promised: `checkCall` and the real tool
 * can be run against the same input and required to agree, which is what
 * `test/mcp/refusal-precondition-coverage.test.ts` does with the corpus of inputs
 * that actually got refused.
 *
 * ## Three grades of expressibility, and the middle one is the honest answer
 *
 * The assumption under the solution is that the conditions are expressible
 * outside the tool, and its own words are that "any that are not will still be
 * discovered the hard way — so the improvement is real but partial". A grade per
 * precondition is how that partiality gets counted instead of asserted:
 *
 * - **`fully`** — decidable from the call's own arguments plus a snapshot of
 *   state this tool owns (the vault, its config, its ruleset). A caller that
 *   holds {@link PublishedPreconditions} can get the same verdict the tool will.
 * - **`caveat`** — decidable from the arguments and a snapshot, but the snapshot
 *   can be true when published and false when called. Usually because the state
 *   is not this tool's to own — a product repository checked out beside the vault
 *   — and once because it is state the CALLER moves between the snapshot and the
 *   call (the session's read receipts). The check is real; the guarantee is not.
 * - **`not`** — the answer does not exist before the call. A filesystem write
 *   that fails, a web fetch that returns nothing, a response that turns out too
 *   large. Publishing these is honest bookkeeping and nothing more: a caller
 *   cannot avoid them, and {@link RefusalCoverage} counts them against the idea.
 *
 * `caveat` and `not` are published with the rest, and named in
 * {@link renderCallPreconditions}, because a manifest that lists only what it
 * covers reads as complete. The share that matters is measured in
 * `src/telemetry/refusal-precondition-coverage.ts`, weighted by what actually
 * fired, not counted flat over paths nobody hits.
 */
import path from "node:path";
import {
  evidenceActors,
  keyString,
  readTrustLedger,
  rungOf,
  sourceTrustKey,
  TRUST_CEILINGS,
  type TrustLedger,
} from "../knowledge/actor-trust.js";
import type { Actor } from "../adapters/source.js";
import { BELIEVABILITY_LADDER, isRung, rungRank, type RungId } from "../knowledge/believability.js";
import { INSTRUMENT_FORMS, isInstrument, parseInstrument } from "../knowledge/instruments.js";
import { hasNonEmptySection } from "../knowledge/unknowns.js";
import { parseThresholdField, thresholdKindOf } from "../eval/coverage.js";
import { MEASUREMENT_RUNGS, unearnedRung } from "../eval/rungs.js";
import { MAX_KILL_HORIZON_DAYS, parseKillCondition, parseKillDate } from "../ost/kill-criteria.js";
import { RESERVED_HEADINGS, reservedHeadingIn } from "../ost/headings.js";
import { accountForSections } from "../ost/section-accounting.js";
import { specResolves } from "../ost/instrument.js";
import { claimsOutcomeAchieved, outcomeSignalState, rootOutcome } from "../ost/outcome-signal.js";
import { canonicalTitle, fileNameForTitle, titlesMatch } from "../ost/sanitize.js";
import type { ReadReceipts } from "./read-receipts.js";
import { ALLOWED_TOOL_NAMES, writesTheVault } from "./policy.js";
import { CAUTIOUS_LANE } from "../knowledge/lanes.js";
import type { OstNode } from "../ost/node.js";
import type { Vault } from "../ost/vault.js";
import { AGENT_SETTABLE_STATUSES, CHILD_HIERARCHY, VALIDATED_REFUSAL } from "./tools.js";

/** How much of a refusal a caller can decide before making the call. */
export type Expressibility =
  /** Arguments plus a snapshot of state this tool owns. */
  | "fully"
  /** Same, but over state this tool does not own, so the snapshot can go stale. */
  | "caveat"
  /** No answer exists before the call. */
  | "not";

/**
 * The snapshot a caller evaluates against.
 *
 * Everything here is a VALUE — no vault handle, no filesystem access, nothing
 * that could quietly re-read the world at check time. That is what makes it
 * publishable: a caller can hold this, evaluate a hundred candidate calls against
 * it without touching disk, and know exactly which instant it describes.
 */
export interface PublishedFacts {
  /** ISO date the snapshot was taken — every horizon is relative to it. */
  readonly asOf: string;
  /**
   * Node filenames, not titles, and every file the root walk enumerated rather
   * than every node the tree returns.
   *
   * Both halves of that are load-bearing and the second one was a bug first.
   * `Vault.has` resolves a title through {@link fileNameForTitle} and asks the
   * filesystem — so the filename is what existence keys off, and comparing titles
   * here would be a looser rule that says yes to calls the vault says no to.
   * Building the set from `readTree()` was the opposite error and worse: a node
   * carrying a `## Retraction` is withheld from every reader and its FILE is still
   * on disk, so `Vault.has` says yes where the live tree says no. A publication
   * that refused a call the tool accepts is the confidently-wrong contract this
   * module exists to avoid, in the strict direction. `readTreeCensus().seenFiles`
   * is the same walk `Vault.has` would hit, so the two cannot disagree.
   */
  readonly nodeFiles: ReadonlySet<string>;
  /**
   * Files that exist but that no reader returns — retracted, archived, or not a
   * node at all. Not a refusal: every write tool accepts them, and publishing one
   * as a refusal would be this module authoring a rule. Published as an advisory
   * because a caller annotating a retracted node is doing work nothing will read.
   */
  readonly existsButWithheld: ReadonlySet<string>;
  /** Filename → the node, for the checks that need a layer, links or body. */
  readonly nodesByFile: ReadonlyMap<string, OstNode>;
  /** Title → node, exactly the index {@link unearnedRung} resolves links against. */
  readonly nodesByTitle: ReadonlyMap<string, OstNode>;
  /** Which parent layers each creatable layer may attach under. */
  readonly hierarchy: Readonly<Record<string, readonly string[]>>;
  /** The `## Headings` no tool argument may contain. */
  readonly reservedHeadings: readonly string[];
  /** The rungs a node may declare. */
  readonly evidenceClasses: readonly RungId[];
  /** The statuses a tool call may set. */
  readonly settableStatuses: readonly string[];
  /** The instrument command forms, by id, with the shape each accepts. */
  readonly instrumentForms: readonly { readonly id: string; readonly example: string }[];
  /** The strongest rung each actor kind can ever reach. */
  readonly trustCeilings: Readonly<Record<string, RungId>>;
  /** The trust ledger, so a source's earned rung is computed, never looked up. */
  readonly trustLedger: TrustLedger;
  /** Evidence-record actors, for sources that cite a stored record. */
  readonly evidenceActors: ReadonlyMap<string, Actor>;
  /** Filenames of tests in the humans-required lane — no command may be attached. */
  readonly humansRequired: ReadonlySet<string>;
  /**
   * The node bodies this session had been served when the snapshot was taken,
   * canonically spelled — what `ost_merge_nodes` requires of its survivor.
   *
   * Empty on a publication taken with no session behind it (the CLI's
   * `preconditions` command builds one per process, and that process has read
   * nothing). Empty is the honest answer there and not a bug: in that process,
   * every merge WOULD be refused.
   */
  readonly bodiesRead: ReadonlySet<string>;
  /** Product repositories configured for this vault, absolute. */
  readonly productRepos: readonly string[];
  /** Longest kill horizon a new Solution may name, in days. */
  readonly maxKillHorizonDays: number;
  /** The root Outcome's title, if the vault has one — the node the top verdict is about. */
  readonly outcomeTitle?: string;
  /**
   * Whether a declared external signal has been read as met by a person. False
   * on a vault that declared no signal at all, which is the same answer for the
   * caller and a different one for the operator (`ost/outcome-signal.ts`).
   */
  readonly outcomeAchieved: boolean;
}

/** One violation a caller found without making the call. */
export interface PreconditionViolation {
  /** The precondition that would refuse it. */
  id: string;
  /** How much the caller can trust this verdict — see {@link Expressibility}. */
  expressibility: Expressibility;
  /** What is wrong, in the terms the refusal would have used. */
  reason: string;
}

/**
 * One published condition.
 *
 * `check` returns the reason the call would be refused, or `null`. It never
 * throws and never reads the world: a caller evaluating fifty candidate calls
 * against one snapshot must not be able to change anything by doing so.
 */
export interface CallPrecondition {
  readonly id: string;
  /** The calls it constrains, by bare tool name. */
  readonly tools: readonly string[];
  /** The condition as a caller reads it, in one line. */
  readonly statement: string;
  readonly expressibility: Expressibility;
  /** Why it is not `fully`. Required for `caveat` and `not`, absent for `fully`. */
  readonly caveat?: string;
  /** The single statement of this rule, as `file.ts:symbol` — what `check` calls. */
  readonly enforcedBy: string;
  readonly check: (input: Record<string, unknown>, facts: PublishedFacts) => string | null;
}

/** A string argument, or undefined if the caller did not pass one. */
function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" ? v : undefined;
}

/** Does the vault hold a node under this title? The `Vault.has` rule, on a snapshot. */
function held(facts: PublishedFacts, title: string | undefined): boolean {
  if (!title) return false;
  try {
    return facts.nodeFiles.has(path.basename(fileNameForTitle(title)));
  } catch {
    // `fileNameForTitle` throws on a title that reduces to nothing or escapes the
    // root. The vault refuses that call too, so "not held" is the right answer
    // here; `title-is-a-filename` is the precondition that reports the reason.
    return false;
  }
}

/**
 * The AssumptionTest an instrument is being attached to, as it will read once the
 * call lands: the node already on disk for `ost_set_instrument`, and the draft the
 * arguments describe for `ost_create_node`.
 *
 * Both doors reach the same rule in `security/tools.ts`, so both are read here.
 * Returning `undefined` means the caller named a node the snapshot does not hold,
 * which `node-exists` owns and this rule must not report a second time.
 */
function testUnderInstrument(input: Record<string, unknown>, facts: PublishedFacts): OstNode | undefined {
  const existing = node(facts, str(input, "test"));
  if (existing) return existing;
  if (str(input, "layer") !== "AssumptionTest") return undefined;
  return {
    title: str(input, "title") ?? "",
    layer: "AssumptionTest",
    body: str(input, "body") ?? "",
    threshold: str(input, "threshold"),
    tags: [],
    links: [],
  } as OstNode;
}

function node(facts: PublishedFacts, title: string | undefined): OstNode | undefined {
  if (!title) return undefined;
  try {
    return facts.nodesByFile.get(path.basename(fileNameForTitle(title)));
  } catch {
    return undefined;
  }
}

/**
 * Every tool argument that names a node the vault must already hold.
 *
 * One list rather than one precondition per tool, because the refusal is one
 * rule with one statement (`Vault.read`'s `no such node`) reached through eleven
 * doors. Sixty-one of the 118 refusals in this project's usage trace came through
 * a single one of them (`ost_annotate`), so a manifest that split this into
 * eleven lines would report eleven rules where a caller has to learn one.
 */
const NODE_ARGUMENTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ost_append_to_node: ["title"],
  ost_set_status: ["title"],
  ost_set_evidence: ["title"],
  ost_annotate: ["title"],
  ost_edit_node: ["title"],
  ost_link_nodes: ["parent", "child"],
  ost_detach_nodes: ["parent", "child"],
  ost_merge_nodes: ["from", "into"],
  ost_set_instrument: ["test"],
  ost_flag_humans_required: ["test"],
  ost_read_tree: ["title"],
});

/**
 * Tools whose free-text arguments reach `assertWritableContent`, by the argument
 * name each one actually uses.
 *
 * Six differently-named parameters, one rule — which is the shape the guard was
 * written for: "a `note`, an `issue` or a `why` with a newline in it authored a
 * `## Results` section just as surely as `section` did". Getting a name wrong here
 * makes the publication stricter than the tool on one argument and blind on
 * another, so the anti-drift control in the test drives every one of them.
 */
const SCANNED_CONTENT: Readonly<Record<string, readonly string[]>> = Object.freeze({
  ost_append_to_node: ["section"],
  ost_annotate: ["issue"],
  ost_set_status: ["note"],
  ost_set_instrument: ["why"],
  ost_flag_humans_required: ["why"],
  ost_edit_node: ["prose", "why"],
  ost_merge_nodes: ["contribution", "why"],
});

/**
 * The published set, committed in source so it is auditable as a derivation.
 *
 * Order is by how much of this project's own refusal weight each one carries,
 * heaviest first, because a caller reading the list top-down should meet the rule
 * that has cost the most calls before the rule that has cost one.
 */
export const CALL_PRECONDITIONS: readonly CallPrecondition[] = Object.freeze([
  {
    id: "node-exists",
    tools: Object.keys(NODE_ARGUMENTS),
    statement:
      "Every argument naming an existing node must be a title the vault already holds, spelled exactly as `ost_read_tree` lists it.",
    expressibility: "fully",
    enforcedBy: "ost/vault.ts:Vault.has",
    check: (input, facts) => {
      const args = NODE_ARGUMENTS[String(input.__tool ?? "")] ?? [];
      for (const arg of args) {
        const title = str(input, arg);
        if (title === undefined) continue;
        if (!held(facts, title)) return `no such node: ${title}`;
      }
      return null;
    },
  },
  {
    id: "parent-exists",
    tools: ["ost_create_node"],
    statement: "`parent` must name a node the vault already holds.",
    expressibility: "fully",
    enforcedBy: "security/tools.ts:ost_create_node",
    check: (input, facts) => {
      const parent = str(input, "parent");
      if (parent === undefined) return null;
      return held(facts, parent) ? null : `parent "${parent}" does not exist — create it before attaching under it`;
    },
  },
  {
    id: "layer-may-attach",
    tools: ["ost_create_node"],
    statement:
      "The hierarchy is fixed: an Opportunity attaches under the Outcome or an Opportunity, a Solution under an Opportunity, an Assumption under a Solution, an AssumptionTest under an Assumption; an Unknown attaches anywhere.",
    expressibility: "fully",
    enforcedBy: "security/tools.ts:CHILD_HIERARCHY",
    check: (input, facts) => {
      const layer = str(input, "layer");
      const parent = str(input, "parent");
      if (layer === undefined || parent === undefined) return null;
      const allowed = facts.hierarchy[layer];
      if (!allowed) return `cannot create layer "${layer}" (the Outcome is human-set at init and there is exactly one)`;
      const p = node(facts, parent);
      if (!p) return null; // `parent-exists` owns that refusal; do not report it twice.
      return allowed.includes(p.layer)
        ? null
        : `a ${layer} must attach under ${allowed.join(" or ")}, but "${parent}" is a ${p.layer}`;
    },
  },
  {
    id: "evidence-class-declared",
    tools: ["ost_create_node", "ost_set_evidence"],
    statement: `\`evidence\` is required and must be one of: ${BELIEVABILITY_LADDER.map((r) => r.id).join(", ")}.`,
    expressibility: "fully",
    enforcedBy: "knowledge/believability.ts:isRung",
    check: (input, facts) => {
      if (input.evidence === undefined) return null; // required-parameter; the schema refuses it first.
      const declared = str(input, "evidence") ?? "";
      return isRung(declared)
        ? null
        : `"${str(input, "title") ?? ""}" needs an evidence class — one of: ${facts.evidenceClasses.join(", ")}`;
    },
  },
  {
    id: "within-source-standing",
    tools: ["ost_create_node", "ost_set_evidence"],
    statement:
      "A node may not declare a rung above what the actor its `source` names has earned, and no actor kind can pass its ceiling — a report is ranked by the channel it arrived on, never by what it says about itself.",
    expressibility: "fully",
    enforcedBy: "security/tools.ts:assertWithinStanding",
    check: (input, facts) => {
      const declared = str(input, "evidence") ?? "";
      if (!isRung(declared)) return null;
      // The measurement pair is `unearned-measurement-rung`'s question, and asking
      // it here would cap `money` at every kind's ceiling — none of which is
      // `money` — silently deleting the result-backed route to it.
      if (MEASUREMENT_RUNGS.includes(declared)) return null;
      const source = (str(input, "source") ?? "").trim();
      if (!source) return null;
      const key = sourceTrustKey(source, facts.evidenceActors);
      if (!key || key.kind === "unattributed") return null;
      const earned = rungOf(facts.trustLedger, key);
      if (rungRank(declared) >= rungRank(earned)) return null;
      return (
        `"${str(input, "title") ?? ""}" cannot declare '${declared}': it cites ${keyString(key)}, which has earned ` +
        `'${earned}' — and '${facts.trustCeilings[key.kind]}' is the ceiling for a ${key.kind}.`
      );
    },
  },
  {
    id: "instrument-is-a-spec-file",
    tools: ["ost_create_node", "ost_set_instrument"],
    statement:
      "An instrument names exactly one spec file in a form the runner accepts (`npx vitest run <path>.test.ts`); shell punctuation and any other command shape are refused, because a verdict has to come from committed code rather than a string an agent chose.",
    expressibility: "fully",
    enforcedBy: "knowledge/instruments.ts:parseInstrument",
    check: (input) => {
      const raw = str(input, "instrument");
      if (raw === undefined) return null;
      const parsed = parseInstrument(raw);
      return isInstrument(parsed) ? null : parsed.reason;
    },
  },
  {
    id: "threshold-fixes-a-bar",
    tools: ["ost_create_node"],
    statement:
      "`threshold` must fix a bar on one line — a comparator next to the number it commits to ('at least 5 of 20', '>= 2 incidents', 'zero data-loss reports'). A restated sentence is refused.",
    expressibility: "fully",
    enforcedBy: "eval/coverage.ts:parseThresholdField",
    check: (input) => {
      const raw = str(input, "threshold");
      if (raw === undefined) return null;
      const reading = parseThresholdField(raw);
      return reading.bound ? null : `cannot carry that threshold: ${reading.reason}`;
    },
  },
  {
    id: "field-belongs-to-layer",
    tools: ["ost_create_node"],
    statement:
      "`threshold`, `instrument` and `humansRequired` are AssumptionTest-only; `killIf` and `killBy` are Solution-only, and a Solution requires both.",
    expressibility: "fully",
    enforcedBy: "security/tools.ts:ost_create_node",
    check: (input) => {
      const layer = str(input, "layer");
      if (layer === undefined) return null;
      for (const field of ["threshold", "instrument", "humansRequired"]) {
        if (input[field] !== undefined && layer !== "AssumptionTest") {
          return `${field} is only meaningful for an AssumptionTest, not a ${layer}`;
        }
      }
      for (const field of ["killIf", "killBy"]) {
        if (input[field] !== undefined && layer !== "Solution") {
          return `${field} is only meaningful for a Solution, not a ${layer}`;
        }
      }
      return null;
    },
  },
  {
    id: "solution-states-its-kill-criteria",
    tools: ["ost_create_node"],
    statement:
      `A new Solution must carry \`killIf\` (the observation that would end it) and \`killBy\` (a date after today and no more than ${MAX_KILL_HORIZON_DAYS} days out).`,
    expressibility: "fully",
    enforcedBy: "ost/kill-criteria.ts:parseKillCondition,parseKillDate",
    check: (input, facts) => {
      if (str(input, "layer") !== "Solution") return null;
      const killIf = str(input, "killIf");
      const killBy = str(input, "killBy");
      if (killIf === undefined || killBy === undefined) {
        return "a Solution needs both killIf (the observation that would end it) and killBy (the date it gets checked)";
      }
      const condition = parseKillCondition(killIf);
      if (!condition.stated) return `killIf: ${condition.reason}`;
      const date = parseKillDate(killBy, facts.asOf);
      if (!date.dated) return `killBy: ${date.reason}`;
      return null;
    },
  },
  {
    id: "unknown-states-its-format",
    tools: ["ost_create_node"],
    statement:
      "An Unknown needs a non-empty `## Format` section — the shape a valid answer would take. Format is the stopping condition: an unknown that cannot say what an answer looks like cannot know when it is done.",
    expressibility: "fully",
    enforcedBy: "knowledge/unknowns.ts:hasNonEmptySection",
    check: (input) => {
      if (str(input, "layer") !== "Unknown") return null;
      const body = str(input, "body") ?? "";
      return hasNonEmptySection(body, "Format") ? null : "needs a non-empty ## Format section";
    },
  },
  {
    id: "status-is-agent-settable",
    tools: ["ost_create_node", "ost_set_status"],
    statement:
      `A tool call may set ${AGENT_SETTABLE_STATUSES.join(", ")}. 'validated' is a human's alone and is refused on every surface.`,
    expressibility: "fully",
    enforcedBy: "security/tools.ts:VALIDATED_REFUSAL",
    check: (input, facts) => {
      const status = str(input, "status");
      if (status === undefined) return null;
      if (status === "validated") return VALIDATED_REFUSAL;
      return facts.settableStatuses.includes(status) ? null : `"${status}" is not a status this surface can set`;
    },
  },
  {
    id: "outcome-achievement-needs-an-external-signal",
    // Every write on the surface, derived rather than listed: the path this rule
    // has to close is the one nobody remembered to name.
    tools: ALLOWED_TOOL_NAMES.filter((n) => writesTheVault(n) && !n.startsWith("git_")),
    statement:
      "No call may record the root Outcome as achieved. That verdict comes from an external signal the operator declared in ost.config.yaml and a person read on the CLI (`ost-agent outcome-signal`); an agent that could write it would be grading its own homework at the one scale nothing beneath can catch.",
    expressibility: "caveat",
    caveat:
      "the reading that opens this gate is written outside the tool surface entirely, so a snapshot taken before a person records one will say refused for a call that now succeeds.",
    enforcedBy: "ost/outcome-signal.ts:outcomeSelfCertificationRefusal",
    check: (input, facts) => {
      if (!facts.outcomeTitle || facts.outcomeAchieved) return null;
      const args = Object.values(input).filter((v): v is string => typeof v === "string");
      if (!args.some((a) => titlesMatch(a, facts.outcomeTitle!))) return null;
      const status = str(input, "status");
      if (status === "validated" || status === "shipped") {
        return `"${status}" on the Outcome node records it as achieved, and no external signal says it is`;
      }
      for (const arg of args) {
        const claim = claimsOutcomeAchieved(arg);
        if (claim) return `this call writes the verdict as prose — ${JSON.stringify(claim)}`;
      }
      return null;
    },
  },
  {
    id: "no-reserved-heading-in-content",
    tools: Object.keys(SCANNED_CONTENT),
    statement:
      `No free-text argument may contain a reserved heading (${RESERVED_HEADINGS.join(", ")}). Those sections are read by the gates as proof something happened outside the tree, so only the human and instrument paths may write one.`,
    expressibility: "fully",
    enforcedBy: "ost/headings.ts:reservedHeadingIn",
    check: (input) => {
      const args = SCANNED_CONTENT[String(input.__tool ?? "")] ?? [];
      for (const arg of args) {
        const content = str(input, arg);
        if (content === undefined) continue;
        const hit = reservedHeadingIn(content);
        if (hit) return `"${hit}" is a reserved heading`;
      }
      return null;
    },
  },
  {
    id: "sections-accounted-for",
    tools: ["ost_edit_node"],
    statement:
      "A rewrite must account for every `## Section` the node currently stores: reproduce the heading in `prose`, or name it in `dropping`. One in neither is refused by name rather than silently deleted — reserved sections are exempt, being reattached verbatim, and naming one in `dropping` is refused because no tool may remove one.",
    expressibility: "fully",
    enforcedBy: "ost/section-accounting.ts:assertSectionsAccountedFor",
    check: (input, facts) => {
      const title = str(input, "title");
      const prose = str(input, "prose");
      if (title === undefined || prose === undefined) return null;
      const target = node(facts, title);
      if (!target) return null; // `node-exists` owns that refusal; do not report it twice.
      const dropping = Array.isArray(input.dropping) ? input.dropping.filter((d): d is string => typeof d === "string") : [];
      const found = accountForSections(target.body, prose, dropping);
      if (found.reservedDrops.length > 0) return `\`dropping\` names the reserved section ${found.reservedDrops[0]}`;
      if (found.unaccounted.length > 0) {
        return `this rewrite would remove ${found.unaccounted.join(", ")}, which is in neither \`prose\` nor \`dropping\``;
      }
      return null;
    },
  },
  {
    id: "humans-required-takes-no-instrument",
    tools: ["ost_set_instrument"],
    statement:
      "A test flagged humans-required cannot carry an instrument: a person is the measurement, and no command can stand in for them.",
    expressibility: "fully",
    enforcedBy: "ost/lanes.ts:flagHumansRequired",
    check: (input, facts) => {
      const title = str(input, "test");
      if (title === undefined) return null;
      try {
        const file = path.basename(fileNameForTitle(title));
        return facts.humansRequired.has(file)
          ? `refusing to instrument "${title}": it is labelled humans-required, so a person is the measurement`
          : null;
      } catch {
        return null;
      }
    },
  },
  {
    id: "unearned-measurement-rung",
    tools: ["ost_create_node", "ost_set_evidence"],
    statement:
      "'observed' and 'money' assert that something was measured. They need a recorded result on the node or on a test one level beneath it, or provenance that is itself a recording — no byline confers them.",
    expressibility: "fully",
    enforcedBy: "eval/rungs.ts:unearnedRung",
    check: (input, facts) => {
      const declared = str(input, "evidence") ?? "";
      if (!isRung(declared) || !MEASUREMENT_RUNGS.includes(declared)) return null;
      const title = str(input, "title") ?? "";
      const existing = node(facts, title);
      // The draft as it will be written: an existing node keeps its body and
      // links (`ost_set_evidence` changes only the rung), a new one has neither.
      const draft = {
        ...(existing ?? { title, layer: str(input, "layer") ?? "Solution", links: [], tags: [] }),
        title,
        evidence: declared,
        source: str(input, "source") ?? existing?.source,
        body: str(input, "body") ?? existing?.body ?? "",
      } as OstNode;
      const verdict = unearnedRung(draft, facts.nodesByTitle);
      return verdict ? `cannot declare '${verdict.declared}': what it points at supports '${verdict.supported}'` : null;
    },
  },
  {
    id: "title-is-a-filename",
    tools: ["ost_create_node"],
    statement:
      "A title must reduce to a filename inside the vault root — it cannot be empty, punctuation only, or a path that climbs out.",
    expressibility: "fully",
    enforcedBy: "ost/sanitize.ts:fileNameForTitle",
    check: (input) => {
      const title = str(input, "title");
      if (title === undefined) return null;
      try {
        fileNameForTitle(title);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
  },

  // ── the caveat grade: real checks over state this tool does not own ──────────
  {
    id: "product-repo-configured",
    tools: ["ost_read_repo"],
    statement:
      "`product.repos` in ost.config.yaml must name at least one local repository, or there is nothing for the agent to read the product out of.",
    expressibility: "caveat",
    caveat:
      "Configured is not the same as present: a path listed in the config and missing from disk passes this check and is refused by the call.",
    enforcedBy: "product/repo.ts:readProductRepo",
    check: (_input, facts) =>
      facts.productRepos.length > 0
        ? null
        : "no product repos configured — add local repo paths under `product.repos` in ost.config.yaml",
  },
  {
    id: "instrument-spec-resolves",
    tools: ["ost_create_node", "ost_set_instrument"],
    statement:
      "The spec file an instrument names must exist in a configured product repository — a file that does not exist yet fails identically whatever question was written on it, so its red grants no build permit.",
    expressibility: "caveat",
    caveat:
      "The product repository is a separate checkout this tool does not own. A spec present when the snapshot was taken can be gone, or arrive, before the call is made.",
    enforcedBy: "ost/instrument.ts:specResolves,eval/coverage.ts:thresholdKindOf",
    check: (input, facts) => {
      const raw = str(input, "instrument");
      if (raw === undefined || facts.productRepos.length === 0) return null;
      const parsed = parseInstrument(raw);
      if (!isInstrument(parsed)) return null; // `instrument-is-a-spec-file` owns that refusal.
      if (specResolves(facts.productRepos, parsed.target)) return null;
      // The tool waives this for a test carrying a bound threshold, and the
      // waiver is not an edge case: a spec file that does not exist yet is
      // exactly what a red instrument on a buildable test names, so the whole
      // build loop composes this call. Checking the resolution and not the
      // waiver published a refusal the tool does not issue — the
      // confidently-wrong contract this module exists to avoid, in the strict
      // direction, on the one call shape that matters most.
      const test = testUnderInstrument(input, facts);
      if (test && thresholdKindOf(test) === "bound") return null;
      return `${parsed.target} does not exist in the configured product repo, so its red would say nothing about this test`;
    },
  },
  {
    id: "survivor-body-read",
    tools: ["ost_merge_nodes"],
    statement:
      "`into` must name a node whose body this session has already been served by `ost_read_tree({ node })`. `contribution` is defined as what the loser says and the survivor does not, and that is not a judgement anyone can make from a title.",
    expressibility: "caveat",
    caveat:
      "the state is the caller's own reading history, and the caller moves it. A snapshot taken before the read says refused for a call that succeeds a moment later, which is the intended way past this rule rather than a defect in publishing it. Note also what the rule checks: that the body was SERVED, not that it was read — a fetch whose result is discarded satisfies it, deliberately (test/tools/merge-read-guard-bypass.test.ts).",
    enforcedBy: "security/tools.ts:assertSurvivorRead",
    check: (input, facts) => {
      const into = str(input, "into");
      if (into === undefined) return null;
      const key = canonicalTitle(into);
      if (key === null || facts.bodiesRead.has(key)) return null;
      return `this session has not read the body of "${into}" — call ost_read_tree({ node: "${into}" }) first`;
    },
  },
  {
    id: "repo-path-exists",
    tools: ["ost_read_repo"],
    statement: "`path` must exist inside a configured product repository.",
    expressibility: "caveat",
    caveat:
      "The product repository is a separate checkout this tool does not own, and it is the one a build is actively changing. A path listed in the snapshot can be renamed by the branch under construction before the call is made — which is exactly when a pass reads it.",
    enforcedBy: "product/repo.ts:repoSight",
    check: () =>
      // Deliberately no verdict. A snapshot of a working tree the builder is
      // editing is the stale-copy failure the solution node warns about, in its
      // purest form; publishing the RULE and refusing to publish a verdict is
      // the honest half. `repoSight` is what a caller should call instead, and
      // the census counts this class as caveat-grade for that reason.
      null,
  },

  // ── the grade the idea does not reach ───────────────────────────────────────
  {
    id: "write-succeeds-on-disk",
    tools: ["ost_create_node", "ost_append_to_node", "ost_edit_node", "ost_link_nodes", "ost_merge_nodes"],
    statement: "The write itself must succeed.",
    expressibility: "not",
    caveat:
      "A full disk, a permission change, or a concurrent writer is not knowable in advance. `ost_create_node` names the node it created and tells you to link it, which is the best a surface can do about this class.",
    enforcedBy: "ost/vault.ts:Vault.writeNodeFile",
    check: () => null,
  },
  {
    id: "remote-lookup-returns-something",
    tools: ["ost_search_web", "ost_read_web", "ost_ingest_inbox", "ost_deposit"],
    statement: "A remote source must answer, and answer with something usable.",
    expressibility: "not",
    caveat:
      "Whether a host is up, a query has results, or a budget is already spent is state outside this process. No snapshot can carry it.",
    enforcedBy: "web/federated.ts:AllSourcesFailedError",
    check: () => null,
  },
]);

/** The whole publication: the rules, and the snapshot they are evaluated against. */
export interface PublishedPreconditions {
  readonly preconditions: readonly CallPrecondition[];
  readonly facts: PublishedFacts;
}

/** What {@link publishCallPreconditions} needs. Deliberately narrow. */
export interface PublishContext {
  readonly vault: Pick<Vault, "readTreeCensus">;
  readonly dir: string;
  readonly productRepos?: readonly string[];
  /** The day the snapshot describes, so a caller can pin it in a test. */
  readonly asOf?: string;
  /**
   * The session whose read receipts this publication describes, if the caller has
   * one. Absent means "no session" and publishes an empty set — never "assume the
   * reads happened", which would be the confidently-wrong direction.
   */
  readonly readReceipts?: ReadReceipts;
}

/**
 * Take the snapshot.
 *
 * One whole-tree read, and then nothing touches disk again: every check runs
 * against the values collected here. That is the property that makes the
 * publication worth having — a caller can screen a batch of composed calls for
 * the price of one read, which is the round trip per rule the solution node is
 * trying to remove.
 *
 * It is `readTreeCensus`, not `readTree`, and the difference is a correctness
 * one rather than a preference — see {@link PublishedFacts.nodeFiles}. The census
 * is the same walk in both directions: `seenFiles` is what `Vault.has` would find
 * on disk, `nodes` is what every reader will actually return, and the gap between
 * them is published as {@link PublishedFacts.existsButWithheld} rather than
 * resolved in either direction by this module.
 */
export function publishCallPreconditions(ctx: PublishContext): PublishedPreconditions {
  const census = ctx.vault.readTreeCensus();
  // Existence, keyed exactly as `Vault.has` keys it. A file the walk enumerated
  // and no node came back for is still a file the write tools will open.
  const nodeFiles = new Set<string>(census.seenFiles.map((f) => path.basename(f)));
  const nodesByFile = new Map<string, OstNode>();
  const nodesByTitle = new Map<string, OstNode>();
  const humansRequired = new Set<string>();
  for (const n of census.nodes) {
    nodesByTitle.set(n.title, n);
    let file: string;
    try {
      file = path.basename(fileNameForTitle(n.title));
    } catch {
      continue; // A title already on disk that no longer reduces to one is a repair job, not a precondition.
    }
    nodesByFile.set(file, n);
    if (n.tags?.includes(CAUTIOUS_LANE)) humansRequired.add(file);
  }
  const existsButWithheld = new Set<string>([...nodeFiles].filter((f) => !nodesByFile.has(f)));
  const root = rootOutcome(census.nodes);
  return {
    preconditions: CALL_PRECONDITIONS,
    facts: {
      asOf: ctx.asOf ?? new Date().toISOString().slice(0, 10),
      nodeFiles,
      existsButWithheld,
      nodesByFile,
      nodesByTitle,
      hierarchy: CHILD_HIERARCHY,
      reservedHeadings: RESERVED_HEADINGS,
      evidenceClasses: BELIEVABILITY_LADDER.map((r) => r.id),
      settableStatuses: AGENT_SETTABLE_STATUSES,
      instrumentForms: INSTRUMENT_FORMS.map((f) => ({ id: f.id, example: "npx vitest run <path>.test.ts" })),
      trustCeilings: TRUST_CEILINGS,
      trustLedger: readTrustLedger(ctx.dir),
      evidenceActors: evidenceActors(ctx.dir),
      humansRequired,
      // Canonical spellings, because that is the key the receipt book uses and a
      // publication that compared raw titles would refuse a merge on a node the
      // session demonstrably read (`ost/sanitize.ts:titlesMatch`).
      bodiesRead: new Set<string>(
        (ctx.readReceipts?.titles() ?? []).map((t) => canonicalTitle(t)).filter((t): t is string => t !== null),
      ),
      productRepos: ctx.productRepos ?? [],
      maxKillHorizonDays: MAX_KILL_HORIZON_DAYS,
      ...(root ? { outcomeTitle: root.title } : {}),
      outcomeAchieved: outcomeSignalState(ctx.dir, root).achieved,
    },
  };
}

/**
 * Check a call the caller has composed but not made.
 *
 * The tool name travels as `__tool` on the input rather than as a parameter,
 * because the two preconditions that span tools (`node-exists`,
 * `no-reserved-heading-in-content`) need to know which argument names carry a
 * node and which carry scanned content, and a caller screening a batch is
 * handling `{tool, input}` pairs anyway.
 */
export function checkCall(
  published: PublishedPreconditions,
  tool: string,
  input: Record<string, unknown>,
): PreconditionViolation[] {
  const bare = tool.replace(/^mcp__[^_]+__/, "");
  const violations: PreconditionViolation[] = [];
  for (const p of published.preconditions) {
    if (!p.tools.includes(bare)) continue;
    const reason = p.check({ ...input, __tool: bare }, published.facts);
    if (reason !== null) violations.push({ id: p.id, expressibility: p.expressibility, reason });
  }
  return violations;
}

/**
 * The publication as text, for the caller that reads rather than evaluates.
 *
 * Grouped by grade and led by the two grades that do NOT cover the caller, for
 * the reason the refusal-coverage census leads with reach: a manifest that lists
 * what it covers and stops reads as complete, and a caller who believes it is
 * complete is the confidently-wrong reader the solution node warns about.
 */
export function renderCallPreconditions(published: PublishedPreconditions): string {
  const { preconditions: rules, facts } = published;
  const out: string[] = [];
  const counts = {
    fully: rules.filter((r) => r.expressibility === "fully").length,
    caveat: rules.filter((r) => r.expressibility === "caveat").length,
    not: rules.filter((r) => r.expressibility === "not").length,
  };
  out.push(`Call preconditions as of ${facts.asOf} — ${rules.length} published`);
  out.push(
    `  ${counts.fully} checkable against this snapshot, ${counts.caveat} checkable but over state this tool does not own, ` +
      `${counts.not} not knowable before the call`,
  );
  out.push(`  snapshot: ${facts.nodeFiles.size} node file(s), ${facts.productRepos.length} product repo(s)`);
  if (facts.existsButWithheld.size > 0) {
    // Not a refusal, and it must not read as one. The write tools accept these;
    // every reader withholds them. A caller that annotates one has spent a call
    // on something nothing will read, which is a cost worth naming and not a rule.
    out.push(
      `  advisory: ${facts.existsButWithheld.size} file(s) exist and are withheld from every reader ` +
        `(retracted or archived) — the write tools accept them and nothing will read the result`,
    );
  }
  out.push("");
  for (const grade of ["not", "caveat", "fully"] as const) {
    const group = rules.filter((r) => r.expressibility === grade);
    if (group.length === 0) continue;
    const heading =
      grade === "not"
        ? "NOT KNOWABLE BEFORE THE CALL — checking these is not possible, only expecting them is"
        : grade === "caveat"
          ? "CHECKABLE, WITH A CAVEAT — the state is real and this tool does not own it"
          : "CHECKABLE AGAINST THIS SNAPSHOT";
    out.push(`${heading} (${group.length})`);
    for (const r of group) {
      out.push(`  [${r.id}] ${r.tools.join(", ")}`);
      out.push(`    ${r.statement}`);
      if (r.caveat) out.push(`    caveat: ${r.caveat}`);
      out.push(`    enforced by ${r.enforcedBy}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd();
}
