# Attention Ledger Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an unknown a first-class, measurable object — a tree node carrying a Format/Methodology/Rationale contract, with attributed attention cost and a recorded resolution.

**Architecture:** A fifth OST layer (`Unknown`) attachable under any node it darkens. The contract lives in body sections (`## Format`, `## Methodology`, `## Rationale`), detected mechanically the way `hasRecordedResult` detects `## Results`. Class is *derived* from contract completeness rather than stored, so changing the classifier reclassifies existing nodes. Cost accrues to an append-only sidecar keyed by unknown, attributed via an `OST_UNKNOWN` env marker that rides the existing `OST_SESSION` plumbing. Token tiers are extracted from Claude Code session JSONL and kept unmixed.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, gray-matter. No new dependencies.

## Global Constraints

- **No new tool names.** `ALLOWED_TOOL_NAMES` (`src/security/policy.ts:12`) is not modified by this plan. Unknowns are created with the existing `ost_create_node`, attached with `ost_link_nodes`, resolved with `ost_set_status`, and annotated with `ost_annotate`.
- **No new node status values.** `NodeStatus` is unchanged; `validated` means satisfied and `deferred` means abandoned.
- **Fail-open telemetry.** Ledger writes never throw. A telemetry failure costs an event, never a mutation — the contract `recordUsageEvent` already keeps (`src/telemetry/usage.ts:51`).
- **Append-only.** No function in this plan deletes, truncates, or rewrites a file.
- **Token tiers stay unmixed** everywhere they are stored. Weighting is applied only at read time.
- **ESM imports** must carry the `.js` extension (e.g. `../ost/node.js`), matching every existing file.
- **Tests** live under `test/<mirror of src path>.test.ts` and use `import { describe, expect, test } from "vitest"`.
- Run the full suite with `npm test`. Baseline before this plan: **70 files, 543 tests passing.**

---

### Task 1: The `Unknown` layer

Adds the fifth layer and lets it attach under any node. Serialization is generic over `Layer`, so round-tripping comes free once the type admits it.

**Files:**
- Modify: `src/ost/node.ts:31-38` (`Layer` type and `LAYERS` array)
- Modify: `src/security/tools.ts:30-34` (`CHILD_HIERARCHY`)
- Test: `test/ost/node.test.ts` (append), `test/security/unknown-layer.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `Layer` now includes `"Unknown"`; `LAYERS` has 5 entries. Later tasks type unknown nodes as `OstNode` with `layer: "Unknown"`.

- [ ] **Step 1: Write the failing test**

Append to `test/ost/node.test.ts`:

```typescript
describe("the Unknown layer", () => {
  test("round-trips an Unknown node with its contract sections intact", () => {
    const node: OstNode = {
      title: "How many users hit the export path",
      layer: "Unknown",
      tags: [],
      links: [],
      evidence: "assertion",
      body: "## Format\ncount per day\n\n## Methodology\nproduct telemetry\n\n## Rationale\nserves [[Reach 10,000 daily active users]]",
    };
    const back = deserialize(node.title, serialize(node));
    expect(back.layer).toBe("Unknown");
    expect(back.body).toContain("## Format");
    expect(back.body).toContain("## Methodology");
  });

  test("renders the #Unknown tag so Obsidian colors darkness distinctly", () => {
    const node: OstNode = {
      title: "U", layer: "Unknown", tags: [], links: [], body: "b", evidence: "assertion",
    };
    expect(serialize(node)).toContain("#Unknown");
  });
});
```

Create `test/security/unknown-layer.test.ts`. This follows the vault-building pattern every other suite uses (`initVault` + `buildPassContext`), and creates its own parent nodes so it assumes nothing about `initVault`'s second argument:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildPassContext } from "../../src/runner/context.js";
import { initVault } from "../../src/runner/init.js";
import { buildOstTools } from "../../src/security/tools.js";

const OUTCOME = "Reach 10,000 daily active users";

let dir: string;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-unknown-"));
  await initVault(dir, OUTCOME, "Retention");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function call(name: string, input: unknown): Promise<string> {
  const tools = buildOstTools(buildPassContext(dir)) as unknown as {
    name: string;
    run: (i: unknown) => Promise<string>;
  }[];
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no such tool: ${name}`);
  return tool.run(input);
}

