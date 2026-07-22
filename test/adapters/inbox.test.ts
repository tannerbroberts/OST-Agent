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
    const src = new InboxSource(dir);

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
    const src = new InboxSource(dir);
    const { items } = await src.fetchSince(null);
    expect(items.map((i) => i.id)).toEqual(["INBOX:a.md"]);
    expect(fs.readdirSync(dir).sort()).toEqual(before); // inbox untouched
  });

  test("missing inbox directory yields no items", async () => {
    const src = new InboxSource(path.join(dir, "does-not-exist"));
    const { items } = await src.fetchSince(null);
    expect(items).toHaveLength(0);
  });
});
