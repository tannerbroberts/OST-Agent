/**
 * The frontier is ordered by what each step unblocks, not by what it costs.
 *
 * This is the instrument for the tree node "Order the frontier by what each step
 * unblocks, not by what it costs", and it is written against the real frontier
 * query — `rankBuildableWork`, the one function in this repository that returns
 * an order over `buildableSolutions`, and the one `ost-agent buildable` prints.
 * Before this node was built that order was affordability, then the believability
 * rung, then the order the files happened to be walked in; on a vault where the
 * first two terms tie it came back alphabetical, which is not a ranking, and the
 * only term that ever separated anything ranked by what a step COST.
 *
 * The node's definition of done is three claims, and they are the three describes
 * below:
 *
 *   1. **Each item reports how many others its completion unblocks.** On every
 *      row, including the zeroes — a count that appeared only when it was large
 *      would let a flat column read as agreement.
 *   2. **Sorting is by that count rather than by title or by cost.** The fixture
 *      is built so that title order, tree order and cost order each name a
 *      different winner than leverage does, so an ordering that quietly fell back
 *      to any of them fails here.
 *   3. **An item that unblocks nothing sorts last however cheap it is.** The
 *      zero-leverage candidate in the fixture is also the alphabetically first
 *      one, the first in tree order, and the only one with no unmet demand at
 *      all. It still comes last.
 *
 * What a green here does NOT settle, per the node itself: whether the computed
 * order is *advice a builder prefers*. That is a record of human behaviour —
 * five picks written down before the order is revealed, then compared — and
 * reading it is a person's job. The last describe pins the two limits the node
 * pre-registered against itself, so neither can be lost quietly: the count
 * rewards a densely-mapped branch, and on a tree where every candidate sits
 * beside a buildable sibling it separates nothing at all.
 */
import { describe, expect, test } from "vitest";
import { buildableSolutions } from "../../src/eval/buildable.js";
import { NOTHING_WAITING, unblockingWeights } from "../../src/ost/frontier.js";
import type { OstNode } from "../../src/ost/node.js";
import { EMPTY_MANIFEST, type ResourceManifest } from "../../src/product/manifest.js";
import { formatPriorityOrder, rankBuildableWork } from "../../src/product/planner.js";

/** A node with everything defaulted, so each fixture line states only what it is about. */
function node(over: Partial<OstNode> & Pick<OstNode, "title" | "layer">): OstNode {
  return { status: "unvalidated", body: "", links: [], tags: [], evidence: "assertion", ...over } as OstNode;
}

/** An assumption test carrying an instrument that has been observed red — i.e. a buildable definition of done. */
function redTest(title: string, over: Partial<OstNode> = {}): OstNode {
  const command = `npx vitest run test/${title.replace(/\W+/g, "-").toLowerCase()}.test.ts`;
  return node({
    title,
    layer: "AssumptionTest",
    instrument: command,
    threshold: "the command exits 0",
    body: `## Instrument Log\n- 2026-08-20 **red** (exit 1) \`${command}\` — No test files found\n`,
    ...over,
  });
}

/** Solution → Assumption → AssumptionTest, the shape a build permit is read through. */
function candidate(solution: string, over: Partial<OstNode> = {}, testOver: Partial<OstNode> = {}): OstNode[] {
  const assumption = `${solution} — the belief beneath it`;
  const spec = `${solution} — the measurement`;
  return [
    node({ title: solution, layer: "Solution", links: [assumption], ...over }),
    node({ title: assumption, layer: "Assumption", links: [spec] }),
    redTest(spec, testOver),
  ];
}

/**
 * A solution nobody can build today: its test names no instrument, so it never
 * enters the frontier — it is outstanding work sitting behind whoever CAN build.
 */
function blockedCandidate(solution: string): OstNode[] {
  const assumption = `${solution} — the belief beneath it`;
  const spec = `${solution} — the measurement`;
  return [
    node({ title: solution, layer: "Solution", links: [assumption] }),
    node({ title: assumption, layer: "Assumption", links: [spec] }),
    node({ title: spec, layer: "AssumptionTest", body: "A human still has to say what would settle this." }),
  ];
}

