/**
 * F6 — No Gate F verdict is computed from a file the unattended surface can write.
 *
 * This is the criterion whose subject is the other five. Gate F's mechanisms are
 * worth exactly what their deciders are worth, and a decider the cartographer can
 * write decides nothing: one appended line to the run ledger resets a no-op
 * streak, one future-stamped record pins the cadence gate, one edited
 * `loop.spend` widens the pool the firing was about to reserve against.
 *
 * The property held before this file existed. What did not exist was anything
 * asserting it. It was the conjunction of three tests written for three other
 * reasons — `nodePath` refusing separators (vault), the examples' deny lists
 * (W5), the ledger living under `.git/` (health) — and that is B12's shape
 * exactly: every link green in isolation while nothing asserts they are one
 * chain. W5 could be tightened, the ledger could move, a fourth decider could be
 * added reading somewhere new, and all three would stay green.
 *
 * So this file states the join, in four parts:
 *
 * 1. **Enumeration** — every module under `src/loop/` is either a decider whose
 *    reads are listed here, a supporting module whose reads are attributed to
 *    one, or provably touches no file at all. A new module fails the build until
 *    someone classifies it. This is the part that makes the rest non-vacuous:
 *    without it the join covers whatever the author remembered.
 * 2. **The MCP surface, behaviourally** — every mutating tool on the allowlist is
 *    invoked against every decider path, with the path in every string argument
 *    the tool's own schema declares, relative and absolute. Every decider file is
 *    then compared byte for byte. A positive control proves the driver is really
 *    reaching the tools rather than bouncing off validation.
 * 3. **The harness surface** — each unattended entry point grants nothing but
 *    names on `MCP_TOOL_NAMES` (the surface part 2 just proved incapable) and
 *    denies every built-in that can write an arbitrary path.
 * 4. **The join** — the two surfaces above are the whole grant, so a decider
 *    file no tool on either can write is a decider the agent cannot forge.
 * 5. **The one input that breaks the pattern, named rather than hidden** — the
 *    `degraded` verdict reads the vault's own tool trace, and the surface writes
 *    that file on every call. Part 5 states what holds there instead, and is
 *    deliberately a weaker claim than parts 2–4 make about everything else.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { configPath } from "../../src/config/load.js";
import { resolveSessionsDir } from "../../src/cli/loop.js";
import { claimsPath } from "../../src/loop/claim.js";
import { openRunPath, runsPath } from "../../src/loop/health.js";
import { firingLockPath } from "../../src/loop/lock.js";
import { loopStateDir } from "../../src/loop/state.js";
import { announcedPath, appliedPath } from "../../src/loop/updates.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";
import { buildOstTools } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readRepoFile = (p: string) => fs.readFileSync(path.join(repoRoot, p), "utf8");

/**
 * The transcript directory the shipped documentation tells an operator to
 * declare. Kept in the same form they would paste — with the `~` — because
 * resolving it is part of what is under test: a `~` resolved against the vault
 * would put a Gate F input *inside* the writable surface.
 */
const DECLARED_SESSIONS_DIR = "~/.claude/projects/example";

interface Decider {
  /** Which criterion this decider decides. */
  criterion: string;
  name: string;
  /** The module that computes the verdict, relative to the repo root. */
  module: string;
  /** Every file it reads, derived by calling the shipped path functions. */
  reads: (vault: string) => string[];
}

/**
 * Every Gate F decider and every file it reads.
 *
 * The paths come from the exported path functions rather than from string
 * literals, so moving the ledger moves this enumeration with it instead of
 * leaving it pointing at a file nothing uses any more — the failure mode that
 * made 22 citations in the readiness document green against wrong lines.
 */
const DECIDERS: readonly Decider[] = [
  {
    criterion: "F1",
    name: "cadence gate",
    module: "src/loop/cadence.ts",
    reads: (v) => [configPath(v), runsPath(v)],
  },
  {
    criterion: "F2",
    name: "overlap lock",
    module: "src/loop/lock.ts",
    reads: (v) => [configPath(v), firingLockPath(v)!],
  },
  {
    criterion: "F3",
    name: "spend ceiling",
    module: "src/loop/spend.ts",
    reads: (v) => [configPath(v), resolveSessionsDir(v, DECLARED_SESSIONS_DIR)],
  },
  {
    criterion: "F4 / H1 / H4",
    name: "health verdict",
    module: "src/loop/health.ts",
    reads: (v) => [runsPath(v), openRunPath(v), path.join(v, ".git", "HEAD")],
  },
];

