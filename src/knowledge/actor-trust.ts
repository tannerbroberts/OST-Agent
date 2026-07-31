/**
 * The actor-keyed trust ledger — where standing is EARNED and computed, never stored.
 *
 * DEC-2: "a new stream, result, or source arrives untested, untrusted and fragile…
 * standing is earned by testing cause and effect." Until this module existed the word
 * "earned" was a word in a tool description: `rankHost` wrote the rung the agent named
 * and `hostRung` read it back, so a promotion was an assertion about an assertion.
 *
 * Three properties carry the whole design, and each is enforced by a type rather than
 * by review:
 *
 * 1. **No record carries a rung.** {@link TrustObservation} has no `rung` field in any
 *    variant. A `verdict` is a fact about a test a human ran; a rung is a conclusion,
 *    and conclusions are computed by {@link rungOf}. (B5a.)
 * 2. **The whole history is folded, not last-record-wins.** {@link readTrustLedger}
 *    returns *histories*, so there is no stored current value for a consumer to read —
 *    every consumer must call {@link rungOf}. (B5b.)
 * 3. **An actor is a `{kind, id}` pair, not a string.** `kind` comes from a closed
 *    union in code and `id` is normalized per kind, so a commissioned pipeline and a
 *    hostname can no longer share one namespace and one ceiling. `rankHost` accepted
 *    `stripe-webhook-feed` as a host and capped a first-party instrument at `expert`;
 *    both halves of that collision are now unrepresentable. (B6.)
 *
 * **The asymmetry that is the safety argument.** The agent can append only records
 * that LOWER standing (`strike`, ungated, one call). Credit (`corroboration`) is minted
 * only where the verdict is read off a test a human recorded under a reserved heading
 * (`## Results`, B1) — never supplied by the caller. Falling is one tool call; rising
 * back from a strike takes a human (`reset`), because a bad source that climbs back
 * automatically is B11's expensive failure wearing a recovery story.
 */
import fs from "node:fs";
import path from "node:path";
import { ACTORS, isActor, UNKNOWN_ACTOR, type Actor } from "../adapters/source.js";
import { claimsStoredEvidence, readEvidence } from "../processes/tree.js";
import { isHeadingLine, RESULTS_HEADING, VERDICTS, type Verdict } from "../ost/headings.js";
import type { OstNode } from "../ost/node.js";
import { titlesMatch } from "../ost/sanitize.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import { BELIEVABILITY_LADDER, FLOOR_RUNG, rungRank, weakestRung, type RungId } from "./believability.js";
import { hostTrustPath, normalizeHost, readLegacyHostRecords } from "./web-trust.js";

/* ------------------------------------------------------------------ *
 * 1. The actor namespace
 * ------------------------------------------------------------------ */

/**
 * The kinds of thing that can hold standing. Closed, declared in code, and NOT
 * derivable from config.
 *
 * `ACTORS` (adapters/source.ts) is a *producer* vocabulary — which channel captured a
 * record. This is a *standing* vocabulary — what class of thing is speaking, and
 * therefore how high it can ever climb. {@link actorTrustKey} is the total map between
 * them; keeping them separate is what stops `web` and `self` (neither of which is a
 * channel) from becoming special cases.
 *
 * **`builder` is deliberately absent.** There is no authenticated builder identity to
 * key on: a builder's reports arrive in a drop folder and are byte-identical to
 * anything else there, so a `builder` kind would be keyed on something the builder
 * writes — the same hole in a third dress, and a kind with no honest writer is a dead
 * module (G3). The builder's standing IS `channel:inbox` until an authenticated
 * builder channel exists, at which point it becomes a member here, in the file where
 * ceilings live.
 */
export const TRUST_KINDS = ["web", "channel", "instrument", "sponsor", "self", "unattributed"] as const;
export type TrustKind = (typeof TRUST_KINDS)[number];

export function isTrustKind(value: unknown): value is TrustKind {
  return typeof value === "string" && (TRUST_KINDS as readonly string[]).includes(value);
}

/** A ledger row's identity. Only {@link actorKey} may mint one. */
export interface ActorKey {
  kind: TrustKind;
  id: string;
}

