/**
 * The safe-form coverage census: if the tool surface offered a small set of
 * first-class forms, how much of what callers actually wrote would they have
 * expressed?
 *
 * The candidate this measures: "The tool surface offers the correct form so
 * prominently that the failing form is not reached for" — rather than teaching
 * the caller to write shell correctly, give them something that does not
 * require it. A comparison, a wait, a glob, a multi-line string, a pipeline:
 * each gets a way to be expressed that cannot be got wrong by quoting, and that
 * way is what the surface presents.
 *
 * The assumption beneath it is coverage, and the assumption test fixed two bars
 * before anything was counted: **the safe forms fully express at least 60% of
 * all harvested commands, and at least 80% of the failing ones.** The two are
 * weighted separately on purpose. Covering most commands while missing most
 * *failures* would be a set that is popular and useless, and a single blended
 * number would hide it — a caller whose case the forms miss falls back to the
 * form that fails, having now paid for both.
 *
 * ## The set is named here, before the corpus is read
 *
 * {@link SAFE_FORM_RULE} fixes which forms exist and which shell ingredient
 * each one absorbs. That ordering is the whole defence against the obvious way
 * to cheat this measurement, which is to keep adding forms until the number
 * clears the bar: a set chosen after seeing which ingredients are common scores
 * against the sample it was fitted to and looks identical to one that was not.
 * This module imports no `fs` and names no fixture, so it structurally cannot
 * read what it is scored against.
 *
 * The set has **six** forms where the assumption test's design names five
 * ("comparison, wait, glob, multi-line text, pipeline") and licenses "five or
 * six". The sixth is `sequence`, and it is here because the sibling census in
 * `test/runner/shell-necessity-census.test.ts` already measured `sequence` as
 * the single most common shell feature in this machine's record — 9,970 of
 * 14,608 readable invocations. A candidate set that cannot express "do this,
 * then that" is not a candidate anybody would ship, and leaving it out to keep
 * the count at five would be choosing the number in the naming.
 *
 * ## What a form may absorb, and what it may not
 *
 * The refusals carry the weight, and they are all in one direction: an
 * ingredient that depends on *evaluation* is not expressible as a form, because
 * a form is a structure the caller fills in and evaluation is a shell running.
 * `$(…)`, `$VAR`, a subshell, a background `&`, and every control-flow word
 * except the polling loop `wait` names are counted uncovered however common
 * they are. That is where this census can be wrong, and the direction it would
 * be wrong in is understatement.
 *
 * Two scalar *fields* on the base command form are treated as covered, and both
 * are reported separately so a stricter reader can subtract them:
 *
 * - **A working directory.** `cd <dir> && <cmd>` is the harness's own idiom —
 *   the shell's directory resets between calls — and "run this in that
 *   directory" is a field, not a shell feature. {@link SafeFormCensus.cwdOnlyInvocations}
 *   counts every invocation that needed this and nothing else.
 * - **Environment.** A leading `VAR=value` prefix is an `env` field for the same
 *   reason. Counted in {@link SafeFormCensus.envFieldInvocations}.
 *
 * ## What a count out of this cannot settle
 *
 * The corpus is commands **as written by callers who had only a shell**. What a
 * caller would write with better forms available is not visible in it at all,
 * so high coverage of past commands is weak evidence about future ones — and
 * low coverage is the more trustworthy result of the two, because it says the
 * forms miss cases that were reached for even under a shell's own idioms.
 */
import { classifyShellNecessity, SHELL_NECESSITY_RULE, type ShellFeature } from "../runner/shell-necessity.js";
import type { TranscriptSession } from "../telemetry/preflight.js";
import { shellWords, SHELL_OPERATORS } from "../telemetry/shell.js";

/**
 * One first-class affordance the surface would offer in place of a shell string.
 *
 * `command` is not one of the candidate forms — it is the substrate every other
 * form is built out of, a program and its arguments with no string for a shell
 * to reinterpret. It is named here so a command that needs no form at all has
 * somewhere to land.
 */
