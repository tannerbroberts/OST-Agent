/**
 * P6 — no tool ships an outward mutation.
 *
 * Two halves, and the readiness document had them in two different states. Half
 * (a) — every HTTP call this codebase makes is a GET — held, but only as a grep
 * somebody had run once, written into a document. Half (b) — the agent's tool
 * surface cannot push — held in fact and was pinned by nothing at all: it is true
 * only because `src/mcp/server.ts` passes `MCP_TOOL_NAMES` to `buildOstTools`,
 * and `buildOstTools` on its own **does** build a `git_push` tool that calls
 * `gitPush(dir)` (`src/security/tools.ts:723-733`), with `git_commit` and
 * `git_push` both on `ALLOWED_TOOL_NAMES` (`src/security/policy.ts:43-44`). One
 * source edit — a second surface built without the filter — turns the whole claim
 * false, silently. That is exactly what P7 objects to, and the document's
 * instruction was to pin it **now**, so the day it changes is a visible,
 * deliberate commit rather than a discovery.
 *
 * Four notes on how each half is checked, because in both cases the obvious
 * version of the check decides nothing:
 *
 * 1. **(a) is the tight pattern, not the loose one.** `method:` matches eight
 *    places, and three of them are type signatures (`init: { method: string }`) —
 *    declarations that permit anything and forbid nothing. `method: "` matches
 *    only the five literal call sites. (P6's entry in the readiness document says
 *    seven and decides nothing on the split; the counts are asserted here as a
 *    relation — declarations === loose − literal — rather than copied, because a
 *    number written into prose is a number nothing re-runs.)
 * 2. **(a) is scanned over all of `src/`, then confined.** The document's check
 *    names `src/web` and `src/adapters`, which is right today and is an
 *    assumption. Scanning everything and asserting the matches land only in those
 *    two directories turns the scope itself into something that can fail.
 * 3. **(a) also pins the transport, not only the verb.** Every check built on the
 *    string `method: "…"` is blind to a POST spelled another way — a spread init,
 *    a quoted key, an assignment. Rather than chase spellings, the file asserts
 *    that nothing in `src/` reaches a transport (`globalThis.fetch`, an injected
 *    `fetchFn`, `http(s).request`, `new Request`, an HTTP client import) outside
 *    the same five files the verb scan reads. A request that cannot leave from
 *    anywhere else cannot leave as a POST from anywhere else either.
 * 4. **(b) is behavioural, not static.** A static check ("no tool's source
 *    mentions gitPush") passes for a tool that reaches it through a helper. So
 *    the git layer is module-mocked (`vi.mock` on `src/git/safe-git.js`, keeping
 *    everything else real via `importOriginal`) and every tool the server exposes
 *    is actually driven, with `remote.enabled: true` so that a reach would really
 *    push. The mock is necessary because closing this behaviourally without it
 *    would mean editing `src/` to inject the git layer, and P6 is a claim about
 *    the code as it ships.
 *
 * Non-vacuity, in both halves, is asserted rather than intended — this repo has
 * shipped three green tests that asserted nothing, and
 * `test/release/gate-f-deciders.test.ts` records the shape: a driver whose every
 * call is refused proves nothing while staying green. So (a) runs its matcher
 * over a planted `method: "POST"` and requires it to be flagged, and (b) counts
 * the calls that actually changed the vault and requires the spy to be reachable
 * at all — a positive control fires `git_push` from the unfiltered tool set and
 * asserts the spy records it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import type { OstNode } from "../../src/ost/node.js";
import { Vault } from "../../src/ost/vault.js";
import { ALLOWED_TOOL_NAMES } from "../../src/security/policy.js";
import { buildPassContext } from "../../src/runner/context.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput, type ToolSchema } from "../../src/security/validateToolInput.js";
import type { WebFetchFn } from "../../src/web/reader.js";
import type { SearchProvider } from "../../src/web/search.js";

/**
 * Only `gitPush` is replaced; `gitCommit` and `gitInitIfAbsent` stay real, so a
 * tool that commits still commits and the driver is exercising the shipped code
 * everywhere except the one call this criterion is about.
 */
