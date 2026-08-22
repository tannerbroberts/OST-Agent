/**
 * "Attach thirty self-observations to one node and require the rung not to move" —
 * the instrument behind "Let a friction record corroborate an existing opportunity
 * instead of demanding a new node".
 *
 * The solution's own stated failure mode is what this file is for, verbatim: "It
 * hands the agent a cheap way to make a node look well-sourced: attaching thirty of
 * its own transcripts to one opportunity produces '30 sources' that are all the same
 * actor observing itself, which is not thirty independent voices and must not read as
 * one." The parent Assumption puts the load on the rollup's support clause — "the
 * per-bucket 'N source(s)' figure counts sources, and nothing in that line says how
 * many actors they came from" — because that line is what an operator reads to judge
 * the tree at a glance.
 *
 * So the ceiling is tested on BOTH routes a recording can reach a node by, and they
 * are different mechanisms with the same failure:
 *
 *   1. **Filing** (`dispose --verdict corroborates`) — the route this solution adds.
 *      A filing writes no `source:`, so the source count cannot move, and
 *      `test/evidence/corroborate-disposition.test.ts` already pins that. Repeated
 *      here only where it touches the actor count.
 *   2. **Citing** (a node created with `source:`) — the route that exists today, and
 *      the one that actually inflates. Thirty transcripts distilled into thirty nodes
 *      is thirty sources on the rollup line, and until this file that rendered
 *      identically to thirty customers saying the same thing.
 *
 * What a green here does not settle: whether any particular filing was judged
 * correctly. This pins that volume from one actor cannot buy standing; it is blind to
 * whether the thirty records belonged on that node at all.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import { renderRollup, rollupTree } from "../../src/eval/rollup.js";
import { appendDisposition } from "../../src/knowledge/dispositions.js";
import { actorKey, evidenceActors, readTrustLedger, rungOf } from "../../src/knowledge/actor-trust.js";
import type { Actor } from "../../src/adapters/source.js";

const OUTCOME = "Retention";
const NEED = "Users churn after week one";

/** Thirty recordings of ONE channel — the scale and the shape the threshold names. */
const IDS = Array.from({ length: 30 }, (_, i) => `TRANSCRIPT:session-${String(i + 1).padStart(2, "0")}-same-stall.md`);

let dir: string;

const CLOCK = (): Date => new Date("2026-08-12T10:00:00.000Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-actor-ceiling-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Capture `ids` as stored records from `actor`, the way the fetching surface stamps them. */
function capture(ids: readonly string[], actor: Actor): void {
  for (const id of ids) {
    writeEvidence(dir, { id, source: id, title: "Same stall, again", timestamp: "2026-08-01", body: "b" }, actor);
  }
}

/** The bucket line as the operator reads it, with the stamps a vault-holding surface has. */
function bucket(vaultDir: string, tree: ReturnType<ReturnType<typeof buildPassContext>["vault"]["readTree"]>) {
  const rollup = rollupTree(tree, evidenceActors(vaultDir));
  return { row: rollup.buckets.find((b) => b.title === NEED), text: renderRollup(rollup) };
}

test("thirty transcripts cited by thirty nodes are thirty sources and ONE actor, and the line says so", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  capture(IDS, "transcript");

  // The inflating route, done exactly as the tree does it today: one node per
  // record, each citing the id it was distilled from.
  IDS.forEach((id, i) => {
    const title = `Stall report ${i + 1}`;
    v.createNode({ title, layer: "Opportunity", evidence: "assertion", source: id, body: "x", tags: [], links: [] });
    v.linkNodes(NEED, title);
  });

  const { row, text } = bucket(dir, v.readTree());

  // Non-vacuity: the source count really did go to thirty. If it had not, the
  // actor assertion below would pass for the wrong reason.
  expect(row?.corroborators).toBe(30);

  // The claim. Thirty recordings of one channel are one voice, and the ceiling
  // that says so is keyed on the actor the FETCHING surface stamped — not on the
  // `TRANSCRIPT:` prefix, which the citing node chose.
  expect(row?.actors).toEqual(["instrument:transcript"]);

  // And the operator's line carries it. The bare "30 source(s)" this replaces is
  // the sentence the Assumption says invites a conclusion the sources do not
  // support, so it must not survive anywhere in the rendered view.
  expect(text).toContain("30 source(s) from 1 actor(s)");
  expect(text).toContain("all 30 source(s) speak from one actor (instrument:transcript)");
  expect(text).toContain("not 30 independent voices");
  expect(text).not.toContain("30 source(s), rests on");
});

