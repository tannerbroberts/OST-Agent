/**
 * The instrument for "A check with an empty subject is a failure, not a pass" —
 * and, beside it, the replay its own assumption test asked for.
 *
 * **The two halves and why they are in one file.** The solution says any sweep
 * whose subject count is zero exits non-zero and says so, rather than reporting
 * zero findings. Its assumption test does not dispute that this is buildable — it
 * disputes that it is worth building, because the failure that produced the
 * candidate was a sweep that read 302 of 306 entries. An all-or-nothing guard is
 * silent on that. So the definition of done is deliberately a pair: the guard
 * exists AND the recorded sweeps can be replayed to say how many were blind all
 * the way rather than partly. Half of that without the other half is either an
 * unmeasured mechanism or a measurement of nothing.
 *
 * **What green here does and does not license.** Green means a sweep that read
 * nothing is reported as a failure rather than a clean run, and that a run's
 * subject count is preserved well enough to classify later. It says nothing about
 * whether the blindness rate is high enough to justify the guard. Nothing in this
 * file asserts a threshold, on purpose: the 30% pre-committed in the assumption
 * test is a reading an operator takes off `ost-agent sweeps`, and a test that took
 * it here would be the check grading its own homework.
 *
 * **Non-vacuity.** Every guard assertion has a positive control beside it — the
 * same code path over a subject that is really there, coming out clean and
 * exit-0. Without those, a bug that made every census read as blind would turn
 * this whole file green, which is the precise failure mode it exists to catch.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { strandedEvidenceCensus, formatStrandedCensus } from "../../src/ost/stranded.js";
import {
  blindnessCensus,
  classifyRun,
  classifySubject,
  formatBlindnessCensus,
  readSweepRuns,
  recordSweepRun,
  sweepReport,
  type RecordedSweepRun,
} from "../../src/ost/sweep.js";
import { readEvidenceScan, writeEvidence } from "../../src/processes/tree.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

// The local tsx binary rather than `npx`, which takes npm's cacache lock.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dirs: string[];

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-blind-sweep-"));
  dirs.push(dir);
  return dir;
}

/** A vault the loop can record into — the ledger lives under `.git/ost-agent/`. */
function makeGitVault(): string {
  const dir = makeVault();
  spawnSync("git", ["init", "-q"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function evidence(dir: string, id: string, title = `record ${id}`): void {
  writeEvidence(dir, { id, source: "fixture", title, timestamp: "2026-08-04T00:00:00Z", body: "captured." }, "transcript");
}

/**
 * An evidence file whose frontmatter will not parse.
 *
 * This is not a contrived shape. `readEvidence` swallows exactly this failure —
 * deliberately, so one bad file cannot take `ost_next_work` down with it — and the
 * directory is fed by an untrusted builder by design. A skip that costs one record
 * and no words is how a sweep goes partly blind in this codebase today.
 */
function unparseableEvidence(dir: string, name: string): void {
  const d = path.join(dir, ".ost-agent", "evidence");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), '---\nid: "unclosed\ntitle: [1, 2\n---\n\nbody\n', "utf8");
}

function opportunity(title: string, body: string): OstNode {
  return { title, layer: "Opportunity", status: "unvalidated", tags: ["unvalidated"], links: [], body };
}

interface Ran {
  code: number;
  out: string;
}

/** stdout and stderr together: a refusal goes to stderr and is the thing being asserted. */
function cli(...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("a sweep that read nothing is a failure, not a clean run", () => {
  test("the subject decides the verdict before any finding is consulted", () => {
    expect(classifySubject({ offered: 0, read: 0 })).toBe("totally-blind");
    // Offered but unread is still blind. "There were 306 files and I opened none"
    // is not a cleaner state than "there were no files".
    expect(classifySubject({ offered: 306, read: 0 })).toBe("totally-blind");
    expect(classifySubject({ offered: 306, read: 302 })).toBe("partly-blind");
    expect(classifySubject({ offered: 306, read: 306 })).toBe("full");
    // A subject that read more than it was offered is a mis-declaration, not a
    // thorough run — it throws rather than rounding to `full`.
    expect(() => classifySubject({ offered: 1, read: 2 })).toThrow(/cannot read 2 of 1/);
  });

  test("a blind sweep exits non-zero and its report cannot be read as clean", () => {
    const blind = sweepReport("em-dash", { offered: 0, read: 0 }, 0);

    expect(blind.outcome).toBe("blind");
    expect(blind.exitCode).not.toBe(0);
    const text = blind.lines.join("\n");
    expect(text).toContain("BLIND");
    expect(text).toContain("read 0 of 0");
    // The one sentence this whole solution exists to make inexpressible.
    expect(text).not.toMatch(/clean/i);
    expect(text).not.toMatch(/\b0 findings\b/);
  });

  /**
   * The positive control. Without it, code that classified everything as blind
   * would pass the test above and this file would certify the opposite of what it
   * is for.
   */
  test("a sweep that read its whole subject and found nothing is clean, and exits 0", () => {
    const clean = sweepReport("em-dash", { offered: 306, read: 306 }, 0);

    expect(clean.outcome).toBe("clean");
    expect(clean.exitCode).toBe(0);
    // The denominator travels with the verdict. "0 findings" alone is the sentence
    // that has been wrong in this repository; "0 findings over 306" cannot be.
    expect(clean.lines.join("\n")).toContain("0 findings over 306 of 306 subject(s)");
  });

  test("a partly blind sweep still reports, and says what it did not reach", () => {
    // This is the case the solution node concedes it does not catch, and the
    // concession is honoured rather than quietly upgraded: the outcome is `clean`,
    // the exit code is 0, and the shortfall is in the operator's line.
    const partial = sweepReport("em-dash", { offered: 306, read: 302 }, 0);

    expect(partial.outcome).toBe("clean");
    expect(partial.exitCode).toBe(0);
    expect(partial.blindness).toBe("partly-blind");
    expect(partial.lines.join("\n")).toContain("4 skipped — this run was partly blind");
  });
});

describe("the guard on a real sweep, not only on the primitive", () => {
  /**
   * `ost-agent stranded` is the sweep in this product that can most easily be
   * pointed at nothing: `--also <dir>` takes a path a human typed, and a mistyped
   * one produced "0 stranded of 0 records across 1 vault(s)" — true, clean-looking,
   * and meaning nobody looked.
   */
  test("a stranded census over a vault with no evidence is blind, not clean", () => {
    const empty = makeVault();

    const census = strandedEvidenceCensus([empty]);

    expect(census.blindness).toBe("totally-blind");
    const text = formatStrandedCensus(census);
    expect(text).toContain("BLIND");
    expect(text).toContain("A sweep with an empty subject is a failure, not a pass");
    expect(text).not.toMatch(/^Stranded evidence: 0 of 0/m);
  });

  test("the same census over a vault that has evidence is not blind", () => {
    const dir = makeVault();
    evidence(dir, "TRANSCRIPT:aaa");
    new Vault(dir).createNode(opportunity("Shell quoting fails the same way", "See `TRANSCRIPT:aaa`."));

    const census = strandedEvidenceCensus([dir]);

    expect(census.blindness).toBe("full");
    expect(census.subject).toEqual({ offered: 1, read: 1 });
    expect(formatStrandedCensus(census)).not.toContain("BLIND");
  });

  /**
   * The partly-blind shape, on the real sweep. `examined` was the only
   * denominator this census reported, and it counts records that PARSED — so four
   * unreadable files out of five made "1 of 1 examined" a true sentence about a
   * subject that had silently lost 80% of itself.
   */
  test("evidence files that would not parse are counted, not silently dropped", () => {
    const dir = makeVault();
    evidence(dir, "TRANSCRIPT:good");
    unparseableEvidence(dir, "broken.md");

    const scan = readEvidenceScan(dir);
    expect(scan.offered).toBe(2);
    expect(scan.records).toHaveLength(1);
    expect(scan.unreadable).toEqual(["broken.md"]);

    const census = strandedEvidenceCensus([dir]);
    expect(census.blindness).toBe("partly-blind");
    expect(census.subject).toEqual({ offered: 2, read: 1 });
    const text = formatStrandedCensus(census);
    expect(text).toContain("partly blind");
    expect(text).toContain("broken.md");
  });

  /**
   * The subject a sweep reports has to be a fact about the directory, not about
   * how many times this process has looked at it.
   *
   * Found while building the guard, and it was live: `gray-matter` writes its cache
   * entry BEFORE parsing, so a file whose YAML throws is left cached as `data: {}`
   * with the raw text as its body. The first read of `broken.md` threw and the file
   * was dropped; every read after it in the same process returned the cached
   * half-built object instead — no throw, and the file admitted as a record whose
   * `id` defaulted to its own filename. Two reads of one unchanged directory, two
   * different subject counts, and the second one silently larger. A guard that
   * reports what a sweep read is worth nothing while that is true, which is why
   * this is pinned here rather than only fixed.
   */
  test("reading the same evidence directory twice gives the same subject both times", () => {
    const dir = makeVault();
    evidence(dir, "TRANSCRIPT:good");
    unparseableEvidence(dir, "broken.md");

    const first = readEvidenceScan(dir);
    const second = readEvidenceScan(dir);

    expect(second.offered).toBe(first.offered);
    expect(second.records.map((r) => r.id)).toEqual(first.records.map((r) => r.id));
    expect(second.unreadable).toEqual(first.unreadable);
    // Named rather than only compared: an implementation that dropped BOTH files
    // every time would satisfy the equalities above and be blind, not stable.
    expect(second.records.map((r) => r.id)).toEqual(["TRANSCRIPT:good"]);
    expect(second.unreadable).toEqual(["broken.md"]);
  });

  /**
   * The same cache, on the node reader. A vault census that files one file under
   * `unreadable` on the first read and under `skipped` on the second is reporting
   * two different facts about one byte-identical directory.
   */
  test("reading the same tree twice classifies an unparseable node file the same way", () => {
    const dir = makeVault();
    new Vault(dir).createNode(opportunity("A real node", "body"));
    fs.writeFileSync(path.join(dir, "Broken node.md"), '---\ntype: "unclosed\n---\n\nbody\n', "utf8");

    const vault = new Vault(dir);
    const first = vault.readTreeCensus();
    const second = vault.readTreeCensus();

    expect(second.unreadable.map((u) => u.file)).toEqual(first.unreadable.map((u) => u.file));
    expect(second.skipped.map((s) => s.file)).toEqual(first.skipped.map((s) => s.file));
    expect(second.unreadable.map((u) => u.file)).toEqual(["Broken node.md"]);
    expect(second.nodes.map((n) => n.title)).toEqual(["A real node"]);
  });

  test("the CLI exits non-zero on a blind census and 0 on one that read something", () => {
    const empty = makeGitVault();
    const blind = cli("stranded", "--vault", empty);
    expect(blind.code).toBe(1);
    expect(blind.out).toContain("BLIND");

    const full = makeGitVault();
    evidence(full, "TRANSCRIPT:aaa");
    const clean = cli("stranded", "--vault", full);
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("Stranded evidence: 1 of 1");
  });
});

describe("replaying recorded sweeps to say how many were blind all the way rather than partly", () => {
  /**
   * The classifier, against every shape a record can take, including the two that
   * are not degrees of blindness at all. `unrecorded` exists so that an unknown
   * can never be folded into `full` — which is the same rounding, one level up,
   * that this whole solution refuses.
   */
  test("a run is classified from its recorded subject, and an unrecorded subject stays unknown", () => {
    expect(classifyRun({ sweep: "s", at: "t", subject: { offered: 10, read: 10 } })).toBe("full");
    expect(classifyRun({ sweep: "s", at: "t", subject: { offered: 10, read: 7 } })).toBe("partly-blind");
    expect(classifyRun({ sweep: "s", at: "t", subject: { offered: 10, read: 0 } })).toBe("totally-blind");
    // The shape of every sweep run this product recorded before the subject count
    // existed: exit code, timestamp, no denominator.
    expect(classifyRun({ sweep: "s", at: "t" })).toBe("unrecorded");
    // A malformed subject is a record nobody can take a reading off, not a run
    // that was thorough.
    expect(classifyRun({ sweep: "s", at: "t", subject: { offered: 3, read: 9 } })).toBe("unrecorded");
  });

  test("the census counts the three kinds and reports the share the guard is judged on", () => {
    const runs: RecordedSweepRun[] = [
      { sweep: "a", at: "1", subject: { offered: 10, read: 10 } },
      { sweep: "a", at: "2", subject: { offered: 10, read: 10 } },
      { sweep: "a", at: "3", subject: { offered: 10, read: 9 } },
      { sweep: "b", at: "4", subject: { offered: 10, read: 9 } },
      { sweep: "b", at: "5", subject: { offered: 10, read: 9 } },
      { sweep: "b", at: "6", subject: { offered: 0, read: 0 } },
    ];

    const census = blindnessCensus(runs);

    expect(census.runs).toBe(6);
    expect(census.full).toBe(2);
    expect(census.partlyBlind).toBe(3);
    expect(census.totallyBlind).toBe(1);
    expect(census.unclassifiable).toBe(0);
    expect(census.nonFull).toBe(4);
    // The one number the assumption test pre-committed a threshold against. It is
    // reported here and judged nowhere in this file.
    expect(census.totallyBlindShareOfNonFull).toBeCloseTo(0.25);
    expect(formatBlindnessCensus(census)).toContain("25% of the 4 non-full run(s) were totally blind");
  });

  test("a replay with no non-full run reports no share rather than a flattering zero", () => {
    const census = blindnessCensus([{ sweep: "a", at: "1", subject: { offered: 4, read: 4 } }]);

    expect(census.totallyBlindShareOfNonFull).toBeNull();
    expect(formatBlindnessCensus(census)).toContain("no run fell short of its subject");
  });

  /**
   * What a result must also state, per the assumption test: how many runs could
   * not be classified because the record does not preserve a subject count. If
   * that number dominates, the finding is about the records rather than about
   * blindness, and the report has to say so instead of quoting a rate over the
   * handful it could read.
   */
  test("runs the record cannot classify are counted and named, never rounded into `full`", () => {
    const census = blindnessCensus([
      { sweep: "legacy", at: "1" },
      { sweep: "legacy", at: "2" },
      { sweep: "legacy", at: "3" },
      { sweep: "modern", at: "4", subject: { offered: 5, read: 5 } },
    ]);

    expect(census.unclassifiable).toBe(3);
    expect(census.full).toBe(1);
    const text = formatBlindnessCensus(census);
    expect(text).toContain("3 run(s) could not be classified because the record preserves no subject count");
    expect(text).toContain("this is a finding about the records, not about blindness");
  });

  test("a ledger line that will not parse becomes an unclassifiable run, not a missing one", () => {
    const dir = makeGitVault();
    recordSweepRun(dir, { sweep: "stranded", at: "1", subject: { offered: 3, read: 3 } });
    const ledger = path.join(dir, ".git", "ost-agent", "sweeps.jsonl");
    fs.appendFileSync(ledger, "{not json\n");
    recordSweepRun(dir, { sweep: "stranded", at: "2", subject: { offered: 3, read: 0 } });

    const runs = readSweepRuns(dir);

    // Three lines in, three runs out. A reader that dropped the bad line would be
    // a partly blind sweep reporting a clean replay.
    expect(runs).toHaveLength(3);
    const census = blindnessCensus(runs);
    expect(census.unclassifiable).toBe(1);
    expect(census.unreadable).toBe(1);
    expect(census.totallyBlind).toBe(1);
    expect(formatBlindnessCensus(census)).toContain("1 of them unparseable ledger line(s)");
  });

  test("an empty ledger is refused as nothing to replay, not reported as no blindness", () => {
    const dir = makeGitVault();

    const ran = cli("sweeps", "--vault", dir);

    expect(ran.code).toBe(1);
    expect(ran.out).toContain("nothing to replay");
  });

  /**
   * End to end, and the half that makes the replay stop being blind about
   * blindness: a real sweep run has to leave a record carrying its subject count,
   * or `ost-agent sweeps` is a census over nothing forever.
   */
  test("a real sweep records its subject count, and the replay reads it back", () => {
    const dir = makeGitVault();
    evidence(dir, "TRANSCRIPT:aaa");
    evidence(dir, "USAGE:2026-07-27");

    expect(cli("stranded", "--vault", dir).code).toBe(0);
    expect(cli("stranded", "--vault", dir).code).toBe(0);

    const runs = readSweepRuns(dir);
    expect(runs).toHaveLength(2);
    expect(runs[0].sweep).toBe("stranded");
    expect(runs[0].subject).toEqual({ offered: 2, read: 2 });

    const replay = cli("sweeps", "--vault", dir);
    expect(replay.code).toBe(0);
    expect(replay.out).toContain("2 recorded run(s)");
    expect(replay.out).toContain("2 read their whole subject");
    expect(replay.out).toContain("0 run(s) could not be classified");
  });

  test("a blind run is recorded as blind, so the census it feeds is not made only of good days", () => {
    const dir = makeGitVault();

    // Exits 1 — and still records, which is the point: a ledger written only on
    // the runs that succeeded measures nothing about the ones that did not.
    expect(cli("stranded", "--vault", dir).code).toBe(1);

    const runs = readSweepRuns(dir);
    expect(runs).toHaveLength(1);
    expect(runs[0].outcome).toBe("blind");
    expect(blindnessCensus(runs).totallyBlind).toBe(1);
  });
});
