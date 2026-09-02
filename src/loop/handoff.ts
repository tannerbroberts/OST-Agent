/**
 * The handoff record — what a pass writes down when the only thing left to do is
 * wait, so that the pass can end there and the finished check can start the next
 * one.
 *
 * The opportunity behind this is measured rather than imagined: twenty captured
 * sessions, fourteen distinct pull requests, the same `sleep N; <check>` reflex
 * refused every time (meta vault, "My loop spends its time waiting for a check it
 * cannot subscribe to", census window 2026-07-24 → 2026-08-06). `wait.ts` answers
 * the half where the wait is short enough to hold — it makes the permitted form
 * cheaper to write than the blocked one. This module answers the other half, the
 * one no shim can reach: **a wait that outlives the session is not a wait, it is a
 * boundary.** The pass records where it got to, exits, and costs nothing while the
 * check runs, because nothing is running.
 *
 * ## Why the record has to refuse itself
 *
 * The candidate's own assumption test names the failure worth catching, and it is
 * not a crash: *"a resumed pass that quietly starts from a different understanding
 * than the one that stopped … will proceed confidently, and everything it builds
 * on the wrong belief looks finished."* A resumed build pass that cannot recall
 * which PR it pushed does not stop — it merges whatever `gh` hands back first.
 *
 * So state is not optional metadata here, it is the contract, and it is enforced
 * twice on purpose:
 *
 *   - **At capture** ({@link captureHandoff}), because that is the only moment the
 *     process that KNOWS the missing fact is still alive. A handoff that could not
 *     be resumed is refused while it can still be fixed, rather than discovered
 *     three hours later by a pass with nowhere to get the answer from.
 *   - **At resume** ({@link drivePass}), because a record can be truncated by a
 *     kill mid-append, hand-edited, or written by a version of this file that knew
 *     different fields. A reader that filled the gap with a default would be the
 *     confident-and-wrong pass the test exists to catch.
 *
 * Every step therefore declares the keys it reads ({@link PassStep.needs}) and
 * nothing may read outside that declaration. That is the whole mechanism: the
 * record is complete when every remaining step's declared needs are in it, and
 * that is a property a machine can check.
 *
 * ## What this cannot check, stated plainly
 *
 * {@link HandoffRecord.holding} is a flat map of strings, so what survives the
 * handoff is exactly what the pass knew it was holding and wrote down. Whatever it
 * held implicitly — a reading of the tree it never named, a judgement it never
 * turned into a key — is absent from the record and therefore absent from every
 * comparison here. The solution node concedes this in its own words and it is not
 * a gap this file can close: a fact that was never a candidate for serialisation
 * cannot be missed by a check over serialised facts.
 *
 * ## Append-only, like the journal, and for the same reason
 *
 * The log is `handoff.jsonl` beside `journal.jsonl` in the loop state directory
 * (`state.ts` argues why that is inside `.git/`). Resumption appends a `resumed`
 * line rather than deleting the handoff: nothing here removes a file, so a pass
 * killed between reading the record and acting on it leaves the record intact, and
 * the account of which handoffs were taken up is auditable after the fact instead
 * of being the absence of a file.
 */
import fs from "node:fs";
import path from "node:path";
import { requireLoopStateDir, loopStateDir } from "./state.js";
import { permittedWait } from "./wait.js";

/**
 * The shape this file writes and the only shape it will resume from.
 *
 * Bumped when a field a resumer depends on changes meaning. A record carrying an
 * unrecognised version is NOT silently skipped — see {@link nextAction}.
 */
export const HANDOFF_VERSION = 1;

/** What a pass is waiting on: a condition, and why it is worth waiting for. */
export interface WaitPoint {
  /**
   * Names the thing waited on, not the attempt — `ci:17`, not `wait 3` — because
   * a resumed pass has to recognise it across a process boundary, exactly as
   * `ResumableStep.id` names an effect rather than a position.
   */
  readonly id: string;
  /**
   * The condition as a shell command whose zero exit means "the check finished".
   * A command, never a description of one: this is what {@link handoffWake}
   * hands to the shim, and a description would need a person to translate it.
   */
  readonly condition: string;
  /** What is being waited for, in the pass's own words. */
  readonly why: string;
}