vi.mock("../../src/git/safe-git.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/git/safe-git.js")>();
  return { ...actual, gitPush: vi.fn(async () => undefined) };
});
import { gitPush } from "../../src/git/safe-git.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/* ------------------------------------------------------------------ *
 * (a) every HTTP call site is a GET
 * ------------------------------------------------------------------ */

/**
 * Every file in `src/` from which a request may leave the machine — named once,
 * because two lists that must agree are a list that will not.
 */
const OUTWARD_FILES = [
  "src/adapters/actions.ts",
  "src/adapters/atlassian.ts",
  "src/adapters/slack.ts",
  "src/security/brokered-fetch.ts",
  "src/web/federated.ts",
  "src/web/reader.ts",
  "src/web/search.ts",
];

/** A `method:` whose value is a string literal — a call site, not a declaration. */
const LITERAL_METHOD = /method:\s*"([^"]*)"/g;
/** Every `method:` at all — the loose pattern the document warns against. */
const ANY_METHOD = /method:\s*/g;

interface Hit {
  file: string;
  line: number;
  value: string;
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts")) out.push(p);
    }
  };
  walk(path.join(repoRoot, "src"));
  return out.sort();
}

/** Every literal `method:` value in a source string, with its line number. */
function literalMethods(source: string, file = "<planted>"): Hit[] {
  const hits: Hit[] = [];
  for (const m of source.matchAll(LITERAL_METHOD)) {
    hits.push({ file, line: source.slice(0, m.index).split("\n").length, value: m[1] });
  }
  return hits;
}

/**
 * The verdict itself, as a function, so the control below runs the SAME
 * expression the real assertion runs.
 *
 * A control that only proves the regex still matches leaves the gap where the
 * regex works and the judgement does not. Both call this.
 */
function outwardMutations(hits: readonly Hit[]): string[] {
  return hits.filter((h) => h.value !== "GET").map((h) => `${h.file}:${h.line} method: "${h.value}"`);
}

