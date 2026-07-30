/**
 * The lookup budget: one counter shared by search and page reads, created per
 * PassContext. Exhaustion is an instruction to work from what you have — not
 * an error.
 *
 * The number an operator writes in `ost.config.yaml` is the only number that
 * governs it. A `budgets` gene could once shadow that from `genome.yaml`, and
 * outranked it; both are gone.
 */
import { describe, expect, test } from "vitest";
import {
  createLookupBudget,
  budgetSpentMessage,
  DEFAULT_LOOKUP_BUDGET,
  DEFAULT_REFILL_PER_HOUR,
  type LookupBudget,
} from "../../src/web/budget.js";

describe("createLookupBudget", () => {
  test("allows exactly `limit` takes, then refuses", () => {
    const b = createLookupBudget(3);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.take()).toBe(false); // stays exhausted
    expect(b.remaining()).toBe(0);
  });

  test("reports remaining as it drains", () => {
    const b = createLookupBudget(2);
    expect(b.remaining()).toBe(2);
    b.take();
    expect(b.remaining()).toBe(1);
  });

  test("defaults to DEFAULT_LOOKUP_BUDGET", () => {
    expect(createLookupBudget().remaining()).toBe(DEFAULT_LOOKUP_BUDGET);
    expect(DEFAULT_LOOKUP_BUDGET).toBe(10);
  });

  test("the spent message instructs, it does not just refuse", () => {
    const msg = budgetSpentMessage(10);
    expect(msg).toMatch(/budget/i);
    expect(msg).toMatch(/annotate|record|cite|open question/i);
  });

  // These three refill tests now pass an explicit `lifetimeLimit`, and that is the
  // point of P8 rather than an inconvenience: since the lifetime total defaults to
  // the burst `limit`, a test about *refill* has to say out loud that it wants more
  // reach than one burst. Before P8 nothing had to say that, which is precisely how
  // a rate got described as a cap.
  test("refills over time at the configured hourly rate", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, lifetimeLimit: 100, now: () => clock });
    for (let i = 0; i < 10; i++) b.take();
    expect(b.take()).toBe(false);

    clock += 6 * 60 * 1000; // six minutes = one token at 10/hour
    expect(b.remaining()).toBe(1);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  test("never refills past the burst capacity", () => {
    let clock = 0;
    const b = createLookupBudget(10, { refillPerHour: 10, lifetimeLimit: 100, now: () => clock });
    b.take();
    clock += 24 * 60 * 60 * 1000; // a full day of refill
    expect(b.remaining()).toBe(10);
  });

  test("refillPerHour: 0 reproduces the old non-refilling behaviour", () => {
    let clock = 0;
    const b = createLookupBudget(2, { refillPerHour: 0, now: () => clock });
    b.take();
    b.take();
    clock += 365 * 24 * 60 * 60 * 1000;
    expect(b.take()).toBe(false);
    expect(b.msUntilNext()).toBe(Infinity);
  });

  test("refund returns a token without exceeding capacity", () => {
    const b = createLookupBudget(2, { refillPerHour: 0 });
    b.take();
    b.refund();
    expect(b.remaining()).toBe(2);
    b.refund(); // already full
    expect(b.remaining()).toBe(2);
  });

  test("msUntilNext reports the wait once exhausted", () => {
    let clock = 0;
    // lifetime headroom, so the wait being reported is the burst's and not a
    // lifetime exhaustion (which reports Infinity — see the P8 block below)
    const b = createLookupBudget(1, { refillPerHour: 60, lifetimeLimit: 10, now: () => clock }); // one per minute
    b.take();
    expect(b.msUntilNext()).toBe(60_000);
    clock += 30_000;
    expect(b.msUntilNext()).toBe(30_000);
  });

});

describe("createLookupBudget — the operator's number", () => {
  test("the operator's configured number governs", () => {
    expect(createLookupBudget(4).limit).toBe(4);
  });

  test("no number at all falls back to DEFAULT_LOOKUP_BUDGET", () => {
    expect(createLookupBudget().limit).toBe(DEFAULT_LOOKUP_BUDGET);
  });
});

