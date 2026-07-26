/**
 * The skill is the other half of first-run handling. The MCP layer can report
 * `bootstrap: true`, but only the skill tells the reasoning session what to do
 * with it — and the one thing it must not do is invent the outcome, which is the
 * single human-set input the whole tree hangs from.
 *
 * These assertions are about *content*, not formatting; the byte-for-byte guard
 * lives in drift.test.ts.
 */
import { describe, expect, test } from "vitest";
import { renderSkill } from "../../scripts/gen-skill.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";

describe("the generated skill teaches the first run", () => {
  const skill = renderSkill();

  test("the ruleset carries the first-run steps, so both brains learn the same thing", () => {
    expect(OST_RULESET.firstRun.length).toBeGreaterThan(0);
  });

  test("it names the bootstrap signal the MCP layer actually emits", () => {
    expect(skill).toMatch(/bootstrap/);
    expect(skill).toMatch(/ost-agent init/);
  });

  test("it forbids inventing the outcome and requires asking the human", () => {
    const firstRun = OST_RULESET.firstRun.join("\n");
    expect(firstRun).toMatch(/ask the human/i);
    expect(firstRun).toMatch(/never invent|do not invent/i);
  });

  test("every first-run rule reaches the rendered skill", () => {
    for (const rule of OST_RULESET.firstRun) expect(skill).toContain(rule);
  });
});
