/**
 * The instrument for "A preflight manifest states every tool precondition before
 * the pass composes its first call".
 *
 * The assumption beneath that solution is the risky half and it was written down
 * before anyone counted: *every precondition that actually costs a pass a turn is
 * derivable from the tool surface's own schemas*. The assumption test fixed the
 * bar in advance — **a manifest generated from the tool schemas alone must name a
 * rule covering at least 60% of the distinct refusal classes in the captured
 * transcript corpus. Below 60% the solution's cost claim is refuted, not
 * refined.**
 *
 * It came out **8 of 24 (33%)**, and weighted by how often each class actually
 * bit, **22% of 330 refusals**. On the reading the solution's own cost argument
 * means — a rule a schema *keyword* carries, which cannot drift from what the
 * validator does — it is **0 of 24**.
 *
 * ## This command being green does not mean the assumption held
 *
 * It is green because the count has been taken and pinned, which is what an
 * instrument on a measurement can mean. That is the convention
 * `test/friction/path-failure-attribution.test.ts` and
 * `test/telemetry/preflight-uncertainty-census.test.ts` already run under, and
 * both of those censuses also came out against the solution they were commissioned
 * for. Whoever reads this exit code must read `census.meetsBar` with it, which is
 * why it is asserted `false` by name below rather than left to be inferred.
 *
 * ## What carries this file is the controls, not the number
 *
 * A classifier that answered "nameable" to everything would satisfy every
 * assertion about a corpus that came out high, and one that answered "not
 * nameable" to everything would satisfy every assertion about a corpus that came
 * out low. So the synthetic cases run first and in both directions: the fold emits
 * a rule for a schema built to carry one and stays silent on a schema built to
 * look like it and not be it; every refusal class fires on a string taken verbatim
 * from the corpus and fails to fire on a lookalike; and two synthetic corpora — one
 * of purely argument-shaped refusals, one of purely history-shaped refusals — are
 * run through the census to show it can reach 100% and 0% on the same code path
 * that reported 33% over the real thing.
 *
 * The strongest control is the anti-drift one. The solution's own body says a
 * hand-written manifest "becomes a second statement of the rules that drifts from
 * the first". So every prose line the manifest emits is asserted to be a verbatim
 * span of the tool's own description — the manifest may quote the surface, and may
 * never author.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import {
  bareToolName,
  foldDescription,
  foldKeywords,
  generatePreflightManifest,
  MANIFEST_RULE,
  manifestNames,
  renderPreflightManifest,
  statesPrecondition,
  type ToolSchemaLike,
} from "../../src/security/preflight-manifest.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import type { FailingCall } from "../../src/telemetry/path-failure-attribution.js";
import {
  classifyRefusal,
  formatRefusalCoverageCensus,
  refusalCoverageCensus,
  REFUSAL_RULE,
} from "../../src/telemetry/refusal-coverage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The corpus. Deliberately the file `test/friction/path-failure-attribution.test.ts`
 * already reads: every failing call in 646 session transcripts, kept whole with
 * nothing selected. It was cut for a different question, which is the strongest
 * property it has here — nobody chose these rows knowing this census would be
 * taken over them. See `test/fixtures/refusal-coverage/PROVENANCE.md`.
 */
