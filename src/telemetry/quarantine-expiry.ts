/**
 * The quarantine-expiry replay: had every exclusion on record carried an expiry
 * date, is there a single period that would have helped?
 *
 * The solution under test is "quarantine entries expire, so a workaround cannot
 * become permanent by inattention". Its mechanism is trivial — a date beside an
 * entry, and a run that goes red when the date passes. **The period is the whole
 * risk**, and it is empirical rather than arguable: too short and the suite goes
 * red on a timer with nothing changed, which this vault's own reasoning calls the
 * worst outcome available, because an operator who learns to skip a report misses
 * the real one; too long and it never fires before the flake is forgotten anyway,
 * which is the state the candidate exists to prevent.
 *
 * So this module replays the record. Every quarantine this project ever opened is
 * reconstructed as a timeline — opened, resolved, forgotten — and every candidate
 * period is fired against it. The bar was fixed before the sweep ran, by the
 * assumption test: **one period must fire after every recorded flake was resolved
 * and before it was forgotten, with zero firings against an unresolved flake.**
 * See {@link QUARANTINE_EXPIRY_RULE}.
 *
 * ## The three verdicts a firing can carry
 *
 * An expiry fires once, at `quarantinedAt + period`. What that firing is worth
 * depends only on where it lands relative to two other dates:
 *
 * - **premature** — it lands while the flake is still unresolved. The test
 *   rejoins the suite and fails again, having changed nothing. This is the
 *   crying-wolf case the bar bans outright.
 * - **useful** — it lands after the flake was resolved and while somebody was
 *   still paying attention to it. The stale entry comes out, and the person who
 *   meets the expiry still remembers why the entry existed.
 * - **late** — it lands after everyone had moved on. Nothing goes red, because
 *   the failure is gone; the entry is simply swept at a moment when no decision
 *   is being made. Harmless, and worth nothing — which is the point, because a
 *   mechanism whose firings are all late has not created the pressure it claims.
 *
 * ## What counts as a resolution, declared rather than assumed
 *
 * The sweep is scored against resolution dates, so how a resolution is
 * recognised decides the answer. Two of the classes in {@link ResolutionEvidence}
 * are resolutions and three are not, and the three are the interesting ones:
 *
 * - **`declared-retired`** — a pass called a flake retired after four clean runs
 *   and no code change. That is a judgement, not an event, and this record
 *   contains one that was falsified two days later.
 * - **`record-ends`** — the failure simply stops appearing. Scoring an expiry
 *   against that begs the question: "nobody mentioned it again" is exactly the
 *   inattention the candidate exists to defend against, so counting it as a
 *   resolution would let the sweep grade the candidate on the outcome the
 *   candidate is supposed to prevent.
 * - **`none`** — the cause is still in the suite today.
 *
 * The reading is not hidden behind that choice. {@link sweepReadings} runs the
 * sweep twice — once strictly, once with `record-ends` and `declared-retired`
 * admitted — and {@link ExpirySweepReadings.readingDecides} says on the report's
 * face whether the verdict turns on which reading an author picked.
 *
 * ## What a replay out of this record cannot settle
 *
 * Whether an operator renews a lapsed quarantine thoughtfully or reflexively.
 * That is the thing which decides whether expiry creates real pressure or only
 * ceremony, and no replay can see it — a period that scores perfectly here still
 * has that risk in front of it.
 */

/** How a quarantined failure stopped being a failure — or did not. */
export type ResolutionEvidence =
  /** A commit removed the cause. The date is the commit's, read from git. */
  | "cause-fixed-in-commit"
  /** The failing assertion left the suite — deleted, rewritten, or replaced. */
  | "cause-removed-from-suite"
  /** Somebody called it over, with no change to the code under it. */
  | "declared-retired"
  /** Nothing was fixed; the failure just stops appearing in the record. */
  | "record-ends"
  /** The cause is still in the suite. */
  | "none";

/**
 * The bar, and the sweep grid, both fixed before the record was replayed.
 *
 * The two numbers a reader should check first are `maxPrematureFirings` — zero,
 * from the assumption test's threshold, written that way so a thin sample fails
 * rather than flatters — and `periodsDays`, whose floor is one day. An expiry
 * measured in minutes is not an expiring quarantine, it is a retry; the grid says
 * so rather than discovering it. `shortestQuarantineMinutes` on the sweep reports
 * what that floor excluded, so the floor is visible instead of load-bearing.
 */
