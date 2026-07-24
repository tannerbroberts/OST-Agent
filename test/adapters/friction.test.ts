import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fileFriction, FRICTION_KINDS } from "../../src/adapters/friction.js";
import { defaultConfigYaml } from "../../src/config/schema.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-friction-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const inbox = () => path.join(dir, ".ost-agent", "inbox");

describe("fileFriction", () => {
  test("drops a note into the vault's configured inbox", () => {
    const written = fileFriction(dir, { kind: "blocked", note: "Could not find the vault from the repo" });

    expect(written.startsWith(inbox())).toBe(true);
    expect(fs.existsSync(written)).toBe(true);
    const body = fs.readFileSync(written, "utf8");
    expect(body).toContain("blocked");
    expect(body).toContain("Could not find the vault from the repo");
  });

  test("records the context and who filed it when given", () => {
    const written = fileFriction(dir, {
      kind: "guessed",
      note: "Guessed the inbox path",
      context: "no docs link the repo to its vault",
      source: "builder-loop",
    });

    const body = fs.readFileSync(written, "utf8");
    expect(body).toContain("no docs link the repo to its vault");
    expect(body).toContain("builder-loop");
  });

  test("never overwrites an earlier filing of the same friction", () => {
    const first = fileFriction(dir, { kind: "blocked", note: "Same wording twice" });
    const second = fileFriction(dir, { kind: "blocked", note: "Same wording twice" });

    expect(second).not.toBe(first);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
  });

  test("rejects an empty note", () => {
    expect(() => fileFriction(dir, { kind: "blocked", note: "   " })).toThrow(/note/i);
  });

  test("rejects an unknown kind and names the ones it accepts", () => {
    expect(() => fileFriction(dir, { kind: "vibes" as never, note: "x" })).toThrow(/blocked/);
  });

  test("redacts secrets pasted into a note", () => {
    const written = fileFriction(dir, {
      kind: "blocked",
      note: "auth failed with Bearer abcDEF123456ghijkl",
    });

    const body = fs.readFileSync(written, "utf8");
    expect(body).not.toContain("abcDEF123456ghijkl");
    expect(body).toContain("[redacted]");
  });

  test("creates the inbox directory when the vault has never received a note", () => {
    fs.rmSync(inbox(), { recursive: true, force: true });

    const written = fileFriction(dir, { kind: "unclear-rule", note: "Which layer does this belong to?" });

    expect(fs.existsSync(written)).toBe(true);
  });

  test("offers exactly the kinds the agent is told to use", () => {
    expect([...FRICTION_KINDS]).toEqual(["blocked", "guessed", "unclear-rule", "missing-affordance", "slow"]);
  });
});
