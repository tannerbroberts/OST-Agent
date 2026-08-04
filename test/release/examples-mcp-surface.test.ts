/**
 * The unattended examples have to actually *have* the tool surface they allowlist.
 *
 * Both of them used to load OST-Agent with `--plugin-dir` and drive the pass with
 * `claude -p "/ost-pass"`. On current Claude Code that combination produces
 * `Unknown command: /ost-pass`, no `mcp__plugin_ost-agent_ost-agent__*` tools, exit 0 — a firing that
 * ran, wrote nothing, and reported success. It was caught only because the loop's
 * health record sealed the run `no-op` (F4) while both of its phases were green.
 *
 * That is the failure this repo is least able to tolerate and least able to see:
 * `examples-allowlist.test.ts` next door pins *which* tools each example allows and
 * denies, tool for tool — and every one of its assertions passed throughout, because
 * an allowlist over an absent surface is still a correct allowlist. The tool lists
 * were never the thing that broke. The loading mechanism was, and nothing looked at it.
 *
 * So this file pins the mechanism instead of the lists: the server is declared, the
 * declaration is the only one in scope, and the pass is handed instructions rather
 * than a slash command that may not exist.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/**
 * The example with its comment lines removed.
 *
 * Both files explain at length why they no longer use `--plugin-dir`, and that
 * explanation necessarily contains the flag. A blanket text search would therefore
 * fail on the very comment documenting the fix, and the obvious way to quiet it —
 * deleting the explanation — is the opposite of what should happen here. Assert
 * against what the file *runs*, not against what it says about itself.
 */
const executable = (p: string) =>
  read(p)
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

const EXAMPLES = ["examples/automation/autonomous-pass.sh", "examples/automation/github-workflow.yml"] as const;

describe.each(EXAMPLES)("%s brings its own MCP surface", (file) => {
  const source = executable(file);

  test("does not load OST-Agent with --plugin-dir", () => {
    // The regression itself. --plugin-dir supplied neither the command nor the
    // server, and its failure mode is a silent no-op rather than an error.
    expect(source).not.toMatch(/--plugin-dir/);
  });

  test("declares the ost-agent MCP server itself", () => {
    // The name matters as much as the presence: every allowlist entry next door is
    // `mcp__plugin_ost-agent_ost-agent__…`, so a server declared under any other name is a pass whose
    // every tool call is denied.
    expect(source).toMatch(/"mcpServers"\s*:\s*\{\s*"ost-agent"/);
    expect(source).toMatch(/--mcp-config/);
  });

  test("admits no MCP server it did not declare", () => {
    // Without this the pass inherits the invoking user's ambient MCP configuration.
    // Observed live: an unrelated deployment server's full tool surface loaded into
    // an unattended discovery pass. The allowlist gates the calls; the grant is
    // still not this example's to make.
    expect(source).toMatch(/--strict-mcp-config/);
  });

  test("does not drive the pass through a slash command", () => {
    // `-p "/ost-pass"` is only as good as whatever supplies /ost-pass. The examples
    // read the command file's body and pass it as the prompt, so the instructions
    // are present by construction rather than by plugin resolution.
    expect(source).not.toMatch(/-p\s+"\/ost-pass"/);
    expect(source).toMatch(/ost-pass\.md/);
  });

  test("carries the skill the pass instructions tell it to follow", () => {
    // The prompt's first line is "Follow the `opportunity-solution-tree` skill's
    // rules exactly". Under --plugin-dir the skill arrived with the plugin; declared
    // this way nothing supplies it unless the example does.
    expect(source).toMatch(/--append-system-prompt/);
    expect(source).toMatch(/opportunity-solution-tree\/SKILL\.md/);
  });
});

describe("examples/automation/autonomous-pass.sh runs on a Linux runner too", () => {
  test("mktemp is given an explicit XXXXXX template, not BSD's -t", () => {
    // `mktemp -t ost-agent-mcp` is BSD syntax. GNU coreutils reads the argument as a
    // template and rejects one with too few trailing X's, so the BSD form worked on
    // the macOS machine this was written on and killed the firing at its first line
    // on every Linux runner — under `set -e`, an exit 1 before anything was logged.
    // The local suite was green; CI caught it. This pins the portable spelling so the
    // next person writing shell here does not have to know that difference.
    const source = executable("examples/automation/autonomous-pass.sh");
    expect(source).not.toMatch(/mktemp\s+-t\b/);
    expect(source).toMatch(/mktemp\s+"\$\{TMPDIR:-\/tmp\}\/[\w.-]*X{6,}"/);
  });
});

describe("examples/automation/autonomous-pass.sh keeps exactly one EXIT trap", () => {
  test("the seal is not displaced by a later trap", () => {
    // bash `trap … EXIT` REPLACES; it does not stack. The temp file holding the MCP
    // declaration needs cleanup on exit, and registering that as its own trap silently
    // discarded `loop seal` — leaving the firing holding its lock until the TTL
    // expired and writing no verdict at all. One trap, both jobs.
    const traps = read("examples/automation/autonomous-pass.sh").match(/^trap .*EXIT$/gm) ?? [];
    expect(traps).toHaveLength(1);
    expect(traps[0]).toMatch(/loop seal/);
    expect(traps[0]).toMatch(/rm -f/);
  });
});
