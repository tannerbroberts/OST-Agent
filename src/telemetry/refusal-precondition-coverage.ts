/**
 * The refusal-precondition census: of the refusals this tool's own calls
 * actually hit, what share could a caller have decided before making the call,
 * from the preconditions `src/security/call-preconditions.ts` publishes?
 *
 * The solution under test is "Publish the preconditions of every call so they can
 * be checked before it is made". Its assumption is the risky half and was written
 * down before anyone counted — *the conditions are expressible outside the tool,
 * and any that are not will still be discovered the hard way, so the improvement
 * is real but partial, and its size is exactly the share that can be published.*
 * The bar the assumption test fixed in advance: **fully expressible conditions
 * cover at least 70% of the refusals actually fired, weighted by the usage traces
 * rather than counted flat.**
 *
 * ## The weighting is the point, not a refinement
 *
 * A flat count over every refusal a mutating call *can* issue would be dominated
 * by rare paths and would say almost nothing about what callers hit. The trace
 * already records what fires. So {@link RefusalPreconditionCensus.share} is over
 * events, and the flat-by-class number is reported beside it as a control rather
 * than as the answer.
 *
 * ## And the weighting has a defect the bar does not survive
 *
 * Weighting by events assumes the events are independent. In this project's own
 * trace they are not: **61 of 118 refusals — 52% of the corpus — are one tool
 * (`ost_annotate`), one class (`no such node`), one day (2026-07-26), one
 * surface, no session id.** Every one of the 61 arguments is a single English
 * word, which is what an unquoted title looks like after a shell has split it.
 * That is one caller mistake recorded 61 times, not 61 independent needs, and it
 * is the single largest term in the number the bar is taken on.
 *
 * So the census computes the bar twice and publishes both:
 * {@link RefusalPreconditionCensus.meetsBar} on the weighting the assumption test
 * named, and {@link RefusalPreconditionCensus.meetsBarWithoutLargestIncident} with
 * the largest single-day single-class cluster collapsed to one event. A reader
 * who sees only the first has been told the idea clears its bar; a reader who
 * sees both has been told it clears its bar *because of that day*. The exit code
 * carries the first because that is what was pre-committed. The second is why the
 * exit code is not the whole finding, and `formatRefusalPreconditionCensus` puts
 * it above the share rather than below it.
 *
 * ## What the record itself cannot tell us
 *
 * `src/telemetry/usage.ts` truncates `err` at `MAX_ERR_CHARS` = 300, and this
 * surface writes refusals longer than that. Three events in the corpus are cut
 * mid-reason; two survive because the class is still legible at character 300 and
 * one does not. {@link RefusalPreconditionCensus.unreadable} counts the ones whose
 * reason was cut away before it could be classified, and they stay in the
 * denominator — a refusal nobody can classify is a refusal no precondition
 * demonstrably covers, and moving it out of the denominator would be the census
 * grading its own homework.
 */
import {
  CALL_PRECONDITIONS,
  type CallPrecondition,
  type Expressibility,
} from "../security/call-preconditions.js";

/** One refusal as the usage trace recorded it. */
export interface RecordedRefusal {
  ts: string;
  tool: string;
  surface: string;
  /** The refusal text, redacted and truncated at 300 characters by the tracer. */
  err: string;
  session?: string;
}

/**
 * One distinct refusal class, and the published precondition that decides it.
 *
 * `precondition` is a {@link CallPrecondition} id, so the grade is never written
 * here — it is looked up. A class whose id names no published precondition is a
 * refusal the publication does not cover at all, and `expressibilityOf` reports
 * it as `not` rather than defaulting it to something kinder.
 */
export interface RefusalClassSpec {
  id: string;
  /** The precondition that would have decided it, by id, or null when none does. */
  precondition: string | null;
  /** What the caller had to know, in one line. */
  needed: string;
  match: RegExp;
}

