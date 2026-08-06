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
import { spawnSync } from "node:child_process";
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

/** Reads the `allowed-tools:` frontmatter line off a command file or the skill. */
function frontmatterAllowedTools(markdown: string): string[] {
  const match = markdown.match(/^allowed-tools:\s*(.+)$/m);
  if (!match) throw new Error("no `allowed-tools` frontmatter line");
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
 * `Task` and `Skill` are on it because neither writes anything itself: they
 * hand the turn to something whose tool set this flag no longer describes, and
 * `/ost-setup` already ships `allowed-tools` frontmatter granting a `Bash(…)`
 * prefix. Web is on it because `ost_read_web`/`ost_search_web` meter lookups
 * against one per-pass budget (`src/security/tools.ts:161-167`) and the raw
 * built-ins are unmetered.
 *
 * **A name on this list must be a tool that exists, and until 2026-08-06 two were
 * not.** Claude Code renamed `SlashCommand` to `Skill` and folded `MultiEdit` into
 * `Edit`. A deny rule matching no tool is inert, so the delegation entry above
 * described a capability that was reachable under its new name for as long as the
 * rename had been in place — the list looked complete and was one short. Claude Code
 * reports this ("Permission deny rule … matches no known tool") and both loops
 * printed it on every firing for four days, where it read as a stale-name nit.
 *
 * The two cases are opposites and the log cannot tell them apart: a retired name WITH
 * a successor is a hole and must be renamed, a retired name WITHOUT one is dead weight
 * and must be dropped. Which one a given name is cannot be decided from this repo —
 * the authority is the running Claude Code, and CI has no Claude Code to ask. So this
 * file does not pretend to derive liveness; it ratchets against the two names already
 * caught, and records the one-line experiment that catches the next one:
 *
 *     claude -p "say ok" --disallowedTools "Skill,MultiEdit,SlashCommand,…"
 *
 * which prints "matches no known tool" for exactly the dead names and nothing for the
 * live ones. That is how these two were found (2026-08-06) rather than reasoned about,
 * and re-running it is the only way to audit this list — a hand-kept copy of Claude
 * Code's tool surface would be a fourth drifting copy of the kind this file exists to
 * refuse.
 */
const MUST_DENY = [
  "Bash",
  "BashOutput",
  "KillShell",
  "Edit",
  "Write",
  "NotebookEdit",
  "Task",
  "Skill",
  "WebFetch",
  "WebSearch",
].sort();

/**
 * Names Claude Code once defined and no longer does, each with what must be done about
 * it instead. Confirmed inert by experiment, not by reading a changelog.
 */
const RETIRED_TOOL_NAMES: ReadonlyMap<string, string> = new Map([
  ["SlashCommand", "renamed to `Skill`, which must be denied in its place (this was a hole, not a nit)"],
  ["MultiEdit", "folded into `Edit`, which is already denied, so it needs no successor"],
]);

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

      test("names no tool Claude Code has retired", () => {
        // A ratchet, not a derivation — see the note on MUST_DENY. Each entry was
        // confirmed inert by running Claude Code with it in --disallowedTools and
        // reading back "matches no known tool". Re-add one and this fails, which is
        // the point: an inert deny rule reads as coverage and provides none.
        for (const [retired, successor] of RETIRED_TOOL_NAMES) {
          expect(denied, `${label} denies "${retired}", which Claude Code no longer defines — ${successor}`).not.toContain(
            retired,
          );
        }
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

/**
 * The pass is handed the SKILL as its system prompt, and the skill declares more tools
 * than this surface grants — 22 against 16. Everything above keeps the three copies of
 * the *grant* honest with each other; none of it asks whether the agent reading the
 * *declaration* is told which part of it does not apply here.
 *
 * It was not, and the cost was measured rather than imagined. Two consecutive
 * unattended firings (2026-08-05, 2026-08-06) reached for `ost_check`, `ost_debt` and
 * `ost_flag_humans_required`, were denied without a message — under `-p` a tool outside
 * `--allowedTools` is denied, not prompted — and reported the identical denied set,
 * correctly concluding it was fixed rather than drifting and unable to see why. One of
 * them then filed ~30 tree writes as "unverified", which reads as an instrument that
 * failed rather than one that was never offered.
 *
 * The containment itself is deliberate and stays (`CONTAINED_ON_PURPOSE` above,
 * `src/knowledge/ruleset.ts`). What changes is that the script now names the difference
 * in the system prompt, computed from the two lists it already holds.
 *
 * **This test runs the shipped derivation, not a reimplementation of it.** The block is
 * extracted from `autonomous-pass.sh` between its `withheld-derivation` markers and
 * executed by bash, so a test-local copy cannot drift into agreeing with itself — the
 * failure mode `scripts/mcp-prefix.ts` exists to prevent, where three careful
 * derivations were all wrong the same way.
 */
describe("the pass is told which declared tools this surface withholds", () => {
  const script = read("examples/automation/autonomous-pass.sh");

  const skillDeclared = frontmatterAllowedTools(
    read(".claude/skills/opportunity-solution-tree/SKILL.md"),
  ).map(bareToolName);
  const surfaceGranted = new Set(
    sortedTools(script.match(/^OST_TOOLS="([^"]+)"/m)![1]).map(bareToolName),
  );
  const expectedWithheld = skillDeclared.filter((t) => !surfaceGranted.has(t)).sort();

  test("the skill really does declare more than this surface grants", () => {
    // Non-vacuity: if these ever converge the test below passes trivially, and the
    // right response is to delete this describe block rather than to keep it green.
    expect(skillDeclared.length).toBeGreaterThan(surfaceGranted.size);
    expect(expectedWithheld.length).toBeGreaterThan(0);
  });

  test("the shipped derivation computes exactly the withheld set", () => {
    const block = script.match(/# >>> withheld-derivation[\s\S]*?\n# <<< withheld-derivation/);
    expect(block, "autonomous-pass.sh has no `withheld-derivation` marker block").toBeTruthy();

    const harness = [
      "set -euo pipefail",
      `SKILL_FILE=${JSON.stringify(path.join(root, ".claude/skills/opportunity-solution-tree/SKILL.md"))}`,
      `OST_TOOLS=${JSON.stringify(script.match(/^OST_TOOLS="([^"]+)"/m)![1])}`,
      block![0],
      'printf "%s\\n" "$WITHHELD"',
    ].join("\n");

    const run = spawnSync("bash", ["-c", harness], { encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    expect(
      run.stdout.split("\n").map((s) => s.trim()).filter(Boolean).sort(),
    ).toEqual(expectedWithheld);
  });

  test("the computed note reaches the model, not just the script", () => {
    // The derivation is worthless if it is never appended. Deny-beats-allow means a
    // wrong grant is loud; an unsent prompt section is silent, so it is pinned here.
    expect(script).toMatch(/--append-system-prompt "\$OST_SKILL\$SURFACE_NOTE"/);
    expect(script).toMatch(/SURFACE_NOTE="/);
  });

  test("it names ost_check specifically, and says writes are unverified by design", () => {
    // The single most expensive line of the two observed firings: a pass that cannot
    // verify its own writes should say so in those terms rather than reporting a
    // failure, which is what sent a human looking for a broken instrument.
    expect(expectedWithheld).toContain("ost_check");
    expect(script).toMatch(/unverified-by-design/);
  });
});