/**
 * v1-readiness **P8 — the system can state a total bound on outward reach, not just
 * a burst rate.**
 *
 * The criterion's check, verbatim: construct `createLookupBudget(operatorLimit,
 * {now, refillPerHour})` with an injected clock, run TWO simulated days hour by
 * hour calling `take()` until refused; pass = day two sums to zero, i.e. total
 * successful takes over all time equals `limit`.
 *
 * Why two days and not one. At `DEFAULT_LOOKUP_BUDGET = 10` with
 * `DEFAULT_REFILL_PER_HOUR = 10`, one day sums to ~240 whether the cap is a
 * lifetime or merely a daily rate — a one-day harness cannot tell the hypotheses
 * apart, and would have been green against the pre-P8 code. The second day is the
 * whole experiment.
 *
 * **Non-vacuity.** The control below runs the *same* harness against a budget built
 * with `lifetimeLimit: Infinity` (the pre-P8 semantics) and asserts it observes 240
 * takes on BOTH days. So the zero cannot be an artefact of a harness that stopped
 * advancing its clock, or of a `take()` that always refuses: if it were, the control
 * would read 0 too and fail. Proved by inversion while writing — with the lifetime
 * check removed from `take()`, the criterion test reads 240/240 and fails while the
 * control stays green.
 */