export type SafeForm =
  | "command" // program + argv, with a working directory and an environment
  | "comparison" // a predicate — equality, ordering, a file test — evaluated without a shell
  | "wait" // repeat a check until it holds, or hold for a duration
  | "glob" // a pattern matched against a root, with stated no-match behaviour
  | "text" // literal multi-line text handed to a file or to a program's stdin
  | "pipeline" // ordered stages, plumbed, with stdout/stderr destinations
  | "sequence"; // ordered steps with an and-then / or-else policy

/** Where one recorded command lands against the candidate set. */
export type SafeFormVerdict =
  | "full" // every ingredient is expressible in the forms
  | "partial" // some are, at least one is not
  | "none" // nothing is; this command is shell all the way down
  | "unreadable"; // unbalanced quoting — counted neither way

export interface SafeFormClassification {
  verdict: SafeFormVerdict;
  /** The forms this command would be written in, in {@link SAFE_FORM_RULE.forms} order. */
  forms: SafeForm[];
  /** The ingredients no form absorbs, in {@link SHELL_NECESSITY_RULE.features} order. */
  uncovered: ShellFeature[];
  /** True when a `cd` head word was read as the command form's working-directory field. */
  cwdField?: boolean;
  /** True when a leading `VAR=value` prefix was read as an `env` field. */
  envField?: boolean;
}

/**
 * The candidate set, and the mapping from shell ingredient to form.
 *
 * Every field is here rather than inline so a later edit shows up as a changed
 * expectation in `test/knowledge/safe-form-coverage.test.ts` rather than as a
 * quietly different finding.
 */
export const SAFE_FORM_RULE = {
  /**
   * The two bars the assumption test fixed, quoted from its threshold: "The
   * safe forms fully express at least 60% of all commands, and at least 80% of
   * the failing ones." Weighted by invocations, so a text issued four hundred
   * times weighs what it cost.
   */
  bars: { all: 0.6, failing: 0.8 },

  /** Every form the classifier can name, so a new one is a visible edit. */
  forms: ["command", "comparison", "wait", "glob", "text", "pipeline", "sequence"] as const satisfies readonly SafeForm[],

  /**
   * Which form absorbs which shell ingredient. A feature absent from this map is
   * uncovered by construction — that is how `substitution`, `expansion`,
   * `background` and `grouping` are refused, and they are refused because each
   * one is the shell *evaluating* rather than the caller *stating*.
   */
  absorbs: {
    pipeline: "pipeline",
    sequence: "sequence",
    /** A destination for a stage's output is a field on the pipeline form. */
    redirection: "pipeline",
    /** `<<EOF` is literal text handed to a program's stdin — the text form exactly. */
    heredoc: "text",
    /** The caller wanted a pattern matched; the glob form matches it and says what no-match means. */
    glob: "glob",
    /** `~` is a named root the surface resolves, not a character a shell rewrites. */
    tilde: "command",
  } as const satisfies Partial<Record<ShellFeature, SafeForm>>,

  /**
   * Control-flow words the `comparison` form covers: a bracket test and its
   * negation are a predicate, and a predicate is what the form is.
   */
  comparisonKeywords: ["[[", "]]", "!"],

  /**
   * Control-flow words the `wait` form covers — but only in a loop that polls,
   * which is why {@link waitProbe} must also appear. `until … do sleep … done`
   * is a wait; `while read line; do …; done` is a program and stays uncovered.
   */
  waitKeywords: ["while", "until", "do", "done"],

  /** The word that makes a `while`/`until` loop a wait rather than an iteration. */
  waitProbe: "sleep",

  /**
   * Head words that make a command shell-bound but are a *field* on the command
   * form. Only `cd` is here: "run this in that directory" is a parameter, and
   * `export`, `source`, `eval` and the rest are the shell's own state.
   */
  fieldBuiltins: ["cd"],
} as const;

