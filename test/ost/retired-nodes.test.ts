/**
 * Z4 — retired nodes leave the denominator, and leave a name behind them.
 *
 * "Nothing is ever deleted" plus "arbitrarily large" means the set a quadratic
 * pass runs over only grows. A node the tree abandoned three months ago is still
 * being compared against every other title on every `ost_next_work`, and still
 * generating hygiene work nobody will ever do.
 *
 * The whole difficulty is that retirement is a way of removing something from a
 * count, and this repo's history is a list of counts that shrank quietly. So
 * there are two halves here and they are separated on purpose:
 *
 *   **Archive** (`<vault>/archive/`) — a human moving a file at a shell. No tool
 *   can express it: `Vault.nodePath` refuses a title that resolves to more than
 *   one path segment, and the class has no rename, move or delete. Unforgeable,
 *   therefore applied at every read. The change is not that these files stop
 *   being counted — they never were, the walk did not descend — but that they
 *   are now NAMED instead of invisible.
 *
 *   **Status** (`deferred`) — a status the agent can set on itself, in one call.
 *   Applied to the near-duplicate scan and to nothing else. If it reached
 *   `checkInvariants` or `done`, "retire it" would be a tool for making a
 *   dangling link or a self-validation contradiction disappear, which is the
 *   forging path B1 and B2 closed by other means. The tests below plant exactly
 *   that attack and require it to fail.
 *
 * `formatCensus` is the precedent both halves follow: an excluded file is
 * counted AND named, because "4 dropped" tells an operator a number is wrong
 * while `Old idea.md` tells them what to open.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import {
  ARCHIVE_DIRNAME,
  RETIRED_STATUSES,
  formatCensus,
  isRetiredNode,
  withoutRetiredNodes,
} from "../../src/ost/census.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import type { OstNode } from "../../src/ost/node.js";

const OUTCOME = "Players keep playing";
/**
 * Two Opportunities that share five of seven significant tokens — Jaccard 0.71,
 * just over the 0.7 threshold. Chosen so the pair is a duplicate by a margin
 * that does not depend on the stopword list staying exactly as it is.
 */
const DUPLICATE_A = "Players cannot find the export button here";
const DUPLICATE_B = "Players cannot find the export button there";

let dir: string;
let vault: Vault;

function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  vault.createNode({ body: `prose for ${node.title}`, tags: [], links: [], evidence: "assertion", ...node } as OstNode);
}

/** A legal tree carrying exactly one near-duplicate pair and nothing else wrong. */
function treeWithOneDuplicatePair(): void {
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: DUPLICATE_A, layer: "Opportunity" });
  put({ title: DUPLICATE_B, layer: "Opportunity" });
  vault.linkNodes(OUTCOME, DUPLICATE_A);
  vault.linkNodes(OUTCOME, DUPLICATE_B);
}

const work = () => computeNextWork(new Vault(dir), dir, 0);
const duplicateIssues = () => work().hygieneIssues.filter((i) => i.rule === "near-duplicate");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z4-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the vocabulary of retirement is the source's, not an invented one", () => {
  test("exactly one status retires a node, and widening that needs this line edited", () => {
    // The same shape as `NOT_DONE_BLOCKING`'s pin in test/mcp/rule-parity.test.ts:
    // exact equality, so adding a second retiring status is an argument someone
    // has to make in a diff rather than a line that slips through. Every other
    // member of the `NodeStatus` union means the work is live (`in-discovery`),
    // succeeded (`validated`, `shipped`), or is the marker stamped on everything
    // the agent creates (`unvalidated`).
    expect([...RETIRED_STATUSES]).toEqual(["deferred"]);
    expect(RETIRED_STATUSES).not.toContain("validated");
  });

  test("isRetiredNode reads the status and nothing else", () => {
    expect(isRetiredNode({ status: "deferred" })).toBe(true);
    expect(isRetiredNode({ status: "unvalidated" })).toBe(false);
    expect(isRetiredNode({})).toBe(false);
  });
});

