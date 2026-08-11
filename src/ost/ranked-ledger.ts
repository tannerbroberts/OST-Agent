/**
 * The whole-tree ranked ledger — every rankable node in one order, and no row
 * published without a reason that cites something real.
 *
 * This is the mechanism of the tree node "A whole-tree ranked ledger that
 * refuses to publish a row without its reason", and the refusal is the entire
 * feature: a row whose reason is missing, empty, or cites no node title or
 * evidence id is refused a rank and lands in an explicitly-named unranked tail,
 * so a gap in the reasoning shows up as a gap in the list rather than as a
 * confident position. The sibling `briefing.ts` names one next build; this
 * names an order over all of them, which is what lets an operator plan past
 * Monday — and disagree with a specific row, because the reason is printed
 * beside it.
 *
 * What counts as a citation is deliberately narrow, and resolution is
 * byte-exact like every other resolution in this repository:
 *
 *   - `[[Some Node Title]]` where that title is a node in the tree. A wikilink
 *     to a title that does not exist cites nothing — otherwise the refusal is
 *     satisfied by fluent prose around a fabricated link.
 *   - a stored evidence id (`INBOX:…`, `TRANSCRIPT:…` — the
 *     `EVIDENCE_ID_PREFIXES` set) that resolves to a record on disk. The claim
 *     is matched case-insensitively so a near-miss can be *named* in the
 *     refusal, but only a byte-exact match to a stored id counts, per the rule
 *     on `claimsStoredEvidence`: a source that claims to name a stored record
 *     must name one that exists.
 *
 * "Rankable" means Solution nodes. Solutions are the things a pass can
 * pick up and build, which is the choice the founder's statement ("a clearly
 * prioritized list from top to bottom — and why") needs ordered; opportunities
 * and tests enter the ledger as citations inside reasons, not as rows. A
 * rankable node the caller never submitted still appears — in the tail, named
 * as never submitted — because a whole-tree ledger that silently omits a node
 * is the same confident silence the refusal exists to prevent.
 *
 * What none of this settles, and the node says so itself: whether the sentence
 * beside a rank is *true*. A citation can be checked by compute; whether written
 * reasons get challenged rather than skimmed is measurable only by watching a
 * reader, and that measurement is the assumption test above this mechanism.
 */
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_ID_PREFIXES, readEvidence } from "../processes/tree.js";
import { Vault } from "./vault.js";

/** The one filename, exported so no caller spells it independently. */
export const RANKED_LEDGER_FILENAME = "RANKED-LEDGER.md";

/**
 * The heading the tail is published under. Exported because "explicitly-named"
 * is load-bearing: the tail must announce itself as the rows refused a rank,
 * never blend into the order above it.
 */
export const UNRANKED_HEADING = "## Unranked — refused a rank";

/** The ledger's stable address for a vault: `<vault>/.ost-agent/RANKED-LEDGER.md`. */
export function rankedLedgerPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", RANKED_LEDGER_FILENAME);
}

/** One submitted row: a position in the proposed order, and the why. */
export interface LedgerRowInput {
  /** Title of a live Solution node, exactly as the tree spells it. */
  title: string;
  /** The written reason this row sits where it does. Optional so "missing" is expressible. */
  reason?: string;
}

export interface RankedRow {
  /** 1-based, contiguous, in submitted order — the rank is a consequence of the reason surviving. */
  rank: number;
  title: string;
  reason: string;
}

export interface UnrankedRow {
  title: string;
  /** Why this row was refused a rank, stated so the gap is legible. */
  problem: string;
}

export interface RankedLedger {
  date: string;
  ranked: RankedRow[];
  unranked: UnrankedRow[];
}

/** The facts a reason is validated against — read off the vault, never supplied by the ranker. */
export interface LedgerWorld {
  /** Titles of every node in the tree (any layer — reasons may cite tests and opportunities). */
  titles: ReadonlySet<string>;
  /** Ids of stored evidence records, byte-exact. */
  evidenceIds: ReadonlySet<string>;
  /** Titles of every rankable node — the set the ledger must cover. */
  rankable: readonly string[];
}

const WIKILINK = /\[\[([^\]]+)\]\]/g;
/**
 * A token that *claims* to be an evidence id. Case-insensitive like
 * `claimsStoredEvidence`, so a near-miss (`inbox:x.md` for a stored
 * `INBOX:x.md`) is reported as the citation it tried to be instead of passing
 * silently as prose.
 */
const EVIDENCE_CLAIM = new RegExp(`\\b(?:${EVIDENCE_ID_PREFIXES.join("|")}):[^\\s\\])},;]+`, "gi");

/**
 * Why this reason cannot carry a rank, or null when it can.
 *
 * The three refusals are exactly the node's three: missing, empty, and
 * citation-free — where a citation is a wikilink resolving to a live node title
 * or an evidence id resolving to a stored record. The literal strings
 * `undefined`/`null` are refused as empty, the same tripwire `briefing.ts` and
 * `Vault.annotate` hold: 21 annotation lines across 16 nodes were each the four
 * characters `undefined`.
 */
