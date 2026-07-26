/**
 * Lane triage over a tree — reading, reporting, and classifying assumption tests
 * by the human minutes they actually cost.
 *
 * The vocabulary and its fail-closed rule live in `knowledge/lanes.ts`. This is
 * the part that touches the tree: which tests sit in which lane, which of them a
 * pass may run itself, and the attributed, append-only way a lane gets set.
 */
import fs from "node:fs";
import path from "node:path";
import { CAUTIOUS_LANE, computeMayRun, isLane, LANES, type LaneId } from "../knowledge/lanes.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

export interface LaneTriage {
  /** Test titles per lane, in tree order. */
  byLane: Record<LaneId, string[]>;
  /** Tests carrying no lane at all — the triage backlog. */
  unlabelled: string[];
  totals: { tests: number; labelled: number; unlabelled: number };
  /** compute-only tests with no result yet: what a pass may go run right now. */
  runnable: string[];
  /**
   * Unclassified tests that state a lane in their own prose. Still unlabelled,
   * still not runnable — but a human already did the thinking, so this is the
   * cheapest end of the triage backlog to work.
   */
  proseDeclared: ProseLaneEntry[];
  /**
   * Tests whose frontmatter lane and whose own prose name *different* lanes.
   * A human decides which is stale; nothing here resolves it.
   */
  laneConflicts: LaneConflict[];
  /**
   * Tests whose prose declaration names more than one lane, so it cannot be
   * read as an answer at all. Kept visible, never offered as a classification.
   */
  proseAmbiguous: ProseAmbiguityEntry[];
}

/** One entry of {@link LaneTriage.proseDeclared}. */
export interface ProseLaneEntry {
  test: string;
  lane: LaneId;
  quote: string;
}

/** One entry of {@link LaneTriage.laneConflicts}. */
export interface LaneConflict {
  test: string;
  /** What the test's own prose says. */
  declared: LaneId;
  /** What the frontmatter label says — the one the tools actually obey. */
  labelled: LaneId;
  quote: string;
}

/** One entry of {@link LaneTriage.proseAmbiguous}. */
export interface ProseAmbiguityEntry {
  test: string;
  quote: string;
  names: LaneId[];
}

function assumptionTests(tree: readonly OstNode[]): OstNode[] {
  return tree.filter((n) => n.layer === "AssumptionTest");
}

/**
 * Tests an unattended pass is permitted to run itself: labelled `compute-only`
 * and not already carrying a result. Everything else — including every
 * unlabelled test — is excluded, by {@link computeMayRun}'s fail-closed rule.
 */
export function runnableByCompute(tree: readonly OstNode[]): OstNode[] {
  return assumptionTests(tree).filter((t) => computeMayRun(t.lane) && !hasRecordedResult(t));
}

/** Group the tree's assumption tests by lane. */
export function triageLanes(tree: readonly OstNode[]): LaneTriage {
  const tests = assumptionTests(tree);
  const byLane = Object.fromEntries(LANES.map((l) => [l.id, [] as string[]])) as Record<LaneId, string[]>;
  const unlabelled: string[] = [];

  for (const t of tests) {
    if (t.lane && isLane(t.lane)) byLane[t.lane].push(t.title);
    else unlabelled.push(t.title);
  }

  const proseDeclared: ProseLaneEntry[] = [];
  const proseAmbiguous: ProseAmbiguityEntry[] = [];
  for (const t of tests) {
    const declared = proseDeclaredLane(t);
    if (declared) proseDeclared.push({ test: t.title, lane: declared.lane, quote: declared.quote });
    const ambiguous = proseLaneAmbiguity(t);
    if (ambiguous) proseAmbiguous.push({ test: t.title, quote: ambiguous.quote, names: ambiguous.names });
  }

  return {
    byLane,
    unlabelled,
    totals: { tests: tests.length, labelled: tests.length - unlabelled.length, unlabelled: unlabelled.length },
    runnable: runnableByCompute(tree).map((t) => t.title),
    proseDeclared,
    laneConflicts: laneConflicts(tree),
    proseAmbiguous,
  };
}