/**
 * The classifier, committed in source before the corpus was counted.
 *
 * Every pattern was written by reading the corpus's distinct refusal strings, and
 * every class it names occurs there at least once. Patterns are anchored to the
 * refusal's own wording rather than to a tool name, because the heaviest class
 * (`no such node`) arrives through eleven tools and a per-tool split would report
 * eleven rules where a caller has to learn one.
 *
 * Changing a line changes the finding. That is why it is one exported object
 * rather than constants scattered through the reader, and why the test beside it
 * asserts its shape as well as its output.
 */
export const REFUSAL_CLASSES: readonly RefusalClassSpec[] = Object.freeze([
  {
    id: "no-such-node",
    precondition: "node-exists",
    needed: "The title has to be one the vault already holds, spelled as `ost_read_tree` lists it.",
    match: /no such node:|no node on the tree carries that title|no evidence record carries that id/i,
  },
  {
    id: "above-source-standing",
    precondition: "within-source-standing",
    needed: "The rung a source has earned, and the ceiling its kind can never pass.",
    match: /cannot declare '[a-z]+': it cites .*which has earned/i,
  },
  {
    id: "unearned-measurement-rung",
    precondition: "unearned-measurement-rung",
    needed: "That 'observed' and 'money' need a recorded result or provenance that is itself a recording.",
    match: /cannot declare '[a-z]+': what it points at supports/i,
  },
  {
    id: "instrument-not-a-spec-file",
    precondition: "instrument-is-a-spec-file",
    // `contains shell pu` rather than the whole phrase: the tracer's 300-character
    // truncation lands inside this word on two events in the corpus, and matching
    // the full sentence would file them as unreadable when the class is legible.
    needed: "The closed grammar of instrument commands — one spec file, no shell punctuation.",
    match: /contains shell pu|is not an instrument form|leaves the repository\. An instrument names/i,
  },
  {
    id: "instrument-spec-missing",
    precondition: "instrument-spec-resolves",
    needed: "Whether the spec file exists in the configured product repo.",
    match: /cannot (?:carry|set) that instrument.*does not exist in/i,
  },
  {
    id: "threshold-not-a-bar",
    precondition: "threshold-fixes-a-bar",
    needed: "That a threshold must fix a comparator next to a number, on one line.",
    match: /cannot carry that threshold/i,
  },
  {
    id: "no-evidence-class",
    precondition: "evidence-class-declared",
    needed: "That `evidence` is required and closed to the ladder's five rungs.",
    match: /needs an evidence class/i,
  },
  {
    id: "reserved-heading",
    precondition: "no-reserved-heading-in-content",
    needed: "The list of reserved headings no tool argument may contain.",
    match: /is a reserved heading/i,
  },
  {
    id: "humans-required-lane",
    precondition: "humans-required-takes-no-instrument",
    needed: "That this test is flagged humans-required, so no command may be attached.",
    match: /labelled humans-required/i,
  },
  {
    id: "no-product-repo",
    precondition: "product-repo-configured",
    needed: "Whether `product.repos` names anything at all.",
    match: /no product repos configured/i,
  },
  {
    id: "repo-path-missing",
    precondition: "repo-path-exists",
    needed: "Whether the path exists in a checkout this tool does not own.",
    match: /does not exist in [A-Za-z0-9_.-]+ —/i,
  },
]);

/**
 * A refusal whose class is still legible after truncation, versus one whose is
 * not. The family prefix is matched separately from the reason so an event cut
 * before its reason is reported as unreadable rather than guessed into a class.
 */
const INSTRUMENT_FAMILY = /cannot (?:carry|set) that instrument/i;

export interface ClassifiedRefusal {
  refusal: RecordedRefusal;
  /** The class it fell into, or null when the record does not say enough. */
  class: RefusalClassSpec | null;
  /** True when the tracer's truncation removed the reason before it could be read. */
  truncated: boolean;
}

