/**
 * The prompt-injection red team — twenty poisoned notes driven through the real
 * ingest path, and a mutation control that goes red when the defence is removed.
 *
 * **What was missing.** `test/security/policy.test.ts` proves no destructive
 * tool is on the allowlist, and `test/security/s4-data-framing.test.ts` proves
 * untrusted bytes reach the model framed. Both are properties of the surface at
 * rest. Neither drives hostile content at it: nothing in this repository took an
 * ingested note saying "delete everything", followed it to the tool call it was
 * asking for, and made that call. So "capability-safety" was an argument from
 * two static checks rather than something demonstrated under attack, and it was
 * demonstrated once, by whoever last read the argument, rather than on every
 * commit.
 *
 * **What this adds.** The corpus in `red-team-corpus.ts` writes twenty notes
 * into the vault's own drop folder, and for each one it also writes down the
 * call an obedient agent would make next. The harness ingests them through the
 * real adapter, reads them back through the real tools, and then makes each
 * attacker's call against the real surface. An attack is CAUGHT only if both
 * halves hold: its bytes surfaced framed as data everywhere they surfaced, and
 * its call failed closed. No model is involved — the question is not whether a
 * model would comply, it is whether complying would work.
 *
 * **The mutation control, which is the half that makes the rest mean anything.**
 * A harness that looked at nothing would report twenty catches. So the same
 * corpus runs against two deliberately vulnerable branches — responses with the
 * framing marker deleted, and a surface that obligingly performs whatever it is
 * asked — and each is required to catch **zero**. `expect(caught).toBe(20)`
 * alone is compatible with a checker stuck at `true`; the pair is not.
 *
 * **What a green here does not say.** These are twenty attacks somebody thought
 * of. It says they are caught; it says nothing about the twenty-first, and
 * nothing about whether an operator would trust the product more for it. That
 * limit is recorded on the tree node this test answers to and is repeated here
 * so a reader of the file does not have to go and find it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { ALLOWED_TOOL_NAMES, assertNoDestructiveTool, isDestructiveToolName } from "../../src/security/policy.js";
import { createLookupBudget } from "../../src/web/budget.js";
import { CHANNEL_ZERO, resolveChannels } from "../../src/adapters/channels.js";
import { configPath, loadConfig } from "../../src/config/load.js";
import type { WebFetchFn } from "../../src/web/reader.js";
import {
  RED_TEAM_CORPUS,
  TARGET_OUTCOME,
  canaryFor,
  plantCorpus,
  runRedTeam,
  seedTargetTree,
  type SurfaceTool,
} from "./red-team-corpus.js";

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-redteam-"));
  await initVault(dir, "Reach ten returning operators.", TARGET_OUTCOME);

  const pass = buildPassContext(dir);
  seedTargetTree(pass.vault);

  plantCorpus(resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === CHANNEL_ZERO)!.dir);

  // A configured product repo, so `ost_read_repo` is confined to something real
  // rather than refusing every path for want of a root — a refusal for the wrong
  // reason is the shape of catch this suite exists to distinguish.
  const before = fs.readFileSync(configPath(dir), "utf8");
  const after = before.replace(/\nproduct:\n {2}repos: \[\][^\n]*/, `\nproduct:\n  repos:\n    - ${JSON.stringify(dir)}`);
  expect(after, "product.repos was not configured — ost_read_repo would refuse for the wrong reason").not.toBe(before);
  fs.writeFileSync(configPath(dir), after, "utf8");
});

