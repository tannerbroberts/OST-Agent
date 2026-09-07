/**
 * Telling a meaningful external write apart from churn, by a rule fixed in advance.
 *
 * The candidate under test watches the working tree and tells the run its copy of a
 * file is stale the moment somebody else writes it. That is only worth building if
 * the watcher can stay quiet about everything else. Editors write scratch files
 * beside the one they are saving, formatters touch every file on save, and a
 * `git checkout` looks like a thousand external writes arriving inside one second.
 * A watcher that cannot filter degrades into an alarm nobody reads, which is the
 * failure mode of every watcher ever built and the reason this — not the cost of
 * the watcher process — is the riskiest assumption in the candidate.
 *
 * ## The rule is committed before the capture it is scored on
 *
 * A rule tuned against the very sessions it is scored on measures nothing except
 * that it was tuned. {@link FS_EVENT_RULE} is therefore pre-registered: it was
 * committed in its own commit, with no capture in the repository to look at, and
 * `test/fixtures/fs-event-classification/PROVENANCE.md` names that commit. The
 * suite asserts every constant below, so a later edit that would improve the score
 * shows up as a changed expectation rather than as a quietly better finding.
 *
 * ## What the rule is allowed to know
 *
 * Only what a watcher could compute for itself at the moment the event arrives:
 * the path, whether git ignores it, whether the run issued the write, and — for the
 * handful of files the run is actually holding — the bytes now on disk against the
 * bytes it read. That last one is not an oracle: the candidate's whole premise is
 * that the agent *has* the copy, so comparing against it is the cheapest check it
 * owns, and it is what separates a formatter rewriting a file with identical
 * content from somebody actually changing it.
 *
 * What the rule may never know is who wrote the file. That is the ground truth the
 * capture records from the driver's side and the classifier never sees — see
 * {@link scoreSession}.
 *
 * ## Two numbers, and the second is the binding one
 *
 * The assumption test fixed both: at least 90% of external write events classified
 * correctly, and no more than 3 unnecessary invalidations per session. A 90% rate
 * still permits several spurious interruptions an hour, which is enough for a run to
 * start ignoring the signal — so the invalidation cap is the clause that decides
 * whether the mechanism survives contact with use, and {@link FsEventCensus} reports
 * them separately rather than as one verdict.
 */

/** The bar and the readings of it, fixed before any capture existed. */
export const FS_EVENT_RULE = {
  /**
   * Distinct paths inside {@link burstWindowMs} above which the wave is one branch
   * operation rather than that many edits. A checkout or a merge lands as a wave;
   * telling the run about it once is the useful notification, and telling it N times
   * is the alarm nobody reads.
   */
  burstFiles: 8,
  burstWindowMs: 1000,
  /** Repeated events on one path inside this window are one write, not several. */
  coalesceMs: 250,
  /** Directories whose contents are never a file the run is holding. */
  alwaysIgnoredDirs: [".git", "node_modules"],
  /**
   * Names editors, formatters and toolchains write *beside* the file they are
   * saving. Matched on the basename only, so a real file is never lost to one.
   */
  scratchPatterns: [
    /^\.DS_Store$/,
    /^4913$/, // vim's probe file, written and removed before every save
    /^\.#/, // emacs lock symlink
    /^#.*#$/, // emacs auto-save
    /~$/, // backup copy
    /\.sw[a-p]$/, // vim swap
    /\.tmp$/,
    /\.temp$/,
    /^\..*\.tmp\./, // atomic-write scratch: `.foo.tmp.1234`
    /\.orig$/,
    /\.rej$/,
    /\.lock$/,
  ],
  /** At least this share of external write events must be classified correctly. */
  minAccuracy: 0.9,
  /** No session may raise more unnecessary invalidations than this. */
  maxUnnecessaryPerSession: 3,
  /**
   * Readings of the burst threshold, so the verdict can be read either side of the
   * number rather than only at it.
   */
  burstLadder: [2, 4, 8, 16, 64],
} as const;