/** Which class this refusal belongs to. Never guesses; nulls instead. */
export function classifyRefusal(refusal: RecordedRefusal): ClassifiedRefusal {
  const err = refusal.err ?? "";
  for (const spec of REFUSAL_CLASSES) {
    if (spec.match.test(err)) return { refusal, class: spec, truncated: false };
  }
  // A refusal from a family we recognise whose reason was cut off. It is not a
  // twelfth class; it is the eleven classes with the distinguishing half missing.
  const truncated = err.length >= 300 && INSTRUMENT_FAMILY.test(err);
  return { refusal, class: null, truncated };
}

/** How much of this class a caller can decide in advance, from the publication. */
export function expressibilityOf(spec: RefusalClassSpec | null): Expressibility {
  if (!spec?.precondition) return "not";
  const published: CallPrecondition | undefined = CALL_PRECONDITIONS.find((p) => p.id === spec.precondition);
  return published?.expressibility ?? "not";
}

export interface ClassTally {
  id: string;
  precondition: string | null;
  needed: string;
  expressibility: Expressibility;
  /** How many refusals in the corpus fell into this class. */
  events: number;
  /** Distinct (day, tool) pairs — one caller's one sitting counts once. */
  incidents: number;
}

export interface RefusalPreconditionCensus {
  /** Every refusal read, including the ones no class matched. */
  total: number;
  /** Refusals whose reason the tracer cut away before it could be classified. */
  unreadable: number;
  /** Refusals no class matched and no truncation explains. */
  unclassified: number;
  tallies: ClassTally[];
  /** Events whose class maps to a `fully` precondition. */
  fullyExpressible: number;
  /** Events whose class maps to a `caveat` precondition. */
  caveated: number;
  /** `fullyExpressible / total`, the number the bar is taken on. */
  share: number;
  /** The pre-committed bar, from the assumption test's frontmatter. */
  bar: number;
  meetsBar: boolean;
  /**
   * The same share with the largest single-day single-class cluster collapsed to
   * one event — the control that says whether the number survives its own corpus.
   */
  shareWithoutLargestIncident: number;
  meetsBarWithoutLargestIncident: boolean;
  /** The cluster that was collapsed, so a reader can go and look at it. */
  largestIncident: { day: string; tool: string; class: string; events: number } | null;
  /** Flat over classes rather than events — reported as a control, never the answer. */
  flatShare: number;
}

/** The bar the assumption test fixed in advance, in its own frontmatter. */
export const REFUSAL_PRECONDITION_BAR = 0.7;

/**
 * Take the census.
 *
 * Nothing is filtered on the way in. The corpus is every `ok: false` event the
 * tracer wrote, and a refusal this census cannot read still counts against the
 * share — see the module note on `unreadable`.
 */
