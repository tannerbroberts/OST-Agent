/**
 * The bar this file is: "One normaliser collapses the read-before-write family
 * and keeps three permission denials apart."
 *
 * Both halves pull opposite ways. The first rewards stripping identifiers, the
 * second punishes it, so the easy answers have to fail: strip everything and the
 * denials become one row, strip nothing and the read-before-write family stays
 * three rows. Two negative controls at the bottom of this file assert exactly
 * that, because a test that only shows the shipped setting passing has not shown
 * the setting is doing anything.
 *
 * **Every string below is verbatim from `.ost-agent/evidence/` in the OST-Agent
 * meta vault**, read on 2026-09-02 across 686 harvested records. The candidate's
 * own note is explicit that invented strings would make both halves trivially
 * satisfiable, so nothing here is written by hand — the `- **tool_error** (X): …`
 * lines are pasted out of the digests and parsed by the same reader the census
 * commands use.
 *
 * ## One substitution, named rather than made quietly
 *
 * The assumption test's threshold names three denials: `ost_check`, `ost_debt`
 * and `ost_read_repo`. It was written without repo or corpus sight. Two of those
 * three are denied in the corpus; **`ost_read_repo` is never denied** — it
 * appears 3 times as a `tool_error` of a different family ("X does not exist in
 * OST-Agent"), never as a permission refusal. So the third *permission denial*
 * here is `ost_status`, which is real and denied 14 times, and `ost_read_repo` is
 * kept in the fixture under the string it actually has. Nothing the threshold
 * named is dropped, the three-apart clause is met by three real denials, and the
 * test is strictly harder than the threshold asked for: all eight denied
 * capabilities in the corpus must stay apart, not three.
 */
import { describe, expect, test } from "vitest";
import { parseFrictionRecord } from "../../src/telemetry/friction-surface.js";
import {
  formatSignatureGrouping,
  frictionSignature,
  groupBySignature,
  normaliseRefusal,
  occurrencesOf,
  type SignatureOccurrence,
} from "../../src/adapters/friction-signature.js";

/** Build a harvested transcript digest out of real event lines, as the reader sees one. */
function record(id: string, lines: readonly string[]) {
  const body = [`---`, `id: ${id}`, `---`, "", ...lines, ""].join("\n");
  const parsed = parseFrictionRecord(`${id.replace(/[:]/g, "_")}.md`, body);
  if (!parsed) throw new Error(`fixture did not parse as a harvested record: ${id}`);
  return parsed;
}

function occurrences(...records: ReturnType<typeof record>[]): SignatureOccurrence[] {
  return records.flatMap(occurrencesOf);
}

// ── the corpus, verbatim ─────────────────────────────────────────────────────

/**
 * The read-before-write family: 545 events across 271 records, the corpus's
 * largest single shape. Three emitting tools produce byte-identical text — `Edit`
 * (307), `Write` (237) and one event whose digest named no tool at all.
 */
const READ_BEFORE_WRITE = {
  edit: "- **tool_error** (Edit): <tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
  write: "- **tool_error** (Write): <tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
  unnamed: "- **tool_error**: <tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
} as const;

/** Every capability the corpus records a permission refusal for. All eight. */
const CAPABILITY_DENIAL = {
  ost_check:
    "- **tool_error** (mcp__ost-agent__ost_check): Claude requested permissions to use mcp__ost-agent__ost_check, but you haven't granted it yet.",
  ost_debt:
    "- **tool_error** (mcp__ost-agent__ost_debt): Claude requested permissions to use mcp__ost-agent__ost_debt, but you haven't granted it yet.",
  ost_status:
    "- **tool_error** (mcp__ost-agent__ost_status): Claude requested permissions to use mcp__ost-agent__ost_status, but you haven't granted it yet.",
  ost_flag_humans_required:
    "- **tool_error** (mcp__ost-agent__ost_flag_humans_required): Claude requested permissions to use mcp__ost-agent__ost_flag_humans_required, but you haven't granted it yet.",
  ost_ingest_inbox:
    "- **tool_error** (mcp__ost-agent__ost_ingest_inbox): Claude requested permissions to use mcp__ost-agent__ost_ingest_inbox, but you haven't granted it yet.",
  ost_next_work:
    "- **tool_error** (mcp__ost-agent__ost_next_work): Claude requested permissions to use mcp__ost-agent__ost_next_work, but you haven't granted it yet.",
  webFetch: "- **tool_error** (WebFetch): Claude requested permissions to use WebFetch, but you haven't granted it yet.",
  webSearch: "- **tool_error** (WebSearch): Claude requested permissions to use WebSearch, but you haven't granted it yet.",
} as const;