describe("creating an Unknown", () => {
  test("darkness may attach under any layer it darkens", async () => {
    await call("ost_create_node", {
      title: "Opp", layer: "Opportunity", parent: OUTCOME, body: "b", evidence: "assertion",
    });
    await call("ost_create_node", {
      title: "Sol", layer: "Solution", parent: "Opp", body: "b", evidence: "assertion",
    });

    for (const [title, parent] of [
      ["Dark under the outcome", OUTCOME],
      ["Dark under the opportunity", "Opp"],
      ["Dark under the solution", "Sol"],
    ]) {
      const out = await call("ost_create_node", {
        title, layer: "Unknown", parent, body: "## Format\nx", evidence: "assertion",
      });
      expect(out).toContain("Unknown");
      expect(buildPassContext(dir).vault.read(title).layer).toBe("Unknown");
    }
  });

  test("an unknown still needs an evidence class like every other node", async () => {
    await expect(
      call("ost_create_node", { title: "Unrunged", layer: "Unknown", parent: OUTCOME, body: "## Format\nx" }),
    ).rejects.toThrow(/evidence class/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/ost/node.test.ts test/security/unknown-layer.test.ts`
Expected: FAIL — `node "…" has invalid or missing type: Unknown` from `deserialize`, and `cannot create layer "Unknown"` from `ost_create_node`.

- [ ] **Step 3: Add the layer**

In `src/ost/node.ts`, replace the `Layer` type and `LAYERS` array:

```typescript
export type Layer = "Outcome" | "Opportunity" | "Solution" | "AssumptionTest" | "Unknown";

export const LAYERS: readonly Layer[] = [
  "Outcome",
  "Opportunity",
  "Solution",
  "AssumptionTest",
  "Unknown",
] as const;
```

In `src/security/tools.ts`, extend `CHILD_HIERARCHY`. Darkness is not layer-bound — any node can be the one you cannot evaluate:

```typescript
const CHILD_HIERARCHY: Record<string, string[]> = {
  Opportunity: ["Outcome", "Opportunity"],
  Solution: ["Opportunity"],
  AssumptionTest: ["Solution"],
  Unknown: ["Outcome", "Opportunity", "Solution", "AssumptionTest"],
};
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — 70 files. Watch specifically for `test/eval/invariants.test.ts` and `test/mcp/next-work.test.ts`: existing hygiene rules only flag orphan `Opportunity` and `Solution` nodes, so an `Unknown` must not newly appear as an orphan. If a test fails because it enumerates `LAYERS` exhaustively, update that test to include `Unknown` — do not narrow `LAYERS`.

- [ ] **Step 5: Commit**

```bash
git add src/ost/node.ts src/security/tools.ts test/ost/node.test.ts test/security/unknown-layer.test.ts
git commit -m "feat(ost): a fifth layer for what the tree cannot see"
```

---

### Task 2: The unknown model — contract, class, resolution

Pure functions over an `OstNode`. Class is derived, never stored, so replacing the classifier in Phase 2 reclassifies the whole tree without a migration.

**Files:**
- Create: `src/knowledge/unknowns.ts`
- Test: `test/knowledge/unknowns.test.ts`

**Interfaces:**
- Consumes: `OstNode` from `src/ost/node.js` (Task 1).
- Produces:
  - `type UnknownClass = "bounded" | "unreached" | "unbounded"`
  - `type ResolutionState = "open" | "satisfied" | "abandoned"`
  - `classifyUnknown(node: OstNode): UnknownClass`
  - `resolutionState(node: OstNode): ResolutionState`
  - `contractGaps(node: OstNode): string[]`
  - `UNKNOWN_CLASSES: readonly UnknownClass[]`

- [ ] **Step 1: Write the failing test**

Create `test/knowledge/unknowns.test.ts`:

```typescript
import { describe, expect, test } from "vitest";
import { classifyUnknown, contractGaps, resolutionState } from "../../src/knowledge/unknowns.js";
import type { OstNode } from "../../src/ost/node.js";

const unknown = (body: string, extra: Partial<OstNode> = {}): OstNode => ({
  title: "U", layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const FULL = "## Format\na count\n\n## Methodology\nquery the log\n\n## Rationale\nserves [[Outcome]]";

describe("classifyUnknown", () => {
  test("a declared shape and a declared mechanism is a cabinet you can open", () => {
    expect(classifyUnknown(unknown(FULL))).toBe("bounded");
  });

  test("a known answer shape with no way to collect it is unreached", () => {
    expect(classifyUnknown(unknown("## Format\na count\n\n## Rationale\nserves [[Outcome]]"))).toBe("unreached");
  });

  test("no declarable answer shape is unbounded, whatever else is present", () => {
    expect(classifyUnknown(unknown("## Methodology\nsail west\n\n## Rationale\nserves [[Outcome]]"))).toBe("unbounded");
  });

  test("an empty body is unbounded rather than an error — the floor, like the ladder's", () => {
    expect(classifyUnknown(unknown(""))).toBe("unbounded");
  });

  test("heading match is case-insensitive but anchored to a heading, not prose", () => {
    expect(classifyUnknown(unknown("## format\nx\n\n## METHODOLOGY\ny"))).toBe("bounded");
    expect(classifyUnknown(unknown("we discussed the Format and the Methodology at length"))).toBe("unbounded");
  });
});

describe("resolutionState", () => {
  test("open by default", () => {
    expect(resolutionState(unknown(FULL))).toBe("open");
  });

  test("an ## Answer section satisfies it", () => {
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\n412 per day`))).toBe("satisfied");
  });

  test("a human moving it to validated satisfies it", () => {
    expect(resolutionState(unknown(FULL, { status: "validated" }))).toBe("satisfied");
  });

  test("deferred means abandoned — the spend that bought nothing stays visible", () => {
    expect(resolutionState(unknown(FULL, { status: "deferred" }))).toBe("abandoned");
  });

  test("abandonment wins over a stray Answer section", () => {
    expect(resolutionState(unknown(`${FULL}\n\n## Answer\nx`, { status: "deferred" }))).toBe("abandoned");
  });
});

