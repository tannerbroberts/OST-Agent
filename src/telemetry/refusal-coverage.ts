/**
 * The refusal-coverage census: of the distinct refusal classes this project's
 * passes actually hit, how many could a manifest generated from tool schemas
 * alone have named before the call was composed?
 *
 * The solution under test is "A preflight manifest states every tool
 * precondition before the pass composes its first call". Its whole cost argument
 * rests on *generation*: its own body says a hand-written manifest "becomes a
 * second statement of the rules that drifts from the first". The assumption
 * beneath it is the risky half, and it was written down before anyone counted —
 * every precondition that actually costs a pass a turn is derivable from the
 * tool surface's own schemas. The bar the assumption test fixed in advance:
 * **at least 60% of the distinct refusal classes in the captured transcript
 * corpus must be nameable by a schema-derived manifest.** Below 60% the cost
 * claim is refuted rather than refined, because the rules that actually bite
 * would be living outside the schemas the manifest generates from.
 *
 * ## What a refusal class is, and what is deliberately not one
 *
 * A class is a distinct *tool precondition* — a rule the surface enforces that
 * the caller could not see before calling. `Exit code 1 … ls: -d: No such file
 * or directory` is not one: it is a program failing, not a tool refusing, and
 * counting the 374 of those in this corpus would swamp the question with shell
 * noise. Three exclusions carry that weight and each is published as a number in
 * {@link RefusalCensus.excluded} rather than defended in prose — see
 * {@link REFUSAL_RULE.consideredAndExcluded}.
 *
 * ## Three readings, because "could have named it" has three honest meanings
 *
 * The readings are monotone: a later one may only admit more.
 *
 * - **`keyword`** — the refusal is a violation of a JSON Schema keyword, and the
 *   manifest {@link generatePreflightManifest} actually emits carries that rule
 *   for a tool the class was refused by. Machine-derived, cannot drift from what
 *   the validator does. This is the reading the solution's cost argument means.
 * - **`argument-decidable`** — adds classes whose truth turns on the call's own
 *   arguments and nothing else, so a sentence in that tool's description could
 *   state them without restating runtime state that might move underneath it.
 *   This is the widest reading that can still come out false, and it is the one
 *   {@link RefusalCensus.meetsBar} is taken on.
 * - **`any-prose`** — adds every remaining class, i.e. what the idea gets if
 *   every tool author writes every runtime rule into their description by hand.
 *   It is 100% by construction and therefore settles nothing; it is reported to
 *   name exactly what "manifest" would have to mean for the solution to work,
 *   which is the hand-written manifest the solution itself ruled out.
 *
 * ## Reach is reported before any share
 *
 * A generator can only fold schemas it holds. {@link RefusalCensus.reach} says
 * how many classes were refused by a tool whose schema this repository actually
 * has; the rest are out of reach of any generator running here, whatever a
 * schema could express in principle. It leads the report for the same reason the
 * preflight-uncertainty census leads with `unread`: a share over a denominator
 * the reader has not seen is the shape of every confident wrong finding this
 * repository has had to withdraw.
 */
import {
  bareToolName,
  manifestNames,
  manifestTools,
  type PreconditionKind,
  type PreflightManifest,
} from "../security/preflight-manifest.js";
import type { FailingCall } from "./path-failure-attribution.js";

/**
 * What a refusal's truth turns on. Only `arguments` is decidable from the call
 * itself; every other value names state a static schema cannot see.
 */
export type DecidableFrom =
  /** The call's own arguments, and nothing else. */
  | "arguments"
  /** What this session already did — which files it read, which worktree it is in. */
  | "session-history"
  /** What the user has granted this run. */
  | "grant-state"
  /** What is on disk right now. */
  | "filesystem-state"
  /** What the vault or its config holds. */
  | "vault-state"
  /** How large the response turned out to be — not knowable before the call. */
  | "response-size"
  /** Which tools and skills this process was started with. */
  | "installed-surface"
  /** What a remote service has linked or selected for this caller. */
  | "remote-state";

export type ReadingName = "keyword" | "argument-decidable" | "any-prose";

/** One distinct precondition the corpus records a tool enforcing. */
export interface RefusalClassSpec {
  id: string;
  /** What the caller had to know, in one line. */
  precondition: string;
  match: RegExp;
  decidableFrom: DecidableFrom;
  /**
   * The manifest rule kinds that would have carried this rule. Almost every
   * class lists only `stated-precondition`, and that is the finding rather than
   * an accident of drafting: a JSON Schema keyword constrains one argument, and
   * "you must have read this file already" is not a fact about an argument.
   */
  namedBy: PreconditionKind[];
}

