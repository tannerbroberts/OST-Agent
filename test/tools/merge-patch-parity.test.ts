/**
 * The instrument for "Merge by patch rather than by replacement, so the
 * survivor's unread prose is never at risk".
 *
 * The claim being risked is narrow and worth stating exactly: a merge that asks
 * for the loser's CONTRIBUTION instead of the survivor's whole body is safer —
 * prose the caller never read cannot be an argument, so it cannot be lost — and
 * safer *at no cost to anything else the merge does*. The second half is what
 * this file measures. A patch shape that quietly stopped repointing an inbound
 * edge, or stopped carrying a `## Results` block across, or stopped refusing the
 * merge that would hand a solution a run nobody performed on it, would be a
 * regression wearing a safety improvement's name.
 *
 * Threshold, pre-committed on the assumption test: *both merge shapes agree on
 * every inbound edge, outbound edge, carried reserved section and refusal across
 * all four fixture cases; any single divergence outside the survivor's prose
 * fails it.* So each case is built TWICE, in two vaults that start byte-identical
 * apart from their directory, folded through the two shapes, and compared on
 * everything a gate, a counter or the graph can see.
 *
 * The four cases are the ones the test named:
 *
 *   1. a loser with several inbound edges — the repointing the tree's
 *      connectedness depends on;
 *   2. a loser with outbound edges the survivor lacks — the union that keeps the
 *      loser's children from being orphaned;
 *   3. a loser carrying `## Results` and `## Instrument Log` — the measurements
 *      that must survive the deletion of the file they lived in;
 *   4. the refusal case: the loser holds a recorded result and the survivor has
 *      none.
 *
 * **The fourth is the one to watch,** and it is the reason this file lives under
 * `test/tools/` rather than `test/ost/`. That refusal is not in the vault at all
 * — `assertMergeAllowed` in `security/tools.ts` holds it, deliberately, because
 * it is the same judgement R6 makes about `ost_link_nodes` — so a parity check
 * run against `Vault` alone would exercise two shapes that both merge happily
 * and would report agreement on a question it never asked. Both shapes are
 * therefore driven through the guard-then-fold sequence the tool surface itself
 * runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { Vault } from "../../src/ost/vault.js";
import { assertMergeAllowed, buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { validateToolInput } from "../../src/security/validateToolInput.js";
import { INSTRUMENT_LOG_HEADING, RESULTS_HEADING, RESERVED_HEADINGS } from "../../src/ost/headings.js";
import { splitReservedSections } from "../../src/ost/sections.js";
import type { OstNode } from "../../src/ost/node.js";

const LOSER = "My tools fail locally";
const SURVIVOR = "Tools break on my machine";
const WHY = "the same need, written twice";

let dirs: string[];

beforeEach(() => {
  dirs = [];
});
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

const vaultDir = new WeakMap<Vault, string>();

function freshVault(): Vault {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-merge-parity-"));
  dirs.push(dir);
  const vault = new Vault(dir);
  vaultDir.set(vault, dir);
  return vault;
}

/**
 * The live `ost_merge_nodes`, schema and all.
 *
 * The patch shape is driven through this rather than through
 * `vault.mergeNodesByPatch` for the reason the header gives about case 4: the
 * refusal that case measures is not in the vault. A parity test that called the
 * vault method directly would agree with itself while the guard sat unwired on
 * the surface the agent actually reaches — and `validateToolInput` is included
 * so that a schema still advertising `prose` fails here rather than at the first
 * real call.
 */
interface SurfaceTool {
  inputSchema: unknown;
  run: (i: unknown) => Promise<unknown>;
}

/**
 * ONE tool set over this vault, so the read and the merge share a session.
 *
 * They have to: `ost_merge_nodes` now refuses a survivor whose body this session
 * has not been served (`security/read-receipts.ts`), and the receipt lives in the
 * closure `buildOstTools` opens. Two `buildOstTools` calls would be two sessions
 * and the merge would be refused however many times the read had been made.
 */
