/**
 * What a write did to a node's structure, reported back to the caller that made it.
 *
 * ## The property this exists to remove
 *
 * On 2026-08-05 a well-formed `ost_edit_node` call destroyed four `## History`
 * entries, and the thing that made it expensive was not the deletion — it was
 * that **nothing in the response distinguished a write that preserved everything
 * from a write that destroyed a record.** Both came back as
 * `edited the body of "…"`. The loss was recovered by luck: the pass happened to
 * have read the whole file minutes earlier for an unrelated reason.
 *
 * Its two siblings ({@link ./sections.ts}, {@link ./section-accounting.ts}) both
 * PREVENT a drop, and both depend on somebody having correctly enumerated what
 * matters. This one assumes that enumeration will eventually be wrong and makes
 * the wrongness visible: every write that touches a node body comes back with a
 * census of what happened to its `## ` sections — kept, replaced, added, and
 * dropped — each by heading.
 *
 * ## Observed, not predicted
 *
 * The census is computed from the node's body BEFORE the write and the node's
 * body AFTER it, read off the file both times. Nothing is inferred from the
 * caller's arguments. That matters for the one thing this is supposed to cover:
 * a loss nobody anticipated, in a tool nobody audited, including one written
 * later. A report derived from `prose` and `dropping` could only ever describe
 * the drops the guard already knows how to name; a report derived from the file
 * describes the drops as well.
 *
 * It also means reserved sections are in scope. `## History` shows up under
 * `replaced` on essentially every write, because essentially every write appends
 * a line to it — noise, but true, and the alternative is a census with a blind
 * spot exactly where the highest-stakes sections live. A `## Results` appearing
 * under `dropped` would be the most important line this module ever prints.
 *
 * ## `dropped` is present even when it is empty
 *
 * A report that appears only when there is bad news teaches a caller that silence
 * means safety, which is the belief that made the original loss expensive. So the
 * rendered line always names all four buckets, and an empty one reads `none`
 * rather than being omitted. Absent must be distinguishable from none.
 *
 * ## Restorable, not merely named
 *
 * Being told a section was dropped is worth little to a caller with no undo, so
 * every dropped entry carries what it takes to put the section back: the
 * section's full prior text, a `git show <sha>:<path>` ref that resolves to the
 * file as it stood immediately before this write, or both. An entry with neither
 * is a bug, and {@link droppedIsRestorable} is the predicate that says so.
 *
 * The ref pins a **concrete sha**, never `HEAD`. Every mutating MCP call commits,
 * so by the time the caller reads this response `HEAD` is the write that did the
 * damage — a ref spelled `HEAD` would hand the caller back the state without the
 * section in it. It is also emitted only when the committed blob is byte-identical
 * to what was on disk before the write: a ref that resolves to something *else*
 * that was once there is worse than no ref, because a caller cannot tell the two
 * apart.
 *
 * ## Not framed as untrusted data, deliberately
 *
 * The prior text quoted here is the node's own body, which `ost_read_tree` already
 * serves to the same caller unframed (`test/security/s4-data-framing.test.ts` pins
 * that as a control). Attaching {@link ../security/framing.ts}'s marker to these
 * bytes and not to that read would make the marker mean less, not more.
 *
 * ## What a census does NOT buy, stated where a reader will meet it
 *
 * It prevents nothing. The record is still gone; the caller is merely told, and an
 * unattended pass reading `dropped: ## History` has no undo beyond re-composing the
 * section from this response. The solution node that commissioned this says so, and
 * its assumption is stated against it: reporting may convert a silent loss into a
 * documented one without changing the loss rate. Build it alongside a preventive
 * sibling, not instead of one.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * One section this write removed, with what it takes to put it back.
 *
 * At least one of `text` and `ref` is always set — see {@link droppedIsRestorable},
 * which is the assertion the spec beneath this module is written as.
 */
export interface DroppedSection {
  /** The heading as the file spelled it, flattened to one line. */
  heading: string;
  /** The section's prior text, verbatim. Absent only when it was too large to inline AND a ref exists. */
  text?: string;
  /** `git show <sha>:<relative path>` — resolves to the file as it stood before this write. */
  ref?: string;
  /** Present when `text` is a head rather than the whole section: how many characters were left out. */
  elided?: number;
}

/** The four buckets the solution node names, computed over one write. */
export interface WriteReport {
  /** Sections present before and after, byte-identical. */
  kept: string[];
  /** Sections present before and after, with different content. */
  replaced: string[];
  /** Sections the write introduced. */
  added: string[];
  /** Sections the write removed — the bucket this whole module exists for. */
  dropped: DroppedSection[];
}

