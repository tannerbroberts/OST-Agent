/**
 * The failure-context census: would a snapshot of four fields have explained the
 * failures this vault actually recorded?
 *
 * The solution under test is "Snapshot the resolved environment, but only for the
 * step that failed" — when a step exits non-zero, capture the working directory,
 * the resolved argv, the tool versions on `PATH` and the git SHA, and attach them
 * to that record. The assumption test beneath it runs *before* the snapshot is
 * built and is allowed to stop it: **at least 7 of the 10 most recent recorded
 * failures must be fully explained by those four fields alone.** Below 7 the node
 * itself says the honest response is to widen the fields or prefer the sibling
 * that re-runs the failure instead of predicting what will matter.
 *
 * This module is the rule. It is committed with the bar the node fixed, the field
 * set the node named, and the two evidence channels below — before any number was
 * read off the corpus it scores.
 *
 * ## The two channels, and why one is not enough
 *
 * Asking "would these four fields have explained it" is a counterfactual, and a
 * counterfactual scored by whoever wants the answer is not evidence. So it is
 * scored from the record, twice, by two mechanisms that can disagree:
 *
 * - **Termination.** What the failing process last said. `claude -p` writes its
 *   terminating condition into the session transcript as an API-error entry; a
 *   shell step writes it to stderr. {@link classifyTermination} maps that text to
 *   an {@link ExplanationClass}, and each class declares once, here, whether the
 *   thing it names is inside the four fields or outside them.
 * - **The corrected re-run.** The same command run again soon after and passing,
 *   with the delta between the two attempts read off the record. This is the
 *   stronger channel, because it does not ask what *would* have explained the
 *   failure — it shows which field actually differed between an attempt that
 *   failed and an attempt that passed. {@link rerunDelta} computes it.
 *
 * The channels are kept separate rather than merged into one score because they
 * fail differently. Termination text can name a cause the fields would have
 * carried without proving the field actually differed; a corrected re-run proves
 * the difference but only exists when somebody re-ran the thing. A failure the
 * termination channel calls field-explained and the re-run channel does not
 * corroborate is {@link Coverage} `partly`, never `explained` — the node asks for
 * *fully* explained, and one channel is not full.
 *
 * ## Why `unread` is a verdict and not a zero
 *
 * A failure whose terminating record did not survive is `unread`. It is never
 * counted as explained and never counted as refuting: a sweep that cannot read its
 * subject must not report a clean result in either direction, which is a sibling
 * opportunity in this tree by name. {@link readCensus} returns `undecidable`
 * rather than `refuted` whenever the unread set is large enough that it could
 * still carry the bar.
 *
 * ## Discriminability, which is the reading the node's own trade-off asks for
 *
 * The node states its worst case in its own words: *a flaky step is the hardest
 * case and this handles it worst — you get a snapshot of the failing attempt but
 * nothing to diff it against, because the passing run recorded nothing.* That is
 * checkable rather than rhetorical. {@link discriminate} takes the failing steps
 * and the *successful* steps of the same phase and asks, per field, whether the
 * field's value on the failures is one the successes never took. A field whose
 * value is identical on every pass and every fail cannot be the explanation of
 * anything, however faithfully it is snapshotted.
 *
 * It also names the opposite trap. A field that takes a fresh value on every
 * single step — a git SHA over a ledger where no two runs share a commit —
 * separates every run from every other run and therefore separates nothing. That
 * is reported as `uninformative`, not as `discriminates`, because a census that
 * counted per-run uniqueness as explanatory power would report the git SHA
 * carrying every failure in any ledger at all.
 */

/** The four fields the threshold names. Not the five the solution's prose lists:
 * the environment variables the step read and the dirty-file count are the
 * solution's, and the assumption test scores the four it fixed. Scoring a wider
 * set than the bar was written against is how a breached bar gets rescued. */
export const SNAPSHOT_FIELDS = ["cwd", "argv", "toolVersions", "gitSha"] as const;
export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number];

/**
 * The rule, in the numbers the assumption test fixed before anybody counted.
 *
 * `sample` and `bar` are quoted from the node's threshold verbatim — "at least 7
 * of the 10 most recent recorded failures". They are asserted against that
 * wording in the spec so a later edit here has to argue with the node.
 */
export const FAILURE_CONTEXT_RULE = {
  /** How many of the most recent recorded failures are scored. */
  sample: 10,
  /** How many of them must come out fully explained. */
  bar: 7,
  fields: SNAPSHOT_FIELDS,
} as const;

