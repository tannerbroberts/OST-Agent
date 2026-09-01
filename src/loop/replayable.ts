/**
 * Which recorded steps are safe to re-run, decided by a fixed allowlist rather
 * than by a judgement the tool does not have.
 *
 * This is the safety half of "Replay a recorded failure in its recorded context
 * on demand" (meta vault). `replay.ts` already answers *can* a step be
 * reconstructed — does the record carry `cwd` and `argv`. This module answers
 * the question that has to be settled before anything is actually spawned:
 * *may* it be re-run. Replay executes something, and a replay that re-runs a
 * publish, a push or an agent pass is worse than an unanswerable question.
 *
 * **The allowlist is data, and it is committed before the corpus is read.**
 * The assumption test beneath this solution ("Count how many recorded steps are
 * safely replayable at all") makes the ordering the load-bearing part, not the
 * threshold: an allowlist derived from the sample and then scored against that
 * same sample produces a number that means nothing and looks identical to one
 * that does. So {@link READ_ONLY_ALLOWLIST} is written from the verbs the node
 * itself names (`vitest`, `tsc`, `ost-agent check`, `git status`, "and
 * similar") plus their siblings read off `ost-agent --help` and `git`'s own
 * documented read subcommands — never off the ledger this rule is measured
 * against. Nothing in this file imports a fixture or reads a ledger, and that
 * is deliberate.
 *
 * **Unknown means no.** A verb this list does not name is not replayable, and a
 * step whose record cannot be reconstructed is not replayable either. The
 * assumption test is explicit that a step needing a human to decide counts as a
 * failure of the rule rather than a pass, so there is no "ask" branch here and
 * no third verdict: the rule either recognises the invocation or refuses it.
 *
 * **Stricter than the node in one place, and never looser.** The node names
 * bare `tsc` as read-only. It is not — `tsc` with no flags writes its emit
 * output. So `tsc` carries a required flag (`--noEmit`) here. A rule can only
 * be tightened before measuring, never relaxed: tightening can lower the share
 * and so cannot manufacture the green the test is trying to earn.
 */

/** One read-only verb, as an ordered token prefix over a normalised argv. */
export interface ReadOnlyVerb {
  /** Tokens that must match the head of the normalised argv, in order. */
  readonly phrase: readonly string[];
  /**
   * Present when the verb is read-only only in a flagged form. At least one of
   * these must appear among the tokens after the phrase, or the step is
   * refused — `tsc` is the case this exists for.
   */
  readonly requiresAnyOf?: readonly string[];
}

/**
 * The committed rule. Every entry is a command that prints and exits: it reads
 * a tree, a repository or a type graph and writes nothing back.
 *
 * The `ost-agent` entries are the subcommands whose own `--help` line describes
 * a read or a census. Every verb that mutates on its default path is absent by
 * construction, including the ones that only mutate behind a flag (`migrate`,
 * `repair-renames` with `--write`; `tree-view`, which records the visit unless
 * told not to; `briefing`, `next-build`, `ledger` and `claim`, which write a
 * file at a fixed address) and `verify`, which appends an instrument log line
 * to the vault. The `git` entries are the subcommands that have no mutating
 * form at all; `branch`, `tag` and `remote` are excluded precisely because they
 * do (`git branch -D`), and a token-prefix rule cannot tell those apart.
 */
export const READ_ONLY_ALLOWLIST: readonly ReadOnlyVerb[] = [
  // The two the assumption test names first.
  { phrase: ["vitest"] },
  { phrase: ["tsc"], requiresAnyOf: ["--noEmit", "--noemit"] },

  // `ost-agent <verb>` — reads and censuses.
  ...[
    "check",
    "status",
    "rollup",
    "debt",
    "gate",
    "buildable",
    "lineage",
    "reflection",
    "critic",
    "judge-panel",
    "score",
    "faithfulness",
    "lanes",
    "asks",
    "prerequisites",
    "dispositions",
    "suppressions",
    "stranded",
    "kill-list",
    "search",
    "symbols",
    "resources",
    "channels",
    "decisions",
    "capability-manifest",
    "setup-check",
    "proposals",
    "manifest",
    "preconditions",
    "corrections",
    "exclusions",
    "build-check",
  ].map((verb) => ({ phrase: ["ost-agent", verb] as const })),

  // `git <verb>` — the subcommands with no mutating form.
  ...["status", "log", "diff", "show", "rev-parse", "ls-files", "cat-file", "describe", "blame", "shortlog"].map(
    (verb) => ({ phrase: ["git", verb] as const }),
  ),
];

/** Package runners that launch another command and have no effect of their own. */
const RUNNER_HEADS = new Set(["npx", "bunx"]);
/** Two-token runner forms — `npm exec`, `pnpm dlx`, `yarn dlx`, and siblings. */
const RUNNER_PAIRS = new Set(["npm exec", "npm run", "pnpm exec", "pnpm dlx", "yarn exec", "yarn dlx", "bun x"]);
/** Runner flags dropped along with the runner itself. */
const RUNNER_FLAGS = new Set(["-y", "--yes", "--no-install", "--no", "--silent", "--quiet"]);
/** Extensions a `node <script>` head resolves through to the script's own name. */
const SCRIPT_EXTENSIONS = [".mjs", ".cjs", ".js"];

/** `FOO=bar` — an environment assignment sitting in front of the real command. */
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Last path segment, with a Windows executable suffix removed. */
function basename(token: string): string {
  const segment = token.split(/[/\\]/).pop() ?? token;
  return segment.endsWith(".exe") ? segment.slice(0, -4) : segment;
}

