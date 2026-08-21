/**
 * The workspace-map coverage census: does a map small enough to carry into every
 * session answer the path lookups this product's own passes actually failed?
 *
 * The solution under test is "Hand the run a layout of the workspace before it takes
 * its first action" — render a compact map of what is here and give it to the run
 * before it does anything, so it stops guessing at paths and being told they are not
 * there. The node fixed the bar before anything was counted, and it is TWO clauses in
 * one command on purpose: a rendered map that **serializes under 2,000 characters**
 * must answer **at least 70%** of the workspace path-lookups that failed. Both at
 * once — a map big enough to answer everything is too large to carry, and one small
 * enough to carry omits the thing being looked for.
 *
 * ## This command being green does not mean the assumption held
 *
 * It came out **refuted**: 16 of 25, 64%, against a bar of 70. The command is green
 * because the count has been taken and pinned — the same convention
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/runner/shell-necessity-census.test.ts` run under, both of which pin a refuted
 * census. Whoever reads this exit code must read {@link census.meetsBar} with it,
 * which is why it is asserted `false` by name below rather than left to be inferred.
 *
 * The shortfall is not noise: every unanswered lookup but three is a probe for a
 * specific leaf FILE (`test/loop/…​.test.ts`), and the map answers "which directories
 * are here", not "which files". Listing the test leaves that would answer them takes
 * the map well past its own 2,000-character budget — the two clauses genuinely
 * conflict on this corpus, which is exactly the squeeze the node named as what would
 * make this the wrong pick. The map cleanly serves the workspace-ROOT and
 * repo-BOUNDARY confusions the opportunity actually documented (`~/dev/ost-agent-meta`
 * vs `~/ost-agent-meta`, which vaults exist, is this a repository); the leaf-file
 * probes are a different failure class the parent opportunity itself distinguishes.
 *
 * The rule is `WORKSPACE_MAP_RULE`, committed in `src/runner/workspace-map.ts` before
 * the corpus was counted, and the corpus is frozen in `test/fixtures/workspace-map/`
 * (see its `PROVENANCE.md` for the cut and every exclusion). This test asserts the
 * shape of the rule as well as its output, so a later edit shows up here as a changed
 * expectation rather than as a quietly different finding.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  defaultWorkspaceSections,
  deepestExistingDir,
  formatWorkspaceMapCensus,
  renderWorkspaceMap,
  workspaceMapCoverage,
  WORKSPACE_MAP_RULE,
  type Layout,
  type WorkspacePathLookup,
} from "../../src/runner/workspace-map.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "workspace-map");

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the two clauses are the ones the node fixed: a 2,000-char budget and a 70% bar", () => {
    expect(WORKSPACE_MAP_RULE.maxChars).toBe(2000);
    expect(WORKSPACE_MAP_RULE.bar).toBe(0.7);
  });
});

// ── the renderer: a map of directories, dropped whole when the budget is tight ──

/** A small hand-built layout: a home holding one repo, whose src has two subdirs and a file. */
function toyLayout(): Layout {
  return {
    home: "/h",
    dirs: {
      "/h": ["repo", "notes.txt"],
      "/h/repo": ["src", "README.md"],
      "/h/repo/src": ["cli", "core", "index.ts"],
      "/h/repo/src/cli": [],
      "/h/repo/src/core": [],
    },
  };
}

describe("the map lists directories, not every file", () => {
  test("a section line names child directories and counts the files beside them", () => {
    const map = renderWorkspaceMap(toyLayout(), [{ dir: "/h/repo/src", label: "src" }]);
    expect(map.text).toContain("src ~/repo/src/: cli core (+1 file)");
    expect(map.covered).toEqual(["/h/repo/src"]);
    expect(map.omitted).toEqual([]);
  });

  test("a leaf directory with no subdirectories says so rather than rendering blank", () => {
    const map = renderWorkspaceMap(toyLayout(), [{ dir: "/h/repo/src/cli", label: "cli" }]);
    expect(map.text).toContain("cli ~/repo/src/cli/: (no subdirectories)");
  });

  test("a section is rendered whole or dropped whole, and the drop is reported", () => {
    // A budget that fits the header and the first section but not the second: the
    // second is omitted entire, never half-listed, because a half-list reads as a
    // complete one and would answer a lookup wrongly.
    const layout = toyLayout();
    const sections = [
      { dir: "/h", label: "home" },
      { dir: "/h/repo", label: "repo" },
    ];
    const full = renderWorkspaceMap(layout, sections);
    const tight = renderWorkspaceMap(layout, sections, { maxChars: full.text.indexOf("repo ~/repo") });
    expect(tight.covered).toEqual(["/h"]);
    expect(tight.omitted.map((s) => s.label)).toEqual(["repo"]);
    expect(tight.text).not.toContain("repo ~/repo/:");
  });

  test("a section naming a directory the layout does not hold is omitted, not invented", () => {
    const map = renderWorkspaceMap(toyLayout(), [{ dir: "/h/nope", label: "nope" }]);
    expect(map.covered).toEqual([]);
    expect(map.omitted.map((s) => s.dir)).toEqual(["/h/nope"]);
  });
});

// ── the coverage predicate: fires when the neighbourhood is covered, not otherwise ──

describe("deepestExistingDir walks up to the nearest real directory", () => {
  test("a guessed file resolves to the directory that would have shown it absent", () => {
    // `/h/repo/src/nope.ts` does not exist; its nearest real directory is `src`,
    // whose child list is exactly what a run needed to see.
    expect(deepestExistingDir("/h/repo/src/nope.ts", toyLayout())).toBe("/h/repo/src");
  });

  test("a directory that exists resolves to itself, trailing slash and all", () => {
    expect(deepestExistingDir("/h/repo/", toyLayout())).toBe("/h/repo");
  });
});