/**
 * Modules under `src/loop/` that open files, each attributed to the decider
 * whose `reads` list already names what it opens.
 *
 * Note that the module computing a verdict and the module opening its inputs
 * are routinely different — `cadence.ts` decides F1 and reads nothing, because
 * the CLI hands it the ledger `health.ts` opened. Classification here is by who
 * opens a file, since that is what determines whether a file is a decider input.
 */
const READER_MODULES: Record<string, string> = {
  "health.ts": "F4 / H1 / H4",
  "lock.ts": "F2",
  "spend.ts": "F3",
  // Resolves <vault>/.git and reads HEAD via `git rev-parse`; both files are
  // enumerated under the health verdict.
  "state.ts": "F4 / H1 / H4",
};

/**
 * Modules under `src/loop/` that touch no file at all. Asserted rather than
 * trusted: a pure module that quietly grows a `readFileSync` is a new decider
 * input nobody enumerated.
 */
const PURE_MODULES = ["cadence.ts", "exitLaundering.ts", "stall.ts"];

/**
 * The third class, and the reason it exists rather than being folded into the
 * second.
 *
 * `degraded.ts` decides whether a firing may report a clean run, and one of its
 * inputs is `.ost-agent/usage/events.jsonl` — the trace `withUsageTracing` writes
 * on every allowlisted call. So the surface CAN move this decider, which is the
 * property parts 2–4 exist to refuse everywhere else, and filing it under
 * `READER_MODULES` would have made part 2 fail for a true reason with a
 * misleading message.
 *
 * **What holds instead, and it is genuinely weaker.** The agent cannot forge a
 * trace line; it can only cause one by actually invoking a tool, because the line
 * is written by the dispatcher inside the call. And it cannot remove one: the
 * allowlist has no tool that deletes, truncates or rewrites a file. So the single
 * direction the surface can move this verdict is *out* of `degraded`, by really
 * using the tools it is being asked whether it had — which is the behaviour the
 * verdict exists to elicit. The honest limit follows from the same sentence: this
 * detects a firing whose surface was ABSENT, not one whose surface was present and
 * unused past the first call. Part 5 pins both halves.
 */
const TRACE_READER_MODULES: Record<string, string> = {
  "degraded.ts": "F4 / H1 / H4",
};

/**
 * The fourth class: modules that open files and decide nothing.
 *
 * `questions.ts` reads the same session transcripts `spend.ts` does, but it
 * produces a LINE, not a verdict — the question budget reports how much of the
 * operator's attention a firing may cost and never refuses one, never touches an
 * exit code. Filing it under `READER_MODULES` would have attributed it to a Gate F
 * criterion it does not decide, and the enumeration's whole value is that the
 * attribution is real.
 *
 * `corrections.ts` is the same shape and is here for the same reason. It reads
 * finished session transcripts and its own ledger, and what it produces is TEXT
 * handed to the next session before it composes — advice, carrying no verdict, no
 * exit code and no gate. `ost-agent corrections` cannot refuse a firing, and both
 * wrappers treat an unreadable ledger as a missing paragraph in a prompt rather
 * than a reason to stop.
 *
 * `senses.ts` is the third, and it is the one whose classification is worth
 * stating carefully because it sits next to a decider that looks just like it.
 * `degraded.ts` reads the same usage trace and the same `buildPassContext`, and it
 * is a TRACE READER because what it returns changes a verdict and an exit code
 * (`LOOP_EXIT.degraded`). The sense census reads those same inputs and returns
 * LINES. Nothing folds it into `computeVerdict`, nothing branches on it, and seal's
 * exit code is computed from `sealed.verdict` alone — so a census that came out
 * wrong misinforms a reader and cannot move a gate. That is precisely the reporter
 * property, and it is the reason the census may be printed unconditionally on every
 * firing while the degraded banner may not.
 *
 * The property that keeps this class from being a hole is asserted below: no
 * decider imports a reporter. The moment one does, its reads become decider inputs
 * and this classification fails the build rather than silently going stale. That
 * assertion is doing real work for `senses.ts` specifically: it is the line that
 * would fail the build if a future change ever let the census decide anything.
 */
const REPORTER_MODULES = ["questions.ts", "corrections.ts", "senses.ts"];

