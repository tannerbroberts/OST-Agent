/**
 * B11, the half with teeth: a withdrawn source becomes *work*, and the work has a
 * way out.
 *
 * `ost_check` names the affected nodes and deliberately does not fail (see
 * `test/eval/suspect-source.test.ts` and `appendStanding`'s comment for that
 * argument). Naming alone would be a report nobody is obliged to read, so the
 * consequence lives on the gate the unattended sweep actually reads: `done`.
 *
 * **Which is only safe because the escape is one call per node.** R2's lesson,
 * relearned five times in Gate F, is that a stopping state with no way out but a
 * human editing a file is a defect on a system whose defining property is being
 * left unattended. Exactly ONE escape exists here for the agent, and it is pinned
 * below: `ost_annotate` on the node, the same clear path every other hygiene issue
 * has, which writes the doubt onto the node permanently.
 *
 * **The second escape this file used to pin is gone, and its absence is now itself
 * pinned.** Under the retired host ledger a re-promotion undid a demotion, so
 * "re-rank the source" cleared every affected node at once. The actor ledger does
 * not work that way: a strike stands until a human runs `ost-agent trust reset`,
 * and `direction: 'corroborated'` is refused unless it names a recorded result
 * joined to a node citing this source. So the sweep's only move is annotation —
 * which makes the wedge question sharper, not softer, and the test that `done`
 * comes back is the one that answers it.
 *
 * The third pinned property is the one a suppression-based clear always loses: an
 * annotation clears the withdrawal it was written about, and NOT the next one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { computeNextWork, HYGIENE_ONLY_RULES } from "../../src/mcp/next-work.js";
import { SUSPECT_SOURCE_RULE } from "../../src/ost/census.js";
import { appendObservation, trustLedgerPath, type NewObservation } from "../../src/knowledge/actor-trust.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HOST = "analytics-weekly.example";
const OTHER = "steady.example";

const OUTCOME = "Players keep playing";
const SEEDED = "Weekly churn is under-reported";
const UNAFFECTED = "Support tickets spike on release day";
const SOLUTION = "Ship a changelog";
const ASSUMPTION = "Diff two builds and count the deltas";

let dir: string;
let vault: Vault;

function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  vault.createNode({ body: `prose for ${node.title}`, tags: [], links: [], evidence: "assertion", ...node } as OstNode);
}

/**
 * A tree that is already fully maintained at `min: 0` — every other `done` term
 * empty, so `hygieneIssues` is the only one that can move.
 *
 * Two Opportunities cite the web: one from the publisher that will be struck and
 * one from a publisher that will not. The second is the control that keeps every
 * assertion below from passing on "the ledger made everything suspect".
 */
function maintainedTree(): void {
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: SEEDED, layer: "Opportunity", source: `WEB:${HOST}` });
  vault.linkNodes(OUTCOME, SEEDED);
  put({ title: UNAFFECTED, layer: "Opportunity", source: `WEB:${OTHER}` });
  vault.linkNodes(OUTCOME, UNAFFECTED);
  put({ title: SOLUTION, layer: "Solution" });
  vault.linkNodes(SEEDED, SOLUTION);
  put({ title: ASSUMPTION, layer: "AssumptionTest" });
  vault.linkNodes(SOLUTION, ASSUMPTION);
}

/**
 * Append a ledger observation with a fixed stamp.
 *
 * `appendObservation` takes the clock as an argument for exactly this reason, so
 * no `Date.now()` reaches this file. A planted history is also the honest case:
 * the ledger is append-only and a vault's history predates any one run. The
 * end-to-end assertion — a strike written by `ost_rank_source` itself — lives in
 * `test/eval/suspect-source.test.ts`, which is where the criterion's own check is.
 */
function append(rec: NewObservation, ts: string): void {
  appendObservation(dir, rec, () => new Date(ts));
}

const strike = (id: string, ts: string, reason = "the last three claims failed replication") =>
  append({ kind: "web", id, type: "strike", reason, by: "test" }, ts);

const supported = (id: string, ts: string, testName: string) =>
  append({ kind: "web", id, type: "corroboration", test: testName, verdict: "supported", by: "test" }, ts);

const reset = (id: string, ts: string) =>
  append({ kind: "web", id, type: "reset", reason: "a human reviewed the evidence", by: "human:cli" }, ts);

/** `min: 0`, so the other three `done` terms cannot mask the hygiene one. */
const work = () => computeNextWork(new Vault(dir), dir, 0);

const suspect = () => work().hygieneIssues.filter((i) => i.rule === SUSPECT_SOURCE_RULE);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-suspect-work-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  maintainedTree();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the fixture is the control", () => {
  test("a maintained tree whose sources are corroborated is done, and names nothing suspect", () => {
    supported(HOST, "2026-01-01T00:00:00.000Z", "Diff two builds and count the deltas");
    // Without this, every "done: false" below would be indistinguishable from a
    // fixture that was never done in the first place.
    expect(work().done).toBe(true);
    expect(suspect()).toEqual([]);
  });
});

