/**
 * The rung-suggestion reflex census: when a refusal names the rung that WOULD
 * have been accepted, does the caller take it because it is honest — or because
 * it was named?
 *
 * The solution under test is "The refusal states the value that would have
 * worked, not just the one that did not": since the tool knows enough to refuse,
 * it knows enough to say what would have been accepted, so one round trip gives
 * the caller an answer instead of a diagnosis. Its own body names the risk that
 * decides whether it is worth doing — *suggesting the acceptable value invites
 * the caller to take it without thinking*, the ladder climbed by autocomplete
 * rather than by evidence — and the assumption test fixed the bar in advance:
 * **at most 5 of 20 retries adopt the named rung with the justification
 * unchanged from the refused attempt.**
 *
 * ## What this produces is a flag, never a verdict
 *
 * Taking the named ceiling is *usually correct*. It may be the honest rung, and
 * on a demotion it almost always is — the ladder's floor is always available and
 * the refusal says so. Separating a reflexive acceptance from a right one means
 * reading the justification and deciding whether it argues for the rung, which is
 * a judgement no count performs. {@link formatRungSuggestionCensus} says this on
 * the report's face rather than in a footnote, because a solution whose entire
 * risk is that a helpful message becomes an autocomplete is one where mistaking
 * the flag for the verdict is the specific way a reader gets it wrong.
 *
 * ## The trace that records arguments is the transcript, not the usage log
 *
 * The assumption test says the data is already captured — "the traces already
 * record every call and its arguments". That is true of exactly one of this
 * product's two traces. `telemetry/usage.ts` records tool name, outcome, timing,
 * surface and input **size**, and refuses input content on purpose, so a refused
 * call and its retry are indistinguishable in it: two `ost_create_node` rows with
 * different `argBytes`. The rung declared, the source cited and the justification
 * written are only in the session transcript, which is why this census reads
 * {@link TranscriptSession} and not {@link ../telemetry/usage.js}. That is a
 * narrower corpus — a call made outside a recorded session is invisible here —
 * and {@link RungSuggestionCensus.refusalsSeen} reports it rather than hiding it.
 *
 * ## Three readings of "new grounds", because they do not agree
 *
 * "Cited grounds it had not cited before" is the phrase the assumption test uses,
 * and it has more than one defensible reading. {@link GROUNDS_READINGS} states
 * each as a rule a reader can disagree with by name:
 *
 * - **any-edit** — the headline, and the one the spec's own words fix: the
 *   justification text is unchanged, character for character, from the refused
 *   attempt. Anything the caller rewrote counts as grounds.
 * - **new-sentence** — the retry must contain a sentence the refused attempt did
 *   not. Rewording is not new grounds; adding a claim is.
 * - **new-citation** — only a change to `source` counts, because `source` is the
 *   field the ceiling is actually computed from. Under this reading a retry that
 *   rewrites three paragraphs and cites the same channel has offered the rule
 *   nothing it did not already refuse.
 *
 * On the committed corpus these do not merely differ, they reverse the verdict,
 * and {@link RungSuggestionCensus.ruleDecides} says so. A reader who takes the
 * headline number without that line has read a property of the reading as a
 * property of the callers.
 *
 * **new-citation has a known artifact and it is disclosed rather than corrected.**
 * `ost_set_evidence` has no `source` argument at all — the refusal itself says
 * `source` is settable only at `ost_create_node` — so every retry made through
 * that tool is *unable* to cite anything new and this reading marks it reflexive
 * by construction. {@link RungSuggestionCensus.citationBlind} counts them, so the
 * strictest reading can be discounted by exactly the amount it is rigged.
 */
import { namedAcceptableRung } from "../eval/rungs.js";
import type { RungId } from "../knowledge/believability.js";
import type { TranscriptSession } from "./preflight.js";

/** The two tools that declare a rung, however the host namespaced them. */
const RUNG_TOOLS = /(?:^|__)(ost_create_node|ost_set_evidence)$/;