describe("contractGaps", () => {
  test("names every missing section so a session knows what to declare", () => {
    expect(contractGaps(unknown(""))).toEqual(["Format", "Methodology", "Rationale"]);
  });

  test("a complete contract has no gaps", () => {
    expect(contractGaps(unknown(FULL))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/knowledge/unknowns.test.ts`
Expected: FAIL — cannot resolve `../../src/knowledge/unknowns.js`.

- [ ] **Step 3: Write the implementation**

Create `src/knowledge/unknowns.ts`:

```typescript
/**
 * The unknown model — what darkness declares about itself.
 *
 * An unknown carries a contract in three body sections: Format (the shape a
 * valid answer takes), Methodology (how it would be collected), Rationale
 * (which node and metric it serves). Format is the stopping condition: an
 * unknown that can state what an answer looks like knows when it is done.
 *
 * The class is DERIVED from contract completeness, never stored. That is
 * deliberate on two counts: replacing the classifier reclassifies every
 * existing node with no migration, and completeness is mechanically checkable
 * rather than a judgement about how mysterious something feels — the same
 * crudeness as `hasRecordedResult`. This classifier is one allele, shipped as
 * the v1 default and expected to lose to something with better predictive
 * power over cost-to-resolve.
 */
import type { OstNode } from "../ost/node.js";

export type UnknownClass = "bounded" | "unreached" | "unbounded";

export const UNKNOWN_CLASSES: readonly UnknownClass[] = ["bounded", "unreached", "unbounded"] as const;

export type ResolutionState = "open" | "satisfied" | "abandoned";

/** The contract's sections, in the order a session should declare them. */
const CONTRACT_SECTIONS = ["Format", "Methodology", "Rationale"] as const;

/** True when the body carries a `## <heading>` section. Anchored to a heading so prose cannot fake one. */
function hasSection(body: string, heading: string): boolean {
  return new RegExp(String.raw`^##\s+${heading}\b`, "im").test(body);
}

/** Which contract sections this unknown has not declared. */
export function contractGaps(node: OstNode): string[] {
  return CONTRACT_SECTIONS.filter((s) => !hasSection(node.body, s));
}

/**
 * Class by contract completeness:
 * - no Format          → unbounded (you cannot say what an answer looks like)
 * - Format, no Method  → unreached (you know the answer's shape; nothing emits it)
 * - both               → bounded   (open the cabinet)
 */
export function classifyUnknown(node: OstNode): UnknownClass {
  if (!hasSection(node.body, "Format")) return "unbounded";
  return hasSection(node.body, "Methodology") ? "bounded" : "unreached";
}

/**
 * Resolution is recorded, never claimed. Abandonment is checked first so that
 * a deferred unknown reads as abandoned even if an answer was drafted — the
 * human's call outranks the draft.
 */
export function resolutionState(node: OstNode): ResolutionState {
  if (node.status === "deferred") return "abandoned";
  if (node.status === "validated" || hasSection(node.body, "Answer")) return "satisfied";
  return "open";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/knowledge/unknowns.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/unknowns.ts test/knowledge/unknowns.test.ts
git commit -m "feat(knowledge): derive an unknown's class from what its contract declares"
```

---

### Task 3: The attention ledger

Append-only per-unknown JSONL, fail-open, mirroring `recordUsageEvent` exactly.

**Files:**
- Create: `src/telemetry/attention.ts`
- Test: `test/telemetry/attention.test.ts`

**Interfaces:**
- Consumes: `sanitizeTitle` from `src/ost/sanitize.js`; `ResolutionState` from `src/knowledge/unknowns.js` (Task 2).
- Produces:
  - `interface TokenTiers { input: number; output: number; cacheCreate: number; cacheRead: number }`
  - `interface AttentionEntry { ts: string; unknown: string; kind: "spend" | "resolution"; calls?: number; ms?: number; tokens?: TokenTiers; state?: ResolutionState; session?: string }`
  - `emptyTiers(): TokenTiers`
  - `addTiers(a: TokenTiers, b: TokenTiers): TokenTiers`
  - `attentionLogPath(vaultDir: string, unknown: string): string`
  - `recordAttention(vaultDir: string, entry: AttentionEntry): void`
  - `readAttention(vaultDir: string, unknown: string): AttentionEntry[]`

`TokenTiers` is defined **here** and imported by later tasks. Do not redeclare it.

- [ ] **Step 1: Write the failing test**

Create `test/telemetry/attention.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  addTiers, attentionLogPath, emptyTiers, readAttention, recordAttention,
} from "../../src/telemetry/attention.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-attention-"));

describe("the attention ledger", () => {
  test("appends entries and reads them back in order", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "2026-07-27T00:00:00Z", unknown: "U", kind: "spend", calls: 1, ms: 10 });
    recordAttention(dir, { ts: "2026-07-27T00:01:00Z", unknown: "U", kind: "resolution", state: "satisfied" });
    const entries = readAttention(dir, "U");
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("spend");
    expect(entries[1].state).toBe("satisfied");
  });

  test("never overwrites — a second write to the same unknown grows the log", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1 });
    recordAttention(dir, { ts: "b", unknown: "U", kind: "spend", calls: 1 });
    expect(readAttention(dir, "U")).toHaveLength(2);
  });

  test("keeps separate unknowns in separate logs", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "First", kind: "spend", calls: 1 });
    recordAttention(dir, { ts: "b", unknown: "Second", kind: "spend", calls: 1 });
    expect(readAttention(dir, "First")).toHaveLength(1);
    expect(readAttention(dir, "Second")).toHaveLength(1);
  });

  test("a title with path characters cannot escape the attention directory", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "../../etc/passwd", kind: "spend", calls: 1 });
    const resolved = path.resolve(attentionLogPath(dir, "../../etc/passwd"));
    expect(resolved.startsWith(path.resolve(dir, ".ost-agent", "attention"))).toBe(true);
  });

  test("reading an unknown with no ledger yields nothing rather than throwing", () => {
    expect(readAttention(tmp(), "never recorded")).toEqual([]);
  });

  test("a corrupt line is skipped, not fatal — a bad byte must not hide the rest", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 1 });
    fs.appendFileSync(attentionLogPath(dir, "U"), "{not json\n", "utf8");
    recordAttention(dir, { ts: "c", unknown: "U", kind: "spend", calls: 1 });
    expect(readAttention(dir, "U")).toHaveLength(2);
  });

  test("an unwritable vault costs an event, never a throw", () => {
    expect(() => recordAttention("/proc/nonexistent-ost", { ts: "a", unknown: "U", kind: "spend" })).not.toThrow();
  });
});

