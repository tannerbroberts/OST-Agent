/**
 * The namespace a plugin session actually mints, and the fact that every grant
 * shipped to a plugin session carries it.
 *
 * **The failure.** A server registered directly — `claude mcp add`, a project
 * `.mcp.json`, `--mcp-config` — is namespaced `mcp__<server>__`. A server
 * delivered by a plugin is namespaced `mcp__plugin_<plugin>_<server>__`. Both
 * names here are `ost-agent`, so the direct form read as correct, and every
 * grant this repo shipped to plugin sessions — eight command files and the
 * generated skill — named tools no plugin session mints. `/plugin install` is
 * the only install path `README.md` documents.
 *
 * Interactively that is a permission prompt per tool, which is why it survived
 * 23 releases looking like a papercut. Under `claude -p` an ungranted call is
 * **denied, not prompted** — the pass runs, every call is refused, it writes
 * nothing, and it exits 0 reporting success. That is the exact shape this repo
 * has a criterion against (F4's `no-op` verdict) arriving through the one door
 * nothing was watching.
 *
 * **Why the guards missed it, which is the part worth keeping.** Three files
 * derived the prefix independently — `scripts/gen-skill.ts`,
 * `test/release/command-allowlists.test.ts`, `test/skill/surface-parity.test.ts`
 * — and all three derived it the same wrong way, off the `mcpServers` key alone.
 * Each carried a comment explaining that deriving it (rather than hardcoding it)
 * was what made it trustworthy. Deriving is not the same as deriving correctly:
 * three independent derivations of one rule are three copies of whatever the
 * first author believed. They now import one, in `scripts/mcp-prefix.ts`.
 *
 * **What this file adds that a shared constant cannot.** A single derivation is
 * still just an assertion about how Claude Code behaves. The literal below is
 * what a real session was observed to mint on 2026-08-06, recorded so the
 * derivation is checked against an observation rather than against itself:
 *
 *     $ claude -p --plugin-dir . "List the exact names of every MCP tool…"
 *     mcp__plugin_ost-agent_ost-agent__ost_annotate
 *     mcp__plugin_ost-agent_ost-agent__ost_append_to_node
 *     …
 *
 * If Claude Code ever changes that scheme, this literal is what fails, and it
 * fails with the fix written above it. Re-run the probe before changing it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DIRECT_PREFIX, MCP_PREFIX, bareToolName } from "../../scripts/mcp-prefix.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMMANDS_DIR = path.join(repoRoot, ".claude", "commands");
const SKILL = path.join(repoRoot, ".claude", "skills", "opportunity-solution-tree", "SKILL.md");

/** Everything shipped to a PLUGIN session: the command files and the skill. */
function pluginSurfaceFiles(): { label: string; text: string }[] {
  const commands = fs
    .readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ label: `.claude/commands/${f}`, text: fs.readFileSync(path.join(COMMANDS_DIR, f), "utf8") }));
  return [...commands, { label: "SKILL.md", text: fs.readFileSync(SKILL, "utf8") }];
}

function allowedToolsLine(text: string): string | null {
  return text.match(/^allowed-tools:\s*(.+)$/m)?.[1] ?? null;
}

describe("the namespace a plugin session mints", () => {
  test("is the observed one, not the direct-registration one", () => {
    // The observation, recorded. See this file's header for how it was taken.
    expect(MCP_PREFIX).toBe("mcp__plugin_ost-agent_ost-agent__");
    expect(DIRECT_PREFIX).toBe("mcp__ost-agent__");
    // Non-vacuity: the two must not be the same string, or every check below
    // passes whichever form the grants happen to use.
    expect(MCP_PREFIX).not.toBe(DIRECT_PREFIX);
  });

  test("is derived from the manifest, so renaming either half propagates", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin", "plugin.json"), "utf8")) as {
      name: string;
      mcpServers: Record<string, unknown>;
    };
    expect(MCP_PREFIX).toContain(manifest.name);
    expect(MCP_PREFIX).toContain(Object.keys(manifest.mcpServers)[0]);
  });
});

describe("every grant shipped to a plugin session carries that namespace", () => {
  const surface = pluginSurfaceFiles();

  test("the surface this scans is not empty", () => {
    // The scan below reports problems; an empty file list would report none.
    expect(surface.length).toBeGreaterThan(5);
    expect(surface.filter((f) => allowedToolsLine(f.text) !== null).length).toBeGreaterThan(5);
  });

  test("no command file or skill grants a tool under the direct-registration prefix", () => {
    const problems: string[] = [];
    for (const { label, text } of surface) {
      const line = allowedToolsLine(text);
      if (!line) continue;
      for (const grant of line.split(",").map((s) => s.trim())) {
        if (!grant.startsWith("mcp__")) continue;
        if (!grant.startsWith(MCP_PREFIX)) {
          problems.push(`${label}: "${grant}" names no tool a plugin session mints (expected ${MCP_PREFIX}*)`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test("and every tool it grants is one the server actually serves", () => {
    // The other direction: a correctly-prefixed name for a tool that does not
    // exist is denied just as silently.
    const served = new Set<string>(MCP_TOOL_NAMES);
    const problems: string[] = [];
    for (const { label, text } of surface) {
      const line = allowedToolsLine(text);
      if (!line) continue;
      for (const grant of line.split(",").map((s) => s.trim())) {
        if (!grant.startsWith("mcp__")) continue;
        const tool = bareToolName(grant);
        if (!served.has(tool)) problems.push(`${label}: "${grant}" is not a tool this server serves`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("the automation examples keep the direct-registration namespace", () => {
  /*
   * The inverse mistake, and the reason `DIRECT_PREFIX` exists as a named export
   * rather than as a string someone remembers. `examples/automation/*.sh` declare
   * the server themselves with `--mcp-config` and never load the plugin, so their
   * lists are correct under the direct form. A reader who concludes from the
   * checks above that there is one right prefix and migrates these too would take
   * down the unattended loop — the same failure, pointed the other way.
   */
  const scripts = ["examples/automation/autonomous-pass.sh", "examples/automation/build-pass.sh"];

  test.each(scripts)("%s grants tools under the direct prefix", (file) => {
    const text = fs.readFileSync(path.join(repoRoot, file), "utf8");
    const grants = [...text.matchAll(/mcp__[A-Za-z0-9_-]+__[a-z_]+/g)].map((m) => m[0]);
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant.startsWith(DIRECT_PREFIX)).toBe(true);
  });
});
