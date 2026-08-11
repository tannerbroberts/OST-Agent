/**
 * The migration a past tightening should have shipped with, held to the one
 * claim that makes a bulk rewrite of an append-only record tolerable: it moves
 * structure, never wording.
 *
 * The tightening replayed here is evidence-class (2026-07-24) — the required
 * `evidence` field that flagged all 57 then-existing meta-vault nodes with no
 * remediation path. `test/fixtures/before-evidence-tightening/` is a small tree
 * captured in the pre-tightening on-disk format: valid under every other
 * invariant, red under `check` solely because no node declares what it rests
 * on. The migration runs on a copy (never the fixture itself), and the pins are
 * mechanical:
 *
 *   - `check` goes red → green;
 *   - every byte after each file's closing frontmatter delimiter is identical
 *     before and after — the prose, tag line, links and history did not move;
 *   - the set of files whose bytes changed equals, exactly, the set the
 *     migration's own report lists as touched.
 *
 * What green here does NOT settle, stated so nobody reads it as more: byte-
 * identical prose is not meaning. A re-parented node changes what its unchanged
 * words claim. This migration never re-parents, and the report names every file
 * it opened precisely so the human reader spends their attention there.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { renderCheck } from "../../src/eval/render.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { migrateEvidenceClass, formatMigrationReport } from "../../src/ost/migrate.js";
import { FLOOR_RUNG } from "../../src/knowledge/believability.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "before-evidence-tightening");

let dir: string;

beforeEach(() => {
  // The test's own design says "run it on a copy" — the captured fixture is the
  // before-state and stays byte-identical in git no matter what the code does.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-migrate-"));
  for (const f of fs.readdirSync(FIXTURE)) {
    fs.copyFileSync(path.join(FIXTURE, f), path.join(dir, f));
  }
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Every byte after the closing `---` — the region the migration must never touch. */
function afterFrontmatter(raw: string): string {
  const lines = raw.split("\n");
  expect(lines[0].trim()).toBe("---");
  const close = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  expect(close).toBeGreaterThan(0);
  return lines.slice(close + 1).join("\n");
}

function readAll(d: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(d).filter((n) => n.endsWith(".md")).sort()) {
    out.set(f, fs.readFileSync(path.join(d, f), "utf8"));
  }
  return out;
}

