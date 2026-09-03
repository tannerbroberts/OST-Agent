/**
 * The sweep, split by who may act on it — and the fourth pile, which is the
 * whole reason to take the split.
 *
 * `ost_next_work` answers one question for every reader: what is outstanding.
 * But the readers are not one reader. An unattended pass holds sixteen MCP
 * tools; an attended session holds those plus a person who can run
 * `ost-agent result`; some work needs a person and nothing else will do. Served
 * as one list, all of it waits on the scarcest actor in it, and an unattended
 * loop reads a list it can never finish as its own definition of done. That is
 * the failure this module is for: not that the work is hidden, but that the
 * asker cannot tell which of it is addressed to them.
 *
 * **What the split is derived from, and what it is never allowed to invent.**
 * Every actor here is read off something the tree or the surface already
 * records — a lane label ({@link ../knowledge/lanes.ts}), a refusal a write
 * boundary actually makes, a verb that exists on exactly one surface. Nothing
 * asks a model which pile an item belongs in, and nothing is keyed off a field
 * an agent can set to move its own work. A partition that could be argued with
 * would be a second, softer copy of the lane vocabulary, and this codebase has
 * already paid for two readings of "who may run this" that could disagree.
 *
 * **The fourth bucket is the finding, and it was predicted.** The solution node
 * this implements guessed that a partition would leave items no actor may act
 * on at all, and named the case: an evidence record whose reading has already
 * been taken. Mapped-ness has exactly one derivation — some node names the id
 * in frontmatter `source` — and `source` is settable only at creation. So an
 * item a pass read, understood, and recorded on the node it corroborates is
 * cited in that node's PROSE and in no node's `source`, and stays outstanding
 * forever: the honest act does not clear it, and the act that would clear it is
 * writing a duplicate node. {@link partitionSweepByActor} reports those as
 * `nobody`, each with the reason, which is diagnosis rather than treatment and
 * is said as much in the node.
 *
 * **Two accountings ride along, because a partition is a place counts go to
 * disappear.** The sweep's lists are capped and its aged-out evidence is
 * reported as a bare count, so a partition over the response sees fewer items
 * than the sweep counted. Those are named in {@link ActorPartition.outOfReach}
 * and make {@link doneForActor} refuse rather than answer — a per-actor `done`
 * computed over a window would be exactly the amnesty a cap is forbidden from
 * being. The sweep's disclosure lists (retired, disposed, suppressed) are not
 * work and are declared in {@link ActorPartition.notPartitioned} rather than
 * silently dropped.
 *
 * **Not on the sweep's hot path, deliberately.** This walks node bodies looking
 * for evidence-id citations, which is the same shape of work
 * {@link ../eval/buildable.ts#confirmPermit} keeps out of `computeNextWork` and
 * for the same reason: `ost_next_work` runs under a wall-clock budget
 * (`test/mcp/wall-clock-budget.test.ts`) and a caller that wants the split asks
 * for it.
 */
import type { OstNode } from "./node.js";
import type { AssumptionWork, NextWork } from "../mcp/next-work.js";
import type { SweepSubject } from "./sweep.js";
import { CAUTIOUS_LANE } from "../knowledge/lanes.js";
import { resolveTestsUnderSolution } from "./legacy-fallback.js";
import { quotesEvidenceId } from "./stranded.js";

/**
 * Who may act on one outstanding item.
 *
 * `unattended` — a pass with the MCP grant and nobody watching can clear it
 * with a tool it already holds.
 *
 * `attended` — the work is compute's but the clearing verb is CLI-only, so a
 * person has to be at the keyboard. Recording a result is the whole of this
 * category and it is deliberate (B1/B2): an agent that runs and files its own
 * test is the one failure this product cannot survive.
 *
 * `human-only` — a person is the measurement, or holds the credential, or is
 * the only one who may make the permissive call. No amount of compute
 * substitutes.
 *
 * `nobody` — no verb on any surface clears it. This is a finding, not a lane,
 * and every item in it carries the reason.
 */
export type SweepActor = "unattended" | "attended" | "human-only" | "nobody";

/** The four, in the order a report prints them. */
export const SWEEP_ACTORS = ["unattended", "attended", "human-only", "nobody"] as const;

