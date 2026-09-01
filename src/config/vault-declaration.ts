/**
 * The vault's own tool-server declaration — the file that makes a vault carry
 * its tools instead of depending on a second file somewhere else.
 *
 * The gap `setup-check.ts` diagnoses is real but its fix lives in the wrong
 * place: `.claude/settings.json` enables a *plugin* for a *project*, and the
 * project is whatever directory the session happened to open. A vault that is
 * moved, copied, or opened from an unexpected directory loses its tools again,
 * because the thing that launches them never travelled with it. Four scheduled
 * passes ran toolless on exactly that shape.
 *
 * `.mcp.json` at the vault root is the other half of the answer: a server
 * declared *by the vault*, naming its own artefact and binding itself to its own
 * directory. Two properties make it work, and both are the point of this module:
 *
 *   - **Self-locating.** Every path in the declaration is resolved against the
 *     directory the declaration sits in — never against `process.cwd()`, which
 *     is the variable that made the original failure invisible. `${CLAUDE_PROJECT_DIR}`
 *     and `${OST_VAULT}` both expand to that same directory, so the file reads
 *     the same to Claude Code (which substitutes them itself) and to
 *     {@link readVaultDeclaration} (which substitutes them here).
 *   - **Carried, not referenced.** The declaration travels inside the vault, in
 *     the vault's own git history. Copy the vault and the declaration comes with
 *     it; there is no second artefact to remember.
 *
 * What this module does NOT do is run anything. It parses a declaration and
 * reports what it names. The `command` in a `.mcp.json` is a string some file on
 * disk supplies, and OST-Agent holds no capability to execute one
 * (`CONTRIBUTING.md`: adapters and tools never shell out); `src/mcp/vault-declared.ts`
 * binds the surface in-process after checking the declaration names *this*
 * server, and never spawns what it read.
 */
import fs from "node:fs";
import path from "node:path";
import { ARTIFACT_PATH } from "../release/capability-manifest.js";

/** The one filename, at the vault root — the name Claude Code already reads. */
export const VAULT_DECLARATION_FILENAME = ".mcp.json";

/** The server key inside it. Same name the plugin manifest uses. */
export const VAULT_SERVER_NAME = "ost-agent";

/**
 * Where a vault that carries its own copy of the server keeps it, vault-relative.
 *
 * Under the dot-folder for the same reason every other sidecar is (Obsidian
 * ignores it, and the vault root stays nothing but node files). Nothing in this
 * module puts a copy there — {@link declaredServerPath} prefers one when it is
 * already present, so the packaging step can land later without changing the
 * load path it would have to change.
 */
export const VAULT_CARRIED_SERVER = ".ost-agent/bin/ost-agent.mjs";

/**
 * The placeholders that mean "the directory this declaration is sitting in".
 *
 * `${CLAUDE_PROJECT_DIR}` is the host's own, and is what a vault opened as the
 * project gets substituted for it — the plugin manifest already uses it the same
 * way. `${OST_VAULT}` is the same value under the name the rest of this codebase
 * uses for it, so a hand-written declaration reads correctly to an operator who
 * knows the env var and not the host.
 */
const SELF_PLACEHOLDERS = ["${CLAUDE_PROJECT_DIR}", "${OST_VAULT}"] as const;

/** A declaration, with every path already resolved. Nothing here is relative. */
export interface VaultDeclaredServer {
  /** Absolute path of the declaration file that supplied this. */
  file: string;
  /** The server key it was declared under. */
  name: string;
  /** The executable it names — a PATH lookup, or an absolute path. */
  command: string;
  /** Its arguments, placeholders expanded and the artefact made absolute. */
  args: string[];
  /** Its environment, placeholders expanded. */
  env: Record<string, string>;
  /**
   * The vault the declaration binds the server to, absolute.
   *
   * From the declaration's own `OST_VAULT`, resolved against the declaration's
   * directory; the declaration's directory itself when it names none. Never the
   * cwd — a vault that resolved through the cwd would be the bug this file exists
   * to remove.
   */
  vault: string;
  /**
   * The server artefact the declaration names, absolute, when its first argument
   * looks like one (anything that is not a flag). `null` for a declaration whose
   * arguments are all flags — legal, and something a caller may want to refuse.
   */
  artifact: string | null;
}

/** What was at the vault root. Three outcomes, each actionable on its own. */
export type VaultDeclarationRead =
  /** A declaration that parses and names this server. */
  | { status: "found"; file: string; server: VaultDeclaredServer }
  /** No declaration at all — the vault does not carry its tools yet. */
  | { status: "absent"; file: string }
  /** A declaration that exists and cannot be used, and exactly why. */
  | { status: "problem"; file: string; reason: string };

/** Absolute path of the declaration a vault would carry, whether or not it does. */
export function vaultDeclarationPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), VAULT_DECLARATION_FILENAME);
}

/** Substitute every self-placeholder with the directory the declaration sits in. */
function expandSelf(value: string, declDir: string): string {
  let out = value;
  for (const placeholder of SELF_PLACEHOLDERS) out = out.split(placeholder).join(declDir);
  return out;
}

