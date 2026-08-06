/**
 * Resolve the tools a run's instructions demand against the grant it will
 * actually fire with, and name every gap before the run reaches the tree.
 *
 * **The disease.** The instructions an unattended pass fires with declare their
 * tools (`allowed-tools` in the skill or command frontmatter). The session,
 * separately, holds a grant (`permissions.allow` in a settings file, or the
 * `--allowedTools` a wrapper hands `claude -p`). Nothing compares the two. Under
 * `claude -p` a call outside the grant is **denied, not prompted** — no message
 * the pass can report — so the run finds the gap by falling into it, one call at
 * a time, at the point where it had already decided what it wanted to do. Five
 * scheduled firings of this repo's meta vault were spent that way
 * (`scripts/mcp-prefix.ts`), and ~30 writes were filed as "unverified" as though
 * a tool had failed rather than never having been offered.
 *
 * This is the comparison, and only the comparison. It does not request a grant,
 * escalate, or work around a gap — the whole point of a permission is that a
 * person decides, and a preflight that helpfully acquires what it lacks has
 * voided the mechanism it was meant to serve. Widening lives in
 * `src/security/allowlist-generator.ts`, is human-only, and refuses in an agent
 * session; this module writes nothing at all.
 *
 * **The path-scoped case is the one that decides whether this is worth having.**
 * Four of fifteen recorded denials in this workspace were `Glob` refused on
 * `/Users/tanner/dev/OST-Agent` — the tool was granted and the *directory* was
 * not. A resolver that reports "Glob: granted" there has cleared a run that is
 * about to be blocked, which is worse than no preflight, because it converts an
 * unknown into a wrong answer. So a grant carries its scope through
 * {@link parseRule} and coverage is decided over the argument as well as the
 * name ({@link argumentCovered}).
 *
 * **What it cannot tell you.** It compares two files. Whether the harness's live
 * grant matches the settings file it read is outside what any file on disk can
 * answer — a resolver that is right about the configuration and wrong about the
 * session is still wrong at 3am, and {@link renderPreflight} says so in its own
 * output rather than leaving the reader to assume otherwise.
 *
 * **What it deliberately does not read: prose.** The pass prompt names tools in
 * sentences, and some of those sentences name a tool in order to say *do not
 * reach for it* — `examples/automation/autonomous-pass.sh` tells a narrowed run
 * "this run cannot verify its own writes with `ost_check`" in the same breath
 * that the containment withholds it. A scanner that harvested tool names out of
 * prose would demand exactly the tool the instructions just said to do without,
 * and stop the run over it. Demands come from the declaration, plus whatever a
 * human names explicitly (`--demand`), and from nowhere else.
 */
import fs from "node:fs";
import { declaredTools, grantedTools, type SettingsFile } from "../security/allowlist-generator.js";

/**
 * One permission rule, parsed. Both sides of the comparison are the same shape:
 * a Claude Code grant (`Glob(/repo/**)`) and a declared demand are written in
 * the same syntax, so one parser serves both and the two cannot disagree about
 * what a scope is.
 */
export interface PermissionRule {
  /** The rule exactly as written, for messages a person has to act on. */
  entry: string;
  /** The tool name — everything before the parenthesis. */
  tool: string;
  /** The scope inside the parenthesis, or `null` for an unscoped rule. */
  argument: string | null;
}

/** Why a demand is not covered. The two want different fixes, so they get different names. */
export type GapKind =
  /** No rule in the grant names this tool at all. */
  | "ungranted"
  /** The tool is granted, but not for what this run asks of it. */
  | "out-of-scope";

export interface GrantGap {
  demand: PermissionRule;
  kind: GapKind;
  /**
   * For an `out-of-scope` gap, the rules that DO name the tool — the scope the
   * grant has, next to the scope the run wants. Empty for `ungranted`.
   */
  granted: string[];
}

export interface PreflightResult {
  demands: PermissionRule[];
  grants: PermissionRule[];
  gaps: GrantGap[];
}

/**
 * Split `Tool(argument)` into its parts. Anything without a parenthesised tail
 * is an unscoped rule, which is the ordinary shape of an MCP tool grant.
 */
