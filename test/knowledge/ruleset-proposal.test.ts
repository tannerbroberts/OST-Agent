/**
 * Instrument for "Acceptance rate of five self-drafted ruleset changes", beneath
 * "Agent proposes its own workflow changes for one-click adoption".
 *
 * The property under test is what makes the candidate safe rather than merely
 * clever: a PENDING proposal does not alter the ruleset the pass executes — the
 * agent keeps running the old workflow until a human accepts — and every proposal
 * carries the friction evidence ids that triggered it, so adoption is a decision
 * made against evidence rather than against prose.
 *
 * What a green here does NOT settle: whether the agent's self-proposed changes are
 * ones a human would accept (desirability) and whether reviewing one is cheaper
 * than writing it (usability). Those need the five-proposal human review the
 * assumption test describes; this spec only proves the machinery cannot surprise
 * the operator while that review is pending.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  decideRulesetProposal,
  draftRulesetProposal,
  effectiveRuleset,
  PROPOSABLE_SECTIONS,
  PROPOSALS_DIR,
  readRulesetProposals,
} from "../../src/knowledge/ruleset-proposal.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";
import { fileFriction } from "../../src/adapters/friction.js";
import { buildPassContext } from "../../src/runner/context.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { defaultConfigYaml } from "../../src/config/schema.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ruleset-proposal-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The three fields `fileFriction` now demands. Spread into filings whose subject is
 * something other than the fields themselves, so those tests keep saying what they
 * said — `test/telemetry/self-filed-friction-events.test.ts` is where the fields are
 * the point.
 */
const ACTIONABLE = {
  tool: "ost-agent check",
  input: "--vault (omitted)",
  expected: "it reads ost.vault.yaml and finds the tree",
} as const;

/** File real friction and hand back what a drafter would cite. */
function fileSomeFriction(note: string): string {
  return path.basename(fileFriction(dir, { ...ACTIONABLE, kind: "unclear-rule", note, source: "test" }));
}

function draft(overrides: Partial<Parameters<typeof draftRulesetProposal>[1]> = {}) {
  return draftRulesetProposal(dir, {
    section: "agentMust",
    rule: "State the vault directory in every report, so a reader never has to guess which tree was read.",
    rationale: "Three passes in a row guessed the vault path and two guessed wrong.",
    evidence: [fileSomeFriction("guessed the vault path again")],
    at: "2026-08-11T10:00:00.000Z",
    ...overrides,
  });
}

describe("every proposal carries the friction evidence ids that triggered it", () => {
  test("drafting with no evidence at all is refused", () => {
    expect(() => draft({ evidence: [] })).toThrow(/friction evidence/i);
  });

  test("drafting against friction that was never filed is refused — a dangling citation reviews nothing", () => {
    expect(() => draft({ evidence: ["INBOX:friction/2026-08-11-friction-never-filed.md"] })).toThrow(/does not resolve/i);
  });

  test("the ids land in the proposal file itself, in the shape the evidence layer recognises", () => {
    const a = fileSomeFriction("guessed the vault path");
    const b = fileSomeFriction("guessed it again the next day");
    const proposal = draft({ evidence: [a, b] });

    // Normalised to full `INBOX:friction/…` ids, whether cited as ids or filenames.
    expect(proposal.evidence).toEqual([`INBOX:friction/${a}`, `INBOX:friction/${b}`]);

    // And they are IN the file a reviewer opens, not only on the return value.
    const onDisk = fs.readFileSync(proposal.file, "utf8");
    expect(onDisk).toContain(`INBOX:friction/${a}`);
    expect(onDisk).toContain(`INBOX:friction/${b}`);

    // A later read of the vault sees the same ids.
    const { proposals } = readRulesetProposals(dir);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.evidence).toEqual(proposal.evidence);
  });
});

