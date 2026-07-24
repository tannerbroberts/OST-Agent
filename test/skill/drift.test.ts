import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { renderSkill, SKILL_PATH } from "../../scripts/gen-skill.js";

describe("generated skill", () => {
  test("the committed SKILL.md is in sync with OST_RULESET (run `npm run gen:skill`)", () => {
    expect(fs.existsSync(SKILL_PATH)).toBe(true);
    const committed = fs.readFileSync(SKILL_PATH, "utf8");
    expect(committed).toBe(renderSkill());
  });
});
