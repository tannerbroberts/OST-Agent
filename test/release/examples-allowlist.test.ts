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
 * **It compares TOOL NAMES, not grant strings, and that is not a loosening.**
 * The two sides run on different surfaces and therefore mint different
 * namespaces: `/ost-pass` is delivered by the plugin, so a session mints
 * `mcp__plugin_ost-agent_ost-agent__*`, while the examples register the server
 * themselves with `--mcp-config` and mint `mcp__ost-agent__*`. Comparing the
 * full strings would force one of the two to be wrong — and until 2026-08-06 the
 * repo resolved that by having BOTH use the direct form, which meant no grant in
 * any command file matched a tool any plugin session mints. Each side's prefix is
 * asserted separately below, against the surface it actually runs on.
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
import { DIRECT_PREFIX, MCP_PREFIX, bareToolName } from "../../scripts/mcp-prefix.js";

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
/** The same list reduced to tool names, for comparison across surfaces. */
const authorityTools = authority.map(bareToolName).sort();

describe("examples' --allowedTools stay in sync with /ost-pass's frontmatter", () => {
  test("the frontmatter itself grants at least the ingest + read/write surface", () => {
    // Sanity check on the authority itself, so a typo there can't make both
    // comparisons below pass vacuously.
    expect(authority).toContain(`${MCP_PREFIX}ost_ingest_inbox`);
    expect(authority).toContain(`${MCP_PREFIX}ost_next_work`);
  });

  test("examples/automation/autonomous-pass.sh's OST_TOOLS matches, tool for tool", () => {
    const script = read("examples/automation/autonomous-pass.sh");
    const match = script.match(/^OST_TOOLS="([^"]+)"/m);
    expect(match, "autonomous-pass.sh has no OST_TOOLS= assignment").toBeTruthy();
    expect(sortedTools(match![1]).map(bareToolName).sort()).toEqual(authorityTools);
    // …and it uses the namespace ITS surface mints, which is not the plugin's.
    for (const grant of sortedTools(match![1])) expect(grant.startsWith(DIRECT_PREFIX)).toBe(true);
  });

  test("examples/automation/github-workflow.yml's --allowedTools matches, tool for tool", () => {
    const workflow = read("examples/automation/github-workflow.yml");
    const match = workflow.match(/--allowedTools "([^"]+)"/);
    expect(match, "github-workflow.yml has no --allowedTools argument").toBeTruthy();
    expect(sortedTools(match![1]).map(bareToolName).sort()).toEqual(authorityTools);
    for (const grant of sortedTools(match![1])) expect(grant.startsWith(DIRECT_PREFIX)).toBe(true);
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
        expect(authorityTools.filter((t) => denied.has(t) || denied.has(`${DIRECT_PREFIX}${t}`))).toEqual([]);
      });
    });
  }
});

/**
 * The prompt and the grant must describe the same agent — and where they don't, the
 * gap is named here rather than left to be discovered from behaviour.
 *
 * Everything above pins the three *copies* of the allowlist against each other, so
 * they cannot drift apart. None of it asks the question one layer up: whether the
 * list they all agree on is the list the prompt actually needs. It was not. The
 * whole outward sense — `ost_search_web`, `ost_read_web`, `ost_read_repo` — was
 * built, budgeted (`src/web/budget.ts`), classified read-only
 * (`src/security/policy.ts`) and granted to nothing. `autonomous-pass.sh` denied the
 * unmetered built-ins on the stated grounds that the metered MCP pair was the proper
 * route, while the grant beside it omitted that pair: a justification describing a
 * road nobody could take. The vault's only inputs were what the operator carried in
 * by hand and what the agent observed about itself, and the tree recorded exactly
 * that as a customer need — "Fresh outside findings never reach the tree unless I go
 * get them", 2026-07-25 — without anyone connecting it to a missing frontmatter line.
 *
 * A missing grant is silent by construction. Under `-p` a tool outside
 * `--allowedTools` is denied rather than prompted, the model cannot report a tool it
 * was never offered, and a pass that skips a step still exits 0 and reports a clean
 * run. So the sync tests above stayed green while the pass did less than its own
 * prompt asked.
 *
 * The rule this file now enforces is *not* "every tool named in the prose is
 * granted". `test/skill/surface-parity.test.ts` makes the opposite point deliberately
 * and is right to: naming a tool in a sentence is not granting it, and two tools are
 * withheld from this surface on purpose.
 *
 *   - `ost_flag_humans_required` — R7's containment. It is on no shipped command,
 *     which is what keeps `lane-conflict`, the one rule the agent can create and
 *     cannot clear, off the unattended surface. R2 has since closed that wedge at the
 *     write boundary and the *skill* grants the tool, so the containment may no longer
 *     be load-bearing — but retiring it is an R7/R2 decision, taken deliberately and
 *     recorded there, not a side effect of tidying an allowlist.
 *   - `ost_check` — named in the hygiene bucket only to explain that an annotated
 *     issue leaves the other gate red. That is exposition, not an instruction.
 *
 * Both are listed below with their reason, so the set is a decision the repository
 * has made rather than a silence. Adding an instruction for an ungranted tool fails
 * here; so does granting a contained one, which forces the criterion to be updated in
 * the same commit instead of quietly contradicted.
 */