/** One outstanding item, with the actor who may act on it and why that one. */
export interface PartitionedItem {
  /** The `NextWork` field it came from — dotted for the lane queues, as `truncated` names them. */
  readonly list: string;
  /** What the sweep named: a node title, an evidence id, a hygiene subject. */
  readonly item: string;
  readonly actor: SweepActor;
  /**
   * The verb that clears it and the surface it lives on. `null` iff `actor` is
   * `nobody` — that is what `nobody` means, and the two fields are kept in step
   * by construction so a reader never has to check both.
   */
  readonly clearedBy: string | null;
  /** Why this actor and not a cheaper one. Never empty, for any actor. */
  readonly reason: string;
}

/** A list the sweep counted but did not hand over, so the partition cannot see it. */
export interface OutOfReach {
  /** The `NextWork` field, or `agedOutEvidence` for the standing backlog line. */
  readonly list: string;
  readonly count: number;
  readonly why: string;
}

/** A list deliberately outside the subject, because it is disclosure rather than work. */
export interface NotPartitioned {
  readonly list: string;
  readonly count: number;
  readonly why: string;
}

export interface ActorPartition {
  /** Every classified item, in sweep order. The denominator. */
  readonly items: readonly PartitionedItem[];
  readonly unattended: readonly PartitionedItem[];
  readonly attended: readonly PartitionedItem[];
  readonly humanOnly: readonly PartitionedItem[];
  /** The fourth bucket. Empty, or every entry naming why no actor reaches it. */
  readonly nobody: readonly PartitionedItem[];
  /**
   * Rows the sweep counted (`offered`) against rows this partition classified
   * (`read`).
   *
   * The pair is {@link SweepSubject}'s, but `classifySubject` is deliberately
   * NOT applied to it. There, `offered === 0` means nobody looked; here it means
   * the tree is maintained and there is nothing outstanding to split — a real
   * and common state that must not be reported as blindness. The distinction
   * this partition needs is the other one, `read < offered`, and that is
   * {@link ActorPartition.reach}.
   */
  readonly subject: SweepSubject;
  /** `partial` iff the sweep counted rows it did not hand over. See {@link outOfReach}. */
  readonly reach: "complete" | "partial";
  /** Each list that was short, and by how much. Empty iff `reach` is `complete`. */
  readonly outOfReach: readonly OutOfReach[];
  /** The sweep's disclosure lists, named rather than dropped. */
  readonly notPartitioned: readonly NotPartitioned[];
}

/**
 * The `NextWork` fields that carry outstanding items, each expanded to the row
 * key the partition reports it under.
 *
 * Exported so a parity test can hold this module to the sweep's shape: a field
 * added to `NextWork` and classified nowhere is work that silently belongs to
 * no actor, which is the defect one level up from the one this file closes.
 */
export const PARTITIONED_LISTS: readonly string[] = Object.freeze([
  "unmappedEvidence",
  "underservedOpportunities",
  "solutionsMissingAssumptions",
  "solutionsMissingInstruments",
  "solutionsAwaitingObservation",
  "assumptionWork",
  "outstandingAsks",
  "hygieneIssues",
  "openUnknowns",
  "quarantined",
]);

/** `NextWork` fields that report a count the partition cannot resolve into rows. */
export const OUT_OF_REACH_LISTS: readonly string[] = Object.freeze(["agedOutEvidence", "truncated"]);

/** `NextWork` fields that are disclosure rather than outstanding work. */
export const NOT_PARTITIONED_LISTS: readonly string[] = Object.freeze([
  "emptyDescents",
  "retiredFromDuplicateScan",
  "withheldByDisposition",
  "suppressedByCondition",
]);

/** `NextWork` fields that are not lists at all — a verdict, a framing, a scope. */
export const NON_LIST_FIELDS: readonly string[] = Object.freeze(["framing", "done", "summary", "scope"]);

/**
 * The lists `NextWork.done` is computed over, so a per-actor `done` is the same
 * question narrowed rather than a second, looser one.
 *
 * Read from the sweep's own definition (`computeNextWork`): unmapped evidence,
 * under-served opportunities, solutions with no assumption test, solutions whose
 * tests are prose only, hygiene. Everything else on the response is available
 * work that has never blocked completion.
 */
export const DONE_BLOCKING_LISTS: readonly string[] = Object.freeze([
  "unmappedEvidence",
  "underservedOpportunities",
  "solutionsMissingAssumptions",
  "solutionsMissingInstruments",
  "hygieneIssues",
]);

