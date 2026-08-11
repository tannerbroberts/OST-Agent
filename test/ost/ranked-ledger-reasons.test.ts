/**
 * The whole-tree ranked ledger refuses to publish a row without its reason.
 *
 * This is the instrument for the tree node "A whole-tree ranked ledger that
 * refuses to publish a row without its reason", under the assumption test "Do
 * written reasons get challenged, or only read". The spec is the node's own
 * sentence: a row whose reason is missing, empty, or cites no node title or
 * evidence id is refused a rank and lands in the explicitly-named unranked
 * tail — a gap in the reasoning shows up as a gap in the list, never as a
 * confident position.
 *
 * What a green here does not settle, and the node says so itself: whether the
 * sentence beside a rank is true, or whether a reader ever argues with it.
 * Compute can force every published row to carry a resolving citation; whether
 * reasons get challenged rather than skimmed is measurable only by watching an
 * operator, and that is the assumption test's human lane, not this suite.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  composeRankedLedger,
  ledgerWorld,
  publishRankedLedger,
  rankedLedgerPath,
  readRankedLedger,
  reasonProblem,
  RANKED_LEDGER_FILENAME,
  UNRANKED_HEADING,
  type LedgerWorld,
} from "../../src/ost/ranked-ledger.js";
import { Vault } from "../../src/ost/vault.js";
import { writeEvidence } from "../../src/processes/tree.js";

const DATE = "2026-08-11";
const OPPORTUNITY = "Users churn after week one";
const SOLUTION_A = "Onboarding checklist";
const SOLUTION_B = "Weekly digest email";
const SOLUTION_C = "In-app progress bar";
const EVIDENCE_ID = "INBOX:churn-interview-notes.md";

let dir: string;
let vault: Vault;

/** A vault with one opportunity, three rankable solutions, one stored evidence record. */
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ledger-"));
  vault = new Vault(dir);
  vault.createNode({ title: OPPORTUNITY, layer: "Opportunity", evidence: "assertion", body: "x", tags: [], links: [] });
  for (const s of [SOLUTION_A, SOLUTION_B, SOLUTION_C]) {
    vault.createNode({ title: s, layer: "Solution", evidence: "assertion", body: "x", tags: [], links: [] });
  }
  writeEvidence(
    dir,
    { id: EVIDENCE_ID, source: EVIDENCE_ID, title: "Churn interview", timestamp: "2026-08-01", body: "b" },
    "inbox",
  );
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const world = (): LedgerWorld => ledgerWorld(dir);

describe("a row without its reason is refused a rank", () => {
  test("a missing reason lands in the unranked tail, not in a position", () => {
    const l = composeRankedLedger([{ title: SOLUTION_A }], world(), DATE);
    expect(l.ranked).toEqual([]);
    expect(l.unranked).toContainEqual({ title: SOLUTION_A, problem: "no reason was written" });
  });

  test("an empty or whitespace reason is refused the same way", () => {
    for (const reason of ["", "   \n\t"]) {
      const l = composeRankedLedger([{ title: SOLUTION_A, reason }], world(), DATE);
      expect(l.ranked).toEqual([]);
      expect(l.unranked[0]).toMatchObject({ title: SOLUTION_A });
    }
  });

  test("fluent prose that cites nothing is the null result, and it is refused", () => {
    // The exact failure the mechanism exists to catch: a confident sentence
    // with no checkable anchor. It must read as a gap, not as a rank.
    const l = composeRankedLedger(
      [{ title: SOLUTION_A, reason: "Clearly the highest-leverage item; everything else depends on it." }],
      world(),
      DATE,
    );
    expect(l.ranked).toEqual([]);
    expect(l.unranked[0].problem).toBe("the reason cites no node title or evidence id");
  });

  test("a wikilink to a title that is not in the tree cites nothing", () => {
    const l = composeRankedLedger(
      [{ title: SOLUTION_A, reason: "Unblocks [[A Node I Just Made Up]] immediately." }],
      world(),
      DATE,
    );
    expect(l.ranked).toEqual([]);
    expect(l.unranked[0].problem).toContain("[[A Node I Just Made Up]]");
  });

  test("an evidence-shaped id that resolves to no stored record cites nothing", () => {
    const l = composeRankedLedger(
      [{ title: SOLUTION_A, reason: "INBOX:no-such-record.md says users asked for this." }],
      world(),
      DATE,
    );
    expect(l.ranked).toEqual([]);
    expect(l.unranked[0].problem).toContain("INBOX:no-such-record.md");
  });
});