function surface(vault: Vault): { readTree: SurfaceTool; merge: SurfaceTool } {
  const ctx: ToolContext = { vault, dir: vaultDir.get(vault)!, remote: { enabled: false } };
  const built = buildOstTools(ctx);
  const pick = (name: string): SurfaceTool => {
    const tool = built.find((t) => t.name === name);
    if (!tool) throw new Error(`${name} is not on the tool surface`);
    return tool as unknown as SurfaceTool;
  };
  return { readTree: pick("ost_read_tree"), merge: pick("ost_merge_nodes") };
}

const node = (title: string, layer: OstNode["layer"], body: string): OstNode => ({
  title,
  layer,
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body,
});

/**
 * The two shapes, each as the tool surface runs it: the guard first, then the
 * fold. `contribution` is what the patch shape appends; `prose` is what the
 * replace shape puts in place of the survivor's whole body. They differ, and
 * that difference is exactly what the comparison below excludes.
 */
type Shape = (vault: Vault) => Promise<void>;

/** What the surface used to run: the guard, then a fold that takes the survivor's whole body. */
const REPLACE: Shape = async (vault) => {
  assertMergeAllowed(vault, LOSER, SURVIVOR);
  vault.mergeNodes(LOSER, SURVIVOR, { prose: "One framing covering both machines.", why: WHY });
};

/**
 * What it runs now, through the real tool — schema checked, guard reached the way
 * the agent reaches it.
 *
 * The read is part of the shape rather than setup around it, because it is part
 * of the call sequence the surface now requires: an agent merging through this
 * tool reads the survivor first or is refused. Every parity assertion below is
 * about what the FOLD does, and the fold is only reachable from here through this
 * pair. (`REPLACE` needs no read: it is the library shape, reached by a human on
 * the CLI who has both bodies in front of them.)
 */
const PATCH: Shape = async (vault) => {
  const { readTree, merge } = surface(vault);
  const input = { from: LOSER, into: SURVIVOR, contribution: "It also happens on a fresh checkout.", why: WHY };
  const problems = validateToolInput(merge.inputSchema as never, input);
  expect(problems, "ost_merge_nodes rejected a patch-shaped call before it ran").toEqual([]);
  await readTree.run({ node: SURVIVOR });
  await merge.run(input);
};

/**
 * Everything about the resulting tree that is NOT the survivor's prose.
 *
 * Reserved sections are compared verbatim — that is the point of case 3, and
 * `## History` is in the set, so the merge's own audit line and every repointing
 * line have to match too. Links are sorted because "the same edges" is a claim
 * about a set; nothing here depends on the order the union happened to produce,
 * and a shape that produced them in a different order is not a divergence a gate
 * could see.
 */
interface Observable {
  titles: string[];
  nodes: Record<string, { layer: string; status?: string; tags: string[]; links: string[]; reserved: string[] }>;
}

function observe(vault: Vault): Observable {
  const tree = [...vault.readTree()].sort((a, b) => a.title.localeCompare(b.title));
  const nodes: Observable["nodes"] = {};
  for (const n of tree) {
    nodes[n.title] = {
      layer: n.layer,
      status: n.status,
      tags: [...n.tags].sort(),
      links: [...n.links].sort(),
      reserved: splitReservedSections(n.body).reserved,
    };
  }
  return { titles: tree.map((n) => n.title), nodes };
}

/** What a shape did: the tree it left behind, or the refusal it raised instead. */
type Attempt = { refused: false; observed: Observable } | { refused: true; message: string };

async function run(build: (vault: Vault) => void, shape: Shape): Promise<Attempt> {
  const vault = freshVault();
  build(vault);
  try {
    await shape(vault);
  } catch (e) {
    return { refused: true, message: e instanceof Error ? e.message : String(e) };
  }
  return { refused: false, observed: observe(vault) };
}

/** Run one fixture through both shapes and require they agree outside the survivor's prose. */
async function requireParity(build: (vault: Vault) => void): Promise<Attempt> {
  const replaced = await run(build, REPLACE);
  const patched = await run(build, PATCH);
  expect(patched).toEqual(replaced);
  return replaced;
}

