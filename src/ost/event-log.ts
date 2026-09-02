/**
 * The event vocabulary a vault's history expresses in, and the projector that
 * folds it back into a tree.
 *
 * This is the feasibility half of "The log is the agent — an event-sourced graph
 * the whole tree is projected from" (meta vault). The architecture that node
 * proposes inverts the store: an append-only log becomes the source of truth and
 * the Markdown tree becomes a deterministic projection of it. Before any of that
 * is worth building, one question has to be answered against real history — *can
 * this tree be expressed as an event log at all?* — and that is what lives here.
 *
 * **Two things, deliberately separate.**
 *
 *   - {@link expressCommit} attempts the decomposition: given what one commit did
 *     to the files, and the writer its subject declares, produce the events that
 *     describe it. It is allowed to fail, and its failures are the measurement.
 *   - {@link projectEvents} is the projector: a pure fold from events to files,
 *     with no knowledge of git, diffs, or which commit anything came from.
 *
 * **The rule that keeps this from measuring nothing.** A vocabulary rich enough
 * to carry arbitrary bytes expresses every history perfectly and says nothing.
 * Two constraints stop that:
 *
 *   1. **The writer licenses the event, not the bytes.** Every commit in this
 *      vault names its writer in the subject (`mcp: ost_set_status — …`). That
 *      name fixes which event types the diff may be expressed with
 *      ({@link LICENSED}). A diff that would need `node.edited` — the one event
 *      carrying whole content, because `ost_edit_node` genuinely takes whole
 *      content — is residue unless the commit says `ost_edit_node` ran.
 *   2. **A semantic event carries its argument, not its result.** `node.appended`
 *      carries the appended text and nothing else; `node.linked` carries a title
 *      and no position. The projector has to re-derive the bytes from the tool's
 *      own rule, so an event that does not actually reconstruct the file is
 *      caught rather than accepted.
 *
 * A change that survives neither is recorded as {@link residueOf} — a marker that
 * carries the literal bytes so the fold can continue past it. Residue markers are
 * not vocabulary: they are the count the assumption test is asking for.
 */
import { FRONTMATTER_FIELDS } from "./node.js";

/** A projection: vault-relative path → file content. Absent key means no file. */
export type Projection = Map<string, string>;

/**
 * The closed event vocabulary, one type per mutation the vault's writers perform.
 *
 * `residue.*` is the exception and is not part of the vocabulary — see the module
 * doc. Every other member's payload is the argument its writer received, never the
 * file that came out.
 */
export type OstEvent =
  /** A node file came into existence with this content (`ost_create_node`, `ost_ingest_inbox`). */
  | { readonly type: "node.created"; readonly path: string; readonly content: string }
  /** A node file ceased to exist (`ost_merge_nodes` retiring its loser). */
  | { readonly type: "node.removed"; readonly path: string }
  /** Text appended at the end of a node (`ost_append_to_node`, the loop's recorder). */
  | { readonly type: "node.appended"; readonly path: string; readonly text: string }
  /**
   * Lines appended to the end of one `## ` section, creating it if the node does
   * not carry it yet (`ost_annotate` into `## Issues`, a field-setter's note into
   * `## History`). Distinct from `node.appended` because these writers target a
   * section rather than the file, and a node whose `## Issues` is followed by
   * three more sections takes the write in the middle.
   */
  | { readonly type: "node.sectionAppended"; readonly path: string; readonly heading: string; readonly lines: readonly string[] }
  /** A wikilink added to a node's link block (`ost_link_nodes`, and the parent half of a create). */
  | { readonly type: "node.linked"; readonly path: string; readonly title: string }
  /** A wikilink removed from a node's link block (`ost_detach_nodes`). */
  | { readonly type: "node.unlinked"; readonly path: string; readonly title: string }
  /**
   * One frontmatter field set, cleared, or introduced (`ost_set_status`,
   * `ost_set_evidence`, `ost_set_instrument`). `lines` is the field's rendered
   * YAML block — its `key:` line plus any continuation lines — or null to remove
   * the field. A field is the smallest thing a writer sets, so this is the
   * argument; the surrounding frontmatter is not carried.
   */
  | { readonly type: "node.fieldSet"; readonly path: string; readonly key: string; readonly lines: readonly string[] | null }
  /** The tag line rewritten, which is how a status change reaches the body (`#Solution #shipped …`). */
  | { readonly type: "node.retagged"; readonly path: string; readonly line: string }
  /** A node's whole content replaced — the one whole-content event, licensed only to the writers that take one. */
  | { readonly type: "node.edited"; readonly path: string; readonly content: string }
  /** Not vocabulary. A change no event above described, carried verbatim so the fold survives it. */
  | { readonly type: "residue.write"; readonly path: string; readonly content: string }
  | { readonly type: "residue.remove"; readonly path: string };

