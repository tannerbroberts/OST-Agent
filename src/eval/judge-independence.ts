/**
 * Independence between the agent that proposes and the judge that checks it —
 * as a property of how the two calls are wired, not as a promise in a prompt.
 *
 * The opportunity beneath this is distrust of self-certification: "a system that
 * both improves things and certifies that it improved them is a hall of
 * mirrors." The solution splits the roles — the generating agent only proposes,
 * and a distinct judge checks the claim against the evidence it cites. But a
 * split that exists only in the wording of two prompts is the failure mode, not
 * the fix. The assumption node beneath this solution says so outright: *a judge
 * that agrees with the proposer by construction has changed the org chart and
 * nothing else.*
 *
 * So this module makes independence checkable, and it is checkable because it is
 * defined narrowly. A {@link Review} is one proposal and one judging call, and
 * {@link checkJudgeIndependence} refuses it unless all of the following hold:
 *
 * 1. **The judging call is issued under a distinct identity.** Different session
 *    and different named agent — {@link separatingAxes} reports which axes
 *    actually differ, so "distinct" is a list a reader can check rather than an
 *    adjective. Same model on both sides is *not* refused; it is reported, because
 *    whether a second model is worth buying is exactly the question the assumption
 *    test leaves with a human.
 * 2. **The judge's context contains the candidate and not the proposer's
 *    reasoning trace.** {@link JudgeContext} has no field a trace could travel in,
 *    and {@link buildJudgeCall} assembles the prompt from that context and the
 *    judge's own identity alone. {@link checkJudgeIndependence} then rebuilds the
 *    prompt and refuses one that does not come out identical, which is what an
 *    accumulating loop — the natural way to write this wrong — cannot survive, and
 *    reads the recorded trace back against the assembled prompt afterwards.
 * 3. **A configuration that routes both roles to one session fails.** Two ways,
 *    on purpose: the recorded identities are compared, and the *ambient* session
 *    is read at the moment the call is issued. The second is the one that catches
 *    a real wiring mistake — a judging tool exposed over the MCP surface would run
 *    inside the session that writes the tree, and its `session` field would look
 *    perfectly distinct while its context was the proposer's own.
 * 4. **The judge holds no tool that writes the tree.** Membership is decided by
 *    {@link mutatesVault}, the MCP dispatcher's own read-only/mutating split, so
 *    this cannot drift from what the surface actually commits.
 * 5. **The verdict comes from the judge.** {@link settleReview} refuses a verdict
 *    authored by the proposer, and refuses one whose rater is not the identity the
 *    call was issued under — a label over a different program is not an identity.
 *
 * **What green here does NOT mean**, stated plainly because the solution's own
 * definition of done is explicit about the misreading: it means the independence
 * this solution is named for is real rather than nominal. It does not mean trust
 * rose. That is an operator's judgement about a tree they are shown, five of them
 * on the assumption test's own design, and it stays with a person.
 *
 * And one thing this module reports rather than enforces, because it is the
 * cheapest evidence that the second pass bought anything at all:
 * {@link independenceReport} counts how often the judge's verdict differed from
 * the proposer's own sign-off. A judge that has never once dissented across
 * {@link RUBBER_STAMP_FLOOR} reviews is flagged — structurally independent, and
 * informationally empty.
 */
import { mutatesVault } from "../mcp/server.js";
import { ambientSession } from "../telemetry/usage.js";
import {
  FAITHFULNESS_SCALE,
  type Citation,
  type Exhibit,
  type FaithfulnessRater,
  type FaithfulnessSubject,
} from "./faithfulness.js";

/** The two roles this module keeps apart. */
export type ReviewRole = "proposer" | "judge";

/**
 * Who is making a call, at the granularity independence is decided on.
 *
 * `session` is the load-bearing field: two roles sharing a session are one
 * voice however different their prompts read, because the earlier call's
 * reasoning is still in the context the later one runs in. `agent` and `model`
 * are the other two axes {@link separatingAxes} reports.
 */
export interface Identity {
  readonly role: ReviewRole;
  /** The named identity making the call. */
  readonly agent: string;
  /** The context the call is issued in — a session id a surface minted, never one it accepted. */
  readonly session: string;
  /** What does the reasoning. `"deterministic"` for the mechanical raters in `eval/`. */
  readonly model: string;
  /** Tools this identity holds. A judge holding a vault-writing tool signs off on its own reading. */
  readonly tools: readonly string[];
}

