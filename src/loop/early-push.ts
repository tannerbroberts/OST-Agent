/**
 * The early-push cadence — accept the collision and shrink it.
 *
 * The failure this bounds was observed once, in full ("Two agents sharing my
 * vault can trample each other", 2026-07-26). A pass cloned a clean repo at
 * 00:47Z, built for eight hours, committed at 08:46Z, and had its push rejected
 * at 08:47Z: a different session had pushed the same feature at 02:56Z. The
 * detector — git refusing a non-fast-forward push — worked perfectly. It simply
 * ran once, eight hours in.
 *
 * This module changes only *when* that detector fires. A pass that pushes a
 * skeleton commit as it starts and keeps pushing on a cadence meets the same
 * rejection at the same fidelity while it has spent almost nothing. No new
 * judgement is added: no matching heuristic to mis-tune, no expiry to mis-set.
 * `src/loop/claim.ts` exists to *prevent* the duplicate; this is the floor
 * under it, bounding the loss when prevention misses.
 *
 * ## What the bound honestly is, and is not
 *
 * The loss this shrinks is time-since-the-colliding-commit, not
 * time-since-the-pass-started. The losing pass began over two hours before
 * anything existed to collide with, and no cadence recovers those hours: every
 * push before 02:56Z succeeds and tells the pass nothing. The bound a cadence
 * of N minutes buys is "rejection within N minutes of the colliding commit
 * landing" — on the recorded timeline, roughly 3.5 hours saved of the 8 spent,
 * never "minutes" in total. {@link pushSchedule} makes that a computable fact
 * and the spec pins it.
 *
 * ## The blind spot, inherited undiminished
 *
 * Rejection requires divergent history on one branch. Two passes on separate
 * branches, or building non-overlapping duplicates of one intent, produce no
 * rejection at any cadence. This module covers only the shape of collision
 * that has actually been caught, and a green spec here says nothing about the
 * others. It also puts unfinished work on a shared branch — a policy cost some
 * repositories will refuse outright, which is a question for people, not code.
 *
 * ## Why the git drivers are injected
 *
 * `src/git/safe-git.ts` is the one file that decides what git this project can
 * run and the only call that can reach a network. A replay harness that cloned
 * and pushed on its own would be a second door. So {@link replayCollisionWindow}
 * owns the schedule, the event order and the measurement, and the caller hands
 * it the two operations the timeline needs — in the spec, real git against a
 * real bare remote, so the rejection measured is git's verdict and not this
 * module agreeing with itself.
 */

/** The recorded timeline, UTC milliseconds, so specs and callers share one. */
export const RECORDED_COLLISION = {
  /** The losing pass cloned a clean repo and started building. */
  passStartedAt: Date.parse("2026-07-26T00:47:00Z"),
  /** The other session's push landed on the shared branch. */
  collidingCommitAt: Date.parse("2026-07-26T02:56:00Z"),
  /** The losing pass pushed once, eight hours in, and was rejected. */
  finalPushAt: Date.parse("2026-07-26T08:47:00Z"),
} as const;

/**
 * When a pass on this cadence pushes, from `startMs` to `endMs` inclusive.
 *
 * The first push is at `startMs` itself — the skeleton push, made before there
 * is anything worth having, because its only job is to stake the branch and
 * meet a rejection early. Then every `cadenceMs` after, and always the final
 * push at `endMs` (the commit the pass actually built), deduplicated if a tick
 * lands on it exactly.
 */
export function pushSchedule(startMs: number, endMs: number, cadenceMs: number): number[] {
  if (!Number.isFinite(cadenceMs) || cadenceMs <= 0) {
    throw new Error(`a push cadence must be a positive number of milliseconds, got ${cadenceMs}`);
  }
  if (endMs < startMs) {
    throw new Error("a push schedule cannot end before it starts");
  }
  const ticks: number[] = [];
  for (let t = startMs; t <= endMs; t += cadenceMs) ticks.push(t);
  if (ticks[ticks.length - 1] !== endMs) ticks.push(endMs);
  return ticks;
}

/** One push the replay drove, stamped with the timeline's clock. */
export interface ReplayPush {
  /** ISO timestamp on the replayed timeline, not the wall clock. */
  at: string;
  accepted: boolean;
  /** What the driver reported for a rejection — the detector's own words. */
  detail?: string;
}

export interface ReplayResult {
  pushes: ReplayPush[];
  /** Timeline timestamp of the first rejected push, null if none was. */
  firstRejectionAt: string | null;
  /** Milliseconds from the colliding commit to the first rejection. */
  rejectionDelayMs: number | null;
}

/**
 * The two operations the replayed timeline is made of. Both take the timeline
 * timestamp they are happening at, purely for the driver's own logging — the
 * replay stamps results itself.
 */
export interface ReplayDrivers {
  /** Land the colliding commit on the shared branch. Must succeed. */
  landCollidingCommit(atMs: number): Promise<void>;
  /**
   * Commit whatever the pass has and push it. Resolves `accepted: false` when
   * the push was refused — the driver decides what refusal looks like, because
   * the driver owns the git.
   */
  pushAsPass(atMs: number): Promise<{ accepted: boolean; detail?: string }>;
}

export interface ReplayTimeline {
  passStartedAt: number;
  collidingCommitAt: number;
  finalPushAt: number;
}

/**
 * Replay the recorded timeline with a push cadence and record when rejection
 * first arrives.
 *
 * `cadenceMs` of `null` is the status quo replayed faithfully: one push, at
 * `finalPushAt`, which is how the observed pass spent eight hours to learn
 * what a skeleton push would have told it in the first thirty minutes after
 * the collision existed.
 *
 * Events run in timeline order. When a tick and the colliding commit share an
 * instant the commit lands first — a push cannot be rejected by history that
 * has not happened. The replay stops at the first rejection: a rejected push is
 * the pass finding out, and what it does next is a different candidate's
 * problem.
 */
export async function replayCollisionWindow(
  timeline: ReplayTimeline,
  cadenceMs: number | null,
  drivers: ReplayDrivers,
): Promise<ReplayResult> {
  const ticks =
    cadenceMs === null
      ? [timeline.finalPushAt]
      : pushSchedule(timeline.passStartedAt, timeline.finalPushAt, cadenceMs);

  const pushes: ReplayPush[] = [];
  let firstRejectionAt: string | null = null;
  let landed = false;

  for (const tick of ticks) {
    if (!landed && timeline.collidingCommitAt <= tick) {
      await drivers.landCollidingCommit(timeline.collidingCommitAt);
      landed = true;
    }
    const outcome = await drivers.pushAsPass(tick);
    pushes.push({ at: new Date(tick).toISOString(), accepted: outcome.accepted, detail: outcome.detail });
    if (!outcome.accepted) {
      firstRejectionAt = new Date(tick).toISOString();
      break;
    }
  }

  return {
    pushes,
    firstRejectionAt,
    rejectionDelayMs:
      firstRejectionAt === null ? null : Date.parse(firstRejectionAt) - timeline.collidingCommitAt,
  };
}
