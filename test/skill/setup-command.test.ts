/**
 * The front door.
 *
 * v0.11.0 made first run *reportable*: `ost_next_work` answers `bootstrap: true`
 * instead of failing, and the skill learned a branch for it. It did nothing to
 * make first run *discoverable*. A stranger who runs `/plugin install` and opens
 * a session still sees no prompt and no reason to believe anything is waiting —
 * the bootstrap branch only fires once they ask for discovery work, which is the
 * thing they installed this to learn how to do.
 *
 * `/ost-setup` is the affordance that closes that: a name in the slash-command
 * menu, which is where someone who has just installed a plugin actually looks.
 *
 * It is generated from `OST_RULESET.firstRun`, the same source the skill renders
 * from, so the menu entry and the skill branch cannot teach different things.
 * These tests are about content and packaging; the byte-for-byte guard lives in
 * drift.test.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  COMMANDS_DIR,
  renderSetupCommand,
  SETUP_COMMAND_PATH,
} from "../../scripts/gen-skill.js";
import { OST_RULESET } from "../../src/knowledge/ruleset.js";

const PLUGIN_MANIFEST = path.resolve(SETUP_COMMAND_PATH, "..", "..", "..", ".claude-plugin", "plugin.json");

describe("the generated /ost-setup command", () => {
  const cmd = renderSetupCommand();

  test("it carries frontmatter a slash command needs, and a description that reads as a front door", () => {
    expect(cmd.startsWith("---\n")).toBe(true);
    const fm = cmd.slice(4, cmd.indexOf("\n---\n", 3));
    expect(fm).toMatch(/^description: /m);
    expect(fm).toMatch(/set up/i);
  });

  test("it can read the bootstrap state it is supposed to branch on", () => {
    expect(cmd).toMatch(/allowed-tools:.*mcp__ost-agent__ost_next_work/);
  });

  test("its shell allowance is scoped to the two setup commands, not to a shell", () => {
    const allowed = /^allowed-tools: (.*)$/m.exec(cmd)?.[1] ?? "";
    const bashGrants = allowed.split(",").map((s) => s.trim()).filter((s) => s.startsWith("Bash("));
    expect(bashGrants.length).toBeGreaterThan(0);
    // Every Bash grant names a concrete ost-agent subcommand. A bare `Bash` or
    // `Bash(*)` would hand a shell to the one product whose whole promise is
    // that it has no shell tool.
    for (const grant of bashGrants) {
      // One launch path: the bundle the plugin ships. No PATH binary, no registry.
      expect(grant).toMatch(
        /^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/ost-agent\.mjs (init|set-outcome):\*\)$/,
      );
    }
  });

  test("every first-run rule reaches the command, so it cannot drift from the skill", () => {
    for (const rule of OST_RULESET.firstRun) expect(cmd).toContain(rule);
  });

  test("it asks the human for the outcome and refuses to invent one", () => {
    expect(cmd).toMatch(/ask the human/i);
    expect(cmd).toMatch(/never invent/i);
    expect(cmd).toMatch(/ost-agent\.mjs init/);
    expect(cmd).toMatch(/ost-agent\.mjs set-outcome/);
  });

  test("it says setup needs no API key — the wall a stranger hits first", () => {
    expect(cmd).toMatch(/no model and no API key|needs no model/i);
  });

  test("it handles the already-set-up case instead of re-initialising over a live vault", () => {
    expect(cmd).toMatch(/already/i);
    expect(cmd).toMatch(/\/ost-status/);
  });
});

describe("packaging — the front door has to actually ship", () => {
  test("the command file lives in the directory the plugin manifest points at", () => {
    const manifest = JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, "utf8")) as { commands: string[] };
    const declared = manifest.commands.map((c) => path.resolve(path.dirname(PLUGIN_MANIFEST), "..", c));
    expect(declared).toContain(path.resolve(COMMANDS_DIR));
    expect(fs.existsSync(SETUP_COMMAND_PATH)).toBe(true);
  });

  test("the file is named /ost-setup", () => {
    expect(path.basename(SETUP_COMMAND_PATH)).toBe("ost-setup.md");
  });
});