function corpus(): FailingCall[] {
  const file = path.join(repoRoot, "test", "fixtures", "path-failure-attribution", "failures.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as FailingCall);
}

function makeContext(): ToolContext {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-manifest-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  return { vault: new Vault(dir), dir, remote: { enabled: false } };
}

/** The manifest as a run would actually receive it: folded from this repo's own surface. */
function realManifest() {
  return generatePreflightManifest(buildOstTools(makeContext()) as unknown as ToolSchemaLike[]);
}

function schema(over: Partial<ToolSchemaLike> = {}): ToolSchemaLike {
  return {
    name: "t_thing",
    description: "Reads a thing and returns it.",
    input_schema: { type: "object", properties: {} },
    ...over,
  };
}

function failure(over: Partial<FailingCall>): FailingCall {
  return { session: "s", tool: "Edit", command: "", error: "", ...over };
}

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    expect(REFUSAL_RULE.bar).toBe(0.6);
  });

  test("the verdict is taken on the widest reading that can still come out false", () => {
    expect(REFUSAL_RULE.verdictReading).toBe("argument-decidable");
    // `any-prose` admits every class by construction. A reading that cannot fail
    // cannot test anything, and must not be the one the verdict rests on.
    expect(REFUSAL_RULE.readings.at(-1)?.name).toBe("any-prose");
    expect(REFUSAL_RULE.verdictReading).not.toBe("any-prose");
  });

  test("every class has a distinct id, a pattern and a stated dependency", () => {
    const ids = REFUSAL_RULE.classes.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of REFUSAL_RULE.classes) {
      expect(c.precondition.length, `${c.id} states no precondition`).toBeGreaterThan(10);
      expect(c.namedBy.length, `${c.id} names no rule kind`).toBeGreaterThan(0);
    }
  });

  test("only two classes are expressible as a schema keyword, and that is the finding", () => {
    // Written as an assertion rather than as a comment because it is the whole
    // argument: a JSON Schema keyword constrains one argument, and "you must have
    // read this file already" is not a fact about an argument. If a later edit
    // makes a third class keyword-shaped, this fails and the finding is restated
    // rather than quietly widened.
    const keywordShaped = REFUSAL_RULE.classes.filter((c) =>
      c.namedBy.some((k) => k !== "stated-precondition"),
    );
    expect(keywordShaped.map((c) => c.id).sort()).toEqual(["closed-parameter-set", "output-schema-violation"]);
  });
});

// ── the fold: it emits on a schema that carries a rule, and not otherwise ────

describe("keyword rules are folded out of the schema and nowhere else", () => {
  test("a closed parameter set becomes a rule; an open one does not", () => {
    const closed = foldKeywords(schema({ input_schema: { type: "object", properties: { a: {} }, additionalProperties: false } }));
    expect(closed.map((r) => r.kind)).toContain("closed-parameter-set");
    const open = foldKeywords(schema({ input_schema: { type: "object", properties: { a: {} } } }));
    expect(open.map((r) => r.kind)).not.toContain("closed-parameter-set");
  });

  test("required parameters become a rule; a schema with none stays silent", () => {
    const required = foldKeywords(schema({ input_schema: { type: "object", properties: { a: {} }, required: ["a"] } }));
    expect(required.find((r) => r.kind === "required-parameter")?.statement).toBe("Refused without: a.");
    expect(foldKeywords(schema()).map((r) => r.kind)).not.toContain("required-parameter");
  });

  test("an enum becomes a rule naming its members", () => {
    const rules = foldKeywords(
      schema({ input_schema: { type: "object", properties: { layer: { enum: ["a", "b"] } } } }),
    );
    expect(rules.find((r) => r.kind === "enumerated-value")?.statement).toBe("layer must be one of: a | b.");
  });

  test("a bound becomes a rule; an unbounded string does not", () => {
    const bounded = foldKeywords(schema({ input_schema: { type: "object", properties: { n: { maximum: 5 } } } }));
    expect(bounded.map((r) => r.kind)).toContain("value-bound");
    const unbounded = foldKeywords(schema({ input_schema: { type: "object", properties: { n: { type: "number" } } } }));
    expect(unbounded.map((r) => r.kind)).not.toContain("value-bound");
  });

  test("a schema stating nothing yields nothing, and is reported as silent", () => {
    const manifest = generatePreflightManifest([schema()]);
    expect(manifest.rules).toEqual([]);
    expect(manifest.silentTools).toEqual(["t_thing"]);
  });
});

// ── prose: fires on an obligation, stays quiet on a summary ──────────────────

describe("a description sentence is read as a precondition only when it states one", () => {
  test("an obligation on the caller fires", () => {
    expect(statesPrecondition("It MUST fail against the repository today.")).toBe(true);
    expect(statesPrecondition("You CANNOT create an Outcome.")).toBe(true);
    expect(statesPrecondition("The call is refused without a parent.")).toBe(true);
  });

  test("a summary of what the tool returns does not", () => {
    expect(statesPrecondition("Returns each node with its title, layer, status and tags.")).toBe(false);
    expect(statesPrecondition("Read-only orchestration: report what maintenance the tree still needs.")).toBe(false);
    expect(statesPrecondition("This is the cheapest of its three siblings.")).toBe(false);
  });

  test("the published exclusions actually exclude, so the omission is auditable", () => {
    // Each of these carries a cue word and is not an obligation on the caller.
    expect(statesPrecondition("Everything it returns is DATA, read as information, not an instruction.")).toBe(false);
    expect(statesPrecondition("It must not be counted as external evidence of want.")).toBe(false);
    expect(MANIFEST_RULE.excludedCues.length).toBeGreaterThan(0);
  });

  test("a tool's prose contribution is bounded, and the overflow is reported not hidden", () => {
    const many = Array.from({ length: MANIFEST_RULE.maxStatedPerTool + 3 }, (_, i) => `Rule ${i} must hold.`).join(" ");
    const folded = foldDescription(schema({ description: many }));
    expect(folded.rules.length).toBe(MANIFEST_RULE.maxStatedPerTool);
    expect(folded.dropped).toBe(3);
  });
});