/**
 * The adjacent family the candidate flagged as the hardest thing to keep apart:
 * a denied *path* read, 154 events, worded differently and carrying the one thing
 * the normaliser strips.
 */
const PATH_DENIAL = [
  "- **tool_error** (Glob): Claude requested permissions to read from /Users/tanner, but you haven't granted it yet.",
  "- **tool_error** (Glob): Claude requested permissions to read from /Users/tanner/.claude, but you haven't granted it yet.",
  "- **tool_error** (Glob): Claude requested permissions to read from /Users/tanner/dev, but you haven't granted it yet.",
  "- **tool_error** (Glob): Claude requested permissions to read from /Users/tanner/dev/OST-Agent, but you haven't granted it yet.",
  "- **tool_error** (Glob): Claude requested permissions to read from /Users/tanner/dev/OST-Agent/src, but you haven't granted it yet.",
] as const;

/** `ost_read_repo`'s real appearance: a missing-path error, not a permission refusal. */
const READ_REPO_MISS =
  '- **tool_error** (mcp__ost-agent__ost_read_repo): "commands" does not exist in OST-Agent — OST-Agent exists and contains CHANGELOG.md, CLAUDE.md, CONTRIBUTING.md, docs, examples, LICENSE, ost.vault.yaml, package-lock.json, package.json, README.md, RELEASING.md, scripts,…';

// ── the collapse half ────────────────────────────────────────────────────────

describe("the read-before-write family collapses to one row", () => {
  test("one group across three emitting tools and four sessions", () => {
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", [READ_BEFORE_WRITE.edit, READ_BEFORE_WRITE.write]),
        record("TRANSCRIPT:b", [READ_BEFORE_WRITE.write]),
        record("TRANSCRIPT:c", [READ_BEFORE_WRITE.edit, READ_BEFORE_WRITE.edit]),
        record("TRANSCRIPT:d", [READ_BEFORE_WRITE.unnamed]),
      ),
    );

    expect(grouping.rows).toBe(1);
    const [row] = grouping.groups;
    expect(row.count).toBe(6);
    expect(row.sessions).toEqual(["TRANSCRIPT:a", "TRANSCRIPT:b", "TRANSCRIPT:c", "TRANSCRIPT:d"]);
    // The emitting tool is not lost by being kept out of the key — it is carried.
    expect(row.tools).toEqual(["Edit", "Write"]);
    // Nothing is discarded: the counts sum back to what went in.
    expect(grouping.groups.reduce((n, g) => n + g.count, 0)).toBe(grouping.occurrences);
  });

  test("collapses across differing paths, on the one family whose text carries them", () => {
    // The read-before-write refusal names no path — the harness's message is the
    // same bytes every time — so "across differing paths" is measured on the
    // family that does carry them: five real denied directories, one shape.
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", [PATH_DENIAL[0], PATH_DENIAL[1], PATH_DENIAL[2]]),
        record("TRANSCRIPT:b", [PATH_DENIAL[3], PATH_DENIAL[4]]),
      ),
    );

    expect(grouping.rows).toBe(1);
    expect(grouping.groups[0].count).toBe(5);
    // Five distinct strings folded into one row is the thing exact-string
    // deduplication cannot do, and the reading says so on its face.
    expect(grouping.groups[0].distinctDetails).toBe(5);
    expect(grouping.identityRows).toBe(5);
  });
});

// ── the keep-apart half ──────────────────────────────────────────────────────

