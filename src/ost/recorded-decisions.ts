/**
 * Recorded-decision ordering — rank only what a human decision already ordered,
 * and leave the rest unranked and named.
 *
 * This is the mechanism of the tree node "Rank only what a recorded decision
 * already ordered, and leave the rest unranked", whose whole claim is a
 * structural one: *the agent never authors a priority.* Every position published
 * here is read off a decision already written into the vault, and every position
 * carries the citation it was read from. A row no recorded decision reaches is
 * published as **unranked and named**, never assigned a place the ranker
 * invented.
 *
 * The sibling `ranked-ledger.ts` enforces that a published row carries *a*
 * reason. This module is narrower and stricter: the reason may only be a
 * decision somebody else already recorded, and the *order itself* is read off
 * the record rather than composed. That is why {@link orderByRecordedDecision}
 * takes the row set and the passages and has no scoring function anywhere in it:
 * there is no place to put a judgement, which is the point.
 *
 * ## What counts as a recorded decision
 *
 * Exactly the five forms the assumption test above this node names — the root's
 * Prioritization section putting a row in a lane, an evidence-debt gate written
 * into a node's own body, a founder decision touching the row, a WIP hold naming
 * it, and a lane label ({@link DECISION_KINDS}). Nothing else positions
 * anything, and in particular **prose that merely discusses a row does not**:
 * a passage positions a row only when it names that row's title verbatim, in
 * quotes or as a wikilink, and the title resolves to a live node. A decision
 * that cannot be located is not a decision the operator can argue with, which is
 * the assumption test's own rule ("record the citation, not just the verdict").
 *
 * ## Where the order comes from
 *
 * From the record's own shape, and from nowhere else: a row's position is the
 * position of the *earliest* passage that names it, then its position within
 * that passage's own list of names. Passages are ordered as the vault records
 * them — node order, then position in the node. So the root Prioritization
 * section's first bullet outranks its fourth because a human wrote it first, not
 * because anything here judged it more important. Shuffling the input rows
 * cannot change the output order; editing the record is the only thing that can.
 *
 * ## Contradictions are reported, not resolved
 *
 * The solution node predicted this failure and it is real in the meta vault: the
 * distribution row is named by a founder decision calling it the critical path
 * *and* by an evidence-debt gate in its own body saying do not expand it. Both
 * are recorded decisions and they point opposite ways. Such a row is ranked —
 * it is positioned — and flagged {@link PositionedRow.contradicted}, carrying
 * both citations. "A report of a deadlock rather than a priority" is the node's
 * own phrase for that output, and it is the honest one: resolving it is a human
 * judgement and there is no code here that could take it.
 *
 * ## The passages are data, not a vault read
 *
 * {@link DecisionPassage} is plain, serialisable fact so the same computation
 * runs over a live vault and over a committed snapshot of one — the convention
 * `unblock-leverage.ts` set, for the same reason: a test that reads a path only
 * the maintainer's machine has skips on CI, and a skipped file reports green.
 */
import { sentencesAround } from "./lanes.js";
import type { OstNode } from "./node.js";

/**
 * The forms of record that can position a row. Exactly the five the assumption
 * test "Count how much of the tree a recorded decision could actually order"
 * enumerates — closed on purpose, because "any prose that mentions the row"
 * is how a mechanism that cannot invent a priority starts inventing one.
 */
export const DECISION_KINDS = [
  "prioritization-lane",
  "founder-decision",
  "evidence-debt-gate",
  "wip-hold",
  "lane-label",
] as const;

export type DecisionKind = (typeof DECISION_KINDS)[number];

/**
 * Which way a decision points. Read off the passage's own words, never inferred
 * from where the row sits: `unstated` is a real answer and the commonest one,
 * and it is what keeps a passage that merely names a row from being read as an
 * endorsement of it.
 *
 * `mixed` is the fourth answer and it is not a failure to classify — the third
 * maintenance pass's ledger entry names one row as its target *and* explains
 * which gates it checked, in one paragraph. Collapsing that to either verdict
 * would be this module deciding; a `mixed` citation is published, quoted, and
 * deliberately does NOT count toward a contradiction, because "the detector
 * cannot tell" and "two humans disagreed" are different findings.
 */
export type Direction = "advance" | "hold" | "mixed" | "unstated";

