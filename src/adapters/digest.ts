/**
 * The digest: what changed since the last one, delivered somewhere that is not
 * the vault.
 *
 * Every other surface in this product is pull-shaped. `ost-agent status`,
 * `rollup`, `asks` and the tree itself all answer questions an operator has to
 * remember to ask, and the opportunity beneath this solution is that they never
 * do. So this one begins on the agent's side: on a declared cadence it composes
 * a few lines and hands them to a transport that puts them where the stakeholder
 * already reads things.
 *
 * **The last hop is deliberately not in this repository, and that is a real
 * limit rather than an omission.** The guarantee stated in `CONTRIBUTING.md` and
 * enforced in `src/security/policy.ts` is that OST-Agent holds no consequential
 * capability — "a tool that acts on the world (sends, signs, pays, publishes) is
 * as unwelcome here as one that deletes". A Slack post or an email is exactly
 * that. Building one here would negate the guarantee to satisfy a solution node,
 * which is the trade this file refuses to make. What it ships instead is:
 *
 *   - {@link DigestTransport}, an injected seam, so the operator's own wrapper
 *     owns the send and this process never holds the credential; and
 *   - {@link fileDropTransport}, the one built-in, which writes the digest into a
 *     directory the operator named — the inbox drop folder run backwards.
 *
 * That is genuinely push as far as this side of the boundary goes: the digest
 * leaves on a schedule nobody had to remember, and it lands where the operator
 * pointed. Whether the last hop from that folder to a chat client happens is
 * theirs to wire, and {@link deliverDigest} records the transport's own answer
 * for where it landed rather than what config hoped.
 *
 * **Refusing to deliver into the vault is the point, not a guard.** A digest
 * written to `.ost-agent/` is a file somebody has to go and read, which is the
 * problem restated as a solution. So a destination that resolves inside the
 * vault is refused, loudly, with the reason.
 *
 * **A window that elapsed with nothing sent is reported, never skipped.** The
 * failure this closes is the quiet one: a cadence stops firing and the surface
 * that would have said so is the surface that stopped. {@link
 * evaluateDigestCadence} counts the whole windows that passed with no delivery
 * and carries the number out with the verdict, and `ost-agent digest` exits
 * non-zero on it — a miss has to be observable by something that is not a human
 * reading prose. Same reasoning, and the same no-default rule, as
 * `loop.cadence`: a vault that declared no digest cadence is never due, because
 * a default here would be this repository deciding how often to interrupt
 * somebody else's stakeholders.
 */
import fs from "node:fs";
import path from "node:path";
import { parseCadence } from "../loop/cadence.js";
import { loopStateDir } from "../loop/state.js";
import type { LoopRunRecord, LoopVerdict } from "../loop/health.js";
import type { PendingAsk } from "../ost/pending-asks.js";

/** The two keys that turn the digest on. Both required; either alone is undeclared. */
export interface DigestSettings {
  /** How often a digest goes out: `"7d"`, `"24h"`. Absent ⇒ never due. */
  readonly cadence?: string | null;
  /** Where it goes, resolved against the vault. Absent ⇒ nothing is delivered. */
  readonly destination?: string | null;
}

export type DigestCadenceStatus = "due" | "not-elapsed" | "undeclared";

export interface DigestCadenceVerdict {
  readonly status: DigestCadenceStatus;
  /** One line, in the operator's terms, for whichever surface prints it. */
  readonly reason: string;
  readonly lastDeliveredAt?: string;
  readonly nextDueAt?: string;
  /**
   * Whole cadence windows that elapsed with no digest delivered, not counting
   * the one now open.
   *
   * Zero before the first delivery — nothing was promised yet, and reporting a
   * miss against a cadence that has never fired would make every fresh vault
   * look broken on the day it declared one.
   */
  readonly missed: number;
  /** Deliveries stamped after `now`, ignored for the window and reported here. */
  readonly ignoredFuture: number;
}

/** One delivery, appended to the ledger by {@link deliverDigest} and by nothing else. */
export interface DigestDelivery {
  /** When it went out — this process's clock, not a caller's claim. */
  readonly at: string;
  /**
   * The upper edge of the window it covered. The next digest starts strictly
   * after this, which is what makes "what changed since the last one" a fact
   * about the ledger rather than an intention.
   */
  readonly coveredThrough: string;
  readonly transport: string;
  /** Where the transport said it landed, verbatim. */
  readonly destination: string;
  /** How many changes it named, so a reader can see an empty digest went out. */
  readonly changes: number;
}

/** One thing that happened since the previous digest. */
export interface DigestChange {
  readonly runId: string;
  readonly at: string;
  readonly verdict: LoopVerdict | "unsealed";
}