// ── the capture format ──────────────────────────────────────────────────────

/** A file event the watcher saw, with what a watcher could have known about it. */
export interface FsEventEntry {
  t: "fs";
  seq: number;
  /** Milliseconds since the capture started. */
  ms: number;
  /** Repository-relative path. */
  path: string;
  kind: "change" | "rename";
  /** Whether git ignores this path, recorded at capture time by `git check-ignore`. */
  gitignored: boolean;
  /**
   * Content hash of the file just after the event, or `null` when it could not be
   * read (a rename that removed it, a path the capture lost the race on). Only
   * recorded for paths the session had read — a watcher does not hash the tree.
   */
  hash: string | null;
}

/** The session reading a file: from here on it is holding a copy. */
export interface ReadEntry {
  t: "read";
  seq: number;
  ms: number;
  path: string;
  /** Hash of the bytes the session read. */
  hash: string;
}

/** The session writing a file through its own tools. */
export interface SelfWriteEntry {
  t: "write";
  seq: number;
  ms: number;
  path: string;
}

/**
 * A command the session started and later finished. Everything a subprocess writes
 * lands with no author attached, so the window is the only thing that connects
 * `dist/ost-agent.mjs` changing to the run having typed `npm run bundle`.
 */
export interface CommandEntry {
  t: "cmd";
  seq: number;
  ms: number;
  phase: "start" | "end";
  id: string;
  command: string;
}

export type CaptureEntry = FsEventEntry | ReadEntry | SelfWriteEntry | CommandEntry;

export interface SessionCapture {
  sessionId: string;
  /** What the session was doing, in one phrase. */
  label: string;
  entries: CaptureEntry[];
}

/** Read one capture stream. A half-written last line is one fewer event, never a throw. */
export function parseCapture(sessionId: string, label: string, jsonl: string): SessionCapture {
  const entries: CaptureEntry[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as CaptureEntry);
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => a.seq - b.seq);
  return { sessionId, label, entries };
}

// ── the classification ──────────────────────────────────────────────────────

/** Why the rule decided an event was not worth telling the run about. */
export type ChurnReason =
  /** The same path, again, inside {@link FS_EVENT_RULE.coalesceMs}. */
  | "coalesced"
  /** A name an editor or toolchain writes beside the file it is saving. */
  | "scratch-file"
  /** Inside a directory whose contents are never a held file. */
  | "ignored-dir"
  /** git ignores it, so nothing the run reads lives here. */
  | "gitignored"
  /** The run issued this write, directly or through a command it started. */
  | "self-issued"
  /** The run has never read this file, so it holds no copy to invalidate. */
  | "not-held"
  /** The bytes on disk are the bytes the run already has — a formatter's no-op save. */
  | "unchanged-content"
  /** Part of a wave already reported once as a branch operation. */
  | "burst-collapsed";

export interface EventVerdict {
  seq: number;
  ms: number;
  path: string;
  verdict: "meaningful" | "churn";
  reason: ChurnReason | null;
  /** Which invalidation this event raised or was folded into, if any. */
  invalidation: number | null;
}

export interface Invalidation {
  id: number;
  ms: number;
  /** Paths the run was holding that this notification covers. */
  paths: string[];
  /** `true` when it was raised for a wave rather than a single write. */
  burst: boolean;
}

export interface Classification {
  verdicts: EventVerdict[];
  invalidations: Invalidation[];
}

function isScratch(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return FS_EVENT_RULE.scratchPatterns.some((p) => p.test(base));
}

function inIgnoredDir(path: string): boolean {
  const parts = path.split("/");
  return FS_EVENT_RULE.alwaysIgnoredDirs.some((dir) => parts.includes(dir));
}

/**
 * Apply the rule to one capture. The order of the filters is part of the rule:
 * burst detection runs on the wave of external writes *before* the held-file test,
 * because a checkout is a checkout whether or not the run happened to have read
 * three of the files in it.
 */
