/**
 * Rebuild the symbol index at the commit that failed, and check it would have named
 * the right symbol.
 *
 * The solution under test is "Hand the run the project's symbol surface before it
 * writes, not after it compiles". Its assumption is **feasibility**: that this
 * project's symbol surface can be extracted mechanically and is accurate enough to have
 * prevented the two failures `TRANSCRIPT:e335a680-ee48-4171-b8ad-4cfb526e4129`
 * actually recorded. The node fixed the bar before anything was built, and it is three
 * lookups taken verbatim from that transcript — all three, no misses:
 *
 *   - `reconcileWithUsage` **absent** (`TS2552: Cannot find name 'reconcileWithUsage'`)
 *   - `reconcileWithGit` **present** (`Did you mean 'reconcileWithGit'?`)
 *   - `configProblem` **absent from `ToolContext`**
 *     (`TS2339: Property 'configProblem' does not exist on type 'ToolContext'`)
 *
 * ## The subject is a commit, and it had to be found rather than assumed
 *
 * "The repository state of the failing session" is not `HEAD`: `configProblem` is on
 * `ToolContext` today, added by `3c21e4d fix(g1): stop one typo in one file taking the
 * whole tool surface down`, and `reconcileWithUsage` is exported today, added by
 * `71b9654 feat(w2,w3)`. Run against `HEAD` two of the three lookups come out the other
 * way and the bar is unmeasurable. {@link FAILING_COMMIT} is the single commit where
 * all three hold at once — `71b9654~1`, the last state in which `reconcileWithGit`
 * existed and neither of the other two did — so the index is built over `src/` as it
 * stood there, all 63 modules of it, read straight out of the object database.
 *
 * Indexing the WHOLE tree at that commit is the load-bearing part of the setup. An
 * absence verdict over two hand-picked files is trivially true; only an absence taken
 * over the whole exported surface is the answer the compiler gave.
 *
 * ## Why the parser cross-check is here and not left to the three cases
 *
 * Three lookups that happen to be right cannot say whether the extractor is right, and
 * the failure mode that matters is a *false absence* — an export the scan misses reads
 * as "that name does not exist", and a run acting on that deletes a correct call. So
 * the last block runs the extractor over today's `src/` beside TypeScript's own parser
 * and requires exact agreement on every exported name and every declared member. That
 * comparison found two real defects in this extractor before it was committed: a regex
 * literal after `return` read as division and desynced the brace depth (two exports in
 * `src/loop/exitLaundering.ts` vanished), and `export function*` was not matched at all
 * (two more in `src/ost/`). Both are false absences, both are now covered by a unit
 * test below, and the cross-check is what would catch the third.
 *
 * ## What a green run does NOT settle
 *
 * Feasibility only, as the node says. It does not show a run handed the index would
 * consult it, it does not show the briefing is small enough to be worth the context it
 * costs, and it says nothing about whether anyone outside this project wants the
 * feature. Desirability, viability and usability are exactly where they were.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  buildSymbolIndex,
  formatMemberLookup,
  formatNameLookup,
  formatSymbolBriefing,
  indexModule,
  lookupMember,
  lookupName,
  nearestNames,
  SYMBOL_INDEX_CASES,
  type SourceFile,
} from "../../src/runner/symbol-index.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * `71b9654~1` — the state of this repository when the captured session was writing.
 *
 * Pinned as a full sha rather than a `~1` expression so the subject cannot move when
 * history around it does.
 */
const FAILING_COMMIT = "368cf6d7f91513cdc426afb1888b2a2050f32f58";

// ── the bar, before any index is built ───────────────────────────────────────

describe("the three lookups are the ones the transcript recorded", () => {
  test("they are pinned in source, not retyped here", () => {
    expect(SYMBOL_INDEX_CASES.absentName).toBe("reconcileWithUsage");
    expect(SYMBOL_INDEX_CASES.presentName).toBe("reconcileWithGit");
    expect(SYMBOL_INDEX_CASES.absentMember).toEqual({ type: "ToolContext", member: "configProblem" });
  });
});

// ── the extractor, on sources small enough to read ───────────────────────────

