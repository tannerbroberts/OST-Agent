/**
 * The required-tool precondition: a pass names the tools it cannot deliver
 * anything without, checks them against what is actually callable, and refuses
 * to begin — before it has written one line into the vault — when one is absent.
 *
 * **The disease.** An unattended sweep on 2026-08-06 reached for
 * `ost_flag_humans_required` and found it was not granted on that surface. It
 * found `Bash` absent and `ost_read_repo` ungranted the same way: at the moment
 * it tried to use them, forty calls in, having already decided what it wanted to
 * do. Under `claude -p` an ungranted call is denied rather than prompted, so each
 * discovery arrived as a silent narrowing — the sweep carried on and produced a
 * smaller result that looks from the outside exactly like a complete one. The
 * cost is not the denied call. It is the pass that ran to completion around it.
 *
 * **Why this is not {@link runGrantPreflight}.** That module already resolves a
 * declaration against a grant and names every gap, and this one reuses its
 * parser and its coverage rules rather than growing a second opinion about what a
 * scope is. What it does not have is the distinction this file exists for: it
 * treats every declared tool as mandatory, so on the surface that actually fires
 * it would refuse over `ost_check` — a tool withheld ON PURPOSE by this repo's own
 * containment argument (`test/release/examples-allowlist.test.ts`,
 * `CONTAINED_ON_PURPOSE`). A gate that stops the nightly pass over a tool
 * somebody deliberately withheld is worse than no gate: it is an obstacle that
 * gets switched off, and then nothing checks anything. So a declaration has two
 * halves, and only one of them can stop a run.
 *
 *   - **required** — the pass produces *nothing* without it. Missing ⇒ do not start.
 *   - **would-use** — the pass produces *less* without it. Missing ⇒ start, say so.
 *
 * The split is a claim about the pass, and it is falsifiable: put a tool in
 * `required` and the pass still delivers value without it, and the gate has
 * become an obstacle; leave one in `would-use` and the pass delivers nothing
 * without it, and the gate has cleared a run that was already dead.
 *
 * **The trap that makes a naive list refuse everything.** The same tool has two
 * names on the two surfaces this repo ships. `.claude/commands/ost-pass.md`
 * declares `mcp__plugin_ost-agent_ost-agent__ost_next_work`, because that is how
 * Claude Code names a tool reached through the plugin. The unattended runner
 * declares the server itself and grants `mcp__ost-agent__ost_next_work`. Compared
 * literally, all sixteen declared tools are gaps and the gate refuses every
 * firing — a false stop, which is the failure mode this file is one line away
 * from at all times. So MCP tool names are compared on the segment after the last
 * `__` ({@link unnamespacedTool}), and the server prefix is treated as the mounting
 * artifact it is. Non-MCP tools keep {@link ruleCovers}'s full path-scoped
 * semantics, because a `Glob` granted on the vault and asked for on the repo is a
 * real gap and four recorded denials in this workspace were exactly that.
 *
 * **What it cannot tell you.** Whether the split is drawn correctly for real
 * passes. This honours whatever split it is handed; whether that split matches
 * how a maintenance pass actually branches is a judgement about the workflow, and
 * no exit code reports on it. And, as ever, it compares two declarations — that
 * the harness's live surface matches the list it was handed is outside what any
 * file can answer, and {@link renderRequiredTools} says so in its own output.
 */
import fs from "node:fs";
import { declaredTools } from "../security/allowlist-generator.js";
import { parseRule, resolveGrants, ruleCovers, type GrantGap, type PermissionRule } from "../runner/grant-preflight.js";

/**
 * A pass's tool precondition, split by what its absence costs.
 *
 * `wouldUse` is derived rather than declared: it is everything the pass is
 * allowed to reach for that is not required. Declaring it separately would give
 * a third list to keep in sync with the other two, and this repo has already
 * spent days on drift between the two it has.
 */
export interface ToolDeclaration {
  /** Named in `required-tools:`. Absent one ⇒ the pass must not begin. */
  readonly required: readonly string[];
  /** `allowed-tools` minus `required-tools`. Absent one ⇒ a narrower pass. */
  readonly wouldUse: readonly string[];
}

/** Why a declaration could not be read. Each wants a different fix, so each says which. */
export interface DeclarationProblem {
  readonly problem: string;
}

/**
 * The tool an MCP grant names, with whatever namespace mounted it removed.
 *
 * Deliberately not `scripts/mcp-prefix.ts`'s `bareToolName`, which strips the two
 * prefixes THIS plugin mints by reading `.claude-plugin/plugin.json` off disk.
 * That is the right answer for a repo-local guard and the wrong one for shipped
 * code: this module runs out of `dist/ost-agent.mjs` on a machine where the
 * manifest may not be beside it, and against vaults whose server was mounted
 * under a name nobody here chose. So the namespace is whatever precedes the last
 * `__`, and the comparison is on what follows it.
 */
export function unnamespacedTool(tool: string): string {
  if (!tool.startsWith("mcp__")) return tool;
  const last = tool.lastIndexOf("__");
  return last > "mcp".length ? tool.slice(last + 2) : tool;
}

