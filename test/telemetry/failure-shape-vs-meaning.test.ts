/**
 * A day of real failed calls, sorted into shape errors and meaning errors.
 *
 * `validateToolInput` shipped in v0.17.0 on the strength of ONE replayed call.
 * The assumption test beneath it fixed the bar before anyone counted: **shape
 * errors at 50% or more of all failures** and the shipped validator stands as a
 * substantially complete answer to its opportunity; below that, the majority of
 * real damage is semantic and "A tool call I got slightly wrong destroyed the
 * note I was filing" needs a sibling aimed at meaning rather than more schema
 * work. The corpus is the vault's append-only usage trace for 2026-07-25 through
 * 2026-07-27 — 217 calls, 62 failures — committed here as a fixture so the count
 * is reproducible by anyone rather than by whoever has that vault on their disk.
 *
 * **The controls carry this file, and they run first.** A classifier that
 * answered "meaning" to everything would satisfy any assertion about a corpus
 * that came out low, and this corpus comes out very low. So the shape families
 * are checked against messages the LIVE validator and the LIVE tool surface
 * actually produce — `validateToolInput` invoked on the real `ost_create_node`
 * schema, and `ost_create_node.run` invoked with the empty input the trace
 * recorded — and each is checked to fire on a message built to carry it and to
 * fail to fire on one built to look like it and not be it. Only after that is
 * the number over the real corpus worth reading.
 *
 * **What this file does not do is promote anything.** It counts. The verdict
 * stays a human's `ost-agent result`, per the node: mechanical classification,
 * human verdict.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import {
  classifyFailure,
  eventsInWindow,
  failureKindCensus,
  formatFailureKindCensus,
  parseUsageTrace,
  FAILURE_KIND_RULE,
  type FailureKindCensus,
} from "../../src/telemetry/failure-kind.js";
import type { UsageEvent } from "../../src/telemetry/usage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const corpusFile = path.join(repoRoot, "test", "fixtures", "failure-shape-vs-meaning", "events.jsonl");

/** A failed call, with only the fields the classifier is allowed to see. */
function failed(err: string, over: Partial<UsageEvent> = {}): UsageEvent {
  return { ts: "2026-07-26T21:00:00.000Z", tool: "ost_annotate", ok: false, ms: 1, surface: "cli-tool", argBytes: 900, err, ...over };
}

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(FAILURE_KIND_RULE.bar).toBe(0.5);
  });

  test("the window is the three days the assumption test named", () => {
    expect(FAILURE_KIND_RULE.window).toEqual({ from: "2026-07-25", to: "2026-07-27" });
  });

  test("every shape family names the schema keyword that would have caught it", () => {
    // A shape error is defined as "refusable by schema validation alone". A
    // family that cannot say WHICH keyword refuses it is an assertion, not a
    // classification, and would let anything be called shape.
    const shape = FAILURE_KIND_RULE.families.filter((f) => f.kind === "shape");
    expect(shape.length).toBeGreaterThan(0);
    expect(shape.every((f) => f.keyword !== undefined)).toBe(true);
    // The converse: nothing that is not shape may claim a keyword, because a
    // keyword is exactly the claim "the validator had this covered".
    expect(FAILURE_KIND_RULE.families.filter((f) => f.kind !== "shape").every((f) => f.keyword === undefined)).toBe(true);
  });

  test("every named keyword is one `validateToolInput` actually implements", () => {
    // The validator checks a six-keyword subset and refuses to claim anything
    // else. A family resting on a keyword outside that subset would be crediting
    // the shipped code with a check it does not perform.
    const implemented = new Set(["type", "properties", "required", "additionalProperties", "enum", "items"]);
    for (const family of FAILURE_KIND_RULE.families) {
      if (family.keyword) expect(implemented.has(family.keyword)).toBe(true);
    }
  });
});

// ── the shape families, against the code that emits them ────────────────────

