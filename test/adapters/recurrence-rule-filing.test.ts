/**
 * "Replay the same 29 records through the recurrence rule and count what files" —
 * the assumption test beneath "Recurrence across sessions files a record, a single
 * incident does not".
 *
 * The solution proposes making repetition the filing criterion: a one-off error is
 * counted and held, and the same error *shape* appearing across several distinct
 * sessions files one record carrying its count and its span. The assumption beneath
 * it has two halves — that repetition is a good enough proxy for significance, and
 * that "the same error shape" can be grouped mechanically. The test fixed the bar
 * before the corpus was replayed: **five or fewer records filed in total**, and the
 * two known patterns — the repeated refusal and the repeated poll — each surfacing
 * as a single record carrying its count and span.
 *
 * ## The finding: the hard half was easy and the easy half was not
 *
 * The node predicted the thirteen blocked sleep-then-poll refusals would be the
 * hard case, "because they differ in their sleep durations and their target
 * commands". They are — all fifteen of those events are distinct strings — and a
 * five-token head after redaction collapses every one of them. Grouping them cost
 * nothing but keying on the head instead of the whole message.
 *
 * The half the node called obvious is the one that does not hold. It says "ten
 * sessions saying `== not found` are obviously the same shape and any rule will
 * collapse them". In the corpus, `(eval):1: == not found` appears verbatim in
 * **five** sessions, not ten. The ten of the census is `== not found` *plus* four
 * other zsh diagnostics — `no matches found:`, `==== not found`, `parse error
 * near`, `invalid command code`, `cd:1: no such file` — which share no template and
 * are the same shape only under a human label like "zsh rejected what I typed".
 * This rule files two of those groups and holds three, and no redaction of
 * arguments will merge them, because what differs is not an argument.
 *
 * ## And what green here does not settle
 *
 * The rule reaches 2 of the 5 records the pass judged to carry a product need. The
 * three it misses are named below and one of them — the two-minute wait on a check
 * that cannot be subscribed to — misses by a single session. The record the
 * *surface* rule keeps, the machine usage rollup, is unreachable at every setting
 * of the bar. Both facts are asserted rather than described, because the comparison
 * between the two candidates is what the tree wants out of this and it is not the
 * filed count.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  formatRecurrenceReplay,
  formatShape,
  MAX_IDS_SHOWN,
  ordinal,
  RECURRENCE_RULE,
  readRecurrenceRecords,
  recurrenceReading,
  recurrenceReplay,
  redactArguments,
  shapeKeyOf,
  shapePrefix,
  timestampOf,
  type RecurrenceRecord,
} from "../../src/telemetry/friction-recurrence.js";
import type { JudgedRecord, RecordEvent } from "../../src/telemetry/friction-surface.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The same corpus the surface rule was judged on, verbatim. Identical material is
// the whole point: the two candidates are only comparable if neither picked its own.
const fixtureDir = path.join(repoRoot, "test", "fixtures", "friction-surface-rule");

const BLOCKED_POLL = "blocked: sleep <n> followed by:";
const SHELL_SLIP = "(eval):<n>: == not found";

function ev(partial: Partial<RecordEvent> & { detail: string }): RecordEvent {
  return { kind: "tool_error", tool: "Bash", command: "", ...partial };
}

function record(id: string, timestamp: string, events: RecordEvent[]): RecurrenceRecord {
  return { id, file: `${id}.md`, kind: "transcript", events, truncated: false, timestamp };
}

/**
 * A blocked sleep-then-poll refusal as the harness words it and as the harvester
 * records it — clipped to the same 223 characters every one of the fifteen real
 * events is clipped to, so a long command eats the tail here exactly as it does there.
 */
const HARVEST_CLIP = 222;
function blocked(sleep: number, command: string): RecordEvent {
  const full =
    `<tool_use_error>Blocked: sleep ${sleep} followed by: ${command}. To wait for a condition, use Monitor with an ` +
    "until-loop (e.g. `until <check>; do sleep 2; done`). To wait for a command you started, use run_in_background: true. " +
    "Do not chain shorter sleeps to work around this block.</tool_use_error>";
  return ev({ detail: full.length > HARVEST_CLIP ? `${full.slice(0, HARVEST_CLIP)}…` : full });
}