/** The lane queues, in the order `AssumptionWork` declares them. */
const LANE_QUEUES: readonly (keyof AssumptionWork)[] = [
  "runnable",
  "awaitingOneCommand",
  "blockedOnPermission",
  "needsHumans",
  "blockedOnPrerequisite",
];

/**
 * Does every assumption test beneath this solution sit in the lane compute may
 * never run?
 *
 * This is the one classification that needs the tree rather than the response,
 * and it is not a nicety: `ost_set_instrument` REFUSES a humans-required test
 * (`src/security/tools.ts`), so a solution all of whose tests carry that label
 * is asked by `solutionsMissingInstruments` for a write the boundary is built to
 * reject. No unattended pass can ever clear it; a human can, with
 * `ost-agent lane --set`, because the permissive direction is a person's call
 * and there is deliberately no agent tool for it.
 *
 * A solution with no resolvable test at all answers `false` — it is on the
 * missing-instruments list for a different reason and belongs to the pass that
 * can go write one.
 */
function everyTestBeyondCompute(solution: OstNode, index: Map<string, OstNode>): boolean {
  const tests = resolveTestsUnderSolution(solution, index);
  if (tests.length === 0) return false;
  return tests.every((t) => t.test.lane === CAUTIOUS_LANE);
}

/**
 * Partition one sweep by who may act on it.
 *
 * `tree` is the same node set the sweep was computed over. Two classifications
 * need it and neither can be taken off the response: whether an evidence id is
 * already quoted in some node's prose, and whether every test under a solution
 * is beyond compute's reach.
 */