/** The two duplicates plus the root that parents them both. Present in every case. */
function duplicates(vault: Vault): void {
  vault.createNode(node("Root", "Outcome", "The mandate."));
  vault.createNode(node(SURVIVOR, "Opportunity", "First framing, at some length, written by a person who was there."));
  vault.createNode(node(LOSER, "Opportunity", "Second framing."));
  vault.linkNodes("Root", SURVIVOR);
  vault.linkNodes("Root", LOSER);
}

test("case 1 — a loser with several inbound edges: both shapes repoint every one of them", async () => {
  const outcome = await requireParity((vault) => {
    duplicates(vault);
    for (const title of ["Another need", "A third need", "A fourth need"]) {
      vault.createNode(node(title, "Opportunity", "Elsewhere in the tree."));
      vault.linkNodes(title, LOSER);
    }
  });

  // Parity is the threshold, but parity with a shape that repointed nothing
  // would also be parity. Pin the behaviour the agreement is about.
  expect(outcome.refused).toBe(false);
  if (outcome.refused) return;
  for (const title of ["Root", "Another need", "A third need", "A fourth need"]) {
    expect(outcome.observed.nodes[title].links).toContain(SURVIVOR);
    expect(outcome.observed.nodes[title].links).not.toContain(LOSER);
  }
  expect(outcome.observed.titles).not.toContain(LOSER);
});

test("case 2 — a loser with outbound edges the survivor lacks: both shapes union them on", async () => {
  const outcome = await requireParity((vault) => {
    duplicates(vault);
    vault.createNode(node("A way to fix it", "Solution", "One approach."));
    vault.createNode(node("A second way", "Solution", "Another approach."));
    vault.linkNodes(LOSER, "A way to fix it");
    vault.linkNodes(LOSER, "A second way");
    // Already the survivor's, so the union must not double it.
    vault.linkNodes(SURVIVOR, "A way to fix it");
    // The commonest duplicate shape: the loser pointing at the survivor. Neither
    // shape may leave the survivor linking to itself.
    vault.linkNodes(LOSER, SURVIVOR);
  });

  expect(outcome.refused).toBe(false);
  if (outcome.refused) return;
  const links = outcome.observed.nodes[SURVIVOR].links;
  expect(links).toEqual(["A second way", "A way to fix it"]);
});

test("case 3 — a loser carrying ## Results and ## Instrument Log: both shapes carry them across verbatim", async () => {
  const outcome = await requireParity((vault) => {
    duplicates(vault);
    // The survivor already records a result, so the refusal in case 4 does not
    // fire and this case can measure the CARRY on its own.
    vault.appendUnderSection(SURVIVOR, RESULTS_HEADING, "- 2026-01-01 supported — two operators on the survivor");
    vault.appendUnderSection(LOSER, RESULTS_HEADING, "- 2026-01-02 refuted — three operators hit it, none reproduced");
    vault.appendUnderSection(LOSER, INSTRUMENT_LOG_HEADING, "- 2026-01-03 **red** (exit 1) `npx vitest run` — 4 failed");
  });

  expect(outcome.refused).toBe(false);
  if (outcome.refused) return;
  const reserved = outcome.observed.nodes[SURVIVOR].reserved.join("\n");
  expect(reserved).toContain("two operators on the survivor");
  expect(reserved).toContain("none reproduced");
  expect(reserved).toContain("**red** (exit 1)");
  expect(reserved).toContain("carried 2 reserved section(s) across");
  // Not "somewhere in the body": under the reserved headings a gate reads.
  for (const heading of [RESULTS_HEADING, INSTRUMENT_LOG_HEADING]) {
    expect(outcome.observed.nodes[SURVIVOR].reserved.some((r) => r.startsWith(heading))).toBe(true);
  }
});

