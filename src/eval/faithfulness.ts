/**
 * The faithfulness judge — one score per node, and the span of evidence it was
 * read against.
 *
 * `judge-panel.ts` measures whether judges agree with EACH OTHER about a
 * solution's riskiest assumption. This asks a different question, of a
 * different population: does a node's claim stay inside what the evidence it
 * cites actually says? A tree can be structurally perfect — every edge
 * resolved, every bar fixed, every rung declared — and still be a pile of
 * confident sentences nothing on disk supports. Nothing in `eval/` could see
 * that, because every other pass reads the node's *paperwork* and none of them
 * reads the cited document.
 *
 * The unit of output is a number a human rating can be compared against, and
 * three properties are what make that comparison possible at all. They are what
 * `test/eval/faithfulness-judge.test.ts` pins:
 *
 * 1. **A fixed scale, for every node offered.** {@link FAITHFULNESS_SCALE} is
 *    1–5 integers and {@link judgeFaithfulness} returns exactly one row per
 *    subject it was handed. A node whose evidence cannot be read scores low; it
 *    is never skipped, because a sweep that drops the nodes it found hard is a
 *    sweep whose average is a lie.
 * 2. **Every score cites a verbatim span of what the judge was shown.**
 *    {@link faithfulnessScore} refuses to construct a score whose span is not a
 *    substring of the exhibit it names. This is the load-bearing guard, and it
 *    is aimed squarely at the judge this module is a seam for: a model asked to
 *    quote its evidence will invent a quotation, and an invented quotation makes
 *    a score that reads exactly like a grounded one. Refusing at construction
 *    means a rater cannot emit an uncited or misquoted score at all.
 * 3. **Repeat runs land within a point.** {@link stability} scores the same
 *    subject `runs` times and reports the spread against
 *    {@link FAITHFULNESS_TOLERANCE}. A judge whose answer moves by two points
 *    between identical calls cannot be compared to a human rating, however good
 *    its median is — so instability is a reported figure, not an assumption.
 *
 * **The rater is injected, and that is where a model goes.** {@link GROUNDING_RATER}
 * is the deterministic default: four mechanical grounds, each citing the span
 * it read. It is not a model, it shares no ancestry with the proposer only in
 * the shallow sense that it is a different program, and its agreement with a
 * human rating is unmeasured. What it does provide is the harness — scale,
 * citation check, stability — which is the half a model cannot be trusted to
 * supply about itself.
 *
 * **What green here does NOT mean**, stated plainly because the assumption test
 * this serves is explicit about the misreading: a passing suite says the judge
 * emits something comparable to a human rating. It says nothing about whether it
 * AGREES with one. That needs human faithfulness ratings to exist as ground
 * truth, and producing those is a person's work.
 */
import type { OstNode } from "../ost/node.js";
import type { EvidenceRecord } from "../processes/tree.js";
import { claimsStoredEvidence } from "../processes/tree.js";
import { classifyProvenance } from "../knowledge/believability.js";
import { solutionProse } from "./judge-panel.js";

/**
 * The scale, fixed and integer. 1–5 because that is the range a human rater is
 * usually asked for, and the comparison this whole module exists to make
 * possible is judge-vs-human.
 */
export const FAITHFULNESS_SCALE = { min: 1, max: 5 } as const;

/**
 * How far two scorings of the same node may land apart and still be called the
 * same answer. One point, from the assumption test's own wording — a judge that
 * moves further than this between identical calls is not measuring the node.
 */
export const FAITHFULNESS_TOLERANCE = 1;

/** One document the judge was shown. A span may only be cited from one of these. */
export interface Exhibit {
  readonly id: string;
  readonly text: string;
}

/**
 * What a judge is handed: the node's own claim, and the evidence it cited.
 *
 * The claim is the author's argument only — `solutionProse` trims the tree's
 * later commentary — because a node whose `## Issues` section quotes its source
 * would otherwise score for words a critic wrote.
 */
export interface FaithfulnessSubject {
  readonly node: string;
  readonly claim: string;
  readonly exhibits: readonly Exhibit[];
}

/** A span of an exhibit, quoted verbatim. Verified at construction, never trusted. */
export interface Citation {
  /** {@link Exhibit.id} the span was taken from. */
  readonly exhibit: string;
  readonly span: string;
}