/**
 * What actually explained a failure, and — decided once, here — whether the four
 * fields would have carried it.
 *
 * `within` is the whole judgement of this census, so it lives on the class rather
 * than in a scoring function where a later reader could not see it. Four classes
 * are inside the snapshot because each names a property *of the invocation*: where
 * it ran, what was run, which binaries served it, which revision of the source it
 * ran against. Three are outside because each names a property of something the
 * invocation does not carry — the machine underneath it, the service above it, or
 * the account paying for it — and a snapshot of the invocation is the same on the
 * attempt that failed and the attempt that passed.
 */
export const EXPLANATION_CLASSES = {
  /** The command ran somewhere it should not have. Carried by `cwd`. */
  "wrong-place": { field: "cwd", within: true },
  /** The command itself was wrong — a flag, a missing argument. Carried by `argv`. */
  "wrong-command": { field: "argv", within: true },
  /** A binary was absent or the wrong version. Carried by `toolVersions`. */
  toolchain: { field: "toolVersions", within: true },
  /** The source at that revision was broken. Carried by `gitSha`. */
  revision: { field: "gitSha", within: true },
  /** The machine underneath: suspended, out of memory, out of disk. */
  host: { field: null, within: false },
  /** A remote service: 5xx, overloaded, connection reset. */
  upstream: { field: null, within: false },
  /** The account: a rate limit, a usage cap, an expired credential. */
  quota: { field: null, within: false },
} as const satisfies Record<string, { field: SnapshotField | null; within: boolean }>;

export type ExplanationClass = keyof typeof EXPLANATION_CLASSES;

/** The classes the snapshot would carry. Derived, never listed twice. */
export function fieldExplainedClasses(): ExplanationClass[] {
  return (Object.keys(EXPLANATION_CLASSES) as ExplanationClass[]).filter((c) => EXPLANATION_CLASSES[c].within);
}

/**
 * The patterns, most specific first.
 *
 * Order is load-bearing and the reason this is an array rather than an object: an
 * out-of-memory kill says "Killed" and a missing binary says "not found", and a
 * looser pattern placed first would swallow a stricter one. Every entry is
 * anchored on a string some record in this repository's corpora actually
 * contains, or on the standard text of a failure mode the corpora do not happen
 * to hold — marked as such, so a reader can tell a pattern that has fired from
 * one that has not.
 */
const TERMINATION_PATTERNS: ReadonlyArray<{ re: RegExp; class: ExplanationClass; seen: boolean }> = [
  // Observed verbatim in this vault's transcripts, 7 of the current 10.
  { re: /your computer went to sleep/i, class: "host", seen: true },
  { re: /\b(out of memory|Killed: 9|ENOSPC|no space left on device)\b/i, class: "host", seen: false },
  // Observed verbatim: "You've hit your weekly limit · resets 5pm".
  { re: /hit your \w+ limit|usage limit reached|rate limit|\b429\b/i, class: "quota", seen: true },
  { re: /invalid api key|authentication_error|credit balance is too low/i, class: "quota", seen: false },
  // Observed verbatim: "API Error: 529 Overloaded".
  { re: /\bAPI Error: 5\d\d\b|\bOverloaded\b|\bConnection error\b|\bECONNRESET\b|\bETIMEDOUT\b/i, class: "upstream", seen: true },
  // The founding case's shape: a relative import resolved against the wrong directory.
  { re: /Cannot find module '\.[^']*'|\bENOENT\b|no such file or directory|not a git repository/i, class: "wrong-place", seen: true },
  { re: /command not found|: not found\b|unsupported engine|requires Node/i, class: "toolchain", seen: false },
  { re: /unknown option|unrecognized (option|argument)|^usage:/im, class: "wrong-command", seen: false },
];

/** Which patterns have fired on a real record, for the spec to hold the comment above honest. */
export const OBSERVED_TERMINATION_CLASSES: ReadonlySet<ExplanationClass> = new Set(
  TERMINATION_PATTERNS.filter((p) => p.seen).map((p) => p.class),
);

/**
 * The class of a terminating record, or `null` when nothing matches.
 *
 * `null` is not "no cause". It is "this text does not say", and it leaves the
 * failure to the other channel or to `unread`. Guessing a class from an
 * unrecognised string is how a census invents its own corpus.
 */
export function classifyTermination(text: string | null | undefined): ExplanationClass | null {
  if (typeof text !== "string" || text.trim().length === 0) return null;
  for (const p of TERMINATION_PATTERNS) if (p.re.test(text)) return p.class;
  return null;
}

/** One failure, with whatever survived of why it failed. */
export interface LabelledFailure {
  /** The step's own recorded timestamp — the join key and the way to find it by hand. */
  at: string;
  phase: string;
  exit: number;
  durationMs: number;
  /** As recorded. Absent on a record written before the field existed. */
  cwd?: string;
  argv?: readonly string[];
  command: string;
  /** The run's `headBefore` — the only git SHA any record in this repo carries today. */
  gitSha?: string;
  /** What the failing process last said, when a record of it survived. */
  termination?: { session: string; ts: string; text: string };
  /** The same command re-run and passing, with what differed. */
  rerun?: RerunDelta;
}