/** One passage of a vault that records a decision, reduced to serialisable facts. */
export interface DecisionPassage {
  kind: DecisionKind;
  /** The node this passage lives in — the first half of a citation a reader can open. */
  node: string;
  /** The heading or ledger line it sits under, verbatim — the second half. */
  section: string;
  /** The ISO date the passage carries, or "" when it states none. */
  date: string;
  /** The passage's own text, whitespace-normalised — what a quote is cut from. */
  text: string;
  /** Titles this passage names verbatim, in the order it names them. */
  names: string[];
  direction: Direction;
  /** Position in the vault read: node order, then position within the node. */
  order: number;
}

/** One decision, bound to the one row it positions. */
export interface Citation {
  kind: DecisionKind;
  node: string;
  section: string;
  date: string;
  direction: Direction;
  /** The whole sentence the row's title was named in — never just the fragment. */
  quote: string;
}

export interface PositionedRow {
  /** 1-based and contiguous; the rank is a consequence of where the record names it. */
  rank: number;
  title: string;
  /** Every decision that names this row, earliest first. Never empty. */
  citations: Citation[];
  /**
   * True when the citations point opposite ways — at least one `advance` and at
   * least one `hold`. The row keeps its rank and both citations; nothing here
   * picks a winner.
   */
  contradicted: boolean;
}

export interface UnrankedRow {
  title: string;
  /** Why no rank was published for it, stated so the gap is legible. */
  problem: string;
}

export interface DecisionOrdering {
  ranked: PositionedRow[];
  /** Every row no recorded decision reaches, in the order the caller supplied them. */
  unranked: UnrankedRow[];
}

/**
 * The bar, pre-committed on 2026-08-02 by the assumption test "Count how much of
 * the tree a recorded decision could actually order", before anything was swept
 * and before this module existed.
 *
 * Carried as data so the verdict is computed against the written bar rather than
 * against a number a later reader remembered. `denominator` is part of it: the
 * bar was fixed over *32 under-served rows*, and a reading whose row set is a
 * different size is measured against a bar that was never set for it — which
 * {@link CoverageReading.denominatorMoved} says out loud rather than rescaling
 * silently.
 */
export const RECORDED_DECISION_RULE = Object.freeze({
  fixed: "2026-08-02",
  denominator: 32,
  /** At least this many positioned rows and the candidate is worth building on its own. */
  pass: 13,
  /** Below this many and the candidate is dead. "Below 7 of 32 kills the candidate." */
  kill: 7,
});

/**
 * The three verdicts the assumption test pre-committed to, by its own names:
 * `supports` at 13+, `kills` below 7, and `supplement` in between — "a partial
 * result meaning the mechanism is a supplement to another candidate rather than
 * an answer on its own".
 */
export type CoverageVerdict = "supports" | "supplement" | "kills";

/** The verdict for a positioned-row count, against the bar fixed above. */
export function coverageVerdict(positioned: number): CoverageVerdict {
  if (positioned >= RECORDED_DECISION_RULE.pass) return "supports";
  if (positioned < RECORDED_DECISION_RULE.kill) return "kills";
  return "supplement";
}

/** What one row set came out at. */
export interface CoverageReading {
  /** The row set's name — which meaning of "the rows a ranking would order" this is. */
  reading: string;
  rows: number;
  positioned: number;
  contradicted: number;
  /** Positioned-row counts split by the kind of record that reached them first. */
  byKind: Record<DecisionKind, number>;
  verdict: CoverageVerdict;
  /**
   * True when this row set is not the size the bar was fixed over. The verdict
   * is still computed — the bar is an absolute count and stays one — but a
   * reader has to know the denominator moved before treating it as the answer
   * the assumption test asked for.
   */
  denominatorMoved: boolean;
  ordering: DecisionOrdering;
}

const WIKILINK = /\[\[([^\]\n]+)\]\]/g;
const QUOTED = /"([^"\n]+)"/g;

/**
 * Words that make a passage a hold, and words that make it an advance.
 *
 * Deliberately literal and deliberately short. Every phrase here is one this
 * vault's governance actually writes — "Hold until", "Expand only when", "no new
 * siblings", "TARGET →", "critical path", "run first" — and a passage matching
 * neither is `unstated`, which is a verdict rather than a default. Widening
 * these into a sentiment read is how a decision-reader starts deciding.
 *
 * These decide a *direction*, never a kind: they run only on a block that some
 * {@link WIP_HOLD_MARKER}-shaped or heading-shaped rule has already admitted as
 * a decision, so their breadth cannot pull ordinary prose into the record.
 */