export function classifyCapture(
  capture: SessionCapture,
  options: { burstFiles?: number } = {},
): Classification {
  const burstFiles = options.burstFiles ?? FS_EVENT_RULE.burstFiles;

  /** Hash of the copy the run holds, by path. Empty until it reads something. */
  const held = new Map<string, string>();
  /** Self-issued writes, by path, with the time they were issued. */
  const selfWrites: { path: string; ms: number }[] = [];
  const commandWindows: { from: number; to: number }[] = [];
  const openCommands = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  /** Head of each path's coalesce group, and the members folded into it. */
  const coalesceHead = new Map<string, number>();
  const coalescedInto = new Map<number, number>();

  const verdicts: EventVerdict[] = [];
  const survivors: { seq: number; ms: number; path: string; heldAt: string | undefined; hash: string | null }[] = [];

  for (const entry of capture.entries) {
    if (entry.t === "read") {
      held.set(entry.path, entry.hash);
      continue;
    }
    if (entry.t === "write") {
      selfWrites.push({ path: entry.path, ms: entry.ms });
      continue;
    }
    if (entry.t === "cmd") {
      if (entry.phase === "start") openCommands.set(entry.id, entry.ms);
      else {
        const from = openCommands.get(entry.id);
        if (from !== undefined) commandWindows.push({ from, to: entry.ms });
        openCommands.delete(entry.id);
      }
      continue;
    }

    const churn = (reason: ChurnReason) =>
      verdicts.push({ seq: entry.seq, ms: entry.ms, path: entry.path, verdict: "churn", reason, invalidation: null });

    const previous = lastSeen.get(entry.path);
    lastSeen.set(entry.path, entry.ms);
    if (previous !== undefined && entry.ms - previous < FS_EVENT_RULE.coalesceMs) {
      // Folded into whatever the head of this path's coalesce group decided. The
      // head has not been scored yet, so the link is recorded and backfilled below.
      churn("coalesced");
      coalescedInto.set(entry.seq, coalesceHead.get(entry.path)!);
      continue;
    }
    coalesceHead.set(entry.path, entry.seq);
    if (isScratch(entry.path)) {
      churn("scratch-file");
      continue;
    }
    if (inIgnoredDir(entry.path)) {
      churn("ignored-dir");
      continue;
    }
    if (entry.gitignored) {
      churn("gitignored");
      continue;
    }
    const issuedHere = selfWrites.some(
      (w) => w.path === entry.path && entry.ms - w.ms >= 0 && entry.ms - w.ms < FS_EVENT_RULE.coalesceMs * 4,
    );
    const insideCommand =
      commandWindows.some((w) => entry.ms >= w.from && entry.ms <= w.to) ||
      [...openCommands.values()].some((from) => entry.ms >= from);
    if (issuedHere || insideCommand) {
      churn("self-issued");
      continue;
    }

    survivors.push({ seq: entry.seq, ms: entry.ms, path: entry.path, heldAt: held.get(entry.path), hash: entry.hash });
  }

  // Bursts are read off the surviving external writes: a wave of more than
  // `burstFiles` distinct paths inside one second is one branch operation.
  const burstOf = new Map<number, number>();
  let burstId = 0;
  for (let i = 0; i < survivors.length; i++) {
    if (burstOf.has(survivors[i].seq)) continue;
    const window: typeof survivors = [];
    for (let j = i; j < survivors.length; j++) {
      if (survivors[j].ms - survivors[i].ms > FS_EVENT_RULE.burstWindowMs) break;
      window.push(survivors[j]);
    }
    if (new Set(window.map((e) => e.path)).size >= burstFiles) {
      for (const e of window) burstOf.set(e.seq, burstId);
      burstId++;
    }
  }

  const invalidations: Invalidation[] = [];
  const byBurst = new Map<number, Invalidation>();

  for (const event of survivors) {
    const churn = (reason: ChurnReason) =>
      verdicts.push({ seq: event.seq, ms: event.ms, path: event.path, verdict: "churn", reason, invalidation: null });

    if (event.heldAt === undefined) {
      churn("not-held");
      continue;
    }
    if (event.hash !== null && event.hash === event.heldAt) {
      churn("unchanged-content");
      continue;
    }

    const burst = burstOf.get(event.seq);
    if (burst !== undefined) {
      const existing = byBurst.get(burst);
      if (existing) {
        existing.paths.push(event.path);
        verdicts.push({
          seq: event.seq,
          ms: event.ms,
          path: event.path,
          verdict: "churn",
          reason: "burst-collapsed",
          invalidation: existing.id,
        });
        continue;
      }
      const raised: Invalidation = { id: invalidations.length, ms: event.ms, paths: [event.path], burst: true };
      invalidations.push(raised);
      byBurst.set(burst, raised);
      verdicts.push({ seq: event.seq, ms: event.ms, path: event.path, verdict: "meaningful", reason: null, invalidation: raised.id });
      continue;
    }

    const raised: Invalidation = { id: invalidations.length, ms: event.ms, paths: [event.path], burst: false };
    invalidations.push(raised);
    verdicts.push({ seq: event.seq, ms: event.ms, path: event.path, verdict: "meaningful", reason: null, invalidation: raised.id });
  }

  // A write folded into an earlier one is not a write the run was never told about.
  // Give every coalesced event the notification its group head raised, so scoring
  // can ask the question that matters — was the run told? — rather than whether
  // this particular event survived the filters.
  const bySeq = new Map(verdicts.map((v) => [v.seq, v]));
  for (const [seq, head] of coalescedInto) {
    const raised = bySeq.get(head)?.invalidation ?? null;
    if (raised === null) continue;
    bySeq.get(seq)!.invalidation = raised;
    const covering = invalidations[raised];
    if (!covering.paths.includes(bySeq.get(seq)!.path)) covering.paths.push(bySeq.get(seq)!.path);
  }

  verdicts.sort((a, b) => a.seq - b.seq);
  return { verdicts, invalidations };
}

