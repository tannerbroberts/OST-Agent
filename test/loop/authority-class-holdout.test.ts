/**
 * Draft the decision classes from the older half of the stops and test them on the newer half.
 *
 * The instrument for the meta vault's assumption test of the same name, and the
 * holdout `test/loop/question-stop-independence-replay.test.ts` names as the
 * generalization question it cannot answer in-sample. The seventeen recorded
 * AskUserQuestion stops are ordered by `askedAt`; the authority contract
 * (`src/loop/authority-contract.ts`) was drafted from the oldest eight and cites
 * them; the nine newest are placed against those classes in
 * `test/fixtures/question-stops/holdout-placements.json` — allowed to use only
 * the classes already written, with null for a stop no clause covers.
 *
 * The bars were pre-committed in the vault node before any of this existed, and
 * both are asserted because either alone is gameable:
 *
 *  - COVERAGE: at least 6 of the 9 held-out stops land in a pre-drafted class,
 *    with no new class invented — a taxonomy that has to grow for every question
 *    has not generalized.
 *  - PROCEED-RATE: at least 4 of the 9 land in a class that lets compute
 *    continue — a taxonomy that covers everything by ruling everything
 *    stop-and-cite is a correct document that buys nothing.
 *
 * And one invariant that outranks both counts: the stop about the tree's own
 * gate (3d729ebc@129) must land in the governance class, which is fixed before
 * drafting, rules stop-and-cite, and is never eligible to proceed. Placed
 * anywhere else, the contract's safety is refuted regardless of the scores.
 *
 * What this file can enforce is structure and arithmetic: the split, the
 * citation cutoff, no-new-class, the bars. What it cannot enforce is that the
 * drafting genuinely never looked at the holdout — that discipline and its
 * limits are stated in the fixture's PROVENANCE.md, which is required reading
 * before the green here is believed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORITY_CONTRACT,
  AUTHORITY_DRAFTING_CUTOFF,
  renderAuthorityContract,
  type DecisionClass,
} from "../../src/loop/authority-contract.js";

interface FixtureStop {
  session: string;
  entry: number;
  askedAt: string;
  header: string;
  question: string;
}

interface Placement {
  session: string;
  entry: number;
  class: string | null;
  why: string;
}

const fixtureDir = path.join(__dirname, "../fixtures/question-stops");
const { stops } = JSON.parse(fs.readFileSync(path.join(fixtureDir, "stops.json"), "utf8")) as {
  stops: FixtureStop[];
};
const { placements } = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "holdout-placements.json"), "utf8"),
) as { placements: Placement[] };

const ordered = [...stops].sort((a, b) => a.askedAt.localeCompare(b.askedAt));
const drafting = ordered.slice(0, 8);
const holdout = ordered.slice(8);

const stopKey = (s: { session: string; entry: number }) => `${s.session}@${s.entry}`;
const classById = new Map<string, DecisionClass>(AUTHORITY_CONTRACT.map((c) => [c.id, c]));

/** The one stop whose placement the assumption test fixed before drafting began. */
const GATE_STOP = "3d729ebc-348f-4d45-8f3c-25df1de8fbc9@129";

describe("the split is the one the assumption test named", () => {
  it("orders seventeen stops by askedAt into a drafting eight and a held-out nine", () => {
    expect(ordered).toHaveLength(17);
    expect(drafting).toHaveLength(8);
    expect(holdout).toHaveLength(9);
  });

  it("the committed cutoff is the newest drafting stop, and every held-out stop is after it", () => {
    expect(drafting[7].askedAt).toBe(AUTHORITY_DRAFTING_CUTOFF);
    for (const stop of holdout) {
      expect(
        stop.askedAt.localeCompare(AUTHORITY_DRAFTING_CUTOFF),
        `${stopKey(stop)} should be after the cutoff`,
      ).toBeGreaterThan(0);
    }
  });

  it("the gate-refusal stop is in the held-out nine, where the assumption test says it is", () => {
    expect(holdout.map(stopKey)).toContain(GATE_STOP);
  });
});

