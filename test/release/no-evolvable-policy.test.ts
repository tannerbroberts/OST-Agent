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
 * **Not a wedge.** Every assertion is over a `mkdtemp` vault or over the source
 * tree; nothing here can red a real vault, and every red is cleared by changing
 * the code or by adding the new writer to the register with its reason.
 */
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
import { CONFIG_FILENAME, configPath } from "../../src/config/load.js";

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

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-g4-"));
  await initVault(dir, OUTCOME, ROOT);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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
      name: "ost_create_node",
      arguments: { title: "Daily streak", layer: "Solution", parent: "I want a reason to come back", body: "b", source: "INBOX:x", evidence: "stated" },
    },
    {
      name: "ost_create_node",
      arguments: { title: "Streaks lift day-7 return", layer: "AssumptionTest", parent: "Daily streak", body: "## Format\nreturn rate", source: "INBOX:x", evidence: "stated" },
    },
    { name: "ost_link_nodes", arguments: { parent: "Daily streak", child: "Streaks lift day-7 return" } },
    { name: "ost_append_to_node", arguments: { title: "Streaks lift day-7 return", section: "## Results\nday-7 return rose from 21% to 28%." } },
    { name: "ost_set_status", arguments: { title: "Daily streak", status: "in-discovery", note: "test is running" } },
    { name: "ost_set_evidence", arguments: { title: "Streaks lift day-7 return", evidence: "stated", note: "one report" } },
    { name: "ost_flag_humans_required", arguments: { test: "Streaks lift day-7 return", why: 'names an outside person: "interview"' } },
    { name: "ost_annotate", arguments: { title: "Daily streak", issue: "duplicate of nothing yet" } },
    { name: "ost_rank_source", arguments: { host: "example.com", rung: "expert", reason: "corroborated by [[Streaks lift day-7 return]]" } },
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

  async function exerciseSurface(): Promise<{ before: string[]; after: string[]; ok: number }> {
    fs.writeFileSync(path.join(dir, ".ost-agent", "inbox", "note.md"), "players churn after day three\n", "utf8");
    const before = walkVault(dir);
    const client = await connect();
    let ok = 0;
    for (const call of CALLS) {
      const res = (await client.callTool(call)) as { isError?: boolean };
      if (!res.isError) ok += 1;
    }
    return { before, after: walkVault(dir), ok };
  }

  test("every tool on the MCP surface is exercised here, or declared read-only", () => {
    // Derived, not listed: a tool added to the surface fails this until someone
    // decides which bucket it is in. Otherwise "the surface writes no policy"
    // quietly comes to mean "the eleven tools I remembered write no policy".
    const covered = [...new Set([...CALLS.map((c) => c.name), ...Object.keys(NOT_EXERCISED)])].sort();
    expect(covered).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("the surface really ran — otherwise the assertions below are about nothing", async () => {
    const { before, after, ok } = await exerciseSurface();
    expect(ok).toBe(CALLS.length);
    expect(after.length).toBeGreaterThan(before.length);
  });

  test("the operator's config is unchanged, byte for byte", async () => {
    const original = fs.readFileSync(configPath(dir));
    await exerciseSurface();
    expect(fs.readFileSync(configPath(dir)).equals(original)).toBe(true);
  });

  test("nothing it wrote is a policy file, anywhere in the vault", async () => {
    const { after } = await exerciseSurface();
    const policy = after.filter((rel) => rel !== CONFIG_FILENAME && POLICY_SHAPED.test(path.basename(rel)));
    expect(policy).toEqual([]);
  });

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
  });
});