const KEYWORD_KINDS: PreconditionKind[] = [
  "closed-parameter-set",
  "required-parameter",
  "enumerated-value",
  "value-bound",
];

/**
 * The classifier, committed in source before the corpus was counted.
 *
 * Every pattern here was written by reading the corpus's distinct refusal
 * strings, and every class it names occurs in that corpus at least once. Changing
 * a line changes the finding; that is why it is one object rather than constants
 * scattered through the reader, and why the test beside this file asserts its
 * shape as well as its output.
 */
export const REFUSAL_RULE = {
  /** The bar the assumption test fixed before anyone counted. */
  bar: 0.6,

  /**
   * The reading `meetsBar` is taken on: the widest one that can still come out
   * false. `any-prose` cannot, so it must not decide anything.
   */
  verdictReading: "argument-decidable" as ReadingName,

  /**
   * The classes, in match order — first match wins, so a message carrying two
   * shapes is counted once.
   */
  classes: [
    // ── the harness's own handshakes: the top of the corpus by a wide margin ──
    {
      id: "read-before-write",
      precondition: "This file must have been Read in this session before it can be written.",
      match: /File has not been read yet/i,
      decidableFrom: "session-history",
      namedBy: ["stated-precondition"],
    },
    {
      id: "stale-read",
      precondition: "The file moved since you read it; read it again before writing.",
      match: /has been modified since read/i,
      decidableFrom: "session-history",
      namedBy: ["stated-precondition"],
    },
    {
      id: "wrong-worktree",
      precondition: "This session is pinned to a worktree and the command addressed outside it.",
      match: /is isolated in the worktree/i,
      decidableFrom: "session-history",
      namedBy: ["stated-precondition"],
    },

    // ── grants: what the user has said yes to, which no schema holds ──────────
    {
      id: "tool-not-granted",
      precondition: "This tool needs a permission grant the run does not have yet.",
      match: /requested permissions to use /i,
      decidableFrom: "grant-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "path-not-granted",
      precondition: "This path needs a read/edit grant the run does not have yet.",
      match: /requested permissions to (?:read from|edit|write)/i,
      decidableFrom: "grant-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "sensitive-file",
      precondition: "Some paths are sensitive and are refused whatever the grant.",
      match: /which is a sensitive file/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },

    // ── the argument itself: the only place a keyword can reach ───────────────
    {
      id: "closed-parameter-set",
      precondition: "The parameter set is closed; an unlisted parameter is refused.",
      match: /an unexpected parameter/i,
      decidableFrom: "arguments",
      namedBy: ["closed-parameter-set"],
    },
    {
      id: "output-schema-violation",
      precondition: "The structured body must satisfy the declared schema exactly.",
      match: /does not match required schema/i,
      decidableFrom: "arguments",
      namedBy: ["closed-parameter-set", "required-parameter", "enumerated-value", "value-bound"],
    },
    {
      id: "malformed-body",
      precondition: "The arguments must be parseable JSON.",
      match: /could not be parsed as JSON/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },
    {
      id: "argument-content-rejected",
      precondition: "Some byte sequences are refused inside an argument whatever it means.",
      match: /contains control characters/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },
    {
      id: "blocked-command-form",
      precondition: "Some command forms are blocked and a permitted form is named instead.",
      match: /^<tool_use_error>Blocked: /,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },
    {
      id: "script-parse-error",
      precondition: "The script argument must parse as plain JavaScript.",
      match: /Script parse error/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },
    {
      id: "malformed-argument",
      precondition: "The pattern or glob must be valid in the engine that runs it.",
      match: /error parsing glob|rejected the pattern, glob, or file type/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },
    {
      id: "no-op-edit",
      precondition: "An edit whose two strings are identical is refused.",
      match: /old_string and new_string are exactly the same/i,
      decidableFrom: "arguments",
      namedBy: ["stated-precondition"],
    },

    // ── the world the call lands in ───────────────────────────────────────────
    {
      id: "response-size-cap",
      precondition: "A response above a size cap is refused; the size is only knowable by asking.",
      match: /exceeds maximum allowed tokens|exceeds (?:the )?maximum length|exceeds the response limit/i,
      decidableFrom: "response-size",
      namedBy: ["stated-precondition"],
    },
    {
      id: "evidence-rung-ceiling",
      precondition: "The declared evidence rung is capped by what the cited sources have earned.",
      match: /cannot declare '/,
      decidableFrom: "vault-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "missing-config",
      precondition: "The capability must be configured before the tool that uses it will run.",
      match: /no product repos configured|is not configured —/i,
      decidableFrom: "vault-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "missing-path",
      precondition: "The path has to exist when the call is made.",
      match: /Path does not exist|File does not exist/i,
      decidableFrom: "filesystem-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "stale-anchor",
      precondition: "The anchor string has to still be in the file as written.",
      match: /String to replace not found/i,
      decidableFrom: "filesystem-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "ambiguous-anchor",
      precondition: "The anchor string has to be unique unless replace_all is set.",
      match: /matches of the string to replace, but replace_all is false/i,
      decidableFrom: "filesystem-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "cwd-deleted",
      precondition: "The working directory has to still exist when the command runs.",
      match: /was deleted; shell cwd recovered/i,
      decidableFrom: "filesystem-state",
      namedBy: ["stated-precondition"],
    },
    {
      id: "destructive-confirmation",
      precondition: "An irreversible action needs a confirmation flag the first call cannot know it needs.",
      match: /Confirm with the user, then re-invoke/i,
      decidableFrom: "filesystem-state",
      namedBy: ["stated-precondition"],
    },

    // ── the schema that was there and said the wrong thing ────────────────────
    {
      // The sharpest case against the idea in the whole corpus, and it is one
      // call. The schema for this tool holds `environment_id` and holds it as
      // OPTIONAL, because the server will infer it from whatever the caller has
      // linked. A manifest folded from that schema states, correctly, that the
      // parameter may be omitted — and the call is refused for omitting it. The
      // generated line is not merely absent here; it is actively wrong, which is
      // a worse failure than silence and is not one more prose sentence fixes.
      id: "conditionally-required-parameter",
      precondition: "A parameter the schema marks optional is required unless remote state supplies it.",
      match: /No \w+_id provided and no linked/i,
      decidableFrom: "remote-state",
      namedBy: ["stated-precondition"],
    },

    // ── the surface this process was started with ─────────────────────────────
    {
      id: "tool-not-available",
      precondition: "The tool exists but is not enabled in this context.",
      match: /No such tool available/i,
      decidableFrom: "installed-surface",
      namedBy: ["stated-precondition"],
    },
    {
      id: "schema-not-discovered",
      precondition: "The tool's schema must be fetched before it can be called.",
      match: /schema was not sent to the API/i,
      decidableFrom: "installed-surface",
      namedBy: ["stated-precondition"],
    },
    {
      id: "unknown-skill",
      precondition: "The named skill has to be installed.",
      match: /Unknown skill:/i,
      decidableFrom: "installed-surface",
      namedBy: ["stated-precondition"],
    },
  ] as readonly RefusalClassSpec[],

  /**
   * Failures that are not tool preconditions, excluded before any class is
   * tested and published as counts rather than defended.
   *
   * The first is by far the largest population in the corpus, and letting it in
   * would not be a rounding error — it would be the finding. A program exiting
   * non-zero is the program's answer to its own arguments; nothing about it was
   * knowable-in-advance-by-manifest, and it is not a rule the surface enforces.
   */
  consideredAndExcluded: [
    {
      name: "subprocess-failure",
      why: "a program's own exit code, not a tool refusing a precondition",
      match: /^Exit code /,
    },
    {
      name: "user-declined",
      why: "a human saying no to a specific call; not a rule that exists before the call",
      match: /user (?:doesn't want|rejected|denied)|The tool use was rejected/i,
    },
    {
      name: "remote-failure",
      why: "a network or remote service answering badly; the precondition is the remote's, not the tool's",
      match: /failed with HTTP \d|ENOTFOUND|aborted due to timeout|^API Error: /i,
    },
  ] as readonly { name: string; why: string; match: RegExp }[],

  /**
   * The three readings, widest last. Monotone: each admits everything the one
   * before it did.
   */
  readings: [
    { name: "keyword", admits: "a schema keyword the generated manifest actually emits" },
    { name: "argument-decidable", admits: "…plus rules that turn only on the call's own arguments" },
    { name: "any-prose", admits: "…plus every remaining rule, if a human writes it into the description" },
  ] as readonly { name: ReadingName; admits: string }[],
} as const;

export interface ClassifiedRefusal {
  cls: string;
  /** Bare tool names this class was refused by, deduped and sorted. */
  tools: string[];
  occurrences: number;
}

export interface CoverageReading {
  name: ReadingName;
  named: string[];
  unnamed: string[];
  share: number;
  /** Share weighted by how often each class actually bit. */
  weightedShare: number;
  meetsBar: boolean;
  /** True when this reading cannot come out below the bar, so it settles nothing. */
  vacuous: boolean;
}

export interface RefusalCensus {
  /** Every failing call read, before any exclusion. */
  failures: number;
  /** Failures dropped by {@link REFUSAL_RULE.consideredAndExcluded}, by rule name. */
  excluded: { name: string; why: string; count: number }[];
  /** Failures that matched no class and no exclusion — the census's own blind spot. */
  unclassified: number;
  /** Distinct classes the corpus actually exercised. */
  classes: ClassifiedRefusal[];
  /** Classes refused by a tool whose schema this repository holds. Reported before any share. */
  reach: { inReach: string[]; outOfReach: string[]; share: number };
  readings: CoverageReading[];
  /** The reading `meetsBar` is taken on — the widest that can still come out false. */
  verdict: CoverageReading;
  /** Convenience mirror of `verdict.meetsBar`, asserted by name wherever this is read. */
  meetsBar: boolean;
}

/** Which class this refusal is, or null when it is not a precondition at all. */
export function classifyRefusal(error: string): string | null {
  if (REFUSAL_RULE.consideredAndExcluded.some((e) => e.match.test(error))) return null;
  return REFUSAL_RULE.classes.find((c) => c.match.test(error))?.id ?? null;
}

function specOf(id: string): RefusalClassSpec {
  const spec = REFUSAL_RULE.classes.find((c) => c.id === id);
  if (!spec) throw new Error(`unknown refusal class: ${id}`);
  return spec;
}

/**
 * Take the census: every failing call in `failures`, against the manifest
 * `manifest` folded out of whatever schemas the caller supplied.
 *
 * Both inputs are passed in rather than read from disk, for the reason every
 * census in this repository does it: a reading that goes and finds its own input
 * is one nobody can re-point at a different surface to check what it would have
 * said.
 */
export function refusalCoverageCensus(
  failures: readonly FailingCall[],
  manifest: PreflightManifest,
): RefusalCensus {
  const excludedCounts = new Map<string, number>();
  const byClass = new Map<string, { tools: Set<string>; occurrences: number }>();
  let unclassified = 0;

  for (const failure of failures) {
    const exclusion = REFUSAL_RULE.consideredAndExcluded.find((e) => e.match.test(failure.error));
    if (exclusion) {
      excludedCounts.set(exclusion.name, (excludedCounts.get(exclusion.name) ?? 0) + 1);
      continue;
    }
    const cls = REFUSAL_RULE.classes.find((c) => c.match.test(failure.error))?.id;
    if (!cls) {
      unclassified++;
      continue;
    }
    const entry = byClass.get(cls) ?? { tools: new Set<string>(), occurrences: 0 };
    if (failure.tool) entry.tools.add(bareToolName(failure.tool));
    entry.occurrences++;
    byClass.set(cls, entry);
  }

  // Class order follows REFUSAL_RULE, not the corpus, so two runs over different
  // corpora are read side by side.
  const classes: ClassifiedRefusal[] = REFUSAL_RULE.classes
    .filter((c) => byClass.has(c.id))
    .map((c) => {
      const entry = byClass.get(c.id)!;
      return { cls: c.id, tools: [...entry.tools].sort(), occurrences: entry.occurrences };
    });

  const held = manifestTools(manifest);
  const inReach = classes.filter((c) => c.tools.some((t) => held.has(t))).map((c) => c.cls);
  const outOfReach = classes.filter((c) => !inReach.includes(c.cls)).map((c) => c.cls);

  /** Does the generated manifest carry a keyword rule for a tool this class bit? */
  const keywordNamed = (c: ClassifiedRefusal): boolean => {
    const kinds = specOf(c.cls).namedBy.filter((k) => KEYWORD_KINDS.includes(k));
    return kinds.some((kind) => c.tools.some((tool) => manifestNames(manifest, tool, kind)));
  };

  const total = classes.length;
  const totalOccurrences = classes.reduce((n, c) => n + c.occurrences, 0);
  const admits: Record<ReadingName, (c: ClassifiedRefusal) => boolean> = {
    keyword: keywordNamed,
    "argument-decidable": (c) => keywordNamed(c) || specOf(c.cls).decidableFrom === "arguments",
    "any-prose": () => true,
  };

  const readings: CoverageReading[] = REFUSAL_RULE.readings.map((reading) => {
    const named = classes.filter(admits[reading.name]);
    const unnamed = classes.filter((c) => !named.includes(c));
    const share = total ? named.length / total : 0;
    return {
      name: reading.name,
      named: named.map((c) => c.cls),
      unnamed: unnamed.map((c) => c.cls),
      share,
      weightedShare: totalOccurrences
        ? named.reduce((n, c) => n + c.occurrences, 0) / totalOccurrences
        : 0,
      meetsBar: share >= REFUSAL_RULE.bar,
      vacuous: unnamed.length === 0 && named.length === total,
    };
  });

  const verdict = readings.find((r) => r.name === REFUSAL_RULE.verdictReading)!;

  return {
    failures: failures.length,
    excluded: REFUSAL_RULE.consideredAndExcluded.map((e) => ({
      name: e.name,
      why: e.why,
      count: excludedCounts.get(e.name) ?? 0,
    })),
    unclassified,
    classes,
    reach: { inReach, outOfReach, share: total ? inReach.length / total : 0 },
    readings,
    verdict,
    meetsBar: verdict.meetsBar,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: reach first, then the verdict, then the
 * classes that carry the weight.
 */
export function formatRefusalCoverageCensus(census: RefusalCensus): string {
  const lines: string[] = [];
  const total = census.classes.length;

  if (total === 0) {
    lines.push(
      `Refusal coverage: UNREAD — ${census.failures} failing call(s) read and not one of them is a ` +
        "tool precondition this census recognises. No share can be taken.",
    );
    return lines.join("\n");
  }

  lines.push(
    `Reach: ${census.reach.inReach.length} of ${total} refusal class(es) (${pct(census.reach.share)}) were ` +
      "refused by a tool whose schema this repository holds. The rest are outside any generator running here, " +
      "whatever a schema could express in principle.",
  );
  lines.push(
    `Coverage: ${census.verdict.named.length} of ${total} class(es) (${pct(census.verdict.share)}) could have ` +
      `been named by a schema-derived manifest, against a bar of ${pct(REFUSAL_RULE.bar)} — ` +
      `${census.meetsBar ? "MET" : "REFUTED"}. Weighted by how often each class actually bit: ` +
      `${pct(census.verdict.weightedShare)} of ${census.classes.reduce((n, c) => n + c.occurrences, 0)} refusals.`,
  );
  lines.push(`  (the verdict is taken on the '${census.verdict.name}' reading — the widest that can come out false)`);
  lines.push("");

  lines.push("Readings, widest last:");
  for (const reading of census.readings) {
    lines.push(
      `  ${reading.name}: ${reading.named.length}/${total} (${pct(reading.share)}), ` +
        `weighted ${pct(reading.weightedShare)}` +
        (reading.vacuous ? " — VACUOUS: admits every class, so it settles nothing" : ""),
    );
  }
  lines.push("");

  lines.push("Classes, by how often they bit:");
  for (const c of [...census.classes].sort((a, b) => b.occurrences - a.occurrences)) {
    const spec = REFUSAL_RULE.classes.find((s) => s.id === c.cls)!;
    const named = census.verdict.named.includes(c.cls) ? "nameable" : "NOT NAMEABLE";
    lines.push(`  ${c.cls} ×${c.occurrences} [${named}; turns on ${spec.decidableFrom}] — ${spec.precondition}`);
    lines.push(`      refused by: ${c.tools.join(", ") || "(unpaired call)"}`);
  }
  lines.push("");

  lines.push("Excluded before any class was tested:");
  for (const e of census.excluded) lines.push(`  ${e.name} ×${e.count} — ${e.why}`);
  lines.push(
    `  unclassified ×${census.unclassified} — matched no class and no exclusion; the census's own blind spot.`,
  );

  lines.push("");
  lines.push(
    "What this does not settle: whether a run that RECEIVES a manifest composes fewer colliding calls. " +
      "This counts what a manifest could carry, never what a caller does with one — and this project already " +
      "ships a partial instance of the idea, the corrections header in the unattended prompt, that sessions " +
      "kept hitting refusals around.",
  );
  return lines.join("\n");
}