/** The mechanical grounds {@link GROUNDING_RATER} decomposes its score into. */
export const FAITHFULNESS_GROUNDS = [
  "cites-a-source",
  "source-resolves",
  "claim-in-evidence",
  "no-unbacked-measurement",
] as const;

export type GroundName = (typeof FAITHFULNESS_GROUNDS)[number];

/** One ground, and the span the judge read to decide it — cited whether met or not. */
export interface Ground {
  readonly name: GroundName;
  readonly met: boolean;
  readonly citation: Citation;
}

export interface FaithfulnessScore {
  readonly node: string;
  /** Integer within {@link FAITHFULNESS_SCALE}. */
  readonly score: number;
  /** Which rater produced it — a score with no author is not comparable to anything. */
  readonly rater: string;
  /** The strongest span the judge can point at for this score. */
  readonly citation: Citation;
  /** Present when the rater decomposes; validated the same way when it is. */
  readonly grounds?: readonly Ground[];
}

/**
 * The seam a model plugs into. A rater sees one subject — the claim and the
 * exhibits, nothing else: not the tree, not the other nodes, not its own
 * previous answers. That independence is structural rather than promised, the
 * same posture `judge-panel.ts` takes.
 */
export interface FaithfulnessRater {
  readonly name: string;
  rate(subject: FaithfulnessSubject): FaithfulnessScore;
}

/**
 * The only way a {@link FaithfulnessScore} comes into being.
 *
 * Refusing here rather than in a downstream check is what makes the guarantee
 * hold for a rater that does not exist yet: a model wired in next year cannot
 * forget to quote its evidence, because forgetting throws before the score is a
 * value anything could report. The three refusals are the three ways a score
 * stops being comparable to a human rating — off the scale, uncited, or citing
 * words that are not in what the judge was shown.
 */
export function faithfulnessScore(
  subject: FaithfulnessSubject,
  rater: string,
  score: number,
  citation: Citation,
  grounds?: readonly Ground[],
): FaithfulnessScore {
  const { min, max } = FAITHFULNESS_SCALE;
  if (!Number.isInteger(score) || score < min || score > max) {
    throw new Error(
      `refusing a faithfulness score of ${score} for "${subject.node}" from rater "${rater}": the scale is ` +
        `${min}–${max} integers, and a score off it cannot be compared to a human rating on the same scale.`,
    );
  }
  verifyCitation(subject, rater, citation, "the score");
  for (const ground of grounds ?? []) {
    verifyCitation(subject, rater, ground.citation, `ground "${ground.name}"`);
  }
  return { node: subject.node, score, rater, citation, ...(grounds ? { grounds } : {}) };
}

/** A span is cited only if the exhibit exists and contains it, byte for byte. */
function verifyCitation(subject: FaithfulnessSubject, rater: string, citation: Citation, what: string): void {
  if (!citation.span.trim()) {
    throw new Error(
      `refusing a faithfulness score for "${subject.node}" from rater "${rater}": ${what} cites an empty span. ` +
        `A score with nothing quoted behind it is an opinion, and a human rating cannot be compared to one.`,
    );
  }
  const exhibit = subject.exhibits.find((e) => e.id === citation.exhibit);
  if (!exhibit) {
    throw new Error(
      `refusing a faithfulness score for "${subject.node}" from rater "${rater}": ${what} cites exhibit ` +
        `"${citation.exhibit}", which is not among the ${subject.exhibits.length} exhibit(s) the judge was shown ` +
        `(${subject.exhibits.map((e) => `"${e.id}"`).join(", ") || "none"}).`,
    );
  }
  if (!exhibit.text.includes(citation.span)) {
    throw new Error(
      `refusing a faithfulness score for "${subject.node}" from rater "${rater}": ${what} quotes ` +
        `"${truncate(citation.span)}" from exhibit "${citation.exhibit}", and that exhibit does not contain it. ` +
        `A quotation the judge invented is indistinguishable from one it read, which is the whole reason the ` +
        `span is checked rather than believed.`,
    );
  }
}

function truncate(text: string, at = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= at ? flat : `${flat.slice(0, at)}…`;
}