describe("a shape error is one the live validator would have refused", () => {
  let dir: string;
  let schemas: ToolSchema[];
  let createNodeSchema: ToolSchema;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-failure-kind-"));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const tools = buildOstTools({ vault: new Vault(dir, { create: false }), dir, remote: { enabled: false } });
    schemas = tools.map((t) => t.input_schema as ToolSchema);
    createNodeSchema = tools.find((t) => t.name === "ost_create_node")!.input_schema as ToolSchema;
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("every problem the validator reports on a real schema is classified shape", () => {
    // Not a transcription of the validator's wording — the wording is generated
    // by calling it. If a future edit rephrases a message, this fails here rather
    // than silently reclassifying that failure as `unclassified` in the census.
    const problems = [
      ...validateToolInput(createNodeSchema, {}),
      ...validateToolInput(createNodeSchema, { title: "T", layer: "Solution", parent: "P", body: "B", evidence: "assertion", note: "x" }),
      ...validateToolInput(createNodeSchema, { title: 7, layer: "Solution", parent: "P", body: "B", evidence: "assertion" }),
      ...validateToolInput(createNodeSchema, { title: "T", layer: "Nonsense", parent: "P", body: "B", evidence: "assertion" }),
    ];
    expect(problems.length).toBeGreaterThanOrEqual(8);
    for (const problem of problems) {
      const verdict = classifyFailure(failed(problem), schemas);
      expect({ problem, kind: verdict.kind }).toEqual({ problem, kind: "shape" });
    }
  });

  test("all four validator keywords are exercised by those problems, not just `required`", () => {
    const keywords = new Set(
      [
        ...validateToolInput(createNodeSchema, {}),
        ...validateToolInput(createNodeSchema, { title: "T", layer: "Solution", parent: "P", body: "B", evidence: "assertion", note: "x" }),
        ...validateToolInput(createNodeSchema, { title: 7, layer: "Solution", parent: "P", body: "B", evidence: "assertion" }),
        ...validateToolInput(createNodeSchema, { title: "T", layer: "Nonsense", parent: "P", body: "B", evidence: "assertion" }),
      ].map((problem) => classifyFailure(failed(problem), schemas).keyword),
    );
    expect([...keywords].sort()).toEqual(["additionalProperties", "enum", "required", "type"]);
  });

  test("the corpus's own shape error is reproduced by running the real tool, not quoted", async () => {
    // The trace records `ost_create_node` failing with argBytes 2 — an empty
    // object. This calls the shipped tool with exactly that and classifies the
    // message it throws, so "shape" here is a claim about the live surface.
    const tools = buildOstTools({ vault: new Vault(dir, { create: false }), dir, remote: { enabled: false } });
    const createNode = tools.find((t) => t.name === "ost_create_node")!;
    let thrown = "";
    try {
      await (createNode.run as (i: unknown) => unknown)({});
    } catch (error) {
      thrown = (error as Error).message;
    }
    expect(thrown).toContain("needs an evidence class");
    const verdict = classifyFailure(failed(thrown, { argBytes: 2 }), schemas);
    expect(verdict.kind).toBe("shape");
    // And the validator agrees, independently, about the same input: five
    // required properties absent. Two derivations, one answer.
    expect(validateToolInput(createNodeSchema, {}).filter((p) => p.includes("missing required")).length).toBe(5);
  });

  test("the enum recital comes off the published schemas, and without them cannot fire", () => {
    // Built from a real declared enum rather than typed in, so a tool that adds
    // a member is covered without this file being edited. Given no schemas the
    // same message is unreadable — the honest answer, and visible in
    // `schemasRead` on the report rather than degraded past in silence.
    const evidence = (createNodeSchema.properties?.evidence as ToolSchema | undefined)?.enum as string[];
    expect(evidence.length).toBeGreaterThan(3);
    const message = `that node needs an evidence class — one of: ${evidence.join(", ")}.`;
    const verdict = classifyFailure(failed(message), schemas);
    expect(verdict.kind).toBe("shape");
    expect(verdict.family).toBe("enum-recital");
    expect(classifyFailure(failed(message), []).kind).toBe("unclassified");
  });

  test("the corpus's message is caught twice over — absent-required reads it without any schema at all", () => {
    // Both derivations of the same refusal agree, from opposite ends: `enum
    // recital` finds the constraint in the message, `absent-required` finds the
    // symptom of a required property arriving absent. The families are tried
    // first, so this is the one that actually fires on the corpus.
    const message = `"undefined" needs an evidence class — one of: money, observed, stated, expert, assertion.`;
    expect(classifyFailure(failed(message), schemas).family).toBe("absent-required");
    expect(classifyFailure(failed(message), []).kind).toBe("shape");
  });
});

// ── and fails to fire on messages built to look like it ─────────────────────

