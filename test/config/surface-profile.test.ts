/**
 * "Pin three surfaces in config and check a profile expresses what actually
 * differs" — the assumption test under "One surface profile per pass, with the
 * tool set pinned in config rather than inherited".
 *
 * **The assumption under test is a feasibility claim:** that the difference
 * between surfaces is a tool list, and not something finer that a list cannot
 * hold. Two halves, and the second is the one that decides it:
 *
 *   1. `unattended`, `attended` and `ci` are declared in config, loaded, and each
 *      resolved tool set matches that surface's REAL grant — the one its own
 *      wrapper hands Claude Code. A profile that agrees with itself and not with
 *      the surface is the "second place for the truth to live" the solution node
 *      names as its own worst outcome, so the fixture is held against the three
 *      wrappers rather than against a copy of itself.
 *   2. A profile can express ONE argument-level restriction — a tool present but
 *      refusing a reserved heading — or it raises an explicit unsupported error.
 *      Resolving cleanly while quietly dropping the restriction refutes the
 *      assumption, because that is the false assurance a pinned profile exists to
 *      remove, and the test below asserts the drop cannot happen.
 *
 * **What running it found, recorded here because the node did not say it.** The
 * tool list expresses almost nothing about these three. `unattended` and `ci` are
 * the same sixteen grants and the same ten denials, character for character;
 * `attended` is the same sixteen tools under the plugin's mounting namespace
 * rather than the direct one. So across the three surfaces the node names, the
 * pinned list distinguishes exactly one pair and only by an artifact of how the
 * MCP server was mounted. Everything that actually differs between an unattended
 * cron firing and a GitHub runner — a vault checkout, a credential, a wall-clock
 * budget — is not in the list and cannot be put there. `expresses(...)` below is
 * the assertion that says so, and it is deliberately written to go red if that
 * ever stops being true: a fourth surface, or a genuine per-surface narrowing,
 * should force whoever adds it to re-read this note.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import {
  SURFACE_PROFILE_EXIT,
  checkSurfaceProfile,
  isSurfaceProfileProblem,
  profileGrants,
  resolveSurfaceProfile,
  type SurfaceProfileResolution,
} from "../../src/config/surface-profile.js";
import { ruleCovers } from "../../src/runner/grant-preflight.js";
import { RESULTS_HEADING } from "../../src/ost/headings.js";
import { DIRECT_PREFIX, MCP_PREFIX, bareToolName } from "../../scripts/mcp-prefix.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureVault = path.join(repoRoot, "test/fixtures/surface-profiles");
const read = (p: string) => fs.readFileSync(path.join(repoRoot, p), "utf8");
const csv = (s: string) => s.split(",").map((t) => t.trim()).filter(Boolean).sort();

const config = loadConfig(fixtureVault);

/** Resolve or fail the test with the problem, so no assertion runs on a null. */
function resolved(name: string): SurfaceProfileResolution {
  const r = resolveSurfaceProfile(config, name);
  if (isSurfaceProfileProblem(r)) throw new Error(`${name}: ${r.problem}`);
  return r;
}

/**
 * Each surface's REAL grant, read out of the file that hands it to Claude Code.
 *
 * Three different extractions because there are three different wrappers, which
 * is the disease: the authority on what a pass may do is whichever of these the
 * reader happened to open.
 */
const REAL: ReadonlyArray<{ profile: string; allowed: string[]; denied: string[]; prefix: string; where: string }> = [
  {
    profile: "unattended",
    allowed: csv(read("examples/automation/autonomous-pass.sh").match(/^OST_TOOLS="([^"]+)"/m)![1]),
    denied: csv(read("examples/automation/autonomous-pass.sh").match(/^DENIED_TOOLS="([^"]+)"/m)![1]),
    prefix: DIRECT_PREFIX,
    where: "examples/automation/autonomous-pass.sh",
  },
  {
    profile: "attended",
    allowed: csv(read(".claude/commands/ost-pass.md").match(/^allowed-tools:\s*(.+)$/m)![1]),
    denied: [],
    prefix: MCP_PREFIX,
    where: ".claude/commands/ost-pass.md",
  },
  {
    profile: "ci",
    allowed: csv(read("examples/automation/github-workflow.yml").match(/--allowedTools "([^"]+)"/)![1]),
    denied: csv(read("examples/automation/github-workflow.yml").match(/--disallowedTools "([^"]+)"/)![1]),
    prefix: DIRECT_PREFIX,
    where: "examples/automation/github-workflow.yml",
  },
];

