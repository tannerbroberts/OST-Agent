/**
 * Append-only vault operations over the filesystem.
 *
 * Every method here is add-only by construction: it creates a new node, appends
 * to a node, adds a link/status-transition/annotation, or reads. There is NO
 * delete, NO rename, and NO truncating rewrite. All paths are confined to the
 * vault root. This class is the ONLY thing that touches node files on disk, and
 * it is what the allowlist tool registry wraps — so the agent cannot express a
 * destructive operation because none exists here to call.
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
import { fileNameForTitle, sanitizeTitle } from "./sanitize.js";
import { isHeadingLine, reservedHeadingIn } from "./headings.js";
import { ARCHIVE_DIRNAME, withoutRetiredNodes, type CensusDrop, type TreeCensus } from "./census.js";
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
        type = (matter(raw).data as Record<string, unknown>).type;
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

      try {
        nodes.push(deserialize(e.name.replace(/\.md$/, ""), raw));
      } catch (err) {
        unreadable.push({ file: e.name, reason: (err as Error).message });
      }
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
    if (!fs.existsSync(p)) throw new Error(`no such node: ${title}`);
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
    if (!fs.existsSync(p)) throw new Error(`no such node: ${title}`);
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