/*
 * The fixture, and every ordering trap in it is deliberate.
 *
 * Four buildable candidates. Titles are chosen so alphabetical order is
 * A, B, C, Z; the array below is in that same order, so tree order agrees with
 * it; and only Z carries an unmet demand, so cost order puts Z last. Leverage
 * puts Z FIRST and A last, which is the one order that disagrees with all three.
 *
 *   Z  — the only live route through a branch mapped in detail: nine outstanding
 *        nodes are waiting behind it. Also the expensive one (it names the
 *        credential the operator withheld).
 *   B, C — two candidates sharing one branch. Neither is a sole route, so each
 *        carries only its own subtree: two nodes apiece.
 *   A  — its assumption and its test have both recorded results already, so
 *        nothing is waiting behind it at all. It is the cheapest thing here.
 */
const CROWDED = "One branch, three candidates, no single route through it";
const MAPPED = "A branch mapped in detail with exactly one live route";

const TREE: OstNode[] = [
  node({
    title: "Order the frontier by what is waiting behind each step",
    layer: "Outcome",
    links: [CROWDED, MAPPED],
  }),
  node({ title: CROWDED, layer: "Opportunity", links: [
    "A settled candidate with nothing waiting behind it",
    "B candidate sharing a branch with a buildable sibling",
    "C candidate sharing a branch with a buildable sibling",
  ] }),
  // A: settled beneath, so leverage 0 — and cheap, and first alphabetically.
  ...candidate(
    "A settled candidate with nothing waiting behind it",
    {},
    { status: "validated" },
  ),
  ...candidate("B candidate sharing a branch with a buildable sibling"),
  ...candidate("C candidate sharing a branch with a buildable sibling"),
  node({ title: MAPPED, layer: "Opportunity", links: [
    "Z candidate that is the only live route through its branch",
    "An unbuildable sibling whose test names no instrument",
    "A second unbuildable sibling whose test names no instrument",
  ] }),
  ...candidate("Z candidate that is the only live route through its branch", {
    body: "Ship the result, which means the run has to publish it.",
  }),
  ...blockedCandidate("An unbuildable sibling whose test names no instrument"),
  ...blockedCandidate("A second unbuildable sibling whose test names no instrument"),
];

/** A's assumption is settled too — `candidate()` only settles the test. */
const SETTLED_ASSUMPTION = "A settled candidate with nothing waiting behind it — the belief beneath it";
for (const n of TREE) if (n.title === SETTLED_ASSUMPTION) n.status = "validated";

const A = "A settled candidate with nothing waiting behind it";
const B = "B candidate sharing a branch with a buildable sibling";
const C = "C candidate sharing a branch with a buildable sibling";
const Z = "Z candidate that is the only live route through its branch";

/** The operator withheld one credential and declared nothing else — so cost separates exactly Z. */
const WITHHOLDS_PUBLISH: ResourceManifest = { credentials: { granted: [], withheld: ["publish"] } };

const order = rankBuildableWork(TREE, WITHHOLDS_PUBLISH);
const titles = order.ranked.map((r) => r.solution);

describe("the fixture really does trap every ordering it is meant to trap", () => {
  test("all four candidates are on the frontier, in alphabetical tree order", () => {
    expect(buildableSolutions(TREE).map((b) => b.solution)).toEqual([A, B, C, Z]);
  });

  test("cost separates exactly one candidate, and it is the one leverage ranks first", () => {
    const unmet = new Map(order.ranked.map((r) => [r.solution, r.unmet.length]));
    expect(unmet.get(Z)).toBe(1);
    expect([A, B, C].map((t) => unmet.get(t))).toEqual([0, 0, 0]);
  });

  test("merit ties across all four, so it can decide nothing here", () => {
    expect(new Set(order.ranked.map((r) => r.evidence))).toEqual(new Set(["assertion"]));
  });
});

