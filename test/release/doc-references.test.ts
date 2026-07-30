/**
 * D4 — no operator-facing document names a command or a module that does not exist.
 *
 * The failure this prevents is specific and was live until 2026-07-30:
 * `docs/reference/evaluating-ost-agent.md` told the reader to run an `eval` npm
 * script and pointed at `src/eval/judge.ts` and `src/eval/scorecard.ts` for the
 * detail. The script had been dropped from `package.json` and both modules had
 * been deleted with the evaluation harness; only `src/eval/invariants.ts`
 * survived. The README mentioned the removal in passing, so the repo *knew* —
 * but the reference document still read as live, in the present tense, with a
 * copy-pasteable shell block. **An unattended operator following a reference doc
 * gets a non-zero exit and no way to tell "I mistyped it" from "it was deleted a
 * release ago."** A doc naming absent machinery is worse than a doc that is
 * silent: it spends the reader's trust and then fails.
 *
 * ## Scope, and why it is computed rather than curated
 *
 * The criterion names the operator-facing surface: `README.md`, everything under
 * `docs/reference/`, and `docs/consuming-from-claude-code.md`. Two exclusions,
 * both for the same reason — the document's *subject* is machinery that is gone:
 *
 * - `docs/superpowers/` is a dated design archive. Its specs and plans name files
 *   that were proposed and never built, or built and since deleted; rewriting
 *   them would falsify the record. The unscoped grep returns 31 such paths, which
 *   is the archive doing its job. (Today it is out of scope twice over — it is not
 *   under any included root — but the exclusion is written down anyway, so that
 *   widening `ROOTS` to `docs` later cannot silently drag the archive in.)
 * - `docs/reference/v1-readiness.md` is excluded because naming absent machinery
 *   is the whole point of it: it is where a criterion says "this module does not
 *   exist yet". A guard that fired on the document doing the reporting is a guard
 *   someone deletes rather than obeys.
 *
 * What this deliberately is **not** is a list of allowed exceptions. An exception
 * list is a place to put the next `judge.ts` — one line, no argument required,
 * and the check keeps passing while the doc keeps lying. Scope here is two
 * explicit sets (include, exclude) and nothing else, so the only way to make a
 * dangling reference pass is to move the document out of the operator surface,
 * which is a decision a reviewer can see.
 *
 * ## Scope limits stated rather than hidden
 *
 * - Only `src/**\/*.ts` paths and `npm run <script>` invocations are checked —
 *   verbatim, the two forms the criterion names. `test/`, `scripts/`, `dist/` and
 *   bare CLI verbs (`ost-agent check`) are *not* verified here. That is a real
 *   gap, left open on purpose: the criterion defines the check as this grep, and
 *   widening the extractor without widening the criterion would make the test and
 *   the document disagree about what "met" means.
 * - Existence is all that is asserted. A path that exists but no longer contains
 *   what the prose claims still passes; nothing short of a human reading it
 *   catches that. The enumeration of invariants in `evaluating-ost-agent.md` is
 *   the live example: every module it names exists, and only a reader notices if
 *   the list of rules inside one has moved on.
 * - Path existence goes through `fs.existsSync`, which is case-insensitive on
 *   macOS and case-sensitive in CI. A doc that miscapitalises a real module
 *   therefore passes locally and fails on the build — the safe direction of that
 *   asymmetry, but worth knowing before debugging it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The operator-facing surface, exactly as D4 defines it. */
const ROOTS = ["README.md", "docs/reference", "docs/consuming-from-claude-code.md"] as const;

/** Documents whose subject is machinery that is gone. See the header. */
const EXCLUDED = ["docs/superpowers", "docs/reference/v1-readiness.md"] as const;

/**
 * The criterion's grep, transcribed. `src/[A-Za-z0-9/_.-]+\.ts` stops at the
 * extension, so a `file.ts:88` line citation yields the path and drops the line
 * number; `npm run [a-z:-]+` covers this repo's colon-namespaced scripts
 * (`gen:skill`, `test:watch`) and stops before a ` -- --flag` tail.
 */
const REFERENCE_RE = /src\/[A-Za-z0-9/_.-]+\.ts|npm run [a-z:-]+/g;