export function partitionSweepByActor(work: NextWork, tree: readonly OstNode[]): ActorPartition {
  const index = new Map<string, OstNode>(tree.map((n) => [n.title, n]));
  const items: PartitionedItem[] = [];
  const push = (
    list: string,
    item: string,
    actor: SweepActor,
    clearedBy: string | null,
    reason: string,
  ): void => {
    items.push({ list, item, actor, clearedBy, reason });
  };

  /*
   * Unmapped evidence. The default actor is the unattended pass — mapping an
   * item is `ost_create_node({ source })`, which it holds.
   *
   * The exception is the finding this partition was built to surface. An item
   * whose id is already quoted in a node's BODY has been read and used; the
   * corroboration went where it belonged. But mapped-ness is derived only from
   * frontmatter `source`, which is settable only at creation, so the item is
   * still outstanding and the only call that would clear it creates a second
   * node saying what the first one already says. No actor can honestly do that,
   * which is what puts these in `nobody` rather than in anybody's queue.
   */
  for (const e of work.unmappedEvidence) {
    const citers = tree.filter((n) => quotesEvidenceId(n.body, e.id)).map((n) => n.title);
    if (citers.length > 0) {
      push(
        "unmappedEvidence",
        e.id,
        "nobody",
        null,
        `"${citers[0]}"${citers.length > 1 ? ` (+${citers.length - 1} more)` : ""} already quotes ${e.id} in its ` +
          `prose, so the reading has been taken and recorded. Mapped-ness is derived from frontmatter \`source\` ` +
          `alone and \`source\` is settable only at creation, so no verb on any surface marks this item mapped — ` +
          `the only call that would is a second node repeating the first.`,
      );
      continue;
    }
    push(
      "unmappedEvidence",
      e.id,
      "unattended",
      `ost_create_node({ source: "${e.id}" })`,
      "no node cites this record in frontmatter or in prose, so mapping it is a node nobody has written yet.",
    );
  }

  for (const o of work.underservedOpportunities) {
    push(
      "underservedOpportunities",
      o.title,
      "unattended",
      "ost_create_node (#Solution)",
      `has ${o.solutions} of ${o.needed} solution(s); ideating candidates is the agent surface's own work.`,
    );
  }

  for (const s of work.solutionsMissingAssumptions) {
    push(
      "solutionsMissingAssumptions",
      s.title,
      "unattended",
      "ost_create_node (#AssumptionTest)",
      "surfacing what a solution assumes is written, not measured, so the pass can do it unattended.",
    );
  }

  /*
   * Solutions whose tests are prose only. Declaring an instrument is the agent's
   * own work — unless the write boundary refuses the call, which it does when
   * every test beneath carries the cautious lane. That is not a corner case in
   * this vault: it is the live defect the opportunity above this solution
   * records, a solution listed as owing an instrument that `ost_set_instrument`
   * will not accept one for.
   */
  for (const title of work.solutionsMissingInstruments) {
    const solution = index.get(title);
    if (solution && everyTestBeyondCompute(solution, index)) {
      push(
        "solutionsMissingInstruments",
        title,
        "human-only",
        `ost-agent lane "<test>" --set compute-only`,
        `every test beneath it is labelled ${CAUTIOUS_LANE}, and ost_set_instrument refuses that combination — ` +
          `so no unattended pass can clear this entry however many times it is listed. Only the permissive lane ` +
          `call moves it, and there is deliberately no agent tool for that direction.`,
      );
      continue;
    }
    push(
      "solutionsMissingInstruments",
      title,
      "unattended",
      "ost_set_instrument",
      "at least one test beneath it can carry a command, so the pass can declare one.",
    );
  }

  for (const title of work.solutionsAwaitingObservation) {
    push(
      "solutionsAwaitingObservation",
      title,
      "attended",
      "ost-agent verify",
      "the question is mechanical but filing an observation is CLI-only, so a person has to be at the keyboard.",
    );
  }

  /*
   * The lane queues. Four of the five are the lane vocabulary read straight
   * off, which is the point — this partition must not become a second opinion
   * about who may run a test.
   *
   * `runnable` is `attended` rather than `unattended`, and that is the sweep's
   * own reading of its own bucket: compute may RUN a compute-only test, but the
   * verdict is recorded with `ost-agent result`, which no tool surface reaches,
   * and `/ost-pass` holds the hard rule that a pass never runs tests.
   *
   * `blockedOnPrerequisite` is the fifth, and it is `nobody` on purpose. The
   * question is who may act on THIS item, and the answer is no one: running it
   * produces a number nothing can interpret until the prerequisite has an
   * answer. The reason names the prerequisite, so the entry is a route rather
   * than a dead end — which is exactly the distinction the fourth bucket has to
   * be able to make if a reader is to trust the rest of it.
   */
  for (const t of work.assumptionWork.runnable) {
    push(
      "assumptionWork.runnable",
      t.test,
      "attended",
      `ost-agent result "${t.test}"`,
      "compute-only, so the run costs nobody anything — but recording the verdict is off every tool surface.",
    );
  }
  for (const t of work.assumptionWork.awaitingOneCommand) {
    push(
      "assumptionWork.awaitingOneCommand",
      t.test,
      "attended",
      `ost-agent result "${t.test}"`,
      "compute can prepare the whole verdict; the human's part is one pre-filled command.",
    );
  }
  for (const t of work.assumptionWork.blockedOnPermission) {
    push(
      "assumptionWork.blockedOnPermission",
      t.test,
      "human-only",
      "the credential or consent, then ost-agent result",
      "the work is finished and what is missing is a permission nobody delegated.",
    );
  }
  for (const t of work.assumptionWork.needsHumans) {
    push(
      "assumptionWork.needsHumans",
      t.test,
      "human-only",
      `ost-agent result "${t.test}"`,
      `labelled ${CAUTIOUS_LANE} (or unlabelled, which fails closed to it) — a person outside the building is ` +
        `the measurement.`,
    );
  }
  for (const b of work.assumptionWork.blockedOnPrerequisite) {
    push(
      "assumptionWork.blockedOnPrerequisite",
      b.test,
      "nobody",
      null,
      `waiting on ${b.waitingOn.map((w) => `"${w}"`).join(", ")} — until that has a recorded result this test ` +
        `produces a number nobody can read, whatever lane it is in. The route out is the prerequisite, not this ` +
        `entry.`,
    );
  }

  for (const a of work.outstandingAsks) {
    push(
      "outstandingAsks",
      a.test,
      "human-only",
      a.command,
      a.ageDays === null
        ? "an ask with no date on record — asked before the ledger existed, or by a route it never saw."
        : `asked ${a.ageDays} day(s) ago and still unanswered.`,
    );
  }

  for (const h of work.hygieneIssues) {
    push(
      "hygieneIssues",
      h.title,
      "unattended",
      "ost_annotate",
      `${h.rule}: annotating is the one clear path and the agent surface holds it.`,
    );
  }

  for (const u of work.openUnknowns) {
    push(
      "openUnknowns",
      u.title,
      "unattended",
      "ost_append_to_node",
      u.gaps.length
        ? `${u.klass}; the contract is missing ${u.gaps.join(", ")} — sections a pass writes rather than measures.`
        : `${u.klass}; the contract is declared and exploring it is the pass's own work.`,
    );
  }

  /*
   * Quarantine. No allowlisted tool rewrites a `type:` — corrections are new
   * commits and there is no edit-in-place on this surface — so the only actor
   * who can put a quarantined file back into the tree is a person with an
   * editor. That is also why it never blocked `done`.
   */
  for (const q of work.quarantined) {
    push(
      "quarantined",
      q.title,
      "human-only",
      "an editor, by hand",
      `carries \`type: ${q.unrecognizedType}\`, which no reader classifies. No allowlisted tool can rewrite a ` +
        `\`type:\`, so no surface reaches this${q.children.length ? ` — and ${q.children.length} node(s) beneath it are dark until it is fixed` : ""}.`,
    );
  }

  /*
   * What the partition could not see. Both entries are counts the sweep reports
   * without rows, and both are outstanding work: a truncated list is a window,
   * and an aged-out record is still unmapped and still on disk. They go into
   * `offered` and never into `read`, which is what makes `doneForActor` refuse
   * rather than answer over a window.
   */
  const outOfReach: OutOfReach[] = [];
  for (const t of work.truncated) {
    if (t.hidden <= 0) continue;
    outOfReach.push({
      list: t.list,
      count: t.hidden,
      why: `the sweep listed ${t.shown} of ${t.total}; the other ${t.hidden} were never handed over, so nobody can be assigned them.`,
    });
  }
  if (work.agedOutEvidence.count > 0) {
    outOfReach.push({
      list: "agedOutEvidence",
      count: work.agedOutEvidence.count,
      why: `still unmapped and still on disk, reported as a count rather than as rows (oldest captured ${work.agedOutEvidence.oldest}).`,
    });
  }

  const notPartitioned: NotPartitioned[] = [
    {
      list: "emptyDescents",
      count: work.emptyDescents.length,
      why: "short headings whose leaves are all already served. Reported so the branch is not silent; no actor can ideate on a category.",
    },
    {
      list: "retiredFromDuplicateScan",
      count: work.retiredFromDuplicateScan.length,
      why: "retired nodes, disclosed so the duplicate scan's denominator is visible. Not outstanding work.",
    },
    {
      list: "withheldByDisposition",
      count: work.withheldByDisposition.length,
      why: "settled by a named person's assertion. Somebody acted; reversing it is `ost-agent dispose --reopen`.",
    },
    {
      list: "suppressedByCondition",
      count: work.suppressedByCondition.length,
      why: "declined against a machine-checkable condition that still holds; the item returns by itself when it flips.",
    },
  ];

  const hidden = outOfReach.reduce((n, r) => n + r.count, 0);
  const subject: SweepSubject = { offered: items.length + hidden, read: items.length };

  return {
    items,
    unattended: items.filter((i) => i.actor === "unattended"),
    attended: items.filter((i) => i.actor === "attended"),
    humanOnly: items.filter((i) => i.actor === "human-only"),
    nobody: items.filter((i) => i.actor === "nobody"),
    subject,
    reach: hidden > 0 ? "partial" : "complete",
    outOfReach,
    notPartitioned,
  };
}

