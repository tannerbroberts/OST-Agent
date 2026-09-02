/**
 * The rung-suggestion reflex: when a refusal names the rung that WOULD have been
 * accepted, does the caller take it because it is honest — or because it was
 * named?
 *
 * The solution under test is "The refusal states the value that would have
 * worked, not just the one that did not". Its own body names the risk that
 * decides whether it was worth doing — *suggesting the acceptable value invites
 * the caller to take it without thinking* — and the assumption test beneath it
 * fixed the bar before anyone counted: **at most 5 of 20 retries adopt the named
 * rung with the justification unchanged from the refused attempt.**
 *
 * **The controls are what carry this file.** A classifier that answered
 * "grounded" to everything would satisfy any assertion about a corpus that came
 * out low, and this corpus does come out low under the headline reading. So the
 * synthetic cases below run first and in both directions: each verdict fires on a
 * session built to carry it and fails to fire on one built to look like it and
 * not be it. Only then is the number over the real corpus worth reading.
 *
 * The rule is `RUNG_SUGGESTION_RULE`, committed in `src/telemetry/rung-suggestion.ts`
 * before this corpus was counted, including the judgement it refuses to be trusted
 * on — what "grounds it had not cited before" means. Three readings are published
 * rather than one defended, and on this corpus the strictest of them reverses the
 * verdict, which the report says on its face.
 *
 * ## What this file does NOT settle, and must not be read past
 *
 * Taking the named rung is often correct: it may be the honest rung, and on a
 * demotion it usually is. Separating a reflexive acceptance from a right one means
 * reading the justification and deciding whether it argues for the rung, which is
 * a judgement. **This produces the flag, never the verdict**, and a human records
 * the result.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { acceptableRungClause, namedAcceptableRung, rungRefusal } from "../../src/eval/rungs.js";
import { BELIEVABILITY_LADDER } from "../../src/knowledge/believability.js";
import { buildOstTools, MCP_TOOL_NAMES } from "../../src/security/tools.js";
import { CALL_PRECONDITIONS, checkCall, publishCallPreconditions } from "../../src/security/call-preconditions.js";
import { readTranscriptSessions, type TranscriptSession } from "../../src/telemetry/preflight.js";
import {
  canCiteSource,
  countRefusals,
  formatRungSuggestionCensus,
  GROUNDS_READINGS,
  readRungCalls,
  RUNG_SUGGESTION_RULE,
  rungSuggestionCensus,
} from "../../src/telemetry/rung-suggestion.js";
import { Vault } from "../../src/ost/vault.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import type { OstNode } from "../../src/ost/node.js";
import type { ToolContext } from "../../src/security/tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "rung-suggestion");

// ── the suggestion itself ────────────────────────────────────────────────────

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  input_schema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

/** Drive the LIVE tool, schema check included — the surface a caller actually meets. */
function call(tool: string, input: Record<string, unknown>): Promise<string> {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const built = (buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === tool);
  if (!built) throw new Error(`${tool} is not on the MCP surface`);
  const problems = validateToolInput(built.input_schema, input);
  if (problems.length > 0) throw new Error(`refused the call: ${problems.join("; ")}`);
  return built.run(input);
}