test("case 4 — the loser records a result and the survivor does not: both shapes refuse, identically", async () => {
  const outcome = await requireParity((vault) => {
    duplicates(vault);
    vault.appendUnderSection(LOSER, RESULTS_HEADING, "- 2026-01-02 supported — a run a human actually performed");
  });

  // The assertion the whole file exists for. A patch shape that dropped this
  // would pass every structural check above and would quietly hand nodes
  // results nobody produced on them.
  expect(outcome.refused).toBe(true);
  if (!outcome.refused) return;
  expect(outcome.message).toMatch(/a run nobody performed on it/);
});

test("the structural refusals are the same set in both shapes", () => {
  // Not one of the four fixture cases, and included because "identical
  // refusals" is only worth measuring if it covers the refusals that make a
  // merge destructive rather than the one that makes it dishonest.
  const cases: Array<[string, (v: Vault) => void, (v: Vault, shape: "replace" | "patch") => void, RegExp]> = [
    [
      "a node cannot merge into itself",
      duplicates,
      (v, s) =>
        s === "replace"
          ? v.mergeNodes(LOSER, LOSER, { prose: "x", why: WHY })
          : v.mergeNodesByPatch(LOSER, LOSER, { contribution: "x", why: WHY }),
      /into itself/,
    ],
    [
      "the two must share a layer",
      (v) => {
        duplicates(v);
        v.createNode(node("A way to fix it", "Solution", "One approach."));
      },
      (v, s) =>
        s === "replace"
          ? v.mergeNodes("A way to fix it", SURVIVOR, { prose: "x", why: WHY })
          : v.mergeNodesByPatch("A way to fix it", SURVIVOR, { contribution: "x", why: WHY }),
      /different\s+kinds of claim|Merge is for duplicates within a layer/,
    ],
    [
      "the Outcome is never a loser",
      (v) => {
        duplicates(v);
        v.createNode(node("Second root", "Outcome", "A rival mandate."));
      },
      (v, s) =>
        s === "replace"
          ? v.mergeNodes("Root", "Second root", { prose: "x", why: WHY })
          : v.mergeNodesByPatch("Root", "Second root", { contribution: "x", why: WHY }),
      /Outcome/,
    ],
    [
      "a retraction is never carried onto a live node",
      (v) => {
        duplicates(v);
        v.appendUnderSection(LOSER, "## Retraction", "- 2026-01-04 retracted by a human — never should have existed");
      },
      (v, s) =>
        s === "replace"
          ? v.mergeNodes(LOSER, SURVIVOR, { prose: "x", why: WHY })
          : v.mergeNodesByPatch(LOSER, SURVIVOR, { contribution: "x", why: WHY }),
      /retracted/,
    ],
  ];

  for (const [what, build, attempt, expected] of cases) {
    const messages = (["replace", "patch"] as const).map((shape) => {
      const vault = freshVault();
      build(vault);
      try {
        attempt(vault, shape);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(messages[0], `${what}: the replace shape did not refuse`).toMatch(expected);
    expect(messages[1], `${what}: the patch shape diverged from the replace shape`).toEqual(messages[0]);
  }
});

test("the patch shape keeps the survivor's prose, which is the only thing it may differ on", () => {
  // The other side of the parity claim. Every test above asserts the two shapes
  // AGREE; this one asserts the difference they are allowed is the difference
  // that motivated the change, rather than the two shapes having quietly become
  // the same operation.
  const vault = freshVault();
  duplicates(vault);
  const before = splitReservedSections(vault.read(SURVIVOR).body).prose;

  vault.mergeNodesByPatch(LOSER, SURVIVOR, { contribution: "It also happens on a fresh checkout.", why: WHY });

  const after = splitReservedSections(vault.read(SURVIVOR).body).prose;
  expect(after).toContain(before.trim());
  expect(after).toContain("It also happens on a fresh checkout.");
  expect(after).toMatch(new RegExp(`^### Merged from "${LOSER}" — \\d{4}-\\d{2}-\\d{2}$`, "m"));
  // The contribution lands in PROSE, not under a heading a gate reads.
  for (const heading of RESERVED_HEADINGS) {
    expect(after).not.toContain(heading);
  }
});
