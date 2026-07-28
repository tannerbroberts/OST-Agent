/**
 * The loop has to know darkness exists, or the genome is a policy nothing ever
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

  test("the class is read off the tool output and the vocabulary is NEVER restated — the classifier is a genome allele, not a constant in a skill file", () => {
    expect(skill).toMatch(/genome/i);
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

  test("the unattended sweep holds NO outward-sensing grant — looking costs money, and money stays an attended decision", () => {
    const frontmatter = pass.slice(0, pass.indexOf("---", 3));
    expect(frontmatter).toContain("allowed-tools:");
    expect(frontmatter).not.toContain("ost_search_web");
    expect(frontmatter).not.toContain("ost_read_web");
    expect(frontmatter).not.toContain("ost_read_repo");
  });

  test("it does NOT restate the class vocabulary either — one copy of the classifier, and it lives in the genome", () => {
    expect(pass).not.toMatch(/\bunreached\b/i);
  });
});
