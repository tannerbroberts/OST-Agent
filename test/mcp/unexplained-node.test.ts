/**
 * A node file that no tool invocation explains (W2), detected by joining the tree
 * against the usage trace (W3).
 *
 * The vault is a plain directory and any process with a filesystem handle is a
 * full-privilege writer. The commit trail cannot report that, and is worse than silent:
 * every mutating call runs `git add -A` and commits as `mcp: <tool> — …`, so a file
 * written out of band *acquires* a commit message naming an allowlisted append-only
 * tool. `reconcileWithGit` compares the walk against an index that same `add -A` has
 * already reconciled. The trace is the one record written before the file existed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { simpleGit } from "simple-git";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { usageLogPath } from "../../src/telemetry/usage.js";
import { renderCheck } from "../../src/eval/render.js";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-unexplained-"));
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function connect(vaultDir: string): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createLazyOstMcpServer(vaultDir);
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return res.content[0].text;
}

/** Write a node file the way anything with a filesystem handle can: directly. */
function inject(vaultDir: string, file: string): void {
  fs.writeFileSync(
    path.join(vaultDir, file),
    "---\ntype: Opportunity\nstatus: proposed\nsource: nowhere\ncreated: 2026-07-30\nevidence: assertion\n---\n\nx\n",
    "utf8",
  );
}

// ─── W2 — the criterion's check, both branches of its OR ─────────────────────────

test("an injected node file is named by ost_check after a mutating call", async () => {
  const client = await connect(dir);
  inject(dir, "Injected.md");

  await call(client, "ost_create_node", {
    title: "I want a reason to come back",
    layer: "Opportunity",
    parent: "Retention",
    body: "b",
    source: "a note from the founder",
    evidence: "stated",
  });

  // The branch of W2's OR that does NOT hold, asserted rather than assumed: the
  // mutating call's `git add -A` really does stage the injected file under a commit
  // message naming an allowlisted tool. If this ever stops being true the criterion is
  // met a second way, and this assertion is what will say so.
  const last = await simpleGit(dir).show(["--stat", "--format=%s", "HEAD"]);
  expect(last).toMatch(/^mcp: ost_create_node/);
  expect(last).toContain("Injected.md");

  // The branch that does hold.
  const check = await call(client, "ost_check");
  expect(check).toContain("unexplained-node");
  expect(check).toContain("Injected.md");
});

test("a node created through the tool surface is not reported", async () => {
  const client = await connect(dir);
  await call(client, "ost_create_node", {
    title: "I want a reason to come back",
    layer: "Opportunity",
    parent: "Retention",
    body: "b",
    source: "a note from the founder",
    evidence: "stated",
  });

  const check = await call(client, "ost_check");
  expect(check).not.toContain("unexplained-node");
  // Including the Outcome the vault was born with — the init marker explains the root.
  expect(check).not.toContain("Retention.md");
});

test("an invariant-clean injection is caught by nothing but the trace", async () => {
  // The important case, and the reason the trace is worth building. A careless
  // injection trips `opportunity-connected` on its way in; a competent one does not,
  // because whoever can write the node file can also write the edge that connects it.
  // Every structural rule passes and the tree looks healthy.
  const client = await connect(dir);
  inject(dir, "Injected.md");
  const root = path.join(dir, "Retention.md");
  const [frontmatter, ...rest] = fs.readFileSync(root, "utf8").split("\n---\n");
  const body = rest.join("\n---\n").replace(/\n/, "\n[[Injected]]\n");
  fs.writeFileSync(root, `${frontmatter}\n---\n${body}`, "utf8");

  const check = await call(client, "ost_check");
  expect(check).toMatch(/invariants: PASS/);
  expect(check).toMatch(/provenance: FAIL/);
  expect(check).toContain("Injected.md");
});

test("the finding counts as a violation, so the CLI exits non-zero on it", () => {
  // `ost_check` has no exit code and the CLI does; both read this one number. A finding
  // that printed a line without moving it would leave `ost-agent check` green on a
  // tampered vault, which is the whole failure being closed.
  // `retired` is a required field on `TreeCensus` and this literal omitted it —
  // caught by no compiler, because `tsconfig.json` covers `src/` only. Every
  // real census carries it, so a fixture without it is a shape nothing produces.
  const census = { nodes: [], examined: 0, seenFiles: ["Injected.md"], skipped: [], unreadable: [], retired: [] };
  const before = renderCheck(census).violations;
  const after = renderCheck({
    ...census,
    unexplained: { source: "usage-trace", basis: ".ost-agent/usage/events.jsonl", unexplained: ["Injected.md"] },
  }).violations;
  expect(after).toBe(before + 1);
});

// ─── W3 — the violation's basis is the usage trace, named ─────────────────────────

test("the violation names the trace it was computed from", async () => {
  const client = await connect(dir);
  inject(dir, "Injected.md");

  const check = await call(client, "ost_check");
  expect(check).toContain(path.join(".ost-agent", "usage", "events.jsonl"));
});

test("the trace records which node files each invocation created", async () => {
  const client = await connect(dir);
  await call(client, "ost_create_node", {
    title: "I want a reason to come back",
    layer: "Opportunity",
    parent: "Retention",
    body: "b",
    source: "a note from the founder",
    evidence: "stated",
  });

  const events = fs
    .readFileSync(usageLogPath(dir), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { tool: string; wrote?: string[] });

  const create = events.filter((e) => e.tool === "ost_create_node");
  expect(create).toHaveLength(1);
  expect(create[0].wrote).toEqual(["I want a reason to come back.md"]);
  // Every other call in this test wrote no node file and says nothing about one — an
  // undrained entry stamped onto the next event would attribute a real write to an
  // innocent tool.
  expect(events.filter((e) => e.tool !== "ost_create_node" && e.wrote !== undefined)).toEqual([
    expect.objectContaining({ tool: "vault_init" }),
  ]);
});

// ─── The floor, and the laundry it has to refuse ─────────────────────────────────

test("re-running init does not explain a file it did not write", async () => {
  inject(dir, "Injected.md");
  // `/ost-setup` grants a `Bash(… init:*)` prefix, and init is re-runnable by design,
  // so this is a move the agent can actually make.
  await initVault(dir, "Reach ten returning operators.", "Retention");

  const client = await connect(dir);
  const check = await call(client, "ost_check");
  expect(check).toContain("Injected.md");
});

test("a vault whose trace has no beginning is reported as no basis, not as all-unexplained", async () => {
  // Every vault predating this mechanism looks like this. Reporting its whole tree as
  // unexplained would be a wall of noise that teaches an operator to skip the line.
  fs.rmSync(usageLogPath(dir));
  inject(dir, "Injected.md");

  const client = await connect(dir);
  const check = await call(client, "ost_check");
  expect(check).not.toContain("unexplained-node");
});
