/**
 * Every criterion in the readiness document is sequenced — placed in a tier, or
 * declared unsequenced on purpose. (V1 readiness, the document's own standard.)
 *
 * "The ordering constraint" is the section that turns 74 criteria into a plan:
 * built out of sequence, the later ones become unmeasurable rather than merely
 * unbuilt. That only holds if the section covers the criteria. An audit on
 * 2026-07-29 found **fifteen** absent from every tier — W3, W4, W6, W7, W8, B10,
 * P3, P4, P6, R6, R8, H4, H5, S4, S5 — with nothing to distinguish an
 * independently-buildable criterion from a forgotten one, and eight more present
 * only as dependency prose, including S1, a blocker. A tier list that omits a
 * third of the document is not an ordering, it is a subset.
 *
 * So this computes the set difference instead of maintaining it, the way
 * `readiness-citations.test.ts` does for evidence and `module-reachability.test.ts`
 * does for dead code. Both sides come out of the file: the criteria from their
 * own headings, the sequencing from the ordering section. Adding a criterion
 * without saying where it goes is a red build.
 *
 * **How the section is read.** Blank-line-separated blocks, classified:
 *
 * - a block opening `**Tier …**` is an assignment, and the blockquotes
 *   immediately following it are part of it — Tier 1's status note is where R2,
 *   R7 and R9 are placed, and splitting a tier from its own note would report
 *   them unsequenced;
 * - a block saying a criterion is *unsequenced* / *sequenced nowhere* is the
 *   escape hatch, and its contents are parsed, never hardcoded here;
 * - everything else — the counter-case, the retrospectives on R3/R4/B4/B8/Gate F
 *   — is commentary. A criterion mentioned only there is **not** sequenced. That
 *   is the distinction the audit found missing, and preserving it is the point.
 *
 * Two spellings inside a tier are expanded: a range (`F1–F4`, `P7–P10`) and a
 * whole gate written as a list item (`…; G3; Gate D.`). The gate form is
 * deliberately narrow — comma or semicolon before, punctuation after. Tier 3
 * says "W1 and W11 precede Gate S", which is a dependency, not an assignment of
 * all six S criteria; a looser rule would silently sequence every future S
 * criterion, and a check that answers yes before the work is done is worse than
 * no check.
 *
 * **The way out of a red here** is one line in the document — name the criterion
 * in a tier, or add it to the unsequenced list with its reason. Both are edits
 * an agent can make. The list cannot become the answer to everything, though:
 * see the last test.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = path.join(repoRoot, "docs/reference/v1-readiness.md");

/** `**⛔ W1 — …**` / `**W3 — …**`: a gate letter, a number, an em dash. */
const CRITERION_HEADING = /^\*\*(?:⛔\s*)?([A-Z]\d{1,2})\s+—\s/;
/** Any criterion-shaped token: `W3`, `B10`. Bounded, so `Tier 1` and `2026` miss. */
const ID_TOKEN = /\b([A-Z]\d{1,2})\b/g;
/** `F1–F4`, `P7–P10`, `Z1–Z5` — en dash or hyphen, the letter optionally repeated. */
const ID_RANGE = /\b([A-Z])(\d{1,2})\s*[–—-]\s*\1?(\d{1,2})\b/g;
/** `…; G3; Gate D.` — a gate standing in a list of criteria, and only there. */
const GATE_AS_LIST_ITEM = /[;,]\s*Gate\s+([A-Z])\b\s*[.;,]/g;
/** The document's own words for "placed nowhere, and that is the answer". */
const UNSEQUENCED_MARKER = /sequenced nowhere|not sequenced|unsequenced|no tier|any tier/i;

const doc = () => fs.readFileSync(DOC, "utf8");

/** Every criterion the document defines, in document order. */
function criterionIds(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(CRITERION_HEADING);
    if (m) out.push(m[1]);
  }
  return out;
}