/**
 * The exhibit every node has, whatever else it cites: its own provenance,
 * rendered.
 *
 * Two things this is and is not. It IS the paperwork the node carries — the id
 * it cited, the rung it claims, the rung that id earns, and whether the id
 * resolved to a record on disk — so a node whose source resolves to nothing
 * still has a span the judge can quote for why it scored low. It is NOT
 * corroboration: quoting `source: (unset)` is quoting the node's own frontmatter
 * back at it, which is why {@link GROUNDING_RATER} will not let a claim count as
 * grounded against this exhibit.
 */
export const PROVENANCE_EXHIBIT = "provenance";

function provenanceExhibit(node: OstNode, resolved: EvidenceRecord | undefined): Exhibit {
  const source = node.source?.trim() ?? "";
  const stored = resolved
    ? resolved.id
    : claimsStoredEvidence(source)
      ? "none — this id names no stored record"
      : "not claimed — this source names no stored record";
  return {
    id: PROVENANCE_EXHIBIT,
    text: [
      `source: ${source || "(unset)"}`,
      `rung claimed: ${node.evidence ?? "(unset)"}`,
      `rung the source earns: ${classifyProvenance(source)}`,
      `stored record: ${stored}`,
    ].join("\n"),
  };
}

/**
 * Build one subject per node handed in — no filtering, no drops.
 *
 * The caller chooses the population (the CLI leaves the Outcome out: the
 * mandate is the human's to declare, not to source, the same exemption
 * `golden-set.ts` makes). What this function guarantees is that whatever it was
 * given comes back, so "every node it is given" is a property of the builder
 * rather than of the caller's luck.
 *
 * Resolution is byte-exact against the record `id`, matching every other
 * consumer of an evidence id in this repo: a node citing `inbox:note.md` for a
 * stored `INBOX:note.md` reads as unresolved, which is the W12 near-miss being
 * reported rather than smoothed over.
 */
export function subjectsFor(
  nodes: readonly OstNode[],
  records: readonly EvidenceRecord[],
): FaithfulnessSubject[] {
  const byId = new Map(records.map((r) => [r.id, r]));
  return nodes.map((node) => {
    const resolved = byId.get(node.source?.trim() ?? "");
    const exhibits: Exhibit[] = [provenanceExhibit(node, resolved)];
    if (resolved && resolved.body.trim()) exhibits.push({ id: resolved.id, text: resolved.body.trim() });
    return { node: node.title, claim: solutionProse(node.body), exhibits };
  });
}

/* ------------------------------------------------------------------ *
 * The deterministic rater.
 * ------------------------------------------------------------------ */