/**
 * Tests that answer the run-me-unattended question twice, differently: a
 * `lane:` in the frontmatter and a different one declared in the prose.
 *
 * Both directions are reported, because both are a tree contradicting itself,
 * but they do not cost the same. Labelled `compute-only` over prose saying
 * `humans-required` is the expensive one — the label is what
 * {@link runnableByCompute} obeys, so an unattended pass will go and run a test
 * whose own text says a person is part of the measurement. The reverse merely
 * leaves a cheap test sitting in the backlog.
 *
 * Reported, never resolved. Picking a side is exactly the permissive call that
 * {@link flagHumansRequired}'s asymmetry exists to keep with a human.
 */
export function laneConflicts(tree: readonly OstNode[]): LaneConflict[] {
  const out: LaneConflict[] = [];
  for (const t of assumptionTests(tree)) {
    const d = proseDeclaredLane(t, { includeConflicts: true });
    if (d?.conflictsWith) {
      out.push({ test: t.title, declared: d.lane, labelled: d.conflictsWith, quote: d.quote });
    }
  }
  return out;
}

/**
 * A lane a test states in its own prose — `**Lane: compute-only.**` — where the
 * tool reads only frontmatter.
 *
 * This exists because the gap is real and silent. A test can declare its lane in
 * the sentence a human reads and carry nothing in the field the tool reads, and
 * every tool in this codebase then correctly treats it as unclassified: it is
 * excluded from `runnable`, `lanes` counts it in the backlog, and an unattended
 * pass refuses to run it. Nothing is broken — but the operator is told to go
 * classify a test that already says what it is, and a capability that shipped
 * to make cheap tests runnable sits unused.
 *
 * **Reporting this is not applying it, and the distinction is the safety
 * argument.** A prose declaration is unverified text; promoting it to a label
 * would let a node authorize its own execution by asserting a lane in a
 * sentence, which is exactly the self-authorization {@link flagHumansRequired}
 * is built to prevent. So this only ever points, and `runnableByCompute` never
 * consults it — see the test that pins that invariant. Making the label real
 * stays a human's `ost-agent lane … --set`.
 *
 * Silence means "no declaration found", never "no lane applies".
 */
export function proseDeclaredLane(
  test: OstNode,
  opts: { includeConflicts?: boolean } = {},
): ProseLaneDeclaration | undefined {
  const found = readProseLane(test);
  if (!found || found.names.length !== 1) return undefined;

  const declared = found.names[0];

  if (test.lane) {
    // Already classified and the prose agrees: nothing to reconcile, and
    // repeating it would only add noise to a triage list.
    if (!opts.includeConflicts || test.lane === declared) return undefined;
    return { lane: declared, quote: found.fragment, conflictsWith: test.lane };
  }

  return { lane: declared, quote: found.fragment };
}

/**
 * A prose declaration that names more than one lane — reported so it stays
 * visible, and deliberately never reported as a *declaration*.
 *
 * This exists because of a real one. In the vault this product maintains for
 * itself, a test reads `**Lane: compute-only for the census, humans-required
 * for the fixing.**` The reader took the first match and printed a paste-ready
 * `lane … --set compute-only`, quoting the test's own words as the reason —
 * that is, it invited a human to classify the human half of a split test into
 * compute's reach, and the invitation looked authoritative because it was a
 * quote. Reading half a sentence and reporting it as the whole is the one
 * failure mode a reader whose output authorizes execution cannot have.
 *
 * So a sentence that names two lanes yields no declaration, only this.
 */
export function proseLaneAmbiguity(test: OstNode): ProseLaneAmbiguity | undefined {
  const found = readProseLane(test);
  if (!found || found.names.length < 2) return undefined;
  return { quote: found.sentence, names: found.names };
}

/** What {@link proseLaneAmbiguity} found: a declaration that says two things. */
export interface ProseLaneAmbiguity {
  /**
   * The whole declaring sentence — deliberately not the `lane: …` fragment. The
   * fragment is what made this misread in the first place; a reader deciding
   * what the node meant needs the qualification that follows it.
   */
  quote: string;
  /** Every lane the sentence names, in the order it names them. */
  names: LaneId[];
}