function node(title: string, layer: OstNode["layer"], body: string): OstNode {
  return { title, layer, body, tags: [], links: [], evidence: "assertion" };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-rung-suggestion-"));
  vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "the mandate"));
  vault.createNode(node("Opp", "Opportunity", "a gap"));
  vault.createNode(node("Sol", "Solution", "an idea worth trying"));
  vault.linkNodes("Root", "Opp");
  vault.linkNodes("Opp", "Sol");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("the refusal states the value that would have worked", () => {
  test("the clause round-trips: what it writes is what the census reads", () => {
    for (const rung of BELIEVABILITY_LADDER) {
      expect(namedAcceptableRung(`nope. ${acceptableRungClause(rung.id)}.`)).toBe(rung.id);
    }
  });

  test("a refusal that names no value reads as none — the reader does not guess", () => {
    expect(namedAcceptableRung("\"X\" cannot declare 'observed'. No.")).toBeNull();
    expect(namedAcceptableRung("declare 'sideways' or lower")).toBeNull();
    expect(namedAcceptableRung("")).toBeNull();
  });

  test("the measurement-rung refusal names it, on both of its branches", () => {
    for (const declared of ["money", "observed"] as const) {
      const message = rungRefusal({ node: "Sol", declared, supported: "assertion", missing: "…" });
      expect(namedAcceptableRung(message)).toBe("assertion");
    }
  });

  test("the write boundary's measurement refusal names it — the live tool, not a helper", async () => {
    await expect(call("ost_set_evidence", { title: "Sol", evidence: "observed" })).rejects.toThrow();
    const message = await call("ost_set_evidence", { title: "Sol", evidence: "observed" }).catch((e: Error) => e.message);
    expect(namedAcceptableRung(message)).toBe("assertion");
  });

  test("the write boundary's standing refusal names it — the other half of the ladder", async () => {
    // `WEB:` keys off the string alone, so this needs no stored evidence record:
    // a web actor starts at the floor and its ceiling is `expert`, which makes
    // `stated` a rung it has not earned.
    const message = await call("ost_create_node", {
      title: "A claim from a page",
      layer: "Solution",
      parent: "Opp",
      evidence: "stated",
      source: "WEB:example.com/report",
      body: "Someone published this.",
      killIf: "nobody cites it",
      killBy: "2027-01-01",
    }).catch((e: Error) => e.message);
    expect(message).toContain("cannot declare 'stated'");
    expect(namedAcceptableRung(message)).toBe("assertion");
  });

  test("both PREFLIGHT refusals name it too — the cheap call is the one the opportunity is about", () => {
    const published = publishCallPreconditions({ vault, dir });

    const measurement = checkCall(published, "ost_set_evidence", { title: "Sol", evidence: "observed" });
    const unearned = measurement.find((v) => v.id === "unearned-measurement-rung");
    expect(unearned).toBeDefined();
    expect(namedAcceptableRung(unearned?.reason ?? "")).toBe("assertion");

    const standing = checkCall(published, "ost_create_node", {
      title: "A claim from a page",
      layer: "Solution",
      parent: "Opp",
      evidence: "stated",
      source: "WEB:example.com/report",
      body: "Someone published this.",
    });
    const withinStanding = standing.find((v) => v.id === "within-source-standing");
    expect(withinStanding).toBeDefined();
    expect(namedAcceptableRung(withinStanding?.reason ?? "")).toBe("assertion");
  });

  test("every rung refusal in src/ is written by the one clause, so a reword cannot blind the census", () => {
    // The census reads the suggestion back out of a refusal. A path that composed
    // its own sentence would not fail anything — the census would find nothing
    // there and report a clean sheet, which is the worst answer it can give. So
    // the sentence and its reader are one unit, and every file that refuses a
    // rung has to reach for it.
    const emitters = sourceFilesContaining("cannot declare '${");
    expect(emitters.length).toBeGreaterThan(0);
    for (const file of emitters) {
      expect(
        fs.readFileSync(path.join(repoRoot, file), "utf8"),
        `${file} refuses a rung without using acceptableRungClause`,
      ).toContain("acceptableRungClause");
    }
  });

  test("the preconditions that refuse a rung are published for both writing tools", () => {
    for (const id of ["unearned-measurement-rung", "within-source-standing"]) {
      const p = CALL_PRECONDITIONS.find((c) => c.id === id);
      expect(p?.tools).toContain("ost_create_node");
      expect(p?.tools).toContain("ost_set_evidence");
    }
  });
});