/**
 * A refusal that is ABOUT the rung, whatever it went on to say.
 *
 * The denominator for coverage, and it has to be narrower than "any error on a
 * rung-declaring call". `ost_create_node` refuses a dozen things — an instrument
 * that names no spec file, a threshold that fixes no bar, a title that will not
 * reduce to a filename — and on this corpus those outnumber the rung refusals
 * two to one. Counting them here would report the suggestion as covering 37% of
 * a surface it covers all of, by putting refusals in the denominator that have
 * no acceptable rung to name.
 */
const RUNG_REFUSAL = /cannot declare '[a-z]+'/;

/**
 * The rule, fixed in source before the corpus was counted.
 *
 * Exported so a test can assert against it and a reader can disagree with it by
 * name rather than by suspicion. Changing a value here changes the finding, and
 * the diff is where that argument belongs.
 */
export const RUNG_SUGGESTION_RULE = {
  /**
   * The pre-committed bar: at most this share of paired retries may adopt the
   * named rung with no new grounds. `5 of 20`, as the assumption test wrote it.
   */
  bar: 5 / 20,
  /**
   * The sample the bar names. A census over fewer pairs reports a rate against
   * the same bar and flags itself short ({@link RungSuggestionCensus.sampleShort}),
   * because a bar stated as a fraction of twenty is not settled by seven.
   */
  sample: 20,
  /**
   * How many later rung-declaring calls may pass before a call on the same node
   * stops being a retry.
   *
   * A retry is a caller answering the refusal it just read. Without a bound, the
   * next declaration on that node — an hour and forty calls later, in a different
   * piece of work — would be paired with it and counted as a reflex.
   * {@link RungSuggestionCensus.retryDistances} publishes how far the real pairs
   * actually sat, so a reader can see whether this number is doing any work.
   */
  retryWindowCalls: 20,
  /** Which reading of "new grounds" the headline number uses. */
  headline: "any-edit" as GroundsReadingName,
} as const;

export type GroundsReadingName = "any-edit" | "new-sentence" | "new-citation";

/** What the caller did after being told which rung would have worked. */
export type Adoption =
  /** Took the named rung, and offered no new grounds under the reading applied. */
  | "reflexive"
  /** Took the named rung, having cited something it had not cited before. */
  | "grounded"
  /** Declared some other rung — the suggestion did not decide it. */
  | "other-rung"
  /** Never declared on that node again. Counted neither way. */
  | "unretried";

/** One rung-declaring call, as the transcript recorded it. */
export interface RungCall {
  session: string;
  /** Position among the rung-declaring calls in that session, for the window. */
  index: number;
  /** The tool as the host named it, namespace and all. */
  tool: string;
  title: string;
  /** The rung this call declared. */
  declared: string;
  /** The provenance it cited, when the tool has an argument for one. */
  source: string | null;
  /** The free text the caller wrote to justify the rung: `body`, or `note`. */
  justification: string;
}

/** A refused declaration whose refusal named the rung that would have worked. */
export interface SuggestedRefusal {
  call: RungCall;
  /** The rung the refusal named as acceptable. */
  named: RungId;
  /** The refusal text, kept so a reader can check the reading against it. */
  message: string;
}

/** A refusal joined to what the caller declared next on the same node. */
export interface RefusalPair {
  refusal: SuggestedRefusal;
  retry: RungCall | null;
  /** Rung-declaring calls between the refusal and the retry. 0 = immediately. */
  distance: number | null;
  /** The verdict under each reading of "new grounds". */
  adoption: Record<GroundsReadingName, Adoption>;
}

export interface ReadingResult {
  name: GroundsReadingName;
  rule: string;
  reflexive: number;
  /** Paired retries — the denominator both readings share. */
  sample: number;
  share: number | null;
  meetsBar: boolean;
}

