/**
 * S3 — two commissioned channels at once, with distinct cursors and distinct id
 * namespaces, plus the migration guarantee that pays for it.
 *
 * The criterion explicitly forbids the cheap version ("two evidence files with
 * different prefixes exist", which passes by hand-writing ids). So every assertion
 * below drives the real adapter and the real cursor store, and the one that
 * actually catches the bug is the third: **ingesting from one channel must not
 * consume the other's cursor.** A second `InboxSource` used to share the first's
 * cursor file silently, which is exactly the shape of that failure.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ConfigSchema } from "../../src/config/schema.js";
import { resolveChannels } from "../../src/adapters/channels.js";
import { InboxSource } from "../../src/adapters/inbox.js";
import { loadCursor, loadCursorRecord, saveCursor } from "../../src/adapters/source.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";

let dir: string;
let parent: string;

beforeEach(() => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-two-chan-"));
  dir = path.join(parent, "vault");
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

/** Both channels outside the vault, which is where a new channel has to live. */
function twoChannels() {
  const cfg = ConfigSchema.parse({
    outcome: "X",
    adapters: {
      inbox: {
        path: "../drop-zero",
        channels: [{ name: "support", path: "../drop-support" }],
      },
    },
  });
  const { channels, problems } = resolveChannels(dir, cfg);
  expect(problems).toEqual([]);
  for (const c of channels) fs.mkdirSync(c.dir, { recursive: true });
  // By name, not by position: the resolver also returns the first-party
  // channels (`friction`, `deposit`), and their number is not this test's
  // subject — the two under test are channel zero and the config-declared one.
  return [channels.find((c) => c.name === "inbox")!, channels.find((c) => c.name === "support")!];
}

const cursorFile = (name: string) => path.join(dir, ".ost-agent", "state", `${name}.json`);

/** One ingest of one channel, exactly as the tool does it: fetch, store, save. */
async function ingest(channel: { name: string; dir: string }): Promise<string[]> {
  const source = new InboxSource({ dir: channel.dir, channel: channel.name });
  const previous = loadCursor(dir, source.name);
  const { items, cursor } = await source.fetchSince(previous);
  const stored = items.filter((i) => writeEvidence(dir, i, source.actor));
  saveCursor(dir, source.name, cursor, { delivered: stored });
  return items.map((i) => i.id);
}

describe("two channels, two cursors, two namespaces", () => {
  test("each channel gets its own cursor FILE and its own id PREFIX", async () => {
    const [zero, support] = twoChannels();
    expect(support.name).toBe("support");
    fs.writeFileSync(path.join(zero.dir, "note.md"), "from the operator\n");
    fs.writeFileSync(path.join(support.dir, "note.md"), "from support\n");

    expect(await ingest(zero)).toEqual(["INBOX:note.md"]);
    expect(await ingest(support)).toEqual(["INBOX:support/note.md"]);

    expect(fs.existsSync(cursorFile("inbox"))).toBe(true);
    expect(fs.existsSync(cursorFile("support"))).toBe(true);
    // Non-vacuity: the two files are genuinely different content, not one file
    // read twice — each names only its own channel's ids.
    expect(fs.readFileSync(cursorFile("inbox"), "utf8")).toContain("INBOX:note.md");
    expect(fs.readFileSync(cursorFile("inbox"), "utf8")).not.toContain("INBOX:support/note.md");
    expect(fs.readFileSync(cursorFile("support"), "utf8")).toContain("INBOX:support/note.md");
  });

  /** The part that actually catches the bug the criterion is about. */
  test("ingesting one channel does not consume the other's cursor", async () => {
    const [zero, support] = twoChannels();
    fs.writeFileSync(path.join(zero.dir, "a.md"), "a\n");
    fs.writeFileSync(path.join(support.dir, "b.md"), "b\n");

    await ingest(zero);
    const zeroCursorAfterFirst = fs.readFileSync(cursorFile("inbox"), "utf8");

    // support has still never been fetched, even though an ingest just ran
    expect(loadCursorRecord(dir, "support")).toBeNull();
    // …and it offers its item, rather than believing it was already delivered
    expect(await ingest(support)).toEqual(["INBOX:support/b.md"]);
    // …and doing so left channel zero's cursor byte-identical
    expect(fs.readFileSync(cursorFile("inbox"), "utf8")).toBe(zeroCursorAfterFirst);

    // Non-vacuity: a cursor CAN be consumed — re-ingesting the same channel
    // offers nothing, so "offered its item" above is a real distinction.
    expect(await ingest(support)).toEqual([]);
  });

  /**
   * The assertion the criterion's forbidden cheap version cannot make: the same
   * FILENAME in two channels is two records, because the namespace is stamped by
   * the ingesting surface rather than read off the file.
   */
  test("the same filename in both channels produces two records", async () => {
    const [zero, support] = twoChannels();
    fs.writeFileSync(path.join(zero.dir, "churn.md"), "operator's copy\n");
    fs.writeFileSync(path.join(support.dir, "churn.md"), "support's copy\n");

    await ingest(zero);
    await ingest(support);

    const ids = readEvidence(dir).map((r) => r.id).sort();
    expect(ids).toEqual(["INBOX:churn.md", "INBOX:support/churn.md"]);
    // Non-vacuity: the store really does collapse a repeat — ingesting again adds
    // nothing, so "two records" is about the namespace and not about the writer
    // being incapable of deduplicating.
    await ingest(zero);
    await ingest(support);
    expect(readEvidence(dir)).toHaveLength(2);
  });

  test("every drop folder still stamps one actor — config mints instances, never trust kinds", async () => {
    const [zero, support] = twoChannels();
    fs.writeFileSync(path.join(zero.dir, "a.md"), "a\n");
    fs.writeFileSync(path.join(support.dir, "a.md"), "a\n");
    await ingest(zero);
    await ingest(support);
    // A channel named in YAML must not be able to become a producer identity: the
    // ceiling belongs to the kind, and the kind is decided in source.ts.
    expect(readEvidence(dir).map((r) => r.actor)).toEqual(["inbox", "inbox"]);
  });
});