/**
 * The session a pass invoked from a shell runs in: none.
 *
 * A pass the operator started from a terminal has no minted session, because the
 * only surface in this repository that mints one is the MCP server — and every
 * session it mints belongs to a run that holds the tree-writing tools. That is
 * why {@link ambientSession} returning anything at all is enough to refuse a
 * judging call, and `test/eval/judge-independence.test.ts` pins the premise
 * against `MCP_TOOL_NAMES` rather than leaving it as a claim in this comment.
 */
export const SHELL_SESSION = "shell";

/**
 * A judge identity for one of the deterministic raters in `eval/`.
 *
 * `tools` is empty and that is the point: the mechanical judges are pure
 * functions over what they were shown, so there is nothing to strip. A model
 * judge wired in later gets the same treatment through the same check.
 */
export function judgeIdentity(agent: string, session: string = SHELL_SESSION, model = "deterministic"): Identity {
  return { role: "judge", agent, session, model, tools: [] };
}

/**
 * The proposer's own verdict on its own output — the sign-off this solution
 * removes. Kept on the proposal so the judge's verdict can be compared against
 * it afterwards; never shown to the judge, which {@link checkJudgeIndependence}
 * enforces rather than assumes.
 */
export interface SelfReport {
  /** On {@link FAITHFULNESS_SCALE}, so the two verdicts are comparable at all. */
  readonly score: number;
  readonly rationale: string;
}

/** What the proposer produced, and how it got there. */
export interface Proposal {
  /** The node the claim belongs to. */
  readonly node: string;
  /** The claim offered for judgement — the only part of this the judge is shown. */
  readonly candidate: string;
  /** The evidence the claim cites. Shared context: the judge reads it by design. */
  readonly exhibits: readonly Exhibit[];
  /** How the proposer got to the claim. Never shown to the judge; this is the whole property. */
  readonly reasoning: string;
  /** The proposer's own sign-off, when it offered one. */
  readonly selfReport?: SelfReport;
  readonly by: Identity;
}

/**
 * Everything the judge is shown.
 *
 * There is no `reasoning` field and no `by` field, and both absences are
 * deliberate. A trace cannot be passed to a judge through a shape that has
 * nowhere to put it, and a judge that is not told who proposed cannot defer to
 * them.
 */
export interface JudgeContext {
  readonly node: string;
  readonly candidate: string;
  readonly exhibits: readonly Exhibit[];
}

export interface JudgeCall {
  readonly by: Identity;
  readonly context: JudgeContext;
  /** Assembled from {@link context} and {@link by} alone — reproducible, and checked to be. */
  readonly prompt: string;
}

export interface Review {
  readonly proposal: Proposal;
  readonly judge: JudgeCall;
}

export type IndependenceViolationKind =
  /** Judge and proposer are routed to the same session, so the judge's context is the proposer's. */
  | "shared-session"
  /** Judge and proposer are the same named identity — the proposer wearing a second hat. */
  | "shared-agent"
  /** The judging call is being issued inside the proposing session's scope, whatever its recorded identity says. */
  | "judging-inside-proposing-session"
  /** An identity is filed under the wrong role. */
  | "role-mismatch"
  /** The judge holds a tool that writes the tree, so it can act on its own verdict. */
  | "judge-writes-the-tree"
  /** The prompt is not what the recorded context yields — something entered it from outside. */
  | "context-drift"
  /** The judge's context carries the proposer's reasoning trace. */
  | "reasoning-trace-in-context"
  /** The judge's context carries the proposer's own sign-off, which is an anchor rather than evidence. */
  | "self-report-in-context"
  /** The judge was not shown the claim it is meant to be judging. */
  | "candidate-absent-from-context"
  /** No span of the trace is long enough to tell a leak from a coincidence. Unverifiable is not verified. */
  | "uncheckable-trace"
  /** The verdict is the proposer's, so the proposer signed off on its own output. */
  | "verdict-by-proposer"
  /** The verdict names a rater that is not the identity the call was issued under. */
  | "verdict-not-from-the-judge";

