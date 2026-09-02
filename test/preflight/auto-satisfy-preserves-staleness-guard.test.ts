/**
 * The instrument for "Auto-satisfy a read-before-write, then change the file
 * underneath and require the write to still refuse" — the assumption test under
 * "The surface satisfies a precondition it could have satisfied itself".
 *
 * The belief the assumption states, so it could be false: *a surface that quietly
 * performs the prerequisite read on the caller's behalf loses nothing, because the
 * read was pure ceremony.* The vault's own record says otherwise in the same
 * breath — read-before-write is what makes "modified since read" detectable, and a
 * surface that auto-reads immediately before writing satisfies the letter of the
 * precondition while destroying the check, because the read it performs is always
 * fresh. Session `57249c25` recorded both refusals in one run, which is the pair
 * that shows the handshake carrying information.
 *
 * **Threshold, fixed in advance and not a rate:** with auto-satisfaction enabled, a
 * write whose target changed after the caller's own read is still refused. One
 * silent overwrite is a failure.
 *
 * ## What this file drives, and why that matters
 *
 * The node that commissioned this test says it was written blind — "missing-file
 * red rather than mechanism-missing red, because the pass that wrote it had no
 * repository sight … re-point it at the real guard module before trusting a
 * green." So nothing here is a mock. The staleness half runs through the real
 * `ost_merge_nodes` and the real `ost_read_tree` from one `buildOstTools` call,
 * because the tool set IS the session — the receipt book lives in that closure —
 * and the file is mutated on disk between them, out of band, exactly as a second
 * pass or a `git checkout` would. The auto-satisfied half runs through the real
 * MCP dispatch point, which is the only place on this surface where a closed
 * parameter set is enforced.
 *
 * ## The controls, which are what make a green mean anything
 *
 * A surface that auto-satisfied nothing would pass every staleness assertion
 * below and would not be the thing this test was commissioned to check. A surface
 * that auto-satisfied everything would pass every discharge assertion and would be
 * the failure the assumption predicts. So both directions are asserted on the same
 * code path: the closed parameter set IS discharged, the read-before-write
 * handshake is NOT, and the policy that separates them is required to classify
 * every precondition the surface publishes — so a precondition added later cannot
 * arrive unclassified and read as safe by omission.
 *
 * ## What a green does NOT settle, restated from the node
 *
 * Only that the staleness guard survives one narrowing. It does not establish that
 * removing preconditions is what operators want, that the narrowed solution still
 * removes enough friction to matter, or that the remaining ceremony is the
 * expensive part.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";
import {
  AUTO_SATISFY_RULE,
  autoSatisfyInput,
  createDischargeLedger,
  DISCHARGE,
  dischargeOf,
  DISPATCH_PRECONDITIONS,
  mayAutoSatisfy,
  renderDischarges,
} from "../../src/security/auto-satisfy.js";
import { CALL_PRECONDITIONS, checkCall, publishCallPreconditions } from "../../src/security/call-preconditions.js";
import { createReadReceipts } from "../../src/security/read-receipts.js";
import { assertSurvivorUnchanged, bodyStamp, buildOstTools, type ToolContext } from "../../src/security/tools.js";
import type { ToolSchema } from "../../src/security/validateToolInput.js";

const LOSER = "My tools fail locally";
const SURVIVOR = "Tools break on my machine";
const WHY = "the same need, written twice";
const CONTRIBUTION = "It also happens on a fresh checkout.";
const mergeCall = { from: LOSER, into: SURVIVOR, contribution: CONTRIBUTION, why: WHY };

interface RawTool {
  name: string;
  inputSchema: ToolSchema;
  run: (input: unknown) => Promise<string>;
}

let dirs: string[];

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const node = (title: string, layer: OstNode["layer"], body: string): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body,
});

/** One session: a vault holding two duplicates, and ONE tool set over it. */
function session(): { readTree: RawTool; merge: RawTool; vault: Vault; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-auto-satisfy-"));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  const vault = new Vault(dir);
  vault.createNode(node("Root", "Outcome", "The mandate."));
  vault.createNode(node(SURVIVOR, "Opportunity", "First framing, at some length, written by a person who was there."));
  vault.createNode(node(LOSER, "Opportunity", "Second framing."));
  vault.linkNodes("Root", SURVIVOR);
  vault.linkNodes("Root", LOSER);

  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test" };
  const tools = buildOstTools(ctx) as unknown as RawTool[];
  const byName = (name: string): RawTool => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`${name} is not on the tool surface`);
    return t;
  };
  return { readTree: byName("ost_read_tree"), merge: byName("ost_merge_nodes"), vault, dir };
}