function orderingSection(markdown: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+The ordering constraint\s*$/.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

interface Block {
  kind: "tier" | "unsequenced" | "commentary";
  text: string;
}

function blocks(section: string): Block[] {
  const raw = section.split(/\n[ \t]*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  const out: Block[] = [];
  let lastWasTier = false;
  for (const text of raw) {
    if (/^\*\*Tier\b/.test(text)) {
      out.push({ kind: "tier", text });
      lastWasTier = true;
      continue;
    }
    // A blockquote riding directly behind a tier is that tier's own note.
    if (lastWasTier && text.startsWith(">")) {
      out.push({ kind: "tier", text });
      continue;
    }
    lastWasTier = false;
    out.push({ kind: UNSEQUENCED_MARKER.test(text) ? "unsequenced" : "commentary", text });
  }
  return out;
}

/** IDs a block names, with ranges and list-item gates expanded. `defined` bounds the gate form. */
function namedIn(text: string, defined: readonly string[]): Set<string> {
  const ids = new Set<string>([...text.matchAll(ID_TOKEN)].map((m) => m[1]));
  for (const m of text.matchAll(ID_RANGE)) {
    const [lo, hi] = [Number(m[2]), Number(m[3])];
    for (let n = lo; n <= hi; n++) ids.add(`${m[1]}${n}`);
  }
  for (const m of text.matchAll(GATE_AS_LIST_ITEM)) {
    for (const id of defined) if (id.startsWith(m[1])) ids.add(id);
  }
  return ids;
}

/** Pure over its input, so the fixture below can pin the reading rules directly. */
export function sequencing(markdown: string) {
  const defined = criterionIds(markdown);
  const section = blocks(orderingSection(markdown));
  const collect = (kind: Block["kind"]) => {
    const out = new Set<string>();
    for (const b of section) if (b.kind === kind) for (const id of namedIn(b.text, defined)) out.add(id);
    return out;
  };
  const tiered = collect("tier");
  const unsequenced = collect("unsequenced");
  return {
    defined,
    section,
    tiered,
    unsequenced,
    unplaced: defined.filter((id) => !tiered.has(id) && !unsequenced.has(id)),
  };
}

const readiness = () => sequencing(doc());

describe("the ordering constraint reader", () => {
  // The rules above are the whole content of this file, and every assertion
  // against the real document is a set difference — which an over-eager reader
  // satisfies vacuously. So they are pinned against a fixture, where "what
  // counts as an assignment" is visible in one screen.
  test("reads assignments, ranges, gates and the escape hatch — and ignores commentary", () => {
    const fixture = [
      "**⛔ A1 — first.**",
      "**A2 — second.**",
      "**A3 — third.**",
      "**B1 — fourth.**",
      "**B2 — fifth.**",
      "**C1 — sixth.**",
      "",
      "## The ordering constraint",
      "",
      "**Tier 1 — the base.** A1–A2, and Gate S precedes it.",
      "",
      "> **Status:** B1 is met, and it belongs here.",
      "",
      "**Tier 2 — the rest.** B2; Gate C.",
      "",
      "**Sequenced nowhere, deliberately:** A3.",
      "",
      "> **The counter-case:** one could put C1 first.",
      "",
      "## What V1.0.0 explicitly does not claim",
      "",
      "A9 is named here and must not count.",
    ].join("\n");
    const s = sequencing(fixture);
    expect(s.defined).toEqual(["A1", "A2", "A3", "B1", "B2", "C1"]);
    expect([...s.tiered].sort()).toEqual(["A1", "A2", "B1", "B2", "C1"]); // C1 via `; Gate C.`
    expect([...s.unsequenced]).toEqual(["A3"]);
    expect(s.unplaced).toEqual([]);
  });

  test("a gate named as a dependency sequences nothing, and commentary sequences nothing", () => {
    const fixture = [
      "**A1 — first.**",
      "**S1 — a blocker.**",
      "**S4 — independent.**",
      "",
      "## The ordering constraint",
      "",
      "**Tier 1 — the base.** A1, which must precede Gate S.",
      "",
      "**The next single item is S1.** It waits on nothing.",
    ].join("\n");
    // "precede Gate S" is a dependency, not an assignment of all six S criteria,
    // and the closing retrospective is commentary. Both S1 and S4 come out
    // unplaced — which is exactly what the 2026-07-29 audit found by hand and
    // what a looser reader would have reported as fine.
    expect(sequencing(fixture).unplaced).toEqual(["S1", "S4"]);
  });

  test("the real document yields criteria, tiers and commentary to tell apart", () => {
    const { defined, section } = readiness();
    expect(defined.length).toBeGreaterThan(40);
    expect(new Set(defined).size).toBe(defined.length); // no duplicate IDs
    expect(section.filter((b) => b.kind === "tier").length).toBeGreaterThan(3);
    // The retrospectives at the foot of the section name half the document
    // between them; if they counted, this file would assert nothing.
    expect(section.filter((b) => b.kind === "commentary").length).toBeGreaterThan(3);
  });
});

describe("every criterion is sequenced", () => {
  test("each one is in a tier, or declared unsequenced on purpose", () => {
    expect(readiness().unplaced).toEqual([]);
  });

  test("the ordering constraint names no criterion the document does not define", () => {
    // The mirror of the check above, and the one that catches a typo or a
    // rename: a tier that sequences work nothing in the document defines.
    const { defined, tiered, unsequenced } = readiness();
    const known = new Set(defined);
    const phantom = [...new Set([...tiered, ...unsequenced])].filter((id) => !known.has(id)).sort();
    expect(phantom).toEqual([]);
  });

  test("the unsequenced list is an exception, not the ordering", () => {
    // The cheap way out of a red above is to append the ID to the unsequenced
    // list. That is a legitimate answer for a criterion that really does depend
    // on nothing — and it is also how the section could quietly become a subset
    // again, which is the failure this file exists for. Bounding it keeps the
    // escape hatch an escape hatch.
    const { defined, unsequenced } = readiness();
    const declared = [...unsequenced].filter((id) => defined.includes(id));
    expect(declared.length).toBeLessThan(defined.length / 2);
  });
});
