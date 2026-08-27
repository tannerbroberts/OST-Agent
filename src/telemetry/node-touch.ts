/**
 * Which node a firing was on when something went wrong, read off the trace.
 *
 * A run that dies leaves two accounts of itself. One is the driver's — prose, in
 * whatever the model got as far as printing, and missing precisely when the
 * driver is what died. The other is the tool trace: written by the dispatcher
 * inside each call, at the instant the bytes landed, and unforgeable by the
 * reasoning that would like to look busy. The failing-run summary reads the
 * second one, for the same reason `degraded.ts` does.
 *
 * **This is a reader and nothing else.** It answers a question in a report; no
 * verdict, exit code or gate is computed from what it returns, and none should
 * be. That matters because the trace is the one decider input the unattended
 * surface can move (see part 5 of `test/release/gate-f-deciders.test.ts`) — a
 * firing that could name its own last node into a gate would be grading itself.
 * Naming it into a sentence a human reads is a different thing entirely.
 */
import { readUsageEvents } from "./preflight.js";

/** The last node file a firing's own tool calls changed, and which call did it. */
export interface NodeTouch {
  /** Basename of the node file, exactly as the trace recorded it. */
  file: string;
  /** The tool whose call changed it. */
  tool: string;
  /** That call's timestamp, so a reader can find the event by hand. */
  at: string;
}

/**
 * The last node file touched since `startedAt`, or undefined when the firing
 * reached none.
 *
 * Undefined is a finding rather than a gap, and the caller is expected to say so
 * out loud: a driver that died on an auth error before it reached the vault
 * touched nothing, and that fact is most of the diagnosis. Callers must not
 * render it the same way they would render a line they failed to compute.
 *
 * `touched` is read ahead of `wrote` and both are read, because they answer
 * different questions and only the first is the one asked here — see the fields
 * on {@link import("./usage.js").UsageEvent}. `wrote` is still consulted so that
 * a trace written before `touched` existed still answers for the creates it
 * recorded, which is the whole of what a pre-upgrade line can honestly say.
 *
 * Order is file order within the window, not timestamp order. Events are
 * appended as calls complete and `ts` is stamped at the call's START, so two
 * calls inside one millisecond — or one long call that finished after a short
 * one began — sort by append order correctly and by timestamp only by luck.
 *
 * No surface is excluded. `loop fallback` shares this trace and is excluded from
 * `countToolCallsSince` deliberately, but the reason there is that its calls must
 * not vouch for a pass that made none; a node it really did change is still a
 * node this firing changed, and hiding it would make the report wrong to protect
 * a verdict this function does not compute.
 */
export function lastNodeTouchedSince(vaultDir: string, startedAt: string): NodeTouch | undefined {
  const from = Date.parse(startedAt);
  if (!Number.isFinite(from)) return undefined;
  let last: NodeTouch | undefined;
  for (const e of readUsageEvents(vaultDir)) {
    const at = Date.parse(e.ts);
    // A call that cannot be placed in time is not evidence that anything was
    // reached — the same rule `countToolCallsSince` applies to the same file.
    if (!Number.isFinite(at) || at < from) continue;
    const files = e.touched ?? e.wrote ?? [];
    const file = files[files.length - 1];
    if (typeof file === "string" && file.length > 0) last = { file, tool: e.tool, at: e.ts };
  }
  return last;
}