export type OstEventType = OstEvent["type"];

/** Is this event a residue marker rather than a member of the vocabulary? */
export function isResidue(event: OstEvent): boolean {
  return event.type === "residue.write" || event.type === "residue.remove";
}

/**
 * The writers this vault's history contains, read off the commit subject.
 *
 * The eleven `ost_*` entries are the mutating MCP surface. `loop.observe` is the
 * build loop's own instrument recorder (`chore(instruments): …`), which is a
 * closed machine operation and belongs in the vocabulary for the same reason the
 * MCP tools do — the parent node's list of seven was written before it existed.
 * `unknown` is everything else: hand edits, migrations, bulk repairs, and the
 * scaffolding passes that predate the MCP surface. It licenses nothing, on
 * purpose, because "a human opened the file" is exactly the case this test was
 * built to find.
 */
export type DeclaredWriter =
  | "ost_create_node"
  | "ost_append_to_node"
  | "ost_link_nodes"
  | "ost_detach_nodes"
  | "ost_set_status"
  | "ost_set_evidence"
  | "ost_set_instrument"
  | "ost_annotate"
  | "ost_edit_node"
  | "ost_merge_nodes"
  | "ost_ingest_inbox"
  | "loop.observe"
  /**
   * A merge commit reconciling two lines of writes. Not a writer and not a tool —
   * named so the reconciliation can be carried in the log rather than lost.
   *
   * The assumption test's method excludes merges from the commits it counts, and
   * {@link residueCensus} honours that. They cannot be excluded from the *fold*:
   * a whole-file residue snapshot taken on one branch reverts work done on
   * another, and without the merge that reconciled them the projection settles on
   * a tree that never existed. Every merge is residue by construction — nothing
   * about resolving a conflict is a tool call — which is itself the finding.
   */
  | "git.merge"
  | "unknown";

/**
 * Which event types each writer may express a diff with.
 *
 * **`node.fieldSet` is on almost every row, and that is a finding rather than a
 * convenience.** Every mutating tool reads the node, changes it, and writes it
 * back through `serialize`, so each one also normalises frontmatter on its way
 * past: `ost_append_to_node` stamps `authorship`, and `ost_create_node` moves the
 * parent's `evidence` field into canonical order while adding a link. Neither
 * commit's subject says so. The vocabulary the solution node sketched — one event
 * per tool — does not survive contact with that, and this is where it shows.
 *
 * What stays gated is `node.edited`, the one event carrying whole content. Only
 * the two writers that genuinely take a whole node may use it; anything else that
 * would need it is residue, which is what keeps the count from being free.
 */
