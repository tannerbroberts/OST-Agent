/**
 * The pointer file: how a project says where its Opportunity Solution Tree lives.
 *
 * A vault knows which product it serves — its Outcome says so on the first line.
 * The product did not know which vault maps it, and discovery always starts from
 * the code, so every session that wanted to run a pass first had to guess between
 * candidate directories in `$HOME`. `ost.vault.yaml` at the project root is the
 * answer written down where the search actually begins.
 *
 * It is a visible file, not a dotfile, on purpose. The assumption the whole idea
 * rests on is that something reads it *unprompted*; an agent that runs `ls` and a
 * human that opens a file tree both see `ost.vault.yaml` sitting beside
 * `package.json`, and neither sees `.ost-vault`. Its name deliberately rhymes with
 * the `ost.config.yaml` that lives inside the vault — same family, opposite
 * direction.
 *
 * Its known weakness, stated by the node that asked for it: it is only a string.
 * It goes stale the moment the vault moves and nothing will say so. That is why
 * `resolveVaultDir` reports *where* an answer came from — a caller that finds
 * nothing at the end of a pointer can name the file that sent it there.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { findVaultAbove } from "./vault-search.js";

/** The one filename. Committed at the project root, beside `package.json`. */
export const VAULT_POINTER_FILENAME = "ost.vault.yaml";

/**
 * A bare string is accepted as shorthand for `{ vault: <string> }`, because the
 * three-line file an operator writes by hand is usually one path and nothing
 * else, and a format that rejects the obvious thing is a format nobody keeps.
 */
const PointerSchema = z.union([
  z.string().min(1),
  z.object({
    /** Where the vault is, absolute, `~`-prefixed, or relative to this file. */
    vault: z.string().min(1),
    /**
     * The outcome that vault serves, verbatim. Read by nothing — it is here so a
     * human opening the file learns what they are being pointed at without
     * having to go look.
     */
    outcome: z.string().optional(),
  }),
]);

export interface VaultPointer {
  /** Absolute path to the vault named by the file. Not checked for existence. */
  dir: string;
  /** The outcome recorded alongside it, when the file records one. */
  outcome?: string;
  /** Absolute path of the pointer file itself, so an error can name it. */
  file: string;
}

/**
 * Expand a leading `~` before resolving. Same reason as
 * `resolveSessionsDir` (`src/cli/loop.ts`): `path.resolve(base, "~/x")` produces
 * `<base>/~/x`, a directory that cannot exist, and the operator writing a vault
 * path by hand is exactly the person who types `~`.
 */
function resolveAgainst(baseDir: string, declared: string): string {
  if (declared === "~") return os.homedir();
  if (declared.startsWith("~/")) return path.join(os.homedir(), declared.slice(2));
  return path.resolve(baseDir, declared);
}

/**
 * Read the pointer file in exactly this directory. `null` when there is none.
 *
 * Throws on a file that exists and cannot be used, matching `loadConfig`: a
 * malformed pointer is a mistake to report, not a state to tolerate. Callers that
 * must survive it use `resolveVaultDir`, which catches and says so.
 */
export function readVaultPointer(dir: string): VaultPointer | null {
  const file = path.join(path.resolve(dir), VAULT_POINTER_FILENAME);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = parseYaml(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file} is not valid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  const parsed = PointerSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${file} does not name a vault — it needs a \`vault:\` key holding a path (or a bare path on one line)`,
    );
  }
  const value = parsed.data;
  const declared = typeof value === "string" ? value : value.vault;
  return {
    dir: resolveAgainst(path.dirname(file), declared),
    outcome: typeof value === "string" ? undefined : value.outcome,
    file,
  };
}

/**
 * Walk up from `startDir` looking for a pointer file, nearest first.
 *
 * Upward, because the command gets run from wherever the operator happens to be
 * standing — `src/config/`, a test fixture, a subpackage — and the pointer is
 * committed once at the root. Stops at the filesystem root; the first file found
 * wins, so a nested project can override its parent's answer.
 */
