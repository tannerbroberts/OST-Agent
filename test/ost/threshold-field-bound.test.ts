/**
 * The `threshold` field carries a bound, or it carries nothing.
 *
 * v0.9.x gave an AssumptionTest a `threshold` frontmatter field so the tool
 * would *read* the pre-commitment rather than scrape it out of prose. That half
 * shipped additively and correctly, and it shipped with the field accepting any
 * string — which the node's own Issues entry named as the live risk, in as many
 * words: does an author "just re-paste the same hard-wrapped prose into the
 * field"? The assumption beneath it puts the cost plainly — "the field fills
 * with the same unbounded sentence, at which point the structure improved and
 * the commitment did not."
 *
 * That is not a cosmetic loss. A test whose bar is a sentence cannot come out a
 * failure: whatever the run returns, a reader who wants to build the thing can
 * read it as a pass. It is also load-bearing for the build loop — `confirmPermit`
 * keeps a `no-spec` instrument's build permit if and only if the test carries a
 * `bound` threshold, so an unbounded one is the difference between handing a
 * builder a definition of done and handing them nothing.
 *
 * The bar this file holds, and it is about the FIELD only:
 *
 *  1. a threshold field parses to an actual bound — the comparator and the
 *     number it commits to, adjacent, on one line;
 *  2. relocated prose is refused at the only door that writes the field
 *     (`ost_create_node`), with a refusal that names the fallback rather than
 *     stranding the author;
 *  3. the strict field reading is a SUBSET of the census classifier — anything
 *     the field accepts, `thresholdKindOf` also calls `bound`. Three consumers
 *     already read that classifier two ways; a fourth that could clear what the
 *     others refuse would be worse than any of them.
 *  4. nothing above touches the prose fallback. Tests written before the field
 *     existed read exactly as they did, which is the whole reason the field
 *     could be optional in the first place.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { askedOf, parseThresholdField, thresholdKindOf } from "../../src/eval/coverage.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

/**
 * Bars this vault and its sibling actually carry, in the forms they carry them.
 * Word-numbers are in here on purpose: this repository has already refused a
 * threshold for spelling its numbers out and accepted the same threshold in
 * digits, and a rule that turns on typography is not reading the commitment.
 */
const BARS = [
  "at least 5 of 20 book a kickoff.",
  "10 of 15 or more classify as bound",
  ">= 2 incidents beyond the known one, else defer",
  "no more than a third may fail.",
  "at least three are retired, and no candidate whose criterion was met is still live.",
  "the false-refusal rate must be at or below 5%",
  "20 arrivals across both arms, and revert if either arm sees none at all.",
  "zero hits on a link that resolves",
  "0 hits on a link that resolves",
  "fewer than ten sessions need a second pass",
  "90% or better",
  "between 5 and 10 responses",
  "unanimous",
] as const;

/**
 * The other half of the pair, and the reason this file exists. Every one of
 * these is a sentence somebody could reasonably paste into a field labelled
 * "threshold" — including two lifted from the assumption test that commissioned
 * this build, which describe a study and fix nothing.
 */
const NOT_BARS = [
  "Fix the minimum number before starting.",
  "Decide the acceptable failure rate before looking at the data.",
  "The piece survives a page reload.",
  "Over the next 15 AssumptionTest nodes created with the field available, classify each threshold value.",
  "Whether the field is doing its job, judged once we have seen enough of them.",
  "Two numbers, both fixed in advance: the lift that would justify building it, and the sentiment floor.",
  "",
  "   ",
] as const;