export const QUARANTINE_EXPIRY_RULE = {
  /** The threshold's hard clause: zero firings against an unresolved flake. */
  maxPrematureFirings: 0,
  /** …and its other clause: the period has to be useful on *every* subject. */
  usefulOnEverySubject: true,
  /** Candidate periods, in days. */
  periodsDays: [1, 2, 3, 5, 7, 10, 14, 21, 30, 45, 60, 90] as const,
  /** Evidence classes that are a resolution under the strict reading. */
  countsAsResolved: ["cause-fixed-in-commit", "cause-removed-from-suite"] as const,
  /** …and the ones that are not, each with the reason it is not. */
  doesNotCount: {
    "declared-retired": "a judgement with no event under it; this record contains one that was falsified two days later",
    "record-ends": "nobody mentioning it again is the inattention the candidate exists to prevent, not evidence it was fixed",
    none: "the cause is still in the suite",
  } as Record<string, string>,
} as const;

/** One quarantine, reconstructed end to end. */
export interface QuarantineTimeline {
  /** The test file that was excluded. */
  file: string;
  /** First recorded failure of this file, if anything recorded one before the exclusion. */
  firstObservedAt: string | null;
  /** The first hand-typed exclusion — when the quarantine, and its expiry clock, would start. */
  quarantinedAt: string;
  /** The last hand-typed exclusion. */
  lastExcludedAt: string;
  /** How many invocations carried the exclusion, and across how many sessions. */
  exclusions: number;
  sessions: number;
  /** When the failure stopped being a failure, and how that is known. */
  resolvedAt: string | null;
  resolutionEvidence: ResolutionEvidence;
  resolutionCitation: string;
  /**
   * The last dated act on this failure by anybody — an exclusion, a filing, or a
   * commit that names it. After this date an expiry fires into an empty room.
   * Deliberately read generously, in the candidate's favour.
   */
  forgottenAt: string;
  forgottenCitation: string;
  /**
   * Whether the failure was non-deterministic at all. Three of this record's four
   * exclusions are a run working around failures its own uncommitted files were
   * causing — true failures, not flakes, and not entries anybody would commit.
   */
  flake: boolean;
  /**
   * Dates this record *claimed* the failure was over, and what falsified each.
   *
   * These are not resolutions and are never scored as one. They are kept because
   * a sweep is scored against resolution dates, and a record that produced two
   * wrong ones for the same failure inside three days is telling a reader
   * something about how reliably that date can be read at all.
   */
  priorResolutionClaims: {
    at: string;
    evidence: ResolutionEvidence;
    citation: string;
    falsifiedAt: string;
    falsifiedBy: string;
  }[];
  note: string;
}

/** Where a single firing landed. */
export type FiringVerdict = "premature" | "useful" | "late";

export interface Firing {
  file: string;
  firesAt: string;
  verdict: FiringVerdict;
  why: string;
}

export interface PeriodResult {
  days: number;
  firings: Firing[];
  premature: number;
  useful: number;
  late: number;
  /** Both clauses of the threshold, on this period. */
  satisfies: boolean;
}

export interface ExpirySweep {
  /** Which resolution reading this sweep ran under. */
  reading: string;
  readingRule: string;
  subjects: number;
  periods: PeriodResult[];
  /** Every period that satisfied both clauses. */
  satisfyingPeriods: number[];
  meetsBar: boolean;
  /** The best any period managed, for a reader who wants to know how close it came. */
  bestUseful: number;
  /** How long the longest quarantine on record actually lasted, in minutes. */
  longestQuarantineMinutes: number;
  /** …against the sweep's floor, so the grid is never the reason something failed. */
  gridFloorMinutes: number;
  /** Quarantines that outlived the shortest period swept. */
  outlivingShortestPeriod: number;
  /** Subjects whose failure was actually non-deterministic. */
  flakes: number;
  /** Subjects with no resolution at all under this reading. */
  unresolved: number;
  /**
   * Resolution dates this record asserted and later contradicted. A period tuned
   * against one of these would have fired on a flake that was still live.
   */
  falsifiedResolutionClaims: number;
}

const DAY_MS = 86_400_000;

function ms(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new Error(`unparseable timestamp: ${iso}`);
  return t;
}

/**
 * Whether a timeline counts as resolved, under a named reading.
 *
 * The strict reading takes the two evidence classes that are events. The
 * permissive one additionally admits the two that are not — and, separately, a
 * resolution the record later took back — so that a reader can see whether the
 * verdict survives the most candidate-friendly interpretation the record allows.
 */
