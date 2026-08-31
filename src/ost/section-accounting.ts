/**
 * Refuse a rewrite that would drop a section the caller never accounted for.
 *
 * ## The loss this stops, observed rather than reasoned
 *
 * A rewrite replaces a node's prose wholesale. `Vault.editProse` takes the new
 * body, holds the reserved blocks aside ({@link ./sections.ts}), and writes the
 * caller's string in place of everything else — so any `## Section` the node
 * carried and the caller did not reproduce is gone, with no error, no warning
 * and the same success string a lossless edit returns. That is not a
 * hypothetical: on 2026-08-05 a well-formed call destroyed four `## History`
 * entries this way, and it was recovered only because the pass happened to have
 * read the file minutes earlier for an unrelated reason.
 *
 * `## History` itself is closed — it joined {@link ./headings.ts}'s reserved set,
 * so it is held aside and reattached like a `## Results`. What is NOT closed is
 * the shape: every other section a node carries is ordinary prose. `##
 * Provenance`, `## Definition of done`, and `## Issues` — the section
 * `ost_annotate` writes into — are all droppable today by a caller who simply did
 * not know they were there. Reserving each one as it is discovered does not
 * scale, and reserving them all would forbid deletion outright.
 *
 * ## The rule
 *
 * A rewrite must ACCOUNT for every `## ` section the node currently stores in its
 * rewritable prose: either reproduce the heading in `prose`, or name it in
 * `dropping`. A section in neither is a refusal that names it.
 *
 * That keeps deletion available and makes it deliberate — the property a flat
 * "carry everything across" rule gives up. And the refusal arrives BEFORE the
 * damage, which for an agent caller is the one form of feedback that reliably
 * changes the next call.
 *
 * ## What this does not buy, stated plainly
 *
 * Two limits, both known in advance and neither closed here:
 *
 *   - **It cannot tell accounting from faithfulness.** A caller may name `##
 *     Provenance` in `prose` and then reproduce it wrongly. The heading is there,
 *     so this passes it. Naming a section is not copying it.
 *   - **It fires on honest rewriting too.** Consolidating two sections into one,
 *     retitling a section, or folding a section into running prose all look
 *     exactly like an accidental drop from out here, and all three now cost a
 *     refusal and a retry with `dropping`. The assumption node beneath this
 *     states that cost as the thing the idea actually turns on; the false-positive
 *     rate on real rewrites is a separate measurement, and this module is not
 *     evidence about it.
 *
 * ## Why `##` and not every heading level
 *
 * A `###` lives INSIDE a `##` section, so accounting for the parent already
 * accounts for the child, and requiring both would double the tax on a caller
 * rewriting one section's internals — the most common legitimate edit there is.
 * The rule matches the one the node body states, and it matches the boundary
 * {@link ./sections.ts} already splits on.
 */
import { RESERVED_HEADINGS, isHeadingLine } from "./headings.js";
import { splitReservedSections } from "./sections.js";

/**
 * One stored section, in the two forms the guard needs: the spelling to show a
 * caller, and the key to compare by.
 */
interface Section {
  /** The heading as the file spells it, flattened and capped for display. */
  display: string;
  /** Case- and whitespace-normalised name, without the `##` marker. */
  key: string;
}

// C0 control chars + DEL, built from an escape string so this source contains no
// literal control bytes — the construction `ost/sanitize.ts` uses.
const HEADING_CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]+", "g");

/**
 * The comparison key for a heading, from either side.
 *
 * Accepts `## Provenance`, `Provenance`, `##   provenance   ` and `## Provenance
 * ##` as the same section, because a caller listing something in `dropping` is
 * typing a heading from memory and the marker is noise. It does NOT accept `##
 * Provenance and sources` as `## Provenance`: a retitle is a different section
 * name, and treating a prefix as a match would let a rewrite that renames a
 * section past a guard whose whole subject is sections going missing.
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
 * Flatten a heading for an error message.
 *
 * A heading comes off the node's own file, so it is vault content rather than
 * caller content — but it reaches the model through a refusal exactly as a title
 * does, and `security/tools.ts:displaySafeTitle` is the argument for why that
 * path is flattened rather than trusted: a control character in the string would
 * forge the look of an extra line of tool output.
 *
 * It is NOT capped, and that is the one place this deliberately parts company
 * with `displaySafeTitle`. The product of this refusal is a name the caller pastes
 * straight back into `dropping`, and `dropping` matches on the whole name — so a
 * heading shown as `## Provenance, and what it does no…` is a heading the caller
 * cannot act on, which turns the one refusal that tells you how to proceed into
 * one that does not. A heading is a single line of markdown and the flattening
 * keeps it one line; verbosity is the cheaper failure.
 */
