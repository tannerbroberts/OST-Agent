/**
 * "A novel item survives the age-out that buries its neighbours" — the instrument
 * behind "An unmapped item ages out of the queue into a standing backlog line".
 *
 * The parent solution's own body claims ageing "makes no claim whatsoever about
 * what the items mean" and is judgement-free. The assumption test beneath it
 * argues the opposite is likely: the item most likely to age out is not the most
 * redundant one but the one whose disposition is hardest, and hardest is often
 * novel. So the rule this file pins is the one that has to hold for the
 * candidate to be safe to ship at all: AGE ALONE MAY NEVER COLLAPSE AN ITEM. An
 * item leaves the individual list only when it is both old and redundant with
 * something a node has already cited — which, if it holds, means the candidate
 * consults something besides the clock and is less judgement-free than its own
 * body claims.
 *
 * The fixture is built so pure age fails it: all twenty-one records share one
 * timestamp, and only the twenty that repeat an already-mapped signature may
 * collapse.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { writeEvidence } from "../../src/processes/tree.js";

const OUTCOME = "Retention";
const NEED = "Users churn after week one";
const AGE_OUT_DAYS = 14;
const NOW = () => new Date("2026-08-12T00:00:00.000Z");
/** 42 days before NOW — comfortably past the 14-day limit, no ambiguity. */
const OLD = "2026-07-01T00:00:00.000Z";
/**
 * The same instant, handed to `writeEvidence` as the CAPTURE time.
 *
 * Ageing reads `fetchedAt` — when this vault pulled the record — rather than the
 * item's own `timestamp`, which is the producer's field and would let a drop-folder
 * note bury itself by dating itself 2019. So a fixture of genuinely old records has
 * to be captured long ago, not merely dated so; the assertions below are unchanged.
 */
const CAPTURED = new Date(OLD);

const REDUNDANT_BODY = "Users say the onboarding checklist is too long to finish in one sitting.";
const NOVEL_BODY = "Users say the export button silently fails on files over 50MB.";

const MAPPED_ID = "TRANSCRIPT:mapped-source.md";
const NOVEL_ID = "TRANSCRIPT:old-novel.md";
/** Twenty unmapped records, all as old as NOVEL_ID, all repeating MAPPED_ID's signature. */
const REDUNDANT_IDS = Array.from({ length: 20 }, (_, i) => `TRANSCRIPT:old-${String(i + 1).padStart(2, "0")}.md`);

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-age-out-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function seedFixture(): void {
  const v = buildPassContext(dir).vault;
  // The record already distilled into the tree — what makes REDUNDANT_BODY's
  // signature "already mapped to an opportunity".
  writeEvidence(dir, { id: MAPPED_ID, source: MAPPED_ID, title: "Checklist too long", timestamp: OLD, body: REDUNDANT_BODY }, "transcript", CAPTURED);
  v.createNode({ title: NEED, layer: "Opportunity", source: MAPPED_ID, evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);

  for (const id of REDUNDANT_IDS) {
    writeEvidence(dir, { id, source: id, title: "Checklist too long, again", timestamp: OLD, body: REDUNDANT_BODY }, "transcript", CAPTURED);
  }
  writeEvidence(dir, { id: NOVEL_ID, source: NOVEL_ID, title: "Export silently fails", timestamp: OLD, body: NOVEL_BODY }, "transcript", CAPTURED);
}

test("twenty items past the age limit that repeat a mapped signature collapse; the equally old novel item stays listed", () => {
  seedFixture();

  const work = computeNextWork(buildPassContext(dir).vault, dir, 3, NOW, undefined, AGE_OUT_DAYS);

  // The twenty redundant records are off the individual list …
  const listedIds = work.unmappedEvidence.map((e) => e.id);
  for (const id of REDUNDANT_IDS) expect(listedIds).not.toContain(id);
  // … and counted, not silently dropped: the true count and the oldest timestamp
  // both survive in the standing backlog line.
  expect(work.agedOutEvidence).toEqual({ count: 20, oldest: OLD });

  // Pure age is not the rule: were it, the equally-old novel item would have
  // collapsed with its neighbours. It has to survive, which is the load-bearing
  // assertion this file exists to pin.
  expect(listedIds).toContain(NOVEL_ID);

  // Nothing was deleted — every record from the fixture is still on disk.
  expect(fs.readdirSync(path.join(dir, ".ost-agent", "evidence")).length).toBe(1 + REDUNDANT_IDS.length + 1);
});

test("with no evidence.ageOutDays configured, nothing ages out no matter how old", () => {
  seedFixture();

  const work = computeNextWork(buildPassContext(dir).vault, dir, 3, NOW);

  expect(work.agedOutEvidence).toEqual({ count: 0, oldest: null });
  const listedIds = work.unmappedEvidence.map((e) => e.id);
  for (const id of REDUNDANT_IDS) expect(listedIds).toContain(id);
  expect(listedIds).toContain(NOVEL_ID);
});
