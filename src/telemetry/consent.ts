/**
 * The consent ledger, and the gate every raw export has to get past.
 *
 * `usage.ts` writes the operator's trace into their own vault, under their own
 * git history, and nothing in this repository ships it anywhere. That is the
 * posture the product promises — local-first, the founder receives full fidelity
 * from operators who opt in rather than thin telemetry from everyone — and until
 * now it was a promise rather than a mechanism: the promise was kept by there
 * being no export code yet, which is the weakest form of keeping it. The moment
 * anyone writes the export, "we only ship with consent" becomes a sentence in a
 * README that no exit code checks.
 *
 * So the export is written here, with the check in front of it, and the check is
 * the only door. Three properties, and each is asserted in
 * `test/telemetry/export-requires-consent.test.ts`:
 *
 *   1. **Local by default, with no outward path.** Recording a usage event
 *      reaches the vault and nothing else, and no module under `src/telemetry/`
 *      holds network capability at all — no `fetch`, no `node:http`, no socket.
 *      {@link exportRawUsage} does not send: it RETURNS the bundle to whoever
 *      asked, and the operator decides where those bytes go. A function that
 *      posted somewhere would make the consent check the only thing standing
 *      between a background pass and an upload; a function that returns bytes
 *      makes the operator's own hands the transport.
 *   2. **Raw export is refused without a dated consent record in the vault.**
 *      Not a config flag, not an env var — a dated, attributed, append-only
 *      record inside the operator's own vault, in their own git history, where
 *      they can read what they agreed to and when.
 *   3. **Revoking stops further export and touches nothing already held.** A
 *      revocation is an appended record, never a deletion, and it does not reach
 *      the usage log: the operator keeps every event they collected, because the
 *      log was always theirs. Withdrawing consent means "stop giving it to me",
 *      not "destroy your own records".
 *
 * **Green here does not mean operators will consent.** That is a person's
 * decision about their own data and no exit code substitutes for asking them —
 * the assumption test above this build ("at least four of ten consent without
 * requiring a bespoke redaction feature") is still unrun, and still needs a
 * human to run it. What this module retires is only the precondition: asking is
 * safe to do now, because consent is the thing that gates the shipping.
 *
 * **Granting is human-only, like `dispose`, `result` and `promote`.** The write
 * path is `ost-agent usage-consent`, a CLI command a person runs, and it is
 * deliberately absent from the agent tool surface. A pass that could grant
 * itself permission to ship the operator's raw trace has issued its own permit,
 * which is the same shape as the self-validation the tool allowlist exists to
 * refuse.
 *
 * Sidecar shape follows `knowledge/suppressions.ts` and `knowledge/dispositions.ts`:
 * append-only JSONL, attributed, dated off an injected clock, read as a history.
 * The one place it deliberately differs is damage handling, and the difference is
 * the whole safety argument — see {@link readConsentLedger}.
 */
import fs from "node:fs";
import path from "node:path";
import { usageLogPath, type UsageEvent } from "./usage.js";

/**
 * What a consent record may cover. Closed, and one entry today, for the reason
 * the suppression vocabulary is closed: a scope invented at the call site is a
 * scope the operator never saw worded, and "consented to raw-usage" would then
 * silently license whatever the next writer decided to call it.
 */
export const CONSENT_SCOPES = [
  /** The un-redacted contents of the vault's usage log — every traced tool call, as recorded. */
  "raw-usage",
] as const;

export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export function isConsentScope(value: unknown): value is ConsentScope {
  return typeof value === "string" && (CONSENT_SCOPES as readonly string[]).includes(value);
}

/** The two things an operator can say about a scope. Both are appends; neither deletes. */
export const CONSENT_DECISIONS = ["granted", "revoked"] as const;

export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/**
 * One dated statement by an operator about what may leave their machine.
 *
 * Every field is required except the note, and each is required for a reason a
 * reader can check: without `ts` the record is not dated and cannot answer "when
 * did I agree to this"; without `by` nobody signed it; without `scope` it
 * licenses everything.
 */
export interface ConsentRecord {
  /** When it was written, from the injected clock — never `Date.now()` directly. */
  ts: string;
  /** Granted or revoked. Latest entry for a scope is the standing answer. */
  decision: ConsentDecision;
  /** What it covers, from the closed vocabulary. */
  scope: ConsentScope;
  /** Who said it. A consent nobody signed is not one. */
  by: string;
  /** The operator's own words, kept for them to re-read. The gate never consults it. */
  note?: string;
}

/**
 * Beside the log it governs (`.ost-agent/usage/`), not in a ledger directory of
 * its own: an operator looking at where their trace lives finds the record of
 * what they agreed to in the same folder, without being told where else to look.
 */
