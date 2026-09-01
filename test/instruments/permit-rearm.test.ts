/**
 * Replacing an instrument preserves the displaced command, and putting that
 * command back re-arms the observations it earned — but ONLY while the spec file
 * it measured is byte-identical to the one on disk now.
 *
 * The threshold this answers, from the assumption test "A re-armed permit is
 * refused when the spec file changed underneath it":
 *
 *   Restoring a displaced command re-arms its observation when the spec file's
 *   contents are unchanged, and refuses to re-arm — leaving the permit
 *   un-cleared — when the contents differ, even though the command string is
 *   byte-identical.
 *
 * The two scenarios below are the same call with the same argument, run against
 * two repositories that differ in one file's contents, and they must come out
 * opposite. That is the discrimination the node pre-committed to: an
 * implementation that keys re-arming on the command STRING passes the first and
 * fails the second, and that failure is the finding — it would mean re-arming
 * cannot be done safely without content addressing.
 *
 * One thing measured while writing this, because it changes what "build" meant
 * here: the string-keyed re-arm was ALREADY the behaviour. `currentObservations`
 * filters an append-only log by the command the node names today, so a restore
 * always revived its old reds, silently and unconditionally. The solution node
 * says "no call on that surface could bring it back"; the surface brought it
 * back every time. So the case that had to be built is the refusal, and
 * `unconditional re-arm was the behaviour before this spec existed` below is the
 * regression guard for the half that already worked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools } from "../../src/security/tools.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { verifyInstrument, instrumentLog } from "../../src/ost/instrument.js";
import { displacedCommands, specDigestIn } from "../../src/ost/rearm.js";
import { buildPermit } from "../../src/eval/buildable.js";
import type { PassContext } from "../../src/runner/context.js";
import { KILL_CRITERIA } from "../ost/kill-criteria-fixture.js";

const OUTCOME = "Retention";
const OPPORTUNITY = "A restored instrument comes back without its verdict";
const SOLUTION = "Re-arm the permit a restored command earned";
const BELIEF = "Command identity is not measurement identity";
const TEST = "Restore a displaced command and read the permit";

const ORIGINAL = "npx vitest run test/original.test.ts";
const OTHER = "npx vitest run test/other.test.ts";

let dir: string;
let repo: string;
let ctx: PassContext;

const call = (name: string, input: Record<string, unknown>): Promise<string> => {
  const tools = buildOstTools({ ...ctx, productRepos: [repo] }, MCP_TOOL_NAMES);
  const tool = tools.find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/**
 * A repository whose runner always fails, so every observation filed here is a
 * real red about a spec file that really exists — the state a permit rests on.
 * Real process, real exit status, for the reason `test/runner/
 * exit-code-observation.test.ts` gives: the property under test is what a
 * WATCHED exit code licenses.
 */
function repoWithSpecs(): void {
  fs.mkdirSync(path.join(repo, "node_modules", ".bin"), { recursive: true });
  fs.mkdirSync(path.join(repo, "test"), { recursive: true });
  fs.writeFileSync(path.join(repo, "test", "original.test.ts"), "// asserts the thing the node is about\n", "utf8");
  fs.writeFileSync(path.join(repo, "test", "other.test.ts"), "// a different question entirely\n", "utf8");
  const bin = path.join(repo, "node_modules", ".bin", "vitest");
  fs.writeFileSync(bin, `#!/bin/sh\necho "FAIL — the behaviour is not built"\nexit 1\n`, "utf8");
  fs.chmodSync(bin, 0o755);
}

const permit = () => buildPermit(ctx.vault.readTree(), SOLUTION);

/** Displace ORIGINAL with OTHER — the destructive act that un-clears the permit. */
const displace = () =>
  call("ost_set_instrument", { test: TEST, instrument: OTHER, why: "believed the original named the wrong module", replace: true });

/** Put ORIGINAL back, byte for byte. */
const restore = () =>
  call("ost_set_instrument", { test: TEST, instrument: ORIGINAL, why: "the displacement was a mistake", replace: true });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-permit-rearm-"));
  repo = fs.mkdtempSync(path.join(os.tmpdir(), "ost-permit-rearm-repo-"));
  repoWithSpecs();
  await initVault(dir, "Reach ten thousand daily active users", OUTCOME);
  ctx = buildPassContext(dir);
  await call("ost_create_node", { title: OPPORTUNITY, layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion" });
  await call("ost_create_node", { title: SOLUTION, layer: "Solution", parent: OPPORTUNITY, body: "b", evidence: "assertion", ...KILL_CRITERIA });
  await call("ost_create_node", { title: BELIEF, layer: "Assumption", parent: SOLUTION, body: "b", evidence: "assertion" });
  await call("ost_create_node", {
    title: TEST,
    layer: "AssumptionTest",
    parent: BELIEF,
    body: "b",
    evidence: "assertion",
    instrument: ORIGINAL,
  });
  // The permit under all of this: one observed red against the original command.
  verifyInstrument(dir, { test: TEST, repo });
  expect(permit().cleared).toBe(true);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(repo, { recursive: true, force: true });
});