/** The digest itself — the window, what happened in it, and what needs a person. */
export interface Digest {
  /**
   * The lower edge, exclusive: the previous digest's `coveredThrough`, or null
   * on the first one. Null means "everything so far" and is the only case where
   * a digest may be a summary of the whole ledger.
   */
  readonly since: string | null;
  readonly through: string;
  readonly changes: readonly DigestChange[];
  /** The one or two the digest names — capped for brevity, never for accuracy. */
  readonly asks: readonly PendingAsk[];
  /** How many are actually waiting, so the cap cannot hide a queue. */
  readonly asksTotal: number;
  /** Carried from the cadence verdict so the miss travels with the thing it is about. */
  readonly missed: number;
}

/**
 * Where the digest is handed off. Injected, because the send is the operator's
 * to own — see this module's header for why that is a boundary rather than an
 * unfinished edge.
 */
/** What a transport is handed. `at` is the delivery stamp, never the wall clock. */
export interface DigestMessage {
  readonly subject: string;
  readonly body: string;
  /**
   * When this digest was composed, as it will be recorded.
   *
   * Passed in rather than read by the transport, and the reason is a bug this
   * file already had: a transport that named its file from `new Date()` collided
   * with itself whenever two deliveries covering different windows happened
   * inside the same millisecond of wall-clock time — which is every test, and
   * any backfill. The clock a delivery is stamped by is the caller's, so the
   * name derived from it must be too.
   */
  readonly at: string;
}

export interface DigestTransport {
  /** Recorded on the delivery, so a ledger reader knows which path it took. */
  readonly name: string;
  /** Deliver, and return where it actually landed. Throwing means it did not. */
  send(message: DigestMessage): string;
}

export type DigestOutcome = "delivered" | "not-elapsed" | "undeclared" | "refused";

export interface DigestDeliveryResult {
  readonly outcome: DigestOutcome;
  readonly reason: string;
  readonly verdict: DigestCadenceVerdict;
  /** Composed only when something was delivered; absent otherwise. */
  readonly digest?: Digest;
  /** The transport's answer, present only on `delivered`. */
  readonly destination?: string;
  /**
   * Windows that elapsed with nothing sent. Repeated out here rather than left
   * on `verdict` alone because this is what a caller branches on, and a number
   * a caller has to go two levels down for is a number a caller forgets.
   */
  readonly missed: number;
}

/** The digest's own ledger, beside the loop's, and for the same reason. */
export function deliveriesPath(dir: string): string | null {
  const state = loopStateDir(dir);
  return state === null ? null : path.join(state, "digests.jsonl");
}

/**
 * Read the delivery ledger, newest first.
 *
 * Same fail-quiet-on-junk rule as `readRuns`: a line that does not parse, or
 * that carries no usable stamp, is dropped rather than repaired. A delivery
 * whose time cannot be read cannot bound a window, and a repaired stamp would
 * be this process inventing the fact the whole cadence turns on.
 */