describe("an existing vault does not re-ingest — the one failure that costs real data", () => {
  /** A vault exactly as every shipped version left it: in-vault folder, `{cursor}` file. */
  async function legacyVault() {
    const legacy = path.join(parent, "legacy");
    const inbox = path.join(legacy, ".ost-agent", "inbox");
    fs.mkdirSync(inbox, { recursive: true });
    fs.mkdirSync(path.join(legacy, ".ost-agent", "state"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "ost.config.yaml"), "outcome: X\n", "utf8");
    fs.writeFileSync(path.join(inbox, "already.md"), "captured last month\n");
    // The old cursor shape, written by hand rather than by the new writer.
    fs.writeFileSync(
      path.join(legacy, ".ost-agent", "state", "inbox.json"),
      JSON.stringify({ cursor: JSON.stringify(["INBOX:already.md"]) }, null, 2),
      "utf8",
    );
    writeEvidence(
      legacy,
      { id: "INBOX:already.md", source: "INBOX:already.md", title: "already", timestamp: "", body: "captured last month" },
      "inbox",
    );
    return { legacy, inbox };
  }

  test("a legacy config + legacy cursor captures nothing new, and the ids keep their shape", async () => {
    const { legacy, inbox } = await legacyVault();
    const cfg = ConfigSchema.parse({ outcome: "X" });
    const zero = resolveChannels(legacy, cfg).channels[0];
    // The resolver points at the folder the vault already has — not a new one.
    expect(zero.dir).toBe(inbox);

    const source = new InboxSource({ dir: zero.dir, channel: zero.name });
    const before = fs.readFileSync(path.join(legacy, ".ost-agent", "state", "inbox.json"), "utf8");
    const { items } = await source.fetchSince(loadCursor(legacy, zero.name));
    expect(items).toEqual([]);
    expect(readEvidence(legacy)).toHaveLength(1);
    // nothing was written to the state file by merely reading it
    expect(fs.readFileSync(path.join(legacy, ".ost-agent", "state", "inbox.json"), "utf8")).toBe(before);

    // Non-vacuity: a note dropped AFTER the cursor was seeded is captured — so
    // "0 new" above is the cursor working, not the ingest doing nothing.
    fs.writeFileSync(path.join(inbox, "fresh.md"), "new today\n");
    const next = await source.fetchSince(loadCursor(legacy, zero.name));
    expect(next.items.map((i) => i.id)).toEqual(["INBOX:fresh.md"]);
  });

  /**
   * The remedy the report offers has to be safe to follow, or it is not a remedy.
   * Ids and cursors are keyed on filenames, never on the folder path.
   */
  test("moving the drop folder outside the vault re-ingests nothing", async () => {
    const { legacy, inbox } = await legacyVault();
    const moved = path.join(parent, "legacy.inbox");
    fs.renameSync(inbox, moved);
    fs.writeFileSync(path.join(legacy, "ost.config.yaml"), 'outcome: X\nadapters:\n  inbox:\n    path: "../legacy.inbox"\n', "utf8");

    const cfg = ConfigSchema.parse({ outcome: "X", adapters: { inbox: { path: "../legacy.inbox" } } });
    const zero = resolveChannels(legacy, cfg).channels[0];
    expect(zero.confined).toBe(true);
    expect(zero.dir).toBe(moved);

    const source = new InboxSource({ dir: zero.dir, channel: zero.name });
    expect((await source.fetchSince(loadCursor(legacy, zero.name))).items).toEqual([]);

    // Non-vacuity: a new note in the NEW location is captured, so "nothing
    // re-ingested" is not "the adapter is reading an empty folder".
    fs.writeFileSync(path.join(moved, "after-the-move.md"), "x\n");
    const next = await source.fetchSince(loadCursor(legacy, zero.name));
    expect(next.items.map((i) => i.id)).toEqual(["INBOX:after-the-move.md"]);
  });
});
