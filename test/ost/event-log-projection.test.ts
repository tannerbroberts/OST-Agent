/**
 * The instrument for "Replay this vault's whole git history as events and see if
 * the projection matches" — the assumption test beneath "The log is the agent — an
 * event-sourced graph the whole tree is projected from", in the meta vault. Read
 * `test/fixtures/event-log-projection/PROVENANCE.md` before believing anything
 * here.
 *
 * The pre-committed threshold has two clauses and they fail for different reasons:
 *
 *   1. **At least 95% of tree-changing commits express as events with no
 *      residue.** Below 90% refutes the architecture outright.
 *   2. **The projection of the full log is byte-identical to the vault.** Any node
 *      the projection cannot reproduce refutes it, whatever clause 1 says.
 *
 * The node is explicit that clause 2 is the strict one and not a refinement of
 * clause 1: a 99%-expressible history that projects to a different tree is a
 * refutation, because near-determinism is not a contract anything can rest on.
 * They are asserted separately here for that reason.
 *
 * **Where the teeth are, and why they are not in clause 2.** Residue is carried
 * through the fold as a marker holding the literal bytes — otherwise every commit
 * after the first unexpressible one diverges and the mismatch count measures
 * nothing but the residue count again. That makes clause 2 alone weaker than it
 * looks: it proves the log is *complete*, not that any single event is *right*.
 * What proves that is the checkpoint replay below, which folds a prefix of the log
 * and compares it against the vault as it actually stood at that commit. A
 * `node.appended` that reconstructs by luck at HEAD has to reconstruct at every
 * checkpoint on the way there too.
 *
 * **Non-vacuity.** Three controls, because every count here would read as a pass if
 * the fixture were empty or the projector were a no-op: the corpus is asserted
 * non-trivial, the residue count is asserted *non-zero* (a classifier that called
 * everything expressible would sail through clause 1), and a deliberately
 * corrupted event is asserted to break clause 2. Without the last one, a
 * comparison that never compared anything would be green.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  applyEvent,
  isResidue,
  projectEvents,
  projectionMismatches,
  type OstEvent,
  type Projection,
} from "../../src/ost/event-log.js";
import { FRONTMATTER_FIELDS, serialize, type OstNode } from "../../src/ost/node.js";

const fixtures = path.join(__dirname, "../fixtures/event-log-projection");

/** The same digest the harvester took the fixture's expectations with. */
function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function readGz<T>(file: string): T {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(fixtures, file))).toString("utf8")) as T;
}

interface Log {
  vault: string;
  head: string;
  /** One entry per tree-changing commit, in replay order; `events` is its slice length. */
  commits: { sha: string; writer: string; events: number }[];
  events: OstEvent[];
}
interface Tree {
  head: string;
  checkpointEvery: number;
  headDigests: Record<string, string>;
  checkpoints: { sha: string; afterCommits: number; afterEvents: number; digests: Record<string, string> }[];
}

const log = readGz<Log>("log.json.gz");
const tree = readGz<Tree>("tree.json.gz");

/** The projection reduced to what the fixture can be compared against. */
function digestsOf(projection: Projection): Map<string, string> {
  return new Map([...projection].map(([file, content]) => [file, sha256(content)]));
}

/**
 * Which commits left residue — recomputed here from the log's own events rather
 * than read off a number the harvester wrote down. The harvester records how many
 * events each commit produced and nothing about whether they were any good; this
 * walks the slices and counts the markers.
 */
function residueCommits(): { sha: string; writer: string }[] {
  const out: { sha: string; writer: string }[] = [];
  let at = 0;
  for (const commit of log.commits) {
    const slice = log.events.slice(at, at + commit.events);
    at += commit.events;
    if (commit.writer === MERGE) continue; // counted out by the method, not by preference
    if (slice.some(isResidue)) out.push({ sha: commit.sha, writer: commit.writer });
  }
  expect(at).toBe(log.events.length); // the slices account for the whole log
  return out;
}