/**
 * Change the survivor on disk without going through any tool — the concurrent
 * writer the guard exists for. A person in an editor, a second pass, a `git
 * checkout` landing a branch. Appended to the prose region so nothing about the
 * node's shape changes; only its content moves.
 */
function mutateUnderneath(vault: Vault, title: string): void {
  const file = vault.pathFor(title);
  fs.writeFileSync(file, `${fs.readFileSync(file, "utf8")}\n\nSomebody else added this while you were composing.\n`, "utf8");
}

// ── the rule, before anything is measured against it ─────────────────────────

describe("the scope was written down before the code that applies it", () => {
  test("the bar is the assumption test's, word for word, and it is zero-tolerance", () => {
    expect(AUTO_SATISFY_RULE.bar).toContain("still refused");
    expect(AUTO_SATISFY_RULE.bar).toContain("One silent overwrite is a failure");
  });

  test("all three conditions must hold, and the third is the one that decides", () => {
    expect(AUTO_SATISFY_RULE.conditions.map((c) => c.id)).toEqual(["held", "unique", "no-detection-duty"]);
  });

  test("`auto` is the exception: every verdict states a duty unless it has none", () => {
    for (const d of DISCHARGE) {
      expect(d.because.length, `${d.id} gives no reason`).toBeGreaterThan(10);
      if (d.verdict === "auto") expect(d.detectionDuty, `${d.id} is auto and claims a duty`).toBeNull();
      else expect(d.detectionDuty?.length ?? 0, `${d.id} refuses and names no duty`).toBeGreaterThan(10);
    }
  });

  test("every precondition the surface publishes carries a verdict here", () => {
    // Without this, a precondition added next month arrives unclassified and
    // `mayAutoSatisfy` answers `false` for it — the right answer, reached by
    // omission rather than by decision. The point of the policy is that somebody
    // looked at each one, so an id with no entry is a failure and not a default.
    const unclassified = CALL_PRECONDITIONS.filter((p) => dischargeOf(p.id) === undefined).map((p) => p.id);
    expect(unclassified, "these preconditions have no discharge verdict — classify them in auto-satisfy.ts").toEqual([]);
  });

  test("and every verdict speaks about a rule that exists", () => {
    // The other direction. A policy entry for a precondition nobody enforces is a
    // second statement of a rule, which is the drift failure this repository has
    // paid for once — a guard that derived the rule it was checking agreed with
    // the bug for 23 releases.
    const published = new Set<string>(CALL_PRECONDITIONS.map((p) => p.id));
    const orphans = DISCHARGE.filter(
      (d) => !published.has(d.id) && !(DISPATCH_PRECONDITIONS as readonly string[]).includes(d.id),
    ).map((d) => d.id);
    expect(orphans, "these verdicts name no precondition this surface enforces").toEqual([]);
  });

  test("ONE of twenty-four is auto — the ratio is the finding, not an accident of effort", () => {
    // Asserted rather than left as prose. The solution node reads as a broad idea;
    // applied to a real surface one rule at a time it reaches almost nothing, and
    // a later edit that widens it silently would be the interesting thing to
    // notice. If a second precondition genuinely becomes dischargeable, this fails
    // and the finding gets restated rather than quietly outgrown.
    const auto = DISCHARGE.filter((d) => d.verdict === "auto").map((d) => d.id);
    expect(auto).toEqual(["closed-parameter-set"]);
    expect(DISCHARGE.length).toBe(CALL_PRECONDITIONS.length + DISPATCH_PRECONDITIONS.length);
  });
});

