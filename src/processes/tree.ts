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
import { parseFrontmatter } from "../ost/frontmatter.js";
import { resolveTestsUnderSolution } from "../ost/legacy-fallback.js";
import { redactSecrets } from "../adapters/transcript.js";
import { isActor, transcriptFileExists, UNKNOWN_ACTOR, type Actor } from "../adapters/source.js";
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
  /**
   * When the ingesting surface fetched this record — the mirror's freshness clock.
   *
   * Separate from `timestamp`, which is the item's own time and therefore the
   * producer's to choose: an inbox file's mtime answers to `touch`, and a Jira
   * `updated` answers to whoever edited the issue. Neither says when THIS replica
   * was filled, which is the only thing an age computed off it could mean.
   *
   * Stamped here from the surface's clock and, like `actor`, absent from
   * {@link UnstampedEvidence} so no producer can supply one. `undefined` on records
   * written before the stamp existed; `src/adapters/mirror.ts` reads that as
   * `undated` rather than as fresh or stale.
   */
  fetchedAt?: string;
}

/**
 * An item as a source hands it over: every field but the two the SURFACE stamps.
 *
 * `actor` (who produced it) and `fetchedAt` (when we pulled it) are both omitted for
 * one reason — they are the fields a record's producer must have no say in. A
 * producer that can date its own capture can make a stale record look current, which
 * is the whole failure the mirror's age is there to prevent.
 */
export type UnstampedEvidence = Omit<EvidenceRecord, "actor" | "fetchedAt">;

