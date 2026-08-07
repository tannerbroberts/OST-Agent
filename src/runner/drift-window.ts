/**
 * The drift window — how much room a between-steps sentinel would have had.
 *
 * A run reads a file, works for a while, and then edits it. If something else
 * moved the ground in between — a merge landing on `HEAD`, an editor saving over
 * a file the run has in context — the edit either applies to text the run never
 * saw or fails with `String to replace not found in file`, which is the same
 * error the run gets when it simply quoted the file wrong. The candidate under
 * test is a sentinel that samples `HEAD` and the mtime of every file read this
 * pass *between steps*, and interrupts when the fingerprint moves.
 *
 * Sampling between steps only helps if there were steps to sample in. This module
 * measures that distance on sessions that already happened: for each recorded
 * collision, the step at which the transcript first *proves* the ground moved, and
 * the step at which the run first acted on stale content. The gap between them is
 * the window a sentinel would have fired in.
 *
 * ## What the record can and cannot say
 *
 * A transcript is not an mtime log. Movement is only visible here when some tool
 * result happened to mention it, so a measured window is a **lower bound**: the
 * mtime advanced at or before the step that reported it, never after. That cuts
 * the right way — it understates the sentinel's room rather than inventing it.
 *
 * The same limit means a session with no movement event is `unseen`, not
 * `no-movement`. Nothing in the record says the ground held still; it says the
 * record never proved it moved. Counting `unseen` as a failure would be reading a
 * gap in the instrument as a fact about the world, so it is reported as coverage.
 *
 * ## Why the tool a result came from decides whether it is evidence
 *
 * The phrase `String to replace not found in file` appears in far more sessions
 * than it happens in. This vault's own nodes quote it — they are nodes *about*
 * this failure — so `ost_next_work` and `Read` hand it back to the agent as data,
 * and a `Bash` grep looking for collisions prints it once per match. Counting
 * every session whose text contains the phrase found 44 of them; counting only
 * sessions where an **edit tool actually returned it as an error** found 9. The
 * other 35 are the tree talking about the bug, not the bug. {@link replaySession}
 * therefore keys every signal to the tool that produced it, and keeps the loose
 * text matches separately as {@link SessionReplay.mentions} so the difference
 * stays visible rather than becoming a quietly larger denominator.
 */
import type { TranscriptSession } from "../telemetry/preflight.js";

/**
 * The bar, and the readings of it, fixed here before the corpus was counted.
 *
 * The assumption test beneath the sentinel states the threshold: *in at least 3
 * of the recorded collision sessions, two or more run steps separate the first
 * detectable movement from the first act on stale content.* Both numbers are
 * below, along with the ladders that say whether the verdict turns on where they
 * were put.
 */
export const DRIFT_WINDOW_RULE = {
  /** Run steps that must separate movement from the stale act for a sentinel to have room. */
  minSteps: 2,
  /** Collision sessions that must clear {@link minSteps}. */
  bar: 3,
  /** Readings of "enough room", so the verdict can be read at more than one strictness. */
  stepLadder: [1, 2, 4, 8, 16],
  /**
   * Tools that write a file through text the run is holding in context. Only their
   * results are read for signals — see the module note on why the tool decides.
   */
  editTools: ["Edit", "MultiEdit", "NotebookEdit", "Write"],
  /**
   * How much of a tool result is read. Every marker below appears within the first
   * line of a result, well inside this; the cap exists so the committed corpus can
   * store exactly what the reader looks at and nothing more.
   */
  resultHeadChars: 300,
} as const;

/** The text a loose scan would match, kept so its overcount can be measured. */
export const COLLISION_PHRASE = /String to replace not found in file/;

/** An edit that landed, on a file that had already moved under the run. */
const APPLIED_OVER_DRIFT = /modified on disk since you last read it/;

/** An edit the harness refused because the file moved after the run read it. */
const REFUSED_STALE_READ = /File has been modified since read/;

/** How the record proved the ground moved. */
export type MovementKind =
  /** The harness reported a file the session had read being edited outside it. */
  | "external-edit"
  /** An edit applied, and the result noted the file already held changes the run had not seen. */
  | "applied-over-drift"
  /** An edit was refused outright because the file had moved since the run read it. */
  | "refused-stale-read";

/** One tool call, in the order the run made it. */
export interface RunStep {
  /** Position in the run, counting tool calls only. This is the unit the window is measured in. */
  index: number;
  tool: string;
  /** The file the call names, when it names one. */
  file?: string;
  isError: boolean;
  /** First {@link DRIFT_WINDOW_RULE.resultHeadChars} characters of the result. */
  resultHead: string;
}

/** A step at which the record proves the ground had moved. */
export interface MovementEvent {
  step: number;
  kind: MovementKind;
  file?: string;
}

/** A step at which the run acted on content that had gone stale. */
export interface StaleAct {
  step: number;
  file?: string;
}

/** A step whose result merely *contains* the phrase, whoever produced it. */
export interface PhraseMention {
  step: number;
  tool: string;
}