// ── the half the assumption predicted would break ────────────────────────────

describe("the staleness guard survives auto-satisfaction", () => {
  test("THE BAR: read, change the file underneath, and the merge is still refused", async () => {
    const { readTree, merge, vault } = session();

    // The caller does the thing the handshake asks for, in full.
    await readTree.run({ node: SURVIVOR });
    // …and the world moves under it, with nothing on this surface involved.
    mutateUnderneath(vault, SURVIVOR);

    await expect(merge.run(mergeCall)).rejects.toThrow(/has changed since this session was served its body/);

    // Refused means refused. One silent overwrite fails this file, so the assertion
    // is on the disk rather than on the exception: the loser is still there and the
    // survivor never took the contribution.
    expect(vault.has(LOSER)).toBe(true);
    expect(vault.read(SURVIVOR).body).not.toContain(CONTRIBUTION);
  });

  test("and it is the CHANGE that refuses it, not the reading — an unmoved survivor merges", async () => {
    // The control that makes the assertion above mean something. A guard that
    // refused every merge would satisfy it perfectly and be worthless.
    const { readTree, merge, vault } = session();
    await readTree.run({ node: SURVIVOR });
    await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);
    expect(vault.has(LOSER)).toBe(false);
  });

  test("re-reading clears it, and the refusal names that as the remedy", async () => {
    const { readTree, merge, vault } = session();
    await readTree.run({ node: SURVIVOR });
    mutateUnderneath(vault, SURVIVOR);

    const refusal = await merge.run(mergeCall).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(refusal).toContain(`ost_read_tree({ node: "${SURVIVOR}" })`);
    // And it says out loud that the surface will not do this read for the caller,
    // because that is the one repair that would look helpful and delete the check.
    expect(refusal).toMatch(/will not do this read for you/);

    await readTree.run({ node: SURVIVOR });
    await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);
  });

  test("a change this session caused fires it too, and the refusal says so", async () => {
    // Not a corner case: it is what a pass folding three duplicates into one
    // survivor now hits on its second merge. The first merge appended a dated
    // heading, so "only what the loser says that the survivor does not" is being
    // evaluated against prose the caller has not seen. Costing a read there is the
    // guard working, and the refusal has to distinguish it from a race or the
    // caller will go looking for a writer that was never there.
    const { readTree, merge, vault } = session();
    vault.createNode(node("A third framing", "Opportunity", "Third."));
    vault.linkNodes("Root", "A third framing");

    await readTree.run({ node: SURVIVOR });
    await expect(merge.run(mergeCall)).resolves.toMatch(/merged/);

    const second = { from: "A third framing", into: SURVIVOR, contribution: "And on Windows.", why: WHY };
    const refusal = await merge.run(second).then(
      () => "",
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    expect(refusal).toMatch(/including an earlier write of your own in this same session/);
  });

  test("the guard is the stamp, not the title: an unstamped receipt reads as stale", () => {
    // The direction to fail in. A receipt the surface could not stamp is one no
    // check can speak to, and treating it as fine would be a hole with a clean
    // exit code over it.
    const { vault } = session();
    const receipts = createReadReceipts();
    receipts.record(SURVIVOR, "");
    expect(() => assertSurvivorUnchanged(vault, receipts, SURVIVOR)).toThrow(/has changed since/);

    receipts.record(SURVIVOR, bodyStamp(vault, SURVIVOR)!);
    expect(() => assertSurvivorUnchanged(vault, receipts, SURVIVOR)).not.toThrow();
  });

  test("the stamp is of the FILE, so a change outside the served prose still counts", () => {
    // `readNodeBody` caps prose and holds `## Results` / `## Instrument Log`
    // aside. A stamp taken over what was displayed would miss a change past the
    // cap or inside a reserved section — and a reserved section is where recorded
    // measurements live.
    const { vault } = session();
    const before = bodyStamp(vault, SURVIVOR)!;
    vault.annotate(SURVIVOR, "a hygiene note appended by somebody else");
    expect(bodyStamp(vault, SURVIVOR)).not.toBe(before);
  });

  test("the publication agrees with the tool, in both directions", async () => {
    // The anti-drift control this repository already runs `call-preconditions.ts`
    // under: a published rule that says yes where the tool says no is worse than
    // no publication, because a caller screening its calls would be confidently
    // wrong. Checked at the exact moment the two could disagree — after the read,
    // after the mutation.
    const { vault, dir } = session();
    const receipts = createReadReceipts();
    const tools = buildOstTools({ vault, dir, remote: { enabled: false }, readReceipts: receipts }) as unknown as RawTool[];
    const readTree = tools.find((t) => t.name === "ost_read_tree")!;
    const merge = tools.find((t) => t.name === "ost_merge_nodes")!;

    await readTree.run({ node: SURVIVOR });
    const fresh = publishCallPreconditions({ vault, dir, readReceipts: receipts, asOf: "2026-09-02" });
    expect(checkCall(fresh, "ost_merge_nodes", mergeCall)).toEqual([]);

    mutateUnderneath(vault, SURVIVOR);
    const stale = publishCallPreconditions({ vault, dir, readReceipts: receipts, asOf: "2026-09-02" });
    expect(checkCall(stale, "ost_merge_nodes", mergeCall).map((v) => v.id)).toEqual(["survivor-body-unchanged"]);
    // And the tool refuses the same call, which is the half that makes the
    // publication worth reading.
    await expect(merge.run(mergeCall)).rejects.toThrow(/has changed since/);
  });

  test("a survivor never read reports the OTHER refusal, not both at once", async () => {
    // A caller handed two objections for one call is the friction this whole
    // branch of the tree is about. `survivor-body-read` owns the never-read case.
    const { vault, dir } = session();
    const receipts = createReadReceipts();
    const published = publishCallPreconditions({ vault, dir, readReceipts: receipts, asOf: "2026-09-02" });
    expect(published.facts.staleBodies.size).toBe(0);
    expect(checkCall(published, "ost_merge_nodes", mergeCall).map((v) => v.id)).toEqual(["survivor-body-read"]);
  });
});