describe("(a) every HTTP call site in the shipped source declares GET", () => {
  const files = sourceFiles();
  const hits = files.flatMap((f) => literalMethods(fs.readFileSync(f, "utf8"), path.relative(repoRoot, f)));

  test("the scan found source to scan, and call sites to judge", () => {
    // Both numbers would be zero on a walker pointed at the wrong directory, and
    // every assertion below would pass on an empty list.
    expect(files.length).toBeGreaterThan(30);
    expect(hits.length).toBeGreaterThanOrEqual(5);
  });

  test("no literal method is anything but GET", () => {
    expect(
      outwardMutations(hits),
      "an outward request that is not a GET — P6 says the tree senses the world and does not act on it",
    ).toEqual([]);
  });

  test("the same verdict really flags a non-GET — the control that makes the assertion above mean something", () => {
    // The planted source goes through `literalMethods` AND `outwardMutations`,
    // the two functions the real assertion is made of. A control that exercised
    // only the regex would leave the gap where the regex matches and the
    // judgement has been softened to accept anything.
    const planted = 'const res = await fetchFn(url, {\n  method: "POST",\n  headers: {},\n});\n';
    expect(outwardMutations(literalMethods(planted))).toEqual(['<planted>:2 method: "POST"']);
    // And a GET is not flagged, so the check is a discriminator rather than an
    // alarm that is always on.
    expect(outwardMutations(literalMethods('{ method: "GET" }'))).toEqual([]);
  });

  test("the call sites live only in src/web, src/adapters and the broker's transport", () => {
    // The readiness check greps these directories. That is a claim about where
    // outward calls can be, and it is asserted here rather than assumed: a new
    // module elsewhere that makes an HTTP call fails this and has to be
    // considered.
    //
    // `src/security/brokered-fetch.ts` is the third, added deliberately when the
    // credential broker landed. It carries the SAME reads the two adapter files
    // already made — what changed is that they no longer hold the token — so the
    // scope grew by one file without the surface growing by one capability.
    const stray = hits.filter(
      (h) =>
        !h.file.startsWith("src/web/") &&
        !h.file.startsWith("src/adapters/") &&
        h.file !== "src/security/brokered-fetch.ts",
    );
    expect(stray.map((h) => `${h.file}:${h.line}`)).toEqual([]);
  });

  test("the seven call sites are named, so an eighth is a deliberate commit", () => {
    // Pinned as a set rather than a count: a call site that MOVES should not fail
    // this, and a call site that APPEARS should.
    expect([...new Set(hits.map((h) => h.file))].sort()).toEqual(OUTWARD_FILES);
  });

  test("and there is no outward transport outside those seven files — the check the method scan cannot make", () => {
    // The gap this closes, stated plainly. Everything above reasons about the
    // string `method: "…"`. A POST written any other way is invisible to it:
    //
    //   fetchFn(url, { ...init })            // the verb arrives in a variable
    //   fetchFn(url, { "method": "POST" })   // quoted key — `method:` never appears
    //   req.method = "POST"                  // assignment, not an object literal
    //
    // None of those is hypothetical enough to ignore, and none of them is worth
    // a regex apiece. The durable check is one level up: an outward mutation
    // needs a transport, this codebase has exactly one (`globalThis.fetch`, and
    // the injected `fetchFn` the adapters take), and every place that touches
    // one is a place the scan above has read. So the claim becomes "no request
    // leaves from anywhere else", which no amount of creative spelling evades.
    //
    // Non-vacuity: `expect(sites.length)` below would be zero on a pattern that
    // stopped matching, and every `toEqual([])` would pass on nothing. The
    // count is asserted first for that reason.
    const TRANSPORT = /\bglobalThis\.fetch\b|(?<![.\w])fetch\s*\(|\bfetchFn\s*\(|\bhttps?\.request\s*\(|\bnew\s+Request\s*\(|\bXMLHttpRequest\b|from\s+"(?:node-fetch|undici|axios)"/g;
    const sites = files.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8");
      const rel = path.relative(repoRoot, f);
      return [...src.matchAll(TRANSPORT)].map((m) => ({ file: rel, line: src.slice(0, m.index).split("\n").length }));
    });
    expect(sites.length, "the transport pattern matched nothing — it has stopped deciding anything").toBeGreaterThan(5);

    const allowed = OUTWARD_FILES;
    expect(
      sites.filter((s) => !allowed.includes(s.file)).map((s) => `${s.file}:${s.line}`),
      "a request leaves the machine from a file the GET scan above never reads",
    ).toEqual([]);
    // And the two lists agree: every file that holds a transport is a file that
    // declares a literal method. A transport site with no literal method is one
    // whose verb comes from somewhere this file cannot see.
    expect([...new Set(sites.map((s) => s.file))].sort()).toEqual(allowed);
  });

  test("the loose pattern decides nothing — it matches more, and the extras permit any method", () => {
    // This is the document's warning, made into a check. `grep -rn 'method:'`
    // returns type signatures like `init: { method: string }`, which forbid
    // nothing; a criterion resting on that pattern would be satisfied by a
    // codebase full of POSTs.
    //
    // Counted over the files that hold a transport, and that scoping is what makes
    // the relation true rather than approximately true. `method:` is not an HTTP
    // word — `src/runner/symbol-index.ts` spells "this type member is a call
    // signature" that way — and counting every `method:` in `src/` folded those in,
    // so the relation broke as though an undeclared verb had appeared, the first
    // time an unrelated module named a field `method`. Nothing outside this list can
    // send anything: the transport test above asserts every `fetch`/`request` site
    // in `src/` lands in exactly these files, so a `method:` elsewhere has no
    // transport to hand it to. The relation still decides what it was written to
    // decide — a verb arriving through a variable at a real call site is `loose`
    // with no matching declaration, and still fails here.
    const outward = files.filter((f) => OUTWARD_FILES.includes(path.relative(repoRoot, f)));
    expect(outward, "the outward file list no longer matches what is on disk").toHaveLength(OUTWARD_FILES.length);

    const loose = outward.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8");
      return [...src.matchAll(ANY_METHOD)].map(() => path.relative(repoRoot, f));
    });
    expect(loose.length).toBeGreaterThan(hits.length);

    const declarations = outward.flatMap((f) => {
      const src = fs.readFileSync(f, "utf8");
      return [...src.matchAll(/method:\s*string\b/g)].map(() => path.relative(repoRoot, f));
    });
    expect(declarations.length).toBe(loose.length - hits.length);
  });
});