export interface IndependenceViolation {
  readonly kind: IndependenceViolationKind;
  /** The node under review, so a violation in a sweep names its subject. */
  readonly node: string;
  readonly detail: string;
}

export class JudgeIndependenceError extends Error {
  constructor(
    message: string,
    readonly violations: readonly IndependenceViolation[] = [],
  ) {
    super(message);
    this.name = "JudgeIndependenceError";
  }
}

/**
 * The fewest significant words a span of the proposer's trace needs before its
 * appearance in the judge's prompt means anything.
 *
 * Higher than the three words `blind-ideation.ts` uses for a whole candidate,
 * because a trace is prose about the same subject as the claim: six words of it
 * appearing verbatim in a context assembled from something else is a leak, and
 * four could be a sentence anyone would write about this evidence. Below the
 * floor the review is not cleared — it is reported `uncheckable-trace`, because
 * a check that cannot see is not a check that passed.
 */
export const MIN_TRACE_WORDS = 6;

/**
 * How many reviews a judge must have settled before "never dissented" is worth
 * reporting. Under this, unanimity is unremarkable; at or over it, a judge that
 * has agreed with every self-report is the org-chart change the assumption node
 * warns about.
 */
export const RUBBER_STAMP_FLOOR = 5;

/** Which axes two identities actually differ on. The list a reader checks instead of the word "distinct". */
export function separatingAxes(a: Identity, b: Identity): ("session" | "agent" | "model")[] {
  const out: ("session" | "agent" | "model")[] = [];
  if (a.session !== b.session) out.push("session");
  if (a.agent !== b.agent) out.push("agent");
  if (a.model !== b.model) out.push("model");
  return out;
}

/**
 * Assemble the judging call.
 *
 * The prompt is a function of the context and the judge's own identity, and
 * there is no parameter through which the proposer's reasoning could enter —
 * the same posture `blind-ideation.ts` takes toward a sibling's candidate. The
 * proposer is not named in it either: a judge told whose work this is has been
 * given something to defer to.
 */
export function buildJudgeCall(proposal: Proposal, judge: Identity): JudgeCall {
  const context: JudgeContext = {
    node: proposal.node,
    candidate: proposal.candidate,
    exhibits: proposal.exhibits.map((e) => ({ id: e.id, text: e.text })),
  };
  return { by: judge, context, prompt: assembleJudgePrompt(context, judge) };
}

/** The prompt text, byte-for-byte reproducible from what {@link Review} records. */
export function assembleJudgePrompt(context: JudgeContext, judge: Identity): string {
  const lines = [
    `You are "${judge.agent}", judging one claim against the evidence it cites.`,
    "You did not write the claim and you are not told who did.",
    "",
    `node: ${context.node}`,
    "",
    "claim:",
    context.candidate.trim(),
    "",
    `evidence (${context.exhibits.length} exhibit(s)):`,
  ];
  for (const exhibit of context.exhibits) {
    lines.push(`[${exhibit.id}]`, exhibit.text.trim(), "");
  }
  lines.push(
    `Score the claim ${FAITHFULNESS_SCALE.min}–${FAITHFULNESS_SCALE.max} on whether it stays inside what the ` +
      "evidence above actually says, and quote the span you read it against.",
  );
  return lines.join("\n");
}

/**
 * Every way this review is not what it claims to be.
 *
 * `ambient` is injected with a default so the ambient check is testable in both
 * directions; in production nothing passes it, and it reads the session the
 * dispatching surface declared around this call.
 */