function sourceFilesContaining(needle: string): string[] {
  const hits: string[] = [];
  const walk = (at: string) => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && fs.readFileSync(full, "utf8").includes(needle)) {
        hits.push(path.relative(repoRoot, full));
      }
    }
  };
  walk(path.join(repoRoot, "src"));
  // The census's own detector holds the string as a pattern rather than emitting
  // one; it is the reader, not an emitter, and requiring it to import its own
  // export would be a rule about nothing.
  return hits.filter((f) => f !== path.join("src", "telemetry", "rung-suggestion.ts"));
}

// ── the classifier ───────────────────────────────────────────────────────────

let nextId = 0;

interface Declaration {
  tool?: string;
  title: string;
  evidence: string;
  source?: string;
  body?: string;
  note?: string;
  /** The refusal this call got back, or undefined when it was accepted. */
  refusedWith?: string;
}

/** A synthetic session: rung declarations and the results they got, in order. */
function session(id: string, calls: Declaration[]): TranscriptSession {
  const lines: string[] = [];
  for (const c of calls) {
    const useId = `toolu_${(nextId += 1)}`;
    const input: Record<string, unknown> = { title: c.title, evidence: c.evidence };
    if (c.source !== undefined) input.source = c.source;
    if (c.body !== undefined) input.body = c.body;
    if (c.note !== undefined) input.note = c.note;
    lines.push(
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: useId, name: c.tool ?? "mcp__ost-agent__ost_create_node", input }],
        },
      }),
    );
    lines.push(
      JSON.stringify({
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: useId,
              is_error: c.refusedWith !== undefined,
              content: c.refusedWith ?? "created",
            },
          ],
        },
      }),
    );
  }
  return { id, jsonl: lines.join("\n") };
}

const REFUSED_OBSERVED = `"N" cannot declare 'observed': what it points at supports 'assertion'. ${acceptableRungClause("assertion")}.`;

