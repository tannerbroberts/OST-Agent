/**
 * Who wrote the prose in a node — the marker that distinguishes an agent's
 * words from a person's.
 *
 * Before this field, a human's node and the agent's were the same bytes. The
 * only provenance marker on a node was `#unvalidated`, which says something
 * about the node's *standing*, not about its *author* — and it is stamped on
 * every node the agent creates, so in this vault it is true of 211 of 219
 * nodes. A marker true of 97% of what a reader sees is not discriminating
 * anything, which is precisely the worry the assumption beneath this records.
 * The narrower claim here is the precondition for that worry even being
 * askable: before you can ask whether a reader still *reads* the marker, the
 * marker has to *mean* something, and today none does.
 *
 * **The vocabulary is a lattice, not a label, and that is the whole design.**
 *
 *              mixed          ← both kinds of writer have authored text here
 *             /     \
 *       machine     human
 *             \     /
 *            (absent)         ← nobody recorded anything; NOT a verdict
 *
 * Every write folds its own writer into whatever the node already carried, with
 * {@link foldAuthorship}, and the fold only ever moves UP. That is what makes
 * the marker survive an edit instead of being reset to whoever touched the file
 * last: an agent edit on a human's node does not relabel it `machine` (the
 * human's sentences are still in there), and a human edit on the agent's node
 * does not leave it saying `machine` either (it now contains a person's words).
 * Both land on `mixed`, which is the only honest reading of a node two kinds of
 * author have written in.
 *
 * **Absent is unknown, never `human`.** Every node written before this field
 * existed carries nothing, and so does a file a person hand-wrote into the vault
 * directory — the two are indistinguishable from here, because nothing watched
 * either write. The census counts them apart as `unlabelled` rather than
 * guessing, exactly as {@link ./instrument.ts#sightCensus} does for an
 * instrument written before sight was recorded. A guess in this field would be
 * the one failure that matters: `human` is the flattering value, the one that
 * says "trust this the way you trust a person", and the party that benefits
 * from it being large is the agent. So it is never inferred and never accepted
 * from the caller — {@link Writer} is a literal at each call site inside
 * `Vault`, and `human` appears only on the writes that carry a named person's
 * attribution (`record-result`, `promote`, `retract`), which the CLI alone can
 * reach and no allowlisted tool can.
 */
import type { OstNode } from "./node.js";

/** What a node's prose is: one kind of author, or both. */
export type Authorship = "machine" | "human" | "mixed";

/**
 * A single writer's own kind — what a write contributes, as opposed to what a
 * node accumulates. `mixed` is not a writer: nothing writes as both at once.
 */
export type Writer = "machine" | "human";

/** Type guard — an unrecognised value is dropped, never carried, like `lane` and `sight`. */
export function isAuthorship(value: unknown): value is Authorship {
  return value === "machine" || value === "human" || value === "mixed";
}

/**
 * The join on the lattice above: everything either side asserted, kept.
 *
 * Deterministic, symmetric (`join(a, b) === join(b, a)`) and lossless, which is
 * what {@link ./vault-merge.ts} requires of a settlement rule — two peers whose
 * copies of a node were written by different hands merge to a node written by
 * both, and neither side's assertion is discarded to get there.
 */
export function joinAuthorship(a: Authorship | undefined, b: Authorship | undefined): Authorship | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return a === b ? a : "mixed";
}

/**
 * Fold one write's author into what the node already carried.
 *
 * The only way the field is ever set. Note what it will not do: it never
 * *replaces* a recorded value with the current writer's, so no single edit can
 * relabel a node as its own author's work.
 */
export function foldAuthorship(prev: Authorship | undefined, writer: Writer): Authorship {
  return joinAuthorship(prev, writer) as Authorship;
}

/** Does this node carry prose a person wrote? `mixed` counts — some of it is theirs. */
export function hasHumanProse(node: OstNode): boolean {
  return node.authorship === "human" || node.authorship === "mixed";
}

export interface AuthorshipCensus {
  /** Nodes considered. */
  total: number;
  /** Nodes whose prose is the agent's alone. */
  machine: number;
  /** Nodes whose prose is a person's alone. */
  human: number;
  /** Nodes both have written in. */
  mixed: number;
  /** Nodes nobody labelled — written before the field existed, or by hand. */
  unlabelled: number;
  /** `human + mixed` — nodes carrying any human-written prose at all. */
  humanWritten: number;
}

/**
 * How much of a tree a person actually wrote.
 *
 * Reported over the whole tree rather than over the labelled subset on purpose:
 * a share computed against `labelled` would climb as the unlabelled backlog was
 * touched, which is movement in the denominator dressed up as movement in the
 * thing. The renderer states `unlabelled` in the same breath so the reader can
 * see how much of the tree the number is silent about.
 */
export function authorshipCensus(tree: readonly OstNode[]): AuthorshipCensus {
  const machine = tree.filter((n) => n.authorship === "machine").length;
  const human = tree.filter((n) => n.authorship === "human").length;
  const mixed = tree.filter((n) => n.authorship === "mixed").length;
  return {
    total: tree.length,
    machine,
    human,
    mixed,
    unlabelled: tree.length - machine - human - mixed,
    humanWritten: human + mixed,
  };
}
