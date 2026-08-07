/**
 * The work claim — a pass says what it is building before it builds it, and the
 * claim outlives the session that wrote it.
 *
 * The failure this answers was observed once, in full, and cost a whole pass
 * ("Two agents sharing my vault can trample each other", 2026-07-26). A loop
 * iteration cloned a clean repo at 00:47Z, read the standing briefing, built the
 * feature the briefing named, and committed at 08:46Z. At 08:47Z the push was
 * rejected: a different session had pushed the same feature at 02:56Z — same
 * migration number, same column name, same hash function, same default-off knob.
 * Neither pass wrote the vault while building, so no lease and no lock would have
 * helped. What collided was the *decision about what to work on*.
 *
 * ## The hard part is not the file, it is the vocabulary
 *
 * Writing a claim down and reading it back is trivial and nobody doubts it. The
 * part that can fail is whether the second pass **recognises** the claim as
 * covering the work it was about to start. The two colliding passes converged on
 * nearly identical code and never once agreed on a name for it: the commits imply
 * `invited-visitor arm split` on one side and `add an arm column to
 * visitor_events` on the other. Those two strings share two significant words out
 * of seven — Jaccard 0.29, far under the 0.6 that `src/ost/dedupe.ts` needs before
 * it will call two titles the same thing. **A claim keyed on the wording would
 * not have stopped this.** That is the whole risk, and it is why the matcher is
 * the object under test here and the file format is not.
 *
 * ## The briefing is the vocabulary
 *
 * The way out is that both passes read the same document. A naming is not
 * compared against another naming; it is *resolved against the briefing*, and the
 * identity of the work is the briefing item it lands on. Two namings that resolve
 * to one item are one work item, however differently they are worded.
 *
 * This is the reason to prefer this shape over inventing a shared taxonomy: no
 * pass has to learn a vocabulary it did not already read. The briefing was
 * already the input to both decisions. It is now also the registry.
 *
 * The cost, stated because it is real: **the briefing has to name the work.** A
 * briefing that gestures at an area rather than an item gives the matcher nothing
 * to key on, and {@link resolveWorkItem} answers `unresolved` rather than
 * guessing. Unresolved is deliberately not "free to build": see below.
 *
 * ## What refusing looks like, and why unresolved is not free
 *
 * Three outcomes, and the middle one is the one that is easy to get wrong.
 *
 *   - `claimed` — nothing live covers this item; the claim is appended.
 *   - `already-claimed` — a live claim covers the item, whatever it called it.
 *   - `unresolved` — the naming could not be tied to the briefing at all. This is
 *     NOT a claim, and it is NOT permission. A pass that cannot say which item it
 *     is starting is precisely the pass this mechanism exists to stop, so the
 *     answer is a refusal with a reason, not a claim on a key nobody else can
 *     compute. Reporting it as "free" would reproduce the original bug in a
 *     mechanism built to prevent it.
 *
 * ## The unsolved half, inherited and not fixed here
 *
 * A claim carries an expiry and nothing else. Too short and a second pass takes
 * work still in progress; too long and a pass that dies mid-build strands the
 * item until the clock runs out. There is no liveness signal behind a claim —
 * `firing.lock` has one (a holder pid, {@link ../loop/lock.ts}) but it is
 * machine-local and a claim is not. The tree already records the gap ("A run that
 * dies while I am away stays dead, and nothing says where it stopped"). Nothing
 * in this module closes it, and a green test here does not claim otherwise.
 *
 * ## Where the ledger lives, and why the caller has to say
 *
 * A **state directory**, passed in, exactly as `corrections.ts` takes one and for
 * the same reason: the discovery loop records under `<vault>/.git/ost-agent/` (a
 * ledger in the working tree is swept into the next `git add -A` commit — see
 * `state.ts`) and the build loop keeps its state outside the vault entirely. A
 * module that picked one would be wrong for the other.
 *
 * The ledger is **append-only JSONL**, folded last-wins by key on read. Releasing
 * a claim appends a `released` record rather than rewriting the file — the same
 * rule the rest of this project holds itself to, that a correction is a new
 * entry and never a deletion.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Filename of the claim ledger inside the state directory. */
export const CLAIMS_FILENAME = "work-claims.jsonl";

/**
 * Eight hours, which is what the collision cost: the pass that lost its work
 * started at 00:47Z and committed at 08:46Z. A TTL shorter than one build pass
 * would expire under a pass still building — the exact failure this prevents —
 * so the default is the longest pass anyone has measured, and the price of that
 * choice is stated in this module's header rather than tuned away.
 */