describe("the rule, pinned", () => {
  test("carries the bar the assumption test fixed and the population it is over", () => {
    expect(RECURRENCE_RULE.filedBar).toBe(5);
    expect(RECURRENCE_RULE.needs).toBe(5);
    expect(RECURRENCE_RULE.nonNeeds).toBe(24);
    expect(RECURRENCE_RULE.needs + RECURRENCE_RULE.nonNeeds).toBe(29);
  });

  test("files on distinct sessions, not on events — recurrence is the criterion", () => {
    expect(RECURRENCE_RULE.minSessions).toBe(3);
    expect(RECURRENCE_RULE.prefixTokens).toBe(5);
  });
});

describe("redacting a detail down to its shape", () => {
  test("the exit code, the harness wrapper, numbers, paths, urls and ids are this run, not this failure", () => {
    expect(redactArguments("Exit code 1 … (eval):1: == not found")).toBe("(eval):<n>: == not found");
    expect(redactArguments("<tool_use_error>String to replace not found in file.</tool_use_error>")).toBe(
      "String to replace not found in file.",
    );
    expect(redactArguments("cat: /Users/tanner/dev/OST-Agent/.gitignore: No such file")).toBe("cat: <path> No such file");
    expect(redactArguments("bundle-drift pass 14s https://github.com/x/y/runs/30555305754")).toBe("bundle-drift pass <n>s <url>");
    expect(redactArguments("session 5bbed804-1d15-44bd-8751-e1c0a87aed12 failed")).toBe("session <id> failed");
  });

  test("a glob is an argument too, so two globs that matched nothing are one shape", () => {
    expect(shapePrefix("Exit code 1 … (eval):1: no matches found: test/tmp*", 5)).toBe("(eval):<n>: no matches found: <path>");
    expect(shapePrefix("Exit code 1 … (eval):1: no matches found: src/vault/*.ts", 5)).toBe("(eval):<n>: no matches found: <path>");
  });
});