describe("a replacement preserves the command it displaced", () => {
  test("the displaced command is still readable from the node after the swap", async () => {
    await displace();
    expect(ctx.vault.read(TEST).instrument).toBe(OTHER);
    expect(displacedCommands(ctx.vault.read(TEST))).toContain(ORIGINAL);
  });

  test("the swap un-clears the permit, and the observation stays in the log", async () => {
    await displace();
    expect(permit().cleared).toBe(false);
    // Append-only: a run that happened, happened. The red is still on the node —
    // it just no longer describes the command the node names.
    expect(instrumentLog(ctx.vault.read(TEST)).some((l) => l.includes(`\`${ORIGINAL}\``))).toBe(true);
  });
});

describe("the spec file is unchanged — the restore re-arms", () => {
  test("restoring the displaced command clears the permit again", async () => {
    await displace();
    await restore();
    const p = permit();
    expect(p.cleared).toBe(true);
    expect(p.instrument).toBe(ORIGINAL);
  });

  test("the restore says out loud that it re-armed, rather than doing it silently", async () => {
    await displace();
    const message = await restore();
    expect(message).toMatch(/re-arm/i);
    expect(message).toMatch(/identical/i);
  });
});

describe("the spec file changed underneath — the restore refuses to re-arm", () => {
  test("the permit stays un-cleared even though the command string is byte-identical", async () => {
    await displace();
    // The whole point of the fixture: same path, same command, different file.
    fs.writeFileSync(path.join(repo, "test", "original.test.ts"), "// rewritten while another command was attached\n", "utf8");
    await restore();

    expect(ctx.vault.read(TEST).instrument).toBe(ORIGINAL);
    const p = permit();
    expect(p.cleared).toBe(false);
    expect(p.reason).toMatch(/never been run|no assumption test|declares an instrument/i);
  });

  test("the refusal is recorded on the node, naming the two digests", async () => {
    await displace();
    fs.writeFileSync(path.join(repo, "test", "original.test.ts"), "// rewritten while another command was attached\n", "utf8");
    const message = await restore();

    expect(message).toMatch(/NOT re-armed/);
    // Both digests, so a reader of the node can see WHICH two files disagreed
    // rather than only that something did.
    expect(ctx.vault.read(TEST).body).toMatch(
      /re-arm: \d+ observation\(s\) withheld — the spec file changed while another command was attached \(spec [0-9a-f]{12} → [0-9a-f]{12}\)/,
    );
  });

  test("a fresh observation earns the permit back — the refusal is not a dead end", async () => {
    await displace();
    fs.writeFileSync(path.join(repo, "test", "original.test.ts"), "// rewritten while another command was attached\n", "utf8");
    await restore();
    expect(permit().cleared).toBe(false);

    // Measuring is the way back, and it is the only way back: the withheld lines
    // stay withheld, and this new red sits past them.
    verifyInstrument(dir, { test: TEST, repo });
    expect(permit().cleared).toBe(true);
  });
});

describe("what makes the discrimination possible", () => {
  test("every recorded observation carries the digest of the spec file it measured", () => {
    const line = instrumentLog(ctx.vault.read(TEST)).at(-1)!;
    expect(specDigestIn(line)).toMatch(/^[0-9a-f]{12}$/);
  });

  test("an observation recorded before digests existed cannot be re-armed", async () => {
    // The append-only log holds lines nobody may rewrite, so the pre-digest reds
    // in a real vault will never gain one. They fail CLOSED: "cannot show what
    // it measured" and "measured something else" license the same building.
    const v = ctx.vault;
    const node = v.read(TEST);
    const stripped = node.body.replace(/ \[spec [0-9a-f]+\]/g, "");
    fs.writeFileSync(path.join(dir, `${TEST}.md`), fs.readFileSync(path.join(dir, `${TEST}.md`), "utf8").replace(node.body.trim(), stripped.trim()), "utf8");
    expect(specDigestIn(instrumentLog(v.read(TEST)).at(-1)!)).toBeUndefined();
    expect(permit().cleared).toBe(true);

    await displace();
    await restore();
    expect(permit().cleared).toBe(false);
  });

  test("a command that has never been observed is not a re-arm and says nothing about one", async () => {
    const message = await displace();
    expect(message).toMatch(/not a build permit/i);
    expect(message).not.toMatch(/re-arm/i);
  });
});