export const DEFAULT_CLAIM_TTL_HOURS = 8;

/**
 * Words that carry no work identity. Deliberately the same list
 * `src/ost/dedupe.ts` uses, plus the handful a *briefing* is made of and a node
 * title is not — a standing briefing says "if something must be built, do …" in
 * every revision, and those words must not be what two namings agree on.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "to", "of", "and", "or", "i", "we", "my", "our", "it",
  "is", "are", "be", "for", "in", "on", "want", "need", "with", "that", "this",
  "if", "so", "as", "at", "by", "do", "not", "no", "but", "than", "then",
  "must", "should", "can", "cannot", "will", "would", "have", "has", "had",
  "week", "item", "work", "build", "built", "building", "take", "taken",
  "something", "anything", "nothing", "one", "only", "still", "already",
]);

/**
 * A term, folded so two spellings of one word cannot split an identity.
 *
 * Only a trailing plural `s` is removed, and only when what is left is still a
 * word (≥ 4 characters) and the ending is not one that is `s` for other reasons
 * (`-ss`, `-us`, `-is`). The fold is applied identically to the briefing and to
 * the naming, so it can only ever merge two terms — never split one — which is
 * the safe direction for a matcher whose failure mode is missing a match.
 */
function fold(term: string): string {
  if (term.length < 5 || !term.endsWith("s")) return term;
  if (/(?:ss|us|is)$/.test(term)) return term;
  return term.slice(0, -1);
}

/**
 * The significant terms of a piece of text, in order, with repeats kept.
 *
 * Identifiers matter here in a way they do not in `dedupe.ts`: one of the two
 * colliding namings is `add an arm column to visitor_events`, and unless
 * `visitor_events` becomes `visitor` + `event` it shares nothing with a briefing
 * that says "an invited visitor". Splitting on everything that is not a letter or
 * a digit does that for `snake_case` and `kebab-case`; the explicit camelCase
 * split does it for `visitorEvents`.
 */
export function termsOf(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(fold)
    .filter((t) => !STOPWORDS.has(t));
}

/** One candidate piece of work, as the briefing states it. */
export interface BriefingItem {
  index: number;
  /** The item's text, verbatim. */
  text: string;
  /** A short human label — enough to recognise the item in a refusal. */
  label: string;
  /** Distinct significant terms, folded. */
  terms: Set<string>;
  /** How often each term occurs in this item. */
  counts: Map<string, number>;
}

/**
 * Split a briefing into the items a pass could pick up — blank-line blocks, and
 * markdown list entries within them.
 *
 * **Not sentences, and that is load-bearing.** The observed briefing states the
 * arm split across three sentences: what to do, why it is needed, and how to
 * shape it. Segmenting by sentence puts `arm` and `visitor` in two different
 * items, so `add an arm column to visitor_events` lands on the *how* sentence
 * while `invited-visitor arm split` lands on the *what* — two identities for one
 * piece of work, which is the bug, reintroduced by the segmenter. A block is the
 * unit a human writing a briefing uses to mean "one thing".
 */
export function briefingItems(briefing: string): BriefingItem[] {
  const blocks: string[] = [];
  for (const block of briefing.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    // A block of list entries is several items, not one.
    const bullets = trimmed.split(/\n(?=\s*(?:[-*+]|\d+[.)])\s)/).map((b) => b.trim()).filter((b) => b.length > 0);
    blocks.push(...(bullets.length > 1 ? bullets : [trimmed]));
  }
  return blocks.map((text, index) => {
    const list = termsOf(text);
    const counts = new Map<string, number>();
    for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { index, text, label: labelOf(text), terms: new Set(list), counts };
  });
}

/** The first sentence or so of an item, capped, for putting in a refusal. */
function labelOf(text: string): string {
  const flat = text.replace(/\s+/g, " ").replace(/^(?:[-*+]|\d+[.)])\s+/, "").trim();
  const stop = flat.search(/[.:;]\s/);
  const head = stop > 20 ? flat.slice(0, stop) : flat;
  return head.length <= 80 ? head : `${head.slice(0, 77)}…`;
}

