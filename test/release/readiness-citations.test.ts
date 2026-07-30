/**
 * Every `file:line` citation in the readiness document points at a file that
 * exists, at a line that exists. (V1 readiness, the document's own standard.)
 *
 * `docs/reference/v1-readiness.md` is the bar, and its whole claim to being a
 * bar rather than an opinion is that each criterion names evidence a reader can
 * go look at. A citation into a file that has since been edited is worse than no
 * citation: it reads as verified and sends the reader to the wrong line, which
 * is how B4 came to cite `tools.ts:546` for a tool at `:501`, and how Z5 spent
 * months citing a `spendClass` that had been deleted with the genome.
 *
 * **The scan used to be narrower than the document.** Its first regex required a
 * `src|test|scripts|docs|.github` prefix and an explicit `path:N`, which made
 * four whole citation forms invisible — and a citation a test cannot see is a
 * citation nothing checks:
 *
 * | form | example | why the old scan missed it |
 * |---|---|---|
 * | bare filename | `` `SKILL.md:5` `` | no directory prefix |
 * | carried-forward suffix | `` (`src/x.ts:20`, `:44-58`) `` | no path of its own |
 * | comma list | `` `usage.ts:74,78` `` | second number dropped |
 * | other roots | `` `README.md:9-11` ``, `` `.claude/commands/ost-pass.md:3` `` | prefix not on the list |
 *
 * So the path pattern now has no prefix allowlist at all, the line pattern takes
 * `-` and `,` runs, and a lone `` `:N` `` inherits the last path named on or
 * before it — which is how the document actually reads.
 *
 * **Two resolutions, deliberately.** *Existence* is lenient: a bare `foo.ts` is
 * resolved by unique basename, because the document uses that shorthand inside
 * prose and grep commands and the question there is whether the evidence is
 * real. *Spelling* is strict and gets its own test: a citation a reader cannot
 * paste into an editor has not really named its evidence. `SKILL.md` lives at
 * `.claude/skills/opportunity-solution-tree/SKILL.md`, and only the strict test
 * can say so.
 *
 * **What this still does not catch.** A citation that has drifted to a different
 * line *within* the file — the B4 case was in-bounds and only fell out of
 * reading it. Nor does it decide that the cited line *says* what the criterion
 * claims; nothing short of a human reading it does, and a test that pretended
 * otherwise would be the self-certification Gate B exists to refuse.
 *
 * **A content check was tried and measured out.** The narrowest defensible one —
 * `` `symbol` (`path:lo-hi`) `` must have `symbol` somewhere in that range —
 * matches 8 citations in the document, 7 of them ranged. It finds zero drifts
 * and one false alarm: `` `ALLOWED_TOOL_NAMES` (`src/security/policy.ts:43-44`) ``,
 * where the range is correct and deliberate (it is where `git_commit` and
 * `git_push` sit *inside* the array, which is the claim being made) and the
 * symbol is naturally absent from it. One false alarm in seven, against no true
 * positives, is a gate that would be turned off rather than obeyed — so it is
 * recorded here instead of committed.
 *
 * One known imprecision, stated rather than papered over: the document sometimes
 * writes `` test `:95-98` `` meaning "in the test file named two sentences ago",
 * while the nearest path is a `src/` one. Carrying the nearest path forward
 * attributes those to the wrong file. It is still a bounds check against a real
 * file, and inferring the writer's intent would be guessing; the honest fix is
 * for the document to repeat the path.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DOC = path.join(repoRoot, "docs/reference/v1-readiness.md");

/** A repo-relative-looking path: any number of segments, a known source extension. */
const PATH_RE = String.raw`(?:[A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+\.(?:ts|tsx|js|mjs|md|ya?ml|json)`;
/** `12`, `12-34`, `74,78` — every number in the run is a line the reader is sent to. */
const LINES_RE = String.raw`\d+(?:[-,]\d+)*`;

const FULL_CITATION = new RegExp(`(${PATH_RE}):(${LINES_RE})`, "g");
const BARE_SUFFIX = new RegExp(`^:(${LINES_RE})$`);
const ANY_PATH = new RegExp(PATH_RE, "g");

export interface Citation {
  /** As written, backticks stripped — what a failure message has to show. */
  raw: string;
  /** 1-based line in the readiness document, so a failure says where to edit. */
  docLine: number;
  /** The path as written, or the inherited one for a bare `:N`. */
  written: string;
  /** True when the path was carried forward rather than written at the citation. */
  inherited: boolean;
  lines: number[];
}

