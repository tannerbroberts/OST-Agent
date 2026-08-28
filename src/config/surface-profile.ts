/**
 * Resolve a named surface profile out of `ost.config.yaml` — and refuse the
 * restrictions the enforcement point cannot actually keep.
 *
 * **The disease.** The same agent has a different tool surface on every surface
 * it runs on, and nowhere says which surface is meant to have what. The three
 * this repository runs each carry their own hand-maintained copy of the list —
 * `.claude/commands/ost-pass.md`'s frontmatter, `autonomous-pass.sh`'s
 * `OST_TOOLS`, `github-workflow.yml`'s `--allowedTools` — and the authority is
 * whichever file the reader happened to open. When an unattended sweep on
 * 2026-08-06 was instructed to flag human-required tests and found the flagging
 * tool absent, the instructions and the grants had been authored in different
 * places and disagreed; nothing could have noticed, because there was no place
 * the intended surface was written down.
 *
 * A profile is that place. It does not make a surface true — the host still
 * decides what it grants — but it gives the preflight
 * ({@link ../mcp/required-tools.ts}) something to check *against* rather than a
 * list handed in by the same wrapper whose grant is in question.
 *
 * **The half a tool list cannot hold, and why this file refuses instead of
 * resolving.** The assumption under all of this is that the difference between
 * surfaces is a tool list. It is not, quite. A restriction like "`ost_append_to_node`
 * is present, but may not write `## Results`" is a real difference between what
 * two surfaces may do, and it is *not expressible as a permission rule at all*:
 * Claude Code matches an MCP rule on the tool name, with no argument specifier,
 * so `mcp__ost-agent__ost_append_to_node(## Results)` in a grant is not a
 * narrower grant — it is a rule that matches nothing, next to a tool the surface
 * hands over whole. A profile that accepted that entry and resolved cleanly
 * would claim a restriction it had silently dropped, which is worse than not
 * having the profile: the operator would read a config that says the surface is
 * narrowed and get one that is not.
 *
 * So the split this file draws is between the two argument forms, and it is the
 * whole of what it adds over {@link ../runner/grant-preflight.ts}:
 *
 *   - **A scoped built-in** (`Glob(/repo/**)`, `Bash(npm run test:*)`) is
 *     expressible. Claude Code's permission grammar takes the scope, and
 *     `ruleCovers` reads it the same way, so the restriction is enforced by the
 *     comparison as well as declared by it.
 *   - **A scoped MCP tool** is NOT expressible, and is reported as an explicit
 *     unsupported restriction rather than resolved. Where the restriction is
 *     genuinely enforced — reserved headings are refused at the *tool* layer, by
 *     `src/ost/headings.ts`, on a parameter no tool call can reach — the refusal
 *     says so, because "you cannot write this here" and "nothing enforces this"
 *     are different answers and only one of them needs work.
 *
 * **What it cannot tell you.** Whether the profile is true of the surface. It is
 * a second place for the truth to live, and a profile that says a surface has a
 * tool the host does not grant is confidently wrong rather than silently wrong —
 * an improvement, and not a reconciliation. Only the preflight comparing a
 * profile against a live grant closes that, and `test/config/surface-profile.test.ts`
 * pins the three profiles against the surfaces' real declarations so the copy in
 * config cannot drift from the copies in the wrappers without a red gate.
 */
import { parseRule, ruleCovers, type PermissionRule } from "../runner/grant-preflight.js";
import { RESERVED_HEADINGS } from "../ost/headings.js";
import type { Config } from "./schema.js";

/**
 * A restriction a profile declared that the enforcement point cannot keep.
 *
 * `reason` is the operator-facing sentence and `enforcedBy` is the honest other
 * half: some of these are unenforceable everywhere, and some are enforced
 * perfectly well somewhere that is not the permission layer. Collapsing the two
 * would send somebody to build a guard that already exists.
 */
export interface UnsupportedRestriction {
  /** The profile entry exactly as the operator wrote it. */
  readonly entry: string;
  /** The tool it restricts. */
  readonly tool: string;
  /** The argument the operator meant to restrict it to. */
  readonly argument: string;
  /** Why a permission rule cannot carry it. */
  readonly reason: string;
  /** Where the restriction IS enforced, or `null` when nothing enforces it. */
  readonly enforcedBy: string | null;
}

