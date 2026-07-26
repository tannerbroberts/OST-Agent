# SQL Evidence Reads (Railway Postgres) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only `ost_read_evidence_sql` MCP tool so the OST-agent can pull evidence (funnel metrics, play counts) from the production Postgres on Railway via SQL, without ever being able to mutate it.

**Architecture:** A pure SQL shape-guard (`src/evidence/sql-guard.ts`) rejects anything but a single `SELECT`/`WITH` statement; an executor (`src/evidence/sql-reader.ts`) runs the validated statement inside a `READ ONLY` transaction with a statement timeout, row cap, and response-size cap, against an injected pool interface (real `pg.Pool` in production, fakes in tests). The tool is registered through every existing security gate deliberately: `ALLOWED_TOOL_NAMES`, `buildOstTools`, `MCP_TOOL_NAMES`, the `READ_ONLY` (no-commit) set, and the generated SKILL.md. Database-level enforcement (a `SELECT`-only `ost_reader` role) is the real guard; the code guards are defense-in-depth.

**Tech Stack:** TypeScript (strict, ESM — relative imports end in `.js`), Node >= 20, vitest, `pg` ^8 (new dependency), `@modelcontextprotocol/sdk`.

## Global Constraints

- ESM project: every relative import ends in `.js` (e.g. `from "./sql-guard.js"`), including in tests.
- The new tool's exact name is `ost_read_evidence_sql` everywhere (allowlist, MCP surface, skill doc, tests).
- The tool is READ-ONLY: it must appear in `src/mcp/server.ts`'s `READ_ONLY` set so calls never auto-commit.
- Connection URLs / credentials must never appear in any tool result, error message, or log line.
- The env var name is exactly `OST_EVIDENCE_DB_URL`.
- The guard errs fail-closed: when statement shape is ambiguous, reject. Over-rejection is acceptable; a write slipping through the guard is not (the `READ ONLY` transaction and DB role still stop it).
- Do not add the new tool to any pass process (P1–P5) tool list; it is exposed on the MCP surface only. Autonomous passes stay hermetic.
- Do not bump `package.json` version; releasing is a separate human-run process (RELEASING.md).
- Run tests with `npx vitest run <file>` for a single file, `npm test` for the suite.
- Commit messages follow repo style: lowercase, imperative, no scope prefix ceremony (see `git log --oneline`).

---

### Task 1: SQL shape guard

**Files:**
- Create: `src/evidence/sql-guard.ts`
- Test: `test/evidence/sql-guard.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, zero deps).
- Produces: `maskSqlLiterals(sql: string): string` and `assertReadOnlySql(sql: string): string` — Task 2's executor calls `assertReadOnlySql` and uses its return value as the statement to execute. It returns the trimmed statement (trailing semicolon removed) or throws `Error` with a human-readable reason.

- [ ] **Step 1: Write the failing test**

```typescript
// test/evidence/sql-guard.test.ts
import { describe, expect, test } from "vitest";
import { assertReadOnlySql, maskSqlLiterals } from "../../src/evidence/sql-guard.js";

describe("maskSqlLiterals", () => {
  test("masks string literal contents but preserves length and structure", () => {
    const sql = "SELECT 'a;b' FROM t";
    const masked = maskSqlLiterals(sql);
    expect(masked.length).toBe(sql.length);
    expect(masked).not.toContain("a;b");
    expect(masked).toContain("SELECT");
    expect(masked).toContain("FROM t");
  });

  test("masks line and block comments (including nested blocks)", () => {
    const masked = maskSqlLiterals("SELECT 1 -- drop table x\n/* outer /* inner */ still */ FROM t");
    expect(masked).not.toContain("drop table");
    expect(masked).not.toContain("inner");
    expect(masked).toContain("FROM t");
  });

  test("masks dollar-quoted strings", () => {
    const masked = maskSqlLiterals("SELECT $tag$; DROP TABLE x$tag$");
    expect(masked).not.toContain("DROP");
  });

  test("masks double-quoted identifier contents", () => {
    const masked = maskSqlLiterals('SELECT ";" FROM t');
    expect(masked.includes('";"')).toBe(false);
    expect(masked).toContain("FROM t");
  });

  test("throws on unterminated string / comment / dollar-quote", () => {
    expect(() => maskSqlLiterals("SELECT 'abc")).toThrow(/unterminated/i);
    expect(() => maskSqlLiterals("SELECT 1 /* abc")).toThrow(/unterminated/i);
    expect(() => maskSqlLiterals("SELECT $x$ abc")).toThrow(/unterminated/i);
  });
});