const ABSORBS = SAFE_FORM_RULE.absorbs as Partial<Record<ShellFeature, SafeForm>>;
const COMPARISON_KEYWORDS = new Set<string>(SAFE_FORM_RULE.comparisonKeywords);
const WAIT_KEYWORDS = new Set<string>(SAFE_FORM_RULE.waitKeywords);
const FIELD_BUILTINS = new Set<string>(SAFE_FORM_RULE.fieldBuiltins);
const BUILTINS = new Set<string>(SHELL_NECESSITY_RULE.builtins);
const KEYWORDS = new Set<string>(SHELL_NECESSITY_RULE.keywords);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

/**
 * The head words a command actually used, per class.
 *
 * `classifyShellNecessity` reports *that* a builtin or a keyword was present;
 * this pass reports *which*, because `cd` and `export` are on opposite sides of
 * the line here and so are `until` and `for`. It re-tokenises rather than
 * threading the words back, so the two modules stay independent and a change to
 * one shows up as a disagreement rather than as a silent shared assumption.
 */
function headWords(command: string): { builtins: Set<string>; keywords: Set<string>; assignments: number; words: string[] } {
  const builtins = new Set<string>();
  const keywords = new Set<string>();
  let assignments = 0;
  const parsed = shellWords(command);
  if (!parsed) return { builtins, keywords, assignments, words: [] };

  let segmentStart = true;
  for (let i = 0; i < parsed.words.length; i++) {
    const word = parsed.words[i];
    if (!parsed.quoted[i] && SHELL_OPERATORS.includes(word)) {
      segmentStart = true;
      continue;
    }
    if (segmentStart && !parsed.quoted[i]) {
      if (ASSIGNMENT.test(word)) {
        assignments++;
        continue; // the head of the command is still to come
      }
      if (KEYWORDS.has(word)) {
        keywords.add(word);
        continue; // `until cmd` — the next word is a command head too
      }
      if (BUILTINS.has(word)) builtins.add(word);
    }
    segmentStart = false;
  }
  return { builtins, keywords, assignments, words: parsed.words };
}

/**
 * Classify one recorded command against the candidate set: fully expressible in
 * the safe forms, partly, or not at all.
 *
 * The command is decomposed into the shell ingredients it depends on — by
 * {@link classifyShellNecessity}, committed for the sibling census before this
 * one existed — and each ingredient is looked up in
 * {@link SAFE_FORM_RULE.absorbs}. A command with no ingredients at all is a bare
 * program and arguments, which the `command` form expresses by definition.
 */
export function classifySafeForm(command: string): SafeFormClassification {
  const shell = classifyShellNecessity(command);
  if (shell.verdict === "unreadable") return { verdict: "unreadable", forms: [], uncovered: [] };
  if (shell.verdict === "argv") return { verdict: "full", forms: ["command"], uncovered: [] };

  const features = shell.features ?? [];
  const { builtins, keywords, assignments } = headWords(command);
  const forms = new Set<SafeForm>(["command"]);
  const uncovered: ShellFeature[] = [];
  let envField = false;
  let cwdField = false;

  for (const feature of features) {
    const direct = ABSORBS[feature];
    if (direct) {
      forms.add(direct);
      continue;
    }
    if (feature === "builtin") {
      // `cd` is a field on the command form; every other builtin is shell state.
      if (builtins.size > 0 && [...builtins].every((b) => FIELD_BUILTINS.has(b))) {
        cwdField = true;
        continue;
      }
      uncovered.push(feature);
      continue;
    }
    if (feature === "assignment") {
      // A leading `VAR=value` is an `env` field — but only when nothing in the
      // line reads it back, and reading it back is `expansion`, refused below.
      if (assignments > 0) {
        envField = true;
        continue;
      }
      uncovered.push(feature);
      continue;
    }
    if (feature === "keyword") {
      const used = [...keywords];
      if (used.length > 0 && used.every((k) => COMPARISON_KEYWORDS.has(k))) {
        forms.add("comparison");
        continue;
      }
      if (
        used.length > 0 &&
        used.every((k) => WAIT_KEYWORDS.has(k) || COMPARISON_KEYWORDS.has(k)) &&
        new RegExp(`(^|\\s)${SAFE_FORM_RULE.waitProbe}(\\s|$)`).test(command)
      ) {
        forms.add("wait");
        continue;
      }
      uncovered.push(feature);
      continue;
    }
    uncovered.push(feature);
  }

  const ordered = SAFE_FORM_RULE.forms.filter((f) => forms.has(f));
  if (uncovered.length === 0) {
    return {
      verdict: "full",
      forms: ordered,
      uncovered: [],
      ...(cwdField ? { cwdField: true } : {}),
      ...(envField ? { envField: true } : {}),
    };
  }
  const inOrder = SHELL_NECESSITY_RULE.features.filter((f) => uncovered.includes(f));
  // `none` means not one ingredient landed in a form. `command` is always in the
  // set and is not an ingredient, so it does not count towards partial coverage.
  const covered = ordered.filter((f) => f !== "command");
  return {
    verdict: covered.length > 0 || cwdField ? "partial" : "none",
    forms: ordered,
    uncovered: inOrder,
    ...(cwdField ? { cwdField: true } : {}),
    ...(envField ? { envField: true } : {}),
  };
}