/** A resolved profile: what it grants, what it denies, and what it could not express. */
export interface SurfaceProfileResolution {
  /** The profile's name in `surfaces:`. */
  readonly name: string;
  /** Every `tools:` entry, parsed. Present whether or not the profile is usable. */
  readonly tools: readonly PermissionRule[];
  /** Every `denied:` entry, parsed. Deny beats allow, so this is the ceiling. */
  readonly denied: readonly PermissionRule[];
  /**
   * Grants the profile's own deny list cancels. Not an error — an operator may
   * deliberately deny a tool the surface would otherwise grant — but a grant
   * nothing can use is worth naming, because it reads as capability.
   */
  readonly cancelled: readonly PermissionRule[];
  /** Restrictions no permission rule can carry. Non-empty ⇒ the profile is not usable. */
  readonly unsupported: readonly UnsupportedRestriction[];
  /**
   * May a caller act on `tools` as the surface's grant?
   *
   * False whenever anything was declared and not expressed. A caller that reads
   * `tools` past a false here has done exactly what this module exists to stop:
   * taken a narrowed profile as a full one.
   */
  readonly usable: boolean;
}

/** Why a profile could not be resolved at all. Distinct from an unusable one. */
export interface SurfaceProfileProblem {
  readonly problem: string;
}

/** Narrow the union without every caller re-writing the `in` check. */
export function isSurfaceProfileProblem(
  r: SurfaceProfileResolution | SurfaceProfileProblem,
): r is SurfaceProfileProblem {
  return "problem" in r;
}

/** Is this rule's tool reached through an MCP server? */
function isMcpTool(tool: string): boolean {
  return tool.startsWith("mcp__");
}

/**
 * Decide whether one entry's argument restriction can be carried by a permission
 * rule, and say what is true instead when it cannot.
 *
 * Returns `null` for every entry that is fine — unscoped (there is no
 * restriction to lose) or a scoped built-in (the grammar takes it).
 */
function unsupportedRestriction(rule: PermissionRule): UnsupportedRestriction | null {
  if (rule.argument === null || !isMcpTool(rule.tool)) return null;
  const heading = RESERVED_HEADINGS.find((h) => rule.argument!.includes(h) || h.includes(rule.argument!.trim()));
  return {
    entry: rule.entry,
    tool: rule.tool,
    argument: rule.argument,
    reason:
      `an MCP permission rule matches on the tool name only — there is no argument specifier a host honours, so ` +
      `"${rule.entry}" is not a narrower grant of ${rule.tool}. It is a rule that matches nothing, beside a tool ` +
      `the surface hands over whole.`,
    enforcedBy:
      heading === undefined
        ? null
        : `src/ost/headings.ts — "${heading}" is a RESERVED_HEADING, refused at the tool layer on a parameter no ` +
          `tool call can reach, so this restriction already holds on every surface and needs no grant to carry it`,
  };
}

/**
 * Resolve one named profile.
 *
 * An unknown name is a problem, never an empty tool set. The two look identical
 * to a caller that reads `tools.length === 0` and they are opposites: a surface
 * that grants nothing is a real, checkable answer, and a typo in `--surface` that
 * resolves to it would clear a run by naming a profile that does not exist.
 */
export function resolveSurfaceProfile(config: Config, name: string): SurfaceProfileResolution | SurfaceProfileProblem {
  const profile = config.surfaces[name];
  if (profile === undefined) {
    const declared = Object.keys(config.surfaces).sort();
    return {
      problem:
        declared.length === 0
          ? `no surface profiles are declared in ost.config.yaml, so "${name}" names nothing. Add a \`surfaces:\` ` +
            `block pinning what each surface is meant to grant — resolving an undeclared profile to an empty tool ` +
            `set would clear a run against a surface nobody described.`
          : `no surface profile named "${name}" — ost.config.yaml declares ${declared.join(", ")}.`,
    };
  }
  const tools = profile.tools.map(parseRule);
  const denied = profile.denied.map(parseRule);
  const unsupported = tools
    .concat(denied)
    .map(unsupportedRestriction)
    .filter((u): u is UnsupportedRestriction => u !== null);
  // Deny beats allow in Claude Code, so a grant its own profile denies is not a
  // grant. Computed with the same coverage rule the preflight uses, so a
  // server-level denial cancels the tools beneath it exactly as the host would.
  const cancelled = tools.filter((t) => denied.some((d) => ruleCovers(d, t)));
  return { name, tools, denied, cancelled, unsupported, usable: unsupported.length === 0 };
}