describe("the evidence-class migration moves structure, never wording", () => {
  test("check goes red → green, every node's prose is byte-identical, and every touched file is in the report", () => {
    const vault = new Vault(dir);

    // Before: red, and red ONLY for the tightening being migrated — a fixture
    // that was also broken some other way would let the migration pass by
    // fixing the wrong thing.
    const beforeViolations = checkInvariants(vault.readTreeCensus().nodes);
    expect(beforeViolations.length).toBeGreaterThan(0);
    expect(new Set(beforeViolations.map((v) => v.rule))).toEqual(new Set(["evidence-class"]));
    expect(renderCheck(vault.readTreeCensus()).violations).toBe(beforeViolations.length);

    const before = readAll(dir);
    const report = migrateEvidenceClass(dir, { write: true });
    const after = readAll(dir);

    // After: green, under the same check the CLI runs.
    const { violations } = renderCheck(vault.readTreeCensus());
    expect(violations).toBe(0);
    expect(report.humansRequired).toEqual([]);

    // Prose untouched, byte for byte — same file set, and in every file the
    // whole region after the frontmatter is identical to the captured before.
    expect([...after.keys()]).toEqual([...before.keys()]);
    for (const [file, raw] of after) {
      expect(afterFrontmatter(raw), file).toBe(afterFrontmatter(before.get(file)!));
    }

    // The report's touched list is exactly the set of files whose bytes
    // changed — nothing touched off the record, nothing on the record untouched.
    const changed = [...after.keys()].filter((f) => after.get(f) !== before.get(f)).sort();
    expect(report.touched.map((t) => t.file).sort()).toEqual(changed);
    expect(changed).toEqual([...before.keys()].sort()); // this fixture predates the rule entirely
    expect(report.alreadyCompliant).toBe(0);

    // What landed is the floor rung — the weight an unlabelled node already
    // carried — never a promotion.
    for (const node of vault.readTree()) {
      expect(node.evidence, node.title).toBe(FLOOR_RUNG);
    }
  });

  test("without --write it is a dry run: the same report, and not one byte moves", () => {
    const before = readAll(dir);

    const dry = migrateEvidenceClass(dir);

    expect(dry.dryRun).toBe(true);
    expect(dry.touched.map((t) => t.file).sort()).toEqual([...before.keys()].sort());
    expect(readAll(dir)).toEqual(before);
    // The rendered report says so out loud — a dry run that reads like a real
    // one is how a migration gets believed without having run.
    expect(formatMigrationReport(dry)).toContain("dry run");
    expect(formatMigrationReport(dry)).toContain("would touch");
  });

  test("a node already carrying a rung — in frontmatter or as a tag — is not opened", () => {
    const viaField = path.join(dir, "Already labelled in frontmatter.md");
    fs.writeFileSync(viaField, "---\ntype: Solution\nevidence: observed\n---\n#Solution\n\nAlready labelled.\n");
    const viaTag = path.join(dir, "Already labelled by tag.md");
    fs.writeFileSync(viaTag, "---\ntype: Solution\n---\n#Solution #evidence/stated\n\nTag only, the pre-frontmatter spelling.\n");
    const fieldBytes = fs.readFileSync(viaField, "utf8");
    const tagBytes = fs.readFileSync(viaTag, "utf8");

    const report = migrateEvidenceClass(dir, { write: true });

    expect(report.alreadyCompliant).toBe(2);
    expect(report.touched.map((t) => t.file)).not.toContain("Already labelled in frontmatter.md");
    expect(report.touched.map((t) => t.file)).not.toContain("Already labelled by tag.md");
    expect(fs.readFileSync(viaField, "utf8")).toBe(fieldBytes);
    expect(fs.readFileSync(viaTag, "utf8")).toBe(tagBytes);
  });

  test("what cannot be decided mechanically is refused, listed node by node with the decision a human owns", () => {
    // An author who wrote SOMETHING that is not a rung made a claim; replacing
    // it would erase a claim, not label an absence. Both spellings refused.
    fs.writeFileSync(path.join(dir, "Claims a rung that does not exist.md"), "---\ntype: Solution\nevidence: proof\n---\n#Solution\n\nA body.\n");
    fs.writeFileSync(path.join(dir, "Tagged with a rung that does not exist.md"), "---\ntype: Solution\n---\n#Solution #evidence/hunch\n\nA body.\n");
    // Frontmatter that will not parse: nothing mechanical can be read out, so
    // nothing mechanical may be written in.
    fs.writeFileSync(path.join(dir, "Broken frontmatter.md"), "---\ntype: Solution\nbad: [unclosed\n---\n#Solution\n\nA body.\n");
    const before = readAll(dir);

    const report = migrateEvidenceClass(dir, { write: true });
    const asks = new Map(report.humansRequired.map((h) => [h.file, h.decide]));

    expect(asks.get("Claims a rung that does not exist.md")).toContain('"proof"');
    expect(asks.get("Tagged with a rung that does not exist.md")).toContain("#evidence/hunch");
    expect(asks.get("Broken frontmatter.md")).toContain("does not parse");
    // Refused means untouched — bytes identical, and absent from the touched list.
    const touched = new Set(report.touched.map((t) => t.file));
    for (const file of asks.keys()) {
      expect(touched.has(file), file).toBe(false);
      expect(fs.readFileSync(path.join(dir, file), "utf8")).toBe(before.get(file));
    }
    // The rendered report carries the full list — the audit trail is never sampled.
    for (const file of asks.keys()) expect(formatMigrationReport(report)).toContain(file);
  });

  test("files check never counts are out of scope: non-nodes and retracted nodes stay byte-identical", () => {
    fs.writeFileSync(path.join(dir, "README.md"), "# Not a node\n\nNo frontmatter type.\n");
    fs.writeFileSync(
      path.join(dir, "A retracted claim.md"),
      "---\ntype: Solution\n---\n#Solution\n\nA body.\n\n## Retraction\n- 2026-07-20 withdrawn by the operator\n",
    );
    const before = readAll(dir);

    const report = migrateEvidenceClass(dir, { write: true });

    expect(report.outOfScope).toBe(2);
    const touched = new Set(report.touched.map((t) => t.file));
    expect(touched.has("README.md")).toBe(false);
    expect(touched.has("A retracted claim.md")).toBe(false);
    expect(fs.readFileSync(path.join(dir, "README.md"), "utf8")).toBe(before.get("README.md"));
    expect(fs.readFileSync(path.join(dir, "A retracted claim.md"), "utf8")).toBe(before.get("A retracted claim.md"));
  });
});
