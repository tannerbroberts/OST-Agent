/**
 * Reconstructing done-ness across an accounting change, and recording that it
 * was reconstructed.
 *
 * **The failure this exists for.** On 2026-07-25 the same vault, read at the same
 * instant by two builds, reported 9 outstanding evidence items and 27. Nothing in
 * the vault had changed: done-ness had moved from a scan of node `source:`
 * frontmatter to a persisted state file no pass had ever written, so every
 * historically-distilled record silently re-opened as unfinished work. The cost is
 * not the wasted passes — it is that the record of what has been done stopped being
 * a property of the vault and became a property of whichever version last looked at
 * it, with nothing anywhere saying the history had been reinterpreted.
 *
 * **What a migration may and may not do.** A migration is a *guess about the past*:
 * it infers a fact the old build never wrote down. The two directions of error cost
 * very different things. Calling something outstanding that was done costs one
 * wasted pass. Calling something done that was not costs a piece of work dropped
 * silently and permanently, in a store built not to forget. So
 * {@link reconstructOldAccounting} is deliberately asymmetric: it marks done only
 * what the old build's own rule marks done, and every weaker signal that *suggests*
 * done-ness is reported as {@link WithheldClaim} for a human instead of migrated.
 * That asymmetry is measured rather than asserted — see the control in
 * `test/ost/accounting-reconstruction.test.ts`.
 *
 * **Where the result is written, and why not into a ledger.** Nowhere, and that is
 * the finding this module carries rather than a gap in it. W12 deleted this
 * product's persisted done-ness ledger precisely because a second answer to "has
 * this been read?" is settable by anything that can drop a file into the vault; the
 * live accounting is derived from the tree, and its one writer is the `source:`
 * frontmatter `ost_create_node` stamps. A migration that "wrote the ledger" today
 * would either re-create that second answer or forge citations into existing nodes
 * — inventing exactly the done-ness the paragraph above forbids. So what this
 * migration migrates is the *statement*: an append-only, in-vault record of which
 * accounting was in force, what it answered, item by item, and what it refused to
 * infer.
 *
 * **That record is the half that would have caught the original failure.**
 * {@link accountingDrift} reads it back and names every item whose done-ness the
 * current build answers differently from the recorded one — separating the
 * dangerous direction (was done, now outstanding: work that has silently re-opened)
 * from the benign one. An upgrade that changes the answer stops being something an
 * agent notices as a count jump and becomes something the vault can state.
 */
import fs from "node:fs";
import path from "node:path";
import { readEvidence } from "../processes/tree.js";
import type { OstNode } from "./node.js";

/**
 * The accounting the reconstruction replays, named by the build that used it.
 *
 * `ost-agent@0.1.3` is the oracle the assumption test names, and its answer is
 * still reproducible: the npm package was unpublished on 2026-07-28, but the `v0.1.3`
 * tag in this repository builds and runs. `test/fixtures/accounting-split/` carries
 * its itemised answer on the vault state that produced the 9-versus-27 split, and
 * `PROVENANCE.md` there carries the commands that regenerate it.
 */
export const OLD_ACCOUNTING = {
  build: "ost-agent@0.1.3",
  /**
   * Stated as the rule rather than as an implementation, because the rule is what a
   * later reader has to be able to check the reconstruction against.
   */
  rule: "an evidence record is done iff some node's `source:` frontmatter cites its id, byte for byte",
  /** The day the split was observed, and the state the reconstruction is measured on. */
  observed: "2026-07-25",
} as const;

/** One evidence record, and what the reconstructed accounting says about it. */
export interface ReconstructedItem {
  id: string;
  /** Done under {@link OLD_ACCOUNTING}. */
  done: boolean;
  /**
   * The node title the done-ness was read off — the whole of the inference, so a
   * reader can go check it — or null when nothing carried it.
   */
  inferredFrom: string | null;
}

/**
 * A done-ness the reconstruction could see a case for and refused to assert.
 *
 * The case is always the same shape: the evidence id appears in some node's prose,
 * so a person distilling it plausibly did the work, but no node cites it as its
 * `source`, so the old build called it outstanding. Migrating it would be an error
 * in the direction that costs a dropped piece of work, so it is named here instead.
 */
export interface WithheldClaim {
  id: string;
  /** Nodes whose prose names the id without citing it. Sorted, complete, never sampled. */
  namedBy: string[];
  reason: string;
}

/** What the old accounting said about this vault, reconstructed item by item. */
export interface AccountingReconstruction {
  build: string;
  rule: string;
  items: ReconstructedItem[];
  /** Ids the reconstruction asserts done. Sorted. */
  done: string[];
  /** Ids the reconstruction leaves outstanding. Sorted. */
  outstanding: string[];
  /** Done-ness a wider rule would have inferred and this one refuses. */
  withheld: WithheldClaim[];
}

