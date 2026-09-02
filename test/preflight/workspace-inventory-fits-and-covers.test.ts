/**
 * The instrument for "The run is handed the workspace layout at startup, before
 * it composes anything".
 *
 * The assumption beneath that solution is the risky half and it was written down
 * before anything was generated: *an inventory detailed enough to prevent the
 * observed failures is too large to carry in context.* The assumption test fixed
 * both halves of the bar in advance — **the generated inventory must render
 * under 4,000 estimated tokens AND name the parent directory of every path that
 * failed in the captured corpus. Both, not either.** An inventory that fits and
 * does not cover, or covers and does not fit, refutes the solution as written,
 * and which condition breaks decides whether it narrows or gives way to a
 * sibling.
 *
 * It came out **FITS and DOES NOT COVER**: 1,413 estimated tokens against a
 * budget of 4,000, and **23 of 41 (56%)** of the failures that named a path.
 *
 * ## This command being green does not mean the assumption held
 *
 * It is green because the count has been taken and pinned, which is what an
 * instrument on a measurement can mean. That is the convention
 * `test/preflight/manifest-covers-observed-refusals.test.ts`,
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/telemetry/preflight-uncertainty-census.test.ts` already run under, and all
 * three of those censuses also came out against the solution they were
 * commissioned for. Whoever reads this exit code must read `census.meetsBar` with
 * it, which is why it is asserted `false` by name below rather than left to be
 * inferred.
 *
 * ## The three findings, each an assertion rather than a comment
 *
 * 1. **The two requirements do not pull against each other here.** The solution
 *    node predicted an inventory "either too coarse to answer the question that
 *    matters or too large to carry", citing `ost_read_tree` refused at 134,240
 *    characters. At directory resolution over a code repository the tension does
 *    not arrive: the inventory fits in a third of its budget and **not one**
 *    coverage miss is a directory cut for size (`byMissReason.truncated === 0`).
 *    The coverage failure is a *scope* failure, and no budget buys it back —
 *    which the census shows by re-taking the verdict at 1,000 and 10,000.
 *
 * 2. **The proxy hands out most of its own credit for free.** The assumption test
 *    scores a hit when the inventory names the failed path's *parent directory*,
 *    "because that is the resolution at which it would actually have helped".
 *    **21 of the 23 hits are cases where that sentence is false**: 12 have `.` as
 *    their parent, which every inventory names by construction and half of which
 *    are not paths at all (`-d`, from `ls: -d: No such file`), and 11 name a path
 *    that is sitting in this workspace *right now* — the run was told it was not
 *    there and it is, so the layout was never the fact it had wrong. Strictly,
 *    the inventory covers **2 of 41**. The verdict is still taken on the
 *    assumption test's own generous definition, because moving a numerator after
 *    seeing it is not measuring.
 *
 * 3. **A nested checkout is a second copy of the workspace.** This repository
 *    keeps git worktrees under `.worktrees/`, and describing one costs 65
 *    directories and 932 estimated tokens — 42% of the whole inventory — every
 *    line of which is about a checkout the run is not standing in. Three
 *    worktrees would breach any budget the assumption test could have named. The
 *    generator stops at a directory holding its own `.git` and says so in the
 *    text; the control below builds a nested repository and asserts the boundary.
 *
 * ## What carries this file is the controls, not the numbers
 *
 * A census that answered "covered" to everything would satisfy every assertion
 * about a corpus that came out high, and one that answered "uncovered" to
 * everything would satisfy every assertion about a corpus that came out low. So
 * the synthetic cases run first and in both directions: a workspace and corpus
 * built to cover reach 100% and clear the bar, one built not to reaches 0%, an
 * inventory built too large is reported as not fitting *and* fails the combined
 * bar while covering perfectly, and a corpus with nothing path-shaped in it comes
 * out UNREAD rather than clean.
 *
 * The strongest control is the anti-drift one. The solution's own body rules
 * itself out if the inventory becomes "a second statement of the workspace's
 * shape that can drift from the workspace". So every directory the inventory
 * names is asserted to exist on disk: the generator may report the filesystem and
 * may never author it.
 *
 * ## Why some numbers are pinned and others are bounded
 *
 * The corpus is a committed fixture, so every count taken over it is pinned
 * exactly. The inventory's own size is not: `.superpowers/`, `.worktrees/` and
 * `.claude/` are untracked or ignored and present on some checkouts and not
 * others, so a pinned token count would be an assertion about one machine. Fit is
 * therefore asserted as a bound with its headroom stated. The coverage counts do
 * not move with those directories — every parent they turn on is tracked — which
 * is why they can be pinned.
 *
 * If a count here changes, the census's subject moved: a file a failure named was
 * created or deleted. That is a true signal and the number should be re-read
 * rather than relaxed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { FailingCall } from "../../src/telemetry/path-failure-attribution.js";
import {
  estimateTokens,
  formatInventoryCoverageCensus,
  generateWorkspaceInventory,
  inventoryCoverageCensus,
  inventoryNames,
  INVENTORY_RULE,
  renderWorkspaceInventory,
  resolveSubject,
  type WorkspaceInventory,
} from "../../src/runner/workspace-inventory.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The corpus. Deliberately the same file `test/friction/path-failure-attribution.test.ts`
 * reads: every failing call in 646 session transcripts, kept whole with nothing
 * selected. It was cut for a different question, which is the strongest property
 * it has here — nobody chose these rows knowing this census would be taken over
 * them. See `test/fixtures/path-failure-attribution/PROVENANCE.md`.
 */
