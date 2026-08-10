/**
 * Policy does not evolve unattended. (V1 readiness, G4.)
 *
 * G4's check is two clauses — "`ls src/harness src/genome` finds nothing, and no
 * code path writes a policy file into a vault" — and until this file, nothing
 * ran either of them. It read **met, by deletion**, which is precisely the
 * configuration G3 was in the morning `module-reachability.test.ts` was written:
 * met because the module that motivated the criterion had been deleted, and
 * nobody enumerated the rest. G3 turned out to be **not met**. A criterion whose
 * status is carried by the memory of a deletion is a criterion nobody has
 * checked since.
 *
 * The three halves, weakest first:
 *
 * 1. **The directories are gone.** Trivial, and the only part `ls` covers.
 *
 * 2. **Nothing but the operator's file is policy.** `test/runner/context.test.ts`
 *    pins that a `genome.yaml` at the vault root is inert — one filename, the one
 *    that used to exist. That is a pin against the past. The general property is
 *    that *no* file a writer could drop into the vault moves a bound the operator
 *    set, so this drops a battery of them — the deleted name, the obvious
 *    successors, a near-miss spelling of the real config (`ost.config.yml`), and
 *    two under the sidecar directory — each one trying to raise `lookupBudget`,
 *    and asserts the operator's number every time. A control asserts the probe
 *    can see a change at all, so the ten zero-effect assertions cannot pass
 *    vacuously. This matters under DEC-1 specifically: the builder has a
 *    filesystem handle by design, so "a file nobody wrote" is not a safe
 *    assumption, only "a file nobody reads" is.
 *
 * 3. **The unattended surface writes no policy.** Every mutating MCP tool is
 *    called against a real vault — the set is checked against `MCP_TOOL_NAMES`
 *    so a new tool cannot join the surface unexercised and undeclared, which is
 *    how "the surface writes no policy" would decay into "the eleven tools I
 *    remembered write no policy". Afterwards the operator's config is unchanged
 *    byte for byte, and every file the vault gained is either a node at the root
 *    or state under `.ost-agent/`. Plus a source-level register: exactly two
 *    modules in `src/` write `ost.config.yaml`, both of them CLI commands a human
 *    types. Exact equality, like G3's — a third writer is a visible commit that
 *    has to argue for itself, not a line that slips in.
 *
 *    **The vault is no longer the whole world the surface can reach, and half 3
 *    had to grow to keep meaning what it said.** When the drop folder lived at
 *    `<vault>/.ost-agent/inbox`, walking the vault covered every directory an
 *    ingest touches, so "everything it wrote is a node at the root or state under
 *    `.ost-agent/`" was a statement about all of the surface's reachable
 *    filesystem. `init` now writes an escaping drop folder (`../<vault>.inbox`),
 *    which is the point of W1 — but it means a `policy.yaml` written *beside* the
 *    vault would satisfy every vault-scoped assertion here while being read by the
 *    next pass all the same. So the fixture puts the vault inside a workspace
 *    directory, snapshots that whole workspace with content hashes, and the
 *    root-or-sidecar test now also asserts that nothing outside the vault was
 *    added, removed or altered — the drop folder included, since the adapter's
 *    read-only promise is what leaves the untouched original recoverable.
 *
 * **Not a wedge.** Every assertion is over a `mkdtemp` vault or over the source
 * tree; nothing here can red a real vault, and every red is cleared by changing
 * the code or by adding the new writer to the register with its reason.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { createOstMcpServer, MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { CONFIG_FILENAME, configPath, readConfig } from "../../src/config/load.js";
import { CHANNEL_ZERO, resolveChannels } from "../../src/adapters/channels.js";
import { Vault } from "../../src/ost/vault.js";
import { RESULTS_HEADING } from "../../src/ost/headings.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUTCOME = "Reach 10,000 daily active users";
const ROOT = "Retention";

/**
 * The two `src/` modules allowed to write the operator's policy file, each with
 * the reason it is here. Both are CLI commands: a human runs `init` to create a
 * vault and `set-outcome` to change its mandate. Neither is on the MCP surface.
 */
const CONFIG_WRITERS: Record<string, string> = {
  "src/runner/init.ts": "`ost-agent init` scaffolds the config a human then owns",
  "src/runner/set-outcome.ts": "`ost-agent set-outcome` rewrites the one field a human sets",
};

/** A filename that would read as policy if a writer dropped it in a vault. */
const POLICY_SHAPED = /^(genome|policy|policies|tuning|params|weights|strategy|prompts?|rules)\.(ya?ml|json|toml)$|\.config\.(ya?ml|json)$/i;