describe("three surfaces pinned in config resolve to their real grants", () => {
  test("the fixture declares exactly the three surfaces the assumption names", () => {
    // A sanity check on the fixture, so a renamed key cannot make every
    // comparison below pass by resolving nothing.
    expect(Object.keys(config.surfaces).sort()).toEqual(["attended", "ci", "unattended"]);
  });

  for (const surface of REAL) {
    describe(surface.profile, () => {
      test(`its pinned tool set is ${surface.where}'s, entry for entry`, () => {
        const r = resolved(surface.profile);
        expect(r.tools.map((t) => t.entry).sort()).toEqual(surface.allowed);
      });

      test(`its pinned deny list is ${surface.where}'s ceiling, entry for entry`, () => {
        const r = resolved(surface.profile);
        expect(r.denied.map((t) => t.entry).sort()).toEqual(surface.denied);
      });

      test("it names tools under the namespace ITS surface actually mints", () => {
        // The two mounting forms both exist on purpose and neither is a fallback
        // for the other: a plugin session mints one, `--mcp-config` the other.
        // A profile that pinned the wrong one would name sixteen tools no session
        // on that surface can call.
        for (const rule of resolved(surface.profile).tools) {
          if (rule.tool.startsWith("mcp__")) expect(rule.tool.startsWith(surface.prefix)).toBe(true);
        }
      });

      test("nothing it grants is something it also denies", () => {
        // Deny beats allow. A tool on both lists is a phase that silently stops
        // running, and the resolution reports it rather than counting it a grant.
        expect(resolved(surface.profile).cancelled).toEqual([]);
      });

      test("it is usable, and flattens to the grant its wrapper passes", () => {
        const check = checkSurfaceProfile(config, surface.profile);
        expect(check.exitCode).toBe(SURFACE_PROFILE_EXIT.cleared);
        expect(profileGrants(check.resolution!).sort()).toEqual(surface.allowed);
      });
    });
  }
});

/**
 * What the pinned list actually expresses about the difference between the three.
 *
 * This is the half of the assumption test that reports rather than ratchets, and
 * the answer is the finding in this file's header: on the tool axis these three
 * surfaces are one surface wearing two namespaces.
 */
describe("a profile expresses what actually differs — and how little that is", () => {
  const bare = (name: string) => resolved(name).tools.map((t) => bareToolName(t.entry)).sort();

  test("unattended and ci are the same grant and the same ceiling, character for character", () => {
    expect(resolved("unattended").tools.map((t) => t.entry).sort()).toEqual(
      resolved("ci").tools.map((t) => t.entry).sort(),
    );
    expect(resolved("unattended").denied.map((t) => t.entry).sort()).toEqual(
      resolved("ci").denied.map((t) => t.entry).sort(),
    );
  });

  test("attended differs from the other two only by the namespace that mounted the server", () => {
    expect(bare("attended")).toEqual(bare("unattended"));
    // …and the raw entries do differ, so the equality above is a statement about
    // mounting rather than an accident of two identical lists.
    expect(resolved("attended").tools.map((t) => t.entry).sort()).not.toEqual(
      resolved("unattended").tools.map((t) => t.entry).sort(),
    );
  });

  test("the only capability difference the list holds is a deny list attended does not have", () => {
    // Which is itself not a narrowing of the attended surface: a human is present
    // there and approves each call. It is the one asymmetry the tool axis carries,
    // and it is worth naming that it is the only one.
    expect(resolved("attended").denied).toEqual([]);
    expect(resolved("unattended").denied.length).toBeGreaterThan(0);
  });
});

describe("an argument-level restriction is expressible, or it is refused out loud", () => {
  /** Build a one-off config carrying a single hand-written profile. */
  function withProfile(tools: string[], denied: string[] = []) {
    return { ...config, surfaces: { ...config.surfaces, probe: { tools, denied } } };
  }

  const headingRestriction = `${DIRECT_PREFIX}ost_append_to_node(${RESULTS_HEADING})`;

  test("a tool present but refusing a reserved heading does NOT resolve cleanly", () => {
    // The refutation case, stated as the assumption states it: a profile that
    // resolved this cleanly would report a narrowed surface and hand over an
    // unnarrowed one.
    const r = resolveSurfaceProfile(withProfile([headingRestriction]), "probe");
    expect(isSurfaceProfileProblem(r)).toBe(false);
    expect((r as SurfaceProfileResolution).usable).toBe(false);
  });

  test("the refusal names the entry, the reason, and where the restriction really lives", () => {
    const check = checkSurfaceProfile(withProfile([headingRestriction]), "probe");
    expect(check.exitCode).toBe(SURFACE_PROFILE_EXIT.unsupportedRestriction);
    expect(check.report).toContain(headingRestriction);
    expect(check.report).toContain("matches on the tool name only");
    // Not merely "unsupported": this particular restriction is enforced, at the
    // tool layer, and sending somebody to build a guard that exists is its own
    // failure.
    expect(check.report).toContain("src/ost/headings.ts");
    const [only] = check.resolution!.unsupported;
    expect(only.tool).toBe(`${DIRECT_PREFIX}ost_append_to_node`);
    expect(only.argument).toBe(RESULTS_HEADING);
    expect(only.enforcedBy).toContain(RESULTS_HEADING);
  });

  test("an unusable profile cannot be flattened into a grant list at all", () => {
    // The one conversion that would lose the restriction silently, refused at the
    // point where it would happen rather than left to a caller's discipline.
    const r = resolveSurfaceProfile(withProfile([headingRestriction]), "probe") as SurfaceProfileResolution;
    expect(() => profileGrants(r)).toThrow(/no flat grant list/);
  });

  test("an MCP argument nothing enforces is refused too, and says nothing enforces it", () => {
    const check = checkSurfaceProfile(withProfile([`${DIRECT_PREFIX}ost_create_node(Opportunity)`]), "probe");
    expect(check.exitCode).toBe(SURFACE_PROFILE_EXIT.unsupportedRestriction);
    expect(check.resolution!.unsupported[0].enforcedBy).toBeNull();
    expect(check.report).toContain("Nothing enforces this restriction");
  });

  test("a scoped BUILT-IN restriction is expressible, and actually restricts", () => {
    // The other side of the split. Claude Code's grammar takes a scope on a
    // built-in, `ruleCovers` reads it the same way, so the restriction is enforced
    // by the comparison and not merely parsed by it — which is what "expressible"
    // has to mean for this to be worth anything.
    const scoped = "Glob(/Users/tanner/dev/OST-Agent/**)";
    const r = resolveSurfaceProfile(withProfile([scoped]), "probe") as SurfaceProfileResolution;
    expect(r.usable).toBe(true);
    const [rule] = r.tools;
    expect(ruleCovers(rule, { entry: "", tool: "Glob", argument: "/Users/tanner/dev/OST-Agent/src" })).toBe(true);
    expect(ruleCovers(rule, { entry: "", tool: "Glob", argument: "/Users/tanner/ost-agent-meta" })).toBe(false);
  });

  test("a restriction on the DENY half is refused on the same rule", () => {
    // Denying `ost_append_to_node(## Results)` is the same unenforceable claim
    // written from the other end, and a profile that refused it in `tools:` while
    // accepting it in `denied:` would leave the false assurance exactly where it
    // was.
    const check = checkSurfaceProfile(withProfile([], [headingRestriction]), "probe");
    expect(check.exitCode).toBe(SURFACE_PROFILE_EXIT.unsupportedRestriction);
  });
});