function corpus(): FailingCall[] {
  const file = path.join(repoRoot, "test", "fixtures", "path-failure-attribution", "failures.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FailingCall);
}

/** A throwaway workspace, built to a named shape so a control can be read off it. */
function workspace(dirs: string[], files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-inventory-"));
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body, "utf8");
  }
  return root;
}

function failure(over: Partial<FailingCall>): FailingCall {
  return { session: "s", tool: "Bash", command: "", error: "", ...over };
}

/** The inventory a run in this repository would actually be handed. */
function realInventory(): WorkspaceInventory {
  return generateWorkspaceInventory(repoRoot);
}

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the inventory was generated", () => {
  test("both bars are the ones the assumption test fixed, not ones chosen after", () => {
    expect(INVENTORY_RULE.tokenBudget).toBe(4000);
    // "…every path that failed". No partial credit; the threshold said both
    // conditions and admitted no fraction on the second.
    expect(INVENTORY_RULE.coverageBar).toBe(1);
  });

  test("the verdict is taken on the plain reading, not the flattering one", () => {
    expect(INVENTORY_RULE.verdictReading).toBe("named-a-path");
    // `in-workspace` narrows the denominator to the places the inventory already
    // describes, which scores the artefact against the sample it was cut from.
    expect(INVENTORY_RULE.verdictReading).not.toBe("in-workspace");
    // …and the widest readings admit subjects no inventory of any workspace can
    // name, so they cannot come out in the solution's favour and must not decide.
    expect(INVENTORY_RULE.readings.at(-1)?.name).toBe("every-path-shaped");
    expect(INVENTORY_RULE.verdictReading).not.toBe("every-path-shaped");
  });

  test("the readings are nested, so a wider one may only admit more", () => {
    for (let i = 1; i < INVENTORY_RULE.readings.length; i++) {
      expect(INVENTORY_RULE.readings[i].admits).toEqual(
        expect.arrayContaining(INVENTORY_RULE.readings[i - 1].admits),
      );
    }
  });

  test("the token estimate errs toward reporting the inventory as smaller than it is", () => {
    // Which is the direction that favours the solution under test: a path
    // tokenizes worse than the English this ratio comes from, so a fit result
    // reached this way is the generous one.
    expect(INVENTORY_RULE.charsPerToken).toBe(4);
    expect(estimateTokens("a".repeat(4000))).toBe(1000);
  });
});

// ── the generator reports the filesystem and never authors it ────────────────