describe("each item reports how many others its completion unblocks", () => {
  test("every row carries a count, including the zeroes", () => {
    expect(order.ranked).toHaveLength(4);
    for (const r of order.ranked) {
      expect(typeof r.unblocks).toBe("number");
      expect(r.unblocks).toBeGreaterThanOrEqual(0);
    }
    expect(order.ranked.some((r) => r.unblocks === 0)).toBe(true);
  });

  test("the counts are the outstanding work actually waiting behind each item", () => {
    const by = new Map(order.ranked.map((r) => [r.solution, r.unblocks]));
    // Z is the only buildable item beneath its opportunity, so the whole branch
    // is waiting on it: the opportunity, its own assumption and test, and two
    // unbuildable siblings with an assumption and a test apiece — nine.
    expect(by.get(Z)).toBe(9);
    // B and C share a branch with each other and with A, so neither is a sole
    // route: each carries only its own assumption and test.
    expect(by.get(B)).toBe(2);
    expect(by.get(C)).toBe(2);
    // A's assumption and test have both recorded results. Nothing waits on it.
    expect(by.get(A)).toBe(0);
  });

  test("a row names the ancestors it is the only live route through", () => {
    const byTitle = new Map(order.ranked.map((r) => [r.solution, r.soleRouteFor]));
    expect(byTitle.get(Z)).toEqual([MAPPED]);
    // The crowded branch holds three buildable candidates, so none of them is
    // the route it depends on — the claim is checkable, and here it is false.
    for (const t of [A, B, C]) expect(byTitle.get(t)).toEqual([]);
  });

  test("the rendered order prints the count on every row and says what it cannot weigh", () => {
    const rendered = formatPriorityOrder(order);
    expect(rendered).toMatch(/unblocks 9 outstanding node\(s\) — only live route through/);
    expect(rendered).toMatch(/unblocks 0 outstanding node\(s\)/);
    expect(rendered.match(/unblocks \d+ outstanding node\(s\)/g)).toHaveLength(4);
    expect(rendered).toMatch(/rewards a densely-mapped branch over a sparse one/);
  });
});

describe("sorting is by that count rather than by title or by cost", () => {
  test("the order is leverage-descending", () => {
    expect(titles).toEqual([Z, B, C, A]);
    const counts = order.ranked.map((r) => r.unblocks);
    expect(counts).toEqual([...counts].sort((x, y) => y - x));
  });

  test("it is not alphabetical, and not the order the tree walk produced", () => {
    const alphabetical = [...titles].sort((x, y) => x.localeCompare(y));
    expect(titles).not.toEqual(alphabetical);
    expect(titles).not.toEqual(buildableSolutions(TREE).map((b) => b.solution));
  });

  test("the expensive candidate outranks three cheaper ones", () => {
    // Under a cost-first order Z is last: it is the only candidate the operator's
    // own declaration defers. It is first here, and that inversion is the node.
    const costFirst = [...order.ranked].sort((a, b) => a.unmet.length - b.unmet.length || a.rank - b.rank);
    expect(costFirst.map((r) => r.solution)[0]).not.toBe(Z);
    expect(titles[0]).toBe(Z);
    expect(order.ranked.find((r) => r.solution === Z)!.unmet).toHaveLength(1);
  });

  test("cost still breaks ties, so declaring resources has not stopped mattering", () => {
    // B and C tie on leverage at 2. Withholding a credential B names moves it
    // below C — the affordability term, doing its work underneath the new one.
    const tied = TREE.map((n) =>
      n.title === B ? { ...n, body: "This one has to publish before it can be read." } : n,
    );
    const shifted = rankBuildableWork(tied, WITHHOLDS_PUBLISH).ranked.map((r) => r.solution);
    expect(shifted).toEqual([Z, C, B, A]);
  });
});