/** Split a frontmatter list line (`a, b, c`) into entries. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Read the two frontmatter lines that make up the declaration.
 *
 * Three ways this refuses, and none of them is "assume nothing is required":
 * a file with no `allowed-tools` has declared no surface at all; a file with no
 * `required-tools` has not answered the question this gate asks, and answering it
 * *for* the file with an empty list would turn the gate into a check that always
 * clears — the exact silence the degraded-firing verdict exists to stop. A
 * `required-tools` entry outside `allowed-tools` is incoherent rather than
 * strict: the pass cannot need a tool it never asked to be granted, and the gate
 * would refuse forever without telling anyone which list was wrong.
 */
export function parseToolDeclaration(markdown: string): ToolDeclaration | DeclarationProblem {
  const allowed = declaredTools(markdown);
  if (allowed === null || allowed.length === 0) {
    return { problem: "no `allowed-tools` frontmatter line, so the pass has declared no tool surface to check" };
  }
  const requiredLine = markdown.match(/^required-tools:\s*(.+)$/m);
  if (!requiredLine) {
    return {
      problem:
        "no `required-tools` frontmatter line. Which of its tools the pass cannot start without is undeclared, " +
        "and an undeclared precondition is not an empty one — reading it as `nothing is required` would make this " +
        "check clear every run, including the ones it exists to stop",
    };
  }
  const required = splitList(requiredLine[1]);
  if (required.length === 0) {
    return { problem: "`required-tools:` is present but names nothing, which is not the same as having no precondition" };
  }
  const allowedBare = new Set(allowed.map((t) => unnamespacedTool(parseRule(t).tool)));
  const undeclared = required.filter((t) => !allowedBare.has(unnamespacedTool(parseRule(t).tool)));
  if (undeclared.length > 0) {
    return {
      problem:
        `\`required-tools\` names ${undeclared.join(", ")}, which \`allowed-tools\` does not — a pass cannot ` +
        `require a tool it never asked to be granted. Fix one of the two lines.`,
    };
  }
  const requiredBare = new Set(required.map((t) => unnamespacedTool(parseRule(t).tool)));
  return {
    required,
    wouldUse: allowed.filter((t) => !requiredBare.has(unnamespacedTool(parseRule(t).tool))),
  };
}

/** Narrow the union without every caller re-writing the `in` check. */
export function isDeclarationProblem(d: ToolDeclaration | DeclarationProblem): d is DeclarationProblem {
  return "problem" in d;
}

/**
 * Does the available surface cover this demand?
 *
 * MCP tools compare on the bare name for the reason in this file's header; a
 * server-level grant (`mcp__ost-agent`) still reaches the tools beneath it, which
 * {@link ruleCovers} already knows how to say. Everything else keeps the full
 * scoped comparison.
 */
function availableCovers(available: PermissionRule, demand: PermissionRule): boolean {
  if (ruleCovers(available, demand)) return true;
  if (!available.tool.startsWith("mcp__") || !demand.tool.startsWith("mcp__")) return false;
  return (
    unnamespacedTool(available.tool) === unnamespacedTool(demand.tool) &&
    (available.argument === null || (demand.argument !== null && available.argument === demand.argument))
  );
}

/** One gap set per half of the declaration. Only the first one can stop a run. */
export interface RequiredToolResolution {
  readonly required: readonly PermissionRule[];
  readonly wouldUse: readonly PermissionRule[];
  /** Required tools the surface does not offer. Non-empty ⇒ the pass must not begin. */
  readonly missingRequired: readonly GrantGap[];
  /** Would-use tools the surface does not offer. The pass runs narrower, and says so. */
  readonly missingWouldUse: readonly GrantGap[];
}

/**
 * Resolve both halves against the surface. Pure — it reads nothing and writes
 * nothing, which is what lets the caller run it before anything else happens.
 */
export function resolveRequiredTools(
  declaration: ToolDeclaration,
  available: readonly string[],
): RequiredToolResolution {
  const grants = [...available];
  const req = resolveGrants({ demands: [...declaration.required], grants });
  const opt = resolveGrants({ demands: [...declaration.wouldUse], grants });
  const parsedAvailable = grants.map(parseRule);
  // `resolveGrants` answers with literal tool names; re-filter through the
  // prefix-aware comparison so a plugin-named declaration checked against a
  // directly-mounted server does not come out as sixteen gaps.
  const surviving = (gaps: readonly GrantGap[]): GrantGap[] =>
    gaps.filter((gap) => !parsedAvailable.some((a) => availableCovers(a, gap.demand)));
  return {
    required: req.demands,
    wouldUse: opt.demands,
    missingRequired: surviving(req.gaps),
    missingWouldUse: surviving(opt.gaps),
  };
}

/**
 * Distinct codes, because a run that must not start and a check that could not be
 * made need different handling from the shell that reads them.
 */
export const REQUIRED_TOOLS_EXIT = {
  cleared: 0,
  /** A required tool is not on the surface. The pass must not begin. */
  missingRequired: 30,
  /** The declaration could not be read, which is not a cleared run. */
  undeclared: 31,
} as const;