describe("the inventory is read off the workspace", () => {
  test("it names the directories that are there, and only those", () => {
    const root = workspace(["src", "src/cli", "test"]);
    const inv = generateWorkspaceInventory(root);
    expect(inv.directories).toEqual([".", "src", "src/cli", "test"]);
  });

  test("every directory in this repository's own inventory exists on disk", () => {
    // The anti-drift control, and the reason this file exists in the shape it
    // does. The solution's body rules itself out if the inventory "can drift from
    // the workspace"; a named directory that is not there is exactly that.
    const inv = realInventory();
    for (const dir of inv.directories) {
      const full = path.join(inv.root, dir);
      expect(fs.existsSync(full), `inventory names ${dir}, which is not there`).toBe(true);
      expect(fs.statSync(full).isDirectory(), `${dir} is named as a directory and is not one`).toBe(true);
    }
  });

  test("a directory that is not a repository is said to be one, in those words", () => {
    // The `git` exit-128 failure the parent opportunity names: a command composed
    // against a directory holding only `bin/` and `vaults/`.
    const root = fs.realpathSync(workspace(["bin", "vaults"]));
    const inv = generateWorkspaceInventory(root);
    expect(inv.git.repository).toBe(false);
    expect(renderWorkspaceInventory(inv)).toContain("NOT a repository");
  });

  test("a repository is found by its .git, without running git", () => {
    const root = fs.realpathSync(workspace([".git", "src"]));
    const inv = generateWorkspaceInventory(root);
    expect(inv.git.repository).toBe(true);
    expect(inv.git.root).toBe(root);
    // …and `.git` is not described, because no command is composed against its
    // internal layout.
    expect(inv.directories).toEqual([".", "src"]);
  });

  test("a declared root that is missing is distinguished from one that is there", () => {
    const root = workspace([]);
    const inv = generateWorkspaceInventory(root, {
      roots: [
        { name: "here", location: root },
        { name: "gone", location: path.join(root, "nowhere") },
      ],
    });
    expect(inv.roots.map((r) => [r.name, r.exists, r.readable])).toEqual([
      ["here", true, true],
      ["gone", false, false],
    ]);
    expect(renderWorkspaceInventory(inv)).toContain("gone: ");
    expect(renderWorkspaceInventory(inv)).toContain("MISSING");
  });

  test("the test layout is reported, and counted rather than listed", () => {
    const root = workspace([], {
      "test/a.test.ts": "",
      "test/b.test.ts": "",
      "src/index.ts": "",
    });
    const inv = generateWorkspaceInventory(root);
    expect(inv.testLayout).toEqual([{ directory: "test", tests: 2 }]);
    // A filename is never in the text; the whole size argument turns on that.
    expect(renderWorkspaceInventory(inv)).not.toContain("a.test.ts");
  });
});

describe("what was cut is in the text, never silent", () => {
  test("the breadth cap reports what it dropped", () => {
    const root = workspace(Array.from({ length: 6 }, (_, i) => `d${i}`));
    const inv = generateWorkspaceInventory(root, { maxChildrenPerDirectory: 4 });
    expect(inv.directories).toEqual([".", "d0", "d1", "d2", "d3"]);
    expect(inv.truncations).toEqual([{ under: ".", reason: "breadth", dropped: 2 }]);
    expect(inv.omitted).toBe(2);
    expect(renderWorkspaceInventory(inv)).toContain("2 under . (breadth cap)");
  });

  test("the depth cap reports what it dropped", () => {
    const root = workspace(["a/b/c"]);
    const inv = generateWorkspaceInventory(root, { maxDepth: 1 });
    expect(inv.directories).toEqual([".", "a"]);
    expect(inv.truncations).toEqual([{ under: "a", reason: "depth", dropped: 1 }]);
  });

  test("an inventory that cut nothing says so, rather than leaving it to be assumed", () => {
    const inv = generateWorkspaceInventory(workspace(["src"]));
    expect(inv.omitted).toBe(0);
    expect(renderWorkspaceInventory(inv)).toContain("Nothing was cut for size");
  });

  test("the text states what a layout description structurally cannot tell you", () => {
    // A manifest that lists what exists without naming the kinds of question it
    // cannot answer reads as complete. The permission limit is the one the
    // solution node raises against itself, and it survives the build.
    const text = renderWorkspaceInventory(realInventory());
    expect(text).toContain("WHAT THIS DOES NOT TELL YOU");
    expect(text).toContain("permitted to read");
    expect(text).toContain("Anything outside this root");
  });
});

