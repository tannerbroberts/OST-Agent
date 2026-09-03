/**
 * The loop publishes a stop condition it can evaluate, and idling is the honest
 * default.
 *
 * This is the spec for "Publish a stop condition the loop can evaluate, and make
 * idling the honest default", written against the failure the opportunity beneath
 * it records: six consecutive firings produced no structure at all while the
 * outstanding-work report named the same items every time. The loop had nothing
 * it could honestly do and nothing in the loop said so — so a governed agent
 * burned passes rediscovering the standstill and an ungoverned one would have
 * filled the quota with invented structure, both paid for identically.
 *
 * Three things have to hold, and this file is those three:
 *
 *   1. **The rule exists as data rather than prose.** Every work-bearing field of
 *      a sweep is either a term of the published condition or is declared
 *      not-actionable with a stated reason — never neither, never both. A field
 *      added to `ost_next_work` is an unclassified field until somebody decides
 *      which it is, and the condition's terms are pinned to the sweep's own
 *      `done` so the two gates cannot answer the same question differently.
 *   2. **An empty sweep makes it evaluate true, and the pass idles without
 *      writing.** Driven through the real CLI, because the wiring is the claim: a
 *      predicate nothing consults would satisfy a unit test and stop nothing.
 *      Asking the question must itself write nothing — a stopping condition that
 *      consumed a window is one nobody asks twice.
 *   3. **A pass that writes while the condition holds fails.** This is what makes
 *      idling the *honest* default rather than the polite one. The firing is
 *      judged on four things it cannot assert about itself: what the vault said
 *      when the run opened, how much evidence was on disk at each end, and what
 *      its own commits were made of.
 *
 * **What a green here does NOT settle, and cannot.** Whether "actionable by an
 * unattended pass right now" is decidable in a way two readers would agree on.
 * That is the assumption beneath this solution, its test is two people labelling
 * one sweep independently at ≥85% agreement, and it stays with the humans. Green
 * says the rule exists, evaluates, and is enforced. It does not say the rule is
 * right — and the failure mode named in the solution's own text is precisely a
 * predicate that hides the same ambiguity while sounding more certain.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { computeNextWork } from "../../src/mcp/next-work.js";
import { readRuns } from "../../src/loop/health.js";
import {
  evaluateStopCondition,
  idleBreach,
  OUTSTANDING_NOT_ACTIONABLE,
  STOP_CONDITION,
} from "../../src/loop/stop-condition.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";

// The local tsx binary, invoked directly rather than through `npx` — `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");

/** `loop stop`'s routine refusal: every term is zero. */
const NOTHING_ACTIONABLE = 23;

const OUTCOME = "Players keep playing";
const OPPORTUNITY = "Players cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Churned players noticed nothing changed";
const TEST = "Interview five churned players";

let vault: string;

