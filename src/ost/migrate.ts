/**
 * Migrations — the half of a tightening that brings the existing tree with it.
 *
 * A new invariant instantly flags every node written before it, and an
 * append-only surface offers no compliant path back: the evidence-class rule
 * landed on 2026-07-24 and flagged all 57 then-existing nodes with nothing that
 * could remediate one of them, let alone all of them. This module is the shape
 * of the fix — the author of a tightening ships the mechanical remediation with
 * it, plus a node-by-node list of what a script must NOT decide, so the tree is
 * never left in a state nobody has a plan for.
 *
 * The one guarantee every migration here makes: **it moves structure, never
 * wording.** Edits are confined to the frontmatter block, byte-for-byte —
 * everything after the closing `---` is untouched, which a test can (and does)
 * assert mechanically. That is deliberately a frontmatter-only edit rather than
 * a deserialize→serialize round-trip: re-serializing would also rewrite the tag
 * line and re-fold the YAML, and then "the migration changed nothing's meaning"
 * would rest on trusting the serializer instead of on a byte comparison.
 *
 * What byte-identical prose does NOT prove: meaning. A migration that re-parents
 * a node changes what its unchanged words claim, so the human reader is made
 * cheaper here, not redundant — the report names every file touched precisely so
 * that a reader can go look at exactly those and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { FLOOR_RUNG, isRung } from "../knowledge/believability.js";
import { LAYERS, type Layer } from "./node.js";
import { parseFrontmatter } from "./frontmatter.js";
import { isRetractedNode } from "./census.js";

/** Tag form of the evidence class on the tag line: `#evidence/observed`. */
const EVIDENCE_TAG = /#evidence\/(\S+)/;

/** A file the migration changed (or would change, on a dry run). */
export interface MigrationTouch {
  file: string;
  change: string;
}

/**
 * A file the migration refused to change, with the decision only a human can
 * make. The refusal is the feature: a script that "fixed" these would be
 * deciding what an author meant, which is the meaning change this whole module
 * exists to rule out.
 */
export interface MigrationAsk {
  file: string;
  decide: string;
}

export interface MigrationReport {
  /** The invariant this migration remediates, by its `check` rule name. */
  rule: string;
  /** Every file whose bytes changed — the complete list, no sampling. */
  touched: MigrationTouch[];
  /** Files a human must decide about before they can comply. */
  humansRequired: MigrationAsk[];
  /** Nodes that already satisfy the rule; the migration never opens them. */
  alreadyCompliant: number;
  /**
   * Files `check` never counts — non-node markdown and retracted nodes. A file
   * outside the rule's denominator cannot violate it, so bringing one "into
   * compliance" would be an edit with no compliance payoff and a meaning risk.
   */
  outOfScope: number;
  /** True when nothing was written; the report says what a real run would do. */
  dryRun: boolean;
}

/**
 * Insert `evidence: <floor>` as the last frontmatter line, changing no other
 * byte. Returns undefined when the file is not in the one delimiter form this
 * edit can be confined to — the caller reports that as a human's decision
 * rather than guessing at a riskier edit.
 */
function withFloorEvidenceLine(raw: string): string | undefined {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      lines.splice(i, 0, `evidence: ${FLOOR_RUNG}`);
      return lines.join("\n");
    }
  }
  return undefined;
}

/**
 * The migration the evidence-class tightening should have shipped with.
 *
 * Mechanical rule: a node that declares no evidence class is set to the floor
 * rung, in frontmatter only. That is the one assignment that cannot change what
 * a node means, because it is the weight the node already carried — the ladder's
 * own rule is that anything unlabelled or unrecognised rests on `assertion`
 * ({@link FLOOR_RUNG}), and `rung-unearned` can never fire on the floor. The
 * migration makes the default explicit; it never promotes.
 *
 * What it refuses to decide (and lists instead):
 * - frontmatter that does not parse — nothing can be read out of it, so nothing
 *   mechanical can be written into it;
 * - an `evidence:` value (or `#evidence/` tag) that is not a rung — the author
 *   wrote *something*, and replacing it would erase a claim rather than label an
 *   absence. Which rung they meant is exactly a meaning question.
 *
 * Walks the same denominator `Vault.readTreeCensus` walks — `.md` files at the
 * vault root — so the set it can bring into compliance is the set `check`
 * counts, not a second opinion about what a node is.
 */
