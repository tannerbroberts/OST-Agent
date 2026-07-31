/**
 * The agent's own filings move from channel zero to the `friction` channel —
 * without re-ingesting, losing or orphaning the filings already sitting in the old
 * place.
 *
 * Two defects are pinned here. The first is that the `friction` channel was always
 * empty, so the distinction it exists to draw did not exist. The second is the
 * serious one: since `init` began writing an escaping `adapters.inbox.path`, a
 * filing written to channel zero landed OUTSIDE the git working tree — the exact
 * loss `FRICTION_CHANNEL`'s doc comment says the channel exists to prevent.
 *
 * The migration assertions build the old shape by hand rather than by running an
 * old version: a friction note in channel zero's folder with an `INBOX:<date>-…`
 * id, and a pre-timestamp `{cursor}` state file that has already seen it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fileFriction } from "../../src/adapters/friction.js";
import {
  CHANNEL_ZERO,
  FRICTION_CHANNEL,
  channelIdPrefix,
  isInsideVault,
  resolveChannels,
} from "../../src/adapters/channels.js";
import { InboxSource } from "../../src/adapters/inbox.js";
import { loadCursor, loadCursorRecord } from "../../src/adapters/source.js";
import { classifyProvenance } from "../../src/knowledge/believability.js";
import { loadConfig } from "../../src/config/load.js";
import { initVault } from "../../src/runner/init.js";

let parent: string;
let dir: string;

beforeEach(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-friction-chan-"));
  dir = path.join(parent, "vault");
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

function channel(name: string) {
  const found = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === name);
  if (!found) throw new Error(`no channel ${name}`);
  return found;
}

/** A state file in exactly the shape every version before timestamps wrote. */
function writeLegacyCursor(name: string, seenIds: string[]) {
  const state = path.join(dir, ".ost-agent", "state");
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, `${name}.json`), JSON.stringify({ cursor: JSON.stringify(seenIds) }), "utf8");
}

async function offeredIds(name: string): Promise<string[]> {
  const c = channel(name);
  const { items } = await new InboxSource({ dir: c.dir, channel: c.name }).fetchSince(loadCursor(dir, c.name));
  return items.map((i) => i.id);
}

