/**
 * The kill criteria a Solution now needs to be born at all, as one fixture.
 *
 * Not a `.test.ts` file, so vitest does not collect it. It exists because
 * `ost_create_node` requires `killIf` and `killBy` on every Solution
 * (`src/ost/kill-criteria.ts`), and roughly twenty specs create a Solution while
 * asking about something else entirely — an evidence rung, an atomicity
 * guarantee, a lane. Those specs should not each carry their own opinion about
 * what a kill condition looks like, and they should certainly not each hard-code
 * a date that goes stale.
 *
 * `killBy` is computed from today rather than fixed, because the create path
 * validates it against the day the node is born: any literal date in a spec file
 * is a test that passes until that morning. That is a clock read inside a test,
 * which CONTRIBUTING warns about — the narrow reason it is safe here is that
 * nothing is asserted about the value. It exists to satisfy a precondition, and
 * the specs that actually pin the date rules pass their own dates in
 * (`test/ost/kill-criteria-required.test.ts`).
 */

/** A YYYY-MM-DD `days` from today, in UTC. */
export function killByIn(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Spread into an `ost_create_node` call that creates a Solution incidentally.
 *
 * A fortnight out, matching the revisit interval the assumption test behind this
 * field proposed — so a spec that leaks a node into a fixture vault leaks one
 * whose criteria read like a real candidate's.
 */
export const KILL_CRITERIA = {
  killIf: "no operator has run it twice in a fortnight",
  killBy: killByIn(14),
} as const;
