/**
 * The path-root coverage census: of the paths this machine's runs actually got
 * wrong, how many fall inside a handful of names a run could have been handed?
 *
 * The solution under test is "Resolve every path against a declared root, so a
 * wrong prefix cannot be constructed" — hand the run the project, the vault and
 * the logs by name, and let it ask for the vault's inbox instead of for a string
 * beginning `/Users/tanner/`. Its assumption test fixed the bar and the vocabulary
 * together before anyone counted: **at least 80% of failed paths fall under 4 or
 * fewer named roots**, because anything outside the named roots is constructed by
 * hand exactly as before, so the coverage share *is* the value of the approach.
 *
 * ## The answer depends entirely on how the question is read, and this file says so
 *
 * Sixteen recounts, and five of them clear the bar. Every single one that does is
 * carried by one of two circularities, which is asserted below as a property of
 * the whole reading set rather than argued in prose:
 *
 *  - **`home` contains everything.** On a single-operator machine every path worth
 *    having begins `/Users/tanner`, so counting `home` as a root scores 95.4% while
 *    preventing nothing — `~/dev/ost-agent-meta` and `~/ost-agent-meta` are both
 *    under it, and that pair *is* the mistake the solution exists to stop.
 *  - **A relative path has no head to get wrong.** 96 of the 131 failed paths were
 *    written relative, and under a project root derived from the working directory
 *    they resolve against, all 96 are covered *by construction* — 96/96, asserted
 *    below. The solution prevents a wrong prefix; a path with no prefix was never
 *    exposed to it.
 *
 * Strip both and the count is **40.0% — 14 of the 35 failures that carry a head at
 * all**, against a bar of 80%. That is the headline this census reports, and
 * `census.meetsBar` is `false`.
 *
 * ## The number that actually decides the row is smaller still
 *
 * Coverage measures territory, and the mechanism prevents head errors, and those
 * are not the same thing — they point opposite ways. A failure that lands *inside*
 * a declared root is one whose prefix was already right, so a root would have
 * supplied exactly what the caller already had: `src/ost/set-outcome.ts` for
 * `src/runner/set-outcome.ts` is wrong in the middle, under a root that was never
 * in doubt. So this census also counts the class the solution really prevents — a
 * failed path whose tail was reached successfully from under a different head —
 * and finds **1 of 35** on a two-segment tail, **10 of 35** on the single-segment
 * tail that also admits bare-filename coincidences across five repositories. The
 * true number is inside that bracket; the node's own example
 * (`/Users/tanner/dev/ost-agent-meta` for `/Users/tanner/ost-agent-meta`) is in the
 * corpus exactly once, and it is one of the ten.
 *
 * ## The control that makes the number readable
 *
 * The assumption test asked for coverage over the successes too, and it is what
 * catches a vocabulary that merely describes where the work happens. It comes out
 * the wrong way round for the solution: the roots cover **68.2%** of the paths that
 * worked and **40.0%** of the paths that failed. Failures are not concentrated in
 * the named territory — they are concentrated outside it, in per-session
 * scratchpads (`/private/tmp/claude-501/<project>/<uuid>/scratchpad/…`), in other
 * repositories' worktrees, and in `/usr/local/bin`.
 *
 * ## This command being green does not mean the assumption held
 *
 * It is green because the count has been taken and pinned — the convention
 * `test/friction/path-guess-hit-rate.test.ts`, `test/friction/path-failure-attribution.test.ts`
 * and `test/loop/replayable-step-share.test.ts` all run under, each of whose
 * censuses also came out short and whose nodes are still `#unvalidated`. Whoever
 * reads this exit code must read `census.meetsBar` with it, which is why it is
 * asserted `false` by name below, beside `census.literalMeetsBar` — `true` — so
 * that the one reading under which the node's own wording passes is on the record
 * rather than suppressed.
 *
 * See `test/fixtures/path-root-coverage/PROVENANCE.md` before believing anything
 * here.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  coverageUnder,
  declareRoots,
  effectiveCwd,
  formatPathRootCensus,
  hasConstructedHead,
  headErrorCount,
  isUnder,
  OPERATOR_LAYOUT,
  PATH_ROOT_RULE,
  pathRootCoverage,
  projectRootFor,
  readAddressedPaths,
  readingOf,
  readsAsPath,
  resolveAddressed,
  resolveUnderRoot,
  RootError,
  rootContaining,
  ROOT_NAMES,
  vocabularyFor,
  type AddressedPath,
  type AddressedRecord,
  type FailedPath,
} from "../../src/runner/path-roots.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(here, "../fixtures/path-root-coverage");
const srcPath = path.join(here, "../../src/runner/path-roots.ts");

describe("the vocabulary was fixed before the corpus was read", () => {
  const ruleSource = fs.readFileSync(srcPath, "utf8");

  test("the rule module opens no file", () => {
    // The structural half of the guarantee: a vocabulary chosen after seeing which
    // prefixes failed scores against the sample it was fitted to and looks
    // identical to one that was not. This module cannot have seen the corpus,
    // because it has no way to open it. The other half is the commit order, which
    // PROVENANCE.md records.
    expect(ruleSource).not.toMatch(/from "node:fs"/);
    expect(ruleSource).not.toContain("fixtures");
  });

  test("it names the four roots the node named, and no more", () => {
    expect([...ROOT_NAMES]).toEqual(["project", "vault", "logs", "home"]);
    expect(ROOT_NAMES.length).toBeLessThanOrEqual(PATH_ROOT_RULE.maxRoots);
    expect(PATH_ROOT_RULE.bar).toBe(0.8);
  });

  test("a fifth name is refused rather than quietly accepted", () => {
    expect(() =>
      declareRoots({ project: "/a", vault: "/b", logs: "/c", home: "/d", scratch: "/e" }),
    ).toThrow(RootError);
    expect(() => declareRoots({ scratch: "/e" })).toThrow(/no root is called "scratch"/);
  });
});

describe("resolveUnderRoot is the mechanism, not a description of it", () => {
  const vocab = declareRoots({
    project: "/Users/tanner/dev/OST-Agent",
    vault: "/Users/tanner/ost-agent-meta",
    logs: "/Users/tanner/Library/Logs",
    home: "/Users/tanner",
  });

  test("a tail under a name resolves to the head the caller never wrote", () => {
    expect(resolveUnderRoot(vocab, "vault", ".ost-agent/inbox")).toBe(
      "/Users/tanner/ost-agent-meta/.ost-agent/inbox",
    );
    expect(resolveUnderRoot(vocab, "project", "src/runner/set-outcome.ts")).toBe(
      "/Users/tanner/dev/OST-Agent/src/runner/set-outcome.ts",
    );
  });

  test("the prefix error the node names cannot be constructed", () => {
    // `/Users/tanner/dev/ost-agent-meta` for `/Users/tanner/ost-agent-meta` is in
    // the corpus. Through a root there is no spelling of it: the tail is asked for
    // by name and the head arrives correct or not at all.
    expect(resolveUnderRoot(vocab, "vault", "src")).toBe("/Users/tanner/ost-agent-meta/src");
    expect(() => resolveUnderRoot(vocab, "vault", "/Users/tanner/dev/ost-agent-meta/src")).toThrow(
      /already carries a head/,
    );
  });

  test("an unknown name, an absolute tail and an escaping tail are three refusals", () => {
    const refusalOf = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return (e as RootError).refusal;
      }
      return "none";
    };
    expect(refusalOf(() => resolveUnderRoot(vocab, "scratch", "x"))).toBe("unknown-root");
    expect(refusalOf(() => resolveUnderRoot(vocab, "vault", "/etc/passwd"))).toBe("absolute-tail");
    expect(refusalOf(() => resolveUnderRoot(vocab, "vault", "~/secrets"))).toBe("absolute-tail");
    expect(refusalOf(() => resolveUnderRoot(vocab, "vault", "../dev/OST-Agent"))).toBe("escapes-root");
    expect(refusalOf(() => resolveUnderRoot(vocab, "vault", "a/../../elsewhere"))).toBe("escapes-root");
  });

  test("a `..` that stays inside its root is allowed, because it addresses the root", () => {
    expect(resolveUnderRoot(vocab, "project", "src/../test")).toBe("/Users/tanner/dev/OST-Agent/test");
  });

  test("containment is segment-wise, so a sibling with a shared prefix is not inside", () => {
    expect(isUnder("/a/b", "/a/b/c")).toBe(true);
    expect(isUnder("/a/b", "/a/b")).toBe(true);
    expect(isUnder("/a/b", "/a/bc")).toBe(false);
  });

  test("the deepest root wins, so a container never absorbs a named place", () => {
    expect(rootContaining(vocab, "/Users/tanner/ost-agent-meta/.ost-agent", "with-home")).toBe("vault");
    expect(rootContaining(vocab, "/Users/tanner/Desktop/notes.md", "with-home")).toBe("home");
    expect(rootContaining(vocab, "/Users/tanner/Desktop/notes.md", "specific")).toBe(null);
    expect(rootContaining(vocab, "/private/tmp/scratch/x", "with-home")).toBe(null);
  });
});

describe("reading the record", () => {
  test("a project is read off the directory a session was launched in", () => {
    expect(projectRootFor("/Users/tanner/dev/pentagram/.claude/worktrees/chaos-ui")).toBe(
      "/Users/tanner/dev/pentagram",
    );
    expect(projectRootFor("/Users/tanner/dev/OST-Agent")).toBe("/Users/tanner/dev/OST-Agent");
    // A session launched outside any project container is its own project. This is
    // the build loop's own shape — cwd is the vault, and the work is in the
    // repository — and it is why `per-session` and `fixed` are both counted.
    expect(projectRootFor("/Users/tanner/ost-agent-meta")).toBe("/Users/tanner/ost-agent-meta");
    expect(vocabularyFor("/Users/tanner/ost-agent-meta", "fixed").project).toBe(OPERATOR_LAYOUT.project);
  });

  test("a command that opens with `cd` ran somewhere other than the session's directory", () => {
    expect(effectiveCwd("/Users/tanner/ost-agent-meta", "cd /Users/tanner/dev/OST-Agent && npx vitest run")).toBe(
      "/Users/tanner/dev/OST-Agent",
    );
    expect(effectiveCwd("/Users/tanner/dev/OST-Agent", "cd test/runner; ls")).toBe(
      "/Users/tanner/dev/OST-Agent/test/runner",
    );
    expect(effectiveCwd("/repo", 'cd "/Users/tanner/a b" && ls')).toBe("/Users/tanner/a b");
    expect(effectiveCwd("/repo", "cd ~/ost-agent-meta && ls")).toBe("/Users/tanner/ost-agent-meta");
  });

  test("a `cd` that is not at the head of the command is not honoured", () => {
    // It changes the directory for part of the command only, and guessing which
    // part would put paths in the corpus that no run ever addressed.
    expect(effectiveCwd("/repo", "ls && cd /elsewhere && ls")).toBe("/repo");
    expect(effectiveCwd("/repo", "git status")).toBe("/repo");
    expect(effectiveCwd("/repo", "")).toBe("/repo");
  });

  test("an assignment word is not an address", () => {
    // Found by reading this census's own first-cut output: `D=/private/tmp/x` was
    // being resolved against the working directory and manufacturing a location no
    // run ever addressed, which then read back as a head error.
    expect(readsAsPath("D=/private/tmp/scratch")).toBe(false);
    expect(readsAsPath("--include=*.ts")).toBe(false);
    expect(readsAsPath("ENOENT")).toBe(false);
    expect(readsAsPath("src/runner/path-roots.ts")).toBe(true);
    expect(readsAsPath("/Users/tanner/ost-agent-meta")).toBe(true);
    expect(readsAsPath("notes.md")).toBe(true);
  });

  test("a relative path is unresolvable as written and resolvable against the record", () => {
    expect(resolveAddressed("test/x.ts", "/repo", "as-written")).toBe(null);
    expect(resolveAddressed("test/x.ts", "/repo", "recorded-cwd")).toBe("/repo/test/x.ts");
    expect(resolveAddressed("/abs/x.ts", "", "as-written")).toBe("/abs/x.ts");
  });
});

describe("the reader, against the real record", () => {
  const slice = (id: string): AddressedRecord =>
    readAddressedPaths([{ id, jsonl: fs.readFileSync(path.join(fixtureDir, `${id}.jsonl`), "utf8") }]);

  test("it lifts the canonical prefix error out of a raw transcript", () => {
    const record = slice("0d27cebf-9b5d-4cff-906c-0134512573bc");
    expect(record.failures.map((f) => f.addressed)).toContain("/Users/tanner/dev/ost-agent-meta");
    const canonical = record.failures.find((f) => f.addressed === "/Users/tanner/dev/ost-agent-meta")!;
    expect(canonical.cls).toBe("missing-path");
    expect(canonical.cwd).toBe("/Users/tanner/dev/OST-Agent");
    expect(record.successes.length).toBeGreaterThan(0);
  });

  test("it lifts a two-root run: the session sits in the vault and the work is in the repository", () => {
    // The build loop's own shape, and the case no derivation from a working
    // directory can serve — this run needs `project` and `vault` bound to two
    // different places, which is exactly what the solution proposes handing it.
    const record = slice("0555db5d-cab6-4293-868f-48c1ef8eb1fa");
    const failure = record.failures[0];
    expect(failure.cwd).toBe("/Users/tanner/ost-agent-meta");
    expect(failure.addressed).toBe("/Users/tanner/dev/OST-Agent/test/adapters/source-attribution.test.ts");
    expect(rootContaining(vocabularyFor(failure.cwd, "per-session"), failure.addressed, "specific")).toBe(null);
    expect(rootContaining(vocabularyFor(failure.cwd, "fixed"), failure.addressed, "specific")).toBe("project");
    // And its `cd`-prefixed commands ran in the repository, not in the vault.
    expect(record.cdAdjusted).toBeGreaterThan(0);
    expect(record.successes.some((s) => s.cwd === OPERATOR_LAYOUT.project)).toBe(true);
  });
});

describe("the census can tell a covered corpus from an uncovered one", () => {
  // A census that answered "covered" to everything would satisfy every assertion
  // about a corpus that came out high, and one that answered "outside" to
  // everything would satisfy every assertion about one that came out low. Both
  // directions run here, on synthetic corpora, before the real number is read.
  const at = (cwd: string, addressed: string): AddressedPath => ({ session: "s", cwd, tool: "Bash", addressed });

  test("paths inside the named roots come out at 100%", () => {
    const inside = [
      at("/Users/tanner/dev/OST-Agent", "/Users/tanner/dev/OST-Agent/src/index.ts"),
      at("/Users/tanner/dev/OST-Agent", "/Users/tanner/ost-agent-meta/.ost-agent/inbox"),
      at("/Users/tanner/dev/OST-Agent", "/Users/tanner/Library/Logs/ost-meta-loop.log"),
    ];
    const reading = coverageUnder(inside, "specific", "recorded-cwd", "per-session", "constructed-head");
    expect(reading).toMatchObject({ covered: 3, outside: 0, share: 1, meetsBar: true });
    expect(reading.byRoot).toEqual({ project: 1, vault: 1, logs: 1, home: 0 });
  });

  test("paths outside them come out at 0%, home included", () => {
    const outside = [
      at("/Users/tanner/dev/OST-Agent", "/private/tmp/claude-501/-Users-tanner-dev-x/abc/scratchpad/a.png"),
      at("/Users/tanner/dev/OST-Agent", "/usr/local/bin/cargo"),
    ];
    for (const containment of PATH_ROOT_RULE.containments) {
      const reading = coverageUnder(outside, containment, "recorded-cwd", "per-session", "constructed-head");
      expect(reading).toMatchObject({ covered: 0, outside: 2, share: 0, meetsBar: false });
    }
  });

  test("home flips a corpus that no specific root reaches", () => {
    const underHomeOnly = [at("/Users/tanner/dev/OST-Agent", "/Users/tanner/Desktop/notes.md")];
    expect(coverageUnder(underHomeOnly, "specific", "recorded-cwd", "per-session", "constructed-head").share).toBe(0);
    expect(coverageUnder(underHomeOnly, "with-home", "recorded-cwd", "per-session", "constructed-head").share).toBe(1);
  });

  test("a head error is counted only when the same tail was reached from another head", () => {
    const failures = [
      at("/Users/tanner/dev/OST-Agent", "/Users/tanner/dev/ost-agent-meta/.ost-agent/inbox"),
      at("/Users/tanner/dev/OST-Agent", "/Users/tanner/dev/OST-Agent/src/nowhere/gone.ts"),
    ];
    const successes = [at("/Users/tanner/dev/OST-Agent", "/Users/tanner/ost-agent-meta/.ost-agent/inbox")];
    const count = headErrorCount(failures, successes);
    expect(count).toMatchObject({ constructedHeads: 2, headErrors: 1 });
    expect(count.examples[0]).toContain("/Users/tanner/dev/ost-agent-meta/.ost-agent/inbox");
    // A tail nothing reached successfully is not a head error, however wrong it is.
    expect(headErrorCount([failures[1]], successes).headErrors).toBe(0);
  });
});

// ── the count over the real corpus ───────────────────────────────────────────

const failures: FailedPath[] = fs
  .readFileSync(path.join(fixtureDir, "failures.jsonl"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as FailedPath);
const successes: AddressedPath[] = zlib
  .gunzipSync(fs.readFileSync(path.join(fixtureDir, "successes.jsonl.gz")))
  .toString("utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as AddressedPath);
const meta = JSON.parse(fs.readFileSync(path.join(fixtureDir, "corpus.json"), "utf8")) as Record<string, number>;
const census = pathRootCoverage({
  failures,
  successes,
  sessions: meta.sessionsRead,
  calls: meta.calls,
  errors: meta.errors,
  unnamed: meta.unnamed,
  notAPath: meta.notAPath,
  deniedPaths: meta.deniedPaths,
  cdAdjusted: meta.cdAdjusted,
});

describe("the corpus is what its provenance says it is", () => {
  test("every failed path and every successful one is here", () => {
    expect(failures.length).toBe(meta.failedPaths);
    expect(successes.length).toBe(meta.successPaths);
    expect(failures.length).toBe(131);
    expect(successes.length).toBe(66366);
    expect(meta.sessionsRead).toBe(1219);
    expect(meta.calls).toBe(60707);
  });

  test("the session that cut it is excluded from it", () => {
    expect(meta.excludedSessions as unknown as string[]).toEqual(["5eb77dd5-30f7-4c49-9ce6-9a714a0c28c6"]);
    expect(failures.some((f) => f.session === "5eb77dd5-30f7-4c49-9ce6-9a714a0c28c6")).toBe(false);
  });

  test("every failing call carried a working directory", () => {
    // The field the whole census turns on. If a future re-cut finds failures
    // without one, the resolution reading stops being a recount and starts being a
    // guess.
    expect(meta.failuresWithoutCwd).toBe(0);
    expect(failures.every((f) => f.cwd.startsWith("/"))).toBe(true);
  });

  test("a quarter of all calls ran somewhere other than the session's directory", () => {
    // 14,493 of 60,707. Without honouring the leading `cd`, every relative path in
    // those calls resolves into the wrong repository — which manufactures wrong
    // prefixes and then reads them back as evidence for the solution.
    expect(meta.cdAdjusted).toBe(14493);
    expect(meta.cdAdjusted / meta.calls).toBeGreaterThan(0.2);
  });

  test("what the read could not use is counted rather than dropped in silence", () => {
    expect(meta.unnamed).toBe(52);
    expect(meta.notAPath).toBe(38);
    expect(meta.deniedPaths).toBe(0);
  });
});

describe("THE READINGS DISAGREE, AND EVERY ONE THAT PASSES IS CIRCULAR", () => {
  test("read literally — all four names, every failed path — the node's bar is cleared", () => {
    expect(census.literal).toMatchObject({ covered: 125, total: 131, meetsBar: true });
    expect(census.literal.share).toBeGreaterThan(0.95);
    expect(census.literalMeetsBar).toBe(true);
  });

  test("read where a root does work, it is missed by half", () => {
    expect(census.headline).toMatchObject({ covered: 14, total: 35, outside: 21, meetsBar: false });
    expect(census.headline.share).toBeCloseTo(0.4, 3);
    expect(census.meetsBar).toBe(false);
    expect(census.readingDecides).toBe(true);
  });

  test("every reading that clears the bar counts home, or counts relative paths as covered", () => {
    // The finding, stated as a property of all sixteen recounts rather than as an
    // argument about the two this file happens to name.
    for (const reading of census.failures) {
      if (!reading.meetsBar) continue;
      const countsHome = reading.containment === "with-home";
      const countsRelative = reading.population === "all" && reading.resolution === "recorded-cwd";
      expect(countsHome || countsRelative).toBe(true);
    }
    // And no reading free of both clears it.
    for (const reading of census.failures) {
      if (reading.containment === "specific" && reading.population === "constructed-head") {
        expect(reading.meetsBar).toBe(false);
      }
    }
  });

  test("all 96 relative failures are covered by construction, not by evidence", () => {
    // A project root derived from the working directory a relative path resolves
    // against contains it necessarily. The 96 are 73% of the corpus, and they are
    // the whole distance between 40.0% and 84.0%.
    expect(census.relativeCovered).toEqual({ relative: 96, covered: 96 });
    expect(failures.filter((f) => !hasConstructedHead(f)).length).toBe(96);
    expect(readingOf(census.failures, "specific", "recorded-cwd", "per-session", "all")).toMatchObject({
      covered: 110,
      total: 131,
      meetsBar: true,
    });
  });

  test("home absorbs fifteen failures no specific root reaches", () => {
    const withHome = readingOf(census.failures, "with-home", "recorded-cwd", "per-session", "constructed-head");
    expect(withHome.byRoot.home).toBe(15);
    expect(withHome).toMatchObject({ covered: 29, total: 35, meetsBar: true });
    expect(withHome.covered - census.headline.covered).toBe(15);
  });

  test("binding `project` machine-wide instead of per run costs half the coverage", () => {
    // Five repositories on one machine, so "the project" is a different directory
    // in every session. A vocabulary that names it once cannot be handed to all of
    // them — which is an argument for the solution's own mechanism and against any
    // fixed table of roots.
    expect(readingOf(census.failures, "specific", "recorded-cwd", "fixed", "all")).toMatchObject({
      covered: 62,
      total: 131,
      meetsBar: false,
    });
  });
});

describe("coverage is not the mechanism, and the gap is most of the answer", () => {
  test("the class a root actually prevents is between 1 and 10 of 35", () => {
    // Strict is a lower bound: it needs two trailing segments to match, so it
    // misses a head error one segment deep — including the node's own example,
    // `/Users/tanner/dev/ost-agent-meta` for `/Users/tanner/ost-agent-meta`, which
    // appears in the loose ten. Loose is an upper bound: a bare filename coincides
    // across five repositories. Read by hand — the ten are listed in
    // PROVENANCE.md — three are genuine head errors and seven are a coincidence or
    // a mistake in the interior of a path whose root was never in doubt.
    expect(census.headErrors).toMatchObject({ constructedHeads: 35, headErrors: 1, headErrorsLooseTail: 10 });
    expect(census.headErrors.headErrors / 131).toBeLessThan(0.01);
    expect(census.headErrors.headErrorsLooseTail / 131).toBeLessThan(0.08);
  });

  test("the node's own example is in the corpus, exactly once", () => {
    expect(failures.filter((f) => f.addressed === "/Users/tanner/dev/ost-agent-meta").length).toBe(1);
    expect(census.headErrors.looseExamples.some((e) => e.startsWith("/Users/tanner/dev/ost-agent-meta →"))).toBe(true);
  });

  test("a failure inside a declared root is one the root would not have prevented", () => {
    // The direction that makes coverage the wrong instrument: these 14 are counted
    // as covered, and every one of them had its prefix right and its tail wrong.
    const insideRoot = failures.filter(
      (f) =>
        hasConstructedHead(f) && rootContaining(vocabularyFor(f.cwd, "per-session"), f.addressed, "specific") !== null,
    );
    expect(insideRoot.length).toBe(census.headline.covered);
    expect(insideRoot.map((f) => f.addressed)).toContain("/Users/tanner/dev/OST-Agent/src/ost/set-outcome.ts");
  });
});

describe("the control: the roots cover the paths that worked better than the ones that failed", () => {
  test("68.2% of successful addresses, 40.0% of failed ones", () => {
    // The comparison group the assumption test asked for, and it runs against the
    // assumption: "it only pays if a few roots cover most of the failures", and the
    // failures are precisely the population the roots reach least.
    const worked = readingOf(census.successes, "specific", "recorded-cwd", "per-session", "constructed-head");
    expect(worked).toMatchObject({ covered: 26962, total: 39510 });
    expect(worked.share).toBeCloseTo(0.682, 3);
    expect(worked.share).toBeGreaterThan(census.headline.share);
  });

  test("the failures the roots miss are named places, not noise", () => {
    const outside = failures.filter(
      (f) =>
        hasConstructedHead(f) && rootContaining(vocabularyFor(f.cwd, "per-session"), f.addressed, "specific") === null,
    );
    expect(outside.length).toBe(21);
    // A per-session scratchpad carries a session uuid in the middle of it, so no
    // fixed vocabulary can name it — it can only be supplied by the runtime that
    // made it, which is the solution's own argument applied to a fifth root.
    expect(outside.filter((f) => f.addressed.includes("/scratchpad/")).length).toBeGreaterThanOrEqual(3);
  });
});

describe("the report says what it is", () => {
  test("the verdict, both readings and both circularities are on its face", () => {
    const report = formatPathRootCensus(census);
    expect(report).toContain("MISSES the 80.0% bar where a root does work");
    expect(report).toContain("read literally (all four names, every failed path) it MEETS it");
    expect(report).toContain("readings DISAGREE");
    expect(report).toContain("96/96 relative failures are covered by construction");
    expect(report).toContain("head errors — the class a root prevents: 1 of 35");
  });
});
