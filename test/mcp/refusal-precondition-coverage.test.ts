/**
 * The instrument for "Publish the preconditions of every call so they can be
 * checked before it is made".
 *
 * The assumption beneath that solution is the risky half and it was written down
 * before anyone counted: *the conditions are expressible outside the tool, and
 * any that are not will still be discovered the hard way, so the improvement is
 * real but partial, and its size is exactly the share that can be published.* The
 * assumption test fixed the bar in advance — **fully expressible conditions must
 * cover at least 70% of the refusals actually fired, weighted by the usage traces
 * rather than counted flat.**
 *
 * It came out **96 of 118 (81%)**, so the bar is met. Two numbers have to be read
 * with that one, and both are asserted below by name rather than left to be
 * inferred:
 *
 * 1. **Collapse the largest incident and it is 62%, under the bar.** Sixty-one of
 *    the 118 refusals are one tool, one class, one day, one surface, no session
 *    id, every argument a single English word — one unquoted title split by a
 *    shell, recorded 61 times. The pre-committed weighting counts it 61 times and
 *    that is the weighting the exit code carries; a reader who stops there has
 *    been told the idea clears its bar without being told it clears it because of
 *    that day.
 * 2. **Twenty-one of the 118 are `caveat`-grade, not `fully`.** They are decidable
 *    only against a product repository this tool does not own, which is the stale
 *    published copy the solution node names as the thing that would make it the
 *    wrong pick — here, structurally, rather than as a risk.
 *
 * ## What carries this file is the controls, not the number
 *
 * A classifier that answered "fully expressible" to everything would satisfy
 * every assertion about a corpus that came out high. So:
 *
 * - every refusal class fires on a string taken **verbatim from the corpus** and
 *   fails to fire on a lookalike;
 * - two synthetic corpora — one of purely argument-shaped refusals, one of purely
 *   unpublishable ones — run through the same code path that reported 81% over
 *   the real thing, and come out 100% and 0%;
 * - and the anti-drift control, which is the one that matters: for every class
 *   the census counts as covered, a call of that shape is put to the REAL tool in
 *   a real vault, and `checkCall` is required to have refused it first, for the
 *   same reason. A published precondition that says yes where the tool says no is
 *   the confidently-wrong contract the solution node warns about, and it would
 *   fail here rather than in a caller's pass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import {
  CALL_PRECONDITIONS,
  checkCall,
  publishCallPreconditions,
  renderCallPreconditions,
  type PublishedPreconditions,
} from "../../src/security/call-preconditions.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import {
  classifyRefusal,
  formatRefusalPreconditionCensus,
  REFUSAL_CLASSES,
  REFUSAL_PRECONDITION_BAR,
  refusalPreconditionCensus,
  type RecordedRefusal,
} from "../../src/telemetry/refusal-precondition-coverage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The corpus: every `ok: false` event in the meta vault's usage trace, kept whole
 * with nothing selected. See `test/fixtures/usage-refusals/PROVENANCE.md` for the
 * cut and for the two properties of it the number depends on.
 */