export function readDeliveries(dir: string): DigestDelivery[] {
  const p = deliveriesPath(dir);
  if (p === null || !fs.existsSync(p)) return [];
  const out: DigestDelivery[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as DigestDelivery;
      if (typeof parsed?.at !== "string" || !Number.isFinite(Date.parse(parsed.at))) continue;
      if (typeof parsed?.coveredThrough !== "string" || !Number.isFinite(Date.parse(parsed.coveredThrough))) continue;
      out.push(parsed);
    } catch {
      continue;
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function appendDelivery(dir: string, delivery: DigestDelivery): void {
  const p = deliveriesPath(dir);
  if (p === null) {
    throw new Error(
      `${path.resolve(dir)} is not a git checkout — the digest records every delivery under .git/ost-agent/ ` +
        "and refuses to deliver where it cannot record. A send nothing remembers is a send that repeats itself " +
        "every cadence forever. Run `git init` there first.",
    );
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(delivery) + "\n");
}

const stamp = (ms: number): string => new Date(ms).toISOString();

/**
 * Is a digest due, and did any window go by without one?
 *
 * The future-stamp rule is `cadence.ts`'s, for the identical reason: a single
 * delivery stamped ahead of the clock would answer "when did this last go out"
 * for as long as it stayed ahead, and the way out has to exist without anyone
 * hand-editing a JSONL file. So such a record does not bound the window, and is
 * counted out separately rather than swallowed.
 */
export function evaluateDigestCadence(input: {
  deliveries: readonly DigestDelivery[];
  now: number;
  cadenceMs: number | null;
}): DigestCadenceVerdict {
  const { deliveries, now, cadenceMs } = input;

  if (cadenceMs === null) {
    return {
      status: "undeclared",
      reason:
        "no `digest.cadence` in ost.config.yaml — this vault sends no digest. " +
        'Declare one (`digest:\\n  cadence: "7d"\\n  destination: "../digests"`) or leave it off.',
      missed: 0,
      ignoredFuture: 0,
    };
  }

  const usable = deliveries.filter((d) => Date.parse(d.at) <= now);
  const ignoredFuture = deliveries.length - usable.length;
  const last = usable[0];

  if (!last) {
    return {
      status: "due",
      reason:
        ignoredFuture > 0
          ? `no digest on record that could have gone out yet (${ignoredFuture} stamped in the future, ignored)`
          : "no digest has ever gone out",
      // Not a miss. Nothing was promised before the first one.
      missed: 0,
      ignoredFuture,
    };
  }

  const lastMs = Date.parse(last.at);
  const nextDueMs = lastMs + cadenceMs;
  // Windows fully elapsed since the last delivery, minus the one now open: two
  // full windows since the last send means one was skipped and this is the
  // second. Floored at zero so clock skew inside a window cannot read as a miss.
  const elapsedWindows = Math.floor((now - lastMs) / cadenceMs);
  const missed = Math.max(0, elapsedWindows - 1);
  const common = { lastDeliveredAt: last.at, nextDueAt: stamp(nextDueMs), missed, ignoredFuture };

  if (now < nextDueMs) {
    return { status: "not-elapsed", reason: `next digest due ${stamp(nextDueMs)}`, ...common };
  }
  return {
    status: "due",
    reason:
      missed > 0
        ? `MISSED — ${missed} digest window(s) elapsed with nothing sent since ${last.at}`
        : `last digest ${last.at}`,
    ...common,
  };
}

/** How many asks a digest names before it stops being read. The node's own number. */
export const ASK_LIMIT = 2;

/**
 * Compose the digest over the window the ledger opened.
 *
 * `since` is exclusive and comes from the previous delivery, so a run named in
 * one digest is never named in the next. That is the difference between a digest
 * and the report it would otherwise be: restating the tree every week is what
 * the operator already has, and what they already ignore.
 */
export function composeDigest(input: {
  runs: readonly LoopRunRecord[];
  asks: readonly PendingAsk[];
  since: string | null;
  through: string;
  missed: number;
}): Digest {
  const { runs, asks, since, through, missed } = input;
  const lower = since === null ? Number.NEGATIVE_INFINITY : Date.parse(since);
  const upper = Date.parse(through);
  const changes = runs
    .filter((r) => {
      const at = Date.parse(r.startedAt);
      return Number.isFinite(at) && at > lower && at <= upper;
    })
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .map((r) => ({ runId: r.runId, at: r.startedAt, verdict: r.verdict ?? ("unsealed" as const) }));
  return { since, through, changes, asks: asks.slice(0, ASK_LIMIT), asksTotal: asks.length, missed };
}

/** The subject line — the window and its headline count, nothing else. */
export function digestSubject(d: Digest): string {
  const scope = d.since === null ? "first digest" : `since ${d.since}`;
  return `OST-Agent digest — ${d.changes.length} change(s) ${scope}`;
}

/**
 * Render the digest a stakeholder reads.
 *
 * Ruthlessly short on purpose: the trade-off the solution node states is that a
 * digest nobody asked for becomes noise, and length is the variable. So it names
 * what happened, what still needs a person, and stops. An empty window says so
 * in one line — silence and "nothing happened" are different facts, and a digest
 * that skipped the empty week would be indistinguishable from a dead cadence.
 */
export function renderDigest(d: Digest): string {
  const lines: string[] = [];
  if (d.missed > 0) {
    lines.push(`MISSED: ${d.missed} digest window(s) went by with nothing sent. This one covers them too.`);
    lines.push("");
  }
  lines.push(d.since === null ? "Covering everything on record so far." : `What changed since ${d.since}:`);
  if (d.changes.length === 0) {
    lines.push("  nothing — no pass fired in this window.");
  } else {
    for (const c of d.changes) lines.push(`  ${c.at} — pass ${c.runId} sealed ${c.verdict}`);
  }
  lines.push("");
  if (d.asksTotal === 0) {
    lines.push("Needs you: nothing.");
  } else {
    const more = d.asksTotal > d.asks.length ? ` (${d.asksTotal - d.asks.length} more waiting)` : "";
    lines.push(`Needs you${more}:`);
    for (const a of d.asks) lines.push(`  "${a.test}" — ${a.why || "no reason recorded"}\n    clear it: ${a.command}`);
  }
  return lines.join("\n");
}

/**
 * The one built-in transport: write the digest into a directory the operator
 * named. Returns the file it wrote, which is what the ledger records.
 *
 * The filename carries the DELIVERY stamp — `message.at`, not this function's own
 * clock — so a folder of these reads as a sequence and two digests covering
 * different windows can never collide on a shared millisecond of wall time. The
 * file is written with `wx`, so a genuine same-stamp collision throws rather than
 * overwriting a digest somebody may not have read yet.
 */
export function fileDropTransport(destination: string): DigestTransport {
  return {
    name: "file-drop",
    send(message) {
      fs.mkdirSync(destination, { recursive: true });
      const file = path.join(destination, `${message.at.replace(/[:.]/g, "-")}-digest.md`);
      fs.writeFileSync(file, `# ${message.subject}\n\n${message.body}\n`, { flag: "wx" });
      return file;
    },
  };
}

/**
 * Is this destination inside the vault?
 *
 * The same containment test the drop folders use, and the same reason DEC-1
 * gives for theirs: "outside the vault" has to be decided on resolved paths, or
 * a `..` in the middle of a string decides it instead. The vault itself counts
 * as inside — a digest written to the vault root is as unread as one written to
 * `.ost-agent/`.
 */
export function isInsideVault(vaultDir: string, destination: string): boolean {
  const vault = path.resolve(vaultDir);
  const dest = path.resolve(vaultDir, destination);
  if (dest === vault) return true;
  const rel = path.relative(vault, dest);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export interface DeliverDigestInput {
  /** The vault. Read for runs and asks, and never written. */
  readonly dir: string;
  readonly settings: DigestSettings;
  readonly runs: readonly LoopRunRecord[];
  readonly asks: readonly PendingAsk[];
  /** Injected in tests and by any operator wrapper that owns the real send. */
  readonly transport?: DigestTransport;
  /** Injected for the same reason every clock in this codebase is. */
  readonly now?: Date;
}

/**
 * Compose and push one digest, if one is due, and append what happened.
 *
 * Four outcomes and they are deliberately four. `undeclared` is a vault that
 * asked for nothing; `not-elapsed` is a cadence working as declared;
 * `refused` is a destination that would have left the digest in the vault;
 * `delivered` is the only one that appends to the ledger. Collapsing `refused`
 * into `not-elapsed` would make a misconfigured vault look like a quiet one,
 * which is the failure this whole file is about.
 */
export function deliverDigest(input: DeliverDigestInput): DigestDeliveryResult {
  const { dir, settings, runs, asks } = input;
  const now = input.now ?? new Date();
  const deliveries = readDeliveries(dir);
  const verdict = evaluateDigestCadence({
    deliveries,
    now: now.getTime(),
    cadenceMs: parseCadence(settings.cadence),
  });

  if (verdict.status !== "due") {
    return { outcome: verdict.status === "undeclared" ? "undeclared" : "not-elapsed", reason: verdict.reason, verdict, missed: verdict.missed };
  }

  const destination = settings.destination;
  if (destination == null || destination.trim() === "") {
    return {
      outcome: "undeclared",
      reason:
        "a digest is due and `digest.destination` names nowhere to put it — declare where the stakeholder " +
        "already reads, or the cadence is a timer wired to nothing",
      verdict,
      missed: verdict.missed,
    };
  }
  if (input.transport === undefined && isInsideVault(dir, destination)) {
    return {
      outcome: "refused",
      reason:
        `digest.destination "${destination}" resolves inside the vault — a digest filed where the tree lives is ` +
        "not delivered, it is one more thing to go and read. Point it outside the vault.",
      verdict,
      missed: verdict.missed,
    };
  }

  const through = now.toISOString();
  // The window's lower edge comes from the delivery the VERDICT bounded itself
  // by, found by its stamp rather than by position. `deliveries[0]` is the
  // newest on the ledger, which is not the same record when one is stamped in
  // the future — and reading `coveredThrough` off a future record would open the
  // window ahead of now and produce an empty digest for a full one.
  const bounding = deliveries.find((d) => d.at === verdict.lastDeliveredAt);
  const digest = composeDigest({
    runs,
    asks,
    since: bounding?.coveredThrough ?? null,
    through,
    missed: verdict.missed,
  });
  const transport = input.transport ?? fileDropTransport(path.resolve(dir, destination));
  const landed = transport.send({ subject: digestSubject(digest), body: renderDigest(digest), at: through });
  appendDelivery(dir, {
    at: through,
    coveredThrough: through,
    transport: transport.name,
    destination: landed,
    changes: digest.changes.length,
  });
  return {
    outcome: "delivered",
    reason:
      verdict.missed > 0
        ? `delivered to ${landed} — and ${verdict.missed} window(s) before it were missed`
        : `delivered to ${landed}`,
    verdict,
    digest,
    destination: landed,
    missed: verdict.missed,
  };
}

/** What `ost-agent digest` prints. The outcome first, because it is the answer. */
export function renderDeliveryResult(result: DigestDeliveryResult): string {
  const head = `digest: ${result.outcome.toUpperCase()} — ${result.reason}`;
  return result.digest ? `${head}\n\n${renderDigest(result.digest)}` : head;
}