describe("a lookup is answered only when the map covers its neighbourhood", () => {
  const layout = toyLayout();
  const map = renderWorkspaceMap(layout, [{ dir: "/h/repo/src", label: "src" }]);

  test("a guess whose nearest real directory the map lists is answered", () => {
    // The map covers `/h/repo/src`, so a guess for a missing file under it is answered.
    const lookups: WorkspacePathLookup[] = [{ subject: "src/nope.ts", absolute: "/h/repo/src/nope.ts", session: "s" }];
    const census = workspaceMapCoverage(map, layout, lookups);
    expect(census.answered).toBe(1);
    expect(census.share).toBe(1);
  });

  test("a guess whose nearest real directory the map does NOT list is not answered", () => {
    // `/h/repo/src/cli` exists but the map did not render it (only `/h/repo/src`),
    // so a probe for a file under `cli` is left unanswered — the map came close and
    // still would not have saved the call.
    const lookups: WorkspacePathLookup[] = [{ subject: "cli/x.ts", absolute: "/h/repo/src/cli/x.ts", session: "s" }];
    const census = workspaceMapCoverage(map, layout, lookups);
    expect(census.answered).toBe(0);
    expect(census.unanswered[0].needed).toBe("/h/repo/src/cli");
  });

  test("meetsBar joins the two clauses: over budget fails even at full coverage", () => {
    const lookups: WorkspacePathLookup[] = [{ subject: "src/nope.ts", absolute: "/h/repo/src/nope.ts", session: "s" }];
    // Force the rendered map over a tiny budget after the fact: coverage is 100%, but
    // the size clause is not met, so the census must not clear the bar.
    const over = { ...map, text: "x".repeat(WORKSPACE_MAP_RULE.maxChars + 1) };
    const census = workspaceMapCoverage(over, layout, lookups);
    expect(census.share).toBe(1);
    expect(census.withinBudget).toBe(false);
    expect(census.meetsBar).toBe(false);
  });
});

// ── the census over the committed corpus ─────────────────────────────────────

function committed(): { layout: Layout; lookups: WorkspacePathLookup[]; meta: Record<string, unknown> } {
  const layout = JSON.parse(fs.readFileSync(path.join(fixtureDir, "layout.json"), "utf8")) as Layout;
  const lookups = JSON.parse(fs.readFileSync(path.join(fixtureDir, "lookups.json"), "utf8")) as WorkspacePathLookup[];
  const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, unknown>;
  return { layout, lookups, meta };
}

describe("the census over the committed corpus", () => {
  const { layout, lookups, meta } = committed();
  const map = renderWorkspaceMap(layout, defaultWorkspaceSections(layout.home));
  const census = workspaceMapCoverage(map, layout, lookups);

  test("the corpus is the size PROVENANCE.md says it is", () => {
    // The upstream cut is the path-failure-attribution fixture's 76 path-shaped
    // failures; this corpus is the workspace subset of them.
    expect(meta.pathShaped).toBe(76);
    expect(meta.workspaceLookups).toBe(25);
    expect(lookups).toHaveLength(25);
    expect(meta.excluded).toEqual({
      "not-a-path": 16,
      unnamed: 11,
      "cwd-unknown": 2,
      ephemeral: 10,
      "foreign-project": 8,
      "outside-territory": 4,
    });
    // The exclusions and the survivors partition the 76 path-shaped failures exactly.
    const excluded = Object.values(meta.excluded as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(excluded + (meta.workspaceLookups as number)).toBe(76);
  });

  test("the whole map fits under the 2,000-character budget", () => {
    // Both the number and the clause, so a later layout that bloats the map trips
    // here rather than silently passing an over-budget map to a session.
    expect(census.sizeChars).toBe(1619);
    expect(census.withinBudget).toBe(true);
    expect(map.omitted).toEqual([]);
  });

  test("THE ASSUMPTION IS REFUTED — 64% against a pre-committed 70% bar", () => {
    // Read this with the exit code. The command is green because the count has been
    // taken; the count says a sub-2,000-character map does not answer 70% of the
    // workspace path-lookups this product's passes suffered.
    expect(census.answered).toBe(16);
    expect(census.total).toBe(25);
    expect(census.share).toBe(16 / 25);
    expect(census.meetsBar).toBe(false);
    expect(formatWorkspaceMapCensus(census)).toContain("REFUTED");
  });

  test("the shortfall is leaf-file probes, not the root confusions the map was built for", () => {
    // Nine unanswered; six name a specific `.test.ts` file inside a directory the map
    // already lists (test/loop, test/ost, test/mcp, test/cli) — the class a DIRECTORY
    // map cannot serve. The other three are single deep paths (`.ost-agent/state`,
    // `docs/reference`, `Library/Logs`). The map answers the workspace-root and
    // repo-boundary probes it was built for: not one unanswered lookup is a
    // vault-location or repo-boundary guess, which are all in the answered 16.
    const leafProbes = census.unanswered.filter((u) => /\.test\.ts$/.test(u.subject));
    expect(leafProbes.length).toBe(6);
    expect(census.unanswered).toHaveLength(9);
    // Every unanswered lookup needs a directory DEEPER than the map's stable skeleton.
    for (const u of census.unanswered) {
      expect(map.covered).not.toContain(u.needed);
    }
  });

  test("the report leads with the map's size and coverage and says the verdict in words", () => {
    const report = formatWorkspaceMapCensus(census);
    expect(report).toContain("1619 char(s)");
    expect(report).toContain("64%");
    expect(report).toContain("against a pre-committed bar of 70%");
  });
});