describe("what an exported declaration contributes to the surface", () => {
  test("every declaration form lands under its own kind", () => {
    const mod = indexModule("m.ts", [
      "export function f() {}",
      "export async function g() {}",
      "export class C {}",
      "export interface I { a: string }",
      "export type T = { b: number };",
      "export const K = 1;",
      "export enum E { A, B }",
    ].join("\n"));
    expect(mod.exports.map((e) => [e.name, e.kind])).toEqual([
      ["f", "function"],
      ["g", "function"],
      ["C", "class"],
      ["I", "interface"],
      ["T", "type"],
      ["K", "const"],
      ["E", "enum"],
    ]);
    expect(mod.exports.find((e) => e.name === "g")?.async).toBe(true);
    expect(mod.exports.find((e) => e.name === "f")?.async).toBe(false);
  });

  test("a generator export is a declaration, star and all", () => {
    // `export function* scanNearDuplicates` — the star binds to the keyword with no
    // space, and requiring whitespace there dropped two of this repository's exports.
    const mod = indexModule("m.ts", "export function* gen(): Generator<number> { yield 1; }");
    expect(mod.exports.map((e) => e.name)).toEqual(["gen"]);
  });

  test("a member's own type text is kept verbatim, mutability included", () => {
    const mod = indexModule("m.ts", "export interface I {\n  readonly nodes: readonly OstNode[];\n  maybe?: string;\n  run(x: number): void;\n}");
    expect(mod.exports[0].members).toEqual([
      { name: "nodes", optional: false, readonly: true, method: false, type: "readonly OstNode[]" },
      { name: "maybe", optional: true, readonly: false, method: false, type: "string" },
      { name: "run", optional: false, readonly: false, method: true, type: "" },
    ]);
  });

  test("a member may be named for a modifier", () => {
    // `ExportedSymbol.async` in `src/runner/symbol-index.ts` is exactly this, and
    // excluding members by name rather than by modifier position dropped it.
    const mod = indexModule("m.ts", "export interface I { async: boolean; get: string; static: number }");
    expect(mod.exports[0].members.map((m) => m.name)).toEqual(["async", "get", "static"]);
  });

  test("a nested object type does not leak its members into the parent", () => {
    const mod = indexModule("m.ts", "export interface I {\n  web?: { key?: string; budget?: number };\n  dir: string;\n}");
    expect(mod.exports[0].members.map((m) => m.name)).toEqual(["web", "dir"]);
  });

  test("a union spread over lines stays one member", () => {
    const mod = indexModule("m.ts", "export interface I {\n  kind:\n    | 'a'\n    | 'b';\n  n: number;\n}");
    expect(mod.exports[0].members.map((m) => m.name)).toEqual(["kind", "n"]);
    expect(mod.exports[0].members[0].type).toBe("| 'a' | 'b'");
  });

  test("a private class member is not surface", () => {
    const mod = indexModule("m.ts", "export class C {\n  readonly name = 'c';\n  private secret = 1;\n  #hidden = 2;\n  run() { return 1; }\n}");
    expect(mod.exports[0].members.map((m) => m.name)).toEqual(["name", "run"]);
  });

  test("a re-export enters the surface under its exported name", () => {
    const mod = indexModule("m.ts", "export { a, b as c } from './x.js';\nexport * from './y.js';");
    expect(mod.exports.map((e) => [e.name, e.kind, e.from])).toEqual([
      ["a", "re-export", "./x.js"],
      ["c", "re-export", "./x.js"],
      ["*", "re-export", "./y.js"],
    ]);
  });

  test("comments, strings and regexes cannot declare an export or move the depth", () => {
    const source = [
      "// export function commented() {}",
      "/* export interface Blocked { x: string } */",
      "const message = 'export function quoted() {}';",
      "const template = `a } { b`;",
      "function local(): boolean {",
      "  return /(^|[\\s;&|(])set\\s+-o\\s+pipefail/.test(message);",
      "}",
      "export function real(): boolean { return local(); }",
    ].join("\n");
    expect(indexModule("m.ts", source).exports.map((e) => e.name)).toEqual(["real"]);
  });

  test("a backtick inside `${…}` closes the nested template, not the outer one", () => {
    // The construct that desynchronised this scan for the rest of a file: an error
    // message quoting its keys. Everything after it read as absent, and a false
    // absence is the one answer this index must not give. Pinned here as well as by
    // the parity run below, because that run only catches it while some module in
    // `src/` happens to contain the construct.
    const source = [
      "export function gap(keys: string[]): string {",
      "  return `needs ${keys.map((k) => `\\`${k}\\``).join(', ')} — and the record lacks them`;",
      "}",
      "export interface AfterTheTemplate { seen: boolean }",
    ].join("\n");
    const mod = indexModule("m.ts", source);

    expect(mod.exports.map((e) => e.name)).toEqual(["gap", "AfterTheTemplate"]);
    expect(mod.exports[1].members.map((m) => m.name)).toEqual(["seen"]);
  });

  test("a brace or backtick inside an interpolation's own string does not end it early", () => {
    const source = [
      "export const closing = `${cond ? `{` : '}'} tail`;",
      "export interface StillHere { ok: boolean }",
    ].join("\n");

    expect(indexModule("m.ts", source).exports.map((e) => e.name)).toEqual(["closing", "StillHere"]);
  });

  test("an export nested inside a block is not a module export", () => {
    const source = "declare global {\n  export interface Window { ost: string }\n}\nexport const K = 1;";
    expect(indexModule("m.ts", source).exports.map((e) => e.name)).toEqual(["K"]);
  });
});

