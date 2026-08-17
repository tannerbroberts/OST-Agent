/**
 * `ost_edit_node` used to protect a hand-listed set of headings — `## Results`,
 * `## Uncovered`, `## Instrument Log` — and let everything else in the old body
 * go. `## History` was never on that list, so an edit whose new prose did not
 * mention it dropped every entry silently: observed first-party on 2026-08-05,
 * reproduced here as a fixture rather than trusted from memory.
 *
 * The fix generalises the reserved-set mechanism from a fixed list to whichever
 * `## ` sections the caller's new prose actually addresses (`carryUnaddressedSections`,
 * `src/ost/sections.ts`): a section the old body named and the new prose omits
 * survives untouched. This file edits a node holding five `## ` sections,
 * supplies two, and checks that the other three — `## History`, one already on
 * the hand-listed reserved set, and one whose body holds a fenced block
 * containing a `## ` line — survive byte-identical, with nothing duplicated.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-edit-preserve-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (title: string, layer: OstNode["layer"], body: string): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body,
});

test("carries every unsupplied ## section across an edit, including History, a reserved heading, and one holding a fenced block", () => {
  const fencedNotes = [
    "## Notes",
    "Worked example, with a heading-shaped line buried in a fence:",
    "```markdown",
    "## This is not a section boundary",
    "it lives inside the fence and must not split the block",
    "```",
    "That fence has to survive along with the prose around it.",
  ].join("\n");

  const original = [
    "Opening prose, before any heading.",
    "",
    "## Overview",
    "Stale overview.",
    "",
    "## Details",
    "Stale details.",
    "",
    "## History",
    "- 2026-08-01 created — first draft",
    "- 2026-08-02 status: unvalidated → validated — five of five said so",
    "",
    fencedNotes,
  ].join("\n");

  vault.createNode(node("A five-section node", "Solution", original));
  // `## Instrument Log` is reserved: createNode refuses it in the body content
  // (the agent may never AUTHOR a measurement), so the fixture adds it the way
  // the human/CLI path does — through the unscanned heading argument.
  vault.appendUnderSection(
    "A five-section node",
    "## Instrument Log",
    "- 2026-08-03 **red** (exit 1) `npx vitest run x.test.ts`",
  );

  vault.editProse(
    "A five-section node",
    ["Sharper opening prose.", "", "## Overview", "Fresh overview.", "", "## Details", "Fresh details."].join("\n"),
    "sharpened the framing and updated the plan",
  );

  const after = vault.read("A five-section node").body;

  // The two supplied sections were replaced outright.
  expect(after).toContain("Fresh overview.");
  expect(after).not.toContain("Stale overview.");
  expect(after).toContain("Fresh details.");
  expect(after).not.toContain("Stale details.");
  expect(after).toContain("Sharper opening prose.");

  // The three unsupplied sections survive byte-identical.
  expect(after).toContain("## History");
  expect(after).toContain("- 2026-08-01 created — first draft");
  expect(after).toContain("- 2026-08-02 status: unvalidated → validated — five of five said so");

  expect(after).toContain("## Instrument Log");
  expect(after).toContain("- 2026-08-03 **red** (exit 1) `npx vitest run x.test.ts`");

  expect(after).toContain(fencedNotes);
  expect(after).toContain("## This is not a section boundary");
  expect(after).toContain("it lives inside the fence and must not split the block");

  // Nothing duplicated: each surviving heading appears exactly once, and the
  // edit's own History line was appended to the carried section, not a second one.
  for (const heading of ["## Overview", "## Details", "## History", "## Instrument Log", "## Notes"]) {
    expect(after.split("\n").filter((l) => l.trim() === heading)).toHaveLength(1);
  }
  expect(after).toContain("body edited — sharpened the framing and updated the plan");
});