describe("createLookupBudget — P8: a total bound, not just a burst rate", () => {
  const MS_PER_HOUR = 60 * 60 * 1000;

  /** One simulated day: 24 hours, draining the pool to refusal in each. */
  function simulateDay(b: LookupBudget, clock: { t: number }): number {
    let takes = 0;
    for (let hour = 0; hour < 24; hour++) {
      // `take()` is bounded by the burst limit, so this while loop always ends
      while (b.take()) takes++;
      clock.t += MS_PER_HOUR;
    }
    return takes;
  }

  test("two simulated days: day two sums to zero, and all of time sums to `limit`", () => {
    const clock = { t: 0 };
    const b = createLookupBudget(DEFAULT_LOOKUP_BUDGET, {
      refillPerHour: DEFAULT_REFILL_PER_HOUR,
      now: () => clock.t,
    });

    const dayOne = simulateDay(b, clock);
    const dayTwo = simulateDay(b, clock);

    expect(dayTwo).toBe(0);
    expect(dayOne + dayTwo).toBe(DEFAULT_LOOKUP_BUDGET); // total over all time === limit
    expect(b.lifetimeRemaining()).toBe(0);
    // and the system can say so: no wait is promised, because none would help
    expect(b.msUntilNext()).toBe(Infinity);
    expect(budgetSpentMessage(b.limit, b.msUntilNext())).not.toMatch(/minutes/);
  });

  test("NON-VACUITY CONTROL: the same harness observes ~240 takes a day without a lifetime", () => {
    const clock = { t: 0 };
    const b = createLookupBudget(DEFAULT_LOOKUP_BUDGET, {
      refillPerHour: DEFAULT_REFILL_PER_HOUR,
      lifetimeLimit: Infinity, // the pre-P8 world: a rate described as a cap
      now: () => clock.t,
    });

    expect(simulateDay(b, clock)).toBe(240);
    expect(simulateDay(b, clock)).toBe(240); // and it would do this forever
  });

  test("both bounds bind at once: the burst paces, the lifetime stops", () => {
    // The reason this is two counters and not a replacement. A lifetime of 25 with a
    // burst of 10/hour is spent 10, 10, 5 across three hours — never 25 at once — and
    // then it is over. Neither number alone describes that.
    const clock = { t: 0 };
    const b = createLookupBudget(10, { refillPerHour: 10, lifetimeLimit: 25, now: () => clock.t });

    const perHour: number[] = [];
    for (let hour = 0; hour < 5; hour++) {
      let takes = 0;
      while (b.take()) takes++;
      perHour.push(takes);
      clock.t += MS_PER_HOUR;
    }
    expect(perHour).toEqual([10, 10, 5, 0, 0]);
    expect(b.remaining()).toBe(0);
  });

  test("the lifetime total defaults to the operator's number, and is reported", () => {
    // The default is the fail-closed reading of `web.lookupBudget: 10` — "ten
    // lookups", not "ten per hour, forever". A long watch raises it deliberately.
    const b = createLookupBudget(7);
    expect(b.lifetimeLimit).toBe(7);
    expect(b.lifetimeRemaining()).toBe(7);
    b.take();
    expect(b.lifetimeRemaining()).toBe(6);
  });

  /**
   * The hole the first P8 pass left, and the reason "day two sums to zero" is not on
   * its own a total bound. `take()` was capped by the lifetime, but `refund()` gave
   * the lifetime back without limit — so take/fail/refund/retry, the exact loop an
   * agent runs against a source that keeps erroring, spent the total and immediately
   * un-spent it. Measured against the pre-fix code this harness made **10,000 outward
   * attempts under a stated total of 10, with `lifetimeRemaining()` still reading 10**.
   * A bound that any failure removes is not a bound; it is a bound on success.
   *
   * `src/security/tools.ts` already refuses to fund this spin in the all-cooling
   * branch ("retrying immediately will not help") — this is the same spin arriving
   * through the branch that does refund.
   *
   * **Non-vacuity.** The control immediately below runs the identical loop against
   * `lifetimeLimit: Infinity` and observes the full 1000 iterations, so the small
   * number here cannot be a loop that never ran or a `take()` that always refuses —
   * if it were, the control would read 0 and fail. Verified by inversion: with the
   * `lifetimeRefunds < lifetimeLimit` guard removed from `refund()`, this test reads
   * 1000 and fails while the control stays green.
   */
  test("a source that keeps failing cannot spin the lifetime total open forever", () => {
    const b = createLookupBudget(10, { refillPerHour: 0 });
    let attempts = 0;
    // Bounded loop on purpose: a regression must fail the test, not hang the suite.
    for (let i = 0; i < 1000; i++) {
      if (!b.take()) break;
      attempts++;
      b.refund(); // every one of them came back empty
    }
    // 10 spends + 10 funded refunds. The worst case is 2x the operator's number,
    // which is a stated bound; the point is that it is finite.
    expect(attempts).toBe(20);
    expect(b.take()).toBe(false);
    expect(b.lifetimeRemaining()).toBe(0);
  });

  test("NON-VACUITY CONTROL: the same spin loop is unbounded without a lifetime", () => {
    const b = createLookupBudget(10, { refillPerHour: 0, lifetimeLimit: Infinity });
    let attempts = 0;
    for (let i = 0; i < 1000; i++) {
      if (!b.take()) break;
      attempts++;
      b.refund();
    }
    expect(attempts).toBe(1000); // it would have gone on forever
  });

  test("a refunded lookup costs neither counter", () => {
    // A source outage must not permanently drain the total — otherwise other
    // people's downtime spends the operator's ceiling.
    let clock = 0;
    const b = createLookupBudget(2, { refillPerHour: 0, now: () => clock });
    b.take();
    b.refund();
    clock += MS_PER_HOUR;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
    expect(b.lifetimeRemaining()).toBe(0);
  });
});

describe("budgetSpentMessage", () => {
  test("names the pool and tells the session what to do instead of looking", () => {
    const msg = budgetSpentMessage(7);
    expect(msg).toContain("7 web lookups");
    expect(msg).toMatch(/work from what you have already read/i);
    expect(msg).toMatch(/open question/i);
  });

  test("names the wait when one is known, so 'stop looking' reads as 'for now'", () => {
    expect(budgetSpentMessage(7, 12 * 60_000)).toMatch(/about 12 minutes/);
    expect(budgetSpentMessage(7)).not.toMatch(/minutes/);
  });
});
