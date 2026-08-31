/**
 * The instrument for "Satisfy the guard with a bare fetch that discards the body,
 * and require the merge to go through" — the assumption test under "Refuse a merge
 * whose prose was composed without a read of the survivor".
 *
 * This file is written to DEFEAT the guard, not to confirm it, and that direction
 * is the whole design. The assumption it risks is stated on the node: *the
 * mechanism available is a session-scoped record that the survivor's body was
 * fetched, and the belief that could be false is that this is enough.* A caller
 * under pressure can issue the fetch, throw the response away, and compose the
 * contribution from the title exactly as before. If that works, the guard is a
 * formality — which is the finding, and it is an argument for the sibling
 * candidate that needs no guard at all.
 *
 * Threshold, pre-committed: **a merge preceded by a fetch whose result was
 * discarded must succeed, and a merge with no prior fetch must be refused. Both
 * must hold; either outcome on the first assertion is informative, but a guard
 * that also permits the no-fetch merge fails the test outright.**
 *
 * So the two assertions are not symmetrical in what they mean:
 *
 *   - The **bypass** assertion pins the guard's admitted weakness in place. It
 *     passing is not the guard working; it is the guard being honest about what a
 *     receipt proves. If someone later makes the fetch un-discardable — a
 *     confirmation argument, a body hash the caller has to echo back — this test
 *     goes red, and it SHOULD, because the tree would then be carrying a claim
 *     about this guard that stopped being true.
 *   - The **refusal** assertion is the one that makes the first mean anything. A
 *     guard that never fires would satisfy the bypass assertion perfectly.
 *
 * Everything is driven through the real `ost_merge_nodes` from one built tool set,
 * because the tool set is the session: the receipt book lives in that closure, and
 * a test that reached past it into the vault would be exercising a merge the agent
 * never reaches.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { checkCall, publishCallPreconditions } from "../../src/security/call-preconditions.js";
import { createReadReceipts } from "../../src/security/read-receipts.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import type { OstNode } from "../../src/ost/node.js";

const LOSER = "My tools fail locally";
const SURVIVOR = "Tools break on my machine";
const WHY = "the same need, written twice";
const CONTRIBUTION = "It also happens on a fresh checkout.";

interface RawTool {
  name: string;
  run: (input: unknown) => Promise<string>;
}

let dirs: string[];

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
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

/**
 * One session: a fresh vault holding the two duplicates, and ONE tool set built
 * over it. Both handles come from the same `buildOstTools` call, so a read through
 * `readTree` is a read the `merge` in the same object can see — and a second
 * `session()` is a second session that inherits nothing.
 */
function session(): { readTree: RawTool; merge: RawTool; vault: Vault } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-merge-read-guard-"));
  dirs.push(dir);
  const vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "The mandate."));
  vault.createNode(node(SURVIVOR, "Opportunity", "First framing, at some length, written by a person who was there."));
  vault.createNode(node(LOSER, "Opportunity", "Second framing."));
  vault.linkNodes("Root", SURVIVOR);
  vault.linkNodes("Root", LOSER);

  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const tools = buildOstTools(ctx) as unknown as RawTool[];
  const byName = (name: string): RawTool => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`${name} is not on the tool surface`);
    return t;
  };
  return { readTree: byName("ost_read_tree"), merge: byName("ost_merge_nodes"), vault };
}

const mergeCall = { from: LOSER, into: SURVIVOR, contribution: CONTRIBUTION, why: WHY };

test("the bypass is open: a fetch whose result is discarded satisfies the guard", async () => {
  const { readTree, merge, vault } = session();

  // The shortcut, exactly as an agent under pressure would take it: ask for the
  // body, do not look at it, compose from the title. `void` is not a flourish —
  // it is the assertion. Nothing between this line and the merge reads a byte of
  // what came back.
  void (await readTree.run({ node: SURVIVOR }));

  await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);
  expect(vault.has(LOSER)).toBe(false);
  expect(vault.read(SURVIVOR).body).toContain(CONTRIBUTION);
});

test("and the guard fires: a merge with no prior fetch is refused, and writes nothing", async () => {
  const { merge, vault } = session();

  await expect(merge.run(mergeCall)).rejects.toThrow(/has not read its body/);

  // Refused means refused, not partially applied: the loser is still on disk and
  // the survivor never took the contribution.
  expect(vault.has(LOSER)).toBe(true);
  expect(vault.read(SURVIVOR).body).not.toContain(CONTRIBUTION);
});

