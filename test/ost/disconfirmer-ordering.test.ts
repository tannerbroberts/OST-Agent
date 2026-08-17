/**
 * The instrument for the solution node "Cheapest-disconfirmer first — rank
 * tests by how fast they could kill the idea": the queue orders by expected
 * candidates-eliminated-per-effort rather than by importance, and a fixture
 * where the two orderings disagree comes out in the disconfirmer order.
 */
import { describe, expect, test } from "vitest";
import { orderByDisconfirmer, orderByImportance, type DisconfirmerCandidate } from "../../src/ost/disconfirmer-ordering.js";

describe("orderByDisconfirmer inverts the importance order when they disagree", () => {
  // "The favourite": most importance, but cheap to run and kills only itself.
  // "The cheap disconfirmer": least importance, but one hour tests an assumption
  // three other candidates also rest on — so a red result there kills four.
  const candidates: DisconfirmerCandidate[] = [
    { title: "The favourite", importance: 10, eliminates: 1, effort: 1 },
    { title: "A mid-importance candidate", importance: 5, eliminates: 1, effort: 2 },
    { title: "The cheap disconfirmer", importance: 1, eliminates: 4, effort: 1 },
  ];

  test("importance order puts the favourite first — the ordering this node exists to replace", () => {
    expect(orderByImportance(candidates)).toEqual([
      "The favourite",
      "A mid-importance candidate",
      "The cheap disconfirmer",
    ]);
  });

  test("disconfirmer order inverts it: the cheap disconfirmer runs first despite the lowest importance", () => {
    expect(orderByDisconfirmer(candidates)).toEqual([
      "The cheap disconfirmer",
      "The favourite",
      "A mid-importance candidate",
    ]);
  });

  test("effort divides the win away: a costlier disconfirmer drops back behind the favourite and the mid candidate", () => {
    const costlier = candidates.map((c) => (c.title === "The cheap disconfirmer" ? { ...c, effort: 9 } : c));
    expect(orderByDisconfirmer(costlier)).toEqual([
      "The favourite",
      "A mid-importance candidate",
      "The cheap disconfirmer",
    ]);
  });
});

describe("orderByDisconfirmer — ties and edge cases", () => {
  test("equal eliminates-per-effort breaks the tie by title, deterministically", () => {
    const tied: DisconfirmerCandidate[] = [
      { title: "Z candidate", importance: 1, eliminates: 2, effort: 2 },
      { title: "A candidate", importance: 1, eliminates: 1, effort: 1 },
    ];
    expect(orderByDisconfirmer(tied)).toEqual(["A candidate", "Z candidate"]);
  });

  test("refuses a non-positive effort rather than silently dividing by zero", () => {
    const broken: DisconfirmerCandidate[] = [{ title: "Free lunch", importance: 1, eliminates: 4, effort: 0 }];
    expect(() => orderByDisconfirmer(broken)).toThrow(/non-positive effort/);
  });

  test("an empty queue orders to an empty queue", () => {
    expect(orderByDisconfirmer([])).toEqual([]);
    expect(orderByImportance([])).toEqual([]);
  });
});