describe("a nested checkout is a boundary, not content", () => {
  test("a directory with its own .git is named and not descended into", () => {
    const root = workspace(["src", "wt/.git", "wt/src", "wt/test"]);
    const inv = generateWorkspaceInventory(root);
    expect(inv.directories).toEqual([".", "src", "wt"]);
    expect(inv.nested).toEqual([{ directory: "wt" }]);
    const text = renderWorkspaceInventory(inv);
    expect(text).toContain("NESTED CHECKOUTS");
    expect(text).toContain("1 nested checkout(s)");
  });

  test("a git worktree's gitlink file counts, not only a .git directory", () => {
    // `git worktree add` writes `.git` as a *file* holding a gitdir pointer. A
    // boundary that only recognised the directory form would descend into every
    // worktree this repository makes, which is the case that motivated it.
    const root = workspace(["wt/deep"], { "wt/.git": "gitdir: /elsewhere\n" });
    const inv = generateWorkspaceInventory(root);
    expect(inv.directories).toEqual([".", "wt"]);
    expect(inv.nested).toEqual([{ directory: "wt" }]);
  });

  test("descending into one would cost the workspace's own size again, per checkout", () => {
    // The finding as arithmetic rather than a claim. A worktree is a *copy* of
    // the tree it sits in, so its inventory is the parent's inventory over
    // again — and n worktrees cost (n+1)× the budget to say the same thing n+1
    // times. Built synthetically so the number does not depend on which
    // worktrees happen to exist on the checkout running this.
    const shape = ["src/adapters", "src/cli", "src/loop", "test/loop", "test/ost", "docs/reference"];
    const alone = generateWorkspaceInventory(workspace(shape));
    const withWorktree = generateWorkspaceInventory(
      workspace([...shape, ".worktrees/wt/.git", ...shape.map((d) => `.worktrees/wt/${d}`)]),
    );

    // Without the boundary the copy is described in full, and the inventory is
    // more than twice the size of the workspace it is supposed to describe.
    const undescribed = generateWorkspaceInventory(
      workspace([...shape, ...shape.map((d) => `.worktrees/wt/${d}`)]), // no .git: not a checkout
    );
    expect(undescribed.directories.length).toBeGreaterThan(2 * alone.directories.length);

    // With it, the cost of a worktree is one line.
    expect(withWorktree.nested).toEqual([{ directory: ".worktrees/wt" }]);
    expect(withWorktree.directories.length).toBe(alone.directories.length + 2); // `.worktrees` and the boundary
    expect(estimateTokens(renderWorkspaceInventory(withWorktree))).toBeLessThan(
      estimateTokens(renderWorkspaceInventory(undescribed)),
    );
  });
});

// ── the census can come out either way, on the same code path ────────────────

describe("the census is not tuned to answer one way", () => {
  test("a workspace holding every failed path clears both halves of the bar", () => {
    const root = workspace(["src/cli", "test/loop"]);
    const inv = generateWorkspaceInventory(root);
    const census = inventoryCoverageCensus(
      [
        failure({ error: "sed: src/cli/index.ts: No such file or directory" }),
        failure({ error: "cat: test/loop/run.ts: No such file or directory" }),
      ],
      inv,
    );
    expect(census.pathShaped).toBe(2);
    expect(census.verdict.covered).toBe(2);
    expect(census.verdict.share).toBe(1);
    expect(census.fits).toBe(true);
    expect(census.meetsBar).toBe(true);
    expect(formatInventoryCoverageCensus(census)).toContain("CLEARS");
  });

  test("a corpus that is all somewhere else comes out at nothing", () => {
    const inv = generateWorkspaceInventory(workspace(["src"]));
    const census = inventoryCoverageCensus(
      [
        failure({ error: "cat: /Users/tanner/dev/other-repo/src/a.ts: No such file or directory" }),
        failure({ error: "ls: /tmp/scratch/b: No such file or directory" }),
      ],
      inv,
    );
    expect(census.verdict.denominator).toBe(2);
    expect(census.verdict.covered).toBe(0);
    expect(census.verdict.share).toBe(0);
    expect(census.byMissReason.elsewhere).toBe(2);
    expect(census.meetsBar).toBe(false);
  });

  test("an inventory too large to carry fails the bar even covering perfectly", () => {
    // Both halves, not either. This is the branch the solution node expected to
    // be the one that broke, and it is reachable on the same code path — it just
    // is not what this repository produced.
    const wide = Array.from({ length: 120 }, (_, i) => `d${String(i).padStart(3, "0")}-${"x".repeat(180)}`);
    const inv = generateWorkspaceInventory(workspace([...wide, "src"]), { maxChildrenPerDirectory: 500 });
    const census = inventoryCoverageCensus(
      [failure({ error: "sed: src/a.ts: No such file or directory" })],
      inv,
    );
    expect(census.tokens).toBeGreaterThan(INVENTORY_RULE.tokenBudget);
    expect(census.fits).toBe(false);
    expect(census.verdict.share).toBe(1); // it covers…
    expect(census.meetsBar).toBe(false); // …and still fails, because it must do both
    expect(formatInventoryCoverageCensus(census)).toContain("DOES NOT FIT");
  });

  test("a corpus with nothing to read is UNREAD, never a clean result", () => {
    const inv = generateWorkspaceInventory(workspace(["src"]));
    const census = inventoryCoverageCensus([failure({ error: "TypeError: x is not a function" })], inv);
    expect(census.pathShaped).toBe(0);
    expect(formatInventoryCoverageCensus(census)).toContain("UNREAD");
  });

  test("the readings are monotone — a wider one may only admit more and cover less", () => {
    const census = inventoryCoverageCensus(corpus(), realInventory());
    for (let i = 1; i < census.readings.length; i++) {
      expect(census.readings[i].denominator).toBeGreaterThanOrEqual(census.readings[i - 1].denominator);
      expect(census.readings[i].share!).toBeLessThanOrEqual(census.readings[i - 1].share!);
    }
  });
});

