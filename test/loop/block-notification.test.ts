/**
 * "Announce the wait on a channel the operator already watches, the moment it
 * starts" — the instrument for that solution node.
 *
 * The node's definition of done names two properties, and this file is split
 * along them:
 *
 *   1. The announcement fires AT THE MOMENT the run blocks, not at the end of
 *      the pass. `ost_flag_humans_required` is the one surface an unattended
 *      pass holds for "a person has to do this" (`src/ost/lanes.ts`), so the
 *      test is that its own return value — read by the agent in the same turn
 *      it filed the block — already carries the announcement. Nothing further
 *      needs to run, and nothing batches it.
 *   2. It carries both payloads the node says make it worth reading: the exact
 *      command that would clear the block, and what is already queued behind
 *      it, read off the standing queue (`src/ost/pending-asks.ts`) at the
 *      moment of filing.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderBlockAnnouncement, renderBlockAnnouncementInstruction } from "../../src/loop/block-announcement.js";
import { defaultClearingCommand } from "../../src/knowledge/asks.js";
import type { PendingAsk } from "../../src/ost/pending-asks.js";
import { Vault } from "../../src/ost/vault.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";

const emptyAsk = (test: string, extra: Partial<PendingAsk> = {}): PendingAsk => ({
  test,
  lane: "humans-required",
  askedAt: null,
  ageDays: null,
  why: "",
  command: "x",
  ...extra,
});

describe("renderBlockAnnouncement — the payload", () => {
  test("carries the exact clearing command, verbatim", () => {
    const command = 'ost-agent result "Interview five players" -v supported -n "did it" -b tanner -u "n/a"';
    const text = renderBlockAnnouncement({ test: "Interview five players", command, why: "a person's reaction is the measurement" }, []);
    expect(text).toContain(command);
  });

  test("names what is queued behind it, excluding the block's own entry", () => {
    const queue = [
      emptyAsk("Interview five players"),
      emptyAsk("Recruit five churned users", { ageDays: 3 }),
      emptyAsk("Sign the pricing survey off", { ageDays: 1 }),
    ];
    const text = renderBlockAnnouncement({ test: "Interview five players", command: "x", why: "needs a person" }, queue);
    expect(text).toContain("2 more queued behind it");
    const behindLine = text.split("\n").find((l) => l.startsWith("2 more queued behind it"))!;
    expect(behindLine).toContain("Recruit five churned users");
    expect(behindLine).toContain("Sign the pricing survey off");
    expect(behindLine).not.toContain("Interview five players"); // not listed among what's "behind" itself
  });

  test("says plainly when nothing else is waiting, rather than a bare count", () => {
    const text = renderBlockAnnouncement({ test: "A test", command: "x", why: "y" }, [emptyAsk("A test")]);
    expect(text).toContain("nothing else queued behind it");
  });
});

describe("renderBlockAnnouncementInstruction — the imperative wrapper", () => {
  test("tells the agent to push it now, not batch it to the end of the pass", () => {
    const text = renderBlockAnnouncementInstruction({ test: "A test", command: "x", why: "y" }, []);
    expect(text).toMatch(/now/i);
    expect(text).toMatch(/not.*end of the pass/i);
    expect(text).toContain(renderBlockAnnouncement({ test: "A test", command: "x", why: "y" }, []));
  });
});

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-block-notify-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), "outcome: x\n", "utf8");
  ctx = { vault: new Vault(dir), dir, remote: { enabled: false } };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (name: string, input: unknown): Promise<string> => {
  const tool = buildOstTools(ctx).find((t) => t.name === name)!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

describe("the moment a run blocks, the tool's own return IS the announcement", () => {
  test("ost_flag_humans_required's return carries the command and the queue in the same call that filed the block", async () => {
    ctx.vault.createNode({ title: "Interview five players", layer: "AssumptionTest", tags: [], links: [], body: "t" });

    const said = await run("ost_flag_humans_required", {
      test: "Interview five players",
      why: 'names an outside person: "Interview"',
    });

    // Red today: the tool's return names only the lane change, not an
    // announcement — nothing tells the agent to act, and nothing carries the
    // command or the queue, so the wait is discoverable only by going to look.
    expect(said).toContain("ANNOUNCE THIS NOW");
    expect(said).toContain(defaultClearingCommand("Interview five players"));
    expect(said).toContain("nothing else queued behind it");
  });

  test("a second block filed after the first shows up as queued behind it, still inside the tool's own return", async () => {
    ctx.vault.createNode({ title: "First test", layer: "AssumptionTest", tags: [], links: [], body: "t" });
    ctx.vault.createNode({ title: "Second test", layer: "AssumptionTest", tags: [], links: [], body: "t" });

    await run("ost_flag_humans_required", { test: "First test", why: "needs a person" });
    const said = await run("ost_flag_humans_required", { test: "Second test", why: "needs a person" });

    expect(said).toContain("1 more queued behind it: First test");
  });
});