describe("a threshold field parses to a bound — a comparator and the number it commits to", () => {
  test.each(BARS)("bound: %s", (bar) => {
    const reading = parseThresholdField(bar);
    expect(reading.bound, `expected a bound in: ${bar}`).toBe(true);
    // The bar it found is reported, not just a yes — a refusal message that can
    // quote the thing it read is the difference between a guard and a wall.
    if (reading.bound) expect(bar.toLowerCase()).toContain(reading.bar.toLowerCase());
  });

  test.each(NOT_BARS)("not a bound: %s", (prose) => {
    const reading = parseThresholdField(prose);
    expect(reading.bound, `expected no bound in: ${prose}`).toBe(false);
    if (!reading.bound) expect(reading.reason.length).toBeGreaterThan(0);
  });

  test("a comparator and a number in one sentence is not a bar unless they are about each other", () => {
    // This is the assertion the cheap version of this check fails. "Over the
    // next 15 nodes" has `over` and `15` in it and commits to nothing; the
    // adjacency requirement is what tells it apart from "over 15".
    expect(parseThresholdField("Over the next 15 AssumptionTest nodes, classify each threshold.").bound).toBe(false);
    expect(parseThresholdField("over 15 of them classify as bound").bound).toBe(true);
  });

  test("a bar hard-wrapped into the field is refused as the relocation it is", () => {
    // The named failure mode, verbatim: the same paragraph, moved. The bar is
    // real and the wrapping is what says a paragraph was pasted rather than a
    // commitment written, so the one-line rule is the field's only edge over
    // the prose scan — which by design reads across line breaks.
    const wrapped = "at least 5 of 20 book a kickoff, measured over the first\ntwo weeks after the invitations go out.";
    const reading = parseThresholdField(wrapped);
    expect(reading.bound).toBe(false);
    if (!reading.bound) expect(reading.reason).toMatch(/one line/i);
    expect(parseThresholdField(wrapped.replace("\n", " ")).bound).toBe(true);
  });

  test("whatever the field accepts, the census also counts as a fixed bar", () => {
    // The subset invariant. `debt`, `rollup` and `confirmPermit` already draw
    // the unfixed line in two different places; the one thing a new reader must
    // not do is clear a threshold all three of them would call unfixed.
    for (const bar of BARS) {
      const node: OstNode = { title: bar, layer: "AssumptionTest", tags: [], links: [], body: "no lead-in in here", threshold: bar };
      expect(parseThresholdField(bar).bound).toBe(true);
      expect(thresholdKindOf(node), `census disagrees about: ${bar}`).toBe("bound");
    }
  });
});

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-threshold-bound-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  ctx = { vault, dir, remote: { enabled: false }, surface: "test:threshold-bound" };
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

// `humansRequired` rather than an instrument, for the same reason the sibling
// file uses it: whether invitees book is a person's reaction, and this file is
// about the threshold field, not the instrument beside it.
const TEST_NODE = {
  title: "At least 5 of 20 book a kickoff",
  layer: "AssumptionTest",
  parent: BELIEF,
  body: "run the pilot with 20 invitees",
  evidence: "assertion",
  humansRequired: "20 invited people either book or do not; their reaction is the measurement",
} as const;

const files = (): string[] => fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isFile());

describe("ost_create_node refuses a threshold field that is not a bar", () => {
  test("a bar is written, and reads back as one", async () => {
    await create({ ...TEST_NODE, threshold: "at least 5 of 20 book a kickoff." });

    const written = new Vault(dir).read(TEST_NODE.title);
    expect(written.threshold).toBe("at least 5 of 20 book a kickoff.");
    expect(thresholdKindOf(written)).toBe("bound");
  });

  test("relocated prose is refused, and nothing is written", async () => {
    const before = files();

    await expect(create({ ...TEST_NODE, threshold: "Judge whether the kickoffs felt worth the invitations." })).rejects.toThrow(
      /cannot carry that threshold/,
    );

    // Refused before anything reaches disk, like every other create-node guard:
    // a half-written node is a worse outcome than a refused call.
    expect(files()).toEqual(before);
  });

  test("the refusal names the way out, so a threshold that needs an argument is not lost", async () => {
    // The opportunity behind this work says whatever gets built must be a report
    // before it is a refusal, and its stated worry is that a rule which nags
    // about good thresholds gets switched off. This is a refusal, so it earns
    // its place by never being a dead end: the prose fallback is in the message.
    await expect(create({ ...TEST_NODE, threshold: "Decide the acceptable failure rate first." })).rejects.toThrow(
      /Pre-committed threshold/,
    );
  });

  test("the layer refusal still comes first — a Solution with a bar is a caller error, not a bad bar", async () => {
    await expect(
      create({ title: "A fresh idea", layer: "Solution", parent: OPPORTUNITY, body: "an idea", evidence: "assertion", threshold: "x" }),
    ).rejects.toThrow(/threshold is only meaningful for an AssumptionTest/);
  });

  test("the fallback is untouched: no field, and the body's prose lead-in reads exactly as before", async () => {
    // The additive half's whole justification. A test that carries its bar as
    // prose — including one that carries no bar at all — is not this guard's
    // business; the census reports on those, and reporting was the order the
    // parent opportunity asked for.
    await create({
      ...TEST_NODE,
      title: "A test whose bar travels with its argument",
      body: "run the pilot\n\n**Pre-committed threshold:** at least 5 of 20 book, and defer if fewer, because the invitation list is the confound.",
    });

    const written = new Vault(dir).read("A test whose bar travels with its argument");
    expect(written.threshold).toBeUndefined();
    expect(askedOf(written)).toMatch(/^at least 5 of 20 book/);
    expect(thresholdKindOf(written)).toBe("bound");

    await create({ ...TEST_NODE, title: "A test with no bar anywhere", body: "run the pilot and see" });
    expect(thresholdKindOf(new Vault(dir).read("A test with no bar anywhere"))).toBe("absent");
  });
});