test("thirty filings against one node move no rung, add no source and add no actor", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  capture(IDS, "transcript");

  const nodeFile = path.join(dir, fileNameForTitle(NEED));
  const bytesBefore = fs.readFileSync(nodeFile);
  const before = bucket(dir, v.readTree()).row;

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
      CLOCK,
    );
  }

  const after = bucket(dir, v.readTree()).row;

  // The filing is the light act it claims to be: no rung, no source, no voice.
  // The third is the one this file adds — a route that raised the actor count
  // would buy standing with volume through the back door the first test closes.
  expect(fs.readFileSync(nodeFile).equals(bytesBefore)).toBe(true);
  expect(after?.weakestRung).toBe(before?.weakestRung);
  expect(after?.corroborators).toBe(before?.corroborators);
  expect(after?.actors).toEqual(before?.actors);
  expect(after?.actors).toEqual([]);
});

test("sources from three channels read as three actors, and no one-actor clause is printed", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);

  // Non-vacuity for the warning: the clause above must be a fact about who spoke,
  // not a thing the renderer says whenever a count is large.
  capture(["TRANSCRIPT:a.md", "TRANSCRIPT:b.md"], "transcript");
  capture(["INBOX:c.md"], "inbox");
  capture(["SLACK:d"], "slack");
  const cited = ["TRANSCRIPT:a.md", "TRANSCRIPT:b.md", "INBOX:c.md", "SLACK:d"];
  cited.forEach((id, i) => {
    const title = `Report ${i + 1}`;
    v.createNode({ title, layer: "Opportunity", evidence: "assertion", source: id, body: "x", tags: [], links: [] });
    v.linkNodes(NEED, title);
  });

  const { row, text } = bucket(dir, v.readTree());
  expect(row?.corroborators).toBe(4);
  expect(row?.actors).toEqual(["channel:inbox", "channel:slack", "instrument:transcript"]);
  expect(text).toContain("4 source(s) from 3 actor(s)");
  expect(text).not.toContain("speak from one actor");
});

test("sources nobody stamped are counted as provenance, never as corroboration", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);

  // `agent-run:` and `agent-ideated:` are what the agent writes when nothing
  // fetched anything. They resolve to no actor, and the alternative — folding them
  // into one anonymous voice — is the same inflation with a quieter name.
  ["agent-run:sweep-1", "agent-ideated:sweep-2", "agent-run:sweep-3"].forEach((id, i) => {
    const title = `Idea ${i + 1}`;
    v.createNode({ title, layer: "Opportunity", evidence: "assertion", source: id, body: "x", tags: [], links: [] });
    v.linkNodes(NEED, title);
  });

  const { row, text } = bucket(dir, v.readTree());
  expect(row?.corroborators).toBe(3);
  expect(row?.actors).toEqual([]);
  expect(text).toContain("3 source(s) from 0 actor(s)");
  expect(text).toContain("none of the 3 source(s) names an actor any surface stamped");
});

test("a caller that cannot establish the actors says so instead of printing a bare source count", () => {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  capture(IDS, "transcript");
  IDS.forEach((id, i) => {
    const title = `Stall report ${i + 1}`;
    v.createNode({ title, layer: "Opportunity", evidence: "assertion", source: id, body: "x", tags: [], links: [] });
    v.linkNodes(NEED, title);
  });

  // No stamps supplied — `composeStandingBriefing` is a pure function of the tree
  // and genuinely has none. The omission is reported rather than assumed away: a
  // count with no voice behind it must not read as thirty voices either.
  const blind = rollupTree(v.readTree());
  expect(blind.buckets.find((b) => b.title === NEED)?.actors).toBeNull();
  expect(renderRollup(blind)).toContain("30 source(s) from unestablished actors");
  expect(renderRollup(blind)).not.toContain("30 source(s), rests on");
});

test("volume does not raise the ceiling: one record and thirty leave the actor standing where it stood", () => {
  const key = actorKey("instrument", "transcript");

  capture([IDS[0]], "transcript");
  const afterOne = rungOf(readTrustLedger(dir), key);

  capture(IDS.slice(1), "transcript");
  const afterThirty = rungOf(readTrustLedger(dir), key);

  // Standing is earned by tests recorded against a source, never by how often the
  // source spoke. Thirty captures append no trust record at all, so the rung is
  // the kind's own — which is the ceiling the Assumption says must hold.
  expect(evidenceActors(dir).size).toBe(30);
  expect(afterThirty).toBe(afterOne);
});
