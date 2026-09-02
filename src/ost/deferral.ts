/**
 * What killed the ideas this tree has already abandoned, grouped so the shape of
 * the distribution is visible.
 *
 * The solution this serves — "Test the assumption that killed the last comparable
 * idea, before anything else" — proposes inferring a solution's riskiest
 * assumption from the vault's own history of deaths instead of from anyone's
 * judgement. That route needs a prior, and a prior needs the deaths to CONCENTRATE:
 * a vault that has abandoned three ideas on the same viability question has told
 * you what its risky assumptions look like, and a vault where every death has its
 * own reason has told you nothing. So the number that decides the approach is not
 * how many nodes were abandoned — it is how the causes pile up.
 *
 * Nothing in this repository grouped deferral causes before this file. Three
 * different mechanisms take a node out of the live tree and each records its
 * reason somewhere else, which is most of why:
 *
 *   - **`status: deferred`** — the reason is prose in the node's own `## History`,
 *     on the entry that recorded the transition (`status: … → deferred — why`);
 *   - **`## Retraction`** — the reason is the retracting human's list entry, which
 *     {@link ../ost/census.ts retractionReason} already renders;
 *   - **`archive/`** — a `git mv` at a shell, which records no reason at all.
 *
 * All three are read here, and the third is *counted and named as unclassifiable*
 * rather than dropped, on `formatCensus`'s rule: a retirement with no recorded
 * cause is a hole in exactly the distribution this census exists to describe, and
 * silently omitting it would make the remaining causes look more concentrated than
 * the record supports.
 *
 * **What this census cannot do, stated up front.** A cause is read off words
 * somebody typed, so it is the cause that was WRITTEN DOWN, which is not always
 * the cause that operated. And the vocabulary in {@link DEFERRAL_CAUSES} was
 * derived from the four retirements this vault had when the file was written —
 * four texts is not a sample a classifier generalises from. Both limits are why
 * every row carries {@link DeferredNode.basis}: the sentence the verdict was read
 * off, so a human can check the classification instead of believing it. This is
 * `stranded.ts`'s discipline and the same reason it reports `citedBy`.
 */
import { ARCHIVE_DIRNAME, isRetiredNode, type TreeCensus } from "./census.js";
import { HISTORY_HEADING, entriesUnder } from "./headings.js";
import type { Layer, OstNode } from "./node.js";
import { classifySubject, type Blindness, type SweepSubject } from "./sweep.js";
import { Vault } from "./vault.js";

/**
 * The closed vocabulary of causes, in the order the classifier tries them.
 *
 * **The order is load-bearing and every step of it was forced by a real entry in
 * `ost-agent-meta`**, which is worth recording because the ordering is the part
 * that looks arbitrary and is not:
 *
 *   - `refuted` before `decided`, because the entry that deferred "Ask the open
 *     question first…" on the evidence ends "a human should still decide whether
 *     to close PR #130" — a `decided` match on the word *decide* would take a
 *     falsification and file it as a preference.
 *   - `decided` before `duplicate`, because the entry that deferred "I don't know
 *     what unit of this anyone would pay for" by founder decision explains that
 *     deferral "retires it from the duplicate scan" — a `duplicate` match on the
 *     name of a scan would take a closed question and file it as a merge.
 *
 * Two ordering accidents in a sample of four is the measurement, not a defect to
 * tune away: free prose does not carry its own category, and a keyword pass over
 * it is a cheap reading that has to be checkable. Hence `unclassified`, which is
 * a member of the vocabulary rather than a silent fallthrough.
 */
export const DEFERRAL_CAUSES = ["superseded", "refuted", "decided", "duplicate", "unclassified"] as const;

export type DeferralCause = (typeof DEFERRAL_CAUSES)[number];