/**
 * Reduce a spawned argv to the tokens the allowlist is written against.
 *
 * Three normalisations, each of which preserves what the command *does*:
 * leading `FOO=bar` assignments and package-runner prefixes are dropped, an
 * absolute executable path becomes its basename, and `node <script>.mjs`
 * becomes the script's own name — which is how this repository's own loop
 * spawns its CLI (`node …/dist/ost-agent.mjs check …`), so without it every
 * `ost-agent` entry above would be unreachable.
 */
export function normalizeArgv(argv: readonly string[]): string[] {
  let tokens = argv.map((token) => token);

  // Environment assignments and package runners, repeatedly — `FOO=1 npx vitest`.
  for (;;) {
    if (tokens.length > 0 && ENV_ASSIGNMENT.test(tokens[0])) {
      tokens = tokens.slice(1);
      continue;
    }
    const head = tokens.length > 0 ? basename(tokens[0]) : "";
    if (tokens.length > 1 && RUNNER_PAIRS.has(`${head} ${tokens[1]}`)) {
      tokens = tokens.slice(2);
      continue;
    }
    if (RUNNER_HEADS.has(head)) {
      tokens = tokens.slice(1);
      while (tokens.length > 0 && RUNNER_FLAGS.has(tokens[0])) tokens = tokens.slice(1);
      continue;
    }
    break;
  }
  if (tokens.length === 0) return [];

  // `node script.mjs …` → `script …`, so a CLI spawned by absolute path reads
  // as the verb it is rather than as the interpreter that launched it.
  if (basename(tokens[0]) === "node" && tokens.length > 1) {
    const script = basename(tokens[1]);
    const ext = SCRIPT_EXTENSIONS.find((e) => script.endsWith(e));
    if (ext) tokens = [script.slice(0, -ext.length), ...tokens.slice(2)];
  }
  tokens = [basename(tokens[0]), ...tokens.slice(1)];

  // `git -C <dir> status` → `git status`. The directory is where it runs, which
  // the record already carries as `cwd`; it does not change the verb.
  if (tokens[0] === "git") {
    let rest = tokens.slice(1);
    while (rest.length > 1 && rest[0] === "-C") rest = rest.slice(2);
    tokens = ["git", ...rest];
  }
  return tokens;
}

/** Why a step was refused, or the allowlist phrase that cleared it. */
export type ReplayVerdict =
  | { readonly replayable: true; readonly verb: string }
  | {
      readonly replayable: false;
      readonly reason: "no-argv" | "not-on-allowlist" | "missing-required-flag";
      /** The normalised head, for a reader auditing the refusals. */
      readonly head: string;
    };

/**
 * The rule, applied to one recorded step's argv.
 *
 * Deliberately typed on `argv` alone rather than on `LoopStepRecord`: `cwd` is
 * what {@link import("./replay.js").reconstructInvocation} checks, and folding
 * the two questions together would let a step be refused as unsafe when it was
 * only unreconstructible. A caller that wants both asks both.
 */
export function classifyReplayable(argv: readonly string[] | undefined): ReplayVerdict {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((a) => typeof a === "string")) {
    return { replayable: false, reason: "no-argv", head: "" };
  }
  const tokens = normalizeArgv(argv);
  if (tokens.length === 0) return { replayable: false, reason: "no-argv", head: "" };
  const head = tokens[0];

  let flagShortfall: ReadOnlyVerb | null = null;
  for (const verb of READ_ONLY_ALLOWLIST) {
    if (verb.phrase.length > tokens.length) continue;
    if (!verb.phrase.every((token, i) => tokens[i] === token)) continue;
    const tail = tokens.slice(verb.phrase.length);
    if (verb.requiresAnyOf && !verb.requiresAnyOf.some((flag) => tail.includes(flag))) {
      flagShortfall = verb;
      continue;
    }
    return { replayable: true, verb: verb.phrase.join(" ") };
  }
  if (flagShortfall) {
    return { replayable: false, reason: "missing-required-flag", head: flagShortfall.phrase.join(" ") };
  }
  return { replayable: false, reason: "not-on-allowlist", head };
}

/** The share of a set of recorded steps the rule clears, and the refusals behind it. */
export interface ReplayableShare {
  total: number;
  replayable: number;
  /** `replayable / total`, or 0 for an empty corpus — an empty sample clears no bar. */
  share: number;
  /** How many steps each refusal reason accounts for, plus the cleared verbs. */
  byReason: Record<string, number>;
}

/**
 * Counted over every step given, with no step excluded for being awkward.
 *
 * An empty corpus scores 0 rather than 1. The vacuous-pass convention used by
 * `credentialedSteps.ts` is right there — a run with no credentialed step is
 * fully independent — but it is wrong here: the question is what share of real
 * recorded work replay would cover, and "there was no work" is not evidence
 * that it covers it.
 */
export function replayableShare(argvs: readonly (readonly string[] | undefined)[]): ReplayableShare {
  const byReason: Record<string, number> = {};
  let replayable = 0;
  for (const argv of argvs) {
    const verdict = classifyReplayable(argv);
    const key = verdict.replayable ? `allowed:${verdict.verb}` : `refused:${verdict.reason}`;
    byReason[key] = (byReason[key] ?? 0) + 1;
    if (verdict.replayable) replayable += 1;
  }
  const total = argvs.length;
  return { total, replayable, share: total === 0 ? 0 : replayable / total, byReason };
}

/** The bar the assumption test fixed, before any corpus was cut: 60%. */
export const REPLAYABLE_SHARE_BAR = 0.6;
