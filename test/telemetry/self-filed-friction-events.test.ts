/**
 * "Five-pass count of self-filed friction events" — the assumption test beneath
 * "In-the-moment friction events filed by the agent".
 *
 * Three clauses were fixed before anything was counted: **≥1 event filed per pass
 * across five passes**, **every event actionable**, and **unfiled-to-filed below
 * 2:1**. This file settles the first two and refuses the third, which needs a human
 * reading the same five transcripts for friction that left no record.
 *
 * ## What this file proves, and what it does not
 *
 * Say it plainly, because the shape is easy to over-read. The five-pass corpus below
 * is written **by this test, through the real writer**. So what the per-pass clause
 * demonstrates here is that a pass which files can be counted, that a pass which does
 * not is *named* rather than averaged away, and that the writer and the reader agree
 * about what a filing is. It does **not** show that the agent files under load. No
 * vitest file can: that is a fact about sessions, not about code.
 *
 * The reading that does bear on the world is `describe("the archive")` at the bottom,
 * over `test/fixtures/self-filed-friction/archive` — every friction event the agent
 * had actually filed when this was written, six of them, and its finding is that the
 * question the assumption test asks **could not be asked of that archive at all**: not
 * one filing says which pass it came from. That is the gap `FrictionFiling.pass`
 * closes, and until filings carrying it accumulate, the honest per-pass answer over
 * the real record is uncountable rather than zero.
 *
 * ## The controls are what keep the rest of it honest
 *
 * A census that answered "met" to everything would satisfy the five-pass corpus, and
 * one that answered "not met" to everything would satisfy the archive. So every clause
 * is asserted in both directions — a silent pass, a bare-prose filing, a filing from
 * outside the window, a corpus of four passes — and the rule's own shape is asserted
 * too, so that a later edit to a bar shows up here as a changed expectation rather
 * than as a quietly different finding.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { FRICTION_CHANNEL_PATH } from "../../src/adapters/channels.js";
import { fileFriction, type FrictionFiling } from "../../src/adapters/friction.js";
import { defaultConfigYaml } from "../../src/config/schema.js";
import {
  formatSelfFiledFrictionCensus,
  readSelfFiledFriction,
  SELF_FILED_FRICTION_RULE,
  selfFiledFrictionCensus,
} from "../../src/telemetry/self-filed-friction.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const archiveDir = path.join(repoRoot, "test", "fixtures", "self-filed-friction", "archive");

let vault: string;
const friction = () => path.join(vault, FRICTION_CHANNEL_PATH);

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-self-filed-friction-"));
  fs.writeFileSync(path.join(vault, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

/** Five ordinary passes, named the way the loop names them. */
const PASSES = ["pass-1", "pass-2", "pass-3", "pass-4", "pass-5"];

/** A filing with everything the writer demands, so a test can vary one thing at a time. */
function filing(overrides: Partial<FrictionFiling> = {}): FrictionFiling {
  return {
    kind: "blocked",
    note: "could not find the vault from the repo",
    tool: "ost-agent check",
    input: "--vault (omitted)",
    expected: "it reads ost.vault.yaml and finds the tree",
    ...overrides,
  };
}

/** File one event per pass, the shape the assumption predicts. */
function fileOnePerPass(passes: readonly string[] = PASSES): void {
  passes.forEach((pass, i) => {
    fileFriction(vault, filing({ pass, note: `friction number ${i + 1}`, at: `2026-08-2${i}T10:00:00.000Z` }));
  });
}

describe("the rule, as it was committed", () => {
  /**
   * Asserted rather than assumed. Every number this file reports is read against
   * these, and a bar edited to fit a result is the one failure mode an instrument
   * cannot survive — so it has to break this test to move.
   */
  test("states the bars the assumption test fixed, and names the clause it refuses", () => {
    expect(SELF_FILED_FRICTION_RULE.passes).toBe(5);
    expect(SELF_FILED_FRICTION_RULE.perPassFloor).toBe(1);
    expect(SELF_FILED_FRICTION_RULE.actionableShare).toBe(1);
    expect([...SELF_FILED_FRICTION_RULE.actionableFields]).toEqual(["tool", "input", "expected"]);
    expect(SELF_FILED_FRICTION_RULE.refuses).toMatch(/unfiled-to-filed/);
  });
});

