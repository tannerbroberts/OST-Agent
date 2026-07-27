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
