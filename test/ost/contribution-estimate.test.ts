/**
 * "Contribution estimates that ladder a local metric to the distant goal" —
 * the recording half of "Do written contribution estimates survive one month
 * of real movement". That assumption test needs a month of real movement to
 * settle, which is a human's call to make; this pins only what a builder can
 * make real today: a node can carry a checkable estimate — local metric,
 * named distant goal, dated figure — an unstructured one is refused rather
 * than silently accepted, and the rollup surfaces every valid one beside
 * whatever a human has since recorded moved.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { isContributionEstimate, parseContributionEstimate } from "../../src/knowledge/contribution.js";
import { deserialize, serialize, type OstNode } from "../../src/ost/node.js";
import { rollupTree } from "../../src/eval/rollup.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const VALID = "weekly builder retries → sessions shipped unattended: +2 per week (2026-08-17)";

describe("parseContributionEstimate", () => {
  test("a structured estimate parses into its metric, goal, figure, and date", () => {
    const parsed = parseContributionEstimate(VALID);
    expect(isContributionEstimate(parsed)).toBe(true);
    if (!isContributionEstimate(parsed)) return;
    expect(parsed.localMetric).toBe("weekly builder retries");
    expect(parsed.distantGoal).toBe("sessions shipped unattended");
    expect(parsed.figure).toBe("+2 per week");
    expect(parsed.date).toBe("2026-08-17");
  });

  test("absent is a rejection, not a default", () => {
    expect(isContributionEstimate(parseContributionEstimate(undefined))).toBe(false);
    expect(isContributionEstimate(parseContributionEstimate(""))).toBe(false);
    expect(isContributionEstimate(parseContributionEstimate("   "))).toBe(false);
  });

  test.each([
    ["This should really move retention a lot"], // loose prose: no metric, no goal, no date
    ["retries → retention"], // no figure, no date
    ["retries → retention: up a lot"], // no date
    ["retries: up 2x (2026-08-17)"], // no distant goal (no arrow)
    ["retries → retention +2x (2026-08-17)"], // no colon separating goal from figure
  ])("refuses an estimate a later pass could not check against real movement: %s", (raw) => {
    const parsed = parseContributionEstimate(raw);
    expect(isContributionEstimate(parsed)).toBe(false);
  });

  test("refuses a dated claim with no number in the figure", () => {
    const parsed = parseContributionEstimate("retries → retention: up a lot (2026-08-17)");
    expect(isContributionEstimate(parsed)).toBe(false);
    if (isContributionEstimate(parsed)) return;
    expect(parsed.reason).toMatch(/no number|direction/);
  });

  test("a rejection explains itself well enough to act on", () => {
    const parsed = parseContributionEstimate("just a hunch");
    expect(isContributionEstimate(parsed)).toBe(false);
    if (isContributionEstimate(parsed)) return;
    expect(parsed.reason).toMatch(/local metric|distant goal|dated figure/);
  });
});

describe("OstNode carries a contribution estimate", () => {
  const node: OstNode = {
    title: "A daily ritual will lift retention",
    layer: "Solution",
    evidence: "assertion",
    tags: [],
    links: [],
    contribution: VALID,
    body: "prose",
  };

  test("round-trips through serialize/deserialize", () => {
    const back = deserialize(node.title, serialize(node));
    expect(back.contribution).toBe(VALID);
    expect(back).toEqual(node);
  });

  test("an unstructured contribution still round-trips verbatim — the reader names it unusable rather than dropping it", () => {
    const loose: OstNode = { ...node, contribution: "this will really move things" };
    const back = deserialize(loose.title, serialize(loose));
    expect(back.contribution).toBe("this will really move things");
    expect(isContributionEstimate(parseContributionEstimate(back.contribution))).toBe(false);
  });
});

describe("rollupTree surfaces recorded estimates beside what actually moved", () => {
  const mk = (title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): OstNode => ({
    title,
    layer,
    status: "unvalidated",
    evidence: "assertion",
    tags: [],
    links: [],
    body: "prose",
    ...extra,
  });

  function tree(overrides: Partial<Record<string, Partial<OstNode>>> = {}): OstNode[] {
    const build = (title: string, layer: OstNode["layer"], links: string[] = []): OstNode =>
      mk(title, layer, { links, ...(overrides[title] ?? {}) });
    return [
      build("Root", "Outcome", ["Tools fail"]),
      build("Tools fail", "Opportunity", ["Ship a shim"]),
      build("Ship a shim", "Solution", ["Run it on five machines"]),
      build("Run it on five machines", "AssumptionTest"),
    ];
  }

  test("a node with no contribution field contributes nothing to the count or the list", () => {
    const r = rollupTree(tree());
    expect(r.buckets[0].contributionEstimates).toBe(0);
    expect(r.estimates).toEqual([]);
  });

  test("a valid estimate is counted on its bucket and listed at the top level, with no actual yet", () => {
    const r = rollupTree(tree({ "Ship a shim": { contribution: VALID } }));
    expect(r.buckets[0].contributionEstimates).toBe(1);
    expect(r.estimates).toHaveLength(1);
    expect(r.estimates[0]).toEqual({
      title: "Ship a shim",
      localMetric: "weekly builder retries",
      distantGoal: "sessions shipped unattended",
      figure: "+2 per week",
      date: "2026-08-17",
      realized: [],
    });
  });

  test("an unstructured contribution is not counted — a value nobody could check is not a recorded estimate", () => {
    const r = rollupTree(tree({ "Ship a shim": { contribution: "this will really help" } }));
    expect(r.buckets[0].contributionEstimates).toBe(0);
    expect(r.estimates).toEqual([]);
  });

  test("a human's `## Results` on the same node is read back as what actually moved", () => {
    const r = rollupTree(
      tree({
        "Ship a shim": {
          contribution: VALID,
          body: "prose\n\n## Results\n- 2026-09-17 retries up 1.4 per week, short of the +2 claimed",
        },
      }),
    );
    expect(r.estimates[0].realized).toEqual(["2026-09-17 retries up 1.4 per week, short of the +2 claimed"]);
  });
});

describe("ost_create_node — contribution field", () => {
  const OUTCOME = "Players keep playing";
  const OPPORTUNITY = "Players cannot tell what changed";
  const SOLUTION = "Ship a changelog";
  const BELIEF = "Players would read a changelog";

  let dir: string;
  let vault: Vault;
  let ctx: ToolContext;

  function put(title: string, layer: OstNode["layer"]): void {
    vault.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body: `prose for ${title}` } as OstNode);
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-contribution-field-"));
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
    vault = new Vault(dir);
    ctx = { vault, dir, remote: { enabled: false }, surface: "test:contribution-field" };
    put(OUTCOME, "Outcome");
    put(OPPORTUNITY, "Opportunity");
    vault.linkNodes(OUTCOME, OPPORTUNITY);
    put(SOLUTION, "Solution");
    vault.linkNodes(OPPORTUNITY, SOLUTION);
    put(BELIEF, "Assumption");
    vault.linkNodes(SOLUTION, BELIEF);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const create = (input: Record<string, unknown>): Promise<string> => {
    const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
    return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
  };

  test("an Opportunity may carry a checkable contribution estimate, and the reader picks it up", async () => {
    await create({
      title: "Players cannot tell what shipped this week",
      layer: "Opportunity",
      parent: OUTCOME,
      body: "the changelog gap",
      evidence: "assertion",
      contribution: VALID,
    });
    const written = new Vault(dir).read("Players cannot tell what shipped this week");
    expect(written.contribution).toBe(VALID);
    expect(isContributionEstimate(parseContributionEstimate(written.contribution))).toBe(true);
  });

  test("a Solution may carry one too", async () => {
    await create({
      title: "Ship a weekly digest",
      layer: "Solution",
      parent: OPPORTUNITY,
      body: "a digest",
      evidence: "assertion",
      contribution: VALID,
    });
    const written = new Vault(dir).read("Ship a weekly digest");
    expect(written.contribution).toBe(VALID);
  });

  test("created without one, a node reads as before — absent, not a blank estimate", async () => {
    await create({ title: "A fresh idea", layer: "Solution", parent: OPPORTUNITY, body: "an idea", evidence: "assertion" });
    const written = new Vault(dir).read("A fresh idea");
    expect(written.contribution).toBeUndefined();
  });

  test("refused for an AssumptionTest — the field only means something on an Opportunity or Solution", async () => {
    const before = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());

    await expect(
      create({
        title: "Some hunch",
        layer: "AssumptionTest",
        parent: BELIEF,
        body: "b",
        evidence: "assertion",
        humansRequired: "a person is the measurement here",
        contribution: VALID,
      }),
    ).rejects.toThrow(/contribution is only meaningful for an Opportunity or a Solution/);

    // Refused before anything is written, matching every other create-node guard.
    expect(fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile())).toEqual(before);
  });

  test("refused when the estimate does not parse — loose prose is not a checkable claim", async () => {
    await expect(
      create({
        title: "A hopeful solution",
        layer: "Solution",
        parent: OPPORTUNITY,
        body: "b",
        evidence: "assertion",
        contribution: "this should really help a lot",
      }),
    ).rejects.toThrow(/cannot carry that contribution estimate/);
  });
});
