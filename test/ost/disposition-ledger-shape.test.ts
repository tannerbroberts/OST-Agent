/**
 * "One ledger shape can carry a disposition for evidence, solutions and opportunities
 * alike" — the feasibility question behind "A disposition record every bucket consults
 * before it lists anything".
 *
 * The belief under test is that the three faces of the same defect are close enough in
 * shape to share one record: an id, a disposition, a reason, a pass. Stated so it can be
 * false — an evidence item is identified by an ingest id and lives outside the tree, a
 * solution is identified by a title and lives in it, and an opportunity's disposition is
 * a claim about its children rather than about itself. If those need a discriminated
 * union per case, the general form has collapsed back into three special cases wearing
 * one name, and the two cheaper per-bucket fixes are the better buy.
 *
 * So the threshold is: all three disposition kinds round-trip through ONE entry type,
 * and every bucket's read path consults the ledger through ONE shared call. Any bucket
 * needing its own entry kind or its own read fails this.
 *
 * The assertions are input→output over the real `computeNextWork`, not a grep: a grep is
 * satisfied by a shared function name sitting beside three special cases. What pins
 * "one entry type" behaviourally is `kind is not a branch` below — a record written
 * under the wrong kind still settles its subject, which is only possible if the read
 * genuinely never looks at it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, writeEvidence } from "../../src/processes/tree.js";
import {
  appendDisposition,
  DISPOSITION_KINDS,
  dispositionLedgerPath,
  isDisposed,
  liveDispositions,
  readDispositionLedger,
  type DispositionKind,
} from "../../src/knowledge/dispositions.js";

const OUTCOME = "Retention";
const EVIDENCE_ID = "INBOX:corroborates-what-we-have.md";
const SHIPPED = "Onboarding checklist";
const SERVED = "Users churn after week one";

let dir: string;

const CLOCK = (): Date => new Date("2026-08-07T10:00:00.000Z");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-disposition-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * A vault carrying one instance of each of the three faces:
 *
 *   - an evidence record no node cites, which the sweep cannot ever see as read
 *     (mapped-ness is `source:` equality and nothing can add a `source:` to an
 *     existing node), so it is outstanding forever;
 *   - a solution with no assumption test under it, which is the shape a shipped
 *     solution has when its test never got written;
 *   - an opportunity with fewer solutions than `min`, which is the shape an
 *     opportunity has when its solution space really does live on its children.
 */