describe("a meaning error is not talked into being a shape error", () => {
  test("a well-formed call naming a node that does not exist is meaning, with no keyword", () => {
    const verdict = classifyFailure(failed("no such node: A"));
    expect(verdict.kind).toBe("meaning");
    expect(verdict.family).toBe("no-such-node");
    expect(verdict.keyword).toBeUndefined();
  });

  test("a nonexistent node whose title happens to BE a property name is still meaning", () => {
    // The near-miss the whole file turns on: `title` and `evidence` are declared
    // properties, and a classifier keying on property names would call these
    // shape. Every field was present and correctly typed; the world was wrong.
    expect(classifyFailure(failed("no such node: title")).kind).toBe("meaning");
    expect(classifyFailure(failed("no such node: evidence")).kind).toBe("meaning");
  });

  test("a node title that recites an enum's members is still meaning", () => {
    // `enum-recital` is the strongest shape signal and the one most able to
    // over-reach: a node genuinely called "money, observed, stated, expert,
    // assertion" would put the enum verbatim into a `no such node` message. The
    // families are tried before the derived signals for exactly this reason.
    const verdict = classifyFailure(failed("no such node: money, observed, stated, expert, assertion"), [
      { type: "object", properties: { evidence: { type: "string", enum: ["money", "observed", "stated", "expert", "assertion"] } } },
    ]);
    expect(verdict.kind).toBe("meaning");
  });

  test("the parent checks are meaning: a real title in the wrong place is schema-valid", () => {
    expect(classifyFailure(failed(`parent "Retention" does not exist — create it before attaching under it`)).kind).toBe("meaning");
    expect(classifyFailure(failed(`a Solution must attach under Opportunity, but "Retention" is a Outcome`)).kind).toBe("meaning");
  });

  test("an environment failure is neither, and a permission refusal is read from the flag, not the words", () => {
    expect(classifyFailure(failed("ENOENT: no such file or directory, open '/x'")).kind).toBe("neither");
    // `denied` is set at capture from the thrown error's TYPE. Honouring it above
    // every wording rule is what keeps a host rephrasing its permission text from
    // moving a call between buckets.
    expect(classifyFailure(failed("missing required property `issue`", { denied: true })).kind).toBe("neither");
  });

  test("an unrecognised refusal is unclassified, never folded into the nearest bucket", () => {
    const verdict = classifyFailure(failed("the moon was in the wrong phase"));
    expect(verdict.kind).toBe("unclassified");
    expect(verdict.family).toBeNull();
  });
});

// ── probes and bursts: what the denominator is allowed to contain ───────────

describe("the two things that inflate a denominator", () => {
  test("the probe floor sits in the gap the corpus leaves, not on the answer", () => {
    const events = parseUsageTrace(fs.readFileSync(corpusFile, "utf8"));
    const window = eventsInWindow(events);
    const writes = window.filter((e) => e.ok !== false && /ost_(annotate|create_node|append_to_node)/.test(e.tool));
    const smallestRealWrite = Math.min(...writes.map((e) => e.argBytes));
    const probes = window.filter((e) => e.ok === false && e.argBytes <= FAILURE_KIND_RULE.probeMaxArgBytes);
    const largestProbe = Math.max(...probes.map((e) => e.argBytes));
    // 32 < 64 < 353: any floor in that range partitions this corpus identically,
    // which is what makes the constant a floor rather than a fit.
    expect(largestProbe).toBe(32);
    expect(smallestRealWrite).toBe(353);
    expect(FAILURE_KIND_RULE.probeMaxArgBytes).toBeGreaterThan(largestProbe);
    expect(FAILURE_KIND_RULE.probeMaxArgBytes).toBeLessThan(smallestRealWrite);
  });

  test("a burst is same tool, same family, no long gap — and one of those failing splits it", () => {
    const at = (ms: number, over: Partial<UsageEvent> = {}) =>
      failed("no such node: w", { ts: new Date(Date.parse("2026-07-26T21:20:48.000Z") + ms).toISOString(), ...over });
    const run = failureKindCensus([at(0), at(330), at(660)]);
    expect(run.incidents).toBe(1);
    // A minute of silence is a different incident…
    expect(failureKindCensus([at(0), at(330), at(61_000)]).incidents).toBe(2);
    // …and so is a different refusal, however close in time.
    expect(failureKindCensus([at(0), at(330), at(660, { err: "ENOENT: no such file or directory, open '/x'" })]).incidents).toBe(2);
  });
});