export function resolutionUnder(
  timeline: QuarantineTimeline,
  reading: Reading,
): { resolvedAt: string | null; why: string } {
  if (timeline.resolvedAt !== null && reading.admits.includes(timeline.resolutionEvidence)) {
    return { resolvedAt: timeline.resolvedAt, why: `${timeline.resolutionEvidence}: ${timeline.resolutionCitation}` };
  }
  // A claim the record itself contradicted is a resolution only to a reader who
  // takes the record at its word. That is what the permissive reading concedes,
  // and it concedes it regardless of the class the claim was filed under — the
  // falsification is the disqualifying fact, not the evidence type.
  if (reading.admitFalsifiedClaims && timeline.priorResolutionClaims.length > 0) {
    const earliest = [...timeline.priorResolutionClaims].sort((a, b) => ms(a.at) - ms(b.at))[0];
    return { resolvedAt: earliest.at, why: `${earliest.evidence} (later falsified by ${earliest.falsifiedBy})` };
  }
  const why =
    timeline.resolvedAt === null
      ? QUARANTINE_EXPIRY_RULE.doesNotCount.none
      : (QUARANTINE_EXPIRY_RULE.doesNotCount[timeline.resolutionEvidence] ?? "not a resolution under this reading");
  return { resolvedAt: null, why };
}

/** A named way of deciding what the record counts as a resolution. */
export interface Reading {
  name: string;
  rule: string;
  admits: readonly string[];
  /** Whether a resolution date the record later contradicted still counts. */
  admitFalsifiedClaims: boolean;
}

/** Fire one period at one timeline and say where it landed. */
export function fireAt(timeline: QuarantineTimeline, days: number, reading: Reading): Firing {
  const firesAt = new Date(ms(timeline.quarantinedAt) + days * DAY_MS).toISOString();
  const { resolvedAt, why } = resolutionUnder(timeline, reading);

  if (resolvedAt === null) {
    return { file: timeline.file, firesAt, verdict: "premature", why: `still unresolved — ${why}` };
  }
  if (ms(firesAt) < ms(resolvedAt)) {
    return { file: timeline.file, firesAt, verdict: "premature", why: `fires ${gap(firesAt, resolvedAt)} before the fix` };
  }
  if (ms(firesAt) <= ms(timeline.forgottenAt)) {
    return { file: timeline.file, firesAt, verdict: "useful", why: `fires after the fix, ${gap(firesAt, timeline.forgottenAt)} before the record goes quiet` };
  }
  return {
    file: timeline.file,
    firesAt,
    verdict: "late",
    why: `fires ${gap(timeline.forgottenAt, firesAt)} after the last act on it — ${timeline.forgottenCitation}`,
  };
}

