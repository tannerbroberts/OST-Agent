/**
 * `examples/automation/build-pass.sh` is the inverse of the discovery pass next door,
 * and the inversion is the safety property.
 *
 * The discovery pass may write the tree and may not touch the world: it grants the nine
 * append-only `ost_*` write tools and denies Bash/Edit/Write. The build pass may write
 * the world and may not touch the tree: it grants Bash/Edit/Write against the code
 * repository and denies every `ost_*` tool that mutates.
 *
 * The reason that second half matters is not tidiness. A builder that can call
 * `ost_append_to_node` can edit the requirement it is being measured against, and a
 * builder that can call `ost_set_status` can mark its own output shipped. The gate this
 * loop runs under (`ost-agent gate` — no build without a recorded assumption-test result,
 * and only a human can record one) is only as strong as the builder's inability to
 * rewrite the node the gate reads.
 *
 * The drift this file exists to catch: someone adds a tenth write tool to
 * `/ost-pass`'s frontmatter. `examples-allowlist.test.ts` will make the discovery pass
 * grant it. Nothing would have made the build pass deny it, and the new tool would be
 * denied by neither list — so it would be available to the builder the moment the gate
 * first opened, silently, on the one path with no human present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const SCRIPT = "examples/automation/build-pass.sh";
const source = read(SCRIPT);

/** The script with comment lines stripped — assert against what it runs, not what it says. */
const executable = source
  .split("\n")
  .filter((line) => !/^\s*#/.test(line))
  .join("\n");

function sortedTools(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function assignment(name: string): string[] {
  const match = executable.match(new RegExp(`^${name}="([^"]+)"`, "m"));
  if (!match) throw new Error(`${SCRIPT} has no ${name}= assignment`);
  return sortedTools(match[1]);
}

const readTools = assignment("OST_READ_TOOLS");
const buildTools = assignment("BUILD_TOOLS");
const denied = assignment("DENIED");
const allowed = [...readTools, ...buildTools].sort();

/** What `/ost-pass` is allowed to call — the authority on which `ost_*` tools exist to be granted. */
const discoveryAuthority = sortedTools(
  read(".claude/commands/ost-pass.md").match(/^allowed-tools:\s*(.+)$/m)![1],
);

describe("the build pass cannot write the tree it builds against", () => {
  test("grants no ost_* tool that mutates", () => {
    // Whitelist by name rather than by "contains write": the read-only surface is small
    // and closed, so anything outside it is a mutation until someone argues otherwise here.
    const READ_ONLY = new Set([
      "mcp__ost-agent__ost_read_tree",
      "mcp__ost-agent__ost_next_work",
      "mcp__ost-agent__ost_status",
      "mcp__ost-agent__ost_debt",
      "mcp__ost-agent__ost_check",
      "mcp__ost-agent__ost_gate",
    ]);
    const granted = allowed.filter((t) => t.startsWith("mcp__ost-agent__"));
    expect(granted.filter((t) => !READ_ONLY.has(t))).toEqual([]);
  });

  test("every ost_* tool the discovery pass may call is either read-only here or denied", () => {
    // The drift guard described in this file's header. Adding a write tool to
    // /ost-pass's frontmatter now fails here until build-pass.sh denies it too.
    const allowedSet = new Set(allowed);
    const deniedSet = new Set(denied);
    const unaccountedFor = discoveryAuthority.filter((t) => !allowedSet.has(t) && !deniedSet.has(t));
    expect(unaccountedFor).toEqual([]);
  });

  test("denies delegation as well as mutation", () => {
    // Task and SlashCommand write nothing themselves — they hand the turn to something
    // whose tool set --disallowedTools no longer describes. The observed failure was a
    // review subagent merging the pull request containing the hole it was reviewing.
    expect(denied).toContain("Task");
    expect(denied).toContain("SlashCommand");
  });

  test("the allow and deny lists are disjoint", () => {
    // Deny beats allow in Claude Code, so a tool on both lists is a capability the script
    // believes it has and does not — the silent-phase-drop failure mode.
    const deniedSet = new Set(denied);
    expect(allowed.filter((t) => deniedSet.has(t))).toEqual([]);
  });

  test("names no tool twice in either list", () => {
    expect(new Set(denied).size).toBe(denied.length);
    expect(new Set(allowed).size).toBe(allowed.length);
  });
});

describe("the build pass can actually build", () => {
  test("grants the built-ins a build needs", () => {
    // The mirror of the assertion above: the discovery pass denies exactly these, and a
    // build pass that also denied them would be a loop that cannot do its only job.
    for (const tool of ["Bash", "Read", "Edit", "Write"]) expect(buildTools).toContain(tool);
  });

  test("does not pre-accept edits", () => {
    // `acceptEdits` approves Edit/Write by mode, which would survive any allowlist — and
    // would apply to the vault as readily as to the repo.
    expect(executable).not.toMatch(/--permission-mode\s+acceptEdits/);
  });
});

describe("the build pass brings its own MCP surface", () => {
  test("declares the ost-agent server and admits no other", () => {
    expect(executable).toMatch(/"mcpServers"\s*:\s*\{\s*"ost-agent"/);
    expect(executable).toMatch(/--mcp-config/);
    expect(executable).toMatch(/--strict-mcp-config/);
  });

  test("does not load OST-Agent with --plugin-dir", () => {
    // The regression that made five straight firings silent no-ops: --plugin-dir supplied
    // neither the command nor the server, and a pass with no tools cannot fail loudly.
    expect(executable).not.toMatch(/--plugin-dir/);
  });
});

describe("the build pass defers to the gate rather than re-implementing it", () => {
  test("asks the CLI whether a solution may be built", () => {
    // The grep for `## Results` only narrows candidates. `ost-agent gate` is what decides,
    // so the rule lives in one place and this script cannot drift from it.
    expect(executable).toMatch(/\bgate\b.*--vault/);
  });

  test("builds nothing when the gate clears nothing", () => {
    // The steady state on an untested tree, and the behavior most likely to be "fixed" by
    // someone who reads an empty build queue as a bug.
    expect(executable).toMatch(/BUILD_COUNT.*-eq 0/s);
  });
});

describe("the build pass does not wedge the discovery loop", () => {
  test("keeps its state outside the vault", () => {
    // `loop start` refuses a dirty vault. Build-loop state written inside the vault would
    // stop discovery firing after the first tick — one loop silently killing the other.
    expect(executable).toMatch(/OST_BUILD_STATE:-\$HOME/);
    expect(executable).not.toMatch(/OST_BUILD_STATE:-\$VAULT/);
  });

  test("does not call the vault's single-tenant loop machinery", () => {
    // `ost-agent loop {due,start,seal}` is keyed to the vault directory and owned by the
    // discovery pass. A second caller would consume its cadence window and its lock.
    expect(executable).not.toMatch(/\bloop (due|start|seal)\b/);
  });

  test("every EXIT trap releases the lock", () => {
    // bash `trap … EXIT` REPLACES rather than stacks. This script sets one trap at lock
    // acquisition and a second after creating the MCP temp file; the second must still do
    // the first one's job, or a firing that ends after that point leaks its lock until TTL.
    const traps = executable.match(/^trap .*EXIT$/gm) ?? [];
    expect(traps.length).toBeGreaterThan(0);
    for (const t of traps) expect(t).toMatch(/rm -rf "\$LOCK"/);
  });
});

describe("the build pass runs on a Linux runner too", () => {
  test("mktemp is given an explicit XXXXXX template, not BSD's -t", () => {
    expect(executable).not.toMatch(/mktemp\s+-t\b/);
    expect(executable).toMatch(/mktemp\s+"\$\{TMPDIR:-\/tmp\}\/[\w.-]*X{6,}"/);
  });
});
