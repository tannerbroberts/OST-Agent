/**
 * "Let a pass mark evidence acknowledged, with a reason, without inventing an
 * opportunity" — the instrument behind "Blind-review a pass's acknowledge-or-map calls
 * on the seven stranded items".
 *
 * An evidence item leaves this product's sweep by exactly one route: some node's
 * frontmatter `source:` equals its id. A body citation is invisible to the sweep however
 * complete, and `source:` is settable only at creation — so when the honest reading of an
 * item is "this corroborates a need the tree already holds", the only mechanical way to
 * clear it was to mint a duplicate of a node the tree already has. Three consecutive
 * sweeps of this project's own vault read their stranded items in full, found the same
 * six needs behind all of them, and cleared none: 7 stranded became 18, 18 became 63.
 *
 * What this file pins is that the other route exists and cannot be abused as a silent
 * dismissal — the DEFINITION OF DONE off the solution node, verb-first:
 *
 *   - the verb is a command a human runs, and acknowledging through it records a reason
 *     and the node the item was filed under, and takes the item off `unmappedEvidence`
 *     as the REAL sweep computes it — no node created, no record deleted;
 *   - it is refused with no reason given;
 *   - it is refused when the node it names is not in the tree. That refusal is the whole
 *     harm check. `corroborates [[X]]` is the one verdict whose entire justification for
 *     removing work is a pointer into the tree, so a pointer that resolves to nothing is
 *     a dismissal wearing a citation: it clears the item, it prints in the audit like a
 *     filing, and it strengthens nothing forever;
 *   - and because a title can stop resolving AFTER the write — this vault's nodes get
 *     retitled in Obsidian, which is a plain file rename — the pointer is resolved again
 *     on every read. An acknowledgement whose node has left the tree withholds nothing:
 *     its item is listed again, and the audit surface names it instead of printing it
 *     among the live filings.
 *
 * What a green here does NOT settle, and it is the assumption test's own question:
 * whether the reasons a pass wrote were honest filing or avoidance. That is a blind human
 * review of real calls against a real vault, and it stays with a human.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { byTitle, readEvidence, writeEvidence } from "../../src/processes/tree.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import {
  appendDisposition,
  corroborationsFor,
  dispositionLedgerPath,
  formatDispositions,
  readDispositionLedger,
} from "../../src/knowledge/dispositions.js";

// See the note in `test/cli/dispose.test.ts`: the local tsx binary directly, never
// through `npx`, so concurrent spawns do not contend on npm's cacache lock.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

const OUTCOME = "Retention";
const NEED = "Users churn after week one";
const STRANDED = "TRANSCRIPT:ninth-session-with-the-same-stall.md";

const CLOCK = (): Date => new Date("2026-08-22T10:00:00.000Z");

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-evidence-acknowledge-"));
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * The trap in miniature: one need the tree already holds, and one evidence record that
 * says the same thing a ninth time. Mapping it means minting a duplicate of `NEED`.
 */
function vaultWithOneStrandedItem() {
  const v = buildPassContext(dir).vault;
  v.createNode({ title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  v.linkNodes(OUTCOME, NEED);
  writeEvidence(
    dir,
    { id: STRANDED, source: STRANDED, title: "Same stall, ninth session", timestamp: "2026-08-01", body: "b" },
    "transcript",
  );
  return v;
}

const cli = (args: string[]) => run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });

const treeIndex = () => byTitle(buildPassContext(dir).vault.readTree());

describe("the verb exists, and it clears the item without inventing an opportunity", () => {
  test("one command records the reason and the node, and the real sweep stops listing the item", async () => {
    const v = vaultWithOneStrandedItem();

    // Non-vacuity: the item is outstanding before the command, and the ONLY other way
    // off this list is a node carrying its id — which is the duplicate this exists to
    // avoid, so nothing here has created one.
    const before = computeNextWork(v, dir, 3);
    expect(before.unmappedEvidence.map((e) => e.id)).toContain(STRANDED);
    const nodesBefore = v.readTree().length;

    const { stdout } = await cli([
      "dispose", STRANDED, "--kind", "evidence", "--corroborates", NEED,
      "--by", "Tanner", "--why", "ninth independent session with the stall the need already names",
      "--vault", dir,
    ]);
    expect(stdout).toMatch(/settled/i);

    // Both halves of "with a reason": the sentence, and the node it was filed under.
    const entry = readDispositionLedger(dir).histories.get(STRANDED)?.[0];
    expect(entry?.reason).toBe("ninth independent session with the stall the need already names");
    expect(entry?.node).toBe(NEED);
    expect(entry?.by).toBe("Tanner");

    // Off the sweep — the real one, not a predicate this test wrote.
    const after = computeNextWork(v, dir, 3);
    expect(after.unmappedEvidence.map((e) => e.id)).not.toContain(STRANDED);

    // "without inventing an opportunity": no node created, and none carries the id.
    expect(v.readTree()).toHaveLength(nodesBefore);
    expect(v.readTree().some((n) => n.source === STRANDED)).toBe(false);
    // Nor deleted — the record is still on disk, readable by id.
    expect(readEvidence(dir).map((e) => e.id)).toContain(STRANDED);
    // And not hidden silently: the withdrawal is named on the response that made it.
    expect(after.withheldByDisposition.map((w) => w.subject)).toContain(STRANDED);
  }, 60_000);

  test("the same command with no reason is refused, and writes nothing at all", async () => {
    vaultWithOneStrandedItem();
    // The reason is the entire audit on a write that removes work by asserting. An
    // acknowledgement with an empty one is a silent dismissal by definition.
    await expect(
      cli([
        "dispose", STRANDED, "--kind", "evidence", "--corroborates", NEED,
        "--by", "Tanner", "--why", "", "--vault", dir,
      ]),
    ).rejects.toThrow(/reason/);
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
  }, 60_000);
});