export const LICENSED: Readonly<Record<DeclaredWriter, readonly OstEventType[]>> = {
  // A create writes the new node and links it under its parent — and re-renders
  // the parent's frontmatter on the way past.
  ost_create_node: ["node.created", "node.linked", "node.fieldSet"],
  ost_append_to_node: ["node.appended", "node.sectionAppended", "node.fieldSet"],
  ost_link_nodes: ["node.linked", "node.fieldSet"],
  ost_detach_nodes: ["node.unlinked", "node.appended", "node.sectionAppended", "node.fieldSet"],
  // Setting a field also stamps the change into ## History and can rewrite the
  // tag line, because the status tag is derived from the field.
  ost_set_status: ["node.fieldSet", "node.retagged", "node.appended", "node.sectionAppended"],
  ost_set_evidence: ["node.fieldSet", "node.retagged", "node.appended", "node.sectionAppended"],
  ost_set_instrument: ["node.fieldSet", "node.appended", "node.sectionAppended"],
  ost_annotate: ["node.appended", "node.sectionAppended", "node.fieldSet"],
  // The two writers that genuinely take whole content.
  ost_edit_node: ["node.edited", "node.appended", "node.fieldSet"],
  ost_merge_nodes: ["node.edited", "node.appended", "node.linked", "node.unlinked", "node.removed"],
  ost_ingest_inbox: ["node.created", "node.linked", "node.appended", "node.sectionAppended", "node.fieldSet"],
  "loop.observe": ["node.appended", "node.sectionAppended", "node.fieldSet"],
  "git.merge": [],
  unknown: [],
};

/**
 * The writer a commit subject declares, or `unknown`.
 *
 * Read off the subject rather than inferred from the diff: inferring it from the
 * bytes would let every diff pick the event type that happens to fit it, which is
 * the degenerate vocabulary this whole measurement exists to avoid.
 */
export function declaredWriter(subject: string): DeclaredWriter {
  const mcp = /^mcp:\s+(ost_[a-z_]+)\b/.exec(subject);
  if (mcp) {
    const name = mcp[1] as DeclaredWriter;
    return name in LICENSED ? name : "unknown";
  }
  if (/^chore\(instruments\):/.test(subject)) return "loop.observe";
  return "unknown";
}

/** What one commit did to one file. `null` on either side means "did not exist". */
export interface FileChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** One commit, reduced to the writer it declares and the files it touched. */
export interface CommitChange {
  readonly sha: string;
  readonly subject: string;
  readonly files: readonly FileChange[];
  /** Overrides the subject-declared writer. Only merges need it — they declare nothing. */
  readonly writer?: DeclaredWriter;
}

/** The decomposition of one commit: its events, and the paths that left residue. */
export interface Expression {
  readonly sha: string;
  readonly writer: DeclaredWriter;
  readonly events: readonly OstEvent[];
  /** Paths whose change no licensed event described. Empty means the commit is expressible. */
  readonly residue: readonly string[];
}

// ---------------------------------------------------------------------------
// The projector
// ---------------------------------------------------------------------------

/**
 * Fold a log into a tree. Pure: same events in, same files out, no clock, no
 * filesystem, no git. This is the function the architecture rests on, and the
 * only one a projection is allowed to be computed by.
 */
export function projectEvents(events: Iterable<OstEvent>): Projection {
  const files: Projection = new Map();
  for (const event of events) applyEvent(files, event);
  return files;
}

/** Apply one event to a projection in place. */
export function applyEvent(files: Projection, event: OstEvent): void {
  switch (event.type) {
    case "node.created":
    case "node.edited":
    case "residue.write":
      files.set(event.path, event.content);
      return;
    case "node.removed":
    case "residue.remove":
      files.delete(event.path);
      return;
    case "node.appended":
      files.set(event.path, (files.get(event.path) ?? "") + event.text);
      return;
    case "node.sectionAppended":
      files.set(event.path, withSectionLines(files.get(event.path) ?? "", event.heading, event.lines));
      return;
    case "node.linked":
      files.set(event.path, withLink(files.get(event.path) ?? "", event.title));
      return;
    case "node.unlinked":
      files.set(event.path, withoutLink(files.get(event.path) ?? "", event.title));
      return;
    case "node.fieldSet":
      files.set(event.path, withField(files.get(event.path) ?? "", event.key, event.lines));
      return;
    case "node.retagged":
      files.set(event.path, withTagLine(files.get(event.path) ?? "", event.line));
      return;
  }
}