/** Inline code spans in document order — the document's own citation delimiter. */
function codeSpans(markdown: string): Array<{ docLine: number; text: string }> {
  const out: Array<{ docLine: number; text: string }> = [];
  markdown.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/`([^`]+)`/g)) out.push({ docLine: i + 1, text: m[1] });
  });
  return out;
}

/**
 * Pure over its input so the tripwire below can exercise all four forms against
 * a fixture instead of against whatever the document happens to contain today.
 */
export function extractCitations(markdown: string): Citation[] {
  const out: Citation[] = [];
  let lastPath: string | null = null;
  for (const span of codeSpans(markdown)) {
    const full = [...span.text.matchAll(FULL_CITATION)];
    for (const m of full) {
      lastPath = m[1];
      out.push({
        raw: `${m[1]}:${m[2]}`,
        docLine: span.docLine,
        written: m[1],
        inherited: false,
        lines: m[2].split(/[-,]/).map(Number),
      });
    }
    const bare = span.text.match(BARE_SUFFIX);
    if (bare && lastPath !== null) {
      out.push({
        raw: `:${bare[1]}`,
        docLine: span.docLine,
        written: lastPath,
        inherited: true,
        lines: bare[1].split(/[-,]/).map(Number),
      });
      continue;
    }
    // A path named without line numbers still sets the antecedent — the document
    // writes ``grep … web-trust.ts`` and then `:35-42`.
    if (full.length === 0) {
      const paths = [...span.text.matchAll(ANY_PATH)];
      if (paths.length > 0) lastPath = paths[paths.length - 1][0];
    }
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "coverage") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(path.relative(repoRoot, p));
  }
  return out;
}

const REPO_FILES = walk(repoRoot);
const BY_BASENAME = new Map<string, string[]>();
for (const f of REPO_FILES) {
  const base = path.basename(f);
  BY_BASENAME.set(base, [...(BY_BASENAME.get(base) ?? []), f]);
}

/** Exactly as written, from the repo root — the spelling a reader can paste. */
function resolvesStrictly(written: string): boolean {
  return REPO_FILES.includes(written);
}

/** Lenient: as written, else the one file in the repo with that basename. */
function resolveLeniently(written: string): string | null {
  if (resolvesStrictly(written)) return written;
  if (written.includes("/")) return null;
  const matches = BY_BASENAME.get(written) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

const LINE_COUNTS = new Map<string, number>();
function lineCount(rel: string): number {
  if (!LINE_COUNTS.has(rel)) LINE_COUNTS.set(rel, fs.readFileSync(path.join(repoRoot, rel), "utf8").split("\n").length);
  return LINE_COUNTS.get(rel)!;
}

const citations = () => extractCitations(fs.readFileSync(DOC, "utf8"));
const where = (c: Citation) => `${DOC.replace(`${repoRoot}/`, "")}:${c.docLine} cites \`${c.raw}\``;

describe("the citation scanner", () => {
  // The previous version of this file was green on 22 real drifts because its
  // regex could not see them. A scanner that silently narrows is the failure
  // mode, so all four forms are pinned against a fixture rather than against the
  // document — the document is allowed to stop using one of them.
  test("reads all four forms the document writes", () => {
    const fixture = [
      "prose (`src/a/one.ts:10-12`) and a bare name (`two.md:3`),",
      "a comma run (`src/a/one.ts:74,78`), then a carried suffix (`:99`).",
      "a path with no numbers (`grep -n x src/b/three.ts`) then (`:7`).",
      "not a citation: (`INBOX:note.md`) or (`ost_set_evidence`).",
    ].join("\n");
    expect(extractCitations(fixture).map((c) => `${c.written}:${c.lines.join(",")}`)).toEqual([
      "src/a/one.ts:10,12",
      "two.md:3",
      "src/a/one.ts:74,78",
      "src/a/one.ts:99",
      "src/b/three.ts:7",
    ]);
  });

  test("finds citations in the document, in every form it uses", () => {
    const found = citations();
    expect(found.length).toBeGreaterThan(50);
    // Tripwire on the widening itself: if inherited suffixes ever stop being
    // found, the scan has silently narrowed back to where it started.
    expect(found.filter((c) => c.inherited).length).toBeGreaterThan(5);
  });
});

describe("the readiness document's file:line evidence", () => {
  test("every cited file exists", () => {
    const missing = citations()
      .filter((c) => resolveLeniently(c.written) === null)
      .map((c) => where(c));
    expect([...new Set(missing)]).toEqual([]);
  });

  test("every citation is spelled as a path from the repo root", () => {
    // Lenient resolution is for reading the document; this is for using it. A
    // citation that only resolves by basename search sends the reader hunting.
    const unpasteable = citations()
      .filter((c) => !c.inherited && !resolvesStrictly(c.written))
      .map((c) => {
        const actual = resolveLeniently(c.written);
        return `${where(c)} — ${actual ? `the file is at \`${actual}\`` : "no such file"}`;
      });
    expect([...new Set(unpasteable)]).toEqual([]);
  });

  test("every cited line is within its file", () => {
    const outOfBounds: string[] = [];
    for (const c of citations()) {
      const rel = resolveLeniently(c.written);
      if (rel === null) continue; // reported by the test above
      const lines = lineCount(rel);
      const over = c.lines.filter((n) => n > lines);
      if (over.length > 0) outOfBounds.push(`${where(c)} — ${rel} has ${lines} lines`);
    }
    expect([...new Set(outOfBounds)]).toEqual([]);
  });
});
