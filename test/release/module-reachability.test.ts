/**
 * No module ships with zero non-test callers. (V1 readiness, G3.)
 *
 * A module reachable only from its own tests is a module whose tests are the
 * only thing that has ever run it. That is not merely tidiness: the harness was
 * this repo's one prediction/outcome/score triple, and a harness varying a gene
 * that reached no consumer would have reported a fitness delta for a policy
 * nobody applied — corroboration manufactured out of noise, which is the exact
 * pathology earned believability (DEC-2) exists to prevent. `src/eval/correlate.ts`
 * was that module, and it shipped for months because nothing looked.
 *
 * **Reachability, not "is imported once."** A pair of dead modules that import
 * each other passes the weaker check, so the walk starts at the package's real
 * entry points and follows the import graph. Entry points are *derived*, not
 * listed: any `src/**.ts` path named in `package.json`'s scripts (the esbuild
 * bundle entry and the `tsx` dev entry are both `src/cli/index.ts`), plus
 * whatever `scripts/` imports directly. Nothing under `test/` is a caller.
 *
 * **On the known-unreachable list below.** The criterion warns that "excluding
 * dead modules" as a manual carve-out lets whoever runs the check make it pass
 * by declaring more modules dead. So this asserts **exact equality**, not
 * absence-of-new: widening the list is a visible commit that has to argue for
 * itself, and deleting or wiring up a module on it fails this test until the
 * entry comes off. The list is a debt register, not an exemption.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");

/**
 * Modules with no live caller today, each with the reason it is still here.
 *
 * Both are *deletions someone declined to make*, not oversights — which is why
 * the list carries the criterion that would retire each one rather than a
 * shrug.
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  // H3: `detectLaunderedExit` is correct and tested, and its refusal message
  // names `ost-agent loop step` — a command that does not exist. H3 is met by
  // wiring it to a caller; it is also met by deleting it. Neither has happened.
  "src/loop/exitLaundering.ts": "H3 — the laundered-exit detector has no caller and names a command that does not exist",
  // Reads token spend out of Claude Code's session JSONL. Written for a
  // correlator (`eval/attention.ts`) that never came to import it.
  "src/adapters/tokens.ts": "the token reader for attention accounting; eval/attention.ts computes without it",
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

const SRC_FILES = tsFiles(srcRoot);
const rel = (p: string) => path.relative(repoRoot, p);

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  if (SRC_FILES.includes(base)) return base;
  const asIndex = base.replace(/\.ts$/, "/index.ts");
  return SRC_FILES.includes(asIndex) ? asIndex : null;
}

/** Static and dynamic imports alike — `await import(…)` is a caller too. */
function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  const specifiers = [
    ...[...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ];
  return specifiers.map((s) => resolveSpecifier(file, s)).filter((p): p is string => p !== null);
}

/** Entry points, derived: every `src/**.ts` path package.json's scripts name. */
function packageEntryPoints(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
    main?: string;
    bin?: string | Record<string, string>;
  };
  const declared = [
    ...Object.values(pkg.scripts ?? {}),
    pkg.main ?? "",
    ...(typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {})),
  ].join(" ");
  const named = [...declared.matchAll(/\bsrc\/[A-Za-z0-9/_.-]+\.ts\b/g)].map((m) => path.join(repoRoot, m[0]));
  return [...new Set(named)].filter((p) => SRC_FILES.includes(p));
}

/** Build tooling that consumes `src/` without being part of it. */
function scriptEntryPoints(): string[] {
  const dir = path.join(repoRoot, "scripts");
  if (!fs.existsSync(dir)) return [];
  return [...new Set(tsFiles(dir).flatMap(importsOf))];
}

function unreachableModules(): string[] {
  const seen = new Set<string>();
  const stack = [...packageEntryPoints(), ...scriptEntryPoints()];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) if (!seen.has(next)) stack.push(next);
  }
  return SRC_FILES.filter((f) => !seen.has(f)).map(rel);
}

describe("every src module has a non-test caller", () => {
  test("the entry points are derived and the graph is actually walked", () => {
    // Without this, a package.json rename would empty the root set and report
    // every module dead — or, worse, an empty SRC_FILES would report none.
    expect(packageEntryPoints().map(rel)).toContain("src/cli/index.ts");
    expect(SRC_FILES.length).toBeGreaterThan(30);
    expect(importsOf(path.join(srcRoot, "cli/index.ts")).length).toBeGreaterThan(5);
  });

  test("the unreachable set is exactly the known debt, module for module", () => {
    expect(unreachableModules()).toEqual(Object.keys(KNOWN_UNREACHABLE).sort());
  });

  test("every entry on the debt register still exists", () => {
    // A module deleted while its entry stayed would leave the register lying
    // about what the repo owes.
    for (const module of Object.keys(KNOWN_UNREACHABLE)) {
      expect(fs.existsSync(path.join(repoRoot, module)), `${module} is on the register but not on disk`).toBe(true);
    }
  });
});