// ---------------------------------------------------------------------------
// The tool rules the projector re-derives bytes with
// ---------------------------------------------------------------------------

const WIKILINK = /^\[\[(.+)\]\]$/;

/** Index of the tag line — the first body line starting `#` — or -1. */
function tagLineIndex(lines: readonly string[], bodyStart: number): number {
  for (let i = bodyStart; i < lines.length; i++) {
    if (lines[i].startsWith("#")) return i;
    if (lines[i].trim() !== "") return -1;
  }
  return -1;
}

/**
 * Where a node's link block ends: the tag line is followed by a contiguous run of
 * `[[…]]` lines, and a new link goes on the end of that run. This is
 * `serialize`'s own layout (`src/ost/node.ts`), which is what makes the position
 * derivable rather than something the event has to carry.
 */
function linkBlockEnd(lines: readonly string[], tagAt: number): number {
  let end = tagAt + 1;
  while (end < lines.length && WIKILINK.test(lines[end])) end++;
  return end;
}

function withLink(content: string, title: string): string {
  const lines = content.split("\n");
  const tagAt = tagLineIndex(lines, frontmatterEnd(lines));
  if (tagAt < 0) return content;
  lines.splice(linkBlockEnd(lines, tagAt), 0, `[[${title}]]`);
  return lines.join("\n");
}

function withoutLink(content: string, title: string): string {
  const lines = content.split("\n");
  const at = lines.indexOf(`[[${title}]]`);
  if (at < 0) return content;
  lines.splice(at, 1);
  return lines.join("\n");
}

/**
 * Append lines to the end of a `## ` section, creating the section at the end of
 * the node when it is not there yet.
 *
 * "The end of the section" is the last line of it that carries anything: an
 * annotation lands under the existing bullets and above the blank line that
 * separates the section from the next heading, which is where `ost_annotate`
 * puts it.
 */
function withSectionLines(content: string, heading: string, added: readonly string[]): string {
  const lines = content.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) {
    let tail = lines.length;
    while (tail > 0 && lines[tail - 1].trim() === "") tail--;
    lines.splice(tail, 0, "", heading, ...added);
    return lines.join("\n");
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  while (end > start + 1 && lines[end - 1].trim() === "") end--;
  lines.splice(end, 0, ...added);
  return lines.join("\n");
}

function withTagLine(content: string, line: string): string {
  const lines = content.split("\n");
  const tagAt = tagLineIndex(lines, frontmatterEnd(lines));
  if (tagAt < 0) return content;
  lines[tagAt] = line;
  return lines.join("\n");
}

/**
 * First body line index — past a leading `---` frontmatter block if there is one.
 * Zero means the file carries no frontmatter, so there is no field to set and no
 * offset to skip.
 */
function frontmatterEnd(lines: readonly string[]): number {
  if (lines[0] !== "---") return 0;
  for (let i = 1; i < lines.length; i++) if (lines[i] === "---") return i + 1;
  return 0;
}

/**
 * The line span one frontmatter field occupies: its `key:` line plus the
 * continuation lines YAML indents beneath it (a `>-` block, a list). Returns null
 * when the field is absent.
 */
function fieldSpan(lines: readonly string[], key: string): { start: number; end: number } | null {
  const end = frontmatterEnd(lines);
  if (end === 0) return null;
  for (let i = 1; i < end - 1; i++) {
    if (!lines[i].startsWith(`${key}:`)) continue;
    let stop = i + 1;
    while (stop < end - 1 && /^\s/.test(lines[stop])) stop++;
    return { start: i, end: stop };
  }
  return null;
}

function withField(content: string, key: string, replacement: readonly string[] | null): string {
  const lines = content.split("\n");
  const span = fieldSpan(lines, key);
  if (span) {
    lines.splice(span.start, span.end - span.start, ...(replacement ?? []));
  } else if (replacement) {
    lines.splice(insertionPointFor(lines, key), 0, ...replacement);
  }
  return lines.join("\n");
}