/** How much a term narrows the briefing: rare across items, worth more. */
function weights(items: readonly BriefingItem[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const item of items) for (const t of item.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const w = new Map<string, number>();
  for (const [t, n] of df) w.set(t, Math.log(1 + items.length / n));
  return w;
}

/**
 * The identity a claim is keyed on: the **briefing item**, digested over the
 * vocabulary that is unique to it.
 *
 * Keying on the item's index would be simpler and is wrong for a reason worth
 * stating — a claim written against one revision of a briefing would stop
 * matching the moment a paragraph was inserted above it, which is a rewording
 * away from the collision this prevents. Keying on the terms no other item uses
 * survives edits elsewhere in the document. It does not survive an edit to the
 * item itself, and nothing here pretends it does.
 */
function identityKey(item: BriefingItem, items: readonly BriefingItem[]): string {
  const shared = new Set<string>();
  for (const other of items) {
    if (other.index === item.index) continue;
    for (const t of other.terms) if (item.terms.has(t)) shared.add(t);
  }
  let distinctive = [...item.terms].filter((t) => !shared.has(t));
  // A briefing whose items all say the same thing leaves nothing distinctive.
  // Fall back to the item's whole vocabulary rather than to an empty digest that
  // every item would share.
  if (distinctive.length < 3) distinctive = [...item.terms];
  return createHash("sha1").update(distinctive.sort().join(" ")).digest("hex").slice(0, 16);
}

/** A short, stable handle for the briefing a claim was resolved against. */
export function briefingDigest(briefing: string): string {
  return createHash("sha1").update(briefing.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 12);
}

/** What a naming resolved to, once the briefing has had its say. */
export interface WorkIdentity {
  /** What a claim is keyed on. Two namings of one briefing item share it. */
  key: string;
  label: string;
  itemIndex: number;
  briefingDigest: string;
  /** Share of the naming's briefing-anchored weight this item accounts for. */
  coverage: number;
  /** Terms of the naming the briefing also uses — the evidence for the match. */
  anchored: string[];
  /** Terms the briefing never uses. Ignored in scoring, reported for diagnosis. */
  unanchored: string[];
}

export type Resolution =
  | { resolved: true; identity: WorkIdentity }
  | { resolved: false; reason: string; anchored: string[]; unanchored: string[] };

export interface ResolveOptions {
  /**
   * How much of a naming's anchored weight the winning item must carry. Below
   * this the naming is spread across the briefing rather than about one item.
   */
  minCoverage?: number;
  /** How far ahead of the runner-up the winner must be, in coverage. */
  minMargin?: number;
}

/**
 * Fixed at 0.6 / 0.15 against the one briefing anyone has: a naming must be
 * mostly about the item it wins, and clearly more about that one than the next.
 * These are the numbers this module is least sure of — they were chosen on n = 1
 * and there is no second briefing to check them against.
 */
export const DEFAULT_MIN_COVERAGE = 0.6;
export const DEFAULT_MIN_MARGIN = 0.15;

/**
 * Resolve a pass's own wording for its work to the briefing item it is about.
 *
 * Refusals are explicit and distinct, because they mean different things to the
 * pass reading them: a naming with no briefing terms in it means "you are not
 * working from this briefing"; a naming spread thin across the document means
 * "say which item"; a tie means "these two items are not distinguishable by what
 * you wrote".
 */
export function resolveWorkItem(naming: string, briefing: string, opts: ResolveOptions = {}): Resolution {
  const minCoverage = opts.minCoverage ?? DEFAULT_MIN_COVERAGE;
  const minMargin = opts.minMargin ?? DEFAULT_MIN_MARGIN;
  const items = briefingItems(briefing);
  const w = weights(items);
  const namingTerms = [...new Set(termsOf(naming))];
  const anchored = namingTerms.filter((t) => w.has(t));
  const unanchored = namingTerms.filter((t) => !w.has(t));

  if (items.length === 0) {
    return { resolved: false, reason: "the briefing has no items to resolve against", anchored, unanchored };
  }
  if (anchored.length === 0) {
    return {
      resolved: false,
      reason: `no term in "${naming}" appears in the briefing — this naming is not about work the briefing names`,
      anchored,
      unanchored,
    };
  }

  const total = anchored.reduce((sum, t) => sum + (w.get(t) ?? 0), 0);
  const scored = items
    .map((item) => {
      const hit = anchored.filter((t) => item.terms.has(t));
      const score = hit.reduce((sum, t) => sum + (w.get(t) ?? 0), 0);
      return { item, coverage: total > 0 ? score / total : 0 };
    })
    // Ties break on the earlier item, so the answer never depends on sort stability.
    .sort((a, b) => b.coverage - a.coverage || a.item.index - b.item.index);

  const best = scored[0];
  const runnerUp = scored[1]?.coverage ?? 0;
  if (best.coverage < minCoverage) {
    return {
      resolved: false,
      reason:
        `"${naming}" is spread across the briefing — the best item accounts for ` +
        `${(best.coverage * 100).toFixed(0)}% of it, under the ${(minCoverage * 100).toFixed(0)}% a claim needs`,
      anchored,
      unanchored,
    };
  }
  if (best.coverage - runnerUp < minMargin) {
    return {
      resolved: false,
      reason:
        `"${naming}" fits two briefing items equally well ("${best.item.label}" and ` +
        `"${scored[1].item.label}") — name which one`,
      anchored,
      unanchored,
    };
  }
  return {
    resolved: true,
    identity: {
      key: identityKey(best.item, items),
      label: best.item.label,
      itemIndex: best.item.index,
      briefingDigest: briefingDigest(briefing),
      coverage: best.coverage,
      anchored,
      unanchored,
    },
  };
}

/** One line of the ledger. */
export interface ClaimRecord {
  key: string;
  label: string;
  /** The wording the claiming pass used. Kept so a refusal can quote it. */
  naming: string;
  session: string;
  claimedAt: string;
  expiresAt: string;
  briefingDigest: string;
  state: "held" | "released";
}

export type ClaimOutcome =
  | { status: "claimed"; claim: ClaimRecord; identity: WorkIdentity }
  | { status: "already-claimed"; held: ClaimRecord; identity: WorkIdentity; why: string }
  | { status: "held-by-self"; held: ClaimRecord; identity: WorkIdentity }
  | { status: "unresolved"; reason: string; anchored: string[]; unanchored: string[] };

export function claimsPath(stateDir: string): string {
  return path.join(stateDir, CLAIMS_FILENAME);
}

/**
 * The briefing, off disk.
 *
 * Here rather than in the CLI because `src/cli/index.ts` opens no file at all —
 * every command hands a path to the module that owns the reading, so there is
 * exactly one place per file that knows how it is read. Throws with the path in
 * the message: a briefing that cannot be read is not an empty briefing, and
 * degrading it to one would resolve every naming to nothing and wave every pass
 * through.
 */
export function readBriefingFile(file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`cannot read the briefing at ${path.resolve(file)}: ${(e as NodeJS.ErrnoException).code ?? String(e)}`);
  }
}

