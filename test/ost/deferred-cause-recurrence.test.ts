/**
 * The instrument for "Check the deferred nodes for whether what killed them
 * repeats by category."
 *
 * The assumption underneath it is a feasibility claim: failure repeats by
 * category, so a vault that has abandoned ideas has told you what its risky
 * assumptions look like and a solution can be gated against that class first. If
 * every death is idiosyncratic, history supplies no prior and the whole route has
 * nothing to work from.
 *
 * The threshold is a count — *at least 15 abandoned solutions exist, and the top 3
 * causes account for half of them* — and it is a count over a live vault that
 * changes every day. So this file follows `stranded-evidence-census.test.ts`
 * exactly, for the reason that file states in its own header: **nothing here reads
 * the live trees.** A number taken over a vault that moves is a number no
 * assertion can be pinned to, and an assertion pinned to it turns the repository's
 * suite gate into a proxy for somebody else's writing. What this file holds is the
 * grouping and the arithmetic; the count that decides the assumption is the
 * operator's to take with `ost-agent deferrals`, out of the same code, and to
 * record with `ost-agent result`.
 *
 * Four things are pinned, and the third is the one worth the file:
 *
 *   1. a cause is read off the `## History` entry that recorded the transition,
 *      and the LAST such entry wins, because retirement is reversible here;
 *   2. all three retirement routes are counted — `deferred`, `## Retraction` and
 *      `archive/` — and the route with no recorded reason is counted and named as
 *      `unclassified` rather than dropped, because dropping it would make the rest
 *      look more concentrated than the record supports;
 *   3. the concentration clause is reported as non-discriminating at this bar. Over
 *      five causes, a sample of fifteen spread as flat as it can go still puts 60%
 *      in its top three — so the clause reads SUPPORTED off the maximally refuting
 *      distribution. That is a property of the threshold, and the instrument's job
 *      is to say so rather than to quietly satisfy it;
 *   4. an empty sample is not a met clause, and a census over nothing is BLIND
 *      rather than clean.
 *
 * The ordering assertions in the classifier block are transcriptions of real
 * entries in `ost-agent-meta`, quoted closely enough to fail if the ordering is
 * ever "simplified": both of this vault's ordering hazards are sentences that
 * mention a category they are not an instance of.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { ARCHIVE_DIRNAME } from "../../src/ost/census.js";
import {
  DEFERRAL_CAUSES,
  classifyCause,
  deferralCensus,
  deferralHistoryEntry,
  deferredCauses,
  flattestTopThreeShare,
  formatDeferralCensus,
  summariseDeferrals,
  tallyCauses,
  type DeferredNode,
} from "../../src/ost/deferral.js";
import type { OstNode } from "../../src/ost/node.js";

let dirs: string[];

function makeVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-deferral-"));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

/** A node written straight to disk, so a `## History` section can be authored verbatim. */
function write(dir: string, node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }, history: string): void {
  const frontmatter = [
    "---",
    `type: ${node.layer}`,
    ...(node.status ? [`status: ${node.status}`] : []),
    "evidence: assertion",
    "---",
  ].join("\n");
  const body = history ? `\n\nSome prose.\n\n## History\n${history}\n` : "\n\nSome prose.\n";
  fs.writeFileSync(path.join(dir, `${node.title}.md`), `${frontmatter}${body}`, "utf8");
}

function row(rows: readonly DeferredNode[], title: string): DeferredNode {
  const found = rows.find((r) => r.title === title);
  if (!found) throw new Error(`no census row for ${title} (have: ${rows.map((r) => r.title).join(", ")})`);
  return found;
}

/**
 * The four retirements `ost-agent-meta` actually carried when this instrument was
 * written, quoted from their `## History` entries. Two of them are the ordering
 * hazards the classifier is ordered around.
 */