/**
 * Where a field the node does not carry yet goes: the position
 * {@link FRONTMATTER_FIELDS} puts it in, which is the order `serialize` renders.
 * A newly-set `instrument` lands between `threshold` and `sight`, not on the end
 * of the block — getting that wrong is a byte difference, and the whole point of
 * the strict clause is that a byte difference counts.
 */
function insertionPointFor(lines: readonly string[], key: string): number {
  const end = frontmatterEnd(lines);
  if (end === 0) return 0;
  const rank = FRONTMATTER_FIELDS.indexOf(key as (typeof FRONTMATTER_FIELDS)[number]);
  // A field the serializer does not know goes last, which is where an unknown key
  // ends up when gray-matter re-emits frontmatter it did not author.
  if (rank < 0) return end - 1;
  for (let i = 1; i < end - 1; i++) {
    const other = /^([A-Za-z][A-Za-z0-9_]*):/.exec(lines[i]);
    if (!other) continue;
    const otherRank = FRONTMATTER_FIELDS.indexOf(other[1] as (typeof FRONTMATTER_FIELDS)[number]);
    if (otherRank > rank) return i;
  }
  return end - 1;
}

// ---------------------------------------------------------------------------
// The decomposition
// ---------------------------------------------------------------------------

/**
 * Express one commit as events, recording every file the vocabulary could not
 * describe.
 *
 * Every emitted sequence is verified by replaying it: the events are applied to
 * the file as it stood before the commit and the result is compared to the file
 * as it stood after, byte for byte. An event that does not reconstruct is not an
 * expression of the change, however plausible it looks, so it falls to residue.
 */
export function expressCommit(commit: CommitChange): Expression {
  const writer = commit.writer ?? declaredWriter(commit.subject);
  const licensed = new Set(LICENSED[writer]);
  const events: OstEvent[] = [];
  const residue: string[] = [];

  for (const file of commit.files) {
    const expressed = expressChange(file, licensed);
    if (expressed) {
      events.push(...expressed);
    } else {
      residue.push(file.path);
      events.push(residueOf(file));
    }
  }
  return { sha: commit.sha, writer, events, residue };
}

/** The marker for a change no event described — the bytes, so the fold survives. */
export function residueOf(file: FileChange): OstEvent {
  return file.after === null
    ? { type: "residue.remove", path: file.path }
    : { type: "residue.write", path: file.path, content: file.after };
}

/**
 * The events describing one file's change, or null when the licensed vocabulary
 * cannot describe it.
 */
export function expressChange(file: FileChange, licensed: ReadonlySet<OstEventType>): OstEvent[] | null {
  const { path, before, after } = file;
  if (before === after) return [];

  if (before === null) {
    if (after === null || !licensed.has("node.created")) return null;
    return [{ type: "node.created", path, content: after }];
  }
  if (after === null) {
    return licensed.has("node.removed") ? [{ type: "node.removed", path }] : null;
  }

  const candidate = describe(path, before, after, licensed);
  if (!candidate) return null;

  // The verification that makes the count mean something.
  const replayed: Projection = new Map([[path, before]]);
  for (const event of candidate) applyEvent(replayed, event);
  return replayed.get(path) === after ? candidate : null;
}

/** Propose events for a modification, without verifying them. */
function describe(path: string, before: string, after: string, licensed: ReadonlySet<OstEventType>): OstEvent[] | null {
  // The commonest change in this vault by a wide margin: text landed on the end.
  if (licensed.has("node.appended") && after.startsWith(before)) {
    return [{ type: "node.appended", path, text: after.slice(before.length) }];
  }

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const hunks = diffLines(beforeLines, afterLines);
  const events: OstEvent[] = [];

  for (let i = 0; i < hunks.length; i++) {
    const described = describeHunk(path, hunks[i], beforeLines, licensed);
    if (described) {
      events.push(...described);
      continue;
    }

    // A pure insertion in last position is an append — but only if it really is
    // the tail, and the honest way to ask that is to apply what is described so
    // far and see whether the rest of the file is a suffix of it. Line arithmetic
    // gets this wrong whenever the file's trailing newline puts an empty line
    // after the insertion, which in this vault is always.
    if (i === hunks.length - 1 && hunks[i].removed.length === 0 && licensed.has("node.appended")) {
      const partial: Projection = new Map([[path, before]]);
      for (const event of events) applyEvent(partial, event);
      const mid = partial.get(path)!;
      if (after.startsWith(mid)) {
        events.push({ type: "node.appended", path, text: after.slice(mid.length) });
        return events;
      }
    }

    // The whole-content fallback, and the reason it is gated on the writer: only
    // a writer that actually takes a whole node may express a change this way.
    return licensed.has("node.edited") ? [{ type: "node.edited", path, content: after }] : null;
  }
  return events.length > 0 ? events : null;
}

