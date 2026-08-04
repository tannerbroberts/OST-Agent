/**
 * The permission policy.
 *
 * `ALLOWED_TOOL_NAMES` is the complete, closed set of tools OST-Agent may ever
 * hold. `assertNoDestructiveTool` is a fail-closed guard the MCP server calls
 * while building its tool set, before a single tool is exposed to a session: it
 * refuses to proceed if the resolved set contains anything outside the allowlist
 * or anything whose name smells destructive *or consequential* — a tool that acts
 * on the world (sends, signs, pays, publishes) is as unwelcome here as one that
 * deletes, and until v1-readiness P7 the token set only knew about deleting. This
 * is defense-in-depth on top of the fact that no such tool is ever built.
 */

export const ALLOWED_TOOL_NAMES = [
  "ost_read_tree",
  "ost_next_work",
  "ost_create_node",
  "ost_append_to_node",
  "ost_link_nodes",
  "ost_set_status",
  "ost_set_evidence",
  // Attaches a runnable command to an assumption test, or corrects one. It is a
  // write, and it is here rather than withheld because the requirement it
  // satisfies is one this project now makes of itself: a test nothing can run is
  // a test the builder cannot use, and a tree can hold hundreds written before
  // instruments existed. Withholding the tool would leave a pass able to see
  // that debt and unable to pay it.
  //
  // What it CANNOT do bounds the grant. The command must match a closed
  // allowlist of spec-file forms (knowledge/instruments.ts), so no string it
  // writes can exit 0 without committed code behind it; and setting one clears
  // no gate at all, because a build permit needs an OBSERVED failure and only
  // `ost-agent verify` — CLI-only, off every tool surface — records one.
  "ost_set_instrument",
  // Restrictive-only by construction: it can put a test out of compute's reach
  // and nothing else. There is deliberately no general lane setter here — see
  // ost/lanes.ts `flagHumansRequired`.
  "ost_flag_humans_required",
  "ost_annotate",
  // Outward sensing (see docs/superpowers/specs/2026-07-26-web-lookup-and-trust-design.md):
  // read-only web lookups under a per-session budget, read-only product-repo
  // sight, and append-only publisher trust ranking capped at 'expert'.
  "ost_search_web",
  "ost_read_web",
  "ost_read_repo",
  "ost_rank_source",
  // The deterministic analysis surface: no model, no writes. These were CLI
  // commands reachable only through a Bash grant on a published binary; with
  // the binary gone they belong on the tool surface like everything else.
  "ost_check",
  "ost_debt",
  "ost_status",
  "ost_gate",
  // The vault's one input path: read the local drop folder and capture each new
  // note as an evidence record. Append-only and idempotent — the adapter's cursor
  // and writeEvidence both refuse to re-ingest. No credentials, no network.
  "ost_ingest_inbox",
  "git_commit",
  "git_push",
] as const;

export type AllowedToolName = (typeof ALLOWED_TOOL_NAMES)[number];

/**
 * Tokens that mark a tool as destructive. Matched against the name's tokens (split
 * on non-alphanumerics AND camelCase) so snake_case like `rm_rf` or `git_reset`
 * cannot slip past a `\b` word boundary. Errs toward over-flagging (fail-closed).
 */
const DESTRUCTIVE_TOKENS = new Set([
  "delete", "destroy", "remove", "rm", "rmdir", "reset", "revert", "force",
  "clean", "rewrite", "overwrite", "truncate", "drop", "wipe", "purge",
  "bash", "sh", "shell", "exec", "spawn", "eval", "system", "run",
  "unlink", "rename", "move", "mv", "replace", "write", "writefile",
  "branch", "checkout", "fetch", "pull", "clone", "rebase", "filter",
]);

/**
 * Tokens that mark a tool as *consequential* — it acts on the world outside the
 * vault. Destruction is not the only harm an OST agent could do: `ost_send_email`,
 * `ost_sign_document`, `ost_pay_invoice` and `ost_publish_post` destroy nothing and
 * are each irreversible in the way that matters, because the effect lands on a
 * person, an account or a public timeline and no commit can take it back. The set
 * above was tuned for destruction and let all four through (v1-readiness P7).
 *
 * **This is defence in depth, not the gate.** What actually stops those four tools
 * today is that they are not in `ALLOWED_TOOL_NAMES` — but membership is decided by
 * a source edit, and a source edit is precisely the weakness P7 objects to (the same
 * objection P6 raises about `MCP_TOOL_NAMES` filtering out `git_push`). A name-level
 * guard cannot stop a determined author either — `ost_dispatch_correspondence` is not
 * on this list — so it is not a security boundary. What it buys is that the *cheap*
 * way to add a real-world action, the way it would happen by accident or by a model
 * writing a plausible-looking tool, fails closed and loudly at startup rather than
 * shipping.
 *
 * Two rules govern additions. (1) No token here may flag a name already in
 * `ALLOWED_TOOL_NAMES` — `test/security/policy.test.ts` asserts the whole allowlist
 * passes the guard, so a token that clashes turns into a red test rather than a
 * server that refuses to start. That is why `push` and `commit` are deliberately
 * absent despite being outward acts: `git_push` and `git_commit` are allowlisted and
 * safe by construction (see git/safe-git.ts), and `force`/`branch`/`checkout` above
 * already catch the dangerous shapes of git. (2) Over-flagging is the safe direction.
 * A false positive costs one deliberate commit to argue past; a false negative ships
 * a tool that can spend money.
 */
const CONSEQUENCE_TOKENS = new Set([
  // reaching a person
  "send", "email", "mail", "sms", "notify", "notification", "message", "dm",
  "contact", "call", "dial", "escalate", "reply", "respond",
  // reaching the public
  "publish", "post", "tweet", "broadcast", "announce", "share", "upload",
  "submit", "comment",
  // committing the operator to something
  "sign", "signature", "approve", "reject", "authorize", "grant", "revoke",
  "apply", "accept", "confirm",
  // spending money
  "pay", "payment", "purchase", "buy", "order", "charge", "refund", "transfer",
  "invoice", "bill", "subscribe", "unsubscribe", // "checkout" is already above
  // taking a booking or a slot in the world
  "book", "reserve", "schedule", "cancel",
  // making software act
  "deploy", "provision", "release", "trigger", "invoke", "dispatch", "webhook",
  "emit",
]);

function tokenize(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Throw if `names` contains any tool that is not on the allowlist or that matches
 * a destructive token. `git_push` and `git_commit` are allowlisted and safe by
 * construction (see git/safe-git.ts) despite touching git.
 */
export function assertNoDestructiveTool(names: readonly string[]): void {
  const allowed = new Set<string>(ALLOWED_TOOL_NAMES);
  for (const name of names) {
    if (!allowed.has(name)) {
      throw new Error(`tool "${name}" is not on the OST-Agent allowlist — refusing to run`);
    }
    // allowlisted git tools are exempt from the token-level destructive scan
    if (name === "git_commit" || name === "git_push") continue;
    if (isDestructiveToolName(name)) {
      throw new Error(`tool "${name}" matches a destructive pattern — refusing to run`);
    }
  }
}

/**
 * True if a name (from anywhere) looks destructive **or consequential**. Used to vet
 * external tools. The name is historical: it is the one guard, and widening what it
 * flags is cheaper and safer than adding a second one that a caller could forget to
 * call. See `CONSEQUENCE_TOKENS` for why acting on the world counts.
 */
export function isDestructiveToolName(name: string): boolean {
  return tokenize(name).some((t) => DESTRUCTIVE_TOKENS.has(t) || CONSEQUENCE_TOKENS.has(t));
}
