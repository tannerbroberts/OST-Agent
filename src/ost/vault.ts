/**
 * Vault operations over the filesystem — mostly additive, and deliberately no
 * longer only additive.
 *
 * Most methods here are add-only by construction: they create a node, append to
 * one, add a link/status-transition/annotation, or read. Three are not, and the
 * reason they exist is worth stating because it overturns the sentence this file
 * used to open with.
 *
 * **Append-only stopped scaling before it stopped being right.** A vault whose
 * every operation grows a file accumulates overlap it has no way to resolve: the
 * tree this product runs on itself reached 566 nodes with a root carrying twenty
 * appended ledgers, 165 edges and 89KB of prose, and nothing in the surface could
 * shrink any of it. Duplicates could be annotated but not merged; a link written
 * by mistake was permanent. So {@link Vault.detach}, {@link Vault.editProse} and
 * {@link Vault.mergeNodes} can remove things, and the guarantee changes shape
 * rather than disappearing:
 *
 *   - Nothing is lost. The vault is a git repository and every mutation lands in
 *     a commit that names what it removed, so recovery is `git show`, not a
 *     backup nobody made.
 *   - The measurements stay untouchable. An edit never takes a whole body — the
 *     caller supplies prose, {@link ./sections.ts} holds the reserved blocks
 *     aside, and the writer puts them back verbatim. A merge carries the loser's
 *     reserved blocks onto the survivor for the same reason. So `## Results`,
 *     `## Uncovered` and `## Instrument Log` are now neither writable nor
 *     removable by any tool, which is strictly stronger than before.
 *   - History still grows. Every removal appends the line that explains it, so a
 *     node carries the account of what it absorbed and what was unlinked from it.
 *
 * There is still NO rename (Obsidian's, which rewrites inbound links, remains the
 * right tool) and all paths are confined to the vault root. This class is the
 * ONLY thing that touches node files on disk.
 *
 * It is also where the one thing the agent may never author is refused. Every
 * caller-supplied string funnels through `assertWritableContent`, and a reserved
 * heading (`ost/headings.ts`) is refused there rather than on any one parameter,
 * because SEVEN different arguments could carry one — six free-text parameters
 * and `tags`, which is not free text and was found last, by review, after the
 * other six had been enumerated by hand. That is the argument for the funnel
 * stated as a fact rather than as a preference. The heading ARGUMENT of
 * `appendUnderSection` is deliberately not scanned: that is the position the
 * human's CLI result path writes from, and no tool call reaches it.
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { nearestName } from "../fs/near-miss.js";
import { noteNodeFileCreated } from "../telemetry/usage.js";
import {
  AGENT_IDEATED_TAG,
  deserialize,
  serialize,
  wrappedLinkTargets,
  type Layer,
  type NodeStatus,
  type OstNode,
  LAYERS,
} from "./node.js";
import { parseFrontmatter } from "./frontmatter.js";
import { canonicalTitle, fileNameForTitle, sanitizeTitle } from "./sanitize.js";
import { isHeadingLine, reservedHeadingIn } from "./headings.js";
import { joinReservedSections, splitReservedSections } from "./sections.js";
import {
  ARCHIVE_DIRNAME,
  isRetractedNode,
  retractionReason,
  withoutRetiredNodes,
  type CensusDrop,
  type TreeCensus,
} from "./census.js";
import type { RungId } from "../knowledge/believability.js";
import type { LaneId } from "../knowledge/lanes.js";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Content that is structurally present but carries nothing — the shape a stringified
 * unset variable takes on its way to disk.
 *
 * This is the *last* line of defence, complementing the schema check on the tool call.
 * Schema validation catches a malformed CALL; it provably cannot see a malformed VALUE
 * arriving through a well-formed one (`{ issue: String(x) }` where x was never set is a
 * schema-valid call). This sits at the single point every node write funnels through, so
 * it holds for entry points that do not exist yet.
 *
 * Deliberately a tripwire, not a policy: the test is that the content IS exactly one of
 * these, never that it CONTAINS one. Real annotations discuss the word "undefined" —
 * several in this project's own vaults do — and must stay writable.
 */
const VOID_CONTENT = new Set(["undefined", "null"]);

