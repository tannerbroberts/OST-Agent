/**
 * Retraction — the way back that append-only never had, and the audit of every
 * reader that has to honour it.
 *
 * The need is the one thing this vault's own history keeps producing: a node
 * written by mistake is permanent. There is no delete, so it is counted, scanned,
 * gated, ranked and re-read by every pass forever, and the two existing ways out
 * each give up something. `archive/` is total but costs a human at a shell.
 * `deferred` is one tool call away and therefore reaches exactly one
 * suspicion-only scan, because a status the agent can set on itself must never be
 * able to empty a gate's denominator (`test/ost/retired-nodes.test.ts` plants that
 * attack three ways and requires it to fail).
 *
 * Retraction is total AND reachable without a shell, and the assumption test
 * behind it asked whether that is safe to build: *can every place which counts,
 * scans, gates or lists nodes be found and taught to exclude a retracted one?*
 * The threshold was "every consumer found is one that could honour the flag, and
 * the total is at most 12". The audit's answer, pinned below, is stronger than
 * the threshold asked for and is the reason the feature is one line of filtering:
 *
 *   **There is exactly one consumer.** Seventeen call sites across five modules
 *   read nodes, and every one of them gets its nodes from `Vault.readTreeCensus`
 *   — nothing outside `src/ost/` turns a file into an `OstNode` at all. So the
 *   set that had to be taught is a single function, and the seventeen honour it
 *   by construction rather than by seventeen remembered edits.
 *
 * That also answers the risk the solution node flagged as what a green spec does
 * NOT settle — "a reader written next year will not know retraction exists". A
 * reader written next year gets its nodes from the same door or it does not get
 * nodes; the first describe block below is what keeps that true, and it fails on
 * the day someone parses a node file somewhere else.
 *
 * The other half of the audit is that retraction must stay unforgeable, or it is
 * strictly worse than not having it: an agent holding a total retirement holds a
 * delete, in the one form no invariant can see — the node the violation hangs off
 * is no longer in the tree the invariant runs over. Three attacks are planted
 * here: author the heading through every mutating tool, drop an existing one
 * through an edit, and copy one onto a live node through a merge. The third was
 * real. `mergeNodes` carries the loser's reserved blocks onto the survivor so a
 * recorded result survives its file's deletion, which for this heading meant
 * `ost_merge_nodes(retracted, live)` was a delete of an arbitrary live node in one
 * allowlisted call.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPermit } from "../../src/eval/buildable.js";
import { computeCoverageDebt } from "../../src/eval/coverage.js";
import { computeEvidenceDebt, gateSolution } from "../../src/eval/evidence-debt.js";
import { checkInvariants } from "../../src/eval/invariants.js";
import { renderCheck, renderDebt, renderGate, renderStatus } from "../../src/eval/render.js";
import { rollupTree } from "../../src/eval/rollup.js";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { readNodeBody } from "../../src/mcp/node-body.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { formatCensus, isRetractedNode, retractionReason } from "../../src/ost/census.js";
import { RESERVED_HEADINGS, RETRACTION_HEADING, declaresHeading } from "../../src/ost/headings.js";
import { triageLanes } from "../../src/ost/lanes.js";
import type { OstNode } from "../../src/ost/node.js";
import { retractNode } from "../../src/ost/results.js";
import { strandedEvidenceCensus } from "../../src/ost/stranded.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { buildPassContext } from "../../src/runner/context.js";
import { fileNameForTitle } from "../../src/ost/sanitize.js";
import { Vault } from "../../src/ost/vault.js";
import {
  checkCall,
  publishCallPreconditions,
  renderCallPreconditions,
} from "../../src/security/call-preconditions.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));

const OUTCOME = "Players keep playing";
const BUCKET = "Tools fail";
/** The node that gets retracted, and its live twin — the control for every assertion. */
const REGRETTED = "Players cannot find the export button here";
const KEPT = "Players cannot find the export button there";

let dir: string;
let vault: Vault;