describe("an item that unblocks nothing sorts last however cheap it is", () => {
  test("the cheapest, alphabetically-first candidate comes last because nothing waits on it", () => {
    const last = order.ranked[order.ranked.length - 1];
    expect(last.solution).toBe(A);
    expect(last.unblocks).toBe(0);
    expect(last.unmet).toEqual([]);
  });

  test("it stays last with every resource blank, so this is not the manifest doing it", () => {
    const blank = rankBuildableWork(TREE, EMPTY_MANIFEST).ranked;
    expect(blank[blank.length - 1].solution).toBe(A);
    expect(blank.every((r) => r.unmet.length === 0)).toBe(true);
    // And with nothing declared the order is leverage alone, then tree order.
    expect(blank.map((r) => r.solution)).toEqual([Z, B, C, A]);
  });

  test("declaring resources never drops a candidate — it only moves one", () => {
    const blank = rankBuildableWork(TREE, EMPTY_MANIFEST).ranked.map((r) => r.solution);
    expect([...titles].sort()).toEqual([...blank].sort());
  });
});

describe("the weight is a graph computation, and it is total on a broken tree", () => {
  test("a title that names no node has nothing behind it, rather than throwing", () => {
    const weights = unblockingWeights(TREE, ["a solution nobody wrote"]);
    expect(weights.get("a solution nobody wrote")).toEqual(NOTHING_WAITING);
  });

  test("a cycle in the links terminates instead of counting forever", () => {
    const looped: OstNode[] = [
      node({ title: "up", layer: "Opportunity", links: ["down"] }),
      node({ title: "down", layer: "Solution", links: ["up"] }),
    ];
    expect(unblockingWeights(looped, ["down"]).get("down")).toEqual({ unblocks: 1, soleRouteFor: ["up"] });
  });

  test("the walk up stops at the first ancestor with a second live route", () => {
    // Z's opportunity has one live route, so it is claimed; the Outcome above it
    // has four, so it is not — nothing in the crowded branch is waiting on Z.
    const weight = unblockingWeights(TREE, buildableSolutions(TREE).map((b) => b.solution)).get(Z)!;
    expect(weight.soleRouteFor).toEqual([MAPPED]);
    expect(weight.soleRouteFor).not.toContain("Order the frontier by what is waiting behind each step");
  });
});

describe("the two limits the node pre-registered against itself", () => {
  test("a flat frontier orders nothing, and the flat column is visible as one", () => {
    // Every candidate beside a buildable sibling, every subtree the same size:
    // leverage separates none of them and the order falls back to what it did
    // before. The node predicted this; a reader sees it in the counts.
    const flat: OstNode[] = [
      node({ title: "One opportunity, three identical candidates", layer: "Opportunity", links: ["S1", "S2", "S3"] }),
      ...candidate("S1"),
      ...candidate("S2"),
      ...candidate("S3"),
    ];
    const ranked = rankBuildableWork(flat, EMPTY_MANIFEST).ranked;
    expect(ranked.map((r) => r.unblocks)).toEqual([2, 2, 2]);
    expect(ranked.map((r) => r.solution)).toEqual(buildableSolutions(flat).map((b) => b.solution));
  });

  test("density wins: the better-mapped branch outranks the sparser one", () => {
    // Two sole-route candidates, identical in every way except how much prose
    // somebody got around to writing beneath each. The one whose branch was
    // easier to map ranks first, and it looks rigorous doing it.
    const dense: OstNode[] = [
      node({ title: "root", layer: "Outcome", links: ["well mapped", "barely mapped"] }),
      node({ title: "well mapped", layer: "Opportunity", links: ["Dense candidate", "unbuilt one", "unbuilt two"] }),
      ...candidate("Dense candidate"),
      ...blockedCandidate("unbuilt one"),
      ...blockedCandidate("unbuilt two"),
      node({ title: "barely mapped", layer: "Opportunity", links: ["Sparse candidate"] }),
      ...candidate("Sparse candidate"),
    ];
    const ranked = rankBuildableWork(dense, EMPTY_MANIFEST).ranked;
    expect(ranked.map((r) => r.solution)).toEqual(["Dense candidate", "Sparse candidate"]);
    expect(ranked[0].unblocks).toBeGreaterThan(ranked[1].unblocks);
  });
});