/**
 * Resolve the argument list.
 *
 * Exactly one entry is a path: the first non-flag argument, which by the
 * convention every MCP declaration follows is the server artefact. Everything
 * after it is the server's own vocabulary — `mcp` is a subcommand, not a
 * directory — and gets placeholder expansion and nothing else. Resolving every
 * non-flag argument as a path is the obvious rule and it is wrong: it turns
 * `["…/ost-agent.mjs", "mcp"]` into a launch of `<vault>/mcp`, which fails as
 * `unknown command` at spawn time rather than as anything readable here.
 */
function resolveArgs(args: readonly string[], declDir: string): { args: string[]; artifact: string | null } {
  let artifact: string | null = null;
  const out = args.map((arg) => {
    const expanded = expandSelf(arg, declDir);
    if (artifact !== null || expanded.startsWith("-")) return expanded;
    artifact = path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(declDir, expanded);
    return artifact;
  });
  return { args: out, artifact };
}

/**
 * Resolve the `command`. A bare name (`node`) is a PATH lookup and stays one; a
 * name with a separator in it is a path and gets the same treatment as an
 * argument, because `./bin/server` in a declaration means "beside the
 * declaration", not "beside wherever you were standing".
 */
function resolveCommand(command: string, declDir: string): string {
  const expanded = expandSelf(command, declDir);
  if (!expanded.includes("/") && !expanded.includes(path.sep)) return expanded;
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.resolve(declDir, expanded);
}

interface RawServer {
  command?: unknown;
  args?: unknown;
  env?: unknown;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}

function stringRecord(v: unknown): Record<string, string> | null {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<string, string> = {};
  for (const [k, value] of Object.entries(v as Record<string, unknown>)) {
    if (typeof value !== "string") return null;
    out[k] = value;
  }
  return out;
}

/**
 * Read the declaration a vault carries, resolved and ready to act on.
 *
 * `vaultDir` is the directory being asked about — the answer never depends on
 * where the process is standing, which is the whole property under test. A
 * declaration that exists and cannot be used comes back as `problem` with the
 * reason in the operator's terms rather than as a throw: this is consulted on
 * paths that must survive a malformed file (the same rule `resolveVaultDir`
 * follows for a broken pointer).
 */
export function readVaultDeclaration(vaultDir: string): VaultDeclarationRead {
  const declDir = path.resolve(vaultDir);
  const file = path.join(declDir, VAULT_DECLARATION_FILENAME);
  if (!fs.existsSync(file)) return { status: "absent", file };

  let parsed: { mcpServers?: Record<string, RawServer> };
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return { status: "problem", file, reason: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const servers = parsed?.mcpServers;
  if (servers == null || typeof servers !== "object" || Array.isArray(servers)) {
    return { status: "problem", file, reason: `has no "mcpServers" object` };
  }
  const raw = servers[VAULT_SERVER_NAME];
  if (raw == null) {
    const named = Object.keys(servers);
    return {
      status: "problem",
      file,
      reason:
        named.length === 0
          ? `declares no servers, so it enables nothing`
          : `declares ${named.map((n) => `"${n}"`).join(", ")} but no "${VAULT_SERVER_NAME}" server`,
    };
  }
  if (typeof raw.command !== "string" || raw.command === "") {
    return { status: "problem", file, reason: `the "${VAULT_SERVER_NAME}" server names no "command"` };
  }
  const args = raw.args === undefined ? [] : raw.args;
  if (!isStringArray(args)) {
    return { status: "problem", file, reason: `the "${VAULT_SERVER_NAME}" server's "args" is not a list of strings` };
  }
  const env = stringRecord(raw.env);
  if (env === null) {
    return { status: "problem", file, reason: `the "${VAULT_SERVER_NAME}" server's "env" is not an object of strings` };
  }

  const resolved = resolveArgs(args, declDir);
  const resolvedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) resolvedEnv[k] = expandSelf(v, declDir);

  // The declared vault, resolved against the declaration rather than the cwd.
  // A declaration that says nothing binds the server to the directory it is in,
  // which is the case this whole file is about.
  const declaredVault = resolvedEnv.OST_VAULT;
  const vault = declaredVault ? path.resolve(declDir, declaredVault) : declDir;

  return {
    status: "found",
    file,
    server: {
      file,
      name: VAULT_SERVER_NAME,
      command: resolveCommand(raw.command, declDir),
      args: resolved.args,
      env: resolvedEnv,
      vault,
      artifact: resolved.artifact,
    },
  };
}

/** The subcommand a declaration has to name for this to be an OST tool server. */
const MCP_SUBCOMMAND = "mcp";

/** {@link usableVaultDeclaration}'s answer: a server to launch, or why not. */
export type VaultDeclarationUse =
  | { ok: true; file: string; server: VaultDeclaredServer }
  | { ok: false; file: string; declared?: VaultDeclaredServer; reason: string };