const HOLD_WORDS =
  /(\bhold until\b|\bheld on\b|\bHeld\s*:|\bon hold\b|\bGate held\b|\bheld,? deliberately\b|\bgated\b|\bevidence-debt gate\b|\bdo not (?:ideate|expand)\b|\bexpand only when\b|\bno new siblings\b|\bsequenced-after\b|\bdeferred?\b|\bWIP limit\b)/i;
const ADVANCE_WORDS = /(\bTARGET\b|\bcritical path\b|\brun first\b|\bhighest[- ]leverage\b)/i;

/**
 * The narrow marker that makes a block a WIP hold, as opposed to prose that
 * happens to contain the word "held".
 *
 * This started as {@link HOLD_WORDS} and that was wrong in a way worth keeping
 * on the record: over the meta vault it admitted **215 passages**, almost all of
 * them ordinary discussion — a census note about stranded evidence, a sibling
 * comparison saying "do not merge", a pass ledger explaining a gate somewhere
 * else — each naming a row in passing and each then counted as a decision
 * positioning that row. Coverage went from 25 rows to 73 on nothing but
 * vocabulary. A mechanism whose guarantee is that it cannot invent a priority
 * cannot afford a detector that reads discussion as disposition, so the marker
 * is the declaration itself: a pass saying, in the words this vault's ledgers
 * use, that it deliberately did not work these rows.
 */
const WIP_HOLD_MARKER =
  /(\bWIP limit\b|\bHeld\s*:|\bheld on\b|\bhold(?:ing)? (?:until|the remaining|these|those)\b|\bon hold\b|\bGate held\b|\bheld,? deliberately\b)/i;

/**
 * Which way a passage points, read off its own words.
 *
 * The phrases are stop-clauses and go-clauses, never sentiment: bare "hold" and
 * "holds" were in the hold list until the founder decision that calls
 * distribution the critical path — "the gate in front of every external-evidence
 * hope this tree holds" — was read as a hold on the strength of that one verb,
 * which erased the contradiction the solution node exists to surface.
 */
export function directionOf(text: string): Direction {
  const hold = HOLD_WORDS.test(text);
  const advance = ADVANCE_WORDS.test(text);
  if (hold && advance) return "mixed";
  if (hold) return "hold";
  if (advance) return "advance";
  return "unstated";
}

/**
 * Every live node title a passage names verbatim, in the order it names them.
 *
 * Only two forms count — `"Some Title"` and `[[Some Title]]` — and only when the
 * name resolves byte-exactly to a title in `titles`. A quotation of a row that
 * does not exist names nothing, exactly as `ranked-ledger.ts` refuses a wikilink
 * to a fabricated node: otherwise the citation requirement is satisfied by
 * fluent prose around an invented name.
 *
 * The text is whitespace-normalised before matching because this vault's prose
 * is hard-wrapped, and a title split across a line break is the defect the
 * `wrapped-wikilink` rule already exists for. Reading it as "no decision here"
 * would be the same silent under-count in a new place.
 */
export function namesIn(text: string, titles: ReadonlySet<string>): string[] {
  const flat = text.replace(/\s+/g, " ");
  const hits: Array<{ at: number; title: string }> = [];
  for (const re of [WIKILINK, QUOTED]) {
    re.lastIndex = 0;
    for (const m of flat.matchAll(re)) {
      const name = m[1].trim();
      if (titles.has(name)) hits.push({ at: m.index ?? 0, title: name });
    }
  }
  hits.sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.title) && seen.add(h.title)).map((h) => h.title);
}

/** A `## Heading` line's text, or null when the line is not one. */
function headingOf(line: string): string | null {
  const m = /^##+\s+(.*\S)\s*$/.exec(line);
  return m ? m[1] : null;
}

/** The first ISO date a passage carries, or "" — the date a citation is dated by. */
function dateIn(text: string): string {
  const m = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  return m ? m[1] : "";
}