describe("clause 1 — at least one event per pass, across five passes", () => {
  test("five passes that each filed once clear the floor, and the bar", () => {
    fileOnePerPass();

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.passesRead).toBe(5);
    expect(census.enoughPasses).toBe(true);
    expect(census.filed).toBe(5);
    expect(census.silentPasses).toEqual([]);
    expect(census.meetsPerPassFloor).toBe(true);
    expect(census.meetsActionableShare).toBe(true);
    expect(census.meetsBar).toBe(true);

    // Non-vacuity: the five are five DISTINCT passes each holding its own filing,
    // not five filings the census happened to spread. Without this, one pass that
    // filed five times would satisfy every assertion above.
    expect(census.passes.map((p) => p.events.length)).toEqual([1, 1, 1, 1, 1]);
    expect(new Set(census.passes.map((p) => p.pass)).size).toBe(5);
  });

  /**
   * The control the floor exists for. A mean of 0.8 events per pass reads as
   * "nearly there"; the pass that filed nothing is the entire finding, and it has
   * to come out by name.
   */
  test("one silent pass fails the floor and is named, not averaged away", () => {
    fileOnePerPass(["pass-1", "pass-2", "pass-4", "pass-5"]);
    // pass-3 filed nothing; pass-5 filed twice, so the total still clears 5.
    fileFriction(vault, filing({ pass: "pass-5", note: "a second one from the last pass" }));

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.filed).toBe(5);
    expect(census.silentPasses).toEqual(["pass-3"]);
    expect(census.meetsPerPassFloor).toBe(false);
    expect(census.meetsBar).toBe(false);
    expect(formatSelfFiledFrictionCensus(census)).toContain("filed nothing");
  });

  /**
   * The passes are supplied, never inferred from the filings. Inferring them would
   * define a pass as one that filed, making the floor true by construction — a
   * census that can only ever report the thing it was built to detect the absence of.
   */
  test("a pass that filed nothing still appears in the census", () => {
    fileOnePerPass(["pass-1"]);

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.passes).toHaveLength(5);
    expect(census.silentPasses).toEqual(["pass-2", "pass-3", "pass-4", "pass-5"]);
  });

  test("a filing from outside the window is not counted for any pass in it", () => {
    fileOnePerPass(["pass-1", "pass-2", "pass-3", "pass-4"]);
    fileFriction(vault, filing({ pass: "pass-9", note: "from a pass this window never asked about" }));

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.filed).toBe(4);
    expect(census.silentPasses).toEqual(["pass-5"]);
    expect(census.unattributed).toEqual([]); // it has a pass — just not one of these
  });

  /**
   * Coverage leads, exactly as it does in the hand-exclusion census. Four passes
   * that each filed is not a five-pass result that came out low; it is not a
   * five-pass result.
   */
  test("four passes cannot clear a five-pass bar even when every one of them filed", () => {
    const four = PASSES.slice(0, 4);
    fileOnePerPass(four);

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), four);

    expect(census.meetsPerPassFloor).toBe(true);
    expect(census.meetsActionableShare).toBe(true);
    expect(census.enoughPasses).toBe(false);
    expect(census.meetsBar).toBe(false);
    expect(formatSelfFiledFrictionCensus(census)).toContain("NOT enough to read it");
  });
});

