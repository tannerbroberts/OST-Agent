/**
 * The grant preflight: what a run's instructions demand, against what the run is
 * actually granted, resolved before the run reaches the tree.
 *
 * The pre-committed bar for the assumption this settles (the tree's
 * "Resolve the declared tool list against the settings allowlist and name every
 * gap, including path-scoped ones") is three numbers, and all three are asserted
 * against the committed fixture pair in `test/fixtures/grant-preflight/`:
 *
 *   1. all four omitted tool grants named,
 *   2. the path-scoped read gap named,
 *   3. zero false gaps against an entry granted by pattern rather than literal.
 *
 * The third is not a nicety. A resolver that reports every demand as a gap
 * satisfies (1) and (2) perfectly and is worthless, so the coverage direction is
 * pinned as hard as the gap direction — including a whole fixture whose grant is
 * expressed only in patterns and must come out completely clean.
 *
 * The path-scoped case is the one the parent assumption turns on. Four of fifteen
 * recorded denials in this workspace were `Glob` refused on
 * `/Users/tanner/dev/OST-Agent`: the tool was granted, the directory was not.
 * Reporting that as "granted" would clear a run that is about to be blocked,
 * which is worse than no preflight — an unknown converted into a wrong answer.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  PREFLIGHT_EXIT,
  parseRule,
  resolveGrants,
  ruleCovers,
  runGrantPreflight,
} from "../../src/runner/grant-preflight.js";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "grant-preflight");
const SKILL = path.join(FIXTURES, "skill.md");
const SETTINGS = path.join(FIXTURES, "settings.json");
const CLEARED = path.join(FIXTURES, "settings-cleared.json");

const MCP = "mcp__plugin_ost-agent_ost-agent__";
/** The four the recorded configuration omits — the pass reached for every one of them. */
const OMITTED = ["ost_check", "ost_debt", "ost_status", "ost_flag_humans_required"].map((t) => `${MCP}${t}`);

describe("the recorded configuration: a declaration the grant does not cover", () => {
  const run = runGrantPreflight({ skillPath: SKILL, settingsPath: SETTINGS });

  test("names all four omitted tool grants, and calls each ungranted rather than out-of-scope", () => {
    const ungranted = run.result!.gaps.filter((g) => g.kind === "ungranted").map((g) => g.demand.entry);
    expect(ungranted.sort()).toEqual([...OMITTED].sort());
  });

  test("names the path-scoped read gap, against a tool that IS granted elsewhere", () => {
    // The whole assumption: `Glob` appears in the grant, so a name-only resolver
    // clears this. It is granted for the vault and asked for on the repo.
    const scoped = run.result!.gaps.filter((g) => g.kind === "out-of-scope");
    expect(scoped.map((g) => g.demand.entry)).toEqual(["Glob(/Users/tanner/dev/OST-Agent/**)"]);
    expect(scoped[0].granted).toEqual(["Glob(//Users/tanner/ost-agent-meta/**)"]);
  });

  test("reports zero false gaps — the pattern-granted and literal-granted demands are clean", () => {
    const gaps = run.result!.gaps.map((g) => g.demand.entry);
    // `Bash(npx vitest run:*)` is covered by `Bash(npx vitest:*)`: a prefix rule,
    // not a literal. Reporting it would be a false stop.
    expect(gaps).not.toContain("Bash(npx vitest run:*)");
    expect(gaps).not.toContain(`${MCP}ost_read_tree`);
    expect(gaps).not.toContain(`${MCP}ost_create_node`);
    // Five gaps and no sixth: "name every gap" is only half the bar.
    expect(run.result!.gaps).toHaveLength(5);
    expect(run.result!.demands).toHaveLength(8);
  });

  test("stops the run with its own exit code, and the report names the gaps and the file they go in", () => {
    expect(run.exitCode).toBe(PREFLIGHT_EXIT.gaps);
    for (const tool of OMITTED) expect(run.report).toContain(tool);
    expect(run.report).toContain("Glob(/Users/tanner/dev/OST-Agent/**)");
    // Naming the file the operator has to edit is the entire saving over finding
    // out one denial at a time.
    expect(run.report).toContain(SETTINGS);
    expect(run.report).toContain(SKILL);
  });

  test("the report says what it did NOT check, so a clear result is not read as more than it is", () => {
    // It compares two files. Whether the session's live grant is this file is
    // outside what any file on disk can answer.
    expect(run.report).toMatch(/live grant/i);
  });
});