export interface RungSuggestionCensus {
  /** Sessions offered to the reader — the corpus, before scope. */
  sessionsRead: number;
  /** Rung-declaring calls found in them. */
  callsSeen: number;
  /** Refusals that were about the rung — the coverage denominator. */
  rungRefusalsSeen: number;
  /**
   * Failures of a rung-declaring call that refused something else: an instrument,
   * a threshold, a title. Reported so a reader can see that the coverage
   * denominator excludes them, and by how much.
   */
  otherRefusals: number;
  /**
   * Rung refusals whose text named the acceptable value. The gap between this and
   * {@link rungRefusalsSeen} is the part of the surface the solution has not
   * reached — a refusal that names no value cannot be taken reflexively, and
   * cannot be measured here either.
   */
  suggested: number;
  /** Refusals dropped as a duplicate record of one already counted. */
  duplicates: number;
  /** Suggested refusals the caller answered with another declaration. */
  paired: number;
  /** Suggested refusals never answered. Counted neither way. */
  unretried: number;
  /** Distance in rung-declaring calls for each pair, ascending. */
  retryDistances: number[];
  /** Paired retries made through a tool with no `source` argument. */
  citationBlind: number;
  cells: Record<Adoption, number>;
  reflexive: number;
  sample: number;
  share: number | null;
  bar: number;
  meetsBar: boolean;
  /** True when the corpus holds fewer pairs than the bar's sample names. */
  sampleShort: boolean;
  readings: ReadingResult[];
  /**
   * True when the readings disagree about the bar. The verdict is then as much a
   * property of how "new grounds" was read as of what the callers did, and the
   * report says so instead of standing on its number.
   */
  ruleDecides: boolean;
  pairs: RefusalPair[];
}

// ── reading the transcript ───────────────────────────────────────────────────

function contentBlocks(entry: Record<string, unknown>): Record<string, unknown>[] {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content;
  return Array.isArray(content) ? (content as Record<string, unknown>[]) : [];
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

function str(input: Record<string, unknown>, key: string): string | null {
  const v = input[key];
  return typeof v === "string" ? v : null;
}

/**
 * Every rung-declaring call in one session, in order, and the refusals among
 * them that named an acceptable value.
 *
 * The join is by `tool_use_id`, never by adjacency: a session that fires four
 * tools in one turn interleaves their results, and a reader that paired the
 * nearest result with the nearest call would attribute refusals to the wrong
 * arguments — which is the one error this census could not recover from, because
 * the arguments are the whole measurement.
 *
 * Only errors joined to one of {@link RUNG_TOOLS} are read. The refusal text
 * appears all over these transcripts — quoted in vault notes, dumped by `grep`,
 * read back by later passes — and counting those occurrences would report the
 * same two refusals hundreds of times and call it a corpus.
 */
export function readRungCalls(session: TranscriptSession): {
  calls: RungCall[];
  refusals: SuggestedRefusal[];
} {
  const pending = new Map<string, RungCall>();
  const calls: RungCall[] = [];
  const refusals: SuggestedRefusal[] = [];

  for (const raw of session.jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // a malformed line is one fewer call, never a thrown census
    }

    for (const block of contentBlocks(entry)) {
      if (block.type === "tool_use") {
        const tool = String(block.name ?? "");
        if (!RUNG_TOOLS.test(tool)) continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const title = str(input, "title");
        const declared = str(input, "evidence");
        if (!title || !declared) continue;
        const call: RungCall = {
          session: session.id,
          index: calls.length,
          tool,
          title,
          declared,
          source: str(input, "source"),
          // `body` on a create, `note` on a set — the same argument under two
          // names, and the one the caller writes to say why the rung is right.
          justification: str(input, "body") ?? str(input, "note") ?? "",
        };
        calls.push(call);
        const id = String(block.id ?? "");
        if (id) pending.set(id, call);
        continue;
      }

      if (block.type === "tool_result" && block.is_error === true) {
        const call = pending.get(String(block.tool_use_id ?? ""));
        if (!call) continue;
        const message = resultText(block.content);
        const named = namedAcceptableRung(message);
        if (named) refusals.push({ call, named, message });
      }
    }
  }

  return { calls, refusals };
}