/** A later step that ran the same payload and passed, and which snapshot fields differed. */
export interface RerunDelta {
  at: string;
  command: string;
  /** Empty means the same invocation passed unchanged — proof the fields did not explain it. */
  changed: SnapshotField[];
}

export type Coverage = "explained" | "partly" | "not-explained" | "unread";

export interface FailureReading {
  failure: LabelledFailure;
  coverage: Coverage;
  class: ExplanationClass | null;
  /** Which channels spoke. Both, one, or neither. */
  via: ("termination" | "corrected-rerun")[];
  /** One line a person can check the verdict against without opening the ledger. */
  because: string;
}

/**
 * Score one failure.
 *
 * The corrected re-run outranks the termination text when both are present and
 * they disagree, because it is the only one of the two that observed a field
 * actually differing. When only the termination text speaks and it names a field
 * class, the result is `partly`: the text says a snapshot field is the kind of
 * thing that broke, and nothing showed the field's value was different on the
 * attempt that worked.
 */
export function readFailure(failure: LabelledFailure): FailureReading {
  const fromText = classifyTermination(failure.termination?.text);
  const via: ("termination" | "corrected-rerun")[] = [];
  if (failure.termination) via.push("termination");
  if (failure.rerun) via.push("corrected-rerun");

  if (failure.rerun && failure.rerun.changed.length > 0) {
    const field = failure.rerun.changed[0];
    const cls = (fieldExplainedClasses().find((c) => EXPLANATION_CLASSES[c].field === field) ?? null) as ExplanationClass | null;
    return {
      failure,
      coverage: "explained",
      class: cls,
      via,
      because: `re-run passed with ${failure.rerun.changed.join(", ")} changed — the field differed between the attempt that failed and the attempt that worked`,
    };
  }

  if (fromText && EXPLANATION_CLASSES[fromText].within) {
    // One channel. The text names a field class; nothing corroborated that the
    // field's value was different when it worked.
    return {
      failure,
      coverage: failure.rerun ? "not-explained" : "partly",
      class: fromText,
      via,
      because: failure.rerun
        ? `terminating record reads ${fromText}, but the re-run passed with no snapshot field changed`
        : `terminating record reads ${fromText}, uncorroborated by a corrected re-run`,
    };
  }

  if (fromText) {
    return {
      failure,
      coverage: "not-explained",
      class: fromText,
      via,
      because: `terminating record reads ${fromText}, which no snapshot field carries`,
    };
  }

  if (failure.rerun) {
    return {
      failure,
      coverage: "not-explained",
      class: null,
      via,
      because: "the same invocation passed on re-run with no snapshot field changed",
    };
  }

  return { failure, coverage: "unread", class: null, via, because: "no terminating record and no corrected re-run survived" };
}

export type FieldVerdict = "not-recorded" | "cannot-discriminate" | "uninformative" | "discriminates";

export interface FieldDiscrimination {
  field: SnapshotField;
  /** Distinct values the field took on the failing steps. */
  onFailures: number;
  /** Distinct values it took on the successful steps of the same phase. */
  onSuccesses: number;
  /** Failing values a successful step also took. */
  shared: number;
  verdict: FieldVerdict;
}

/** A step reduced to the snapshot fields it actually carries. `null` = not recorded. */
export type FieldValues = Readonly<Record<SnapshotField, string | null>>;

/**
 * Per field: could its value have told a failure from a success?
 *
 * `uninformative` fires when the field's values are all but unique across the
 * steps it was read over — a field that never repeats separates every step from
 * every other step, so "the failing steps' values never appear on a success" is a
 * statement about the field's cardinality rather than about the failures. The
 * threshold is deliberately generous to the solution: a field is only called
 * uninformative when *nothing* repeats on either side.
 */
export function discriminate(failures: readonly FieldValues[], successes: readonly FieldValues[]): FieldDiscrimination[] {
  return SNAPSHOT_FIELDS.map((field) => {
    const fVals = failures.map((f) => f[field]).filter((v): v is string => v !== null);
    const sVals = successes.map((s) => s[field]).filter((v): v is string => v !== null);
    const fSet = new Set(fVals);
    const sSet = new Set(sVals);
    const shared = [...fSet].filter((v) => sSet.has(v)).length;

    let verdict: FieldVerdict;
    if (fVals.length === 0) verdict = "not-recorded";
    else if (shared === fSet.size) verdict = "cannot-discriminate";
    else if (fSet.size === fVals.length && sSet.size === sVals.length && fVals.length + sVals.length > 1) verdict = "uninformative";
    else verdict = "discriminates";

    return { field, onFailures: fSet.size, onSuccesses: sSet.size, shared, verdict };
  });
}

