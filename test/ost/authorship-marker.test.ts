/**
 * The authorship marker distinguishes something.
 *
 * The assumption this file answers to is about readers — "do provenance markers
 * still get read once they are on everything" — and this test cannot settle
 * that: whether a person's eye still stops on a marker is a fact about people,
 * and it needs people. What it settles is the precondition without which that
 * question is not even askable. Today a human's node and the agent's are the
 * same bytes. The only provenance signal on a node is `#unvalidated`, which is
 * stamped on every node the agent creates (211 of 219 in this vault) and says
 * nothing about who wrote the prose, so the "marker on everything" the
 * assumption fears is not a future risk here — it is the current state, and
 * there is no finer marker for it to happen to.
 *
 * So the bar, and it is about the FIELD:
 *
 *  1. **a node records whose prose it holds** — round-tripped through
 *     frontmatter, stamped by the writer and not by the caller, so the party
 *     that benefits from reading as a person's work cannot declare itself one;
 *  2. **the marker survives an edit** rather than resetting to whoever touched
 *     the file last. This is the one that goes red on the failure the History
 *     line named: a human edit that leaves the node still reading `machine`.
 *     Both directions count — an agent edit must not erase a person's hand
 *     either;
 *  3. **the marker survives a peer merge**, by a rule that is deterministic,
 *     symmetric and lossless, and that fails toward `machine` rather than
 *     toward `human`;
 *  4. **the rollup can report the human-written share**, out of the field rather
 *     than out of anybody's estimate.
 *
 * What is deliberately NOT here: any claim that the marker is READ. The rollup
 * says the share and says how much of the tree is unlabelled; whether that
 * changes what an operator does is the humans-required half, still open.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  authorshipCensus,
  foldAuthorship,
  isAuthorship,
  joinAuthorship,
  type Authorship,
} from "../../src/ost/authorship.js";
import { renderRollup, rollupTree } from "../../src/eval/rollup.js";
import { deserialize, serialize, type OstNode } from "../../src/ost/node.js";
import { recordResult, retractNode } from "../../src/ost/results.js";
import { settleNodeCollision } from "../../src/ost/vault-merge.js";
import { Vault } from "../../src/ost/vault.js";

const TEST_TITLE = "Whether operators notice who wrote a line";

function testNode(): OstNode {
  return {
    title: TEST_TITLE,
    layer: "AssumptionTest",
    tags: [],
    links: [],
    body: "The agent's own words about a bar it set for itself.",
    evidence: "assertion",
  };
}

describe("authorship is recorded per node", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-authorship-"));
    vault = new Vault(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a node the agent created reads as the machine's, in the file itself", () => {
    vault.createNode(testNode());
    const raw = fs.readFileSync(path.join(dir, `${TEST_TITLE}.md`), "utf8");
    expect(raw).toContain("authorship: machine");
    expect(vault.read(TEST_TITLE).authorship).toBe("machine");
  });

  test("the field round-trips, and an unrecognised value is dropped rather than carried", () => {
    for (const value of ["machine", "human", "mixed"] as const) {
      const round = deserialize(TEST_TITLE, serialize({ ...testNode(), authorship: value }));
      expect(round.authorship).toBe(value);
    }
    // The posture `lane` and `sight` already take. A word nobody defined must
    // never be the reason a node reads as a person's work.
    const forged = deserialize(TEST_TITLE, "---\ntype: Solution\nauthorship: definitely-a-person\n---\n#Solution\n\nb\n");
    expect(forged.authorship).toBeUndefined();
    expect(isAuthorship("definitely-a-person")).toBe(false);
  });

  test("the caller cannot declare its own prose a person's — createNode stamps over it", () => {
    vault.createNode({ ...testNode(), authorship: "human" });
    expect(vault.read(TEST_TITLE).authorship).toBe("machine");
  });
});

describe("the marker survives an edit rather than resetting to the editor", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-authorship-edit-"));
    vault = new Vault(dir);
    vault.createNode(testNode());
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * The red the instrument was written for. A person records a result on a node
   * the agent wrote; if the node still says `machine` afterwards, the marker has
   * been inherited across a human's write and is measuring the file's creator
   * forever rather than its authors.
   */
  test("a human's recorded result leaves the node reading mixed, never machine", () => {
    recordResult(dir, {
      test: TEST_TITLE,
      verdict: "refuted",
      by: "tanner",
      note: "ran it with five operators; four could not tell",
      uncovered: "only desktop operators, and only on one output",
      on: "2026-08-22",
    });
    const after = vault.read(TEST_TITLE);
    expect(after.authorship).not.toBe("machine");
    expect(after.authorship).toBe("mixed");
    // And the person's words really are in the node the marker now describes.
    expect(after.body).toContain("four could not tell");
  });

  test("a human's promotion and a human's retraction do the same", () => {
    vault.createNode({ ...testNode(), title: "Promote me", layer: "Solution" });
    vault.promoteToValidated("Promote me", "tanner", "two customers paid for it");
    expect(vault.read("Promote me").authorship).toBe("mixed");

    vault.createNode({ ...testNode(), title: "Retract me", layer: "Solution" });
    retractNode(dir, { node: "Retract me", by: "tanner", why: "filed by mistake", on: "2026-08-22" });
    expect(vault.read("Retract me").authorship).toBe("mixed");
  });

  test("and the other direction: an agent edit does not erase a person's hand", () => {
    // A node a person wrote by hand, labelled by the person who wrote it.
    const p = path.join(dir, "A need the founder typed himself.md");
    fs.writeFileSync(
      p,
      "---\ntype: Opportunity\nauthorship: human\nevidence: assertion\n---\n#Opportunity\n\nI cannot leave it running unattended.\n",
      "utf8",
    );
    vault.editProse("A need the founder typed himself", "Rephrased by the agent.", "tightening the wording");
    const after = vault.read("A need the founder typed himself");
    expect(after.authorship).toBe("mixed");
    expect(after.authorship).not.toBe("machine");
  });

  test("an agent write that adds a section to a node it did not write is recorded too", () => {
    const p = path.join(dir, "A need the founder typed himself.md");
    fs.writeFileSync(
      p,
      "---\ntype: Opportunity\nauthorship: human\nevidence: assertion\n---\n#Opportunity\n\nI cannot leave it running unattended.\n",
      "utf8",
    );
    vault.appendToNode("A need the founder typed himself", "## Notes\n- the agent's own reading of this");
    expect(vault.read("A need the founder typed himself").authorship).toBe("mixed");
  });

  test("an append to a node the agent already owns still only grows the file", () => {
    // The byte guarantee `appendToNode` carries, kept where the marker does not
    // have to move — which is every append onto a node the agent created.
    const p = path.join(dir, `${TEST_TITLE}.md`);
    const before = fs.readFileSync(p, "utf8");
    vault.appendToNode(TEST_TITLE, "## Notes\n- extra context");
    const after = fs.readFileSync(p, "utf8");
    expect(after.startsWith(before)).toBe(true);
  });

  test("repeated writes by the same author do not drift the marker", () => {
    vault.editProse(TEST_TITLE, "again", "a second pass");
    vault.editProse(TEST_TITLE, "and again", "a third pass");
    vault.annotate(TEST_TITLE, "an issue the agent noticed");
    expect(vault.read(TEST_TITLE).authorship).toBe("machine");
  });

  test("the fold is monotone: nothing ever takes a recorded author back off", () => {
    const values: (Authorship | undefined)[] = [undefined, "machine", "human", "mixed"];
    for (const prev of values) {
      for (const writer of ["machine", "human"] as const) {
        const next = foldAuthorship(prev, writer);
        // Whatever was recorded is still recorded.
        if (prev !== undefined) expect(joinAuthorship(prev, next)).toBe(next);
        // The current writer is recorded too.
        expect(joinAuthorship(writer, next)).toBe(next);
      }
    }
    expect(foldAuthorship("machine", "human")).toBe("mixed");
    expect(foldAuthorship("human", "machine")).toBe("mixed");
    expect(foldAuthorship("mixed", "human")).toBe("mixed");
  });
});