/** Whether this tool can cite a source at all — `ost_set_evidence` cannot. */
export function canCiteSource(tool: string): boolean {
  return /ost_create_node$/.test(tool);
}

// ── the readings ─────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function sentences(text: string): string[] {
  return normalize(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The readings, each a predicate a reader can disagree with by name.
 *
 * `newGrounds` answers one question only: did the retry offer something the
 * refused attempt did not? Whether that something *bears on the rung* is the
 * judgement none of these performs, and the reason the report calls itself a flag.
 */
export const GROUNDS_READINGS: {
  name: GroundsReadingName;
  rule: string;
  newGrounds: (refused: RungCall, retry: RungCall) => boolean;
}[] = [
  {
    name: "any-edit",
    rule: "the justification text differs at all from the refused attempt — the assumption test's own words, and the most generous reading of the caller",
    newGrounds: (refused, retry) => normalize(refused.justification) !== normalize(retry.justification),
  },
  {
    name: "new-sentence",
    rule: "the retry contains a sentence the refused attempt did not — rewording is not new grounds, adding a claim is",
    newGrounds: (refused, retry) => {
      const had = new Set(sentences(refused.justification));
      return sentences(retry.justification).some((s) => !had.has(s));
    },
  },
  {
    name: "new-citation",
    rule: "the retry cites a source the refused attempt did not — the strictest reading, because `source` is the field the ceiling is computed from",
    newGrounds: (refused, retry) => (retry.source ?? "") !== (refused.source ?? ""),
  },
];

function adoptionUnder(
  reading: (typeof GROUNDS_READINGS)[number],
  refusal: SuggestedRefusal,
  retry: RungCall | null,
): Adoption {
  if (!retry) return "unretried";
  if (retry.declared !== refusal.named) return "other-rung";
  return reading.newGrounds(refusal.call, retry) ? "grounded" : "reflexive";
}

// ── the census ───────────────────────────────────────────────────────────────

/**
 * A refusal's identity for de-duplication.
 *
 * One session's record is copied into subagent and workflow directories, so the
 * same refusal can appear under several session ids. Two callers composing the
 * same title, the same rung and the same multi-paragraph justification is not a
 * coincidence worth allowing for; a duplicated record is.
 */
function refusalKey(r: SuggestedRefusal): string {
  return [r.call.title, r.call.declared, r.call.source ?? "", normalize(r.call.justification)].join(" ");
}

/**
 * Pair each suggested refusal with the caller's next declaration on the same
 * node, and count the retries that took the named rung without new grounds.
 */
export function rungSuggestionCensus(sessions: readonly TranscriptSession[]): RungSuggestionCensus {
  const pairs: RefusalPair[] = [];
  const seen = new Set<string>();
  let callsSeen = 0;
  let rungRefusalsSeen = 0;
  let otherRefusals = 0;
  let suggested = 0;
  let duplicates = 0;

  for (const session of sessions) {
    const { calls, refusals } = readRungCalls(session);
    callsSeen += calls.length;
    // Every refusal joined to a rung-declaring call, split by whether it was
    // about the rung — the denominator `suggested` is a share of.
    const counted = countRefusals(session);
    rungRefusalsSeen += counted.rung;
    otherRefusals += counted.other;
    for (const refusal of refusals) {
      suggested += 1;
      const key = refusalKey(refusal);
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);

      const from = refusal.call.index + 1;
      const to = Math.min(calls.length, from + RUNG_SUGGESTION_RULE.retryWindowCalls);
      let retry: RungCall | null = null;
      let distance: number | null = null;
      for (let i = from; i < to; i++) {
        if (calls[i].title === refusal.call.title) {
          retry = calls[i];
          distance = i - from;
          break;
        }
      }

      pairs.push({
        refusal,
        retry,
        distance,
        adoption: Object.fromEntries(
          GROUNDS_READINGS.map((r) => [r.name, adoptionUnder(r, refusal, retry)]),
        ) as Record<GroundsReadingName, Adoption>,
      });
    }
  }

  const readings: ReadingResult[] = GROUNDS_READINGS.map((r) => {
    const under = pairs.map((p) => p.adoption[r.name]).filter((a) => a !== "unretried");
    const reflexive = under.filter((a) => a === "reflexive").length;
    const share = under.length ? reflexive / under.length : null;
    return {
      name: r.name,
      rule: r.rule,
      reflexive,
      sample: under.length,
      share,
      meetsBar: share === null || share <= RUNG_SUGGESTION_RULE.bar,
    };
  });

  const headline = readings.find((r) => r.name === RUNG_SUGGESTION_RULE.headline);
  /* c8 ignore next */
  if (!headline) throw new Error(`no reading named ${RUNG_SUGGESTION_RULE.headline}`);

  const cells: Record<Adoption, number> = { reflexive: 0, grounded: 0, "other-rung": 0, unretried: 0 };
  for (const p of pairs) cells[p.adoption[RUNG_SUGGESTION_RULE.headline]] += 1;

  return {
    sessionsRead: sessions.length,
    callsSeen,
    rungRefusalsSeen,
    otherRefusals,
    suggested,
    duplicates,
    paired: pairs.filter((p) => p.retry).length,
    unretried: pairs.filter((p) => !p.retry).length,
    retryDistances: pairs
      .map((p) => p.distance)
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b),
    citationBlind: pairs.filter((p) => p.retry && !canCiteSource(p.retry.tool)).length,
    cells,
    reflexive: headline.reflexive,
    sample: headline.sample,
    share: headline.share,
    bar: RUNG_SUGGESTION_RULE.bar,
    meetsBar: headline.meetsBar,
    sampleShort: headline.sample < RUNG_SUGGESTION_RULE.sample,
    readings,
    ruleDecides: new Set(readings.map((r) => r.meetsBar)).size > 1,
    pairs,
  };
}