/**
 * The strongest rung {@link rungOf} may ever return for a kind, and where a kind stands
 * with an empty history.
 *
 * Each ceiling is read off the ladder's own definitions rather than chosen:
 *
 * - `web` → `expert`. A publisher is a byline, and `expert` is "judgement from someone
 *   with relevant experience, but not about their own behavior" — a publisher exactly.
 *   The shipped rule in two places already says a byline never confers observed/money.
 * - `channel` → `stated`. Slack and Jira hold what people *said*; `stated` is "a
 *   first-person account, not a measurement". It starts at the floor because DEC-2's
 *   sentence is about precisely this: a new stream arrives untested.
 * - `instrument` → `observed`, **and it starts there too: an instrument can only
 *   fall.** The vault's own recording apparatus, declared in code, not mintable from
 *   config. `observed` is "recorded as it happened rather than recalled afterwards" —
 *   what a measuring device structurally produces. The asymmetry is correct for an
 *   instrument, and it is what makes a first-party commissioned pipeline hold
 *   `observed` by construction rather than by promotion (B6b).
 * - `sponsor` → `stated`. Part 0: "not an authority whose statements are true." A
 *   promise about the runtime environment is a first-person report about the speaker's
 *   own resources — which is `stated`, and specifically not `expert`, whose definition
 *   excludes speaking about one's own behaviour.
 * - `self` → `assertion`, ceiling equal to floor, permanently. A claim the system makes
 *   about itself must be unforgeable by the actor making it, and a `self` row that could
 *   rise is the cartographer promoting its own speculation. The row exists so that track
 *   record is *readable*, never so it can lift anything.
 * - `unattributed` → `assertion`. `UNKNOWN_ACTOR`'s existing contract: a record that
 *   predates the stamp or was hand-edited lands on the least-trusted answer.
 *
 * **No kind's ceiling is `money`, ever.** `money` is backed only by `hasRecordedResult`,
 * written on the CLI-only result/promote path, so this ledger is structurally incapable
 * of becoming a route to it.
 */
export const TRUST_CEILINGS: Readonly<Record<TrustKind, RungId>> = Object.freeze({
  web: "expert",
  channel: "stated",
  instrument: "observed",
  sponsor: "stated",
  self: "assertion",
  unattributed: "assertion",
});

export const TRUST_INITIAL: Readonly<Record<TrustKind, RungId>> = Object.freeze({
  web: FLOOR_RUNG,
  channel: FLOOR_RUNG,
  instrument: "observed",
  sponsor: FLOOR_RUNG,
  self: FLOOR_RUNG,
  unattributed: FLOOR_RUNG,
});

/**
 * Kinds whose id is a singleton: there is exactly one sponsor relationship, one
 * cartographer, one "we do not know".
 *
 * A table rather than a branch, on purpose. The moment a kind gets an `if` of its own
 * in the scorer or the constructor it has stopped being a member of a vocabulary and
 * become a mechanism, which is exactly what P5 forbids for the sponsor.
 */
const SINGLETON_IDS: Partial<Record<TrustKind, string>> = Object.freeze({
  sponsor: "sponsor",
  self: "self",
  unattributed: UNKNOWN_ACTOR,
});

/**
 * A hostname, not "any string that reached the `host` parameter".
 *
 * This regex IS B6's trap, closed: `rankHost({host: 'stripe-webhook-feed'})` succeeded
 * because `normalizeHost` is a no-op on a bare word, so a commissioned pipeline got a
 * row in the publisher namespace under the publisher ceiling. At least one dot is
 * required, which is what separates a hostname from a pipeline's nickname.
 */
const HOSTNAME_SHAPE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The fail-closed row: a producer that is not established holds nothing. */
export const UNATTRIBUTED_KEY: ActorKey = Object.freeze({ kind: "unattributed", id: UNKNOWN_ACTOR });

/** `kind:id` — the ledger's line format and map key. Minted only from a validated pair. */
export function keyString(key: ActorKey): string {
  return `${key.kind}:${key.id}`;
}

export function sameKey(a: ActorKey, b: ActorKey): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Why an id could not enter a kind's namespace, in the terms the caller can act on. */
function namespaceRefusal(kind: TrustKind, id: string): string {
  if (kind === "web") {
    return (
      `"${id}" is not a hostname, so it cannot hold standing as a web publisher. ` +
      `Web standing is keyed on a publisher's host (example.com, blog.example.org). ` +
      `A first-party pipeline is kind 'instrument' (${instrumentIds().join(", ")}) and a delivery ` +
      `channel is kind 'channel' (${channelIds().join(", ")}) — different namespaces, different ceilings.`
    );
  }
  return (
    `"${id}" is not a declared ${kind}. The ${kind} ids are: ${kindIds(kind).join(", ")}. ` +
    `A ${kind} is declared in code (adapters/source.ts), never named by a caller — that is what stops ` +
    `an id typed at this surface from minting a row with a ceiling nobody decided.`
  );
}

