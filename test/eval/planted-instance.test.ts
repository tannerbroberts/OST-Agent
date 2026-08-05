import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { laneConflicts } from "../../src/ost/lanes.js";
import { Vault } from "../../src/ost/vault.js";

/**
 * Positive control: every shipped check must find an instance planted in its
 * subject.
 *
 * This exists because three of this codebase's reporting rules were found blind
 * AFTER shipping green — the lane reader that read a fragment as a declaration,
 * eleven audio tests that could not fail, and a history sweep that measured only
 * the files it could open. The common property was that none of them had ever
 * been observed finding anything. A rule that has only ever reported success is
 * indistinguishable from a rule that cannot report failure.
 *
 * The point is not the assertions — those existed already. It is that each
 * assertion is preceded by a CLEAN baseline, so a rule reporting the plant is
 * demonstrably reacting to the plant and not to ambient noise in the fixture.
 *
 * A run of this as a one-off script found 3 apparent misses that were all
 * defects in the PLANTS: a wikilink placed in prose rather than the contiguous
 * edge block (correctly not an edge), a "conflict" whose two halves agreed, and
 * an assertion grepping for a word the reporter never prints. That is the
 * failure mode a positive control has to survive — a plant that is not the
 * shape the check looks for proves nothing about the check.
 */
let dir: string;

const BASELINE: Record<string, string> = {
  "Root outcome.md": `---
type: Outcome
status: validated
created: '2026-07-27'
evidence: assertion
---
#Outcome #evidence/assertion
[[An opportunity]]

A baseline vault that satisfies every invariant.
`,
  "An opportunity.md": `---
type: Opportunity
status: validated
created: '2026-07-27'
evidence: assertion
---
#Opportunity #evidence/assertion
[[A solution]]

An opportunity reachable from the outcome.
`,
  "A solution.md": `---
type: Solution
status: unvalidated
created: '2026-07-27'
evidence: assertion
---
#Solution #evidence/assertion
[[A test]]

A solution mapped under an opportunity.
`,
  "A test.md": `---
type: AssumptionTest
status: unvalidated
created: '2026-07-27'
evidence: assertion
lane: compute-only
---
#AssumptionTest #evidence/assertion

**Lane: compute-only.** Runs unattended with no person involved.
`,
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-planted-"));
  for (const [name, body] of Object.entries(BASELINE)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const tree = (): ReturnType<Vault["readTree"]> => new Vault(dir).readTree();
const write = (name: string, body: string): void => fs.writeFileSync(path.join(dir, name), body);
const rules = (): string[] => checkInvariants(tree()).map((v) => v.rule);

/** Add a title to a node's contiguous edge block — the only place a link is an edge. */
function linkFrom(file: string, after: string, title: string): void {
  const p = path.join(dir, file);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(`[[${after}]]`, `[[${after}]]\n[[${title}]]`));
}

describe("the baseline is clean", () => {
  test("no invariant fires on an unmutated vault", () => {
    // Every test below is meaningless without this one.
    expect(checkInvariants(tree())).toEqual([]);
  });
});

describe("checkInvariants finds each planted violation", () => {
  test("single-outcome: a second Outcome", () => {
    write("Second outcome.md", BASELINE["Root outcome.md"]);
    expect(rules()).toContain("single-outcome");
  });

  test("dangling-link: an edge to a node that does not exist", () => {
    linkFrom("An opportunity.md", "A solution", "A node that does not exist");
    expect(rules()).toContain("dangling-link");
  });

  test("wrapped-wikilink: a link split across a line break", () => {
    const p = path.join(dir, "An opportunity.md");
    fs.appendFileSync(p, "\nSee [[A solution\nsplit across lines]] for detail.\n");
    expect(rules()).toContain("wrapped-wikilink");
  });

  test("opportunity-connected: an Opportunity nothing links to", () => {
    write(
      "A stranded opportunity.md",
      `---\ntype: Opportunity\nstatus: unvalidated\ncreated: '2026-07-27'\nevidence: assertion\n---\n#Opportunity #evidence/assertion\n\nNothing links to this.\n`,
    );
    expect(rules()).toContain("opportunity-connected");
  });

  test("solution-mapped: a Solution under no Opportunity", () => {
    write(
      "A stranded solution.md",
      `---\ntype: Solution\nstatus: unvalidated\ncreated: '2026-07-27'\nevidence: assertion\n---\n#Solution #evidence/assertion\n\nNo opportunity links to this.\n`,
    );
    expect(rules()).toContain("solution-mapped");
  });

  test("assumption-mapped: an Assumption under no Solution", () => {
    write(
      "A stranded belief.md",
      `---\ntype: Assumption\nstatus: unvalidated\ncreated: '2026-07-27'\nevidence: assertion\n---\n#Assumption #evidence/assertion\n\nNo solution links to this.\n`,
    );
    expect(rules()).toContain("assumption-mapped");
  });

  test("test-mapped: an AssumptionTest under no Assumption", () => {
    write(
      "A stranded test.md",
      `---\ntype: AssumptionTest\nstatus: unvalidated\ncreated: '2026-07-27'\nevidence: assertion\n---\n#AssumptionTest #evidence/assertion\n\nNo assumption links to this.\n`,
    );
    expect(rules()).toContain("test-mapped");
  });

  test("evidence-class: a node declaring nothing about what it rests on", () => {
    write(
      "A node with no evidence class.md",
      `---\ntype: Solution\nstatus: unvalidated\ncreated: '2026-07-27'\n---\n#Solution\n\nDeclares nothing.\n`,
    );
    linkFrom("An opportunity.md", "A solution", "A node with no evidence class");
    expect(rules()).toContain("evidence-class");
  });

  test("no-self-validation: tagged unvalidated while claiming validated", () => {
    write(
      "A self-validating node.md",
      `---\ntype: Solution\nstatus: validated\ncreated: '2026-07-27'\nevidence: assertion\n---\n#Solution #unvalidated #evidence/assertion\n\nClaims both.\n`,
    );
    linkFrom("An opportunity.md", "A solution", "A self-validating node");
    expect(rules()).toContain("no-self-validation");
  });
});

describe("the lane-conflict rule finds a planted contradiction", () => {
  /** Frontmatter says compute may run it; the node's own prose says a person is needed. */
  function plantLaneConflict(): void {
    write(
      "A test whose lane contradicts its prose.md",
      `---\ntype: AssumptionTest\nstatus: unvalidated\ncreated: '2026-07-27'\nevidence: assertion\nlane: compute-only\n---\n#AssumptionTest #evidence/assertion\n\n**Lane: humans-required.** A person must sit with five participants.\n`,
    );
    linkFrom("A solution.md", "A test", "A test whose lane contradicts its prose");
  }

  test("laneConflicts names the contradicting test", () => {
    plantLaneConflict();
    expect(laneConflicts(tree()).map((c) => c.test)).toContain(
      "A test whose lane contradicts its prose",
    );
  });

  test("and it surfaces through checkInvariants, which is what gates a run", () => {
    plantLaneConflict();
    expect(rules()).toContain("lane-conflict");
  });

  test("a prose lane that AGREES with the label is not a conflict", () => {
    // The negative control. Without it, a rule that flags every classified test
    // would pass every assertion above while being useless.
    expect(laneConflicts(tree())).toEqual([]);
  });
});
