/**
 * "Does a quarantined node make the agent notice the hole in its tree" — the
 * instrument beneath "Quarantine unknown node types instead of dropping them".
 *
 * **The fixture is the recorded incident, rebuilt.** One node in this project's
 * own vault had its `type:` changed from `Opportunity` to `Metric` by hand.
 * `readTreeCensus` filed it under `skipped`; `readTree` stopped returning it; its
 * outgoing edges went with it. What reached the operator was nine findings — 5
 * orphan Opportunities, 3 orphan Solutions, 1 dangling link from the Outcome —
 * and not one of them said *a node is missing*. An agent reading only the tools
 * could not recover the fact that a whole branch existed on disk that it could
 * not see: it would run a full pass against a tree with a hole in it and report
 * success.
 *
 * The first two tests below hold that arithmetic in place, because it is the
 * reason the rest exists: with the type recognised the tree is clean, and one
 * character of edit produces nine findings that name the wrong nodes. Everything
 * after them is the three properties the solution's definition of done names —
 * **retained**, **excluded from counts and gates rather than miscounted**, and
 * **named in the sweep along with the type that was not understood**.
 *
 * What this does NOT settle, stated because the assumption test says so in as
 * many words: whether an agent handed only this output goes on to ACT on the
 * hole. That needs a person reading a pass, and no assertion here can stand in
 * for it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkInvariants } from "../../src/eval/invariants.js";
import { renderCheck } from "../../src/eval/render.js";
import { readNodeBody } from "../../src/mcp/node-body.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { formatCensus } from "../../src/ost/census.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { readTreeResponse } from "../../src/security/tools.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-quarantine-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const OUTCOME = "Steakholders keep the tree honest";
/** The node the incident was about, title and all. */
const HELD = "Any steakholder can start the ost-agent npm package";
const BRANCH_OPPORTUNITIES = ["Setup is undocumented", "The CLI has no entry point", "Install fails on Node 18", "Nobody knows it exists"];
const NESTED_OPPORTUNITY = "Install fails behind a proxy";
const BRANCH_SOLUTIONS = ["Ship a bin entry", "Pin the engines field", "Write a quickstart"];

const node = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links,
  body: `Prose for ${title}.`,
});

/**
 * The tree exactly as it stood before the edit: a category Opportunity under the
 * Outcome, four Opportunities and three Solutions beneath it, and one Opportunity
 * nested a level deeper.
 *
 * Written file-by-file rather than through `linkNodes` so the shape is legible in
 * one place — this fixture IS the finding, and a reader has to be able to check
 * that the nine numbers below come from it.
 */
function buildBranch(): void {
  vault.createNode(node(OUTCOME, "Outcome", [HELD]));
  vault.createNode(node(HELD, "Opportunity", [...BRANCH_OPPORTUNITIES, ...BRANCH_SOLUTIONS]));
  vault.createNode(node(BRANCH_OPPORTUNITIES[0], "Opportunity", [NESTED_OPPORTUNITY]));
  for (const t of BRANCH_OPPORTUNITIES.slice(1)) vault.createNode(node(t, "Opportunity"));
  vault.createNode(node(NESTED_OPPORTUNITY, "Opportunity"));
  for (const t of BRANCH_SOLUTIONS) vault.createNode(node(t, "Solution"));
}

/**
 * The edit, byte for byte: `type: Opportunity` becomes `type: Metric` in the
 * file, and nothing else about the file changes. Not `createNode` with a
 * different layer — no writer in this product can produce this file, which is the
 * whole reason the reader has to cope with it.
 */
function retypeHeldNode(to: string): void {
  const file = path.join(dir, `${HELD}.md`);
  const before = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, before.replace(/^type: Opportunity$/m, `type: ${to}`), "utf8");
}