/**
 * The shared read: find the declaring sentence in the node's *own* prose and
 * report every lane it names.
 *
 * Two exclusions, each one a false positive that would otherwise be certain
 * rather than hypothetical:
 *
 * 1. **Sections are skipped.** `## History` carries the audit trail that
 *    {@link Vault.setLane} itself writes — `lane: <prev> → <next>` — so a
 *    reclassified test would report its own paper trail as prose declaring the
 *    lane it was moved *off* of, and every conflict check would find the tool
 *    arguing with its own record. `## Issues` carries hygiene annotations,
 *    which discuss lanes for the same reason. Neither is the node speaking; both
 *    are commentary about it, in the past tense.
 * 2. **The scan stops at the sentence.** A later sentence explaining why the
 *    other lane does not apply is ordinary prose and must not read as a second
 *    claim.
 */
function readProseLane(
  test: OstNode,
): { fragment: string; sentence: string; names: LaneId[] } | undefined {
  if (test.layer !== "AssumptionTest") return undefined;

  const own = ownProse(test.body ?? "");
  const hit = PROSE_LANE_DECLARATION.exec(own);
  if (!hit) return undefined;

  const sentence = declaringSentence(own, hit.index);
  const names: LaneId[] = [];
  for (const m of sentence.matchAll(LANE_MENTION)) {
    const id = m[0].toLowerCase();
    // An unrecognised lane name is dropped rather than reported, on the same
    // rule the frontmatter parser uses: a label nobody defined is not a label.
    if (isLane(id) && !names.includes(id)) names.push(id);
  }
  if (names.length === 0) return undefined;

  return { fragment: hit[0].replace(/\*+/g, "").trim(), sentence, names };
}

/** The node's own statement: everything above the first `## ` section heading. */
function ownProse(body: string): string {
  const section = /^##\s+/m.exec(body);
  return section ? body.slice(0, section.index) : body;
}

/**
 * The sentence containing the declaration at `from`, trimmed of the emphasis
 * markers Obsidian prose wraps it in. Ends at the first `.`/`!`/`?` that is
 * followed by whitespace, a closing `**`, or the end of the text.
 */
