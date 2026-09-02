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
import { countOperation } from "../telemetry/operation-budget.js";
import { temporaryWritePath } from "../fs/atomic-write.js";
import { TRACED_NODE_FIELDS, noteNodeFileCreated, noteNodeFileWritten } from "../telemetry/usage.js";
import {
  AGENT_IDEATED_TAG,
  deserialize,
  serialize,
  wrappedLinkTargets,
  type Layer,
  type NodeStatus,
  type OstNode,
  type RepoSight,
  LAYERS,
} from "./node.js";
import { parseFrontmatter } from "./frontmatter.js";
import { quarantineNode, type QuarantinedNode } from "./quarantine.js";
import { foldAuthorship, type Writer } from "./authorship.js";
import { canonicalTitle, fileNameForTitle, sanitizeTitle } from "./sanitize.js";
import { cycleFromAdding } from "./prerequisites.js";
import { isHeadingLine, reservedHeadingIn } from "./headings.js";
import { joinReservedSections, splitReservedSections } from "./sections.js";
import { assertSectionsAccountedFor } from "./section-accounting.js";
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
import { DriftError, readWithHash, writeWithHash } from "../git/read-write-hash-guard.js";
import { Plan } from "./plan.js";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Which of the trace's closed field vocabulary this file's frontmatter carries.
 *
 * `undefined` — not the empty list — when the frontmatter will not parse, and the
 * distinction is the whole reason this returns two kinds of nothing: a file whose
 * YAML is broken holds fields nobody here can enumerate, and calling that "no
 * fields" would report every one of them lost on the next write that repairs it.
 *
 * Defence rather than a live path, and honestly so: every write in this class
 * deserializes the node before it renders one, so a file this cannot parse throws
 * on the READ and never reaches a write. `test/ost/vault-write-census.test.ts`
 * pins that, so if a write path ever stops reading first, the branch is here.
 */
function tracedFields(markdown: string): string[] | undefined {
  try {
    const data = parseFrontmatter(markdown).data as Record<string, unknown>;
    return TRACED_NODE_FIELDS.filter((f) => {
      const value = data[f];
      return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
    });
  } catch {
    return undefined;
  }
}

/**
 * Report one node-file write to the trace: what the file holds now, and what it
 * held before and does not hold now.
 *
 * The single writer reports the one thing only it can know, exactly as it does for
 * `noteNodeFileCreated` — that these bytes replaced those bytes. Nothing downstream
 * can reconstruct it: the vault is committed with `git add -A` after the fact, so a
 * field that vanished between two writes inside one call leaves no trace in the
 * commit trail either. Field NAMES only travel (see {@link TRACED_NODE_FIELDS});
 * no value crosses this boundary.
 */