// ── the score ───────────────────────────────────────────────────────────────

/**
 * What actually happened, recorded by the capture from the driver's side. The
 * classifier never sees `writer`: knowing which process wrote a file is exactly
 * the thing a watcher cannot know, and it is what makes this a ground truth rather
 * than a second opinion.
 */
export interface EventTruth {
  seq: number;
  writer: "session" | "external";
  /** Did this write invalidate something the run was holding? */
  label: "meaningful" | "churn";
  /** Why, in one phrase, for a reader checking the labelling by hand. */
  why: string;
}

export interface SessionScore {
  sessionId: string;
  label: string;
  /** Every file event the watcher saw, including the run's own writes. */
  events: number;
  /** The denominator the threshold names: events some other process wrote. */
  externalEvents: number;
  correct: number;
  accuracy: number;
  /**
   * The same rate over external events outside {@link FS_EVENT_RULE.alwaysIgnoredDirs}.
   * A `git checkout` writes hundreds of objects under `.git/` and every one of them is
   * an external write the rule gets right for free, so the headline rate can be
   * carried by noise. This is the denominator with that mass removed, and it is the
   * one to read when the two disagree.
   */
  contestedEvents: number;
  contestedCorrect: number;
  contestedAccuracy: number;
  /** Meaningful writes no notification covered — the ones the run is never told about. */
  missed: EventVerdict[];
  /** Churn a notification covered anyway — the ones that cry wolf. */
  falseAlarms: EventVerdict[];
  invalidations: number;
  /** Invalidations no held file actually changed under. */
  unnecessary: number;
  meetsAccuracy: boolean;
  meetsInvalidationCap: boolean;
}

/**
 * Score one session. Accuracy is taken over external write events only — the
 * threshold's own denominator, and the honest one: a run's own writes are the mass
 * of any capture and it knows about them by construction, so counting them would
 * dilute the rate with events nothing could get wrong.
 *
 * An invalidation is unnecessary when not one of the events folded into it is
 * labelled meaningful. A burst that covers one real change and eleven irrelevant
 * ones is a necessary notification, because the run is being told something true.
 */
