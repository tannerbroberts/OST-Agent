import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { defaultTranscriptDir } from "../../src/adapters/transcript.js";
import { correlateTokens, markCorrelated, transcriptDirFor } from "../../src/eval/correlate.js";
import { defaultGenome } from "../../src/genome/load.js";
import type { Genome } from "../../src/genome/schema.js";
import type { OstNode } from "../../src/ost/node.js";
import { recordAttention } from "../../src/telemetry/attention.js";
import { usageLogPath } from "../../src/telemetry/usage.js";

const FULL = "## Format\na count\n\n## Methodology\nquery\n\n## Rationale\nserves [[O]]";

const unknown = (title: string): OstNode => ({
  title,
  layer: "Unknown",
  tags: [],
  links: [],
  body: FULL,
  evidence: "assertion",
});

/** Every fixture tree carries the same three unknowns; the split decides who gets what. */
const TREE: OstNode[] = [unknown("A"), unknown("B"), unknown("U")];

const ZERO = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 };

/** A fixed epoch so every window and every transcript stamp is exact, never wall-clock. */
const T0 = Date.parse("2026-07-27T12:00:00.000Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();

const tmp = (prefix: string) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

/** One usage-log event, shaped exactly as `withUsageTracing` writes it. */
const call = (title: string | undefined, startMs: number, ms: number) => ({
  ts: at(startMs),
  tool: "ost_read_tree",
  ok: true,
  ms,
  surface: "mcp",
  argBytes: 0,
  ...(title ? { unknown: title } : {}),
});

function writeUsage(vault: string, events: Record<string, unknown>[]): void {
  const file = usageLogPath(vault);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`, "utf8");
}

/** Raw JSONL, backdated past the 30-minute quiet gate so the session reads as finished. */
function writeRaw(tdir: string, id: string, lines: string[]): string {
  const file = path.join(tdir, `${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
  const past = Date.now() / 1000 - 3600;
  fs.utimesSync(file, past, past);
  return file;
}

function writeSession(
  tdir: string,
  id: string,
  cwd: string,
  entries: { ts: string; usage: Record<string, number> }[],
): string {
  return writeRaw(
    tdir,
    id,
    entries.map((e, i) =>
      JSON.stringify({
        type: "assistant",
        sessionId: id,
        cwd,
        uuid: `${id}-${i}`,
        requestId: `req_${i}`,
        timestamp: e.ts,
        message: { usage: { ...e.usage, server_tool_use: { web_search_requests: 0 } } },
      }),
    ),
  );
}

/** A vault, its usage log, and one finished session transcript whose cwd IS the vault. */
function fixture(
  events: Record<string, unknown>[],
  entries: { ts: string; usage: Record<string, number> }[],
  id = "sess-1",
): { vault: string; tdir: string } {
  const vault = tmp("ost-correlate-");
  const tdir = tmp("ost-transcripts-");
  writeUsage(vault, events);
  writeSession(tdir, id, vault, entries);
  return { vault, tdir };
}

function genomeWith(over: Partial<Genome["tokenSplit"]>): Genome {
  const g = defaultGenome();
  return { ...g, tokenSplit: { ...g.tokenSplit, ...over } };
}

const run = (vault: string, tdir: string, over: Partial<Genome["tokenSplit"]> = {}) =>
  correlateTokens(vault, TREE, genomeWith({ enabled: true, transcriptDir: tdir, ...over }));

describe("correlateTokens — the default genome", () => {
  test("the default genome correlates nothing — and the SAME fixture with enabled:true does, so the emptiness is the gene and not the fixture", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );

    const off = correlateTokens(vault, TREE, genomeWith({ transcriptDir: tdir }));
    expect(off.byUnknown.size).toBe(0);
    expect(off.residual).toEqual(ZERO);
    expect(off.sessions).toEqual([]);
    expect(off.costBasis).toBe("tokens");

    expect(run(vault, tdir).byUnknown.get("U")?.input).toBe(100);
  });
});