export function parseRule(entry: string): PermissionRule {
  const trimmed = entry.trim();
  const match = trimmed.match(/^([^(]+)\((.*)\)$/s);
  if (!match) return { entry: trimmed, tool: trimmed, argument: null };
  return { entry: trimmed, tool: match[1].trim(), argument: match[2].trim() };
}

/**
 * Normalise a scope for comparison: Claude Code writes an absolute path rule as
 * `//abs/path`, and a trailing slash is not a different directory.
 */
function normalizeArgument(argument: string): string {
  const collapsed = argument.startsWith("//") ? argument.slice(1) : argument;
  return collapsed.length > 1 && collapsed.endsWith("/") ? collapsed.replace(/\/+$/, "") : collapsed;
}

/**
 * Does a grant's tool name reach a demand's?
 *
 * Exact, or a server-level MCP grant covering the tools beneath it: a settings
 * file may grant `mcp__plugin_ost-agent_ost-agent` and mean every tool that
 * server exposes. Reporting `mcp__plugin_ost-agent_ost-agent__ost_read_tree` as
 * a gap against it would be a false stop, which is the failure mode this whole
 * module is one step away from at all times.
 */
function toolCovered(grantTool: string, demandTool: string): boolean {
  if (grantTool === demandTool) return true;
  return grantTool.startsWith("mcp__") && demandTool.startsWith(`${grantTool}__`);
}

/** `*` within a path segment, `**` across segments — gitignore semantics, as Claude Code reads them. */
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * Does a grant's scope cover the scope a run asks for?
 *
 * Three forms, because the grant syntax has three: a Bash prefix rule
 * (`npm run test:*`), a path glob (`/repo/**`), and a bare directory, which
 * covers what is under it the way a gitignore entry does. Everything else is
 * equality — and a demand that matches nothing here is a gap, which is the
 * fail-closed direction: over-reporting costs a person one reading, and
 * under-reporting costs the run.
 */
function argumentCovered(grantArgument: string, demandArgument: string): boolean {
  const grant = normalizeArgument(grantArgument);
  const demand = normalizeArgument(demandArgument);
  if (grant === demand) return true;
  if (grant.endsWith(":*")) return demand.startsWith(grant.slice(0, -2));
  if (grant.includes("*") || grant.includes("?")) return globToRegExp(grant).test(demand);
  return demand.startsWith(`${grant}/`);
}

/** Does one grant rule cover one demand outright? */
export function ruleCovers(grant: PermissionRule, demand: PermissionRule): boolean {
  if (!toolCovered(grant.tool, demand.tool)) return false;
  // An unscoped grant is the whole tool; a scoped grant reaches only its scope,
  // and an unscoped demand asks for more than any scoped grant can give.
  if (grant.argument === null) return true;
  if (demand.argument === null) return false;
  return argumentCovered(grant.argument, demand.argument);
}

/**
 * The comparison itself: every demand the grant does not cover, in the order
 * they were declared, each with the reason it is uncovered.
 */
export function resolveGrants(input: { demands: string[]; grants: string[] }): PreflightResult {
  const demands = input.demands.map(parseRule);
  const grants = input.grants.map(parseRule);
  const gaps: GrantGap[] = [];
  for (const demand of demands) {
    if (grants.some((g) => ruleCovers(g, demand))) continue;
    const named = grants.filter((g) => toolCovered(g.tool, demand.tool));
    gaps.push({
      demand,
      kind: named.length > 0 ? "out-of-scope" : "ungranted",
      granted: named.map((g) => g.entry),
    });
  }
  return { demands, grants, gaps };
}

export interface PreflightPaths {
  /** The file the demands were declared in. */
  skillPath: string;
  /** The settings file whose `permissions.allow` is the grant — and where a fix goes. */
  settingsPath: string;
}

/**
 * The message the operator reads. Every gap is named individually, because
 * "4 tools missing" sends a person back to the two files to work out which — and
 * the whole saving this buys is that they do not have to.
 */
export function renderPreflight(result: PreflightResult, paths: PreflightPaths): string {
  // Named even when clear: a preflight whose output is silence is one a reader
  // cannot tell from a preflight that never ran.
  const caveat =
    `Checked: ${paths.skillPath} declares, ${paths.settingsPath} grants. NOT checked: whether the session's ` +
    `live grant is this file — a preflight right about the configuration and wrong about the session is still wrong.`;

  if (result.gaps.length === 0) {
    return [
      `preflight CLEARED: all ${result.demands.length} declared tool demand(s) are covered by the grant.`,
      caveat,
    ].join("\n");
  }

  const ungranted = result.gaps.filter((g) => g.kind === "ungranted");
  const scoped = result.gaps.filter((g) => g.kind === "out-of-scope");
  const lines = [
    `PREFLIGHT FAILED: ${result.gaps.length} of ${result.demands.length} declared tool demand(s) are not covered ` +
      `by the grant this run would fire with.`,
    "",
  ];
  if (ungranted.length > 0) {
    lines.push(`Not granted at all (${ungranted.length}):`);
    for (const gap of ungranted) lines.push(`  ${gap.demand.entry}`);
    lines.push("");
  }
  if (scoped.length > 0) {
    lines.push(`Granted, but not for what this run asks (${scoped.length}):`);
    for (const gap of scoped) {
      lines.push(`  ${gap.demand.entry} — ${gap.demand.tool} is granted only for: ${gap.granted.join(", ")}`);
    }
    lines.push("");
  }
  lines.push(
    `Add them to \`permissions.allow\` in ${paths.settingsPath}, or narrow the declaration in ${paths.skillPath}.`,
    "Stopping here is cheaper than finding out one call at a time: under `claude -p` an ungranted call is denied",
    "rather than prompted, so a run that proceeds spends its night discovering this and reports a night with",
    "nothing to do. Nothing was requested, escalated or written — which grant to add is the operator's decision.",
    "",
    caveat,
  );
  return lines.join("\n");
}

/** Distinct codes: a run that must not start, and a preflight that could not answer, need different handling. */
export const PREFLIGHT_EXIT = {
  cleared: 0,
  /** Demands the grant does not cover. The run must not start. */
  gaps: 20,
  /** The comparison could not be made at all — which is not a clear result. */
  unreadable: 21,
} as const;

export interface PreflightRun {
  exitCode: number;
  report: string;
  result: PreflightResult | null;
}

/**
 * The IO shell: read the declaration and the grant, compare, report.
 *
 * An unreadable input exits `unreadable` rather than `cleared`. A sweep that
 * cannot read its subject must not report a clean result — the same rule this
 * repo already applies to the preflight-uncertainty census and to a firing whose
 * source surface could not be built.
 */
export function runGrantPreflight(opts: {
  skillPath: string;
  settingsPath: string;
  /** Tools a human knows the run needs that the declaration does not name (`--demand`). */
  extraDemands?: string[];
}): PreflightRun {
  const paths = { skillPath: opts.skillPath, settingsPath: opts.settingsPath };
  if (!fs.existsSync(opts.skillPath)) {
    return {
      exitCode: PREFLIGHT_EXIT.unreadable,
      report: `preflight COULD NOT RUN: no declaration file at ${opts.skillPath}. That is not a cleared run.`,
      result: null,
    };
  }
  const declared = declaredTools(fs.readFileSync(opts.skillPath, "utf8")) ?? [];
  const demands = [...declared, ...(opts.extraDemands ?? [])];
  if (demands.length === 0) {
    return {
      exitCode: PREFLIGHT_EXIT.unreadable,
      report:
        `preflight COULD NOT RUN: ${opts.skillPath} has no \`allowed-tools\` frontmatter line and no --demand was ` +
        `given, so there is nothing to check the grant against. That is not a cleared run.`,
      result: null,
    };
  }

  if (!fs.existsSync(opts.settingsPath)) {
    // An absent settings file grants nothing, and that is a real, checkable
    // answer rather than an unreadable one: every demand is a gap.
    const result = resolveGrants({ demands, grants: [] });
    return { exitCode: PREFLIGHT_EXIT.gaps, report: renderPreflight(result, paths), result };
  }

  let settings: SettingsFile;
  try {
    settings = JSON.parse(fs.readFileSync(opts.settingsPath, "utf8")) as SettingsFile;
  } catch (e) {
    return {
      exitCode: PREFLIGHT_EXIT.unreadable,
      report:
        `preflight COULD NOT RUN: ${opts.settingsPath} is not valid JSON ` +
        `(${e instanceof Error ? e.message : String(e)}), so what this run is granted is unknown. ` +
        `That is not a cleared run.`,
      result: null,
    };
  }

  const result = resolveGrants({ demands, grants: grantedTools(settings) });
  return {
    exitCode: result.gaps.length > 0 ? PREFLIGHT_EXIT.gaps : PREFLIGHT_EXIT.cleared,
    report: renderPreflight(result, paths),
    result,
  };
}