describe("a subject is placed in this workspace only when it is one", () => {
  test("an absolute path recorded against the corpus's own checkout is re-rooted", () => {
    // Otherwise a clone anywhere else scores every one of these out of reach and
    // the census reports a different number per checkout.
    const resolved = resolveSubject(`${INVENTORY_RULE.corpusWorkspaceRoot}/test/mcp/a.test.ts`, "/somewhere/else");
    expect(resolved.kind).toBe("in-workspace");
    expect(resolved.parent).toBe("test/mcp");
  });

  test("a path that climbs out with .. cannot be placed and is not credited", () => {
    // The record does not say what it was relative to.
    expect(resolveSubject("../../../../apps/frontend/.env", "/w").kind).toBe("elsewhere");
  });

  test("a glob operand is not a path anyone addressed", () => {
    // `no matches found: /Users/tanner/dev/ost*` is path-shaped because the
    // shell's message is, and has no parent directory an inventory could name.
    expect(resolveSubject("/Users/tanner/dev/ost*", "/w").kind).toBe("not-a-path");
    expect(resolveSubject("src/vault/*.ts", "/w").kind).toBe("not-a-path");
  });

  test("a message that named nothing is unnamed, not uncovered-for-a-reason", () => {
    expect(resolveSubject(null, "/w").kind).toBe("unnamed");
  });

  test("the inventory is asked about the parent, at the resolution the bar names", () => {
    const inv = generateWorkspaceInventory(workspace(["src/cli"]));
    expect(inventoryNames(inv, "src/cli")).toBe(true);
    expect(inventoryNames(inv, "src/genome")).toBe(false);
  });
});

// ── the count over the corpus this project actually produced ─────────────────