describe("assertReadOnlySql", () => {
  test("accepts a plain SELECT and returns it trimmed", () => {
    expect(assertReadOnlySql("  SELECT id, played_at FROM plays  ")).toBe("SELECT id, played_at FROM plays");
  });

  test("accepts WITH (CTE) queries", () => {
    const sql = "WITH d AS (SELECT 1 AS n) SELECT n FROM d";
    expect(assertReadOnlySql(sql)).toBe(sql);
  });

  test("accepts one trailing semicolon and strips it", () => {
    expect(assertReadOnlySql("SELECT 1;")).toBe("SELECT 1");
    expect(assertReadOnlySql("SELECT 1; \n")).toBe("SELECT 1");
  });

  test("accepts leading comments before the keyword", () => {
    expect(assertReadOnlySql("-- daily plays\nSELECT count(*) FROM plays")).toBe(
      "-- daily plays\nSELECT count(*) FROM plays",
    );
  });

  test("rejects every non-SELECT statement type", () => {
    for (const bad of [
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "DROP TABLE t",
      "TRUNCATE t",
      "CREATE TABLE t (a int)",
      "ALTER TABLE t ADD b int",
      "GRANT SELECT ON t TO x",
      "COPY t FROM '/tmp/x'",
      "EXPLAIN SELECT 1",
      "VACUUM",
    ]) {
      expect(() => assertReadOnlySql(bad), bad).toThrow(/only SELECT/i);
    }
  });

  test("rejects multiple statements", () => {
    expect(() => assertReadOnlySql("SELECT 1; DROP TABLE plays")).toThrow(/one SQL statement/i);
    expect(() => assertReadOnlySql("SELECT 1;;")).toThrow(/one SQL statement/i);
  });

  test("semicolons hidden in literals do not count as separators", () => {
    expect(assertReadOnlySql("SELECT 'a;b' AS x")).toBe("SELECT 'a;b' AS x");
    expect(assertReadOnlySql("SELECT $q$;$q$ AS x")).toBe("SELECT $q$;$q$ AS x");
  });

  test("rejects SELECT INTO (creates a table)", () => {
    expect(() => assertReadOnlySql("SELECT * INTO backup FROM plays")).toThrow(/INTO/i);
  });

  test("allows the word into inside a string literal", () => {
    expect(assertReadOnlySql("SELECT 'into the void' AS x")).toBe("SELECT 'into the void' AS x");
  });

  test("rejects empty and comment-only input", () => {
    expect(() => assertReadOnlySql("")).toThrow(/empty/i);
    expect(() => assertReadOnlySql("   ")).toThrow(/empty/i);
    expect(() => assertReadOnlySql("-- just a comment")).toThrow(/empty/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/evidence/sql-guard.test.ts`
Expected: FAIL — cannot resolve `src/evidence/sql-guard.js`.

- [ ] **Step 3: Implement the guard**

```typescript
// src/evidence/sql-guard.ts
/**
 * Shape guard for evidence SQL: admits exactly one SELECT/WITH statement.
 *
 * Defense-in-depth only — the real write-protection is the READ ONLY
 * transaction (sql-reader.ts) and the SELECT-only database role. This guard
 * errs fail-closed: ambiguous input is rejected, never given the benefit of
 * the doubt. Masking replaces literal/comment CONTENTS with spaces while
 * preserving length, so structural checks (semicolons, keywords) share
 * indices with the raw text and cannot be fooled by quoted payloads.
 */

/** Replace the contents of strings, quoted identifiers, and comments with spaces (length-preserving). */
export function maskSqlLiterals(sql: string): string {
  const out = sql.split("");
  const n = sql.length;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];
    if (c === "-" && d === "-") {
      const nl = sql.indexOf("\n", i);
      const stop = nl === -1 ? n : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && d === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") { depth++; j += 2; }
        else if (sql[j] === "*" && sql[j + 1] === "/") { depth--; j += 2; }
        else j++;
      }
      if (depth > 0) throw new Error("unterminated block comment");
      blank(i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= n) throw new Error(`unterminated ${c === "'" ? "string literal" : "quoted identifier"}`);
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; } // '' / "" escape
          j++;
          break;
        }
        j++;
      }
      blank(i + 1, j - 1);
      i = j;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close === -1) throw new Error("unterminated dollar-quoted string");
        blank(i + tag.length, close);
        i = close + tag.length;
        continue;
      }
    }
    i++;
  }
  return out.join("");
}