/** One unit of a pass, as the plan carries it. */
export interface PassStep {
  /** Names the effect. Matched against {@link HandoffRecord.completed}. */
  readonly id: string;
  /** What a human reads to know what this step does. */
  readonly command: string;
  /**
   * The keys of {@link HandoffRecord.holding} this step reads.
   *
   * Declared rather than inferred, because inference is what makes invention
   * invisible: a step that reaches for a fact it never declared gets whatever
   * happens to be lying around, and that is precisely the quiet wrong start this
   * whole module is built against.
   */
  readonly needs: readonly string[];
  /** Present when this step cannot begin until `waitsFor` holds. */
  readonly waitsFor?: WaitPoint;
}

/** What a pass actually did, in the order it did it. */
export interface PassAction {
  readonly stepId: string;
  readonly command: string;
}

/** A pass ended at a wait, and this is everything the next one needs. */
export interface HandoffRecord {
  readonly kind: "handoff";
  readonly version: number;
  /** The run that stopped here. */
  readonly runId: string;
  readonly at: string;
  /** The wait it stopped at. Its condition is what wakes the next pass. */
  readonly wait: WaitPoint;
  /** Step ids already finished. A resumed pass runs none of these again. */
  readonly completed: readonly string[];
  /** The plan from the wait onward, in order — the record carries the plan so a
   * fresh process needs nothing but this file. */
  readonly remaining: readonly PassStep[];
  /** Everything the pass knew it was holding, by name. */
  readonly holding: Readonly<Record<string, string>>;
}

/** A later pass took up a handoff. Appended; the handoff line stays. */
export interface HandoffResumed {
  readonly kind: "resumed";
  readonly version: number;
  /** The run that took it up. */
  readonly runId: string;
  readonly at: string;
  /** The `runId` of the handoff being taken up. */
  readonly handoffRunId: string;
}

export type HandoffLine = HandoffRecord | HandoffResumed;

/**
 * A record that cannot answer what the next step is about to ask.
 *
 * A distinct class rather than a bare `Error` so a caller can tell "this handoff
 * is incomplete" from "the disk is gone" — the first is a bug in how the pass
 * declared its state and is fixable at the call site; the second is not.
 */
