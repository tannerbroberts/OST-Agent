/**
 * Splitting a node body into the part an agent may rewrite and the part it may not.
 *
 * The vault stopped being append-only when the tree outgrew it: a root node
 * carrying twenty appended ledgers and 165 edges cannot be pruned by a surface
 * whose every operation grows a file. So `Vault` now holds an edit, an unlink and
 * a merge-with-delete, and the question those raise is the one append-only never
 * had to answer — *what may an edit remove?*
 *
 * The answer is the same asymmetry {@link ./headings.ts} already draws, applied
 * in the other direction. A reserved heading is a measurement the agent may never
 * AUTHOR, because a gate reads it as proof something happened outside the tree.
 * The moment a body can be replaced, it is equally a measurement the agent may
 * never DESTROY: erasing a `## Results` block un-clears a gate a human cleared,
 * and erasing an `## Instrument Log` throws away the red observation that is the
 * build permit. Authoring one grants a permit; deleting one revokes a human's.
 * Both are the agent deciding what was measured.
 *
 * So an edit never takes the whole body. The caller supplies the PROSE, this
 * module holds the reserved blocks aside, and the writer puts them back verbatim.
 * The agent's content is still scanned for a reserved heading and still refused,
 * which means the two rules compose into one sentence: reserved sections are
 * neither writable nor removable through any tool, and an edit cannot express
 * either even by accident.
 */
import { RESERVED_HEADINGS, isHeadingLine } from "./headings.js";

export interface SplitBody {
  /** Everything outside a reserved section — the part an edit may replace. */
  prose: string;
  /** The reserved sections, verbatim and in the order they appeared. */
  reserved: string[];
}

/** Is this line any `## Heading`/`# Heading` at all? Section boundaries are heading-to-heading. */
function isAnyHeading(line: string): boolean {
  return /^#{1,6}\s/.test(line.trim());
}

function startsReservedSection(line: string): boolean {
  return RESERVED_HEADINGS.some((h) => isHeadingLine(line, h));
}

/**
 * Split a body into replaceable prose and untouchable reserved blocks.
 *
 * A reserved section runs from its heading to the next heading of any level, the
 * same span {@link ../ost/vault.ts}'s `appendUnderHeading` writes into — so a
 * block held aside here is exactly the block that function would have appended
 * to, and a round trip through split/rejoin moves nothing.
 */
export function splitReservedSections(body: string): SplitBody {
  const lines = body.split("\n");
  const prose: string[] = [];
  const reserved: string[] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (isAnyHeading(line)) {
      // Any heading closes an open reserved block; a reserved one opens the next.
      if (current) {
        reserved.push(current.join("\n").trimEnd());
        current = null;
      }
      if (startsReservedSection(line)) {
        current = [line];
        continue;
      }
    }
    (current ?? prose).push(line);
  }
  if (current) reserved.push(current.join("\n").trimEnd());

  return { prose: prose.join("\n").trimEnd(), reserved };
}

/**
 * Put a body back together: new prose first, then every reserved block.
 *
 * Reserved sections migrate to the end rather than back to their original
 * offsets, and that is deliberate — an edit rewrites the prose around them, so
 * there is no "original position" left to restore them to. Their content is
 * byte-identical either way, which is the property the gates read.
 */
export function joinReservedSections(prose: string, reserved: string[]): string {
  const parts = [prose.trimEnd(), ...reserved.map((r) => r.trimEnd())].filter((p) => p !== "");
  return parts.join("\n\n");
}