describe("the classifier — each verdict fires on a case built to carry it, and not on one built to look like it", () => {
  test("reflexive: the retry takes the named rung and rewrites nothing", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", source: "USAGE:1", body: "The trace counted it.", refusedWith: REFUSED_OBSERVED },
        { title: "N", evidence: "assertion", source: "USAGE:1", body: "The trace counted it." },
      ]),
    ]);
    expect(c.cells.reflexive).toBe(1);
    expect(c.sample).toBe(1);
    expect(c.share).toBe(1);
    expect(c.meetsBar).toBe(false);
  });

  test("grounded: the same adoption, with a justification the refused attempt did not carry", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", source: "USAGE:1", body: "The trace counted it.", refusedWith: REFUSED_OBSERVED },
        { title: "N", evidence: "assertion", source: "USAGE:1", body: "The trace counted it. No result records it, so this is inference." },
      ]),
    ]);
    expect(c.cells.grounded).toBe(1);
    expect(c.cells.reflexive).toBe(0);
  });

  test("whitespace is not grounds — a reflow does not buy a rung", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "The trace counted it.", refusedWith: REFUSED_OBSERVED },
        { title: "N", evidence: "assertion", body: "The  trace\n counted it.\n" },
      ]),
    ]);
    expect(c.cells.reflexive).toBe(1);
  });

  test("other-rung: the caller went somewhere the refusal did not name", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED },
        { title: "N", evidence: "expert", body: "same" },
      ]),
    ]);
    expect(c.cells["other-rung"]).toBe(1);
    expect(c.cells.reflexive).toBe(0);
    expect(c.sample).toBe(1);
  });

  test("unretried: never answered, and counted neither way rather than as compliance", () => {
    const c = rungSuggestionCensus([
      session("s", [{ title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED }]),
    ]);
    expect(c.cells.unretried).toBe(1);
    expect(c.sample).toBe(0);
    expect(c.share).toBeNull();
    expect(formatRungSuggestionCensus(c)).toContain("UNREAD");
  });

  test("a declaration on ANOTHER node is not this refusal's retry", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED },
        { title: "Other", evidence: "assertion", body: "same" },
      ]),
    ]);
    expect(c.cells.unretried).toBe(1);
    expect(c.cells.reflexive).toBe(0);
  });

  test("a declaration past the window is not a retry — it is later work on the same node", () => {
    const filler: Declaration[] = Array.from({ length: RUNG_SUGGESTION_RULE.retryWindowCalls }, (_, i) => ({
      title: `Filler ${i}`,
      evidence: "assertion",
      body: "unrelated",
    }));
    const late = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED },
        ...filler,
        { title: "N", evidence: "assertion", body: "same" },
      ]),
    ]);
    expect(late.cells.unretried).toBe(1);

    // …and one fewer call in between is inside the window, so the window is what
    // decides it rather than the pairing having silently stopped working.
    const inside = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED },
        ...filler.slice(1),
        { title: "N", evidence: "assertion", body: "same" },
      ]),
    ]);
    expect(inside.cells.reflexive).toBe(1);
  });

  test("a refusal that named nothing is not counted, and shows up as coverage instead", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { title: "N", evidence: "observed", body: "same", refusedWith: `"N" cannot declare 'observed'. It does not.` },
        { title: "N", evidence: "assertion", body: "same" },
      ]),
    ]);
    expect(c.suggested).toBe(0);
    expect(c.rungRefusalsSeen).toBe(1);
    expect(c.cells.reflexive).toBe(0);
  });

  test("a refusal about something OTHER than the rung is out of the coverage denominator", () => {
    const c = rungSuggestionCensus([
      session("s", [
        {
          title: "N",
          evidence: "assertion",
          body: "same",
          refusedWith: `"N" cannot carry that instrument: no spec file at that path`,
        },
      ]),
    ]);
    expect(c.rungRefusalsSeen).toBe(0);
    expect(c.otherRefusals).toBe(1);
  });

  test("the refusal text quoted back in the record is not a refusal", () => {
    // This project writes its own refusals into the vault, so every later pass
    // that reads the tree re-emits them. Counting the echo would report the same
    // refusal hundreds of times and call it a corpus.
    const echo: TranscriptSession = {
      id: "echo",
      jsonl: [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "tool_use", id: "toolu_echo", name: "Bash", input: { command: "cat node.md" } }] },
        }),
        JSON.stringify({
          type: "user",
          message: {
            content: [{ type: "tool_result", tool_use_id: "toolu_echo", is_error: true, content: REFUSED_OBSERVED }],
          },
        }),
        JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: REFUSED_OBSERVED }] } }),
      ].join("\n"),
    };
    const c = rungSuggestionCensus([echo]);
    expect(c.suggested).toBe(0);
    expect(c.rungRefusalsSeen).toBe(0);
  });

  test("the join is by tool_use_id, so an interleaved turn attributes the refusal to its own arguments", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "a", name: "ost_create_node", input: { title: "A", evidence: "observed", body: "a" } },
            { type: "tool_use", id: "b", name: "ost_create_node", input: { title: "B", evidence: "observed", body: "b" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "b", is_error: true, content: REFUSED_OBSERVED },
            { type: "tool_result", tool_use_id: "a", is_error: false, content: "created" },
          ],
        },
      }),
    ].join("\n");
    const { refusals } = readRungCalls({ id: "s", jsonl });
    expect(refusals).toHaveLength(1);
    expect(refusals[0].call.title).toBe("B");
  });

  test("one session's record copied into a subagent directory is counted once", () => {
    const calls: Declaration[] = [
      { title: "N", evidence: "observed", source: "USAGE:1", body: "same", refusedWith: REFUSED_OBSERVED },
      { title: "N", evidence: "assertion", source: "USAGE:1", body: "same" },
    ];
    const c = rungSuggestionCensus([session("s", calls), session("s-copy", calls)]);
    expect(c.suggested).toBe(2);
    expect(c.duplicates).toBe(1);
    expect(c.sample).toBe(1);
  });

  test("a malformed line is one fewer call, never a thrown census", () => {
    const s = session("s", [{ title: "N", evidence: "observed", body: "same", refusedWith: REFUSED_OBSERVED }]);
    const c = rungSuggestionCensus([{ id: s.id, jsonl: `{not json\n${s.jsonl}\n\n` }]);
    expect(c.suggested).toBe(1);
  });

  test("ost_set_evidence justifies with `note`, and cannot cite a source at all", () => {
    const c = rungSuggestionCensus([
      session("s", [
        { tool: "mcp__ostmeta__ost_set_evidence", title: "N", evidence: "observed", note: "why", refusedWith: REFUSED_OBSERVED },
        { tool: "mcp__ostmeta__ost_set_evidence", title: "N", evidence: "assertion", note: "why" },
      ]),
    ]);
    expect(c.cells.reflexive).toBe(1);
    expect(c.citationBlind).toBe(1);
    expect(canCiteSource("mcp__ostmeta__ost_set_evidence")).toBe(false);
    expect(canCiteSource("mcp__ost-agent__ost_create_node")).toBe(true);
    // And the report discounts the strictest reading by exactly that amount
    // rather than letting it stand on retries it rigged.
    expect(formatRungSuggestionCensus(c)).toContain("marks them reflexive by");
  });

  test("the three readings disagree where they are meant to: a rewrite that cites nothing new", () => {
    const pair = session("s", [
      { title: "N", evidence: "observed", source: "USAGE:1", body: "One sentence.", refusedWith: REFUSED_OBSERVED },
      { title: "N", evidence: "assertion", source: "USAGE:1", body: "One sentence. And a second." },
    ]);
    const c = rungSuggestionCensus([pair]);
    const by = Object.fromEntries(c.readings.map((r) => [r.name, r.reflexive]));
    expect(by["any-edit"]).toBe(0);
    expect(by["new-sentence"]).toBe(0);
    expect(by["new-citation"]).toBe(1);
    expect(c.ruleDecides).toBe(true);
    expect(formatRungSuggestionCensus(c)).toContain("THE RULE DECIDES THIS");
  });

  test("every reading is a stated rule rather than a flag someone can set", () => {
    for (const reading of GROUNDS_READINGS) {
      expect(reading.rule.length).toBeGreaterThan(40);
      expect(reading.rule).toMatch(/[a-z]/);
    }
    expect(GROUNDS_READINGS.map((r) => r.name)).toContain(RUNG_SUGGESTION_RULE.headline);
  });
});