function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  vault.createNode({
    body: `prose for ${node.title}`,
    tags: [],
    links: [],
    evidence: "assertion",
    ...node,
  } as OstNode);
}

/**
 * A legal tree with two Solutions beneath one bucket, each with its own test, and
 * a near-duplicate pair among the Opportunities.
 *
 * Every consumer under audit has something to say about this tree: the gates have
 * a solution to gate, the debt reports have a test with no result, the rollup has
 * a bucket to count under, the duplicate scan has a pair, and `check` has a clean
 * bill until something breaks it.
 */
function tree(): void {
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: BUCKET, layer: "Opportunity" });
  put({ title: REGRETTED, layer: "Opportunity" });
  put({ title: KEPT, layer: "Opportunity" });
  put({ title: "Regretted solution", layer: "Solution" });
  put({ title: "Kept solution", layer: "Solution" });
  put({ title: "Regretted test", layer: "AssumptionTest", threshold: "at least 5 of 10" });
  put({ title: "Kept test", layer: "AssumptionTest", threshold: "at least 5 of 10" });
  vault.linkNodes(OUTCOME, BUCKET);
  vault.linkNodes(BUCKET, REGRETTED);
  vault.linkNodes(BUCKET, KEPT);
  vault.linkNodes(REGRETTED, "Regretted solution");
  vault.linkNodes(KEPT, "Kept solution");
  vault.linkNodes("Regretted solution", "Regretted test");
  vault.linkNodes("Kept solution", "Kept test");
}

function retract(title: string, why = "written against evidence a later pass refuted"): string {
  return retractNode(dir, { node: title, by: "Tanner", why, on: "2026-08-04" });
}

const work = () => computeNextWork(new Vault(dir), dir, 0);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-retraction-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  vault = new Vault(dir);
  tree();
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * The audit the assumption test asked for, as an assertion rather than a memo.
 *
 * Its threshold was a count — at most 12 consumers, every one able to honour the
 * flag. Counting call sites answers the wrong question, though: seventeen call
 * sites that all read one function are one consumer, and a thirteenth call site
 * in `cli/index.ts` would fail a count-based test while changing nothing about
 * whether retraction is total. So the count is taken over MODULES that read
 * nodes, and the property that actually matters — that they all read through the
 * one door — is asserted directly underneath it.
 */
