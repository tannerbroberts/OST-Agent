/**
 * Peer exchange: merging one vault into another and counting what a person has
 * to settle.
 *
 * There is no central inbox in this design. An operator who wants another
 * instance's experience arranges the exchange directly — a fetch from a remote
 * they were given access to — and the whole question is whether that costs an
 * afternoon. Raw conflict count does not answer it: a merge with two hundred
 * collisions a rule resolves cleanly is cheap, and a merge with six that each
 * need a ruling is not. So this module does two things and reports them apart:
 * it performs the exchange as a real `git merge` into a scratch repository
 * neither vault can see, and it partitions every conflict git stops on into the
 * ones a stated rule settles and the ones only a person can.
 *
 * **The classifier is deliberately base-free.** Two federating vaults have no
 * common ancestor — that is what makes them peers rather than branches — so
 * nothing here consults merge stage 1 even when git has one. Every rule below
 * takes two sides and nothing else, which makes it strictly weaker than a
 * three-way merge (it can never say "one side simply did not touch this") and
 * therefore never settles something a three-way merge would have left alone.
 *
 * **What makes something a rule.** A conflict counts as settled only when the
 * resolution is
 *
 *   1. **deterministic** — the same two sides always produce the same bytes;
 *   2. **symmetric** — which vault ran the exchange does not change the content
 *      of the result (line ORDER inside a ledger follows the local side, and
 *      that is the whole of the asymmetry);
 *   3. **lossless** — no assertion either side made is discarded. Where a rule
 *      picks one value over another it writes the value it did not adopt into
 *      the node's `## History`, which is the same append-only discipline the
 *      vault already runs on. A person reviewing the merge afterwards can see
 *      every choice a rule made and what it cost.
 *
 * A collision that cannot be settled that way is not resolved here at ALL. It is
 * reported, with the field that diverged named, and the scratch merge is left
 * conflicted on disk so the person can look at it. Nothing in this module
 * commits, and nothing writes to either vault.
 *
 * **A settlement is a NODE, never bytes.** `settleNodeCollision` returns the
 * `OstNode` a rule resolved to and stops there; it does not import `serialize`
 * and it does not render a file. `Vault` is the only thing in this codebase that
 * turns a node into bytes on disk, every safety property downstream rests on
 * that being true, and `test/ost/serialize-single-writer.test.ts` pins it at the
 * import level rather than at the write — because "it does not write it today"
 * is how the next violation ships. So this module decides WHAT the merged node
 * is and the vault decides how it lands, which is also the better division:
 * a resolution you can check field by field beats one you have to diff.
 *
 * **It may author reserved headings, and nothing on the tool surface may reach
 * it.** It appends to `## History`, which `ost/headings.ts` reserves to the
 * human/CLI path for the reason stated there. This is a library function called
 * from the CLI, exactly like `recordResult`; it is not in `ALLOWED_TOOL_NAMES`
 * and must not be added to it.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { simpleGit, type SimpleGit } from "simple-git";
import { classifyProvenance, rungRank, weakestRung } from "../knowledge/believability.js";
import { joinAuthorship } from "./authorship.js";
import { HISTORY_HEADING, RESERVED_HEADINGS, RETRACTION_HEADING, isHeadingLine } from "./headings.js";
import { deserialize, type OstNode } from "./node.js";

/**
 * The named rules. Each one is a sentence a person can check, which is the
 * point: "a rule settles it" is only a defence if the rule can be stated.
 */