// ── the corpus this test exists to count ─────────────────────────────────────

/**
 * The committed corpus, cut from this machine's session transcripts by
 * `scripts/harvest-rung-suggestion-corpus.ts`. `PROVENANCE.md` records the rule
 * and what it leaves out; the harvester prints a fidelity check against the live
 * corpus and the cut was verified `EXACT` before it was committed.
 */
function committedCorpus(): TranscriptSession[] {
  return readTranscriptSessions(fixtureDir);
}

describe("the census over the committed corpus", () => {
  const sessions = committedCorpus();
  const census = rungSuggestionCensus(sessions);

  test("the corpus is the sessions the cut kept, and each is a real transcript", () => {
    expect(sessions.length).toBe(8);
    for (const s of sessions) expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("EVERY rung refusal in the corpus already names the acceptable value", () => {
    // The solution node gives this as its first reason for the instrument being
    // red — "the refusal does not name the acceptable ceiling yet". It did. Both
    // rung refusals have carried the clause since 2026-07-30, four days before
    // the node was written, so the suggestion is not the unbuilt half; the
    // measurement of what it does to callers is.
    expect(census.rungRefusalsSeen).toBe(10);
    expect(census.suggested).toBe(10);
    expect(census.duplicates).toBe(0);
  });

  test("it pairs each suggested refusal with the caller's next declaration on that node", () => {
    expect(census.paired).toBe(7);
    expect(census.unretried).toBe(3);
    expect(census.cells).toEqual({ reflexive: 1, grounded: 6, "other-rung": 0, unretried: 3 });
  });

  test("every retry in this corpus came back immediately, so the window decides nothing", () => {
    // If the answer moved with the window, the window would be a finding about
    // the rule rather than about the callers, and the number below would be
    // reporting a choice.
    expect(Math.max(...census.retryDistances)).toBeLessThanOrEqual(1);
    for (const window of [1, 2, 5, 20]) {
      expect(window).toBeLessThanOrEqual(RUNG_SUGGESTION_RULE.retryWindowCalls);
    }
  });

  test("all seven retries took the rung the refusal named — not one went elsewhere", () => {
    // The suggestion is being followed. Whether it is being followed *for a
    // reason* is the question the readings below split on, and the one no count
    // settles.
    expect(census.cells["other-rung"]).toBe(0);
  });

  // ── the bar ────────────────────────────────────────────────────────────────

  test("THE BAR: at most 5 of 20 retries take the named rung with no new grounds", () => {
    expect(RUNG_SUGGESTION_RULE.bar).toBe(5 / 20);
    expect(RUNG_SUGGESTION_RULE.headline).toBe("any-edit");
    expect(census.reflexive).toBe(1);
    expect(census.sample).toBe(7);
    expect(census.share).toBeCloseTo(1 / 7, 6);
    expect(census.meetsBar).toBe(true);
  });

  test("and the report says the sample is short of the twenty the bar names", () => {
    expect(census.sampleShort).toBe(true);
    const rendered = formatRungSuggestionCensus(census);
    expect(rendered).toContain("SAMPLE SHORT");
    expect(rendered).toContain("this corpus holds 7");
  });

  test("the strictest reading of 'new grounds' REVERSES the verdict, and the report says so", () => {
    // Not one of the seven retries changed its `source`, and `source` is the
    // field the ceiling is computed from. Under that reading every retry took a
    // rung the rule had already refused its citation for, and offered the rule
    // nothing new — 7 of 7, against a bar of 5 in 20.
    const byName = Object.fromEntries(census.readings.map((r) => [r.name, r]));
    expect(byName["any-edit"].reflexive).toBe(1);
    expect(byName["new-sentence"].reflexive).toBe(1);
    expect(byName["new-citation"].reflexive).toBe(7);
    expect(byName["new-citation"].meetsBar).toBe(false);
    expect(census.ruleDecides).toBe(true);
    expect(formatRungSuggestionCensus(census)).toContain("THE RULE DECIDES THIS");
  });

  test("six of the seven retries are ost_create_node, so new-citation is not an artifact of the tool", () => {
    // `ost_set_evidence` has no `source` argument, so a corpus made of those
    // would score 100% reflexive under new-citation by construction. This one
    // does not: the retries could have cited something else and did not.
    expect(census.citationBlind).toBe(0);
  });

  test("the report leads with coverage and never claims to settle the question", () => {
    const rendered = formatRungSuggestionCensus(census);
    expect(rendered.indexOf("Coverage:")).toBeLessThan(rendered.indexOf('What counts as "grounds'));
    expect(rendered).toContain("This is a FLAG, never a verdict");
    expect(rendered).toContain("a human records the result");
  });

  test("the corpus counts refusals about the rung only, and says how many it set aside", () => {
    const total = sessions.reduce(
      (n, s) => {
        const c = countRefusals(s);
        return { rung: n.rung + c.rung, other: n.other + c.other };
      },
      { rung: 0, other: 0 },
    );
    expect(total.rung).toBe(census.rungRefusalsSeen);
    expect(census.otherRefusals).toBe(total.other);
  });
});