/** One actor's share of the sweep, in sweep order. */
export function shareOf(partition: ActorPartition, actor: SweepActor): readonly PartitionedItem[] {
  switch (actor) {
    case "unattended":
      return partition.unattended;
    case "attended":
      return partition.attended;
    case "human-only":
      return partition.humanOnly;
    case "nobody":
      return partition.nobody;
  }
}

export interface ActorDone {
  readonly actor: SweepActor;
  /** False whenever {@link ActorDone.notComputable} is set — an unanswerable question is not a yes. */
  readonly done: boolean;
  /** Done-blocking items in this actor's share. */
  readonly outstanding: number;
  /** Why the verdict could not be taken, or `null`. */
  readonly notComputable: string | null;
}

/**
 * Is this actor's share of the DONE-BLOCKING lists empty?
 *
 * The solution this implements says `done` is computed over the asker's share
 * alone, and this is that — narrowed from the sweep's own definition rather
 * than from a new one, so a per-actor `done` can never be reached by a route
 * the whole-tree `done` does not have.
 *
 * It refuses over a partial reach, and that refusal is the load-bearing half.
 * A cap is a display limit that `NextWork.done` steps around by counting the
 * full set; a partition only ever sees the rows. Answering `true` because the
 * hidden twenty-six were not in front of it would turn a display limit into a
 * completion certificate, and an unattended loop stops on this signal.
 */
