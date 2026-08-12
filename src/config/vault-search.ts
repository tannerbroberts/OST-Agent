/**
 * Upward vault search: find the vault by its shape, the way git finds its root.
 *
 * The pointer file (`src/config/pointer.ts`) is a recorded answer, and a recorded
 * answer can go stale. This is the convention-based alternative the tree asked
 * for: nothing records the link — every consumer walks up from where it is
 * standing and takes the nearest directory that has the vault's recognisable
 * shape. A vault that moves is found in its new place; a project cloned inside a
 * vault finds the vault above the clone.
 *
 * "Recognisable shape" is `ost.config.yaml` in the directory — the same test
 * `isVault` (src/ost/results.ts) already applies, kept as one shared constant so
 * the search and the error messages cannot disagree about what a vault is.
 *
 * The convention's known weakness, stated by the node that asked for it: it
 * silently binds a project to whatever vault happens to sit above it, and it
 * cannot express intent — a project that deliberately has no vault looks exactly
 * like one whose vault was not found. Two consequences in the design:
 *
 *  - **Nearest wins, and only ancestors count.** With two vaults nested, the one
 *    containing the start more closely is the answer, exactly as a nested git
 *    repository shadows its parent. A sibling vault is never an answer at all —
 *    when no ancestor is a vault the search returns `null` rather than guessing,
 *    because a wrong tree with no error is the failure mode this convention is
 *    most accused of.
 *  - **It ranks below every recorded answer.** `resolveVaultDir` consults it
 *    after `--vault`, the pointer file, and `OST_VAULT`; it only replaces the
 *    blind last resort of assuming the cwd is the vault.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME } from "./load.js";

/**
 * The nearest ancestor of `startDir` (inclusive) that is a vault, or `null`
 * when no ancestor is one. Never guesses: `null` means "no vault contains this
 * directory", not "pick one from somewhere else".
 */
export function findVaultAbove(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