/**
 * Distinct codes, because "this profile does not exist" and "this profile
 * declares something nothing can enforce" need different handling from the shell
 * that reads them, and neither is a cleared run.
 */
export const SURFACE_PROFILE_EXIT = {
  cleared: 0,
  /** The profile declares a restriction no permission rule can carry. */
  unsupportedRestriction: 40,
  /** No profile by that name. */
  unknownProfile: 41,
} as const;

const PROFILE_CAVEAT =
  "NOT checked: whether the host actually grants this. A profile is what a surface is MEANT to have — if it says " +
  "a surface has a tool the host withholds, the config is now confidently wrong rather than silently wrong, which " +
  "is an improvement and not a reconciliation.";

/**
 * The message the operator reads.
 *
 * Every unsupported restriction is named individually with the entry as written,
 * because the fix is an edit to that line and a count sends somebody back to the
 * file to work out which. The cleared case is not silent, for the same reason the
 * preflight's is not: a check whose output is nothing cannot be told from a check
 * that never ran.
 */
export function renderSurfaceProfile(resolution: SurfaceProfileResolution): string {
  const cancelled =
    resolution.cancelled.length === 0
      ? []
      : [
          "",
          `Granted and denied by the same profile (${resolution.cancelled.length}) — deny beats allow, so these are not grants:`,
          ...resolution.cancelled.map((r) => `  ${r.entry}`),
        ];

  if (resolution.usable) {
    return [
      `surface "${resolution.name}": ${resolution.tools.length} tool(s) granted, ${resolution.denied.length} denied.`,
      ...cancelled,
      "",
      PROFILE_CAVEAT,
    ].join("\n");
  }

  const lines = [
    `surface "${resolution.name}" IS NOT USABLE: ${resolution.unsupported.length} declared restriction(s) cannot be ` +
      `carried by a permission rule.`,
    "",
  ];
  for (const u of resolution.unsupported) {
    lines.push(`  ${u.entry}`);
    lines.push(`    ${u.reason}`);
    lines.push(
      u.enforcedBy === null
        ? `    Nothing enforces this restriction. Drop the argument and grant ${u.tool} outright, or withhold it.`
        : `    Already enforced, elsewhere: ${u.enforcedBy}. Drop the argument — the grant is not where this lives.`,
    );
    lines.push("");
  }
  lines.push(
    "Resolving this profile anyway would report a narrowed surface and hand over an unnarrowed one, which is the",
    "false assurance a pinned profile exists to remove. Nothing was granted, denied or written.",
    ...cancelled,
    "",
    PROFILE_CAVEAT,
  );
  return lines.join("\n");
}

export interface SurfaceProfileCheck {
  readonly exitCode: number;
  readonly report: string;
  readonly resolution: SurfaceProfileResolution | null;
}

/** Resolve and render in one call, with the exit code a shell can gate on. */
export function checkSurfaceProfile(config: Config, name: string): SurfaceProfileCheck {
  const resolved = resolveSurfaceProfile(config, name);
  if (isSurfaceProfileProblem(resolved)) {
    return {
      exitCode: SURFACE_PROFILE_EXIT.unknownProfile,
      report: `surface profile COULD NOT RESOLVE: ${resolved.problem} That is not a cleared run.`,
      resolution: null,
    };
  }
  return {
    exitCode: resolved.usable ? SURFACE_PROFILE_EXIT.cleared : SURFACE_PROFILE_EXIT.unsupportedRestriction,
    report: renderSurfaceProfile(resolved),
    resolution: resolved,
  };
}

/**
 * The grant a profile actually offers, as the flat list `required-tools` and
 * `--allowedTools` both take.
 *
 * Only ever called on a usable resolution — an unusable one has no honest flat
 * list, because the entry that could not be expressed would come out of it
 * looking like an ordinary grant, which is the exact conversion this module
 * refuses to perform.
 */
export function profileGrants(resolution: SurfaceProfileResolution): string[] {
  if (!resolution.usable) {
    throw new Error(
      `surface profile "${resolution.name}" declares a restriction no permission rule can carry, so it has no ` +
        `flat grant list — flattening it would drop the restriction silently.`,
    );
  }
  const cancelled = new Set(resolution.cancelled.map((r) => r.entry));
  return resolution.tools.filter((t) => !cancelled.has(t.entry)).map((t) => t.entry);
}