function srcFiles(dir = path.join(repoRoot, "src"), out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) srcFiles(p, out);
    else if (entry.name.endsWith(".ts")) out.push(path.relative(repoRoot, p));
  }
  return out.sort();
}

function walkVault(dir: string, base = dir, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue; // git's own object store is not the vault
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkVault(p, base, out);
    else out.push(path.relative(base, p));
  }
  return out.sort();
}

/**
 * Everything in the workspace that is NOT the vault, keyed by path and hashed.
 *
 * Hashed rather than listed, because outside the vault the interesting failures
 * include *editing* a file that already exists — a drop-folder note rewritten in
 * place, or a `policy.yaml` beside the vault gaining a line. A name list would
 * call all of those unchanged.
 */
function walkOutside(work: string, vault: string, cur = work, out = new Map<string, string>()): Map<string, string> {
  for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
    const p = path.join(cur, entry.name);
    if (path.resolve(p) === path.resolve(vault)) continue; // the vault has its own walker
    if (entry.isDirectory()) walkOutside(work, vault, p, out);
    else out.set(path.relative(work, p), createHash("sha256").update(fs.readFileSync(p)).digest("hex"));
  }
  return out;
}

/** Paths present on one side only, or whose bytes moved. */
function changedOutside(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((n) => before.get(n) !== after.get(n)).sort();
}

/**
 * Channel zero's folder, asked of the vault's own configuration.
 *
 * Never `path.join(dir, ".ost-agent", "inbox")`. That literal was correct until
 * `init` started writing an escaping drop-folder path, at which point this file
 * was planting its note in a folder nothing reads — the ingest call still
 * succeeded, having found nothing, and the surface was being exercised with one
 * fewer tool than the count claimed. Reading the resolver keeps that from
 * recurring the next time the default moves, which is the actual defect.
 */
function dropFolderOf(vault: string): string {
  const { channels, problems } = resolveChannels(vault, readConfig(vault).config);
  if (problems.length > 0) throw new Error(`fixture vault has channel problems: ${problems.join("; ")}`);
  const zero = channels.find((c) => c.name === CHANNEL_ZERO);
  if (!zero) throw new Error("no channel zero resolved for the fixture vault");
  return zero.dir;
}

/**
 * `work` is the world; `dir` is the vault inside it. The vault is not the
 * `mkdtemp` directory itself because its drop folder is now a *sibling* of the
 * vault — so the fixture has to own a directory that contains both, or the
 * teardown leaves the drop folder behind and the "wrote nothing outside" checks
 * would have nowhere to look.
 */
let work: string;
let dir: string;
beforeEach(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "ost-g4-"));
  dir = path.join(work, "vault");
  await initVault(dir, OUTCOME, ROOT);
});
afterEach(() => fs.rmSync(work, { recursive: true, force: true }));

