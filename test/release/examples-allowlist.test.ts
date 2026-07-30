/**
 * The two unattended-automation examples (a local shell script and a GitHub
 * Actions workflow) each hardcode a `--allowedTools` list so `/ost-pass` can
 * run non-interactively under `--permission-mode acceptEdits`. That list is a
 * hand-maintained copy of `.claude/commands/ost-pass.md`'s `allowed-tools`
 * frontmatter — the actual authority on what the command needs.
 *
 * Nothing enforces the two stay in sync. When a tool was added to `/ost-pass`
 * (`ost_ingest_inbox`, so the pass has an input path at all), both examples'
 * copies silently fell out of date: under `-p` + `acceptEdits`, a tool call
 * outside `--allowedTools` cannot be interactively approved — it is denied.
 * The pass would run, ingest nothing, and report "done" with unread notes
 * still sitting in the inbox, on the one path with no human present to notice.
 *
 * This test makes that drift a loud CI failure instead of a silent one.
 *
 * It also pins the other half, which the sync check never touched: what the
 * examples *deny*. Both ran under `--permission-mode acceptEdits` with no
 * `--disallowedTools`, and cwd is the vault — so ordinary Edit/Write against a
 * node file were pre-approved and the allowlist above described only which MCP
 * tools the agent would bother to use, not what it could do (criterion W5).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

function sortedTools(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

function frontmatterAllowedTools(commandMd: string): string[] {
  const match = commandMd.match(/^allowed-tools:\s*(.+)$/m);
  if (!match) throw new Error("ost-pass.md has no `allowed-tools` frontmatter line");
  return sortedTools(match[1]);
}

const authority = frontmatterAllowedTools(read(".claude/commands/ost-pass.md"));

describe("examples' --allowedTools stay in sync with /ost-pass's frontmatter", () => {
  test("the frontmatter itself grants at least the ingest + read/write surface", () => {
    // Sanity check on the authority itself, so a typo there can't make both
    // comparisons below pass vacuously.
    expect(authority).toContain("mcp__ost-agent__ost_ingest_inbox");
    expect(authority).toContain("mcp__ost-agent__ost_next_work");
  });

  test("examples/automation/autonomous-pass.sh's OST_TOOLS matches, tool for tool", () => {
    const script = read("examples/automation/autonomous-pass.sh");
    const match = script.match(/^OST_TOOLS="([^"]+)"/m);
    expect(match, "autonomous-pass.sh has no OST_TOOLS= assignment").toBeTruthy();
    expect(sortedTools(match![1])).toEqual(authority);
  });

  test("examples/automation/github-workflow.yml's --allowedTools matches, tool for tool", () => {
    const workflow = read("examples/automation/github-workflow.yml");
    const match = workflow.match(/--allowedTools "([^"]+)"/);
    expect(match, "github-workflow.yml has no --allowedTools argument").toBeTruthy();
    expect(sortedTools(match![1])).toEqual(authority);
  });
});

/**
 * The exhaustive set of Claude Code built-ins that can write a file, execute a
 * command, delegate to an agent carrying its own tool set, or reach the network.
 * This list is the authority — an example may not quietly ship a shorter one, and
 * lengthening it here forces both examples to be edited in the same commit.
 *
 * `Task` and `SlashCommand` are on it because neither writes anything itself: they
 * hand the turn to something whose tool set this flag no longer describes, and
 * `/ost-setup` already ships `allowed-tools` frontmatter granting a `Bash(…)`
 * prefix. Web is on it because `ost_read_web`/`ost_search_web` meter lookups
 * against one per-pass budget (`src/security/tools.ts:161-167`) and the raw
 * built-ins are unmetered.
 */
const MUST_DENY = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  "Task",
  "SlashCommand",
  "WebFetch",
  "WebSearch",
].sort();

const examples: ReadonlyArray<[label: string, file: string, denyPattern: RegExp]> = [
  ["examples/automation/autonomous-pass.sh", "examples/automation/autonomous-pass.sh", /^DENIED_TOOLS="([^"]+)"/m],
  ["examples/automation/github-workflow.yml", "examples/automation/github-workflow.yml", /--disallowedTools "([^"]+)"/],
];

describe("the unattended examples grant no write capability beyond the MCP surface", () => {
  for (const [label, file, denyPattern] of examples) {
    describe(label, () => {
      const source = read(file);
      const match = source.match(denyPattern);
      const denied = new Set(match ? sortedTools(match[1]) : []);

      test("denies every mutating, executing, delegating and networked built-in", () => {
        expect(match, `${label} passes no --disallowedTools list`).toBeTruthy();
        expect([...denied].sort()).toEqual(MUST_DENY);
      });

      test("does not pre-accept edits against the vault", () => {
        // `acceptEdits` approves Edit/Write by *mode*, so it survives an allowlist
        // that never mentions them. The deny list above is belt; this is braces.
        expect(source).not.toMatch(/--permission-mode\s+acceptEdits/);
      });

      test("nothing it denies is something /ost-pass needs", () => {
        // Deny beats allow. An MCP tool that lands on both lists is a phase that
        // silently stops running on the one path with no human present to notice —
        // the same failure the sync test above exists to prevent.
        expect(authority.filter((t) => denied.has(t))).toEqual([]);
      });
    });
  }
});
