/**
 * Z1: `ost_next_work` never throws on a large tree.
 *
 * This criterion sat at `not met` for a revision after it had already been fixed.
 * The `RangeError: Maximum call stack size exceeded` it recorded came from
 * `issues.push(...findNearDuplicateIssues(tree))` spreading an O(n²)-sized array
 * into `Function.prototype.apply`'s argument list; R4's rewrite of `detectHygiene`
 * replaced that spread with a `for` loop as a side effect of making the two health
 * gates compute one rule set, and nobody re-ran the reproduction. The document went
 * on citing a line that had become a `HYGIENE_LABELS` entry.
 *
 * So the point of this file is not that 500 nodes work today — it is that the next
 * rewrite of the dedupe path cannot silently reopen the hole the way the last one
 * silently closed it.
 *
 * Deliberately NOT asserted here: that the response is a reasonable *size*. It is
 * not — the same fixture marshals ~21 MB, which is Z2, still open. A `RangeError`
 * is at least a stop; what closing Z1 bought is that an unreadable response now
 * reaches the model successfully. The two criteria have to be read together, and
 * splitting them across two files is what lets Z1 stay green while Z2 stays red.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { computeNextWork } from "../../src/mcp/next-work.js";

/**
 * The smallest size that used to fail. Not raised to 5,000: at O(n²) that fixture
 * builds ~12.5M issue objects and exhausts memory before the assertion is reached,
 * so the test could not run — which is the reason the criterion names 500.
 */
const NEAR_DUPLICATES = 500;

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-z1-"));
  await initVault(dir, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

test("computeNextWork returns rather than throwing on 500 near-identical Opportunities", () => {
  const ctx = buildPassContext(dir);
  for (let i = 0; i < NEAR_DUPLICATES; i++) {
    ctx.vault.createNode({
      title: `Users cannot find the export button ${i}`,
      layer: "Opportunity",
      source: "INBOX:n.md",
      body: "b",
      tags: [],
      links: [],
    });
  }

  // The assertion is the absence of a throw. `.not.toThrow()` would swallow the
  // error's identity, so the result is captured and inspected instead: a run that
  // returned an empty issue set would pass a bare no-throw check while proving the
  // quadratic pass had been skipped rather than fixed.
  const work = computeNextWork(ctx.vault, dir, 3);
  expect(work.hygieneIssues.length).toBeGreaterThan(NEAR_DUPLICATES);
});