/**
 * The fifth class, and the one that could most easily have been a hole.
 *
 * `claim.ts` reads a file and produces a verdict carrying an exit code
 * (`CLAIM_EXIT.alreadyClaimed` stops a pass before it builds), so it is not a
 * reporter. It decides no Gate F criterion either — no cadence, no lock, no
 * ceiling, no health — so filing it under `READER_MODULES` would attribute it to
 * a criterion it does not decide, which is the dishonesty part 1 exists to
 * prevent.
 *
 * **What it gets instead of an exemption: the same proof.** A claim the
 * unattended surface can write is a claim the agent can forge (take work it
 * never did) or erase (rebuild work somebody holds), which is worth precisely
 * nothing. So the ledger is enumerated below like a decider input and goes
 * through parts 2 and 4 byte for byte with the rest — it lives in the same
 * `.git/ost-agent/` directory as `firing.lock`, and the point of listing it here
 * is that a future move OUT of that directory fails this file rather than
 * quietly making the claims forgeable.
 */
const OFF_GATE_DECIDER_MODULES: Record<string, string> = {
  "claim.ts": "the work claim — decides whether a pass may start, not whether a firing may",
  "updates.ts": "the update channel — decides which VERSION a pass runs, not whether a firing may",
};

/**
 * Files read by deciders that are not Gate F deciders. Snapshotted beside the
 * Gate F inputs in part 2 for the reason above.
 *
 * **`updates.ts` is the one entry here whose threat model is not the agent**, and
 * it is worth stating rather than filing quietly. The other deciders are proved
 * safe by showing the unattended surface cannot write them; the update spool has
 * exactly that property, for exactly the same reason (`.git/ost-agent/`, which
 * `git add -A` cannot reach), and it is nonetheless the one decider a push
 * channel intends somebody OFF this machine to write. That is what the feature
 * is. So what part 2 proves about it is the same thing it proves about the rest —
 * the agent cannot forge a version pin for itself — and the question of whether
 * an operator should accept a remote writer at all is a question about people,
 * settled by the assumption test under the solution and not by this file. Listing
 * the two paths here is what makes a future move out of `.git/` fail the build
 * instead of quietly handing the agent its own version pin.
 */
const OFF_GATE_DECIDER_PATHS = (v: string): string[] => [
  claimsPath(loopStateDir(v)!),
  announcedPath(v)!,
  appliedPath(v)!,
];

/**
 * A throwaway checkout, for the two enumeration assertions that need a vault
 * before the suite's own one exists. `loopStateDir` resolves through a real
 * `.git`, which is the resolution under test — passing a made-up path would ask
 * a different question.
 */
function sampleCheckout(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-f6-sample-"));
  fs.mkdirSync(path.join(dir, ".git"));
  return dir;
}

const FS_READ =/\bfs\.(readFileSync|readdirSync|existsSync|statSync|lstatSync|realpathSync|openSync)\b|\bspawnSync\b|\bexecFileSync\b/;

