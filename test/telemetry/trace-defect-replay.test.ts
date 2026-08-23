/**
 * Replay the hard-fix session's trace against its known defects.
 *
 * The instrument for "Replay the hard-fix session's trace against its known
 * defects", which is the assumption test under "Mechanical tool-invocation trace
 * with daily evidence rollup". The belief being measured, in the tree's words:
 * *the trace records no content, which is what makes it safe to keep — the
 * question is whether the shape alone is enough to recognise a known-bad
 * session.*
 *
 * **The session.** 2026-07-24 left roughly fifty tool invocations and two
 * independently-confirmed defects:
 *
 *   1. the serializer stripped `evidence:` from the frontmatter of every node a
 *      rewrite touched;
 *   2. `ost_create_node`@0.1.3 accepted an `evidence` argument, refused the call
 *      without one, and then did not put it on the node it built.
 *
 * Both returned success. Neither is representable in counts, error rates or
 * durations, which is why the solution node states the limit out loud — "a defect
 * that leaves all calls green is invisible to the trace without diff-awareness" —
 * and names this test as the thing that probes it.
 *
 * **What is replayed, and what is not.** The node's method hands the rollup to a
 * human reviewer who does not know the defects and asks what looks wrong; that
 * sitting is not something a test file can hold, and this file does not pretend
 * to. What it pins is the precondition without which that sitting is guaranteed to
 * score zero: that the trace still CARRIES each defect, and that the day's rollup
 * NAMES it — the tool, the field and which way it went — in text a reviewer who
 * has never heard of either bug could point at. A rollup that cannot do that
 * cannot be handed to anybody, and the reviewer sitting is decided in advance.
 *
 * **Neither defect is simulated by hand-writing an event.** Both are reproduced
 * through the real writer (`Vault`) under the real wrapper (`withUsageTracing`),
 * because a test that appends `{lost: ["evidence"]}` to a JSONL file and then
 * reads it back has measured JSON.parse. Defect 1 in particular is reproduced by
 * a mechanism that is LIVE in this repository today: `deserialize` drops an
 * `evidence` value that is not on the believability ladder, so a node file
 * carrying one loses the field on the next rewrite of any kind. That is the
 * 2026-07-24 defect's exact shape — read, re-render, field gone, call green —
 * still reachable, which is a finding in its own right and the reason this replay
 * needs no bug injected into the code under test.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { serialize, type OstNode } from "../../src/ost/node.js";
import { TRACED_NODE_FIELDS, usageLogPath, withUsageTracing, type UsageEvent } from "../../src/telemetry/usage.js";
import { UsageSource } from "../../src/adapters/usage.js";

let dir: string;
let vault: Vault;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-trace-replay-"));
  vault = new Vault(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function readEvents(): UsageEvent[] {
  const file = usageLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as UsageEvent);
}

const opportunity = (title: string): OstNode => ({
  title,
  layer: "Opportunity",
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body: "A need the tree is holding.",
});

/** Roll a day's events up exactly as the ingest pipeline would, and hand back the body. */
async function rollupBody(events: UsageEvent[], day = "2026-07-24"): Promise<{ body: string; title: string }> {
  const file = path.join(dir, "replay-events.jsonl");
  fs.writeFileSync(file, events.map((e) => `${JSON.stringify(e)}\n`).join(""), "utf8");
  const source = new UsageSource({ file, today: () => "2026-07-25" });
  const { items } = await source.fetchSince(undefined);
  const item = items.find((i) => i.id === `USAGE:${day}`);
  expect(item, `the rollup emitted no item for ${day}`).toBeDefined();
  return { body: item!.body, title: item!.title };
}

describe("defect 1 — a rewrite that strips a field, and every call green", () => {
  test("the trace records which field the write cost the node", async () => {
    // The node is written to disk with an evidence value the ladder does not
    // recognise. Nothing refuses this — a vault predating a tightening, or one a
    // human edited in Obsidian, is full of values like it.
    const p = path.join(dir, "A need the tree is holding.md");
    fs.writeFileSync(p, serialize({ ...opportunity("A need the tree is holding"), evidence: undefined }), "utf8");
    fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("type: Opportunity", "type: Opportunity\nevidence: hearsay"), "utf8");
    expect(fs.readFileSync(p, "utf8")).toContain("evidence: hearsay");

    // A perfectly ordinary status change. It reads the node, re-renders it, and
    // the field is gone — the 2026-07-24 defect, reproduced without injecting one.
    const [tool] = withUsageTracing(
      [{ name: "ost_set_status", run: async () => vault.setStatus("A need the tree is holding", "in-discovery") }],
      dir,
      "mcp",
    );
    await tool.run({ title: "A need the tree is holding", status: "in-discovery" } as never);

    expect(fs.readFileSync(p, "utf8")).not.toContain("evidence:");
    const [event] = readEvents();
    // The half that makes this defect what it is: the call succeeded.
    expect(event.ok).toBe(true);
    expect(event.err).toBeUndefined();
    // And the half that makes it findable.
    expect(event.lost).toEqual(["evidence"]);
  });

  test("a rewrite that keeps every field records no loss — the census is not a constant", async () => {
    // NON-VACUITY. Without this, an implementation that stamped `lost:
    // ["evidence"]` on every write would pass the test above, and the rollup would
    // report a defect on every day the agent ever worked.
    vault.createNode(opportunity("A well-formed need"));
    const [tool] = withUsageTracing(
      [{ name: "ost_set_status", run: async () => vault.setStatus("A well-formed need", "in-discovery") }],
      dir,
      "mcp",
    );
    await tool.run({ title: "A well-formed need", status: "in-discovery" } as never);

    const event = readEvents().at(-1)!;
    expect(event.ok).toBe(true);
    expect(event.lost).toBeUndefined();
    expect(event.dropped).toBeUndefined();
  });
});