function describeHunk(
  path: string,
  hunk: Hunk,
  beforeLines: readonly string[],
  licensed: ReadonlySet<OstEventType>,
): OstEvent[] | null {
  const { removed, added } = hunk;

  // Links in and out of the link block.
  if (removed.length === 0 && added.length > 0 && added.every((l) => WIKILINK.test(l))) {
    if (!licensed.has("node.linked")) return null;
    return added.map((l) => ({ type: "node.linked", path, title: WIKILINK.exec(l)![1] }) as OstEvent);
  }
  if (added.length === 0 && removed.length > 0 && removed.every((l) => WIKILINK.test(l))) {
    if (!licensed.has("node.unlinked")) return null;
    return removed.map((l) => ({ type: "node.unlinked", path, title: WIKILINK.exec(l)![1] }) as OstEvent);
  }

  const frontEnd = frontmatterEnd(beforeLines);
  const inFrontmatter = frontEnd > 0 && hunk.beforeStart < frontEnd;

  // Frontmatter fields set, cleared, or introduced — one event each. A hunk here
  // routinely spans two of them, because setting a field re-renders the block and
  // the same hunk carries both the field that moved and the field that arrived.
  if (inFrontmatter && licensed.has("node.fieldSet")) {
    const gone = splitFields(removed);
    const arrived = splitFields(added);
    if (!gone || !arrived) return null;
    const events: OstEvent[] = [];
    for (const [key] of gone) {
      if (!arrived.some(([k]) => k === key)) events.push({ type: "node.fieldSet", path, key, lines: null });
    }
    for (const [key, lines] of arrived) events.push({ type: "node.fieldSet", path, key, lines });
    return events.length > 0 ? events : null;
  }

  // The tag line, which a status or evidence change rewrites in place.
  if (removed.length === 1 && added.length === 1 && removed[0].startsWith("#") && added[0].startsWith("#")) {
    return licensed.has("node.retagged") ? [{ type: "node.retagged", path, line: added[0] }] : null;
  }

  // Lines landing at the end of a `## ` section. Proposed from the enclosing
  // heading alone; whether the insertion really is at that section's end is
  // settled by the replay in `expressChange`, not guessed at here.
  if (removed.length === 0 && added.length > 0 && licensed.has("node.sectionAppended")) {
    const heading = enclosingHeading(beforeLines, hunk.beforeStart);
    if (heading !== null) return [{ type: "node.sectionAppended", path, heading, lines: [...added] }];
  }

  return null;
}

/** The `## ` heading a line sits under, or null when it sits above the first one. */
function enclosingHeading(lines: readonly string[], at: number): string | null {
  for (let i = Math.min(at, lines.length) - 1; i >= 0; i--) {
    if (lines[i].startsWith("## ")) return lines[i];
  }
  return null;
}

const FIELD_KEY = /^([A-Za-z][A-Za-z0-9_]*):/;

/**
 * Split rendered frontmatter lines into the fields they render: a `key:` line
 * plus the indented continuations YAML writes beneath it (a `>-` block, a list).
 * Null when the lines are not whole fields — a hunk that starts mid-field is not
 * a field set, whatever else it might be.
 */
