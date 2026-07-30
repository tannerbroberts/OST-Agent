/**
 * The wedge D5 nearly shipped with: **a firing's own leavings refusing the firing
 * after it.**
 *
 * `test/cli/loop.test.ts` has a test by that name already, and it passes, but its
 * steps are `true` — no tool ever runs. What it proves is that the *loop's*
 * records (ledger, marker, lock) stay out of the working tree because they live
 * under `.git/`. That is a real fact and a different one from the fact the gate
 * actually depends on, which is about what a *pass* leaves behind:
 *
 *   1. Every tool invocation appends one line to `.ost-agent/usage/events.jsonl`
 *      — `withUsageTracing` wraps `tool.run`, so the append happens *inside* the
 *      call (`src/telemetry/usage.ts`).
 *   2. The dispatcher commits with `git add -A` only for MUTATING tools
 *      (`src/mcp/server.ts:237`). A read-only call writes its trace line and
 *      nothing ever commits it.
 *   3. `.claude/commands/ost-pass.md` step 4 ends the sweep by re-calling
 *      `ost_ingest_inbox` and then `ost_next_work` — a read — and stops when that
 *      returns `done: true`.
 *
 * So a conforming pass terminates on a read-only call, by design, and leaves the
 * working tree dirty by exactly one path. A literal `git status --porcelain` gate
 * would refuse the *second* firing of every vault that ever fired a first one,
 * for ever, with a human-only way out — R2's shape on the mechanism meant to
 * protect the record. It was reproduced end to end before the exemption existed:
 * init, one `ost_create_node`, one `ost_read_tree`, then `loop start` → exit 14.
 *
 * The four rows below are the whole argument: the residue is real (measured, not
 * assumed), the loop fires through it, one ordinary stray file is still refused,
 * and the waiver is a prefix rather than the dot-folder. The third row is what
 * keeps the second from being "the gate is off"; the fourth is what keeps the
 * exemption from quietly growing.
 *
 * **Non-vacuity, proved by mutation, both directions.** Narrowing
 * `FIRING_TRACE_PREFIX` to a path nothing writes (`".ost-agent/nowhere/"`) reds
 * all four rows: the loop is refused (14 where 0 was expected) and the refusal
 * starts naming `events.jsonl`. Widening it to `".ost-agent/"` reds only row 4 —
 * rows 1–3 cannot see that difference, since every path they use is either the
 * trace itself or outside the dot-folder entirely, which is precisely why row 4
 * is written as a table of paths rather than left to the end-to-end rows. The
 * gate is pinned from both sides: too narrow wedges the loop, too wide waives the
 * inbox.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { createLazyOstMcpServer } from "../../src/mcp/server.js";
import { entriesRequiringAHuman } from "../../src/cli/loop.js";
import { workingTreeStatus } from "../../src/loop/state.js";

const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

let dir: string;
let vault: string;

/**
 * The real dispatcher, in process. Deliberately not a hand-rolled "call the tool
 * then commit if it looks mutating": the read-only/mutating split IS the
 * mechanism under test, and a copy of it here could drift out of agreement with
 * `src/mcp/server.ts` and leave this file asserting its own assumptions.
 */
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

/**
 * `spawnSync` rather than `execFileSync`, and the difference is load-bearing:
 * `execFileSync` returns stdout only on success, so the carried-trace notice —
 * which goes to stderr, like every other thing this command says about a refusal
 * — would be invisible on the exit-0 path and its assertion vacuously unfalsifiable.
 */
