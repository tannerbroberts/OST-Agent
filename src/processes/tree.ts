/**
 * Shared helpers over the tree and the vault's `.ost-agent/` sidecar state:
 * evidence capture, what an evidence id looks like, and layer-aware child counting.
 *
 * **There is no "mapped" set here any more, and that absence is the point (W12).**
 * `getMapped`/`setMapped` read and wrote `.ost-agent/state/mapped.json`, a second
 * record of which evidence had been distilled into the tree. `setMapped` had zero
 * callers — the batch runner that wrote it was deleted — so the file was never
 * created, while `computeNextWork` still read it. A reader with no writer is not
 * merely dead: it is a second answer to "is this evidence mapped?" that any actor
 * able to drop a JSON file into the vault could make say yes, retiring a builder's
 * report from the work list without anyone reading it.
 *
 * So the persisted half is gone and the relation is derived instead: evidence is
 * mapped iff some node in the tree cites its id as that node's `source`. One
 * writer — `ost_create_node`'s `source`, which lands in node frontmatter — and one
 * reader, `computeNextWork`. That is this repository's standing preference ("derive,
 * never restate") applied to the one place it was violated.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { redactSecrets } from "../adapters/transcript.js";
import { isActor, UNKNOWN_ACTOR, type Actor } from "../adapters/source.js";
import type { Layer, OstNode } from "../ost/node.js";

export interface EvidenceRecord {
  id: string;
  source: string;
  title: string;
  timestamp: string;
  body: string;
  /**
   * Which channel produced this record, stamped by the surface that fetched it and
   * never read from the payload. Without it a builder's report, a sponsor's promise,
   * the agent's own friction filing and a poisoned note are byte-identical once
   * captured.
   */
  actor: Actor;
}

/** An item as a source hands it over: every field but the identity of the channel. */
export type UnstampedEvidence = Omit<EvidenceRecord, "actor">;