// ── the half the assumption said would survive the narrowing ─────────────────

describe("a precondition with no detection duty IS satisfied for the caller", () => {
  const schema: ToolSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      issue: { type: "string" },
      count: { type: "number" },
    },
    required: ["title"],
  };

  test("a misspelled property is read as the one it is a typo away from", () => {
    const out = autoSatisfyInput("ost_annotate", schema, { titl: "A node", issue: "x" });
    expect(out.input).toEqual({ title: "A node", issue: "x" });
    expect(out.discharges).toHaveLength(1);
    expect(out.discharges[0].precondition).toBe("closed-parameter-set");
    expect(out.discharges[0].tool).toBe("ost_annotate");
  });

  test("and the caller is told, so the absorbed signal is counted rather than lost", () => {
    const out = autoSatisfyInput("ost_annotate", schema, { titl: "A node" });
    const note = renderDischarges(out.discharges);
    expect(note).toContain("satisfied a precondition for you");
    expect(note).toContain("`titl`");
    expect(note).toContain("`title`");
    // The ledger is the countable half; the note is the readable one.
    const ledger = createDischargeLedger();
    for (const d of out.discharges) ledger.record(d);
    expect(ledger.entries()).toHaveLength(1);
  });

  test("a TRANSPOSITION in a short name is not repaired, and that is a real limit", () => {
    // `titel` for `title` is the commonest typo there is, and this does not fix
    // it. `fs/near-miss.ts` scores with Levenshtein, where a transposition costs
    // two edits, against a tolerance of `floor(length / 4)` — which is 1 for any
    // name under eight characters. So the discharge reaches long property names
    // (`contribution`, `prerequisite`) and misses short ones.
    //
    // Recorded as an assertion rather than left for someone to rediscover: the
    // fix is a Damerau distance in `near-miss.ts`, and that module also decides
    // which FILE a failed path lookup suggests, where a transposition being out
    // of reach is a deliberate conservatism. Widening it is a change to that
    // question, not to this one, so it is named here instead of taken.
    expect(autoSatisfyInput("ost_annotate", schema, { titel: "A node" }).discharges).toEqual([]);
    const long: ToolSchema = { type: "object", additionalProperties: false, properties: { contribution: {} } };
    expect(autoSatisfyInput("t", long, { contirbution: "x" }).discharges).toHaveLength(1);
  });

  test("a name with no unique target is NOT repaired — the surface does not guess", () => {
    // `note` is five edits from `title` and five from `issue`. This is the
    // `ost_annotate({note})` incident the input validator was written for, and
    // auto-satisfaction must not resurrect it: inventing a target here is how the
    // string "undefined" reached fourteen nodes permanently.
    expect(autoSatisfyInput("ost_annotate", schema, { note: "x", title: "A node" }).discharges).toEqual([]);
    // Nor a tie. `nearestName` refuses two equally close candidates outright.
    const tied: ToolSchema = { type: "object", additionalProperties: false, properties: { fold: {}, gold: {} } };
    expect(autoSatisfyInput("t", tied, { bold: 1 }).discharges).toEqual([]);
  });

  test("a repair onto a property the caller also supplied is refused", () => {
    // Two values for one property is not a spelling correction, and picking one
    // is exactly the guess condition `unique` exists to forbid.
    expect(autoSatisfyInput("ost_annotate", schema, { titl: "one", title: "two" }).discharges).toEqual([]);
  });

  test("a repair that would not survive the schema it lands in is refused", () => {
    // A `count` handed a string does not become valid by being spelled right, and
    // a repair that trades one refusal for another has spent the turn it saved.
    expect(autoSatisfyInput("t", schema, { cont: "seven" }).discharges).toEqual([]);
    expect(autoSatisfyInput("t", schema, { cont: 7 }).discharges).toHaveLength(1);
  });

  test("a missing REQUIRED property is never invented", () => {
    // No unique value exists, so `held` and `unique` both fail. The call is
    // refused exactly as before.
    const out = autoSatisfyInput("t", schema, { issue: "x" });
    expect(out.discharges).toEqual([]);
    expect(out.input).toEqual({ issue: "x" });
  });

  test("an open schema is left alone entirely", () => {
    const open: ToolSchema = { type: "object", properties: { title: { type: "string" } } };
    expect(autoSatisfyInput("t", open, { titel: "x" }).discharges).toEqual([]);
  });
});