describe("1 — the enumeration covers every module that can become a decider input", () => {
  const loopDir = path.join(repoRoot, "src/loop");
  const modules = fs
    .readdirSync(loopDir)
    .filter((f) => f.endsWith(".ts"))
    .sort();

  test("every module under src/loop is classified exactly once", () => {
    for (const m of modules) {
      const classifications = [
        READER_MODULES[m] ? "reader" : null,
        TRACE_READER_MODULES[m] ? "trace-reader" : null,
        PURE_MODULES.includes(m) ? "pure" : null,
        REPORTER_MODULES.includes(m) ? "reporter" : null,
        OFF_GATE_DECIDER_MODULES[m] ? "off-gate decider" : null,
      ].filter(Boolean);
      expect(
        classifications,
        `src/loop/${m} is not classified — add it to READER_MODULES, TRACE_READER_MODULES, PURE_MODULES, ` +
          "REPORTER_MODULES or OFF_GATE_DECIDER_MODULES, and if it opens a new file for a DECIDER, add that " +
          "file to the decider's reads so both surfaces below cover it",
      ).toHaveLength(1);
    }
  });

  test("every reader is attributed to a decider this file enumerates", () => {
    const known = new Set(DECIDERS.map((d) => d.criterion));
    for (const [m, criterion] of Object.entries({ ...READER_MODULES, ...TRACE_READER_MODULES })) {
      expect(known.has(criterion), `src/loop/${m} is attributed to "${criterion}", which is not in DECIDERS`).toBe(true);
    }
  });

  test("the modules declared pure really read nothing", () => {
    for (const m of PURE_MODULES) {
      const src = fs.readFileSync(path.join(loopDir, m), "utf8");
      expect(FS_READ.test(src), `src/loop/${m} is declared pure but touches the filesystem`).toBe(false);
    }
  });

  test("the modules declared readers really do read something", () => {
    // Non-vacuity in the other direction: a reader whose reads list is a guess
    // rather than a reading of the code would pass every assertion below.
    for (const m of Object.keys(READER_MODULES)) {
      const src = fs.readFileSync(path.join(loopDir, m), "utf8");
      expect(FS_READ.test(src), `src/loop/${m} is enumerated as reading files but does not`).toBe(true);
    }
  });

  test("the trace readers really do read the trace", () => {
    // Same non-vacuity, spelled differently because these modules read through
    // the shared helpers rather than through `fs` — a module filed here that
    // stopped touching the trace would be claiming an exemption it no longer
    // needs, and part 5's weaker property would be covering nothing.
    for (const m of Object.keys(TRACE_READER_MODULES)) {
      const src = fs.readFileSync(path.join(loopDir, m), "utf8");
      expect(src, `src/loop/${m} is enumerated as a trace reader but does not read the trace`).toMatch(
        /readUsageEvents/,
      );
    }
  });

  test("the modules declared reporters really do read something", () => {
    // Same non-vacuity as the readers: a "reporter" that touches no file is just a
    // pure module filed in the class with the weaker obligations.
    for (const m of REPORTER_MODULES) {
      const src = fs.readFileSync(path.join(loopDir, m), "utf8");
      expect(FS_READ.test(src), `src/loop/${m} is filed as a reporter but reads nothing`).toBe(true);
    }
  });

  test("the off-gate deciders really do read something, and it is enumerated", () => {
    // Same non-vacuity as the readers. The second half matters more here: this
    // class buys its place by having its inputs snapshotted like a decider's, so
    // a module filed here that opened a file OFF the list would be taking the
    // classification without the obligation.
    for (const m of Object.keys(OFF_GATE_DECIDER_MODULES)) {
      const src = fs.readFileSync(path.join(loopDir, m), "utf8");
      expect(FS_READ.test(src), `src/loop/${m} is filed as an off-gate decider but reads nothing`).toBe(true);
      expect(
        OFF_GATE_DECIDER_PATHS(sampleCheckout()).length,
        `src/loop/${m} is filed as an off-gate decider but no path is enumerated for it`,
      ).toBeGreaterThan(0);
    }
  });

  test("the off-gate deciders' inputs live where the surface cannot reach", () => {
    // The whole argument for the class in one assertion: these files are under
    // the git directory, which is the property parts 2–4 turn into a proof.
    for (const p of OFF_GATE_DECIDER_PATHS(sampleCheckout())) {
      expect(p, `${p} is an off-gate decider input outside .git/ — it is forgeable`).toContain(
        path.join(".git", "ost-agent"),
      );
    }
  });

  test("no decider imports a reporter, so no verdict is computed from what one reads", () => {
    // This is what makes the reporter class safe rather than an exemption. A
    // reporter's files are NOT enumerated as decider inputs and are NOT covered by
    // parts 2–4; that is only sound while no verdict can reach them.
    const deciderModules = [
      ...DECIDERS.map((d) => d.module),
      ...Object.keys({ ...READER_MODULES, ...TRACE_READER_MODULES, ...OFF_GATE_DECIDER_MODULES }).map(
        (m) => `src/loop/${m}`,
      ),
    ];
    for (const decider of new Set(deciderModules)) {
      const src = readRepoFile(decider);
      for (const reporter of REPORTER_MODULES) {
        expect(
          src.includes(`./${reporter.replace(/\.ts$/, ".js")}`),
          `${decider} imports the reporter src/loop/${reporter} — its reads are now decider inputs, ` +
            "so move it to READER_MODULES and enumerate them",
        ).toBe(false);
      }
    }
  });

  test("the loop CLI reads no vault file the enumeration does not already name", () => {
    // The entry point itself is a decider input: it loads the config and hands
    // the three loop blocks to the gates. `loadConfig` is `ost.config.yaml`,
    // already enumerated three times over; anything else opening a path here
    // would be a fourth decider input.
    const src = readRepoFile("src/cli/loop.ts");
    const opens = [...src.matchAll(/\bfs\.[a-zA-Z]+Sync\(/g)].map((m) => m[0]);
    expect(opens, "src/cli/loop.ts opens a file directly — enumerate it as a decider input").toEqual([]);
    expect(src).toMatch(/loadConfig\(/);
  });
});

/* ------------------------------------------------------------------ */

let vault: string;

function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * Every decider file, deduplicated, in a stable order — Gate F's, plus the
 * off-gate deciders' inputs, which earn the same byte-for-byte comparison for
 * the reason {@link OFF_GATE_DECIDER_MODULES} gives.
 */
function deciderPaths(v: string): string[] {
  return [...new Set([...DECIDERS.flatMap((d) => d.reads(v)), ...OFF_GATE_DECIDER_PATHS(v)])].sort();
}

function digest(p: string): string {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch (e) {
    return `absent:${(e as NodeJS.ErrnoException).code}`;
  }
}

function snapshot(paths: string[]): Record<string, string> {
  return Object.fromEntries(paths.map((p) => [p, digest(p)]));
}

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-f6-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.writeFileSync(
    configPath(vault),
    [
      "outcome: Ship the thing",
      "loop:",
      '  cadence: "6h"',
      "  spend:",
      "    ceilingWeightedTokens: 1000000",
      "    windowHours: 24",
      `    sessionsDir: "${DECLARED_SESSIONS_DIR}"`,
      "",
    ].join("\n"),
    "utf8",
  );
  // Real records, so a write that lands is a changed hash rather than a created
  // file that a laxer assertion might read as "was already like that".
  fs.mkdirSync(path.dirname(runsPath(vault)), { recursive: true });
  fs.writeFileSync(
    runsPath(vault),
    JSON.stringify({ runId: "r1", startedAt: "2026-07-01T00:00:00.000Z", verdict: "healthy", steps: [] }) + "\n",
    "utf8",
  );
  fs.writeFileSync(openRunPath(vault), JSON.stringify({ runId: "r2", startedAt: "2026-07-02T00:00:00.000Z" }), "utf8");
  fs.writeFileSync(firingLockPath(vault)!, JSON.stringify({ pid: 1, acquiredAt: "2026-07-02T00:00:00.000Z" }), "utf8");
  fs.writeFileSync(
    claimsPath(loopStateDir(vault)!),
    JSON.stringify({
      key: "0123456789abcdef",
      label: "the invited-visitor arm split",
      naming: "invited-visitor arm split",
      session: "s1",
      claimedAt: "2026-07-02T00:00:00.000Z",
      expiresAt: "2026-07-02T08:00:00.000Z",
      briefingDigest: "abc123",
      state: "held",
    }) + "\n",
    "utf8",
  );

  const v = new Vault(vault);
  v.createNode({ title: "Ship the thing", layer: "Outcome", tags: [], links: [], body: "root" });
  v.createNode({ title: "Users churn", layer: "Opportunity", tags: [], links: [], body: "an opportunity" });
  v.linkNodes("Ship the thing", "Users churn");
  git("add", "-A");
  git("commit", "-qm", "root");
});