/* ------------------------------------------------------------------ *
 * (b) the exposed surface cannot push
 * ------------------------------------------------------------------ */

const OUTWARD_TOOLS = ["git_commit", "git_push"];

describe("(b) the two names the server withholds", () => {
  test("ALLOWED_TOOL_NAMES minus MCP_TOOL_NAMES is exactly git_commit and git_push", () => {
    const exposed = new Set<string>(MCP_TOOL_NAMES);
    expect(ALLOWED_TOOL_NAMES.filter((n) => !exposed.has(n)).sort()).toEqual([...OUTWARD_TOOLS].sort());
  });

  test("and nothing is exposed that was never allowed", () => {
    // The other direction. The allowlist is the closed set (CONTRIBUTING.md); a
    // name on the server that is not on it would make the subtraction above true
    // and the claim false.
    const allowed = new Set<string>(ALLOWED_TOOL_NAMES);
    for (const n of MCP_TOOL_NAMES) expect(allowed.has(n), `${n} is exposed but not allowlisted`).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The driver — every exposed tool, actually run
 * ------------------------------------------------------------------ */

const OUTCOME = "Ship the thing";
const OPPORTUNITY = "Users cannot tell what changed";
const SOLUTION = "Ship a changelog";
const BELIEF = "Players would read a changelog if it existed";
const TEST = "Diff two builds and count the deltas";
const SECOND_OPPORTUNITY = "Nobody reads the release notes";

function put(v: Vault, title: string, layer: OstNode["layer"]): void {
  v.createNode({ title, layer, tags: [], links: [], evidence: "assertion", body: `prose for ${title}` } as OstNode);
}

function makeVault(): { dir: string; vault: Vault } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-p6-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  const vault = new Vault(dir);
  put(vault, OUTCOME, "Outcome");
  put(vault, OPPORTUNITY, "Opportunity");
  vault.linkNodes(OUTCOME, OPPORTUNITY);
  put(vault, SOLUTION, "Solution");
  vault.linkNodes(OPPORTUNITY, SOLUTION);
  put(vault, BELIEF, "Assumption");
  vault.linkNodes(SOLUTION, BELIEF);
  put(vault, TEST, "AssumptionTest");
  vault.linkNodes(BELIEF, TEST);
  // Unattached on purpose, and the only node in this fixture that is. R6's guard
  // refuses a wrong-layer edge and an already-run test adopted by a new Solution,
  // so `ost_link_nodes` needs a target that is a LEGAL new edge or its row stops
  // exercising the push path at all — which is what this file is for.
  put(vault, SECOND_OPPORTUNITY, "Opportunity");
  fs.mkdirSync(path.join(dir, "product"), { recursive: true });
  fs.writeFileSync(path.join(dir, "product", "README.md"), "the product\n", "utf8");
  // Every spec the AIM rows can name has to exist in the product repo: the
  // write boundary resolves an instrument's path against `productRepos` and
  // refuses one that is not there, and a driven call refused on its own input
  // proves nothing about the push path. driven-N covers both driver rounds
  // (`n++` and `100 + n++`) with room for the tool list to grow.
  fs.mkdirSync(path.join(dir, "product", "test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "product", "test", "driven.test.ts"), "// a spec that exists\n", "utf8");
  for (let n = 0; n < 200; n++) {
    fs.writeFileSync(path.join(dir, "product", "test", `driven-${n}.test.ts`), "// a spec that exists\n", "utf8");
  }
  return { dir, vault };
}

const fakeFetch: WebFetchFn = async () => ({
  status: 200,
  ok: true,
  headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? "text/html" : null) },
  text: async () => "<html><title>a page</title><body>prose</body></html>",
});
const fakeProvider: SearchProvider = {
  name: "fixture",
  search: async () => ({ results: [{ title: "a page", url: "https://example.com/notes", snippet: "prose", host: "example.com" }], failures: [] }),
};

/**
 * `remote.enabled` is TRUE on purpose.
 *
 * `git_push`'s body returns early when the remote is disabled, so a driver run
 * with `enabled: false` would record zero pushes whether or not a tool reached
 * the call. The whole point is that the spy would have fired.
 */
function contextFor(dir: string, vault: Vault): ToolContext {
  const web = { provider: fakeProvider, fetchFn: fakeFetch };
  // A real pass context, built by the shipped builder. Without one, `ost_status`
  // and its neighbours refuse before their bodies run — and a tool that never
  // ran is a tool this file has said nothing about.
  const passContext = { ...buildPassContext(dir), web, remote: { enabled: true } };
  return {
    vault,
    dir,
    remote: { enabled: true, url: "https://example.invalid/vault.git" },
    surface: "test:p6",
    web,
    // A real directory, so `ost_read_repo` reads instead of refusing.
    productRepos: [path.join(dir, "product")],
    passContext,
  };
}

interface RunnableTool {
  name: string;
  input_schema: ToolSchema & { properties?: Record<string, { type?: string; enum?: string[] }> };
  run: (input: unknown) => Promise<unknown>;
}

/**
 * The fields that AIM each exposed tool at the fixture, so its call LANDS.
 *
 * Keyed by tool name and asserted below to cover `MCP_TOOL_NAMES` exactly: a tool
 * added to the surface fails the build until someone decides how to drive it,
 * rather than being quietly skipped by a driver that only knows the old names.
 * Everything the row does not name is filled from the tool's own schema.
 */
const AIM: Record<string, (n: number) => Record<string, unknown>> = {
  // Aimed at a real node rather than left to the filler, which would produce
  // `node: "text for node"` and a refusal. Two things ride on it: the read is
  // actually exercised, and it mints the session receipt `ost_merge_nodes` now
  // requires for its survivor (`security/read-receipts.ts`). The driver walks the
  // tools in surface order and `ost_read_tree` is first, so the receipt exists by
  // the time the merge row runs — the merge's own comment says what happens if it
  // does not.
  ost_read_tree: () => ({ node: OPPORTUNITY }),
  ost_next_work: () => ({}),
  ost_check: () => ({}),
  ost_debt: () => ({}),
  ost_status: () => ({}),
  ost_ingest_inbox: () => ({}),
  ost_deposit: (n) => ({ answer: `what I considered and rejected, take ${n}`, from: "an operator", closing: "session" }),
  ost_gate: () => ({ solution: SOLUTION }),
  // `instrument` is aimed rather than left to the schema filler: the boundary
  // refuses anything that is not a spec-file command, so the generic `text for
  // instrument` would make this a call that writes nothing — and a driver that
  // silently stops writing proves nothing about the push path it is testing.
  // `threshold` is aimed for the identical reason since the field started
  // requiring a bar — `text for threshold` fixes nothing and is refused.
  // `killIf`/`killBy` are aimed at nothing for the mirror-image reason: they are
  // Solution-only, this call creates an AssumptionTest, and the generic filler
  // would carry a field the aimed layer forbids — a refused call again writes
  // nothing and proves nothing about the push path.
  ost_create_node: (n) => ({
    title: `A new test ${n}`,
    parent: BELIEF,
    layer: "AssumptionTest",
    evidence: "assertion",
    instrument: "npx vitest run test/driven.test.ts",
    threshold: "at least 5 of 20 drive a write",
    killIf: undefined,
    killBy: undefined,
  }),
  ost_append_to_node: () => ({ title: TEST, section: "## Notes\nsomething true" }),
  // A NEW edge, and a LEGAL one: `linkNodes` no-ops on a duplicate, so aiming at
  // the edge the fixture already has would be a call that writes nothing — and
  // since R6 the old aim here (an AssumptionTest under an Opportunity) is refused
  // outright, which writes nothing for a different reason. An Opportunity under
  // the Outcome is the shape that still lands.
  ost_link_nodes: () => ({ parent: OUTCOME, child: SECOND_OPPORTUNITY }),
  ost_set_status: () => ({ title: TEST, status: "in-discovery" }),
  ost_set_evidence: () => ({ title: TEST, evidence: "assertion" }),
  // A real instrument, not the schema filler: the boundary refuses anything that
  // is not a spec-file command, so generic text would make this a call that
  // writes nothing and the landing count would catch it.
  ost_set_instrument: (n) => ({ test: TEST, instrument: `npx vitest run test/driven-${n}.test.ts`, why: "a driven probe" }),
  ost_annotate: () => ({ title: TEST, issue: "worth a second look" }),
  // The three mutations. Each is driven at a real target so it LANDS rather than
  // being refused — a refused call proves nothing about whether the push path is
  // reachable from inside it. `ost_merge_nodes` folds the second opportunity into
  // the first: same layer, neither carries a recorded result, so
  // `assertMergeAllowed` lets it through and the write actually happens. It also
  // needs the survivor's body to have been served to this session — the
  // `ost_read_tree` row above is what does that, and without it this row lands
  // nothing and the named-landers assertion below goes red rather than silent.
  ost_detach_nodes: () => ({ parent: OUTCOME, child: SECOND_OPPORTUNITY, why: "driven probe" }),
  // `dropping` is aimed rather than left to the filler, and the driver goes red
  // without it: the `ost_append_to_node` and `ost_annotate` rows put `## Notes`
  // and `## Issues` on TEST, and a rewrite that accounts for no section the node
  // holds is now refused (`ost/section-accounting.ts`). A probe that means to
  // replace the whole body says so. Order-independent — naming a section the node
  // does not hold drops nothing and refuses nothing.
  ost_edit_node: () => ({
    title: TEST,
    prose: "A driven rewrite.",
    why: "driven probe",
    dropping: ["## Notes", "## Issues"],
  }),
  ost_merge_nodes: () => ({ from: SECOND_OPPORTUNITY, into: OPPORTUNITY, contribution: "One framing.", why: "driven probe" }),
  ost_flag_humans_required: () => ({ test: TEST, why: 'a person has to read it: "interview"' }),
  ost_rank_source: () => ({ kind: "web", id: "example.com", direction: "contradicted", reason: "a strike needs no citation" }),
  ost_search_web: () => ({ query: "prior art" }),
  ost_read_web: () => ({ url: "https://example.com/notes" }),
  ost_read_repo: () => ({}),
};

/** Fill everything the row did not aim, from the tool's own schema. */
function inputFor(tool: RunnableTool, aimed: Record<string, unknown>): Record<string, unknown> {
  const schema = tool.input_schema;
  if (!schema || typeof schema !== "object" || typeof schema.properties !== "object") {
    // Built outside every `try` in this file, and loud. The gate-f-deciders
    // failure was exactly this returning `{}` instead of throwing.
    throw new Error(`${tool.name} carries no readable input schema — the driver would drive nothing`);
  }
  const props = schema.properties as Record<string, { type?: string; enum?: string[] }>;
  for (const key of Object.keys(aimed)) {
    if (!(key in props)) throw new Error(`${tool.name}'s aim names "${key}", which the tool no longer declares`);
  }
  const input: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(props)) {
    if (key in aimed) input[key] = aimed[key];
    else if (spec.enum) input[key] = spec.enum[0];
    // One word: a tag carrying whitespace is refused at the vault (B1's seventh
    // door), and a driver refused on its own filler drives nothing.
    else if (spec.type === "array") input[key] = ["a-tag"];
    else if (spec.type === "number" || spec.type === "integer") input[key] = 1;
    else if (spec.type === "boolean") input[key] = true;
    else input[key] = `text for ${key}`;
  }
  return input;
}

function vaultDigest(dir: string): string {
  const trace = path.join(".ost-agent", "usage");
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? dir, e.name)))
    .filter((rel) => !rel.startsWith(trace))
    .sort()
    .map((rel) => `${rel} ${fs.readFileSync(path.join(dir, rel), "utf8")}`)
    .join("");
}

