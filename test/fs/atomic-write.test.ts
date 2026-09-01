/**
 * A node write replaces the file; it never truncates it.
 *
 * This is the "no half-written state" half of the resumable-journal work, and
 * it is checked structurally rather than by racing a kill against a write. The
 * race is not measurable here: 64MB through `writeFileSync` lands in 23ms on
 * the machine this was written on, because the bytes go to the page cache, so
 * the window a killer would have to hit is sub-millisecond and a test aimed at
 * it would be a coin toss dressed as an assertion.
 *
 * What IS decidable, exactly and cheaply, is whether the write went through a
 * rename: a file replaced by `rename(2)` has a new inode, and a file written in
 * place keeps the one it had. So each test below writes and then asks the
 * filesystem which of those happened. A regression that puts `fs.writeFileSync`
 * back on the target reddens here on the first run rather than on the first
 * unlucky kill.
 *
 * `kill-restart-idempotence.test.ts` is the other end of the same property: it
 * kills a real pass at twenty points and asserts the vault is whole. Its kills
 * land between operations, which is precisely why it cannot see this one.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TEMP_WRITE_SUFFIX, sweepAbandonedWrites, temporaryWritePath } from "../../src/fs/atomic-write.js";
import { Vault } from "../../src/ost/vault.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-atomic-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const node = (title: string): OstNode => ({
  title,
  layer: "Opportunity",
  status: "unvalidated",
  evidence: "assertion",
  tags: ["unvalidated"],
  links: [],
  body: "A need.",
});

function inode(file: string): number {
  return fs.statSync(file).ino;
}

describe("the staging path", () => {
  test("is hidden, beside the target, and not a node file", () => {
    const target = path.join(dir, "Some node.md");
    const staged = temporaryWritePath(target);

    expect(path.dirname(staged), "a rename is only atomic within a filesystem").toBe(dir);
    expect(path.basename(staged).startsWith("."), "a visible staging file is one an editor offers to open").toBe(true);
    expect(staged.endsWith(".md"), "the vault census enumerates *.md — a staging file must not be one").toBe(false);
    expect(staged.endsWith(TEMP_WRITE_SUFFIX)).toBe(true);
    expect(staged, "the writing process must be identifiable from the name").toContain(String(process.pid));
  });
});

describe("every node write lands by rename", () => {
  test("appending to a node replaces the file instead of rewriting it in place", () => {
    const vault = new Vault(dir);
    vault.createNode(node("Alpha"));
    const file = path.join(dir, "Alpha.md");
    const before = inode(file);

    vault.appendToNode("Alpha", "## Finding\n\nSomething observed.");

    expect(inode(file), "the file was written in place — a kill mid-write would truncate it").not.toBe(before);
    expect(fs.readFileSync(file, "utf8")).toContain("Something observed.");
  });

  test("editing prose — the one write that carries a drift hash — replaces the file too", () => {
    const vault = new Vault(dir);
    vault.createNode(node("Beta"));
    const file = path.join(dir, "Beta.md");
    const before = inode(file);

    vault.editProse("Beta", "A need, restated.", "the first wording was wrong");

    expect(inode(file), "editProse writes through writeWithHash — it needs the same atomicity").not.toBe(before);
    expect(fs.readFileSync(file, "utf8")).toContain("A need, restated.");
  });

  test("no staging file survives a write that completed", () => {
    const vault = new Vault(dir);
    vault.createNode(node("Gamma"));
    vault.appendToNode("Gamma", "## Finding\n\nSomething else.");

    expect(fs.readdirSync(dir).filter((n) => n.endsWith(TEMP_WRITE_SUFFIX))).toEqual([]);
  });
});

describe("sweeping what a killed write left behind", () => {
  /** A pid that has certainly exited: a process run to completion, by its own report. */
  function deadPid(): number {
    const r = spawnSync(process.execPath, ["-e", "process.stdout.write(String(process.pid))"], { encoding: "utf8" });
    return Number(r.stdout.trim());
  }

  test("a staging file whose writer is gone is residue, and is removed", () => {
    const orphan = path.join(dir, `.Alpha.md.${deadPid()}${TEMP_WRITE_SUFFIX}`);
    fs.writeFileSync(orphan, "half a node");

    expect(sweepAbandonedWrites(dir)).toEqual([path.basename(orphan)]);
    expect(fs.existsSync(orphan)).toBe(false);
  });

  test("a staging file whose writer is alive is left alone", () => {
    // The live case is a second process mid-write, which is the one thing a
    // sweeper must never touch: its rename is still coming.
    const live = path.join(dir, `.Alpha.md.${process.pid}${TEMP_WRITE_SUFFIX}`);
    fs.writeFileSync(live, "a write in progress");

    expect(sweepAbandonedWrites(dir)).toEqual([]);
    expect(fs.existsSync(live)).toBe(true);
  });

  test("it removes nothing else, whatever the name looks like", () => {
    const keep = [
      "Alpha.md", // a node
      ".hidden.md", // a hidden node file
      "notes.ost-tmp", // right suffix, not hidden, no pid — not ours
      `.Alpha.md.notapid${TEMP_WRITE_SUFFIX}`, // ours in shape, but names no writer
    ];
    for (const name of keep) fs.writeFileSync(path.join(dir, name), "x");

    expect(sweepAbandonedWrites(dir)).toEqual([]);
    expect(fs.readdirSync(dir).sort()).toEqual([...keep].sort());
  });

  test("a directory that does not exist is not residue", () => {
    expect(sweepAbandonedWrites(path.join(dir, "nowhere"))).toEqual([]);
  });
});

describe("the vault a killed write leaves behind", () => {
  test("a staging file is invisible to the tree census", () => {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    const vault = new Vault(dir);
    vault.createNode(node("Delta"));
    fs.writeFileSync(path.join(dir, `.Delta.md.999999${TEMP_WRITE_SUFFIX}`), "half a node");

    const census = vault.readTreeCensus();
    expect(census.nodes.map((n) => n.title)).toEqual(["Delta"]);
    // Not a node, not a quarantine, not an unreadable file, not even a drop: the
    // census never enumerated it, which is the point of the naming rule.
    expect([...census.skipped, ...census.unreadable].map((d) => d.file)).toEqual([]);
    expect(census.quarantined).toEqual([]);
  });
});