/**
 * How much of a dropped section is quoted inline before the ref carries it instead.
 *
 * A tool response is read by a model with a finite window, and a dropped `##
 * Instrument Log` on an old node can run to tens of kilobytes. The cap applies
 * ONLY when a git ref is available to carry the rest: with no ref, the inline text
 * is the sole copy the caller will ever be handed, and truncating it would turn a
 * restorable report into an unrestorable one to save bytes.
 */
export const MAX_INLINE_DROPPED_TEXT = 4000;

/** C0 control chars + DEL, built from an escape string so this file holds no literal control bytes. */
const HEADING_CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]+", "g");

/** Is this line an `## ` heading — level two exactly, `###` and `#` excluded? */
function isSectionHeading(line: string): boolean {
  return /^##\s+\S/.test(line.trim());
}

/**
 * The comparison key for a heading. Case- and whitespace-insensitive, marker
 * stripped — the same normalisation {@link ./section-accounting.ts} compares by,
 * so the guard that refuses a drop and the census that reports one cannot disagree
 * about whether two spellings are the same section.
 */
function headingKey(text: string): string {
  return text
    .replace(HEADING_CONTROL_CHARS, " ")
    .replace(/^\s*#{1,6}\s*/, "")
    .replace(/\s*#+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Flatten a heading for display.
 *
 * A heading comes off the node's own file and reaches the model as tool output, so
 * it is flattened for the reason `security/tools.ts:displaySafeTitle` gives: a
 * control character in the string would forge the look of an extra line of output.
 * It is not capped — the product of a `dropped` entry is a name the caller acts on.
 */
function displayHeading(line: string): string {
  return line.replace(HEADING_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

interface Span {
  display: string;
  /** Heading line included — this is what a caller pastes back to restore the section. */
  text: string;
}

/**
 * Every `## ` section a body declares, keyed by normalised name.
 *
 * A section runs from its `## ` heading to the next `## ` heading, so nested
 * `###` blocks belong to their parent — the same boundary
 * {@link ./section-accounting.ts} accounts at and {@link ./sections.ts} splits on.
 * A repeated heading keeps the first occurrence, matching the dedup the accounting
 * guard already does.
 */
function sectionSpans(body: string): Map<string, Span> {
  const out = new Map<string, Span>();
  const lines = body.split("\n");
  let key: string | null = null;
  let display = "";
  let buffer: string[] = [];

  const flush = (): void => {
    if (key === null) return;
    if (!out.has(key)) out.set(key, { display, text: buffer.join("\n").trimEnd() });
    key = null;
    buffer = [];
  };

  for (const line of lines) {
    if (isSectionHeading(line)) {
      flush();
      const heading = displayHeading(line.trim());
      const k = headingKey(heading);
      if (k === "") continue;
      key = k;
      display = heading;
      buffer = [line.trimEnd()];
      continue;
    }
    if (key !== null) buffer.push(line);
  }
  flush();
  return out;
}

/**
 * Compare the node's body before a write against its body after, and say what
 * happened to each section.
 *
 * `dropped` entries come back carrying `text` only. The ref — and the decision to
 * elide the text in favour of it — is attached by {@link attachRestorePaths}, which
 * needs the vault directory and so cannot live in a pure comparison.
 */
export function censusOfWrite(before: string, after: string): WriteReport {
  const was = sectionSpans(before);
  const is = sectionSpans(after);

  const kept: string[] = [];
  const replaced: string[] = [];
  const added: string[] = [];
  const dropped: DroppedSection[] = [];

  for (const [key, span] of was) {
    const now = is.get(key);
    if (!now) dropped.push({ heading: span.display, text: span.text });
    else if (now.text === span.text) kept.push(now.display);
    else replaced.push(now.display);
  }
  for (const [key, span] of is) {
    if (!was.has(key)) added.push(span.display);
  }

  return { kept, replaced, added, dropped };
}

/**
 * Ask git for a ref that resolves to `filePath` exactly as it stood before this
 * write, or undefined if it cannot honestly offer one.
 *
 * Three ways it declines, each of which would otherwise produce a ref that reads
 * as an undo and is not one:
 *
 *   - the directory is not a git repository, or has no commit yet;
 *   - the path is not tracked at that commit (a node created this session);
 *   - the committed blob differs from what was on disk before the write, which is
 *     what an uncommitted hand edit in the vault looks like from here.
 *
 * `beforeContent` is the whole file, not the body, because that is what `git show`
 * returns — frontmatter included.
 */
export function priorBlobRef(dir: string, filePath: string, beforeContent: string): string | undefined {
  const rel = path.relative(dir, filePath);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const spec = rel.split(path.sep).join("/");

  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  if (head.status !== 0) return undefined;
  const sha = head.stdout.trim();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) return undefined;

  const show = spawnSync("git", ["show", `${sha}:${spec}`], { cwd: dir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (show.status !== 0) return undefined;
  // Byte-identical modulo the trailing newline git and the writer disagree about.
  if (show.stdout.trimEnd() !== beforeContent.trimEnd()) return undefined;

  return `git show ${sha}:${spec}`;
}

/**
 * Give every dropped entry a way back, and elide an oversized quote only when the
 * ref can carry it.
 *
 * Called with `ref` undefined — no git, an untracked file, a drifted one — this
 * changes nothing, which is the intended behaviour: the full text stays, however
 * long it is, because it is the only copy the caller is getting.
 */
export function attachRestorePaths(report: WriteReport, ref: string | undefined): WriteReport {
  if (!ref) return report;
  return {
    ...report,
    dropped: report.dropped.map((d) => {
      const text = d.text ?? "";
      if (text.length <= MAX_INLINE_DROPPED_TEXT) return { ...d, ref };
      return {
        ...d,
        ref,
        text: text.slice(0, MAX_INLINE_DROPPED_TEXT),
        elided: text.length - MAX_INLINE_DROPPED_TEXT,
      };
    }),
  };
}

/**
 * Can a caller holding only this entry put the section back?
 *
 * The predicate the spec is written as, exported so a test asserts the property
 * the module claims rather than its own reading of the rendered string. An entry
 * whose `text` was elided is restorable through its ref, not through its text, so
 * a truncated quote does not count on its own.
 */
export function droppedIsRestorable(d: DroppedSection): boolean {
  if (typeof d.ref === "string" && d.ref.trim() !== "") return true;
  return typeof d.text === "string" && d.text.trim() !== "" && d.elided === undefined;
}

/** `["## A", "## B"]` → `` `## A`, `## B` ``; the empty list → `none`, never nothing. */
function bucket(headings: readonly string[]): string {
  if (headings.length === 0) return "none";
  return headings.map((h) => `\`${h}\``).join(", ");
}

/**
 * How many sections a bucket names before it says how many it hid.
 *
 * Z2's rule — a capped list names what it left out — applied to the three buckets
 * where a long list is noise. `dropped` is never capped: it is the bucket a caller
 * has to act on, and a report that hid the fifth dropped section to stay short
 * would reintroduce the silence this module exists to remove.
 */
export const MAX_LISTED_SECTIONS = 10;

function cappedBucket(headings: readonly string[]): string {
  if (headings.length <= MAX_LISTED_SECTIONS) return bucket(headings);
  const shown = headings.slice(0, MAX_LISTED_SECTIONS);
  return `${bucket(shown)} and ${headings.length - MAX_LISTED_SECTIONS} more`;
}

/**
 * The census as the caller reads it.
 *
 * One summary line naming all four buckets, then — only when something was
 * dropped — the prior text of each dropped section between delimiters, so it can
 * be lifted out and pasted straight back into `prose`.
 */
export function renderWriteReport(report: WriteReport, title: string): string {
  const summary =
    `Sections after this write — kept: ${cappedBucket(report.kept)}; replaced: ${cappedBucket(report.replaced)}; ` +
    `added: ${cappedBucket(report.added)}; dropped: ${bucket(report.dropped.map((d) => d.heading))}`;
  if (report.dropped.length === 0) return summary;

  const blocks = report.dropped.map((d) => {
    const where = d.ref ? ` Or read it at \`${d.ref}\`.` : "";
    const quote =
      d.text === undefined
        ? ""
        : [
            `--- \`${d.heading}\` as it stood before this write ---`,
            d.text,
            d.elided === undefined
              ? `--- end \`${d.heading}\` ---`
              : `--- ${d.elided} more character(s) not shown; the ref above has all of it ---`,
          ].join("\n");
    const lead =
      d.text === undefined
        ? `\`${d.heading}\` is GONE from "${title}". Restore it from \`${d.ref}\`.`
        : `\`${d.heading}\` is GONE from "${title}". Paste the text below back into \`prose\` to restore it.${where}`;
    return [lead, quote].filter((p) => p !== "").join("\n\n");
  });

  return [summary, ...blocks].join("\n\n");
}
