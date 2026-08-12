/**
 * Put two vaults on one machine and see whether the upward search picks the
 * right one.
 *
 * The convention under test: no file records the project→vault link; every
 * consumer searches from where it is standing, upward, for a directory with the
 * vault's shape (`ost.config.yaml`), and takes the nearest. The assumption that
 * decides whether this can replace a recorded pointer is that the answer is
 * unambiguous — because the convention's failure mode is silently binding a
 * project to whatever vault happens to sit above it, a mistake that produces no
 * error at all, only the wrong tree.
 *
 * So the fixture is a machine with several vaults, laid out the ways the
 * assumption test names: one vault nested under another (a "home" vault with a
 * working vault inside it), two vaults as siblings, and a project outside any
 * vault. Ten start directories; the bar is 0 of 10 silently selecting the wrong
 * vault, with ambiguous cases returning nothing rather than guessing.
 *
 * What this does not settle, stated by the node itself: a machine laid out in a
 * way this fixture did not anticipate — the standing weakness of conventions
 * over declarations. And "the intended vault" for each start is decided by the
 * person who wrote this file; for a start contained by no vault there is no
 * objectively correct answer to give, which is exactly why the required answer
 * there is null.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { findVaultAbove } from "../../src/config/vault-search.js";
import { describeVaultSource, resolveVaultDir, VAULT_POINTER_FILENAME } from "../../src/config/pointer.js";
import { initVault } from "../../src/runner/init.js";

/**
 * The machine. `root` itself is not a vault, so anything under `side/` has no
 * vault above it (nothing in `os.tmpdir()`'s ancestry is one either).
 *
 *   root/
 *   ├── home/              ← a vault ("another sits at the home directory")
 *   │   └── work/
 *   │       └── tree-a/    ← a vault, nested under home
 *   │           ├── src/config/
 *   │           ├── projects/app/   ← a project cloned inside tree-a
 *   │           └── inner-tree/     ← a third vault, nested under tree-a
 *   │               └── notes/
 *   └── side/              ← not a vault
 *       ├── vault-one/     ← siblings: two vaults, neither containing the other
 *       │   └── sub/
 *       ├── vault-two/
 *       └── plain-project/ ← a project outside any vault
 */
let root: string;
let home: string;
let treeA: string;
let innerTree: string;
let vaultOne: string;
let vaultTwo: string;

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-upward-")));
  home = path.join(root, "home");
  treeA = path.join(home, "work", "tree-a");
  innerTree = path.join(treeA, "inner-tree");
  vaultOne = path.join(root, "side", "vault-one");
  vaultTwo = path.join(root, "side", "vault-two");

  await initVault(home, "The home vault");
  await initVault(treeA, "Tree A, nested under home");
  await initVault(innerTree, "Inner tree, nested under tree A");
  await initVault(vaultOne, "Vault one of two siblings");
  await initVault(vaultTwo, "Vault two of two siblings");

  for (const dir of [
    path.join(treeA, "src", "config"),
    path.join(treeA, "projects", "app"),
    path.join(innerTree, "notes"),
    path.join(vaultOne, "sub"),
    path.join(root, "side", "plain-project"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ten starts across the layouts — 0 may silently select the wrong vault", () => {
  /** [what the start is, start dir relative to root, intended vault or null] */
  const starts: Array<[string, string[], () => string | null]> = [
    ["the vault root itself", ["home", "work", "tree-a"], () => treeA],
    ["a subdirectory of a vault", ["home", "work", "tree-a", "src"], () => treeA],
    ["a deep subdirectory of a vault", ["home", "work", "tree-a", "src", "config"], () => treeA],
    // The case the node warns about: a project nested under one vault while
    // another vault sits above both. Nearest containment must win.
    ["a project cloned inside tree-a, with home above both", ["home", "work", "tree-a", "projects", "app"], () => treeA],
    ["a directory between the home vault and tree-a", ["home", "work"], () => home],
    ["the home vault's own root", ["home"], () => home],
    // Nested vaults: the inner one shadows the outer, as a nested git repo does.
    ["inside a vault nested within another vault", ["home", "work", "tree-a", "inner-tree", "notes"], () => innerTree],
    ["inside the first of two sibling vaults", ["side", "vault-one", "sub"], () => vaultOne],
    ["the second sibling vault's root", ["side", "vault-two"], () => vaultTwo],
    // No ancestor is a vault, and two sit beside it. Picking either would be a
    // guess; the convention must return nothing instead.
    ["a project outside any vault, beside two of them", ["side", "plain-project"], () => null],
  ];

  test("the table really holds ten starts", () => {
    expect(starts).toHaveLength(10);
  });

  test.each(starts)("from %s", (_what, rel, intended) => {
    expect(findVaultAbove(path.join(root, ...rel))).toBe(intended());
  });

  test("0 of 10: counted across the whole table, no start picks a wrong vault", () => {
    const wrong = starts.filter(([, rel, intended]) => findVaultAbove(path.join(root, ...rel)) !== intended());
    expect(wrong.map(([what]) => what)).toEqual([]);
  });
});

describe("the search only replaces the blind cwd fallback in resolveVaultDir", () => {
  test("a command run from a vault subdirectory resolves the vault, and says how", () => {
    const cwd = path.join(treeA, "src", "config");

    const r = resolveVaultDir(undefined, { cwd, env: undefined });

    expect(r).toMatchObject({ dir: treeA, via: "search", searchedFrom: cwd });
    const line = describeVaultSource(r)!;
    expect(line).toContain(treeA);
    expect(line).toContain(cwd);
  });

  test("standing in the vault root is not announced — there is nothing to explain", () => {
    const r = resolveVaultDir(undefined, { cwd: treeA, env: undefined });

    expect(r.dir).toBe(treeA);
    expect(describeVaultSource(r)).toBeNull();
  });

  test("every recorded answer still outranks the derived one", () => {
    const sub = path.join(treeA, "src");

    // --vault typed on the command line.
    expect(resolveVaultDir(vaultTwo, { cwd: sub })).toMatchObject({ dir: vaultTwo, via: "argument" });
    // OST_VAULT, a launcher's recorded guess.
    expect(resolveVaultDir(undefined, { cwd: sub, env: vaultTwo })).toMatchObject({ dir: vaultTwo, via: "environment" });
    // A pointer file committed by the project.
    const app = path.join(treeA, "projects", "app");
    fs.writeFileSync(path.join(app, VAULT_POINTER_FILENAME), `vault: ${vaultOne}\n`);
    try {
      expect(resolveVaultDir(undefined, { cwd: app, env: undefined })).toMatchObject({ dir: vaultOne, via: "pointer" });
    } finally {
      fs.rmSync(path.join(app, VAULT_POINTER_FILENAME));
    }
  });

  test("no vault above still falls back to the cwd, as it always did", () => {
    const cwd = path.join(root, "side", "plain-project");

    expect(resolveVaultDir(undefined, { cwd, env: undefined })).toMatchObject({ dir: cwd, via: "cwd" });
  });
});