describe("transcriptDirFor", () => {
  test("derives from the VAULT dir, NEVER from the product repo the transcript adapter harvests", () => {
    const vault = tmp("ost-correlate-");
    expect(transcriptDirFor(vault, genomeWith({}))).toBe(defaultTranscriptDir(vault));
    expect(transcriptDirFor(vault, genomeWith({}))).not.toBe(
      defaultTranscriptDir("/some/product/repo"),
    );
  });

  test("an explicit transcriptDir wins over the derived one", () => {
    const vault = tmp("ost-correlate-");
    expect(transcriptDirFor(vault, genomeWith({ transcriptDir: "/tmp/elsewhere" }))).toBe(
      path.resolve("/tmp/elsewhere"),
    );
  });
});

describe("correlateTokens — apportioning", () => {
  test("a transcript entry inside a call's window is attributed to the unknown that call named", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100, output_tokens: 10 } }],
    );
    const res = run(vault, tdir);
    expect(res.byUnknown.get("U")).toEqual({ input: 100, output: 10, cacheCreate: 0, cacheRead: 0 });
    expect(res.residual).toEqual(ZERO);
    expect(res.sessions).toEqual(["sess-1"]);
  });

  test("tokens spent between calls stay residual — most of a session is thinking, and the split does NOT invent an owner for it", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 100)],
      [
        { ts: at(50), usage: { input_tokens: 100 } },
        { ts: at(2000), usage: { input_tokens: 200 } },
        { ts: at(4000), usage: { input_tokens: 200 } },
      ],
    );
    const res = run(vault, tdir);
    expect(res.byUnknown.get("U")?.input).toBe(100);
    expect(res.residual.input).toBe(400);
    expect(res.residual.input).toBeGreaterThan(res.byUnknown.get("U")!.input);
  });

  test("two windows covering the same instant split it by calls", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 1000), call("B", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir);
    expect(res.byUnknown.get("A")?.input).toBe(50);
    expect(res.byUnknown.get("B")?.input).toBe(50);
    expect(res.residual).toEqual(ZERO);
  });

  test("proportional-by-ms weights the longer window heavier", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 300), call("B", 0, 100)],
      [{ ts: at(50), usage: { input_tokens: 400 } }],
    );
    const res = run(vault, tdir, { method: "proportional-by-ms" });
    expect(res.byUnknown.get("A")?.input).toBe(300);
    expect(res.byUnknown.get("B")?.input).toBe(100);
  });

  test("winner-take-all gives the whole entry to the innermost window", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 1000), call("B", 400, 200)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir, { method: "winner-take-all" });
    expect(res.byUnknown.get("B")?.input).toBe(100);
    expect(res.byUnknown.get("A")).toBeUndefined();
  });

  test("method: none attributes nothing — every token is residual", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const res = run(vault, tdir, { method: "none", residual: "proportional" });
    expect(res.byUnknown.size).toBe(0);
    expect(res.residual.input).toBe(100);
  });

  test("residual: proportional spreads the leftover on the same basis the method used", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 10), call("A", 20, 10), call("A", 40, 10), call("B", 60, 10)],
      [{ ts: at(5000), usage: { input_tokens: 400 } }],
    );
    const res = run(vault, tdir, { residual: "proportional" });
    expect(res.byUnknown.get("A")?.input).toBe(300);
    expect(res.byUnknown.get("B")?.input).toBe(100);
    expect(res.residual).toEqual(ZERO);
  });

  test("residual: nearest-preceding credits the unknown last worked on, and credits nothing at all before the first call", () => {
    const { vault, tdir } = fixture(
      [call("A", 0, 100)],
      [
        { ts: at(500), usage: { input_tokens: 100 } },
        { ts: at(-500), usage: { input_tokens: 40 } },
      ],
    );
    const res = run(vault, tdir, { residual: "nearest-preceding" });
    expect(res.byUnknown.get("A")?.input).toBe(100);
    expect(res.residual.input).toBe(40);
  });

  test("attribution does NOT depend on the usage log's file order — the log is appended in FINISH order while ts is START time", () => {
    const entries = [{ ts: at(105), usage: { input_tokens: 100 } }];
    const finishOrder = fixture([call("B", 100, 10), call("A", 0, 1000)], entries, "sess-f");
    const startOrder = fixture([call("A", 0, 1000), call("B", 100, 10)], entries, "sess-s");

    const a = run(finishOrder.vault, finishOrder.tdir, { method: "winner-take-all" });
    const b = run(startOrder.vault, startOrder.tdir, { method: "winner-take-all" });
    expect([...a.byUnknown.entries()]).toEqual([...b.byUnknown.entries()]);
    expect(a.byUnknown.get("B")?.input).toBe(100);
  });
});