describe("an acknowledgement is only as good as the node it names", () => {
  test("filing under a node the tree does not hold is refused, and the item stays on the sweep", async () => {
    const v = vaultWithOneStrandedItem();

    const failure = await cli([
      "dispose", STRANDED, "--kind", "evidence", "--corroborates", "A need nobody ever wrote down",
      "--by", "Tanner", "--why", "counted toward that one", "--vault", dir,
    ]).catch((e: { stderr?: string }) => e);
    expect((failure as { stderr?: string }).stderr ?? "").toContain("A need nobody ever wrote down");

    // Nothing stored, and the work is still outstanding — the failure direction that
    // costs a re-read rather than a permanently lost item.
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
    expect(computeNextWork(v, dir, 3).unmappedEvidence.map((e) => e.id)).toContain(STRANDED);
  }, 60_000);

  test("a near-miss title is named rather than guessed at", () => {
    vaultWithOneStrandedItem();
    expect(() =>
      appendDisposition(
        dir,
        { subject: STRANDED, kind: "evidence", state: "closed", reason: "r", by: "o", verdict: "corroborates", node: "users churn after week one" },
        treeIndex(),
        CLOCK,
      ),
    ).toThrow(/Did you mean "Users churn after week one"/);
  });

  test("a node retitled after the fact orphans the filing: the item is listed again", () => {
    const v = vaultWithOneStrandedItem();
    appendDisposition(
      dir,
      { subject: STRANDED, kind: "evidence", state: "closed", reason: "ninth session", by: "Tanner", verdict: "corroborates", node: NEED },
      treeIndex(),
      CLOCK,
    );
    expect(computeNextWork(v, dir, 3).unmappedEvidence.map((e) => e.id)).not.toContain(STRANDED);

    // A retitle in Obsidian is a file rename and nothing else — the title this product
    // reads IS the filename. Every acknowledgement filed under the old one now points
    // at nothing, and no write happened for anything to notice.
    const renamed = "Users churn in their first week";
    fs.renameSync(path.join(dir, fileNameForTitle(NEED)), path.join(dir, fileNameForTitle(renamed)));
    expect(v.readTree().some((n) => n.title === NEED)).toBe(false);

    // The item is back on the sweep. It has to be: the filing it was traded for is
    // gone, so leaving it hidden would be a dismissal nobody ever wrote.
    const after = computeNextWork(v, dir, 3);
    expect(after.unmappedEvidence.map((e) => e.id)).toContain(STRANDED);
    expect(after.withheldByDisposition.map((w) => w.subject)).not.toContain(STRANDED);
    // And it strengthens neither the old title nor the new one.
    const ledger = readDispositionLedger(dir);
    expect(corroborationsFor(ledger, NEED)).toHaveLength(1);
    expect(corroborationsFor(ledger, renamed)).toHaveLength(0);
  });

  test("the audit surface names an orphaned filing instead of printing it among the live ones", () => {
    vaultWithOneStrandedItem();
    appendDisposition(
      dir,
      { subject: STRANDED, kind: "evidence", state: "closed", reason: "ninth session", by: "Tanner", verdict: "corroborates", node: NEED },
      treeIndex(),
      CLOCK,
    );
    fs.renameSync(path.join(dir, fileNameForTitle(NEED)), path.join(dir, fileNameForTitle("Users churn in their first week")));

    const screen = formatDispositions(readDispositionLedger(dir), treeIndex());
    // Not counted as work no bucket is listing — that would be the lie in the other
    // direction, since the item IS being listed again.
    expect(screen).toContain("No live dispositions");
    expect(screen).toContain("no such node");
    expect(screen).toContain(STRANDED);
    expect(screen).toContain("Re-file");
  });
});
