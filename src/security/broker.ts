/**
 * The credential broker — a process holds the secret, a run asks it for a
 * scoped action, and the run never sees the secret.
 *
 * **The shape of the problem.** Every credential this codebase uses is read out
 * of the environment and handed, in full, to whatever needs it: the Slack bot
 * token to an HTTP client, the Atlassian token into a Basic-auth header, the
 * search key onto `PassContext.web.searchApiKey` — an object every tool is built
 * with. A secret that has been handed over is a secret whose use is unbounded
 * and unrecorded: nothing constrains what it is spent on, and nothing anywhere
 * says what it was spent on.
 *
 * A broker converts the credential from a thing a run must POSSESS into a
 * service a run may CALL. The three properties that follow are the whole point,
 * and each is asserted in `test/security/credential-broker.test.ts`:
 *
 *  1. **Containment.** The secret is held in this module's closure. Nothing the
 *     broker returns carries it, no method hands it out, and a result or error
 *     that happens to echo it is scrubbed on the way past. What a run holds is a
 *     {@link CredentialHandle} — an opaque name, worthless to whoever steals it.
 *  2. **Scope.** A request names an ACTION and a TARGET, never a credential. The
 *     grant table decides which credential answers, and a request outside it is
 *     refused without the action ever running. The pattern language is
 *     deliberately tiny (exact, or one `…/*` prefix) so a grant cannot widen by
 *     accident; anything else throws when the broker is built, not when the
 *     request arrives.
 *  3. **Audit.** Every request lands in the log — who asked, for what, and what
 *     came back — including the ones that were refused. **No record, no action:**
 *     if the log cannot be written, the request is denied and nothing is
 *     performed. That is the one property that makes the broker worth its cost
 *     over a short-lived scoped token, so it fails closed rather than best-effort.
 *
 * **What this is NOT.** It is not a tool, and it never becomes one. Nothing in
 * `ALLOWED_TOOL_NAMES` reaches it; it is constructed by the runner and consumed
 * by adapters. A model can ask a brokered adapter to fetch a page it is already
 * allowed to fetch — it cannot ask the broker for anything, which is why adding
 * it changes the tool surface not at all (`test/security/policy.test.ts` and the
 * surface assertions in the broker's own spec both hold that line).
 *
 * **The trade the node this implements names against itself:** a broker
 * concentrates every secret into one process on one machine. Nothing here fixes
 * that. What it buys, and the alternatives do not, is the record.
 */

/**
 * An opaque reference to a held credential — what a run is given instead of the
 * secret.
 *
 * The prefix is deliberately conspicuous. A handle that escapes into a log, a
 * transcript or a vault note reads as obviously not-a-secret, and a request that
 * skips the broker and sends the handle to a vendor gets a 401 rather than
 * succeeding — a wrong path fails loudly instead of leaking quietly.
 */
export type CredentialHandle = string;

const HANDLE_PREFIX = "ost-credential:";

/**
 * The shortest secret the broker will hold.
 *
 * Scrubbing is substring replacement, so a two-character secret would redact
 * half the English language out of every result and audit line it touched. A
 * credential that short is also not a credential. Refused at construction —
 * silently declining to scrub it would leave the containment claim false exactly
 * where nobody would look.
 */
export const MIN_SECRET_CHARS = 8;

/**
 * Whether a value is something the broker will hold at all — the ONE definition
 * of "this credential is usable", exported so nothing gets to have a second one.
 *
 * `src/adapters/channels.ts` decides whether a channel is reportable without
 * constructing anything, and `buildPassContext` decides whether it can build.
 * Those two answers are pinned together by `test/cli/channels.test.ts`, and the
 * moment the broker started refusing a value the health probe still counted as
 * present, they were one `if` away from disagreeing — which is the failure that
 * test exists to catch.
 */
export function usableSecret(value: string | undefined): boolean {
  const trimmed = value?.trim();
  return typeof trimmed === "string" && trimmed.length >= MIN_SECRET_CHARS;
}

/** How much of a result the audit record keeps. Enough to identify, not to mirror. */
const MAX_DETAIL_CHARS = 200;