/** One distinct command as harvested: its text, its weight, and how often it failed. */
export interface HarvestedOutcome {
  command: string;
  /** Recorded invocations of exactly this text — the frequency weight. */
  count: number;
  /** Distinct sessions it appeared in. */
  sessions: number;
  /** Invocations whose `tool_result` came back `is_error`. */
  failures: number;
  /** Invocations no `tool_result` was ever paired back to. Never read as success. */
  unpaired: number;
}

/**
 * Every `Bash` command in a corpus of transcripts, deduplicated, with the
 * outcome of each invocation.
 *
 * A call is a failure only when a `tool_result` came back carrying `is_error` —
 * the same single signal `path-failure-attribution` reads, and for the same
 * reason: anything inferred from the *text* of a result is the reader's
 * judgement about what an error message looks like, and this census would then
 * be scoring its own guess. A call whose result never arrives is `unpaired` and
 * is counted in neither the failing numerator nor its denominator.
 */
export function readBashOutcomes(sessions: readonly TranscriptSession[]): {
  commands: HarvestedOutcome[];
  /** Total `Bash` calls read, before deduplication. */
  invocations: number;
  /** Calls that came back `is_error`. */
  failures: number;
  /** Calls no result was paired back to. */
  unpaired: number;
} {
  const byText = new Map<string, { count: number; sessions: Set<string>; failures: number; unpaired: number }>();
  let invocations = 0;
  let failures = 0;

  for (const session of sessions) {
    /** Calls awaiting a result, by `tool_use` id. A session's ids are its own. */
    const pending = new Map<string, string>();
    const record = (command: string, failed: boolean) => {
      const seen = byText.get(command);
      if (seen) {
        seen.count++;
        seen.sessions.add(session.id);
        if (failed) seen.failures++;
      } else {
        byText.set(command, { count: 1, sessions: new Set([session.id]), failures: failed ? 1 : 0, unpaired: 0 });
      }
    };

    for (const line of session.jsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: { message?: { content?: unknown } };
      try {
        parsed = JSON.parse(trimmed) as { message?: { content?: unknown } };
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      const content = parsed.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && block.name === "Bash" && typeof block.id === "string") {
          const command = (block.input as Record<string, unknown> | undefined)?.command;
          if (typeof command !== "string" || !command.trim()) continue;
          invocations++;
          pending.set(block.id, command);
          continue;
        }
        if (block.type !== "tool_result") continue;
        const command = pending.get(String(block.tool_use_id ?? ""));
        if (command === undefined) continue;
        pending.delete(String(block.tool_use_id ?? ""));
        const failed = block.is_error === true;
        if (failed) failures++;
        record(command, failed);
      }
    }

    // Whatever is still pending never got a result — the session ended, or the
    // record is clipped. It weighs in the denominator of `all` and in neither
    // side of `failing`.
    for (const command of pending.values()) {
      record(command, false);
      byText.get(command)!.unpaired++;
    }
  }

  const commands = [...byText.entries()]
    .map(([command, v]) => ({ command, count: v.count, sessions: v.sessions.size, failures: v.failures, unpaired: v.unpaired }))
    .sort((a, b) => b.count - a.count || (a.command < b.command ? -1 : 1));
  const unpaired = commands.reduce((n, c) => n + c.unpaired, 0);
  return { commands, invocations, failures, unpaired };
}