/**
 * Every record in the ledger, folded last-wins by key.
 *
 * A line that will not parse is skipped rather than thrown on: the ledger is
 * appended to by more than one process, and a torn last line must not cost a
 * later pass its ability to see the claims above it.
 */
export function readClaims(stateDir: string): ClaimRecord[] {
  const p = claimsPath(stateDir);
  if (!fs.existsSync(p)) return [];
  const byKey = new Map<string, ClaimRecord>();
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rec = JSON.parse(line) as ClaimRecord;
      if (typeof rec?.key === "string" && typeof rec?.expiresAt === "string") byKey.set(rec.key, rec);
    } catch {
      continue;
    }
  }
  return [...byKey.values()];
}

/** Claims still held: not released, and not past their expiry. */
export function liveClaims(stateDir: string, now: number = Date.now()): ClaimRecord[] {
  return readClaims(stateDir).filter((c) => isLive(c, now));
}

function isLive(claim: ClaimRecord, now: number): boolean {
  if (claim.state !== "held") return false;
  const expires = Date.parse(claim.expiresAt);
  // An unparseable expiry is treated as expired: a claim nobody can date is a
  // claim that could block the work forever, and stranding beats deadlocking.
  return Number.isFinite(expires) && now < expires;
}

function append(stateDir: string, record: ClaimRecord): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(claimsPath(stateDir), `${JSON.stringify(record)}\n`);
}

export interface ClaimOptions {
  /** How this pass words the work. Resolved against the briefing, not stored as the key. */
  naming: string;
  /** The document both passes read. The vocabulary and the registry. */
  briefing: string;
  /** Who is claiming — a session or run id, so a refusal can name the holder. */
  session: string;
  /** How long the claim holds without being renewed. */
  ttlMs: number;
  now?: number;
  resolve?: ResolveOptions;
}

/**
 * Take the work, or find out it is taken.
 *
 * A pass re-claiming its own live item gets `held-by-self` and the claim is
 * renewed, so calling this at the top of every step is safe and is the intended
 * use — it is also the only liveness signal available, weak as it is.
 */
