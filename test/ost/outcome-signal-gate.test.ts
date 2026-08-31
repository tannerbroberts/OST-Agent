/**
 * The instrument for "No call on the agent surface can mark the outcome achieved
 * without a declared external signal".
 *
 * The threshold this file was written to, verbatim from the assumption test:
 * *enumerate every write on the agent tool surface and attempt, through each, to
 * record the root Outcome as achieved while no external signal is declared. All
 * must refuse. One path that succeeds fails the test — a gate with one way around
 * it is not a gate.*
 *
 * **The enumeration is the point and it is derived, not typed out.** The write
 * surface here is `MCP_TOOL_NAMES.filter(writesTheVault)` — the complement of the
 * read-only set, the same derivation `mcp/server.ts` uses to decide what it
 * commits. Every name it yields must appear in one of the two tables below, and
 * the assertion that says so is the first test in the file. A tool added to the
 * surface tomorrow turns this red until somebody decides which table it belongs
 * in, which is the only form of "every path" that survives a new path.
 *
 * The two tables are two different findings, and collapsing them would hide one:
 *
 *   - {@link REFUSING} — tools that CAN name the root Outcome. Each is driven with
 *     the strongest achievement record it can express and must throw.
 *   - {@link CANNOT_EXPRESS} — tools whose write cannot reach the root node at
 *     all. `ost_deposit` files a collaborator's answer, `ost_rank_source` appends
 *     to a trust ledger, `ost_ingest_inbox` captures evidence records. Each is
 *     driven with the same claim and must leave the Outcome recording nothing.
 *     A refusal would be the wrong assertion for these: there is nothing to
 *     refuse, and demanding one would test a rule they do not have.
 *
 * ## What a green here does not settle
 *
 * Two things, and the second is a limit of the mechanism rather than of the test.
 *
 * First, the field questions: whether any team can name an external signal worth
 * gating on, whether the signal they name measures what they think, and how often
 * the human CLI escape hatch gets used. None has an exit code and all three stay
 * with "Teams can define an external signal that decides whether their outcome
 * was met".
 *
 * Second — and this is the finding this build produced rather than inherited —
 * the prose half of the gate is a detector, and a detector is not a proof. The
 * assumption node worried that "the outcome was met" written as ordinary prose is
 * a claim no refusal can catch, and it is right: `claimsOutcomeAchieved` refuses
 * the forms a self-certifying pass actually writes and a determined author can
 * paraphrase past it. What makes the guarantee hold anyway is that nothing in
 * this product READS the root's ordinary prose as an achievement record. The
 * verdict is typed and lives under `## Outcome Signal`, which is reserved, so the
 * strongest assertions in this file are the structural ones: the record cannot be
 * authored on this surface, and the bar it is read against lives in a file this
 * surface cannot write.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { OUTCOME_SIGNAL_HEADING } from "../../src/ost/headings.js";
import type { OstNode } from "../../src/ost/node.js";
import {
  claimsOutcomeAchieved,
  outcomeSignalReadings,
  outcomeSignalState,
  readDeclaredOutcomeSignal,
  recordOutcomeSignal,
} from "../../src/ost/outcome-signal.js";
import { Vault } from "../../src/ost/vault.js";
import { checkCall, publishCallPreconditions } from "../../src/security/call-preconditions.js";
import { writesTheVault } from "../../src/security/policy.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const ROOT = "Root";

/** The sentence every path is driven with — one claim, so a miss is the path's, not the phrasing's. */
const CLAIM = "The outcome has been achieved.";

let dir: string;
let vault: Vault;

interface RawTool {
  name: string;
  run: (input: unknown) => Promise<string>;
}

function tools(): RawTool[] {
  const ctx: ToolContext = { vault, dir, remote: { enabled: false }, surface: "test", productRepos: [] };
  return buildOstTools(ctx, MCP_TOOL_NAMES) as unknown as RawTool[];
}

function call(name: string, input: Record<string, unknown>): Promise<string> {
  const built = tools().find((t) => t.name === name);
  if (!built) throw new Error(`${name} is not on the MCP surface`);
  return built.run(input);
}

function put(title: string, layer: OstNode["layer"], extra: Partial<OstNode> = {}): void {
  vault.createNode({ title, layer, body: "prose", tags: [], links: [], evidence: "assertion", ...extra });
}

function writeConfig(extra = ""): void {
  fs.writeFileSync(
    path.join(dir, "ost.config.yaml"),
    `outcome: "Teams keep discovering faster than they build"\noutcomeTitle: ${JSON.stringify(ROOT)}\n${extra}`,
  );
}