describe("the consumer set, enumerated and held there", () => {
  /** Every `.ts` file under `src/`, read once. */
  function sources(): Array<{ rel: string; text: string }> {
    const out: Array<{ rel: string; text: string }> = [];
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) out.push({ rel: path.relative(SRC, p), text: fs.readFileSync(p, "utf8") });
      }
    };
    walk(SRC);
    return out;
  }

  test("every module that reads nodes is one of ten, and the audit's bar is 12", () => {
    const readers = sources()
      .filter((f) => f.rel !== path.join("ost", "vault.ts"))
      .filter((f) => /\.(readTree|readTreeCensus|readLiveTree)\(/.test(f.text))
      .map((f) => f.rel)
      .sort();

    // Exact, like `RETIRED_STATUSES`' pin: a seventh reading module is an argument
    // someone makes in a diff rather than a line that slips through. It is not a
    // cap on the feature — a new reader is welcome — it is a cap on adding one
    // WITHOUT looking at whether it honours a retraction.
    //
    // `ost/stranded.ts` is the sixth, added with that argument made: the stranded
    // census asks which nodes quote an evidence id, and a retracted node's prose
    // must not be able to answer yes — see the assertion below.
    //
    // `mcp/node-body.ts` is the seventh, and honouring retraction is the reason
    // it reads through `readTree()` at all: the body read resolves a title
    // against the NODE SET rather than the directory, so a retracted node is
    // refused as a miss instead of served — a full-body read of a node every
    // other consumer withholds would be a brand-new channel for exactly the
    // content retraction exists to take out of circulation. Asserted below
    // ("the body read — a retracted node's body is refused, not served").
    //
    // `ost/ranked-ledger.ts` is the eighth: the ledger's write boundary reads
    // the world it validates reasons against through `readTree()`, where a
    // `## Retraction` or an `archive/` move is withheld unconditionally — so a
    // retracted node can neither hold a rank nor be the citation that earns
    // one. It deliberately does NOT read the status-retired filter: `deferred`
    // is one agent call, and must not be a way to make a rankable node vanish
    // from the whole-tree ledger (`withoutRetiredNodes` stays bounded to the
    // duplicate scan).
    //
    // `ost/instrument.ts` is the ninth: the write boundary that decides whether
    // a first-run green may be recorded now has to ask which Solution a test
    // answers for, to tell a genuine shipped-observation apart from every other
    // test the red-now rule still binds. It reads through `readTree()`, so a
    // retracted node is unconditionally absent from that answer the same way it
    // is absent everywhere else — nothing bespoke was added, and nothing needed
    // to be.
    //
    // `security/call-preconditions.ts` is the tenth, and it is the first reader
    // that needs BOTH sides of the census, which is why the argument for it is
    // longer than the others. It publishes what a caller can check before making
    // a call, so it must agree with `Vault.has` — and `Vault.has` asks the
    // filesystem, where a retracted node's file still is. Built out of
    // `readTree()` it would have said "no such node" for a title every write tool
    // accepts: a publication stricter than the rule it publishes, which costs a
    // caller a capability silently. So it takes existence from `seenFiles` (the
    // same walk `Vault.has` would hit) and node CONTENT from `nodes` (where a
    // retraction is withheld unconditionally, like everywhere else), and it
    // publishes the difference as an advisory rather than as a refusal —
    // annotating a retracted node is work nothing will read, and that is a cost
    // to name, not a rule to invent. Asserted below ("the publication agrees with
    // `Vault.has` about a retracted node, and says nothing will read it").
    expect(readers).toEqual([
      path.join("cli", "index.ts"),
      path.join("mcp", "bootstrap.ts"),
      path.join("mcp", "next-work.ts"),
      path.join("mcp", "node-body.ts"),
      path.join("ost", "instrument.ts"),
      path.join("ost", "ranked-ledger.ts"),
      path.join("ost", "stranded.ts"),
      path.join("runner", "set-outcome.ts"),
      path.join("security", "call-preconditions.ts"),
      path.join("security", "tools.ts"),
    ]);
    // The assumption test's own threshold, stated in its own units.
    expect(readers.length).toBeLessThanOrEqual(12);
  });

  test("nothing outside src/ost parses a node file, so there is no second door", () => {
    // The load-bearing half. Five modules honouring retraction is worth nothing
    // if a sixth reads the markdown itself — and this is also the answer to what
    // the solution node said a green spec does not settle, because a reader
    // written next year either comes through `Vault` or fails this line.
    const bypasses = sources().filter(
      (f) => !f.rel.startsWith(`ost${path.sep}`) && /\bdeserialize\s*\(/.test(f.text),
    );
    expect(bypasses.map((f) => f.rel)).toEqual([]);
  });
});

