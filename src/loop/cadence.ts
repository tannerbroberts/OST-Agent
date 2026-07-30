/**
 * The cadence gate — may this vault fire right now?
 *
 * Deterministic and read-only: it takes the ledger, the declared cadence and
 * the current time, and returns one of three statuses. There is **no default
 * cadence**. A vault that does not declare one is never due, because the
 * alternative is a tool that starts spending on a schedule nobody chose.
 *
 * **The future-stamp wedge, and the way out.** The ledger is sorted newest
 * first, so a single record stamped in the future would answer "when did this
 * vault last fire" for as long as that timestamp stayed ahead of the clock —
 * permanent not-due, clearable only by hand-editing a JSONL file. That is R2's
 * cautionary tale exactly. Clamping the stamp to `now` does not fix it: the
 * clamp moves with the clock, so the window never elapses either.
 *
 * So a record stamped after `now` is **ignored** for the purposes of bounding
 * the window, and counted and reported separately. The newest record that could
 * actually have happened is what bounds the window; if every record is in the
 * future the vault reads as never-fired and fires once, which writes a
 * present-stamped record and restores ordering without anyone touching a file.
 * The anomaly is never swallowed — `ignoredFuture` travels with the verdict so
 * the operator sees the clock problem instead of inheriting its consequences.
 */
import type { LoopRunRecord } from "./health.js";

export type CadenceStatus = "due" | "not-elapsed" | "undeclared";

export interface CadenceVerdict {
  status: CadenceStatus;
  /** One line, in the operator's terms, for whichever surface prints it. */
  reason: string;
  /** The newest firing that could actually have happened, if any. */
  lastFiredAt?: string;
  /** Its verdict, so "never fired" and "fired and sealed unhealthy" differ. */
  lastVerdict?: string;
  nextDueAt?: string;
  /** Records stamped after `now`, ignored for the window and reported here. */
  ignoredFuture: number;
}

const UNITS: Record<string, number> = {
  m: 60_000,
  h: 60 * 60_000,
  d: 24 * 60 * 60_000,
};

/**
 * Parse a declared cadence (`"30m"`, `"6h"`, `"1d"`) into milliseconds.
 *
 * Null for anything else — absent, blank, zero, negative, a bare number, a unit
 * this does not know. Guessing at `"6"` would be choosing a spend rate on the
 * operator's behalf out of a string they got wrong.
 */
export function parseCadence(spec: string | null | undefined): number | null {
  if (typeof spec !== "string") return null;
  const match = spec.trim().toLowerCase().match(/^(\d+)\s*([mhd])$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value * UNITS[match[2]];
}

function stamp(ms: number): string {
  return new Date(ms).toISOString();
}

export function evaluateCadence(input: {
  runs: readonly LoopRunRecord[];
  now: number;
  cadenceMs: number | null;
}): CadenceVerdict {
  const { runs, now, cadenceMs } = input;

  if (cadenceMs === null) {
    return {
      status: "undeclared",
      reason:
        "no `loop.cadence` in ost.config.yaml — this vault will never fire on its own. " +
        'Declare one (`loop:\\n  cadence: "6h"`) or drive the pass by hand.',
      ignoredFuture: 0,
    };
  }

  const usable = runs.filter((r) => Date.parse(r.startedAt) <= now);
  const ignoredFuture = runs.length - usable.length;
  const last = usable[0];

  if (!last) {
    return {
      status: "due",
      reason:
        ignoredFuture > 0
          ? `no firing on record that could have happened yet (${ignoredFuture} record(s) stamped in the future, ignored)`
          : "no firing on record",
      ignoredFuture,
    };
  }

  const nextDueMs = Date.parse(last.startedAt) + cadenceMs;
  const common = {
    lastFiredAt: last.startedAt,
    ...(last.verdict ? { lastVerdict: last.verdict } : {}),
    nextDueAt: stamp(nextDueMs),
    ignoredFuture,
  };
  return now >= nextDueMs
    ? { status: "due", reason: `last fired ${last.startedAt} (${last.verdict ?? "unsealed"})`, ...common }
    : { status: "not-elapsed", reason: `next due ${stamp(nextDueMs)}`, ...common };
}