interface Ran {
  code: number;
  out: string;
}

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** `out` is stdout AND stderr — the verdict lines are split across both. */
function loop(subcommand: string, ...args: string[]): Ran {
  const r = spawnSync(TSX, [CLI, "loop", subcommand, "--vault", vault, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function put(node: Partial<OstNode> & { title: string; layer: OstNode["layer"] }): void {
  new Vault(vault).createNode({
    body: `prose for ${node.title}`,
    tags: [],
    links: [],
    evidence: "assertion",
    ...node,
  } as OstNode);
}

/**
 * A complete, maintained tree: one opportunity, one solution, and a belief
 * beneath it whose test names a command that can come out red.
 *
 * Complete to the bottom on purpose. Every one of the five terms has to be zero
 * for an uninteresting reason, or the assertions below would pass for the wrong
 * one — the same care `test/mcp/rule-parity.test.ts` takes with its own fixture.
 */
function maintainedTree(): void {
  put({ title: OUTCOME, layer: "Outcome" });
  put({ title: OPPORTUNITY, layer: "Opportunity" });
  put({ title: SOLUTION, layer: "Solution" });
  put({ title: BELIEF, layer: "Assumption" });
  put({ title: TEST, layer: "AssumptionTest", instrument: "npx vitest run test/fixture.test.ts" });
  const v = new Vault(vault);
  v.linkNodes(OUTCOME, OPPORTUNITY);
  v.linkNodes(OPPORTUNITY, SOLUTION);
  v.linkNodes(SOLUTION, BELIEF);
  v.linkNodes(BELIEF, TEST);
}

/**
 * One outstanding item of a kind the condition counts: a second solution with no
 * assumption test beneath it. Work an unattended pass may do with the tools it
 * actually holds, which is the whole distinction the condition draws.
 */
function plantWork(): void {
  put({ title: "Send a weekly digest", layer: "Solution" });
  new Vault(vault).linkNodes(OPPORTUNITY, "Send a weekly digest");
}

/** The sweep as the loop takes it: the whole list, at the fixture's ideation minimum. */
function sweep() {
  return computeNextWork(new Vault(vault), vault, 1, undefined, undefined, undefined, Number.POSITIVE_INFINITY);
}

/** Commit whatever is in the tree, so `loop start` does not refuse a dirty vault. */
function commitAll(message: string): void {
  git("add", "-A");
  git("commit", "--quiet", "-m", message);
}

/**
 * One traced tool invocation, exactly as `withUsageTracing` writes them.
 *
 * A firing whose pass phase traces nothing seals `degraded`, and the brackets
 * here run `git --version` for their pass step — so this line stands for the pass
 * they are standing in for. It matters here beyond the borrowed convention: a
 * `degraded` verdict would mask the `unhealthy` this file is trying to observe,
 * and the breach has to outrank it for its own reasons.
 */
function traceToolCall(): void {
  fs.appendFileSync(
    path.join(vault, ".ost-agent", "usage", "events.jsonl"),
    JSON.stringify({ ts: new Date().toISOString(), tool: "ost_next_work", ok: true, ms: 2, surface: "mcp", argBytes: 8 }) + "\n",
    "utf8",
  );
}

/**
 * A commit the pass-shape classifier reads as this firing having authored
 * structure — the subject shape the MCP dispatcher writes for a node creation.
 *
 * `--allow-empty` because what is under test is the loop's reading of what a
 * firing did, and the classifier reads subjects and nothing else.
 */
function authorStructure(): void {
  git("commit", "--quiet", "--allow-empty", "-m", `mcp: ost_create_node — created "A node nobody asked for"`);
}

/** A commit the classifier reads as commentary — the honest idle pass's friction note. */
function writeCommentary(): void {
  git("commit", "--quiet", "--allow-empty", "-m", `mcp: ost_append_to_node — appended to "${OPPORTUNITY}"`);
}

/** One evidence record arriving mid-firing, the way `ost_ingest_inbox` leaves them. */
function ingestEvidence(id: string): void {
  const dir = path.join(vault, ".ost-agent", "evidence");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    ["---", `id: ${id}`, "source: INBOX:note.md", `title: ${id}`, `timestamp: ${new Date().toISOString()}`, "---", "", "a note"].join("\n"),
    "utf8",
  );
}

/** Open a run, run both required phases, and leave it open for the caller to seal. */
function openFiring(): Ran {
  const started = loop("start");
  expect(started.code, started.out).toBe(0);
  for (const phase of ["pass", "check"]) {
    const step = loop("step", "--phase", phase, "--", "git", "--version");
    expect(step.code, step.out).toBe(0);
  }
  traceToolCall();
  return started;
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-stop-condition-"));
  git("init", "--quiet");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("config", "commit.gpgsign", "false");
  fs.writeFileSync(
    path.join(vault, "ost.config.yaml"),
    ["outcome: keep players playing", "processes:", "  P3_ideate:", "    minSolutionsPerOpportunity: 1", ""].join("\n"),
    "utf8",
  );
  // Tracked and empty before the first firing, so the appends `traceToolCall`
  // makes read as a modification under `.ost-agent/usage/` — which the dirty-tree
  // gate exempts — rather than as an untracked `?? .ost-agent/`, which it refuses.
  const trace = path.join(vault, ".ost-agent", "usage", "events.jsonl");
  fs.mkdirSync(path.dirname(trace), { recursive: true });
  fs.writeFileSync(trace, "", "utf8");
  maintainedTree();
  commitAll("a maintained tree");
});
afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

describe("1 — the stop condition is published as data, not as prose", () => {
  test("every term names a sweep field, an action, and a way to count itself", () => {
    expect(STOP_CONDITION.length).toBeGreaterThan(0);
    const work = sweep();
    for (const term of STOP_CONDITION) {
      expect(term.id, "a term with no id cannot be reported or recorded").toMatch(/^[a-z][a-z-]+$/);
      expect(term.action.length, `${term.id} names no action, so a pass reading it learns nothing`).toBeGreaterThan(10);
      expect(typeof term.count(work), `${term.id} does not count`).toBe("number");
    }
    // Ids are the handle a run record and an operator both use. Two terms sharing
    // one would make a ledger line ambiguous about which queue went quiet.
    expect(new Set(STOP_CONDITION.map((t) => t.id)).size).toBe(STOP_CONDITION.length);
  });

  test("every work-bearing field of a sweep is claimed or declared — never neither, never both", () => {
    // The partition, computed against a REAL sweep rather than a written-down
    // list, so a field added to `NextWork` is unclassified until somebody decides
    // which side it is on. This is `test/mcp/rule-parity.test.ts`'s shape applied
    // to the loop's stopping question, and for the same reason: two gates that can
    // disagree permanently about what is outstanding are not gates.
    const work = sweep();
    // `version` is bookkeeping in the same sense `framing` is: it names no work
    // and no actor, it says which tree state the lists beside it were taken over
    // so a caller can ask whether they still hold (`src/ost/tree-version.ts`).
    // A stop condition computed over it would be firing on the tree changing
    // rather than on anything being outstanding.
    const bookkeeping = new Set(["framing", "version", "done", "summary", "scope", "truncated"]);
    const fields = Object.keys(work).filter((k) => !bookkeeping.has(k));
    // `assumptionWork` is a record of five queues rather than one list, and each
    // is classified on its own — a single verdict over the group would hide that
    // `runnable` and `needsHumans` are outstanding for entirely different reasons.
    const expanded = fields.flatMap((f) =>
      f === "assumptionWork" ? Object.keys(work.assumptionWork).map((q) => `assumptionWork.${q}`) : [f],
    );

    const claimed = STOP_CONDITION.map((t) => t.field);
    const declared = OUTSTANDING_NOT_ACTIONABLE.map((n) => n.field);
    expect([...claimed, ...declared].sort()).toEqual([...expanded].sort());
    expect(claimed.filter((f) => declared.includes(f))).toEqual([]);
  });

  test("every not-actionable declaration states a reason, not just a name", () => {
    // A stop condition is a claim that the loop may go quiet while a report still
    // names open items. The only thing separating that from an amnesty is being
    // able to say, per field, why the item is somebody else's.
    for (const n of OUTSTANDING_NOT_ACTIONABLE) {
      expect(n.why.length, `${n.field} is declared not-actionable with no reason`).toBeGreaterThan(80);
    }
  });

  test("the terms are exactly the sweep's own done-blocking set", () => {
    // Pinned in both directions on real trees rather than asserted as a list. Two
    // gates answering the same question with different arithmetic is the defect
    // this repository has already paid for once, and there is no third thing to
    // break the tie.
    expect(evaluateStopCondition(sweep()).holds).toBe(sweep().done);
    plantWork();
    expect(evaluateStopCondition(sweep()).holds).toBe(sweep().done);
    expect(sweep().done).toBe(false);
  });

  test("a term counts the whole queue, not the page of it a sweep displays", () => {
    // Display caps cannot change the verdict — a capped list is never empty — but
    // they can change the NUMBER, and the number is what an operator raises a
    // cadence on. 25 hygiene issues beside a real 1,700 ends an investigation
    // early.
    for (let i = 0; i < 30; i += 1) {
      put({ title: `Candidate number ${i}`, layer: "Solution" });
      new Vault(vault).linkNodes(OPPORTUNITY, `Candidate number ${i}`);
    }
    const capped = computeNextWork(new Vault(vault), vault, 1);
    expect(capped.solutionsMissingAssumptions.length).toBe(25);
    const term = evaluateStopCondition(capped).terms.find((t) => t.field === "solutionsMissingAssumptions")!;
    expect(term.count).toBe(30);
  });
});

describe("2 — an empty sweep makes the condition hold, and the pass idles without writing", () => {
  test("a maintained tree stops the loop, and says which declaration accounts for what is left", () => {
    const r = loop("stop");
    expect(r.code, r.out).toBe(NOTHING_ACTIONABLE);
    expect(r.out).toMatch(/nothing an unattended pass may act on/);
    expect(r.out).toMatch(/Idling is the honest outcome/);
  });

  test("asking the question writes nothing — no commit, no ledger line, no dirty file", () => {
    // A stopping condition that consumed a window, took a lock or left a record is
    // one nobody asks twice, and an operator has to be able to ask it at any
    // moment to find out why the loop is quiet.
    const head = git("rev-parse", "HEAD").trim();
    const runsBefore = readRuns(vault).length;
    expect(loop("stop").code).toBe(NOTHING_ACTIONABLE);
    expect(git("rev-parse", "HEAD").trim()).toBe(head);
    expect(git("status", "--porcelain").trim()).toBe("");
    expect(readRuns(vault).length).toBe(runsBefore);
  });

  test("outstanding work makes it go, and names the term that is not zero", () => {
    plantWork();
    commitAll("one solution with nothing beneath it");
    const r = loop("stop");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/go: .*solutionsMissingAssumptions/);
  });

  test("a sweep that cannot be taken is not a stop — it is loud, and enforces nothing", () => {
    // The one way this gate could do real damage: idling a loop forever on the
    // strength of a tree nobody could read. "Cannot tell" is not "nothing to do".
    fs.writeFileSync(path.join(vault, "ost.config.yaml"), "outcome: [unclosed\n", "utf8");
    const r = loop("stop");
    expect(r.code).not.toBe(NOTHING_ACTIONABLE);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/cannot evaluate/);
  });

  test("the firing is told at the top of the run, not only judged at the end", () => {
    // A rule enforced at seal and never announced at start would fail a firing for
    // a standard it was never given, which is the shape of gate people rightly
    // switch off.
    const started = loop("start");
    expect(started.code, started.out).toBe(0);
    expect(started.out).toMatch(/the stop condition holds/);
    expect(started.out).toMatch(/author nothing/);
  });
});