/**
 * Refused rung-declaring calls in a session, split by whether the refusal was
 * about the rung.
 *
 * Separate from {@link readRungCalls} because it answers a different question —
 * how much of the refusing surface the suggestion has reached — and a census that
 * counted only the refusals it could read would report full coverage by
 * construction, which is the one number it must not be able to assume.
 */
export function countRefusals(session: TranscriptSession): { rung: number; other: number } {
  const pending = new Set<string>();
  let rung = 0;
  let other = 0;
  for (const raw of session.jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    for (const block of contentBlocks(entry)) {
      if (block.type === "tool_use" && RUNG_TOOLS.test(String(block.name ?? ""))) {
        const id = String(block.id ?? "");
        if (id) pending.add(id);
      }
      if (block.type === "tool_result" && block.is_error === true && pending.has(String(block.tool_use_id ?? ""))) {
        if (RUNG_REFUSAL.test(resultText(block.content))) rung += 1;
        else other += 1;
      }
    }
  }
  return { rung, other };
}

function pct(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: coverage first, then the readings, and a
 * verdict only after the sentence that says it is not one.
 *
 * Coverage leads because it is the number most likely to invalidate the others.
 * A share of a denominator the reader has not seen is the shape of every
 * confident wrong finding this repository has had to withdraw.
 */
export function formatRungSuggestionCensus(census: RungSuggestionCensus): string {
  const lines: string[] = [];

  if (census.sample === 0) {
    lines.push(
      `Rung-suggestion reflex: UNREAD — ${census.suggested} rung refusal(s) named an acceptable value and not one was ` +
        `answered by another declaration on the same node.`,
    );
  } else {
    lines.push(
      `Rung-suggestion reflex: ${census.reflexive} of ${census.sample} paired retr${census.sample === 1 ? "y" : "ies"} ` +
        `(${pct(census.share)}) took the named rung with no new grounds; the bar is ` +
        `${RUNG_SUGGESTION_RULE.bar * RUNG_SUGGESTION_RULE.sample} of ${RUNG_SUGGESTION_RULE.sample} (${pct(census.bar)}).`,
    );
  }

  lines.push(
    `  Coverage: ${census.suggested} of ${census.rungRefusalsSeen} rung refusal(s) named an acceptable value, over ` +
      `${census.sessionsRead} session(s) and ${census.callsSeen} declaration(s); ${census.duplicates} dropped as a ` +
      `duplicated record; ${census.unretried} never answered and counted neither way. A further ` +
      `${census.otherRefusals} rung-declaring call(s) were refused over something other than the rung and are not in ` +
      `that denominator.`,
  );
  if (census.sampleShort) {
    lines.push(
      `  SAMPLE SHORT: the bar is stated as ${RUNG_SUGGESTION_RULE.bar * RUNG_SUGGESTION_RULE.sample} of ` +
        `${RUNG_SUGGESTION_RULE.sample} and this corpus holds ${census.sample}. The rate above is real; it is not ` +
        `the twenty retries the bar was written against, and a reader treating it as those has read more than is here.`,
    );
  }
  lines.push(
    `  Retries: reflexive ${census.cells.reflexive}, grounded ${census.cells.grounded}, ` +
      `other rung ${census.cells["other-rung"]}, unretried ${census.cells.unretried}` +
      (census.retryDistances.length
        ? ` — every pair sat within ${Math.max(...census.retryDistances)} declaration(s) of its refusal ` +
          `(window ${RUNG_SUGGESTION_RULE.retryWindowCalls}).`
        : "."),
  );

  lines.push("");
  lines.push('  What counts as "grounds it had not cited before":');
  for (const reading of census.readings) {
    lines.push(
      `    ${reading.reflexive}/${reading.sample} (${pct(reading.share)}) ${reading.meetsBar ? "meets" : "MISSES"} ` +
        `the bar — ${reading.name}`,
    );
    lines.push(`        ${reading.rule}`);
  }
  if (census.citationBlind) {
    lines.push(
      `    Note on new-citation: ${census.citationBlind} of ${census.sample} retr${census.citationBlind === 1 ? "y was" : "ies were"} ` +
        `made through ost_set_evidence, which has no \`source\` argument — that reading marks them reflexive by ` +
        `construction rather than by anything the caller did.`,
    );
  }
  lines.push(
    census.ruleDecides
      ? `  Rule: THE RULE DECIDES THIS. The readings above do not agree about the ${pct(census.bar)} bar, so the ` +
          `verdict is as much a property of how "new grounds" was read as of what the callers did.`
      : `  Rule: stable — every reading above reaches the same verdict against the ${pct(census.bar)} bar.`,
  );

  lines.push("");
  lines.push(
    "  This is a FLAG, never a verdict. Taking the named rung is often correct — it may be the honest one, and " +
      "demotion is always available. Deciding whether a retry argued for its rung means reading the justification, " +
      "which is a judgement, and a human records the result.",
  );

  lines.push("");
  lines.push(`Retries that took the named rung with no new grounds (${census.cells.reflexive}):`);
  const reflexive = census.pairs.filter((p) => p.adoption[RUNG_SUGGESTION_RULE.headline] === "reflexive");
  if (!reflexive.length) lines.push("  (none)");
  for (const p of reflexive) {
    lines.push(`  ${p.refusal.call.declared} → ${p.refusal.named}  "${p.refusal.call.title}" (${p.refusal.call.session})`);
  }

  return lines.join("\n");
}