describe("the marker survives a peer merge", () => {
  const at = "2026-08-22";
  const render = (authorship: string): string =>
    `---\ntype: Solution\nevidence: assertion\nauthorship: ${authorship}\n---\n#Solution #evidence/assertion\n\nSame prose both sides.\n`;

  test("two hands merge to mixed, and the rule says so in History", () => {
    const verdict = settleNodeCollision("Same node", render("machine"), render("human"), { at });
    expect(verdict.settleable).toBe(true);
    if (!verdict.settleable) return;
    expect(verdict.resolved.authorship).toBe("mixed");
    expect(verdict.rules).toContain("authorship-union");
    expect(verdict.resolved.body).toContain("authorship machine / human");
  });

  test("the rule is symmetric — which peer ran the exchange does not change the marker", () => {
    const forward = settleNodeCollision("Same node", render("machine"), render("human"), { at });
    const backward = settleNodeCollision("Same node", render("human"), render("machine"), { at });
    expect(forward.settleable && forward.resolved.authorship).toBe("mixed");
    expect(backward.settleable && backward.resolved.authorship).toBe("mixed");
  });

  test("a one-sided marker is adopted, and a merge never invents a human", () => {
    const bare = `---\ntype: Solution\nevidence: assertion\n---\n#Solution #evidence/assertion\n\nSame prose both sides.\n`;
    const oneSided = settleNodeCollision("Same node", render("machine"), bare, { at });
    expect(oneSided.settleable && oneSided.resolved.authorship).toBe("machine");
    // No pair of inputs settles to `human` unless both sides already said it —
    // the direction that would let a peer launder the agent's prose into a
    // person's.
    for (const [a, b] of [
      ["machine", "human"],
      ["machine", "mixed"],
      ["mixed", "human"],
    ] as const) {
      const v = settleNodeCollision("Same node", render(a), render(b), { at });
      expect(v.settleable && v.resolved.authorship).toBe("mixed");
    }
  });
});