function displayHeading(line: string): string {
  return line.replace(HEADING_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** Is this line an `## ` heading — level two exactly, `###` and `#` excluded? */
function isSectionHeading(line: string): boolean {
  return /^##\s+\S/.test(line.trim());
}

/**
 * Every `## ` section a body declares, in order, deduplicated by name.
 *
 * Exported because the guard's spec drives it directly: a test that recomputed
 * "which sections are stored" with its own regex would be measuring its own
 * reading of the file rather than the one the refusal is decided from.
 */
export function sectionHeadings(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of body.split("\n")) {
    if (!isSectionHeading(line)) continue;
    const key = headingKey(line);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(displayHeading(line.trim()));
  }
  return out;
}

function sections(body: string): Section[] {
  return sectionHeadings(body).map((display) => ({ display, key: headingKey(display) }));
}

/** What the accounting check found, as data, so a caller can render it or assert on it. */
export interface SectionAccounting {
  /** Every `## ` section stored in the node's rewritable prose, as the file spells it. */
  stored: string[];
  /** Stored sections the submission neither reproduced in `prose` nor named in `dropping`. */
  unaccounted: string[];
  /**
   * Stored sections this rewrite actually removes — named in `dropping` and
   * absent from `prose`.
   *
   * A section named in BOTH is not here: the caller listed it and then kept it,
   * and the file will still hold it, so reporting it as removed would be this
   * guard describing a loss that did not happen.
   */
  dropped: string[];
  /** `dropping` entries naming a RESERVED section — nothing may remove one, so these are refused. */
  reservedDrops: string[];
}

/**
 * Compare what the node stores against what the caller submitted.
 *
 * `storedBody` is the node's whole body: the reserved split happens HERE rather
 * than at the call site, so the guard and the writer cannot disagree about which
 * region is at risk. Reserved sections are never at risk — `editProse` reattaches
 * them verbatim — so they are not accountable, and naming one in `dropping` is a
 * caller believing it can delete something no tool can, which is worth a refusal
 * rather than a silent no-op.
 */
export function accountForSections(storedBody: string, newProse: string, dropping: readonly string[]): SectionAccounting {
  const stored = sections(splitReservedSections(storedBody).prose);
  const submitted = new Set(sections(newProse).map((s) => s.key));
  const dropKeys = new Set(dropping.map((d) => headingKey(d)).filter((k) => k !== ""));

  return {
    stored: stored.map((s) => s.display),
    unaccounted: stored.filter((s) => !submitted.has(s.key) && !dropKeys.has(s.key)).map((s) => s.display),
    dropped: stored.filter((s) => dropKeys.has(s.key) && !submitted.has(s.key)).map((s) => s.display),
    reservedDrops: dropping.filter((d) => RESERVED_HEADINGS.some((h) => isHeadingLine(`## ${headingKey(d)}`, h))),
  };
}

/** `["## A", "## B"]` → `` `## A` and `## B` ``, for a refusal a caller reads once. */
function list(headings: readonly string[]): string {
  const quoted = headings.map((h) => `\`${h}\``);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;
}

/**
 * Refuse the rewrite, or return the sections it deliberately removes.
 *
 * The refusal names every unaccounted section rather than the first, because a
 * caller that has to discover them one retry at a time pays the tax once per
 * section — and this vault's own census records thirteen sessions independently
 * rediscovering a single refusal, so one that arrives in instalments is a refusal
 * a caller learns to route around.
 *
 * Nothing is written when this throws: it runs before `editProse` composes the
 * new body, so the file on disk is untouched and the caller's `prose` is still
 * theirs to correct.
 */
export function assertSectionsAccountedFor(
  title: string,
  storedBody: string,
  newProse: string,
  dropping: readonly string[],
): string[] {
  const found = accountForSections(storedBody, newProse, dropping);

  if (found.reservedDrops.length > 0) {
    throw new Error(
      `refusing to edit "${title}": \`dropping\` names ${list(found.reservedDrops.map(displayHeading))}, which is ` +
        `reserved. A reserved section records something that happened outside the tree — a human's result, a stated ` +
        `limit, an observed exit code, the node's own history — and no tool may author or remove one; an edit ` +
        `reattaches them verbatim. Take it out of \`dropping\` and the edit will keep it. Nothing was written.`,
    );
  }

  if (found.unaccounted.length > 0) {
    throw new Error(
      `refusing to edit "${title}": this rewrite would remove ${list(found.unaccounted)}, which you did not include ` +
        `or list. Include ${found.unaccounted.length === 1 ? "it" : "them"} in \`prose\` to keep ` +
        `${found.unaccounted.length === 1 ? "it" : "them"}, or name ${found.unaccounted.length === 1 ? "it" : "them"} ` +
        `in \`dropping\` to remove ${found.unaccounted.length === 1 ? "it" : "them"} on purpose. ` +
        `ost_read_tree({ node: "${title}" }) returns the body this was compared against. Nothing was written.`,
    );
  }

  return found.dropped;
}