describe("the count over the captured corpus", () => {
  const inv = realInventory();
  const census = inventoryCoverageCensus(corpus(), inv);

  test("the whole corpus was read, and every path-shaped failure is accounted for", () => {
    expect(census.failures).toBe(719);
    expect(census.pathShaped).toBe(76);
    // Every path-shaped failure is exactly one subject kind. A census with a
    // blind spot it does not name is the shape this repository has withdrawn
    // findings over, so the residual is asserted to be zero rather than small.
    const kinds = Object.values(census.bySubjectKind).reduce((n, k) => n + k, 0);
    expect(kinds).toBe(census.pathShaped);
  });

  test("REACH: 27 of 76 path-shaped failures name a place inside this workspace", () => {
    // Reported before any share, and it is the first thing that goes wrong for
    // the solution. An inventory describes one workspace; the failures this
    // project actually suffered were spread across six of them plus /tmp, and no
    // budget reaches what is not in the root.
    expect(census.bySubjectKind["in-workspace"]).toBe(27);
    expect(census.bySubjectKind.elsewhere).toBe(14);
    expect(census.bySubjectKind["not-a-path"]).toBe(24);
    expect(census.bySubjectKind.unnamed).toBe(11);
  });

  test("FIT: it fits, in about a third of its budget, with the whole tree listed", () => {
    // Not pinned to a number: `.superpowers/`, `.worktrees/` and `.claude/` are
    // untracked or ignored and present on some checkouts and not others. The
    // claim that matters is the headroom, and it is large.
    expect(census.fits).toBe(true);
    expect(census.tokens).toBeLessThan(INVENTORY_RULE.tokenBudget / 2);
    expect(census.named).toBeGreaterThan(100);
  });

  test("FINDING: not one coverage miss is a directory cut for size", () => {
    // The solution node predicted the two requirements would pull against each
    // other and cited `ost_read_tree` refused at 134,240 characters. At directory
    // resolution over a code repository that tension does not arrive at all: the
    // budget is not what this coverage failure is about, and no budget buys it
    // back.
    expect(census.byMissReason.truncated).toBe(0);
    expect(census.budgetDecides).toBe(false);
    expect(census.budgetReadings.every((b) => !b.meetsBar)).toBe(true);
    expect(formatInventoryCoverageCensus(census)).toContain("Nothing was missed for size");
  });

  test("the misses inside the workspace are directories that have since been deleted", () => {
    // `src/genome` went in 8261a6f. The corpus is historical and the workspace is
    // not, so an inventory generated today correctly does not name them — and
    // reporting that as a budget failure would blame the budget for the calendar.
    expect(census.byMissReason.gone).toBe(4);
    const gone = census.rows.filter((r) => r.missReason === "gone").map((r) => r.parent);
    expect(gone).toContain("src/genome");
  });

  test("VERDICT: 23 of 41 (56%) against a bar of every path — REFUTED", () => {
    expect(census.verdict.name).toBe("named-a-path");
    expect(census.verdict.denominator).toBe(41);
    expect(census.verdict.covered).toBe(23);
    expect(census.verdict.share).toBeCloseTo(23 / 41, 6);
    expect(census.verdict.share!).toBeLessThan(INVENTORY_RULE.coverageBar);
    // Asserted by name. A green run of this file means the count has been taken,
    // never that the assumption held.
    expect(census.meetsBar).toBe(false);
  });

  test("no reading of the threshold clears the bar, so the choice did not decide it", () => {
    expect(census.readingDecides).toBe(false);
    // Including the flattering one, which is the only reason that matters: even
    // scored solely against the places it already describes, it misses.
    const inWorkspace = census.readings.find((r) => r.name === "in-workspace")!;
    expect(inWorkspace.covered).toBe(23);
    expect(inWorkspace.denominator).toBe(27);
    expect(inWorkspace.meetsBar).toBe(false);
  });

  test("FINDING: 21 of the 23 hits are credit the proxy grants for free", () => {
    // The assumption test's proxy is "names the parent directory, because that is
    // the resolution at which it would actually have helped". For 21 of its 23
    // hits that sentence is false.
    expect(census.proxy.covered).toBe(23);
    // `.` is named by every inventory by construction, and half of these are not
    // paths at all — `-d`, out of `ls: -d: No such file or directory`.
    expect(census.proxy.trivialRoot).toBe(12);
    // …and these name a path that is in this workspace right now. The run was
    // told it was not there and it is: it was standing somewhere else, or reached
    // before the file was written. A layout description answers neither.
    expect(census.proxy.subjectPresentToday).toBe(11);
    expect(census.proxy.free).toBe(21);
    expect(census.proxy.strict).toBe(2);
    expect(census.proxy.strictShare!).toBeLessThan(0.05);
  });

  test("the report leads with reach and says REFUTED out loud", () => {
    const text = formatInventoryCoverageCensus(census);
    expect(text.split("\n")[0]).toMatch(/^Reach: 27 of 76/);
    expect(text).toContain("REFUTED");
    expect(text).toContain("FREE CREDIT");
    expect(text).toContain("VACUOUS");
    expect(text).toContain("What this does not settle");
  });
});