export function refusalPreconditionCensus(corpus: readonly RecordedRefusal[]): RefusalPreconditionCensus {
  const classified = corpus.map(classifyRefusal);

  const byClass = new Map<string, { spec: RefusalClassSpec; events: number; incidents: Set<string> }>();
  for (const c of classified) {
    if (!c.class) continue;
    const slot = byClass.get(c.class.id) ?? { spec: c.class, events: 0, incidents: new Set<string>() };
    slot.events++;
    slot.incidents.add(`${c.refusal.ts.slice(0, 10)} ${c.refusal.tool}`);
    byClass.set(c.class.id, slot);
  }

  const tallies: ClassTally[] = [...byClass.values()]
    .map((slot) => ({
      id: slot.spec.id,
      precondition: slot.spec.precondition,
      needed: slot.spec.needed,
      expressibility: expressibilityOf(slot.spec),
      events: slot.events,
      incidents: slot.incidents.size,
    }))
    .sort((a, b) => b.events - a.events || a.id.localeCompare(b.id));

  const total = corpus.length;
  const fullyExpressible = tallies.filter((t) => t.expressibility === "fully").reduce((n, t) => n + t.events, 0);
  const caveated = tallies.filter((t) => t.expressibility === "caveat").reduce((n, t) => n + t.events, 0);

  // The largest single-day, single-tool, single-class cluster. Three keys rather
  // than one, because "one incident" means one caller doing one thing in one
  // sitting, and a day alone would collapse unrelated refusals that share a date.
  const clusters = new Map<string, { day: string; tool: string; class: string; events: number }>();
  for (const c of classified) {
    if (!c.class) continue;
    const day = c.refusal.ts.slice(0, 10);
    const key = `${day} ${c.refusal.tool} ${c.class.id}`;
    const slot = clusters.get(key) ?? { day, tool: c.refusal.tool, class: c.class.id, events: 0 };
    slot.events++;
    clusters.set(key, slot);
  }
  const largestIncident = [...clusters.values()].sort((a, b) => b.events - a.events)[0] ?? null;
  const collapsed = largestIncident ? largestIncident.events - 1 : 0;
  const collapsedIsFully =
    largestIncident !== null &&
    tallies.find((t) => t.id === largestIncident.class)?.expressibility === "fully";
  const adjustedTotal = total - collapsed;
  const adjustedFully = fullyExpressible - (collapsedIsFully ? collapsed : 0);

  const share = total === 0 ? 0 : fullyExpressible / total;
  const shareWithoutLargestIncident = adjustedTotal === 0 ? 0 : adjustedFully / adjustedTotal;

  return {
    total,
    unreadable: classified.filter((c) => !c.class && c.truncated).length,
    unclassified: classified.filter((c) => !c.class && !c.truncated).length,
    tallies,
    fullyExpressible,
    caveated,
    share,
    bar: REFUSAL_PRECONDITION_BAR,
    meetsBar: share >= REFUSAL_PRECONDITION_BAR,
    shareWithoutLargestIncident,
    meetsBarWithoutLargestIncident: shareWithoutLargestIncident >= REFUSAL_PRECONDITION_BAR,
    largestIncident: largestIncident && largestIncident.events > 1 ? largestIncident : null,
    flatShare:
      tallies.length === 0 ? 0 : tallies.filter((t) => t.expressibility === "fully").length / tallies.length,
  };
}

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * The census as text.
 *
 * The qualification leads. A share printed first and qualified afterwards is read
 * as the finding with a footnote; this census's finding is that the share and its
 * qualification are the same size.
 */
export function formatRefusalPreconditionCensus(c: RefusalPreconditionCensus): string {
  const out: string[] = [];
  out.push(`Refusal-precondition coverage — ${c.total} refusal(s) this tool's own calls actually hit`);
  if (c.largestIncident) {
    out.push(
      `  READ THIS FIRST: ${c.largestIncident.events} of ${c.total} are one cluster — ` +
        `${c.largestIncident.tool}/${c.largestIncident.class} on ${c.largestIncident.day}. ` +
        `That is one caller in one sitting recorded ${c.largestIncident.events} times, not ${c.largestIncident.events} independent needs.`,
    );
    out.push(
      `  collapsed to one, the share is ${pct(c.shareWithoutLargestIncident)} ` +
        `(${c.meetsBarWithoutLargestIncident ? "still clears" : "does NOT clear"} the ${pct(c.bar)} bar)`,
    );
  }
  out.push(
    `  fully expressible ${c.fullyExpressible}/${c.total} = ${pct(c.share)} ` +
      `(bar ${pct(c.bar)} — ${c.meetsBar ? "MET" : "NOT met"})`,
  );
  out.push(`  checkable only against state this tool does not own: ${c.caveated}`);
  if (c.unreadable > 0) {
    out.push(
      `  ${c.unreadable} refusal(s) unreadable — the tracer truncates err at 300 chars and cut the reason away`,
    );
  }
  if (c.unclassified > 0) out.push(`  ${c.unclassified} refusal(s) no class matched`);
  out.push(`  flat over classes rather than events: ${pct(c.flatShare)} (control, not the answer)`);
  out.push("");
  for (const t of c.tallies) {
    out.push(
      `  ${String(t.events).padStart(3)} ${t.expressibility.padEnd(7)} ${t.id}` +
        ` (${t.incidents} incident${t.incidents === 1 ? "" : "s"})`,
    );
    out.push(`      needed: ${t.needed}`);
  }
  return out.join("\n").trimEnd();
}