describe("3 — a pass that writes while the condition holds fails", () => {
  test("authoring structure against an empty sweep seals unhealthy", () => {
    openFiring();
    authorStructure();
    const sealed = loop("seal");
    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.code, "a breaching firing exited 0 — the merge gate would never see it").toBe(1);
    expect(sealed.out).toMatch(/stop condition breached/);

    const [run] = readRuns(vault);
    expect(run.stopCondition?.heldAtStart).toBe(true);
    expect(run.stopCondition?.closed?.shape?.structure).toBe(1);
    expect(idleBreach(run.stopCondition)?.authored).toBe(1);
  });

  test("idling and saying so is not a breach — commentary is the honest move, and it seals clean", () => {
    // The behaviour this whole line of work wants: the pass reads, finds nothing
    // it may do, files a note about the standstill and stops. If that failed too,
    // the rule would be "produce nothing at all", and a pass with something to say
    // about why it is idle would be punished for saying it.
    openFiring();
    writeCommentary();
    const sealed = loop("seal");
    expect(sealed.code, sealed.out).toBe(0);
    expect(sealed.out).not.toMatch(/unhealthy/);
    expect(sealed.out).toMatch(/authored no structure/);
  });

  test("a firing with real work to do may author all it likes", () => {
    // The control that makes the rule about idleness rather than about writing.
    // Same commits, same bracket; the only difference is that the sweep had
    // something in it when the run opened.
    plantWork();
    commitAll("work to do");
    openFiring();
    authorStructure();
    const sealed = loop("seal");
    expect(sealed.code, sealed.out).toBe(0);
    expect(readRuns(vault)[0].stopCondition?.heldAtStart).toBe(false);
    expect(sealed.out).toMatch(/did not hold when this run opened/);
  });

  test("new evidence arriving mid-pass voids the start reading — an ingesting firing is judged on nothing", () => {
    // The conjunct that keeps an honest pass out of trouble. Ingestion happens
    // INSIDE the firing, so a pass that captured inbox notes and mapped them is
    // doing its job against a sweep that could not have known they existed.
    openFiring();
    ingestEvidence("inbox-2026-08-30-a-note");
    authorStructure();
    const sealed = loop("seal");
    expect(sealed.code, sealed.out).toBe(0);
    expect(sealed.out).toMatch(/new evidence record\(s\) arrived/);
    expect(idleBreach(readRuns(vault)[0].stopCondition)).toBeNull();
  });

  test("the verdict comes from the vault, not from anything the firing says about itself", () => {
    // Every conjunct is an observation the pass cannot make: the sweep at open,
    // the evidence count at both ends, and the subjects of commits the loop's own
    // dispatcher writes. There is deliberately no flag, argument or file by which
    // a firing can tell `seal` it was idle.
    openFiring();
    authorStructure();
    const sealed = loop("seal", "--attempted", "I idled honestly and wrote nothing at all");
    expect(sealed.out).toMatch(/sealed: unhealthy/);
    expect(sealed.code).toBe(1);
  });
});