describe("defect 2 — a create that declares a field and does not write it", () => {
  test("the trace records what the call named and the node did not come out holding", async () => {
    // `ost_create_node`@0.1.3, reproduced at the seam where it actually broke: the
    // input carries `evidence`, the node the tool builds from that input does not.
    // `lost` is structurally blind here — there was no earlier file to lose
    // anything from — so this is the case the second half of the census exists for.
    const [tool] = withUsageTracing(
      [
        {
          name: "ost_create_node",
          run: async () => vault.createNode({ ...opportunity("A need created by 0.1.3"), evidence: undefined }),
        },
      ],
      dir,
      "mcp",
    );
    await tool.run({
      title: "A need created by 0.1.3",
      layer: "Opportunity",
      parent: "Outcome",
      evidence: "assertion",
      body: "A need the tree is holding.",
    } as never);

    const [event] = readEvents();
    expect(event.ok).toBe(true);
    expect(event.wrote).toEqual(["A need created by 0.1.3.md"]);
    expect(event.dropped).toEqual(["evidence"]);
    expect(event.lost).toBeUndefined();
  });

  test("a create that honours its input records no drop", async () => {
    // The other half of the same non-vacuity argument, on the other detector.
    const [tool] = withUsageTracing(
      [{ name: "ost_create_node", run: async () => vault.createNode(opportunity("A need created correctly")) }],
      dir,
      "mcp",
    );
    await tool.run({
      title: "A need created correctly",
      layer: "Opportunity",
      parent: "Outcome",
      evidence: "assertion",
      body: "A need the tree is holding.",
    } as never);

    const event = readEvents().at(-1)!;
    expect(event.dropped).toBeUndefined();
  });

  test("a read tool that takes `status` as a filter has not dropped it", async () => {
    // The false positive that would make the whole census unreadable: every read
    // tool takes schema field names as arguments, and none of them writes. A call
    // that wrote nothing reports nothing.
    const [tool] = withUsageTracing([{ name: "ost_read_tree", run: async () => "ok" }], dir, "mcp");
    await tool.run({ status: "unvalidated", evidence: "assertion" } as never);

    const event = readEvents().at(-1)!;
    expect(event.dropped).toBeUndefined();
    expect(event.lost).toBeUndefined();
  });
});