function splitFields(lines: readonly string[]): [string, string[]][] | null {
  const fields: [string, string[]][] = [];
  for (const line of lines) {
    const m = FIELD_KEY.exec(line);
    if (m) {
      fields.push([m[1], [line]]);
    } else if (/^\s/.test(line) && fields.length > 0) {
      fields[fields.length - 1][1].push(line);
    } else {
      return null;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Line diff
// ---------------------------------------------------------------------------

interface Hunk {
  readonly beforeStart: number;
  readonly removed: readonly string[];
  readonly afterStart: number;
  readonly added: readonly string[];
}

/**
 * Line-level hunks between two files, by longest common subsequence.
 *
 * Deliberately plain: this runs in the harvester, never in the projector, so the
 * quadratic table is affordable and being easy to check is worth more than being
 * fast. Trimming the common prefix and suffix first keeps the table small for the
 * one-line changes that dominate this history.
 */
export function diffLines(before: readonly string[], after: readonly string[]): Hunk[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail++;
  }

  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0) {
    return [{ beforeStart: head, removed: a, afterStart: head, added: b }];
  }

  // LCS table, then walk it back into aligned hunks.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let pending: { beforeStart: number; removed: string[]; afterStart: number; added: string[] } | null = null;
  const flush = () => {
    if (pending) hunks.push(pending);
    pending = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
      continue;
    }
    pending ??= { beforeStart: head + i, removed: [], afterStart: head + j, added: [] };
    if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      pending.added.push(b[j++]);
    } else {
      pending.removed.push(a[i++]);
    }
  }
  flush();
  return hunks;
}

// ---------------------------------------------------------------------------
// The two counts the assumption test asks for
// ---------------------------------------------------------------------------

/** How much of a history the vocabulary described. */
export interface ResidueCensus {
  /** Commits examined. */
  readonly commits: number;
  /** Commits every file of which an event described. */
  readonly expressible: number;
  /** Commits with at least one file the vocabulary could not describe. */
  readonly withResidue: number;
  /** `expressible / commits`, or 1 when there is nothing to express. */
  readonly rate: number;
  /** Residue-carrying commit counts by declared writer — where the gap actually is. */
  readonly byWriter: Readonly<Record<string, number>>;
}

/**
 * The rate, over the commits the assumption test's method counts.
 *
 * Merges are excluded from the denominator because the method excludes them —
 * "enumerate every tree-changing commit … excluding `.ost-agent/usage/` sweeps and
 * merge commits". They stay in the log regardless, because the fold needs them;
 * see {@link DeclaredWriter}. Counting them would be scoring the architecture on
 * commits nobody claimed a tool wrote.
 */
export function residueCensus(expressions: readonly Expression[]): ResidueCensus {
  const counted = expressions.filter((e) => e.writer !== "git.merge");
  const byWriter: Record<string, number> = {};
  let withResidue = 0;
  for (const e of counted) {
    if (e.residue.length === 0) continue;
    withResidue++;
    byWriter[e.writer] = (byWriter[e.writer] ?? 0) + 1;
  }
  const commits = counted.length;
  return {
    commits,
    expressible: commits - withResidue,
    withResidue,
    rate: commits === 0 ? 1 : (commits - withResidue) / commits,
    byWriter,
  };
}

/** One file the projection and the real tree disagree about. */
export interface Mismatch {
  readonly path: string;
  readonly reason: "missing" | "extra" | "differs";
}

/**
 * Every file the projection fails to reproduce. Empty is the strict half of the
 * assumption test's threshold — the half a high expressibility rate does not buy.
 */
export function projectionMismatches(projected: Projection, actual: ReadonlyMap<string, string>): Mismatch[] {
  const out: Mismatch[] = [];
  for (const [path, content] of actual) {
    const got = projected.get(path);
    if (got === undefined) out.push({ path, reason: "missing" });
    else if (got !== content) out.push({ path, reason: "differs" });
  }
  for (const path of projected.keys()) {
    if (!actual.has(path)) out.push({ path, reason: "extra" });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