describe("the grouping clause — the half the node called the hard one", () => {
  const refusals = [
    blocked(45, "gh pr checks 8 | head -10"),
    // The real 470cb94a refusal, path and all — the one whose command is long
    // enough that the harvester's clip eats the instruction sentence entirely.
    blocked(
      240,
      "git status --porcelain wc -l ls /Users/tanner/.claude/projects/-Users-tanner-dev-OST-Agent/" +
        "470cb94a-d709-43b1-85aa-dedd917ac866/subagents/workflows/wf_452ccb28-61c/journal.jsonl",
    ),
    blocked(25, "tail -20 /Users/tanner/Library/Logs/ost-meta-loop.log"),
  ];

  test("three refusals with different sleeps and different target commands are one shape", () => {
    expect(new Set(refusals.map((r) => r.detail)).size).toBe(3);
    const keys = new Set(refusals.map((r) => shapeKeyOf(r, RECURRENCE_RULE.prefixTokens)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(`tool_error|Bash|${BLOCKED_POLL}`);
  });

  test("…which is grouping and not deduplication: exact-string matching files them as three", () => {
    // The distinction the node insisted on. A rule that only collapses identical
    // strings has shown that identical strings are detectable, not that repetition is.
    expect(new Set(refusals.map((r) => shapeKeyOf(r, RECURRENCE_RULE.prefixTokens, "identity"))).size).toBe(3);
  });

  test("the head is what groups them, and a longer key reaches into the command and splits them", () => {
    // The prefix length is the rule. At six tokens the key reaches `gh`/`git`/`tail`
    // — the embedded command — and the same three refusals become three shapes.
    expect(new Set(refusals.map((r) => shapeKeyOf(r, 6))).size).toBe(3);
  });

  test("the head and not the tail, because the harvester clips the invariant instruction off", () => {
    // The digest keeps roughly 200 characters. A long embedded command eats the
    // "To wait for a condition…" sentence that a tail-based rule would key on, and
    // how much survives is a function of the command's length rather than the failure.
    expect(refusals[1].detail).not.toContain("To wait for a condition");
    expect(refusals[0].detail).toContain("To wait for a condition");
    // …and the head groups them anyway, which is the whole reason it is the head.
    expect(shapeKeyOf(refusals[0], 5)).toBe(shapeKeyOf(refusals[1], 5));
  });

  test("two different failures do not merge just because both were redacted", () => {
    const slip = ev({ detail: "Exit code 1 … (eval):1: == not found" });
    const missing = ev({ detail: "Exit code 1 … cat: .gitignore: No such file or directory" });
    expect(shapeKeyOf(slip, 5)).not.toBe(shapeKeyOf(missing, 5));
    // …and a different tool is a different shape however alike the words are.
    expect(shapeKeyOf(ev({ tool: "Edit", detail: "not found" }), 5)).not.toBe(shapeKeyOf(ev({ detail: "not found" }), 5));
  });
});

describe("what files and what is held", () => {
  test("a shape that repeated nine times inside one session is a single incident, and is held", () => {
    const reading = recurrenceReading([
      record("TRANSCRIPT:one", "2026-07-30T13:52:39.136Z", Array.from({ length: 9 }, () => ev({ detail: "Exit code 1 … (eval):1: == not found" }))),
    ]);
    expect(reading.filed).toEqual([]);
    expect(reading.held).toHaveLength(1);
    expect(reading.held[0].events).toBe(9);
    expect(reading.held[0].sessions).toEqual(["TRANSCRIPT:one"]);
  });

  test("the same shape in three sessions files one record carrying its count and its span", () => {
    const reading = recurrenceReading([
      record("TRANSCRIPT:a", "2026-07-29T16:36:04.685Z", [blocked(45, "gh pr checks 8")]),
      record("TRANSCRIPT:b", "2026-07-30T00:55:25.831Z", [blocked(45, "gh pr checks 12 | head -10")]),
      record("TRANSCRIPT:c", "2026-08-02T16:13:47.037Z", [blocked(25, "tail -20 /tmp/loop.log"), blocked(60, "gh pr checks 30")]),
    ]);
    expect(reading.filed).toHaveLength(1);
    const [shape] = reading.filed;
    expect(shape.sessions).toEqual(["TRANSCRIPT:a", "TRANSCRIPT:b", "TRANSCRIPT:c"]);
    expect(shape.events).toBe(4);
    expect(shape.span).toMatchObject({ first: "2026-07-29T16:36:04.685Z", last: "2026-08-02T16:13:47.037Z", days: 4, undated: 0 });
  });

  test("nothing is discarded: every event is either in a filed shape or in a held one", () => {
    const reading = recurrenceReading([
      record("TRANSCRIPT:a", "2026-07-29T16:36:04.685Z", [blocked(45, "gh pr checks 8"), ev({ tool: "Edit", detail: "String to replace not found in file." })]),
      record("TRANSCRIPT:b", "2026-07-30T00:55:25.831Z", [blocked(45, "gh pr checks 12")]),
      record("TRANSCRIPT:c", "2026-08-02T16:13:47.037Z", [blocked(60, "gh pr checks 30")]),
    ]);
    expect(reading.filedEvents + reading.heldEvents).toBe(reading.events);
    expect(reading.events).toBe(4);
    expect(reading.held.map((s) => s.events)).toEqual([1]);
  });

  test("a record with no failing call is named rather than counted as a quiet one", () => {
    const reading = recurrenceReading([record("USAGE:clean", "2026-07-25T23:59:59.000Z", [])]);
    expect(reading.nothingToJudge).toEqual(["USAGE:clean"]);
    expect(reading.uncoveredRecords).toEqual(["USAGE:clean"]);
  });

  test("a record with no timestamp costs the span, never the count", () => {
    const reading = recurrenceReading([
      record("TRANSCRIPT:a", "", [blocked(45, "gh pr checks 8")]),
      record("TRANSCRIPT:b", "", [blocked(45, "gh pr checks 9")]),
      record("TRANSCRIPT:c", "", [blocked(45, "gh pr checks 10")]),
    ]);
    expect(reading.filed[0].sessions).toHaveLength(3);
    expect(reading.filed[0].span).toBeNull();
    expect(formatShape(reading.filed[0])).toContain("span unknown");
  });
});

describe("reading the harvested corpus", () => {
  test("the timestamp comes off the frontmatter, and a record without one reads as undated", () => {
    expect(timestampOf("---\nid: 'TRANSCRIPT:x'\ntimestamp: '2026-07-29T16:36:04.685Z'\n---\nbody")).toBe("2026-07-29T16:36:04.685Z");
    expect(timestampOf("---\nid: 'TRANSCRIPT:x'\n---\nbody")).toBe("");
  });
});

describe("the corpus — the same 29 records the surface rule was judged on", () => {
  const records = readRecurrenceRecords(path.join(fixtureDir, "records"));
  const judgement = JSON.parse(fs.readFileSync(path.join(fixtureDir, "judgement.json"), "utf8")).records as JudgedRecord[];
  const replay = recurrenceReplay(records, judgement);

  const filedBy = (prefix: string) => replay.reading.filed.filter((s) => s.prefix === prefix);

  test("is the 29 the assumption test names, every one of them judged and timestamped", () => {
    expect(records).toHaveLength(29);
    expect(judgement).toHaveLength(29);
    expect(replay.missing).toEqual([]);
    expect(replay.unjudged).toEqual([]);
    expect(records.filter((r) => !r.timestamp)).toEqual([]);
    expect(judgement.filter((j) => j.need)).toHaveLength(RECURRENCE_RULE.needs);
  });

  test("THE COUNT CLAUSE: 98 events over 29 records file 4 records — the bar is 5, and it is MET", () => {
    expect(replay.reading.events).toBe(98);
    expect(replay.filedRecords).toBe(4);
    expect(replay.filedRecords).toBeLessThanOrEqual(RECURRENCE_RULE.filedBar);
    expect(replay.meetsCountBar).toBe(true);
    // …and the held side is where the rest went, not the floor.
    expect(replay.reading.filedEvents + replay.reading.heldEvents).toBe(98);
    expect(replay.reading.held.length).toBeGreaterThan(replay.reading.filed.length);
  });

  test("THE REPEATED REFUSAL is one record carrying its count and its span", () => {
    const [refusal] = filedBy(SHELL_SLIP);
    expect(refusal).toBeDefined();
    expect(refusal.sessions).toHaveLength(5);
    expect(refusal.events).toBe(11);
    expect(refusal.span).toMatchObject({ first: "2026-07-29T16:36:04.685Z", last: "2026-07-30T15:32:38.222Z", days: 1 });
    // Five sessions, not the ten the node claims — see the file comment. The other
    // five of the census's ten are zsh diagnostics with a different template, and
    // three of those groups are held below the bar rather than merged into this one.
    expect(refusal.distinctDetails).toBe(1);
  });

  test("THE REPEATED POLL is one record too, and its fifteen events are fifteen different strings", () => {
    const [poll] = filedBy(BLOCKED_POLL);
    expect(poll).toBeDefined();
    expect(poll.sessions).toHaveLength(13);
    expect(poll.events).toBe(15);
    expect(poll.distinctDetails).toBe(15);
    expect(poll.span).toMatchObject({ first: "2026-07-29T14:54:30.937Z", last: "2026-08-02T16:13:47.037Z" });
    expect(poll.span?.days).toBeGreaterThan(4);
  });

  test("exact-string grouping at the same bar files 2 and finds neither the poll nor a shape it worded twice", () => {
    // The control for the whole rule. Deduplication files the shell slip (one
    // string in five sessions) and one Edit message that happened to repeat
    // verbatim; the thirteen refusals are invisible to it.
    expect(replay.identityFiled).toBe(2);
    const identity = recurrenceReading(records, { grouping: "identity" });
    expect(identity.filed.every((s) => s.distinctDetails === 1)).toBe(true);
    expect(identity.filed.some((s) => s.example.includes("Blocked: sleep"))).toBe(false);
  });

  test("the other two filed records are the Edit search drift and the glob that matched nothing", () => {
    expect(replay.reading.filed.map((s) => `${s.tool}: ${s.prefix}`)).toEqual([
      `Bash: ${BLOCKED_POLL}`,
      "Bash: (eval):<n>: == not found",
      "Edit: string to replace not found",
      "Bash: (eval):<n>: no matches found: <path>",
    ]);
  });

  test("THE FINDING: filing 4 records instead of 29 reaches 2 of the 5 judged needs", () => {
    expect(replay.needsCovered.sort()).toEqual([
      // one shell-quoting slip — the record that distilled the parent opportunity
      "TRANSCRIPT:08ab58d6-ac83-4b7a-abc6-129dd77376b9",
      // a shell slip and the blocked-poll refusal, rediscovered every session
      "TRANSCRIPT:5bbed804-1d15-44bd-8751-e1c0a87aed12",
    ]);
    expect(replay.needsMissed.sort()).toEqual([
      // eight forced clarifying questions, in one session
      "TRANSCRIPT:16e9596b-7c8f-445b-a8ff-f822ed211ea5",
      // two minutes spent waiting on a check that cannot be subscribed to
      "TRANSCRIPT:f48dc76d-9bb6-45c3-b624-5b386609d720",
      // 62 failed ost_annotate/ost_create_node calls in a machine rollup
      "USAGE:2026-07-26",
    ]);
  });

  test("two of the three misses are one session short of the bar, and lowering it costs the count clause", () => {
    const atTwo = recurrenceReplay(records, judgement, { minSessions: 2 });
    expect(atTwo.needsCovered).toHaveLength(4);
    expect(atTwo.filedRecords).toBe(13);
    expect(atTwo.meetsCountBar).toBe(false);
    // So the bar is a trade and not a discovery: the third and fourth need cost
    // nine more records to read, which is the thing the assumption test was
    // measuring when it capped the count.
  });

  test("the machine usage rollup is unreachable at every setting of either knob — the two rules are complementary", () => {
    // The one record the *surface* rule keeps is the one no amount of loosening
    // reaches here: its failures happened 62 times in a single day's rollup, and
    // recurrence is counted across records. Their union is 3 of 5; neither alone
    // is more than 2.
    for (const minSessions of [2, 3, 4, 5]) {
      for (const prefixTokens of [4, 5, 6]) {
        const swept = recurrenceReplay(records, judgement, { minSessions, prefixTokens });
        expect(swept.needsCovered).not.toContain("USAGE:2026-07-26");
      }
    }
  });

  test("the sensitivity table reports both knobs rather than asserting the shipped one", () => {
    const shipped = replay.sensitivity.find((r) => r.minSessions === 3 && r.prefixTokens === 5);
    expect(shipped).toMatchObject({ filed: 4, needsCovered: 2, meetsCountBar: true });
    // At six tokens the poll shape splits: the same bar still files four, but one
    // of them is a twelve-session poll with a thirteenth held beside it, so the
    // "single record carrying its count" clause fails even though the count clause holds.
    const wider = recurrenceReading(records, { prefixTokens: 6 });
    expect(wider.filed.filter((s) => s.prefix.startsWith("blocked: sleep"))[0].sessions).toHaveLength(12);
    expect(wider.held.some((s) => s.prefix.startsWith("blocked: sleep"))).toBe(true);
  });

  test("the report says what it filed, what it is holding, and refuses to say repetition means significance", () => {
    const report = formatRecurrenceReplay(replay);
    expect(report).toContain("29 record(s), 98 failing event(s)");
    expect(report).toContain("4 filed");
    expect(report).toContain("0 discarded");
    expect(report).toContain("13 session(s), 15 event(s), 15 distinct strings");
    expect(report).toContain("Records a pass must read: 4 — bar is 5, MET");
    expect(report).toContain("Needs reached by a filed shape: 2/5");
    expect(report).toContain("Held, not discarded");
    expect(report).toContain(RECURRENCE_RULE.refuses);
  });

  test("with no judgement the report says NOT SCORED rather than reporting zero needs reached", () => {
    // A reading over a vault nobody judged is a reading. Printing "0/5" would
    // report a refuted rule to anyone who had not supplied the one input that can
    // refute it — the mistake the sibling census made against the live vault.
    const unjudged = recurrenceReplay(records, []);
    const report = formatRecurrenceReplay(unjudged);
    expect(report).toContain("Not scored: no record was judged");
    expect(report).not.toContain("Needs reached");
    expect(report).not.toContain("In the corpus and unjudged");
    // …and the sensitivity table drops its needs column for the same reason: a
    // sweep printing `98/0` reads as "reached none of them", not as "nobody said".
    expect(report).toContain("Sensitivity (filed records), by minimum sessions");
  });

  test("the count bar is scored over the corpus it was fixed on and reported anywhere else", () => {
    // Found by running the CLI over the live vault: 561 records file 60 shapes,
    // and a flat "bar is 5, NOT MET" reported the rule refuted against a
    // population the bar was never stated for. The bar belongs to the 29.
    expect(replay.barApplies).toBe(true);
    expect(formatRecurrenceReplay(replay)).toContain("Records a pass must read: 4 — bar is 5, MET");

    const half = records.slice(0, 14);
    const other = recurrenceReplay(half, judgement.filter((j) => half.some((r) => r.id === j.id)));
    expect(other.barApplies).toBe(false);
    const report = formatRecurrenceReplay(other);
    expect(report).toContain("Not scored against the bar of 5");
    expect(report).not.toContain("NOT MET");
  });

  test("the report names the session a held shape is waiting for, in English", () => {
    expect(formatRecurrenceReplay(replay)).toContain("waiting for a 3rd session");
    expect(formatRecurrenceReplay(recurrenceReplay(records, judgement, { minSessions: 4 }))).toContain("waiting for a 4th session");
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(21)).toBe("21st");
  });

  test("long id lists are sampled, so one line cannot bury the clauses under it", () => {
    const many = Array.from({ length: 20 }, (_, i) => record(`TRANSCRIPT:${i}`, "2026-07-30T00:00:00.000Z", []));
    const report = formatRecurrenceReplay(recurrenceReplay(many, many.map((r) => ({ id: r.id, need: false, note: "" }))));
    expect(report).toContain(`… and ${20 - MAX_IDS_SHOWN} more`);
  });
});