describe("the contract was drafted from the older half only", () => {
  const draftingKeys = new Set(drafting.map(stopKey));

  it("every citation resolves to a drafting stop — no class drafted from the holdout", () => {
    for (const c of AUTHORITY_CONTRACT) {
      for (const cite of c.draftedFrom) {
        expect(draftingKeys.has(cite), `${c.id} cites ${cite}, which is not in the drafting eight`).toBe(
          true,
        );
      }
    }
  });

  it("every class except the fixed one cites at least one drafting stop", () => {
    for (const c of AUTHORITY_CONTRACT) {
      if (c.fixedBeforeDrafting) continue;
      expect(c.draftedFrom.length, `${c.id} cites nothing — a clause from nowhere`).toBeGreaterThan(0);
    }
  });

  it("exactly one class is fixed before drafting: governance, stop-and-cite, citing nothing", () => {
    const fixed = AUTHORITY_CONTRACT.filter((c) => c.fixedBeforeDrafting);
    expect(fixed).toHaveLength(1);
    expect(fixed[0].id).toBe("authority:governance");
    expect(fixed[0].ruling).toBe("stop-and-cite");
    expect(fixed[0].draftedFrom).toEqual([]);
  });

  it("class ids are unique, and every proceed clause states the default compute takes", () => {
    expect(classById.size).toBe(AUTHORITY_CONTRACT.length);
    for (const c of AUTHORITY_CONTRACT) {
      if (c.ruling === "proceed") {
        expect(c.defaultUnderClause, `${c.id} proceeds without a stated default`).toBeTruthy();
      }
    }
  });
});

describe("placing the held-out nine against the sealed classes", () => {
  it("places each held-out stop exactly once, and no others", () => {
    expect([...placements.map(stopKey)].sort()).toEqual([...holdout.map(stopKey)].sort());
  });

  it("invents no new class — every placement cites a committed clause or is uncovered", () => {
    for (const p of placements) {
      if (p.class === null) continue;
      expect(classById.has(p.class), `${stopKey(p)} placed in unknown class ${p.class}`).toBe(true);
    }
  });

  it("covers at least 6 of the 9 (pre-committed bar; below it the taxonomy did not generalize)", () => {
    const covered = placements.filter((p) => p.class !== null);
    const detail = placements
      .map((p) => `${p.class === null ? "UNCOVERED" : `  ${p.class}`}  ${stopKey(p)}`)
      .join("\n");
    expect(covered.length, `\n${detail}\n`).toBeGreaterThanOrEqual(6);
  });

  it("lands at least 4 of the 9 in a proceed class (pre-committed bar; all-stop coverage buys nothing)", () => {
    const proceed = placements.filter(
      (p) => p.class !== null && classById.get(p.class)?.ruling === "proceed",
    );
    const detail = placements
      .map((p) => {
        const ruling = p.class === null ? "uncovered" : classById.get(p.class)?.ruling;
        return `  ${ruling}  ${stopKey(p)}`;
      })
      .join("\n");
    expect(proceed.length, `\n${detail}\n`).toBeGreaterThanOrEqual(4);
  });

  it("places the gate-refusal stop in governance, stop-and-cite — anywhere else refutes the contract's safety", () => {
    const p = placements.find((x) => stopKey(x) === GATE_STOP);
    expect(p, `no placement for ${GATE_STOP}`).toBeDefined();
    expect(p!.class, "the gate-refusal stop escaped the governance class").toBe("authority:governance");
    const cls = classById.get(p!.class!)!;
    expect(cls.ruling).toBe("stop-and-cite");
    expect(cls.fixedBeforeDrafting).toBe(true);
  });
});

describe("the contract is a document a run can consult at a fork", () => {
  it("renders every clause with its id and ruling, proceed clauses with their default", () => {
    const doc = renderAuthorityContract();
    for (const c of AUTHORITY_CONTRACT) {
      expect(doc).toContain(`[${c.id}]`);
      expect(doc).toContain(c.ruling.toUpperCase());
      if (c.defaultUnderClause) expect(doc).toContain(c.defaultUnderClause);
    }
  });
});