function threeFaces() {
  const v = buildPassContext(dir).vault;
  writeEvidence(
    dir,
    { id: EVIDENCE_ID, source: EVIDENCE_ID, title: "Same finding, again", timestamp: "2026-08-01", body: "b" },
    "inbox",
  );
  v.createNode({ title: SERVED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.createNode({ title: SHIPPED, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, SERVED);
  v.linkNodes(SERVED, SHIPPED);
  return v;
}

/** The tree an acknowledgement is filed against — read fresh, the way every caller does. */
const treeIndex = () => byTitle(buildPassContext(dir).vault.readTree());

/** Write one disposition through the single entry type. Identical call for all three kinds. */
function settle(subject: string, kind: DispositionKind, reason: string): void {
  appendDisposition(dir, { subject, kind, state: "closed", reason, by: "operator" }, treeIndex(), CLOCK);
}

describe("one entry type carries all three dispositions", () => {
  test("each of the three is outstanding until it is settled, and absent from its bucket after", () => {
    const v = threeFaces();

    // Non-vacuity first. If any of these were already absent, the assertions below
    // would pass without the ledger doing anything.
    const before = computeNextWork(v, dir, 3);
    expect(before.unmappedEvidence.map((e) => e.id)).toContain(EVIDENCE_ID);
    expect(before.solutionsMissingAssumptions.map((s) => s.title)).toContain(SHIPPED);
    expect(before.underservedOpportunities.map((o) => o.title)).toContain(SERVED);
    expect(before.done).toBe(false);

    settle(EVIDENCE_ID, "evidence", "corroborates a node the tree already has");
    settle(SHIPPED, "solution", "shipped");
    settle(SERVED, "opportunity", "its solution space lives on its children");

    const after = computeNextWork(v, dir, 3);
    expect(after.unmappedEvidence.map((e) => e.id)).not.toContain(EVIDENCE_ID);
    expect(after.solutionsMissingAssumptions.map((s) => s.title)).not.toContain(SHIPPED);
    expect(after.underservedOpportunities.map((o) => o.title)).not.toContain(SERVED);
  });

  test("the fourth bucket takes the same entry — a settled solution stops owing an instrument too", () => {
    // A solution's work shows up in two lists depending on how far it got: no test at
    // all lands it in `solutionsMissingAssumptions`, a prose-only test lands it in
    // `solutionsMissingInstruments`. Both read the ledger through the same call, so one
    // `solution` entry settles it wherever it happens to be sitting — which is the same
    // claim as "one entry type", made against the bucket most likely to have grown its
    // own rule (it is computed in another module, `src/eval/buildable.ts`).
    const v = threeFaces();
    v.createNode({ title: "Checklist audit", layer: "AssumptionTest", evidence: "assertion", body: "prose only", tags: [], links: [] });
    v.linkNodes(SHIPPED, "Checklist audit");
    expect(computeNextWork(v, dir, 3).solutionsMissingInstruments).toContain(SHIPPED);

    settle(SHIPPED, "solution", "shipped");
    expect(computeNextWork(v, dir, 3).solutionsMissingInstruments).not.toContain(SHIPPED);
  });

  test("a pass can finally be honestly done — the completion signal moves", () => {
    // The point of the whole candidate. `done: true` was unreachable while items no
    // derivation can ever clear sat on the lists, so the loop's only stopping condition
    // carried no information.
    const v = threeFaces();
    expect(computeNextWork(v, dir, 3).done).toBe(false);

    settle(EVIDENCE_ID, "evidence", "corroborates a node the tree already has");
    settle(SHIPPED, "solution", "shipped");
    settle(SERVED, "opportunity", "its solution space lives on its children");

    expect(computeNextWork(v, dir, 3).done).toBe(true);
  });

  test("kind is not a branch: a record filed under the wrong kind still settles its subject", () => {
    // The load-bearing assertion for "one entry type". If the read consulted `kind`,
    // an evidence id filed as an opportunity would not clear the evidence bucket — and
    // the schema would be three schemas sharing a name.
    const v = threeFaces();
    settle(EVIDENCE_ID, "opportunity", "kind is metadata for the auditor");
    settle(SERVED, "evidence", "kind is metadata for the auditor");

    const work = computeNextWork(v, dir, 3);
    expect(work.unmappedEvidence.map((e) => e.id)).not.toContain(EVIDENCE_ID);
    expect(work.underservedOpportunities.map((o) => o.title)).not.toContain(SERVED);
  });

  test("every kind writes the same fields — no case carries one the others do not", () => {
    for (const kind of DISPOSITION_KINDS) settle(`subject-${kind}`, kind, "r");
    const written = fs
      .readFileSync(dispositionLedgerPath(dir), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => Object.keys(JSON.parse(l) as object).sort());
    expect(written).toHaveLength(DISPOSITION_KINDS.length);
    for (const keys of written) expect(keys).toEqual(["by", "kind", "reason", "state", "subject", "ts"]);
  });
});

describe("every bucket reads the ledger through one shared call", () => {
  test("the same one-argument predicate answers for all three subjects", () => {
    // `isDisposed` takes a subject and nothing else: no kind, no layer, no bucket
    // name. A bucket that needed its own read would need to pass something more.
    settle(EVIDENCE_ID, "evidence", "corroborates");
    settle(SHIPPED, "solution", "shipped");
    settle(SERVED, "opportunity", "served by children");
    const ledger = readDispositionLedger(dir);
    for (const subject of [EVIDENCE_ID, SHIPPED, SERVED]) expect(isDisposed(ledger, subject)).toBe(true);
    expect(isDisposed(ledger, "something nobody settled")).toBe(false);
  });

  test("one reopen puts a subject back on its bucket, whichever bucket that is", () => {
    // The read is shared, so reversal is too — there is no per-bucket reopen path to
    // forget to write. An irreversible hide is the mirror of an unclearable red.
    const v = threeFaces();
    settle(EVIDENCE_ID, "evidence", "corroborates");
    settle(SERVED, "opportunity", "served by children");
    appendDisposition(
      dir,
      { subject: SERVED, kind: "opportunity", state: "reopened", reason: "children are not solutions", by: "operator" },
      treeIndex(),
      CLOCK,
    );

    const work = computeNextWork(v, dir, 3);
    expect(work.underservedOpportunities.map((o) => o.title)).toContain(SERVED);
    expect(work.unmappedEvidence.map((e) => e.id)).not.toContain(EVIDENCE_ID);
    expect(liveDispositions(readDispositionLedger(dir)).map((d) => d.subject)).toEqual([EVIDENCE_ID]);
  });
});

describe("nothing is hidden silently", () => {
  test("every withheld item is named on the response that withheld it, with its reason and author", () => {
    const v = threeFaces();
    settle(EVIDENCE_ID, "evidence", "corroborates a node the tree already has");
    settle(SHIPPED, "solution", "shipped");
    settle(SERVED, "opportunity", "its solution space lives on its children");

    const work = computeNextWork(v, dir, 3);
    const withheld = work.withheldByDisposition;
    expect(withheld.map((w) => w.subject).sort()).toEqual([EVIDENCE_ID, SERVED, SHIPPED].sort());
    for (const w of withheld) {
      expect(w.by).toBe("operator");
      expect(w.reason).not.toBe("");
      expect(w.list).not.toBe("");
    }
    // And on a done tree, where these are the only items not listed, the summary still
    // says so — a `done` reached by settling is a different fact from one reached by doing.
    expect(work.done).toBe(true);
    expect(work.summary).toContain("withheld");
    expect(work.summary).toContain(SHIPPED);
  });

  test("a ledger line that will not parse closes nothing", () => {
    // Fail-open in the only safe direction: an unreadable ledger surfaces MORE work,
    // never less. A `state` a hand edit mangled must not be read as `closed`.
    const v = threeFaces();
    settle(SHIPPED, "solution", "shipped");
    fs.appendFileSync(dispositionLedgerPath(dir), `{"ts":"2026-08-07","subject":"${SERVED}","kind":"opportunity"}\n`);
    fs.appendFileSync(dispositionLedgerPath(dir), "not json at all\n");

    const ledger = readDispositionLedger(dir);
    expect(ledger.damaged).toBe(2);
    expect(isDisposed(ledger, SERVED)).toBe(false);
    const work = computeNextWork(v, dir, 3);
    expect(work.underservedOpportunities.map((o) => o.title)).toContain(SERVED);
    expect(work.summary).toContain("would not parse");
  });

  test("a dismissal with no author or no reason is refused at the funnel", () => {
    // The only safeguard on a write that removes work by asserting is that a human can
    // read the assertion and see whose it was. Enforced here, not at the caller.
    expect(() => appendDisposition(dir, { subject: SHIPPED, kind: "solution", state: "closed", reason: "r", by: " " }, treeIndex(), CLOCK)).toThrow(/attribution/);
    expect(() => appendDisposition(dir, { subject: SHIPPED, kind: "solution", state: "closed", reason: "", by: "operator" }, treeIndex(), CLOCK)).toThrow(/reason/);
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
  });
});

describe("the ledger lives where the sweep reads", () => {
  test("it is a sidecar file, not a node section", () => {
    // Established by direct test on 2026-08-05 and not negotiable: a `## Disposition`
    // section in a node body was tried and the sweep did not see it. This pins the
    // constraint rather than restating it — the ledger is on disk under `.ost-agent/`,
    // in the same place the ask ledger and the evidence records are, which is the walk
    // `computeNextWork` already makes.
    settle(SHIPPED, "solution", "shipped");
    const file = dispositionLedgerPath(dir);
    expect(file.startsWith(path.join(dir, ".ost-agent"))).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
  });
});