describe("the index answers absence the way the compiler does", () => {
  const index = buildSymbolIndex([
    { path: "a.ts", source: "export function reconcileWithGit() {}\nexport interface Ctx { vault: string; dir: string }" },
  ]);

  test("a name that is not there is reported absent, with the near miss volunteered", () => {
    const found = lookupName(index, "reconcileWithUsage");
    expect(found.present).toBe(false);
    expect(found.suggestions).toEqual(["reconcileWithGit"]);
    expect(formatNameLookup(found)).toContain("Did you mean 'reconcileWithGit'?");
  });

  test("a name that is there is reported with where it is and what it takes", () => {
    const found = lookupName(index, "reconcileWithGit");
    expect(found.present).toBe(true);
    expect(found.sites).toEqual([
      { module: "a.ts", kind: "function", line: 1, signature: "export function reconcileWithGit()" },
    ]);
  });

  test("an absent member is reported with everything the type does declare", () => {
    const found = lookupMember(index, "Ctx", "configProblem");
    expect(found.typePresent).toBe(true);
    expect(found.present).toBe(false);
    expect(found.members).toEqual(["vault", "dir"]);
  });

  test("a type that extends something withholds the absence rather than overstating it", () => {
    // The scan does not resolve inheritance, so `present: false` on a derived type means
    // "not on its own declaration". Saying otherwise would delete a correct call.
    const derived = buildSymbolIndex([{ path: "b.ts", source: "export interface Wide extends Base { own: string }" }]);
    const found = lookupMember(derived, "Wide", "fromBase");
    expect(found.present).toBe(false);
    expect(found.inheritedFrom).toEqual(["Base"]);
    expect(formatMemberLookup(found)).toContain("Inherited members from Base were not resolved");
  });

  test("an unrelated name is not volunteered as a suggestion", () => {
    expect(nearestNames("reconcileWithUsage", ["formatCensus", "buildOstTools"])).toEqual([]);
    expect(nearestNames("reconcileWithUsage", ["reconcileWithGit", "formatCensus"])).toEqual(["reconcileWithGit"]);
  });
});

// ── THE INSTRUMENT: the index rebuilt at the commit that failed ──────────────

/**
 * Every `src/**` TypeScript file at `sha`, read out of the object database in one
 * `git cat-file --batch` rather than one `git show` per file.
 *
 * It throws rather than skipping when the commit is unreachable. A shallow checkout
 * would otherwise turn the one command that measures this assumption into a green run
 * over an empty subject, which is the pathology `test/product/committed-capability-profile.test.ts`
 * and the `fetch-depth: 0` in `.github/workflows/ci.yml` already exist to prevent.
 */