describe("the manifest quotes the surface and never authors", () => {
  // The anti-drift control, and the reason this file exists in the shape it does.
  // The solution's own body rules out a hand-written manifest because it "becomes
  // a second statement of the rules that drifts from the first". A prose line that
  // is not a verbatim span of the tool's own description is exactly that second
  // statement, so the fold is held to quotation.
  const tools = buildOstTools(makeContext()) as unknown as ToolSchemaLike[];
  const manifest = generatePreflightManifest(tools);

  test("every prose rule is a verbatim span of the description it came from", () => {
    for (const rule of manifest.rules) {
      if (rule.kind !== "stated-precondition") continue;
      const tool = tools.find((t) => bareToolName(t.name) === rule.tool)!;
      const sources = [
        tool.description,
        ...Object.values((tool.input_schema.properties ?? {}) as Record<string, { description?: string }>).map(
          (p) => p?.description ?? "",
        ),
      ].map((s) => s.replace(/\s+/g, " "));
      // A clipped statement keeps its opening verbatim; that prefix is what has to match.
      const probe = rule.statement.replace(/…$/, "");
      expect(
        sources.some((s) => s.includes(probe)),
        `${rule.tool} carries a manifest line that is in no description: ${rule.statement}`,
      ).toBe(true);
    }
  });

  test("every rule says which keyword or sentence produced it", () => {
    for (const rule of manifest.rules) expect(rule.derivedFrom.length).toBeGreaterThan(0);
  });

  test("the manifest a run would actually receive is not empty and is readable", () => {
    expect(manifest.tools.length).toBeGreaterThan(20);
    expect(manifest.rules.length).toBeGreaterThan(50);
    const text = renderPreflightManifest(manifest);
    expect(text).toContain("PREFLIGHT MANIFEST");
    // It has to say what it structurally cannot hold. A manifest that lists
    // preconditions without naming the kinds it cannot carry reads as complete.
    expect(text).toContain("WHAT THIS CANNOT TELL YOU");
    expect(text).toContain("ost_create_node");
  });

  test("the fold reaches the rung ceiling — the one class in the corpus it does reach", () => {
    expect(manifestNames(manifest, "ost_create_node", "enumerated-value")).toBe(true);
    expect(manifestNames(manifest, "mcp__ost-agent__ost_create_node", "closed-parameter-set")).toBe(true);
    // …and holds nothing at all about the tool that produced the corpus's single
    // largest refusal class, because its schema is not this repository's to fold.
    expect(manifestNames(manifest, "Edit", "stated-precondition")).toBe(false);
  });
});

// ── each refusal class fires on the real string and not on its lookalike ─────