export interface RequiredToolsCheck {
  readonly exitCode: number;
  readonly report: string;
  readonly resolution: RequiredToolResolution | null;
}

const LIVE_SURFACE_CAVEAT =
  "NOT checked: whether the surface this run actually fires with is the list handed in here — a precondition " +
  "right about the declaration and wrong about the session is still wrong at 3am.";

/**
 * The message the operator reads.
 *
 * Every absent required tool is named individually, because the whole saving this
 * buys over discovering them one call at a time is that nobody has to go back to
 * the two lists and work out which. The cleared case is not silent for the same
 * reason a degraded firing is not: a check whose output is nothing cannot be told
 * from a check that never ran.
 */
export function renderRequiredTools(resolution: RequiredToolResolution): string {
  const narrowing =
    resolution.missingWouldUse.length === 0
      ? []
      : [
          "",
          `Narrower than declared: ${resolution.missingWouldUse.length} would-use tool(s) are not on this surface.`,
          ...resolution.missingWouldUse.map((g) => `  ${g.demand.entry}`),
          "The pass starts anyway — these cost it reach, not its ability to deliver. Report what you could not do",
          "with them rather than reporting a clean run.",
        ];

  if (resolution.missingRequired.length === 0) {
    return [
      `required-tools CLEARED: all ${resolution.required.length} required tool(s) are on this surface.`,
      ...narrowing,
      "",
      LIVE_SURFACE_CAVEAT,
    ].join("\n");
  }

  return [
    `REFUSING TO BEGIN: ${resolution.missingRequired.length} of ${resolution.required.length} required tool(s) ` +
      `are not on this surface.`,
    "",
    "Required and absent:",
    ...resolution.missingRequired.map((g) => `  ${g.demand.entry}`),
    ...narrowing,
    "",
    "Nothing has been written. A pass that starts without these does not fail — it narrows, finishes, and reports",
    "a run that looks complete from the outside, which is the state this refusal exists to prevent. Grant them, or",
    "move them out of `required-tools` if the pass genuinely delivers without them.",
    "",
    LIVE_SURFACE_CAVEAT,
  ].join("\n");
}

/**
 * Read a declaration file and check it against a surface.
 *
 * An unreadable or undeclared file exits `undeclared` rather than `cleared`: a
 * sweep that cannot read its subject must not report a clean result, which is the
 * same rule this repo applies to the grant preflight and to a firing whose source
 * surface could not be built.
 */
export function checkRequiredTools(opts: {
  /** The file whose frontmatter declares the two halves. */
  passFile: string;
  /** What the run will actually be able to call — `--allowedTools`, verbatim. */
  available: readonly string[];
}): RequiredToolsCheck {
  let markdown: string;
  try {
    markdown = fs.readFileSync(opts.passFile, "utf8");
  } catch (e) {
    return {
      exitCode: REQUIRED_TOOLS_EXIT.undeclared,
      report:
        `required-tools COULD NOT RUN: ${opts.passFile} is unreadable ` +
        `(${e instanceof Error ? e.message : String(e)}). That is not a cleared run.`,
      resolution: null,
    };
  }
  const declaration = parseToolDeclaration(markdown);
  if (isDeclarationProblem(declaration)) {
    return {
      exitCode: REQUIRED_TOOLS_EXIT.undeclared,
      report: `required-tools COULD NOT RUN: ${opts.passFile} has ${declaration.problem}. That is not a cleared run.`,
      resolution: null,
    };
  }
  const resolution = resolveRequiredTools(declaration, opts.available);
  return {
    exitCode: resolution.missingRequired.length > 0 ? REQUIRED_TOOLS_EXIT.missingRequired : REQUIRED_TOOLS_EXIT.cleared,
    report: renderRequiredTools(resolution),
    resolution,
  };
}

export interface PassStart<T> {
  readonly started: boolean;
  readonly exitCode: number;
  readonly report: string;
  /** What `begin` returned, or `undefined` if it was never called. */
  readonly result: T | undefined;
}

/**
 * The ordering guarantee, in the only form that can be tested: `begin` is the
 * work, and it is not reached at all unless the precondition holds.
 *
 * Everything above this function is a pure comparison over two lists of strings —
 * so the claim "zero vault writes on refusal" is not a property of the comparison,
 * which could not write anyway. It is a property of this call: the pass's writes
 * live behind `begin`, and a refusal returns without invoking it. That is what a
 * test can hold, and holding it is the difference between a precondition and a
 * message printed next to a run that started regardless.
 */
export function beginPass<T>(opts: {
  passFile: string;
  available: readonly string[];
  begin: () => T;
}): PassStart<T> {
  const check = checkRequiredTools({ passFile: opts.passFile, available: opts.available });
  if (check.exitCode !== REQUIRED_TOOLS_EXIT.cleared) {
    return { started: false, exitCode: check.exitCode, report: check.report, result: undefined };
  }
  return { started: true, exitCode: REQUIRED_TOOLS_EXIT.cleared, report: check.report, result: opts.begin() };
}
