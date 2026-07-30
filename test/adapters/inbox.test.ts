import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { InboxSource } from "../../src/adapters/inbox.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-inbox-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("InboxSource", () => {
  test("returns new notes once, then nothing until a new file appears", async () => {
    fs.writeFileSync(path.join(dir, "a.md"), "note a");
    fs.writeFileSync(path.join(dir, "b.txt"), "note b");
    const src = new InboxSource({ dir, channel: "inbox" });

    const first = await src.fetchSince(null);
    expect(first.items.map((i) => i.id).sort()).toEqual(["INBOX:a.md", "INBOX:b.txt"]);
    expect(first.items[0].body).toBeTypeOf("string");

    const second = await src.fetchSince(first.cursor);
    expect(second.items).toHaveLength(0);

    fs.writeFileSync(path.join(dir, "c.md"), "note c");
    const third = await src.fetchSince(second.cursor);
    expect(third.items.map((i) => i.id)).toEqual(["INBOX:c.md"]);
  });

  test("ignores non-text files and never mutates the inbox", async () => {
    fs.writeFileSync(path.join(dir, "a.md"), "note a");
    fs.writeFileSync(path.join(dir, "image.png"), "binary");
    const before = fs.readdirSync(dir).sort();
    const src = new InboxSource({ dir, channel: "inbox" });
    const { items } = await src.fetchSince(null);
    expect(items.map((i) => i.id)).toEqual(["INBOX:a.md"]);
    expect(fs.readdirSync(dir).sort()).toEqual(before); // inbox untouched
  });

  test("missing inbox directory yields no items", async () => {
    const src = new InboxSource({ dir: path.join(dir, "does-not-exist"), channel: "inbox" });
    const { items } = await src.fetchSince(null);
    expect(items).toHaveLength(0);
  });

  test("the channel is what names the cursor file and the id namespace", async () => {
    fs.writeFileSync(path.join(dir, "a.md"), "note a");
    const src = new InboxSource({ dir, channel: "support" });
    expect(src.name).toBe("support");
    expect((await src.fetchSince(null)).items.map((i) => i.id)).toEqual(["INBOX:support/a.md"]);
    // Non-vacuity: channel zero over the same folder still mints the legacy id,
    // which is what stops every existing vault re-ingesting.
    expect((await new InboxSource({ dir, channel: "inbox" }).fetchSince(null)).items.map((i) => i.id)).toEqual([
      "INBOX:a.md",
    ]);
  });

  /**
   * The transitional shim is gone, and this is what replaced it.
   *
   * While it existed, `new InboxSource(dir)` silently meant channel zero. That was
   * the right answer for un-migrated call sites and the wrong one for ever after:
   * once a vault has two drop folders, a positional call is a second channel
   * consuming the first's cursor — S3's bug, re-entering through a compatibility
   * path. It must now FAIL, loudly, at construction rather than at the first
   * mismatched watermark.
   */
  test("a legacy positional call is refused rather than silently meaning channel zero", () => {
    fs.writeFileSync(path.join(dir, "a.md"), "note a");
    const positional = () => new (InboxSource as unknown as new (d: string) => InboxSource)(dir);
    expect(positional).toThrow();
    // Non-vacuity: the same folder with the channel named builds fine, so the throw
    // is about the missing channel and not about the fixture.
    expect(() => new InboxSource({ dir, channel: "inbox" })).not.toThrow();
  });
});