function assertWritableContent(what: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new Error(
      `refusing to write empty ${what}: content was empty or whitespace only. ` +
        `An append-only vault cannot take this back — pass real content or make no call.`,
    );
  }
  if (VOID_CONTENT.has(trimmed.toLowerCase())) {
    throw new Error(
      `refusing to write ${what}: content was the literal string "${trimmed}". ` +
        `This is almost always a stringified unset variable rather than something meant ` +
        `to be recorded; an append-only vault cannot take it back.`,
    );
  }
  // A wikilink broken across a line break is a one-way door, and the only one this
  // guard can close. It is not an edge (only a whole line `[[Title]]` becomes one) and
  // not a dangling edge either, so it is invisible to every structural check except
  // `wrapped-wikilink` — which no append-only tool can then clear, because clearing it
  // would mean shrinking a body. Refusing at the write is the last moment the content
  // is still revocable.
  const wrapped = wrappedLinkTargets(value);
  if (wrapped.length > 0) {
    throw new Error(
      `refusing to write ${what}: the link [[${wrapped[0]}]] is split across a line ` +
        `break. Only a whole line of the form [[Title]] becomes an edge, so this would ` +
        `render as bracketed text while permanently reddening \`wrapped-wikilink\` — and ` +
        `an append-only vault has no tool that can take it back. Put the link on one ` +
        `unbroken line.`,
    );
  }
  // A reserved heading is a measurement claim, and this is the one place every
  // write that could carry one funnels through. `appendUnderHeading` splices a
  // caller's string in as LINES, so a `note`, an `issue` or a `why` with a
  // newline in it authored a `## Results` section just as surely as `section`
  // did — six arguments, one defect. Refusing the CONTENT here while leaving
  // `appendUnderSection`'s `heading` parameter unscanned is what keeps the
  // human's `ost-agent result` path open: it names the heading, it never writes
  // one. (B1, B10.)
  const reserved = reservedHeadingIn(value);
  if (reserved) {
    throw new Error(
      `refusing to write ${what}: "${reserved}" is a reserved heading. The tree's gates read it ` +
        `as evidence that a test was RUN outside the tree, and the agent may never run a test or ` +
        `record a result — a heading it can author is a gate it can clear on its own authority. ` +
        `A human records one on the CLI: ost-agent result "<test>" -v <verdict> -n "<what happened>" ` +
        `-b "<who ran it>" -u "<what it did not cover>". Put your note under a different heading ` +
        `(## Notes, ## Method, ## Plan).`,
    );
  }
}

/**
 * Guard an OPTIONAL note. `undefined` is a caller legitimately declining to explain
 * itself and is allowed through untouched; the four-character string "undefined" is a
 * caller that stringified a variable it never set, and is exactly the defect.
 */
function assertWritableNote(what: string, value: string | undefined): void {
  if (value === undefined) return;
  assertWritableContent(what, value);
}

/**
 * A tag is one `#word`, and this is what makes that true rather than assumed.
 *
 * `serialize` renders every tag onto ONE space-joined line and `deserialize`
 * reads only the first non-empty line back, so a tag carrying a newline is not a
 * tag at all — it is arbitrary body content, and the remainder of the tag line
 * (including the `#unvalidated` stamp) is stranded below it and lost on the next
 * read. Measured: `tags: ["a\nb"]` round-trips to `["a"]`, and a tag holding a
 * `## Results` block cleared `gateSolution` in one allowlisted call while
 * `checkInvariants` stayed empty.
 *
 * **That door was open for the same reason the criterion it defeats existed:**
 * `assertWritableContent` was reached by every *free-text* parameter and `tags`
 * was not free text, so it was never enumerated. A hand-written list of writable
 * parameters will always be one short of the truth; the pin for this is a
 * property over each tool's own schema, not a seventh entry on a list.
 *
 * Whitespace is the load-bearing half — it makes the injection inexpressible —
 * and the content guard runs too, so a tag cannot be void or carry a broken link.
 */
function assertWritableTag(title: string, tag: string): void {
  if (/\s/.test(tag)) {
    throw new Error(
      `refusing to write a tag on "${title}": tags cannot contain whitespace, and this one does ` +
        `(${JSON.stringify(tag)}). A tag is rendered as a single #word on one shared line, so ` +
        `whitespace in one either silently splits it in two or, with a newline, writes body content ` +
        `that no reader can tell from prose the author wrote. Use one word, or hyphens.`,
    );
  }
  if (tag.includes("#")) {
    throw new Error(`refusing to write a tag on "${title}": tags are rendered with their own "#" — drop it from ${JSON.stringify(tag)}.`);
  }
  assertWritableContent(`a tag on "${title}"`, tag);
}