describe("(b) no tool the server exposes reaches gitPush", () => {
  let dir: string;
  let vault: Vault;

  beforeEach(() => {
    vi.mocked(gitPush).mockClear();
    ({ dir, vault } = makeVault());
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("every exposed tool has a way to be driven — a new tool fails the build until it does", () => {
    expect(Object.keys(AIM).sort()).toEqual([...MCP_TOOL_NAMES].sort());
  });

  test("positive control: the spy is wired, and git_push really does reach it", async () => {
    // Without this, "the spy was never called" is satisfied by a spy that could
    // never have been called — the same nothing that a refused driver proves.
    const unfiltered = buildOstTools(contextFor(dir, vault)) as unknown as RunnableTool[];
    const push = unfiltered.find((t) => t.name === "git_push");
    expect(push, "buildOstTools no longer builds git_push — P6(b) has changed shape, re-read the criterion").toBeTruthy();
    expect(vi.mocked(gitPush)).not.toHaveBeenCalled();
    await push!.run({});
    expect(vi.mocked(gitPush)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(gitPush).mock.calls[0][0]).toBe(dir);
  });

  test("the exposed set contains neither git tool, however it is spelled", () => {
    const exposed = buildOstTools(contextFor(dir, vault), MCP_TOOL_NAMES) as unknown as RunnableTool[];
    expect(exposed.map((t) => t.name).filter((n) => /git/i.test(n))).toEqual([]);
    expect(exposed.length).toBe(MCP_TOOL_NAMES.length);
  });

  test("driving every exposed tool never enters the push path", async () => {
    const exposed = buildOstTools(contextFor(dir, vault), MCP_TOOL_NAMES) as unknown as RunnableTool[];
    const landers = new Set<string>();
    let n = 0;

    for (const tool of exposed) {
      // Built OUTSIDE the try: a driver that cannot construct its own input must
      // fail loudly, never be swallowed by the catch meant for tool refusals.
      const input = inputFor(tool, AIM[tool.name](n++));
      const problems = validateToolInput(tool.input_schema, input);
      expect(problems, `${tool.name} refused the driver's own input: ${problems.join("; ")}`).toEqual([]);
      const before = vaultDigest(dir);
      try {
        await tool.run(input);
      } catch {
        // A tool may refuse on its own terms; that is not what is under test.
      }
      if (vaultDigest(dir) !== before) landers.add(tool.name);
    }

    // Non-vacuity, named rather than counted: every tool whose job is to write
    // has to have written. A driver silently refused on one of these would have
    // proved nothing about it while the push assertion below stayed green.
    expect([...landers].sort()).toEqual([
      "ost_annotate",
      "ost_append_to_node",
      "ost_create_node",
      // The three that can remove something. They land here — unlike in P10's
      // sweep, where the merge row aims the borrowed-result attack and is
      // refused — because these targets are ordinary duplicates with no recorded
      // result between them, which is the case the tool exists for.
      "ost_deposit",
      "ost_detach_nodes",
      "ost_edit_node",
      "ost_flag_humans_required",
      "ost_ingest_inbox",
      "ost_link_nodes",
      "ost_merge_nodes",
      "ost_rank_source",
      "ost_set_evidence",
      "ost_set_instrument",
      "ost_set_status",
    ]);
    expect(vi.mocked(gitPush), "a tool the MCP server exposes reached gitPush").not.toHaveBeenCalled();
  });

  test("and the surface is still incapable when the whole allowlist is built minus the git pair", async () => {
    // The filter is `MCP_TOOL_NAMES`, a list. This asks the same question of the
    // complement computed from the allowlist itself, so the answer does not
    // depend on the two lists agreeing — which is the very thing the first half
    // of this file just checked, and a check should not rest on its neighbour.
    const names = ALLOWED_TOOL_NAMES.filter((n) => !OUTWARD_TOOLS.includes(n));
    const built = buildOstTools(contextFor(dir, vault), names) as unknown as RunnableTool[];
    let n = 0;
    for (const tool of built) {
      const input = inputFor(tool, AIM[tool.name](100 + n++));
      await tool.run(input).catch(() => undefined);
    }
    expect(vi.mocked(gitPush)).not.toHaveBeenCalled();
  });
});