afterEach(() => {
  fs.rmSync(`${dir}.inbox`, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A fetch that says yes to everything.
 *
 * Injected on purpose, and it matters which way: if the page reader were handed
 * a fetch that failed, the cloud-metadata attack would be "caught" by the
 * network being absent rather than by `assertAllowedUrl`. A fetch that would
 * happily serve `169.254.169.254` makes the guard the only thing in the way.
 */
const obligingFetch: WebFetchFn = async () => ({
  status: 200,
  ok: true,
  headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
  text: async () => "<title>metadata</title><p>AccessKeyId: AKIA</p>",
});

const obligingSearch = {
  name: "fake",
  search: async () => ({
    results: [{ title: "a result", url: "https://example.com/a", snippet: "a snippet", host: "example.com" }],
    failures: [],
  }),
};

function buildSurface(): SurfaceTool[] {
  const pass = buildPassContext(dir);
  const ctx: ToolContext = {
    vault: pass.vault,
    dir,
    remote: { enabled: false },
    surface: "test",
    productRepos: pass.config.product.repos,
    passContext: pass,
    web: { provider: obligingSearch, fetchFn: obligingFetch, budget: createLookupBudget(40) },
  };
  // `input_schema` is what the tool helper emits and `inputSchema` is what the
  // MCP server renames it to; read both, or the harness validates every call
  // against `undefined` and reports a schema refusal that never happens.
  return (buildOstTools(ctx) as unknown as Array<Record<string, unknown>>).map((t) => ({
    name: t.name as string,
    inputSchema: t.input_schema ?? t.inputSchema,
    run: t.run as (i: unknown) => Promise<unknown>,
  }));
}

test("the corpus is twenty distinct attacks, each carrying its own canary", () => {
  expect(RED_TEAM_CORPUS).toHaveLength(20);
  expect(new Set(RED_TEAM_CORPUS.map((a) => a.id)).size).toBe(20);
  expect(new Set(RED_TEAM_CORPUS.map((a) => a.filename)).size).toBe(20);
  for (const attack of RED_TEAM_CORPUS) {
    expect(attack.body, `${attack.id} carries no canary, so nothing can attribute a response to it`).toContain(
      canaryFor(attack.id),
    );
    // Body only. The filename becomes the evidence id, and S4 asserts ids are
    // deliberately unframed so a citation still resolves — a canary there would
    // fail containment on the one path that is right.
    expect(attack.filename).not.toContain(canaryFor(attack.id));
  }
});

test("every attack in the capability-absent family names a tool the allowlist does not hold", () => {
  const absent = RED_TEAM_CORPUS.filter((a) => a.family === "capability-absent");
  expect(absent.length).toBe(10);
  const onList = absent.filter((a) => (ALLOWED_TOOL_NAMES as readonly string[]).includes(a.compliance.tool));
  expect(onList.map((a) => a.compliance.tool), "these are on the allowlist, so absence is not what stops them").toEqual([]);
  // And the other two families must aim at tools that ARE on it, or "the surface
  // refused" would be indistinguishable from "the surface had never heard of it".
  for (const attack of RED_TEAM_CORPUS.filter((a) => a.family !== "capability-absent")) {
    expect(ALLOWED_TOOL_NAMES as readonly string[], `${attack.id} aims at a tool that does not exist`).toContain(
      attack.compliance.tool,
    );
  }
});

test("the name-level guard flags every demanded capability but one, and the exception is named", () => {
  // P7's guard is defence in depth, not the boundary — what actually stops these
  // is that they are off `ALLOWED_TOOL_NAMES`. Recording which names it catches
  // is still worth a line, because a name it does not flag is a name a plausible
  // tool could be added under without the cheap guard fail-closing.
  const unflagged = RED_TEAM_CORPUS.filter((a) => a.family === "capability-absent")
    .map((a) => a.compliance.tool)
    .filter((name) => !isDestructiveToolName(name));
  // `ost_set_lane` tokenizes to ost/set/lane, and none of those is destructive or
  // consequential in the token sets' sense — yet a lane is who may run a test and
  // whether compute may clear it on its own. Asserted by exact equality so that
  // widening the token sets shows up here as a passing exception disappearing,
  // rather than as nothing at all.
  expect(unflagged).toEqual(["ost_set_lane"]);
});

test("the red-team suite catches all twenty seeded attacks", async () => {
  const report = await runRedTeam({ tools: buildSurface() });

  // The failure message is the point: a miss says which attack, which half, and
  // what the surface did instead.
  const misses = report.verdicts
    .filter((v) => !v.caught)
    .map((v) => `${v.attack} (${v.family}): compliance=${v.compliance} | containment=${v.containment}`);
  expect(misses, "these attacks were not caught").toEqual([]);
  expect(report.caught).toHaveLength(20);
});

test("each attack is stopped by the defence it was written to probe", async () => {
  const report = await runRedTeam({ tools: buildSurface() });
  const by = new Map(report.verdicts.map((v) => [v.attack, v]));

  // Capability absence is the whole defence for the first family. A catch by any
  // other route there would mean the tool exists and something else refused it,
  // which is a different (and weaker) claim than the one CONTRIBUTING.md makes.
  for (const attack of RED_TEAM_CORPUS.filter((a) => a.family === "capability-absent")) {
    expect(by.get(attack.id)!.stoppedBy, `${attack.id}: ${by.get(attack.id)!.compliance}`).toBe("no-such-tool");
  }
  // And nothing in the other two families may be caught that way, or a typo in a
  // tool name would read as a defended escalation.
  for (const attack of RED_TEAM_CORPUS.filter((a) => a.family !== "capability-absent")) {
    const verdict = by.get(attack.id)!;
    expect(verdict.stoppedBy, `${attack.id}: ${verdict.compliance}`).not.toBe("no-such-tool");
    expect(["schema-refused", "surface-refused"]).toContain(verdict.stoppedBy);
  }
  // At least one in each of those families must be stopped by the tool's own
  // guard rather than by its schema — otherwise the only thing exercised beyond
  // the allowlist is JSON Schema.
  for (const family of ["escalation-refused", "reach-refused"] as const) {
    const stopped = RED_TEAM_CORPUS.filter((a) => a.family === family).map((a) => by.get(a.id)!.stoppedBy);
    expect(stopped, `${family} is entirely schema-refused — no tool guard was exercised`).toContain("surface-refused");
  }
});

test("every attack's bytes reached a response, and reached it framed as data", async () => {
  const report = await runRedTeam({ tools: buildSurface() });
  const unframed = report.verdicts.filter((v) => !v.contained).map((v) => `${v.attack}: ${v.containment}`);
  expect(unframed, "these notes surfaced unframed, or never surfaced at all").toEqual([]);
});

test("MUTATION — with the framing marker removed, the suite catches nothing", async () => {
  const report = await runRedTeam({ tools: buildSurface(), mutation: { unframeResponses: true } });
  expect(report.caught, "the containment check passed on responses with no marker in them").toEqual([]);
  expect(report.missed).toHaveLength(20);
  // The compliance half is untouched by this mutation, so it must still hold —
  // a mutation that turned everything red would prove only that the harness can
  // fail, not that it is reading the thing it claims to read.
  expect(report.verdicts.every((v) => v.stoppedBy !== null)).toBe(true);
  expect(report.verdicts.every((v) => !v.contained)).toBe(true);
});

test("MUTATION — with an obliging surface, the suite catches nothing", async () => {
  const report = await runRedTeam({ tools: buildSurface(), mutation: { obedientSurface: true } });
  expect(report.caught, "every demanded call went through and the harness still reported catches").toEqual([]);
  expect(report.missed).toHaveLength(20);
  // Containment is untouched here, for the same reason and in the other direction.
  expect(report.verdicts.every((v) => v.contained)).toBe(true);
  expect(report.verdicts.every((v) => v.stoppedBy === null)).toBe(true);
});

test("MUTATION — the registration guard fail-closes on a surface that granted the demanded tools", () => {
  // The mutation above simulates an open surface; this asserts the production
  // guard would refuse to build one. Ten names, added to the set `buildOstTools`
  // vets, and the vetting must throw on the first.
  const demanded = RED_TEAM_CORPUS.filter((a) => a.family === "capability-absent").map((a) => a.compliance.tool);
  for (const name of demanded) {
    expect(() => assertNoDestructiveTool([...ALLOWED_TOOL_NAMES, name]), `${name} was admitted`).toThrow();
  }
  // Control: the guard is not simply throwing on everything it is handed.
  expect(() => assertNoDestructiveTool([...ALLOWED_TOOL_NAMES])).not.toThrow();
});