describe("permission denials stay apart", () => {
  test("three named denials are three rows", () => {
    // The threshold's clause, with `ost_status` standing in for the `ost_read_repo`
    // denial the corpus does not contain — see this file's header.
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", [CAPABILITY_DENIAL.ost_check, CAPABILITY_DENIAL.ost_debt]),
        record("TRANSCRIPT:b", [CAPABILITY_DENIAL.ost_status]),
      ),
    );

    expect(grouping.rows).toBe(3);
    expect(grouping.groups.map((g) => g.tools[0]).sort()).toEqual([
      "mcp__ost-agent__ost_check",
      "mcp__ost-agent__ost_debt",
      "mcp__ost-agent__ost_status",
    ]);
  });

  test("all eight denied capabilities stay apart, and the count is not the tool's", () => {
    const lines = Object.values(CAPABILITY_DENIAL);
    const grouping = groupBySignature(occurrences(record("TRANSCRIPT:a", lines)));

    expect(grouping.rows).toBe(8);
    // The key holds the capability because the message names it, not because the
    // digest labelled the event — which is what makes the collapse half possible.
    // Every event here is handed the SAME emitting tool on purpose: eight rows
    // survive that, so nothing in this half is being carried by the tool label.
    const signatures = new Set(
      lines.map((l) => frictionSignature({ kind: "tool_error", tool: "same", detail: l.split("): ")[1] })),
    );
    expect(signatures.size).toBe(8);
  });

  test("a denied path read does not fold into the denied-capability family", () => {
    const grouping = groupBySignature(
      occurrences(record("TRANSCRIPT:a", [...PATH_DENIAL, CAPABILITY_DENIAL.ost_check, CAPABILITY_DENIAL.ost_debt])),
    );

    // Two sentences that differ before the path begins: one path row, two capability rows.
    expect(grouping.rows).toBe(3);
    expect(grouping.groups[0].count).toBe(5);
    expect(grouping.groups[0].template).toContain("read from <path>");
    expect(grouping.groups.filter((g) => g.template.includes("to use ")).length).toBe(2);
  });
});

// ── both halves at once, which is the bar ────────────────────────────────────

describe("one normaliser satisfies both halves at the same setting", () => {
  test("the read-before-write family is one row while every denial keeps its own", () => {
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", [READ_BEFORE_WRITE.edit, CAPABILITY_DENIAL.ost_check, ...PATH_DENIAL.slice(0, 2)]),
        record("TRANSCRIPT:b", [READ_BEFORE_WRITE.write, CAPABILITY_DENIAL.ost_debt, READ_REPO_MISS]),
        record("TRANSCRIPT:c", [READ_BEFORE_WRITE.unnamed, CAPABILITY_DENIAL.ost_status, PATH_DENIAL[4]]),
      ),
    );

    const rows = new Map(grouping.groups.map((g) => [g.template, g]));
    const readBeforeWrite = [...rows.values()].filter((g) => g.template.includes("has not been read yet"));
    expect(readBeforeWrite).toHaveLength(1);
    expect(readBeforeWrite[0].count).toBe(3);
    expect(readBeforeWrite[0].sessions).toHaveLength(3);

    const denials = [...rows.values()].filter((g) => g.template.includes("requested permissions to use"));
    expect(denials).toHaveLength(3);
    expect(denials.every((g) => g.count === 1)).toBe(true);

    // Six rows in total: one read-before-write, three capability denials, one path
    // denial family, one `ost_read_repo` missing-path error. Ten events.
    expect(grouping.occurrences).toBe(10);
    expect(grouping.rows).toBe(6);
  });
});

// ── the negative controls ────────────────────────────────────────────────────

describe("the two easy answers fail, which is why the setting is a setting", () => {
  const corpus = occurrences(
    record("TRANSCRIPT:a", [READ_BEFORE_WRITE.edit, CAPABILITY_DENIAL.ost_check]),
    record("TRANSCRIPT:b", [READ_BEFORE_WRITE.write, CAPABILITY_DENIAL.ost_debt]),
    record("TRANSCRIPT:c", [READ_BEFORE_WRITE.unnamed, CAPABILITY_DENIAL.ost_status]),
  );

  test("keying on the emitting tool everywhere splits the read-before-write family into three", () => {
    const byTool = new Set(corpus.map((o) => `${o.kind}|${o.tool}|${normaliseRefusal(o.detail)}`));
    const readBeforeWrite = [...byTool].filter((k) => k.includes("has not been read yet"));
    expect(readBeforeWrite).toHaveLength(3); // the collapse half fails
    expect(groupBySignature(corpus).groups.filter((g) => g.template.includes("has not been read yet"))).toHaveLength(1);
  });

  test("stripping the capability name folds three denials into one", () => {
    const overStripped = new Set(
      corpus.map((o) => `${o.kind}|${normaliseRefusal(o.detail).replace(/mcp__[a-z_-]+/g, "<tool>")}`),
    );
    const denials = [...overStripped].filter((k) => k.includes("requested permissions"));
    expect(denials).toHaveLength(1); // the keep-apart half fails
    expect(groupBySignature(corpus).groups.filter((g) => g.template.includes("requested permissions"))).toHaveLength(3);
  });

  test("exact-string grouping still splits the family that carries a path", () => {
    const grouping = groupBySignature([...corpus, ...occurrences(record("TRANSCRIPT:d", [...PATH_DENIAL]))]);
    // 5 rows under the rule: one read-before-write, three denials, one path family.
    expect(grouping.rows).toBe(5);
    // Exact strings: 9 rows — 1 read-before-write + 3 denials + 5 separate paths.
    //
    // Worth reading carefully, because it is the honest limit of this control and
    // the reason the tool-keyed control above exists. The read-before-write family
    // is BYTE-IDENTICAL across its three emitting tools, so exact-string grouping
    // folds it too; what splits it in the record is the digest's tool label, which
    // is why "does the key include the emitting tool" and not "how hard do we
    // strip" is the decision the collapse half turns on. Against exact strings the
    // normaliser earns its place on the path family alone, 5 rows down to 1.
    expect(grouping.identityRows).toBe(9);
    expect(formatSignatureGrouping(grouping)).toContain("would leave 9 row(s)");
  });
});