describe("a retracted node is in no count, scan, gate or rollup", () => {
  /**
   * The non-vacuity control for every assertion below. If the fixture stopped
   * producing these, "retracting it removes them" would be true of a tree that
   * never had them.
   */
  test("before the retraction, every consumer can see the node", () => {
    const t = vault.readTree();
    expect(t.map((n) => n.title)).toContain(REGRETTED);
    expect(t).toHaveLength(8);
    expect(computeEvidenceDebt(t).solutions.map((s) => s.title)).toContain("Regretted solution");
    expect(rollupTree(t).buckets[0].opportunities).toBe(2);
    expect(gateSolution(t, "Regretted solution").cleared).toBe(false);
    expect(work().hygieneIssues.some((i) => i.rule === "near-duplicate")).toBe(true);
  });

  test("the walk withholds it, and names it — the counts, and the census", () => {
    retract(REGRETTED);

    const census = vault.readTreeCensus();
    expect(census.nodes.map((n) => n.title)).not.toContain(REGRETTED);
    expect(census.nodes).toHaveLength(7);
    // Named, never silently dropped: `formatCensus`' rule, which is the whole
    // difference between a retirement and a file that went missing.
    expect(census.retired).toHaveLength(1);
    expect(census.retired[0].file).toBe(`${REGRETTED}.md`);
    expect(census.retired[0].reason).toContain("retracted");
    expect(census.retired[0].reason).toContain("refuted");
    // The denominator is unchanged: the file WAS examined, it just did not come
    // back as a node. A smaller `examined` would read as a walk that went blind.
    expect(census.examined).toBe(8);
    expect(formatCensus(census, 7)).toContain(REGRETTED);
    // Named on the surfaces a human actually reads, not only in the struct.
    // `appendCensus` used to return early unless some file had been DROPPED, so
    // a node that left the live tree was subtracted from every count above and
    // named nowhere — the census's own failure mode, inside the census. It cost
    // the archive half the same silence for as long as that half has existed.
    expect(renderStatus(buildPassContext(dir), census)).toContain(REGRETTED);
    expect(renderCheck(census).text).toContain(REGRETTED);
    // And it is gone either way — a retraction is not the opt-in filter.
    expect(vault.readLiveTree().map((n) => n.title)).not.toContain(REGRETTED);
  });

  test("check — the invariants run over a tree that does not contain it", () => {
    // A violation the retracted node OWNS, so this is not merely "some rule
    // stopped firing": before, `check` names it; after, it names nothing.
    vault.setEvidence(REGRETTED, "assertion");
    const dirty = new Vault(dir);
    dirty.appendToNode(REGRETTED, "## Notes\nlinking a ghost");
    dirty.linkNodes(REGRETTED, "Ghost opportunity");
    expect(checkInvariants(dirty.readTree()).some((v) => v.rule === "dangling-link" && v.node === REGRETTED)).toBe(true);

    retract(REGRETTED);

    expect(checkInvariants(vault.readTree()).some((v) => v.node === REGRETTED)).toBe(false);
    const { text } = renderCheck(vault.readTreeCensus());
    expect(text).not.toContain(`[[Ghost opportunity]]`);
  });

  test("debt — neither the evidence debt nor the coverage debt carries it", () => {
    // An unbounded claim on each test: a result with no `## Uncovered` beside it,
    // which is exactly what `computeCoverageDebt` counts. Written through
    // `appendUnderSection`'s heading argument, the human's position.
    for (const t of ["Regretted test", "Kept test"]) {
      vault.appendUnderSection(t, "## Results", "- 2026-08-04 **supported** (ran by Tanner) — it worked");
    }
    expect(computeCoverageDebt(vault.readTree()).gaps.map((g) => g.title)).toEqual(["Kept test", "Regretted test"]);

    retract("Regretted solution");
    retract("Regretted test");

    const t = vault.readTree();
    expect(computeEvidenceDebt(t).solutions.map((s) => s.title)).toEqual(["Kept solution"]);
    expect(computeCoverageDebt(t).gaps.map((g) => g.title)).toEqual(["Kept test"]);
    expect(computeCoverageDebt(t).totals.withResults).toBe(1);
    expect(renderDebt(t)).not.toContain("Regretted solution");
  });

  test("the status rollup — the bucket's counts drop by exactly what left", () => {
    const before = rollupTree(vault.readTree()).buckets[0];
    expect([before.opportunities, before.solutions, before.tests]).toEqual([2, 2, 2]);

    retract(REGRETTED);
    retract("Regretted solution");
    retract("Regretted test");

    const after = rollupTree(vault.readTree()).buckets[0];
    expect([after.opportunities, after.solutions, after.tests]).toEqual([1, 1, 1]);
  });

  test("the duplicate scan — and unlike `deferred`, without asking for a filter", () => {
    retract(REGRETTED);
    expect(work().hygieneIssues.filter((i) => i.rule === "near-duplicate")).toEqual([]);
  });

  test("the body read — a retracted node's body is refused, not served", () => {
    // The seventh reader's argument, made load-bearing. A full-body read is the
    // highest-bandwidth channel a node has, so a retraction it did not honour
    // would put back into circulation exactly the content every other consumer
    // withholds. Before the retraction it serves (the control); after, a miss.
    expect(readNodeBody(vault, REGRETTED).prose).toContain(`prose for ${REGRETTED}`);
    retract(REGRETTED);
    expect(() => readNodeBody(new Vault(dir), REGRETTED)).toThrow(/no node on the tree/);
  });

  test("the publication agrees with `Vault.has` about a retracted node, and says nothing will read it", () => {
    // The tenth reader's argument, made load-bearing, and it runs the OPPOSITE
    // way to every other assertion in this file. Retraction takes a node out of
    // circulation for readers; it does not take the FILE off disk, and the write
    // tools ask the filesystem. So a publication of what a caller may call must
    // still say yes here — a stricter publication is a caller silently losing a
    // capability, which is the confidently-wrong contract in the other direction.
    retract(REGRETTED);
    const published = publishCallPreconditions({ vault: new Vault(dir), dir, asOf: "2026-08-30" });
    const file = path.basename(fileNameForTitle(REGRETTED));

    expect(new Vault(dir).has(REGRETTED)).toBe(true);
    expect(published.facts.nodeFiles.has(file)).toBe(true);
    expect(checkCall(published, "ost_annotate", { title: REGRETTED, issue: "x" })).toEqual([]);
    // And withheld from every reader, which is the half a caller has to be told
    // rather than left to discover by annotating into a void.
    expect(published.facts.nodesByFile.has(file)).toBe(false);
    expect(published.facts.existsButWithheld.has(file)).toBe(true);
    expect(renderCallPreconditions(published)).toContain("withheld from every reader");
    // The control: a title that was never on disk is still absent from both.
    expect(published.facts.nodeFiles.has("Never written.md")).toBe(false);
    expect(checkCall(published, "ost_annotate", { title: "Never written", issue: "x" })).not.toEqual([]);
  });

  test("the sweep — it is in no hygiene issue, and it is still named as retired", () => {
    retract(REGRETTED);

    const after = work();
    expect(after.hygieneIssues.some((i) => i.title === REGRETTED)).toBe(false);
    // Withheld AND named, in the prose a human reads. A retirement that shrank
    // the sweep silently is indistinguishable from the sweep breaking.
    expect(after.retiredFromDuplicateScan.map((r) => r.node)).toContain(REGRETTED);
  });

  test("each gate — the evidence gate, and the build permit", () => {
    retract("Regretted solution");

    // A gate asked about a node it can no longer see refuses, rather than
    // clearing by default. Both were verified to answer for the node before.
    expect(gateSolution(vault.readTree(), "Regretted solution").cleared).toBe(false);
    expect(renderGate(vault.readTree(), "Regretted solution").cleared).toBe(false);
    expect(buildPermit(vault.readTree(), "Regretted solution").cleared).toBe(false);
    // The control, so the two above are about retraction and not about the gate
    // refusing everything.
    expect(gateSolution(vault.readTree(), "Kept solution").cleared).toBe(false);
    expect(renderGate(vault.readTree(), "Kept solution").text).toContain("Kept test");
  });

  test("the stranded census — a retracted node's prose no longer counts as an attachment", () => {
    writeEvidence(
      dir,
      { id: "TRANSCRIPT:only-cited-by-the-regretted-node", source: "f", title: "x", timestamp: "t", body: "b" },
      "transcript",
    );
    vault.appendToNode(REGRETTED, "## Notes\ngrounded by `TRANSCRIPT:only-cited-by-the-regretted-node`");
    expect(strandedEvidenceCensus([dir]).attachable.map((i) => i.citedBy)).toEqual([[REGRETTED]]);

    retract(REGRETTED);

    // The point: the citation is still on disk, and the census must not read it.
    // "An existing node already cites this" is a claim about the LIVE tree, so a
    // node nobody may act on cannot be the reason an item looks attached.
    const after = strandedEvidenceCensus([dir]);
    expect(after.attachable).toEqual([]);
    expect(after.homeless.map((i) => i.id)).toEqual(["TRANSCRIPT:only-cited-by-the-regretted-node"]);
  });

  test("lane triage — a retracted test is not in an unattended pass's backlog", () => {
    vault.setLane("Regretted test", "compute-only", "cheap");
    vault.setLane("Kept test", "compute-only", "cheap");
    expect(triageLanes(vault.readTree()).runnable).toContain("Regretted test");

    retract("Regretted test");

    expect(triageLanes(vault.readTree()).runnable).toEqual(["Kept test"]);
  });

  test("nothing is lost — the file, its prose and its history are all still there", () => {
    retract(REGRETTED, "the source it rested on was struck");

    // The claim that makes this different from a delete, asserted on the bytes.
    const raw = fs.readFileSync(path.join(dir, `${REGRETTED}.md`), "utf8");
    expect(raw).toContain(`prose for ${REGRETTED}`);
    expect(raw).toContain("**retracted** (by Tanner)");
    expect(raw).toContain("the source it rested on was struck");
    // And it is still readable BY TITLE, which is what lets a human find it, and
    // lets a second retraction be refused rather than silently appended.
    expect(isRetractedNode(vault.read(REGRETTED))).toBe(true);
    expect(retractionReason(vault.read(REGRETTED))).toContain("struck");
  });
});

