/**
 * Whether a run's step needed the operator's own credential, and how much of a
 * run's work sat upstream of the first one that did.
 *
 * This is the assumption test beneath "Do everything that needs no credential
 * first, and bank the rest into one approval" — not the reorder itself. The
 * reorder is worth building only if, in most past runs, a fair share of the
 * steps could have run before the first credentialed one; this module is what
 * makes that fraction computable at all, where before nothing marked a step as
 * credentialed and nothing derived which steps sat downstream of one.
 *
 * **What counts as credentialed, and why by tool/command rather than by
 * outcome.** The four surfaces this repo's own credential broker actually
 * gates (`src/runner/credentials.ts`): Slack, Atlassian, brokered web search,
 * and the GitHub Actions read. Two more are added because they are the
 * credential this build loop itself blocks on today (see "Every run ends
 * blocked on a credential only I hold" in the vault): `git push`/`fetch`/`pull`
 * against a remote, and any `gh` call. `curl`/`wget` and `npm publish`/`login`
 * are included too — a raw network fetch or a registry publish is exactly the
 * shape of action this classification exists to catch, even though it is not
 * one of this repo's named adapters. The match is on the COMMAND text, not on
 * whether the call actually had a credential available — a run that failed for
 * want of one still needed one, and still belongs on the far side of the gate.
 *
 * **Downstream is positional, not causal, and that is a known understatement.**
 * A step after the run's first credentialed step is never counted as
 * independent, even when it is not itself credentialed, because it may consume
 * that step's output — the run's own order is the only dependency signal
 * available. A step is never promoted to "independent" for having looked
 * harmless; it is only ever demoted for sitting after the boundary. That makes
 * the computed fraction a floor on how much work could run before the
 * approval, not an estimate of it — see the solution node's own caveat: a run
 * written by an agent that already stops at the first block was never free to
 * show what a reordering run would sequence differently.
 */

/** One tool call, in the order a run made it. */
export interface RunStep {
  /** The tool name exactly as the transcript recorded it. */
  tool: string;
  /** The Bash command, when `tool` is `"Bash"` — absent for every other tool. */
  command?: string;
}

/** Built-in tools that always spend a credential the operator holds. */
const CREDENTIALED_TOOLS = new Set(["WebSearch", "WebFetch"]);

/** Substrings of an MCP tool's name that mark it as reaching a credentialed adapter. */
const CREDENTIALED_MCP_MARKERS = [
  "search_web",
  "read_web",
  "ingest_inbox",
  "slack",
  "atlassian",
  "jira",
  "confluence",
];

/** `git push`, `git fetch` or `git pull` — the three subcommands that reach a remote. */
const GIT_REMOTE_SUBCOMMAND = /\bgit\s+(?:-C\s+\S+\s+)?(?:push|fetch|pull)\b/;
/** Any `gh` invocation — every subcommand it has authenticates against GitHub. */
const GH_CLI = /(?:^|[;&|]\s*|\s)gh\s+\S/;
const REGISTRY_PUBLISH = /\b(?:npm|yarn|pnpm)\s+(?:publish|login)\b/;
const RAW_HTTP = /\b(?:curl|wget)\b/;

/** Does this step spend a credential only the operator holds? */
export function classifyStep(step: RunStep): boolean {
  if (CREDENTIALED_TOOLS.has(step.tool)) return true;
  if (step.tool.startsWith("mcp__")) {
    const name = step.tool.toLowerCase();
    return CREDENTIALED_MCP_MARKERS.some((marker) => name.includes(marker));
  }
  if (step.tool === "Bash" && step.command) {
    const cmd = step.command;
    return GIT_REMOTE_SUBCOMMAND.test(cmd) || GH_CLI.test(cmd) || REGISTRY_PUBLISH.test(cmd) || RAW_HTTP.test(cmd);
  }
  return false;
}

/**
 * Fraction of a run's steps that sit strictly before its first credentialed
 * step — the ones a "do the unsecured work first" reorder could move earlier
 * without guessing at a dependency the run's order does not show.
 *
 * A run with no credentialed step at all is fully independent (1): there is no
 * boundary to sit downstream of. An empty run is vacuously independent (1) —
 * there is no step for the boundary to disqualify.
 */
export function independentFraction(steps: readonly RunStep[]): number {
  if (steps.length === 0) return 1;
  const firstCredentialed = steps.findIndex(classifyStep);
  const independent = firstCredentialed === -1 ? steps.length : firstCredentialed;
  return independent / steps.length;
}

export interface IndependenceBar {
  /** A run "qualifies" once at least this fraction of its steps are independent. */
  minFraction: number;
  /** At least this many runs, of however many are given, must qualify. */
  minQualifyingRuns: number;
}

/** The bar the solution node fixed: half or more of the steps, in at least 6 of 10 runs. */
export const DEFAULT_INDEPENDENCE_BAR: IndependenceBar = { minFraction: 0.5, minQualifyingRuns: 6 };

export interface IndependenceResult {
  total: number;
  qualifying: number;
  /** One fraction per run, same order as given — the distribution, not its mean. */
  fractions: number[];
  meetsBar: boolean;
}

/**
 * Applies the bar over the distribution of runs, never over their mean — a
 * mean hides the runs where nothing was independent, which is exactly the
 * failure mode the solution node's own "what would make this the wrong pick"
 * section describes: most of a run downstream of one push.
 */
export function runIndependence(
  runs: readonly (readonly RunStep[])[],
  bar: IndependenceBar = DEFAULT_INDEPENDENCE_BAR,
): IndependenceResult {
  const fractions = runs.map((steps) => independentFraction(steps));
  const qualifying = fractions.filter((f) => f >= bar.minFraction).length;
  return { total: runs.length, qualifying, fractions, meetsBar: qualifying >= bar.minQualifyingRuns };
}