describe("a pending proposal does not alter the ruleset the pass executes", () => {
  test("the pass context ruleset is byte-for-byte the shipped ruleset while a proposal is pending", () => {
    const proposal = draft();
    expect(readRulesetProposals(dir).proposals[0]?.status).toBe("pending");

    // The ruleset every pass receives — built exactly the way `buildPassContext` builds it.
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(ctx.ruleset).toEqual(OST_RULESET);
    expect((ctx.ruleset.agentMust as readonly string[]).includes(proposal.rule)).toBe(false);
    expect(effectiveRuleset(dir).adopted).toEqual([]);
  });

  test("a REJECTED proposal never alters it either", () => {
    const proposal = draft();
    decideRulesetProposal(dir, proposal.id, { decision: "reject", by: "Tanner", at: "2026-08-11T11:00:00.000Z" });
    expect(buildPassContext(dir, { skipSources: true }).ruleset).toEqual(OST_RULESET);
  });

  test("only a human ACCEPT changes what the pass runs — and then it really changes", () => {
    const proposal = draft();
    decideRulesetProposal(dir, proposal.id, { decision: "accept", by: "Tanner", at: "2026-08-11T11:00:00.000Z" });

    const { ruleset, adopted, problems } = effectiveRuleset(dir);
    expect(adopted).toEqual([proposal.id]);
    expect(problems).toEqual([]);
    expect(ruleset.agentMust).toContain(proposal.rule);
    // Only the targeted section moved; nothing else drifted in the fold.
    expect(ruleset.agentMustNot).toEqual(OST_RULESET.agentMustNot);
    expect(ruleset.skillTools).toEqual(OST_RULESET.skillTools);

    // The same amended ruleset is what the next pass is handed.
    expect(buildPassContext(dir, { skipSources: true }).ruleset.agentMust).toContain(proposal.rule);
    // The shipped constant itself was never touched — the fold is per-vault, per-read.
    expect((OST_RULESET.agentMust as readonly string[]).includes(proposal.rule)).toBe(false);
  });

  test("a replacement names the current rule exactly, and adoption swaps rather than appends", () => {
    const current = OST_RULESET.agentMust[0];
    expect(() => draft({ replaces: "a rule nobody ever wrote" })).toThrow(/matches the text/i);

    const proposal = draft({ replaces: current });
    decideRulesetProposal(dir, proposal.id, { decision: "accept", by: "Tanner", at: "2026-08-11T11:00:00.000Z" });
    const { ruleset } = effectiveRuleset(dir);
    expect(ruleset.agentMust).toContain(proposal.rule);
    expect(ruleset.agentMust).not.toContain(current);
    expect(ruleset.agentMust).toHaveLength(OST_RULESET.agentMust.length);
  });
});

describe("adoption is one human action, and only that action", () => {
  test("a decision needs a name on it", () => {
    const proposal = draft();
    expect(() => decideRulesetProposal(dir, proposal.id, { decision: "accept", by: "  " })).toThrow(/name/i);
  });

  test("a proposal is decided exactly once — no re-deciding an accepted or rejected one", () => {
    const proposal = draft();
    decideRulesetProposal(dir, proposal.id, { decision: "reject", by: "Tanner", at: "2026-08-11T11:00:00.000Z" });
    expect(() => decideRulesetProposal(dir, proposal.id, { decision: "accept", by: "Tanner" })).toThrow(/already rejected/i);
  });

  test("no tool on the MCP surface can draft or decide a proposal — the agent must never adopt its own", () => {
    // Drafting and deciding are CLI-only (`ost-agent propose-rule` / `ost-agent proposal`).
    // The closed MCP surface names no proposal tool, so an unattended session
    // holds no path from "wrote a proposal" to "runs under it".
    for (const name of MCP_TOOL_NAMES) {
      expect(name).not.toMatch(/proposal|propose/i);
    }
  });

  test("the sections a proposal may touch are rule prose, never the tool grant list", () => {
    expect(PROPOSABLE_SECTIONS).not.toContain("skillTools" as never);
    expect(() => draft({ section: "skillTools" as never })).toThrow(/not a section a proposal may touch/i);
    expect(() => draft({ section: "layers" as never })).toThrow(/not a section a proposal may touch/i);
  });

  test("an accepted replacement whose target rule has since changed is reported, never guessed at", () => {
    const proposal = draft({ replaces: OST_RULESET.agentMust[0] });
    decideRulesetProposal(dir, proposal.id, { decision: "accept", by: "Tanner", at: "2026-08-11T11:00:00.000Z" });
    // Simulate the shipped rule changing after acceptance: point the stored
    // `replaces` at text that no longer exists.
    const raw = fs.readFileSync(proposal.file, "utf8");
    fs.writeFileSync(proposal.file, raw.replace(/^replaces: .*$/m, 'replaces: "text the ruleset no longer contains"'), "utf8");

    const { ruleset, adopted, problems } = effectiveRuleset(dir);
    expect(adopted).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/no longer in "agentMust"/);
    expect(ruleset).toEqual(OST_RULESET);
  });

  test("proposals live inside the vault, where the tree's own git history versions them", () => {
    const proposal = draft();
    expect(proposal.file.startsWith(path.join(dir, PROPOSALS_DIR))).toBe(true);
  });
});