export interface Reference {
  /** The matched text, e.g. `src/eval/judge.ts` or `npm run bundle`. */
  raw: string;
  /** Repo-relative document it was found in. */
  file: string;
  /** 1-based line, so a failure message can be pasted into an editor. */
  line: number;
}

function excluded(rel: string): boolean {
  return EXCLUDED.some((e) => rel === e || rel.startsWith(`${e}/`));
}

/**
 * Root is a parameter only so the non-vacuity control can point it at a fixture
 * directory. Nothing in the real scan passes anything but `repoRoot`; the seam
 * exists because "reads every file, not only `*.md`" is otherwise unpinnable in a
 * tree that happens to contain only Markdown.
 */
export function walkFrom(root: string, rel: string, out: string[]): void {
  if (excluded(rel)) return;
  const abs = path.join(root, rel);
  // A root that has been renamed must fail loudly. The alternative — skipping a
  // missing root — is the classic vacuous pass: the scan finds nothing, every
  // assertion holds, and no document is being read at all.
  if (!fs.existsSync(abs)) throw new Error(`scanned root ${rel} does not exist`);
  if (fs.statSync(abs).isDirectory()) {
    for (const entry of fs.readdirSync(abs).sort()) walkFrom(root, path.posix.join(rel, entry), out);
    return;
  }
  // Every file under a scanned root, not just `*.md`. The criterion's check is
  // `grep -r` over `docs/reference/`, which does not filter by extension, and an
  // extension filter here would be a narrowing the criterion never granted: drop a
  // `notes.txt` or a `runbook.sh` into `docs/reference/` and the guard would stop
  // reading exactly the file most likely to hold a copy-pasteable command. Today
  // the directory is all Markdown so this changes nothing — which is the moment to
  // fix it, rather than after the first non-Markdown operator file lands.
  out.push(rel);
}

export function scannedDocs(): string[] {
  const out: string[] = [];
  for (const root of ROOTS) walkFrom(repoRoot, root, out);
  return out;
}

/** Pulled out so the non-vacuity control can drive it with a fixture. */
export function extractReferences(text: string, file: string): Reference[] {
  const found: Reference[] = [];
  text.split("\n").forEach((content, i) => {
    for (const m of content.matchAll(REFERENCE_RE)) found.push({ raw: m[0], file, line: i + 1 });
  });
  return found;
}

const scripts = (): Record<string, string> =>
  JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).scripts ?? {};

/** Undefined when the reference resolves; a reason when it does not. */
export function dangling(ref: Reference, definedScripts: Record<string, string>): string | undefined {
  if (ref.raw.startsWith("npm run ")) {
    const script = ref.raw.slice("npm run ".length);
    // `Object.hasOwn`, not `in`. `JSON.parse` hands back an ordinary object, so
    // `"constructor" in scripts` is true for a `scripts` block that defines
    // nothing of the sort — and `constructor` is inside `[a-z:-]+`, so a doc
    // saying `npm run constructor` would be waved through by a guard whose whole
    // job is to fail closed. It is a silly command to document; it is also the
    // exact shape of hole this file exists to refuse.
    return Object.hasOwn(definedScripts, script)
      ? undefined
      : `package.json defines no "${script}" script`;
  }
  return fs.existsSync(path.join(repoRoot, ref.raw)) ? undefined : "no such file on disk";
}

function allReferences(): Reference[] {
  return scannedDocs().flatMap((file) =>
    extractReferences(fs.readFileSync(path.join(repoRoot, file), "utf8"), file),
  );
}