/** One line of the grant table: this asker may do this action to these targets, with this credential. */
export interface Grant {
  /** Who is allowed to ask — the run, adapter or subsystem making the request. */
  asker: string;
  /** Which action, one of the keys of the broker's action table. */
  action: string;
  /** Which held credential answers. Must name a credential the broker holds. */
  credential: string;
  /** Exact targets, or `prefix/*` patterns. Anything else throws at construction. */
  targets: readonly string[];
}

/** What a run sends. Note what is absent: it cannot name, or even see, a credential. */
export interface BrokerRequest {
  asker: string;
  action: string;
  /** The specific thing being acted on — a URL, a branch, a repository. */
  target: string;
  /** Non-secret parameters the action needs. Never recorded in the audit log. */
  args?: Record<string, unknown>;
}

/** What an action receives. The secret arrives here and goes nowhere else. */
export interface PerformInput {
  /** The credential, in the clear, for the duration of this one call. */
  secret: string;
  /** The handle the caller may have embedded in its own arguments, for substitution. */
  handle: CredentialHandle;
  target: string;
  args?: Record<string, unknown>;
}

/** Something the broker knows how to do with a credential. Injected, so tests run offline. */
export type Action = (input: PerformInput) => Promise<unknown> | unknown;

/** Why a request was refused. Every one of these means the action did not run. */
export type DenialReason =
  /** No grant gives this asker this action at all. */
  | "no-grant"
  /** A grant exists for the pair, and the target is not in it. */
  | "out-of-scope"
  /** The grant names an action this broker was not built with. */
  | "unknown-action"
  /** The request could not be recorded, so it was not performed. */
  | "unauditable";

export type BrokerResponse =
  | {
      status: "performed";
      result: unknown;
      /** The action ran and its OUTCOME could not be recorded. See `request`. */
      auditIncomplete?: boolean;
    }
  | { status: "denied"; reason: DenialReason; why: string }
  | { status: "failed"; why: string; auditIncomplete?: boolean };

/**
 * One line of the audit log.
 *
 * Two per request, joined by `id`: a `request` line written BEFORE the credential
 * is used, and an `outcome` line written after. The pair is what makes a
 * credential use that crashed mid-flight visible — a single line written at the
 * end would leave a hung or killed action with no trace at all, which is the
 * exact case an operator most wants to see.
 */
export interface AuditRecord {
  /** ISO timestamp from the injected clock. */
  at: string;
  /** Joins the two phases of one request. Per-broker, monotonic. */
  id: string;
  phase: "request" | "outcome";
  asker: string;
  action: string;
  target: string;
  /** The credential the grant resolved to, by NAME. Absent when nothing matched. */
  credential?: string;
  outcome?: "performed" | "denied" | "failed";
  /** What came back, scrubbed and clipped. Present on the outcome line. */
  detail?: string;
  reason?: DenialReason;
}

/** Where audit records go. Throwing is meaningful: see the "no record, no action" rule. */
export type AuditSink = (record: AuditRecord) => void;

export interface CredentialBrokerOptions {
  /** name → secret. Held in closure; never returned, never enumerated by value. */
  credentials: Record<string, string>;
  grants: readonly Grant[];
  actions: Record<string, Action>;
  /** Defaults to an in-memory sink, which is only ever the right choice in a test. */
  audit?: AuditSink;
  /** Injected clock — audit timestamps are data, and data in tests must be fixed. */
  now?: () => string;
}

export interface CredentialBroker {
  /** The names of the credentials held. Names only — this is the whole introspection surface. */
  readonly names: readonly string[];
  holds(name: string): boolean;
  /** The opaque reference a run may hold in place of the secret. Throws for a credential not held. */
  handle(name: string): CredentialHandle;
  request(req: BrokerRequest): Promise<BrokerResponse>;
}

/**
 * Validate one target pattern.
 *
 * The language is exact-match plus a single trailing `/*`, and everything else
 * is a construction-time error. A scope policy whose patterns can be subtly
 * wrong is worse than no policy: `slack.com/api*` looks like the intended grant
 * and also matches `slack.com/apiary.example.com`, and nothing at request time
 * could tell the operator which one they meant. So the broker refuses to be
 * built rather than resolve the ambiguity on their behalf.
 */