describe("a filing lands in the friction channel, inside the git working tree", () => {
  test("it is written inside the vault even though channel zero now escapes it", () => {
    const written = fileFriction(dir, { kind: "blocked", note: "The ruleset does not say which layer this is" });

    expect(written.startsWith(channel(FRICTION_CHANNEL).dir)).toBe(true);
    // The consequence, not the mechanism: the filing is somewhere the vault's own
    // `git add -A` will commit it.
    expect(isInsideVault(dir, written)).toBe(true);

    // Non-vacuity, and the defect itself: channel zero in a freshly-initialised
    // vault is outside the working tree, so the old destination really would have
    // put this file where git never sees it.
    expect(isInsideVault(dir, channel(CHANNEL_ZERO).dir)).toBe(false);
    expect(fs.existsSync(channel(CHANNEL_ZERO).dir) && fs.readdirSync(channel(CHANNEL_ZERO).dir).length).toBe(0);
  });

  test("the friction channel stops being empty, and gets its own id namespace", async () => {
    fileFriction(dir, { kind: "guessed", note: "Guessed the vault path" });

    const ids = await offeredIds(FRICTION_CHANNEL);
    expect(ids).toHaveLength(1);
    expect(ids[0].startsWith(channelIdPrefix(FRICTION_CHANNEL))).toBe(true);
    expect(ids[0]).toMatch(/^INBOX:friction\//);

    // Non-vacuity on both halves: channel zero offers nothing, and its prefix is
    // still the bare frozen one — so the namespace above is the friction channel's
    // and not something every drop folder would have produced.
    expect(await offeredIds(CHANNEL_ZERO)).toEqual([]);
    expect(channelIdPrefix(CHANNEL_ZERO)).toBe("INBOX:");
  });
});

describe("filings already sitting in channel zero are left exactly where they are", () => {
  /** The old shape: a filing in channel zero, and a cursor that has already seen it. */
  function plantOldFiling(filename = "2026-01-01-friction-had-to-guess-the-path.md"): string {
    const zero = channel(CHANNEL_ZERO);
    fs.mkdirSync(zero.dir, { recursive: true });
    const file = path.join(zero.dir, filename);
    fs.writeFileSync(file, "# Friction (guessed): had to guess the path\n", "utf8");
    return `${channelIdPrefix(CHANNEL_ZERO)}${filename}`;
  }

  test("they are not re-ingested: the old cursor still covers them", async () => {
    const oldId = plantOldFiling();
    writeLegacyCursor(CHANNEL_ZERO, [oldId]);

    fileFriction(dir, { kind: "blocked", note: "A new one, filed after the move" });

    // The whole risk of moving where new filings land: an id that changes shape is
    // an id no cursor matches, and every old filing re-enters the tree as new.
    expect(await offeredIds(CHANNEL_ZERO)).toEqual([]);
    expect(loadCursor(dir, CHANNEL_ZERO)).toContain(oldId);

    // Non-vacuity: the same channel with the same folder DOES offer a note the
    // cursor has not seen, so "nothing offered" is the cursor working rather than
    // channel zero having stopped being read.
    const unseen = plantOldFiling("2026-01-02-friction-a-filing-nobody-ingested.md");
    expect(await offeredIds(CHANNEL_ZERO)).toEqual([unseen]);
  });

  test("they are not lost: an old filing never ingested is still offered by channel zero", async () => {
    const stranded = plantOldFiling("2026-01-03-friction-never-ingested.md");
    writeLegacyCursor(CHANNEL_ZERO, []); // fetched once, stored nothing

    fileFriction(dir, { kind: "slow", note: "Filed after the move" });

    // Moving the destination must not strand what the old destination still holds.
    expect(await offeredIds(CHANNEL_ZERO)).toEqual([stranded]);
    // …and the new filing is offered by its own channel in the same breath.
    expect((await offeredIds(FRICTION_CHANNEL))[0]).toMatch(/^INBOX:friction\//);
  });

  test("they are not orphaned: an old id is still exactly what channel zero mints today", async () => {
    const oldId = plantOldFiling();
    // A node in the tree cites `INBOX:<file>.md`. Nothing renames the file and
    // nothing changes channel zero's prefix, so the citation resolves to the same
    // record it always did — which is why this move is not a data event.
    writeLegacyCursor(CHANNEL_ZERO, []);
    expect(await offeredIds(CHANNEL_ZERO)).toEqual([oldId]);
    expect(fs.existsSync(path.join(channel(CHANNEL_ZERO).dir, oldId.slice("INBOX:".length)))).toBe(true);
  });

  test("the two channels keep separate cursors — neither consumes the other's watermark", () => {
    const oldId = plantOldFiling();
    writeLegacyCursor(CHANNEL_ZERO, [oldId]);
    fileFriction(dir, { kind: "blocked", note: "Filed after the move" });

    // The friction channel has never been fetched, so it has no state file at all;
    // channel zero's is untouched by the filing.
    expect(loadCursorRecord(dir, FRICTION_CHANNEL)).toBeNull();
    expect(loadCursor(dir, CHANNEL_ZERO)).toBe(JSON.stringify([oldId]));

    // Non-vacuity: the two names really are two different files on disk.
    expect(path.join(dir, ".ost-agent", "state", `${FRICTION_CHANNEL}.json`)).not.toBe(
      path.join(dir, ".ost-agent", "state", `${CHANNEL_ZERO}.json`),
    );
  });
});

/**
 * B12 — "the sole provenance rule that rises above the floor on the builder's only
 * channel reads a string the builder chooses" — is fixed here. The channel move made
 * the fix expressible; these assertions are what make it hold.
 *
 * The rule is the same rule. Only its key changed: from the word `friction` anywhere in
 * the id (which is `INBOX:${filename}`, so the builder wrote it) to the leading
 * `friction/` segment, which `channelIdPrefix` mints from the channel's own name.
 */
describe("the rung above the floor is keyed on the channel, not on the filename", () => {
  test("a real filing still reaches 'stated', by way of the segment", async () => {
    fileFriction(dir, { kind: "blocked", note: "Which layer is this" });
    const [id] = await offeredIds(FRICTION_CHANNEL);

    expect(id.startsWith(channelIdPrefix(FRICTION_CHANNEL))).toBe(true);
    expect(classifyProvenance(id)).toBe("stated");

    // Non-vacuity: an inbox id without the segment does not reach that rung, so the
    // assertion above is about the rule and not about every INBOX id passing.
    expect(classifyProvenance("INBOX:2026-01-01-founder-theory.md")).toBe("assertion");
  });

  test("the filename the builder chooses no longer buys a rung", async () => {
    // The exact reproduction B12 was filed on: the builder drops a file it named
    // itself into channel zero. It used to land above the floor. It no longer can,
    // because the segment is minted from the channel and a filename cannot contain a
    // slash — so channel zero has no spelling that reaches the rule.
    const zero = channel(CHANNEL_ZERO);
    fs.mkdirSync(zero.dir, { recursive: true });
    fs.writeFileSync(path.join(zero.dir, "my-notes-on-friction.md"), "not a filing\n", "utf8");
    const [forged] = await offeredIds(CHANNEL_ZERO);
    expect(forged).toBe("INBOX:my-notes-on-friction.md");
    expect(forged.startsWith(channelIdPrefix(FRICTION_CHANNEL))).toBe(false);
    expect(classifyProvenance(forged)).toBe("assertion");
  });

  test("the cost is stated rather than hidden: a pre-move filing reads as an assertion", () => {
    // A filing made before the friction channel existed lives in channel zero under a
    // name containing the word, and now falls to the floor. That is the honest answer —
    // such an id is byte-for-byte something the builder could have written — and it is
    // asserted here so the regression is a decision somebody made rather than a
    // surprise somebody discovers.
    expect(classifyProvenance("INBOX:2026-01-01-friction-old-shape.md")).toBe("assertion");
  });
});