describe("every class is matched by a string the corpus actually recorded", () => {
  test("read-before-write, the class that bit hardest", () => {
    expect(classifyRefusal("<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>")).toBe(
      "read-before-write",
    );
    // And not the neighbouring handshake, which is a different rule with a
    // different remedy: one says go and read, the other says read it again.
    expect(classifyRefusal("<tool_use_error>File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.</tool_use_error>")).toBe(
      "stale-read",
    );
  });

  test("a grant on a tool and a grant on a path are different classes", () => {
    expect(classifyRefusal("Claude requested permissions to use mcp__ost-agent__ost_check, but you haven't granted it yet.")).toBe(
      "tool-not-granted",
    );
    expect(classifyRefusal("Claude requested permissions to read from /Users/tanner/dev/OST-Agent, but you haven't granted it yet.")).toBe(
      "path-not-granted",
    );
  });

  test("the argument-shaped classes, which are the only ones a keyword could reach", () => {
    expect(classifyRefusal("<tool_use_error>InputValidationError: Glob failed due to the following issue: An unexpected parameter `limit` was provided</tool_use_error>")).toBe(
      "closed-parameter-set",
    );
    expect(classifyRefusal("Output does not match required schema: root: must have required property 'refuted'")).toBe(
      "output-schema-violation",
    );
    expect(classifyRefusal("<tool_use_error>InputValidationError: Read was called with input that could not be parsed as JSON.</tool_use_error>")).toBe(
      "malformed-body",
    );
    expect(classifyRefusal("<tool_use_error>Blocked: sleep 120 followed by: tail -5 /tmp/out. To wait for a condition, use Monitor.</tool_use_error>")).toBe(
      "blocked-command-form",
    );
  });

  test("the classes that turn on state a schema cannot see", () => {
    expect(classifyRefusal("File content (73874 tokens) exceeds maximum allowed tokens (25000).")).toBe("response-size-cap");
    expect(classifyRefusal("\"A third of my calls go on re-asking what is outstanding\" cannot declare 'observed': what it points at supports 'assertion'.")).toBe(
      "evidence-rung-ceiling",
    );
    expect(classifyRefusal("no product repos configured — add local repo paths under `product.repos` in ost.config.yaml")).toBe(
      "missing-config",
    );
    expect(classifyRefusal("<tool_use_error>Error: No such tool available: Bash. Bash exists but is not enabled in this context.</tool_use_error>")).toBe(
      "tool-not-available",
    );
  });

  test("the schema that was present and said the wrong thing", () => {
    // A parameter the schema marks OPTIONAL, refused for being absent. A folded
    // manifest states the optionality correctly and misleads the caller anyway.
    expect(classifyRefusal("MCP error -32602: No environment_id provided and no linked environment. Available environments: - production")).toBe(
      "conditionally-required-parameter",
    );
  });

  test("a program's own exit code is not a tool precondition and is excluded", () => {
    expect(classifyRefusal("Exit code 1 … (eval):1: no matches found: /Users/tanner/dev/ost*")).toBeNull();
    expect(classifyRefusal("Exit code 143 Command timed out after 2m 0s")).toBeNull();
  });

  test("a human declining, and a remote answering badly, are excluded too", () => {
    expect(classifyRefusal("The user doesn't want to proceed with this tool use. The tool use was rejected")).toBeNull();
    expect(classifyRefusal("GET https://vistaly.com/opportunity-solution-trees failed with HTTP 404")).toBeNull();
    expect(classifyRefusal("getaddrinfo ENOTFOUND reviews.appsmenow.com")).toBeNull();
  });

  test("ordinary prose is not a refusal of any class", () => {
    expect(classifyRefusal("The build finished and everything is fine.")).toBeNull();
    expect(classifyRefusal("")).toBeNull();
  });
});

// ── the census can come out either way, on the same code path ────────────────

describe("the census is not tuned to answer one way", () => {
  const manifest = realManifest();

  test("a corpus of purely argument-shaped refusals clears the bar", () => {
    const census = refusalCoverageCensus(
      [
        failure({ tool: "Glob", error: "InputValidationError: An unexpected parameter `limit` was provided" }),
        failure({ tool: "Bash", error: "<tool_use_error>Blocked: sleep 45 followed by: gh pr checks 9</tool_use_error>" }),
        failure({ tool: "Workflow", error: "Invalid workflow script: Script parse error: Unexpected token (24:12)" }),
      ],
      manifest,
    );
    expect(census.classes.length).toBe(3);
    expect(census.verdict.share).toBe(1);
    expect(census.meetsBar).toBe(true);
  });

  test("a corpus of purely history-shaped refusals comes out at nothing", () => {
    const census = refusalCoverageCensus(
      [
        failure({ tool: "Edit", error: "File has not been read yet. Read it first before writing to it." }),
        failure({ tool: "Read", error: "File content (73874 tokens) exceeds maximum allowed tokens (25000)." }),
        failure({ tool: "Grep", error: "Claude requested permissions to read from /Users/tanner, but you haven't granted it yet." }),
      ],
      manifest,
    );
    expect(census.verdict.share).toBe(0);
    expect(census.meetsBar).toBe(false);
    // …while the vacuous reading still says 100%, which is exactly why it does
    // not decide anything.
    expect(census.readings.find((r) => r.name === "any-prose")?.share).toBe(1);
    expect(census.readings.find((r) => r.name === "any-prose")?.vacuous).toBe(true);
  });

  test("a corpus with nothing to read is UNREAD, never a clean result", () => {
    const census = refusalCoverageCensus([failure({ tool: "Bash", error: "Exit code 1 … ls: -d: No such file" })], manifest);
    expect(census.classes).toEqual([]);
    expect(formatRefusalCoverageCensus(census)).toContain("UNREAD");
  });

  test("the readings are monotone — a wider one may only admit more", () => {
    const census = refusalCoverageCensus(corpus(), manifest);
    for (let i = 1; i < census.readings.length; i++) {
      expect(census.readings[i].named).toEqual(expect.arrayContaining(census.readings[i - 1].named));
      expect(census.readings[i].share).toBeGreaterThanOrEqual(census.readings[i - 1].share);
    }
  });
});

