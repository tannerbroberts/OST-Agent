/**
 * "Dismiss ten records and require every one to be attributable and reversible" — the
 * instrument behind "Record a read-and-skipped judgement so the queue drains without a
 * write".
 *
 * The skill tells a pass to skip an item that reveals no genuine need, and a skip that
 * cannot be recorded is indistinguishable from an unread item: the next pass reads the
 * same record, reaches the same conclusion, and pays the same cost. A dismissal closes
 * that gap — and it closes it by *asserting*, which is the shape this whole tool surface
 * exists to refuse. So the assertion has to be auditable, and this file pins the
 * mechanical half of auditable, at the scale a pass would actually dismiss.
 *
 * The bar, pre-committed by the assumption test: 5 of 5 properties, over ten records.
 *
 *   1. every dismissal names an actor;
 *   2. every dismissal carries a timestamp;
 *   3. every dismissal carries a non-empty reason — and one with an empty or
 *      whitespace-only reason is refused at the boundary rather than stored;
 *   4. one command lists all ten for review, dated, attributed and reasoned;
 *   5. every dismissal is reversible — a reopen puts its record back on
 *      `unmappedEvidence`, where the sweep sees it again.
 *
 * Property 3's refusal is not decoration. An empty reason is what bulk dismissal
 * actually looks like in practice, and a mechanism that stores one has kept a log
 * rather than a check.
 *
 * **What a green here does NOT settle, and it is the important half.** It settles that
 * a dismissal is *recorded* honestly. It says nothing about whether the recording
 * restrains anybody. The parent assumption's real risk is that nobody reads the log —
 * the operator this is built for has stated their hours do not exist, and an
 * after-the-fact review queue is precisely the obligation such an operator never
 * serves. Whether the reason string is a restraint or a formality the dismissing party
 * writes to itself is not answerable by a spec. A green run here is permission to trust
 * the plumbing, not permission to grant the power.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, readEvidence, writeEvidence } from "../../src/processes/tree.js";
import {
  appendDisposition,
  dispositionLedgerPath,
  readDispositionLedger,
  type DispositionRecord,
} from "../../src/knowledge/dispositions.js";

/** Ten records — the scale the threshold names, and the scale a single pass reaches. */
const IDS = Array.from({ length: 10 }, (_, i) => `INBOX:skipped-${String(i + 1).padStart(2, "0")}.md`);
const ACTOR = "Tanner";
/** A distinct sentence per record, so "listed" cannot pass on one reason printed ten times. */
const REASON = (i: number): string => `read in full and reveals no need anyone should act on (record ${i + 1})`;

// See the note in `test/cli/dispose.test.ts`: the local tsx binary directly, never
// through `npx`, so concurrent spawns do not contend on npm's cacache lock.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