afterEach(() => fs.rmSync(vault, { recursive: true, force: true }));

/**
 * The two tools that reach the network. Excluded from the driver because
 * invoking them with an attack string as a URL would make a real request from
 * CI, and both are read-only — the only file either can produce is the trust
 * ledger `ost_rank_source` writes, and that tool IS driven below.
 */
const NETWORK_TOOLS = new Set(["ost_search_web", "ost_read_web"]);

interface JsonSchema {
  properties?: Record<string, { type?: string; enum?: string[] }>;
}

/**
 * Fill every string property a tool declares with the attack path.
 *
 * Every property, not only the required ones, and read off the tool's own
 * schema rather than a hand-written list — so a tool that grows a new path-ish
 * argument is attacked through it the day it ships, without this file being
 * edited.
 *
 * It throws on a tool whose schema it cannot read, and the throw is deliberately
 * outside the driver's `try`. The first draft read `inputSchema`; the shipped
 * defs carry `input_schema` (`src/security/tool.ts:37`), so every generated
 * input was `undefined`, every call threw inside the catch, and the byte
 * comparison passed against a surface that had never been touched. **The whole
 * of part 2 was vacuous and green.** That is the failure this file exists to
 * name, committed by this file, so the guard is not optional.
 */
function attackInput(schema: JsonSchema | undefined, attack: string): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    throw new Error("tool definition carries no readable input schema — the driver would attack nothing");
  }
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    if (spec.enum) out[key] = spec.enum[0];
    else if (spec.type === "array") out[key] = [attack];
    else if (spec.type === "number" || spec.type === "integer") out[key] = 1;
    else if (spec.type === "boolean") out[key] = true;
    else out[key] = attack;
  }
  return out;
}