/**
 * The patterns, in `DEFERRAL_CAUSES` order. `unclassified` has none — it is what
 * is left, and it is reported rather than hidden.
 *
 * Deliberately narrow. A pattern broad enough to catch every phrasing of "we
 * stopped believing this" is also broad enough to catch a sentence that merely
 * mentions belief, and a census whose buckets are wrong in a way nobody can see
 * is worse than one with a large `unclassified` bucket that says so.
 */
const CAUSE_PATTERNS: Readonly<Partial<Record<DeferralCause, RegExp>>> = {
  // "Deferred means superseded by those two, not abandoned" — a node split into
  // successors that carry its design forward.
  superseded: /\bsupersede|\bsplit\b|\breplaced by\b|\bsuccessor/i,
  // "Deferring per the evidence"; "this designed-to-fail assertion". A run
  // happened and it went against the node.
  refuted: /\brefut|\bfalsif|\bdisprov|\bdesigned-to-fail\b|\bper the evidence\b/i,
  // "ANSWERED BY FOUNDER DECISION"; "the nearest status to 'closed by decision'".
  // Nobody measured anything; somebody with the mandate said no.
  decided: /\bdecision\b|\bdecided\b|\bfounder\b|\bout of scope\b|\bwon't do\b/i,
  // "self-flagged near-duplicate of sibling"; "Human-authorized merge".
  duplicate: /\bduplicate\b|\bmerged? into\b|\bmerge\b|\bredundant\b/i,
};

/**
 * A recorded reason on one line, flattened but NOT clamped.
 *
 * `quotableSource` was the obvious reuse and is wrong here, and the reason is
 * worth keeping: its 200-character limit is sized for a census row that names a
 * file, and the four real entries this census reads all put the words the verdict
 * turns on past it. Measured — the entry that deferred "Ask the open question
 * first…" reaches `designed-to-fail`, the phrase its `refuted` classification is
 * read off, at character 268. A basis clipped before its own evidence is a
 * citation that cannot be checked, which is the only thing this field is for.
 */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]+", "g");