function gap(a: string, b: string): string {
  const minutes = Math.round(Math.abs(ms(b) - ms(a)) / 60_000);
  if (minutes < 90) return `${minutes}m`;
  const hours = minutes / 60;
  return hours < 48 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

/** Sweep every candidate period across every timeline, under one reading. */
export function sweepExpiryPeriods(timelines: readonly QuarantineTimeline[], reading: Reading): ExpirySweep {
  const periods: PeriodResult[] = QUARANTINE_EXPIRY_RULE.periodsDays.map((days) => {
    const firings = timelines.map((t) => fireAt(t, days, reading));
    const premature = firings.filter((f) => f.verdict === "premature").length;
    const useful = firings.filter((f) => f.verdict === "useful").length;
    const late = firings.filter((f) => f.verdict === "late").length;
    return {
      days,
      firings,
      premature,
      useful,
      late,
      satisfies:
        timelines.length > 0 &&
        premature <= QUARANTINE_EXPIRY_RULE.maxPrematureFirings &&
        (!QUARANTINE_EXPIRY_RULE.usefulOnEverySubject || useful === timelines.length),
    };
  });

  const lifetimes = timelines.map((t) => (ms(t.lastExcludedAt) - ms(t.quarantinedAt)) / 60_000);
  const floorMinutes = QUARANTINE_EXPIRY_RULE.periodsDays[0] * 24 * 60;

  return {
    reading: reading.name,
    readingRule: reading.rule,
    subjects: timelines.length,
    periods,
    satisfyingPeriods: periods.filter((p) => p.satisfies).map((p) => p.days),
    meetsBar: periods.some((p) => p.satisfies),
    bestUseful: periods.reduce((best, p) => Math.max(best, p.useful), 0),
    longestQuarantineMinutes: lifetimes.length ? Math.round(Math.max(...lifetimes)) : 0,
    gridFloorMinutes: floorMinutes,
    outlivingShortestPeriod: lifetimes.filter((m) => m > floorMinutes).length,
    flakes: timelines.filter((t) => t.flake).length,
    unresolved: timelines.filter((t) => resolutionUnder(t, reading).resolvedAt === null).length,
    falsifiedResolutionClaims: timelines.reduce((n, t) => n + t.priorResolutionClaims.length, 0),
  };
}

export interface ExpirySweepReadings {
  strict: ExpirySweep;
  permissive: ExpirySweep;
  /** True when the two readings disagree about the bar — i.e. the author's choice decided it. */
  readingDecides: boolean;
  meetsBar: boolean;
}

/**
 * Both readings, and whether the verdict turns on the choice between them.
 *
 * `meetsBar` is the strict reading's, because the permissive one admits a class
 * the rule names as question-begging. But a reader who only saw the strict number
 * could not tell a robust answer from one that hangs on a definition, so both are
 * published and {@link ExpirySweepReadings.readingDecides} states which it is.
 */
export function sweepReadings(timelines: readonly QuarantineTimeline[]): ExpirySweepReadings {
  const strict = sweepExpiryPeriods(timelines, STRICT_READING);
  const permissive = sweepExpiryPeriods(timelines, PERMISSIVE_READING);
  return { strict, permissive, readingDecides: strict.meetsBar !== permissive.meetsBar, meetsBar: strict.meetsBar };
}

/** Only an event counts: a commit that removed the cause, or the assertion leaving the suite. */
export const STRICT_READING: Reading = {
  name: "strict",
  rule: "only a commit that removed the cause, or the assertion leaving the suite, is a resolution",
  admits: QUARANTINE_EXPIRY_RULE.countsAsResolved,
  admitFalsifiedClaims: false,
};

/** Everything the record ever called a resolution counts, including the ones it took back. */
export const PERMISSIVE_READING: Reading = {
  name: "permissive",
  rule: "a pass declaring it retired, the failure simply not recurring, and a resolution the record later contradicted all count too",
  admits: [...QUARANTINE_EXPIRY_RULE.countsAsResolved, "declared-retired", "record-ends"],
  admitFalsifiedClaims: true,
};

/** The report. Coverage first; the verdict is never left to be inferred from a table. */
export function formatExpirySweep(readings: ExpirySweepReadings): string {
  const { strict, permissive } = readings;
  const lines: string[] = [];

  if (strict.subjects === 0) {
    return "Quarantine expiry: UNREAD — no quarantine timeline was reconstructed, so no period was swept.";
  }

  lines.push(
    `Quarantine expiry: ${readings.meetsBar ? "SUPPORTED" : "REFUTED"} — ` +
      `${strict.satisfyingPeriods.length} of ${strict.periods.length} candidate period(s) fire after every recorded ` +
      `flake was resolved and before it was forgotten, with zero firings against an unresolved one.`,
  );
  lines.push(
    `  Coverage: ${strict.subjects} quarantine(s) on record, ${strict.flakes} of them a flake rather than a failure ` +
      `the run caused; ${strict.unresolved} with no resolution event at all. The longest quarantine on record lasted ` +
      `${strict.longestQuarantineMinutes} minute(s), against a sweep floor of ${strict.gridFloorMinutes} — ` +
      `${strict.outlivingShortestPeriod} outlived the shortest period swept.`,
  );
  lines.push(
    `  Best any period managed: useful on ${strict.bestUseful} of ${strict.subjects} (strict), ` +
      `${permissive.bestUseful} of ${permissive.subjects} (permissive).`,
  );
  if (strict.falsifiedResolutionClaims > 0) {
    lines.push(
      `  ${strict.falsifiedResolutionClaims} resolution date(s) this record asserted were later contradicted by it — ` +
        `a period tuned against one would have fired on a flake that was still live.`,
    );
  }

  lines.push("");
  lines.push("  What counts as a resolution:");
  for (const sweep of [strict, permissive]) {
    lines.push(
      `    ${sweep.meetsBar ? "MET" : "MISSED"} — ${sweep.satisfyingPeriods.length} of ${sweep.periods.length} ` +
        `period(s) satisfy both clauses — ${sweep.reading}`,
    );
    lines.push(`        ${sweep.readingRule}`);
  }
  lines.push(
    readings.readingDecides
      ? "    The two readings DISAGREE — this verdict is a fact about the reading, not about the record."
      : "    Both readings agree, so the verdict does not turn on which one an author picked.",
  );

  lines.push("");
  lines.push("  Period sweep (premature / useful / late):");
  for (const p of strict.periods) {
    lines.push(`    ${String(p.days).padStart(2)}d  ${p.premature} / ${p.useful} / ${p.late}${p.satisfies ? "  ✓" : ""}`);
  }

  return lines.join("\n");
}