type RunnableTool = { name: string; input_schema: JsonSchema; run: (input: unknown) => Promise<unknown> };

/** How many string arguments of this tool the attack path reaches. */
function attackedFields(tool: RunnableTool, attack: string): number {
  return Object.values(attackInput(tool.input_schema, attack)).filter(
    (v) => v === attack || (Array.isArray(v) && v.includes(attack)),
  ).length;
}

function mutatingTools(): RunnableTool[] {
  const ctx = { vault: new Vault(vault), dir: vault, remote: { enabled: false }, surface: "test" };
  return (buildOstTools(ctx) as unknown as RunnableTool[]).filter(
    (t) => MCP_TOOL_NAMES.includes(t.name as (typeof MCP_TOOL_NAMES)[number]) && !NETWORK_TOOLS.has(t.name),
  );
}

describe("2 — the MCP surface cannot write a Gate F decider", () => {
  test("the driver is exercising the real tool surface", async () => {
    // Non-vacuity. If every call below threw on validation, the byte comparison
    // would pass while proving nothing at all. So: the same driver, aimed at a
    // legitimate title, has to actually change the tree.
    const tools = mutatingTools();
    expect(tools.length).toBeGreaterThan(5);

    const before = fs.readFileSync(path.join(vault, "Users churn.md"), "utf8");
    const append = tools.find((t) => t.name === "ost_append_to_node")!;
    await append.run({ title: "Users churn", section: "## Notes\nreached the tool" });
    expect(fs.readFileSync(path.join(vault, "Users churn.md"), "utf8")).not.toEqual(before);
  });

  test("every mutating tool, aimed at every decider file, leaves all of them byte-identical", async () => {
    const targets = deciderPaths(vault);
    expect(targets.length).toBeGreaterThanOrEqual(5);
    const before = snapshot(targets);

    let attempted = 0;
    let fieldsAttacked = 0;
    for (const target of targets) {
      // Both spellings an attacker has: the path as written in the config or the
      // repo (relative to the vault, so `../` escapes are in play) and the fully
      // resolved absolute path.
      const spellings = [path.relative(vault, target), target, `./${path.relative(vault, target)}`];
      for (const attack of spellings) {
        for (const tool of mutatingTools()) {
          // Built OUTSIDE the try on purpose — see attackInput's note. A driver
          // that cannot construct its own attack must fail loudly, never be
          // swallowed by the catch meant for the tool's refusals.
          const input = attackInput(tool.input_schema, attack);
          attempted += 1;
          fieldsAttacked += attackedFields(tool, attack);
          try {
            await tool.run(input);
          } catch {
            // A refusal is one of the two acceptable outcomes; the other is a
            // write that lands somewhere other than a decider. Both are settled
            // by the comparison below, not by which one happened.
          }
        }
      }
    }

    expect(attempted).toBeGreaterThan(30);
    // The count that would have been zero while everything above stayed green.
    expect(fieldsAttacked).toBeGreaterThan(attempted);
    expect(snapshot(targets)).toEqual(before);
  });

  test("no tool created a new file in the loop's state directory", async () => {
    // The comparison above is per known path. This one catches a write that
    // lands *beside* a decider — a second ledger, a lock under another name —
    // which a later read could pick up.
    const stateDir = path.dirname(runsPath(vault));
    const before = fs.readdirSync(stateDir).sort();

    for (const tool of mutatingTools()) {
      for (const attack of [path.join(stateDir, "planted.jsonl"), "../.git/ost-agent/planted.jsonl"]) {
        const input = attackInput(tool.input_schema, attack);
        await tool.run(input).catch(() => undefined);
      }
    }

    expect(fs.readdirSync(stateDir).sort()).toEqual(before);
  });

  test("the vault's own commit sweep cannot pull a decider into the tree", () => {
    // `git add -A` on every mutating call is what makes a ledger in the working
    // tree a W2 violation on every firing. The records are under `.git/`, so the
    // sweep cannot see them — asserted, because the reason it holds is a
    // property of where the files live and that could change.
    git("add", "-A");
    for (const p of deciderPaths(vault)) {
      const rel = path.relative(vault, p);
      if (rel.startsWith("..")) continue; // outside the vault entirely (transcripts)
      const tracked = git("ls-files", "--", rel).trim();
      if (rel === path.basename(configPath(vault))) {
        expect(tracked, "the config is the operator's file and is tracked on purpose").not.toBe("");
      } else {
        expect(tracked, `${rel} is reachable by \`git add -A\``).toBe("");
      }
    }
  });
});