function kindIds(kind: TrustKind): string[] {
  const singleton = SINGLETON_IDS[kind];
  if (singleton) return [singleton];
  return ACTORS.filter((a) => actorTrustKey(a).kind === kind);
}
const channelIds = () => kindIds("channel");
const instrumentIds = () => kindIds("instrument");

/**
 * The only constructor of a ledger row's identity, and the write boundary's refusal.
 *
 * Normalization is per kind and reuses the shipped normalizer for `web`
 * ({@link normalizeHost}), which is what makes the legacy migration exact rather than
 * approximate: a host that keyed a `hosts.jsonl` record keys the same row here.
 */
export function actorKey(kind: string, id: string): ActorKey {
  if (!isTrustKind(kind)) {
    throw new Error(`"${kind}" is not a trust kind — one of: ${TRUST_KINDS.join(", ")}`);
  }
  const key = tryActorKey(kind, id);
  if (!key) throw new Error(namespaceRefusal(kind, String(id).trim()));
  return key;
}

/**
 * The same construction for READ paths, which must degrade rather than throw.
 *
 * A search result's host comes from a third-party provider and a node's `source` comes
 * from a file; neither is a place to raise. `null` means "no row", and every reader
 * turns that into the floor — fail-closed in the direction that grants nothing.
 */
export function tryActorKey(kind: TrustKind, id: string): ActorKey | null {
  const singleton = SINGLETON_IDS[kind];
  if (singleton) return { kind, id: singleton };
  const raw = String(id ?? "").trim();
  if (kind === "web") {
    const host = normalizeHost(raw);
    return HOSTNAME_SHAPE.test(host) ? { kind, id: host } : null;
  }
  // `channel` and `instrument` ids are members of ACTORS, and the actor's own kind has
  // to agree — otherwise `actorKey('instrument', 'inbox')` would let the drop folder
  // in through the measuring-device ceiling.
  const candidate = raw.toLowerCase();
  if (!isActor(candidate)) return null;
  const mapped = actorTrustKey(candidate);
  return mapped.kind === kind ? mapped : null;
}

/**
 * Every producer, mapped to the row it writes into. Exhaustive switch, no `default`.
 *
 * The missing `default` is the mechanism: adding a member to `ACTORS` fails to COMPILE
 * until its kind — and therefore its ceiling — has been decided here. Config can mint a
 * channel *instance* (`adapters.inbox.channels[]`), but every drop folder stamps
 * `actor: "inbox"`, so `channels: [{name: "sponsor"}]` produces the row `channel:inbox`
 * at the channel ceiling. `ACTORS` is where kinds are minted, and only a code change
 * reaches it.
 */
export function actorTrustKey(actor: Actor): ActorKey {
  switch (actor) {
    case "inbox":
    case "slack":
    case "atlassian":
      return { kind: "channel", id: actor };
    case "transcript":
    case "usage":
      return { kind: "instrument", id: actor };
    case "unknown":
      return UNATTRIBUTED_KEY;
  }
}

/* ------------------------------------------------------------------ *
 * 2. What a prediction is: a citation the agent cannot forge
 * ------------------------------------------------------------------ */

/** `id` → the actor the INGESTING SURFACE stamped on that record (W11), never the payload's claim. */
export function evidenceActors(dir: string): ReadonlyMap<string, Actor> {
  return new Map(readEvidence(dir).map((r) => [r.id, r.actor]));
}

/**
 * The ledger row a node's `source` names — the missing link between provenance and
 * standing (B12).
 *
 * A node whose `source` names an actor IS the record that says "this source predicted
 * X", where X is the node's own claim. Every property that makes it unforgeable is
 * already committed: `source` is settable only at `ost_create_node`; a source claiming
 * a stored record must resolve to one (W12); and that record's `actor` was stamped by
 * the surface that fetched it, not read off the payload (W11).
 *
 * So the rung comes from the identity the surface stamped — never from a prefix in a
 * filename the producer chose. A source that *claims* a stored record and names none
 * lands on {@link UNATTRIBUTED_KEY} rather than nowhere: claiming a record that does
 * not exist is a stronger reason to grant nothing than saying nothing at all.
 * `null` means "this source names no actor" (an interview, a hand-written note), which
 * every caller reads as the floor.
 */