function sourcesAt(sha: string): SourceFile[] {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    throw new Error(
      `commit ${sha} is not in this checkout, so the symbol index cannot be rebuilt at the state that failed. ` +
        `Fetch full history (\`git fetch --unshallow\`) — this test must not pass over a subject it cannot read.`,
    );
  }

  const paths = execFileSync("git", ["ls-tree", "-r", "--name-only", sha, "--", "src"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((p) => p.endsWith(".ts"));

  const batch = execFileSync("git", ["cat-file", "--batch"], {
    cwd: repoRoot,
    input: paths.map((p) => `${sha}:${p}`).join("\n") + "\n",
    maxBuffer: 256 * 1024 * 1024,
  });

  // `<sha> blob <size>\n<size bytes>\n`, one record per requested path, in order.
  const files: SourceFile[] = [];
  let at = 0;
  for (const p of paths) {
    const nl = batch.indexOf(0x0a, at);
    const header = batch.subarray(at, nl).toString("utf8");
    const size = Number(header.split(" ")[2]);
    const start = nl + 1;
    files.push({ path: p, source: batch.subarray(start, start + size).toString("utf8") });
    at = start + size + 1;
  }
  return files;
}

describe("the index rebuilt over src/ at the commit the session was writing from", () => {
  const files = sourcesAt(FAILING_COMMIT);
  const index = buildSymbolIndex(files);

  test("the subject is the whole tree at that commit, not a pair of chosen files", () => {
    // An absence taken over two files is trivially true. 63 modules is the whole of
    // `src/` at `71b9654~1`, which is the surface `tsc` was reading when it objected.
    expect(files).toHaveLength(63);
    expect(index.modules).toHaveLength(63);
    expect(index.modules.reduce((n, m) => n + m.exports.length, 0)).toBe(355);
    expect(files.map((f) => f.path)).toContain("src/ost/census.ts");
    expect(files.map((f) => f.path)).toContain("src/security/tools.ts");
  });

  test("CASE 1 — `reconcileWithUsage` is absent, and the near miss is the one tsc named", () => {
    const found = lookupName(index, SYMBOL_INDEX_CASES.absentName);
    expect(found.present).toBe(false);
    expect(found.sites).toEqual([]);
    // `TS2552: Cannot find name 'reconcileWithUsage'. Did you mean 'reconcileWithGit'?`
    // — reproduced from source text alone, before any compile.
    expect(found.suggestions[0]).toBe(SYMBOL_INDEX_CASES.presentName);
    expect(formatNameLookup(found)).toContain("Did you mean 'reconcileWithGit'?");
  });

  test("CASE 2 — `reconcileWithGit` is present, in the module that declares it", () => {
    const found = lookupName(index, SYMBOL_INDEX_CASES.presentName);
    expect(found.present).toBe(true);
    expect(found.sites.map((s) => s.module)).toEqual(["src/ost/census.ts"]);
    expect(found.sites[0].kind).toBe("function");
    expect(found.sites[0].line).toBe(90);
    // The signature carries the parameters and the return type, which is the half of
    // the surface a name lookup alone does not give.
    expect(found.sites[0].signature).toBe(
      "export async function reconcileWithGit( vaultRoot: string, census: TreeCensus, ): Promise<IndependentDenominator | undefined>",
    );
  });

  test("CASE 3 — `ToolContext` does not carry `configProblem`, and here is what it does carry", () => {
    const found = lookupMember(index, SYMBOL_INDEX_CASES.absentMember.type, SYMBOL_INDEX_CASES.absentMember.member);
    expect(found.typePresent).toBe(true);
    expect(found.module).toBe("src/security/tools.ts");
    expect(found.present).toBe(false);
    // The whole member list, because "it isn't there" is only half of what the run
    // needed — the other half is what is.
    expect(found.members).toEqual([
      "vault",
      "dir",
      "remote",
      "minSolutionsPerOpportunity",
      "surface",
      "web",
      "productRepos",
      "passContext",
    ]);
    // `ToolContext` extends nothing, so this absence is complete, not partial.
    expect(found.inheritedFrom).toEqual([]);
  });

  test("ALL THREE, NO MISSES — the threshold the node fixed", () => {
    const one = lookupName(index, SYMBOL_INDEX_CASES.absentName).present === false;
    const two = lookupName(index, SYMBOL_INDEX_CASES.presentName).present === true;
    const three =
      lookupMember(index, SYMBOL_INDEX_CASES.absentMember.type, SYMBOL_INDEX_CASES.absentMember.member).present === false;
    expect([one, two, three]).toEqual([true, true, true]);
  });

  test("the surface serializes to a briefing, and the briefing states what it dropped", () => {
    // 11,210 characters for 63 modules at that commit — recorded, not judged. Whether
    // that is small enough to be worth its context is exactly what the node says a
    // green run here does not settle.
    const full = formatSymbolBriefing(index);
    expect(full.length).toBe(11210);
    const clipped = formatSymbolBriefing(index, { maxChars: 2000 });
    expect(clipped.length).toBeLessThanOrEqual(2000 + 60);
    expect(clipped).toMatch(/… \d+ more module\(s\) not shown/);
  });
});

// ── the extractor against TypeScript's own parser, over today's src/ ─────────

function tsSurface(file: SourceFile): { names: Set<string>; members: Map<string, Set<string>> } {
  const sf = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.ES2022, true);
  const names = new Set<string>();
  const members = new Map<string, Set<string>>();
  for (const st of sf.statements) {
    const exported = (ts.canHaveModifiers(st) ? (ts.getModifiers(st) ?? []) : []).some(
      (m) => m.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exported) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
      continue;
    }
    if (!("name" in st) || !st.name || !ts.isIdentifier(st.name)) continue;
    names.add(st.name.text);
    const body = ts.isInterfaceDeclaration(st)
      ? st.members
      : ts.isTypeAliasDeclaration(st) && ts.isTypeLiteralNode(st.type)
        ? st.type.members
        : undefined;
    // An index signature carries no `name` node; both sides identify it by its bracket
    // form (`[k: string]`), which is what the text scan records.
    if (body) {
      members.set(
        st.name.text,
        new Set(body.map((m) => (m.name ? m.name.getText(sf) : (/^\[[^\]]*\]/.exec(m.getText(sf))?.[0] ?? m.getText(sf).trim())))),
      );
    }
  }
  return { names, members };
}