export type SettlementRule =
  /**
   * The two files differ in bytes and in nothing this schema reads — frontmatter
   * key order, indentation, a trailing newline. Not a hypothetical: on the real
   * pairs measured, 17 of 44 settled collisions were this, because two vault
   * versions emit the same frontmatter keys in a different order.
   */
  | "identical-after-parsing"
  /** Both sides' entries under a reserved append-only heading are kept. */
  | "ledger-union"
  /** Both sides' child edges are kept. */
  | "link-union"
  /** Both sides' tags are kept. */
  | "tag-union"
  /** One side set a field the other left absent; the set value is adopted. */
  | "one-sided-field"
  /** Evidence rungs differ; the weaker is adopted — a conclusion is only as believable as its weakest input. */
  | "weakest-rung-wins"
  /** Sources differ; the one classifying to the weaker rung is adopted, the other recorded. */
  | "weaker-provenance-wins"
  /** `sight` differs; `blind` is adopted, because an unlabelled instrument must never read as grounded. */
  | "blind-sight-wins"
  /** `authorship` differs; both are kept as `mixed`, because two hands wrote the node this merge produces. */
  | "authorship-union"
  /** `created` differs; the earlier date is adopted — the node exists from when the first peer wrote it. */
  | "earliest-created-wins"
  /** Two agent-set confidences disagree, so neither is a claim; the field is dropped and both recorded. */
  | "confidence-dropped-on-disagreement"
  /** The two prose bodies say the same words and cite the same nodes in different sigils. */
  | "citation-style-normalised"
  /** One side's prose contains the other's verbatim; the longer is adopted. */
  | "prose-superset-wins"
  /** One side has no prose at all; the other's is adopted. */
  | "one-sided-prose";

/** Why a collision needs a person. Each names the field, so a report can be read without opening the file. */
export type JudgementReason =
  | "status-diverged"
  | "layer-diverged"
  | "threshold-diverged"
  | "instrument-diverged"
  | "lane-diverged"
  | "prose-diverged"
  | "retraction-diverged"
  | "unknown-field-diverged"
  | "unparseable-node"
  | "not-a-node"
  | "delete-modify";

export interface Settlement {
  file: string;
  /** Every rule that fired, in field order, so the report says what was done rather than that something was. */
  rules: SettlementRule[];
  /** The node the rules resolved to. A rule that cannot produce one is not a rule. */
  resolved: OstNode;
  /** Frontmatter outside this schema, carried through untouched. Empty in every vault measured so far. */
  extraFrontmatter: Record<string, unknown>;
}

export interface JudgementCall {
  file: string;
  reasons: JudgementReason[];
  /** One line per reason: the field and both sides' values, truncated. */
  detail: string[];
}

export type CollisionVerdict =
  | ({ settleable: true } & Omit<Settlement, "file">)
  | ({ settleable: false } & Omit<JudgementCall, "file">);

/** How long a value may be before the report truncates it. */
const DETAIL_WIDTH = 80;

function brief(value: string | undefined): string {
  if (value === undefined) return "(absent)";
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > DETAIL_WIDTH ? `${flat.slice(0, DETAIL_WIDTH - 1)}…` : flat;
}

/**
 * Normalise prose for comparison: trailing whitespace and blank-line runs are
 * formatting, not content, and two peers whose editors disagree about them have
 * not disagreed about anything a person should be asked to rule on.
 */