export function doneForActor(partition: ActorPartition, actor: SweepActor): ActorDone {
  const blocking = new Set(DONE_BLOCKING_LISTS);
  const outstanding = shareOf(partition, actor).filter((i) => blocking.has(i.list)).length;
  const short = partition.outOfReach.filter((r) => blocking.has(r.list) || r.list === "agedOutEvidence");
  if (short.length > 0) {
    return {
      actor,
      done: false,
      outstanding,
      notComputable:
        `${short.reduce((n, r) => n + r.count, 0)} done-blocking item(s) were counted by the sweep and not listed ` +
        `(${short.map((r) => `${r.list} +${r.count}`).join(", ")}), so no actor's share is complete and no ` +
        `per-actor \`done\` can be taken off this response.`,
    };
  }
  return { actor, done: outstanding === 0, outstanding, notComputable: null };
}

/** The label an operator reads for each actor. */
const ACTOR_LABELS: Record<SweepActor, string> = {
  unattended: "An unattended pass may clear",
  attended: "An attended session may clear",
  "human-only": "Only a person may clear",
  nobody: "NOBODY MAY ACT",
};

/**
 * The partition as an operator reads it: the four shares, the fourth spelled
 * out item by item, then what the split could not see.
 *
 * The fourth bucket prints its reasons in full and the other three do not. That
 * asymmetry is the report's argument: the first three are routing, and routing
 * is checked by whether the work gets done. The fourth is a claim that no route
 * exists, and a claim like that is only worth as much as the sentence under it.
 */
export function formatActorPartition(partition: ActorPartition): string {
  const lines: string[] = [];
  lines.push(
    `Sweep by actor: ${partition.items.length} outstanding item(s) — ` +
      `${partition.unattended.length} unattended, ${partition.attended.length} attended, ` +
      `${partition.humanOnly.length} human-only, ${partition.nobody.length} nobody.`,
  );
  if (partition.reach === "partial") {
    lines.push(
      `  ⚠ partial: the sweep counted ${partition.subject.offered} row(s) and handed over ${partition.subject.read}. ` +
        `Every count above is over what was listed, and no per-actor \`done\` can be taken off it.`,
    );
    for (const r of partition.outOfReach) lines.push(`    ${r.list} +${r.count} — ${r.why}`);
  }

  for (const actor of SWEEP_ACTORS) {
    if (actor === "nobody") continue;
    const share = shareOf(partition, actor);
    const verdict = doneForActor(partition, actor);
    lines.push("");
    lines.push(
      `${ACTOR_LABELS[actor]} (${share.length}) — ${verdict.notComputable ? "done: not computable" : verdict.done ? "done" : `${verdict.outstanding} done-blocking`}`,
    );
    if (!share.length) lines.push("  (none)");
    for (const i of share) lines.push(`  ${i.list}: ${i.item} → ${i.clearedBy}`);
  }

  lines.push("");
  lines.push(`${ACTOR_LABELS.nobody} (${partition.nobody.length}) — the finding this split exists to take.`);
  if (!partition.nobody.length) {
    lines.push("  (none) — every outstanding item is in somebody's reach.");
  }
  for (const i of partition.nobody) {
    lines.push(`  ${i.list}: ${i.item}`);
    lines.push(`    ${i.reason}`);
  }

  lines.push("");
  lines.push("Outside the subject, because it is disclosure rather than outstanding work:");
  for (const n of partition.notPartitioned) lines.push(`  ${n.list} (${n.count}) — ${n.why}`);

  lines.push("");
  lines.push(
    "A reason here says no verb reaches the item, never that the reason is a good one — that reading is a " +
      "human's, and this report only asserts one is present.",
  );
  return lines.join("\n");
}
