/**
 * Can the tools be loaded from inside the vault directory at all?
 *
 * The feasibility question under the packaging answer. Everything that launches
 * OST-Agent's tools today launches them for a *project*: `.claude/settings.json`
 * enables a plugin, the plugin points a server at `${CLAUDE_PROJECT_DIR}`, and
 * the project is whichever directory the session happened to open. Four
 * scheduled passes ran with no tools because the vault was fine and that other
 * directory carried nothing. The candidate this file measures is the other
 * shape — the vault carries the declaration — and the only thing worth checking
 * first is whether such a declaration can be loaded at all.
 *
 * So the bar is the one the assumption test fixed: **a vault opened from an
 * unrelated working directory yields its tools.** Every test here sets the
 * process (or the child's) working directory somewhere with no relationship to
 * the vault, and asks for the `ost_*` surface anyway.
 *
 * What is deliberately NOT asserted: that shipping this way is right. The
 * packaging cost, the upgrade story for a vault carrying its own server copy,
 * and whether an operator wants their vault to be executable are all untouched
 * by anything green here.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { initVault } from "../../src/runner/init.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { loadVaultDeclaredTools } from "../../src/mcp/vault-declared.js";
import {
  VAULT_DECLARATION_FILENAME,
  readVaultDeclaration,
  renderVaultDeclaration,
} from "../../src/config/vault-declaration.js";

/** The vault. */
let vault: string;
/** A directory with nothing to do with it — where the session is standing. */
let elsewhere: string;
const originalCwd = process.cwd();

beforeEach(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-declared-vault-"));
  elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "ost-declared-elsewhere-"));
  await initVault(vault, "Reach 10,000 daily active users", "Retention");
});
afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(vault, { recursive: true, force: true });
  fs.rmSync(elsewhere, { recursive: true, force: true });
});

async function connect(server: ReturnType<typeof loadVaultDeclaredTools>["server"]): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await (server as NonNullable<typeof server>).connect(serverT);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientT);
  return client;
}

describe("a vault that carries its own tool-server declaration", () => {
  test("init leaves the declaration inside the vault, naming an artefact that exists", () => {
    const file = path.join(vault, VAULT_DECLARATION_FILENAME);
    expect(fs.existsSync(file)).toBe(true);

    const read = readVaultDeclaration(vault);
    expect(read.status).toBe("found");
    if (read.status !== "found") return;
    // The vault it binds to is itself — resolved out of the declaration, which is
    // what makes the file mean "the vault I am in" rather than a path that was
    // correct on the machine that wrote it.
    expect(read.server.vault).toBe(path.resolve(vault));
    expect(read.server.artifact).not.toBeNull();
    expect(fs.existsSync(read.server.artifact as string)).toBe(true);
    expect(read.server.args).toContain("mcp");
  });

  test("the declaration is stored self-relatively, not as this machine's vault path", () => {
    const raw = fs.readFileSync(path.join(vault, VAULT_DECLARATION_FILENAME), "utf8");
    // The absolute vault path must not appear as the bound vault: written that
    // way the file would be right exactly once, and a copy of the vault would
    // quietly serve the original — worse than serving nothing, because nothing
    // reports it.
    expect(JSON.parse(raw).mcpServers["ost-agent"].env.OST_VAULT).toBe("${CLAUDE_PROJECT_DIR}");
  });
});

describe("loading those tools from an unrelated working directory", () => {
  test("the ost_* surface comes back, bound to the vault and not to the cwd", async () => {
    process.chdir(elsewhere);

    const load = loadVaultDeclaredTools(vault);
    expect(load.problem ?? "").toBe("");
    expect(load.ok).toBe(true);
    expect(load.vault).toBe(path.resolve(vault));

    const client = await connect(load.server);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
    } finally {
      await client.close();
    }
  });

  test("the tools operate on the declared vault — a write lands there, not in the cwd", async () => {
    process.chdir(elsewhere);

    const load = loadVaultDeclaredTools(vault);
    const client = await connect(load.server);
    try {
      const res = await client.callTool({
        name: "ost_create_node",
        arguments: {
          title: "Daily streak",
          layer: "Opportunity",
          parent: "Retention",
          body: "b",
          source: "a note from the founder",
          evidence: "stated",
        },
      });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    expect(fs.existsSync(path.join(vault, "Daily streak.md"))).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, "Daily streak.md"))).toBe(false);
  });

  test("a copy of the vault serves the copy, because the declaration travelled with it", async () => {
    process.chdir(elsewhere);
    // The property the sibling candidates cannot have: the enabling artefact is
    // inside the thing being copied, so it says "here" rather than a path that
    // was true on one machine.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "ost-declared-copy-"));
    try {
      fs.cpSync(vault, copy, { recursive: true });
      const load = loadVaultDeclaredTools(copy);
      expect(load.ok).toBe(true);
      expect(load.vault).toBe(path.resolve(copy));
      expect(load.vault).not.toBe(path.resolve(vault));
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  });

  test("a vault with no declaration is refused by name, never resolved from the cwd", () => {
    process.chdir(vault); // standing IN the vault — still not an answer the loader may use
    fs.rmSync(path.join(vault, VAULT_DECLARATION_FILENAME));

    const load = loadVaultDeclaredTools(vault);
    expect(load.ok).toBe(false);
    expect(load.vault).toBeUndefined();
    expect(load.problem).toContain(VAULT_DECLARATION_FILENAME);
  });

  test("a declaration naming an artefact that is not on disk fails here, not at launch", () => {
    fs.writeFileSync(
      path.join(vault, VAULT_DECLARATION_FILENAME),
      renderVaultDeclaration("${CLAUDE_PROJECT_DIR}/.ost-agent/bin/ost-agent.mjs"),
      "utf8",
    );
    const load = loadVaultDeclaredTools(vault);
    expect(load.ok).toBe(false);
    expect(load.problem).toMatch(/does not exist/);
    // Named the file it looked for, so the operator can put it there.
    expect(load.problem).toContain(path.join(vault, ".ost-agent", "bin", "ost-agent.mjs"));
  });
});

describe("the declared server, actually launched from an unrelated working directory", () => {
  test("spawning exactly what the vault declares yields the ost_* tools", async () => {
    // The in-process tests prove the declaration resolves. This one proves the
    // thing it resolves TO is a tool server: the child is started with the
    // command, arguments and environment the vault's own file supplies, from a
    // working directory with no relationship to the vault, and with every
    // ambient OST variable stripped so nothing but the declaration can be
    // supplying the answer.
    const read = readVaultDeclaration(vault);
    expect(read.status).toBe("found");
    if (read.status !== "found") return;
    const declared = read.server;

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && k !== "OST_VAULT" && k !== "ANTHROPIC_API_KEY") env[k] = v;
    }

    const transport = new StdioClientTransport({
      command: declared.command,
      args: declared.args,
      env: { ...env, ...declared.env },
      cwd: elsewhere,
    });
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
      const res = await client.callTool({
        name: "ost_create_node",
        arguments: {
          title: "Weekly digest",
          layer: "Opportunity",
          parent: "Retention",
          body: "b",
          source: "a note from the founder",
          evidence: "stated",
        },
      });
      expect(res.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    // The launched server served the vault that declared it, from a cwd that had
    // nothing to say about which vault that was.
    expect(fs.existsSync(path.join(vault, "Weekly digest.md"))).toBe(true);
  }, 30_000);
});