describe("the defect, held in place — nine symptoms for one cause", () => {
  test("with the type recognised, the branch is clean: no violation anywhere in it", () => {
    buildBranch();

    expect(checkInvariants(vault.readTree(), vault.readQuarantined())).toEqual([]);
  });

  test("with the type unrecognised and quarantine switched off, the same tree reports nine findings that name the wrong nodes", () => {
    buildBranch();
    retypeHeldNode("Metric");

    // No quarantine argument — this is `checkInvariants` reading exactly what it
    // read before this solution existed, and the nine are the recorded incident.
    const blind = checkInvariants(vault.readTree());

    expect(blind).toHaveLength(9);
    expect(blind.filter((v) => v.rule === "opportunity-connected")).toHaveLength(5);
    expect(blind.filter((v) => v.rule === "solution-mapped")).toHaveLength(3);
    expect(blind.filter((v) => v.rule === "dangling-link")).toHaveLength(1);
    // The point, and the reason a count is not enough: not one of the nine names
    // the file that was edited, or says a node is missing.
    expect(blind.some((v) => v.node === HELD)).toBe(false);
    expect(blind.some((v) => JSON.stringify(v).includes("Metric"))).toBe(false);
  });
});

describe("retained — the node survives the read with its title, body and links", () => {
  test("the census holds it instead of dropping it, and carries the type that was not understood", () => {
    buildBranch();
    retypeHeldNode("Metric");

    const census = vault.readTreeCensus();

    expect(census.quarantined).toHaveLength(1);
    const held = census.quarantined[0]!;
    expect(held.title).toBe(HELD);
    expect(held.file).toBe(`${HELD}.md`);
    expect(held.unrecognizedType).toBe("Metric");
    // Every outgoing edge, in the order the file wrote them — this is what makes
    // the branch beneath it visible at all.
    expect(held.links).toEqual([...BRANCH_OPPORTUNITIES, ...BRANCH_SOLUTIONS]);
    expect(held.body).toContain(`Prose for ${HELD}.`);
    // And it is no longer reported as something that was dropped.
    expect(census.skipped).toEqual([]);
  });

  test("a file with no `type:` at all is still dropped — quarantine is for nodes, not for every stray file", () => {
    buildBranch();
    fs.writeFileSync(path.join(dir, "README.md"), "# Not a node\n\nJust a note beside the vault.\n");

    const census = vault.readTreeCensus();

    expect(census.quarantined).toEqual([]);
    expect(census.skipped.map((s) => s.file)).toEqual(["README.md"]);
  });

  test("its body is readable through the same door a node's is, flagged rather than passed off as a node", () => {
    buildBranch();
    retypeHeldNode("Metric");

    const body = readNodeBody(vault, HELD);

    expect(body.unrecognizedType).toBe("Metric");
    expect(body.layer).toBe("Metric");
    expect(body.quarantineNote).toContain("QUARANTINED");
    expect(body.prose).toContain(`Prose for ${HELD}.`);
    expect(body.links).toEqual([...BRANCH_OPPORTUNITIES, ...BRANCH_SOLUTIONS]);
    // Nothing here validated a status or a rung, so this read asserts neither.
    expect(body.status).toBeNull();
    expect(body.evidence).toBeNull();
  });
});

describe("excluded from counts and gates — retained is not the same as counted", () => {
  test("it is not a node: readTree's count is unchanged by quarantining it", () => {
    buildBranch();
    const before = vault.readTree().length;
    retypeHeldNode("Metric");

    const after = vault.readTree();

    expect(after).toHaveLength(before - 1);
    expect(after.some((n) => n.title === HELD)).toBe(false);
  });

  test("it generates no finding of its own — a reader that cannot classify a node does not get to judge it", () => {
    buildBranch();
    retypeHeldNode("Metric");

    const violations = checkInvariants(vault.readTree(), vault.readQuarantined());

    // It declares no evidence class this reader read, sits under an Outcome that
    // may only hold Opportunities, and carries no recognised layer — three rules
    // that would each have fired had it been admitted as a node.
    expect(violations.filter((v) => v.node === HELD)).toEqual([]);
  });
});