export function scoreSession(
  capture: SessionCapture,
  classification: Classification,
  truth: EventTruth[],
): SessionScore {
  const truthBySeq = new Map(truth.map((t) => [t.seq, t]));
  const external = classification.verdicts.filter((v) => truthBySeq.get(v.seq)?.writer === "external");

  // "Was the run told about this write?" — not "did this event survive the
  // filters". A write folded into a burst or into an earlier event on the same
  // path is still a write the run was notified of, and counting it as a miss
  // would score the rule against a question nobody asked.
  const told = (v: EventVerdict) => v.invalidation !== null;
  const missed = external.filter((v) => !told(v) && truthBySeq.get(v.seq)!.label === "meaningful");
  const falseAlarms = external.filter((v) => told(v) && truthBySeq.get(v.seq)!.label === "churn");
  const correct = external.length - missed.length - falseAlarms.length;

  const meaningfulSeqs = new Set(truth.filter((t) => t.label === "meaningful").map((t) => t.seq));
  const coveredBy = new Map<number, boolean>();
  for (const v of classification.verdicts) {
    if (v.invalidation === null) continue;
    coveredBy.set(v.invalidation, (coveredBy.get(v.invalidation) ?? false) || meaningfulSeqs.has(v.seq));
  }
  const unnecessary = classification.invalidations.filter((i) => !coveredBy.get(i.id)).length;

  const missedSeqs = new Set(missed.map((v) => v.seq));
  const alarmSeqs = new Set(falseAlarms.map((v) => v.seq));
  const contested = external.filter((v) => !inIgnoredDir(v.path));
  const contestedCorrect = contested.filter((v) => !missedSeqs.has(v.seq) && !alarmSeqs.has(v.seq)).length;

  const accuracy = external.length === 0 ? 1 : correct / external.length;
  return {
    sessionId: capture.sessionId,
    label: capture.label,
    events: classification.verdicts.length,
    externalEvents: external.length,
    correct,
    contestedEvents: contested.length,
    contestedCorrect,
    contestedAccuracy: contested.length === 0 ? 1 : contestedCorrect / contested.length,
    accuracy,
    missed,
    falseAlarms,
    invalidations: classification.invalidations.length,
    unnecessary,
    meetsAccuracy: accuracy >= FS_EVENT_RULE.minAccuracy,
    meetsInvalidationCap: unnecessary <= FS_EVENT_RULE.maxUnnecessaryPerSession,
  };
}

export interface FsEventCensus {
  sessions: SessionScore[];
  externalEvents: number;
  correct: number;
  accuracy: number;
  /** The rate with the `.git`/`node_modules` mass removed — see {@link SessionScore.contestedAccuracy}. */
  contestedEvents: number;
  contestedAccuracy: number;
  meetsAccuracyContested: boolean;
  /** `true` when the headline rate and the contested rate straddle the bar. Say so; never average them. */
  readingDecides: boolean;
  worstUnnecessary: number;
  /** The first clause: the rate, over every external write event in the corpus. */
  meetsAccuracy: boolean;
  /** The second and binding clause: no session over the cap. */
  meetsInvalidationCap: boolean;
  meetsBar: boolean;
  /** How the verdict reads either side of the burst threshold. */
  burstLadder: { burstFiles: number; worstUnnecessary: number; meetsInvalidationCap: boolean }[];
  /** Every churn reason the rule used, and how often — what is actually doing the filtering. */
  churnByReason: Record<string, number>;
}