function declaringSentence(text: string, from: number): string {
  const rest = text.slice(from);
  const end = /[.!?](\*{1,2})?(\s|$)/.exec(rest);
  const sentence = end ? rest.slice(0, end.index + 1) : rest;
  return sentence.replace(/\*+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Deliberately narrow: the word `lane`, a colon, then the lane id. It matches a
 * *declaration* and not a mention, so prose that merely discusses the
 * compute-only lane does not read as a claim to be in it.
 */
const PROSE_LANE_DECLARATION = /\blane\s*:\s*[a-z][a-z-]*/i;

/** Any lane id named anywhere in the declaring sentence — the ambiguity check. */
const LANE_MENTION = /\b[a-z][a-z-]*\b/gi;

/** What {@link proseDeclaredLane} found, quoted so the call can be checked. */
export interface ProseLaneDeclaration {
  lane: LaneId;
  /** The declaration as written, minus surrounding emphasis. */
  quote: string;
  /** Set only when the frontmatter carries a *different* lane — a human call. */
  conflictsWith?: LaneId;
}

/**
 * Phrases that mean a person outside the building is part of the measurement.
 * Deliberately narrow and literal: this list exists to raise a hand, and every
 * hit is quoted back in the reason so the call can be checked in one glance.
 */
const PEOPLE_MARKERS: readonly RegExp[] = [
  /\binterviews?\b/i,
  /\binterviewing\b/i,
  /\brecruit(?:ing|ment)?\b/i,
  /\bstrangers?\b/i,
  /\bparticipants?\b/i,
  /\bcohort\b/i,
  /\bsurvey(?:s|ed)?\b/i,
  /\bpre-order\b/i,
  /\bwillingness to pay\b/i,
  /\bconsent\b/i,
  /\busability\b/i,
  /\bdesign partners?\b/i,
  /\breal (?:players?|users?|operators?|teams?|customers?)\b/i,
  /\boutside (?:teams?|operators?|people)\b/i,
];

export interface LaneSuggestion {
  lane: LaneId;
  /** Why, quoting the phrase that triggered it, so a human can check the call. */
  why: string;
}

/**
 * A mechanical triage aid that can only ever point at {@link CAUTIOUS_LANE}.
 *
 * It never returns a lane compute is allowed to run, and its silence means
 * "no marker found" — never "safe to automate". Both halves matter: a helper
 * that could talk a pass into running a test would defeat the point of having
 * lanes at all, so the permissive call is left to a person by construction.
 */
export function suggestCaution(test: OstNode): LaneSuggestion | undefined {
  if (test.layer !== "AssumptionTest") return undefined;
  const haystack = `${test.title}\n${test.body ?? ""}`;
  for (const marker of PEOPLE_MARKERS) {
    const hit = haystack.match(marker);
    if (hit) {
      return {
        lane: CAUTIOUS_LANE,
        why: `names an outside person: "${hit[0]}"`,
      };
    }
  }
  return undefined;
}

/**
 * The tests a pass would flag, listed before it flags anything: unlabelled
 * assumption tests whose own text names a person outside the building.
 *
 * Deliberately skips anything already carrying a lane, permissive ones
 * included. A human's `compute-only` call is a judgement this must never
 * quietly reverse, and re-flagging an already-cautious test only adds noise to
 * its History.
 */
export function cautionBacklog(tree: readonly OstNode[]): CautionEntry[] {
  const out: CautionEntry[] = [];
  for (const t of assumptionTests(tree)) {
    if (t.lane) continue;
    const hint = suggestCaution(t);
    if (hint) out.push({ test: t.title, why: hint.why });
  }
  return out;
}

/** One entry of {@link cautionBacklog}: which test, and the phrase that flagged it. */
export interface CautionEntry {
  test: string;
  why: string;
}

export interface FlagFiling {
  /** Title of the AssumptionTest to put out of compute's reach. */
  test: string;
  /** Who made the call — an unattributed label cannot be audited. */
  by: string;
  /** Why, ideally quoting the phrase that prompted it. */
  why: string;
}

/**
 * Put one assumption test beyond an unattended pass's reach — the restrictive
 * half of lane classification, and the only half an agent is given.
 *
 * There is no lane parameter, and that absence is the entire safety argument.
 * Labelling a test `compute-only` is what decides that a pass may go run it on
 * its own authority; an agent able to make that call can authorize itself, and
 * every mechanism in the lane design becomes decoration. So the permissive call
 * stays a human's, on the CLI (`ost-agent lane … --set`), while the call that
 * only ever *removes* work from compute's reach is free — it is
 * {@link suggestCaution}'s advice, promoted to a capability.
 *
 * Erring this way costs an operator some time. Erring the other way costs the
 * tree its credibility, which is the one failure this product cannot survive.
 */
export function flagHumansRequired(vaultDir: string, filing: FlagFiling): string {
  return setLane(vaultDir, { ...filing, lane: CAUTIOUS_LANE });
}

export interface LaneFiling {
  /** Title of the AssumptionTest being classified. */
  test: string;
  lane: LaneId;
  /** Who made the call — an unattributed label cannot be audited. */
  by: string;
  /** Why this lane, in the classifier's words. */
  why: string;
}

/**
 * Classify a test into a lane, recording the call in History. Attribution and a
 * reason are both required: the lane decides whether an unattended agent may run
 * the test, so a label nobody can trace back is worse than no label at all.
 */
export function setLane(vaultDir: string, filing: LaneFiling): string {
  if (!isLane(filing.lane)) {
    throw new Error(`"${filing.lane}" is not a lane — use one of: ${LANES.map((l) => l.id).join(", ")}`);
  }
  const by = (filing.by ?? "").trim();
  if (!by) {
    throw new Error("a lane classification needs attribution — say who made the call");
  }
  const why = (filing.why ?? "").trim();
  if (!why) {
    throw new Error("a lane classification needs a why — an unauditable label is worse than no label");
  }

  const vault = new Vault(path.resolve(vaultDir));
  const node = vault.read(filing.test);
  if (node.layer !== "AssumptionTest") {
    throw new Error(`"${filing.test}" is a ${node.layer} — lanes classify an AssumptionTest`);
  }

  return vault.setLane(filing.test, filing.lane, `by ${by} — ${why}`);
}

/** True when the directory looks like a vault (used for friendlier CLI errors). */
export function isVaultDir(dir: string): boolean {
  return fs.existsSync(path.join(path.resolve(dir), "ost.config.yaml"));
}