// ── the corpus ──────────────────────────────────────────────────────────────

describe("the failures that actually happened, 2026-07-25 to 2026-07-27", () => {
  let census: FailureKindCensus;
  let dir: string;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-failure-kind-corpus-"));
    await initVault(dir, "Reach 10,000 daily active users", "Retention");
    const schemas = buildOstTools({ vault: new Vault(dir, { create: false }), dir, remote: { enabled: false } }).map(
      (t) => t.input_schema as ToolSchema,
    );
    census = failureKindCensus(parseUsageTrace(fs.readFileSync(corpusFile, "utf8")), schemas);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("the corpus is the one the assumption test named: 217 calls, 62 failures", () => {
    expect(census.callsRead).toBe(217);
    expect(census.failures).toBe(62);
  });

  test("every failure was readable — a rule that could not read them would report a clean corpus", () => {
    // The bucket this project has been burned by: a sweep that cannot read its
    // subject reports the same "nothing here" as one that read everything. If
    // this ever goes red, every count below is a floor and not a census.
    expect(census.unreadable).toEqual([]);
    expect(census.cells.unclassified).toBe(0);
    expect(census.schemasRead).toBeGreaterThan(0);
  });

  test("61 of the 62 are meaning errors; exactly one is a shape error", () => {
    expect(census.cells).toEqual({ shape: 1, meaning: 61, neither: 0, unclassified: 0 });
  });

  test("the one shape error is itself a probe, so the counted corpus contains none at all", () => {
    // The finding the assumption test could not have anticipated. It asked for
    // probes to be reported separately rather than counted — and the single
    // failure schema validation would have caught is a 2-byte empty call, which
    // is a probe by the same rule. Report the failures the branch is actually
    // about and the shape column is empty.
    expect(census.probes).toHaveLength(3);
    expect(census.probes.filter((p) => p.kind === "shape")).toHaveLength(1);
    expect(census.shape).toBe(0);
    expect(census.denominator).toBe(59);
  });

  test("the 59 counted failures are one burst — five annotations splattered by an unquoted argument", () => {
    // Same tool, same family, 21 seconds, each ~930 bytes of identical payload
    // under a one-word title. `usage.ts` stores no input, so the mechanism is an
    // inference; what is NOT an inference is that these 59 are one incident, and
    // reading them as 59 independent failures is the "one actor recorded 59
    // times" error the tree keeps finding elsewhere.
    const counted = census.classified.filter((f) => !f.probe);
    expect(counted).toHaveLength(59);
    expect(new Set(counted.map((f) => f.incident)).size).toBe(1);
    expect(new Set(counted.map((f) => f.event.tool))).toEqual(new Set(["ost_annotate"]));
    const span = Date.parse(counted.at(-1)!.event.ts) - Date.parse(counted[0]!.event.ts);
    expect(span).toBeLessThan(22_000);
  });

  test("the pre-committed 50% bar is MISSED, and by every denominator on offer", () => {
    // The losing branch the assumption test wrote down before the count: below
    // the bar, the majority of real damage is semantic, and the branch needs a
    // candidate aimed at MEANING — an existence precheck on node titles, a
    // non-empty-content guard — rather than further schema work. This is that
    // branch, and nothing about how the failures are counted rescues it: the
    // reading built to be most generous to the shipped validator (bursts
    // collapsed, probes left in) still lands at 25%, half the bar.
    expect(census.meetsBar).toBe(false);
    expect(census.share).toBe(0);
    expect(census.readings.map((r) => [r.shape, r.denominator, r.meetsBar])).toEqual([
      [0, 59, false],
      [1, 62, false],
      [1, 4, false],
    ]);
    expect(census.readings.every((r) => !r.meetsBar)).toBe(true);
  });

  test("the verdict does not turn on which denominator a reader prefers", () => {
    expect(census.ruleDecides).toBe(false);
    const report = formatFailureKindCensus(census);
    expect(report).toContain("MISSED");
    expect(report).toContain("every denominator agrees");
    expect(report).not.toContain("UNREADABLE");
    // Printed, because a census nobody reads is a number in a test file.
    // eslint-disable-next-line no-console
    console.log(`\n${report}\n`);
  });
});
