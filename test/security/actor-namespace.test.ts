/**
 * A commissioned first-party pipeline and a web publisher are different KINDS of
 * source, with different ceilings, and neither can be named as the other.
 * (V1 readiness, B6.)
 *
 * B6's criterion had two halves and this file is deliberately behavioural about both,
 * driven through the tools an agent actually holds rather than against the ledger's
 * unit API — the guard that is unit-tested but unwired is the failure B12 names.
 *
 * (a) **The trap, pinned as a regression.** `rankHost({host: 'stripe-webhook-feed',
 *     rung: 'expert'})` used to SUCCEED: `normalizeHost` is a no-op on a bare word, so a
 *     pipeline took a row in the publisher namespace, under the publisher's ceiling.
 *     The refusal is pinned here, and so is the fact that a real hostname still works —
 *     a guard that refused everything would pass the first assertion and be useless.
 *
 * (b) **A first-party commissioned pipeline can hold `observed`, and a web host cannot.**
 *     Not by promotion: `instrument` starts at `observed` and can only fall, which is
 *     the right asymmetry for a measuring device. The web host's refusal text is pinned
 *     because the sentence is the product — an agent that is refused without being told
 *     what would satisfy the rule just tries again.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import {
  actorKey,
  readTrustLedger,
  rungOf,
  TRUST_CEILINGS,
  webStanding,
} from "../../src/knowledge/actor-trust.js";
import { rungRank } from "../../src/knowledge/believability.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { Vault } from "../../src/ost/vault.js";
import { RESULTS_HEADING } from "../../src/ost/headings.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-b6-"));
  vault = new Vault(dir);
  vault.createNode({ title: "Ship the thing", layer: "Outcome", tags: [], links: [], body: "root" });
  vault.createNode({ title: "Users churn", layer: "Opportunity", tags: [], links: [], body: "an opportunity" });
  vault.linkNodes("Ship the thing", "Users churn");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

type Runnable = { name: string; run: (i: unknown) => Promise<string> };
function tool(name: string): Runnable {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  return buildOstTools(ctx).find((t) => t.name === name) as unknown as Runnable;
}

describe("B6(a) — the trap, pinned", () => {
  test("a bare pipeline name can no longer take a row in the publisher namespace", async () => {
    await expect(
      tool("ost_rank_source").run({
        kind: "web",
        id: "stripe-webhook-feed",
        direction: "contradicted",
        reason: "it stopped delivering",
      }),
    ).rejects.toThrow(/"stripe-webhook-feed" is not a hostname/);
    // The refusal says where such a thing DOES belong, so the agent has somewhere to go.
    await expect(
      tool("ost_rank_source").run({ kind: "web", id: "stripe-webhook-feed", direction: "contradicted", reason: "r" }),
    ).rejects.toThrow(/kind 'instrument'.*kind 'channel'/s);
    expect(fs.existsSync(path.join(dir, ".ost-agent", "trust", "actors.jsonl"))).toBe(false);
  });

  test("a real publisher still works, through the same constructor — the guard is not refusing everything", async () => {
    const out = await tool("ost_rank_source").run({
      kind: "web",
      id: "https://www.Example.com/some/post",
      direction: "contradicted",
      reason: "their headline number did not replicate on our funnel",
    });
    expect(out).toContain("web:example.com");
    expect(webStanding(readTrustLedger(dir), "example.com")).toBe("assertion");
  });

  test("the two namespaces do not overlap: an instrument name is not a host, and a host is not an instrument", async () => {
    await expect(
      tool("ost_rank_source").run({ kind: "web", id: "transcript", direction: "contradicted", reason: "r" }),
    ).rejects.toThrow(/is not a hostname/);
    await expect(
      tool("ost_rank_source").run({ kind: "instrument", id: "example.com", direction: "contradicted", reason: "r" }),
    ).rejects.toThrow(/not a declared instrument/);
  });
});

describe("B6(b) — a commissioned pipeline holds 'observed'; a publisher cannot", () => {
  /**
   * Attach a node under the opportunity, through the tool the agent actually holds.
   *
   * The kill criteria are supplied here rather than per call for the same reason
   * `parent` is: every node this block creates is a Solution, the boundary now
   * requires both halves on one, and this block is asking about rungs.
   */
  const create = (input: Record<string, unknown>) =>
    tool("ost_create_node").run({ parent: "Users churn", ...KILL_CRITERIA, ...input });

  test("a first-party instrument's provenance carries a node at 'observed'", async () => {
    writeEvidence(
      dir,
      { id: "TRANSCRIPT:8fc8d6e3", source: "TRANSCRIPT:8fc8d6e3", title: "session", timestamp: "", body: "they abandoned setup" },
      "transcript",
    );
    const out = await create({
      title: "Setup is abandoned at step three",
      layer: "Solution",
      body: "recorded in the session",
      source: "TRANSCRIPT:8fc8d6e3",
      evidence: "observed",
    });
    expect(out).toMatch(/Setup is abandoned/);
    expect(vault.read("Setup is abandoned at step three").evidence).toBe("observed");
    // And at the ledger: `observed` is where an instrument STARTS. Nothing was promoted.
    expect(rungOf(readTrustLedger(dir), actorKey("instrument", "transcript"))).toBe("observed");
    expect(TRUST_CEILINGS.instrument).toBe("observed");
  });

  test("a web publisher's provenance cannot, and the refusal names the way out", async () => {
    await expect(
      create({
        title: "The industry says setup is abandoned",
        layer: "Solution",
        body: "a blog post said so",
        source: "WEB:example.com",
        evidence: "observed",
      }),
    ).rejects.toThrow(/cannot declare 'observed'/);
    await expect(
      create({
        title: "The industry says setup is abandoned",
        layer: "Solution",
        body: "a blog post said so",
        source: "WEB:example.com",
        evidence: "observed",
      }),
    ).rejects.toThrow(/no byline confers them/);
  });

  test("no amount of corroboration lifts a publisher to a measurement rung", async () => {
    // Drive the raise through the real surface, three times over, with a real join each
    // time — the strongest version of "the ceiling is not a starting condition".
    for (const n of [1, 2, 3, 4]) {
      const title = `Their claim held ${n}`;
      vault.createNode({
        title,
        layer: "AssumptionTest",
        body: "## Method\nran it\n",
        tags: [],
        links: [],
        source: "WEB:example.com",
      });
      vault.appendUnderSection(title, RESULTS_HEADING, `- 2026-01-0${n} **supported** (ran by Tanner) — held`);
      await tool("ost_rank_source").run({
        kind: "web",
        id: "example.com",
        direction: "corroborated",
        reason: `corroborated by [[${title}]]`,
      });
    }
    const earned = webStanding(readTrustLedger(dir), "example.com");
    expect(earned).toBe("expert");
    expect(rungRank(earned)).toBeGreaterThan(rungRank("observed"));
    // Non-vacuity: the four corroborations DID do something — the host is off the floor.
    expect(earned).not.toBe("assertion");
  });
});
