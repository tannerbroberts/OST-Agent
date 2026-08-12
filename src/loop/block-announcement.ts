/**
 * The block announcement — fired the moment a run reaches something only the
 * operator can do, not batched to the end of the pass.
 *
 * "An operator notified at every block keeps acting on the notifications
 * rather than tuning them out" argues the mechanism has to actually be worth
 * reading, and names the two payloads that make it so: the exact command that
 * clears the block, and what else is already waiting behind it. A message
 * that says only "something needs you" is indistinguishable from noise; one
 * that hands over the command and the size of the backlog is an action, not
 * an alert.
 *
 * `flagHumansRequired` (`src/ost/lanes.ts`) is the one write path every route
 * to a needs-a-person lane goes through, and it already files the ask
 * (P2, `src/knowledge/asks.ts`). This module renders what that same moment
 * says out loud — {@link renderBlockAnnouncement} is called synchronously,
 * in the tool response that reaches the agent the instant it files the block,
 * which is the whole latency claim: a wait announced when it starts costs
 * what the operator takes to read it, not what is left of the pass plus
 * whatever comes after.
 */
import type { PendingAsk } from "../ost/pending-asks.js";

/** The block as filed — what {@link renderBlockAnnouncement} reads to build the message. */
export interface BlockedFiling {
  /** Title of the AssumptionTest that just landed in a needs-a-person lane. */
  test: string;
  /** The exact command that clears this block — never a description of one. */
  command: string;
  /** Why a person is needed, in the filer's own words. */
  why: string;
}

/**
 * Render the announcement: the block, the command that clears it, and what
 * else is already queued behind it.
 *
 * `queue` is the standing queue at the moment of filing (`readPendingAskQueue`)
 * — the caller passes it including this block's own entry, and it is excluded
 * here by title so "what is queued behind it" never counts the block against
 * itself. Titles only, not the full queue detail: this is a push notification,
 * not the `ost-agent asks` report, and an operator reading it on a lock screen
 * needs the count and the names, not the age of each.
 */
export function renderBlockAnnouncement(filing: BlockedFiling, queue: readonly PendingAsk[]): string {
  const behind = queue.filter((a) => a.test !== filing.test);
  const behindLine =
    behind.length === 0
      ? "nothing else queued behind it"
      : `${behind.length} more queued behind it: ${behind.map((a) => a.test).join("; ")}`;
  return [
    `BLOCKED — needs you now: "${filing.test}"`,
    `why: ${filing.why}`,
    `clear it: ${filing.command}`,
    behindLine,
  ].join("\n");
}

/**
 * The imperative wrapper an agent reads at the moment it files a block —
 * distinct from {@link renderBlockAnnouncement}'s payload so a caller that only
 * wants the payload (a test, a future non-agent surface) is not forced to take
 * the instruction along with it.
 *
 * OST-Agent does not call the model — Claude Code does — so nothing here can
 * reach a push service on its own. What it CAN do is put the instruction to
 * announce in the one place a run cannot miss it: the return value of the
 * tool call that just filed the block, read in the same turn that caused it.
 */
export function renderBlockAnnouncementInstruction(filing: BlockedFiling, queue: readonly PendingAsk[]): string {
  return (
    "ANNOUNCE THIS NOW, before doing anything else in this pass: push it to whatever channel actually " +
    "reaches the operator (a push notification, a message) — the wait starts the moment they read this, " +
    "not at the end of the pass.\n" +
    renderBlockAnnouncement(filing, queue)
  );
}
