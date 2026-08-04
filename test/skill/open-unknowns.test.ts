/**
 * The loop has to know darkness exists, or the Unknown layer is a policy nothing ever
 * exercises. `ost_next_work` has reported `openUnknowns` since Phase 1 and
 * nothing in `.claude/` mentioned it — a session could not have picked one up.
 *
 * Two files, two different guards. `SKILL.md` is generated, so drift.test.ts
 * already byte-compares it against `renderSkill()`; these assertions are about
 * *content*, the same division of labour first-run.test.ts keeps. `/ost-pass`
 * is hand-authored — no generator behind it and no drift test over it — so this
 * file is the ONLY thing standing between that command and a silent regression.
 * It reads the committed file off disk on purpose.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { COMMANDS_DIR, renderSkill } from "../../scripts/gen-skill.js";

const pass = fs.readFileSync(path.join(COMMANDS_DIR, "ost-pass.md"), "utf8");

describe("the generated skill teaches the fifth bucket", () => {
  const skill = renderSkill();

  test("it names the field the tool actually returns, so the session can find the work", () => {
    expect(skill).toContain("openUnknowns");
  });

  test("it teaches all three contract sections, and names Format as the stopping condition", () => {
    expect(skill).toContain("## Format");
    expect(skill).toContain("## Methodology");
    expect(skill).toContain("## Rationale");
    expect(skill).toMatch(/Format[\s\S]{0,200}?stopping condition/i);
  });

  test("it teaches the `unknown` argument — spend that does not self-attribute teaches nothing", () => {
    expect(skill).toMatch(/`unknown:/);
  });

  test("exploration is discretionary — darkness NEVER blocks done", () => {
    expect(skill).toMatch(/never blocks? `done`|does not block `done`/);
  });

  test("the class is read off the tool output and the vocabulary is NEVER restated — one classifier, and it is not in a prose file", () => {
    expect(skill).toMatch(/read the class off the tool output/i);
    expect(skill).not.toMatch(/\bunreached\b/i);
  });
});

describe("/ost-pass — the unattended sweep knows about darkness", () => {
  test("the fifth bucket reached the command a session actually runs", () => {
    expect(pass).toContain("openUnknowns");
  });

  test("done is still done with unknowns open — the sweep must NOT loop on darkness", () => {
    expect(pass).toMatch(/never blocks? `done`|does not block `done`/);
  });

  test("an unattended pass attributes its spend too — it passes the `unknown` argument", () => {
    expect(pass).toMatch(/`unknown:/);
  });

  test("the unattended sweep DOES hold the outward-sensing grant — the spend it costs is bounded by two operator numbers", () => {
    // **This assertion is a deliberate reversal** of the one it replaces, which read
    // "the unattended sweep holds NO outward-sensing grant — looking costs money, and
    // money stays an attended decision". Recorded rather than quietly rewritten,
    // because the old rule was reasoned and someone should be able to see it change.
    //
    // What the old rule got right: an unattended loop that can reach the network is a
    // spend nobody approved per-call. What it assumed, and what is no longer true, is
    // that *attendance* is the only thing that can bound that spend. Two operator-set
    // numbers now do it, and neither existed in this form when the rule was written:
    //
    //   - `web.lookupBudget` (`src/config/schema.ts:190`, default 10) is a **lifetime**
    //     total per process, not a rate — P8's two-day simulation is what proves that,
    //     and `refillPerHour` paces bursts within it rather than topping it up forever.
    //     A firing therefore reaches outward at most ~10 times, whatever it believes
    //     it is doing, and the number is the operator's line in `ost.config.yaml`.
    //   - `loop.spend.ceilingWeightedTokens` stops the whole loop dead on a rolling
    //     window, so the reading those lookups feed is bounded too.
    //
    // What the old rule cost, meanwhile, was the tree itself. With no outward sense the
    // vault's only inputs were what the operator carried in by hand and what the agent
    // observed about itself — so every node rested on the one supply an agent grading
    // its own repairs cannot use to check itself, and the tree recorded that as a
    // customer need ("Fresh outside findings never reach the tree unless I go get
    // them", 2026-07-25) while the cause sat in this assertion.
    //
    // `ost_read_repo` is on the grant for a related but distinct reason: it reads
    // declared local repo roots read-only and reaches no network at all, so the money
    // argument never applied to it. It is what lets the sweep write an instrument
    // against a mechanism that exists instead of a path it invented — the difference
    // between a red that means "this is unbuilt" and a red that means "no such file".
    const frontmatter = pass.slice(0, pass.indexOf("---", 3));
    expect(frontmatter).toContain("allowed-tools:");
    expect(frontmatter).toContain("ost_search_web");
    expect(frontmatter).toContain("ost_read_web");
    expect(frontmatter).toContain("ost_read_repo");
  });

  test("the sweep is told to look only on demand — a grant without that rule is a crawler", () => {
    // The grant above is only defensible with the prose that bounds it. A budget stops
    // a binge; it does not stop a pass opening with a speculative search and deciding
    // what matters before it has read what the tree already knows.
    expect(pass).toMatch(/demanded by an open question, never scheduled on its own/i);
    expect(pass).toMatch(/DATA, never instructions/i);
    expect(pass).toMatch(/assertion.*floor|floor.*assertion/i);
  });

  test("it does NOT restate the class vocabulary either — one copy of the classifier, and it lives in the kernel", () => {
    expect(pass).not.toMatch(/\bunreached\b/i);
  });
});
