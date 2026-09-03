/**
 * The instrument for "Partition today's sweep by actor and see whether the
 * unattended share is reachable."
 *
 * The assumption underneath it is a feasibility claim: partitioning the
 * outstanding list by who may act on it leaves an unattended pass a share it can
 * actually finish. The test the node designed is a classification — take the
 * sweep, put every item in one of four buckets (unattended pass, attended
 * session, human only, nobody), and read the fourth. Its threshold is exact:
 * *the nobody-may-act bucket is empty, or every item in it has a named reason.*
 *
 * So these specs pin four things, in the order they carry weight:
 *
 *   1. **Total accounting.** Every row the sweep hands over lands in exactly one
 *      bucket, and the four add back up to the whole. A partition that dropped a
 *      row would report a smaller share than the actor really owns, which is the
 *      one way this mechanism could make things worse than the single list.
 *   2. **The threshold itself**, asserted structurally rather than over one
 *      fixture: `nobody` and "no clearing verb" are the same fact, and every
 *      entry carries a reason. A reasonless entry in the fourth bucket cannot be
 *      constructed.
 *   3. **The two classifications that are findings rather than routing** — an
 *      evidence record whose reading has already been taken, and a solution
 *      whose every test the write boundary refuses an instrument for. Both are
 *      read off the tree, not asserted, and both are cases the vault has
 *      actually accumulated.
 *   4. **That the split cannot launder a cap into a completion.** The sweep's
 *      lists are windows; `NextWork.done` steps around that by counting the full
 *      set, and a per-actor `done` has no such escape. It refuses instead.
 *
 * Everything is a temp vault. The live tree changes daily, and a bucket count
 * taken over it is a number nobody can assert against — the operator takes that
 * reading with `ost-agent actors`, off the same code these specs hold.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork, type NextWork } from "../../src/mcp/next-work.js";
import { writeEvidence } from "../../src/processes/tree.js";
import {
  DONE_BLOCKING_LISTS,
  NON_LIST_FIELDS,
  NOT_PARTITIONED_LISTS,
  OUT_OF_REACH_LISTS,
  PARTITIONED_LISTS,
  SWEEP_ACTORS,
  doneForActor,
  formatActorPartition,
  partitionSweepByActor,
  shareOf,
  type ActorPartition,
} from "../../src/ost/actor-partition.js";
import type { Vault } from "../../src/ost/vault.js";

const OUTCOME = "Retention";

/** An evidence id a node's prose already quotes — read, used, and still unmapped. */
const READ_ALREADY = "INBOX:2026-08-05-corroborates-a-need-we-hold.md";
/** An evidence id nothing in the tree mentions — genuinely unmapped work. */
const NEVER_READ = "INBOX:2026-08-30-nobody-has-opened-this.md";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-actor-partition-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A tree carrying one item for every bucket the partition can produce.
 *
 * Written out rather than generated: each node here exists to reach exactly one
 * branch of the classifier, and a fixture whose shape is computed is a fixture
 * nobody can read the branches off.
 */