function loopStart(): { code: number; out: string } {
  const r = spawnSync(TSX, [CLI, "loop", "start", "--vault", vault], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** One pass's worth of tool traffic, ending the way `/ost-pass` step 4 ends: on a read. */
async function firingWorthOfCalls(): Promise<void> {
  const client = await connect(vault);
  await call(client, "ost_create_node", {
    title: "Players cannot tell what changed",
    layer: "Opportunity",
    parent: "Retention",
    body: "an opportunity the pass mapped",
    evidence: "assertion",
  });
  await call(client, "ost_read_tree", {});
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-firing-residue-"));
  vault = path.join(dir, "vault");
  await initVault(vault, "Reach ten returning operators.", "Retention");
  // The vault the tool itself creates starts clean, or nothing below means
  // anything — the residue has to come from the calls, not from `init`.
  expect(workingTreeStatus(vault)).toEqual({ kind: "clean" });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a pass leaves its trace uncommitted, and the next firing still starts", () => {
  test("the residue is exactly the usage trace — measured, not assumed", async () => {
    await firingWorthOfCalls();

    const tree = workingTreeStatus(vault);
    // If this ever comes back clean, the dispatcher started committing after
    // read-only calls (or the trace moved) and the exemption below is dead
    // weight that should be deleted rather than left to rot.
    expect(tree.kind).toBe("dirty");
    if (tree.kind !== "dirty") return;
    expect(tree.entries).toEqual([" M .ost-agent/usage/events.jsonl"]);
    // And the mutating call really did commit its own work, so the row above is
    // about the read-only tail and not about nothing being committed at all.
    expect(fs.existsSync(path.join(vault, "Players cannot tell what changed.md"))).toBe(true);
    expect(entriesRequiringAHuman(tree.entries)).toEqual([]);
  });

  test("`loop start` fires through it, and says out loud that it did", async () => {
    await firingWorthOfCalls();

    const r = loopStart();
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/loop run .* open/);
    // The waiver is visible. A silent exemption is how a gate stops being read.
    expect(r.out).toMatch(/carrying 1 uncommitted usage-trace path\(s\)/);
  });

  test("an ordinary stray file is still refused, trace or no trace", async () => {
    await firingWorthOfCalls();
    fs.writeFileSync(path.join(vault, "zz-probe.md"), "left behind by an audit\n", "utf8");

    const r = loopStart();
    expect(r.code).toBe(14);
    expect(r.out).toMatch(/\?\? zz-probe\.md/);
    // The refusal lists ONLY what a human can act on. Naming the trace file
    // would send them to commit a path the machine owns — and the count in the
    // headline has to agree with the list, or the "way out" is a lie about scale.
    expect(r.out).toMatch(/^not firing: 1 path\(s\) are already dirty/m);
    expect(r.out).not.toMatch(/events\.jsonl/);
  });

  test("the exemption is a prefix, and everything else under the dot-folder is still fail-closed", () => {
    // The dot-folder is not one thing. `inbox/` is fed by an untrusted builder
    // under DEC-1 and `evidence/` is what belief is computed from; a leftover in
    // either is precisely what D5 is for. Only `usage/` is waived.
    expect(entriesRequiringAHuman([" M .ost-agent/usage/events.jsonl"])).toEqual([]);
    expect(entriesRequiringAHuman(["?? .ost-agent/usage/"])).toEqual([]);
    expect(entriesRequiringAHuman(["?? .ost-agent/inbox/note.md"])).toEqual(["?? .ost-agent/inbox/note.md"]);
    expect(entriesRequiringAHuman(["?? .ost-agent/evidence/x.json"])).toEqual(["?? .ost-agent/evidence/x.json"]);
    expect(entriesRequiringAHuman(["?? .ost-agent/"])).toEqual(["?? .ost-agent/"]);
    // Not a substring match anywhere in the line, and not fooled by a path that
    // merely contains the prefix further along.
    expect(entriesRequiringAHuman(["?? notes/.ost-agent/usage/x"])).toEqual(["?? notes/.ost-agent/usage/x"]);
    // A rename is judged by where the file ended up, since that is the path that
    // would be committed. (`R  <from> -> <to>`.)
    expect(entriesRequiringAHuman(["R  Old.md -> .ost-agent/usage/Old.md"])).toEqual([]);
    expect(entriesRequiringAHuman(["R  .ost-agent/usage/x -> New.md"])).toEqual(["R  .ost-agent/usage/x -> New.md"]);
    // A quoted path is not unquoted, so it cannot match and is refused. Fail
    // closed: the one path this exemption exists for is never quoted.
    expect(entriesRequiringAHuman(['?? ".ost-agent/usage/we ird"'])).toEqual(['?? ".ost-agent/usage/we ird"']);
  });
});
