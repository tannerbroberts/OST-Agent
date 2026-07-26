/**
 * The product-repo reader: read-only, confined to configured roots (symlink
 * escapes refused), listings skip vendor noise, file content is capped and
 * secret-redacted. The agent can see what the product IS — nothing more.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readProductRepo, MAX_FILE_CHARS } from "../../src/product/repo.js";

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ost-repo-"));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), "ost-outside-"));
  fs.mkdirSync(path.join(root, "src"));
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, "README.md"), "# The Game\nA match-3 game.");
  fs.writeFileSync(path.join(root, "src", "acquisition.ts"), 'export const API_KEY = "sk-live-abcdef1234567890";\nexport function invite() {}');
  fs.writeFileSync(path.join(outside, "secret.txt"), "outside the fence");
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "escape.txt"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe("readProductRepo", () => {
  test("no repos configured is a setup error naming the config key", () => {
    expect(() => readProductRepo([], {})).toThrow(/product\.repos/);
  });

  test("lists the root when no path is given, skipping .git and node_modules", () => {
    const r = readProductRepo([root], {});
    expect(r.kind).toBe("listing");
    const names = (r.entries ?? []).map((e) => e.name);
    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(names).not.toContain(".git");
    expect(names).not.toContain("node_modules");
  });

  test("reads a file with secrets redacted", () => {
    const r = readProductRepo([root], { path: "src/acquisition.ts" });
    expect(r.kind).toBe("file");
    expect(r.text).toContain("export function invite");
    expect(r.text).not.toContain("sk-live-abcdef1234567890");
    expect(r.text).toContain("[redacted]");
  });

  test("caps file content and marks truncation", () => {
    fs.writeFileSync(path.join(root, "big.txt"), "y".repeat(MAX_FILE_CHARS + 5000));
    const r = readProductRepo([root], { path: "big.txt" });
    expect(r.text?.length).toBe(MAX_FILE_CHARS);
    expect(r.truncated).toBe(true);
  });

  test("refuses path traversal out of the root", () => {
    expect(() => readProductRepo([root], { path: "../" })).toThrow(/outside|escape|confine/i);
    expect(() => readProductRepo([root], { path: "../../etc/passwd" })).toThrow(/outside|escape|confine/i);
  });

  test("refuses a symlink that escapes the root", () => {
    expect(() => readProductRepo([root], { path: "escape.txt" })).toThrow(/outside|escape|symlink/i);
  });

  test("with several repos, selects by name; without a selection, lists the repos", () => {
    const second = fs.mkdtempSync(path.join(os.tmpdir(), "ost-repo2-"));
    try {
      fs.writeFileSync(path.join(second, "index.js"), "// second repo");
      const listing = readProductRepo([root, second], {});
      expect(listing.kind).toBe("repos");
      expect(listing.entries?.map((e) => e.name)).toEqual([path.basename(root), path.basename(second)]);
      const file = readProductRepo([root, second], { repo: path.basename(second), path: "index.js" });
      expect(file.text).toContain("second repo");
    } finally {
      fs.rmSync(second, { recursive: true, force: true });
    }
  });

  test("refuses a binary file", () => {
    fs.writeFileSync(path.join(root, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
    expect(() => readProductRepo([root], { path: "img.png" })).toThrow(/binary/i);
  });
});