/**
 * Validate that `sql` is a single read-only statement; return it trimmed
 * (one trailing semicolon removed) ready to execute, or throw.
 */
export function assertReadOnlySql(sql: string): string {
  const masked = maskSqlLiterals(sql);
  let start = 0;
  let end = masked.length;
  while (start < end && /\s/.test(masked[start])) start++;
  while (end > start && /\s/.test(masked[end - 1])) end--;
  if (start >= end) throw new Error("SQL is empty (or contains only comments)");
  if (masked[end - 1] === ";") {
    end--;
    while (end > start && /\s/.test(masked[end - 1])) end--;
    if (start >= end) throw new Error("SQL is empty (or contains only comments)");
  }
  const body = masked.slice(start, end);
  if (body.includes(";")) throw new Error("exactly one SQL statement is allowed");
  const kw = /[A-Za-z]+/.exec(body)?.[0]?.toUpperCase();
  if (kw !== "SELECT" && kw !== "WITH") {
    throw new Error(`only SELECT/WITH queries are allowed here (statement starts with ${kw ?? "nothing"})`);
  }
  if (/\bINTO\b/i.test(body)) {
    throw new Error("SELECT ... INTO creates a table — not allowed on the evidence surface");
  }
  return sql.slice(start, end).trim();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/evidence/sql-guard.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/evidence/sql-guard.ts test/evidence/sql-guard.test.ts
git commit -m "evidence: add fail-closed shape guard admitting one SELECT/WITH statement"
```

---

### Task 2: Read-only query executor

**Files:**
- Create: `src/evidence/sql-reader.ts`
- Test: `test/evidence/sql-reader.test.ts`
- Modify: `package.json` (add `pg` dependency, `@types/pg` dev dependency — via `npm install`)

**Interfaces:**
- Consumes: `assertReadOnlySql` from `src/evidence/sql-guard.js` (Task 1).
- Produces (Task 3 depends on these exact names):
  - `interface SqlPoolClient { query(text: string): Promise<{ rows: unknown[] }>; release(): void }`
  - `interface SqlPool { connect(): Promise<SqlPoolClient> }`
  - `interface EvidenceQueryResult { query: string; executedAt: string; rowCount: number; truncated: boolean; rows: unknown[] }`
  - `runEvidenceQuery(pool: SqlPool, sql: string, opts?: { maxRows?: number }): Promise<EvidenceQueryResult>`
  - `createEvidencePool(url: string): SqlPool`
  - constants `DEFAULT_MAX_ROWS = 200`, `MAX_MAX_ROWS = 1000`, `STATEMENT_TIMEOUT_MS = 10_000`, `MAX_RESPONSE_CHARS = 100_000`

- [ ] **Step 1: Install the dependency**

Run: `npm install pg && npm install -D @types/pg`
Expected: both appear in `package.json`; lockfile updated.

- [ ] **Step 2: Write the failing test**

```typescript
// test/evidence/sql-reader.test.ts
import { describe, expect, test } from "vitest";
import {
  DEFAULT_MAX_ROWS,
  MAX_RESPONSE_CHARS,
  runEvidenceQuery,
  STATEMENT_TIMEOUT_MS,
  type SqlPool,
  type SqlPoolClient,
} from "../../src/evidence/sql-reader.js";

class FakeClient implements SqlPoolClient {
  calls: string[] = [];
  released = false;
  constructor(
    private rows: unknown[],
    private failOn?: string,
  ) {}
  async query(text: string): Promise<{ rows: unknown[] }> {
    this.calls.push(text);
    if (this.failOn && text.includes(this.failOn)) throw new Error(`boom on ${this.failOn}`);
    if (/^(BEGIN|SET|ROLLBACK)/.test(text)) return { rows: [] };
    return { rows: this.rows };
  }
  release(): void {
    this.released = true;
  }
}

class FakePool implements SqlPool {
  connects = 0;
  constructor(public client: FakeClient) {}
  async connect(): Promise<SqlPoolClient> {
    this.connects++;
    return this.client;
  }
}

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

describe("runEvidenceQuery", () => {
  test("wraps the statement in a READ ONLY transaction with a local statement timeout, then rolls back", async () => {
    const client = new FakeClient(rowsOf(3));
    const result = await runEvidenceQuery(new FakePool(client), "SELECT id FROM plays");
    expect(client.calls).toEqual([
      "BEGIN TRANSACTION READ ONLY",
      `SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`,
      "SELECT id FROM plays",
      "ROLLBACK",
    ]);
    expect(client.released).toBe(true);
    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.rows).toEqual(rowsOf(3));
    expect(result.query).toBe("SELECT id FROM plays");
    expect(new Date(result.executedAt).getTime()).not.toBeNaN();
  });

  test("rejects invalid SQL before ever touching the pool", async () => {
    const pool = new FakePool(new FakeClient([]));
    await expect(runEvidenceQuery(pool, "DROP TABLE plays")).rejects.toThrow(/only SELECT/i);
    expect(pool.connects).toBe(0);
  });

  test("rolls back and releases even when the statement fails", async () => {
    const client = new FakeClient([], "SELECT");
    await expect(runEvidenceQuery(new FakePool(client), "SELECT 1")).rejects.toThrow(/boom/);
    expect(client.calls[client.calls.length - 1]).toBe("ROLLBACK");
    expect(client.released).toBe(true);
  });

  test("caps rows at DEFAULT_MAX_ROWS and reports truncation with the full count", async () => {
    const client = new FakeClient(rowsOf(DEFAULT_MAX_ROWS + 50));
    const result = await runEvidenceQuery(new FakePool(client), "SELECT id FROM plays");
    expect(result.rows).toHaveLength(DEFAULT_MAX_ROWS);
    expect(result.rowCount).toBe(DEFAULT_MAX_ROWS + 50);
    expect(result.truncated).toBe(true);
  });

  test("honors a smaller maxRows and clamps an absurd one", async () => {
    const client = new FakeClient(rowsOf(50));
    const small = await runEvidenceQuery(new FakePool(client), "SELECT 1", { maxRows: 5 });
    expect(small.rows).toHaveLength(5);
    const clamped = await runEvidenceQuery(new FakePool(new FakeClient(rowsOf(2000))), "SELECT 1", {
      maxRows: 999999,
    });
    expect(clamped.rows.length).toBeLessThanOrEqual(1000);
  });

  test("shrinks the row set to fit the response-size cap", async () => {
    const bigRows = Array.from({ length: 100 }, (_, i) => ({ i, blob: "x".repeat(5000) }));
    const result = await runEvidenceQuery(new FakePool(new FakeClient(bigRows)), "SELECT 1");
    expect(JSON.stringify(result.rows).length).toBeLessThanOrEqual(MAX_RESPONSE_CHARS);
    expect(result.truncated).toBe(true);
    expect(result.rows.length).toBeGreaterThan(0);
  });

  test("throws a clear error when a single row exceeds the size cap", async () => {
    const huge = [{ blob: "x".repeat(MAX_RESPONSE_CHARS + 1) }];
    await expect(runEvidenceQuery(new FakePool(new FakeClient(huge)), "SELECT 1")).rejects.toThrow(
      /fewer|smaller columns/i,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/evidence/sql-reader.test.ts`
Expected: FAIL — cannot resolve `src/evidence/sql-reader.js`.

- [ ] **Step 4: Implement the executor**

```typescript
// src/evidence/sql-reader.ts
/**
 * Read-only evidence query executor.
 *
 * Belt-and-suspenders on top of the SELECT-only database role:
 *  - assertReadOnlySql rejects anything but one SELECT/WITH statement
 *  - the statement runs inside BEGIN TRANSACTION READ ONLY (Postgres refuses
 *    writes even if something slipped the guard)
 *  - SET LOCAL statement_timeout bounds runaway queries
 *  - the transaction is always ROLLBACKed — nothing this module does can commit
 *  - row and response-size caps keep results MCP-sized
 *
 * The pool is an interface so tests inject fakes; production uses pg.Pool via
 * createEvidencePool. Connection URLs must never appear in errors or results.
 */
import pg from "pg";
import { assertReadOnlySql } from "./sql-guard.js";

export interface SqlPoolClient {
  query(text: string): Promise<{ rows: unknown[] }>;
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlPoolClient>;
}

export interface EvidenceQueryResult {
  query: string;
  executedAt: string;
  /** Total rows the query produced (before truncation). */
  rowCount: number;
  truncated: boolean;
  rows: unknown[];
}

export const DEFAULT_MAX_ROWS = 200;
export const MAX_MAX_ROWS = 1000;
export const STATEMENT_TIMEOUT_MS = 10_000;
export const MAX_RESPONSE_CHARS = 100_000;

export async function runEvidenceQuery(
  pool: SqlPool,
  sql: string,
  opts?: { maxRows?: number },
): Promise<EvidenceQueryResult> {
  const statement = assertReadOnlySql(sql); // validate before consuming a connection
  const maxRows = Math.max(1, Math.min(opts?.maxRows ?? DEFAULT_MAX_ROWS, MAX_MAX_ROWS));

  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const res = await client.query(statement);
    let rows = res.rows.slice(0, maxRows);
    while (JSON.stringify(rows).length > MAX_RESPONSE_CHARS) {
      if (rows.length <= 1) {
        throw new Error(
          `a single row exceeds the ${MAX_RESPONSE_CHARS}-char response cap — select fewer or smaller columns`,
        );
      }
      rows = rows.slice(0, Math.floor(rows.length / 2));
    }
    return {
      query: statement,
      executedAt: new Date().toISOString(),
      rowCount: res.rows.length,
      truncated: rows.length < res.rows.length,
      rows,
    };
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the connection may already be dead; releasing is all that's left
    }
    client.release();
  }
}

/** Production pool: small, lazy, URL never re-exposed. */
export function createEvidencePool(url: string): SqlPool {
  return new pg.Pool({ connectionString: url, max: 2 }) as unknown as SqlPool;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/evidence/sql-reader.test.ts`
Expected: PASS (all tests). Also run `npx vitest run test/evidence/` to confirm Task 1 still passes.

- [ ] **Step 6: Commit**

```bash
git add src/evidence/sql-reader.ts test/evidence/sql-reader.test.ts package.json package-lock.json
git commit -m "evidence: read-only executor — READ ONLY txn, timeout, row and size caps"
```

---

### Task 3: Register the tool through the security gates

**Files:**
- Modify: `src/security/policy.ts` (add name to `ALLOWED_TOOL_NAMES`)
- Modify: `src/security/tools.ts` (add tool to `buildOstTools`; extend `ToolContext`)
- Modify: `test/security/policy.test.ts` (allowlist count 10 → 11; `buildOstTools` count; new name in expected lists)
- Create: `test/evidence/tool.test.ts`

**Interfaces:**
- Consumes: `runEvidenceQuery`, `createEvidencePool`, `SqlPool`, `DEFAULT_MAX_ROWS`, `MAX_MAX_ROWS` from `src/evidence/sql-reader.js` (Task 2).
- Produces: `ToolContext` gains an optional field `evidenceDb?: { url?: string; pool?: SqlPool }` (pool wins over url; url is lazily turned into a pool on first call). Task 4 passes this through from `PassContext`. Tool name `ost_read_evidence_sql` is now on `ALLOWED_TOOL_NAMES`.

- [ ] **Step 1: Write the failing tests**

Add to `test/security/policy.test.ts`: in the `"the allowlist is exactly the 10 expected tools"` test, rename it to `"the allowlist is exactly the 11 expected tools"` and add `"ost_read_evidence_sql"` to the expected array. In the `isDestructiveToolName` test add:

```typescript
    expect(isDestructiveToolName("ost_read_evidence_sql")).toBe(false);
```

In the `buildOstTools` describe block, update the exact-count test (currently "EXACTLY the 8") to include `ost_read_evidence_sql` in its expected names and bump its count by one.

Create `test/evidence/tool.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { Vault } from "../../src/ost/vault.js";
import type { SqlPool, SqlPoolClient } from "../../src/evidence/sql-reader.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-evidence-tool-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakePool(rows: unknown[]): SqlPool {
  const client: SqlPoolClient = {
    async query(text: string) {
      return /^(BEGIN|SET|ROLLBACK)/.test(text) ? { rows: [] } : { rows };
    },
    release() {},
  };
  return { async connect() { return client; } };
}

function toolWith(ctx: Partial<ToolContext>) {
  const built = buildOstTools(
    { vault: new Vault(dir), dir, remote: { enabled: false }, ...ctx },
    ["ost_read_evidence_sql"],
  ) as unknown as Array<{ name: string; run: (i: unknown) => Promise<unknown> }>;
  const tool = built.find((t) => t.name === "ost_read_evidence_sql");
  if (!tool) throw new Error("ost_read_evidence_sql not built");
  return tool;
}

describe("ost_read_evidence_sql tool", () => {
  test("runs a query through an injected pool and returns provenance-stamped JSON", async () => {
    const tool = toolWith({ evidenceDb: { pool: fakePool([{ plays: 42 }]) } });
    const out = JSON.parse((await tool.run({ sql: "SELECT count(*) AS plays FROM plays" })) as string);
    expect(out.rows).toEqual([{ plays: 42 }]);
    expect(out.rowCount).toBe(1);
    expect(out.query).toBe("SELECT count(*) AS plays FROM plays");
    expect(out.executedAt).toBeTruthy();
  });

  test("fails with setup guidance when no evidence database is configured", async () => {
    const tool = toolWith({});
    await expect(tool.run({ sql: "SELECT 1" })).rejects.toThrow(/OST_EVIDENCE_DB_URL/);
  });

  test("rejects non-SELECT SQL", async () => {
    const tool = toolWith({ evidenceDb: { pool: fakePool([]) } });
    await expect(tool.run({ sql: "DELETE FROM plays" })).rejects.toThrow(/only SELECT/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/evidence/tool.test.ts test/security/policy.test.ts`
Expected: FAIL — tool not built, allowlist count mismatch.

- [ ] **Step 3: Implement**

In `src/security/policy.ts`, add to `ALLOWED_TOOL_NAMES` (after `"ost_annotate"`):

```typescript
  "ost_read_evidence_sql",
```

In `src/security/tools.ts`:

1. Add imports:

```typescript
import {
  createEvidencePool,
  runEvidenceQuery,
  DEFAULT_MAX_ROWS,
  MAX_MAX_ROWS,
  type SqlPool,
} from "../evidence/sql-reader.js";
```

2. Extend `ToolContext`:

```typescript
  /** Read-only evidence database (Railway Postgres). `pool` wins over `url`; url is opened lazily. */
  evidenceDb?: { url?: string; pool?: SqlPool };
```

3. Inside `buildOstTools`, before the `all` array, add the lazy pool accessor:

```typescript
  let evidencePool: SqlPool | null = ctx.evidenceDb?.pool ?? null;
  const getEvidencePool = (): SqlPool => {
    if (!evidencePool) {
      const url = ctx.evidenceDb?.url;
      if (!url) {
        throw new Error(
          "no evidence database configured — set OST_EVIDENCE_DB_URL to a READ-ONLY Postgres connection string " +
            "(a SELECT-only role; see README § SQL evidence reads)",
        );
      }
      evidencePool = createEvidencePool(url);
    }
    return evidencePool;
  };
```

4. Add the tool to the `all` array (after the `ost_annotate` entry, before `git_commit`):

```typescript
    betaTool({
      name: "ost_read_evidence_sql",
      description:
        "Run ONE read-only SQL query (SELECT or WITH) against the configured evidence database and return " +
        "provenance-stamped rows: { query, executedAt, rowCount, truncated, rows }. Read-only by construction: " +
        "statement-shape guard, READ ONLY transaction, statement timeout, row + size caps, and a SELECT-only DB role. " +
        "Use it to pull real product-usage evidence (funnel counts, play events); then record findings on nodes via " +
        "ost_append_to_node / ost_set_evidence, citing the query as the source. This reads reality — it never mutates it.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sql: { type: "string", description: "A single SELECT/WITH statement. No writes, no DDL, no multiple statements." },
          maxRows: {
            type: "number",
            description: `Row cap for the response (default ${DEFAULT_MAX_ROWS}, max ${MAX_MAX_ROWS}).`,
          },
        },
        required: ["sql"],
      },
      run: async (input: { sql: string; maxRows?: number }) => {
        const result = await runEvidenceQuery(getEvidencePool(), input.sql, { maxRows: input.maxRows });
        return JSON.stringify(result, null, 2);
      },
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/evidence/ test/security/`
Expected: PASS. If `test/security/policy.test.ts` has other count-sensitive assertions the grep missed, update them in the same spirit (add the new name, bump the count) — never weaken an assertion to `toContain`.

- [ ] **Step 5: Commit**

```bash
git add src/security/policy.ts src/security/tools.ts test/security/policy.test.ts test/evidence/tool.test.ts
git commit -m "security: allowlist ost_read_evidence_sql — read-only SQL evidence tool"
```

---

### Task 4: Expose the tool on the MCP surface

**Files:**
- Modify: `src/mcp/server.ts` (`MCP_TOOL_NAMES`, `READ_ONLY`, pass `evidenceDb` into `buildOstTools`)
- Modify: `src/processes/types.ts` (add `evidenceDb` to `PassContext` — read the file first; add the field alongside `remote`)
- Modify: `src/runner/context.ts` (populate from `process.env.OST_EVIDENCE_DB_URL`)
- Modify: `test/mcp/server.test.ts` (new tests)

**Interfaces:**
- Consumes: `ToolContext.evidenceDb` (Task 3), `SqlPool` type from `src/evidence/sql-reader.js`.
- Produces: `PassContext.evidenceDb?: { url?: string; pool?: SqlPool }`; MCP surface now lists `ost_read_evidence_sql`; calls to it never commit.

- [ ] **Step 1: Write the failing tests**

Add to `test/mcp/server.test.ts` (inside the existing describe; the existing "exposes exactly" test auto-adapts because it compares against `MCP_TOOL_NAMES`):

```typescript
  test("ost_read_evidence_sql is on the surface, read-only, and errors helpfully when unconfigured", async () => {
    expect(process.env.OST_EVIDENCE_DB_URL).toBeUndefined();
    const client = await connect(dir);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("ost_read_evidence_sql");

    const before = (await simpleGit(dir).log()).total;
    const res = await client.callTool({ name: "ost_read_evidence_sql", arguments: { sql: "SELECT 1" } });
    expect(res.isError).toBe(true);
    expect(textOf(res as never)).toContain("OST_EVIDENCE_DB_URL");
    expect((await simpleGit(dir).log()).total).toBe(before); // no commit, even on the error path
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/mcp/server.test.ts`
Expected: the new test FAILS (tool not on `MCP_TOOL_NAMES`); the "exposes exactly" test still passes.

- [ ] **Step 3: Implement**

In `src/processes/types.ts`: read the `PassContext` interface, add (with the `SqlPool` import from `../evidence/sql-reader.js`):

```typescript
  /** Read-only evidence database (Railway Postgres); absent ⇒ the SQL tool errors with setup guidance. */
  evidenceDb?: { url?: string; pool?: SqlPool };
```

In `src/runner/context.ts`, add to the returned object in `buildPassContext`:

```typescript
    evidenceDb: { url: process.env.OST_EVIDENCE_DB_URL },
```

In `src/mcp/server.ts`:

1. Add `"ost_read_evidence_sql"` to `MCP_TOOL_NAMES` (after `"ost_annotate"`).
2. Add it to the `READ_ONLY` set: `new Set<string>(["ost_read_tree", "ost_next_work", "ost_read_evidence_sql"])`.
3. Pass it through in the `buildOstTools` call: add `evidenceDb: ctx.evidenceDb,` alongside `remote: ctx.remote,`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/mcp/ test/evidence/ test/security/`
Expected: PASS, including the pre-existing surface-lockdown tests.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/server.ts src/processes/types.ts src/runner/context.ts test/mcp/server.test.ts
git commit -m "mcp: expose ost_read_evidence_sql — read-only, no commit, env-configured"
```

---

### Task 5: Regenerate the skill, document setup, full suite green

**Files:**
- Modify: `scripts/gen-skill.ts` and/or `src/knowledge/ruleset.ts` — wherever the "The tools you drive" bullet list is rendered (grep for `ost_annotate` in both; add the new bullet in the same style/position order as `MCP_TOOL_NAMES`)
- Modify: `.claude/skills/opportunity-solution-tree/SKILL.md` (via `npm run gen:skill` — never by hand)
- Modify: `README.md` (new setup section)

**Interfaces:**
- Consumes: everything prior; no new exports.
- Produces: SKILL.md drift test green; operator documentation.

- [ ] **Step 1: Add the tool to the generated skill source**

Grep: `grep -rn "ost_annotate" scripts/gen-skill.ts src/knowledge/ruleset.ts`. In the tool-list template, add after the `ost_annotate` bullet:

```markdown
- **ost_read_evidence_sql** — read-only. Run ONE SELECT/WITH query against the configured evidence database (READ ONLY transaction, timeout, row caps) and get provenance-stamped rows back. Reads reality — real product usage — as evidence; record findings on nodes and cite the query as source. Errors with setup guidance when `OST_EVIDENCE_DB_URL` is unset.
```

Match the surrounding format exactly (the existing bullets are the template).

- [ ] **Step 2: Regenerate and verify drift**

Run: `npm run gen:skill && npx vitest run test/skill/drift.test.ts`
Expected: PASS. `git diff --stat` shows SKILL.md changed.

- [ ] **Step 3: Document operator setup in README.md**

Add a section (after the existing MCP/setup section — read the README's structure first and match its voice):

````markdown
## SQL evidence reads (Postgres)

`ost_read_evidence_sql` lets the agent pull evidence — funnel counts, play events,
retention queries — straight from your product's Postgres. It is read-only by
construction at four layers: a statement-shape guard (one `SELECT`/`WITH` only), a
`READ ONLY` transaction, a statement timeout with row/size caps, and — the layer
that actually matters — a SELECT-only database role. Set it up with a dedicated
role; never hand the agent your app's read-write URL:

```sql
CREATE ROLE ost_reader LOGIN PASSWORD '<generate a strong one>';
GRANT CONNECT ON DATABASE railway TO ost_reader;
GRANT USAGE ON SCHEMA public TO ost_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ost_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ost_reader;
ALTER ROLE ost_reader SET default_transaction_read_only = on;
ALTER ROLE ost_reader SET statement_timeout = '10s';
```

Then expose the connection string to the MCP server's environment:

```bash
export OST_EVIDENCE_DB_URL="postgresql://ost_reader:<password>@<host>:<port>/railway"
```

The tool returns `{ query, executedAt, rowCount, truncated, rows }` — cite the
query as the provenance when recording results on tree nodes. Query results are
evidence of what users did; they are still not permission to mark ideas
validated without a human in the loop.
````

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: ALL tests pass. If any unrelated-looking test fails (e.g. eval invariants counting tools), read it and update it in the same deliberate spirit — the new tool is a legitimate allowlist member; never delete or skip a test to get green.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-skill.ts src/knowledge/ruleset.ts .claude/skills README.md
git commit -m "skill+docs: document ost_read_evidence_sql and the ost_reader role setup"
```

---

## Out of scope (deliberate)

- No Redis reader (`ost_read_redis`) — YAGNI until a funnel counter actually lives there.
- No pass-process (P1–P5) integration — SQL reads are interactive-MCP-only for now.
- No npm version bump or publish — RELEASING.md is a human-run process.
- Creating the `ost_reader` role on the actual Railway Postgres and setting the env var on the operator's machine is controller/operator work, not part of this repo's code.