/**
 * Split a node body into `[heading, blocks]` pairs — a heading's bullets when it
 * has them, otherwise its paragraphs. Text before the first heading is the
 * node's own prose, under the heading `""`.
 *
 * Bullets rather than paragraphs for a listed section because a lane bullet *is*
 * the decision: the root's Prioritization section is four bullets naming
 * thirteen rows, and reading the section as one block would collapse four
 * distinct dispositions into one.
 */
function blocksByHeading(body: string): Array<{ heading: string; block: string }> {
  const out: Array<{ heading: string; block: string }> = [];
  let heading = "";
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join("\n");
    buffer = [];
    if (!text.trim()) return;
    // Bullets first: a `- ` line starts a new block and continuation lines join it.
    const blocks: string[] = [];
    let current: string[] = [];
    let inBullet = false;
    for (const line of text.split("\n")) {
      if (/^\s*[-*]\s+/.test(line)) {
        if (current.length) blocks.push(current.join("\n"));
        current = [line];
        inBullet = true;
      } else if (line.trim() === "" && inBullet) {
        if (current.length) blocks.push(current.join("\n"));
        current = [];
        inBullet = false;
      } else if (line.trim() === "") {
        if (current.length) blocks.push(current.join("\n"));
        current = [];
      } else {
        current.push(line);
      }
    }
    if (current.length) blocks.push(current.join("\n"));
    for (const b of blocks) if (b.trim()) out.push({ heading, block: b });
  };

  for (const line of body.split("\n")) {
    const h = headingOf(line);
    if (h !== null) {
      flush();
      heading = h;
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

/** Does this heading open the root's row-by-row prioritization? */
const PRIORITIZATION_HEADING = /^Prioritization\b/i;
/** Does this heading open a founder decision? */
const FOUNDER_HEADING = /^Founder (decision|framing)\b/i;
/**
 * The declaration an author writes when they gate a node's own expansion —
 * the bold lead-in, not the phrase. Six nodes in the meta vault carry
 * `**Evidence-debt gate (deliberate):**` and one writes the same decision as
 * `**No solutions ideated under this, deliberately.**`; a dozen other nodes
 * *mention* the gate while discussing something else, and those are not
 * decisions about the node they sit in.
 */
const GATE_MARKER = /(\*\*\s*Evidence-debt gate\b|\bno solutions? ideated under (?:this|it)\b[^.]{0,60}\bdeliberate)/i;

/**
 * Read every recorded decision out of a tree.
 *
 * Passage order is the read order — the tree as the caller supplies it, then
 * position within each node. Callers pass the tree in vault order (`Vault`'s
 * tree read returns it sorted by filename), which is stable across machines and
 * re-runs; it is only a tie-break, because {@link byRecordOrder} ranks by the
 * date a decision carries before it looks at where the file sits.
 *
 * Nothing here opens a vault, which is why this module is not on
 * `test/ost/retraction-consumers.test.ts`'s pinned list of node readers: it
 * takes nodes and returns facts. That guard matches the reading call textually,
 * so the sentence above deliberately does not spell one — a doc reference is not
 * a call site, and earning a place on that list by writing one in prose would
 * spend the audit's budget on a module that reads nothing.
 */
export function extractDecisions(tree: readonly OstNode[]): DecisionPassage[] {
  const titles = new Set(tree.map((n) => n.title));
  const passages: DecisionPassage[] = [];
  let order = 0;

  for (const node of tree) {
    // A lane label positions the node that carries it: a human classified this
    // test into the lane that says who may run it, which is a decision about
    // what happens to it next. Frontmatter, so there is no prose to quote.
    if (node.lane) {
      passages.push({
        kind: "lane-label",
        node: node.title,
        section: "frontmatter lane:",
        date: node.created ?? "",
        text: `lane: ${node.lane}`,
        names: [node.title],
        direction: directionOf(`lane: ${node.lane}`),
        order: order++,
      });
    }

    for (const { heading, block } of blocksByHeading(node.body ?? "")) {
      const named = namesIn(block, titles);
      const flat = block.replace(/\s+/g, " ").trim();

      if (PRIORITIZATION_HEADING.test(heading) && named.length > 0) {
        passages.push(passage("prioritization-lane", node, heading, flat, named, order++));
        continue;
      }
      if (FOUNDER_HEADING.test(heading) && named.length > 0) {
        passages.push(passage("founder-decision", node, heading, flat, named, order++));
        continue;
      }
      // A gate is written into the gated node's own body and names no row —
      // "this node" is the row, and the gate is the decision about it. Only the
      // node's own prose (before any `##` section) can carry one: a gate
      // recounted in a later ledger entry is a report of a decision, not one.
      if (heading === "" && GATE_MARKER.test(block)) {
        passages.push(passage("evidence-debt-gate", node, "body", flat, [node.title], order++));
        continue;
      }
      if (WIP_HOLD_MARKER.test(block) && named.length > 0) {
        passages.push(passage("wip-hold", node, heading || "body", flat, named, order++));
      }
    }
  }
  return passages;
}

function passage(
  kind: DecisionKind,
  node: OstNode,
  section: string,
  text: string,
  names: string[],
  order: number,
): DecisionPassage {
  const body = text.replace(/^[-*]\s+/, "");
  return {
    kind,
    node: node.title,
    section,
    // The passage's own date first, then the date its heading carries, and only
    // then the node's creation date. A founder decision written under a heading
    // dated 2026-07-25 inside a node created 2026-07-24 is dated by the decision,
    // not by the file — and since the date is the ordering key, getting that
    // backwards would rank one human decision under another on file mtime.
    date: dateIn(body) || dateIn(section) || node.created || "",
    text: body,
    names,
    direction: directionOf(body),
    order,
  };
}

/** The sentence within a passage that names one row — the quote a citation carries. */
function quoteFor(text: string, title: string): string {
  const at = text.indexOf(title);
  // A gate names no row — the node it sits in IS the row — so there is no
  // sentence to narrow to and the declaration itself is the quote.
  if (at < 0) return text.replace(/\*+/g, "").trim();
  return sentencesAround(text, at, at + title.length);
}

/**
 * The order the record itself puts its decisions in: by the date the decision
 * carries, earliest first, then by where it sits in the vault read.
 *
 * Earliest-first, and the alternative is worth naming because it was the first
 * thing tried. Ordering by vault read alone ranks by *filename*, so the root's
 * Prioritization section — the only passage in this vault that records an
 * ordering rather than a disposition — landed in the middle of the alphabet and
 * eight of the thirteen rows it positions took their rank from whatever ledger
 * note happened to sort earlier. Date-first makes the governing decision the one
 * that first put the row somewhere, which is a rule a reader can check against
 * the record and disagree with. A passage carrying no date sorts last: it states
 * no position in time, and guessing one for it would be this module inventing
 * exactly what it exists not to invent.
 */
function byRecordOrder(a: DecisionPassage, b: DecisionPassage): number {
  const ad = a.date || "9999-99-99";
  const bd = b.date || "9999-99-99";
  return ad < bd ? -1 : ad > bd ? 1 : a.order - b.order;
}

/**
 * Publish the ordering: rank every row a recorded decision reaches, in the order
 * the record reaches them, and name every row it does not.
 *
 * There is no tie-break and no score. Two rows named by the same passage are
 * ordered by the order that passage names them in; two rows in different
 * passages by which decision the record dates first ({@link byRecordOrder}). A
 * row named by nothing is not ranked last — it is not ranked at all, which is
 * the difference this mechanism exists to keep.
 */
export function orderByRecordedDecision(
  rows: readonly string[],
  passages: readonly DecisionPassage[],
): DecisionOrdering {
  const byRow = new Map<string, Citation[]>();
  const firstAt = new Map<string, [number, number]>();
  const rowSet = new Set(rows);

  [...passages].sort(byRecordOrder).forEach((p, at) => {
    p.names.forEach((title, i) => {
      if (!rowSet.has(title)) return;
      const cites = byRow.get(title) ?? [];
      cites.push({
        kind: p.kind,
        node: p.node,
        section: p.section,
        date: p.date,
        direction: p.direction,
        quote: quoteFor(p.text, title),
      });
      byRow.set(title, cites);
      if (!firstAt.has(title)) firstAt.set(title, [at, i]);
    });
  });

  const positioned = [...byRow.keys()].sort((a, b) => {
    const [ao, ai] = firstAt.get(a)!;
    const [bo, bi] = firstAt.get(b)!;
    return ao - bo || ai - bi || a.localeCompare(b);
  });

  const ranked: PositionedRow[] = positioned.map((title, i) => {
    const citations = byRow.get(title)!;
    return {
      rank: i + 1,
      title,
      citations,
      contradicted:
        citations.some((c) => c.direction === "advance") && citations.some((c) => c.direction === "hold"),
    };
  });

  const unranked: UnrankedRow[] = rows
    .filter((t) => !byRow.has(t))
    .map((title) => ({ title, problem: "no recorded decision in this vault positions this row" }));

  return { ranked, unranked };
}

/**
 * The reason string published beside a rank — a citation of the decision, never
 * a sentence this module composed.
 *
 * Shaped to survive `ranked-ledger.ts`'s independent refusal: it opens with a
 * `[[wikilink]]` to the node the decision is written in, which is a live title
 * by construction, so a row this mechanism ranks is one that ledger would also
 * publish. That is the check worth having — the ledger asks "does this reason
 * cite anything real?" without knowing where the reason came from.
 */
export function citationReason(row: PositionedRow): string {
  const c = row.citations[0];
  const dated = c.date ? ` (${c.date})` : "";
  const rest =
    row.citations.length > 1
      ? ` — and ${row.citations.length - 1} further recorded decision(s)${row.contradicted ? ", pointing the other way" : ""}`
      : "";
  return `positioned by [[${c.node}]] § ${c.section}${dated} — ${c.kind}, ${DIRECTION_VERB[c.direction]}: "${c.quote}"${rest}`;
}

/** How each direction reads beside a rank. Verbs, so the citation reads as the record's act. */
const DIRECTION_VERB: Record<Direction, string> = {
  advance: "which would advance it",
  hold: "which would hold it",
  mixed: "whose own words point both ways on it",
  unstated: "which names it without saying which way",
};

/** Measure one row set against the pre-committed bar. */
export function coverageOf(
  reading: string,
  rows: readonly string[],
  passages: readonly DecisionPassage[],
): CoverageReading {
  const ordering = orderByRecordedDecision(rows, passages);
  const byKind = Object.fromEntries(DECISION_KINDS.map((k) => [k, 0])) as Record<DecisionKind, number>;
  for (const r of ordering.ranked) byKind[r.citations[0].kind] += 1;
  return {
    reading,
    rows: rows.length,
    positioned: ordering.ranked.length,
    contradicted: ordering.ranked.filter((r) => r.contradicted).length,
    byKind,
    verdict: coverageVerdict(ordering.ranked.length),
    denominatorMoved: rows.length !== RECORDED_DECISION_RULE.denominator,
    ordering,
  };
}

/** The sweep as a person reads it: the table, then the ordering, then the tail. */
export function formatDecisionSweep(readings: readonly CoverageReading[]): string {
  const out: string[] = [
    "RECORDED-DECISION ORDERING",
    "",
    `Bar fixed ${RECORDED_DECISION_RULE.fixed}, before the sweep: ${RECORDED_DECISION_RULE.pass}+ of ` +
      `${RECORDED_DECISION_RULE.denominator} positioned rows supports the candidate; below ` +
      `${RECORDED_DECISION_RULE.kill} kills it.`,
    "",
  ];
  for (const r of readings) {
    out.push(
      `${r.reading}: ${r.positioned}/${r.rows} positioned — ${r.verdict.toUpperCase()}` +
        (r.denominatorMoved ? ` (denominator is ${r.rows}, not the ${RECORDED_DECISION_RULE.denominator} the bar was fixed over)` : "") +
        (r.contradicted > 0 ? `, ${r.contradicted} contradicted` : ""),
    );
    for (const k of DECISION_KINDS) if (r.byKind[k] > 0) out.push(`    ${k}: ${r.byKind[k]}`);
    for (const row of r.ordering.ranked) {
      out.push(`  ${row.rank}. ${row.title}${row.contradicted ? "  [CONTRADICTED]" : ""}`);
      out.push(`     ${citationReason(row)}`);
    }
    if (r.ordering.unranked.length > 0) {
      out.push(`  Unranked — no recorded decision reaches them (${r.ordering.unranked.length}):`);
      for (const u of r.ordering.unranked) out.push(`  - ${u.title}`);
    }
    out.push("");
  }
  return out.join("\n");
}
