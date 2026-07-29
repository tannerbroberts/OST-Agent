/**
 * `Vault` is the only thing that serializes a node to disk. (V1 readiness, W4.)
 *
 * The claim is made in `src/ost/vault.ts`'s own header — "This class is the ONLY
 * thing that touches node files on disk" — and every safety property downstream
 * of it rests on that being true: `assertWritableContent`'s refusals, the
 * confinement in `nodePath`, the append-only shape of every write. A module that
 * imports `serialize` and calls `writeFileSync` itself gets none of them, and
 * the resulting file looks exactly like a node the vault wrote.
 *
 * This is not hypothetical. `src/harness/generate.ts` did precisely that until
 * the harness was deleted (`8261a6f`), so the claim in that header became true
 * by accident and stayed unpinned — which is how the next one ships.
 *
 * **Why an import-level check, and not the obvious same-line grep.** Two greps
 * were considered and both are worse:
 *
 * - `grep 'serialize(' | grep writeFileSync` is defeated by splitting the call
 *   across two statements, which is the ordinary way anyone would write it.
 * - `grep -rn "import.*\bserialize\b.*ost/node" src/` — the form the readiness
 *   doc originally proposed — matches **nothing at all** today: `vault.ts`'s
 *   import spans nine lines and names the module `./node.js`, so a line-oriented
 *   grep returns an empty set and reads as a pass. A check whose green state and
 *   whose broken state are the same output is not a check.
 *
 * So the parse below is statement-oriented and specifier-resolving: it finds
 * every file that could *reach* `serialize`, including through a namespace
 * import, and names them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");
const NODE_MODULE = path.join(srcRoot, "ost/node.ts");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

/** Resolve a relative specifier the way NodeNext does: `./x.js` is `./x.ts` on disk. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  if (fs.existsSync(base)) return base;
  const asIndex = base.replace(/\.ts$/, "/index.ts");
  return fs.existsSync(asIndex) ? asIndex : null;
}

/** Every `import … from "…"` statement in a file, clause and specifier, newlines included. */
function importStatements(source: string): Array<{ clause: string; specifier: string }> {
  return [...source.matchAll(/import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g)].map((m) => ({
    clause: m[1],
    specifier: m[2],
  }));
}

/**
 * Files under `src/` that can reach `serialize` from `ost/node`.
 *
 * `\bserialize\b` deliberately does not match `deserialize` — reading is not the
 * concern; only the write side can produce a file that skips the vault's guards.
 */
function serializeImporters(): string[] {
  const holders: string[] = [];
  for (const file of tsFiles(srcRoot)) {
    if (file === NODE_MODULE) continue; // where it is defined
    for (const { clause, specifier } of importStatements(fs.readFileSync(file, "utf8"))) {
      if (resolveSpecifier(file, specifier) !== NODE_MODULE) continue;
      const namesIt = /\bserialize\b/.test(clause);
      // `import * as node` hands over the whole module, serialize included.
      const namespaced = /\*\s+as\s+\w+/.test(clause);
      if (namesIt || namespaced) holders.push(path.relative(repoRoot, file));
    }
  }
  return [...new Set(holders)].sort();
}

describe("only Vault serializes a node to disk", () => {
  test("the parse finds the module it is looking for", () => {
    // Guards against the whole check passing because a rename made every
    // specifier resolve to null.
    expect(fs.existsSync(NODE_MODULE)).toBe(true);
    expect(fs.readFileSync(NODE_MODULE, "utf8")).toMatch(/export function serialize\(/);
  });

  test("exactly one module imports serialize, and it is the vault", () => {
    expect(serializeImporters()).toEqual(["src/ost/vault.ts"]);
  });

  test("nothing outside the vault writes a node file", () => {
    // The complementary half: `serialize` is how a node is *rendered*, but a
    // module could also hand-roll the frontmatter. Anything writing a `.md` path
    // outside the vault module is at least worth reading before it lands.
    const writers = tsFiles(srcRoot)
      .filter((f) => f !== path.join(srcRoot, "ost/vault.ts"))
      .filter((f) => /writeFileSync\([^)]*\.md\b/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(repoRoot, f));
    expect(writers).toEqual([]);
  });
});