describe("token tiers", () => {
  test("stay unmixed when added", () => {
    const sum = addTiers(
      { input: 1, output: 2, cacheCreate: 3, cacheRead: 4 },
      { input: 10, output: 20, cacheCreate: 30, cacheRead: 40 },
    );
    expect(sum).toEqual({ input: 11, output: 22, cacheCreate: 33, cacheRead: 44 });
  });

  test("empty is all zeroes", () => {
    expect(emptyTiers()).toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/telemetry/attention.test.ts`
Expected: FAIL — cannot resolve `../../src/telemetry/attention.js`.

- [ ] **Step 3: Write the implementation**

Create `src/telemetry/attention.ts`:

```typescript
/**
 * The attention ledger — what an unknown cost, and what it bought.
 *
 * One append-only JSONL per unknown, beside the usage trace and health records
 * it is modelled on. Cost lives here rather than in the node body because a
 * cost line per tool call would fight the never-rewrite rule and drown the
 * prose; the node stays readable, the ledger stays machine-owned.
 *
 * Token tiers are stored UNMIXED. Cached reads are priced roughly an order of
 * magnitude below fresh input, so a summed number tracks conversation length
 * rather than attention spent — and because fitness is cost, summing early
 * would quietly select for variants that re-read context. Weighting is a read-
 * time decision (see eval/attention.ts), which keeps the cost model an allele
 * rather than an assumption baked into the store.
 *
 * Writing is fail-open, exactly as `recordUsageEvent` is: a telemetry failure
 * must cost an event, never a mutation.
 */
import fs from "node:fs";
import path from "node:path";
import type { ResolutionState } from "../knowledge/unknowns.js";
import { sanitizeTitle } from "../ost/sanitize.js";

export interface TokenTiers {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

export interface AttentionEntry {
  /** ISO timestamp. */
  ts: string;
  /** Title of the unknown this attention was spent on. */
  unknown: string;
  /** `spend` accrues cost; `resolution` records a terminal state. */
  kind: "spend" | "resolution";
  /** Tool invocations attributed to this unknown. */
  calls?: number;
  /** Wall-clock milliseconds attributed to this unknown. */
  ms?: number;
  /** Token cost, tiers kept separate. */
  tokens?: TokenTiers;
  /** Terminal state, on a `resolution` entry. */
  state?: ResolutionState;
  /** Session marker (OST_SESSION), for correlating with the usage trace. */
  session?: string;
}

export function emptyTiers(): TokenTiers {
  return { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };
}

export function addTiers(a: TokenTiers, b: TokenTiers): TokenTiers {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

/**
 * Where one unknown's ledger lives. The title is sanitized before it becomes a
 * filename, so a title carrying path separators cannot write outside the
 * attention directory.
 */
export function attentionLogPath(vaultDir: string, unknown: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "attention", `${sanitizeTitle(unknown)}.jsonl`);
}

/** Append one entry. NEVER throws. */
export function recordAttention(vaultDir: string, entry: AttentionEntry): void {
  try {
    const file = attentionLogPath(vaultDir, entry.unknown);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // fail-open: tracing is best-effort by contract
  }
}

/** Every entry recorded for one unknown, in write order. Corrupt lines are skipped. */
export function readAttention(vaultDir: string, unknown: string): AttentionEntry[] {
  const file = attentionLogPath(vaultDir, unknown);
  if (!fs.existsSync(file)) return [];
  const out: AttentionEntry[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as AttentionEntry);
    } catch {
      // a bad byte must not hide the rest of the ledger
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/telemetry/attention.test.ts`
Expected: PASS — 9 tests. If the path-escape test fails, check `sanitizeTitle`'s actual behavior in `src/ost/sanitize.ts:26` and keep the assertion (the containment property is the requirement); adjust only if `sanitizeTitle` already guarantees it by a different mechanism.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/attention.ts test/telemetry/attention.test.ts
git commit -m "feat(telemetry): an append-only ledger for what darkness costs"
```

---

### Task 4: `OST_UNKNOWN` attribution

One optional field on the trace, populated from the environment exactly as `OST_SESSION` already is.

**Files:**
- Modify: `src/telemetry/usage.ts:21-38` (`UsageEvent`), `src/telemetry/usage.ts:71-110` (`withUsageTracing`)
- Test: `test/telemetry/usage.test.ts` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `UsageEvent.unknown?: string`. Task 6 groups trace events by this field.

- [ ] **Step 1: Write the failing test**

Append to `test/telemetry/usage.test.ts`:

```typescript
describe("attribution to an unknown", () => {
  test("stamps OST_UNKNOWN onto every event so spend says what it was for", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-attr-"));
    process.env.OST_UNKNOWN = "How many users hit the export path";
    try {
      const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
      await tool.run(undefined as never);
    } finally {
      delete process.env.OST_UNKNOWN;
    }
    const events = fs.readFileSync(usageLogPath(dir), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(events[0].unknown).toBe("How many users hit the export path");
  });

  test("omits the field entirely when no unknown is being worked", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-attr-"));
    delete process.env.OST_UNKNOWN;
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
    await tool.run(undefined as never);
    const event = JSON.parse(fs.readFileSync(usageLogPath(dir), "utf8").trim());
    expect("unknown" in event).toBe(false);
  });

  test("attributes a failed call too — a wasted attempt is the point", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-attr-"));
    process.env.OST_UNKNOWN = "U";
    try {
      const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => { throw new Error("nope"); } }], dir, "mcp");
      await expect(tool.run(undefined as never)).rejects.toThrow("nope");
    } finally {
      delete process.env.OST_UNKNOWN;
    }
    const event = JSON.parse(fs.readFileSync(usageLogPath(dir), "utf8").trim());
    expect(event.ok).toBe(false);
    expect(event.unknown).toBe("U");
  });
});
```

If `test/telemetry/usage.test.ts` does not already import `fs`, `os`, `path`, `withUsageTracing`, and `usageLogPath`, add those imports at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/telemetry/usage.test.ts`
Expected: FAIL — `expected undefined to be "How many users hit the export path"`.

- [ ] **Step 3: Write the implementation**

In `src/telemetry/usage.ts`, add the field to `UsageEvent` after `session`:

```typescript
  /** Optional session/process marker (OST_SESSION env), for grouping. */
  session?: string;
  /** Which unknown this call was spent on (OST_UNKNOWN env), when one is being worked. */
  unknown?: string;
```

In `withUsageTracing`, read the marker beside the session one. Read it **per invocation**, not once at wrap time — the loop sets and clears it as it moves between unknowns, while the tool set is built once:

```typescript
export function withUsageTracing<T extends RunnableTool>(tools: T[], vaultDir: string, surface: string): T[] {
  const session = process.env.OST_SESSION || undefined;
  return tools.map((tool) => ({
    ...tool,
    run: async (input: never) => {
      const unknown = process.env.OST_UNKNOWN || undefined;
      const started = Date.now();
```

Then add `...(unknown ? { unknown } : {})` to **both** `recordUsageEvent` calls (success and failure), immediately after the existing `...(session ? { session } : {})` spread.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/telemetry/usage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telemetry/usage.ts test/telemetry/usage.test.ts
git commit -m "feat(telemetry): every call says which unknown it was spent on"
```

---

### Task 5: Token tier extraction

Claude Code session JSONL carries a `usage` object per assistant message. OST-Agent never calls the model, so this is the only place token cost exists.

**Files:**
- Create: `src/adapters/tokens.ts`
- Test: `test/adapters/tokens.test.ts`

**Interfaces:**
- Consumes: `TokenTiers`, `emptyTiers`, `addTiers` from `src/telemetry/attention.js` (Task 3). Import direction is adapters → telemetry, matching `src/adapters/usage.ts`.
- Produces:
  - `parseUsage(entry: unknown): TokenTiers | null`
  - `readSessionTokens(file: string): TokenTiers`

- [ ] **Step 1: Write the failing test**

Create `test/adapters/tokens.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { parseUsage, readSessionTokens } from "../../src/adapters/tokens.js";

const line = (usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { usage: { ...usage, server_tool_use: { web_search_requests: 0 } } } });

function sessionFile(lines: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tokens-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  return file;
}

describe("parseUsage", () => {
  test("lifts all four tiers separately", () => {
    expect(parseUsage(JSON.parse(line({
      input_tokens: 2, output_tokens: 85, cache_creation_input_tokens: 11208, cache_read_input_tokens: 22024,
    })))).toEqual({ input: 2, output: 85, cacheCreate: 11208, cacheRead: 22024 });
  });

  test("treats a missing tier as zero rather than dropping the record", () => {
    expect(parseUsage(JSON.parse(line({ input_tokens: 5, output_tokens: 6 }))))
      .toEqual({ input: 5, output: 6, cacheCreate: 0, cacheRead: 0 });
  });

  test("an entry with no usage is not a cost record", () => {
    expect(parseUsage({ type: "user", message: { content: "hi" } })).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage("nonsense")).toBeNull();
  });

  test("a non-numeric tier is read as zero, never NaN — a poisoned trace must not corrupt cost", () => {
    expect(parseUsage(JSON.parse(line({ input_tokens: "lots" as unknown as number }))))
      .toEqual({ input: 0, output: 0, cacheCreate: 0, cacheRead: 0 });
  });
});

describe("readSessionTokens", () => {
  test("sums each tier across a session, keeping them unmixed", () => {
    const file = sessionFile([
      line({ input_tokens: 1, output_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 }),
      line({ input_tokens: 2, output_tokens: 20, cache_creation_input_tokens: 200, cache_read_input_tokens: 2000 }),
    ]);
    expect(readSessionTokens(file)).toEqual({ input: 3, output: 30, cacheCreate: 300, cacheRead: 3000 });
  });

  test("skips corrupt and usage-free lines without failing the read", () => {
    const file = sessionFile(["{broken", JSON.stringify({ type: "user" }), line({ input_tokens: 7 })]);
    expect(readSessionTokens(file).input).toBe(7);
  });

  test("a missing file is zero cost, not a throw", () => {
    expect(readSessionTokens("/nonexistent/session.jsonl")).toEqual({
      input: 0, output: 0, cacheCreate: 0, cacheRead: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapters/tokens.test.ts`
Expected: FAIL — cannot resolve `../../src/adapters/tokens.js`.

- [ ] **Step 3: Write the implementation**

Create `src/adapters/tokens.ts`:

```typescript
/**
 * Token cost, read from the only place it exists.
 *
 * Since the API-key runner was deleted, OST-Agent never calls the model —
 * Claude Code does — so the tool tracer cannot see token spend at all. It is
 * carried instead in Claude Code's session JSONL, one `usage` object per
 * assistant message.
 *
 * The four tiers are lifted SEPARATELY and never summed here. Cached reads are
 * priced roughly an order of magnitude below fresh input; a single number
 * would track conversation length rather than attention, and the cost model
 * belongs at read time where it can be varied (see eval/attention.ts).
 *
 * Every parse failure degrades to zero rather than to NaN or a throw: this
 * reads a file no OST-Agent process wrote, so it is untrusted input.
 */
import fs from "node:fs";
import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";

/** A non-negative finite number, or 0. Never NaN. */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Lift one transcript entry's token usage, or null when it carries none. */
export function parseUsage(entry: unknown): TokenTiers | null {
  if (!entry || typeof entry !== "object") return null;
  const message = (entry as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const usage = (message as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;
  return {
    input: count(u.input_tokens),
    output: count(u.output_tokens),
    cacheCreate: count(u.cache_creation_input_tokens),
    cacheRead: count(u.cache_read_input_tokens),
  };
}

/** Total token cost of one session transcript, tiers kept separate. */
export function readSessionTokens(file: string): TokenTiers {
  let total = emptyTiers();
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return total;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const tiers = parseUsage(entry);
    if (tiers) total = addTiers(total, tiers);
  }
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/adapters/tokens.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/tokens.ts test/adapters/tokens.test.ts
git commit -m "feat(adapters): read token cost from the only trace that carries it"
```

---

### Task 6: The attention rollup

The read-time question: per unknown and per class, what did attention cost and what did it buy. This is the artifact Phase 3's harness will use as its fitness input.

**Files:**
- Create: `src/eval/attention.ts`
- Test: `test/eval/attention.test.ts`

**Interfaces:**
- Consumes: `OstNode`; `classifyUnknown`, `resolutionState`, `UnknownClass`, `ResolutionState` (Task 2); `TokenTiers`, `emptyTiers`, `addTiers`, `readAttention` (Task 3); `usageLogPath` from `src/telemetry/usage.js`.
- Produces:
  - `interface TokenWeights { input: number; output: number; cacheCreate: number; cacheRead: number }`
  - `DEFAULT_TOKEN_WEIGHTS: TokenWeights`
  - `weightedTokenCost(tokens: TokenTiers, weights?: TokenWeights): number`
  - `interface UnknownAttention { title: string; klass: UnknownClass; state: ResolutionState; calls: number; ms: number; tokens: TokenTiers; weightedCost: number }`
  - `interface AttentionRollup { unknowns: UnknownAttention[]; byClass: Record<UnknownClass, ClassRollup>; unattributed: { calls: number; ms: number } }`
  - `interface ClassRollup { count: number; satisfied: number; abandoned: number; open: number; weightedCost: number }`
  - `computeAttention(tree: readonly OstNode[], vaultDir: string, weights?: TokenWeights): AttentionRollup`

Note the field is `klass`, not `class` — `class` is a reserved word and cannot be a shorthand property. Use `klass` consistently.

- [ ] **Step 1: Write the failing test**

Create `test/eval/attention.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { computeAttention, DEFAULT_TOKEN_WEIGHTS, weightedTokenCost } from "../../src/eval/attention.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (title: string, body = FULL, extra: Partial<OstNode> = {}): OstNode => ({
  title, layer: "Unknown", tags: [], links: [], body, evidence: "assertion", ...extra,
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ost-rollup-"));

describe("weightedTokenCost", () => {
  test("prices a cached read far below fresh input", () => {
    const cached = weightedTokenCost({ input: 0, output: 0, cacheCreate: 0, cacheRead: 1000 });
    const fresh = weightedTokenCost({ input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 });
    expect(cached).toBeLessThan(fresh);
  });

  test("prices output above input", () => {
    const out = weightedTokenCost({ input: 0, output: 100, cacheCreate: 0, cacheRead: 0 });
    const inp = weightedTokenCost({ input: 100, output: 0, cacheCreate: 0, cacheRead: 0 });
    expect(out).toBeGreaterThan(inp);
  });

  test("honours supplied weights over the defaults", () => {
    const tiers = { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 };
    expect(weightedTokenCost(tiers, { ...DEFAULT_TOKEN_WEIGHTS, input: 2 })).toBe(20);
  });
});

describe("computeAttention", () => {
  test("classifies each unknown and totals its ledger", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "U", kind: "spend", calls: 2, ms: 50,
      tokens: { input: 100, output: 10, cacheCreate: 0, cacheRead: 0 } });
    recordAttention(dir, { ts: "b", unknown: "U", kind: "spend", calls: 1, ms: 25,
      tokens: { input: 50, output: 5, cacheCreate: 0, cacheRead: 0 } });

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unknowns).toHaveLength(1);
    expect(rollup.unknowns[0].klass).toBe("bounded");
    expect(rollup.unknowns[0].calls).toBe(3);
    expect(rollup.unknowns[0].ms).toBe(75);
    expect(rollup.unknowns[0].tokens).toEqual({ input: 150, output: 15, cacheCreate: 0, cacheRead: 0 });
    expect(rollup.unknowns[0].weightedCost).toBeGreaterThan(0);
  });

  test("ignores every layer that is not Unknown", () => {
    const rollup = computeAttention(
      [unknown("U"), { title: "S", layer: "Solution", tags: [], links: [], body: "b" }],
      tmp(),
    );
    expect(rollup.unknowns.map((u) => u.title)).toEqual(["U"]);
  });

  test("rolls counts and cost up by class", () => {
    const dir = tmp();
    recordAttention(dir, { ts: "a", unknown: "Bounded", kind: "spend", calls: 1, ms: 1,
      tokens: { input: 10, output: 0, cacheCreate: 0, cacheRead: 0 } });
    const rollup = computeAttention([
      unknown("Bounded"),
      unknown("Unreached", "## Format\nx\n\n## Rationale\ny"),
      unknown("Dark", "no sections here"),
      unknown("Done", FULL, { status: "validated" }),
      unknown("Given up", FULL, { status: "deferred" }),
    ], dir);

    expect(rollup.byClass.bounded.count).toBe(3);
    expect(rollup.byClass.bounded.satisfied).toBe(1);
    expect(rollup.byClass.bounded.abandoned).toBe(1);
    expect(rollup.byClass.bounded.open).toBe(1);
    expect(rollup.byClass.unreached.count).toBe(1);
    expect(rollup.byClass.unbounded.count).toBe(1);
    expect(rollup.byClass.bounded.weightedCost).toBeGreaterThan(0);
  });

  test("an unknown with no ledger costs zero rather than being omitted", () => {
    const rollup = computeAttention([unknown("Never worked")], tmp());
    expect(rollup.unknowns[0].calls).toBe(0);
    expect(rollup.unknowns[0].weightedCost).toBe(0);
  });

  test("reports unattributed spend — a variant that cannot say what it spent on is measurably worse", () => {
    const dir = tmp();
    fs.mkdirSync(path.dirname(usageLogPath(dir)), { recursive: true });
    fs.writeFileSync(usageLogPath(dir), [
      JSON.stringify({ ts: "a", tool: "ost_read_tree", ok: true, ms: 5, surface: "mcp", argBytes: 0 }),
      JSON.stringify({ ts: "b", tool: "ost_read_tree", ok: true, ms: 7, surface: "mcp", argBytes: 0, unknown: "U" }),
    ].join("\n"), "utf8");

    const rollup = computeAttention([unknown("U")], dir);
    expect(rollup.unattributed.calls).toBe(1);
    expect(rollup.unattributed.ms).toBe(5);
  });

  test("a vault with no usage log reports no unattributed spend rather than throwing", () => {
    expect(computeAttention([unknown("U")], tmp()).unattributed).toEqual({ calls: 0, ms: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/eval/attention.test.ts`
Expected: FAIL — cannot resolve `../../src/eval/attention.js`.

- [ ] **Step 3: Write the implementation**

Create `src/eval/attention.ts`:

```typescript
/**
 * The attention rollup — what darkness cost, and what it bought.
 *
 * Deterministic and read-only, like the rest of `eval/`: no model, no writes.
 * It answers one question per unknown and per class — how much attention was
 * spent, and did it terminate — which is the question a session needs to
 * decide where to look next, and the same question a selection harness needs
 * as fitness input. One instrument, two altitudes.
 *
 * The token weighting lives here rather than in the store on purpose. Summing
 * tiers at write time would bake in a cost model; here it is a parameter, and
 * in Phase 2 it becomes an allele of the genome rather than a constant.
 */
import { classifyUnknown, resolutionState, UNKNOWN_CLASSES, type ResolutionState, type UnknownClass } from "../knowledge/unknowns.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";
import fs from "node:fs";

export interface TokenWeights {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

/**
 * Relative cost per tier, tracking published pricing ratios: output is the
 * dear one, a cache write costs a little more than fresh input, and a cache
 * read is roughly a tenth. These are ratios, not currency.
 */
export const DEFAULT_TOKEN_WEIGHTS: TokenWeights = {
  input: 1,
  output: 5,
  cacheCreate: 1.25,
  cacheRead: 0.1,
};

export function weightedTokenCost(tokens: TokenTiers, weights: TokenWeights = DEFAULT_TOKEN_WEIGHTS): number {
  return (
    tokens.input * weights.input +
    tokens.output * weights.output +
    tokens.cacheCreate * weights.cacheCreate +
    tokens.cacheRead * weights.cacheRead
  );
}

export interface UnknownAttention {
  title: string;
  /** `class` is reserved; the derived class is carried as `klass`. */
  klass: UnknownClass;
  state: ResolutionState;
  calls: number;
  ms: number;
  tokens: TokenTiers;
  weightedCost: number;
}

export interface ClassRollup {
  count: number;
  satisfied: number;
  abandoned: number;
  open: number;
  weightedCost: number;
}

export interface AttentionRollup {
  unknowns: UnknownAttention[];
  byClass: Record<UnknownClass, ClassRollup>;
  /** Spend the trace could not attribute to any unknown. */
  unattributed: { calls: number; ms: number };
}

/** Tool calls in the usage trace that carry no `unknown` attribution. */
function unattributedSpend(vaultDir: string): { calls: number; ms: number } {
  const file = usageLogPath(vaultDir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return { calls: 0, ms: 0 };
  }
  let calls = 0;
  let ms = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { unknown?: string; ms?: number };
      if (event.unknown) continue;
      calls++;
      ms += typeof event.ms === "number" && Number.isFinite(event.ms) ? event.ms : 0;
    } catch {
      // a corrupt trace line is not attributable either way
    }
  }
  return { calls, ms };
}

function emptyByClass(): Record<UnknownClass, ClassRollup> {
  return Object.fromEntries(
    UNKNOWN_CLASSES.map((c) => [c, { count: 0, satisfied: 0, abandoned: 0, open: 0, weightedCost: 0 }]),
  ) as Record<UnknownClass, ClassRollup>;
}

/** Per-unknown and per-class attention across the tree in `vaultDir`. */
export function computeAttention(
  tree: readonly OstNode[],
  vaultDir: string,
  weights: TokenWeights = DEFAULT_TOKEN_WEIGHTS,
): AttentionRollup {
  const unknowns: UnknownAttention[] = tree
    .filter((n) => n.layer === "Unknown")
    .map((node) => {
      let calls = 0;
      let ms = 0;
      let tokens = emptyTiers();
      for (const entry of readAttention(vaultDir, node.title)) {
        if (entry.kind !== "spend") continue;
        calls += entry.calls ?? 0;
        ms += entry.ms ?? 0;
        if (entry.tokens) tokens = addTiers(tokens, entry.tokens);
      }
      return {
        title: node.title,
        klass: classifyUnknown(node),
        state: resolutionState(node),
        calls,
        ms,
        tokens,
        weightedCost: weightedTokenCost(tokens, weights),
      };
    });

  const byClass = emptyByClass();
  for (const u of unknowns) {
    const bucket = byClass[u.klass];
    bucket.count++;
    bucket.weightedCost += u.weightedCost;
    if (u.state === "satisfied") bucket.satisfied++;
    else if (u.state === "abandoned") bucket.abandoned++;
    else bucket.open++;
  }

  return { unknowns, byClass, unattributed: unattributedSpend(vaultDir) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/eval/attention.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/eval/attention.ts test/eval/attention.test.ts
git commit -m "feat(eval): roll attention up per unknown and per class"
```

---

### Task 7: Surface open unknowns in `ost_next_work`

The behavior change that delivers the headline: uncertainty becomes something the tree can offer as work.

**Critical design constraint:** open unknowns are **reported but do not block `done`.** An unbounded unknown has no stopping condition by construction, so counting it toward completion would wedge every pass forever — the "sails and never returns" failure. `done` continues to mean *maintenance* is complete. Exploration is discretionary and budget-governed.

**Files:**
- Modify: `src/mcp/next-work.ts` (`NextWork` interface, `computeNextWork`)
- Test: `test/mcp/next-work.test.ts` (append)

**Interfaces:**
- Consumes: `classifyUnknown`, `resolutionState` (Task 2).
- Produces: `NextWork.openUnknowns: OpenUnknown[]` where `interface OpenUnknown { title: string; klass: UnknownClass; darkens: string | null; gaps: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp/next-work.test.ts`. The file already has a `beforeEach` creating `dir` via `initVault(dir, "Reach 10,000 daily active users", "Retention")`, and imports `buildPassContext` and `computeNextWork` — reuse them. Add this block:

```typescript
describe("open unknowns", () => {
  const CONTRACT = "## Format\na count per day\n\n## Rationale\nserves [[Retention]]";

  /** Attach an Unknown under the opportunity `initVault` creates, and return fresh work. */
  function withUnknown(body: string, status?: "validated" | "deferred") {
    const ctx = buildPassContext(dir);
    ctx.vault.createNode({
      title: "How many users hit the export path",
      layer: "Unknown",
      body,
      tags: [],
      links: [],
      evidence: "assertion",
      ...(status ? { status } : {}),
    });
    ctx.vault.linkNodes("Retention", "How many users hit the export path");
    return computeNextWork(buildPassContext(dir).vault, dir, 1);
  }

  test("surfaces an open unknown with its class, what it darkens, and its gaps", () => {
    const work = withUnknown(CONTRACT);
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].title).toBe("How many users hit the export path");
    expect(work.openUnknowns[0].klass).toBe("unreached");
    expect(work.openUnknowns[0].darkens).toBe("Retention");
    expect(work.openUnknowns[0].gaps).toEqual(["Methodology"]);
  });

  test("a satisfied unknown is no longer offered as work", () => {
    expect(withUnknown(`${CONTRACT}\n\n## Answer\n412 per day`).openUnknowns).toHaveLength(0);
  });

  test("an abandoned unknown is no longer offered as work", () => {
    expect(withUnknown(CONTRACT, "deferred").openUnknowns).toHaveLength(0);
  });

  test("an open unknown does NOT block done — an unbounded one would wedge the loop forever", () => {
    const work = withUnknown("nothing declared at all");
    expect(work.openUnknowns).toHaveLength(1);
    expect(work.openUnknowns[0].klass).toBe("unbounded");
    // A freshly-initialized vault has no outstanding maintenance at min=1.
    expect(work.unmappedEvidence).toHaveLength(0);
    expect(work.hygieneIssues).toHaveLength(0);
    expect(work.done).toBe(true);
  });

  test("the summary names outstanding darkness even when maintenance is done", () => {
    expect(withUnknown(CONTRACT).summary).toContain("unknown");
  });

  test("an Unknown is never counted as a solution missing assumptions", () => {
    const work = withUnknown(CONTRACT);
    expect(work.solutionsMissingAssumptions.map((s) => s.title))
      .not.toContain("How many users hit the export path");
  });
});
```

**If `initVault`'s third argument does not produce a node titled `Retention`,** check what `initVault` actually creates (`src/runner/init.js`) and substitute the real title in both `linkNodes` and the `darkens` assertion. Do not change the assertion's intent — `darkens` must name the parent node.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/mcp/next-work.test.ts`
Expected: FAIL — `openUnknowns` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/mcp/next-work.ts`, add the import:

```typescript
import { classifyUnknown, contractGaps, resolutionState, type UnknownClass } from "../knowledge/unknowns.js";
```

Add the interface beside the other work shapes:

```typescript
export interface OpenUnknown {
  title: string;
  /** Derived class; `class` is reserved. */
  klass: UnknownClass;
  /** The node this darkness attaches under, when it has a parent. */
  darkens: string | null;
  /** Contract sections not yet declared — what to write to make it actionable. */
  gaps: string[];
}
```

Add the field to `NextWork`, documented as non-blocking:

```typescript
  /** Structural issues that should be annotated (never auto-fixed). */
  hygieneIssues: HygieneIssue[];
  /**
   * Darkness the tree has declared and not yet resolved. Reported as available
   * work but deliberately NOT part of `done`: an unbounded unknown has no
   * stopping condition, so counting it toward completion would wedge every
   * pass forever. `done` means maintenance is complete; exploration is
   * discretionary and budget-governed.
   */
  openUnknowns: OpenUnknown[];
```

In `computeNextWork`, after `hygieneIssues` is computed:

```typescript
  const openUnknowns: OpenUnknown[] = tree
    .filter((n) => n.layer === "Unknown" && resolutionState(n) === "open")
    .map((u) => ({
      title: u.title,
      klass: classifyUnknown(u),
      darkens: tree.find((p) => p.layer !== "Unknown" && p.links.includes(u.title))?.title ?? null,
      gaps: contractGaps(u),
    }));
```

Leave the `done` expression exactly as it is. Append to the summary so darkness is legible either way — insert immediately before the `const summary = …` line:

```typescript
  if (openUnknowns.length) parts.push(`${openUnknowns.length} open unknown(s) → explore (does not block done)`);
```

Return `openUnknowns` in the result object.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — every file. `computeNextWork`'s result gained a field; check `test/mcp/next-work.test.ts` and `test/mcp/analysis-tools.test.ts` for any exact-shape (`toEqual` on the whole object) assertion and extend it rather than loosening it.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/next-work.ts test/mcp/next-work.test.ts
git commit -m "feat(mcp): the tree can offer darkness as work"
```

---

## Verification

After Task 7, confirm the whole phase:

- [ ] `npm test` — all files pass; total is 543 plus the ~50 added here.
- [ ] `npm run build` — clean TypeScript compile with no new errors.
- [ ] `node -e "const {ALLOWED_TOOL_NAMES}=require('./dist/security/policy.js');console.log(ALLOWED_TOOL_NAMES.length)"` — unchanged from before this plan. **The allowlist must not have grown.**

## Out of scope for Phase 1

- The genome (Phase 2). `DEFAULT_TOKEN_WEIGHTS` and the classifier stay TypeScript constants for now; Phase 2 moves them into declarative data. They are written as parameters, not hard-coded call sites, so that move is mechanical.
- The harness, environments, and selection (Phases 3–4).
- Wiring `OST_UNKNOWN` into the loop ruleset — Phase 1 makes attribution *possible*; the loop learning to set it belongs with the phase that spends against a budget.
- Any new MCP tool. Unknowns are created, linked, and resolved entirely through the existing surface.