/**
 * The wiring, checked at the surface an operator and a wrapper actually use.
 *
 * A profile nothing reads is a fourth copy of the allowlist with no consumer. The
 * point of pinning it is that the preflight can check a pass against it instead of
 * against the list handed in by the same wrapper whose grant is in question.
 */
describe("the CLI reads a profile where it used to take the list verbatim", () => {
  // The local tsx binary rather than `npx`, which takes npm's cacache lock.
  const TSX = path.join(repoRoot, "node_modules/.bin/tsx");
  const CLI = path.join(repoRoot, "src/cli/index.ts");
  const SKILL = ".claude/skills/opportunity-solution-tree/SKILL.md";
  const cli = (args: string[]) =>
    spawnSync(TSX, [CLI, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });

  test("`required-tools --surface` clears the same pass `--available` clears", () => {
    // The equivalence that makes the profile a substitute rather than an addition:
    // the unattended profile IS autonomous-pass.sh's OST_TOOLS, so the verdict must
    // be identical to the one that script already gets on every firing.
    const viaProfile = cli(["required-tools", "--pass", SKILL, "--surface", "unattended", "--vault", fixtureVault]);
    const viaList = cli([
      "required-tools",
      "--pass",
      SKILL,
      "--available",
      REAL.find((s) => s.profile === "unattended")!.allowed.join(","),
    ]);
    expect(viaProfile.status).toBe(0);
    expect(viaList.status).toBe(0);
    expect(viaProfile.stdout).toBe(viaList.stdout);
  });

  test("naming both a profile and a list is refused, not silently resolved one way", () => {
    // An operator who passes both thinks one of the two is in force and cannot tell
    // which — and a default between them would make the losing flag look honoured.
    const both = cli([
      "required-tools",
      "--pass",
      SKILL,
      "--surface",
      "unattended",
      "--available",
      "Read",
      "--vault",
      fixtureVault,
    ]);
    expect(both.status).toBe(31);
    expect(both.stderr).toContain("exactly one of --available");
  });

  test("`surface-profile` exits non-zero on a profile that cannot be enforced", () => {
    const unknown = cli(["surface-profile", "--surface", "nightly", "--vault", fixtureVault]);
    expect(unknown.status).toBe(SURFACE_PROFILE_EXIT.unknownProfile);
    expect(unknown.stderr).toContain("COULD NOT RESOLVE");
  });
});

describe("a profile that names nothing is a problem, never an empty surface", () => {
  test("an unknown name resolves to a problem that lists what IS declared", () => {
    const r = resolveSurfaceProfile(config, "nightly");
    expect(isSurfaceProfileProblem(r)).toBe(true);
    expect((r as { problem: string }).problem).toContain("attended, ci, unattended");
  });

  test("a vault with no `surfaces:` block says so rather than resolving empty", () => {
    // The two look identical to a caller reading `tools.length === 0` and they are
    // opposites: a typo in `--surface` must not clear a run by naming a profile
    // nobody wrote.
    const bare = { ...config, surfaces: {} };
    const r = resolveSurfaceProfile(bare, "unattended");
    expect(isSurfaceProfileProblem(r)).toBe(true);
    expect(checkSurfaceProfile(bare, "unattended").exitCode).toBe(SURFACE_PROFILE_EXIT.unknownProfile);
  });
});