export interface SessionReplay {
  sessionId: string;
  /** Where the transcript came from, in one phrase — a session, or a subagent under one. */
  origin: string;
  /** Total tool calls in the session, so a window can be read against the run's length. */
  stepCount: number;
  movements: MovementEvent[];
  staleActs: StaleAct[];
  /** Every step whose result text matched {@link COLLISION_PHRASE}, tool included. */
  mentions: PhraseMention[];
}

interface ReplayInput {
  session: TranscriptSession;
  origin: string;
}

/**
 * Read one transcript into the steps, movements and stale acts it records.
 *
 * `mentionsPhrase` on a reduced entry lets a committed corpus carry the loose
 * text match without carrying the megabytes of tool output it was found in; a
 * live transcript has no such field and the full result is scanned instead.
 */
export function replaySession({ session, origin }: ReplayInput): SessionReplay {
  const edits = new Set<string>(DRIFT_WINDOW_RULE.editTools);
  const steps: RunStep[] = [];
  const byToolUseId = new Map<string, number>();
  const movements: MovementEvent[] = [];
  const mentions: PhraseMention[] = [];

  for (const line of session.jsonl.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, any>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a half-written last line is one fewer step, never a parse failure
    }

    // The harness noticing a tracked file change outside the run. This is the only
    // movement signal that does not need the run to touch the file to surface.
    if (entry.type === "attachment" && entry.attachment?.type === "edited_text_file") {
      movements.push({ step: steps.length, kind: "external-edit", file: entry.attachment.filename });
      continue;
    }

    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block?.type === "tool_use" && entry.type === "assistant") {
        byToolUseId.set(block.id, steps.length);
        steps.push({ index: steps.length, tool: block.name, file: block.input?.file_path, isError: false, resultHead: "" });
        continue;
      }
      if (block?.type !== "tool_result") continue;
      const at = byToolUseId.get(block.tool_use_id);
      if (at === undefined) continue; // a result for a call this transcript does not hold
      const step = steps[at];
      const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
      step.resultHead = text.slice(0, DRIFT_WINDOW_RULE.resultHeadChars);
      step.isError = Boolean(block.is_error);
      if (block.mentionsPhrase ?? COLLISION_PHRASE.test(text)) mentions.push({ step: at, tool: step.tool });
    }
  }

  for (const step of steps) {
    if (!edits.has(step.tool)) continue;
    if (APPLIED_OVER_DRIFT.test(step.resultHead)) {
      movements.push({ step: step.index, kind: "applied-over-drift", file: step.file });
    }
    if (REFUSED_STALE_READ.test(step.resultHead)) {
      movements.push({ step: step.index, kind: "refused-stale-read", file: step.file });
    }
  }
  movements.sort((a, b) => a.step - b.step);

  const staleActs = steps
    .filter((s) => edits.has(s.tool) && s.isError && COLLISION_PHRASE.test(s.resultHead))
    .map((s) => ({ step: s.index, file: s.file }));

  return { sessionId: session.id, origin, stepCount: steps.length, movements, staleActs, mentions };
}

/** What the record says about one collision session. */
export type SessionVerdict =
  /** Movement was proved at least {@link DRIFT_WINDOW_RULE.minSteps} steps before the stale act. */
  | "room"
  /** Movement was proved, but too close to the stale act for a between-steps sample to land. */
  | "too-late"
  /** No movement is provable from this transcript. Coverage, not a negative result. */
  | "unseen";

export interface SessionWindow {
  sessionId: string;
  origin: string;
  stepCount: number;
  /** The step the run first acted on stale content. */
  staleAct: number;
  /** First proved movement anywhere in the run, and the gap to the stale act. */
  movement: MovementEvent | null;
  windowSteps: number | null;
  /**
   * The same measurement restricted to movement in *the file that later failed*.
   * The sentinel under test interrupts on any movement, so the headline uses the
   * unrestricted reading — but a same-file movement is the unambiguous case, and
   * the two do not agree on this corpus, so both are carried.
   */
  sameFileMovement: MovementEvent | null;
  sameFileWindowSteps: number | null;
  verdict: SessionVerdict;
}

/** Measure one replay. Returns null for a session that records no collision at all. */
export function measureWindow(replay: SessionReplay, minSteps = DRIFT_WINDOW_RULE.minSteps): SessionWindow | null {
  const first = replay.staleActs[0];
  if (!first) return null;

  const before = replay.movements.filter((m) => m.step < first.step);
  const movement = before[0] ?? null;
  const sameFileMovement = before.find((m) => m.file !== undefined && m.file === first.file) ?? null;
  const windowSteps = movement ? first.step - movement.step : null;

  return {
    sessionId: replay.sessionId,
    origin: replay.origin,
    stepCount: replay.stepCount,
    staleAct: first.step,
    movement,
    windowSteps,
    sameFileMovement,
    sameFileWindowSteps: sameFileMovement ? first.step - sameFileMovement.step : null,
    verdict: windowSteps === null ? "unseen" : windowSteps >= minSteps ? "room" : "too-late",
  };
}