export function reasonProblem(reason: string | undefined, world: LedgerWorld): string | null {
  if (reason === undefined) return "no reason was written";
  const t = reason.trim();
  if (t.length === 0) return "the reason is empty";
  if (/^(undefined|null)$/i.test(t)) return `the reason is the literal string "${t}"`;

  const claims: string[] = [];
  for (const m of t.matchAll(WIKILINK)) {
    if (world.titles.has(m[1])) return null;
    claims.push(`[[${m[1]}]]`);
  }
  for (const m of t.matchAll(EVIDENCE_CLAIM)) {
    if (world.evidenceIds.has(m[0])) return null;
    claims.push(m[0]);
  }
  if (claims.length > 0) {
    return `the reason cites only ${claims.join(", ")} — none of which is a live node title or stored evidence id`;
  }
  return "the reason cites no node title or evidence id";
}

/**
 * Compose the ledger: rank what survives, refuse the rest into the tail.
 *
 * Pure over its inputs so the boundary is testable without a disk. Throws — the
 * whole write refused, not a row demoted — when a row names something that is
 * not a rankable node, or names one twice: a ledger that ranks a phantom or
 * holds two positions for one node is not a ledger with a gap, it is wrong.
 */
export function composeRankedLedger(rows: readonly LedgerRowInput[], world: LedgerWorld, date: string): RankedLedger {
  const rankableSet = new Set(world.rankable);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!rankableSet.has(row.title)) {
      throw new Error(`refusing to publish: "${row.title}" is not a live Solution node in this tree`);
    }
    if (seen.has(row.title)) {
      throw new Error(`refusing to publish: two rows name "${row.title}"`);
    }
    seen.add(row.title);
  }

  const ranked: RankedRow[] = [];
  const unranked: UnrankedRow[] = [];
  for (const row of rows) {
    const problem = reasonProblem(row.reason, world);
    if (problem === null) {
      ranked.push({ rank: ranked.length + 1, title: row.title, reason: (row.reason as string).trim() });
    } else {
      unranked.push({ title: row.title, problem });
    }
  }
  // Whole-tree coverage: a rankable node nobody submitted is a gap too, and it
  // must show as one rather than vanish from the list.
  for (const title of world.rankable) {
    if (!seen.has(title)) unranked.push({ title, problem: "never submitted — no reason was offered" });
  }
  return { date, ranked, unranked };
}

/**
 * Read the world a ledger is validated against off the vault itself.
 *
 * `readTree()`, not `readLiveTree()`: a `## Retraction` or an `archive/` move is
 * withheld unconditionally at the read, but the status-retired filter is
 * deliberately NOT applied — `deferred` is a status the agent can set on itself
 * in one call, and it must not be a way to make a rankable node vanish from the
 * whole-tree ledger (`withoutRetiredNodes` bounds that filter to the duplicate
 * scan, and this module stays outside that boundary). A deferred solution the
 * ranker skips still shows in the tail as never submitted, which is the visible
 * gap this feature exists to keep visible.
 */
export function ledgerWorld(vaultDir: string): LedgerWorld {
  const live = new Vault(vaultDir, { create: false }).readTree();
  return {
    titles: new Set(live.map((n) => n.title)),
    evidenceIds: new Set(readEvidence(vaultDir).map((r) => r.id)),
    rankable: live.filter((n) => n.layer === "Solution").map((n) => n.title),
  };
}

/**
 * The write boundary: compose against the vault's own facts and publish to the
 * stable address. The caller hands over proposed rows, never a finished ledger —
 * there is no path to the file that skips the refusal.
 */
export function publishRankedLedger(vaultDir: string, rows: readonly LedgerRowInput[], date: string): string {
  const ledger = composeRankedLedger(rows, ledgerWorld(vaultDir), date);
  const p = rankedLedgerPath(vaultDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, renderRankedLedger(ledger));
  return p;
}

/** Render the ledger — the same text is the file and the terminal output. */
export function renderRankedLedger(ledger: RankedLedger): string {
  const parts = [
    "# RANKED LEDGER",
    "",
    "**The whole tree in one order, each row carrying the reason it sits where it",
    "does. A row whose reason is missing, empty, or cites no node title or evidence",
    `id is refused a rank and listed under "${UNRANKED_HEADING.slice(3)}": a gap in`,
    "the reasoning shows as a gap in the list, never as a confident position.**",
    "",
    `_Published ${ledger.date} — ${ledger.ranked.length} ranked, ${ledger.unranked.length} unranked._`,
    "",
    "## Ranked",
    "",
  ];
  if (ledger.ranked.length === 0) {
    parts.push("(no row survived the refusal — every reason is missing, empty, or cites nothing)");
  }
  for (const r of ledger.ranked) parts.push(`${r.rank}. **${r.title}** — ${r.reason}`);
  parts.push("", UNRANKED_HEADING, "");
  if (ledger.unranked.length === 0) parts.push("(none — every rankable node holds a ranked position)");
  for (const u of ledger.unranked) parts.push(`- **${u.title}** — ${u.problem}`);
  return parts.join("\n") + "\n";
}

/** The published ledger's text, or null when none has ever been published. */
export function readRankedLedger(vaultDir: string): string | null {
  const p = rankedLedgerPath(vaultDir);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