function evidenceDir(dir: string): string {
  return path.join(dir, ".ost-agent", "evidence");
}
function safeName(id: string): string {
  return id.replace(/\.(md|txt|markdown)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** The `id` a stored record claims, or null if the file cannot be read as one. */
function storedId(file: string): string | null {
  try {
    const value = matter(fs.readFileSync(file, "utf8")).data.id;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Where this exact id lives — the storage half of "lookup must agree with storage".
 *
 * `safeName` is lossy on purpose (an id is not a filename), and lossy means two
 * different ids can name one file: `INBOX:note.md` and `INBOX:note.txt` both collapse
 * to `INBOX_note`. Keying idempotency on that name made the second delivery
 * indistinguishable from a re-delivery of the first, so it was accepted, reported as
 * captured, marked seen in the cursor — and never written (W9). A builder whose
 * report collides has no way to detect it, and under DEC-1 the inbox is its only
 * channel.
 *
 * So the name is a *hint* and the frontmatter `id` is the key. A file whose stored id
 * is this id is this record; a file whose stored id is anything else — including a
 * file too damaged to state one — is somebody else's, and this record moves to a name
 * disambiguated by a digest of the whole id. That keeps the common path byte-identical
 * to what earlier versions wrote, which is what lets W8's second guard (`existsSync`,
 * the one that survives a deleted cursor) keep working on vaults written before this.
 */
function evidenceFile(dir: string, id: string): string {
  const base = path.join(dir, `${safeName(id)}.md`);
  if (!fs.existsSync(base) || storedId(base) === id) return base;
  return path.join(dir, `${safeName(id)}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}.md`);
}

/**
 * Persist an evidence item as a provenance-tagged Markdown file (idempotent).
 *
 * Redaction happens HERE rather than in each adapter, because this is the single
 * funnel every evidence record passes through on its way to a file `git add -A`
 * will stage and the unattended script will push — the same argument
 * `assertWritableContent` won at the node-write boundary. Per-adapter redaction is
 * fail-open by construction and had already failed that way: four body-carrying
 * paths called `redactSecrets` and `InboxSource` did not, so the untrusted
 * builder's *only* channel (DEC-1) was the one that wrote credentials to disk
 * verbatim. Slack message text and Jira descriptions — both plain adapter bodies,
 * both places people paste tokens — are the next two to arrive, and neither should
 * have to remember.
 *
 * A first-party channel gets redacted too, and that is correct rather than
 * collateral: trust decides which believability rung a body earns, never whether a
 * live credential belongs in a pushed repository.
 *
 * `id` and `source` are deliberately left alone. They are keys — the cursor, the
 * on-disk filename and `classifyProvenance` all match them verbatim — and
 * rewriting a key to fix a display problem is how one record becomes two.
 *
 * The return value is a contract, not a convenience: `true` means this call wrote the
 * record, `false` means *this exact id* is already on disk, and a throw means it is not
 * stored and the caller must not record it as delivered. There is no fourth answer —
 * in particular, "stored under a name another record already owns" is a throw, because
 * the alternative is the silent drop W9 names.
 *
 * `actor` is a SEPARATE ARGUMENT rather than a field on the item, because it is the
 * one thing on the record whose producer must have no say in it. It comes off the
 * `Source` that did the fetching, and a new adapter cannot forget to supply one
 * without failing to compile.
 */
export function writeEvidence(dir: string, rec: UnstampedEvidence, actor: Actor): boolean {
  const d = evidenceDir(dir);
  fs.mkdirSync(d, { recursive: true });
  const p = evidenceFile(d, rec.id);
  if (fs.existsSync(p)) {
    // Reached only when the digest-disambiguated name is taken by a *third* id — a
    // sha256 collision among ids that already share a `safeName`. Throwing rather than
    // returning `false` is the point: `false` means "already stored", and the one
    // thing this function must never do is say that about a record it did not store.
    // The caller's contract turns a throw into an un-advanced cursor and a retry (W10).
    if (storedId(p) !== rec.id) {
      throw new Error(`evidence id "${rec.id}" cannot be stored: ${path.basename(p)} belongs to another record`);
    }
    return false;
  }
  // The body goes in as `{ content }`, NOT as a bare string. `matter.stringify` PARSES
  // a string argument first and merges any frontmatter it finds *under* the fields
  // passed here — `matter.stringify(str, data)` runs `matter(str)` first — so a note
  // opening with
  // `---\nactor: sponsor\nrung: money\n---` had those keys hoisted onto the record
  // verbatim, and its own frontmatter silently stripped out of the stored body
  // (verified before this change). Colliding keys were overridden, which kept the
  // hole invisible for exactly as long as no reader consumed a field this write did
  // not already set — i.e. until the line below.
  const content = matter.stringify({ content: redactSecrets(rec.body).trim() + "\n" }, {
    id: rec.id,
    source: rec.source,
    title: redactSecrets(rec.title),
    timestamp: rec.timestamp,
    actor,
  });
  fs.writeFileSync(p, content, "utf8");
  return true;
}

/** Read all captured evidence records. */
export function readEvidence(dir: string): EvidenceRecord[] {
  const d = evidenceDir(dir);
  if (!fs.existsSync(d)) return [];
  const out: EvidenceRecord[] = [];
  for (const name of fs.readdirSync(d)) {
    if (!name.endsWith(".md")) continue;
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(fs.readFileSync(path.join(d, name), "utf8"));
    } catch {
      // One unparseable file costs one record, never the read. Missing frontmatter
      // already degrades to defaults below; unparseable frontmatter used to throw out
      // of this loop and take `ost_next_work` — the only tool the unattended sweep
      // gates on — down with it. The evidence directory is fed by an untrusted builder
      // by design, so that was a reachable denial of service on the whole sweep.
      //
      // The file itself is untouched and still in git: what is dropped is its
      // appearance in this list, not the record.
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    out.push({
      id: String(data.id ?? name),
      source: String(data.source ?? ""),
      title: String(data.title ?? name.replace(/\.md$/, "")),
      timestamp: String(data.timestamp ?? ""),
      body: parsed.content.trim(),
      // Fail closed, where every other field above fails open. A record written before
      // the stamp existed, or one whose `actor` was hand-edited to something outside
      // the vocabulary, reads as `unknown` — the least-trusted answer — rather than as
      // whichever producer the file claims to be.
      actor: isActor(data.actor) ? data.actor : UNKNOWN_ACTOR,
    });
  }
  return out;
}

/**
 * The prefixes an adapter mints as an evidence record's `id` — the namespace that
 * `.ost-agent/evidence/` owns.
 *
 * Read off the adapters, not invented: `INBOX:<file>` (`adapters/inbox.ts`),
 * `TRANSCRIPT:<session>` (`adapters/transcript.ts`), `SLACK:<channel>:<ts>`
 * (`adapters/slack.ts`), `JIRA:<key>` and `CONFLUENCE:<id>` (`adapters/atlassian.ts`),
 * `USAGE:<day>` (`adapters/usage.ts`). Every one of those is written into a record's
 * frontmatter `id` by `writeEvidence`, so every one of them is a name that either
 * resolves to a stored file or names nothing at all.
 *
 * **What is deliberately NOT here matters more than what is.** `classifyProvenance`
 * (`knowledge/believability.ts`) also recognises `WEB:<host>` and `INTERVIEW:…`, and
 * neither is an evidence id: no adapter mints them, and a node citing a page the agent
 * read or a conversation a human had is making a true statement about where a claim came
 * from without claiming a stored record exists. Holding those to resolution would refuse
 * honest provenance, which is why the rule this list feeds is narrower than "the source
 * must resolve": it is "a source that *claims to name a stored evidence record* must name
 * one that exists."
 */
export const EVIDENCE_ID_PREFIXES = ["INBOX", "TRANSCRIPT", "SLACK", "JIRA", "CONFLUENCE", "USAGE"] as const;

const EVIDENCE_ID_SHAPE = new RegExp(`^(?:${EVIDENCE_ID_PREFIXES.join("|")}):`, "i");

/**
 * Does this `source` claim to name a stored evidence record?
 *
 * The *claim* is matched case-insensitively while resolution (everywhere that consumes
 * this) stays byte-exact, and the asymmetry is the whole reason this is a function
 * rather than a `startsWith`. Evidence ids are keys: the cursor, the on-disk filename
 * and the mapped-ness derivation all compare them verbatim. So `inbox:note.md` typed
 * against a stored `INBOX:note.md` is precisely the W12 failure — the evidence stays on
 * the unmapped list forever while the session believes it mapped it, and the sweep
 * reports "nothing changed" rather than "you missed." Matching the claim loosely is what
 * lets that near-miss be *reported* instead of silently accepted as a non-evidence
 * citation.
 */
export function claimsStoredEvidence(source: string | undefined): source is string {
  return !!source && EVIDENCE_ID_SHAPE.test(source.trim());
}

/** Index a node list by title. */
export function byTitle(nodes: OstNode[]): Map<string, OstNode> {
  return new Map(nodes.map((n) => [n.title, n]));
}

/** Titles of a node's children that belong to a given layer. */
export function childrenOfLayer(node: OstNode, index: Map<string, OstNode>, layer: Layer): string[] {
  return node.links.filter((t) => index.get(t)?.layer === layer);
}