/**
 * One line per session whose *text* holds the phrase — the loose set, five times
 * larger than the set of sessions the failure happened in. Carried separately
 * from the replays because these sessions have no bodies committed: the only
 * thing the census needs from them is which tool handed the phrase over.
 */
export interface SessionMention {
  sessionId: string;
  origin: string;
  /** Whether an edit tool returned the phrase as an error. */
  collision: boolean;
  mentions: PhraseMention[];
}

export interface DriftWindowCensus {
  /** Transcripts read to build the corpus, whether or not they held anything. */
  transcriptsRead: number;
  /** Sessions whose text contains the phrase, however it got there. */
  mentioningSessions: number;
  /** Sessions where an edit tool actually returned it as an error. */
  collisionSessions: number;
  windows: SessionWindow[];
  /** Collision sessions with at least {@link DRIFT_WINDOW_RULE.minSteps} steps of room. */
  withRoom: number;
  tooLate: number;
  unseen: number;
  meetsBar: boolean;
  /** The same count under the stricter same-file reading of movement. */
  withRoomSameFile: number;
  meetsBarSameFile: boolean;
  /** `true` when the two readings disagree about the verdict — say so, never average them. */
  readingDecides: boolean;
  /** How many sessions clear each rung of {@link DRIFT_WINDOW_RULE.stepLadder}. */
  stepLadder: { minSteps: number; withRoom: number; meetsBar: boolean }[];
  /** Which tool delivered each loose text match, across every mentioning session. */
  mentionsByTool: Record<string, number>;
}

export function driftWindowCensus(
  replays: SessionReplay[],
  meta: { transcriptsRead: number; mentioned: SessionMention[] },
): DriftWindowCensus {
  const windows = replays.map((r) => measureWindow(r)).filter((w): w is SessionWindow => w !== null);
  const withRoom = windows.filter((w) => w.verdict === "room").length;
  const withRoomSameFile = windows.filter(
    (w) => w.sameFileWindowSteps !== null && w.sameFileWindowSteps >= DRIFT_WINDOW_RULE.minSteps,
  ).length;

  const mentionsByTool: Record<string, number> = {};
  for (const session of meta.mentioned) {
    for (const mention of session.mentions) {
      mentionsByTool[mention.tool] = (mentionsByTool[mention.tool] ?? 0) + 1;
    }
  }

  const meetsBar = withRoom >= DRIFT_WINDOW_RULE.bar;
  const meetsBarSameFile = withRoomSameFile >= DRIFT_WINDOW_RULE.bar;

  return {
    transcriptsRead: meta.transcriptsRead,
    mentioningSessions: meta.mentioned.length,
    collisionSessions: windows.length,
    windows,
    withRoom,
    tooLate: windows.filter((w) => w.verdict === "too-late").length,
    unseen: windows.filter((w) => w.verdict === "unseen").length,
    meetsBar,
    withRoomSameFile,
    meetsBarSameFile,
    readingDecides: meetsBar !== meetsBarSameFile,
    stepLadder: DRIFT_WINDOW_RULE.stepLadder.map((minSteps) => {
      const n = windows.filter((w) => w.windowSteps !== null && w.windowSteps >= minSteps).length;
      return { minSteps, withRoom: n, meetsBar: n >= DRIFT_WINDOW_RULE.bar };
    }),
    mentionsByTool,
  };
}

export function formatDriftWindowCensus(census: DriftWindowCensus): string {
  const lines: string[] = [];
  lines.push("Drift window — room a between-steps sentinel would have had");
  lines.push(
    `Coverage: ${census.transcriptsRead} transcripts read, ${census.mentioningSessions} mention the failure, ` +
      `${census.collisionSessions} actually recorded one.`,
  );
  lines.push(
    `${census.withRoom} of ${census.collisionSessions} had ${DRIFT_WINDOW_RULE.minSteps}+ steps of room ` +
      `(bar is ${DRIFT_WINDOW_RULE.bar}) — ${census.meetsBar ? "MET" : "NOT MET"}.`,
  );
  lines.push(
    `${census.unseen} record no movement at all; that is coverage, not a still ground — ` +
      "a transcript only shows drift a tool happened to report.",
  );
  if (census.readingDecides) {
    lines.push(
      `THE READING DECIDES THIS: any movement gives ${census.withRoom}, movement in the failing file ` +
        `gives ${census.withRoomSameFile}, and the bar is ${DRIFT_WINDOW_RULE.bar}.`,
    );
  }
  for (const w of census.windows) {
    const window = w.windowSteps === null ? "no movement seen" : `${w.windowSteps} steps`;
    const same = w.sameFileWindowSteps === null ? "none" : `${w.sameFileWindowSteps} steps`;
    lines.push(
      `  ${w.sessionId} (${w.origin}) — stale act at step ${w.staleAct} of ${w.stepCount}; ` +
        `window ${window}, same-file ${same} [${w.verdict}]`,
    );
  }
  lines.push("This measures whether a sentinel would have had time to fire. It does not say firing helps.");
  return lines.join("\n");
}
