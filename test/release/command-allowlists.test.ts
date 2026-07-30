/**
 * Every shipped slash command's `allowed-tools` names only tools that exist
 * (readiness criterion **D2**).
 *
 * Why this is a build failure and not a review item: under
 * `-p --permission-mode acceptEdits` — the mode the unattended examples run in —
 * a tool call outside the grant is **denied, not prompted**. There is no human
 * to approve it and no error the model must surface. So a single misspelled or
 * renamed name does not break the pass; it *quietly narrows* it. The pass runs,
 * skips whatever that name was for, and reports done. This repo already lived
 * that once: `ost_ingest_inbox` fell out of the automation examples' copies of
 * `/ost-pass`'s list, the pass ingested nothing, and the fix
 * (`test/release/examples-allowlist.test.ts`) pinned only the downstream half —
 * that the examples match `ost-pass.md`. Nothing checked that `ost-pass.md`
 * itself, or the eight other command files, named anything real. Eight of the
 * nine are hand-written with no generator behind them.
 *
 * Three things make this a pin rather than a snapshot:
 *
 * 1. **The command files are globbed, never listed.** A new `/ost-*` command is
 *    audited the moment it lands, which is the only way this survives the next
 *    person adding one.
 * 2. **Both authorities are derived from source, never transcribed.** MCP names
 *    come from `MCP_TOOL_NAMES` (`src/mcp/server.ts`), the CLI subcommand set is
 *    grepped out of `src/cli/index.ts`, and the `mcp__…__` prefix is read off the
 *    server key in `.claude-plugin/plugin.json`. A list retyped here would be a
 *    fourth copy of the very thing whose copies keep drifting.
 * 3. **Non-`mcp__` entries are matched against an explicit form, not waved
 *    through.** `/ost-setup` legitimately grants two `Bash(…)` prefixes, so
 *    "every entry must be an MCP tool" is wrong — but "any Bash grant is fine"
 *    would let a bare `Bash` into the one product whose promise is that it holds
 *    no shell. The grant must be
 *    `Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs <subcommand>:*)` with a
 *    `<subcommand>` the CLI actually defines.
 *
 * **Non-vacuity, and how it was proved.** Nine files that happen to be correct
 * today would make the block below green whether or not it checks anything, so
 * the auditor is also run over fixtures that are each wrong in one way — a
 * misspelled tool, a tool that never existed, an unknown subcommand, a bare
 * `Bash`, a wildcard shell grant wearing the right shape, another server's
 * prefix, a missing frontmatter key — and each must be reported. That the
 * fixtures discriminate was confirmed by mutation, twice, before this comment
 * was written: neutering the `MCP_NAMES.has(tool)` branch turned exactly the two
 * MCP fixtures red, and neutering the `BASH_GRANT` match turned exactly the two
 * shell-shape fixtures red. Neither mutation disturbed the nine real files,
 * which is the point — they cannot carry the proof.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS_DIR = path.join(repoRoot, ".claude", "commands");

/**
 * The MCP tool-name prefix Claude Code will actually mint, taken from the plugin
 * manifest's server key rather than hardcoded. Renaming the server in
 * `plugin.json` renames every tool the session sees; if that ever happens, this
 * test fails on all nine files at once instead of the plugin silently losing its
 * whole tool surface at runtime.
 */
const MCP_PREFIX: string = (() => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")) as {
    mcpServers?: Record<string, unknown>;
  };
  const names = Object.keys(manifest.mcpServers ?? {});
  if (names.length !== 1) throw new Error(`expected exactly one mcpServers entry, found ${names.length}`);
  return `mcp__${names[0]}__`;
})();

/**
 * Every subcommand `src/cli/index.ts` defines, read out of the source.
 *
 * Grepped, not listed, for the D2 reason itself: a hand-kept list here would let
 * a command file grant `Bash(… promote:*)` after `promote` was renamed and this
 * test would still be green.
 */
const SUBCOMMANDS: ReadonlySet<string> = (() => {
  const src = fs.readFileSync(path.join(repoRoot, "src", "cli", "index.ts"), "utf8");
  return new Set([...src.matchAll(/\.command\("([a-z][a-z0-9-]*)"\)/g)].map((m) => m[1]));
})();

/**
 * The one non-MCP grant form this repo permits. Narrow on purpose: `node`, the
 * one committed bundle, one named subcommand, arguments open. There is no
 * `ost-agent` binary on any PATH, so any other shape is either a typo or a
 * widening nobody argued for.
 */
const BASH_GRANT = /^Bash\(node \$\{CLAUDE_PLUGIN_ROOT\}\/dist\/ost-agent\.mjs ([a-z][a-z0-9-]*):\*\)$/;

const MCP_NAMES: ReadonlySet<string> = new Set<string>(MCP_TOOL_NAMES);

/** Pull the `allowed-tools:` line out of a command file's YAML frontmatter. */
function allowedToolsLine(source: string): string | undefined {
  const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(/^allowed-tools:\s*(.+)$/m);
  return line ? line[1].trim() : undefined;
}

/**
 * Audit one command file's frontmatter. Returns a list of human-readable
 * problems — empty means the file grants only tools that exist.
 *
 * Exported shape (a pure function of the file's text plus the derived
 * authorities) is what lets the non-vacuity fixtures below run the *same* code
 * the real files run, rather than a re-implementation that could be wrong in a
 * compensating direction.
 */