// ── the number over the corpus this project actually produced ────────────────

describe("the count over the captured corpus", () => {
  const census = refusalCoverageCensus(corpus(), realManifest());

  test("the whole corpus was read, and nothing in it went unaccounted for", () => {
    expect(census.failures).toBe(719);
    // Every failing call is either a class, or a named exclusion. A census with a
    // blind spot it does not name is the shape this repository has withdrawn
    // findings over, so the blind spot is asserted to be empty rather than small.
    expect(census.unclassified).toBe(0);
    const excluded = census.excluded.reduce((n, e) => n + e.count, 0);
    const classified = census.classes.reduce((n, c) => n + c.occurrences, 0);
    expect(excluded + classified).toBe(census.failures);
  });

  test("the exclusions are published as counts, and the largest is the shell", () => {
    expect(census.excluded.find((e) => e.name === "subprocess-failure")?.count).toBe(374);
    expect(census.excluded.find((e) => e.name === "user-declined")?.count).toBe(10);
    expect(census.excluded.find((e) => e.name === "remote-failure")?.count).toBe(5);
  });

  test("REACH: this repository holds a schema for the tools behind 3 of 24 classes", () => {
    // Reported before any share, and it is the first thing that goes wrong for
    // the solution: a generator can only fold schemas it has, and 21 of the 24
    // preconditions that bit were enforced by a surface this repository does not
    // own. Nothing about "what a schema could express in principle" repairs that.
    expect(census.classes.length).toBe(24);
    expect(census.reach.inReach.sort()).toEqual(["evidence-rung-ceiling", "missing-config", "tool-not-granted"]);
    expect(census.reach.outOfReach.length).toBe(21);
  });

  test("KEYWORD reading: 0 of 24 — the reading the cost argument actually means", () => {
    const keyword = census.readings.find((r) => r.name === "keyword")!;
    expect(keyword.named).toEqual([]);
    expect(keyword.share).toBe(0);
    expect(keyword.meetsBar).toBe(false);
  });

  test("VERDICT: 8 of 24 (33%) against a bar of 60% — the assumption is REFUTED", () => {
    expect(census.verdict.name).toBe("argument-decidable");
    expect(census.verdict.named.length).toBe(8);
    expect(census.classes.length).toBe(24);
    expect(census.verdict.share).toBeCloseTo(8 / 24, 6);
    expect(census.verdict.share).toBeLessThan(REFUSAL_RULE.bar);
    // Asserted by name. A green run of this file means the count has been taken,
    // never that the assumption held.
    expect(census.meetsBar).toBe(false);
  });

  test("weighted by how often each class bit, it is worse: 22% of 330 refusals", () => {
    // The unweighted share is the one the assumption test named, but it treats a
    // class that bit once the same as one that bit 85 times. Weighted, the three
    // largest classes — tool grants, read-before-write, path grants: 199 of 330
    // refusals between them — are all unnameable.
    expect(census.classes.reduce((n, c) => n + c.occurrences, 0)).toBe(330);
    expect(census.verdict.weightedShare).toBeLessThan(0.25);
    const biggest = [...census.classes].sort((a, b) => b.occurrences - a.occurrences).slice(0, 3);
    expect(biggest.map((c) => c.cls)).toEqual(["tool-not-granted", "read-before-write", "path-not-granted"]);
    for (const c of biggest) expect(census.verdict.named).not.toContain(c.cls);
  });

  test("the report leads with reach and says REFUTED out loud", () => {
    const text = formatRefusalCoverageCensus(census);
    expect(text.split("\n")[0]).toMatch(/^Reach: 3 of 24/);
    expect(text).toContain("REFUTED");
    expect(text).toContain("VACUOUS");
    expect(text).toContain("What this does not settle");
  });
});
