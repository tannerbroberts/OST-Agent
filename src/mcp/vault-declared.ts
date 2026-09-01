/**
 * Load the tools a vault declares for itself.
 *
 * This is the load path for the packaging answer rather than the configuration
 * one: instead of a project's `.claude/settings.json` enabling a plugin that then
 * points a server at whatever directory the session opened, the *vault* carries
 * `.mcp.json` naming its own server and binding it to its own directory. Hand
 * this function a vault path from anywhere — any cwd, any project — and it comes
 * back with the `ost_*` surface bound to that vault, because every path in the
 * declaration resolves against the declaration (`src/config/vault-declaration.ts`)
 * and none of them resolves against the process.
 *
 * **It does not spawn the command it read.** The declaration's `command` is a
 * string a file on disk supplies, and executing one would hand any vault on disk
 * an arbitrary-exec capability this product does not have and must not acquire
 * (`CONTRIBUTING.md`, the closed allowlist). So the declaration is *checked* —
 * it must be declared under this server's name, name an `mcp` invocation, and
 * name an artefact that is actually on disk — and then the surface is bound in
 * process, by the same `createLazyOstMcpServer` the stdio entrypoint uses. What
 * the check cannot establish is that the named artefact really is this server;
 * only running it could, and running it is the thing being declined. A caller
 * that needs that answer is a test with a fixture it wrote itself, and it spawns
 * the resolved command on its own account.
 */
import path from "node:path";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  VAULT_DECLARATION_FILENAME,
  usableVaultDeclaration,
  type VaultDeclaredServer,
} from "../config/vault-declaration.js";
import { MCP_TOOL_NAMES, createLazyOstMcpServer } from "./server.js";

export interface VaultDeclaredLoad {
  ok: boolean;
  /** Where the declaration was looked for, absolute, found or not. */
  file: string;
  /**
   * The vault the tools are bound to when `ok` — from the declaration, never
   * from the cwd. Absent when nothing usable was found, because a guess here is
   * the failure this whole path removes.
   */
  vault?: string;
  /** The resolved declaration, for a caller that wants to say what it read. */
  declared?: VaultDeclaredServer;
  /** The `ost_*` surface, ready to connect to a transport. */
  server?: Server;
  /** The tool names that surface carries, when `ok`. */
  toolNames?: readonly string[];
  /** Why nothing was loaded, in the operator's terms. */
  problem?: string;
}

/**
 * Read `<vault>/.mcp.json` and return the surface it declares.
 *
 * Never throws and never guesses: a vault with no declaration, a malformed one,
 * or one naming a server this process cannot vouch for all come back as
 * `ok: false` with the reason. The caller decides whether that is a diagnosis to
 * print or a fallback to take.
 */
export function loadVaultDeclaredTools(vaultDir: string): VaultDeclaredLoad {
  const use = usableVaultDeclaration(vaultDir);
  if (!use.ok) {
    return { ok: false, file: use.file, declared: use.declared, problem: use.reason };
  }
  return {
    ok: true,
    file: use.file,
    vault: use.server.vault,
    declared: use.server,
    // Bound in process, from the vault the declaration named — never by running
    // the command it named. Lazy, so this costs no config load until a call
    // arrives, which is what makes it cheap enough for a diagnostic caller.
    server: createLazyOstMcpServer(use.server.vault),
    toolNames: MCP_TOOL_NAMES,
  };
}

/**
 * One line saying what the vault's own declaration did or did not supply.
 *
 * Written for a surface that logs to stderr, and phrased so the failing case
 * names the file rather than the symptom — "no tools" is the message the failing
 * path already delivers, silently, and it is the one that cost four passes.
 */
export function describeVaultDeclaredLoad(load: VaultDeclaredLoad): string {
  if (load.ok) {
    return `${VAULT_DECLARATION_FILENAME} in ${path.dirname(load.file)} declares this vault's tools (${load.toolNames?.length} of them), bound to ${load.vault}`;
  }
  return load.problem ?? `${load.file} declares no usable tool server`;
}