export function fsEventCensus(
  scored: { capture: SessionCapture; truth: EventTruth[] }[],
): FsEventCensus {
  const sessions = scored.map(({ capture, truth }) =>
    scoreSession(capture, classifyCapture(capture), truth),
  );
  const externalEvents = sessions.reduce((n, s) => n + s.externalEvents, 0);
  const correct = sessions.reduce((n, s) => n + s.correct, 0);
  const worstUnnecessary = sessions.reduce((n, s) => Math.max(n, s.unnecessary), 0);

  const churnByReason: Record<string, number> = {};
  for (const { capture } of scored) {
    for (const v of classifyCapture(capture).verdicts) {
      if (v.reason) churnByReason[v.reason] = (churnByReason[v.reason] ?? 0) + 1;
    }
  }

  const contestedEvents = sessions.reduce((n, s) => n + s.contestedEvents, 0);
  const contestedCorrect = sessions.reduce((n, s) => n + s.contestedCorrect, 0);
  const contestedAccuracy = contestedEvents === 0 ? 1 : contestedCorrect / contestedEvents;

  const accuracy = externalEvents === 0 ? 1 : correct / externalEvents;
  const meetsAccuracy = accuracy >= FS_EVENT_RULE.minAccuracy;
  const meetsAccuracyContested = contestedAccuracy >= FS_EVENT_RULE.minAccuracy;
  const meetsInvalidationCap = worstUnnecessary <= FS_EVENT_RULE.maxUnnecessaryPerSession;

  return {
    sessions,
    externalEvents,
    correct,
    accuracy,
    contestedEvents,
    contestedAccuracy,
    meetsAccuracyContested,
    readingDecides: meetsAccuracy !== meetsAccuracyContested,
    worstUnnecessary,
    meetsAccuracy,
    meetsInvalidationCap,
    meetsBar: meetsAccuracy && meetsAccuracyContested && meetsInvalidationCap,
    burstLadder: FS_EVENT_RULE.burstLadder.map((burstFiles) => {
      const worst = scored.reduce((n, { capture, truth }) => {
        const s = scoreSession(capture, classifyCapture(capture, { burstFiles }), truth);
        return Math.max(n, s.unnecessary);
      }, 0);
      return {
        burstFiles,
        worstUnnecessary: worst,
        meetsInvalidationCap: worst <= FS_EVENT_RULE.maxUnnecessaryPerSession,
      };
    }),
    churnByReason,
  };
}

export function formatFsEventCensus(census: FsEventCensus): string {
  const lines: string[] = [];
  lines.push("Filesystem events — meaningful external write, or churn?");
  lines.push(
    `Rate: ${census.correct} of ${census.externalEvents} external write events classified correctly ` +
      `(${(census.accuracy * 100).toFixed(1)}%, bar ${FS_EVENT_RULE.minAccuracy * 100}%) — ` +
      `${census.meetsAccuracy ? "MET" : "NOT MET"}.`,
  );
  lines.push(
    `With the .git/node_modules mass removed: ${(census.contestedAccuracy * 100).toFixed(1)}% of ` +
      `${census.contestedEvents} contested events — ${census.meetsAccuracyContested ? "MET" : "NOT MET"}.` +
      (census.readingDecides ? " THE READING DECIDES THIS." : ""),
  );
  lines.push(
    `THE BINDING CLAUSE: worst session raised ${census.worstUnnecessary} unnecessary invalidation(s), ` +
      `cap is ${FS_EVENT_RULE.maxUnnecessaryPerSession} — ${census.meetsInvalidationCap ? "MET" : "NOT MET"}.`,
  );
  for (const s of census.sessions) {
    lines.push(
      `  ${s.sessionId} (${s.label}) — ${s.events} events, ${s.externalEvents} external, ` +
        `${(s.accuracy * 100).toFixed(1)}% correct, ${s.invalidations} invalidation(s), ` +
        `${s.unnecessary} unnecessary`,
    );
  }
  const filters = Object.entries(census.churnByReason).sort((a, b) => b[1] - a[1]);
  lines.push(`Filtering was done by: ${filters.map(([r, n]) => `${r} ${n}`).join(", ")}.`);
  lines.push("This says a rule can sort these events. It does not say the run acts better for being told.");
  return lines.join("\n");
}