function reportNodeWrite(filePath: string, before: string[] | undefined, after: string): void {
  const fields = tracedFields(after) ?? [];
  noteNodeFileWritten({
    file: path.basename(filePath),
    fields,
    lost: (before ?? []).filter((f) => !fields.includes(f)),
  });
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

  /**
   * Fold this write's own author into the node, immediately before it is
   * rendered. Returns the node so it can wrap a `serialize` argument in place.
   *
   * The writer is a LITERAL at every call site below, never a value that reached
   * this class from a tool argument, for the reason {@link ./authorship.ts}
   * states: `human` is the flattering label and the agent is the party that
   * benefits from it. Which literal a method passes is decided the same way
   * {@link ./headings.ts} decides who may name a reserved heading — by whether
   * any allowlisted tool can reach the method at all. `promoteToValidated` and
   * `setOutcomeBody` are human-only writers with no tool wrapping them, and
   * `appendUnderSection` takes the choice as a parameter because both a person
   * (`recordResult`, `retractNode`) and a process (`instrument.ts`) come through
   * that door; every other method here is reachable from the tool surface and
   * says `machine`.
   *
   * `linkNodes` deliberately does not stamp: an edge is structure, not prose,
   * and drawing one authors no sentence anybody reads.
   */
  private authoredBy(node: OstNode, writer: Writer): OstNode {
    node.authorship = foldAuthorship(node.authorship, writer);
    return node;
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
   * Absolute path for a node title. Public because {@link Plan} fingerprints files
   * across a whole plan's reads rather than one write's own target, so it needs the
   * same confined resolution this class uses everywhere else rather than a second,
   * unconfined copy of it.
   */
  pathFor(title: string): string {
    return this.nodePath(title);
  }

  /**
   * Begin a plan: a sequence of reads and writes whose premise is pinned at read
   * time. See `./plan.ts` for what that buys over calling this vault's write
   * methods directly — in short, a write refuses once ANY node the plan has read
   * has drifted, not only the write's own target, and stays refused for the rest
   * of the plan once that happens.
   */
  beginPlan(): Plan {
    return new Plan(this);
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

  /**
   * Read all node files at the vault root (skips non-node files and subdirs).
   *
   * A file whose `type:` this reader does not recognise is deliberately NOT here
   * — it is on `readTreeCensus().quarantined`, retained and named, and excluded
   * from every count and gate that reads this array. See {@link ./quarantine.ts}.
   */
  readTree(): OstNode[] {
    return this.readTreeCensus().nodes;
  }

  /** The node-shaped files this reader could not classify. See {@link ./quarantine.ts}. */
  readQuarantined(): QuarantinedNode[] {
    return this.readTreeCensus().quarantined;
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
    countOperation("directoryScan");
    const entries = fs.readdirSync(this.root, { withFileTypes: true });
    const nodes: OstNode[] = [];
    const seenFiles: string[] = [];
    const skipped: CensusDrop[] = [];
    const unreadable: CensusDrop[] = [];
    const quarantined: QuarantinedNode[] = [];
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
        // Counted at the call site, not inferred from `entries.length` — an
        // operation budget derived from a separate walk is a number that can
        // drift away from the reads it claims to describe.
        countOperation("fileRead");
        raw = fs.readFileSync(path.join(this.root, e.name), "utf8");
      } catch (err) {
        unreadable.push({ file: e.name, reason: `could not be read: ${(err as Error).message}` });
        continue;
      }

      let type: unknown;
      let content: string;
      try {
        const parsed = parseFrontmatter(raw);
        type = (parsed.data as Record<string, unknown>).type;
        content = parsed.content;
      } catch (err) {
        // Frontmatter that will not parse. Before the census this threw out of
        // readTree and took every command down with a stack trace that named no
        // file; one malformed node made the whole vault unreadable.
        unreadable.push({ file: e.name, reason: `frontmatter did not parse: ${(err as Error).message}` });
        continue;
      }

      // Two different files land here and they are not the same finding.
      //
      // A file with NO `type:` was never a node — a README, a template, a note
      // beside the vault — and dropping it is right. A file that DECLARES a type
      // this reader does not know is a node this reader cannot classify, and
      // dropping THAT is the defect `./quarantine.ts` exists for: it took a
      // branch of this project's own tree dark and reported the disappearance as
      // nine unrelated orphans. It is quarantined instead — retained, named, and
      // kept out of `nodes` so no count or gate can miscount it.
      if (typeof type !== "string" || !LAYERS.includes(type as Layer)) {
        if (typeof type === "string" && type.trim().length > 0) {
          const held = quarantineNode(e.name, raw, type, content);
          // A retraction outranks quarantine, and by the same argument it
          // outranks everything else here: the heading is unforgeable, so a
          // human who retracted a node meant it whatever its `type:` says.
          if (isRetractedNode(held)) retired.push({ file: e.name, reason: retractionReason(held) });
          else quarantined.push(held);
        } else {
          skipped.push({
            file: e.name,
            reason:
              type === undefined
                ? "no frontmatter `type` — not an OST node"
                : `unrecognised type ${JSON.stringify(String(type))}`,
          });
        }
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

    const census: TreeCensus = { nodes, examined: seenFiles.length, seenFiles, skipped, unreadable, quarantined, retired };
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
    countOperation("fileRead");
    return deserialize(title, fs.readFileSync(p, "utf8"));
  }

  /**
   * The one door every node-file write in this class goes through.
   *
   * It exists so that the before/after field comparison cannot be forgotten at a
   * write site. This class already had fifteen `fs.writeFileSync` calls and gains
   * one whenever a new typed transition does; a census wired into fifteen of them
   * is a census that is wrong at the sixteenth, and wrong silently, which is the
   * exact failure mode it was added to detect. `test/ost/vault-write-census.test.ts`
   * holds the file to having no raw write left.
   *
   * The read-before is unconditional and costs one `readFileSync` per write. That
   * is affordable here — these are single files of a few KB, and every one of them
   * was just read by the method calling this anyway — and it is the only way to
   * know what the bytes held, since the caller hands over a rendered string and no
   * longer has the original.
   *
   * **Staged and renamed rather than written in place.** `writeFileSync` truncates
   * first and writes after, so a process killed between those two leaves a node
   * file shorter than either version — the half-written state the resumable-journal
   * work exists to make impossible. The rename is atomic within the directory, so a
   * reader sees the old bytes or the new ones and a kill costs a temporary file that
   * {@link ../fs/atomic-write.ts}'s sweeper collects. See that module for what this
   * does not buy (durability across a power cut).
   */
  private writeNodeFile(filePath: string, contents: string): void {
    const before = fs.existsSync(filePath) ? tracedFields(fs.readFileSync(filePath, "utf8")) : [];
    const staged = temporaryWritePath(filePath);
    fs.writeFileSync(staged, contents, "utf8");
    fs.renameSync(staged, filePath);
    reportNodeWrite(filePath, before, contents);
  }

  /**
   * Create a new node file. Throws if a file for this title already exists.
   *
   * Stamped `authorship: machine` regardless of what the caller put in the node,
   * for the reason the tag above it is stamped server-side: this is a writer the
   * tool surface reaches, and the caller must not be able to declare its own
   * prose a person's. A node born through a program is the machine's until
   * somebody writes in it.
   */
  createNode(node: OstNode): void {
    assertWritableContent(`the body of "${node.title}"`, node.body);
    for (const tag of node.tags) assertWritableTag(node.title, tag);
    const p = this.nodePath(node.title);
    if (fs.existsSync(p)) {
      throw new Error(`node already exists (create is non-overwriting): ${node.title}`);
    }
    node.authorship = "machine";
    this.writeNodeFile(p, serialize(node));
    // The single writer reports the one thing only it can know: that this file now
    // exists because something asked for it. Nothing else in the process can
    // distinguish a node the tree grew from a node that appeared beside it, and a
    // detector that cannot make that distinction is the gap W2 names.
    noteNodeFileCreated(path.basename(p));
  }

  /**
   * Append a prose section to an existing node's file. Strictly grows the file —
   * the prior bytes remain an exact prefix of the new content.
   *
   * That byte guarantee and the authorship marker pull against each other, and
   * the split here is deliberate. This is the one prose write the tool surface
   * can reach that does not go through `serialize`, so folding `machine` in
   * would mean re-rendering the whole file and the prefix property would be
   * gone from every append. So the file is re-rendered ONLY when the marker
   * would actually move — a node the agent created already reads `machine`, and
   * the append leaves it there, which is the case the prefix property was pinned
   * on. The case that does re-render is the one that matters: the agent adding a
   * section to a node it did not write, which must not go on reading as
   * nobody's or as a person's.
   */
  appendToNode(title: string, section: string): void {
    assertWritableContent(`a section of "${title}"`, section);
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw this.noSuchNode(title);
    const prev = fs.readFileSync(p, "utf8");
    const node = deserialize(title, prev);
    if (foldAuthorship(node.authorship, "machine") !== node.authorship) {
      node.body = `${node.body}\n\n${section.trim()}`;
      this.writeNodeFile(p, serialize(this.authoredBy(node, "machine")));
      return;
    }
    const sep = prev.endsWith("\n") ? "\n" : "\n\n";
    // Goes through the same door as every re-render, even though a strict append
    // provably cannot lose a field: the census is a property of the write site,
    // not of the writer's confidence about what this particular write does.
    this.writeNodeFile(p, prev + sep + section.trim() + "\n");
  }

  /**
   * Append one line under a `## Heading` in a node's body, creating the heading
   * only if it is absent. Grows the file like every other write here — nothing
   * already recorded under that heading is touched.
   *
   * `writer` is the other half of the asymmetry `heading` already carries. Both
   * a person (`recordResult`, `retractNode` — CLI-only, off every allowlist) and
   * a process (`instrument.ts`, filing an exit code it watched) come through this
   * one door, so which of them is writing has to travel with the call. It
   * defaults to `machine`: a caller that says nothing has not established a
   * person, and `human` is the label that must never be reached by omission.
   */
  appendUnderSection(title: string, heading: string, line: string, writer: Writer = "machine"): void {
    assertWritableContent(`a line under ${heading} of "${title}"`, line);
    const node = this.read(title);
    node.body = appendUnderHeading(node.body, heading, line);
    this.writeNodeFile(this.nodePath(title), serialize(this.authoredBy(node, writer)));
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
    this.writeNodeFile(this.nodePath(parent), serialize(node));
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
    this.writeNodeFile(this.nodePath(title), serialize(node));
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
    this.writeNodeFile(this.nodePath(title), serialize(node));
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
    this.writeNodeFile(this.nodePath(title), serialize(node));
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
   *
   * The un-clearing is undone by putting the command back, because the filter is
   * a string match on an append-only log — see {@link ../ost/rearm.ts}, which is
   * where that restore is made conditional on the spec file not having changed
   * underneath it. `rearm` is the clause that ruling wants recorded; this method
   * writes it and reads nothing, because the identity check needs a repository
   * and the vault has none.
   */
  setInstrument(title: string, instrument: string, note?: string, sight?: RepoSight, rearm?: string): string {
    assertWritableNote(`the instrument note on "${title}"`, note);
    const node = this.read(title);
    const prev = node.instrument ?? "(none)";
    node.instrument = instrument;
    // The sight of the WRITE that set this command, replacing whatever the
    // prior write's sight was — the field describes the current instrument,
    // and the History line below is where the old pairing survives.
    if (sight) node.sight = sight;
    // The re-arm clause goes LAST, after the free-text note, so a note that
    // happens to contain the marker cannot displace the real one: the reader
    // takes the largest withholding it finds, and an extra one only ever
    // withholds more.
    const line = `- ${isoToday()} instrument: ${prev} → ${instrument}${sight ? ` [sight: ${sight}]` : ""}${note ? ` — ${note}` : ""}${rearm ?? ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    this.writeNodeFile(this.nodePath(title), serialize(node));
    return line;
  }

  /**
   * Declare that `title` cannot be answered until `prerequisite` is, recording
   * the claim in History. Returns the line written.
   *
   * **The refusals are the point, and there are four.** This is the one edge in
   * the schema that is not parent-child, so it is also the one that can be
   * written into a shape the tree has no other defence against:
   *
   *   - both ends must be assumption tests — an ordering claim about a Solution
   *     is a claim nothing here knows how to read
   *   - a test may not require itself
   *   - the edge may not close a CYCLE, and the refusal names the chain it
   *     collided with. This is the failure mode the field introduces: a cycle is
   *     not a slow ordering, it is an ordering that can never start, and every
   *     test on it is blocked by the tree's own shape forever
   *   - the prerequisite must already exist, so an edge cannot be written onto a
   *     title that will be created later and possibly differently
   *
   * Idempotent: declaring an edge that is already there is a no-op returning the
   * empty string, because the same claim twice is one claim.
   *
   * A cycle written by hand into a file — this is not the only writer a vault has
   * — is caught by `checkInvariants` instead, which is the same division of
   * labour every other structural rule here follows.
   */
  setPrerequisite(title: string, prerequisite: string, note?: string): string {
    assertWritableNote(`the prerequisite note on "${title}"`, note);
    const node = this.read(title);
    if (node.layer !== "AssumptionTest") {
      throw new Error(`"${title}" is a ${node.layer} — a prerequisite orders one AssumptionTest against another`);
    }
    // Sanitized for the same reason `linkNodes` sanitizes: the caller names the
    // title they meant, the tree carries the title the filesystem allowed, and an
    // edge written in the first spelling would never resolve.
    const target = sanitizeTitle(prerequisite);
    if (target === node.title) {
      throw new Error(
        `"${title}" cannot be its own prerequisite — that is an ordering nothing can start, not a slow one`,
      );
    }
    const required = this.read(target);
    if (required.layer !== "AssumptionTest") {
      throw new Error(`"${target}" is a ${required.layer} — a prerequisite orders one AssumptionTest against another`);
    }
    if ((node.prerequisites ?? []).includes(target)) return "";

    const cycle = cycleFromAdding(this.readTree(), node.title, target);
    if (cycle) {
      throw new Error(
        `refusing to make "${target}" a prerequisite of "${title}" — it would close a cycle: ` +
          `${cycle.map((t) => `"${t}"`).join(" requires ")}. Every test on that chain would wait on itself. ` +
          `One of those edges is the wrong one; the tree cannot say which.`,
      );
    }

    node.prerequisites = [...(node.prerequisites ?? []), target];
    const line = `- ${isoToday()} prerequisite: + ${target}${note ? ` — ${note}` : ""}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    this.writeNodeFile(this.nodePath(title), serialize(node));
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
    // A human writer, by construction: `set-outcome` is a CLI command with no
    // tool wrapping it, precisely so the agent can never rewrite its own
    // mandate. The text landing here is the operator's own.
    this.writeNodeFile(this.nodePath(title), serialize(this.authoredBy(node, "human")));
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
    // The named person's own reason goes into the node, so their hand is now in
    // its prose. An agent-created node promoted here reads `mixed` afterwards,
    // never `machine` — inheriting the machine marker across a human's write is
    // the exact failure this field exists to make visible.
    this.writeNodeFile(this.nodePath(title), serialize(this.authoredBy(node, "human")));
    return line;
  }

  /** Attach a hygiene/issue annotation under a `## Issues` section. Add-only. */
  annotate(title: string, issue: string): void {
    assertWritableContent(`an annotation on "${title}"`, issue);
    const node = this.read(title);
    node.body = appendUnderHeading(node.body, "## Issues", `- ${isoToday()} ${issue}`);
    this.writeNodeFile(this.nodePath(title), serialize(this.authoredBy(node, "machine")));
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
    // Quoted, not linked. A History line naming the node in brackets is a second
    // wikilink to it, so the very act of recording a re-parenting used to violate
    // `single-backlink` — and it did, 272 times, in this repository's own vault.
    // The record keeps every word; only the syntax changes.
    const line = `- ${isoToday()} unlinked "${target}" — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    this.writeNodeFile(this.nodePath(parent), serialize(node));
    return line;
  }

  /**
   * Repoint one parent's edge from an old (now-dangling) child title to a new
   * one, recording the repair in the parent's History.
   *
   * The write `findRenameShapedBreaks` / `liveRenameRepairs` exist to license:
   * an edge that used to resolve now points at nothing because the node it
   * named was renamed outside this vault's own tools, and topology — not
   * title similarity — says where it went. Refuses if the parent does not
   * currently link to `from` (nothing to repoint) or if `to` is not a real
   * node here (repointing at nothing would trade one dangling edge for
   * another): both are the caller's evidence to have checked first, and this
   * method re-checks rather than trusting a stale answer.
   */
  repointEdge(parent: string, from: string, to: string, why: string): string {
    assertWritableContent(`the reason for repointing "${from}" to "${to}" under "${parent}"`, why);
    const node = this.read(parent);
    const oldTarget = sanitizeTitle(from);
    const newTarget = sanitizeTitle(to);
    if (!node.links.includes(oldTarget)) {
      throw new Error(`"${parent}" does not link to "${from}" — nothing to repoint`);
    }
    if (!this.has(newTarget)) {
      throw new Error(`repoint target does not exist: "${to}"`);
    }
    node.links = node.links.map((l) => (l === oldTarget ? newTarget : l));
    const line = `- ${isoToday()} repointed "${oldTarget}" → "${newTarget}" — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    this.writeNodeFile(this.nodePath(parent), serialize(node));
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
   *
   * Carries a content hash from the read here to the write: a full-body
   * replace is the one write on this file that can silently discard
   * something, so if the file on disk has moved since this method read it —
   * a human editing the vault in Obsidian, a second agent process, another
   * tool call landing between the read and this write — the write refuses,
   * naming what drifted, instead of overwriting whatever arrived.
   *
   * Read that window narrowly, because it is narrow: the hash compared is the
   * one THIS METHOD took, microseconds before the write, not the one the agent
   * took when it read the node to decide what to say. A second writer that
   * lands in between those two reads is invisible here. Widening it means
   * carrying a fingerprint across the tool boundary, which is a change to the
   * `ost_edit_node` surface, not to this method.
   *
   * The drift guard answers "did the file move since I read it". It does not
   * answer "did the caller know what was in it", and those are different losses:
   * a rewrite composed from a title alone drifts nothing and still drops every
   * `## Section` it failed to reproduce. `dropping` is the second answer — every
   * stored section must be reproduced in `newProse` or named there, and one in
   * neither is refused by name ({@link ./section-accounting.ts}) before anything
   * is composed. Reserved sections are not accountable and cannot be dropped;
   * they are reattached below regardless of what either argument says.
   */
  editProse(title: string, newProse: string, why: string, dropping: readonly string[] = []): string {
    assertWritableContent(`the new body of "${title}"`, newProse);
    assertWritableContent(`the reason for editing "${title}"`, why);
    const p = this.nodePath(title);
    if (!fs.existsSync(p)) throw this.noSuchNode(title);
    const read = readWithHash(p);
    const node = deserialize(title, read.content);
    const removed = assertSectionsAccountedFor(title, node.body, newProse, dropping);
    const { reserved } = splitReservedSections(node.body);
    node.body = joinReservedSections(newProse, reserved);
    // A deliberate removal is still a removal, and this vault's rule is that every
    // one of them writes the line that explains it. Naming the sections in History
    // is what makes a drop auditable from the node itself rather than from `git
    // log` — the same reason `detach` and `mergeNodes` name what they took.
    const line =
      removed.length > 0
        ? `- ${isoToday()} body edited, dropping ${removed.map((h) => `\`${h}\``).join(", ")} — ${why}`
        : `- ${isoToday()} body edited — ${why}`;
    node.body = appendUnderHeading(node.body, "## History", line);
    const rendered = serialize(this.authoredBy(node, "machine"));
    try {
      // The one write that does not go through `writeNodeFile`, because it must
      // carry the drift guard's hash. It reports by hand instead, from the content
      // the guard already read — which is a better `before` than a second
      // `readFileSync` would be, since it is the exact bytes the write is checked
      // against rather than whatever is on disk a moment later.
      writeWithHash(p, rendered, read);
      reportNodeWrite(p, tracedFields(read.content), rendered);
    } catch (err) {
      if (err instanceof DriftError) {
        // No "re-read the node" any more. The DriftError now quotes what the
        // node holds at the place that moved, so the correction travels with
        // the refusal; sending the caller back to the file for an answer it is
        // already holding is the cost `../fs/current-text.ts` exists to remove.
        throw new Error(`cannot edit "${title}": ${err.message}`);
      }
      throw err;
    }
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
   * This is the REPLACEMENT shape, and taking the survivor's whole body is what
   * makes it dangerous to a caller who has not read that body. It is no longer
   * the tool surface: `ost_merge_nodes` calls {@link Vault.mergeNodesByPatch}
   * instead, and this remains as the library/CLI shape for a human who has read
   * both nodes and is genuinely rewriting the survivor's claim.
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
    return this.fold(from, into, opts.why, () => opts.prose);
  }

  /**
   * Fold one node into another WITHOUT asking for the survivor's body.
   *
   * The same operation as {@link Vault.mergeNodes} in everything a gate, a
   * counter or the graph can see — identical refusals, identical inbound
   * repointing, identical outbound union, identical carry of reserved sections,
   * identical History line, same deleted file. Both shapes run {@link Vault.fold}
   * and differ in exactly one expression: what the survivor's prose becomes.
   *
   * The difference is the whole point. `mergeNodes` takes the survivor's
   * COMPLETE merged body, which means a caller who never read the survivor can
   * replace prose it has never seen with a paragraph composed from a title —
   * silently, and with no way for the vault to tell that from a real rewrite.
   * This shape takes only what the LOSER contributes and appends it under a
   * dated heading. The survivor's existing prose is not an argument, so there is
   * no call a caller can make that puts it at risk. That is a removal of the
   * failure mode rather than a guard against it, which is worth more because it
   * cannot be skipped.
   *
   * What it costs, stated plainly because the tool surface does not say it: a
   * node merged three times reads as an original plus three appended
   * contributions rather than as one coherent claim. Tidying that up is a
   * genuine rewrite and belongs to `ost_edit_node`, whose caller has to read the
   * body first.
   */
  mergeNodesByPatch(from: string, into: string, opts: { contribution: string; why: string }): string {
    assertWritableContent(`the contribution "${from}" brings to "${into}"`, opts.contribution);
    return this.fold(from, into, opts.why, (survivorProse, loserTitle) => {
      const heading = `### Merged from "${loserTitle}" — ${isoToday()}`;
      return [survivorProse.trimEnd(), heading, opts.contribution.trim()].filter((p) => p !== "").join("\n\n");
    });
  }

  /**
   * The mechanics both merge shapes share, parameterised on the one thing they
   * disagree about.
   *
   * `composeProse` receives the survivor's CURRENT prose (reserved sections
   * already held aside) and the loser's sanitised title, and returns the prose
   * the survivor ends up with. Every other decision — which edges move, which
   * sections carry, what History records — is made here once, and which merges
   * are refused is made once in {@link Vault.assertFoldable}, which this calls
   * before it touches anything. So "the two shapes agree" is a property of there
   * being one implementation rather than of a test noticing when they stop.
   */
  private fold(
    from: string,
    into: string,
    why: string,
    composeProse: (survivorProse: string, loserTitle: string) => string,
  ): string {
    assertWritableContent(`the reason for merging "${from}" into "${into}"`, why);
    this.assertFoldable(from, into);
    const loser = this.read(from);
    const survivor = this.read(into);

    const loserTitle = sanitizeTitle(from);
    const survivorTitle = sanitizeTitle(into);

    // The survivor's prose is `composeProse`'s; both nodes' reserved blocks are
    // kept. The loser's go on last so a result it carried survives the deletion.
    const survivorSplit = splitReservedSections(survivor.body);
    const survivorReserved = survivorSplit.reserved;
    const loserReserved = splitReservedSections(loser.body).reserved;
    survivor.body = joinReservedSections(composeProse(survivorSplit.prose, loserTitle), [
      ...survivorReserved,
      ...loserReserved,
    ]);

    // Outbound edges: union, minus any edge that would now point at the survivor
    // itself (the loser linking to the survivor is the commonest duplicate shape).
    for (const link of loser.links) {
      if (link !== survivorTitle && !survivor.links.includes(link)) survivor.links.push(link);
    }

    const line =
      `- ${isoToday()} merged "${loserTitle}" into this node and deleted its file — ${why}` +
      (loserReserved.length > 0 ? ` (carried ${loserReserved.length} reserved section(s) across)` : "");
    survivor.body = appendUnderHeading(survivor.body, "## History", line);
    // The survivor's prose is the caller's — the agent's — so it folds `machine`
    // in. The loser's marker does not travel with its reserved sections: those
    // are measurements, and a merge that could import a `human` marker along
    // with them would be a way to have the agent's prose read as a person's by
    // choosing what to fold into it.
    this.writeNodeFile(this.nodePath(into), serialize(this.authoredBy(survivor, "machine")));

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
        `- ${isoToday()} link "${loserTitle}" repointed to "${survivorTitle}" — that node was merged away`,
      );
      this.writeNodeFile(this.nodePath(n.title), serialize(n));
    }

    fs.unlinkSync(this.nodePath(from));
    return line;
  }

  /**
   * Every way a merge destroys rather than consolidates, asked WITHOUT writing.
   *
   * Extracted from {@link Vault.fold} rather than copied out of it, and `fold`
   * still calls it first, so there is exactly one statement of these rules. The
   * separation exists because the tool surface has a refusal of its own to order
   * against them (`security/tools.ts:assertSurvivorRead`): a merge this method
   * refuses can never succeed, so telling that caller to go and read the survivor
   * first would spend a call to arrive at a no that was already true. A caller
   * that only wants to know can ask here and write nothing.
   *
   * The refusals:
   *   - a node cannot merge into itself
   *   - the two must share a layer, because an Opportunity folded into a Solution
   *     is not a merge, it is a claim that a need and a way to meet it are one
   *     thing — the confusion the tree exists to keep apart
   *   - the Outcome is never a loser; the root's identity is the mandate
   *   - neither side may be retracted, in either direction (see below)
   */
  assertFoldable(from: string, into: string): void {
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