/**
 * 5 — the one decider input the surface writes, and the weaker thing that holds.
 *
 * The `degraded` verdict asks whether a firing had the means to do its job, and
 * its evidence is the vault's own tool trace. That file is written by the surface
 * being judged, which parts 2–4 refuse everywhere else — so the claim here is
 * smaller and is stated as such: the surface can only ADD to the trace, only by
 * really invoking a tool, and never by removing what is already there. A verdict
 * built on that can be moved out of `degraded` by doing the work, and in no other
 * direction.
 */
describe("5 — the trace the degraded verdict reads is append-only under the whole surface", () => {
  const tracePath = (v: string) => path.join(v, ".ost-agent", "usage", "events.jsonl");

  test("a tool call really does append to it — the trace is the surface's own record", async () => {
    // Non-vacuity first, and it is the whole reason this input is exempt from
    // part 2: if the surface could NOT write here, there would be nothing to
    // carve out and no evidence a pass ever reached the tree.
    const append = mutatingTools().find((t) => t.name === "ost_append_to_node")!;
    await append.run({ title: "Users churn", section: "## Notes\nreached the tool" });

    const lines = fs.readFileSync(tracePath(vault), "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.parse(lines[lines.length - 1]).tool).toBe("ost_append_to_node");
  });

  test("no tool on the allowlist can shorten or rewrite what is already recorded", async () => {
    const trace = tracePath(vault);
    fs.mkdirSync(path.dirname(trace), { recursive: true });
    const planted =
      JSON.stringify({ ts: "2026-07-01T00:00:00.000Z", tool: "ost_read_tree", ok: true, ms: 1, surface: "mcp", argBytes: 2 }) +
      "\n";
    fs.writeFileSync(trace, planted, "utf8");

    // The same driver as part 2, aimed at the trace in every spelling.
    for (const attack of [path.relative(vault, trace), trace, `./${path.relative(vault, trace)}`]) {
      for (const tool of mutatingTools()) {
        await tool.run(attackInput(tool.input_schema, attack)).catch(() => undefined);
      }
    }

    // Append-only: whatever the surface added, the earlier record is still there,
    // byte for byte, at the front. A verdict read off this file cannot be moved
    // by erasing the evidence that the pass DID reach the tree either.
    const after = fs.readFileSync(trace, "utf8");
    expect(after.startsWith(planted)).toBe(true);
  });

  test("the limit is stated where the verdict is computed, not only here", () => {
    // The property this file can prove is narrower than the verdict's name
    // suggests, and a limit recorded only in a test is a limit the next reader of
    // the module will not meet. So the module has to say it too.
    // Comment markers stripped and whitespace normalised, because a sentence that
    // wraps across two comment lines is the same sentence — a check that missed it
    // would be arguing with the formatter rather than with the author.
    const prose = readRepoFile("src/loop/degraded.ts")
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ");
    expect(prose.includes("cannot make zero tool calls"), "the inference the verdict rests on is not stated").toBe(true);
    expect(
      prose.includes("does not separate work done from work shirked"),
      "the limit of that inference is not stated",
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

/**
 * Built-ins that can write a path of the caller's choosing. Denying these is
 * what makes "the MCP surface cannot write a decider" the whole story rather
 * than one story among several.
 */
const PATH_WRITING_BUILTINS = ["Bash", "Edit", "Write", "NotebookEdit", "Task", "Skill"];

const ENTRY_POINTS: ReadonlyArray<[file: string, allow: RegExp, deny: RegExp]> = [
  ["examples/automation/autonomous-pass.sh", /^OST_TOOLS="([^"]+)"/m, /^DENIED_TOOLS="([^"]+)"/m],
  ["examples/automation/github-workflow.yml", /--allowedTools "([^"]+)"/, /--disallowedTools "([^"]+)"/],
];

function toolList(source: string, pattern: RegExp): string[] {
  const m = source.match(pattern);
  if (!m) throw new Error("no tool list matched");
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("3 — the unattended surface grants nothing beyond the tools proved incapable above", () => {
  for (const [file, allowPattern, denyPattern] of ENTRY_POINTS) {
    describe(file, () => {
      const source = readRepoFile(file);

      test("every granted tool is a name on MCP_TOOL_NAMES", () => {
        const allowed = toolList(source, allowPattern);
        expect(allowed.length).toBeGreaterThan(0);
        for (const t of allowed) {
          const bare = t.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
          expect(
            (MCP_TOOL_NAMES as readonly string[]).includes(bare),
            `${t} is granted but is not an ost_* tool — part 2 says nothing about what it can write`,
          ).toBe(true);
        }
      });

      test("every built-in that can write a path of its own choosing is denied", () => {
        const denied = new Set(toolList(source, denyPattern));
        for (const b of PATH_WRITING_BUILTINS) {
          expect(denied.has(b), `${b} is not denied — a Gate F decider is one tool call from being rewritten`).toBe(true);
        }
      });

      test("no permission mode pre-accepts writes", () => {
        expect(source).not.toMatch(/--permission-mode\s+acceptEdits/);
        expect(source).not.toMatch(/--dangerously-skip-permissions/);
      });
    });
  }
});

/* ------------------------------------------------------------------ */

/**
 * Why each decider is out of reach, computed rather than asserted.
 *
 * Parts 2 and 3 establish that nothing on either surface *did* write a decider.
 * This part says why none of them *can*, by putting every decider path in
 * exactly one of three categories and refusing to accept a fourth. A decider
 * that stops fitting — a ledger moved into the working tree, a transcript
 * directory declared inside the vault — comes out `unclassified` and fails here
 * before it fails in production, which is the whole point of enumerating.
 */
type Shelter = "outside-the-vault" | "inside-dot-git" | "operator-owned-config" | "unclassified";

function shelterOf(v: string, target: string): Shelter {
  const rel = path.relative(v, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "outside-the-vault";
  if (rel === path.basename(configPath(v))) return "operator-owned-config";
  if (rel === ".git" || rel.startsWith(`.git${path.sep}`)) return "inside-dot-git";
  return "unclassified";
}

describe("4 — the join: every decider path is sheltered, and by a stated mechanism", () => {
  test("every decider path falls into one of the three sheltered categories", () => {
    const classified = deciderPaths(vault).map((p) => [path.relative(vault, p), shelterOf(vault, p)] as const);
    expect(classified.length).toBeGreaterThanOrEqual(5);
    for (const [rel, shelter] of classified) {
      expect(
        shelter,
        `${rel} is a Gate F input inside the vault's writable surface — say which mechanism keeps it out of reach, or move it`,
      ).not.toBe("unclassified");
    }
  });

  test("all three categories are actually in use, so none of them is dead prose", () => {
    const used = new Set(deciderPaths(vault).map((p) => shelterOf(vault, p)));
    expect([...used].sort()).toEqual(["inside-dot-git", "operator-owned-config", "outside-the-vault"]);
  });

  test("the transcript directory a firing measures spend from resolves outside the vault", () => {
    // The `~` is the whole reason this is a test rather than an observation.
    // `path.resolve(vault, "~/.claude/…")` yields `<vault>/~/.claude/…`, which
    // is inside the writable surface — so the same bug that once wedged the loop
    // permanently (F3's sharp edge) would also have made the spend ceiling's
    // input forgeable. One fix, two criteria.
    const resolved = resolveSessionsDir(vault, DECLARED_SESSIONS_DIR);
    expect(shelterOf(vault, resolved)).toBe("outside-the-vault");
    expect(resolved.startsWith(os.homedir())).toBe(true);
  });

  test("the config is the one decider inside the tree, and no MCP write can name it", () => {
    // Every MCP write resolves to `<vault>/<sanitized title>.md` — no separator
    // survives `nodePath` and the extension is not the caller's to choose — so
    // `ost.config.yaml` is unnameable from that surface however it is spelled.
    // Part 3 covers the other surface. Stated here because this is the single
    // decider whose shelter is a property of the writer rather than of location.
    const rel = path.relative(vault, configPath(vault));
    expect(shelterOf(vault, configPath(vault))).toBe("operator-owned-config");
    expect(rel.endsWith(".md")).toBe(false);
    expect(fs.readdirSync(vault).filter((f) => f.endsWith(".md")).length).toBeGreaterThan(0);
  });
});