export function consentLedgerPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "usage", "consent.jsonl");
}

/**
 * Append one consent record. Validated at this funnel so no caller can store a
 * decision or scope the gate would then have to interpret.
 */
export function appendConsent(
  vaultDir: string,
  rec: { decision: unknown; scope?: unknown; by: string; note?: string },
  now: () => Date = () => new Date(),
): ConsentRecord {
  if (typeof rec.decision !== "string" || !(CONSENT_DECISIONS as readonly string[]).includes(rec.decision)) {
    throw new Error(`a consent record is ${CONSENT_DECISIONS.join(" or ")} — got ${JSON.stringify(rec.decision)}`);
  }
  const scope = rec.scope ?? "raw-usage";
  if (!isConsentScope(scope)) {
    throw new Error(`a consent record names one of: ${CONSENT_SCOPES.join(", ")} — got ${JSON.stringify(rec.scope)}`);
  }
  if (!rec.by.trim()) {
    throw new Error("a consent record needs attribution — say who is consenting, because nobody else can consent for them");
  }
  const record: ConsentRecord = {
    ts: now().toISOString(),
    decision: rec.decision as ConsentDecision,
    scope,
    by: rec.by.trim(),
    ...(rec.note?.trim() ? { note: rec.note.trim() } : {}),
  };
  const file = consentLedgerPath(vaultDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return record;
}

/** The ledger as read: every record in file order, plus the count of lines that would not parse. */
export interface ConsentLedger {
  records: readonly ConsentRecord[];
  damaged: number;
}

function parseConsentLine(raw: string): ConsentRecord | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  if (typeof rec.ts !== "string" || !rec.ts.trim()) return null;
  if (typeof rec.decision !== "string" || !(CONSENT_DECISIONS as readonly string[]).includes(rec.decision)) return null;
  if (!isConsentScope(rec.scope)) return null;
  if (typeof rec.by !== "string" || !rec.by.trim()) return null;
  return {
    ts: rec.ts,
    decision: rec.decision as ConsentDecision,
    scope: rec.scope,
    by: rec.by,
    ...(typeof rec.note === "string" && rec.note.trim() ? { note: rec.note } : {}),
  };
}

/**
 * Read the ledger, dropping lines that will not parse.
 *
 * **This fails in the opposite direction from the suppression ledger, and the
 * inversion is deliberate.** There, a damaged line suppresses nothing, so a
 * corrupted file surfaces MORE work — fail-open is the safe direction when the
 * cost of the failure is a wasted look. Here the cost is somebody's raw trace
 * leaving their machine, so a line this reader cannot understand grants nothing:
 * a truncated write, a hand-edit, a merge conflict marker in the file all leave
 * the export refused. The only thing that can license an export is a record this
 * parser fully understood, and `damaged` is carried out so a caller can say
 * "your consent file has an unreadable line" rather than silently reading past
 * it — a corrupted grant must announce itself, not just fail.
 */
export function readConsentLedger(vaultDir: string): ConsentLedger {
  const file = consentLedgerPath(vaultDir);
  if (!fs.existsSync(file)) return { records: [], damaged: 0 };
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    // An unreadable ledger is not an absent one: it is a file whose contents we
    // cannot vouch for, and vouching is this module's only job.
    return { records: [], damaged: 1 };
  }
  const records: ConsentRecord[] = [];
  let damaged = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const rec = parseConsentLine(line);
    if (!rec) {
      damaged += 1;
      continue;
    }
    records.push(rec);
  }
  return { records, damaged };
}

/**
 * The standing statement for one scope — the last record written about it, or
 * `null` when the operator has never spoken about it. Latest wins, which is what
 * makes revocation work without any deletion: a `revoked` record does not remove
 * the grant, it supersedes it, and the history of both stays readable.
 */
export function standingConsent(ledger: ConsentLedger, scope: ConsentScope = "raw-usage"): ConsentRecord | null {
  for (let i = ledger.records.length - 1; i >= 0; i -= 1) {
    if (ledger.records[i].scope === scope) return ledger.records[i];
  }
  return null;
}

/** Is this scope consented right now? The one question the gate asks. */
export function hasConsent(ledger: ConsentLedger, scope: ConsentScope = "raw-usage"): boolean {
  return standingConsent(ledger, scope)?.decision === "granted";
}

/**
 * Thrown when an export is asked for and the vault does not license it.
 *
 * A distinct type rather than a plain `Error` for the reason
 * `PermissionDeniedError` is one: a caller deciding what to tell the operator
 * needs to know this was a refusal about permission, not a failure to read the
 * log, and a caller that had to match on message text would drift the moment the
 * wording improved.
 */