const REAL_ENTRIES = {
  superseded:
    "2026-08-20 status: unvalidated → deferred — Split rather than instrumented. The 2026-08-20 unattended " +
    "sweep created the two halves beside it under the same assumption. Deferred means superseded by those " +
    "two, not abandoned; its design paragraph is preserved in both.",
  // Mentions "a human should still decide" — `decided` would take it if it ran first.
  refuted:
    "2026-08-16 status: (none) → deferred — Its own instrument was run by the build loop against real " +
    "harvested history: two-stage framing costs 92 operator turns vs one-stage's actual 72. Full suite green " +
    "except this designed-to-fail assertion. Deferring per the evidence rather than leaving it live — a " +
    "human should still decide whether to close PR #130.",
  // Mentions "the duplicate scan" — `duplicate` would take it if it ran first.
  decided:
    "2026-08-20 status: unvalidated → deferred — Records a human decision already on this node: the pricing " +
    "question was ANSWERED BY FOUNDER DECISION — the unit is zero, the product will be free. Deferred is the " +
    "nearest status to \"closed by decision\": it retires the node from the duplicate scan.",
  duplicate:
    "2026-07-25 status: unvalidated → deferred — Human-authorized merge: self-flagged near-duplicate of " +
    "sibling 'Fear the agent could take a destructive, irreversible action' — same fear, two mitigation " +
    "philosophies. Deferred, never deleted; reverse by resetting status.",
} as const;

describe("classifying a recorded cause", () => {
  test("reads each of this vault's four real retirements into its own category", () => {
    for (const [expected, entry] of Object.entries(REAL_ENTRIES)) {
      expect(classifyCause(entry), `entry classified as ${expected}`).toBe(expected);
    }
  });

  test("a falsification that also asks a human to decide is refuted, not decided", () => {
    // The ordering hazard, isolated. `decided` matches "decide" in this sentence
    // and would file a measured refutation as somebody's preference.
    expect(REAL_ENTRIES.refuted).toMatch(/decide/);
    expect(classifyCause(REAL_ENTRIES.refuted)).toBe("refuted");
  });

  test("a founder decision that mentions the duplicate scan is decided, not duplicate", () => {
    expect(REAL_ENTRIES.decided).toMatch(/duplicate/);
    expect(classifyCause(REAL_ENTRIES.decided)).toBe("decided");
  });

  test("prose with no recognised cause is unclassified rather than forced into a bucket", () => {
    expect(classifyCause("2026-08-01 status: unvalidated → deferred — no longer relevant")).toBe("unclassified");
    expect(classifyCause("")).toBe("unclassified");
    expect(classifyCause("   ")).toBe("unclassified");
  });

  test("the last transition wins, because a retirement here is reversible", () => {
    const body = [
      "## History",
      `- ${REAL_ENTRIES.duplicate}`,
      "- 2026-08-01 status: deferred → unvalidated — restored, the merge was wrong",
      `- ${REAL_ENTRIES.refuted}`,
    ].join("\n");
    expect(deferralHistoryEntry({ body })).toContain("designed-to-fail");
    expect(classifyCause(deferralHistoryEntry({ body }))).toBe("refuted");
  });

  test("a History line that merely mentions deferral is not read as a transition", () => {
    const body = ["## History", "- 2026-08-01 unlinked a child — its deferred sibling now carries the design"].join("\n");
    expect(deferralHistoryEntry({ body })).toBe("");
  });
});

