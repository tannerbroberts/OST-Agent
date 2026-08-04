/**
 * The stranded-evidence census: what is in the ledger that no node claims, and
 * which half of it a new node type would actually be for.
 *
 * Mapped-ness has exactly one derivation in this product (`mcp/next-work.ts`):
 * an evidence record is mapped iff some node names its id in frontmatter
 * `source`. `source` is settable only at node creation, so an item that grounds
 * a node written before the item arrived can never become mapped, however
 * thoroughly a pass has read it. Those items are reported as outstanding on
 * every future sweep with no action that clears them.
 *
 * That backlog is the case for two different fixes, and the fixes are not the
 * same size:
 *
 *   - an **appendable `source`**, which clears any item some node would cite;
 *   - a **new node layer** for evidence that is true and useful and is not a
 *     customer need, which is the only thing that houses an item no node in the
 *     tree would cite at all.
 *
 * So the number that decides between them is not "how many are stranded" — it is
 * the split. This module computes it, and the discriminator is deliberately the
 * cheapest observable one: **does any node's prose already quote this id?** A
 * pass that read an item and used it wrote the id into the body of the node it
 * grounds; that citation is the attachment, already made, in every sense except
 * the frontmatter field the ledger counts. An id no body mentions is an item the
 * tree has never found a use for.
 *
 * **What this is not.** It is not a judgment about whether an item "carries a
 * need". That is the reading a human took by hand, and nothing here can compute
 * it. A census that counts citations and a census that counts needs are two
 * different censuses, and this is the one a machine can take without inventing
 * anything — see {@link StrandedItem.citedBy}, which reports the citers rather
 * than only the verdict, so the verdict can be checked.
 */
import { readEvidence, type EvidenceRecord } from "../processes/tree.js";
import type { Actor } from "../adapters/source.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

/**
 * Which fix an item is evidence for.
 *
 * `attachable` — some node's prose already quotes the id, so an appendable
 * `source` would clear it and no new layer is required.
 *
 * `homeless` — nothing in the tree quotes it. Only a place to put evidence that
 * is not a need houses this one.
 */
export type StrandedKind = "attachable" | "homeless";

export interface StrandedItem {
  /** The vault this record and this tree came from, so a two-vault census stays attributable. */
  vault: string;
  id: string;
  title: string;
  /** Which channel captured it. A clean usage day and an anonymous note strand for different reasons. */
  actor: Actor;
  /** Titles of nodes whose prose quotes the id, in tree order. Empty iff `kind` is `homeless`. */
  citedBy: string[];
  kind: StrandedKind;
}

export interface VaultStrandedCensus {
  vault: string;
  /** Evidence records read. The denominator every count below is taken over. */
  examined: number;
  /** Records some node names in frontmatter `source` — mapped, therefore not stranded. */
  mapped: number;
  stranded: StrandedItem[];
}

export interface StrandedCensus {
  /** Per-vault, in the order the vaults were given. */
  vaults: VaultStrandedCensus[];
  examined: number;
  mapped: number;
  stranded: StrandedItem[];
  /** The two halves of `stranded`, which is the whole point of taking it. */
  attachable: StrandedItem[];
  homeless: StrandedItem[];
}

export interface StrandedOptions {
  /**
   * Node titles whose prose citations do not count as an attachment.
   *
   * A node that *enumerates* a backlog cites every id in it, which makes every
   * item look attached to the very node that exists to argue they are not. That
   * is not a hypothetical: the census this instrument replaces was written by
   * hand into a solution node's body, listing all nineteen ids. Excluding a
   * citer is how an operator asks the question without the answer's own
   * paperwork in it, and the default is to exclude nothing so the raw reading is
   * always the one you get unless you say otherwise.
   */
  excludeCiters?: readonly string[];
}

/** Escape a literal for embedding in a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Characters that continue an evidence id, and therefore may not sit against a
 * match on either side.
 *
 * Ids are keys and are compared byte-exact everywhere else in the product, so a
 * prose scan has to be exact too: `USAGE:2026-07-2` must not be found inside
 * `USAGE:2026-07-25`, and `SLACK:general` must not be found inside
 * `SLACK:general:1717`. Colon is in the class for that second case; `.` is,
 * because `INBOX:note` and `INBOX:note.md` are different records.
 */
const ID_CHAR = "A-Za-z0-9_.:\\-";