export function checkJudgeIndependence(
  review: Review,
  ambient: string | undefined = ambientSession(),
): IndependenceViolation[] {
  const { proposal, judge } = review;
  const node = proposal.node;
  const out: IndependenceViolation[] = [];
  const violation = (kind: IndependenceViolationKind, detail: string) => out.push({ kind, node, detail });

  if (proposal.by.role !== "proposer") {
    violation("role-mismatch", `the proposing call is filed under role "${proposal.by.role}"`);
  }
  if (judge.by.role !== "judge") {
    violation("role-mismatch", `the judging call is filed under role "${judge.by.role}"`);
  }

  const axes = separatingAxes(proposal.by, judge.by);
  if (!axes.includes("session")) {
    violation(
      "shared-session",
      `both roles are routed to session "${judge.by.session}", so the judge's context is the context the claim ` +
        "was written in — the trace is present whether or not anyone passed it",
    );
  }
  if (!axes.includes("agent")) {
    violation(
      "shared-agent",
      `both roles are "${judge.by.agent}", so the judge is the proposer under a second heading`,
    );
  }
  if (ambient !== undefined && ambient === proposal.by.session) {
    violation(
      "judging-inside-proposing-session",
      `the call is being issued inside session "${ambient}", which is the session that proposed — a judging tool ` +
        "on a writing surface records a distinct identity and runs in the proposer's context anyway",
    );
  }

  const writes = judge.by.tools.filter((t) => mutatesVault(t));
  if (writes.length > 0) {
    violation(
      "judge-writes-the-tree",
      `the judge holds ${writes.join(", ")}, which write(s) the tree, so it can act on its own verdict`,
    );
  }

  if (judge.prompt !== assembleJudgePrompt(judge.context, judge.by)) {
    violation(
      "context-drift",
      "the prompt is not what the recorded context yields, so something entered it from outside the claim and the " +
        "evidence — the proposer's reasoning is the way that happens",
    );
  }

  if (!normalize(judge.prompt).includes(normalize(proposal.candidate))) {
    violation(
      "candidate-absent-from-context",
      "the judge was not shown the claim, so whatever it returns is a verdict on something else",
    );
  }

  const prompt = normalize(judge.prompt);
  const shared = normalize([judge.context.candidate, ...judge.context.exhibits.map((e) => e.text)].join("\n"));
  const spans = checkableSpans(proposal.reasoning, shared);
  if (spans.length === 0) {
    violation(
      "uncheckable-trace",
      proposal.reasoning.trim()
        ? `no span of the proposer's reasoning is ${MIN_TRACE_WORDS} words of its own, so a match in the judge's ` +
          "context could not be told from a coincidence"
        : "the proposal records no reasoning, so the property that the judge never saw it is vacuous rather than met",
    );
  }
  const leaked = spans.filter((span) => prompt.includes(span));
  if (leaked.length > 0) {
    violation(
      "reasoning-trace-in-context",
      `the judge's context carries ${leaked.length} span(s) of the proposer's reasoning, beginning "${truncate(leaked[0])}"`,
    );
  }

  const signOff = checkableSpans(proposal.selfReport?.rationale ?? "", shared).filter((span) => prompt.includes(span));
  if (signOff.length > 0) {
    violation(
      "self-report-in-context",
      `the judge's context carries the proposer's own sign-off, beginning "${truncate(signOff[0])}"`,
    );
  }

  return out;
}

/** {@link checkJudgeIndependence} as a refusal. */
export function assertJudgeIndependence(review: Review, ambient?: string | undefined): void {
  const violations = checkJudgeIndependence(review, ambient === undefined ? ambientSession() : ambient);
  if (violations.length === 0) return;
  throw new JudgeIndependenceError(
    `the review of "${review.proposal.node}" does not carry the independence it claims:\n` +
      violations.map((v) => `  ${v.kind} — ${v.detail}`).join("\n"),
    violations,
  );
}

/**
 * Refuse to judge from inside a session that also proposes.
 *
 * The half of the session check a pass can run when it holds no proposal at all
 * — `ost-agent faithfulness` scores nodes somebody else wrote and has no trace
 * of how they were written. What it can still say is where it is running, and a
 * scoring pass running inside a minted session is a scoring pass inside the run
 * that writes the tree.
 */
export function assertJudgeOutOfSession(judge: Identity, what: string, ambient: string | undefined = ambientSession()): void {
  if (ambient === undefined) return;
  throw new JudgeIndependenceError(
    `refusing to judge ${what} as "${judge.agent}": this call is inside session "${ambient}", and every session ` +
      "this repository mints belongs to a run that holds the tree-writing tools. A judge that runs in the " +
      "proposer's session is the proposer, whatever identity the call records.",
    [
      {
        kind: "judging-inside-proposing-session",
        node: what,
        detail: `ambient session "${ambient}"`,
      },
    ],
  );
}