export interface FailureContextCensus {
  /** How many failures were scored. The honest denominator, before any share. */
  scored: number;
  readings: FailureReading[];
  explained: number;
  partly: number;
  notExplained: number;
  unread: number;
  fields: FieldDiscrimination[];
}

export function failureContextCensus(
  failures: readonly LabelledFailure[],
  failureFields: readonly FieldValues[],
  successFields: readonly FieldValues[],
): FailureContextCensus {
  const readings = failures.map(readFailure);
  return {
    scored: readings.length,
    readings,
    explained: readings.filter((r) => r.coverage === "explained").length,
    partly: readings.filter((r) => r.coverage === "partly").length,
    notExplained: readings.filter((r) => r.coverage === "not-explained").length,
    unread: readings.filter((r) => r.coverage === "unread").length,
    fields: discriminate(failureFields, successFields),
  };
}

export type CensusVerdict = "cleared" | "refuted" | "undecidable";

export interface CensusReading {
  verdict: CensusVerdict;
  /** Only `explained` counts. The node asks for *fully* explained. */
  strict: number;
  /** `explained + partly` — the most generous reading available, published so the
   * verdict cannot be mistaken for an artefact of the strict one. */
  generous: number;
  bar: number;
  sample: number;
  why: string;
}

/**
 * The verdict, derived from the node's rule rather than from a friendlier one.
 *
 * `undecidable` exists because unsettled evidence can rescue a low count, and it
 * comes in two forms. A failure nobody could read is unsettled because the record
 * is gone; a `partly` is unsettled because one channel named a snapshot field and
 * the other never spoke. If those two together could still reach the bar, the
 * corpus has not refuted anything. Only the failures positively explained by
 * something outside the snapshot count against the assumption.
 */
export function readCensus(census: FailureContextCensus, rule = FAILURE_CONTEXT_RULE): CensusReading {
  const { bar, sample } = rule;
  const strict = census.explained;
  const generous = census.explained + census.partly;
  const base = { strict, generous, bar, sample };

  if (census.scored === 0) {
    return { ...base, verdict: "undecidable", why: "no failures were scored — there is nothing to read" };
  }
  if (census.scored < sample) {
    // A bar of "7 of the 10 most recent" cannot be failed by a corpus that does
    // not hold ten. Without this, the control corpus — two failures, both fully
    // explained — would report `refuted`, and a short cut would be a way to
    // manufacture a refutation out of nothing.
    return {
      ...base,
      verdict: "undecidable",
      why: `${strict} of ${census.scored} fully explained, but the bar is ${bar} of ${sample} and this corpus holds ${census.scored}`,
    };
  }
  if (strict >= bar) {
    return { ...base, verdict: "cleared", why: `${strict} of ${census.scored} fully explained, against a bar of ${bar}` };
  }
  if (generous + census.unread >= bar) {
    return {
      ...base,
      verdict: "undecidable",
      why:
        `${strict} fully explained and ${census.partly} partly, but ${census.unread} could not be read — ` +
        `the unread set is large enough to still carry the bar of ${bar}`,
    };
  }
  return {
    ...base,
    verdict: "refuted",
    why:
      `${strict} of ${census.scored} fully explained (${generous} on the most generous reading, ` +
      `${census.unread} unread), against a bar of ${bar} — the unread set cannot reach it`,
  };
}

/**
 * The census as an operator reads it: coverage first, then the count, then the
 * failures by name.
 *
 * Coverage leads for the reason every census in this repository leads with it — a
 * share over a denominator the reader has not seen is the shape of a confident
 * wrong finding.
 */
export function formatFailureContextCensus(label: string, census: FailureContextCensus, reading: CensusReading): string {
  const lines: string[] = [];
  lines.push(`Failure-context coverage — ${label}: ${reading.verdict.toUpperCase()}`);
  lines.push(`  ${reading.why}`);
  lines.push(
    `  scored ${census.scored}: ${census.explained} explained, ${census.partly} partly, ` +
      `${census.notExplained} not explained, ${census.unread} unread`,
  );
  lines.push(`  fields (${FAILURE_CONTEXT_RULE.fields.join(", ")}):`);
  for (const f of census.fields) {
    lines.push(`    ${f.field}: ${f.verdict} — ${f.onFailures} distinct on failures, ${f.onSuccesses} on successes, ${f.shared} shared`);
  }
  lines.push("  failures, newest first:");
  for (const r of census.readings) {
    lines.push(`    ${r.failure.at} ${r.failure.phase} exit ${r.failure.exit} — ${r.coverage}${r.class ? ` (${r.class})` : ""}: ${r.because}`);
  }
  return lines.join("\n");
}
