/**
 * What a reader saw the last time they looked, so the next look can say what
 * moved.
 *
 * This is the storage half of the tree node "A per-visit diff of the tree can be
 * computed from the vault alone". That assumption names three ways it could be
 * false, and this file answers the first one: there may be **no durable place to
 * record when a particular reader last looked**. The answer is the vault's own
 * sidecar — `<vault>/.ost-agent/visits/<reader>.json`, beside the ledgers, the
 * dispositions and the usage log — so a fresh clone that carries the vault
 * carries the visits, no server keeps per-reader state, and nothing has to
 * remember who visited when except the file the visit wrote.
 *
 * What is stored is a **fingerprint per node, not the vault**. A snapshot has to
 * be able to answer "did this node's status move?" and "was this node's prose
 * rewritten?" without keeping a second copy of a 1600-node tree in the sidecar,
 * so every field a reader would care about is kept verbatim (they are short) and
 * the prose is kept as a hash (it is not). The consequence, stated because it
 * bounds what the diff can ever say: a snapshot knows that prose changed, never
 * what it changed to. Naming the words is git's job and this is not git.
 *
 * The other consequence is deliberate: **the History lines are kept in full.**
 * They are the vault's own record of *why* a file changed — `status: a → b`,
 * `merged "X" into this node`, `link "X" repointed to "Y"` — and the diff beside
 * this ({@link ../eval/tree-view.ts}) is built entirely on reading them. Drop
 * them and the diff falls back to comparing bytes, which is the failure the
 * assumption's third clause names: a merge reported as one deletion plus one
 * unrelated edit rather than as one event.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { HISTORY_HEADING, entriesUnder, isHeadingLine } from "./headings.js";
import { splitReservedSections } from "./sections.js";
import type { OstNode } from "./node.js";

/** The sidecar directory a vault's visit records live in. */
export function visitsDir(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "visits");
}

/**
 * The reader name used when a caller names none.
 *
 * A constant rather than the OS username: the same vault read by the same person
 * from two machines is one reader, and a diff that silently split on `$USER`
 * would show a first visit to somebody who had visited twice.
 */
export const DEFAULT_READER = "default";

/**
 * A reader name reduced to a filename, or a throw.
 *
 * Refused rather than mangled, because the two failure modes of a quiet
 * reduction are both bad: `../../etc/x` silently becoming `etc-x` writes
 * somewhere the caller did not ask for, and two distinct readers colliding onto
 * one slug shows each of them the other's diff. Names are ASCII word characters,
 * dashes and dots, and a dot may not lead — which excludes `.` and `..` without
 * a special case for either.
 */
export function readerSlug(reader: string): string {
  const trimmed = reader.trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(
      `refusing "${reader}" as a reader name: use letters, digits, dash, underscore or dot, ` +
        `and do not start with a dot — the name becomes a filename under .ost-agent/visits/`,
    );
  }
  return trimmed.toLowerCase();
}

/**
 * Everything about one node a later visit compares against.
 *
 * Every field except `prose` is carried verbatim, so the diff can name the old
 * value and the new one ("unvalidated → validated") rather than reporting that
 * something in the frontmatter moved. `prose` is a hash for size; see the file
 * header for what that costs.
 */
export interface NodeFingerprint {
  layer: string;
  status?: string;
  evidence?: string;
  lane?: string;
  instrument?: string;
  /** Sorted, so a reordered link list is not a change. */
  links: string[];
  /** SHA-256 of the body outside the reserved sections. */
  prose: string;
  /**
   * SHA-256 of the reserved sections other than History — `## Results`, `##
   * Instrument Log`, `## Retraction`.
   *
   * Kept apart from `prose` because it is the one body change a reader is most
   * likely to have come for: a test that came back, an exit code somebody
   * watched. Folded into the prose hash it would surface as "the text changed",
   * which is the least informative true thing that could be said about it.
   */
  measurements: string;
  /** The `## History` entries, verbatim and in order — the vault's own account of its writes. */
  history: string[];
}

/** What one reader saw, and when. */
export interface VisitSnapshot {
  reader: string;
  /** ISO timestamp supplied by the caller — never read off the clock here, so tests are deterministic. */
  at: string;
  nodes: Record<string, NodeFingerprint>;
}

function hashOf(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** Is this reserved block the History section? */
function isHistoryBlock(block: string): boolean {
  return isHeadingLine(block.split("\n", 1)[0] ?? "", HISTORY_HEADING);
}

/** The fingerprint of one node, as the snapshot stores it. */
export function fingerprint(node: OstNode): NodeFingerprint {
  const split = splitReservedSections(node.body);
  const measurements = split.reserved.filter((block) => !isHistoryBlock(block));
  return {
    layer: node.layer,
    ...(node.status ? { status: node.status } : {}),
    ...(node.evidence ? { evidence: node.evidence } : {}),
    ...(node.lane ? { lane: node.lane } : {}),
    ...(node.instrument ? { instrument: node.instrument } : {}),
    links: [...node.links].sort(),
    prose: hashOf(split.prose.trim()),
    measurements: hashOf(measurements.join("\n\n").trim()),
    history: entriesUnder(node.body, HISTORY_HEADING),
  };
}

/** Fingerprint a whole tree, keyed by title. */
export function fingerprintTree(tree: readonly OstNode[]): Record<string, NodeFingerprint> {
  const out: Record<string, NodeFingerprint> = {};
  for (const node of tree) out[node.title] = fingerprint(node);
  return out;
}

/** Where one reader's record lives. */
export function visitPath(vaultDir: string, reader: string): string {
  return path.join(visitsDir(vaultDir), `${readerSlug(reader)}.json`);
}

/**
 * Record that `reader` has now seen this tree.
 *
 * Overwrites rather than appends. A visit record is a *position*, not an event
 * log — the only question ever asked of it is "what did they last see" — and an
 * append-only history of full tree fingerprints would grow by the size of the
 * tree on every read of the view. The events themselves are not lost by this:
 * they are in the node files' History sections and in git, which is where the
 * diff reads them from anyway.
 */
export function recordVisit(vaultDir: string, reader: string, tree: readonly OstNode[], at: string): VisitSnapshot {
  const snapshot: VisitSnapshot = { reader: readerSlug(reader), at, nodes: fingerprintTree(tree) };
  const p = visitPath(vaultDir, reader);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(snapshot)}\n`, "utf8");
  return snapshot;
}

/**
 * What `reader` last saw, or undefined if they have never looked.
 *
 * A record that will not parse reads as never-looked rather than throwing: the
 * one caller is a view somebody opened, and a corrupt sidecar file should cost
 * them the diff, not the tree.
 */
export function lastVisit(vaultDir: string, reader: string): VisitSnapshot | undefined {
  const p = visitPath(vaultDir, reader);
  if (!fs.existsSync(p)) return undefined;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!parsed || typeof parsed !== "object") return undefined;
    const snapshot = parsed as VisitSnapshot;
    if (!snapshot.nodes || typeof snapshot.nodes !== "object") return undefined;
    return snapshot;
  } catch {
    return undefined;
  }
}