describe("the census over a tree", () => {
  test("counts all three retirement routes and names the one that records no reason", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    vault.createNode({
      title: "Outcome",
      layer: "Outcome",
      status: "unvalidated",
      tags: [],
      links: [],
      body: "The mandate.",
    } as OstNode);
    write(dir, { title: "Deferred by evidence", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    write(dir, { title: "Still live", layer: "Solution", status: "unvalidated" }, "");
    // Retraction: withheld from the tree at the read, reaching the census as a
    // named drop carrying the retracting human's words.
    write(dir, { title: "Retracted one", layer: "Solution" }, "");
    fs.appendFileSync(
      path.join(dir, "Retracted one.md"),
      "\n## Retraction\n- 2026-08-02 withdrawn — a near-duplicate of the surviving sibling\n",
      "utf8",
    );
    // Archive: a `git mv` at a shell, which records no reason anywhere.
    fs.mkdirSync(path.join(dir, ARCHIVE_DIRNAME));
    write(path.join(dir, ARCHIVE_DIRNAME), { title: "Archived one", layer: "Solution" }, "");

    const census = deferredCauses(dir, vault.readTreeCensus());
    expect(census.retired.map((r) => r.route).sort()).toEqual(["archive", "retraction", "status"]);
    expect(row(census.retired, "Deferred by evidence").cause).toBe("refuted");
    expect(row(census.retired, "Retracted one").cause).toBe("duplicate");

    // The archived row is the point: no reason was ever recorded for it, so it is
    // carried as unclassified with an empty basis rather than left out. Dropping
    // it would shrink the denominator the concentration is measured over.
    const archived = row(census.retired, "Archived one");
    expect(archived.cause).toBe("unclassified");
    expect(archived.basis).toBe("");
  });

  test("a live node is not a retirement", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    write(dir, { title: "Still live", layer: "Solution", status: "unvalidated" }, `- ${REAL_ENTRIES.refuted}`);
    expect(deferredCauses(dir, vault.readTreeCensus()).retired).toHaveLength(0);
  });

  test("an unparseable node file makes the census partly blind rather than quietly short", () => {
    const dir = makeVault();
    const vault = new Vault(dir);
    write(dir, { title: "Deferred by evidence", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    fs.writeFileSync(path.join(dir, "Broken.md"), "---\ntype: Solutoin\n---\n\nbody\n", "utf8");

    const one = deferredCauses(dir, vault.readTreeCensus());
    expect(one.unreadable).toContain("Broken.md");
    const census = summariseDeferrals([one]);
    expect(census.blindness).toBe("partly-blind");
    expect(formatDeferralCensus(census)).toContain("partly blind");
  });

  test("a census over a vault with nothing in it is blind, not clean", () => {
    const dir = makeVault();
    const census = deferralCensus([dir]);
    expect(census.blindness).toBe("totally-blind");
    const text = formatDeferralCensus(census);
    expect(text).toContain("BLIND");
    expect(text).not.toContain("THRESHOLD MET");
  });

  test("spans more than one vault, because a cause recurring in a tree that never heard of the first is the evidence", () => {
    const a = makeVault();
    const b = makeVault();
    for (const dir of [a, b]) {
      new Vault(dir);
      write(dir, { title: "Deferred by evidence", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    }
    const census = deferralCensus([a, b]);
    expect(census.retired).toHaveLength(2);
    expect(census.vaults.map((v) => v.vault)).toEqual([a, b]);
    expect(census.tally.find((t) => t.cause === "refuted")?.count).toBe(2);
  });
});

describe("the layer the threshold is taken over", () => {
  test("scopes the sample to Solutions by default and still reports the rest", () => {
    const dir = makeVault();
    new Vault(dir);
    write(dir, { title: "Dead solution", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    write(dir, { title: "Dead opportunity", layer: "Opportunity", status: "deferred" }, `- ${REAL_ENTRIES.decided}`);
    write(dir, { title: "Dead test", layer: "AssumptionTest", status: "deferred" }, `- ${REAL_ENTRIES.superseded}`);

    const census = deferralCensus([dir]);
    // Three retirements found; one of them is what the threshold's word
    // "solutions" is taken over. Reporting three as the sample would clear the
    // sample-size clause five times faster than the record supports.
    expect(census.retired).toHaveLength(3);
    expect(census.inScope).toHaveLength(1);
    expect(census.verdict.sample).toBe(1);
    expect(formatDeferralCensus(census)).toContain("out of scope");

    const widened = deferralCensus([dir], { layers: ["Solution", "Opportunity", "AssumptionTest"] });
    expect(widened.verdict.sample).toBe(3);
  });
});

describe("the threshold's arithmetic", () => {
  const rows = (causes: readonly string[]): DeferredNode[] =>
    causes.map((cause, i) => ({
      vault: "/v",
      title: `n${i}`,
      layer: "Solution" as const,
      route: "status" as const,
      cause: cause as DeferredNode["cause"],
      basis: "b",
    }));

  test("both clauses are required, and a short sample fails whatever the concentration", () => {
    // Fourteen deaths, all one cause — perfectly concentrated and still short.
    const { verdict } = tallyCauses(rows(Array(14).fill("refuted")));
    expect(verdict.shareHolds).toBe(true);
    expect(verdict.sampleHolds).toBe(false);
    expect(verdict.holds).toBe(false);
  });

  test("an empty sample clears neither clause", () => {
    const { verdict } = tallyCauses([]);
    expect(verdict.topThreeShare).toBe(0);
    expect(verdict.shareHolds).toBe(false);
    expect(verdict.holds).toBe(false);
  });

  test("the tally carries every cause, including the ones nothing landed in", () => {
    const { tally } = tallyCauses(rows(["refuted", "refuted", "decided"]));
    expect(tally.map((t) => t.cause).sort()).toEqual([...DEFERRAL_CAUSES].sort());
    expect(tally[0]).toEqual({ cause: "refuted", count: 2 });
  });

  test("the top three are the three largest", () => {
    const { verdict } = tallyCauses(
      rows([
        "refuted", "refuted", "refuted",
        "decided", "decided",
        "duplicate",
        "superseded",
        "unclassified",
      ]),
    );
    expect(verdict.topThree).toBe(6); // 3 + 2 + 1
    expect(verdict.sample).toBe(8);
    expect(verdict.topThreeShare).toBeCloseTo(6 / 8, 10);
  });
});

describe("whether the concentration clause can come out a failure", () => {
  test("the flattest distribution over five causes is not flat enough to fail the clause at 15", () => {
    // 15 over 5 buckets is 3/3/3/3/3; the top three is 9, which is 60%.
    expect(flattestTopThreeShare(15, 5)).toBeCloseTo(0.6, 10);
  });

  test("so the census reports the clause as non-discriminating, in words, beside its own result", () => {
    const dir = makeVault();
    new Vault(dir);
    write(dir, { title: "Dead solution", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    const census = deferralCensus([dir]);

    expect(census.verdict.concentrationDiscriminates).toBe(false);
    const text = formatDeferralCensus(census);
    expect(text).toContain("concentration clause cannot come out a failure");
    // Named as the threshold's own property, not silently satisfied: the reader is
    // told which clause is carrying the bar.
    expect(text).toContain("sample-size clause");
  });

  test("it would discriminate against a wider vocabulary, which is what makes this a property of the bar", () => {
    // Seven causes: 15 spreads to 3/2/2/2/2/2/2, top three 7 — 47%, below half.
    expect(flattestTopThreeShare(15, 7)).toBeLessThan(0.5);
    const { verdict } = tallyCauses([], { sampleRequired: 15, shareRequired: 0.8 });
    // A stricter share bar also restores discrimination, for the same reason.
    expect(verdict.concentrationDiscriminates).toBe(true);
  });
});

describe("the operator's reading", () => {
  test("leads with the verdict and prints the words every cause was read off", () => {
    const dir = makeVault();
    new Vault(dir);
    write(dir, { title: "Dead solution", layer: "Solution", status: "deferred" }, `- ${REAL_ENTRIES.refuted}`);
    const text = formatDeferralCensus(deferralCensus([dir]));

    expect(text.split("\n")[0]).toContain("THRESHOLD NOT MET");
    expect(text).toContain("short by 14");
    // The basis line is what makes a bucket checkable rather than believable.
    expect(text).toContain("designed-to-fail");
    expect(text).toContain("the cause somebody WROTE DOWN");
    expect(text).toContain("ost-agent result");
  });
});