export class Vault {
  readonly root: string;

  constructor(rootDir: string, opts: { create?: boolean } = {}) {
    this.root = path.resolve(rootDir);
    // Creation is the default because every write path assumes the root exists.
    // Probe-only callers (the MCP server's readiness check and its pre-ready
    // tool listing) opt out: probing a directory must never create it.
    if (opts.create !== false) fs.mkdirSync(this.root, { recursive: true });
  }

  /** Absolute path for a node title, asserted to stay within the vault root. */
  private nodePath(title: string): string {
    const p = path.resolve(this.root, fileNameForTitle(title));
    const rel = path.relative(this.root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel) || rel.includes(path.sep)) {
      throw new Error(`refusing to write outside the vault: ${title}`);
    }
    return p;
  }

  has(title: string): boolean {
    return fs.existsSync(this.nodePath(title));
  }

  /**
   * The one title a miss is plausibly a misspelling of, or undefined.
   *
   * A node lookup is a path lookup with the directory hidden — every title is a
   * file at the vault root — so the same discipline applies, including the refusal
   * to name anything when two titles are equally close. A caller handed the wrong
   * node writes to the wrong node, so a tie here is worse than silence.
   */
  nearestTitle(title: string): string | undefined {
    let titles: string[];
    try {
      titles = fs
        .readdirSync(this.root)
        .filter((n) => n.endsWith(".md"))
        .map((n) => n.slice(0, -3));
    } catch {
      return undefined;
    }
    const wanted = canonicalTitle(title);
    return wanted ? nearestName(wanted, titles) : undefined;
  }

  /**
   * `no such node`, plus the nearest real title when there is an obvious one.
   *
   * A shell that ran a title together with two others, or dropped an apostrophe
   * out of one, is the recorded shape of this miss — both are a few characters
   * away from a title that is right there on disk.
   */
  private noSuchNode(title: string): Error {
    const near = this.nearestTitle(title);
    return new Error(`no such node: ${title}${near ? ` — did you mean "${near}"?` : ""}`);
  }

  /** Read all node files at the vault root (skips non-node files and subdirs). */
  readTree(): OstNode[] {
    return this.readTreeCensus().nodes;
  }

  /**
   * The live tree — `readTree` with retired nodes withheld.
   *
   * Deliberately NOT what `readTree` returns. Every gate in the product reads
   * `readTree`, and a retired-by-status node must stay inside every gate, or
   * `ost_set_status(node, "deferred")` becomes a way to clear an invariant.
   * The argument for the one pass that may use this is on
   * {@link withoutRetiredNodes}.
   */
  readLiveTree(): OstNode[] {
    return this.readTreeCensus({ excludeRetired: true }).nodes;
  }

  /**
   * `readTree`, plus an account of everything it declined to return.
   *
   * This is the SAME traversal that produces the node list rather than a second one
   * run alongside it, and that is deliberate: a census taken by a different walk
   * would be measuring a different walk, and could agree with itself while the real
   * counter quietly dropped files. The only thing that knows the counter skipped
   * something is the counter.
   *
   * That covers files the walk saw. Files the walk never enumerated at all are
   * invisible from in here by construction — `reconcileWithGit` exists for those,
   * and takes its denominator from outside this function on purpose.
   *
   * `opts.excludeRetired` additionally withholds nodes whose *status* retires
   * them. It is off by default and must stay that way for every gate: the read
   * that feeds `checkInvariants` and `done` has to see a `deferred` node, or
   * setting that status becomes a way to clear a violation. The one caller that
   * turns it on, and the argument for it, are on `withoutRetiredNodes`. Files
   * under `archive/` are withheld either way — nothing the agent can call puts
   * a file there.
   *
   * A node carrying a `## Retraction` is withheld either way too, for the same
   * reason and by the same argument: the heading is reserved, so no tool call
   * can author one and no edit can drop one, and a retirement the agent cannot
   * forge is a retirement every gate may honour. See {@link isRetractedNode}.
   */
  readTreeCensus(opts: { excludeRetired?: boolean } = {}): TreeCensus {
    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    const nodes: OstNode[] = [];
    const seenFiles: string[] = [];
    const skipped: CensusDrop[] = [];
    const unreadable: CensusDrop[] = [];
    // Node files a human moved out of the live tree. Read only to be named:
    // they never enter `nodes`, and they are not counted in `examined` either,
    // because `examined` is the denominator the ROOT walk was taken over and
    // `reconcileWithGit` compares it against git's top-level listing.
    const retired: CensusDrop[] = this.archivedFiles();

    for (const e of entries) {
      // Not a markdown file at the vault root, so it was never a candidate to be a
      // node. Counting these as "dropped" would bury the real drops in config files.
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      seenFiles.push(e.name);

      let raw: string;
      try {
        raw = fs.readFileSync(path.join(this.root, e.name), "utf8");
      } catch (err) {
        unreadable.push({ file: e.name, reason: `could not be read: ${(err as Error).message}` });
        continue;
      }

      let type: unknown;
      try {
        type = (parseFrontmatter(raw).data as Record<string, unknown>).type;
      } catch (err) {
        // Frontmatter that will not parse. Before the census this threw out of
        // readTree and took every command down with a stack trace that named no
        // file; one malformed node made the whole vault unreadable.
        unreadable.push({ file: e.name, reason: `frontmatter did not parse: ${(err as Error).message}` });
        continue;
      }

      if (typeof type !== "string" || !LAYERS.includes(type as Layer)) {
        skipped.push({
          file: e.name,
          reason:
            type === undefined
              ? "no frontmatter `type` — not an OST node"
              : `unrecognised type ${JSON.stringify(String(type))}`,
        });
        continue;
      }

      let node: OstNode;
      try {
        node = deserialize(e.name.replace(/\.md$/, ""), raw);
      } catch (err) {
        unreadable.push({ file: e.name, reason: (err as Error).message });
        continue;
      }

      // Retraction, honoured HERE and only here.
      //
      // This is the whole of "every reader and gate honours it", and it is one
      // line rather than a change to each of the seventeen call sites downstream
      // because there is exactly one door: nothing outside `src/ost/` turns a
      // file into an `OstNode`, so every count, scan, gate, rollup and sweep in
      // the product is reading this array. A per-consumer flag would have been
      // the version that a reader written next year silently does not honour;
      // `test/ost/retraction-consumers.test.ts` pins the door shut so it stays
      // that way.
      //
      // Unconditional, unlike `excludeRetired` below, and the asymmetry is the
      // safety argument in one word: `deferred` is the agent's to set and a
      // retraction is not, so only this one is safe to apply to a gate.
      if (isRetractedNode(node)) {
        retired.push({ file: e.name, reason: retractionReason(node) });
        continue;
      }

      nodes.push(node);
    }

    const census: TreeCensus = { nodes, examined: seenFiles.length, seenFiles, skipped, unreadable, retired };
    return opts.excludeRetired ? withoutRetiredNodes(census) : census;
  }

  /**
   * The `archive/` directory's markdown files, as census entries.
   *
   * One level, no recursion, and nothing is parsed: an archived file is out of
   * the tree, so the only fact worth recovering from it is that it exists. It is
   * listed rather than counted for the reason the census exists at all — "3
   * retired" tells an operator a number moved, `Old idea.md` tells them what.
   */
  private archivedFiles(): CensusDrop[] {
    const dir = path.join(this.root, ARCHIVE_DIRNAME);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return []; // no archive directory is the normal case, not a discrepancy
    }
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => ({ file: `${ARCHIVE_DIRNAME}/${e.name}`, reason: "archived — moved out of the live tree by a human" }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  }

  read(title: string): OstNode {
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw this.noSuchNode(title);
    return deserialize(title, fs.readFileSync(p, "utf8"));
  }

  /** Create a new node file. Throws if a file for this title already exists. */
  createNode(node: OstNode): void {
    assertWritableContent(`the body of "${node.title}"`, node.body);
    for (const tag of node.tags) assertWritableTag(node.title, tag);
    const p = this.nodePath(node.title);
    if (fs.existsSync(p)) {
      throw new Error(`node already exists (create is non-overwriting): ${node.title}`);
    }
    fs.writeFileSync(p, serialize(node), "utf8");
    // The single writer reports the one thing only it can know: that this file now
    // exists because something asked for it. Nothing else in the process can
    // distinguish a node the tree grew from a node that appeared beside it, and a
    // detector that cannot make that distinction is the gap W2 names.
    noteNodeFileCreated(path.basename(p));
  }

  /**
   * Append a prose section to an existing node's file. Strictly grows the file —
   * the prior bytes remain an exact prefix of the new content.
   */
  appendToNode(title: string, section: string): void {
    assertWritableContent(`a section of "${title}"`, section);
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw this.noSuchNode(title);
    const prev = fs.readFileSync(p, "utf8");
    const sep = prev.endsWith("\n") ? "\n" : "\n\n";
    fs.writeFileSync(p, prev + sep + section.trim() + "\n", "utf8");
  }

  /**
   * Append one line under a `## Heading` in a node's body, creating the heading
   * only if it is absent. Grows the file like every other write here — nothing
   * already recorded under that heading is touched.
   */
  appendUnderSection(title: string, heading: string, line: string): void {
    assertWritableContent(`a line under ${heading} of "${title}"`, line);
    const node = this.read(title);
    node.body = appendUnderHeading(node.body, heading, line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /**
   * Everything {@link linkNodes} can refuse, asked BEFORE anything is written.
   *
   * This exists for `ost_create_node`, which writes twice — the new node's file,
   * then the parent's file carrying the edge — and holds no delete with which to
   * undo the first if the second throws. R8's answer is not a rollback (there is
   * none, by design: the vault has no destructive operation) but the other
   * direction — move every failure the attach can have to a moment when nothing
   * has been written yet, so the second write's only remaining failure mode is
   * the filesystem itself.
   *
   * Three checks, each one a real way the attach could have thrown after the
   * node existed: the parent must exist and deserialize (`read`), the child's
   * title must reduce to a name inside the vault root (`nodePath`, which throws
   * on a title that sanitizes empty or escapes), and the parent's file must be
   * writable — the one the caller cannot see coming, since a read-only file is
   * fine for every check up to the moment of the write.
   *
   * What it deliberately does NOT check is the hierarchy or the child's
   * existence: those are the tool surface's judgements (R6), and the fixtures
   * that plant violations for the invariant tests write through this class on
   * purpose. This method answers only "can the edge be written at all".
   */
  assertLinkable(parent: string, child: string): void {
    this.read(parent);
    this.nodePath(child);
    fs.accessSync(this.nodePath(parent), fs.constants.W_OK);
  }

  /** Add a parent→child wikilink edge. Idempotent; adds the link at most once. */
  linkNodes(parent: string, child: string): void {
    const node = this.read(parent);
    // Store the child's canonical (sanitized) title — the name its file is keyed by —
    // so the [[wikilink]] resolves. A raw title containing a stripped character (e.g.
    // ":") would otherwise be written verbatim and dangle. (see test/ost/vault.test.ts)
    const target = sanitizeTitle(child);
    if (node.links.includes(target)) return; // already linked — no-op
    node.links.push(target);
    fs.writeFileSync(this.nodePath(parent), serialize(node), "utf8");
  }

  /**
   * Set a node's status and append the transition to a `## History` section so
   * the prior value stays visible in the note (and always in git).
   */
  setStatus(title: string, status: NodeStatus, note?: string): void {
    assertWritableNote(`the status note on "${title}"`, note);
    const node = this.read(title);
    const prev = node.status ?? "(none)";
    node.status = status;
    const line = `- ${isoToday()} status: ${prev} → ${status}${note ? ` — ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /**
   * Declare which rung of the believability ladder a node rests on, recording the
   * change in History. Existing nodes predate the ladder, so this is how a tree
   * becomes labelled without rewriting or losing anything.
   */
  setEvidence(title: string, evidence: RungId, note?: string): void {
    assertWritableNote(`the evidence note on "${title}"`, note);
    const node = this.read(title);
    const prev = node.evidence ?? "(none)";
    node.evidence = evidence;
    const line = `- ${isoToday()} evidence: ${prev} \u2192 ${evidence}${note ? ` \u2014 ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /**
   * Classify an assumption test into a lane, recording the call in History.
   * Returns the history line that was written. Validation of the lane itself,
   * and of who/why, lives in `ost/lanes.ts` — this is the write.
   */
  setLane(title: string, lane: LaneId, note?: string): string {
    assertWritableNote(`the lane note on "${title}"`, note);
    const node = this.read(title);
    const prev = node.lane ?? "(none)";
    node.lane = lane;
    const line = `- ${isoToday()} lane: ${prev} → ${lane}${note ? ` — ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
    return line;
  }

  /**
   * Attach or replace an assumption test's instrument, recording the change in
   * History. Returns the line written; the command is validated by the caller
   * (`knowledge/instruments.ts`) — this is the write.
   *
   * Replacement is permitted on purpose, and it is the whole reason this exists:
   * a tree can hold hundreds of tests written before instruments did, and every
   * one of them is a dead end until something can go back and give it a command.
   * A test whose instrument is wrong is worth correcting for the same reason.
   *
   * What replacement must never do is carry a permit across. The prior
   * observations stay in the log — the vault is append-only and a run that
   * happened, happened — but they name the command they ran, so
   * {@link ../eval/buildable.ts} stops recognising them the moment the field
   * says something else. Swapping the instrument therefore un-clears the build
   * permit rather than inheriting it, and the test has to be verified again.
   */
  setInstrument(title: string, instrument: string, note?: string): string {
    assertWritableNote(`the instrument note on "${title}"`, note);
    const node = this.read(title);
    const prev = node.instrument ?? "(none)";
    node.instrument = instrument;
    const line = `- ${isoToday()} instrument: ${prev} → ${instrument}${note ? ` — ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
    return line;
  }

  /**
   * Revise the root Outcome node's body in place (human-set mandate tuning).
   * Refuses any non-Outcome node, so the append-only guarantee for regular nodes
   * is untouched; prior mandate text is expected to be carried in `newBody`'s
   * History section (and is always preserved in git).
   */
  setOutcomeBody(title: string, newBody: string): void {
    const node = this.read(title);
    if (node.layer !== "Outcome") {
      throw new Error(`setOutcomeBody only applies to the Outcome node, not a ${node.layer}`);
    }
    node.body = newBody;
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /**
   * Human promotion: set `validated` AND drop the agent-ideated marker.
   *
   * The second bounded exception in this class, alongside `setOutcomeBody`, and
   * for the same reason: it is a human-only write with no tool wrapping it. It is
   * also the only method here that REMOVES anything, so the removal is pinned to
   * one literal — `AGENT_IDEATED_TAG`, never a caller-supplied tag — and every
   * other tag survives.
   *
   * It has to drop the marker as well as set the status, or promotion would
   * manufacture the `no-self-validation` contradiction it exists to resolve.
   * Idempotent by construction, which is how a vault written before B2 gets
   * repaired: promoting an already-validated node still clears the marker.
   */
  promoteToValidated(title: string, by: string, why: string): string {
    const node = this.read(title);
    const prev = node.status ?? "(none)";
    node.tags = node.tags.filter((t) => t !== AGENT_IDEATED_TAG);
    node.status = "validated";
    const line = `- ${isoToday()} status: ${prev} → validated (promoted by ${by}) — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
    return line;
  }

  /** Attach a hygiene/issue annotation under a `## Issues` section. Add-only. */
  annotate(title: string, issue: string): void {
    assertWritableContent(`an annotation on "${title}"`, issue);
    const node = this.read(title);
    node.body = appendUnderHeading(node.body, "## Issues", `- ${isoToday()} ${issue}`);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
  }

  /**
   * Remove one parent→child edge, recording the removal in the parent's History.
   *
   * The operation the root node needed and append-only could not express. A link
   * written by mistake used to be permanent, and a tree whose outcome accumulated
   * every edge any pass ever drew — 87 of them, a third pointing at Solutions and
   * AssumptionTests that belong under an Opportunity — had no way back.
   *
   * Removing an edge cannot lose a node: the child's file is untouched and its
   * other inbound edges are untouched. What it CAN do is orphan the child, which
   * is `ost_check`'s business to report (`opportunity-connected`, `solution-mapped`)
   * rather than this method's to prevent — a caller re-parenting a subtree unlinks
   * before it links, and a writer that refused the first half could never do it.
   */
  detach(parent: string, child: string, why: string): string {
    assertWritableContent(`the reason for unlinking "${child}" from "${parent}"`, why);
    const node = this.read(parent);
    const target = sanitizeTitle(child);
    if (!node.links.includes(target)) {
      throw new Error(`"${parent}" does not link to "${child}" — nothing to unlink`);
    }
    node.links = node.links.filter((l) => l !== target);
    const line = `- ${isoToday()} unlinked [[${target}]] — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(parent), serialize(node), "utf8");
    return line;
  }

  /**
   * Replace a node's prose, keeping its reserved sections verbatim.
   *
   * `newProse` is the body MINUS every reserved block; this reattaches the ones
   * the node already had. That is what makes an edit safe to hand an unattended
   * pass: the agent's content is scanned and refused if it declares a reserved
   * heading (it may not author a measurement), and it never sees the existing
   * blocks in the first place, so it cannot drop one either. The argument is on
   * {@link ./sections.ts} — deleting a `## Results` revokes a permit a human
   * granted, which is the same act as authoring one, pointed the other way.
   *
   * Frontmatter is not touched. Status, evidence, lane and instrument each have
   * their own writer because each records a typed transition in History, and an
   * edit that could set them silently would launder those transitions.
   */
  editProse(title: string, newProse: string, why: string): string {
    assertWritableContent(`the new body of "${title}"`, newProse);
    assertWritableContent(`the reason for editing "${title}"`, why);
    const node = this.read(title);
    const { reserved } = splitReservedSections(node.body);
    node.body = joinReservedSections(newProse, reserved);
    const line = `- ${isoToday()} body edited — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    fs.writeFileSync(this.nodePath(title), serialize(node), "utf8");
    return line;
  }

  /**
   * Fold one node into another and delete the loser's file.
   *
   * The operation the overlap problem actually needed. A tree that may only
   * append answers "these two nodes are the same need" with an annotation on
   * both, which leaves two nodes and adds a third claim; the counters keep
   * counting two, every future pass re-reads both, and the duplication compounds
   * with every pass that cannot resolve it.
   *
   * The split of labour is the point. **Judgement is the caller's**: which node
   * survives, and what the merged prose says, are decisions a program cannot
   * make, so `prose` arrives from whoever called. **Mechanics are this method's**,
   * because they are what a model gets wrong — every inbound edge in the tree is
   * repointed at the survivor, the loser's outbound edges are unioned in, and its
   * reserved blocks are carried across so no recorded result or observed exit
   * code is lost in the fold.
   *
   * Refusals, each a way a merge destroys rather than consolidates:
   *   - a node cannot merge into itself
   *   - the two must share a layer, because an Opportunity folded into a Solution
   *     is not a merge, it is a claim that a need and a way to meet it are one
   *     thing — the confusion the tree exists to keep apart
   *   - the Outcome is never a loser; the root's identity is the mandate
   */
  mergeNodes(from: string, into: string, opts: { prose: string; why: string }): string {
    assertWritableContent(`the merged body of "${into}"`, opts.prose);
    assertWritableContent(`the reason for merging "${from}" into "${into}"`, opts.why);
    if (sanitizeTitle(from) === sanitizeTitle(into)) {
      throw new Error(`refusing to merge "${from}" into itself`);
    }
    const loser = this.read(from);
    const survivor = this.read(into);
    if (loser.layer !== survivor.layer) {
      throw new Error(
        `refusing to merge a ${loser.layer} into a ${survivor.layer}: "${from}" and "${into}" are different ` +
          `kinds of claim, and folding one into the other would assert they are the same thing. ` +
          `Merge is for duplicates within a layer.`,
      );
    }
    if (loser.layer === "Outcome") {
      throw new Error(`refusing to merge the Outcome node "${from}" — the root's identity is the mandate it carries`);
    }
    /*
     * The laundering path, closed where it opens.
     *
     * A merge carries the LOSER's reserved blocks onto the survivor so a result
     * it recorded is not lost with its file — correct for the three measurement
     * headings and catastrophic for the fourth. `## Retraction` carried across
     * would retract the survivor, so `ost_merge_nodes(retracted, live)` would be
     * a delete of an arbitrary live node in one allowlisted call: the exact
     * capability making the heading reserved was meant to withhold, reached by
     * copying it rather than by writing it.
     *
     * Refused in both directions. The loser's case is the attack; the survivor's
     * is the mirror of it — folding a live node into a retracted one buries a
     * node the tree still holds behind a retirement it never had, which is the
     * same loss with the arrow reversed. A human who means to do either retracts
     * the node they mean to retract, by name.
     */
    for (const [role, node] of [["loser", loser] as const, ["survivor", survivor] as const]) {
      if (!isRetractedNode(node)) continue;
      throw new Error(
        `refusing to merge "${from}" into "${into}": the ${role} "${node.title}" is retracted. ` +
          `A merge carries reserved sections onto the survivor, so this would copy a retraction ` +
          `onto a live node — taking it out of every count, scan and gate without anyone retracting it. ` +
          `Retraction is a human's call on the CLI: ost-agent retract "<node>" -b "<who>" -w "<why>".`,
      );
    }

    const loserTitle = sanitizeTitle(from);
    const survivorTitle = sanitizeTitle(into);

    // The survivor's prose is the caller's; both nodes' reserved blocks are kept.
    // The loser's go on last so a result it carried survives the file's deletion.
    const survivorReserved = splitReservedSections(survivor.body).reserved;
    const loserReserved = splitReservedSections(loser.body).reserved;
    survivor.body = joinReservedSections(opts.prose, [...survivorReserved, ...loserReserved]);

    // Outbound edges: union, minus any edge that would now point at the survivor
    // itself (the loser linking to the survivor is the commonest duplicate shape).
    for (const link of loser.links) {
      if (link !== survivorTitle && !survivor.links.includes(link)) survivor.links.push(link);
    }

    const line =
      `- ${isoToday()} merged [[${loserTitle}]] into this node and deleted its file — ${opts.why}` +
      (loserReserved.length > 0 ? ` (carried ${loserReserved.length} reserved section(s) across)` : "");
    survivor.body = appendUnderHeading(survivor.body, "## History", line);
    fs.writeFileSync(this.nodePath(into), serialize(survivor), "utf8");

    // Repoint every inbound edge in the tree. Done after the survivor is written
    // so a crash between the two leaves edges pointing at a node that still
    // exists, rather than at one that does not.
    for (const n of this.readTree()) {
      if (n.title === loserTitle || n.title === survivorTitle) continue;
      if (!n.links.includes(loserTitle)) continue;
      n.links = n.links.filter((l) => l !== loserTitle);
      if (!n.links.includes(survivorTitle)) n.links.push(survivorTitle);
      n.body = appendUnderHeading(
        n.body,
        "## History",
        `- ${isoToday()} link [[${loserTitle}]] repointed to [[${survivorTitle}]] — that node was merged away`,
      );
      fs.writeFileSync(this.nodePath(n.title), serialize(n), "utf8");
    }

    fs.unlinkSync(this.nodePath(from));
    return line;
  }
}

/**
 * Append `line` at the end of `heading`'s section, creating the section if absent.
 *
 * "At the end of the section", not "at the end of the body": a node now carries
 * several growing sections (History, Issues, Results, Uncovered), and appending
 * to the body files each line under whichever section happens to be last. Still
 * strictly additive — no existing line is moved or rewritten.
 */
function appendUnderHeading(body: string, heading: string, line: string): string {
  const trimmed = body.trimEnd();
  const lines = trimmed.split("\n");
  // The WRITER matches the same way the readers do. It used to be trim-equality
  // while `hasRecordedResult` and `countEntriesUnder` were unified onto
  // `isHeadingLine`, and a writer that cannot find the section its readers can
  // see appends a SECOND one — after which `countEntriesUnder`, which stops at
  // the first, counts only half the results. Four matchers, one heading.
  const start = lines.findIndex((l) => isHeadingLine(l, heading));
  if (start === -1) {
    return `${trimmed}\n\n${heading}\n${line}`;
  }
  // The section runs until the next heading of any level, or to the end.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,6}\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  // Sit tight against the last content line so a blank separator stays a separator.
  while (end > start + 1 && lines[end - 1].trim() === "") end--;
  return [...lines.slice(0, end), line, ...lines.slice(end)].join("\n");
}
