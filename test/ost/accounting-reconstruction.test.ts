/**
 * "Reconstruct the old accounting on a copy and see if it agrees."
 *
 * **The threshold, from the assumption test, unchanged.** Reconstruction agrees with
 * `ost-agent@0.1.3`'s own answer on at least 26 of the 27 items, with **zero** items
 * marked done that the old build called outstanding.
 *
 * **The asymmetry is the whole design and is not smoothed out here.** Calling
 * something outstanding that was done costs a wasted pass. Calling something done
 * that was not drops a piece of work silently and permanently, in an append-only
 * store. One miss is tolerated in the safe direction and none in the dangerous one —
 * so a command that averaged the two would pass on exactly the failure that matters,
 * and the two clauses below are asserted separately for that reason.
 *
 * **The oracle was run, not inferred.** `test/fixtures/accounting-split/` holds the
 * vault state that produced the 9-versus-27 split (meta-vault commit `5f7875bb`,
 * 2026-07-25T02:01:38Z) and `ost-agent@0.1.3`'s itemised answer on it, produced by
 * building the `v0.1.3` tag in this repository and running its `ost_next_work`.
 * `PROVENANCE.md` there carries the commands. The npm package was unpublished on
 * 2026-07-28, so the tag is the only surviving copy of the oracle — which is worth
 * knowing before anyone plans another test around re-running an old release.
 *
 * **Non-vacuity.** Agreement on 27 of 27 could mean the reconstruction is right or it
 * could mean the threshold is impossible to fail. `a wider rule breaks the
 * zero-tolerance clause` is the control: reading prose citations instead of
 * frontmatter ones — the widening the solution node speculates about, in its own
 * words "node sources, history entries, whatever carried done-ness before" — marks
 * four of the old build's nine outstanding items done. The bar discriminates.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { initVault } from "../../src/runner/init.js";
import { writeEvidence } from "../../src/processes/tree.js";
import {
  accountingDrift,
  accountingMigrationPath,
  formatAccountingDrift,
  formatAccountingMigration,
  migrateAccounting,
  readAccountingMigrations,
  reconstructOldAccounting,
  OLD_ACCOUNTING,
} from "../../src/ost/accounting-reconstruction.js";

const fixtureDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/accounting-split");

interface Oracle {
  oldBuild: { version: string; outstanding: string[]; outstandingCount: number; doneCount: number };
  newBuildAtTheTime: { outstandingCount: number };
  items: string[];
  itemCount: number;
}
const oracle = JSON.parse(fs.readFileSync(path.join(fixtureDir, "oracle-0.1.3.json"), "utf8")) as Oracle;

/** The migration writes into the vault, so every run gets its own copy. "On a copy" is the test's own name. */
function copyOfTheSplitVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-accounting-"));
  fs.cpSync(path.join(fixtureDir, "vault"), dir, { recursive: true });
  return dir;
}

const NOW = "2026-08-23T00:00:00.000Z";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(make: () => string): string {
  const d = make();
  dirs.push(d);
  return d;
}

describe("the fixture is the moment the friction note recorded", () => {
  test("27 stored records, 9 of them outstanding under the old build", () => {
    // Guards the rest of the file: every assertion below is stated against these
    // numbers, and a fixture that quietly lost half its evidence would make them
    // all pass while measuring a different vault.
    expect(oracle.itemCount).toBe(27);
    expect(oracle.items).toHaveLength(27);
    expect(oracle.oldBuild.version).toBe("0.1.3");
    expect(oracle.oldBuild.outstandingCount).toBe(9);
    expect(oracle.oldBuild.outstanding).toHaveLength(9);
    expect(oracle.oldBuild.doneCount).toBe(18);
    // The other half of the split: the build of the day re-opened all 27.
    expect(oracle.newBuildAtTheTime.outstandingCount).toBe(27);
  });
});