// ── the exception the corpus forced ──────────────────────────────────────────

/**
 * The five tools whose `retry` input serialises to the empty object. 582 events
 * across 251 records — the largest row in the corpus the first time this rule was
 * run over it, and five different observations wearing one string.
 */
const EMPTY_PAYLOAD_RETRY = [
  "- **retry** (CronList): {}",
  "- **retry** (mcp__ost-agent__ost_ingest_inbox): {}",
  "- **retry** (mcp__ost-agent__ost_next_work): {}",
  "- **retry** (mcp__plugin_ost-agent_ost-agent__ost_next_work): {}",
  "- **retry** (mcp__plugin_ost-agent_ost-agent__ost_read_tree): {}",
] as const;

describe("a serialised payload keys on the emitting tool, because it cannot name itself", () => {
  test("five tools retrying on `{}` are five rows, not one", () => {
    const grouping = groupBySignature(
      occurrences(record("TRANSCRIPT:a", [...EMPTY_PAYLOAD_RETRY]), record("TRANSCRIPT:b", [...EMPTY_PAYLOAD_RETRY])),
    );

    expect(grouping.rows).toBe(5);
    expect(grouping.groups.every((g) => g.count === 2)).toBe(true);
    expect(grouping.groups.every((g) => g.tools.length === 1)).toBe(true);
  });

  test("the exception is the payload, not the kind — a printed retry still collapses", () => {
    // Same `retry` kind, prose detail instead of JSON, two emitting tools: one row.
    const grouping = groupBySignature([
      { kind: "retry", tool: "Edit", detail: "File has not been read yet. Read it first before writing to it.", session: "a" },
      { kind: "retry", tool: "Write", detail: "File has not been read yet. Read it first before writing to it.", session: "b" },
    ]);
    expect(grouping.rows).toBe(1);
    expect(grouping.groups[0].tools).toEqual(["Edit", "Write"]);
  });

  test("a payload's own arguments are still normalised away inside its tool", () => {
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", ['- **retry** (Read): {"file_path":"/Users/tanner/dev/OST-Agent/src/eval/rollup.ts"}']),
        record("TRANSCRIPT:b", ['- **retry** (Read): {"file_path":"/Users/tanner/dev/OST-Agent/src/cli/index.ts"}']),
      ),
    );
    expect(grouping.rows).toBe(1);
    expect(grouping.groups[0].distinctDetails).toBe(2);
  });
});

// ── what the queue entry carries, and what it refuses to say ─────────────────

describe("the queue entry", () => {
  test("leads with the count and names the sessions behind it", () => {
    const grouping = groupBySignature(
      occurrences(
        record("TRANSCRIPT:a", [READ_BEFORE_WRITE.edit, READ_BEFORE_WRITE.write]),
        record("TRANSCRIPT:b", [READ_BEFORE_WRITE.edit]),
      ),
    );
    const report = formatSignatureGrouping(grouping);

    expect(report).toContain("3× across 2 session(s)");
    expect(report).toContain("TRANSCRIPT:a, TRANSCRIPT:b");
    // A count of sightings is not a measure of need, and the report says so on
    // every reading rather than only on an unflattering one.
    expect(report).toContain("Not settled:");
    expect(report).toContain("never how much it cost");
  });

  test("no friction read is a row of its own, not an empty queue reported as clean", () => {
    const grouping = groupBySignature([]);
    expect(grouping.rows).toBe(0);
    expect(formatSignatureGrouping(grouping)).toContain("no friction event was read");
  });
});