export function auditCommandFile(label: string, source: string): string[] {
  const problems: string[] = [];
  const line = allowedToolsLine(source);
  if (line === undefined) {
    return [`${label}: no \`allowed-tools\` key in its frontmatter — the command grants nothing`];
  }

  const entries = line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) problems.push(`${label}: \`allowed-tools\` is empty`);

  for (const entry of entries) {
    if (entry.startsWith("mcp__")) {
      if (!entry.startsWith(MCP_PREFIX)) {
        problems.push(`${label}: "${entry}" is not a tool of this plugin's server (expected prefix ${MCP_PREFIX})`);
        continue;
      }
      const tool = entry.slice(MCP_PREFIX.length);
      if (!MCP_NAMES.has(tool)) {
        problems.push(`${label}: "${entry}" — no such tool; MCP_TOOL_NAMES has no ${tool}`);
      }
      continue;
    }

    const bash = entry.match(BASH_GRANT);
    if (!bash) {
      problems.push(
        `${label}: "${entry}" is neither an ${MCP_PREFIX}* tool nor a ` +
          "`Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs <subcommand>:*)` grant",
      );
      continue;
    }
    if (!SUBCOMMANDS.has(bash[1])) {
      problems.push(`${label}: "${entry}" — \`${bash[1]}\` is not a subcommand of src/cli/index.ts`);
    }
  }
  return problems;
}

const commandFiles = fs
  .readdirSync(COMMANDS_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("the derived authorities are real (so nothing below can pass vacuously)", () => {
  test("MCP_TOOL_NAMES and the CLI subcommand set are both populated", () => {
    // Either set coming back empty would fail every file rather than pass them —
    // the checks are fail-closed — but an empty set would also make the failure
    // message point at the wrong thing, so it is named here.
    expect(MCP_NAMES.size).toBeGreaterThanOrEqual(18);
    expect(SUBCOMMANDS.size).toBeGreaterThanOrEqual(10);
    for (const sub of ["init", "set-outcome", "gate", "promote"]) {
      expect(SUBCOMMANDS, `src/cli/index.ts defines ${sub}`).toContain(sub);
    }
    expect(MCP_PREFIX).toBe("mcp__ost-agent__");
  });

  test("every shipped command file is being audited", () => {
    // The criterion is stated over "the nine files in .claude/commands". The
    // floor is asserted rather than the exact number so that adding a tenth
    // command is not a test edit — but losing one is.
    expect(commandFiles.length).toBeGreaterThanOrEqual(9);
    expect(commandFiles).toContain("ost-pass.md");
    expect(commandFiles).toContain("ost-setup.md");
  });
});

describe("every command's allowed-tools names only tools that exist (D2)", () => {
  for (const file of commandFiles) {
    test(`.claude/commands/${file}`, () => {
      const source = fs.readFileSync(path.join(COMMANDS_DIR, file), "utf8");
      expect(auditCommandFile(file, source)).toEqual([]);
    });
  }
});

/**
 * The control. Each fixture is a command file that is wrong in exactly one way,
 * and each must be reported — otherwise the block above is a test that reads
 * nine files and asserts nothing about them.
 */
const BROKEN: ReadonlyArray<[why: string, frontmatter: string, expected: RegExp]> = [
  [
    "a misspelled MCP tool",
    "mcp__ost-agent__ost_read_tree, mcp__ost-agent__ost_creat_node",
    /no such tool.*ost_creat_node/,
  ],
  [
    "a tool that was never on the surface",
    "mcp__ost-agent__ost_delete_node",
    /no such tool.*ost_delete_node/,
  ],
  [
    "a Bash grant for a subcommand the CLI does not define",
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs initialise:*)",
    /is not a subcommand/,
  ],
  [
    "a bare shell grant",
    "Bash",
    /is neither an mcp__ost-agent__\* tool nor a/,
  ],
  [
    "a wildcard shell grant dressed up as the real form",
    "Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs:*)",
    /is neither an mcp__ost-agent__\* tool nor a/,
  ],
  [
    "another server's tool",
    "mcp__some-other-server__ost_read_tree",
    /not a tool of this plugin's server/,
  ],
];

describe("the auditor reports a command file that grants something unreal", () => {
  for (const [why, frontmatter, expected] of BROKEN) {
    test(why, () => {
      const source = `---\ndescription: fixture\nallowed-tools: ${frontmatter}\n---\n\nbody\n`;
      const problems = auditCommandFile("fixture.md", source);
      expect(problems.length, `${frontmatter} was accepted`).toBeGreaterThan(0);
      expect(problems.join("\n")).toMatch(expected);
    });
  }

  test("a command file with no allowed-tools key at all is reported", () => {
    expect(auditCommandFile("fixture.md", "---\ndescription: fixture\n---\n\nbody\n")).toEqual([
      "fixture.md: no `allowed-tools` key in its frontmatter — the command grants nothing",
    ]);
  });

  test("a well-formed fixture passes, so the auditor is not simply always-red", () => {
    const source =
      "---\ndescription: fixture\n" +
      "allowed-tools: mcp__ost-agent__ost_read_tree, Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs init:*)\n" +
      "---\n\nbody\n";
    expect(auditCommandFile("fixture.md", source)).toEqual([]);
  });
});
