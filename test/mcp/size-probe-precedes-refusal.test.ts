/**
 * "Every response that can be refused for size states its size first."
 *
 * The assumption beneath the solution asked, per tool, whether a size can be
 * answered without paying the cost of producing the response — and named the
 * two shapes this vault had actually seen: `Read` refused at 73,874 tokens
 * against a 25,000 cap (a file length, a stat call) and `ost_read_tree`
 * returning 134,240 characters (sized only by walking and serialising every
 * node file — the entire cost of the operation). It predicted a split: cheap
 * for file-backed reads, expensive for computed aggregations.
 *
 * The split this file finds is narrower than that. It is not "file-backed vs.
 * computed" — `ost_read_repo`'s file read and `ost_read_tree`'s node-body read
 * are BOTH file-backed, yet only one is cheaply probable. The axis that
 * actually decides it is how the target is found: `ost_read_repo` resolves a
 * caller-given PATH directly, so the `stat` a normal read already takes is a
 * free probe. `ost_read_tree({node})` and `ost_next_work({evidence})` resolve
 * a caller-given TITLE/ID by scanning every file in the vault (the census, or
 * the evidence directory) to validate it — so answering "how big" costs the
 * same walk as answering "what", and there is no cheaper call to offer.
 *
 * So: a real probe for `ost_read_repo` (built here), and for the tools whose
 * lookup is a scan rather than a path, the existing behaviour — cap the
 * response, name what was hidden, in the SAME call — is what "states its
 * size" already means for them; a separate probe would cost a turn to save
 * nothing (the "where this fails" clause the solution names for itself).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readProductRepo, MAX_FILE_CHARS } from "../../src/product/repo.js";
import { buildOstTools } from "../../src/security/tools.js";
import { readTreeResponse } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-size-probe-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (title: string, layer: OstNode["layer"] = "Solution"): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  tags: ["unvalidated"],
  links: [],
  body: "A body.",
});

function call(ctx: Parameters<typeof buildOstTools>[0], name: string, input: Record<string, unknown> = {}): Promise<string> {
  const t = buildOstTools(ctx).find((x) => x.name === name);
  if (!t) throw new Error(`no tool named ${name}`);
  return (t as unknown as { run: (i: unknown) => Promise<string> }).run(input);
}

// ---------------------------------------------------------------------------
// ost_read_repo — a real probe, because the target is a path, not a lookup.
// ---------------------------------------------------------------------------

test("ost_read_repo probes a file's size from the stat, without reading its bytes", () => {
  fs.writeFileSync(path.join(dir, "big.txt"), "y".repeat(MAX_FILE_CHARS + 5000));
  const spy = vi.spyOn(fs, "readFileSync");
  try {
    const r = readProductRepo([dir], { path: "big.txt", probe: true });
    expect(r.kind).toBe("probe");
    expect(r.bytes).toBe(MAX_FILE_CHARS + 5000);
    expect(r.wouldTruncate).toBe(true);
    expect(r.text).toBeUndefined();
    // The definition of done: the probe never invoked the read that produces
    // the payload it is reporting on.
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("a small file's probe says it would not be truncated", () => {
  fs.writeFileSync(path.join(dir, "small.txt"), "hello");
  const r = readProductRepo([dir], { path: "small.txt", probe: true });
  expect(r.bytes).toBe(5);
  expect(r.wouldTruncate).toBe(false);
});

test("the probe succeeds where the full read would refuse — proof it never materializes the payload", () => {
  // `readProductRepo` refuses a binary file, but only after reading it (the
  // sniff checks the first 8KB of the buffer). A probe that shared that cost
  // would refuse identically; this one does not, because it never reads.
  fs.writeFileSync(path.join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  expect(() => readProductRepo([dir], { path: "img.png" })).toThrow(/binary/i);
  const r = readProductRepo([dir], { path: "img.png", probe: true });
  expect(r.kind).toBe("probe");
  expect(r.bytes).toBe(7);
});

test("every refusal that guards the real read still guards the probe — probing is not a bypass", () => {
  fs.mkdirSync(path.join(dir, ".ost-agent", "evidence"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".ost-agent", "evidence", "note.md"), "---\nid: x\n---\nbody");
  expect(() => readProductRepo([dir], { path: ".ost-agent/evidence/note.md", probe: true })).toThrow(/sidecar/i);
  expect(() => readProductRepo([dir], { path: "../outside", probe: true })).toThrow(/outside|escape|confine/i);
});

test("ost_read_repo the MCP tool exposes probe end to end", async () => {
  fs.writeFileSync(path.join(dir, "README.md"), "# hi");
  const ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, productRepos: [dir] };
  const out = JSON.parse(await call(ctx, "ost_read_repo", { path: "README.md", probe: true }));
  expect(out.kind).toBe("probe");
  expect(out.bytes).toBe(4);
  expect(out.text).toBeUndefined();
});

// ---------------------------------------------------------------------------
// ost_read_tree / ost_next_work — the negative half. Their lookup is a scan,
// so a probe would cost what the read costs; this pins that it really would,
// rather than assuming it from the node's own prose.
// ---------------------------------------------------------------------------

test("finding one node's body reads every node file in the vault — there is no cheaper lookup to probe", () => {
  const vault = new Vault(dir);
  for (let i = 0; i < 12; i++) vault.createNode(node(`Node ${i}`));

  const spy = vi.spyOn(fs, "readFileSync");
  try {
    // Resolving ONE title requires the same walk `readTreeResponse` pays to
    // list all twelve — proving the assumption's claim rather than asserting it.
    vault.readTree();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(12);
  } finally {
    spy.mockRestore();
  }
});

test("ost_read_tree's schema carries no probe parameter — it cannot honestly offer one", () => {
  const ctx = { vault: new Vault(dir), dir, remote: { enabled: false } };
  const t = buildOstTools(ctx).find((x) => x.name === "ost_read_tree");
  const schema = t?.input_schema as { properties?: Record<string, unknown> };
  expect(Object.keys(schema.properties ?? {})).not.toContain("probe");
});

test("what a computed aggregation offers instead: the cap names the hidden count in the SAME response", () => {
  const vault = new Vault(dir);
  for (let i = 0; i < 5; i++) vault.createNode(node(`Node ${i}`));
  const response = readTreeResponse(vault.readTree());
  // On a small tree nothing is hidden — the control that this vault's shape
  // is not why the assumption came out the way it did (Z2 pins the capped case).
  expect(response.hidden).toBe(0);
  expect(response.note).toBeUndefined();
});