function normalizeProse(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An inline citation of another node's title, in the form Obsidian renders as a link. */
const INLINE_WIKILINK = /\[\[([^[\]\n]+)\]\]/g;

/**
 * Rewrite every inline `[[Title]]` as `"Title"`.
 *
 * Used ONLY as a comparison key, never as content. Two vaults that have been
 * apart for a while cite each other's nodes in different sigils — this project's
 * own tree changed dialect mid-life, from `"Title"` to `[[Title]]`, and a body
 * that a peer merely re-rendered arrives looking like a rewrite. Measured
 * against two real snapshots of this repository's vault, that one difference
 * accounted for 39 of 52 collisions that no other rule could settle, and in
 * every one of them the words were identical: a two-character diff in an eight
 * thousand character body.
 *
 * A rewrite of a sigil is not a disagreement, so the comparison ignores it. Note
 * what is NOT ignored: only a WHOLE LINE of `[[Title]]` is an edge
 * ({@link ./node.ts}), so nothing collapsed here was ever a link in the graph,
 * and the child edges themselves are merged separately and by union.
 */
function canonicalCitations(text: string): string {
  return text.replace(INLINE_WIKILINK, (_m, title: string) => `"${title.trim()}"`);
}

/** How many inline citations render as links. Decides which of two equivalent bodies is adopted. */
function wikilinkCount(text: string): number {
  return [...text.matchAll(INLINE_WIKILINK)].length;
}

/**
 * Split a body into its non-reserved prose and a map from reserved heading to
 * the lines under it.
 *
 * `sections.ts` already splits prose from reserved blocks and is the right tool
 * for an edit, which only has to put the blocks back verbatim. A merge has to
 * look INSIDE them — two peers each appended to `## History` and the union is
 * the whole point — so the blocks are keyed by heading here rather than kept as
 * an opaque ordered list.
 */
function splitLedgers(body: string): { prose: string; ledgers: Map<string, string[]> } {
  const lines = body.split("\n");
  const prose: string[] = [];
  const ledgers = new Map<string, string[]>();
  let current: string[] | null = null;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line.trim())) {
      current = null;
      const reserved = RESERVED_HEADINGS.find((h) => isHeadingLine(line, h));
      if (reserved) {
        // A heading repeated in one file (it happens, from a hand edit) extends
        // the block it already opened rather than replacing it.
        current = ledgers.get(reserved) ?? [];
        ledgers.set(reserved, current);
        continue;
      }
    }
    (current ?? prose).push(line);
  }

  for (const [heading, block] of ledgers) {
    while (block.length > 0 && block[block.length - 1].trim() === "") block.pop();
    while (block.length > 0 && block[0].trim() === "") block.shift();
    ledgers.set(heading, block);
  }
  return { prose: prose.join("\n").trim(), ledgers };
}

/**
 * Union two ledgers: ours in order, then every line of theirs we do not already
 * carry. Lossless by construction, and the only ordering choice in the module —
 * the local side reads first, which is what an operator merging a peer into
 * their own vault expects to see.
 */
function unionLedger(ours: string[], theirs: string[]): string[] {
  // Keyed on the citation-normalised line, so the same entry re-rendered in the
  // other vault's dialect is recognised as the entry it already is rather than
  // filed twice. The line that survives is ours, verbatim.
  const key = (line: string): string => canonicalCitations(line.trim());
  const seen = new Set(ours.map(key).filter((l) => l !== ""));
  const out = [...ours];
  for (const line of theirs) {
    const k = key(line);
    if (k === "" || seen.has(k)) continue;
    seen.add(k);
    out.push(line);
  }
  return out;
}

/** Frontmatter keys `deserialize` understands; anything else is carried, and compared, by hand. */
const KNOWN_FIELDS = new Set([
  "type",
  "status",
  "source",
  "created",
  "confidence",
  "evidence",
  "lane",
  "threshold",
  "instrument",
  "sight",
  "authorship",
]);

function extraFields(text: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try {
    data = matter(text).data as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN_FIELDS.has(k)) out[k] = v;
  return out;
}

/** One `## History` line recording a choice a rule made, in the vault's own dated style. */
function historyLine(at: string, sentence: string): string {
  return `- ${at} peer-merge: ${sentence}`;
}

export interface SettleOptions {
  /** ISO date stamped on the `## History` lines a rule writes. Passed in, never read from the clock. */
  at: string;
  /** How the peer is named in those lines — a remote name, a path, whatever the operator called it. */
  peerLabel?: string;
}

/**
 * Classify one collision, and resolve it when a rule can.
 *
 * `title` is the node title (the filename without `.md`), which `deserialize`
 * needs and neither side's bytes carry.
 */
