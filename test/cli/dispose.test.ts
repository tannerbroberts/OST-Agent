/**
 * `ost-agent dispose` / `ost-agent dispositions` — the write path and the audit surface
 * for the disposition ledger.
 *
 * The mechanism itself is pinned by `test/ost/disposition-ledger-shape.test.ts`. What
 * this file pins is *where the write lives and what it will not do*, which is the half
 * that matters for the risk: a disposition removes work by asserting a sentence about
 * it, written by the party whose budget the work costs. So the write sits on the CLI —
 * a human's hands, like `result` and `promote` (B1/B2) — it refuses an unattributed or
 * unexplained dismissal, it prints the reversal beside the list, and `dispositions`
 * shows every live one in bulk so an operator can audit what a pass was allowed to skip.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { dispositionLedgerPath, isDisposed, readDispositionLedger } from "../../src/knowledge/dispositions.js";

/** The node the acknowledgement tests file against. `--corroborates` resolves against
 * the tree, so the title it names has to be one the vault actually holds. */
const NEED = "Users churn after week one";

// See the note in `test/cli/result.test.ts`: the local tsx binary directly, never
// through `npx`, so concurrent spawns do not contend on npm's cacache lock.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const run = promisify(execFile);
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cli-dispose-"));
  await initVault(dir, "Reach 10,000 daily active users");
  buildPassContext(dir).vault.createNode({
    title: NEED, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [],
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function cli(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: path.resolve(__dirname, "../..") });
}

describe("ost-agent dispose", () => {
  test("settles one subject, and says both that it is hidden and how to put it back", async () => {
    const { stdout } = await cli([
      "dispose", "Onboarding checklist", "--kind", "solution", "--by", "Tanner", "--why", "shipped in #78", "--vault", dir,
    ]);
    expect(stdout).toMatch(/settled/i);
    // The two sentences that keep this from being an amnesty: it is still counted
    // somewhere a reader will see, and the reversal is one command.
    expect(stdout).toContain("withheldByDisposition");
    expect(stdout).toContain("--reopen");
    expect(isDisposed(readDispositionLedger(dir), "Onboarding checklist")).toBe(true);
  }, 60_000);

  test("refuses a dismissal with no author and one with no reason", async () => {
    // Not a style preference. The whole safeguard on a write that removes work by
    // asserting is that somebody can read the assertion and see whose it was.
    await expect(
      cli(["dispose", "Onboarding checklist", "--kind", "solution", "--why", "shipped", "--vault", dir]),
    ).rejects.toThrow(/by/);
    await expect(
      cli(["dispose", "Onboarding checklist", "--kind", "solution", "--by", "Tanner", "--vault", dir]),
    ).rejects.toThrow(/why/);
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
  }, 60_000);

  test("refuses a kind outside the vocabulary rather than storing it", async () => {
    await expect(
      cli(["dispose", "X", "--kind", "invented", "--by", "Tanner", "--why", "w", "--vault", dir]),
    ).rejects.toThrow(/kind must be one of/);
    expect(fs.existsSync(dispositionLedgerPath(dir))).toBe(false);
  }, 60_000);

  test("--reopen takes the kind from the entry it reverses, so the two cannot disagree", async () => {
    await cli(["dispose", "Onboarding checklist", "--kind", "solution", "--by", "Tanner", "--why", "shipped", "--vault", dir]);
    const { stdout } = await cli([
      "dispose", "Onboarding checklist", "--reopen", "--by", "Tanner", "--why", "it did not ship after all", "--vault", dir,
    ]);
    expect(stdout).toMatch(/reopened/i);
    expect(isDisposed(readDispositionLedger(dir), "Onboarding checklist")).toBe(false);
    // Append-only: the reversal is a second entry, and the dismissal it reverses is
    // still on file. That history is the part an auditor most needs.
    expect(readDispositionLedger(dir).histories.get("Onboarding checklist")).toHaveLength(2);
  }, 60_000);

  test("a reopen of a subject the ledger never saw says so instead of inventing a kind", async () => {
    await expect(
      cli(["dispose", "Never settled", "--reopen", "--by", "Tanner", "--why", "w", "--vault", dir]),
    ).rejects.toThrow(/no earlier entry/);
  }, 60_000);

  test("--corroborates writes the typed verdict with the node it counts toward", async () => {
    // The acknowledgement in its sharpened form: not "dismissed", but "read, counted
    // toward an existing node" — the one verdict that can strengthen that node later.
    const { stdout } = await cli([
      "dispose", "TRANSCRIPT:ninth-session.md", "--kind", "evidence", "--corroborates", NEED,
      "--by", "Tanner", "--why", "ninth session with the same stall", "--vault", dir,
    ]);
    expect(stdout).toContain("corroborating");
    const entry = readDispositionLedger(dir).histories.get("TRANSCRIPT:ninth-session.md")?.[0];
    expect(entry?.verdict).toBe("corroborates");
    expect(entry?.node).toBe(NEED);
  }, 60_000);

  test("--no-genuine-need writes the other verdict, and the two refuse to share an entry", async () => {
    const { stdout } = await cli([
      "dispose", "USAGE:clean-day.md", "--kind", "evidence", "--no-genuine-need",
      "--by", "Tanner", "--why", "a clean day reveals no need of its own", "--vault", dir,
    ]);
    expect(stdout).toContain("no genuine need");
    expect(readDispositionLedger(dir).histories.get("USAGE:clean-day.md")?.[0].verdict).toBe("no-genuine-need");

    await expect(
      cli([
        "dispose", "X", "--kind", "evidence", "--no-genuine-need", "--corroborates", "Some node",
        "--by", "Tanner", "--why", "w", "--vault", dir,
      ]),
    ).rejects.toThrow(/one verdict/);
  }, 60_000);

  test("a verdict on a reopen is refused — a reopen disputes an acknowledgement, it does not make one", async () => {
    await cli([
      "dispose", "USAGE:clean-day.md", "--kind", "evidence", "--no-genuine-need",
      "--by", "Tanner", "--why", "clean day", "--vault", dir,
    ]);
    await expect(
      cli([
        "dispose", "USAGE:clean-day.md", "--reopen", "--corroborates", "Some node",
        "--by", "Tanner", "--why", "w", "--vault", dir,
      ]),
    ).rejects.toThrow(/disputes/);
  }, 60_000);
});

describe("ost-agent dispositions", () => {
  test("lists every live dismissal, dated and attributed, and drops the reversed one", async () => {
    await cli(["dispose", "Onboarding checklist", "--kind", "solution", "--by", "Tanner", "--why", "shipped in #78", "--vault", dir]);
    await cli(["dispose", "INBOX:note.md", "--kind", "evidence", "--by", "Tanner", "--why", "corroborates an existing node", "--vault", dir]);
    await cli(["dispose", "INBOX:note.md", "--reopen", "--by", "Tanner", "--why", "read it again, it is new", "--vault", dir]);

    const { stdout } = await cli(["dispositions", "--vault", dir]);
    expect(stdout).toContain("Onboarding checklist");
    expect(stdout).toContain("shipped in #78");
    expect(stdout).toContain("Tanner");
    expect(stdout).not.toContain("INBOX:note.md");
    expect(stdout).toContain("--reopen");
  }, 60_000);

  test("an empty ledger says nothing is hidden, rather than printing nothing", async () => {
    const { stdout } = await cli(["dispositions", "--vault", dir]);
    expect(stdout).toMatch(/no live dispositions/i);
  }, 60_000);
});