function srcFiles(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) srcFiles(p, out);
    else if (entry.name.endsWith(".ts")) out.push({ path: path.relative(repoRoot, p), source: fs.readFileSync(p, "utf8") });
  }
  return out;
}

describe("the text scan agrees with TypeScript's parser on today's src/", () => {
  const files = srcFiles(path.join(repoRoot, "src"));

  test("the corpus is this repository's whole source tree, not a sample", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  test("every exported name TypeScript sees, the scan sees — and no others", () => {
    // A false absence is the one wrong answer this index must not give: an export the
    // scan misses reads as "that name does not exist". This is the check that catches
    // the next construct the scan cannot parse, on the commit that introduces it.
    const missing: string[] = [];
    const extra: string[] = [];
    for (const file of files) {
      const truth = tsSurface(file);
      const mine = new Set(indexModule(file.path, file.source).exports.filter((e) => e.kind !== "re-export").map((e) => e.name));
      for (const n of truth.names) if (!mine.has(n)) missing.push(`${file.path}:${n}`);
      for (const n of mine) if (!truth.names.has(n)) extra.push(`${file.path}:${n}`);
    }
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });

  test("every declared member TypeScript sees, the scan sees — and no others", () => {
    const missing: string[] = [];
    const extra: string[] = [];
    for (const file of files) {
      const truth = tsSurface(file);
      const mod = indexModule(file.path, file.source);
      for (const [type, expected] of truth.members) {
        const got = new Set(mod.exports.find((e) => e.name === type)?.members.map((m) => m.name) ?? []);
        for (const m of expected) if (!got.has(m)) missing.push(`${file.path}:${type}.${m}`);
        for (const m of got) if (!expected.has(m)) extra.push(`${file.path}:${type}.${m}`);
      }
    }
    expect(missing).toEqual([]);
    expect(extra).toEqual([]);
  });
});