describe("readTreeCensus supports the filter, and defaults to not applying it", () => {
  beforeEach(() => treeWithOneDuplicatePair());

  test("by default a deferred node is still a node — every gate keeps seeing it", () => {
    vault.setStatus(DUPLICATE_B, "deferred", "superseded");

    const census = vault.readTreeCensus();
    expect(census.nodes.map((n) => n.title)).toContain(DUPLICATE_B);
    expect(census.retired).toEqual([]);
    // The default is what `readTree` is built on, which is what every gate reads.
    expect(vault.readTree().map((n) => n.title)).toContain(DUPLICATE_B);
  });

  test("with the filter on, it is withheld and named — never silently dropped", () => {
    vault.setStatus(DUPLICATE_B, "deferred", "superseded");

    const census = vault.readTreeCensus({ excludeRetired: true });
    expect(census.nodes.map((n) => n.title)).not.toContain(DUPLICATE_B);
    expect(census.retired).toHaveLength(1);
    expect(census.retired[0].file).toBe(`${DUPLICATE_B}.md`);
    expect(census.retired[0].reason).toContain("deferred");

    // The denominator the counter reports is unchanged: the file was examined,
    // it just did not come back as a node. Reporting a smaller `examined` would
    // make a retirement look like a file that went missing.
    expect(census.examined).toBe(3);
    expect(vault.readLiveTree().map((n) => n.title)).not.toContain(DUPLICATE_B);
  });

  test("with nothing retired, the filter is a no-op — the control for the two above", () => {
    const filtered = vault.readTreeCensus({ excludeRetired: true });
    expect(filtered.nodes).toHaveLength(3);
    expect(filtered.retired).toEqual([]);
    expect(withoutRetiredNodes(vault.readTreeCensus()).nodes).toHaveLength(3);
  });
});

describe("the archive directory is read to be named, and cannot be written to", () => {
  beforeEach(() => treeWithOneDuplicatePair());

  function archive(title: string): void {
    const archiveDir = path.join(dir, ARCHIVE_DIRNAME);
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(path.join(dir, `${title}.md`), path.join(archiveDir, `${title}.md`));
  }

  test("an archived node is named as retired and is in no tree, filter or no filter", () => {
    archive(DUPLICATE_B);

    for (const census of [vault.readTreeCensus(), vault.readTreeCensus({ excludeRetired: true })]) {
      expect(census.nodes.map((n) => n.title)).not.toContain(DUPLICATE_B);
      expect(census.retired.map((r) => r.file)).toEqual([`${ARCHIVE_DIRNAME}/${DUPLICATE_B}.md`]);
      expect(census.retired[0].reason).toContain("archived");
    }
  });

  test("formatCensus names the archived file, it does not merely count it", () => {
    archive(DUPLICATE_B);
    const line = formatCensus(vault.readTreeCensus(), 2);

    expect(line).toContain("retired");
    expect(line).toContain(DUPLICATE_B);
    // The control: with nothing retired the section is absent entirely, so its
    // presence above is a fact about the vault rather than boilerplate.
    fs.rmSync(path.join(dir, ARCHIVE_DIRNAME), { recursive: true, force: true });
    expect(formatCensus(vault.readTreeCensus(), 2)).not.toContain("retired");
  });

  test("no title can put a file in the archive — the separator does not survive", () => {
    // This is why the archive half is allowed to apply to every read. A title
    // that looks like a path is sanitized to a single segment, so the node lands
    // beside the others at the root and the archive stays a human-only door.
    put({ title: `${ARCHIVE_DIRNAME}/Smuggled`, layer: "Opportunity" });

    expect(fs.existsSync(path.join(dir, ARCHIVE_DIRNAME))).toBe(false);
    expect(fs.readdirSync(dir)).toContain("archive Smuggled.md");
    expect(vault.readTree().map((n) => n.title)).toContain("archive Smuggled");
  });
});

describe("the duplicate scan uses the filter — and only the duplicate scan does", () => {
  beforeEach(() => treeWithOneDuplicatePair());

  test("the pair is flagged while both nodes are live", () => {
    // The non-vacuity control for every assertion below: if this fixture stopped
    // producing a duplicate issue, "retiring it removes the issue" would be true
    // of a tree that never had one.
    const issues = duplicateIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe(DUPLICATE_B);
    expect(work().done).toBe(false);
  });

  test("retiring one of the pair takes it out of the scan, and says so", () => {
    vault.setStatus(DUPLICATE_B, "deferred", "superseded by the other one");

    const after = work();
    expect(after.hygieneIssues.filter((i) => i.rule === "near-duplicate")).toEqual([]);

    // Withheld, named, and named in the prose a human reads — the `formatCensus`
    // rule applied to this response. A retirement that shrank the scan silently
    // would be indistinguishable from the scan breaking.
    expect(after.retiredFromDuplicateScan).toEqual([
      { node: DUPLICATE_B, reason: expect.stringContaining("deferred") },
    ]);
    expect(after.summary).toContain(DUPLICATE_B);
    expect(after.summary).toContain("duplicate scan only");
  });

  test("an archived node leaves the scan too, without any status being set", () => {
    const archiveDir = path.join(dir, ARCHIVE_DIRNAME);
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.renameSync(path.join(dir, `${DUPLICATE_B}.md`), path.join(archiveDir, `${DUPLICATE_B}.md`));

    const after = work();
    expect(after.hygieneIssues.filter((i) => i.rule === "near-duplicate")).toEqual([]);
    expect(after.retiredFromDuplicateScan.map((r) => r.node)).toEqual([`${ARCHIVE_DIRNAME}/${DUPLICATE_B}`]);
  });
});