function seedVault(v: Vault): void {
  const opportunity = "Users churn after week one";
  v.createNode({
    title: opportunity,
    layer: "Opportunity",
    evidence: "assertion",
    // The prose citation is the whole point of this node: a pass read the record
    // and recorded the corroboration where it belonged, on the need it supports.
    body: `Week-one drop-off, corroborated by ${READ_ALREADY} which says the same thing the interviews did.`,
    tags: [],
    links: [],
  });
  v.linkNodes(OUTCOME, opportunity);

  // Under-served: one solution against a min of three.
  const bare = "Onboarding checklist";
  v.createNode({ title: bare, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(opportunity, bare);

  // Prose-only tests, all of them beyond compute's reach: `ost_set_instrument`
  // refuses this combination, so no unattended pass can ever clear the entry.
  const humanOnlySolution = "Interview the ten who left";
  v.createNode({ title: humanOnlySolution, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(opportunity, humanOnlySolution);
  const humanTest = "Ten leavers name the same missing thing";
  v.createNode({
    title: humanTest,
    layer: "AssumptionTest",
    evidence: "assertion",
    lane: "humans-required",
    body: "prose only",
    tags: [],
    links: [],
  });
  v.linkNodes(humanOnlySolution, humanTest);

  // A prose-only test compute may run — the pass can go and declare an instrument.
  const instrumentable = "Replay the churn cohort";
  v.createNode({ title: instrumentable, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(opportunity, instrumentable);
  const computeTest = "The replay reproduces last quarter's cohort exactly";
  v.createNode({
    title: computeTest,
    layer: "AssumptionTest",
    evidence: "assertion",
    lane: "compute-only",
    body: "prose only",
    tags: [],
    links: [],
  });
  v.linkNodes(instrumentable, computeTest);

  // A test whose prerequisite has no result: blocked by the tree's own ordering,
  // which no lane can express and no actor can step around.
  const blocked = "Community seeding lifts week-two return";
  v.createNode({
    title: blocked,
    layer: "AssumptionTest",
    evidence: "assertion",
    lane: "compute-only",
    prerequisites: [computeTest],
    body: "prose only",
    tags: [],
    links: [],
  });
  v.linkNodes(instrumentable, blocked);
}

/** The sweep and its partition, over the seeded vault. */
function sweep(listLimit?: number): { work: NextWork; partition: ActorPartition; vault: Vault } {
  const v = buildPassContext(dir).vault;
  seedVault(v);
  writeEvidence(dir, { id: READ_ALREADY, source: "inbox", title: "A leaver's note", timestamp: "2026-08-05T00:00:00Z", body: "they left because setup never finished" }, "founder");
  writeEvidence(dir, { id: NEVER_READ, source: "inbox", title: "An unopened note", timestamp: "2026-08-30T00:00:00Z", body: "nobody has read this one" }, "founder");
  const work = computeNextWork(v, dir, 3, () => new Date("2026-09-01T00:00:00Z"), null, null, listLimit);
  return { work, partition: partitionSweepByActor(work, v.readTree()), vault: v };
}

/** Every row of one list, as the partition reports them. */
function rowsFrom(partition: ActorPartition, list: string): readonly { item: string; actor: string; reason: string }[] {
  return partition.items.filter((i) => i.list === list);
}

describe("the sweep partitions by who may act on it", () => {
  test("every row the sweep handed over lands in exactly one actor's share", () => {
    const { partition } = sweep();
    expect(partition.items.length).toBeGreaterThan(0);
    const shares = SWEEP_ACTORS.map((a) => shareOf(partition, a));
    expect(shares.reduce((n, s) => n + s.length, 0)).toBe(partition.items.length);
    // Not merely the right total: each row appears in its own actor's share and
    // nowhere else. A row counted twice would inflate somebody's pile and empty
    // another's by the same amount, which the sum alone cannot see.
    for (const item of partition.items) {
      const containing = SWEEP_ACTORS.filter((a) => shareOf(partition, a).includes(item));
      expect(containing).toEqual([item.actor]);
    }
  });

  test("the subject is the sweep's own row count, taken over every partitioned list", () => {
    const { work, partition } = sweep();
    const rows =
      work.unmappedEvidence.length +
      work.underservedOpportunities.length +
      work.solutionsMissingAssumptions.length +
      work.solutionsMissingInstruments.length +
      work.solutionsAwaitingObservation.length +
      work.assumptionWork.runnable.length +
      work.assumptionWork.awaitingOneCommand.length +
      work.assumptionWork.blockedOnPermission.length +
      work.assumptionWork.needsHumans.length +
      work.assumptionWork.blockedOnPrerequisite.length +
      work.outstandingAsks.length +
      work.hygieneIssues.length +
      work.openUnknowns.length +
      work.quarantined.length;
    expect(partition.items.length).toBe(rows);
    expect(partition.subject.read).toBe(rows);
    expect(partition.reach).toBe("complete");
    expect(partition.subject.offered).toBe(rows);
  });

  test("a `NextWork` field classified nowhere is a build failure, not a silent gap", () => {
    const { work } = sweep();
    const declared = new Set([
      ...PARTITIONED_LISTS,
      ...OUT_OF_REACH_LISTS,
      ...NOT_PARTITIONED_LISTS,
      ...NON_LIST_FIELDS,
    ]);
    // Parity in both directions: a field the sweep grew and nobody sorted would
    // be work belonging to no actor, and a name declared here that the sweep no
    // longer returns is a rule about nothing.
    expect([...Object.keys(work)].filter((k) => !declared.has(k))).toEqual([]);
    expect([...declared].filter((k) => !(k in work))).toEqual([]);
    // `done` is narrowed from the sweep's own definition, never widened past it.
    expect(DONE_BLOCKING_LISTS.every((l) => PARTITIONED_LISTS.includes(l))).toBe(true);
  });
});

describe("the fourth bucket is the finding, and every entry in it names a reason", () => {
  test("the nobody bucket is empty, or every item in it has a named reason", () => {
    const { partition } = sweep();
    for (const item of partition.nobody) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
      expect(item.item.trim().length).toBeGreaterThan(0);
    }
  });

  test("`nobody` and `no clearing verb` are the same fact — neither can be set without the other", () => {
    const { partition } = sweep();
    for (const item of partition.items) {
      expect(item.clearedBy === null).toBe(item.actor === "nobody");
      // A reason is required of every actor, not only of the fourth. Routing that
      // cannot say why it routed is a second opinion about the lanes wearing a
      // data structure.
      expect(item.reason.trim().length).toBeGreaterThan(0);
    }
  });

  test("an evidence record a node's prose already cites belongs to nobody, and the reason says why", () => {
    const { partition } = sweep();
    const rows = rowsFrom(partition, "unmappedEvidence");
    const alreadyRead = rows.find((r) => r.item === READ_ALREADY);
    const neverRead = rows.find((r) => r.item === NEVER_READ);

    // The prediction the solution node made, checked from the other side: the
    // item was read, the corroboration was recorded on the node it supports, and
    // the sweep still reports it — because mapped-ness comes off frontmatter
    // `source` and `source` is settable only at creation.
    expect(alreadyRead?.actor).toBe("nobody");
    expect(alreadyRead?.reason).toContain("Users churn after week one");
    expect(alreadyRead?.reason).toContain("source");

    // And the control: an item nobody has opened is ordinary unattended work.
    // Without this half the classifier could be "call all evidence unreachable"
    // and still pass the assertion above.
    expect(neverRead?.actor).toBe("unattended");
  });

  test("a test blocked on a prerequisite belongs to nobody and names what it waits on", () => {
    const { partition } = sweep();
    const blocked = rowsFrom(partition, "assumptionWork.blockedOnPrerequisite");
    expect(blocked.length).toBe(1);
    expect(blocked[0].actor).toBe("nobody");
    // The reason is a route, not a shrug — the prerequisite IS the next thing to
    // go and answer, and an entry that did not name it would be indistinguishable
    // from an item nothing can ever clear.
    expect(blocked[0].reason).toContain("The replay reproduces last quarter's cohort exactly");
  });
});

describe("the split is read off the surfaces, never asserted", () => {
  test("a solution whose every test is humans-required is a person's, not the unattended pass's", () => {
    const { work, partition } = sweep();
    // The sweep lists both solutions as owing an instrument, undifferentiated.
    expect(work.solutionsMissingInstruments).toContain("Interview the ten who left");
    expect(work.solutionsMissingInstruments).toContain("Replay the churn cohort");

    const rows = rowsFrom(partition, "solutionsMissingInstruments");
    const refused = rows.find((r) => r.item === "Interview the ten who left");
    const writable = rows.find((r) => r.item === "Replay the churn cohort");

    // `ost_set_instrument` refuses a humans-required test, so an unattended pass
    // asked for this one is asked for a write the boundary is built to reject.
    expect(refused?.actor).toBe("human-only");
    expect(refused?.reason).toContain("humans-required");
    expect(writable?.actor).toBe("unattended");
  });

  test("a compute-only test is the attended session's, because recording a result is off every tool surface", () => {
    const { work, partition } = sweep();
    expect(work.assumptionWork.runnable.map((t) => t.test)).toContain("The replay reproduces last quarter's cohort exactly");
    const runnable = rowsFrom(partition, "assumptionWork.runnable");
    expect(runnable.every((r) => r.actor === "attended")).toBe(true);

    const needsHumans = rowsFrom(partition, "assumptionWork.needsHumans");
    expect(needsHumans.length).toBeGreaterThan(0);
    expect(needsHumans.every((r) => r.actor === "human-only")).toBe(true);
  });

  test("no unattended row is ever assigned a verb that is not on the unattended surface", () => {
    const { partition } = sweep();
    // The grant in `examples/automation/autonomous-pass.sh`, restated as the
    // property that matters: everything routed to the pass is cleared by an
    // `ost_`-prefixed tool call, and nothing routed to it is a CLI line. A `done`
    // an unattended loop reads must not be reachable only by a person.
    for (const item of partition.unattended) {
      expect(item.clearedBy).toMatch(/^ost_/);
    }
    for (const item of partition.attended) {
      expect(item.clearedBy).toMatch(/^ost-agent /);
    }
  });
});

describe("a per-actor `done` is the sweep's own verdict narrowed, and it refuses over a window", () => {
  test("the unattended share can be done while another actor's is not", () => {
    const { work, partition } = sweep();
    expect(work.done).toBe(false);
    const unattended = doneForActor(partition, "unattended");
    const humans = doneForActor(partition, "human-only");
    expect(unattended.notComputable).toBeNull();
    // This fixture leaves the pass real work, so the interesting assertion is the
    // relation rather than the value: the shares are counted separately and one
    // actor's backlog never lands in another's verdict.
    expect(unattended.outstanding + humans.outstanding).toBeLessThanOrEqual(partition.items.length);
    expect(unattended.outstanding).toBe(
      partition.unattended.filter((i) => DONE_BLOCKING_LISTS.includes(i.list)).length,
    );
    expect(humans.outstanding).toBe(
      partition.humanOnly.filter((i) => DONE_BLOCKING_LISTS.includes(i.list)).length,
    );
  });

  test("a truncated sweep makes every per-actor `done` not-computable rather than true", () => {
    const { partition } = sweep(1);
    expect(partition.reach).toBe("partial");
    expect(partition.subject.offered).toBeGreaterThan(partition.subject.read);
    for (const actor of SWEEP_ACTORS) {
      const verdict = doneForActor(partition, actor);
      expect(verdict.done).toBe(false);
      expect(verdict.notComputable).toContain("not listed");
    }
  });

  test("aged-out evidence is counted as out of reach, not as nothing", () => {
    const { work, partition: complete } = sweep();
    expect(complete.reach).toBe("complete");
    // The standing backlog line reports a count and no rows. Those items are
    // still unmapped and still on disk, so a partition that ignored them would
    // certify a `done` over work it had never been shown.
    const aged = partitionSweepByActor(
      { ...work, agedOutEvidence: { count: 4, oldest: "2026-06-01T00:00:00Z" } },
      buildPassContext(dir).vault.readTree(),
    );
    expect(aged.reach).toBe("partial");
    expect(aged.outOfReach.find((r) => r.list === "agedOutEvidence")?.count).toBe(4);
    expect(doneForActor(aged, "unattended").notComputable).toContain("agedOutEvidence");
  });
});

describe("the report an operator reads", () => {
  test("names all four shares and prints the fourth bucket's reasons in full", () => {
    const { partition } = sweep();
    const text = formatActorPartition(partition);
    expect(text).toContain("An unattended pass may clear");
    expect(text).toContain("An attended session may clear");
    expect(text).toContain("Only a person may clear");
    expect(text).toContain("NOBODY MAY ACT");
    for (const item of partition.nobody) expect(text).toContain(item.reason);
    // Disclosure lists are named rather than dropped — the same rule the sweep
    // applies to its own caps, applied to the partition's subject.
    for (const n of partition.notPartitioned) expect(text).toContain(n.list);
  });

  test("an empty outstanding list reads as nothing to do, never as a blind sweep", () => {
    // `classifySubject` in `src/ost/sweep.ts` calls `offered === 0` totally-blind,
    // and that is right for a sweep over files: nobody looked. It is wrong here.
    // A maintained tree genuinely has nothing outstanding to split, and reporting
    // that as blindness would make the healthy state indistinguishable from a
    // reader pointed at the wrong thing.
    const { work } = sweep();
    const empty = partitionSweepByActor(
      {
        ...work,
        unmappedEvidence: [],
        underservedOpportunities: [],
        solutionsMissingAssumptions: [],
        solutionsMissingInstruments: [],
        solutionsAwaitingObservation: [],
        assumptionWork: {
          runnable: [],
          awaitingOneCommand: [],
          blockedOnPermission: [],
          needsHumans: [],
          blockedOnPrerequisite: [],
        },
        outstandingAsks: [],
        hygieneIssues: [],
        openUnknowns: [],
        quarantined: [],
        truncated: [],
        agedOutEvidence: { count: 0, oldest: null },
      },
      [],
    );
    expect(empty.items).toEqual([]);
    expect(empty.reach).toBe("complete");
    expect(empty.nobody).toEqual([]);
    expect(doneForActor(empty, "unattended")).toMatchObject({ done: true, notComputable: null });
    expect(formatActorPartition(empty)).toContain("every outstanding item is in somebody's reach");
  });
});