function corpus(): RecordedRefusal[] {
  const file = path.join(repoRoot, "test", "fixtures", "usage-refusals", "refusals.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RecordedRefusal);
}

function corpusReport(): { events: number; refusals: number } {
  const file = path.join(repoRoot, "test", "fixtures", "usage-refusals", "corpus.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as { events: number; refusals: number };
}

/** A refusal row's error text, for the classifier's verbatim controls. */
function errorsMatching(re: RegExp): string[] {
  return corpus()
    .map((r) => r.err)
    .filter((e) => re.test(e));
}

describe("the corpus is the whole cut", () => {
  test("every refusal the trace holds is committed, not the ones a classifier can read", () => {
    const rows = corpus();
    expect(rows.length).toBe(corpusReport().refusals);
    // The successes are the denominator this census does NOT use, and the ratio
    // is worth pinning: a corpus that quietly became refusals-only would look
    // identical to this one from inside the census.
    expect(corpusReport().events).toBeGreaterThan(rows.length * 10);
  });

  test("no row was filtered by tool — eight distinct tools refused something", () => {
    expect(new Set(corpus().map((r) => r.tool)).size).toBe(8);
  });
});

describe("the classifier fires on the corpus and not on lookalikes", () => {
  // Each entry: the class, a string taken verbatim from the corpus, and a
  // lookalike that must NOT reach it. The lookalikes are the near-misses that
  // would inflate the covered share if the patterns were loose.
  const lookalikes: Record<string, string> = {
    "no-such-node": "no such file or directory: Some Title.md",
    "above-source-standing": "cannot declare 'stated' because the body is empty",
    "unearned-measurement-rung": "cannot declare 'observed': the parent supports it",
    "instrument-not-a-spec-file": "the command was accepted once its shell punctuation was removed",
    "instrument-spec-missing": "the node does not exist in OST-Agent",
    "threshold-not-a-bar": "cannot carry that instrument: it is not a spec file",
    "no-evidence-class": "needs an evidence record",
    "reserved-heading": "## Results is a heading",
    "humans-required-lane": "labelled humans-optional",
    "no-product-repo": "no product repo configured for the web adapter",
    "repo-path-missing": "src/ost does not exist in the vault",
  };

  for (const spec of REFUSAL_CLASSES) {
    test(`${spec.id} fires on the corpus's own wording`, () => {
      const hits = errorsMatching(spec.match);
      expect(hits.length).toBeGreaterThan(0);
      // And the whole verbatim string classifies to THIS class, not to an earlier
      // one that happened to be checked first.
      const row = corpus().find((r) => spec.match.test(r.err))!;
      expect(classifyRefusal(row).class?.id).toBe(spec.id);
    });

    test(`${spec.id} does not fire on its lookalike`, () => {
      expect(spec.match.test(lookalikes[spec.id])).toBe(false);
    });
  }

  test("every class names a published precondition that exists", () => {
    for (const spec of REFUSAL_CLASSES) {
      expect(CALL_PRECONDITIONS.map((p) => p.id)).toContain(spec.precondition);
    }
  });

  test("a refusal whose reason the tracer truncated away is reported, never guessed", () => {
    const cut = corpus().filter((r) => classifyRefusal(r).truncated);
    expect(cut.length).toBe(1);
    // 300 is `MAX_ERR_CHARS` in src/telemetry/usage.ts. The record of WHY a call
    // was refused is clipped shorter than this surface's refusals are written,
    // which is a defect in the instrument this census reads, not in the census.
    expect(cut[0].err.length).toBe(300);
    expect(classifyRefusal(cut[0]).class).toBeNull();
  });
});

describe("the census can reach 100% and 0% on the same code path", () => {
  const at = (n: number, err: string): RecordedRefusal => ({
    ts: `2026-01-${String(n).padStart(2, "0")}T00:00:00.000Z`,
    tool: "ost_create_node",
    surface: "test",
    err,
  });

  test("a corpus of purely publishable refusals comes out 100%", () => {
    const synthetic = [1, 2, 3, 4].map((n) => at(n, `"X" needs an evidence class — one of: money, observed`));
    const c = refusalPreconditionCensus(synthetic);
    expect(c.share).toBe(1);
    expect(c.meetsBar).toBe(true);
  });

  test("a corpus of refusals no precondition covers comes out 0%", () => {
    const synthetic = [1, 2, 3, 4].map((n) => at(n, "ENOSPC: no space left on device"));
    const c = refusalPreconditionCensus(synthetic);
    expect(c.share).toBe(0);
    expect(c.meetsBar).toBe(false);
    expect(c.unclassified).toBe(4);
  });

  test("the caveat grade counts against the share, not for it", () => {
    const synthetic = [1, 2].map((n) => at(n, "no product repos configured — add local repo paths"));
    const c = refusalPreconditionCensus(synthetic);
    expect(c.caveated).toBe(2);
    expect(c.share).toBe(0);
  });

  test("the incident collapse is a real collapse, not a relabelling", () => {
    // Ten identical refusals on one day plus one on another: collapsing takes the
    // ten to one, so a corpus that is nine-tenths one sitting cannot carry a bar.
    const oneDay = Array.from({ length: 10 }, () => at(1, `"X" needs an evidence class — one of: money`));
    const other = [at(2, "ENOSPC: no space left on device")];
    const c = refusalPreconditionCensus([...oneDay, ...other]);
    expect(c.largestIncident?.events).toBe(10);
    expect(c.share).toBeCloseTo(10 / 11, 5);
    expect(c.shareWithoutLargestIncident).toBeCloseTo(1 / 2, 5);
  });
});

describe("the published preconditions agree with the tools that enforce them", () => {
  let dir: string;
  let vault: Vault;
  let published: PublishedPreconditions;

  interface RawTool {
    name: string;
    run: (input: unknown) => Promise<string>;
  }

  function ctx(): ToolContext {
    return { vault, dir, remote: { enabled: false }, surface: "test", productRepos: [] };
  }

  function call(name: string, input: Record<string, unknown>): Promise<string> {
    const built = (buildOstTools(ctx(), MCP_TOOL_NAMES) as unknown as RawTool[]).find((t) => t.name === name)!;
    return built.run(input);
  }

  function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
    vault.createNode({ title, layer, body: "prose", tags: [], links: [], evidence: "assertion", ...extra });
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-preconditions-"));
    vault = new Vault(dir);
    put("Root", "Outcome");
    put("Opp", "Opportunity");
    put("Sol", "Solution");
    put("Ass", "Assumption");
    vault.linkNodes("Root", "Opp");
    vault.linkNodes("Opp", "Sol");
    vault.linkNodes("Sol", "Ass");
    published = publishCallPreconditions({ vault, dir, productRepos: [], asOf: "2026-08-30" });
  });

  /**
   * The control that makes "published" mean something. Each row is a call shape
   * the corpus actually recorded being refused; the tool must still refuse it,
   * and `checkCall` must have said so first.
   */
  const refusedCalls: Array<{ id: string; tool: string; input: Record<string, unknown> }> = [
    { id: "node-exists", tool: "ost_annotate", input: { title: "credential", note: "x" } },
    { id: "parent-exists", tool: "ost_create_node", input: { title: "N", layer: "Solution", parent: "Nope", body: "b", evidence: "assertion", killIf: "no operator runs it twice in a fortnight", killBy: "2026-10-01" } },
    { id: "layer-may-attach", tool: "ost_create_node", input: { title: "N", layer: "Solution", parent: "Root", body: "b", evidence: "assertion", killIf: "no operator runs it twice in a fortnight", killBy: "2026-10-01" } },
    { id: "evidence-class-declared", tool: "ost_create_node", input: { title: "N", layer: "Opportunity", parent: "Root", body: "b", evidence: "undefined" } },
    { id: "instrument-is-a-spec-file", tool: "ost_set_instrument", input: { test: "Ass", instrument: 'npx vitest run test/a.test.ts -t "x"', why: "because it fails today" } },
    { id: "threshold-fixes-a-bar", tool: "ost_create_node", input: { title: "N", layer: "AssumptionTest", parent: "Ass", body: "b", evidence: "assertion", threshold: "we will see whether it works" } },
    { id: "no-reserved-heading-in-content", tool: "ost_append_to_node", input: { title: "Sol", section: "## Results\nit passed" } },
    { id: "status-is-agent-settable", tool: "ost_set_status", input: { title: "Sol", status: "validated" } },
    { id: "unknown-states-its-format", tool: "ost_create_node", input: { title: "N", layer: "Unknown", parent: "Root", body: "no sections here", evidence: "assertion" } },
    { id: "field-belongs-to-layer", tool: "ost_create_node", input: { title: "N", layer: "Opportunity", parent: "Root", body: "b", evidence: "assertion", threshold: "at least 5 of 20" } },
  ];

  for (const row of refusedCalls) {
    test(`${row.id}: the tool refuses it and the publication said so first`, async () => {
      await expect(call(row.tool, row.input)).rejects.toThrow();
      const violations = checkCall(published, row.tool, row.input);
      expect(violations.map((v) => v.id)).toContain(row.id);
    });
  }

  test("a legal call is refused by neither", async () => {
    const legal = {
      title: "A node that is fine",
      layer: "Solution",
      parent: "Opp",
      body: "prose",
      evidence: "assertion",
      killIf: "no operator has run it twice in a fortnight",
      killBy: "2026-10-01",
    };
    expect(checkCall(published, "ost_create_node", legal)).toEqual([]);
    await expect(call("ost_create_node", legal)).resolves.toBeTruthy();
  });

  test("the mcp-prefixed name resolves to the same rules", () => {
    const bare = checkCall(published, "ost_annotate", { title: "nope", note: "x" });
    const prefixed = checkCall(published, "mcp__ost-agent__ost_annotate", { title: "nope", note: "x" });
    expect(prefixed).toEqual(bare);
    expect(bare.map((v) => v.id)).toContain("node-exists");
  });

  test("checking a call changes nothing on disk", () => {
    const before = fs.readdirSync(dir).sort();
    for (const row of refusedCalls) checkCall(published, row.tool, row.input);
    expect(fs.readdirSync(dir).sort()).toEqual(before);
  });

  test("every published precondition names the symbol that enforces it, and it exists", () => {
    for (const p of CALL_PRECONDITIONS) {
      const [file, symbols] = p.enforcedBy.split(":");
      expect(fs.existsSync(path.join(repoRoot, "src", file))).toBe(true);
      const source = fs.readFileSync(path.join(repoRoot, "src", file), "utf8");
      // `Vault.has` is written `has(` in the class body, so the qualifier is for
      // the reader and the last segment is what has to exist in the file.
      for (const symbol of symbols.split(",")) {
        expect(source).toContain(symbol.split(".").pop()!);
      }
    }
  });

  test("a grade below `fully` must say why, and `fully` must not need to", () => {
    for (const p of CALL_PRECONDITIONS) {
      if (p.expressibility === "fully") expect(p.caveat).toBeUndefined();
      else expect(p.caveat && p.caveat.length > 40).toBe(true);
    }
  });

  test("the rendered publication leads with what it does NOT cover", () => {
    const text = renderCallPreconditions(published);
    expect(text.indexOf("NOT KNOWABLE BEFORE THE CALL")).toBeLessThan(text.indexOf("CHECKABLE AGAINST THIS SNAPSHOT"));
    for (const p of CALL_PRECONDITIONS) expect(text).toContain(p.id);
  });
});