export function claimWork(stateDir: string, opts: ClaimOptions): ClaimOutcome {
  const now = opts.now ?? Date.now();
  const resolution = resolveWorkItem(opts.naming, opts.briefing, opts.resolve);
  if (!resolution.resolved) {
    return {
      status: "unresolved",
      reason: resolution.reason,
      anchored: resolution.anchored,
      unanchored: resolution.unanchored,
    };
  }
  const identity = resolution.identity;
  const held = readClaims(stateDir).find((c) => c.key === identity.key);
  if (held && isLive(held, now) && held.session !== opts.session) {
    return {
      status: "already-claimed",
      held,
      identity,
      why:
        `"${opts.naming}" is the same work as "${held.naming}", which ${held.session} claimed at ` +
        `${held.claimedAt} and holds until ${held.expiresAt}`,
    };
  }
  const record: ClaimRecord = {
    key: identity.key,
    label: identity.label,
    naming: held && isLive(held, now) ? held.naming : opts.naming,
    session: opts.session,
    claimedAt: held && isLive(held, now) ? held.claimedAt : new Date(now).toISOString(),
    expiresAt: new Date(now + opts.ttlMs).toISOString(),
    briefingDigest: identity.briefingDigest,
    state: "held",
  };
  append(stateDir, record);
  return held && isLive(held, now)
    ? { status: "held-by-self", held: record, identity }
    : { status: "claimed", claim: record, identity };
}

/**
 * What the shell learns. A pass runs `ost-agent claim` and reads the exit code
 * before it reads anything else, so the three ways it can fail have to be told
 * apart by the number: "somebody has it" and "you did not say what you are
 * doing" call for different next moves, and collapsing them into 1 would make
 * the second look like the first.
 */
export const CLAIM_EXIT = {
  /** The item is yours — freshly taken, or renewed because it already was. */
  taken: 0,
  /** A live claim covers this work under some other wording. Do not build it. */
  alreadyClaimed: 32,
  /** The naming could not be tied to the briefing. Not a claim, not permission. */
  unresolved: 33,
} as const;

/** The report the operator (or the pass's own log) reads beside the exit code. */
export function renderClaim(outcome: ClaimOutcome): string {
  switch (outcome.status) {
    case "claimed":
      return (
        `CLAIMED "${outcome.claim.label}" until ${outcome.claim.expiresAt}\n` +
        `  as: ${outcome.claim.naming}\n` +
        `  by: ${outcome.claim.session}\n` +
        `  matched on: ${outcome.identity.anchored.join(", ") || "(nothing)"}` +
        (outcome.identity.unanchored.length > 0
          ? `\n  the briefing does not use: ${outcome.identity.unanchored.join(", ")}`
          : "")
      );
    case "held-by-self":
      return (
        `STILL YOURS "${outcome.held.label}" — renewed until ${outcome.held.expiresAt}\n` +
        `  claimed at ${outcome.held.claimedAt} as: ${outcome.held.naming}`
      );
    case "already-claimed":
      return (
        `ALREADY CLAIMED "${outcome.held.label}"\n  ${outcome.why}\n` +
        "  This is the same work worded differently — that is the point of the check. " +
        "Pick something else, or wait for the claim to lapse."
      );
    case "unresolved":
      return (
        `NOT CLAIMED — ${outcome.reason}\n` +
        "  Nothing was written. A claim on work the briefing does not name excludes nobody, " +
        "because no other pass can compute the same key.\n" +
        `  briefing terms in your naming: ${outcome.anchored.join(", ") || "(none)"}\n` +
        `  terms the briefing never uses: ${outcome.unanchored.join(", ") || "(none)"}`
      );
  }
}

/** Every claim currently held, oldest first, as a block of text. */
export function renderClaims(claims: readonly ClaimRecord[]): string {
  if (claims.length === 0) return "No work is claimed.";
  return [...claims]
    .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt))
    .map((c) => `${c.session} holds "${c.label}"\n  as: ${c.naming}\n  since ${c.claimedAt}, until ${c.expiresAt}`)
    .join("\n");
}

/**
 * Give the item back, by appending a release rather than removing a line.
 *
 * Only the holder may release, for the same reason `releaseFiringLock` matches
 * before it deletes: a claim that expired and was retaken belongs to whoever
 * retook it, and releasing it on their behalf is the bug this prevents.
 */
export function releaseClaim(stateDir: string, key: string, session: string, now: number = Date.now()): boolean {
  const held = readClaims(stateDir).find((c) => c.key === key);
  if (!held || held.state !== "held" || held.session !== session) return false;
  append(stateDir, { ...held, state: "released", expiresAt: new Date(now).toISOString() });
  return true;
}