describe("reconstruction against the vault state that produced the 9-versus-27 split", () => {
  test("agrees with the old build's own answer on at least 26 of the 27 items", () => {
    const dir = tmp(copyOfTheSplitVault);
    const r = reconstructOldAccounting(dir, new Vault(dir, { create: false }).readTree());

    expect(r.items.map((i) => i.id).sort()).toEqual([...oracle.items].sort());

    const outstandingByOracle = new Set(oracle.oldBuild.outstanding);
    const agreed = r.items.filter((i) => i.done === !outstandingByOracle.has(i.id));
    expect(agreed.length).toBeGreaterThanOrEqual(26);
  });

  test("ZERO items are marked done that the old build called outstanding", () => {
    const dir = tmp(copyOfTheSplitVault);
    const r = reconstructOldAccounting(dir, new Vault(dir, { create: false }).readTree());

    const wronglyDone = oracle.oldBuild.outstanding.filter((id) => r.done.includes(id));
    expect(wronglyDone).toEqual([]);
  });

  test("every done-ness it asserts names the node it was read off", () => {
    const dir = tmp(copyOfTheSplitVault);
    const r = reconstructOldAccounting(dir, new Vault(dir, { create: false }).readTree());

    expect(r.done).toHaveLength(18);
    for (const item of r.items.filter((i) => i.done)) {
      expect(item.inferredFrom, `${item.id} is done with nothing to point at`).toBeTruthy();
    }
    for (const item of r.items.filter((i) => !i.done)) expect(item.inferredFrom).toBeNull();
  });

  test("CONTROL — a wider rule that reads prose citations breaks the zero-tolerance clause", () => {
    // The solution node's own framing is "node sources, history entries, whatever
    // carried done-ness before". This is that widening, measured: an id named in a
    // node's prose but cited as nobody's `source`. Four of the old build's nine
    // outstanding items would flip to done under it — four pieces of work dropped
    // silently, in the direction the threshold tolerates none of.
    //
    // Without this the two assertions above would pass just as happily against a
    // bar nothing can fail.
    const dir = tmp(copyOfTheSplitVault);
    const r = reconstructOldAccounting(dir, new Vault(dir, { create: false }).readTree());

    const outstandingByOracle = new Set(oracle.oldBuild.outstanding);
    const widened = r.withheld.filter((w) => outstandingByOracle.has(w.id));
    expect(widened).toHaveLength(4);
    for (const w of widened) expect(w.namedBy.length).toBeGreaterThan(0);

    // …and every one of them is refused rather than migrated.
    for (const w of widened) expect(r.done).not.toContain(w.id);
  });
});

describe("the live case — done-ness recorded by appending to an existing node", () => {
  /**
   * The Issues section of the opportunity records this happening now rather than
   * historically: two TRANSCRIPT ids sat in a ledger as done while the counter called
   * them outstanding, because appending a corroborating section to an existing node
   * does not add the id to the derived accounting — only a node created with a
   * `source` does. The ids are the ones that were recorded; the vault is built here
   * because the state file they sat in is not a thing this product reads any more.
   */
  const LIVE = ["TRANSCRIPT:5e5c119d-e5e8-4dbd-ab7c-c4bfc1247a18", "TRANSCRIPT:8fc8d6e3-7cae-41e0-a83b-e32346e352b1"];

  test("stays outstanding, and is reported as a withheld claim rather than migrated", async () => {
    const dir = tmp(() => fs.mkdtempSync(path.join(os.tmpdir(), "ost-accounting-live-")));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const vault = new Vault(dir);
    for (const id of LIVE) {
      writeEvidence(dir, { id, source: id, title: id, timestamp: "2026-08-02T00:00:00Z", body: "A session." }, "transcript");
      vault.appendToNode("Retention", `## Corroboration\n\nSeen again in ${id}.`);
    }

    const r = reconstructOldAccounting(dir, vault.readTree());
    expect(r.done).toEqual([]);
    expect(r.outstanding.sort()).toEqual([...LIVE].sort());
    expect(r.withheld.map((w) => w.id).sort()).toEqual([...LIVE].sort());
    for (const w of r.withheld) expect(w.namedBy).toEqual(["Retention"]);

    // CONTROL — the one writer the derived accounting has still works. Without this,
    // the block above would pass on a reconstruction that can never call anything done.
    vault.createNode({
      title: "Players want a reason to return",
      layer: "Opportunity",
      source: LIVE[0],
      evidence: "assertion",
      body: "prose",
      tags: [],
      links: [],
    });
    vault.linkNodes("Retention", "Players want a reason to return");
    const after = reconstructOldAccounting(dir, vault.readTree());
    expect(after.done).toEqual([LIVE[0]]);
    expect(after.withheld.map((w) => w.id)).toEqual([LIVE[1]]);
  });
});