export class ConsentRequiredError extends Error {
  /** Which scope was refused, so a caller can name the exact grant that is missing. */
  readonly scope: ConsentScope;
  constructor(message: string, scope: ConsentScope) {
    super(message);
    this.name = "ConsentRequiredError";
    this.scope = scope;
  }
}

/**
 * What a consented export produces: the raw events, and the record that licensed
 * them travelling.
 *
 * The consent goes in the bundle rather than staying behind in the vault so the
 * provenance survives the trip — a receiver holding raw events can say who
 * consented and when, instead of taking the sender's word for it. It carries the
 * ledger's own `ts`, `by` and `scope` and nothing further.
 */
export interface RawUsageExport {
  /** The scope the operator consented to, echoed so a receiver need not infer it. */
  scope: ConsentScope;
  /** The standing consent record that licensed this export. */
  consent: ConsentRecord;
  /** When the export was produced, from the injected clock. */
  exportedAt: string;
  /** The vault's usage log, verbatim, in file order. */
  events: readonly UsageEvent[];
  /** Log lines that would not parse — reported rather than silently dropped, so a thin export is visibly thin. */
  unreadableLines: number;
}

/**
 * Produce the raw export, or refuse.
 *
 * **This function does not send anything.** It reads the vault, checks the
 * ledger, and returns bytes to its caller — the operator's own command is the
 * transport. Nothing here opens a socket and nothing under `src/telemetry/` can,
 * which is what makes "local by default with no outward path" a fact about the
 * code rather than a policy someone is trusted to follow.
 *
 * It also never writes to, truncates, or rotates the usage log. The log is the
 * operator's; an export is a copy of it leaving, not a handover of it.
 */
export function exportRawUsage(
  vaultDir: string,
  opts: { scope?: ConsentScope; now?: () => Date } = {},
): RawUsageExport {
  const scope = opts.scope ?? "raw-usage";
  const now = opts.now ?? (() => new Date());
  const ledger = readConsentLedger(vaultDir);
  const standing = standingConsent(ledger, scope);

  if (!standing || standing.decision !== "granted") {
    // Three refusals, worded apart, because the operator's next action differs in
    // each case and a single "consent required" would hide which one they are in.
    const reason =
      standing?.decision === "revoked"
        ? `consent for "${scope}" was revoked on ${standing.ts} by ${standing.by} — nothing further leaves this vault until it is granted again`
        : ledger.damaged > 0
          ? `no readable consent record for "${scope}" — the ledger holds ${ledger.damaged} line(s) this reader could not parse, and an unreadable grant is not a grant`
          : `no consent record for "${scope}" in this vault — raw usage does not leave a machine nobody asked`;
    throw new ConsentRequiredError(
      `${reason}. Grant it with \`ost-agent usage-consent grant --by "<you>" --vault ${vaultDir}\`, which appends a dated record to ${consentLedgerPath(vaultDir)}.`,
      scope,
    );
  }

  const file = usageLogPath(vaultDir);
  const events: UsageEvent[] = [];
  let unreadableLines = 0;
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as UsageEvent);
      } catch {
        unreadableLines += 1;
      }
    }
  }

  return { scope, consent: standing, exportedAt: now().toISOString(), events, unreadableLines };
}

/** Render the standing consent for a human reading `ost-agent usage-consent` with no verb. */
export function formatConsent(ledger: ConsentLedger, scope: ConsentScope = "raw-usage"): string {
  const lines: string[] = [];
  const standing = standingConsent(ledger, scope);
  if (!standing) {
    lines.push(`${scope}: never asked — no consent record in this vault, so no raw export can be produced.`);
  } else if (standing.decision === "granted") {
    lines.push(`${scope}: GRANTED ${standing.ts} by ${standing.by}${standing.note ? ` — ${standing.note}` : ""}`);
  } else {
    lines.push(`${scope}: REVOKED ${standing.ts} by ${standing.by}${standing.note ? ` — ${standing.note}` : ""}`);
    lines.push("  Everything already collected is still in your vault; revocation stops export, it deletes nothing.");
  }
  const history = ledger.records.filter((r) => r.scope === scope);
  if (history.length > 1) {
    lines.push(`  ${history.length} record(s) in this scope's history — the ledger is append-only, so every earlier answer is still readable.`);
  }
  if (ledger.damaged > 0) {
    lines.push(`  ${ledger.damaged} line(s) in the ledger could not be parsed and license nothing.`);
  }
  return lines.join("\n");
}