export function sourceTrustKey(source: string | undefined, actors: ReadonlyMap<string, Actor>): ActorKey | null {
  const s = (source ?? "").trim();
  if (!s) return null;
  const web = /^WEB:\s*([^\s/]+)/i.exec(s);
  if (web) return tryActorKey("web", web[1]);
  if (claimsStoredEvidence(s)) {
    // Byte-exact, like every other resolution of an evidence id: the id is a key, and
    // matching it loosely is what W12 exists to report rather than silently accept.
    const id = s.split(/\s+/)[0];
    const actor = actors.get(id) ?? actors.get(s);
    return actor ? actorTrustKey(actor) : UNATTRIBUTED_KEY;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 3. What an outcome is: a verdict under a reserved heading
 * ------------------------------------------------------------------ */

const VERDICT_PATTERN = new RegExp(`\\b(${VERDICTS.join("|")})\\b`, "i");

/**
 * The verdict a test's `## Results` section records, latest last, or null.
 *
 * `## Results` is a RESERVED_HEADING: no agent-reachable parameter can author it, and
 * the only writer is the CLI's `recordResult`, which requires attribution. That is what
 * makes this the one outcome signal in the repo that the actor being judged cannot
 * write.
 *
 * Deliberately tolerant about the line's shape and strict about where it lives: the
 * section is what the agent cannot write, so leniency inside it costs nothing, while a
 * verdict word in ordinary prose is ignored entirely.
 *
 * **`status: validated` is deliberately NOT read here.** It is unforgeable
 * (`ost-agent promote`, human-only) but it carries no verdict, so it cannot distinguish
 * corroboration from refutation — and a signal that cannot express a refutation cannot
 * make a source fall. It keeps clearing `hasRecordedResult`; it scores nothing.
 */
export function recordedVerdict(node: Pick<OstNode, "body">): Verdict | null {
  let inResults = false;
  let latest: Verdict | null = null;
  for (const line of (node.body ?? "").split("\n")) {
    if (/^\s*##\s/.test(line)) inResults = isHeadingLine(line, RESULTS_HEADING);
    if (!inResults) continue;
    const m = VERDICT_PATTERN.exec(line);
    if (m) latest = m[1].toLowerCase() as Verdict;
  }
  return latest;
}

/**
 * The tests, one level from a node citing `key`, that have recorded an outcome.
 *
 * "One level" is the relation `gateSolution` and `unearnedRung` already mean by "a
 * result for a node" — reused rather than deepened, so a grandchild's result cannot
 * launder standing two layers up. Both directions count: the citing node may be the
 * test itself, its parent, or its child.
 */
export function joinedTests(
  tree: readonly OstNode[],
  key: ActorKey,
  actors: ReadonlyMap<string, Actor>,
  candidates: readonly OstNode[],
): { test: OstNode; verdict: Verdict | null; cited: string }[] {
  const cites = (n: OstNode | undefined): boolean => {
    if (!n) return false;
    const k = sourceTrustKey(n.source, actors);
    return !!k && sameKey(k, key);
  };
  const out: { test: OstNode; verdict: Verdict | null; cited: string }[] = [];
  for (const test of candidates) {
    if (!hasRecordedResult(test)) continue;
    const neighbours = [
      test,
      ...test.links.map((t) => tree.find((n) => titlesMatch(n.title, t))),
      ...tree.filter((n) => n.links.some((t) => titlesMatch(t, test.title))),
    ];
    const citing = neighbours.find(cites);
    if (citing) out.push({ test, verdict: recordedVerdict(test), cited: citing.title });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 4. The record and the ledger file
 * ------------------------------------------------------------------ */

/**
 * One thing that happened to an actor's standing. **No variant carries a rung.**
 *
 * `by` is stamped by the surface, never self-reported — `web-trust.ts`'s one property
 * worth keeping verbatim.
 */
export type TrustObservation =
  | {
      ts: string;
      kind: TrustKind;
      id: string;
      type: "corroboration";
      /** The test whose recorded outcome this is. The unit of standing is a TEST, not a citation. */
      test: string;
      verdict: Verdict;
      /** The node whose citation was the prediction, when there is one. */
      node?: string;
      reason?: string;
      by: string;
    }
  | { ts: string; kind: TrustKind; id: string; type: "strike"; reason: string; by: string }
  | { ts: string; kind: TrustKind; id: string; type: "reset"; reason: string; by: string }
  | {
      ts: string;
      type: "migration";
      from: string;
      by: string;
      /** Legacy ids that could not enter the actor namespace — retired visibly, never silently. */
      retired?: string[];
    };

export type TrustRecordType = TrustObservation["type"];

/** Everything but the timestamp, which the surface stamps from an injected clock. */
export type NewObservation =
  | Omit<Extract<TrustObservation, { type: "corroboration" }>, "ts">
  | Omit<Extract<TrustObservation, { type: "strike" }>, "ts">
  | Omit<Extract<TrustObservation, { type: "reset" }>, "ts">;

export function trustLedgerPath(dir: string): string {
  return path.join(dir, ".ost-agent", "trust", "actors.jsonl");
}

/**
 * The ledger as read: HISTORIES, never rungs, plus the count of lines that could not be
 * read.
 *
 * The damage count is not bookkeeping. Skipping a corrupt `corroboration` fails safe;
 * skipping a corrupt `strike` fails OPEN — an actor keeps standing it should have lost.
 * So the number travels with the read and `checkInvariants` reports it, rather than a
 * lost safety record passing in silence.
 */
export interface TrustLedger {
  histories: ReadonlyMap<string, readonly TrustObservation[]>;
  /** Unreadable or unrecognised lines, which is a `trust-ledger-damaged` violation. */
  damaged: number;
}

function isVerdict(value: unknown): value is Verdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** A parsed line, or null when it grants and revokes nothing. */
function parseObservation(raw: string): TrustObservation | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  const ts = typeof rec.ts === "string" ? rec.ts : "";
  if (rec.type === "migration") {
    return typeof rec.from === "string"
      ? { ts, type: "migration", from: rec.from, by: String(rec.by ?? ""), retired: Array.isArray(rec.retired) ? rec.retired.map(String) : undefined }
      : null;
  }
  if (!isTrustKind(rec.kind) || typeof rec.id !== "string" || !rec.id) return null;
  const base = { ts, kind: rec.kind, id: rec.id, by: String(rec.by ?? "") };
  if (rec.type === "corroboration") {
    if (typeof rec.test !== "string" || !rec.test.trim() || !isVerdict(rec.verdict)) return null;
    return {
      ...base,
      type: "corroboration",
      test: rec.test,
      verdict: rec.verdict,
      node: typeof rec.node === "string" ? rec.node : undefined,
      reason: typeof rec.reason === "string" ? rec.reason : undefined,
    };
  }
  if (rec.type === "strike" || rec.type === "reset") {
    return { ...base, type: rec.type, reason: String(rec.reason ?? "") };
  }
  return null;
}

/**
 * Append one observation. Returns the record as written.
 *
 * The clock is injected so the stamp is deterministic under test — the same rule every
 * other ledger in this repo follows, and the reason no test here calls `Date.now()`.
 */
export function appendObservation(dir: string, rec: NewObservation, now: () => Date = () => new Date()): TrustObservation {
  // Re-mint the identity through the constructor rather than trusting the caller's
  // pair: this is the write boundary, and it is where `stripe-webhook-feed` is refused.
  const key = actorKey(rec.kind, rec.id);
  if (rec.type !== "corroboration" && !rec.reason.trim()) {
    throw new Error("a trust change needs a reason — name what happened, not that something did");
  }
  if (rec.type === "corroboration" && !rec.test.trim()) {
    throw new Error("a corroboration is keyed on the test that produced it — name the test");
  }
  const record = { ...rec, kind: key.kind, id: key.id, ts: now().toISOString() } as TrustObservation;
  const file = trustLedgerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

/**
 * Read the ledger, folding the legacy `hosts.jsonl` in on first sight.
 *
 * The migration is a WRITE performed on a read, which is unusual enough to justify:
 * translating on every read instead would leave two files that must agree, and that is
 * the drift this repo has already paid for once (R4). It runs at most once per vault
 * (the marker makes a re-run a no-op) and its failure is swallowed — a vault on a
 * read-only filesystem still reads, it just keeps folding legacy records in memory.
 */
export function readTrustLedger(dir: string): TrustLedger {
  try {
    migrateLegacyHostTrust(dir);
  } catch {
    // A migration that cannot be written must not take the read down with it.
  }
  const file = trustLedgerPath(dir);
  const histories = new Map<string, TrustObservation[]>();
  let damaged = 0;
  if (!fs.existsSync(file)) return { histories, damaged };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = parseObservation(line);
    if (!rec) {
      damaged += 1;
      continue;
    }
    if (rec.type === "migration") continue;
    const key = keyString({ kind: rec.kind, id: rec.id });
    const list = histories.get(key) ?? [];
    list.push(rec);
    histories.set(key, list);
  }
  return { histories, damaged };
}

/** One actor's records, oldest first. Empty is a legitimate answer, not a missing one. */
export function historyOf(ledger: TrustLedger, key: ActorKey): readonly TrustObservation[] {
  return ledger.histories.get(keyString(key)) ?? [];
}

/* ------------------------------------------------------------------ *
 * 5. The scoring function
 * ------------------------------------------------------------------ */

/** Distinct supporting tests needed to reach a kind's ceiling. */
export const CORROBORATIONS_FOR_CEILING = 3;

/** One step stronger on the ladder, clamped at the top. Clamped again by the ceiling. */
function oneRungAbove(rung: RungId): RungId {
  const i = BELIEVABILITY_LADDER.findIndex((r) => r.id === rung);
  return BELIEVABILITY_LADDER[Math.max(0, i - 1)].id;
}

/** The records after this actor's last `reset` — the only ones that count. */
function since(history: readonly TrustObservation[]): readonly TrustObservation[] {
  let last = -1;
  history.forEach((r, i) => {
    if (r.type === "reset") last = i;
  });
  return history.slice(last + 1);
}

/**
 * What an actor's history has earned it. The only answer to "what rung is this source?".
 *
 * ```
 * 1. any strike           → the floor          (absolute, immediate, needs nothing)
 * 2. any refuted verdict  → the floor          (one refutation is fatal, not a ratio)
 * 3. otherwise            → initial / one above / ceiling, by DISTINCT supporting tests
 * ```
 *
 * **Distinct tests, never a ratio.** A ratio lets a chatty source buy standing with
 * volume, and B11 names that failure exactly: "a channel that keeps delivering
 * plausible, wrong content on cadence". Under a ratio, cadence is a numerator. Fifty
 * nodes citing one host under one test are one observation's worth of standing.
 *
 * **`inconclusive` scores nothing in either direction.** It is the honest third answer,
 * and punishing it pushes whoever records a result toward a verdict they do not have.
 *
 * **No decay, no time-weighting.** It would make "why is this host at expert?"
 * unanswerable without the wall clock, and would put a clock inside the scorer.
 *
 * One consequence worth naming rather than discovering: the intermediate step is the
 * ladder's own next rung, so a channel with one or two supporting tests reads `expert`
 * on its way to `stated`. The ladder orders STRENGTH, not category, and `expert` is the
 * only rung between `assertion` and `stated`; the alternative — no gradient at all
 * below the ceiling — would also mean a migrated host with one corroborating result
 * losing the `expert` it already held, which is the silent reset the migration exists
 * to avoid.
 */
export function rungOf(ledger: TrustLedger, key: ActorKey): RungId {
  return explainRung(ledger, key).rung;
}

export interface RungExplanation {
  rung: RungId;
  ceiling: RungId;
  /** The records that DECIDED it — the strike, the refutation, or the supporting tests. */
  because: readonly TrustObservation[];
}

/** {@link rungOf}, plus the records that decided it, so a report can name which one caused a fall. */
export function explainRung(ledger: TrustLedger, key: ActorKey): RungExplanation {
  const ceiling = TRUST_CEILINGS[key.kind];
  const initial = TRUST_INITIAL[key.kind];
  const history = since(historyOf(ledger, key));

  const strikes = history.filter((r) => r.type === "strike");
  if (strikes.length > 0) return { rung: FLOOR_RUNG, ceiling, because: strikes };

  const refutations = history.filter((r) => r.type === "corroboration" && r.verdict === "refuted");
  if (refutations.length > 0) return { rung: FLOOR_RUNG, ceiling, because: refutations };

  const supporting = history.filter((r) => r.type === "corroboration" && r.verdict === "supported");
  const distinct = new Set(supporting.map((r) => (r as Extract<TrustObservation, { type: "corroboration" }>).test));
  const earned =
    distinct.size === 0 ? initial : distinct.size < CORROBORATIONS_FOR_CEILING ? oneRungAbove(initial) : ceiling;

  // The one definition of "the weaker of two" (believability.ts), reused rather than
  // re-spelled — a second `Math.max(rank)` here is how two ceilings drift apart.
  return { rung: weakestRung([earned, ceiling]), ceiling, because: supporting };
}

export interface Standing extends RungExplanation {
  key: ActorKey;
}

/** Every actor with a history, with what it has earned. What `ost-agent trust` prints. */
export function standings(ledger: TrustLedger): Standing[] {
  const out: Standing[] = [];
  for (const history of ledger.histories.values()) {
    const first = history[0];
    // `migration` markers are dropped at read time and never keyed, so this is a
    // narrowing for the compiler rather than a case that occurs.
    if (!first || first.type === "migration") continue;
    const key: ActorKey = { kind: first.kind, id: first.id };
    out.push({ key, ...explainRung(ledger, key) });
  }
  return out.sort((a, b) => rungRank(a.rung) - rungRank(b.rung) || keyString(a.key).localeCompare(keyString(b.key)));
}

/**
 * A web publisher's standing, derived. The read path `ost_search_web`/`ost_read_web` use.
 *
 * A host the namespace cannot accept holds the floor rather than raising: a provider's
 * result is not a place to refuse, and granting nothing is the fail-closed direction.
 */
export function webStanding(ledger: TrustLedger, host: string): RungId {
  const key = tryActorKey("web", host);
  return key ? rungOf(ledger, key) : FLOOR_RUNG;
}

/**
 * The rung a node's `source` has EARNED, or the floor.
 *
 * This is what `classifyProvenance`'s prefix rules become once a vault directory is in
 * hand: the rung comes from the stamped actor's track record, never from the shape of
 * an id string the producer chose.
 */
export function sourceStanding(
  ledger: TrustLedger,
  source: string | undefined,
  actors: ReadonlyMap<string, Actor>,
): RungId {
  const key = sourceTrustKey(source, actors);
  return key ? rungOf(ledger, key) : FLOOR_RUNG;
}

/* ------------------------------------------------------------------ *
 * 6. The writers
 * ------------------------------------------------------------------ */

/**
 * The observations a recorded result earns, resolved AT RESULT TIME.
 *
 * This is the load-bearing decision of the whole design: the bet must predate the
 * settlement. Deriving standing from the tree at read time looks cleaner and is wrong —
 * `ost_create_node` takes a `source`, so the agent could manufacture corroborations
 * after the fact by citing a well-regarded actor on nodes hanging under already-tested
 * solutions. Walking one level *now* and writing what it finds means a citation added
 * after the verdict is hindsight, and hindsight scores nothing.
 *
 * One observation per distinct actor: fifty nodes citing one host under one test yield
 * one record.
 */
export function resultObservations(
  tree: readonly OstNode[],
  actors: ReadonlyMap<string, Actor>,
  filing: { test: string; verdict: Verdict; by: string },
): NewObservation[] {
  const test = tree.find((n) => titlesMatch(n.title, filing.test));
  if (!test) return [];
  const neighbours = [
    test,
    ...test.links.map((t) => tree.find((n) => titlesMatch(n.title, t))),
    ...tree.filter((n) => n.links.some((t) => titlesMatch(t, test.title))),
  ];
  const seen = new Set<string>();
  const out: NewObservation[] = [];
  for (const n of neighbours) {
    if (!n) continue;
    const key = sourceTrustKey(n.source, actors);
    if (!key || seen.has(keyString(key))) continue;
    seen.add(keyString(key));
    out.push({
      kind: key.kind,
      id: key.id,
      type: "corroboration",
      test: test.title,
      verdict: filing.verdict,
      node: n.title,
      by: filing.by,
    });
  }
  return out;
}

/**
 * Append the observations a recorded result earns. The one line `recordResult` adds.
 *
 * Failure is swallowed by design: a ledger that cannot be written must never cost the
 * human their recorded result, which is the tree's load-bearing fact.
 */
export function recordResultObservations(
  dir: string,
  tree: readonly OstNode[],
  filing: { test: string; verdict: Verdict; by: string },
  now: () => Date = () => new Date(),
): TrustObservation[] {
  const written: TrustObservation[] = [];
  for (const rec of resultObservations(tree, evidenceActors(dir), filing)) {
    try {
      written.push(appendObservation(dir, rec, now));
    } catch {
      // One unwritable observation costs one observation, never the result.
    }
  }
  return written;
}

/* ------------------------------------------------------------------ *
 * 7. Migration from the host-keyed ledger
 * ------------------------------------------------------------------ */

export const MIGRATION_SOURCE = "hosts.jsonl";
const MIGRATION_BY = `migration:${MIGRATION_SOURCE}`;
/** The synthetic test name a legacy promotion folds into. One per host, so it counts once. */
export const LEGACY_TEST = "legacy trust record (hosts.jsonl)";

/** Has this vault's legacy file already been folded in? */
function alreadyMigrated(file: string): boolean {
  if (!fs.existsSync(file)) return false;
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .some((line) => line.includes(`"type":"migration"`) && line.includes(MIGRATION_SOURCE));
}

/**
 * Fold `.ost-agent/trust/hosts.jsonl` into the actor ledger, once.
 *
 * Nothing is rewritten, renamed or deleted — corrections are appends, and a vault
 * rolled back to an earlier version must still find its trust file where it left it.
 *
 * The fold preserves MEANING, not the record shape:
 *
 * - last legacy record `expert` → one supporting corroboration, carrying the legacy
 *   record's own timestamp and reason. One supported test puts a `web` row one rung
 *   above the floor, which is `expert` — **the host keeps exactly the rung it had.**
 * - last record `assertion` after having been `expert` → a `strike` carrying the legacy
 *   reason. That is what a legacy demotion meant, and it lands on the same rung plus the
 *   correct "a human has to bring it back" property.
 * - only ever `assertion` → nothing. `rankHost` was called to promote or demote; an
 *   initial `assertion` is the floor either way, and minting a strike for it would
 *   over-punish and pollute B11's report.
 * - an id that is not a hostname (B6's trap, which the old namespace accepted) → RETIRED,
 *   and named in the marker. It never was a publisher; a silent reset would be a defect,
 *   so the marker records what was dropped.
 *
 * No clock: every stamp comes from the legacy record it folds, so the fold is
 * deterministic and a test needs no injected time.
 */
export function migrateLegacyHostTrust(dir: string): TrustObservation[] {
  const legacyFile = hostTrustPath(dir);
  const ledgerFile = trustLedgerPath(dir);
  if (!fs.existsSync(legacyFile) || alreadyMigrated(ledgerFile)) return [];

  const legacy = readLegacyHostRecords(dir);
  const byHost = new Map<string, { rung: string; reason: string; ts: string; everExpert: boolean }>();
  for (const rec of legacy) {
    const prior = byHost.get(rec.host);
    byHost.set(rec.host, {
      rung: rec.rung,
      reason: rec.reason,
      ts: rec.ts,
      everExpert: (prior?.everExpert ?? false) || rec.rung === "expert",
    });
  }

  const appended: TrustObservation[] = [];
  const retired: string[] = [];
  const lines: string[] = [];
  for (const [host, state] of byHost) {
    const key = tryActorKey("web", host);
    if (!key) {
      retired.push(host);
      continue;
    }
    const common = { ts: state.ts, kind: key.kind, id: key.id, by: MIGRATION_BY };
    if (state.rung === "expert") {
      appended.push({ ...common, type: "corroboration", test: LEGACY_TEST, verdict: "supported", reason: state.reason });
    } else if (state.everExpert) {
      appended.push({ ...common, type: "strike", reason: state.reason });
    }
  }
  const marker: TrustObservation = {
    // The marker is stamped from the legacy file itself, so re-running the fold on a
    // copied vault produces byte-identical output.
    ts: legacy.length > 0 ? legacy[legacy.length - 1].ts : "",
    type: "migration",
    from: MIGRATION_SOURCE,
    by: MIGRATION_BY,
    ...(retired.length > 0 ? { retired } : {}),
  };
  for (const rec of [...appended, marker]) lines.push(JSON.stringify(rec));
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.appendFileSync(ledgerFile, lines.join("\n") + "\n");
  return appended;
}