/** A fixed clock per record, so the timestamps are checkable rather than "recent". */
const CLOCK = (i: number): (() => Date) => () => new Date(`2026-08-12T10:${String(i).padStart(2, "0")}:00.000Z`);

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-dismissal-audit-"));
  await initVault(dir, "Reach ten thousand daily active users");
  for (const id of IDS) {
    writeEvidence(dir, { id, source: id, title: "A session that revealed nothing", timestamp: "2026-08-01", body: "b" }, "inbox");
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

/** The true size of a possibly-capped list: the cap names what it hid, so total = shown + hidden. */
function trueCount(shown: number, truncated: readonly { list: string; total: number }[], list: string): number {
  const entry = truncated.find((t) => t.list === list);
  return entry ? entry.total : shown;
}

/** Dismiss all ten through the funnel every write goes through, and return what was written. */
function dismissAll(): DispositionRecord[] {
  const index = byTitle(buildPassContext(dir).vault.readTree());
  return IDS.map((id, i) =>
    appendDisposition(
      dir,
      { subject: id, kind: "evidence", state: "closed", reason: REASON(i), by: ACTOR, verdict: "no-genuine-need" },
      index,
      CLOCK(i),
    ),
  );
}

test("ten records dismissed: each attributable, listable in one command, and reversible to unmapped", async () => {
  const v = buildPassContext(dir).vault;

  // Non-vacuity. All ten are outstanding before anything is dismissed, and the list is
  // capped, so the true count is read the way the cap says to read it.
  const before = computeNextWork(v, dir, 3);
  expect(trueCount(before.unmappedEvidence.length, before.truncated, "unmappedEvidence")).toBe(10);
  const nodesBefore = v.readTree().length;

  dismissAll();

  // The drain itself — the thing the solution exists for. Ten read-and-skipped
  // judgements, ten items off the sweep, and not one node written to achieve it.
  const after = computeNextWork(v, dir, 3);
  expect(after.unmappedEvidence).toHaveLength(0);
  expect(after.truncated.find((t) => t.list === "unmappedEvidence")).toBeUndefined();
  expect(v.readTree().length).toBe(nodesBefore);
  // Nothing hidden silently: every withdrawal is named on the response that made it.
  const withheld = after.withheldByDisposition.filter((w) => w.list === "unmappedEvidence");
  expect(trueCount(withheld.length, after.truncated, "withheldByDisposition")).toBe(10);

  const ledger = readDispositionLedger(dir);
  expect(ledger.damaged).toBe(0);
  const entries = IDS.map((id) => ledger.histories.get(id) ?? []);
  expect(entries.map((h) => h.length)).toEqual(IDS.map(() => 1));
  const written = entries.map((h) => h[0]);

  // ── 1. Actor. Every one names who dismissed it. An unattributed dismissal is
  // unauditable: the entire safeguard is that a human can read the assertion and see
  // whose it was.
  expect(written.map((d) => d.by)).toEqual(IDS.map(() => ACTOR));

  // ── 2. Timestamp. Every one is dated, off the injected clock, in a form that sorts
  // and parses — "when did this pass start clearing its own list" is the first question
  // an auditor asks of a bulk dismissal.
  for (const [i, d] of written.entries()) {
    expect(d.ts).toBe(`2026-08-12T10:${String(i).padStart(2, "0")}:00.000Z`);
    expect(Number.isNaN(Date.parse(d.ts))).toBe(false);
  }

  // ── 3. Reason. Every one carries the writer's own sentence, distinct per record.
  expect(written.map((d) => d.reason)).toEqual(IDS.map((_, i) => REASON(i)));
  expect(written.every((d) => d.reason.trim().length > 0)).toBe(true);

  // ── 4. One command lists them. Not a library call an auditor would have to write —
  // `ost-agent dispositions`, printing all ten with the date, the actor and the reason
  // each was skipped for, plus the sentence that says how to put one back.
  const { stdout } = await cli(["dispositions", "--vault", dir]);
  for (const [i, id] of IDS.entries()) {
    expect(stdout).toContain(id);
    expect(stdout).toContain(REASON(i));
  }
  expect(stdout).toContain(ACTOR);
  expect(stdout).toContain("2026-08-12");
  expect(stdout).toContain("--reopen");

  // ── 5. Reversible. Each dismissal can be disputed, and the record it hid comes back
  // on `unmappedEvidence` — the same list it left. An irreversible hide is a delete
  // wearing a ledger's clothes.
  const index = byTitle(v.readTree());
  for (const [i, id] of IDS.entries()) {
    appendDisposition(
      dir,
      { subject: id, kind: "evidence", state: "reopened", reason: "read it again — there is a need here", by: ACTOR },
      index,
      CLOCK(i + 30),
    );
  }
  const reopened = computeNextWork(v, dir, 3);
  expect(trueCount(reopened.unmappedEvidence.length, reopened.truncated, "unmappedEvidence")).toBe(10);
  expect(reopened.withheldByDisposition.filter((w) => w.list === "unmappedEvidence")).toHaveLength(0);
  // Append-only, so the reversal does not erase what it reverses: both entries stand,
  // and that history is the part an auditor most needs.
  expect(IDS.map((id) => readDispositionLedger(dir).histories.get(id)?.length)).toEqual(IDS.map(() => 2));

  // The records themselves were never touched by any of this — dismissal is a
  // judgement about a record, not a deletion of one.
  expect(readEvidence(dir).map((e) => e.id).sort()).toEqual([...IDS].sort());
}, 60_000);

test("a dismissal with an empty or whitespace-only reason is refused, not stored", async () => {
  const index = byTitle(buildPassContext(dir).vault.readTree());
  const empty = { subject: IDS[0], kind: "evidence" as const, state: "closed" as const, by: ACTOR };

  // At the funnel, because a rule enforced at one of two callers is not a rule.
  for (const reason of ["", "   ", "\t\n "]) {
    expect(() => appendDisposition(dir, { ...empty, reason }, index)).toThrow(/reason/);
  }
  expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);

  // And at the command a human actually types. `--why ""` satisfies commander — the
  // option is present — so an empty reason reaches the funnel as a real argument, and
  // this is the path a bulk dismissal would take.
  await expect(cli(["dispose", IDS[0], "--kind", "evidence", "--by", ACTOR, "--why", "   ", "--vault", dir])).rejects.toThrow(/reason/);
  expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);

  // Non-vacuity for the refusal: the same call with a reason is accepted, so what was
  // refused above was the empty reason and not the shape of the call.
  expect(() => appendDisposition(dir, { ...empty, reason: "reveals nothing" }, index)).not.toThrow();
  expect(readDispositionLedger(dir).histories.get(IDS[0])).toHaveLength(1);
}, 60_000);