describe("nine symptoms become one cause", () => {
  test("the orphans and the dangling link are gone, and nothing else went quiet with them", () => {
    buildBranch();
    retypeHeldNode("Metric");

    const violations = checkInvariants(vault.readTree(), vault.readQuarantined());

    expect(violations).toEqual([]);
  });

  test("suppression is scoped to the branch the quarantine actually holds — a real orphan elsewhere still reports", () => {
    buildBranch();
    // Adrift by its own doing, nothing to do with the edited file.
    vault.createNode(node("Nobody linked this one", "Solution"));
    retypeHeldNode("Metric");

    const violations = checkInvariants(vault.readTree(), vault.readQuarantined());

    expect(violations.map((v) => [v.rule, v.node])).toEqual([["solution-mapped", "Nobody linked this one"]]);
  });

  test("the sweep reports one quarantine naming the type and every child it holds, and no hygiene issue for any of them", async () => {
    buildBranch();
    retypeHeldNode("Metric");

    const work = await computeNextWork(vault, dir, 1);

    expect(work.quarantined).toHaveLength(1);
    const held = work.quarantined[0]!;
    expect(held.title).toBe(HELD);
    expect(held.unrecognizedType).toBe("Metric");
    // The live end of the edge that is no longer called dangling.
    expect(held.darkens).toBe(OUTCOME);
    // quarantined-parent, not orphan: every node the nine findings misnamed.
    expect(held.children).toEqual([...BRANCH_OPPORTUNITIES, ...BRANCH_SOLUTIONS]);
    expect(work.hygieneIssues).toEqual([]);
  });
});

describe("named in the sweep — the type that was not understood reaches a reader", () => {
  test("the sweep summary says the tree has a hole in it before it says anything about the tree", async () => {
    buildBranch();
    retypeHeldNode("Metric");

    const work = await computeNextWork(vault, dir, 1);

    expect(work.summary).toContain(HELD);
    expect(work.summary).toContain('"Metric"');
    // Before the verdict, not after it — and `startsWith` rather than a relative
    // index, because the sentence has to arrive ahead of BOTH branches of the
    // verdict ("Tree is fully maintained" and "Outstanding:"), and a test that
    // pinned one of them would go quiet on whichever tree it did not build.
    expect(work.summary.startsWith("1 node(s) on disk could not be classified")).toBe(true);
    expect(work.summary).toContain("including `done`");
  });

  test("a clean tree says nothing about quarantine at all — the note cannot become wallpaper", async () => {
    buildBranch();

    const work = await computeNextWork(vault, dir, 1);

    expect(work.quarantined).toEqual([]);
    expect(work.summary).not.toContain("could not be classified");
  });

  test("ost_read_tree lists it apart from `nodes`, with the unrecognised type and its edges", () => {
    buildBranch();
    retypeHeldNode("Metric");
    const census = vault.readTreeCensus();

    const response = readTreeResponse(census.nodes, census.quarantined);

    expect(response.nodes.some((n) => n.title === HELD)).toBe(false);
    expect(response.count).toBe(census.nodes.length);
    // `#Opportunity` survives in `tags`, and that is not a leak — the frontmatter
    // and the tag line now disagree, and the tag line is the only record of what
    // the file was before somebody retyped it. Dropping it to match the declared
    // type would throw away the one clue that says which repair is right.
    expect(response.quarantined).toEqual([
      {
        title: HELD,
        unrecognizedType: "Metric",
        tags: ["Opportunity", "unvalidated"],
        links: [...BRANCH_OPPORTUNITIES, ...BRANCH_SOLUTIONS],
      },
    ]);
    expect(response.quarantineNote).toContain("hole in the tree");
  });

  test("ost_check names the file and the type, and says the branch beneath it is dark", () => {
    buildBranch();
    retypeHeldNode("Metric");
    const census = vault.readTreeCensus();

    const rendered = renderCheck(census).text;
    const line = formatCensus(census, census.nodes.length);

    expect(rendered).toContain("quarantined");
    expect(rendered).toContain(HELD);
    expect(line).toContain('"Metric"');
    expect(line).toContain("quarantined-parent of:");
    // The count above the census line does not silently absorb it.
    expect(line).toContain(`Counted over: ${census.nodes.length} node(s) of ${census.examined} markdown file(s) examined`);
  });
});