/**
 * Does this directory carry a declaration that would actually produce tools?
 *
 * Three things past parsing, and each one is a way for a present declaration to
 * yield nothing at launch and say nothing about why:
 *
 *   - it has to be declared under this server's name (`readVaultDeclaration`),
 *   - its arguments have to name the `mcp` subcommand, or it describes some
 *     other program that happens to be filed under our key, and
 *   - the artefact it names has to be on disk. A declaration that travelled
 *     without its artefact is the shape that cost four scheduled passes: present
 *     configuration, absent tools, nothing anywhere saying which file to look at.
 *
 * Kept here, beside the parser, rather than beside the loader, because
 * `setup-check.ts` answers "can a session opened here launch the tools" and
 * would otherwise call a declaration OK on the strength of it parsing — a false
 * OK, which is the one answer that check must never give.
 */
export function usableVaultDeclaration(vaultDir: string): VaultDeclarationUse {
  const read = readVaultDeclaration(vaultDir);
  if (read.status === "absent") {
    return {
      ok: false,
      file: read.file,
      reason: `${read.file} does not exist — this directory does not carry its own tool-server declaration, so opening it is not enough to get the tools`,
    };
  }
  if (read.status === "problem") return { ok: false, file: read.file, reason: `${read.file} ${read.reason}` };

  const server = read.server;
  if (!server.args.includes(MCP_SUBCOMMAND)) {
    return {
      ok: false,
      file: read.file,
      declared: server,
      reason: `${read.file} declares "${VAULT_SERVER_NAME}" but its arguments never name the \`${MCP_SUBCOMMAND}\` subcommand, so it does not describe an OST tool server`,
    };
  }
  if (server.artifact === null) {
    return {
      ok: false,
      file: read.file,
      declared: server,
      reason: `${read.file} declares "${VAULT_SERVER_NAME}" with no server artefact among its arguments`,
    };
  }
  if (!fs.existsSync(server.artifact)) {
    return {
      ok: false,
      file: read.file,
      declared: server,
      reason: `${read.file} names the server at ${server.artifact}, which does not exist — the declaration travelled but the artefact did not`,
    };
  }
  return { ok: true, file: read.file, server };
}

/**
 * The server artefact this process was launched from, absolute, or `null`.
 *
 * Found by walking up from the running file rather than from the cwd — same
 * search `findReleaseRoot` does for the capability manifest, and for the same
 * reason: for a plugin install the cwd is some unrelated project directory, and
 * the question is about the binary in front of us. It answers in all three ways
 * this code gets run: from the bundle (`argv[1]` is the artefact itself), from
 * `dist/` after `tsc`, and from `src/` under `tsx` in the suite — in each case the
 * walk finds the same committed `dist/ost-agent.mjs`.
 */
export function runningServerArtifact(argv1: string | undefined = process.argv[1]): string | null {
  const segments = ARTIFACT_PATH.split("/");
  let dir = path.resolve(path.dirname(argv1 ?? "."));
  for (;;) {
    const candidate = path.join(dir, ...segments);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The path a fresh declaration should name for the server artefact, and whether
 * it is one the vault carries.
 *
 * Two answers, in the order that survives the vault moving:
 *
 *   1. **A copy the vault already carries** — written as
 *      `${CLAUDE_PROJECT_DIR}/…` so it stays correct wherever the vault ends up.
 *      This is what "one unit" finally means, and this function prefers it the
 *      moment something puts a copy there.
 *   2. **The artefact this process was launched from**, absolute. Honest and
 *      immediately usable on this machine; it is the thing that breaks if the
 *      vault is carried to another one, which is why it ranks second and why the
 *      caller is told which answer it got.
 *
 * `null` when neither exists — a declaration naming an artefact that is not there
 * is worse than no declaration, because it fails at launch instead of at setup.
 */
export function declaredServerPath(
  vaultDir: string,
  runningArtifact: string | null,
): { path: string; carried: boolean } | null {
  const carried = path.join(path.resolve(vaultDir), ...VAULT_CARRIED_SERVER.split("/"));
  if (fs.existsSync(carried)) return { path: `\${CLAUDE_PROJECT_DIR}/${VAULT_CARRIED_SERVER}`, carried: true };
  if (runningArtifact && fs.existsSync(runningArtifact)) return { path: runningArtifact, carried: false };
  return null;
}

/**
 * The declaration's text, for a server at `serverPath`.
 *
 * `OST_VAULT` is `${CLAUDE_PROJECT_DIR}` rather than the vault's absolute path on
 * purpose: written absolute, the file would be correct exactly once and wrong the
 * first time the vault was copied — with the failure showing up as a session
 * quietly serving the *original* vault, which is worse than serving none. The
 * placeholder is what makes the declaration mean "the vault I am in".
 */
export function renderVaultDeclaration(serverPath: string): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        [VAULT_SERVER_NAME]: {
          command: "node",
          args: [serverPath, "mcp"],
          env: { OST_VAULT: "${CLAUDE_PROJECT_DIR}" },
        },
      },
    },
    null,
    2,
  )}\n`;
}