const CONTAINED_ON_PURPOSE: ReadonlyMap<string, string> = new Map([
  ["ost_flag_humans_required", "R7 containment — on no shipped command, keeps lane-conflict off this surface"],
  ["ost_check", "named as exposition in the hygiene bucket, never as a step the pass takes"],
  [
    "ost_rank_source",
    "finding a source and promoting it are the same act if one agent can do both; `suspect-source` " +
      "stays clearable only by annotation (test/mcp/suspect-source-work.test.ts)",
  ],
]);

describe("/ost-pass's prose and its allowed-tools describe the same agent", () => {
  const body = read(".claude/commands/ost-pass.md").replace(/^---\n[\s\S]*?\n---\n/, "");

  // The body names tools in backticks and occasionally in bold; match the bare
  // identifier anywhere in the prose. Over-matching is the safe direction — it pulls
  // in exposition as well as instruction, and exposition is exactly what the
  // contained set above has to justify by name.
  const mentioned = [...new Set(body.match(/\bost_[a-z_]+\b/g) ?? [])].sort();
  const granted = new Set(authorityTools);

  test("the body names tools at all, so the comparison cannot pass vacuously", () => {
    expect(mentioned.length).toBeGreaterThan(5);
    expect(mentioned).toContain("ost_next_work");
    expect(granted.size).toBeGreaterThan(5);
  });

  test("every tool it names is granted, or contained with a stated reason", () => {
    const unaccountedFor = mentioned.filter((t) => !granted.has(t) && !CONTAINED_ON_PURPOSE.has(t));
    expect(
      unaccountedFor,
      `/ost-pass names ${unaccountedFor.join(", ")} without granting ${unaccountedFor.length === 1 ? "it" : "them"} ` +
        `and without a recorded reason for withholding. On the unattended surface that call is denied, the step is ` +
        `skipped, and the pass still reports a clean run. Either grant it in all three copies, or add it to ` +
        `CONTAINED_ON_PURPOSE with the criterion that withholds it.`,
    ).toEqual([]);
  });

  test("the contained tools are genuinely still withheld", () => {
    // The other direction. If a later change grants one of these, this fails and the
    // criterion that argued for containment (R7, R2) has to be revisited on purpose.
    const wronglyGranted = [...CONTAINED_ON_PURPOSE.keys()].filter((t) => granted.has(t));
    expect(
      wronglyGranted,
      `${wronglyGranted.join(", ")} is granted to /ost-pass but recorded here as contained. Update ` +
        `docs/reference/v1-readiness.md (R7/R2) and this list together, or drop the grant.`,
    ).toEqual([]);
  });

  test("the contained set stays honest — every entry is actually named in the prose", () => {
    // Guards the list against becoming a graveyard: an entry for a tool the prompt no
    // longer mentions is a reason nobody needs, and it would mask a real regression by
    // silently absorbing the name if the prose ever reintroduced it.
    const stale = [...CONTAINED_ON_PURPOSE.keys()].filter((t) => !mentioned.includes(t));
    expect(stale, `${stale.join(", ")} is listed as contained but /ost-pass no longer mentions it`).toEqual([]);
  });

  test("the outward senses reached the grant", () => {
    // The specific regression this describe block was written for. Named individually
    // so removing one reads as a reversal rather than a tidy-up.
    for (const sense of ["ost_search_web", "ost_read_web", "ost_read_repo"]) {
      expect(granted, `${sense} should be granted — the pass has no outward sense without it`).toContain(sense);
    }
  });
});