export function migrateEvidenceClass(dir: string, opts: { write?: boolean } = {}): MigrationReport {
  const report: MigrationReport = {
    rule: "evidence-class",
    touched: [],
    humansRequired: [],
    alreadyCompliant: 0,
    outOfScope: 0,
    dryRun: !opts.write,
  };

  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();

  for (const file of files) {
    const full = path.join(dir, file);
    const raw = fs.readFileSync(full, "utf8");

    let data: Record<string, unknown>;
    let content: string;
    try {
      const parsed = parseFrontmatter(raw);
      data = parsed.data as Record<string, unknown>;
      content = parsed.content;
    } catch (err) {
      report.humansRequired.push({
        file,
        decide: `frontmatter does not parse (${(err as Error).message.split("\n")[0]}) — repair the YAML by hand; nothing mechanical can be read out of it, so nothing mechanical may be written into it`,
      });
      continue;
    }

    // Not a node by the census's own test, or retracted and therefore withheld
    // from every gate: outside the rule's denominator either way.
    if (typeof data.type !== "string" || !LAYERS.includes(data.type as Layer)) {
      report.outOfScope++;
      continue;
    }
    if (isRetractedNode({ body: content })) {
      report.outOfScope++;
      continue;
    }

    const declared = typeof data.evidence === "string" ? data.evidence : undefined;
    const tagged = EVIDENCE_TAG.exec(content)?.[1];

    if ((declared && isRung(declared)) || (tagged && isRung(tagged))) {
      report.alreadyCompliant++;
      continue;
    }
    if (declared !== undefined) {
      report.humansRequired.push({
        file,
        decide: `frontmatter declares evidence: ${JSON.stringify(declared)}, which is not a rung — the author claimed something; decide which rung they meant, because overwriting it would erase a claim rather than label an absence`,
      });
      continue;
    }
    if (tagged !== undefined) {
      report.humansRequired.push({
        file,
        decide: `tag line carries #evidence/${tagged}, which is not a rung — decide which rung was meant; a frontmatter line contradicting the tag would leave the node saying two things`,
      });
      continue;
    }

    const migrated = withFloorEvidenceLine(raw);
    if (migrated === undefined) {
      report.humansRequired.push({
        file,
        decide: "frontmatter parsed but is not in the `---` delimiter form this edit can be confined to — add the evidence line by hand",
      });
      continue;
    }
    if (opts.write) fs.writeFileSync(full, migrated);
    report.touched.push({
      file,
      change: `evidence: ${FLOOR_RUNG} added to frontmatter — the floor rung, the weight an unlabelled node already carried`,
    });
  }

  return report;
}

/**
 * The report, rendered node by node. Every touched file and every human
 * decision is listed in full — a migration that sampled its own audit trail
 * would leave a reader unable to check exactly the files that moved.
 */
export function formatMigrationReport(r: MigrationReport): string {
  const lines: string[] = [];
  const verb = r.dryRun ? "would touch" : "touched";
  lines.push(
    `migrate ${r.rule}: ${verb} ${r.touched.length} node(s), ${r.humansRequired.length} need(s) a human, ` +
      `${r.alreadyCompliant} already compliant, ${r.outOfScope} out of scope${r.dryRun ? " (dry run — nothing written; pass --write)" : ""}`,
  );
  for (const t of r.touched) lines.push(`  ~ ${t.file} — ${t.change}`);
  for (const h of r.humansRequired) lines.push(`  ✗ ${h.file} — ${h.decide}`);
  return lines.join("\n");
}