/** How often one form would have been reached for, and one ingredient refused. */
export interface FormShare {
  form: SafeForm;
  invocations: number;
  distinct: number;
}

export interface UncoveredShare {
  feature: ShellFeature;
  invocations: number;
  distinct: number;
  /** Of those, how many were in commands that failed. */
  failingInvocations: number;
}

export interface SafeFormCensus {
  /** Transcripts read. Leads the report: a census of nothing is not a clean result. */
  sessionsRead: number;
  invocations: number;
  distinct: number;

  /** Invocations every ingredient of which a form expresses. */
  fullInvocations: number;
  partialInvocations: number;
  noneInvocations: number;
  /** Unbalanced quoting the classifier refused; counted in neither numerator nor denominator. */
  unreadableInvocations: number;
  unreadableDistinct: number;

  /** `fullInvocations` over readable invocations — the bar for all commands. */
  allShare: number;
  meetsAllBar: boolean;

  /** Invocations whose `tool_result` came back `is_error`, readable ones only. */
  failingInvocations: number;
  failingFullInvocations: number;
  failingPartialInvocations: number;
  failingNoneInvocations: number;
  failingUnreadableInvocations: number;
  /** `failingFullInvocations` over readable failing invocations — the second bar. */
  failingShare: number;
  meetsFailingBar: boolean;

  /** Both bars, which is what the assumption test asks. */
  meetsBothBars: boolean;

  /**
   * Invocations that would drop out of `full` if the command form's
   * working-directory field were not counted as covering a `cd` head word.
   * Reported separately so a stricter reader can subtract it from
   * {@link fullInvocations} rather than take this module's judgement on trust.
   */
  cwdFieldFullInvocations: number;
  /** Invocations where a leading `VAR=value` was read as an `env` field. */
  envFieldInvocations: number;

  /** Which forms carry the coverage, most-reached-for first. */
  forms: FormShare[];
  /** Which ingredients no form absorbs, most-costly first. */
  uncovered: UncoveredShare[];
}