describe("clause 2 — every event carries the tool, the failing input and what was expected", () => {
  test("the three fields survive the round trip from writer to census", () => {
    const written = fileFriction(
      vault,
      filing({
        pass: "pass-1",
        tool: "Read",
        input: "/Users/x/dev/OST-Agent/src/cli/index.ts with a trailing comma in the JSON",
        expected: "the file, or an error naming the offending character",
      }),
    );

    const [event] = readSelfFiledFriction(friction());

    expect(event.file).toBe(path.basename(written));
    expect(event.pass).toBe("pass-1");
    expect(event.tool).toBe("Read");
    expect(event.input).toContain("trailing comma");
    expect(event.expected).toContain("offending character");
    expect(event.actionable).toBe(true);
    expect(event.missing).toEqual([]);
  });

  /**
   * Bare prose fails at the writer, not merely at the census. Scoring the shape
   * afterwards leaves the affordance free to keep producing prose, which is what
   * the archive shows it did six times out of six.
   */
  test("the writer refuses a filing made of bare prose, and names all three fields at once", () => {
    expect(() =>
      fileFriction(vault, { kind: "blocked", note: "everything is broken", tool: "", input: "", expected: "" }),
    ).toThrow(/tool.*failing input.*expected/s);

    // One missing field is refused as firmly as three, and the list names only it —
    // matched up to the dash, because the sentence that follows always names all
    // three as guidance and would make any looser assertion pass on anything.
    expect(() => fileFriction(vault, { ...filing(), expected: "   " })).toThrow(/needs expected —/);
    expect(() => fileFriction(vault, { ...filing(), tool: "" })).toThrow(/needs tool —/);

    // Non-vacuity: nothing reached disk on either attempt.
    expect(readSelfFiledFriction(friction())).toEqual([]);
  });

  /**
   * The census still has to read prose, because the archive is full of it and a
   * filing written past the CLI by hand is prose the writer never saw.
   */
  test("a prose filing on disk reads back unactionable, and drags the share below the bar", () => {
    fileOnePerPass(["pass-1", "pass-2", "pass-3", "pass-4"]);
    fs.writeFileSync(
      path.join(friction(), "2026-08-20-friction-written-by-hand.md"),
      ["# Friction (blocked): it just did not work", "", "- **kind:** blocked", "- **filed:** 2026-08-20T09:00:00.000Z", "- **pass:** pass-5", ""].join("\n"),
      "utf8",
    );

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    // Every pass filed — the floor is met, and the bar still is not.
    expect(census.meetsPerPassFloor).toBe(true);
    expect(census.filed).toBe(5);
    expect(census.actionable).toBe(4);
    expect(census.actionableShare).toBeCloseTo(0.8);
    expect(census.meetsActionableShare).toBe(false);
    expect(census.meetsBar).toBe(false);

    const prose = census.passes.find((p) => p.pass === "pass-5")?.events[0];
    expect(prose?.missing).toEqual(["no tool named", "no failing input", "no expectation stated"]);
  });

  /**
   * A filing's own note is operator prose and quotes these words routinely — the
   * archive holds one whose first sentence is about a missing tool. A reader that
   * searched the body rather than the bullet would lift that sentence as the field
   * and score the filing actionable.
   */
  test("the field labels are read off their own bullets, never out of the note", () => {
    fs.mkdirSync(friction(), { recursive: true });
    fs.writeFileSync(
      path.join(friction(), "2026-08-20-friction-quoting-itself.md"),
      [
        "# Friction (blocked): the tool: Bash reported expected: 0 and failing input: none",
        "",
        "- **kind:** blocked",
        "- **filed:** 2026-08-20T09:00:00.000Z",
        "",
        "**Context:** - **tool:** Bash",
        "",
      ].join("\n"),
      "utf8",
    );

    const [event] = readSelfFiledFriction(friction());

    // The `- **tool:**` inside the context line is at the start of no line of its
    // own, so it is prose about a filing rather than a filing's field.
    expect(event.tool).toBeUndefined();
    expect(event.actionable).toBe(false);
    expect(event.missing).toHaveLength(3);
  });
});