describe("a row whose reason cites something real is ranked", () => {
  test("citing a live node title earns a rank", () => {
    const l = composeRankedLedger(
      [{ title: SOLUTION_A, reason: `Directly serves [[${OPPORTUNITY}]], the widest live opportunity.` }],
      world(),
      DATE,
    );
    expect(l.ranked).toEqual([
      { rank: 1, title: SOLUTION_A, reason: `Directly serves [[${OPPORTUNITY}]], the widest live opportunity.` },
    ]);
  });

  test("citing a stored evidence id earns a rank", () => {
    const l = composeRankedLedger(
      [{ title: SOLUTION_B, reason: `Three of five interviewees asked for it (${EVIDENCE_ID}).` }],
      world(),
      DATE,
    );
    expect(l.ranked).toHaveLength(1);
    expect(l.ranked[0]).toMatchObject({ rank: 1, title: SOLUTION_B });
  });

  test("ranks are contiguous over the survivors: a refused row is a gap, not a position", () => {
    const l = composeRankedLedger(
      [
        { title: SOLUTION_A, reason: `Serves [[${OPPORTUNITY}]].` },
        { title: SOLUTION_B, reason: "Feels important." }, // citation-free — refused
        { title: SOLUTION_C, reason: `Also serves [[${OPPORTUNITY}]], but needs the checklist first.` },
      ],
      world(),
      DATE,
    );
    expect(l.ranked.map((r) => [r.rank, r.title])).toEqual([
      [1, SOLUTION_A],
      [2, SOLUTION_C],
    ]);
    expect(l.unranked.map((u) => u.title)).toContain(SOLUTION_B);
  });
});

describe("whole tree, not a single pick", () => {
  test("a rankable node nobody submitted appears in the tail, named as never submitted", () => {
    const l = composeRankedLedger([{ title: SOLUTION_A, reason: `Serves [[${OPPORTUNITY}]].` }], world(), DATE);
    expect(l.unranked).toContainEqual({ title: SOLUTION_B, problem: "never submitted — no reason was offered" });
    expect(l.unranked).toContainEqual({ title: SOLUTION_C, problem: "never submitted — no reason was offered" });
  });

  test("a row naming something that is not a rankable node refuses the whole write", () => {
    expect(() => composeRankedLedger([{ title: "Phantom feature", reason: "x" }], world(), DATE)).toThrow(
      /not a live Solution node/,
    );
    // An Opportunity is a real node, but not a rankable row either.
    expect(() => composeRankedLedger([{ title: OPPORTUNITY, reason: "x" }], world(), DATE)).toThrow(
      /not a live Solution node/,
    );
  });

  test("two rows for one node refuse the whole write", () => {
    const row = { title: SOLUTION_A, reason: `Serves [[${OPPORTUNITY}]].` };
    expect(() => composeRankedLedger([row, row], world(), DATE)).toThrow(/two rows name/);
  });
});

describe("the published file", () => {
  test("publishes to the one stable address, with the tail explicitly named", () => {
    const p = publishRankedLedger(
      dir,
      [
        { title: SOLUTION_A, reason: `Serves [[${OPPORTUNITY}]].` },
        { title: SOLUTION_B, reason: "No citation here." },
      ],
      DATE,
    );
    expect(p).toBe(rankedLedgerPath(dir));
    expect(p).toBe(path.join(dir, ".ost-agent", RANKED_LEDGER_FILENAME));

    const raw = readRankedLedger(dir) as string;
    expect(raw).toContain(UNRANKED_HEADING);
    // The ranked row carries its reason beside its rank…
    expect(raw).toContain(`1. **${SOLUTION_A}** — Serves [[${OPPORTUNITY}]].`);
    // …and the refused row sits under the named tail with its problem, not a rank.
    expect(raw).toMatch(new RegExp(`${UNRANKED_HEADING}[\\s\\S]*\\*\\*${SOLUTION_B}\\*\\*`));
    expect(raw).not.toContain(`**${SOLUTION_B}** — No citation here.`);
  });

  test("there is no ledger until one is published", () => {
    expect(readRankedLedger(dir)).toBeNull();
  });
});