/** Score a harvested corpus against the candidate set. */
export function safeFormCoverageCensus(
  commands: readonly HarvestedOutcome[],
  options: { sessionsRead: number },
): SafeFormCensus {
  let invocations = 0;
  let full = 0;
  let partial = 0;
  let none = 0;
  let unreadable = 0;
  let unreadableDistinct = 0;
  let failing = 0;
  let failingFull = 0;
  let failingPartial = 0;
  let failingNone = 0;
  let failingUnreadable = 0;
  let cwdFieldFull = 0;
  let envField = 0;

  const formCounts = new Map<SafeForm, { invocations: number; distinct: number }>();
  const uncoveredCounts = new Map<ShellFeature, { invocations: number; distinct: number; failingInvocations: number }>();

  for (const entry of commands) {
    invocations += entry.count;
    failing += entry.failures;
    const c = classifySafeForm(entry.command);

    if (c.verdict === "unreadable") {
      unreadable += entry.count;
      unreadableDistinct++;
      failingUnreadable += entry.failures;
      continue;
    }
    if (c.verdict === "full") {
      full += entry.count;
      failingFull += entry.failures;
      if (c.cwdField) cwdFieldFull += entry.count;
    } else if (c.verdict === "partial") {
      partial += entry.count;
      failingPartial += entry.failures;
    } else {
      none += entry.count;
      failingNone += entry.failures;
    }
    if (c.envField) envField += entry.count;

    for (const form of c.forms) {
      const seen = formCounts.get(form) ?? { invocations: 0, distinct: 0 };
      seen.invocations += entry.count;
      seen.distinct++;
      formCounts.set(form, seen);
    }
    for (const feature of c.uncovered) {
      const seen = uncoveredCounts.get(feature) ?? { invocations: 0, distinct: 0, failingInvocations: 0 };
      seen.invocations += entry.count;
      seen.distinct++;
      seen.failingInvocations += entry.failures;
      uncoveredCounts.set(feature, seen);
    }
  }

  const readable = invocations - unreadable;
  const readableFailing = failing - failingUnreadable;
  const allShare = readable > 0 ? full / readable : 0;
  const failingShare = readableFailing > 0 ? failingFull / readableFailing : 0;
  const meetsAllBar = readable > 0 && allShare >= SAFE_FORM_RULE.bars.all;
  const meetsFailingBar = readableFailing > 0 && failingShare >= SAFE_FORM_RULE.bars.failing;

  return {
    sessionsRead: options.sessionsRead,
    invocations,
    distinct: commands.length,
    fullInvocations: full,
    partialInvocations: partial,
    noneInvocations: none,
    unreadableInvocations: unreadable,
    unreadableDistinct,
    allShare,
    meetsAllBar,
    failingInvocations: failing,
    failingFullInvocations: failingFull,
    failingPartialInvocations: failingPartial,
    failingNoneInvocations: failingNone,
    failingUnreadableInvocations: failingUnreadable,
    failingShare,
    meetsFailingBar,
    meetsBothBars: meetsAllBar && meetsFailingBar,
    cwdFieldFullInvocations: cwdFieldFull,
    envFieldInvocations: envField,
    forms: [...formCounts.entries()]
      .map(([form, v]) => ({ form, ...v }))
      .sort((a, b) => b.invocations - a.invocations || a.form.localeCompare(b.form)),
    uncovered: [...uncoveredCounts.entries()]
      .map(([feature, v]) => ({ feature, ...v }))
      .sort((a, b) => b.invocations - a.invocations || a.feature.localeCompare(b.feature)),
  };
}

function pct(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/**
 * The census as a reader sees it: both bars on their own line, because a single
 * blended number is exactly what would hide a set that is popular and useless.
 */
export function formatSafeFormCoverage(census: SafeFormCensus): string {
  if (census.sessionsRead === 0 || census.invocations === 0) {
    return "Coverage: UNREAD — no transcript was read, so this is not a clean zero.";
  }
  const readable = census.invocations - census.unreadableInvocations;
  const readableFailing = census.failingInvocations - census.failingUnreadableInvocations;
  const lines = [
    `Coverage: ${pct(census.allShare)} of ${readable} readable invocations are fully expressible ` +
      `(bar is ${pct(SAFE_FORM_RULE.bars.all)}, ${census.meetsAllBar ? "met" : "NOT MET"}).`,
    `Failing: ${pct(census.failingShare)} of ${readableFailing} readable failing invocations are fully expressible ` +
      `(bar is ${pct(SAFE_FORM_RULE.bars.failing)}, ${census.meetsFailingBar ? "met" : "NOT MET"}).`,
    `Read ${census.sessionsRead} transcript(s): ${census.invocations} invocations, ${census.distinct} distinct, ` +
      `${census.unreadableInvocations} unreadable and counted neither way.`,
    `Forms reached for: ${census.forms.map((f) => `${f.form} ${f.invocations}`).join(", ") || "none"}.`,
    `Not expressible: ${census.uncovered.map((u) => `${u.feature} ${u.invocations} (${u.failingInvocations} failing)`).join(", ") || "nothing"}.`,
    `Counted full with help from a field rather than a form: ${census.cwdFieldFullInvocations} working directory, ${census.envFieldInvocations} environment.`,
    "Commands are counted AS WRITTEN by callers who had only a shell; what they would write with these forms available is not in this corpus.",
  ];
  return lines.join("\n");
}