describe("the migration runs once and records what it inferred, and from what", () => {
  test("a dry run writes nothing", () => {
    const dir = tmp(copyOfTheSplitVault);
    const report = migrateAccounting(dir, new Vault(dir, { create: false }).readTree(), { now: NOW });

    expect(report.firstRun).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(fs.existsSync(accountingMigrationPath(dir))).toBe(false);
    expect(formatAccountingMigration(report)).toContain("dry run");
  });

  test("--write appends one record naming the accounting, the counts and every refusal", () => {
    const dir = tmp(copyOfTheSplitVault);
    const report = migrateAccounting(dir, new Vault(dir, { create: false }).readTree(), { write: true, now: NOW });

    expect(report.recorded).toBeDefined();
    const { records, unreadableLines } = readAccountingMigrations(dir);
    expect(unreadableLines).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0].migratedAt).toBe(NOW);
    expect(records[0].build).toBe(OLD_ACCOUNTING.build);
    expect(records[0].rule).toBe(OLD_ACCOUNTING.rule);
    expect(records[0].items).toBe(27);
    expect(records[0].done).toHaveLength(18);
    expect(records[0].outstanding).toHaveLength(9);
    // The refusals are in the record, not only in the console output a nightly run throws away.
    expect(records[0].withheld.map((w) => w.id).sort()).toEqual(report.reconstruction.withheld.map((w) => w.id).sort());

    const page = formatAccountingMigration(report);
    for (const w of report.reconstruction.withheld) expect(page).toContain(w.id);
  });

  test("a second run writes nothing and says when the first one happened", () => {
    const dir = tmp(copyOfTheSplitVault);
    const tree = new Vault(dir, { create: false }).readTree();
    migrateAccounting(dir, tree, { write: true, now: NOW });
    const again = migrateAccounting(dir, tree, { write: true, now: "2026-09-01T00:00:00.000Z" });

    expect(again.firstRun).toBe(false);
    expect(again.alreadyMigratedAt).toBe(NOW);
    expect(again.dryRun).toBe(true);
    expect(readAccountingMigrations(dir).records).toHaveLength(1);
    expect(formatAccountingMigration(again)).toContain("already migrated");
  });

  test("one unparseable line costs that line and not the read", () => {
    const dir = tmp(copyOfTheSplitVault);
    migrateAccounting(dir, new Vault(dir, { create: false }).readTree(), { write: true, now: NOW });
    fs.appendFileSync(accountingMigrationPath(dir), "{ not json\n", "utf8");

    const { records, unreadableLines } = readAccountingMigrations(dir);
    expect(records).toHaveLength(1);
    expect(unreadableLines).toBe(1);
  });
});

describe("drift — an accounting that changed its answer is stated rather than folded into the counts", () => {
  test("with nothing recorded, it says so instead of reporting no drift", () => {
    const dir = tmp(copyOfTheSplitVault);
    const drift = accountingDrift(dir, new Vault(dir, { create: false }).readTree());

    expect(drift.comparable).toBe(false);
    expect(formatAccountingDrift(drift)).toContain("no accounting has been recorded");
  });

  test("an item the tree no longer accounts for is reported as re-opened", () => {
    const dir = tmp(copyOfTheSplitVault);
    const vault = new Vault(dir, { create: false });
    migrateAccounting(dir, vault.readTree(), { write: true, now: NOW });

    const before = accountingDrift(dir, vault.readTree());
    expect(before.reopened).toEqual([]);
    expect(formatAccountingDrift(before)).toContain("0 item(s) re-opened");

    // The failure the opportunity records, in one line: a signal that carried a
    // record's done-ness stops being read. Modelled by withholding the citations the
    // accounting reads rather than by editing the vault, because that is exactly what
    // an upgrade did — the bytes stayed put and the rule stopped counting them.
    const recorded = readAccountingMigrations(dir).records[0];
    const carrier = reconstructOldAccounting(dir, vault.readTree()).items.find((i) => i.done)!;
    const blinded = vault.readTree().filter((n) => n.source !== carrier.id);

    const after = accountingDrift(dir, blinded);
    expect(after.comparable).toBe(true);
    expect(after.recordedAt).toBe(recorded.migratedAt);
    expect(after.reopened).toEqual([carrier.id]);
    expect(formatAccountingDrift(after)).toContain(carrier.id);
  });

  test("work distilled since the migration is reported as newly done, not as drift to worry about", () => {
    const dir = tmp(copyOfTheSplitVault);
    const vault = new Vault(dir, { create: false });
    migrateAccounting(dir, vault.readTree(), { write: true, now: NOW });

    const outstanding = readAccountingMigrations(dir).records[0].outstanding[0];
    vault.createNode({
      title: "A distillation of the item nobody had mapped",
      layer: "Opportunity",
      source: outstanding,
      evidence: "assertion",
      body: "prose",
      tags: [],
      links: [],
    });

    const drift = accountingDrift(dir, vault.readTree());
    expect(drift.newlyDone).toEqual([outstanding]);
    expect(drift.reopened).toEqual([]);
  });
});