describe("a withdrawal becomes work", () => {
  beforeEach(() => {
    supported(HOST, "2026-01-01T00:00:00.000Z", "Diff two builds and count the deltas");
    strike(HOST, "2026-06-01T00:00:00.000Z");
  });

  test("done goes false and the node whose source is the withdrawn host is named", () => {
    const w = work();
    expect(w.done).toBe(false);
    expect(suspect().map((i) => i.title)).toEqual([SEEDED]);
    expect(w.summary).toContain("hygiene issue");
  });

  test("the issue names the source, both rungs and the withdrawal's own date", () => {
    const issue = suspect()[0].issue;
    expect(issue).toContain(`web:${HOST}`);
    expect(issue).toContain("was 'expert', now 'assertion'");
    expect(issue).toContain("2026-06-01T00:00:00.000Z");
    // One line, or `annotate` writes something the suppression reader can never
    // match back and the issue is re-reported forever (W12's third wedge).
    expect(issue).not.toContain("\n");
  });

  test("the issue does not offer a clear the agent does not have", () => {
    // It used to say "re-ranking the source clears this", which was true of the
    // host ledger and is false of this one. A hygiene issue whose stated escape
    // always refuses is R3's wedge wearing a suggestion: the sweep would spend
    // calls on `ost_rank_source` and never clear the block.
    const issue = suspect()[0].issue;
    expect(issue).not.toMatch(/re-rank/i);
    expect(issue).toContain("only a human can restore the source");
  });

  test("NON-VACUITY: the node citing a source that kept its standing is not named", () => {
    expect(suspect().map((i) => i.title)).not.toContain(UNAFFECTED);
  });

  test("no invariant fires — this is a report about the world, not about the tree's shape", () => {
    // The R3 argument, executed. A strike is free and reachable in one call, so an
    // invariant here would be the clearability table's first `create: true` cell
    // since R2 and R6 closed the last two — and R3 then demands a one-call clear
    // that does not exist. The tree is structurally perfect throughout.
    expect(checkInvariants(vault.readTree())).toEqual([]);
  });

  test("annotating the node clears it — the ONLY escape the unattended sweep has", () => {
    const issue = suspect()[0];
    vault.annotate(issue.title, issue.issue);
    expect(suspect()).toEqual([]);
    expect(work().done).toBe(true);
  });

  test("the sweep's escape survives the issue text going back through the write boundary", () => {
    // The clear path is `ost_annotate`, which refuses reserved headings and
    // wrapped wikilinks. An issue the vault will not accept is a `done: false`
    // with no way out at all — the exact wedge, one layer down from the one above.
    const issue = suspect()[0];
    expect(() => vault.annotate(issue.title, issue.issue)).not.toThrow();
  });

  test("a human reset clears it everywhere at once, with nothing written to any node", () => {
    reset(HOST, "2026-07-01T00:00:00.000Z");
    expect(suspect()).toEqual([]);
    expect(work().done).toBe(true);
    // The suspicion was only ever derived — no node was touched by any of this.
    expect(vault.read(SEEDED).body).not.toContain("suspect source");
  });

  test("a corroboration does NOT clear it — the agent cannot vote a struck source back up", () => {
    // The self-certification question, asked at the ledger. If a later
    // `supported` record cleared a strike, the agent could withdraw and restore
    // standing at will and DEC-2's "earned" would again be a word in a tool
    // description. `explainRung` returns the floor while any strike stands, and
    // this is the assertion that keeps the report agreeing with it.
    supported(HOST, "2026-07-01T00:00:00.000Z", "Some other test entirely");
    expect(suspect().map((i) => i.title)).toEqual([SEEDED]);
    expect(work().done).toBe(false);
  });

  test("a SECOND withdrawal is reported again, past the first one's annotation", () => {
    const first = suspect()[0];
    vault.annotate(first.title, first.issue);
    expect(suspect()).toEqual([]);

    reset(HOST, "2026-07-01T00:00:00.000Z");
    strike(HOST, "2026-08-01T00:00:00.000Z", "wrong again, on a new claim");

    // Suppression matches the issue string exactly. Carrying the withdrawal's own
    // timestamp in the text is the whole reason the second one is visible; drop it
    // and a source can be re-struck forever behind one stale annotation.
    const second = suspect();
    expect(second.map((i) => i.title)).toEqual([SEEDED]);
    expect(second[0].issue).not.toBe(first.issue);
    expect(second[0].issue).toContain("2026-08-01T00:00:00.000Z");
    expect(work().done).toBe(false);
  });
});

describe("the shape of the rule", () => {
  test("it is a hygiene-only rule — stricter than `check`, which is the safe direction", () => {
    expect(HYGIENE_ONLY_RULES as readonly string[]).toContain(SUSPECT_SOURCE_RULE);
    const invariants = fs.readFileSync(path.join(repoRoot, "src/eval/invariants.ts"), "utf8");
    // Grepped rather than reasoned about, for the reason `rule-parity.test.ts`
    // greps its rule list: a hygiene-only rule that quietly acquired an invariant
    // would flip the R3 cell this design was chosen to avoid.
    expect(invariants).not.toContain(`"${SUSPECT_SOURCE_RULE}"`);
  });

  test("`/ost-pass` cannot rank a source, so annotation is its only way out", () => {
    // The fact the whole wedge argument rests on, read off the shipped command
    // file rather than remembered. If `ost_rank_source` were ever granted to the
    // unattended sweep, this design would need re-arguing — and this line is where
    // that conversation starts.
    const md = fs.readFileSync(path.join(repoRoot, ".claude/commands/ost-pass.md"), "utf8");
    const granted = md.match(/^allowed-tools:\s*(.+)$/m)![1];
    expect(granted).not.toContain("ost_rank_source");
    expect(granted).toContain("ost_annotate");
  });

  test("no ledger at all changes nothing — a vault that never ranked a source is unaffected", () => {
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
    expect(work().done).toBe(true);
    expect(suspect()).toEqual([]);
  });
});