function assertPattern(pattern: string, grant: Grant): void {
  const star = pattern.indexOf("*");
  if (star === -1) return;
  if (star !== pattern.length - 1 || !pattern.endsWith("/*")) {
    throw new Error(
      `credential broker: grant ${grant.asker}/${grant.action} has target pattern "${pattern}" — ` +
        `the only wildcard form is a trailing "/*" (e.g. "https://slack.com/api/*"). ` +
        `A pattern that can be read two ways is refused here rather than resolved at request time.`,
    );
  }
}

/** Exact, or under a `prefix/*` grant. Nothing crosses a prefix it was not given. */
function matchesTarget(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  if (!pattern.endsWith("/*")) return false;
  const prefix = pattern.slice(0, -1); // keep the trailing slash: "https://x/api/"
  return target.startsWith(prefix) && target.length > prefix.length;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_DETAIL_CHARS ? `${flat.slice(0, MAX_DETAIL_CHARS)}…` : flat;
}

/** Is this a value the broker can walk safely? Plain objects and arrays only. */
function isPlain(value: unknown): value is Record<string, unknown> | unknown[] {
  if (Array.isArray(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function createCredentialBroker(opts: CredentialBrokerOptions): CredentialBroker {
  const now = opts.now ?? (() => new Date().toISOString());
  const audit = opts.audit ?? (() => {});

  // The secrets. This Map is the only place they exist in this process, and no
  // exported member of the returned object can reach it.
  const secrets = new Map<string, string>();
  for (const [name, secret] of Object.entries(opts.credentials)) {
    if (typeof secret !== "string" || secret.length < MIN_SECRET_CHARS) {
      throw new Error(
        `credential broker: credential "${name}" is shorter than ${MIN_SECRET_CHARS} characters. ` +
          `Scrubbing is substring replacement, so a secret that short cannot be redacted without ` +
          `mangling unrelated text — it is refused rather than held unscrubbable.`,
      );
    }
    secrets.set(name, secret);
  }

  for (const grant of opts.grants) {
    if (!secrets.has(grant.credential)) {
      throw new Error(
        `credential broker: grant ${grant.asker}/${grant.action} names credential "${grant.credential}", ` +
          `which is not held. Grants are checked when the broker is built so a scope can never ` +
          `silently resolve to nothing at request time.`,
      );
    }
    if (grant.targets.length === 0) {
      throw new Error(
        `credential broker: grant ${grant.asker}/${grant.action} lists no targets. ` +
          `An empty scope denies everything, which is what withholding the grant already does — ` +
          `it reads as an unfinished policy, so it is refused.`,
      );
    }
    for (const pattern of grant.targets) assertPattern(pattern, grant);
  }

  /**
   * Replace every held secret with `[redacted]`.
   *
   * Applied to everything leaving the broker — results, failure messages, audit
   * detail — because the alternative is trusting each action not to echo what it
   * was given, and an action that does echo it would leak into the very log
   * written to prove it did not.
   */
  function scrub(text: string): string {
    let out = text;
    for (const secret of secrets.values()) out = out.split(secret).join("[redacted]");
    return out;
  }

  /**
   * Scrub a returned value in place of its strings.
   *
   * Walks strings, arrays and plain objects. A class instance, a stream or a
   * function is returned untouched and this is stated rather than hidden: for
   * those, containment rests on the structural fact that the secret was handed
   * to the ACTION and never to the caller. The one such value this repository
   * actually returns — an HTTP response — is scrubbed at its own boundary by
   * `brokered-fetch.ts`, which reads and scrubs the body before handing it back.
   */
  function scrubValue(value: unknown): unknown {
    if (typeof value === "string") return scrub(value);
    if (Array.isArray(value)) return value.map(scrubValue);
    if (isPlain(value)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubValue(v);
      return out;
    }
    return value;
  }

  let seq = 0;

  /** Write one record. Returns false when the sink refused it — the caller decides what that costs. */
  function record(rec: AuditRecord): boolean {
    try {
      audit(rec);
      return true;
    } catch {
      return false;
    }
  }

  async function request(req: BrokerRequest): Promise<BrokerResponse> {
    const id = `req-${++seq}`;
    const base = { at: now(), id, asker: req.asker, action: req.action, target: req.target };

    const forPair = opts.grants.filter((g) => g.asker === req.asker && g.action === req.action);
    const grant = forPair.find((g) => g.targets.some((t) => matchesTarget(t, req.target)));

    const denial: { reason: DenialReason; why: string } | undefined = !opts.actions[req.action]
      ? {
          reason: "unknown-action",
          why: `this broker performs no action named "${req.action}"`,
        }
      : forPair.length === 0
        ? {
            reason: "no-grant",
            why: `"${req.asker}" holds no grant for action "${req.action}"`,
          }
        : !grant
          ? {
              reason: "out-of-scope",
              why: `"${req.asker}" may perform "${req.action}", but not against "${req.target}"`,
            }
          : undefined;

    // The request line goes down BEFORE the credential is touched, so a use that
    // never returns is still visible as a use.
    const wrote = record({
      ...base,
      phase: "request",
      ...(grant ? { credential: grant.credential } : {}),
      ...(denial ? { reason: denial.reason } : {}),
    });
    if (!wrote) {
      // No record, no action. A broker whose only advantage over a scoped token
      // is the log must not act when the log is gone.
      return {
        status: "denied",
        reason: "unauditable",
        why:
          `the audit log refused the record for ${req.asker} → ${req.action} ${req.target}, ` +
          `so the request was not performed. The broker does not act unrecorded.`,
      };
    }

    if (denial || !grant) {
      const why = denial?.why ?? "no grant matched";
      record({ ...base, phase: "outcome", outcome: "denied", reason: denial?.reason ?? "no-grant", detail: why });
      return { status: "denied", reason: denial?.reason ?? "no-grant", why };
    }

    const secret = secrets.get(grant.credential) as string;
    try {
      const result = await opts.actions[req.action]({
        secret,
        handle: `${HANDLE_PREFIX}${grant.credential}`,
        target: req.target,
        ...(req.args ? { args: req.args } : {}),
      });
      const safe = scrubValue(result);
      const logged = record({
        ...base,
        phase: "outcome",
        credential: grant.credential,
        outcome: "performed",
        detail: clip(scrub(describe(safe))),
      });
      // An action already performed cannot be un-performed by a failed log
      // write, so the honest answer is the result plus the gap. The one thing
      // the broker will not do here is hand it back looking clean.
      return logged ? { status: "performed", result: safe } : { status: "performed", result: safe, auditIncomplete: true };
    } catch (err) {
      const why = scrub(err instanceof Error ? err.message : String(err));
      const logged = record({
        ...base,
        phase: "outcome",
        credential: grant.credential,
        outcome: "failed",
        detail: clip(why),
      });
      return logged ? { status: "failed", why } : { status: "failed", why, auditIncomplete: true };
    }
  }

  return {
    get names() {
      return [...secrets.keys()];
    },
    holds: (name: string) => secrets.has(name),
    handle(name: string) {
      if (!secrets.has(name)) {
        throw new Error(
          `credential broker: no credential named "${name}" is held (holding: ${[...secrets.keys()].join(", ") || "none"})`,
        );
      }
      return `${HANDLE_PREFIX}${name}`;
    },
    request,
  };
}

/** True for a string that is a handle rather than a secret. */
export function isCredentialHandle(value: string): boolean {
  return value.startsWith(HANDLE_PREFIX);
}

/** A one-line description of what came back, for the audit record. */
function describe(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/**
 * The audit sink that keeps records in memory — for tests, and for a caller that
 * wants to assert on them. Not a default anyone should ship: the point of the
 * log is that it outlives the run.
 */
export function memoryAuditSink(): AuditSink & { records: AuditRecord[] } {
  const records: AuditRecord[] = [];
  const sink = ((rec: AuditRecord) => {
    records.push(rec);
  }) as AuditSink & { records: AuditRecord[] };
  sink.records = records;
  return sink;
}