export function findVaultPointer(startDir: string): VaultPointer | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const found = readVaultPointer(dir);
    if (found) return found;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Where the answer came from, in the order the answers are consulted. */
export type VaultSource = "argument" | "pointer" | "environment" | "search" | "cwd";

export interface VaultResolution {
  /** Absolute path of the directory to treat as the vault. */
  dir: string;
  via: VaultSource;
  /** Set when `via` is `"pointer"` — the file that supplied the answer. */
  pointer?: VaultPointer;
  /**
   * Set when `via` is `"search"` — where the upward search started, so a caller
   * can say which directory led it to a vault nothing recorded.
   */
  searchedFrom?: string;
  /**
   * Set when a pointer file exists and could not be read. The resolution then
   * falls through to the next source rather than failing: one typo in one file
   * must not take down every command in the CLI, and a caller that prints this
   * gives the operator the one line they need to fix it.
   */
  problem?: string;
}

export interface ResolveVaultOptions {
  /** Where to start the upward search. Defaults to the process's cwd. */
  cwd?: string;
  /** The ambient `OST_VAULT`. Defaults to the process's own. */
  env?: string;
}

/**
 * Decide which directory is the vault, and say why.
 *
 * The order is the argument the pointer file exists to win:
 *
 * 1. **`--vault` typed on the command line** — an operator naming a directory
 *    outranks everything; nothing here second-guesses it.
 * 2. **The pointer file**, searched upward from the cwd. It is the project's own
 *    committed answer, versioned with the code and readable by a human.
 * 3. **`OST_VAULT`** — what a launcher guessed. The plugin sets it to
 *    `${CLAUDE_PROJECT_DIR}` for every project alike
 *    (`.claude-plugin/plugin.json`), which is right whenever the vault *is* the
 *    project and wrong whenever it is not. A pointer file only exists in the
 *    second case, which is why it is consulted first.
 * 4. **The nearest vault above the cwd** (`findVaultAbove`) — derived, not
 *    recorded, so it ranks below everything anyone wrote down. It replaces only
 *    the blind assumption below it: `ost-agent status` run from a vault's
 *    subdirectory now finds the vault instead of failing on a directory that
 *    holds no config.
 * 5. **The cwd**, the last-resort assumption that you are standing in the vault.
 */
export function resolveVaultDir(explicit?: string, opts: ResolveVaultOptions = {}): VaultResolution {
  if (explicit != null && explicit !== "") return { dir: path.resolve(explicit), via: "argument" };

  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env.OST_VAULT;

  let problem: string | undefined;
  try {
    const pointer = findVaultPointer(cwd);
    if (pointer) return { dir: pointer.dir, via: "pointer", pointer };
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }

  if (env) return { dir: path.resolve(env), via: "environment", problem };

  const above = findVaultAbove(cwd);
  if (above) return { dir: above, via: "search", searchedFrom: path.resolve(cwd), problem };
  return { dir: path.resolve(cwd), via: "cwd", problem };
}

/**
 * One line naming where the vault came from, for a surface that has somewhere to
 * put it. The pointer and the upward search are worth saying out loud, because
 * both send the command somewhere the operator did not name; the rest is what
 * the operator already typed, exported, or stood in. The search line exists
 * because the convention's failure mode is a wrong tree with no error — a
 * derived binding must never be a silent one.
 */
export function describeVaultSource(r: VaultResolution): string | null {
  if (r.problem) return `${r.problem} — falling back to ${r.dir}`;
  if (r.via === "search" && r.searchedFrom && r.searchedFrom !== r.dir) {
    return `vault ${r.dir} — the nearest vault above ${r.searchedFrom} (found by upward search; nothing records this link)`;
  }
  if (r.via !== "pointer" || !r.pointer) return null;
  const outcome = r.pointer.outcome ? ` (${r.pointer.outcome})` : "";
  return `vault ${r.dir}${outcome} — named by ${r.pointer.file}`;
}