describe("correlateTokens — idempotency and fail-open", () => {
  test("a session already named in the ledger is skipped — an append-only ledger would double-count it", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    recordAttention(vault, {
      ts: at(1000),
      unknown: "U",
      kind: "spend",
      session: "sess-1",
      tokens: { input: 100, output: 0, cacheCreate: 0, cacheRead: 0 },
    });
    const res = run(vault, tdir);
    expect(res.sessions).toEqual([]);
    expect(res.byUnknown.size).toBe(0);
  });

  test("markCorrelated makes the next run skip exactly what this one consumed", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const first = run(vault, tdir);
    expect(first.sessions).toEqual(["sess-1"]);
    markCorrelated(vault, first.sessions);
    expect(run(vault, tdir).sessions).toEqual([]);
  });

  test("a session whose cwd is not the vault belongs to another project and is NOT read", () => {
    const vault = tmp("ost-correlate-");
    const tdir = tmp("ost-transcripts-");
    writeUsage(vault, [call("U", 0, 1000)]);
    writeSession(tdir, "foreign", "/some/other/project", [
      { ts: at(500), usage: { input_tokens: 100 } },
    ]);
    const res = run(vault, tdir);
    expect(res.sessions).toEqual([]);
    expect(res.byUnknown.size).toBe(0);
  });

  test("a live session is invisible while it spends — token attribution is retroactive by construction", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    const now = Date.now() / 1000;
    fs.utimesSync(path.join(tdir, "sess-1.jsonl"), now, now);
    expect(run(vault, tdir).sessions).toEqual([]);
  });

  test("a missing transcript directory is an empty correlation, never a throw — a correlator that throws takes ost_status down", () => {
    const vault = tmp("ost-correlate-");
    writeUsage(vault, [call("U", 0, 1000)]);
    const res = run(vault, path.join(vault, "no-such-transcripts"));
    expect(res.byUnknown.size).toBe(0);
    expect(res.residual).toEqual(ZERO);
    expect(res.costBasis).toBe("tokens");
  });

  test("a corrupt session file costs its own tokens, not the correlation", () => {
    const vault = tmp("ost-correlate-");
    const tdir = tmp("ost-transcripts-");
    writeUsage(vault, [call("U", 0, 1000)]);
    writeRaw(tdir, "sess-1", [
      JSON.stringify({
        type: "user",
        sessionId: "sess-1",
        cwd: vault,
        timestamp: at(0),
        message: { content: "hi" },
      }),
      "{broken",
      JSON.stringify({
        type: "assistant",
        sessionId: "sess-1",
        cwd: vault,
        timestamp: at(500),
        message: { usage: { input_tokens: 100 } },
      }),
    ]);
    expect(run(vault, tdir).byUnknown.get("U")?.input).toBe(100);
  });

  test("the cost basis rides on every result, so a comparison that mixes bases can be refused rather than normalized", () => {
    const { vault, tdir } = fixture(
      [call("U", 0, 1000)],
      [{ ts: at(500), usage: { input_tokens: 100 } }],
    );
    expect(run(vault, tdir, { costBasis: "calls-and-ms" }).costBasis).toBe("calls-and-ms");
  });
});