/**
 * Replay {@link OLD_ACCOUNTING} over a vault.
 *
 * The tree is passed in rather than read here so the caller decides which tree is
 * being accounted for — the live one, or the one a census already read — and so
 * this function cannot disagree with the caller about what the tree contains.
 */
export function reconstructOldAccounting(dir: string, tree: readonly OstNode[]): AccountingReconstruction {
  const cited = new Map<string, string>();
  // First citation wins, and the tree is walked in order, so a rebuild of the same
  // vault names the same node. An arbitrary winner would make the report's
  // `inferredFrom` unstable and therefore undiffable.
  for (const node of tree) {
    if (node.source && !cited.has(node.source)) cited.set(node.source, node.title);
  }

  const items: ReconstructedItem[] = readEvidence(dir)
    .map((record) => ({
      id: record.id,
      done: cited.has(record.id),
      inferredFrom: cited.get(record.id) ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const outstanding = items.filter((i) => !i.done);
  const withheld: WithheldClaim[] = [];
  for (const item of outstanding) {
    // Substring, not word-boundary: an evidence id is a filename or a uuid and
    // appears in prose exactly as it is written. A looser match here would only
    // widen the population this function is refusing anyway.
    const namedBy = tree
      .filter((n) => n.body.includes(item.id))
      .map((n) => n.title)
      .sort();
    if (namedBy.length === 0) continue;
    withheld.push({
      id: item.id,
      namedBy,
      reason:
        `named in the prose of ${namedBy.length} node(s) but cited as no node's \`source\` — ` +
        `${OLD_ACCOUNTING.build} called it outstanding, and marking it done here would drop it silently`,
    });
  }

  return {
    build: OLD_ACCOUNTING.build,
    rule: OLD_ACCOUNTING.rule,
    items,
    done: items.filter((i) => i.done).map((i) => i.id),
    outstanding: outstanding.map((i) => i.id),
    withheld,
  };
}

/** The append-only record, beside the vault's other state and committed with it. */
const MIGRATION_LEDGER = path.join(".ost-agent", "state", "accounting-migration.jsonl");

/** Where the record lives for a vault. */
export function accountingMigrationPath(dir: string): string {
  return path.join(dir, MIGRATION_LEDGER);
}

/** One migration, as it is written down. */
export interface AccountingMigrationRecord {
  /** ISO instant, supplied by the caller so a test is not at the mercy of a clock. */
  migratedAt: string;
  /** The build whose accounting was reconstructed, and the rule it used. */
  build: string;
  rule: string;
  /** Every stored record the migration accounted for. */
  items: number;
  done: string[];
  outstanding: string[];
  withheld: WithheldClaim[];
}

/**
 * Read every migration ever recorded, oldest first.
 *
 * A line that will not parse is dropped and counted rather than thrown on: this
 * file is read on a path that must not be deniable by one bad byte, and a reader
 * that silently skipped them would be the same class of blindness this module is
 * about. The count is returned, not logged.
 */
export function readAccountingMigrations(dir: string): {
  records: AccountingMigrationRecord[];
  unreadableLines: number;
} {
  const file = accountingMigrationPath(dir);
  if (!fs.existsSync(file)) return { records: [], unreadableLines: 0 };
  const records: AccountingMigrationRecord[] = [];
  let unreadableLines = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as AccountingMigrationRecord;
      if (parsed && typeof parsed.migratedAt === "string" && Array.isArray(parsed.done)) records.push(parsed);
      else unreadableLines++;
    } catch {
      unreadableLines++;
    }
  }
  return { records, unreadableLines };
}

export interface AccountingMigrationReport {
  /** False when this vault already carries a migration; nothing is written twice. */
  firstRun: boolean;
  /** When the earlier migration ran, on a repeat. */
  alreadyMigratedAt?: string;
  reconstruction: AccountingReconstruction;
  /** True when nothing was written — a dry run, or a repeat. */
  dryRun: boolean;
  /** The record appended, on a write. */
  recorded?: AccountingMigrationRecord;
}

/**
 * Run the migration once and record that it happened.
 *
 * "Once" is enforced by reading the ledger rather than by a marker file: the record
 * of what was inferred and the proof that it was inferred are the same bytes, so
 * there is no state in which the vault believes it has migrated and cannot say to
 * what. A second call reports the earlier record and writes nothing.
 */
export function migrateAccounting(
  dir: string,
  tree: readonly OstNode[],
  opts: { write?: boolean; now: string },
): AccountingMigrationReport {
  const reconstruction = reconstructOldAccounting(dir, tree);
  const earlier = readAccountingMigrations(dir).records[0];
  if (earlier) {
    return { firstRun: false, alreadyMigratedAt: earlier.migratedAt, reconstruction, dryRun: true };
  }
  if (!opts.write) return { firstRun: true, reconstruction, dryRun: true };

  const record: AccountingMigrationRecord = {
    migratedAt: opts.now,
    build: reconstruction.build,
    rule: reconstruction.rule,
    items: reconstruction.items.length,
    done: reconstruction.done,
    outstanding: reconstruction.outstanding,
    withheld: reconstruction.withheld,
  };
  const file = accountingMigrationPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n", "utf8");
  return { firstRun: true, reconstruction, dryRun: false, recorded: record };
}

/** How the current accounting differs from the one that was recorded. */
export interface AccountingDrift {
  /** False when nothing has been recorded yet — no drift can be computed, and saying so is the answer. */
  comparable: boolean;
  recordedAt?: string;
  /**
   * Done when the migration ran, outstanding now. This is the dangerous class: work
   * that has silently re-opened, which is the whole failure the opportunity records.
   */
  reopened: string[];
  /** Outstanding when the migration ran, done now — the ordinary result of a pass doing its job. */
  newlyDone: string[];
  /** Accounted for at migration time and no longer stored at all. */
  disappeared: string[];
}

/**
 * Compare the live accounting against the recorded one.
 *
 * The comparison is against the FIRST record, not the most recent: the question is
 * whether done-ness has moved since anybody last stated what it was, and re-recording
 * would reset the baseline every time it was asked.
 */
export function accountingDrift(dir: string, tree: readonly OstNode[]): AccountingDrift {
  const recorded = readAccountingMigrations(dir).records[0];
  if (!recorded) return { comparable: false, reopened: [], newlyDone: [], disappeared: [] };

  const now = reconstructOldAccounting(dir, tree);
  const doneNow = new Set(now.done);
  const stored = new Set(now.items.map((i) => i.id));
  const doneThen = new Set(recorded.done);

  return {
    comparable: true,
    recordedAt: recorded.migratedAt,
    reopened: recorded.done.filter((id) => stored.has(id) && !doneNow.has(id)).sort(),
    newlyDone: now.done.filter((id) => !doneThen.has(id)).sort(),
    disappeared: [...doneThen, ...recorded.outstanding].filter((id) => !stored.has(id)).sort(),
  };
}

/** The migration as a page. Every withheld claim is listed in full — a refusal nobody can read is a silent one. */
export function formatAccountingMigration(report: AccountingMigrationReport): string {
  const r = report.reconstruction;
  const lines: string[] = [];

  if (!report.firstRun) {
    lines.push(`accounting already migrated at ${report.alreadyMigratedAt} — nothing written.`);
  } else {
    lines.push(
      `migrate accounting: reconstructed ${r.build}'s answer over ${r.items.length} stored record(s) — ` +
        `${r.done.length} done, ${r.outstanding.length} outstanding` +
        (report.dryRun ? " (dry run — nothing recorded; pass --write)" : ""),
    );
  }
  lines.push(`  rule: ${r.rule}`);
  lines.push(
    "  nothing is marked done that the rule does not derive from the tree — a migration is a guess about the past, " +
      "and the direction that invents done-ness drops work permanently.",
  );

  if (r.withheld.length > 0) {
    lines.push("");
    lines.push(`  ${r.withheld.length} done-ness claim(s) WITHHELD for a human:`);
    for (const w of r.withheld) {
      lines.push(`    ✗ ${w.id} — ${w.reason}`);
      for (const node of w.namedBy) lines.push(`        named by: ${node}`);
    }
  }

  if (report.recorded) {
    lines.push("");
    lines.push(`  recorded at ${report.recorded.migratedAt} in ${MIGRATION_LEDGER} — append-only, and the baseline drift is measured against.`);
  }
  return lines.join("\n");
}

/** The drift as a page, written so the dangerous direction cannot be skimmed past. */
export function formatAccountingDrift(drift: AccountingDrift): string {
  if (!drift.comparable) {
    return "no accounting has been recorded for this vault, so nothing can be said about whether the answer has changed — run `ost-agent migrate accounting --write`.";
  }
  const lines = [`accounting recorded ${drift.recordedAt}; comparing the live answer against it.`];
  if (drift.reopened.length === 0) {
    lines.push("  0 item(s) re-opened — no work the recorded accounting called done is outstanding now.");
  } else {
    lines.push(`  ${drift.reopened.length} item(s) RE-OPENED — done when the accounting was recorded, outstanding now:`);
    for (const id of drift.reopened) lines.push(`    ! ${id}`);
  }
  if (drift.newlyDone.length > 0) lines.push(`  ${drift.newlyDone.length} item(s) newly done since.`);
  if (drift.disappeared.length > 0) {
    lines.push(`  ${drift.disappeared.length} item(s) accounted for then and no longer stored:`);
    for (const id of drift.disappeared) lines.push(`    ? ${id}`);
  }
  return lines.join("\n");
}