describe("operator-facing docs name only things that exist (D4)", () => {
  /**
   * Non-vacuity, part 1 — the extractor.
   *
   * This repo has shipped three green tests that asserted nothing, so the
   * extractor is exercised against a fixture holding a known-bad and a known-good
   * reference of each kind. A regex that silently matched nothing — the way this
   * check fails open — makes the length assertion fail here before it can make
   * the real scan pass by finding zero references.
   *
   * `src/eval/judge.ts` and the `eval` script are the two references that were
   * actually live in the doc when this test was written; `src/eval/invariants.ts`
   * and `bundle` are their surviving counterparts; `constructor` is the third bad
   * one, present because a membership test written with `in` rather than
   * `Object.hasOwn` reports it as a defined script. Proving the classifier splits
   * that fixture 2 good / 3 bad is what proves the real scan's empty result means
   * "clean" rather than "blind".
   */
  test("the extractor finds both kinds of reference, and the classifier splits good from bad", () => {
    const fixture = [
      "Run `npm run eval` to score a pass, or `npm run bundle` to rebuild.",
      "The judge lives in `src/eval/judge.ts:18` and the invariants in `src/eval/invariants.ts`.",
      // Third row guards the prototype hole: an `in` check calls this one defined.
      "Nor is `npm run constructor` a script, whatever the object prototype says.",
      "Prose with no references at all, which must contribute nothing.",
    ].join("\n");

    const refs = extractReferences(fixture, "fixture.md");
    expect(refs.map((r) => r.raw)).toEqual([
      "npm run eval",
      "npm run bundle",
      "src/eval/judge.ts",
      "src/eval/invariants.ts",
      "npm run constructor",
    ]);
    // The line number has to travel with the match, or a failure cannot be acted on.
    expect(refs.find((r) => r.raw === "src/eval/judge.ts")?.line).toBe(2);

    const defined = scripts();
    const verdicts = refs.map((r) => [r.raw, dangling(r, defined) === undefined] as const);
    expect(verdicts).toEqual([
      ["npm run eval", false],
      ["npm run bundle", true],
      ["src/eval/judge.ts", false],
      ["src/eval/invariants.ts", true],
      ["npm run constructor", false],
    ]);
  });

  /**
   * Non-vacuity, part 2 — the scope. A file the walker never opens is a file this
   * test cannot protect, and the one that carried every D4 failure is named
   * explicitly so that quietly moving it out of `docs/reference/` turns red.
   */
  test("the scan reaches the operator surface and stops at the two archives", () => {
    const docs = scannedDocs();
    for (const surface of [
      "README.md",
      "docs/consuming-from-claude-code.md",
      "docs/reference/evaluating-ost-agent.md",
      "docs/reference/teresa-torres-ost.md",
    ]) {
      expect(docs, `${surface} is not being scanned`).toContain(surface);
    }
    expect(docs).not.toContain("docs/reference/v1-readiness.md");
    expect(docs.some((d) => d.startsWith("docs/superpowers/"))).toBe(false);

    // And the scan has to actually be reading prose: the operator surface names
    // real modules and real scripts today, so zero references means the walker
    // returned filenames it never opened.
    expect(allReferences().length).toBeGreaterThan(0);
  });

  /**
   * Non-vacuity, part 3 — the walker takes every file, not every *Markdown* file.
   *
   * `docs/reference/` is all Markdown today, so an extension filter and no
   * extension filter are observationally identical against the real tree: a
   * regression to `if (rel.endsWith(".md"))` would stay green forever and only
   * surface the day someone lands `docs/reference/runbook.sh` full of commands
   * nobody checks. A fixture directory holding one of each is the only way to
   * make that difference visible now rather than then. It also pins the sort, so
   * failure messages stay in a stable order, and re-checks the exclusion rule on
   * a tree where `docs/superpowers` is not the real archive.
   */
  test("the walker takes every file under a root, not only Markdown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-d4-"));
    try {
      fs.mkdirSync(path.join(dir, "docs", "superpowers"), { recursive: true });
      fs.writeFileSync(path.join(dir, "docs", "guide.md"), "");
      fs.writeFileSync(path.join(dir, "docs", "runbook.sh"), "");
      fs.writeFileSync(path.join(dir, "docs", "superpowers", "archived.md"), "");

      const out: string[] = [];
      walkFrom(dir, "docs", out);
      expect(out).toEqual(["docs/guide.md", "docs/runbook.sh"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("every `src/…` path and `npm run` script named in an operator doc exists", () => {
    const defined = scripts();
    const failures = allReferences()
      .map((ref) => ({ ref, why: dangling(ref, defined) }))
      .filter((r) => r.why !== undefined)
      .map((r) => `${r.ref.file}:${r.ref.line} names \`${r.ref.raw}\` — ${r.why}`);

    expect(failures).toEqual([]);
  });
});