/**
 * The method counts "every tree-changing commit … excluding `.ost-agent/usage/`
 * sweeps and merge commits", so merges are out of clause 1's denominator. They
 * are still in the log, because the fold needs them — see the module doc of
 * `src/ost/event-log.ts`.
 */
const MERGE = "git.merge";
const counted = log.commits.filter((c) => c.writer !== MERGE);

describe("the corpus is a real history, not an empty one", () => {
  test("the cut is this vault's whole tree-changing history", () => {
    expect(log.vault).toBe("ost-agent-meta");
    expect(log.commits.length).toBeGreaterThan(3000);
    expect(log.events.length).toBeGreaterThan(log.commits.length);
    expect(Object.keys(tree.headDigests).length).toBeGreaterThan(1500);
    expect(tree.head).toBe(log.head);
  });

  test("more than one writer wrote it, so the vocabulary is not one tool's shape", () => {
    const writers = new Set(log.commits.map((c) => c.writer));
    expect(writers.size).toBeGreaterThanOrEqual(8);
  });
});

describe("clause 1 — the history expresses as events", () => {
  const residue = residueCommits();
  const rate = (counted.length - residue.length) / counted.length;

  test("at least 95% of tree-changing commits express with no residue", () => {
    expect(counted.length).toBeGreaterThan(3000);
    expect(rate).toBeGreaterThanOrEqual(0.95);
    // Below 90% refutes the architecture outright rather than merely missing the
    // bar, so the two edges of the threshold are asserted as the two things they
    // are — see the node's `threshold`.
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  test("every merge in the history is residue, which is why they are not counted here", () => {
    // Not a carve-out to be argued with later: the merges are in the log, every
    // one of them is unexpressible, and the method's exclusion is what keeps
    // that from flattering — or punishing — the rate.
    const merges = log.commits.filter((c) => c.writer === MERGE);
    expect(merges.length).toBeGreaterThan(0);
    let at = 0;
    const residueInMerges = new Map<string, boolean>();
    for (const commit of log.commits) {
      const slice = log.events.slice(at, at + commit.events);
      at += commit.events;
      if (commit.writer === MERGE) residueInMerges.set(commit.sha, slice.every(isResidue));
    }
    expect([...residueInMerges.values()].filter((all) => !all)).toEqual([]);
  });

  test("some history does NOT express — a vocabulary that swallowed everything would prove nothing", () => {
    expect(residue.length).toBeGreaterThan(0);
  });

  test("residue concentrates in commits that declare no writer, which is where the node predicted it", () => {
    const undeclared = residue.filter((c) => c.writer === "unknown").length;
    expect(undeclared / residue.length).toBeGreaterThan(0.5);
  });
});

describe("clause 2 — the projection reproduces the vault byte-identically", () => {
  const projected = projectEvents(log.events);

  test("every file at HEAD is reproduced, and no file is invented", () => {
    const mismatches = projectionMismatches(digestsOf(projected), new Map(Object.entries(tree.headDigests)));
    expect(mismatches).toEqual([]);
  });

  test("the fold is deterministic — the same log twice is the same tree twice", () => {
    const again = projectEvents(log.events);
    expect([...digestsOf(again)].sort()).toEqual([...digestsOf(projected)].sort());
  });

  test("a corrupted event breaks the projection — the comparison really compares", () => {
    // The positive control. Corrupt one `node.appended` and the file it lands on
    // must stop matching — but it has to be the *last* event on its path, or a
    // later whole-content write would paper over the damage and the control would
    // pass for the wrong reason.
    const touchedLater = new Set<string>();
    let at = -1;
    for (let i = log.events.length - 1; i >= 0; i--) {
      const e = log.events[i];
      if (e.type === "node.appended" && e.text.length > 1 && !touchedLater.has(e.path)) {
        at = i;
        break;
      }
      touchedLater.add(e.path);
    }
    expect(at).toBeGreaterThanOrEqual(0);
    const event = log.events[at] as Extract<OstEvent, { type: "node.appended" }>;
    const tampered = [...log.events];
    tampered[at] = { ...event, text: event.text.slice(1) };

    const mismatches = projectionMismatches(
      digestsOf(projectEvents(tampered)),
      new Map(Object.entries(tree.headDigests)),
    );
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches.map((m) => m.path)).toContain(event.path);
  });
});

describe("the checkpoint replay — a prefix of the log is the tree as it stood", () => {
  test("the corpus carries checkpoints spread across the history, each a real tree", () => {
    expect(tree.checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(tree.checkpoints[0].afterCommits).toBeGreaterThanOrEqual(tree.checkpointEvery);
    // A checkpoint holding no files would make its replay pass by comparing
    // nothing to nothing, and the tree only grows, so every one has to be big.
    for (const checkpoint of tree.checkpoints) {
      expect(Object.keys(checkpoint.digests).length).toBeGreaterThan(100);
    }
  });

  // Folded incrementally rather than from zero each time: replaying a prefix is
  // the same fold stopped early, and doing it any other way would test a
  // different function from the one the architecture rests on.
  test.each(tree.checkpoints.map((c) => [c.afterCommits, c] as const))(
    "the tree after %i commits matches the vault at that commit",
    (_n, checkpoint) => {
      const partial: Projection = new Map();
      for (let i = 0; i < checkpoint.afterEvents; i++) applyEvent(partial, log.events[i]);
      expect(projectionMismatches(digestsOf(partial), new Map(Object.entries(checkpoint.digests)))).toEqual([]);
    },
  );
});

describe("the projector's rules are the writers' rules", () => {
  const node = "---\ntype: Solution\nevidence: assertion\n---\n#Solution #unvalidated\n[[One]]\n\nBody.\n";

  test("a link lands on the end of the link block, with no position in the event", () => {
    const files: Projection = new Map([["n.md", node]]);
    applyEvent(files, { type: "node.linked", path: "n.md", title: "Two" });
    expect(files.get("n.md")).toContain("[[One]]\n[[Two]]\n");
  });

  test("an annotation lands at the end of its section, not the end of the file", () => {
    const withSections = node + "\n## Issues\n- first\n\n## Later\n- untouched\n";
    const files: Projection = new Map([["n.md", withSections]]);
    applyEvent(files, { type: "node.sectionAppended", path: "n.md", heading: "## Issues", lines: ["- second"] });
    expect(files.get("n.md")).toBe(node + "\n## Issues\n- first\n- second\n\n## Later\n- untouched\n");
  });

  test("a field the node did not carry lands where the serializer would put it", () => {
    const files: Projection = new Map([["n.md", node]]);
    applyEvent(files, { type: "node.fieldSet", path: "n.md", key: "status", lines: ["status: shipped"] });
    // Between `type` and `evidence`, per FRONTMATTER_FIELDS — not on the end.
    expect(files.get("n.md")).toContain("type: Solution\nstatus: shipped\nevidence: assertion\n");
  });

  test("FRONTMATTER_FIELDS still describes what serialize emits", () => {
    // The drift guard for the constant `withField` positions new fields by. A
    // field added to `serialize` and not to the list would silently start landing
    // at the end of the block, which is a byte difference the strict clause counts.
    const populated: OstNode = {
      title: "N",
      layer: "AssumptionTest",
      status: "unvalidated",
      source: "s",
      created: "2026-01-01",
      confidence: "high",
      evidence: "assertion",
      lane: "compute-only",
      threshold: "t",
      instrument: "cmd",
      sight: "grounded",
      prerequisites: ["P"],
      killIf: "k",
      killBy: "2026-02-01",
      authorship: "machine",
      tags: [],
      links: [],
      body: "b",
    } as OstNode;
    const emitted = serialize(populated)
      .split("\n---")[0]
      .split("\n")
      .slice(1)
      .filter((l) => /^[A-Za-z]/.test(l))
      .map((l) => l.slice(0, l.indexOf(":")));
    expect(emitted).toEqual([...FRONTMATTER_FIELDS]);
  });
});