/* ------------------------------------------------------------------ *
 * The verdict.
 * ------------------------------------------------------------------ */

export interface Verdict {
  /** On {@link FAITHFULNESS_SCALE}, so it is comparable to the proposer's own sign-off. */
  readonly score: number;
  /** The identity that produced it. Checked against the call, never believed. */
  readonly by: Identity;
  /** The span the judge read, when the rater cites one. */
  readonly citation?: Citation;
}

export interface SettledReview {
  readonly node: string;
  readonly verdict: Verdict;
  readonly judge: Identity;
  readonly proposer: Identity;
  /** Axes the two identities differ on — `model` missing means independence is structural but same-brained. */
  readonly axes: readonly ("session" | "agent" | "model")[];
  /** The proposer's own score, when it offered one. */
  readonly selfScore?: number;
  /** `true` when the judge landed on the proposer's own score; absent when there was nothing to compare. */
  readonly agreedWithProposer?: boolean;
}

/**
 * Record the verdict, refusing the two ways the proposer ends up signing off on
 * its own output: authoring the verdict, and authoring the program that did
 * under the judge's name.
 */
export function settleReview(review: Review, verdict: Verdict): SettledReview {
  assertJudgeIndependence(review);
  const { proposal, judge } = review;
  const violations: IndependenceViolation[] = [];
  if (separatingAxes(verdict.by, proposal.by).length === 0) {
    violations.push({
      kind: "verdict-by-proposer",
      node: proposal.node,
      detail: `the verdict is signed "${verdict.by.agent}", which is the identity that proposed`,
    });
  }
  if (separatingAxes(verdict.by, judge.by).length > 0) {
    violations.push({
      kind: "verdict-not-from-the-judge",
      node: proposal.node,
      detail:
        `the verdict is signed "${verdict.by.agent}" but the call was issued as "${judge.by.agent}" — an identity ` +
        "is who ran, not a label put on the result afterwards",
    });
  }
  const { min, max } = FAITHFULNESS_SCALE;
  if (!Number.isInteger(verdict.score) || verdict.score < min || verdict.score > max) {
    throw new JudgeIndependenceError(
      `refusing a verdict of ${verdict.score} on "${proposal.node}": the scale is ${min}–${max} integers, and a ` +
        "verdict off it cannot be compared to the proposer's own score.",
    );
  }
  if (violations.length > 0) {
    throw new JudgeIndependenceError(
      `the verdict on "${proposal.node}" is not the judge's:\n` +
        violations.map((v) => `  ${v.kind} — ${v.detail}`).join("\n"),
      violations,
    );
  }
  const selfScore = proposal.selfReport?.score;
  return {
    node: proposal.node,
    verdict,
    judge: judge.by,
    proposer: proposal.by,
    axes: separatingAxes(proposal.by, judge.by),
    ...(selfScore === undefined ? {} : { selfScore, agreedWithProposer: selfScore === verdict.score }),
  };
}

/**
 * The bridge to the judging seam this repository already has.
 *
 * `faithfulness.ts` defines a rater that sees one subject — a claim and the
 * exhibits — and nothing else. That subject is what the judge's context becomes
 * here, so the existing raters plug in as independent judges without changing a
 * line of them, and the guard runs before the rater does rather than after.
 */
export function subjectOf(call: JudgeCall): FaithfulnessSubject {
  return { node: call.context.node, claim: call.context.candidate, exhibits: call.context.exhibits };
}

/**
 * Judge one proposal with an injected rater, under the review's own guard.
 *
 * The rater's name must be the judging identity's agent: a rater called
 * something else running under this identity's name is the "different judge"
 * being a relabelling of the same program, which is the version of this solution
 * that would fool exactly the reader it was built for.
 */
export function rateIndependently(review: Review, rater: FaithfulnessRater): SettledReview {
  assertJudgeIndependence(review);
  if (rater.name !== review.judge.by.agent) {
    throw new JudgeIndependenceError(
      `the judging call on "${review.proposal.node}" is issued as "${review.judge.by.agent}" but the rater is ` +
        `"${rater.name}": an identity is which program ran, not the name on the call.`,
      [
        {
          kind: "verdict-not-from-the-judge",
          node: review.proposal.node,
          detail: `rater "${rater.name}" under identity "${review.judge.by.agent}"`,
        },
      ],
    );
  }
  const scored = rater.rate(subjectOf(review.judge));
  return settleReview(review, { score: scored.score, by: review.judge.by, citation: scored.citation });
}

