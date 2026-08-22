/**
 * "Filing corroboration clears the item and moves no rung" — the instrument behind
 * "An evidence item can be filed as corroboration of a node that already exists".
 *
 * The parent opportunity's sharpest sentence is that a need observed 76 times and a
 * need observed once look identical once each has a node. The corroboration verdict
 * fixes that by landing each observation on the node it bears on — but only if the
 * filing is the light act it claims to be. This file pins that at the scale a single
 * pass would actually file (thirty items, all one channel), and the load-bearing
 * assertion is the last one: thirty recordings of one channel are one channel observed
 * thirty times, and neither the node's evidence rung nor the rollup's source count may
 * read them as thirty voices.
 *
 * What a green here does not settle, verbatim from the assumption test: whether the
 * judgement "this confirms an existing need" was made correctly. This file pins the
 * mechanics of a filing and is blind to whether the filing was right — the
 * novelty-hiding failure the parent names needs a reader, not a spec.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, readEvidence, writeEvidence } from "../../src/processes/tree.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import { rollupTree } from "../../src/eval/rollup.js";
import { appendDisposition, corroborationsFor, readDispositionLedger } from "../../src/knowledge/dispositions.js";

const OUTCOME = "Retention";
const NEED = "Users churn after week one";
/** Thirty recordings of ONE channel — the scale and the shape the threshold names. */
const IDS = Array.from({ length: 30 }, (_, i) => `TRANSCRIPT:session-${String(i + 1).padStart(2, "0")}-same-stall.md`);

let dir: string;

const CLOCK = (): Date => new Date("2026-08-12T10:00:00.000Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-corroborate-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** The true size of a possibly-capped list: the cap names what it hid, so total = shown + hidden. */
function trueCount(shown: number, truncated: readonly { list: string; total: number }[], list: string): number {
  const entry = truncated.find((t) => t.list === list);
  return entry ? entry.total : shown;
}

test("thirty items filed against one opportunity: cleared from the sweep, counted as 30, no node created, no rung moved", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  for (const id of IDS) {
    writeEvidence(dir, { id, source: id, title: "Same stall, again", timestamp: "2026-08-01", body: "b" }, "transcript");
  }

  // Non-vacuity: all thirty are outstanding before anything is filed. The list is
  // capped, so the true count is read the way the cap says to read it.
  const before = computeNextWork(v, dir, 3);
  expect(trueCount(before.unmappedEvidence.length, before.truncated, "unmappedEvidence")).toBe(30);
  const nodesBefore = v.readTree().length;
  const nodeFile = path.join(dir, fileNameForTitle(NEED));
  const nodeBytesBefore = fs.readFileSync(nodeFile);
  const bucketBefore = rollupTree(v.readTree()).buckets.find((b) => b.title === NEED);

  for (const id of IDS) {
    appendDisposition(
      dir,
      {
        subject: id,
        kind: "evidence",
        state: "closed",
        reason: "another session with the stall the need already names",
        by: "operator",
        verdict: "corroborates",
        node: NEED,
      },
      byTitle(v.readTree()),
      CLOCK,
    );
  }

  // Cleared: the items are absent from `unmappedEvidence`, and the emptiness is
  // real rather than a cap hiding them — no truncation entry names that list.
  const after = computeNextWork(v, dir, 3);
  expect(after.unmappedEvidence).toHaveLength(0);
  expect(after.truncated.find((t) => t.list === "unmappedEvidence")).toBeUndefined();

  // Not deleted, and not hidden silently: every record is still on disk, and every
  // withdrawal is named on the response that made it.
  expect(readEvidence(dir).map((e) => e.id).sort()).toEqual([...IDS].sort());
  const withheld = after.withheldByDisposition.filter((w) => w.list === "unmappedEvidence");
  expect(trueCount(withheld.length, after.truncated, "withheldByDisposition")).toBe(30);

  // Counted: the node's corroboration count is 30, every entry naming this node.
  const filed = corroborationsFor(readDispositionLedger(dir), NEED);
  expect(filed).toHaveLength(30);
  expect(filed.map((c) => c.subject).sort()).toEqual([...IDS].sort());

  // No node was created — filing lands on the node that exists, not beside it.
  expect(v.readTree().length).toBe(nodesBefore);
  expect(v.readTree().some((n) => n.source !== undefined && IDS.includes(n.source))).toBe(false);

  // And no rung moved. Byte-identical is the bar: the node file — frontmatter
  // `evidence:` rung included — was not touched by thirty filings.
  expect(fs.readFileSync(nodeFile).equals(nodeBytesBefore)).toBe(true);
  expect(v.readTree().find((n) => n.title === NEED)?.evidence).toBe("assertion");

  // The ladder reads the same floor, and thirty recordings of one channel did not
  // become thirty sources: `corroborators` counts distinct node `source:` values,
  // which a ledger filing never writes.
  const bucketAfter = rollupTree(v.readTree()).buckets.find((b) => b.title === NEED);
  expect(bucketAfter?.weakestRung).toBe(bucketBefore?.weakestRung);
  expect(bucketAfter?.corroborators).toBe(bucketBefore?.corroborators);
});