describe("the census over the corpus", () => {
  test("the bar the assumption test fixed in advance is met, weighted by what fired", () => {
    const c = refusalPreconditionCensus(corpus());
    // Printed so a red run tells its reader the number, not just that a number moved.
    if (!c.meetsBar) console.log(formatRefusalPreconditionCensus(c));

    expect(c.total).toBe(118);
    expect(c.bar).toBe(REFUSAL_PRECONDITION_BAR);
    expect(c.fullyExpressible).toBe(96);
    expect(c.share).toBeGreaterThanOrEqual(0.7);
    expect(c.meetsBar).toBe(true);
  });

  test("and it is met because of one day — asserted by name so the exit code cannot stand alone", () => {
    const c = refusalPreconditionCensus(corpus());
    expect(c.largestIncident).toEqual({
      day: "2026-07-26",
      tool: "ost_annotate",
      class: "no-such-node",
      events: 61,
    });
    // 52% of the corpus is one caller in one sitting. Collapse it to the one
    // event it actually is and the idea does not clear its own bar.
    expect(c.shareWithoutLargestIncident).toBeLessThan(REFUSAL_PRECONDITION_BAR);
    expect(c.meetsBarWithoutLargestIncident).toBe(false);
  });

  test("what the publication cannot guarantee is counted, not omitted", () => {
    const c = refusalPreconditionCensus(corpus());
    // Decidable only against a product repo this tool does not own — the stale
    // published copy the solution node names as its own worst case.
    expect(c.caveated).toBe(21);
    // And the one the trace itself made unreadable.
    expect(c.unreadable).toBe(1);
    expect(c.unclassified).toBe(0);
  });

  test("flat over classes says something different from weighted over events", () => {
    const c = refusalPreconditionCensus(corpus());
    // 8 of 11 classes are `fully`, which is 73% — close to the weighted 81% by
    // coincidence rather than by construction, and it is reported so a reader can
    // see that the weighting did not manufacture the result on its own.
    expect(c.flatShare).toBeCloseTo(8 / 11, 5);
    expect(c.tallies.length).toBe(11);
  });
});