/* ------------------------------------------------------------------ *
 * What the second pass bought.
 * ------------------------------------------------------------------ */

export interface IndependenceReport {
  readonly judge: string;
  readonly reviews: number;
  /** Reviews where the proposer offered a score of its own, so a comparison exists at all. */
  readonly comparable: number;
  readonly affirmed: number;
  readonly dissented: number;
  /** Nodes where the judge landed somewhere other than the proposer's own score. */
  readonly dissentedOn: readonly string[];
  /** Nodes judged by the same model that proposed — independent, and same-brained. */
  readonly sameModel: readonly string[];
  /** Structurally independent and informationally empty: never once dissented, over enough reviews to say so. */
  readonly rubberStamp: boolean;
}

/**
 * What the judge actually disagreed with.
 *
 * The count is not a quality figure and must not be read as one — a judge that
 * dissents constantly may simply be wrong. It answers the narrower question the
 * assumption node raises: whether a second pass that agrees with the first by
 * construction has changed anything except the org chart.
 */
export function independenceReport(settled: readonly SettledReview[]): IndependenceReport {
  const comparable = settled.filter((s) => s.agreedWithProposer !== undefined);
  const dissentedOn = comparable.filter((s) => s.agreedWithProposer === false).map((s) => s.node);
  return {
    judge: settled[0]?.judge.agent ?? "(none)",
    reviews: settled.length,
    comparable: comparable.length,
    affirmed: comparable.length - dissentedOn.length,
    dissented: dissentedOn.length,
    dissentedOn,
    sameModel: settled.filter((s) => !s.axes.includes("model")).map((s) => s.node),
    rubberStamp: comparable.length >= RUBBER_STAMP_FLOOR && dissentedOn.length === 0,
  };
}

/** The report a person reads. The caveats are printed, not filed under a flag nobody looks at. */
export function renderIndependence(report: IndependenceReport): string {
  if (report.reviews === 0) return "judge-independence: no reviews settled, so there is nothing to report.";
  const lines = [
    `judge-independence: "${report.judge}" settled ${report.reviews} review(s); ${report.comparable} carried a ` +
      "proposer's own score to compare against.",
  ];
  if (report.comparable > 0) {
    lines.push(`  affirmed ${report.affirmed}, dissented ${report.dissented}`);
    if (report.dissented > 0) lines.push(`  differed on: ${report.dissentedOn.join("; ")}`);
  }
  if (report.rubberStamp) {
    lines.push(
      `  RUBBER STAMP — agreed with the proposer on all ${report.comparable} review(s). The roles are separate and ` +
        "the second pass has added nothing a reader could act on.",
    );
  }
  if (report.sameModel.length > 0) {
    lines.push(
      `  same model as the proposer on ${report.sameModel.length} review(s), so independence there is a matter of ` +
        "context and tools rather than of a second judgement",
    );
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Text.
 * ------------------------------------------------------------------ */

/** Case, punctuation and whitespace folded, so a leak that survived a reformat is still a leak. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The spans of `text` long enough to mean something if they turn up in the
 * judge's context, minus anything the judge sees by design.
 *
 * Every {@link MIN_TRACE_WORDS}-word window rather than every sentence, because
 * a leak is rarely a whole sentence: prose gets summarised, re-wrapped and half
 * quoted on the way into a prompt, and a checker that only recognised the
 * original sentence would clear all three. A window already inside the shared
 * context is dropped rather than reported — a trace that quotes the evidence is
 * not a leak, since the evidence is in every judging prompt on purpose.
 */
function checkableSpans(text: string, shared: string): string[] {
  const words = normalize(text).split(" ").filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i + MIN_TRACE_WORDS <= words.length; i++) {
    const span = words.slice(i, i + MIN_TRACE_WORDS).join(" ");
    if (!shared.includes(span)) out.push(span);
  }
  return out;
}

function truncate(text: string, at = 60): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= at ? flat : `${flat.slice(0, at)}…`;
}