export function settleNodeCollision(
  title: string,
  ours: string,
  theirs: string,
  opts: SettleOptions,
): CollisionVerdict {
  let a: OstNode;
  let b: OstNode;
  try {
    a = deserialize(title, ours);
    b = deserialize(title, theirs);
  } catch (e) {
    return {
      settleable: false,
      reasons: ["unparseable-node"],
      detail: [`does not parse as a node: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  const rules: SettlementRule[] = [];
  const reasons: JudgementReason[] = [];
  const detail: string[] = [];
  const history: string[] = [];
  const peer = opts.peerLabel ? ` (peer: ${opts.peerLabel})` : "";

  const merged: OstNode = { ...a, tags: [...a.tags], links: [...a.links] };

  // --- fields only a person can rule on -------------------------------------
  // Each is a claim the two vaults make differently ABOUT THE SAME NODE, and no
  // ordering on the values exists that is not somebody's opinion. `status` is a
  // verdict, `threshold` and `instrument` are the pre-committed bar, `lane` is
  // permission for compute to spend money unattended, `type` is what kind of
  // thing the node is at all. Picking a side on any of these is the resolution
  // being wrong quietly, which is worse than an afternoon of merge work.
  //
  // One side simply not having filled a field in is NOT one of those: adopting
  // the value that exists loses nothing, because the absent side asserted
  // nothing to lose. `adopt` is that half; the caller does the assignment so the
  // merged node stays a typed `OstNode` rather than an index signature.
  const adopt = <T>(x: T | undefined, y: T | undefined, reason: JudgementReason, field: string): T | undefined => {
    if (x === y) return x;
    if (x === undefined || y === undefined) {
      rules.push("one-sided-field");
      return x ?? y;
    }
    reasons.push(reason);
    detail.push(`${field}: ours ${brief(String(x))} / theirs ${brief(String(y))}`);
    return x;
  };
  merged.layer = adopt(a.layer, b.layer, "layer-diverged", "type") ?? a.layer;
  merged.status = adopt(a.status, b.status, "status-diverged", "status");
  merged.threshold = adopt(a.threshold, b.threshold, "threshold-diverged", "threshold");
  merged.instrument = adopt(a.instrument, b.instrument, "instrument-diverged", "instrument");
  merged.lane = adopt(a.lane, b.lane, "lane-diverged", "lane");

  // --- fields a stated rule settles -----------------------------------------
  if (a.evidence !== b.evidence) {
    if (a.evidence === undefined || b.evidence === undefined) {
      merged.evidence = a.evidence ?? b.evidence;
      rules.push("one-sided-field");
    } else {
      merged.evidence = weakestRung([a.evidence, b.evidence]);
      rules.push("weakest-rung-wins");
      history.push(
        historyLine(
          opts.at,
          `evidence ${a.evidence} / ${b.evidence}${peer} → ${merged.evidence}, the weaker of the two`,
        ),
      );
    }
  }

  if (a.source !== b.source) {
    if (a.source === undefined || b.source === undefined) {
      merged.source = a.source ?? b.source;
      rules.push("one-sided-field");
    } else {
      // Same principle as the rung, applied to where the claim came from: the
      // provenance that earns less is the one the merged node stands on, and
      // the other is written down rather than thrown away.
      const [keep, drop] =
        rungRank(classifyProvenance(a.source)) >= rungRank(classifyProvenance(b.source))
          ? [a.source, b.source]
          : [b.source, a.source];
      merged.source = keep;
      rules.push("weaker-provenance-wins");
      history.push(historyLine(opts.at, `source ${keep} kept; peer also cited ${drop}${peer}`));
    }
  }

  if (a.sight !== b.sight) {
    if (a.sight === undefined || b.sight === undefined) {
      merged.sight = a.sight ?? b.sight;
      rules.push("one-sided-field");
    } else {
      merged.sight = "blind";
      rules.push("blind-sight-wins");
      history.push(historyLine(opts.at, `sight ${a.sight} / ${b.sight}${peer} → blind, the unproven side`));
    }
  }

  // The join on the authorship lattice, which is exactly what a settlement rule
  // has to be: deterministic, symmetric, and lossless — neither peer's claim
  // about who wrote the node is discarded to reach the answer. Note the
  // direction it fails in: `machine` against `human` resolves to `mixed`, which
  // says a machine's prose is in there, never to `human`. A rule that could
  // launder the agent's sentences into a person's by merging a peer would be
  // worth more to the agent than any other line in this file.
  if (a.authorship !== b.authorship) {
    merged.authorship = joinAuthorship(a.authorship, b.authorship);
    if (a.authorship === undefined || b.authorship === undefined) {
      rules.push("one-sided-field");
    } else {
      rules.push("authorship-union");
      history.push(
        historyLine(opts.at, `authorship ${a.authorship} / ${b.authorship}${peer} → mixed, both hands kept`),
      );
    }
  }

  if (a.created !== b.created) {
    if (a.created === undefined || b.created === undefined) {
      merged.created = a.created ?? b.created;
      rules.push("one-sided-field");
    } else {
      const [early, late] = a.created <= b.created ? [a.created, b.created] : [b.created, a.created];
      merged.created = early;
      rules.push("earliest-created-wins");
      history.push(historyLine(opts.at, `created ${early} kept; the peer's copy dated ${late}${peer}`));
    }
  }

  if (a.confidence !== b.confidence) {
    if (a.confidence === undefined || b.confidence === undefined) {
      merged.confidence = a.confidence ?? b.confidence;
      rules.push("one-sided-field");
    } else {
      delete merged.confidence;
      rules.push("confidence-dropped-on-disagreement");
      history.push(
        historyLine(opts.at, `confidence dropped — the two sides said ${a.confidence} and ${b.confidence}${peer}`),
      );
    }
  }

  // Tags and edges are sets, and a set has a union. Neither side loses anything.
  const tagUnion = [...new Set([...a.tags, ...b.tags])];
  if (tagUnion.length !== a.tags.length || tagUnion.some((t, i) => t !== a.tags[i])) {
    merged.tags = tagUnion;
    rules.push("tag-union");
  }
  const linkUnion = [...new Set([...a.links, ...b.links])];
  if (linkUnion.length !== a.links.length || linkUnion.some((l, i) => l !== a.links[i])) {
    merged.links = linkUnion;
    rules.push("link-union");
  }

  // --- body ------------------------------------------------------------------
  const left = splitLedgers(a.body);
  const right = splitLedgers(b.body);

  const mergedLedgers = new Map<string, string[]>();
  for (const heading of RESERVED_HEADINGS) {
    const ourBlock = left.ledgers.get(heading);
    const theirBlock = right.ledgers.get(heading);
    if (ourBlock === undefined && theirBlock === undefined) continue;

    // A retraction takes the node out of every read there is. One side holding
    // one and the other not is the two vaults disagreeing about whether the node
    // exists, and a union would quietly retract it for both.
    if (heading === RETRACTION_HEADING && (ourBlock === undefined || theirBlock === undefined)) {
      reasons.push("retraction-diverged");
      detail.push(`${heading}: present on ${ourBlock ? "ours" : "theirs"} only`);
      continue;
    }

    const union = unionLedger(ourBlock ?? [], theirBlock ?? []);
    mergedLedgers.set(heading, union);
    const changed = ourBlock === undefined || union.length !== ourBlock.length;
    if (changed) rules.push("ledger-union");
  }

  const ourProse = normalizeProse(left.prose);
  const theirProse = normalizeProse(right.prose);
  let mergedProse = ourProse;
  if (ourProse !== theirProse) {
    const ourKey = canonicalCitations(ourProse);
    const theirKey = canonicalCitations(theirProse);
    if (ourProse === "" || theirProse === "") {
      mergedProse = ourProse === "" ? theirProse : ourProse;
      rules.push("one-sided-prose");
    } else if (ourKey === theirKey) {
      // Same words, different sigils. Adopt the side that renders as links —
      // more citations resolve in Obsidian, and no word changes either way.
      // Ties break on length and then on the text itself, so which vault ran
      // the exchange cannot change the bytes that come out.
      const ourRank: [number, number, string] = [wikilinkCount(ourProse), ourProse.length, ourProse];
      const theirRank: [number, number, string] = [wikilinkCount(theirProse), theirProse.length, theirProse];
      const oursWins =
        ourRank[0] !== theirRank[0]
          ? ourRank[0] > theirRank[0]
          : ourRank[1] !== theirRank[1]
            ? ourRank[1] > theirRank[1]
            : ourRank[2] <= theirRank[2];
      mergedProse = oursWins ? ourProse : theirProse;
      rules.push("citation-style-normalised");
    } else if (ourKey.includes(theirKey) || theirKey.includes(ourKey)) {
      // One peer's body is the other's with more written into it — the common
      // shape when both worked from a copy of the same node. The longer text
      // contains every word of the shorter, so adopting it loses nothing.
      mergedProse = ourKey.length >= theirKey.length ? ourProse : theirProse;
      rules.push("prose-superset-wins");
    } else {
      reasons.push("prose-diverged");
      detail.push(`prose: ${ourProse.length} chars ours / ${theirProse.length} theirs, neither contains the other`);
    }
  }

  // Frontmatter this schema does not know about. Carried through untouched when
  // the sides agree; never guessed at when they do not.
  const extrasA = extraFields(ours);
  const extrasB = extraFields(theirs);
  const extras: Record<string, unknown> = { ...extrasB, ...extrasA };
  for (const key of new Set([...Object.keys(extrasA), ...Object.keys(extrasB)])) {
    const va = extrasA[key];
    const vb = extrasB[key];
    if (va === undefined || vb === undefined) continue;
    if (JSON.stringify(va) === JSON.stringify(vb)) continue;
    reasons.push("unknown-field-diverged");
    detail.push(`${key}: ours ${brief(String(va))} / theirs ${brief(String(vb))}`);
  }

  if (reasons.length > 0) return { settleable: false, reasons, detail };

  if (history.length > 0) {
    const block = mergedLedgers.get(HISTORY_HEADING) ?? [];
    mergedLedgers.set(HISTORY_HEADING, [...block, ...history]);
    if (block.length === 0) rules.push("ledger-union");
  }

  const bodyParts = [mergedProse];
  for (const heading of RESERVED_HEADINGS) {
    const block = mergedLedgers.get(heading);
    if (!block) continue;
    bodyParts.push([heading, ...block].join("\n"));
  }
  merged.body = bodyParts.filter((p) => p.trim() !== "").join("\n\n");

  // A settlement nobody can name is a resolution nobody can review, so the case
  // where the two sides differ in bytes alone gets a name of its own rather than
  // an empty list.
  const named = rules.length > 0 ? [...new Set(rules)] : (["identical-after-parsing"] as SettlementRule[]);
  return { settleable: true, rules: named, resolved: merged, extraFrontmatter: extras };
}

// ---------------------------------------------------------------------------
// The exchange itself
// ---------------------------------------------------------------------------

export interface OutOfScopeFile {
  file: string;
  why: string;
}

export interface MergeCensus {
  /** Where the dry run happened. Left conflicted on disk so a person can open it. */
  scratchDir: string;
  /** Files the peer brought that the local vault did not have — pure gain, no collision. */
  incoming: number;
  /** Files that merged without git stopping. */
  clean: number;
  /** Every path git reported as unmerged, in the order git reported it. */
  conflicted: string[];
  settled: Settlement[];
  judgement: JudgementCall[];
  /**
   * Conflicts on paths the exchange does not carry. Reported rather than
   * silently dropped: a census that quietly narrows its subject is the failure
   * mode "a sweep that cannot read its subject reports a clean result" names.
   */
  outOfScope: OutOfScopeFile[];
}

/**
 * Paths a peer exchange does not carry, by default.
 *
 * These are the local instance's own run state — what IT ingested, what IT
 * spent, which sweeps IT ran — plus the editor and plugin configuration of the
 * machine the vault sits on. None of it is tree knowledge, none of it means
 * anything in another operator's vault, and all of it collides on every
 * exchange because both sides are always writing to it. Excluding them is a
 * choice that lowers the count this census reports, so they are counted and
 * named in {@link MergeCensus.outOfScope} rather than skipped.
 */
export const DEFAULT_NOT_EXCHANGED: readonly string[] = Object.freeze([
  ".ost-agent/",
  ".obsidian/",
  ".claude/",
]);

export interface PeerMergeOptions {
  /** The operator's own vault. Read only — nothing here writes to it. */
  localDir: string;
  /** The peer's vault, as a path a `git fetch` can reach (a clone, a mount, a bare repo). */
  peerDir: string;
  /** An empty or non-existent directory to run the dry merge in. */
  scratchDir: string;
  localRef?: string;
  peerRef?: string;
  /** Path prefixes the exchange does not carry. Defaults to {@link DEFAULT_NOT_EXCHANGED}. */
  notExchanged?: readonly string[];
  /** Stamped on any `## History` line a rule writes. Passed in so a census is reproducible. */
  at: string;
  peerLabel?: string;
}

function git(dir: string): SimpleGit {
  return simpleGit(path.resolve(dir));
}

/** `git show :<stage>:<path>`, or null when that stage has no entry (a delete/modify collision). */
async function stage(g: SimpleGit, n: 2 | 3, file: string): Promise<string | null> {
  try {
    return await g.raw(["show", `:${n}:${file}`]);
  } catch {
    return null;
  }
}

/**
 * Run the exchange as a real merge and count what it costs.
 *
 * Neither vault is touched. Both are read through `git fetch`, into a scratch
 * repository this function creates, and the merge happens there with
 * `--no-commit`: nothing is committed even when it is clean, so there is no
 * outcome of this call that leaves a vault different from how it was found.
 * `--allow-unrelated-histories` is unconditional because the case this exists
 * for — two operators who each ran `ost-agent init` — has no common ancestor at
 * all; it is a no-op when the two do share one.
 *
 * The scratch repository is left exactly as git left it, conflict markers and
 * all. Deleting it is the caller's business, and the path comes back in the
 * census so a person can go and read the collisions this call only counted.
 */
export async function censusPeerMerge(opts: PeerMergeOptions): Promise<MergeCensus> {
  const scratchDir = path.resolve(opts.scratchDir);
  fs.mkdirSync(scratchDir, { recursive: true });
  const g = git(scratchDir);
  await g.init();
  await g.addConfig("user.email", "ost-agent@localhost");
  await g.addConfig("user.name", "OST-Agent");

  await g.raw(["fetch", "--no-tags", path.resolve(opts.localDir), opts.localRef ?? "HEAD"]);
  const localSha = (await g.revparse(["FETCH_HEAD"])).trim();
  await g.raw(["checkout", "-B", "local", localSha]);

  await g.raw(["fetch", "--no-tags", path.resolve(opts.peerDir), opts.peerRef ?? "HEAD"]);
  const peerSha = (await g.revparse(["FETCH_HEAD"])).trim();

  await g
    .raw(["merge", "--allow-unrelated-histories", "--no-commit", "--no-ff", peerSha])
    // git exits non-zero when it stops on a conflict; that is the normal answer
    // here, not a failure, and the index is what says which paths stopped it.
    .catch(() => "");

  const unmerged = (await g.raw(["diff", "--name-only", "--diff-filter=U", "-z"]))
    .split("\0")
    .filter((f) => f.length > 0);
  const conflictedSet = new Set(unmerged);

  const staged = (await g.raw(["diff", "--cached", "--name-only", "--diff-filter=A", "-z", localSha]))
    .split("\0")
    .filter((f) => f.length > 0 && !conflictedSet.has(f));
  const changed = (await g.raw(["diff", "--cached", "--name-only", "-z", localSha]))
    .split("\0")
    .filter((f) => f.length > 0 && !conflictedSet.has(f));

  const notExchanged = opts.notExchanged ?? DEFAULT_NOT_EXCHANGED;
  const census: MergeCensus = {
    scratchDir,
    incoming: staged.length,
    clean: changed.length,
    conflicted: unmerged,
    settled: [],
    judgement: [],
    outOfScope: [],
  };

  for (const file of unmerged) {
    const prefix = notExchanged.find((p) => file.startsWith(p));
    if (prefix) {
      census.outOfScope.push({ file, why: `under ${prefix} — local run state, not tree knowledge` });
      continue;
    }
    if (!file.endsWith(".md")) {
      census.judgement.push({ file, reasons: ["not-a-node"], detail: ["not a Markdown node; no rule covers it"] });
      continue;
    }
    const ours = await stage(g, 2, file);
    const theirs = await stage(g, 3, file);
    if (ours === null || theirs === null) {
      census.judgement.push({
        file,
        reasons: ["delete-modify"],
        detail: [`one side has no content for this path (${ours === null ? "ours" : "theirs"} absent)`],
      });
      continue;
    }
    const title = path.basename(file, ".md");
    const verdict = settleNodeCollision(title, ours, theirs, { at: opts.at, peerLabel: opts.peerLabel });
    if (verdict.settleable)
      census.settled.push({
        file,
        rules: verdict.rules,
        resolved: verdict.resolved,
        extraFrontmatter: verdict.extraFrontmatter,
      });
    else census.judgement.push({ file, reasons: verdict.reasons, detail: verdict.detail });
  }

  return census;
}

/**
 * The census as a person reads it — the judgement calls first and in full,
 * because they are the cost, and everything else as counts.
 */
export function formatMergeCensus(census: MergeCensus): string {
  const lines: string[] = [];
  lines.push(`Peer exchange dry run — ${census.conflicted.length} conflict(s) from the merge`);
  lines.push("");
  lines.push(`  ${census.incoming} file(s) the peer brought that this vault did not have`);
  lines.push(`  ${census.clean} file(s) merged without git stopping`);
  lines.push(`  ${census.settled.length} conflict(s) a stated rule settles`);
  lines.push(`  ${census.outOfScope.length} conflict(s) on paths the exchange does not carry`);
  lines.push(`  ${census.judgement.length} conflict(s) a person has to settle`);

  if (census.judgement.length > 0) {
    lines.push("");
    lines.push("Needs a person:");
    for (const j of census.judgement) {
      lines.push(`  ${j.file}  [${j.reasons.join(", ")}]`);
      for (const d of j.detail) lines.push(`      ${d}`);
    }
  }

  if (census.settled.length > 0) {
    const byRule = new Map<SettlementRule, number>();
    for (const s of census.settled) for (const r of s.rules) byRule.set(r, (byRule.get(r) ?? 0) + 1);
    lines.push("");
    lines.push("Settled by rule:");
    for (const [rule, n] of [...byRule].sort((x, y) => y[1] - x[1])) lines.push(`  ${n}  ${rule}`);
  }

  if (census.outOfScope.length > 0) {
    lines.push("");
    lines.push("Not carried by the exchange (counted, not settled):");
    for (const o of census.outOfScope) lines.push(`  ${o.file} — ${o.why}`);
  }

  lines.push("");
  lines.push(`Scratch merge left in place, conflicts and all: ${census.scratchDir}`);
  return lines.join("\n");
}