describe("filings that name no pass", () => {
  /**
   * The distinction the whole per-pass count turns on. An unattributed filing is
   * evidence the agent DID file; counting it as a pass that filed nothing would
   * turn the record of a filing into evidence against filing, which is the exact
   * inversion the archive would have produced.
   */
  test("are counted apart, credited to no pass, and never become a silent pass", () => {
    fileOnePerPass();
    fileFriction(vault, filing({ note: "filed with no pass id in the environment" }));

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.unattributed).toHaveLength(1);
    expect(census.unattributed[0].note).toContain("no pass id");
    expect(census.filed).toBe(5); // not 6 — it belongs to no pass in the window
    expect(census.silentPasses).toEqual([]);
    expect(formatSelfFiledFrictionCensus(census)).toContain("cannot be counted per pass");
  });

  test("cannot carry a pass over the floor on their own", () => {
    for (let i = 0; i < 10; i++) fileFriction(vault, filing({ note: `unattributed number ${i}` }));

    const census = selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES);

    expect(census.unattributed).toHaveLength(10);
    expect(census.filed).toBe(0);
    expect(census.actionableShare).toBeNull();
    expect(census.meetsBar).toBe(false);
  });
});

describe("the archive — every friction event the agent had actually filed", () => {
  const archive = () => readSelfFiledFriction(archiveDir);

  /**
   * The count is asserted so that a later re-cut of the fixture cannot quietly
   * become a selection. `PROVENANCE.md` sits in the same folder and is not one of
   * them: it carries no `kind` and no `filed`, so it is a note about filings rather
   * than a filing, which is also how a stray file dropped into the real channel
   * behaves.
   */
  test("is six filings, and the note beside them is not counted as a seventh", () => {
    expect(archive()).toHaveLength(6);
    expect(fs.existsSync(path.join(archiveDir, "PROVENANCE.md"))).toBe(true);
    expect(archive().map((e) => e.file)).not.toContain("PROVENANCE.md");
  });

  /**
   * The finding this fixture exists for. Not one filing says which pass it came
   * from, so the per-pass count the assumption test is named for was never merely
   * un-run against this archive — it was not computable from it.
   */
  test("names no pass at all, so the per-pass question cannot be asked of it", () => {
    const events = archive();

    expect(events.filter((e) => e.pass)).toEqual([]);

    const census = selfFiledFrictionCensus(events, PASSES);
    expect(census.unattributed).toHaveLength(6);
    expect(census.filed).toBe(0);
    // Uncountable, not zero: six filings exist and none of them is evidence about
    // any of these five passes, in either direction.
    expect(census.actionableShare).toBeNull();
    expect(census.meetsBar).toBe(false);
  });

  /**
   * The node's usability assumption — "that a one-line note carries enough context
   * to be actionable later" — settled in the negative, six for six, against the
   * only record there is. This is why the writer now refuses a filing without the
   * fields instead of scoring one after the fact.
   */
  test("is zero-for-six on the fields that make a filing actionable", () => {
    const events = archive();

    expect(events.filter((e) => e.actionable)).toEqual([]);
    expect(events.every((e) => e.missing.length === 3)).toBe(true);
  });

  /** It is a real archive, not an empty folder the assertions above pass over. */
  test("is nonetheless a corpus of genuine filings, with kinds and dates", () => {
    const events = archive();

    expect(events.every((e) => e.note.length > 0)).toBe(true);
    expect(events.every((e) => e.kind !== "unknown")).toBe(true);
    expect([...new Set(events.map((e) => e.at.slice(0, 10)))].sort()).toEqual(["2026-08-01", "2026-08-10"]);
  });
});

describe("the report an operator reads", () => {
  /**
   * The refusal is printed on a MET bar too. A report that ended on "BAR MET" would
   * read as the assumption confirmed, and the clause that decides whether
   * self-reporting can stand alone is the one not in the output.
   */
  test("says what it could not settle, even when both computable clauses are met", () => {
    fileOnePerPass();

    const report = formatSelfFiledFrictionCensus(selfFiledFrictionCensus(readSelfFiledFriction(friction()), PASSES));

    expect(report).toContain("Bar (both computable clauses): MET");
    expect(report).toContain("Not settled");
    expect(report).toContain("unfiled-to-filed");
    expect(report).toContain("supplement to retrospective harvesting");
  });
});
