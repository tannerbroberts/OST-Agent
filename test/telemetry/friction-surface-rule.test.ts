/**
 * "Replay all 29 records through the surface rule and see what it keeps" — the
 * assumption test beneath "Only friction touching the product's own surface is
 * filed; the rest is counted".
 *
 * The solution proposes scoping the friction filter by what the failing call was
 * against: a failure on this product's own tools becomes an evidence record, a
 * failure on a shell, an editor or a script runner becomes a number in a tally.
 * The assumption beneath it is that **the surface of the call is a cheap
 * mechanical proxy for relevance**, and the test fixed both bars before the corpus
 * was replayed: keep ≥4 of the 5 records a pass judged to carry a product need,
 * and demote ≥20 of the 24 it judged not to.
 *
 * ## The finding
 *
 * The rule keeps **1 of 5** and demotes **24 of 24**. It is perfectly precise and
 * almost entirely blind, and it fails the assumption test on the clause that
 * matters. The four needs it throws away are the ones the test predicted it would:
 * a session whose whole content is a shell-quoting slip, a session that hit the
 * same blocked-poll refusal twice, a two-minute timeout waiting on a check that
 * cannot be subscribed to, and eight forced clarifying questions. Every one is
 * friction on the *harness*, and every one was distilled into a node.
 *
 * The test node asked for that outcome to be recorded as a caveat rather than a
 * pass. It is stronger than a caveat: on this corpus the rule's precision is
 * bought entirely by keeping one record — the machine usage rollup, the only
 * record in 29 that names this product's tools at all.
 *
 * ## Green here does not mean the rule is good
 *
 * This file is green when the rule runs, keeps what touches this product's
 * surface, and **counts** the rest instead of discarding it — which is what the
 * solution node's definition of done says. The bar being NOT MET is asserted as
 * the finding. A later edit that made `meetsBar` true would have to change either
 * the rule or the judgement, and both show up here as a changed expectation rather
 * than as a quietly different result.
 *
 * ## The controls are what keep it honest
 *
 * A rule that answered "foreign" to everything would demote 24 of 24 too. So the
 * synthetic cases assert both directions — a product tool is kept, a shell call
 * carrying an `ost-agent` command is kept, an `Edit` is not — and the corpus's own
 * two clean days are broken out, because a record with no failing call in it was
 * never demoted by the rule and must not be credited to its drop score.
 *
 * The generous bound is asserted for the same reason. Reading "the error text
 * names this product" as evidence recovers **zero** of the four lost needs and
 * costs six of the demotions, because the harness's own project directory is
 * called `OST-Agent` and appears in the path of every blocked-poll refusal. Both
 * readings of the rule fail; they just fail different clauses.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  applySurfaceRule,
  attributeEvent,
  commandOf,
  formatFrictionSurfaceReplay,
  FRICTION_SURFACE_RULE,
  frictionSurfaceReplay,
  MAX_IDS_SHOWN,
  parseFrictionRecord,
  readFrictionRecords,
  servedByThisProduct,
  surfaceRuleReading,
  type FrictionRecord,
  type JudgedRecord,
  type RecordEvent,
} from "../../src/telemetry/friction-surface.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "friction-surface-rule");

function ev(partial: Partial<RecordEvent> & { tool: string }): RecordEvent {
  return { kind: "tool_error", detail: "", command: "", ...partial };
}

function record(id: string, events: RecordEvent[]): FrictionRecord {
  return { id, file: `${id}.md`, kind: id.startsWith("USAGE:") ? "usage" : "transcript", events, truncated: false };
}

describe("the rule, pinned", () => {
  test("carries the two bars the assumption test fixed, and the population they are over", () => {
    expect(FRICTION_SURFACE_RULE.needs).toBe(5);
    expect(FRICTION_SURFACE_RULE.nonNeeds).toBe(24);
    expect(FRICTION_SURFACE_RULE.keepsBar).toBe(4);
    expect(FRICTION_SURFACE_RULE.dropsBar).toBe(20);
    expect(FRICTION_SURFACE_RULE.needs + FRICTION_SURFACE_RULE.nonNeeds).toBe(29);
  });

  test("takes its idea of this product's surface from the closed tool allowlist", () => {
    // Not a regex written here: a tool this repository builds is this
    // repository's surface, and the two sets are the same set by definition.
    expect(FRICTION_SURFACE_RULE.productTools.has("ost_create_node")).toBe(true);
    expect(FRICTION_SURFACE_RULE.productTools.has("git_commit")).toBe(true);
    expect(FRICTION_SURFACE_RULE.productTools.has("Bash")).toBe(false);
    expect(FRICTION_SURFACE_RULE.productTools.has("Edit")).toBe(false);
  });
});

describe("attributing one event", () => {
  test("a tool this product implements is certainly ours", () => {
    expect(attributeEvent(ev({ tool: "ost_annotate", detail: "no such node: probe" }))).toMatchObject({
      surface: "product",
      certainty: "certain",
    });
  });

  test("so is the same tool reached over MCP, however the plugin prefixes it", () => {
    expect(attributeEvent(ev({ tool: "mcp__plugin_ost-agent_ost-agent__ost_status" }))).toMatchObject({
      surface: "product",
      certainty: "certain",
    });
  });

  test("…and whatever the operator called the server, because the tool suffix is the authority", () => {
    // Found by running this census over the live vault: the meta vault registers
    // the server as `ostmeta`, so a server-name match demoted this product's own
    // MCP failures. `ost_set_evidence` is in the closed allowlist; the label in
    // front of it is the operator's choice and says nothing about whose tool it is.
    expect(servedByThisProduct("mcp__ostmeta__ost_set_evidence")).toBe(true);
    expect(attributeEvent(ev({ tool: "mcp__ostmeta__ost_set_evidence" })).surface).toBe("product");
    expect(servedByThisProduct("mcp__ostmeta__ost_not_a_real_tool")).toBe(false);
    expect(servedByThisProduct("mcp__github__create_pull_request")).toBe(false);
    expect(servedByThisProduct("Bash")).toBe(false);
  });

  test("the host's own tools are foreign, and this repository will never change their messages", () => {
    for (const tool of ["Edit", "Workflow", "AskUserQuestion", "Skill", "CronList", "TaskOutput"]) {
      expect(attributeEvent(ev({ tool, detail: "<tool_use_error>…</tool_use_error>" })).surface).toBe("foreign");
    }
  });

  test("a shell call is ours when the recorded command runs our CLI", () => {
    expect(attributeEvent(ev({ tool: "Bash", command: "ost-agent rollup --vault /tmp/v" }))).toMatchObject({
      surface: "product",
      certainty: "certain",
    });
    expect(attributeEvent(ev({ tool: "Bash", command: "node dist/ost-agent.mjs buildable x" })).surface).toBe("product");
  });

  test("a compound command that is only partly ours is `possible`, never `certain`", () => {
    expect(attributeEvent(ev({ tool: "Bash", command: "cd /tmp/v && ost-agent status" }))).toMatchObject({
      surface: "product",
      certainty: "possible",
    });
  });

  test("a shell call whose command runs no program of ours is foreign", () => {
    expect(attributeEvent(ev({ tool: "Bash", command: "npx vitest run" })).surface).toBe("foreign");
  });

  test("a shell call whose command the digest dropped is foreign — the cheap rule's blind spot", () => {
    // This is the shape of nearly every event in the record: the digest keeps the
    // error and throws the command away, so the tool name says `Bash` and nothing
    // more. A failing `ost-agent rollup` would look exactly like this.
    const blind = attributeEvent(ev({ tool: "Bash", detail: "Exit code 1 … (eval):1: == not found" }));
    expect(blind.surface).toBe("foreign");
    expect(blind.because).toMatch(/did not keep/);
  });

  test("a mention of this product in the error text buys the generous bound only", () => {
    const mention = attributeEvent(ev({ tool: "Bash", detail: "ls: /Users/tanner/dev/ost-agent-meta: No such file" }));
    expect(mention).toMatchObject({ surface: "product", certainty: "possible" });
    // …and it is a failing `ls`, which is exactly why it may not be `certain`.
    expect(applySurfaceRule(record("TRANSCRIPT:x", [ev({ tool: "Bash", detail: "ls: ost-agent-meta: nope" })]))).toMatchObject({
      disposition: "counted",
      dispositionUpperBound: "filed",
    });
  });
});

describe("applying the rule to one record", () => {
  test("one product-surface failure files the record, however many shell slips sit beside it", () => {
    const d = applySurfaceRule(
      record("TRANSCRIPT:mixed", [
        ev({ tool: "Bash", detail: "(eval):1: == not found" }),
        ev({ tool: "Edit", detail: "String to replace not found in file." }),
        ev({ tool: "ost_create_node", detail: "needs an evidence class" }),
      ]),
    );
    expect(d.disposition).toBe("filed");
    expect(d.productCertain).toBe(1);
  });

  test("a record with no product-surface failure is counted, with the reason said out loud", () => {
    const d = applySurfaceRule(record("TRANSCRIPT:noise", [ev({ tool: "Bash", detail: "(eval):1: == not found" })]));
    expect(d.disposition).toBe("counted");
    expect(d.reason).toBe("no failing call against this product's own surface");
  });

  test("a record with no failing call at all is distinguished from one the rule demoted", () => {
    const d = applySurfaceRule(record("USAGE:clean", []));
    expect(d.disposition).toBe("counted");
    expect(d.reason).toBe("no failing call to attribute");
    expect(d.failing).toBe(0);
  });
});

describe("reading the harvested records", () => {
  test("a transcript digest yields one event per bullet, with the tool the digest named", () => {
    const parsed = parseFrictionRecord(
      "TRANSCRIPT_x.md",
      [
        "---",
        "id: 'TRANSCRIPT:x'",
        "---",
        "Session `x` produced 2 friction events (tool_error ×1, retry ×1).",
        "",
        "All events shown.",
        "",
        "- **tool_error** (Bash): Exit code 1 … (eval):1: == not found",
        '- **retry** (Bash): {"command":"npx vitest run","description":"suite"}',
      ].join("\n"),
    );
    expect(parsed?.kind).toBe("transcript");
    expect(parsed?.events).toHaveLength(2);
    expect(parsed?.events[0]).toMatchObject({ kind: "tool_error", tool: "Bash", command: "" });
    // A `retry` records the tool's input as JSON, which is the one place a `Bash`
    // command survives the digest at all.
    expect(parsed?.events[1].command).toBe("npx vitest run");
  });

  test("a truncated digest says so, so a demotion can be read against the harvester's cap", () => {
    const parsed = parseFrictionRecord(
      "TRANSCRIPT_y.md",
      ["---", "id: 'TRANSCRIPT:y'", "---", "Showing the first 25; the rest are counted only.", "", "- **tool_error** (Bash): x"].join("\n"),
    );
    expect(parsed?.truncated).toBe(true);
  });

  test("a usage rollup yields its failing calls only — a successful ost_create_node is not friction", () => {
    const body = [
      "---",
      "id: 'USAGE:2026-07-26'",
      "---",
      "- **Calls:** 93 (31 ok, 62 failed)",
      "",
      "| Tool | Calls |",
      "| --- | --- |",
      "| ost_annotate | 75 |",
      "",
      "**Failed calls (redacted, first 3):**",
      "- `ost_annotate`: no such node: probe",
      "- `ost_create_node`: needs an evidence class",
    ].join("\n");
    const parsed = parseFrictionRecord("USAGE_2026-07-26.md", body);
    expect(parsed?.kind).toBe("usage");
    expect(parsed?.events.map((e) => e.tool)).toEqual(["ost_annotate", "ost_create_node"]);
  });

  test("a clean day yields no event, so it cannot be filed by having been busy", () => {
    const body = ["---", "id: 'USAGE:2026-07-25'", "---", "- **Calls:** 108 (108 ok, 0 failed)", "| ost_create_node | 32 |"].join("\n");
    expect(parseFrictionRecord("USAGE_2026-07-25.md", body)?.events).toEqual([]);
  });

  test("a note that is not a harvest is not read as one", () => {
    expect(parseFrictionRecord("INBOX_note.md", "---\nid: 'INBOX:note.md'\n---\nA human wrote this.")).toBeNull();
    expect(parseFrictionRecord("stray.md", "no frontmatter here")).toBeNull();
  });

  test("a clipped retry detail costs the command, never the event", () => {
    expect(commandOf('{"command":"npx vitest run","desc')).toBe("");
    expect(commandOf("Exit code 1 … nope")).toBe("");
  });
});

describe("nothing is discarded", () => {
  const records = [
    record("USAGE:filed", [ev({ tool: "ost_annotate", detail: "no such node" })]),
    record("TRANSCRIPT:a", [ev({ tool: "Bash", detail: "(eval):1: == not found" }), ev({ tool: "Edit", detail: "no match" })]),
    record("TRANSCRIPT:b", [ev({ tool: "CronList", detail: "{}", kind: "retry" })]),
  ];

  test("every record read comes out either filed or counted", () => {
    const reading = surfaceRuleReading(records);
    expect(reading.filed.length + reading.counted.length).toBe(reading.read);
    expect(reading.filed).toEqual(["USAGE:filed"]);
  });

  test("the tally holds every demoted event, grouped and traceable back to its records", () => {
    const reading = surfaceRuleReading(records);
    expect(reading.tally.records).toBe(2);
    expect(reading.tally.events).toBe(3);
    expect(reading.tally.byTool).toEqual([
      { tool: "Bash", n: 1 },
      { tool: "CronList", n: 1 },
      { tool: "Edit", n: 1 },
    ]);
    expect(reading.tally.byKind).toEqual([
      { kind: "tool_error", n: 2 },
      { kind: "retry", n: 1 },
    ]);
    expect(reading.tally.ids).toEqual(["TRANSCRIPT:a", "TRANSCRIPT:b"]);
  });
});

describe("scoring against a judgement", () => {
  test("a judgement row with no record, and a record with no judgement, are both named", () => {
    const replay = frictionSurfaceReplay(
      [record("TRANSCRIPT:present", [ev({ tool: "Bash", detail: "x" })])],
      [
        { id: "TRANSCRIPT:present", need: false, note: "" },
        { id: "TRANSCRIPT:gone", need: true, note: "" },
      ],
    );
    expect(replay.missing).toEqual(["TRANSCRIPT:gone"]);
    expect(replay.unjudged).toEqual([]);
    // The absent row is scored against nothing rather than counted as a miss:
    // a judgement about a record the corpus does not hold is not evidence
    // about the rule.
    expect(replay.keeps.of).toBe(0);
  });

  test("with no judgement at all the report says NOT SCORED, never NOT MET", () => {
    // Running the census over a whole vault with no judgement is a reading, and
    // it must not print a refutation. Found by running the CLI over the live
    // vault, where a `0/0 — NOT MET` line reported the rule as failed to anyone
    // who had not supplied the one input that can fail it.
    const replay = frictionSurfaceReplay([record("TRANSCRIPT:x", [ev({ tool: "Bash", detail: "boom" })])], []);
    expect(replay.judged).toBe(0);
    expect(replay.keeps.scored).toBe(false);
    expect(replay.drops.scored).toBe(false);
    const report = formatFrictionSurfaceReplay(replay);
    expect(report).toContain("Not scored: no record was judged");
    expect(report).not.toContain("NOT MET");
    // …and the unjudged line is suppressed rather than printing every id read.
    expect(report).not.toContain("In the corpus and unjudged");
  });

  test("long id lists are sampled, so one line cannot bury the two clauses under it", () => {
    const many = Array.from({ length: 20 }, (_, i) => record(`USAGE:${i}`, [ev({ tool: "ost_annotate", detail: "x" })]));
    const report = formatFrictionSurfaceReplay(
      frictionSurfaceReplay(many, many.map((r) => ({ id: r.id, need: false, note: "" }))),
    );
    expect(report).toContain(`… and ${20 - MAX_IDS_SHOWN} more`);
  });

  test("a rule that kept everything would fail the drop clause, not sail past it", () => {
    const kept = [1, 2, 3].map((n) => record(`USAGE:${n}`, [ev({ tool: "ost_annotate", detail: "x" })]));
    const judgement: JudgedRecord[] = kept.map((r) => ({ id: r.id, need: false, note: "" }));
    const replay = frictionSurfaceReplay(kept, judgement);
    expect(replay.drops.got).toBe(0);
    expect(replay.nonNeedsKept).toHaveLength(3);
  });
});

describe("the corpus — all 29 records of the 2026-08-02 pass", () => {
  const records = readFrictionRecords(path.join(fixtureDir, "records"));
  const judgement = JSON.parse(fs.readFileSync(path.join(fixtureDir, "judgement.json"), "utf8")).records as JudgedRecord[];
  const replay = frictionSurfaceReplay(records, judgement);

  test("is the 29 the assumption test names, and every one of them is judged", () => {
    expect(records).toHaveLength(29);
    expect(judgement).toHaveLength(29);
    expect(replay.missing).toEqual([]);
    expect(replay.unjudged).toEqual([]);
    expect(judgement.filter((j) => j.need)).toHaveLength(FRICTION_SURFACE_RULE.needs);
    expect(judgement.filter((j) => !j.need)).toHaveLength(FRICTION_SURFACE_RULE.nonNeeds);
  });

  test("no digest in it was truncated, so no demotion here is the harvester's cap", () => {
    expect(replay.truncated).toEqual([]);
  });

  test("nothing is discarded: 1 filed, 28 counted, 95 events kept in the tally", () => {
    const { reading } = replay;
    expect(reading.read).toBe(29);
    expect(reading.filed.length + reading.counted.length).toBe(29);
    expect(reading.tally.events).toBe(95);
    expect(reading.tally.events).toBe(
      reading.dispositions.filter((d) => d.disposition === "counted").reduce((n, d) => n + d.failing, 0),
    );
  });

  test("THE FINDING: it demotes 24 of 24 non-needs and keeps 1 of 5 needs — the bar is NOT MET", () => {
    expect(replay.drops).toMatchObject({ got: 24, of: 24, meets: true });
    expect(replay.keeps).toMatchObject({ got: 1, of: 5, meets: false });
    expect(replay.meetsBar).toBe(false);
  });

  test("the one record it keeps is the machine usage rollup — the only one naming our own tools", () => {
    expect(replay.reading.filed).toEqual(["USAGE:2026-07-26"]);
    expect(replay.nonNeedsKept).toEqual([]);
  });

  test("the four needs it throws away are the four the assumption test predicted", () => {
    expect(replay.needsDropped.sort()).toEqual([
      // one shell-quoting slip, the record that distilled the parent opportunity
      "TRANSCRIPT:08ab58d6-ac83-4b7a-abc6-129dd77376b9",
      // eight forced clarifying questions
      "TRANSCRIPT:16e9596b-7c8f-445b-a8ff-f822ed211ea5",
      // a shell slip and the blocked-poll refusal, rediscovered every session
      "TRANSCRIPT:5bbed804-1d15-44bd-8751-e1c0a87aed12",
      // two minutes spent waiting on a check that cannot be subscribed to
      "TRANSCRIPT:f48dc76d-9bb6-45c3-b624-5b386609d720",
    ]);
  });

  test("2 of the 24 demotions had no failing call to demote, and both readings still clear the drop bar", () => {
    // The census called 2026-07-25 "a clean day". 2026-07-27 is one too. Neither
    // was demoted by the rule — there was nothing in them to keep — so the drop
    // score is 22 of 24 on the strict reading of "demoted". Both clear 20, which
    // is why the choice is reported rather than argued.
    expect(replay.reading.nothingToJudge.sort()).toEqual(["USAGE:2026-07-25", "USAGE:2026-07-27"]);
    expect(replay.drops.got - replay.reading.nothingToJudge.length).toBeGreaterThanOrEqual(FRICTION_SURFACE_RULE.dropsBar);
  });

  test("dropping the two records that were already mapped a week earlier does not move the verdict", () => {
    // The census says it read 29 outstanding records. Two of them —
    // 5e5c119d and 8fc8d6e3 — were written into the vault's `mapped.json` on
    // 2026-07-25, seven days before the pass, so the outstanding set was 27.
    // See PROVENANCE.md. Both are non-needs and both are demoted either way, so
    // the miscount costs the denominator and nothing else — asserted rather than
    // argued, because a corpus that turned out to be 27 is a corpus a reader is
    // entitled to see re-scored.
    const alreadyMapped = new Set(["TRANSCRIPT:5e5c119d-e5e8-4dbd-ab7c-c4bfc1247a18", "TRANSCRIPT:8fc8d6e3-7cae-41e0-a83b-e32346e352b1"]);
    const rescored = frictionSurfaceReplay(
      records.filter((r) => !alreadyMapped.has(r.id)),
      judgement.filter((j) => !alreadyMapped.has(j.id)),
    );
    expect(rescored.reading.read).toBe(27);
    expect(rescored.drops).toMatchObject({ got: 22, of: 22, meets: true });
    expect(rescored.keeps).toMatchObject({ got: 1, of: 5, meets: false });
    expect(rescored.meetsBar).toBe(false);
  });

  test("the generous bound recovers no need and costs six demotions — both readings fail", () => {
    // Reading "the error text names this product" as evidence files six more
    // records and not one of them carries a need, because the harness's own
    // project directory is called `OST-Agent` and appears in the path inside
    // every blocked-poll refusal. The bound decides the drop clause and cannot
    // rescue the keep clause.
    expect(replay.keepsUpperBound).toMatchObject({ got: 1, of: 5, meets: false });
    expect(replay.dropsUpperBound).toMatchObject({ got: 18, of: 24, meets: false });
    expect(replay.boundDecides).toBe(true);
  });

  test("the report says what was counted and refuses to say the demotion was safe", () => {
    const report = formatFrictionSurfaceReplay(replay);
    expect(report).toContain("29 record(s) — 1 filed, 28 counted, 0 discarded");
    expect(report).toContain("needs kept: 1/5 — bar is 4, NOT MET");
    expect(report).toContain("non-needs demoted: 24/24 — bar is 20, MET");
    expect(report).toContain("Bar (both clauses): NOT MET");
    expect(report).toContain(FRICTION_SURFACE_RULE.refuses);
  });
});