/** Does this text quote `id` as a whole id, rather than as the prefix of another one? */
export function quotesEvidenceId(text: string, id: string): boolean {
  // Cheap reject first: the census runs every id against every body, and the
  // overwhelming majority of those pairs share no substring at all.
  if (!text.includes(id)) return false;
  return new RegExp(`(?<![${ID_CHAR}])${escapeRegExp(id)}(?![${ID_CHAR}])`).test(text);
}

/**
 * The census over one tree and one ledger, with no filesystem in it.
 *
 * Split out from {@link strandedEvidenceCensus} so the classification can be
 * tested against arrays rather than against two vaults on disk, and so a caller
 * that already holds a tree does not read it twice.
 */
export function strandedEvidence(
  vault: string,
  tree: readonly OstNode[],
  evidence: readonly EvidenceRecord[],
  opts: StrandedOptions = {},
): VaultStrandedCensus {
  const excluded = new Set(opts.excludeCiters ?? []);
  // The one derivation of mapped-ness, copied from nowhere: frontmatter `source`
  // is the field the ledger counts, and this census exists to describe what that
  // field leaves behind.
  const citedSources = new Set(tree.map((n) => n.source).filter((s): s is string => !!s));
  const citers = tree.filter((n) => !excluded.has(n.title));

  const stranded: StrandedItem[] = [];
  for (const record of evidence) {
    if (citedSources.has(record.id)) continue;
    const citedBy = citers.filter((n) => quotesEvidenceId(n.body, record.id)).map((n) => n.title);
    stranded.push({
      vault,
      id: record.id,
      title: record.title,
      actor: record.actor,
      citedBy,
      kind: citedBy.length > 0 ? "attachable" : "homeless",
    });
  }

  return { vault, examined: evidence.length, mapped: evidence.length - stranded.length, stranded };
}

/**
 * Take the census across one or more vaults.
 *
 * Plural on purpose. The assumption this answers is about whether the gap recurs
 * — one vault's backlog is one product's habits, and the same hole showing up in
 * a second tree that never heard of the first is the part that is evidence.
 */
export function strandedEvidenceCensus(dirs: readonly string[], opts: StrandedOptions = {}): StrandedCensus {
  const vaults = dirs.map((dir) => strandedEvidence(dir, new Vault(dir).readTree(), readEvidence(dir), opts));
  const stranded = vaults.flatMap((v) => v.stranded);
  return {
    vaults,
    examined: vaults.reduce((n, v) => n + v.examined, 0),
    mapped: vaults.reduce((n, v) => n + v.mapped, 0),
    stranded,
    attachable: stranded.filter((i) => i.kind === "attachable"),
    homeless: stranded.filter((i) => i.kind === "homeless"),
  };
}

/** The census as an operator reads it: the split first, then what it was taken over. */
export function formatStrandedCensus(census: StrandedCensus): string {
  const lines: string[] = [];
  lines.push(
    `Stranded evidence: ${census.stranded.length} of ${census.examined} record(s) across ${census.vaults.length} vault(s) — ` +
      `${census.attachable.length} an existing node already cites, ${census.homeless.length} nothing in the tree cites.`,
  );
  for (const v of census.vaults) {
    lines.push(`  ${v.vault}: ${v.stranded.length} stranded of ${v.examined} examined (${v.mapped} mapped)`);
  }

  // The half a new node type would be for, named individually — it is the small
  // one, and it is the only one whose size decides anything.
  lines.push("");
  lines.push(`Only a new home would take these (${census.homeless.length}):`);
  if (!census.homeless.length) lines.push("  (none)");
  for (const i of census.homeless) lines.push(`  ${i.id} — ${i.title} [${i.actor}]`);

  lines.push("");
  lines.push(`An existing node's prose already quotes these (${census.attachable.length}):`);
  if (!census.attachable.length) lines.push("  (none)");
  for (const i of census.attachable) {
    const more = i.citedBy.length > 1 ? ` (+${i.citedBy.length - 1} more)` : "";
    lines.push(`  ${i.id} → ${i.citedBy[0]}${more}`);
  }

  lines.push("");
  lines.push(
    "Citation in prose is the discriminator, not whether an item carries a customer need — " +
      "a judgment no count can take. Read `citedBy` before believing either half.",
  );
  return lines.join("\n");
}