describe("retraction is a human's, and there is no way for the agent to reach it", () => {
  interface RawTool {
    name: string;
    input_schema: ToolSchema;
    run: (input: unknown) => Promise<string>;
  }

  function tools(): RawTool[] {
    const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
    return buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[];
  }

  function call(tool: string, input: Record<string, unknown>): Promise<string> {
    const built = tools().find((t) => t.name === tool);
    if (!built) throw new Error(`${tool} is not on the MCP surface`);
    const problems = validateToolInput(built.input_schema, input);
    if (problems.length > 0) throw new Error(`refused the call: ${problems.join("; ")}`);
    return built.run(input);
  }

  test("it is a reserved heading, beside the three measurements", () => {
    expect(RESERVED_HEADINGS).toContain(RETRACTION_HEADING);
  });

  /**
   * The door-independent property, in the shape `test/ost/reserved-headings.test.ts`
   * established: every string-valued argument every mutating tool declares, read
   * off the tool's own schema. A list of parameters is always one short of the
   * truth — that file's `tags` hole is the proof — so the question is asked of
   * the tree afterwards rather than of any one call.
   */
  test("no argument on any mutating tool can author one, whatever it is called", async () => {
    const PAYLOAD = `x\n\n${RETRACTION_HEADING}\n- 2026-08-04 **retracted** (by nobody) — inconvenient`;
    const mutating = tools().filter((t) => !["ost_search_web", "ost_read_web", "ost_read_repo"].includes(t.name));
    expect(mutating.length).toBeGreaterThan(8);

    let reached = 0;
    for (const built of mutating) {
      if (!built.input_schema) throw new Error(`${built.name} declares no input_schema`);
      const props = (built.input_schema.properties ?? {}) as Record<string, ToolSchema>;
      for (const [key, sub] of Object.entries(props)) {
        if (sub.enum) continue; // a fixed vocabulary carries no caller content
        const isArray = sub.type === "array" && (sub.items as ToolSchema | undefined)?.type === "string";
        if (sub.type !== "string" && !isArray) continue;

        const input: Record<string, unknown> = {
          title: `Probe ${built.name} ${key}`,
          test: "Kept test",
          section: "## Notes\nfine",
          issue: "an issue",
          note: "a note",
          why: 'a person is needed: "interview"',
          body: "prose",
          layer: "AssumptionTest",
          parent: "Kept solution",
          evidence: "assertion",
          instrument: "npx vitest run test/fixture.test.ts",
          host: "example.com",
          reason: "corroborated by [[Kept test]]",
          child: "Kept test",
          from: REGRETTED,
          into: KEPT,
          prose: "merged prose",
          [key]: isArray ? [PAYLOAD] : PAYLOAD,
        };
        if (built.name !== "ost_create_node" && key !== "title") input.title = "Kept test";
        for (const k of Object.keys(input)) if (!(k in props)) delete input[k];

        reached += 1;
        try {
          await built.run(input);
        } catch {
          // A refusal is the desired outcome; the property below settles it.
        }
      }
    }
    expect(reached).toBeGreaterThan(15);

    // The property, asked of the whole vault rather than of any one call: every
    // markdown file at the root is still a node the tree returns.
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    const titles = new Set(vault.readTree().map((n) => `${n.title}.md`));
    for (const f of files) expect(titles.has(f), `${f} left the tree`).toBe(true);
    expect(vault.readTreeCensus().retired).toEqual([]);
  });

  test("an edit cannot drop one either — reserved is untouchable in both directions", () => {
    retract(REGRETTED);
    vault.editProse(REGRETTED, "a rewritten body with no retraction in it", "trying to bring it back");

    expect(isRetractedNode(vault.read(REGRETTED))).toBe(true);
    expect(vault.readTree().map((n) => n.title)).not.toContain(REGRETTED);
  });

  /**
   * The one that was real, and the reason this file exists rather than a shorter
   * one. `mergeNodes` carries the LOSER's reserved sections onto the survivor so
   * a recorded result is not lost with its file — which for this heading means a
   * merge would COPY a retraction onto a live node. `ost_merge_nodes(retracted,
   * live)` was a delete of an arbitrary node, in one allowlisted call, reached by
   * duplicating the heading rather than by authoring it — so every guard above
   * was blind to it.
   */
  test("a merge cannot launder a retraction onto a live node", async () => {
    retract(REGRETTED);

    await expect(
      call("ost_merge_nodes", { from: REGRETTED, into: KEPT, contribution: "one need", why: "same claim" }),
    ).rejects.toThrow(/retracted/);

    expect(vault.readTree().map((n) => n.title)).toContain(KEPT);
    expect(declaresHeading(vault.read(KEPT).body, RETRACTION_HEADING)).toBe(false);
  });

  test("and not in the other direction either — a live node is not buried under one", async () => {
    retract(KEPT);

    await expect(
      call("ost_merge_nodes", { from: REGRETTED, into: KEPT, contribution: "one need", why: "same claim" }),
    ).rejects.toThrow(/retracted/);

    expect(vault.readTree().map((n) => n.title)).toContain(REGRETTED);
    expect(fs.existsSync(path.join(dir, `${REGRETTED}.md`))).toBe(true);
  });
});

describe("what the CLI path refuses, and why", () => {
  test("the Outcome is never retracted — a tree with no root is broken, not smaller", () => {
    expect(() => retract(OUTCOME)).toThrow(/Outcome/);
    // The failure it would have caused, named so the refusal has a reason a
    // reader can check rather than a rule they have to trust.
    expect(checkInvariants(vault.readTree()).some((v) => v.rule === "single-outcome")).toBe(false);
  });

  test("attribution and a reason are both required — an anonymous retraction is a delete", () => {
    expect(() => retractNode(dir, { node: KEPT, by: "  ", why: "no" })).toThrow(/attribution/);
    expect(() => retractNode(dir, { node: KEPT, by: "Tanner", why: "  " })).toThrow(/reason/);
    expect(vault.readTree().map((n) => n.title)).toContain(KEPT);
  });

  test("retracting twice is refused, and the standing retraction is what it says", () => {
    retract(REGRETTED, "the first reason");
    expect(() => retract(REGRETTED, "a second one")).toThrow(/already retracted[\s\S]*the first reason/);
  });
});