describe("the replay — a day's rollup, scored against the two known defects", () => {
  /**
   * The session's shape: ~50 invocations, of which the two defective ones are
   * indistinguishable from the rest on every field the rollup used to carry.
   * Written as a generator rather than a fixture so the point is visible — the
   * clean calls and the defective calls differ in exactly one field.
   */
  function hardFixSession(opts: { defective: boolean }): UsageEvent[] {
    const base = (i: number, over: Partial<UsageEvent> = {}): UsageEvent => ({
      ts: `2026-07-24T${String(9 + Math.floor(i / 12)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}:00.000Z`,
      tool: ["ost_read_tree", "ost_check", "ost_annotate", "ost_next_work"][i % 4],
      ok: true,
      ms: 8 + (i % 17),
      surface: "mcp",
      argBytes: 120 + i,
      session: "hard-fix-2026-07-24",
      ...over,
    });
    const events = Array.from({ length: 46 }, (_, i) => base(i));
    // The two defects, as green as everything above them.
    events.push(
      base(46, {
        tool: "ost_set_status",
        ...(opts.defective ? { lost: ["evidence"] } : {}),
      }),
      base(47, {
        tool: "ost_set_status",
        ...(opts.defective ? { lost: ["evidence"] } : {}),
      }),
      base(48, {
        tool: "ost_create_node",
        wrote: ["A need.md"],
        ...(opts.defective ? { dropped: ["evidence"] } : {}),
      }),
      base(49, {
        tool: "ost_create_node",
        wrote: ["Another need.md"],
        ...(opts.defective ? { dropped: ["evidence"] } : {}),
      }),
    );
    return events;
  }

  test("the rollup names both defects — the tool, the field, and which way it went", async () => {
    const { body, title } = await rollupBody(hardFixSession({ defective: true }));

    // The node's pre-committed threshold is >= 1 of the 2. Both are asserted,
    // because a rollup that surfaces one and buries the other tells a reviewer the
    // day had a defect while leaving them unable to find the second one.
    expect(body).toContain("ost_set_status");
    expect(body).toContain("ost_create_node");
    expect(body).toContain("`evidence`");
    // Which way each went, in words a reviewer who knows neither bug can act on.
    expect(body).toContain("the node carried it before the write and not after");
    expect(body).toContain("the call declared it and nothing it wrote holds it");
    // Counted, not merely mentioned: 2 calls of each shape.
    expect(body).toMatch(/\| ost_set_status \| `evidence` \|[^|]+\| 2 \|/);
    expect(body).toMatch(/\| ost_create_node \| `evidence` \|[^|]+\| 2 \|/);
    // And visible without opening the body, which is how an unmapped evidence item
    // is actually read in `ost_next_work`.
    expect(title).toContain("4 silently lost a field");
    // The session still looks clean on every number the rollup carried before this
    // was built — which is the finding the assumption test was set up to reach.
    expect(body).toContain("0 failed");
  });

  test("the same session without the defects reads clean — no loss section, no loss in the title", async () => {
    const { body, title } = await rollupBody(hardFixSession({ defective: false }));

    expect(body).not.toContain("Silent frontmatter loss");
    expect(body).not.toContain("`evidence`");
    expect(title).not.toContain("silently lost");
    // Same 50 calls, same tools, same timings: the ONLY difference between this
    // rollup and the one above is the field census. So the assertions above are
    // about a defect being detected, not about a busy day looking alarming.
    expect(title).toContain("50 calls");
  });
});

describe("what the census may say", () => {
  test("it names schema fields and nothing else — no title, no body, no argument value", async () => {
    const [tool] = withUsageTracing(
      [
        {
          name: "ost_create_node",
          run: async () => vault.createNode({ ...opportunity("A need with a secret"), evidence: undefined }),
        },
      ],
      dir,
      "mcp",
    );
    await tool.run({
      title: "A need with a secret",
      evidence: "assertion",
      source: "CONFIDENTIAL-SOURCE-4417",
      body: "A need the tree is holding.",
    } as never);

    const raw = fs.readFileSync(usageLogPath(dir), "utf8");
    const event = readEvents()[0];
    // `source` is a declared field that did not land, so its NAME is in the census…
    expect(event.dropped).toEqual(["evidence", "source"]);
    // …and its VALUE is nowhere, which is the contract that makes the trace safe
    // to keep in a git repository the operator shares.
    expect(raw).not.toContain("CONFIDENTIAL-SOURCE-4417");
    // Stated as a closed set rather than as an absence, because absence is what a
    // census that recorded nothing would also show: every string these two fields
    // can hold is a member of the vocabulary, so no call's arguments can put an
    // arbitrary one there. (The node's TITLE does reach the trace, through `wrote`
    // — the pre-existing, argued exception: it is already the filename, in git, and
    // in the commit message. Nothing new here widens that.)
    for (const field of [...(event.dropped ?? []), ...(event.lost ?? [])]) {
      expect(TRACED_NODE_FIELDS).toContain(field);
    }
  });

  test("the vocabulary the trace names is the vocabulary the serializer writes", () => {
    // The drift guard for the shared literal. `TRACED_NODE_FIELDS` lives in
    // telemetry and the serializer lives in `src/ost/`, so a twelfth frontmatter
    // field could be added to the schema and stay permanently outside the census —
    // silently, since a field nobody watches loses nothing visible. This renders a
    // node carrying every field the schema has and asks which keys came out.
    const everyField: OstNode = {
      title: "A node carrying every field",
      layer: "Opportunity",
      status: "unvalidated",
      source: "founder-directive:2026-07-24",
      created: "2026-07-24",
      confidence: "medium",
      evidence: "assertion",
      lane: "compute-only",
      threshold: ">= 1 of 2",
      instrument: "npx vitest run",
      sight: "sighted",
      authorship: "machine",
      tags: [],
      links: [],
      body: "prose",
    };
    const emitted = serialize(everyField)
      .split("---")[1]
      .split("\n")
      .map((l) => l.split(":")[0].trim())
      .filter((k) => k.length > 0);

    expect([...emitted].sort()).toEqual([...TRACED_NODE_FIELDS].sort());
  });
});