// ── the distinction itself, which is the thing under test ────────────────────

describe("the surface distinguishes the two, and the distinction is the finding", () => {
  test("one precondition is discharged and the other never is", () => {
    expect(mayAutoSatisfy("closed-parameter-set")).toBe(true);
    expect(mayAutoSatisfy("survivor-body-read")).toBe(false);
    expect(mayAutoSatisfy("survivor-body-unchanged")).toBe(false);
    // An id nobody classified is not silently safe.
    expect(mayAutoSatisfy("something-invented-later")).toBe(false);
  });

  test("the read-before-write refusal is the one the corpus recorded most, and it stands", async () => {
    // Stated as an assertion rather than a comment because it is the whole
    // outcome: the single most frequent refusal in this project's friction
    // corpus — twenty occurrences in eleven sessions — is the one the solution
    // most wants removed, and it is the one that may not be. A future change
    // that flips this to a pass is the silent overwrite this file exists to stop.
    const { merge, vault } = session();
    await expect(merge.run(mergeCall)).rejects.toThrow(/has not read its body/);
    expect(vault.has(LOSER)).toBe(true);
  });

  test("both halves of the handshake name the same duty, and it is the staleness check", () => {
    for (const id of ["survivor-body-read", "survivor-body-unchanged"]) {
      expect(dischargeOf(id)!.detectionDuty).toMatch(/detect|Discharging|detection/);
    }
  });
});