describe("the rollup reports the human-written share", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-authorship-rollup-"));
    vault = new Vault(dir);
    vault.createNode({ title: "Outcome", layer: "Outcome", tags: [], links: [], body: "the mandate" });
    vault.createNode({ title: "A category", layer: "Opportunity", tags: [], links: [], body: "b", evidence: "assertion" });
    vault.linkNodes("Outcome", "A category");
    vault.createNode({ ...testNode(), title: "A test", layer: "AssumptionTest" });
    vault.linkNodes("A category", "A test");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("the census counts each kind apart, and unlabelled is not a verdict", () => {
    fs.writeFileSync(
      path.join(dir, "Hand written.md"),
      "---\ntype: Opportunity\nevidence: assertion\n---\n#Opportunity\n\nno marker at all\n",
      "utf8",
    );
    const census = authorshipCensus(vault.readTree());
    expect(census.machine).toBe(3);
    expect(census.human).toBe(0);
    expect(census.mixed).toBe(0);
    expect(census.unlabelled).toBe(1);
    expect(census.humanWritten).toBe(0);
    expect(census.total).toBe(4);
  });

  test("the rendered rollup states the share, and it moves when a person writes", () => {
    const before = renderRollup(rollupTree(vault.readTree()));
    expect(before).toContain("Authorship: 0/3 node(s) carry human-written prose");

    recordResult(dir, {
      test: "A test",
      verdict: "supported",
      by: "tanner",
      note: "four of six pointed at the machine-selected lines",
      uncovered: "one output, one sitting",
      on: "2026-08-22",
    });

    const after = renderRollup(rollupTree(vault.readTree()));
    expect(after).toContain("Authorship: 1/3 node(s) carry human-written prose");
    expect(rollupTree(vault.readTree()).authorship.mixed).toBe(1);
  });

  test("a tree where the marker reads the same everywhere says so", () => {
    for (let i = 0; i < 12; i++) {
      vault.createNode({ ...testNode(), title: `Filler ${i}`, layer: "Solution" });
      vault.linkNodes("A category", `Filler ${i}`);
    }
    const rendered = renderRollup(rollupTree(vault.readTree()));
    expect(rendered).toContain("is not telling a reader which is which");

    // …and stops saying it as soon as the marker is doing work.
    recordResult(dir, {
      test: "A test",
      verdict: "inconclusive",
      by: "tanner",
      note: "a person's finding, in the tree",
      uncovered: "one sitting",
      on: "2026-08-22",
    });
    expect(renderRollup(rollupTree(vault.readTree()))).not.toContain("is not telling a reader which is which");
  });
});