describe("a grant that covers the same declaration, expressed only in patterns", () => {
  const run = runGrantPreflight({ skillPath: SKILL, settingsPath: CLEARED });

  test("clears with zero gaps and exit 0", () => {
    expect(run.result!.gaps).toEqual([]);
    expect(run.exitCode).toBe(PREFLIGHT_EXIT.cleared);
    expect(run.report).toContain("CLEARED");
  });

  test("a server-level MCP grant covers the tools beneath it", () => {
    // `mcp__plugin_ost-agent_ost-agent` grants that server's whole surface;
    // demanding one of its tools is not a gap.
    expect(ruleCovers(parseRule("mcp__plugin_ost-agent_ost-agent"), parseRule(`${MCP}ost_check`))).toBe(true);
    // …and it does not reach a different server, which is the same rule failing closed.
    expect(ruleCovers(parseRule("mcp__plugin_ost-agent_ost-agent"), parseRule("mcp__other__ost_check"))).toBe(false);
  });

  test("an absolute path grant covers the subtree it names and nothing above it", () => {
    const grant = parseRule("Glob(//Users/tanner/dev/OST-Agent/**)");
    expect(ruleCovers(grant, parseRule("Glob(/Users/tanner/dev/OST-Agent/src/runner/context.ts)"))).toBe(true);
    expect(ruleCovers(grant, parseRule("Glob(/Users/tanner/dev)"))).toBe(false);
    expect(ruleCovers(grant, parseRule("Glob(/Users/tanner/ost-agent-meta/x.md)"))).toBe(false);
  });

  test("a scoped grant does not cover an unscoped demand, and an unscoped grant covers everything", () => {
    expect(ruleCovers(parseRule("Bash(npm test:*)"), parseRule("Bash"))).toBe(false);
    expect(ruleCovers(parseRule("Read"), parseRule("Read(/anywhere/at/all)"))).toBe(true);
  });
});

describe("a preflight that cannot answer does not report a clear one", () => {
  test("an unreadable grant file is its own exit code, never `cleared`", () => {
    const run = runGrantPreflight({ skillPath: SKILL, settingsPath: path.join(FIXTURES, "PROVENANCE.md") });
    expect(run.exitCode).toBe(PREFLIGHT_EXIT.unreadable);
    expect(run.result).toBeNull();
    expect(run.report).toMatch(/not a cleared run/);
  });

  test("a declaration with no `allowed-tools` line is unreadable, not vacuously clear", () => {
    // Zero demands are trivially covered by any grant. Exiting 0 there would
    // clear every run whose declaration file was wrong.
    const run = runGrantPreflight({ skillPath: path.join(FIXTURES, "PROVENANCE.md"), settingsPath: SETTINGS });
    expect(run.exitCode).toBe(PREFLIGHT_EXIT.unreadable);
  });

  test("a missing settings file grants nothing, which is an answer: every demand is a gap", () => {
    const run = runGrantPreflight({ skillPath: SKILL, settingsPath: path.join(FIXTURES, "no-such-settings.json") });
    expect(run.exitCode).toBe(PREFLIGHT_EXIT.gaps);
    expect(run.result!.gaps).toHaveLength(8);
  });

  test("a tool a human names but the declaration does not is still checked", () => {
    // The pass prompt names tools in prose, and prose is deliberately not
    // harvested (a sentence naming a tool may be telling the run NOT to use it),
    // so an operator who knows a demand is missing can name it themselves.
    const run = runGrantPreflight({
      skillPath: SKILL,
      settingsPath: CLEARED,
      extraDemands: ["WebSearch"],
    });
    expect(run.result!.gaps.map((g) => g.demand.entry)).toEqual(["WebSearch"]);
  });
});

describe("the comparison itself, independent of any file", () => {
  test("a demand covered by no rule at all is `ungranted`; one whose tool appears is `out-of-scope`", () => {
    const result = resolveGrants({
      demands: ["Read(/repo/src/index.ts)", "WebFetch(domain:example.com)"],
      grants: ["Read(/vault/**)", "Glob"],
    });
    expect(result.gaps.map((g) => [g.demand.tool, g.kind])).toEqual([
      ["Read", "out-of-scope"],
      ["WebFetch", "ungranted"],
    ]);
  });

  test("gaps come back in declaration order, so the report reads like the file it came from", () => {
    const result = resolveGrants({ demands: ["C", "A", "B"], grants: ["A"] });
    expect(result.gaps.map((g) => g.demand.entry)).toEqual(["C", "B"]);
  });
});