function evidenceDir(dir: string): string {
  return path.join(dir, ".ost-agent", "evidence");
}
function safeName(id: string): string {
  return id.replace(/\.(md|txt|markdown)$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/** The `id` a stored record claims, or null if the file cannot be read as one. */
function storedId(file: string): string | null {
  try {
    const value = parseFrontmatter(fs.readFileSync(file, "utf8")).data.id;
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
 *
 * `now` is the second such field and arrives the same way: it becomes `fetchedAt`,
 * the moment this replica was filled, and it is what makes the mirror's staleness a
 * number rather than a property nobody can see (`src/adapters/mirror.ts`). It is
 * written ONCE, on the call that actually stores the record — a re-offer returns
 * `false` above without touching the file, so the stamp keeps saying when the bytes
 * on disk were fetched rather than when something last looked at them.
 */
export function writeEvidence(
  dir: string,
  rec: UnstampedEvidence,
  actor: Actor,
  now: Date = new Date(),
): boolean {
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
    fetchedAt: now.toISOString(),
  });
  fs.writeFileSync(p, content, "utf8");
  return true;
}

/**
 * What a read of the evidence directory was offered and what it came back with.
 *
 * The two numbers are not the same and the gap between them is silent: the loop
 * below drops a file whose frontmatter will not parse, on purpose (see the catch),
 * so a caller holding only the records has no way to know that four of three
 * hundred never made it. Every count taken over `records` is a count over a
 * subject that may have shrunk — which is exactly the partly-blind sweep this
 * shape exists to make visible. `offered` is the denominator; `unreadable` names
 * the difference.
 */
export interface EvidenceScan {
  /** `.md` files present in the evidence directory — the subject as it was found. */
  readonly offered: number;
  readonly records: EvidenceRecord[];
  /** Filenames that would not parse and are therefore absent from `records`. */
  readonly unreadable: string[];
}

/** Read all captured evidence records. */
export function readEvidence(dir: string): EvidenceRecord[] {
  return readEvidenceScan(dir).records;
}

/** Read the evidence directory and report what it could not read as well as what it could. */
export function readEvidenceScan(dir: string): EvidenceScan {
  const d = evidenceDir(dir);
  if (!fs.existsSync(d)) return { offered: 0, records: [], unreadable: [] };
  const out: EvidenceRecord[] = [];
  const unreadable: string[] = [];
  let offered = 0;
  for (const name of fs.readdirSync(d)) {
    if (!name.endsWith(".md")) continue;
    offered++;
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = parseFrontmatter(fs.readFileSync(path.join(d, name), "utf8"));
    } catch {
      // One unparseable file costs one record, never the read. Missing frontmatter
      // already degrades to defaults below; unparseable frontmatter used to throw out
      // of this loop and take `ost_next_work` — the only tool the unattended sweep
      // gates on — down with it. The evidence directory is fed by an untrusted builder
      // by design, so that was a reachable denial of service on the whole sweep.
      //
      // The file itself is untouched and still in git: what is dropped is its
      // appearance in this list, not the record.
      //
      // It is named in `unreadable` rather than only dropped, because a skip
      // nobody counts is how a sweep goes partly blind and still reports clean.
      unreadable.push(name);
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
      // Carried through as written or not at all — no fallback to `timestamp`, which
      // is the producer's field and would hand back a fetch time nobody fetched.
      // A record without one is `undated` to the mirror, never fresh.
      fetchedAt: typeof data.fetchedAt === "string" ? data.fetchedAt : undefined,
    });
  }
  return { offered, records: out, unreadable };
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
export const EVIDENCE_ID_PREFIXES = [
  "INBOX",
  "TRANSCRIPT",
  "SLACK",
  "JIRA",
  "CONFLUENCE",
  "USAGE",
  // `ACTIONS:<day>` (`adapters/actions.ts`) — a day of the repository's own CI runs.
  "ACTIONS",
] as const;

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

/**
 * What a citation that {@link claimsStoredEvidence} resolves to, for a caller
 * deciding whether to WRITE it rather than one reporting on a tree already
 * written.
 *
 * `"unresolvable"` is the one answer `ost_check`'s sweep-time `unresolved-citation`
 * rule could already report — this function exists so `ost_create_node` can refuse
 * it before the byte lands, rather than after. `"unharvested"` is why that refusal
 * cannot just be "does `readEvidence` have this id": a session id is well-formed
 * and simply not delivered yet whenever the session it names has started, and a
 * node is free to cite its own still-running session (see
 * {@link transcriptFileExists}). Collapsing that into `"unresolvable"` would refuse
 * the exact citation this repository shipped once and then watched self-heal.
 */
export type SourceResolution = "resolved" | "unharvested" | "unresolvable";

/**
 * Resolve a citation that {@link claimsStoredEvidence} against what is actually on
 * disk — the stored evidence directory first, then (for `TRANSCRIPT:` ids only) the
 * directories the transcript adapter itself would read.
 *
 * Callers must have already gated on `claimsStoredEvidence`: this function does not
 * repeat that check, because "not a claim at all" (`WEB:…`, free prose, no source)
 * is a different answer than any of the three here, and folding it in would make
 * every caller re-derive the distinction from a fourth string.
 */
export function resolveClaimedSource(
  dir: string,
  source: string,
  transcriptDirs: readonly { readonly dir: string }[],
): SourceResolution {
  if (readEvidence(dir).some((e) => e.id === source)) return "resolved";
  return transcriptFileExists(source, transcriptDirs) ? "unharvested" : "unresolvable";
}

/** Index a node list by title. */
export function byTitle(nodes: OstNode[]): Map<string, OstNode> {
  return new Map(nodes.map((n) => [n.title, n]));
}

/** Titles of a node's children that belong to a given layer. */
export function childrenOfLayer(node: OstNode, index: Map<string, OstNode>, layer: Layer): string[] {
  return node.links.filter((t) => index.get(t)?.layer === layer);
}

/**
 * Every Opportunity with at least one Solution somewhere in its subtree —
 * its own children included, and its sub-opportunities' children too.
 *
 * **Why a set computed once rather than a walk per node.** The caller
 * (`underservedOpportunities`) asks this of every Opportunity in the tree, and a
 * fresh subtree walk each time is quadratic: 2,000 opportunities over a 10,000
 * node tree is the shape the wall-clock budget is pinned against
 * (`test/mcp/wall-clock-budget.test.ts`). Memoised, the whole set costs one pass
 * over the nodes and their edges.
 *
 * **Boolean, not a count.** The only question anyone has needed is whether the
 * subtree is empty of solutions, and a boolean is the one answer that survives a
 * cycle honestly: a back edge contributes `false`, so a node on a cycle can only
 * ever be UNDER-reported as served. Under-reporting keeps a node on the
 * under-served list, which is the safe direction — the failure this guards
 * against is a gap that goes quiet, never a heading listed once too often.
 */
export function opportunitiesServedBeneath(tree: readonly OstNode[], index: Map<string, OstNode>): Set<string> {
  const served = new Set<string>();
  const settled = new Set<string>();
  const visiting = new Set<string>();

  const walk = (title: string): boolean => {
    if (settled.has(title)) return served.has(title);
    if (visiting.has(title)) return false; // back edge: see the cycle note above
    const node = index.get(title);
    if (!node || node.layer !== "Opportunity") return false;

    visiting.add(title);
    let has = false;
    for (const link of node.links) {
      const child = index.get(link); // dangling link — `check` reports it; this counts what exists
      if (child?.layer === "Solution") has = true;
      // No early exit: descending every sub-opportunity is what memoises them,
      // and that is where the single-pass cost comes from.
      else if (child?.layer === "Opportunity" && walk(link)) has = true;
    }
    visiting.delete(title);

    settled.add(title);
    if (has) served.add(title);
    return has;
  };

  for (const n of tree) if (n.layer === "Opportunity") walk(n.title);
  return served;
}

/**
 * Every Opportunity mapped to HOW MANY distinct Solutions sit in its subtree —
 * its own solution children included, and its sub-opportunities' too.
 *
 * **Why a count when {@link opportunitiesServedBeneath} already answers the
 * boolean.** "Is anything beneath this heading" and "is enough beneath it" are
 * different questions and the exemption needs the second one. A heading holding
 * one solution under a five-child subtree is served by the boolean and thin by
 * every reading a person would give it, and the boolean can never say so.
 *
 * **Distinct, not summed.** A solution reachable from two sub-opportunities is
 * one solution, and summing child counts would report it twice — which is the
 * one direction of error this must not make, because an over-count silences a
 * heading. So the memo carries the titles and the parent unions them.
 *
 * **Memoised for the same reason {@link leafOpportunitiesBeneath} is** — the
 * caller asks this of every Opportunity in the tree and a fresh subtree walk
 * each time is quadratic on the 10,000-node shape
 * `test/mcp/wall-clock-budget.test.ts` pins.
 *
 * **A cycle contributes nothing**, exactly as in the boolean: a back edge
 * returns the empty set, so a node on a cycle can only ever be UNDER-counted.
 * Under-counting keeps a heading on the under-served list, which is the safe
 * direction — the failure worth guarding against is a gap that goes quiet.
 *
 * Descent is through Opportunity edges only, because a Solution's own children
 * are Assumptions rather than more solutions. That is the one place this can
 * differ from `rollup`'s bucket figure, which follows every edge downward.
 */
export function solutionsBeneath(tree: readonly OstNode[], index: Map<string, OstNode>): Map<string, number> {
  const settled = new Map<string, ReadonlySet<string>>();
  const visiting = new Set<string>();

  const walk = (title: string): ReadonlySet<string> => {
    const done = settled.get(title);
    if (done) return done;
    if (visiting.has(title)) return new Set(); // back edge: see the cycle note above
    const node = index.get(title);
    if (!node || node.layer !== "Opportunity") return new Set();

    visiting.add(title);
    const solutions = new Set<string>();
    for (const link of node.links) {
      const child = index.get(link); // dangling link — `check` reports it; this counts what exists
      if (child?.layer === "Solution") solutions.add(link);
      else if (child?.layer === "Opportunity") for (const t of walk(link)) solutions.add(t);
    }
    visiting.delete(title);

    settled.set(title, solutions);
    return solutions;
  };

  const out = new Map<string, number>();
  for (const n of tree) if (n.layer === "Opportunity") out.set(n.title, walk(n.title).size);
  return out;
}

/**
 * Every Opportunity mapped to the LEAF opportunities beneath it — the
 * descendants that file no sub-opportunity of their own.
 *
 * **Why leaves specifically.** A solution cannot legitimately hang on a
 * category; the tree's own invariant (`outcome-files-categories`) says a heading
 * holds sub-opportunities and the specific needs hang beneath it. So when the
 * queue finds a heading short of solutions, the node it actually wants served is
 * somewhere down here, and this is the map that says which.
 *
 * **Exclusive of the node itself**, so a leaf maps to the empty set. That is the
 * distinction the caller needs: "no leaf beneath me" and "I am the leaf" are
 * different facts about a branch and only one of them is a descent.
 *
 * **Memoised for the same reason {@link opportunitiesServedBeneath} is** — the
 * caller asks this of every short category and a fresh subtree walk each time is
 * quadratic on the 10,000-node shape `test/mcp/wall-clock-budget.test.ts` pins.
 *
 * **A cycle terminates rather than recursing**, exactly as in `evidenceExtents`:
 * a back edge contributes the empty set. What that yields for the nodes ON the
 * cycle is not a meaningful answer — a node can name itself as its own leaf —
 * and it is not made to be: `check` reports the cycle, and this map's guarantee
 * is only that a malformed tree cannot hang the sweep. The caller's failure mode
 * either way is a diagnostic too many, never a branch that goes quiet.
 */
export function leafOpportunitiesBeneath(
  tree: readonly OstNode[],
  index: Map<string, OstNode>,
): Map<string, ReadonlySet<string>> {
  const settled = new Map<string, ReadonlySet<string>>();
  const visiting = new Set<string>();

  const walk = (title: string): ReadonlySet<string> => {
    const done = settled.get(title);
    if (done) return done;
    if (visiting.has(title)) return new Set(); // back edge: see the cycle note above
    const node = index.get(title);
    if (!node || node.layer !== "Opportunity") return new Set();

    visiting.add(title);
    const leaves = new Set<string>();
    for (const link of node.links) {
      const child = index.get(link); // dangling link — `check` owns reporting that
      if (child?.layer !== "Opportunity") continue;
      const beneath = walk(link);
      // A child with nothing beneath it IS the leaf; otherwise its own leaves are.
      if (beneath.size === 0) leaves.add(link);
      else for (const t of beneath) leaves.add(t);
    }
    visiting.delete(title);

    settled.set(title, leaves);
    return leaves;
  };

  const out = new Map<string, ReadonlySet<string>>();
  for (const n of tree) if (n.layer === "Opportunity") out.set(n.title, walk(n.title));
  return out;
}

/**
 * The AssumptionTests that answer for a Solution — through its Assumptions.
 *
 * **This is the one place the Solution→Assumption→AssumptionTest walk is
 * written.** Six callers used to spell it as a direct-child filter, and six
 * copies of a two-hop walk is how the gate (`buildable`) and the report
 * (`debt`) end up disagreeing about whether a solution is tested.
 *
 * Reads are deliberately tolerant of the pre-Assumption shape: a legacy
 * Solution→AssumptionTest edge still counts. Vaults written before the layer
 * existed must not have every gate go red on a migration nobody asked them to
 * run — the strictness lives on the WRITE side (`CHILD_HIERARCHY`), where it
 * only constrains edges being drawn now.
 *
 * **That tolerance is BOUNDED, and the bound lives in
 * {@link ../ost/legacy-fallback.ts}.** It applies only to tests created before
 * the release that introduced the Assumption layer, it goes inert at a release
 * named in code, and what it is carrying is countable — because an unbounded
 * second reading of "is this tested" quietly becomes the definition of done and
 * then nobody can show it is safe to remove. Callers that need to know *which*
 * route a test came by take {@link resolveTestsUnderSolution} instead; this
 * spelling drops the attribution for the callers that only count.
 *
 * De-duplicated by title, because two Assumptions under one Solution may share
 * a test and a solution should not read as twice-tested for it.
 */
export function testsUnderSolution(solution: OstNode, index: Map<string, OstNode>): OstNode[] {
  return resolveTestsUnderSolution(solution, index).map((r) => r.test);
}