function flattenBasis(text: string): string {
  return text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** How a node left the live tree. Three mechanisms, three places the reason lives. */
export type RetirementRoute = "status" | "retraction" | "archive";

export interface DeferredNode {
  /** The vault it came from, so a multi-vault census stays attributable. */
  vault: string;
  title: string;
  /**
   * `Unknown` for an archived or retracted node: those are withheld from the tree
   * at the read and reach this census as a filename and a reason, with no
   * frontmatter behind them.
   */
  layer: Layer;
  route: RetirementRoute;
  cause: DeferralCause;
  /**
   * The recorded words the cause was read off, flattened to one line and carried
   * whole — see {@link flattenBasis} for why it is not clamped. Empty when nothing
   * recorded a reason, which is itself the finding for every `archive` row.
   */
  basis: string;
}

export interface CauseTally {
  cause: DeferralCause;
  count: number;
}

/**
 * Whether the threshold this census answers is met, and — separately — whether it
 * could have come out a failure at all.
 *
 * The threshold is the assumption test's own: *at least 15 abandoned solutions
 * exist, and the top 3 causes account for half of them.* Both clauses are counts,
 * so both are computed here rather than judged. What is NOT judged here is the
 * assumption: recording a result against a node is a human's `ost-agent result`,
 * and this type exists to make that recording cheap and checkable, not to
 * pre-empt it.
 */
export interface DeferralVerdict {
  /** Retirements in scope — the layers the threshold names, across every vault. */
  sample: number;
  sampleRequired: number;
  sampleHolds: boolean;
  /** Retirements in the three largest causes, over `sample`. 0 when `sample` is 0. */
  topThree: number;
  topThreeShare: number;
  shareRequired: number;
  shareHolds: boolean;
  /** Both clauses. The threshold as written. */
  holds: boolean;
  /**
   * The top-three share the FLATTEST possible distribution over this vocabulary
   * would produce at this sample size — the most refuting reading the data could
   * have taken.
   *
   * Reported because when it already clears `shareRequired`, the concentration
   * clause cannot come out a failure, and a clause that cannot fail is not
   * measuring anything. With five causes and a sample of fifteen the flattest
   * distribution is 3/3/3/3/3, whose top three is 60% — so the clause reads
   * SUPPORTED off a vault whose every death had its own reason. That is not a
   * reason to move the bar, which is the human's to set; it is a reason for the
   * instrument to say out loud which half of the threshold is doing the work.
   */
  flattestTopThreeShare: number;
  /** `flattestTopThreeShare < shareRequired` — could the concentration clause have failed? */
  concentrationDiscriminates: boolean;
}

export interface VaultDeferralCensus {
  vault: string;
  /** Node-shaped files this census could read a retirement route off. The denominator. */
  examined: number;
  subject: SweepSubject;
  /** Node files present that could not be read or classified, and are absent from `examined`. */
  unreadable: string[];
  retired: DeferredNode[];
}

export interface DeferralCensus {
  /** Per-vault, in the order the vaults were given. */
  vaults: VaultDeferralCensus[];
  examined: number;
  /** Every retirement found, every layer, in vault order. */
  retired: DeferredNode[];
  /** The subset the threshold is taken over — see {@link DeferralOptions.layers}. */
  inScope: DeferredNode[];
  /** Causes over `inScope`, descending by count then by vocabulary order. */
  tally: CauseTally[];
  subject: SweepSubject;
  blindness: Blindness;
  verdict: DeferralVerdict;
}

export interface DeferralOptions {
  /**
   * Which layers the threshold's sample is drawn from. Defaults to `Solution`,
   * because the threshold says "abandoned **solutions**" — and the difference is
   * not academic: on `ost-agent-meta` at the time of writing, four nodes are
   * deferred and one of them is a Solution.
   *
   * Rows outside the scope are still censused and still reported; they are simply
   * not in the count the threshold is judged on.
   */
  layers?: readonly Layer[];
  /** The sample-size clause. Defaults to the assumption test's 15. */
  sampleRequired?: number;
  /** The concentration clause, as a fraction. Defaults to the assumption test's 0.5. */
  shareRequired?: number;
}

const DEFAULT_LAYERS: readonly Layer[] = ["Solution"];
const DEFAULT_SAMPLE_REQUIRED = 15;
const DEFAULT_SHARE_REQUIRED = 0.5;

/** How many causes the top-three clause sums. Named so the arithmetic below reads. */
const TOP_N = 3;

/**
 * Read a cause out of recorded prose.
 *
 * Exported because the ordering it encodes is the part most likely to be wrong,
 * and a rule that can only be exercised through a filesystem census is a rule
 * nobody re-checks when the vocabulary grows.
 */
export function classifyCause(basis: string): DeferralCause {
  if (!basis.trim()) return "unclassified";
  for (const cause of DEFERRAL_CAUSES) {
    const pattern = CAUSE_PATTERNS[cause];
    if (pattern?.test(basis)) return cause;
  }
  return "unclassified";
}

/**
 * The `## History` entry that recorded this node's transition to a retired status,
 * or `""`.
 *
 * The last matching entry wins. History is append-only and a node can be deferred,
 * restored and deferred again — "reverse by resetting status" is the instruction
 * two of this vault's own retirements carry — so the transition that is still in
 * force is the most recent one, never the first.
 */
export function deferralHistoryEntry(node: { body?: string }): string {
  const entries = entriesUnder(node.body ?? "", HISTORY_HEADING);
  // `status: unvalidated → deferred — why`, `status: (none) → deferred — why`.
  // The arrow is what makes this a transition record rather than any line that
  // happens to mention the word.
  const transitions = entries.filter((e) => /\bstatus:.*(?:→|->)\s*deferred\b/i.test(e));
  return transitions.length ? transitions[transitions.length - 1] : "";
}

/** One retirement, classified, with the words it was classified from. */
function fromStatus(vault: string, node: OstNode): DeferredNode {
  const entry = deferralHistoryEntry(node);
  return {
    vault,
    title: node.title,
    layer: node.layer,
    route: "status",
    cause: classifyCause(entry),
    basis: flattenBasis(entry),
  };
}

/**
 * `archive/Old idea.md` → `Old idea`.
 *
 * An archived file reaches the census as the path the walk named it by, prefix
 * and all, because that is what `TreeCensus.retired` carries. The prefix is not
 * part of the node's title, and leaving it on would make the same node under two
 * retirement routes look like two different nodes.
 */
function titleOfDrop(file: string): string {
  return file.replace(new RegExp(`^${ARCHIVE_DIRNAME}/`), "").replace(/\.md$/i, "");
}

/**
 * The census over one already-read tree, with no filesystem in it.
 *
 * Split out from {@link deferralCensus} on `strandedEvidence`'s precedent, so the
 * classification can be tested against arrays rather than against vaults on disk.
 */
export function deferredCauses(vault: string, census: TreeCensus): VaultDeferralCensus {
  const retired: DeferredNode[] = census.nodes.filter(isRetiredNode).map((n) => fromStatus(vault, n));

  // Archived and retracted nodes never reach `census.nodes` — they are withheld at
  // the read, by an unforgeable mechanism, and arrive here as a filename and a
  // reason. `retractionReason` prefixes the human's words with `retracted — `;
  // an archived file's reason names the directory and no cause, which classifies
  // as `unclassified` and is exactly the truth about it.
  for (const drop of census.retired) {
    const isRetraction = /^retracted\b/i.test(drop.reason);
    retired.push({
      vault,
      title: titleOfDrop(drop.file),
      layer: "Unknown",
      route: isRetraction ? "retraction" : "archive",
      cause: isRetraction ? classifyCause(drop.reason) : "unclassified",
      basis: isRetraction ? flattenBasis(drop.reason) : "",
    });
  }

  // What this census could read a route off, against what was node-shaped and
  // there to be read. A file that would not parse, or whose `type:` this reader
  // does not recognise, could be a deferred solution nobody here can see — which
  // is a shortfall in the very distribution being counted, not an unrelated
  // hygiene problem.
  const read = census.nodes.length + census.retired.length;
  const unreadable = [...census.unreadable.map((d) => d.file), ...census.quarantined.map((q) => q.file)];
  return {
    vault,
    examined: read,
    subject: { offered: read + unreadable.length, read },
    unreadable,
    retired,
  };
}

/**
 * The top-three share of the flattest distribution `sample` retirements could take
 * over `causes` buckets — the most refuting reading the data could have produced.
 *
 * Spreading n over k buckets as evenly as possible gives `n % k` buckets of
 * `⌈n/k⌉` and the rest `⌊n/k⌋`; the three largest are what the clause sums.
 */
export function flattestTopThreeShare(sample: number, causes: number = DEFERRAL_CAUSES.length): number {
  if (sample <= 0 || causes <= 0) return 0;
  const base = Math.floor(sample / causes);
  const remainder = sample % causes;
  let top = 0;
  for (let i = 0; i < Math.min(TOP_N, causes); i++) top += i < remainder ? base + 1 : base;
  return Math.min(top, sample) / sample;
}

/** Group, count and judge. Pure, so the arithmetic is testable without a vault. */
export function tallyCauses(inScope: readonly DeferredNode[], opts: DeferralOptions = {}): {
  tally: CauseTally[];
  verdict: DeferralVerdict;
} {
  const sampleRequired = opts.sampleRequired ?? DEFAULT_SAMPLE_REQUIRED;
  const shareRequired = opts.shareRequired ?? DEFAULT_SHARE_REQUIRED;

  const counts = new Map<DeferralCause, number>();
  for (const cause of DEFERRAL_CAUSES) counts.set(cause, 0);
  for (const row of inScope) counts.set(row.cause, (counts.get(row.cause) ?? 0) + 1);

  // Every cause is carried, including the zeroes. A tally that lists only what
  // occurred cannot show that a vocabulary is wider than the deaths in it, and
  // the width of the vocabulary is what decides whether the clause discriminates.
  const tally: CauseTally[] = DEFERRAL_CAUSES.map((cause) => ({ cause, count: counts.get(cause) ?? 0 })).sort(
    (a, b) => b.count - a.count || DEFERRAL_CAUSES.indexOf(a.cause) - DEFERRAL_CAUSES.indexOf(b.cause),
  );

  const sample = inScope.length;
  const topThree = tally.slice(0, TOP_N).reduce((n, t) => n + t.count, 0);
  const topThreeShare = sample > 0 ? topThree / sample : 0;
  const sampleHolds = sample >= sampleRequired;
  // A share taken over an empty sample is 0, and 0 does not clear the bar. An
  // empty vault must not report a met concentration clause on the strength of
  // dividing by nothing.
  const shareHolds = sample > 0 && topThreeShare >= shareRequired;
  const flattest = flattestTopThreeShare(sampleRequired);

  return {
    tally,
    verdict: {
      sample,
      sampleRequired,
      sampleHolds,
      topThree,
      topThreeShare,
      shareRequired,
      shareHolds,
      holds: sampleHolds && shareHolds,
      flattestTopThreeShare: flattest,
      concentrationDiscriminates: flattest < shareRequired,
    },
  };
}

/**
 * Take the census across one or more vaults.
 *
 * Plural for the reason the assumption test's design is plural — "every deferred
 * or abandoned solution in this vault **and both its siblings**". One vault's
 * deaths are one product's habits; the same cause recurring in a tree that never
 * heard of the first is the part that would be evidence for the general claim.
 */
export function deferralCensus(dirs: readonly string[], opts: DeferralOptions = {}): DeferralCensus {
  const vaults = dirs.map((dir) => deferredCauses(dir, new Vault(dir, { create: false }).readTreeCensus()));
  return summariseDeferrals(vaults, opts);
}

/** The cross-vault roll-up, over per-vault censuses that have already been read. */
export function summariseDeferrals(
  vaults: readonly VaultDeferralCensus[],
  opts: DeferralOptions = {},
): DeferralCensus {
  const layers = new Set(opts.layers ?? DEFAULT_LAYERS);
  const retired = vaults.flatMap((v) => v.retired);
  const inScope = retired.filter((r) => layers.has(r.layer));
  const subject: SweepSubject = {
    offered: vaults.reduce((n, v) => n + v.subject.offered, 0),
    read: vaults.reduce((n, v) => n + v.subject.read, 0),
  };
  const { tally, verdict } = tallyCauses(inScope, opts);
  return {
    vaults: [...vaults],
    examined: vaults.reduce((n, v) => n + v.examined, 0),
    retired,
    inScope,
    tally,
    subject,
    blindness: classifySubject(subject),
    verdict,
  };
}

/** `0.6` → `60%`, to the nearest whole point. Shares are read, not computed on. */
function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: the verdict first, then the distribution it
 * was taken over, then every row with the words it was classified from.
 *
 * Except when it was taken over nothing, which is printed as a failure on
 * `formatStrandedCensus`'s rule — "0 retirements of 0 nodes" is true, reads as a
 * finished measurement, and is what a mistyped path produces.
 */
export function formatDeferralCensus(census: DeferralCensus, opts: DeferralOptions = {}): string {
  const layers = opts.layers ?? DEFAULT_LAYERS;
  const v = census.verdict;
  const lines: string[] = [];

  if (census.blindness === "totally-blind") {
    lines.push(
      `Deferral causes: BLIND — read 0 of ${census.subject.offered} node(s) across ` +
        `${census.vaults.length} vault(s). This is not a clean census; nothing was examined.`,
    );
    for (const vault of census.vaults) {
      lines.push(`  ${vault.vault}: read ${vault.subject.read} of ${vault.subject.offered} offered`);
    }
    lines.push("");
    lines.push("A sweep with an empty subject is a failure, not a pass. Check that each path above is a vault.");
    return lines.join("\n");
  }

  lines.push(
    `Deferral causes: ${v.holds ? "THRESHOLD MET" : "THRESHOLD NOT MET"} — ` +
      `${v.sample} retired ${layers.join("/")} node(s) of a required ${v.sampleRequired} ` +
      `(${v.sampleHolds ? "met" : "short by " + (v.sampleRequired - v.sample)}), ` +
      `top ${TOP_N} cause(s) ${pct(v.topThreeShare)} of a required ${pct(v.shareRequired)} ` +
      `(${v.shareHolds ? "met" : "not met"}).`,
  );
  lines.push(
    `  taken over ${census.examined} node(s) across ${census.vaults.length} vault(s); ` +
      `${census.retired.length} retirement(s) found in all, ${v.sample} in scope.`,
  );
  for (const vault of census.vaults) {
    lines.push(`  ${vault.vault}: ${vault.retired.length} retired of ${vault.examined} examined`);
  }
  if (census.blindness === "partly-blind") {
    const shortfall = census.subject.offered - census.subject.read;
    lines.push(
      `  ⚠ partly blind: ${shortfall} node file(s) present could not be read or classified, so every count ` +
        `above is over ${census.subject.read} of ${census.subject.offered}. A file this reader cannot parse ` +
        `may be a retirement it cannot count.`,
    );
    for (const vault of census.vaults) {
      for (const name of vault.unreadable) lines.push(`    unreadable: ${vault.vault}/${name}`);
    }
  }

  lines.push("");
  lines.push(`Causes over the ${v.sample} node(s) in scope:`);
  for (const t of census.tally) lines.push(`  ${t.cause.padEnd(13)} ${t.count}`);

  // The clause that cannot fail, said in the same breath as the clause's own
  // result. A reader who sees only "top 3: 100%" learns the opposite of the truth
  // when the vocabulary has three causes in it.
  lines.push("");
  if (!v.concentrationDiscriminates) {
    lines.push(
      `⚠ The concentration clause cannot come out a failure at this bar. Spread as evenly as ` +
        `${DEFERRAL_CAUSES.length} cause(s) allow, a sample of ${v.sampleRequired} still puts ` +
        `${pct(v.flattestTopThreeShare)} in its top ${TOP_N} — above the ${pct(v.shareRequired)} required. ` +
        `A vault whose every death had its own reason would read as concentrated. The sample-size clause ` +
        `is carrying this threshold on its own; only a human may move the bar or widen the vocabulary.`,
    );
  } else {
    lines.push(
      `The concentration clause discriminates: the flattest distribution ${DEFERRAL_CAUSES.length} cause(s) ` +
        `allow puts ${pct(v.flattestTopThreeShare)} in its top ${TOP_N}, below the ${pct(v.shareRequired)} required.`,
    );
  }

  lines.push("");
  lines.push(`Every retirement found (${census.retired.length}), with the words its cause was read off:`);
  if (!census.retired.length) lines.push("  (none)");
  for (const row of census.retired) {
    const scope = layers.includes(row.layer) ? "" : " [out of scope]";
    lines.push(`  ${row.cause} — ${row.title} (${row.layer}, ${row.route})${scope}`);
    lines.push(`    ${row.basis || "no reason recorded"}`);
  }

  lines.push("");
  lines.push(
    "A cause here is the cause somebody WROTE DOWN, matched by keyword against a vocabulary fitted to " +
      "this vault's first retirements — not the cause that operated. Read the basis line under each row " +
      "before believing any bucket, and record the verdict with `ost-agent result`, which is a human's call.",
  );
  return lines.join("\n");
}