/** The one question every attempt is judged by, whatever it did on the way. */
function outcomeRecordsAchievement(): boolean {
  const root = vault.read(ROOT);
  return (
    outcomeSignalState(dir, root).achieved ||
    claimsOutcomeAchieved(root.body) !== undefined ||
    root.status === "validated" ||
    root.status === "shipped"
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-outcome-signal-"));
  vault = new Vault(dir);
  // A config that EXISTS and declares no signal, rather than no config at all:
  // the gate must hold on the absence of the key, not on the absence of the file.
  writeConfig();
  put(ROOT, "Outcome");
  put("Opp", "Opportunity");
  put("Sol", "Solution");
  put("Asm", "Assumption");
  put("Test", "AssumptionTest", { threshold: "at least 5 of 20 teams" });
  vault.linkNodes(ROOT, "Opp");
  vault.linkNodes("Opp", "Sol");
  vault.linkNodes("Sol", "Asm");
  vault.linkNodes("Asm", "Test");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/**
 * Every write tool that can name the root Outcome, with the strongest
 * achievement record it can express through its own arguments.
 *
 * `ost_link_nodes` gets a child planted through the vault directly, because
 * creating it through the surface is itself one of the paths under test — the
 * fixture must not depend on the thing it is measuring.
 */
const REFUSING: Record<string, () => Promise<unknown>> = {
  ost_create_node: () =>
    call("ost_create_node", {
      title: "We have achieved the outcome",
      layer: "Opportunity",
      parent: ROOT,
      body: CLAIM,
      evidence: "assertion",
    }),
  ost_append_to_node: () => call("ost_append_to_node", { title: ROOT, section: `## Notes\n${CLAIM}` }),
  ost_link_nodes: () => {
    put("We have achieved the outcome", "Opportunity");
    return call("ost_link_nodes", { parent: ROOT, child: "We have achieved the outcome" });
  },
  ost_set_status: () => call("ost_set_status", { title: ROOT, status: "shipped", note: "done" }),
  ost_set_evidence: () => call("ost_set_evidence", { title: ROOT, evidence: "assertion", note: CLAIM }),
  ost_set_instrument: () =>
    call("ost_set_instrument", { test: ROOT, instrument: "npx vitest run test/ost/x.test.ts", why: CLAIM }),
  ost_flag_humans_required: () => call("ost_flag_humans_required", { test: ROOT, why: CLAIM }),
  ost_annotate: () => call("ost_annotate", { title: ROOT, issue: CLAIM }),
  ost_detach_nodes: () => call("ost_detach_nodes", { parent: ROOT, child: "Opp", why: CLAIM }),
  ost_edit_node: () => call("ost_edit_node", { title: ROOT, prose: CLAIM, why: "recording where we got to" }),
  ost_merge_nodes: () => call("ost_merge_nodes", { from: "Opp", into: ROOT, contribution: CLAIM, why: "same claim" }),
};

/**
 * The write tools whose effect cannot land on the Outcome node at all, with the
 * strongest attempt each can make. The assertion is the outcome of the attempt,
 * not a refusal: each of these succeeds at what it does, and what it does is not
 * this.
 */
const CANNOT_EXPRESS: Record<string, () => Promise<unknown>> = {
  ost_deposit: () => call("ost_deposit", { answer: CLAIM, from: "the agent", closing: "session" }),
  ost_rank_source: () =>
    call("ost_rank_source", { kind: "channel", id: "inbox", direction: "contradicted", reason: CLAIM }),
  // No pass context, so this refuses for its own reason. Driven anyway, because
  // "it happened to be unavailable" is not the same finding as "it cannot express
  // the claim", and the assertion below is about the Outcome either way.
  ost_ingest_inbox: () => call("ost_ingest_inbox", {}),
};

describe("the enumeration covers the write surface, derived rather than listed", () => {
  test("every write tool on the MCP surface is in exactly one table", () => {
    const writes = MCP_TOOL_NAMES.filter((n) => writesTheVault(n));
    const covered = [...Object.keys(REFUSING), ...Object.keys(CANNOT_EXPRESS)];
    // Sorted set equality both ways: a tool added to the surface and not to a
    // table reddens this, and a table naming a tool the surface dropped does too.
    expect([...covered].sort()).toEqual([...writes].sort());
    // And the tables do not overlap — a name in both would let a path be checked
    // by the weaker assertion while appearing covered by the stronger.
    expect(covered.length).toBe(new Set(covered).size);
    // A guard against the whole thing passing vacuously if the derivation broke.
    expect(writes.length).toBeGreaterThanOrEqual(14);
  });
});

describe("with no external signal declared, every write path refuses the verdict", () => {
  for (const [name, attempt] of Object.entries(REFUSING)) {
    test(`${name} refuses to record the Outcome as achieved`, async () => {
      await expect(attempt()).rejects.toThrow(/refusing to record the Outcome as achieved/);
      expect(outcomeRecordsAchievement()).toBe(false);
    });
  }

  for (const [name, attempt] of Object.entries(CANNOT_EXPRESS)) {
    test(`${name} cannot reach the Outcome with it`, async () => {
      await attempt().catch(() => undefined);
      expect(outcomeRecordsAchievement()).toBe(false);
    });
  }

  // The sweep as one act. Individually-green paths could still leave the tree
  // recording achievement between them; this is the state after all of them.
  test("after driving every write path in turn, the Outcome records nothing", async () => {
    for (const attempt of [...Object.values(REFUSING), ...Object.values(CANNOT_EXPRESS)]) {
      await attempt().catch(() => undefined);
    }
    expect(outcomeRecordsAchievement()).toBe(false);
    expect(outcomeSignalReadings(vault.read(ROOT))).toEqual([]);
    // And compute did not declare the bar either — the second half of the
    // assumption, which a gate that only refused writes to the tree would miss.
    expect(readDeclaredOutcomeSignal(dir)).toBeUndefined();
  });

  // A pass that has to make a call to find out it will be refused pays a turn for
  // it. The publication is where that turn is saved, and a rule the enforcement
  // holds but the publication does not name is a rule the caller cannot see.
  test("the publication says so before the call is made", () => {
    const published = publishCallPreconditions({ vault, dir, productRepos: [], asOf: "2026-08-31" });
    const violations = checkCall(published, "ost_append_to_node", { title: ROOT, section: CLAIM });
    expect(violations.map((v) => v.id)).toContain("outcome-achievement-needs-an-external-signal");
    // And it stays quiet on a call that is fine, or it is noise rather than a
    // publication.
    expect(
      checkCall(published, "ost_append_to_node", { title: ROOT, section: "Three teams ran a pass." }).map((v) => v.id),
    ).not.toContain("outcome-achievement-needs-an-external-signal");
  });

  test("the refusal names the path back, and it is not on this surface", async () => {
    const err = await call("ost_append_to_node", { title: ROOT, section: CLAIM }).catch((e: Error) => e.message);
    expect(err).toMatch(/ost\.config\.yaml/);
    expect(err).toMatch(/outcomeSignal/);
    expect(err).toMatch(/ost-agent outcome-signal/);
  });
});

describe("the record is typed, so prose is not the mechanism", () => {
  test("## Outcome Signal is reserved — no content argument can author one", async () => {
    const forged = `${OUTCOME_SIGNAL_HEADING}\n- 2026-08-31 **met** (by the agent) — 31 teams`;
    // Named on a node that is NOT the root, so the refusal is the reserved-heading
    // rule and not the Outcome gate standing in for it.
    await expect(call("ost_append_to_node", { title: "Sol", section: forged })).rejects.toThrow(/reserved heading/);
    await expect(call("ost_annotate", { title: "Sol", issue: forged })).rejects.toThrow(/reserved heading/);
    await expect(
      call("ost_edit_node", { title: "Sol", prose: forged, why: "adding the reading" }),
    ).rejects.toThrow(/reserved heading/);
  });

  test("a forged line under the heading is not a reading anyway — the bar is undeclared", () => {
    // Planted through the vault directly, i.e. by a human in Obsidian or an
    // import: the surface cannot write this, but the reader must still be right
    // about it.
    vault.appendUnderSection(ROOT, OUTCOME_SIGNAL_HEADING, "- 2026-08-31 **met** (by nobody) — 31 teams", "human");
    expect(outcomeSignalState(dir, vault.read(ROOT)).achieved).toBe(false);
  });
});

describe("the gate opens, and only the way it is supposed to", () => {
  function declareSignal(): void {
    writeConfig(
      'outcomeSignal:\n  signal: "weekly active teams that ran a pass"\n  met: "25 or more, four weeks running"\n  source: "the usage dashboard"\n',
    );
  }

  test("a declared signal alone does not open it — someone has to have read one", async () => {
    declareSignal();
    expect(readDeclaredOutcomeSignal(dir)?.met).toBe("25 or more, four weeks running");
    const err = await call("ost_append_to_node", { title: ROOT, section: CLAIM }).catch((e: Error) => e.message);
    expect(err).toMatch(/refusing to record the Outcome as achieved/);
    // The refusal changes shape once a bar exists: it quotes the bar rather than
    // asking for one, which is the difference between "no signal" and "not met".
    expect(err).toContain("25 or more, four weeks running");
  });

  test("a person's reading of the declared signal opens it, and the agent may then report it", async () => {
    declareSignal();
    const line = recordOutcomeSignal(dir, {
      verdict: "met",
      by: "Tanner",
      reading: "31 weekly active teams, weeks of 2026-08-03 through 2026-08-24",
      on: "2026-08-31",
    });
    expect(line).toContain("**met**");
    expect(outcomeSignalState(dir, vault.read(ROOT)).achieved).toBe(true);

    await expect(call("ost_append_to_node", { title: ROOT, section: `## Notes\n${CLAIM}` })).resolves.toMatch(
      /appended/,
    );
  });

  test("an unmet reading keeps it shut", async () => {
    declareSignal();
    recordOutcomeSignal(dir, { verdict: "unmet", by: "Tanner", reading: "4 weekly active teams", on: "2026-08-31" });
    await expect(call("ost_append_to_node", { title: ROOT, section: CLAIM })).rejects.toThrow(
      /refusing to record the Outcome/,
    );
  });

  test("the CLI path cannot invent the bar it then clears", () => {
    // No `outcomeSignal` in the config — so there is nothing to read against, and
    // the human path refuses too. This is what stops the escape hatch from being
    // a way to declare a signal rather than a way to read one.
    expect(() => recordOutcomeSignal(dir, { verdict: "met", by: "Tanner", reading: "31 teams" })).toThrow(
      /no external signal is declared/,
    );
  });

  test("a reading needs a person and a number behind it", () => {
    declareSignal();
    expect(() => recordOutcomeSignal(dir, { verdict: "met", by: "  ", reading: "31 teams" })).toThrow(/attribution/);
    expect(() => recordOutcomeSignal(dir, { verdict: "met", by: "Tanner", reading: "  " })).toThrow(/the number/);
  });
});

describe("the detector fires on the claim and not on the mandate", () => {
  // A detector that answered yes to everything would satisfy every assertion
  // above while making the surface useless, so the negative controls carry this
  // block rather than decorate it.
  const CLAIMS = [
    "The outcome has been achieved.",
    "the outcome is met",
    "Our goal has been reached.",
    "We have achieved the outcome.",
    "the agent met the goal",
    "Outcome: achieved",
    "OUTCOME — MET",
    "The mandate was fulfilled.",
  ];
  for (const text of CLAIMS) {
    test(`reads as a verdict: ${JSON.stringify(text)}`, () => {
      expect(claimsOutcomeAchieved(text)).toBeDefined();
    });
  }

  const NOT_CLAIMS = [
    // The root Outcome's own body IS a goal statement. A detector that fired on
    // one would refuse the operator's mandate on every edit.
    "Teams keep discovering faster than they build, so that they reach their goal sooner.",
    "The outcome is not yet achieved — 4 of a target 25 teams.",
    "We have not met the goal.",
    "Whether the outcome was met is not something this pass can say.",
    "If the outcome is achieved, the tree will say so under its own heading.",
    "Three teams ran a pass this week.",
    "This solution was shipped and its assumption test is still running.",
    "The goal will be met when 25 teams run a pass four weeks running.",
  ];
  for (const text of NOT_CLAIMS) {
    test(`does not read as a verdict: ${JSON.stringify(text)}`, () => {
      expect(claimsOutcomeAchieved(text)).toBeUndefined();
    });
  }

  test("the gate is about the ROOT, not about the word — a claim on another node is not refused", async () => {
    await expect(call("ost_append_to_node", { title: "Sol", section: `## Notes\n${CLAIM}` })).resolves.toMatch(
      /appended/,
    );
  });

  test("an ordinary write to the root is not refused", async () => {
    await expect(
      call("ost_append_to_node", { title: ROOT, section: "## Notes\nThree teams ran a pass this week." }),
    ).resolves.toMatch(/appended/);
    await expect(
      call("ost_append_to_node", { title: ROOT, section: "## Notes\nThe outcome is not yet achieved — 4 of 25." }),
    ).resolves.toMatch(/appended/);
  });
});