/** Markdown emphasis and link syntax stripped, so the lens sees words. */
function plain(text: string): string {
  return text.replace(/\*\*|\*|`|\[\[|\]\]/g, "");
}

/**
 * Words too common to distinguish a claim from any other claim. Short tokens are
 * dropped by length below; this list is the frequent long words that would
 * otherwise make every node look grounded in every document.
 */
const STOPWORDS = new Set([
  "about", "after", "again", "against", "because", "been", "before", "being", "between", "both", "cannot",
  "could", "does", "doing", "down", "during", "each", "even", "ever", "every", "from", "further", "have",
  "having", "here", "into", "just", "less", "like", "made", "make", "makes", "many", "more", "most", "much",
  "must", "never", "only", "onto", "other", "over", "same", "should", "since", "some", "such", "than", "that",
  "them", "then", "there", "these", "they", "this", "those", "through", "under", "until", "very", "were",
  "what", "when", "where", "which", "while", "with", "without", "would", "your",
]);

/** The words that make a claim this claim rather than another one. */
function distinctive(text: string): Set<string> {
  const out = new Set<string>();
  for (const token of plain(text).toLowerCase().match(/[a-z][a-z-]*/g) ?? []) {
    if (token.length >= 4 && !STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

/** Sentences of a document, long enough to assert something. */
function sentences(text: string): string[] {
  return plain(text)
    .split(/\n{2,}|(?<=[.?!])\s+(?=[A-Z"“(])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 20);
}

/**
 * How much of the claim's vocabulary the evidence carries, before a threshold is
 * applied. Exported because the number is more useful than the verdict when a
 * human is deciding whether {@link GROUNDING_FLOOR} sits in the right place.
 */
export function lexicalCoverage(claim: string, evidence: string): number {
  const terms = distinctive(claim);
  if (terms.size === 0) return 0;
  const found = distinctive(evidence);
  let hit = 0;
  for (const t of terms) if (found.has(t)) hit++;
  return hit / terms.size;
}

/**
 * The share of a claim's distinctive vocabulary that must appear in the cited
 * evidence before {@link GROUNDING_RATER} will call the claim grounded in it.
 *
 * A floor, not a tuned parameter: it is set where a node that restates its
 * source clears it and a node that merely cites a document about a different
 * subject does not, and `test/eval/faithfulness-judge.test.ts` pins that
 * separation on committed fixtures rather than on this number's authority. It
 * is deliberately generous — this rater must not punish a node for paraphrasing
 * well, because a scorer that fires on good writing is a scorer somebody turns
 * off.
 */
export const GROUNDING_FLOOR = 0.3;

/**
 * Claim shapes that assert something was counted, proven, or holds universally.
 * These are the sentences a document either backs or does not; a hedge cannot
 * outrun its evidence, but "every firing does X" can.
 */
const MEASURED_CLAIM =
  /\b\d+(\.\d+)?\s*(%|percent|x\b|×)|\b\d+\s+(of|out of|in)\s+\d+\b|\b(always|never|every|all|proves|proven|measured|guarantees|guaranteed|eliminates|impossible)\b/i;

/** The same shapes, as a document either carries one or it does not. */
function carriesMeasurement(text: string): boolean {
  return MEASURED_CLAIM.test(plain(text));
}

/** The sentence of a document that carries the most of the claim's distinctive terms. */
function bestMatch(claim: string, exhibit: Exhibit): Citation {
  const terms = distinctive(claim);
  let best = "";
  let bestHits = -1;
  for (const sentence of sentences(exhibit.text)) {
    const words = distinctive(sentence);
    let hits = 0;
    for (const t of terms) if (words.has(t)) hits++;
    if (hits > bestHits) {
      best = sentence;
      bestHits = hits;
    }
  }
  // `sentences()` normalises whitespace, so the winner is re-anchored to the
  // exhibit's own bytes: a citation must be quotable from the document as
  // stored, not from a cleaned-up copy of it.
  return { exhibit: exhibit.id, span: anchor(best, exhibit) ?? firstLine(exhibit) };
}

/**
 * The longest prefix of a normalised sentence that appears verbatim in the
 * exhibit. Wrapping and repeated spaces mean the normalised form is often not a
 * substring of the source; the prefix that is, is still a span the reader can
 * find, which is what a citation is for.
 */
function anchor(sentence: string, exhibit: Exhibit): string | null {
  if (!sentence) return null;
  if (exhibit.text.includes(sentence)) return sentence;
  const words = sentence.split(" ");
  for (let take = words.length - 1; take >= 4; take--) {
    const prefix = words.slice(0, take).join(" ");
    if (exhibit.text.includes(prefix)) return prefix;
  }
  return null;
}

/** The fallback span: an exhibit's first non-empty line, which every exhibit has. */
function firstLine(exhibit: Exhibit): string {
  return exhibit.text.split("\n").find((l) => l.trim())?.trim() ?? exhibit.text.trim();
}

/** The provenance exhibit's line beginning with `label`, e.g. `source: `. */
function provenanceLine(subject: FaithfulnessSubject, label: string): Citation {
  const exhibit = subject.exhibits.find((e) => e.id === PROVENANCE_EXHIBIT)!;
  const line = exhibit.text.split("\n").find((l) => l.startsWith(label));
  return { exhibit: PROVENANCE_EXHIBIT, span: line ?? firstLine(exhibit) };
}

/**
 * The mechanical rater: four grounds, one point each above the floor.
 *
 * They are ordered by what they cost to satisfy — citing anything, citing
 * something that resolves, citing something the claim's own words are in, and
 * not asserting a measurement the document never made. The score is
 * `1 + met`, so the scale's floor is "cited nothing that resolves and reads
 * like nothing in the record" and its ceiling is "restates a document on disk
 * without adding a measurement to it".
 *
 * Every ground cites the span it READ, met or not, because "why did this score
 * 2" is the question a human comparing ratings actually asks, and a bare number
 * cannot answer it. Grounds three and four fall back to the provenance exhibit
 * when nothing resolved: there is no document to quote, and saying so by quoting
 * the line that says so is more honest than a missing citation.
 *
 * What it does not read: the node's shape. Whether an Opportunity is written as
 * a need is `golden-set.ts`'s `need-shaped` dimension, and scoring it here too
 * would be a second opinion about the same property in a second spelling — the
 * drift this repo has spent time removing. This rater answers exactly the
 * question its name asks.
 *
 * **And the ceiling, stated as a fact rather than a caveat: lexical overlap
 * cannot see negation.** A claim built from the same words as a sentence that
 * CONTRADICTS it scores exactly as high as one the sentence supports — the
 * corpus contains a live instance, and `test/eval/faithfulness-judge.test.ts`
 * pins it deliberately so the limit is a committed fact instead of a surprise
 * somebody meets in production. That gap is the strongest argument for the
 * injected rater: it is what a reading judge is for, and it is precisely the
 * kind of error a human rater would never make, so agreement measured against
 * THIS rater would flatter it.
 */
export const GROUNDING_RATER: FaithfulnessRater = {
  name: "grounding",
  rate(subject: FaithfulnessSubject): FaithfulnessScore {
    const documents = subject.exhibits.filter((e) => e.id !== PROVENANCE_EXHIBIT);
    const corpus = documents.map((d) => d.text).join("\n\n");

    const sourceLine = provenanceLine(subject, "source: ");
    const cites: Ground = {
      name: "cites-a-source",
      met: !sourceLine.span.endsWith("(unset)"),
      citation: sourceLine,
    };

    const resolves: Ground = {
      name: "source-resolves",
      met: documents.length > 0,
      citation: documents.length > 0 ? firstSentenceOf(documents[0]) : provenanceLine(subject, "stored record: "),
    };

    // With nothing resolved there is no document to weigh the claim against, so
    // both reading grounds fail and cite the line that explains why.
    const nothingRead = provenanceLine(subject, "stored record: ");
    const read = documents.length > 0 ? bestMatch(subject.claim, documents[0]) : nothingRead;

    const grounded: Ground = {
      name: "claim-in-evidence",
      met: documents.length > 0 && lexicalCoverage(subject.claim, corpus) >= GROUNDING_FLOOR,
      citation: read,
    };

    const measured: Ground = {
      name: "no-unbacked-measurement",
      met: documents.length > 0 && (!carriesMeasurement(subject.claim) || carriesMeasurement(corpus)),
      citation: read,
    };

    const grounds = [cites, resolves, grounded, measured];
    const met = grounds.filter((g) => g.met);
    // The strongest thing the judge can point at: the last ground it cleared,
    // or the first ground's span when it cleared none.
    const decisive = (met.length > 0 ? met[met.length - 1] : grounds[0]).citation;
    return faithfulnessScore(subject, this.name, FAITHFULNESS_SCALE.min + met.length, decisive, grounds);
  },
};

/** An exhibit's opening sentence — what "this resolved to a record" points at. */
function firstSentenceOf(exhibit: Exhibit): Citation {
  const first = sentences(exhibit.text)[0];
  return { exhibit: exhibit.id, span: (first && anchor(first, exhibit)) ?? firstLine(exhibit) };
}

/* ------------------------------------------------------------------ *
 * The sweep.
 * ------------------------------------------------------------------ */

export interface FaithfulnessRow {
  readonly node: string;
  /** The first run's score — the one a report quotes. */
  readonly score: number;
  readonly citation: Citation;
  readonly grounds?: readonly Ground[];
  /** Every run's score, in order, so a reader can see the movement rather than a summary of it. */
  readonly repeats: readonly number[];
  /** max − min across {@link repeats}. */
  readonly spread: number;
  /** Whether {@link spread} is within {@link FAITHFULNESS_TOLERANCE}. */
  readonly stable: boolean;
}

export interface FaithfulnessReport {
  readonly rater: string;
  /** Sweep discipline: a judgement over nothing must be visible as such. */
  readonly subject: { readonly offered: number; readonly read: number };
  readonly rows: readonly FaithfulnessRow[];
  /** Count per score, indexed by the score itself. */
  readonly distribution: Readonly<Record<number, number>>;
  readonly mean: number;
  /** Nodes whose repeat runs moved further than the tolerance — named, never averaged away. */
  readonly unstable: readonly string[];
}

/**
 * Score one subject `runs` times and report the movement.
 *
 * Separate from the sweep because it is the property a human wants to check
 * before trusting any rating at all, and because a rater with a real cost
 * should be able to buy stability for a sample rather than for the whole tree.
 */
export function stability(
  subject: FaithfulnessSubject,
  rater: FaithfulnessRater,
  runs = 2,
): { readonly scores: readonly number[]; readonly spread: number; readonly stable: boolean } {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`refusing to measure stability over ${runs} run(s): a spread needs at least one score.`);
  }
  const scores: number[] = [];
  for (let i = 0; i < runs; i++) scores.push(rater.rate(subject).score);
  const spread = Math.max(...scores) - Math.min(...scores);
  return { scores, spread, stable: spread <= FAITHFULNESS_TOLERANCE };
}

/**
 * Judge every subject offered.
 *
 * One row per subject, always: the row count IS the totality property, and a
 * rater that throws on a subject takes the sweep down rather than quietly
 * shrinking its own denominator. That is the intended trade — a partly-blind
 * sweep reporting a clean mean is the failure this repo keeps finding, and a
 * loud stop is the cheaper half of it.
 */
export function judgeFaithfulness(
  subjects: readonly FaithfulnessSubject[],
  rater: FaithfulnessRater = GROUNDING_RATER,
  runs = 2,
): FaithfulnessReport {
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`refusing to judge over ${runs} run(s): a score needs at least one.`);
  }
  const rows: FaithfulnessRow[] = subjects.map((subject) => {
    const first = rater.rate(subject);
    // The first run is the one the report quotes, so it is kept rather than
    // re-derived: a rater that moves would otherwise report a citation from one
    // run beside a score from another.
    const repeats = runs === 1 ? [first.score] : [first.score, ...stability(subject, rater, runs - 1).scores];
    const spread = Math.max(...repeats) - Math.min(...repeats);
    return {
      node: subject.node,
      score: first.score,
      citation: first.citation,
      ...(first.grounds ? { grounds: first.grounds } : {}),
      repeats,
      spread,
      stable: spread <= FAITHFULNESS_TOLERANCE,
    };
  });

  const distribution: Record<number, number> = {};
  for (let s = FAITHFULNESS_SCALE.min; s <= FAITHFULNESS_SCALE.max; s++) distribution[s] = 0;
  for (const row of rows) distribution[row.score]++;

  return {
    rater: rater.name,
    subject: { offered: subjects.length, read: rows.length },
    rows,
    distribution,
    mean: rows.length === 0 ? 0 : rows.reduce((sum, r) => sum + r.score, 0) / rows.length,
    unstable: rows.filter((r) => !r.stable).map((r) => r.node),
  };
}

/**
 * The report an operator reads: the distribution first, then every node with the
 * span it was scored against.
 *
 * The spans are the point. A mean with no quotations behind it is a grade nobody
 * can check, and checking it — spot-reading the judge against the document it
 * claims to have read — is the only thing standing between this number and the
 * grading-its-own-homework problem the node it serves was raised against.
 */
export function renderFaithfulness(report: FaithfulnessReport): string {
  const { offered, read } = report.subject;
  if (read === 0) {
    return `faithfulness: BLIND — read 0 of ${offered} node(s), so no score exists.`;
  }
  const lines: string[] = [];
  const histogram = Object.entries(report.distribution)
    .map(([score, count]) => `${score}:${count}`)
    .join("  ");
  lines.push(
    `faithfulness (rater "${report.rater}"): mean ${report.mean.toFixed(2)} on a ` +
      `${FAITHFULNESS_SCALE.min}–${FAITHFULNESS_SCALE.max} scale over ${read} of ${offered} node(s).`,
  );
  lines.push(`  distribution  ${histogram}`);
  if (report.unstable.length > 0) {
    lines.push(
      `  UNSTABLE on ${report.unstable.length} node(s) — repeat runs moved more than ${FAITHFULNESS_TOLERANCE} ` +
        `point, so those scores are not comparable to a rating: ${report.unstable.join("; ")}`,
    );
  }
  for (const row of [...report.rows].sort((a, b) => a.score - b.score || a.node.localeCompare(b.node))) {
    lines.push(`\n- ${row.score}/${FAITHFULNESS_SCALE.max} — "${row.node}"`);
    lines.push(`    read: [${row.citation.exhibit}] "${truncate(row.citation.span, 120)}"`);
    for (const ground of row.grounds ?? []) {
      lines.push(`    ${ground.met ? "✓" : "✗"} ${ground.name}: [${ground.citation.exhibit}] "${truncate(ground.citation.span)}"`);
    }
  }
  return lines.join("\n");
}