test("the refusal names the call that clears it, and clearing it works", async () => {
  const { readTree, merge } = session();

  const refusal = await merge.run(mergeCall).then(
    () => "",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  // A refusal that does not name its remedy costs the caller a second guess as
  // well as the call — the cost this vault's friction corpus records against
  // read-before-write guards generally.
  expect(refusal).toContain('ost_read_tree({ node: "Tools break on my machine" })');
  // And it says what it actually checked, rather than claiming to have proved
  // that the caller read anything.
  expect(refusal).toMatch(/SERVED, not that you read it/);

  await readTree.run({ node: SURVIVOR });
  await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);
});

test("reading the LOSER does not satisfy it — the receipt is per node, not per session", async () => {
  const { readTree, merge } = session();

  await readTree.run({ node: LOSER });

  // Without this, the guard would be cleared by the read a caller makes anyway
  // while deciding the two are duplicates, and would never fire on the node whose
  // prose the contribution is supposed to be measured against.
  await expect(merge.run(mergeCall)).rejects.toThrow(/has not read its body/);
});

test("the listing does not mint a receipt — only a body read does", async () => {
  const { readTree, merge } = session();

  // `ost_read_tree` with no argument returns every node's title, layer and edges
  // and NO prose. Counting it would make the guard unfireable, since every pass
  // opens with that call.
  await readTree.run({});

  await expect(merge.run(mergeCall)).rejects.toThrow(/has not read its body/);
});

test("a receipt does not cross sessions", async () => {
  const first = session();
  await first.readTree.run({ node: SURVIVOR });
  await expect(first.merge.run(mergeCall)).resolves.toMatch(/merged/);

  // A second tool set is a second session — two MCP servers, or one process that
  // rebuilt its defs. Nothing about the first session's reads is on disk, so the
  // guard starts closed again.
  const second = session();
  await expect(second.merge.run(mergeCall)).rejects.toThrow(/has not read its body/);
});

test("the publication says so before the call, and stops saying so once the read happens", async () => {
  // The anti-drift control `call-preconditions.ts` exists for, applied to the one
  // refusal this change adds: a published rule that says yes where the tool says
  // no (or vice versa) is worse than no publication at all, because a caller
  // screening its calls against it would be confidently wrong.
  const { readTree, merge, vault } = session();
  const dir = dirs[dirs.length - 1];
  const receipts = createReadReceipts();

  // The tool set under test carries its own receipt book, so the publication is
  // driven through a second surface built over the SAME book — which is how a
  // real caller holds one: `buildOstTools({ readReceipts })`.
  const shared = (buildOstTools({ vault, dir, remote: { enabled: false }, readReceipts: receipts }) as unknown as RawTool[]).find(
    (t) => t.name === "ost_read_tree",
  )!;

  const before = publishCallPreconditions({ vault, dir, readReceipts: receipts, asOf: "2026-08-31" });
  expect(checkCall(before, "ost_merge_nodes", mergeCall).map((v) => v.id)).toContain("survivor-body-read");
  await expect(merge.run(mergeCall)).rejects.toThrow(/has not read its body/);

  await shared.run({ node: SURVIVOR });
  await readTree.run({ node: SURVIVOR });
  const after = publishCallPreconditions({ vault, dir, readReceipts: receipts, asOf: "2026-08-31" });
  expect(checkCall(after, "ost_merge_nodes", mergeCall)).toEqual([]);
  await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);
});

test("the guard sits behind the structural refusals, not in front of them", async () => {
  // A merge the tree will never allow must say why it will never be allowed. If
  // the read guard ran first, the caller would be told to go and read a survivor,
  // spend the call, and then be refused for a reason that was true before it
  // started — the worst shape a two-step refusal can have.
  const { merge, vault } = session();
  vault.createNode(node("A way to fix it", "Solution", "One approach."));
  vault.linkNodes(SURVIVOR, "A way to fix it");

  await expect(
    merge.run({ from: "A way to fix it", into: SURVIVOR, contribution: CONTRIBUTION, why: WHY }),
  ).rejects.toThrow(/different\s+kinds of claim|Merge is for duplicates within a layer/);
});