describe("retirement cannot silence a gate", () => {
  /*
   * The attack, planted three ways: create a real violation, then retire the
   * node it names and see whether it goes away. `deferred` is on
   * `AGENT_SETTABLE_STATUSES`, so this is a move the constrained actor can make
   * on its own authority — which is exactly why the filter reaches one
   * suspicion-only rule and no invariant.
   */
  beforeEach(() => treeWithOneDuplicatePair());

  test("a dangling link on a retired node still blocks done and still reddens check", () => {
    vault.linkNodes(DUPLICATE_B, "Ghost opportunity");
    vault.setStatus(DUPLICATE_B, "deferred", "nothing to see here");

    const after = work();
    /*
     * Named down to the node and the target, not merely "some dangling link
     * survived".
     *
     * That weaker assertion passes under the exact mutation this test exists to
     * catch — verified by making `detectHygiene` read the live tree, which
     * removes DUPLICATE_B from the index and so turns the Outcome's link TO it
     * into a fresh dangling link of its own. A test that only counted rules
     * would have seen a `dangling-link` either way and called the attack
     * repelled while it succeeded. The issue that has to survive is the one
     * hanging off the retired node.
     */
    const dangling = after.hygieneIssues.filter((i) => i.rule === "dangling-link");
    expect(dangling.map((i) => ({ title: i.title, ghost: i.issue.includes("Ghost opportunity") }))).toContainEqual({
      title: DUPLICATE_B,
      ghost: true,
    });
    expect(after.done).toBe(false);
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "dangling-link" && v.node === DUPLICATE_B)).toBe(true);
  });

  test("an unlabelled node still owes an evidence class after it is retired", () => {
    // A node with no `evidence` — the shape a legacy or hand-written node
    // arrives in — attached legally so nothing but `evidence-class` fires.
    put({ title: "A legacy gap", layer: "Opportunity", evidence: undefined });
    vault.linkNodes(OUTCOME, "A legacy gap");
    expect(work().hygieneIssues.some((i) => i.rule === "evidence-class" && i.title === "A legacy gap")).toBe(true);

    vault.setStatus("A legacy gap", "deferred", "not working on it");

    // Withheld from the duplicate scan, and from nothing else. The issue still
    // names the retired node by title, so it is not merely that SOME issue
    // survived — the one attached to the retired node did.
    const after = work();
    expect(after.retiredFromDuplicateScan.map((r) => r.node)).toContain("A legacy gap");
    expect(after.hygieneIssues.some((i) => i.rule === "evidence-class" && i.title === "A legacy gap")).toBe(true);
    expect(after.done).toBe(false);
  });

  test("retiring every node in the tree does not reach done", () => {
    // The blunt version of the attack: if retirement emptied the denominator the
    // gates run over, this is the one call sequence that would make a broken tree
    // report clean.
    vault.linkNodes(DUPLICATE_A, "Ghost opportunity");
    for (const n of vault.readTree()) {
      if (n.layer === "Outcome") continue;
      vault.setStatus(n.title, "deferred", "retiring everything");
    }

    const after = work();
    expect(after.done).toBe(false);
    // Same discrimination as the test above, and for the same reason: retiring
    // every node would itself manufacture dangling links (the Outcome's edges to
    // the nodes that left), so the rule name alone proves nothing. The violation
    // that must survive is the one DUPLICATE_A owns.
    expect(
      after.hygieneIssues.some(
        (i) => i.rule === "dangling-link" && i.title === DUPLICATE_A && i.issue.includes("Ghost opportunity"),
      ),
    ).toBe(true);
  });
});