export class HandoffGapError extends Error {
  constructor(
    readonly stepId: string,
    readonly missing: readonly string[],
  ) {
    super(
      `step "${stepId}" needs ${missing.map((k) => `\`${k}\``).join(", ")}, and the handoff record does not carry ` +
        `${missing.length === 1 ? "it" : "them"}. A resumed pass may not supply what the pass that stopped never wrote ` +
        "down — add the key to the handoff's `holding`, or drop it from the step's `needs` (src/loop/handoff.ts).",
    );
    this.name = "HandoffGapError";
  }
}

/** Keys `step` reads that `holding` does not carry, in declaration order. */
function missingFor(step: PassStep, holding: Readonly<Record<string, string>>): string[] {
  return step.needs.filter((key) => !Object.prototype.hasOwnProperty.call(holding, key));
}

/**
 * Build the record a pass leaves at a wait, or throw naming what is missing.
 *
 * The throw is the feature. This runs inside the pass that is about to end, which
 * is the last moment anything knows the value it forgot to record; a capture that
 * accepted an unresumable record would move the failure to a process that has no
 * way to recover it.
 */
export function captureHandoff(input: {
  runId: string;
  at: string;
  wait: WaitPoint;
  completed: readonly string[];
  remaining: readonly PassStep[];
  holding: Readonly<Record<string, string>>;
}): HandoffRecord {
  for (const step of input.remaining) {
    const missing = missingFor(step, input.holding);
    if (missing.length > 0) throw new HandoffGapError(step.id, missing);
  }
  return {
    kind: "handoff",
    version: HANDOFF_VERSION,
    runId: input.runId,
    at: input.at,
    wait: input.wait,
    completed: [...input.completed],
    remaining: input.remaining.map((s) => ({ ...s, needs: [...s.needs] })),
    holding: { ...input.holding },
  };
}

/**
 * What a pass resumed from this record will do first — the comparison the
 * assumption test is built around.
 *
 * Refuses rather than guesses in both directions it can be wrong. An
 * unrecognised `version` throws instead of reading as "nothing to do", because a
 * record this code cannot understand and an absent record are different facts and
 * a caller acting on the second as the first sleeps through work that was handed
 * to it. A step whose needs the record cannot meet throws for the reason the file
 * header gives.
 */
export function nextAction(record: HandoffRecord): PassAction | null {
  if (record.version !== HANDOFF_VERSION) {
    throw new Error(
      `handoff record from run ${record.runId} declares version ${record.version}; this build resumes version ` +
        `${HANDOFF_VERSION} only. Reading it with the wrong field meanings is how a resumed pass proceeds ` +
        "confidently from a different understanding (src/loop/handoff.ts).",
    );
  }
  const step = record.remaining.find((s) => !record.completed.includes(s.id));
  if (step === undefined) return null;
  const missing = missingFor(step, record.holding);
  if (missing.length > 0) throw new HandoffGapError(step.id, missing);
  return { stepId: step.id, command: step.command };
}

/** How a pass treats a wait whose condition does not hold yet. */
export type WaitPolicy =
  /** Hold it open in-process and carry on — what a pass does when it cannot hand off. */
  | "hold"
  /** Record where we got to and end the pass here. */
  | "handoff";

export interface DriveOptions {
  /** The run doing the driving — stamped on any record it leaves. */
  readonly runId: string;
  /** The record's timestamp, supplied by the caller so a driven pass is deterministic. */
  readonly at: string;
  /** What to do at a wait that has not finished. */
  readonly onUnfinishedWait: WaitPolicy;
  /**
   * True when the thing this wait names has already finished. A pass woken BY a
   * check answers true for that check and nothing else — which is what lets a
   * plan with two waits hand off twice rather than blocking on the second.
   */
  readonly finished?: (wait: WaitPoint) => boolean;
  /** Step ids already done. They are not run again and not reported as actions. */
  readonly completed?: readonly string[];
}

export interface PassOutcome {
  /** What this pass did, in order. Excludes anything skipped as already done. */
  readonly actions: readonly PassAction[];
  /** Present when the pass ended at a wait rather than finishing its plan. */
  readonly handoff?: HandoffRecord;
}

/**
 * Run a plan, and either hold its waits open or end at the first one that has not
 * finished.
 *
 * One driver for both halves of the comparison on purpose. If the original pass
 * and the resumed pass ran through different code, "it took the same next action"
 * would be a claim about two implementations agreeing rather than about the record
 * being sufficient, and the instrument would go green on a mechanism that does not
 * exist.
 */
export function drivePass(
  plan: readonly PassStep[],
  holding: Readonly<Record<string, string>>,
  opts: DriveOptions,
): PassOutcome {
  const done = new Set(opts.completed ?? []);
  const finished = opts.finished ?? (() => false);
  const actions: PassAction[] = [];
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    if (done.has(step.id)) continue;
    if (step.waitsFor !== undefined && !finished(step.waitsFor) && opts.onUnfinishedWait === "handoff") {
      const handoff = captureHandoff({
        runId: opts.runId,
        at: opts.at,
        wait: step.waitsFor,
        completed: [...done],
        remaining: plan.slice(i),
        holding,
      });
      return { actions, handoff };
    }
    // Checked even in `hold`, where nothing is being resumed: a step that reads a
    // fact the pass never named is a step whose handoff would be incomplete, and
    // finding that out on the run that CAN still name it is the cheap version.
    const missing = missingFor(step, holding);
    if (missing.length > 0) throw new HandoffGapError(step.id, missing);
    actions.push({ stepId: step.id, command: step.command });
    done.add(step.id);
  }
  return { actions };
}

/**
 * Continue a handed-off pass from the record and nothing else.
 *
 * The signature is the claim: a `HandoffRecord`, and no plan, no holding and no
 * reference to the process that stopped. Anything this needs that is not in the
 * record is a hole in the record, and it will be raised as one.
 *
 * The wait that woke this pass counts as finished — that is what the wake MEANS —
 * and every other wait in the remainder does not, so a plan with a second wait
 * hands off again instead of blocking.
 */
export function resumePass(record: HandoffRecord, opts: { runId: string; at: string }): PassOutcome {
  if (record.version !== HANDOFF_VERSION) {
    // Same refusal as `nextAction`, raised before any work is attempted.
    nextAction(record);
  }
  return drivePass(record.remaining, record.holding, {
    runId: opts.runId,
    at: opts.at,
    onUnfinishedWait: "handoff",
    finished: (w) => w.id === record.wait.id,
    completed: record.completed,
  });
}

/**
 * The one line that turns a handoff into a wake: wait for the condition, then run
 * the command that starts the next pass.
 *
 * Built on `wait.ts`'s shim rather than on a fresh construct, because the two
 * halves of this branch are answering one opportunity and the shim is the form
 * this environment does not refuse. `&&`, not `;` — a wait that gave up did not
 * observe the check finishing, and starting the next pass anyway would resume on
 * the strength of a timeout.
 */
export function handoffWake(record: HandoffRecord, resumeCommand?: string): string {
  const wait = permittedWait(record.wait.condition);
  return resumeCommand === undefined || resumeCommand.length === 0 ? wait : `${wait} && ${resumeCommand}`;
}

/** What an operator reads to see what is parked and what would restart it. */
export function renderHandoff(record: HandoffRecord, resumeCommand?: string): string[] {
  const lines = [
    `handoff: run ${record.runId} ended at "${record.wait.id}" (${record.at})`,
    `  waiting for: ${record.wait.why}`,
    `  wake it with: ${handoffWake(record, resumeCommand)}`,
  ];
  let next: PassAction | null;
  try {
    next = nextAction(record);
  } catch (e) {
    lines.push(`  next: UNRESUMABLE — ${e instanceof Error ? e.message : String(e)}`);
    return lines;
  }
  lines.push(next === null ? "  next: nothing — the plan is finished" : `  next: ${next.stepId} — ${next.command}`);
  lines.push(
    `  ${record.completed.length} step(s) already done, ${record.remaining.length} to go; ` +
      `holding ${Object.keys(record.holding).length} fact(s): ${Object.keys(record.holding).sort().join(", ") || "none"}`,
  );
  return lines;
}

export function handoffPath(dir: string): string {
  return path.join(requireLoopStateDir(dir), "handoff.jsonl");
}

export function appendHandoff(dir: string, line: HandoffLine): void {
  fs.appendFileSync(handoffPath(dir), JSON.stringify(line) + "\n");
}

/**
 * Every readable handoff line, in the order it was written.
 *
 * A line that does not parse is skipped, for the reason `journal.ts` gives: a
 * process killed mid-append leaves a truncated final line, and the lines before it
 * are intact. A line whose `version` is unrecognised is KEPT — refusing to read it
 * would turn a record this build cannot understand into no record at all, and the
 * refusal belongs where somebody sees it (`nextAction`) rather than here.
 */
export function readHandoffLog(dir: string): HandoffLine[] {
  const state = loopStateDir(dir);
  if (state === null) return [];
  const p = path.join(state, "handoff.jsonl");
  if (!fs.existsSync(p)) return [];
  const lines: HandoffLine[] = [];
  for (const raw of fs.readFileSync(p, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw) as HandoffLine;
      if (typeof parsed?.runId !== "string") continue;
      if (parsed?.kind !== "handoff" && parsed?.kind !== "resumed") continue;
      lines.push(parsed);
    } catch {
      /* truncated or corrupt line — the entries around it are still the record */
    }
  }
  return lines;
}

/**
 * The handoff waiting to be taken up: the last one written that no `resumed` line
 * claims. Null when there is none.
 *
 * Last rather than first, because a pass that hands off twice in a chain leaves
 * two records and the live one is the newest; and matched by `runId` rather than
 * by position, because a `resumed` line can be appended by a process that is not
 * the next line in the file.
 */
export function pendingHandoff(dir: string): HandoffRecord | null {
  const lines = readHandoffLog(dir);
  const taken = new Set(lines.filter((l): l is HandoffResumed => l.kind === "resumed").map((l) => l.handoffRunId));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.kind === "handoff" && !taken.has(line.runId)) return line;
  }
  return null;
}

/** Record that `record` has been taken up, so the pass after this one does not take it again. */
export function markResumed(dir: string, record: HandoffRecord, by: { runId: string; at: string }): void {
  appendHandoff(dir, {
    kind: "resumed",
    version: HANDOFF_VERSION,
    runId: by.runId,
    at: by.at,
    handoffRunId: record.runId,
  });
}