describe("the evolvable-policy machinery is gone", () => {
  test("`ls src/harness src/genome` finds nothing", () => {
    const present = ["src/harness", "src/genome"].filter((d) => fs.existsSync(path.join(repoRoot, d)));
    expect(present).toEqual([]);
  });

  test("exactly two modules write the operator's config, and both are CLI commands", () => {
    // Exact equality, not absence-of-new: G3's lesson is that a list you may
    // widen quietly is not a constraint. `src/mcp/bootstrap.ts` reads
    // `configPath` and must stay out of this set.
    const writers = srcFiles().filter((rel) => {
      const source = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      return /configPath\(/.test(source) && /(writeFileSync|appendFileSync|writeFile)\s*\(/.test(source);
    });
    expect(writers).toEqual(Object.keys(CONFIG_WRITERS).sort());
  });
});

describe("no file but the operator's own moves a bound the operator set", () => {
  function setBudget(limit: number) {
    fs.writeFileSync(configPath(dir), `outcome: ${JSON.stringify(OUTCOME)}\nweb:\n  lookupBudget: ${limit}\n`, "utf8");
  }
  const budget = () => buildPassContext(dir).web?.budget?.limit;

  /** Each decoy asks for a bigger number than the operator's, in its own dialect. */
  const DECOYS: Record<string, string> = {
    "genome.yaml": "budgets:\n  sharedPool: 99\n",
    "policy.yaml": "web:\n  lookupBudget: 99\n",
    "ost.policy.yaml": "web:\n  lookupBudget: 99\n",
    "ost.config.yml": `outcome: ${JSON.stringify(OUTCOME)}\nweb:\n  lookupBudget: 99\n`,
    "ost.config.json": JSON.stringify({ outcome: OUTCOME, web: { lookupBudget: 99 } }),
    "tuning.yaml": "web:\n  lookupBudget: 99\n",
    "weights.json": JSON.stringify({ lookupBudget: 99 }),
    ".ostrc": "web:\n  lookupBudget: 99\n",
    ".ost-agent/config.yaml": `outcome: ${JSON.stringify(OUTCOME)}\nweb:\n  lookupBudget: 99\n`,
    ".ost-agent/state/policy.yaml": "web:\n  lookupBudget: 99\n",
  };

  test("the probe can see a bound change at all", () => {
    // Without this the ten assertions below would also pass on a `budget()` that
    // always returned the same thing — the shape `web-lookup-cost.test.ts` uses
    // to keep its zero-call assertions honest.
    setBudget(4);
    expect(budget()).toBe(4);
    setBudget(9);
    expect(budget()).toBe(9);
  });

  test("every plausible policy file at the vault root is inert", () => {
    setBudget(4);
    const shadowed: string[] = [];
    for (const [name, body] of Object.entries(DECOYS)) {
      const target = path.join(dir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body, "utf8");
      const seen = budget();
      if (seen !== 4) shadowed.push(`${name} moved lookupBudget to ${seen}`);
      fs.rmSync(target);
    }
    expect(shadowed).toEqual([]);
  });
});

describe("the unattended surface writes no policy into the vault", () => {
  /**
   * Long enough that a busy machine cannot answer for this file.
   *
   * Each test below drives the WHOLE mutating MCP surface against a fresh vault
   * — every call a git commit — and costs ~11 s on an idle host. Against the
   * suite's 20 s default that is under 2× headroom, and 186 test files running
   * in parallel routinely spend it: all five failed with `Test timed out in
   * 20000ms` on three consecutive full runs on 2026-08-09, and all five passed
   * when the file was run alone. The same five fail on `main` under the same
   * load, so this is the harness, not a change.
   *
   * Raising it costs nothing that matters, because none of these tests is ABOUT
   * time: they assert what the surface wrote. The one criterion that owns a
   * wall-clock bound is Z3, whose budget lives in
   * `test/mcp/wall-clock-budget.test.ts` and is untouched by this. A timeout
   * that fires on load is not a gate — it is a second, accidental performance
   * assertion nobody wrote, hiding the real one.
   */
  const SURFACE_TIMEOUT_MS = 120_000;

  async function connect(): Promise<Client> {
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const server = createOstMcpServer(buildPassContext(dir));
    await server.connect(serverT);
    const client = new Client({ name: "g4", version: "0.0.0" });
    await client.connect(clientT);
    return client;
  }

  /**
   * Every mutating tool on the MCP surface, in an order where each one's
   * precondition is already on the tree. Read-only tools are omitted: they
   * cannot produce a diff, so they cannot write a policy file either.
   */
  const CALLS: Array<{ name: string; arguments: Record<string, unknown> }> = [
    {
      name: "ost_create_node",
      arguments: { title: "I want a reason to come back", layer: "Opportunity", parent: ROOT, body: "b", source: "INBOX:x", evidence: "stated" },
    },
    {
      // Cites the publisher on purpose. `ost_rank_source` no longer moves a source
      // because a test somewhere passed — the test has to sit one level from a node
      // whose `source` is that actor, or naming an already-supported test would mint
      // standing for a publisher that predicted nothing. So the claim this solution
      // carries has to come from `example.com` for the last call in this list to be a
      // real exercise of the tool rather than a refusal counted as one.
      name: "ost_create_node",
      arguments: { title: "Daily streak", layer: "Solution", parent: "I want a reason to come back", body: "b", source: "WEB:example.com", evidence: "assertion" },
    },
    {
      // The belief the solution rests on. A test attaches under one of these
      // now, not under the solution directly.
      name: "ost_create_node",
      arguments: { title: "Streaks change return behaviour", layer: "Assumption", parent: "Daily streak", body: "b", source: "INBOX:x", evidence: "assertion" },
    },
    {
      name: "ost_create_node",
      // Carries an instrument because an AssumptionTest without one is refused at
      // the boundary now: a test nothing can run is a test the builder cannot use.
      arguments: { title: "Streaks lift day-7 return", layer: "AssumptionTest", parent: "Streaks change return behaviour", body: "## Format\nreturn rate", source: "INBOX:x", evidence: "stated", instrument: "npx vitest run test/streaks.test.ts" },
    },
    { name: "ost_link_nodes", arguments: { parent: "Streaks change return behaviour", child: "Streaks lift day-7 return" } },
    // Deliberately NOT "## Results". That heading is reserved
    // (`src/ost/headings.ts`, B1) — the agent may never author the section its
    // own gates read as proof a test was run, so a sequence that used one here
    // would be asserting the surface can do something it is now refused. The
    // corroborating result `ost_rank_source` needs is planted out of band by
    // `exerciseSurface`, through the CLI's write path.
    { name: "ost_append_to_node", arguments: { title: "Streaks lift day-7 return", section: "## Notes\nday-7 return rose from 21% to 28%." } },
    { name: "ost_set_status", arguments: { title: "Daily streak", status: "in-discovery", note: "test is running" } },
    { name: "ost_set_evidence", arguments: { title: "Streaks lift day-7 return", evidence: "stated", note: "one report" } },
    {
      name: "ost_set_instrument",
      arguments: { test: "Streaks lift day-7 return", instrument: "npx vitest run test/streaks-v2.test.ts", why: "the first command named the wrong module" },
    },
    { name: "ost_flag_humans_required", arguments: { test: "Streaks lift day-7 return", why: 'names an outside person: "interview"' } },
    { name: "ost_annotate", arguments: { title: "Daily streak", issue: "duplicate of nothing yet" } },
    { name: "ost_rank_source", arguments: { kind: "web", id: "example.com", direction: "corroborated", reason: "corroborated by [[Streaks lift day-7 return]]" } },
    // The three mutations, exercised because "the surface writes no policy" has
    // to hold for the tools that can REMOVE things too — a merge deletes a file
    // and rewrites every node that pointed at it, which is the widest write on
    // this surface and therefore the one most worth walking the tree after.
    // A second Solution is created first so the merge has a same-layer partner
    // that carries no recorded result.
    {
      name: "ost_create_node",
      arguments: { title: "A streak counter", layer: "Solution", parent: "I want a reason to come back", body: "b", source: "INBOX:x", evidence: "assertion" },
    },
    { name: "ost_edit_node", arguments: { title: "A streak counter", prose: "A sharper framing of the same idea.", why: "the first draft named a mechanism, not the need it serves" } },
    { name: "ost_detach_nodes", arguments: { parent: "I want a reason to come back", child: "A streak counter", why: "re-parenting under the surviving solution" } },
    { name: "ost_merge_nodes", arguments: { from: "A streak counter", into: "Daily streak", prose: "One framing covering both.", why: "the same solution, written twice" } },
    { name: "ost_ingest_inbox", arguments: {} },
  ];

  /** The rest of the surface, with the reason calling it would prove nothing here. */
  const NOT_EXERCISED: Record<string, string> = {
    ost_read_tree: "read-only — cannot produce a diff, so cannot write a policy file",
    ost_next_work: "read-only",
    ost_check: "read-only analysis",
    ost_debt: "read-only analysis",
    ost_status: "read-only analysis",
    ost_gate: "read-only analysis",
    ost_read_repo: "read-only, and reads a repo rather than the vault",
    ost_search_web: "read-only, and would need the network the suite refuses",
    ost_read_web: "read-only, and would need the network the suite refuses",
  };

  async function exerciseSurface(): Promise<{
    before: string[];
    after: string[];
    outsideBefore: Map<string, string>;
    outsideAfter: Map<string, string>;
    dropFolder: string;
    ok: number;
  }> {
    // The drop folder is wherever this vault's config says — outside the vault, on
    // a fresh vault, which is exactly why the snapshot below is taken over `work`
    // and not only over `dir`.
    const dropFolder = dropFolderOf(dir);
    fs.mkdirSync(dropFolder, { recursive: true });
    fs.writeFileSync(path.join(dropFolder, "note.md"), "players churn after day three\n", "utf8");
    const before = walkVault(dir);
    const outsideBefore = walkOutside(work, dir);
    const client = await connect();
    let ok = 0;
    for (const call of CALLS) {
      // `ost_rank_source` refuses a promotion that cites no recorded result (B4),
      // and the only actor that may record one is the human on the CLI (B1). So
      // the result is planted here, through the write path that names the heading
      // as its own argument — the position no tool call reaches. Doing it inside
      // the loop rather than in the fixture keeps the ordering honest: the node
      // has to exist first, and it is created by an earlier call.
      if (call.name === "ost_rank_source") {
        new Vault(dir).appendUnderSection(
          "Streaks lift day-7 return",
          RESULTS_HEADING,
          "- 2026-07-30 **supported** (ran by Tanner) — day-7 return rose from 21% to 28%.",
        );
      }
      const res = (await client.callTool(call)) as { isError?: boolean };
      if (!res.isError) ok += 1;
    }
    return { before, after: walkVault(dir), outsideBefore, outsideAfter: walkOutside(work, dir), dropFolder, ok };
  }

  test("every tool on the MCP surface is exercised here, or declared read-only", () => {
    // Derived, not listed: a tool added to the surface fails this until someone
    // decides which bucket it is in. Otherwise "the surface writes no policy"
    // quietly comes to mean "the eleven tools I remembered write no policy".
    const covered = [...new Set([...CALLS.map((c) => c.name), ...Object.keys(NOT_EXERCISED)])].sort();
    expect(covered).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("the surface really ran — otherwise the assertions below are about nothing", async () => {
    const { before, after, outsideBefore, dropFolder, ok } = await exerciseSurface();
    expect(ok).toBe(CALLS.length);
    expect(after.length).toBeGreaterThan(before.length);

    // The outside walker has to be able to see the world it is about to report
    // unchanged. Without this, `changedOutside` over two empty maps would report
    // "nothing was written outside the vault" for a surface that wrote anything at
    // all out there.
    expect([...outsideBefore.keys()]).toContain(path.relative(work, path.join(dropFolder, "note.md")));

    // `ost_ingest_inbox` succeeds when it finds nothing, so a green `ok` count does
    // not prove the drop folder was read — which is precisely how the note being
    // planted in a hardcoded folder nobody reads any more stayed invisible. The
    // record has to actually exist.
    const stored = after
      .filter((rel) => rel.startsWith(".ost-agent/evidence/"))
      .map((rel) => fs.readFileSync(path.join(dir, rel), "utf8"));
    expect(
      stored.some((text) => text.includes("players churn after day three")),
      "the planted note never became an evidence record — the drop folder this fixture writes is not the one the vault reads",
    ).toBe(true);
  }, SURFACE_TIMEOUT_MS);

  test("the operator's config is unchanged, byte for byte", async () => {
    const original = fs.readFileSync(configPath(dir));
    await exerciseSurface();
    expect(fs.readFileSync(configPath(dir)).equals(original)).toBe(true);
  }, SURFACE_TIMEOUT_MS);

  test("nothing it wrote is a policy file, anywhere in the vault", async () => {
    const { after } = await exerciseSurface();
    const policy = after.filter((rel) => rel !== CONFIG_FILENAME && POLICY_SHAPED.test(path.basename(rel)));
    expect(policy).toEqual([]);
  }, SURFACE_TIMEOUT_MS);

  test("everything it wrote is a node at the root or state under `.ost-agent/`", async () => {
    // init's own comment says "the vault root only ever contains OST node
    // files". Holding the surface to it is what makes a policy file at the root
    // unwritable rather than merely unwritten — a new kind of file has to be a
    // deliberate change to this test.
    const { after } = await exerciseSurface();
    const stray = after.filter((rel) => {
      if (rel.startsWith(".ost-agent/")) return false;
      if (rel === CONFIG_FILENAME) return false;
      return path.dirname(rel) !== "." || !rel.endsWith(".md");
    });
    expect(stray).toEqual([]);
  }, SURFACE_TIMEOUT_MS);

  test("and nothing at all outside the vault, where that rule cannot reach", async () => {
    // The clause above is scoped to the vault, and the vault used to be the whole
    // of what an ingest touches. Since the drop folder escaped, it is not: a
    // `policy.yaml` written next to the vault would satisfy every assertion above
    // and still be sitting in the directory the next pass reads from. So the same
    // criterion is asserted over the rest of the workspace, where the permitted
    // answer is not "root node or sidecar" but *nothing* — the surface has no
    // business writing outside the vault it was pointed at.
    //
    // Bytes, not names: the drop folder is included, and the adapter's read-only
    // promise is what leaves an over-redacted note's original recoverable
    // (`test/processes/evidence-redaction.test.ts`). A note rewritten in place
    // would keep its name.
    const { outsideBefore, outsideAfter } = await exerciseSurface();
    expect(changedOutside(outsideBefore, outsideAfter)).toEqual([]);
  }, SURFACE_TIMEOUT_MS);
});
