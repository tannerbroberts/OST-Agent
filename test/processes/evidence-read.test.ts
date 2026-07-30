/**
 * `readEvidence` degrades one record at a time.
 *
 * The evidence directory is fed by an untrusted builder by design — that is what an
 * inbox is. `ost_next_work` is the only tool the unattended sweep gates on, and it
 * cannot compute anything without this read, so one file that gray-matter cannot parse
 * used to be a denial of service on the entire sweep: not a lost record, a lost pass,
 * every pass, until a human noticed and deleted the file by hand.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-evidence-"));
  for (const n of [1, 2]) {
    writeEvidence(
      dir,
      {
        id: `INBOX:note-${n}.md`,
        source: `INBOX:note-${n}.md`,
        title: `note ${n}`,
        timestamp: "2026-07-29T00:00:00Z",
        body: `Body ${n}.`,
      },
      "inbox",
    );
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Drop a raw file into the evidence directory, as an inbox builder would. */
function writeRaw(name: string, content: string): void {
  fs.writeFileSync(path.join(dir, ".ost-agent", "evidence", name), content, "utf8");
}

/**
 * Malformed frontmatter, distinct per call.
 *
 * The `tag` is not decoration: gray-matter memoizes on the content string and populates
 * that cache *before* parsing, so the same malformed bytes throw the first time they are
 * seen in a process and return a junk record every time after. Reusing one fixture
 * across tests would make them order-dependent and quietly stop exercising the throw.
 */
function malformed(tag: string): string {
  return `---\n${tag}: [unclosed\n---\nbody\n`;
}

describe("readEvidence survives a malformed record", () => {
  test("unparseable frontmatter costs one record, not the read", () => {
    writeRaw("bad.md", malformed("foo"));
    expect(readEvidence(dir)).toHaveLength(2);
  });

  test("the surviving records are intact, not just counted", () => {
    writeRaw("bad.md", malformed("intact"));
    const records = readEvidence(dir);
    expect(records.map((e) => e.id).sort()).toEqual(["INBOX:note-1.md", "INBOX:note-2.md"]);
    expect(records.find((e) => e.id === "INBOX:note-1.md")?.body).toBe("Body 1.");
  });

  test("a malformed file cannot starve the read even when it sorts first", () => {
    // readdir order is not guaranteed, so a throwing file must not be able to take the
    // records after it down with it — an early failure that kept only the ones already
    // pushed would still lose the rest of the directory.
    writeRaw("aaa.md", malformed("first"));
    writeRaw("zzz.md", malformed("last"));
    expect(readEvidence(dir)).toHaveLength(2);
  });

  test("missing frontmatter still degrades to defaults rather than being dropped", () => {
    // The pre-existing behaviour, pinned here so the new try/catch cannot quietly
    // widen into discarding merely *sparse* records.
    writeRaw("plain.md", "just a body, no frontmatter at all\n");
    const rec = readEvidence(dir).find((e) => e.id === "plain.md");
    expect(rec?.body).toBe("just a body, no frontmatter at all");
    expect(rec?.title).toBe("plain");
  });
});
