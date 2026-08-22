import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fileFriction, FRICTION_KINDS } from "../../src/adapters/friction.js";
import { FRICTION_CHANNEL, FRICTION_CHANNEL_PATH, resolveChannels } from "../../src/adapters/channels.js";
import { defaultConfigYaml } from "../../src/config/schema.js";
import { loadConfig } from "../../src/config/load.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-friction-"));
  fs.writeFileSync(path.join(dir, "ost.config.yaml"), defaultConfigYaml("Reach 10,000 daily active users"), "utf8");
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Where filings go now: the first-party channel, not channel zero. */
const friction = () => path.join(dir, FRICTION_CHANNEL_PATH);
const channelZero = () => path.join(dir, ".ost-agent", "inbox");

/**
 * The three fields a filing must carry. Spread into the cases below, whose subject
 * is where a filing lands rather than what it says; the fields themselves are the
 * subject of `test/telemetry/self-filed-friction-events.test.ts`.
 */
const ACTIONABLE = {
  tool: "ost-agent check",
  input: "--vault (omitted)",
  expected: "it reads ost.vault.yaml and finds the tree",
} as const;

describe("fileFriction", () => {
  test("drops a note into the vault's friction channel, not into channel zero", () => {
    const written = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "Could not find the vault from the repo" });

    expect(written.startsWith(friction())).toBe(true);
    expect(fs.existsSync(written)).toBe(true);
    const body = fs.readFileSync(written, "utf8");
    expect(body).toContain("blocked");
    expect(body).toContain("Could not find the vault from the repo");

    // The distinction the friction channel was created to draw: channel zero is
    // where the untrusted builder writes, and nothing the agent files lands there.
    expect(fs.existsSync(channelZero())).toBe(false);
  });

  test("records the context and who filed it when given", () => {
    const written = fileFriction(dir, {
      ...ACTIONABLE,
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
    const first = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "Same wording twice" });
    const second = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "Same wording twice" });

    expect(second).not.toBe(first);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
  });

  test("rejects an empty note", () => {
    expect(() => fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "   " })).toThrow(/note/i);
  });

  test("rejects an unknown kind and names the ones it accepts", () => {
    expect(() => fileFriction(dir, { ...ACTIONABLE, kind: "vibes" as never, note: "x" })).toThrow(/blocked/);
  });

  test("redacts secrets pasted into a note", () => {
    const written = fileFriction(dir, {
      ...ACTIONABLE,
      kind: "blocked",
      note: "auth failed with Bearer abcDEF123456ghijkl",
    });

    const body = fs.readFileSync(written, "utf8");
    expect(body).not.toContain("abcDEF123456ghijkl");
    expect(body).toContain("[redacted]");
  });

  test("creates the friction directory when the vault has never received a filing", () => {
    fs.rmSync(friction(), { recursive: true, force: true });

    const written = fileFriction(dir, { ...ACTIONABLE, kind: "unclear-rule", note: "Which layer does this belong to?" });

    expect(fs.existsSync(written)).toBe(true);
    // Named, not merely existing: a filing that landed anywhere at all would satisfy
    // `existsSync`, and the folder this test is about is the one that had to be made.
    expect(written.startsWith(friction())).toBe(true);
  });

  /**
   * A config that will not parse is one of the things most worth filing friction
   * about, so filing must survive it. It can, because the friction channel's folder
   * is a code constant rather than a config value.
   */
  test("files against a broken config, and against no config at all", () => {
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), "adapters:\n  inbox:\n    cadence: soon\n", "utf8");
    const broken = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "ost.config.yaml will not parse" });
    expect(broken.startsWith(friction())).toBe(true);

    fs.rmSync(path.join(dir, "ost.config.yaml"));
    const absent = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "there is no config here at all" });
    expect(absent.startsWith(friction())).toBe(true);

    // Non-vacuity: the two filings are distinct files that really exist, so the
    // assertions above are about where they landed and not about a path string.
    expect(absent).not.toBe(broken);
    expect(fs.existsSync(broken) && fs.existsSync(absent)).toBe(true);
  });

  /**
   * `adapters.inbox.enabled: false` means "the drop-folder adapter is off", and the
   * friction channel follows that switch — for READING. Filing must not follow it.
   * That switch governs ingestion; refusing to write would throw the agent's record
   * away to honour a setting about what gets read, and an unfiled friction is gone
   * while an unread one still sits in git where a person can find it.
   */
  test("files even when the drop-folder adapter is switched off", () => {
    fs.writeFileSync(path.join(dir, "ost.config.yaml"), 'outcome: "X"\nadapters:\n  inbox:\n    enabled: false\n', "utf8");

    const written = fileFriction(dir, { ...ACTIONABLE, kind: "blocked", note: "filed while the adapter is switched off" });
    expect(written.startsWith(friction())).toBe(true);
    expect(fs.readFileSync(written, "utf8")).toContain("switched off");

    // Non-vacuity: the switch really is off in the config this filing was resolved
    // against — the friction channel comes back not-enabled, and it was written
    // anyway. Without this the assertion above passes on any config at all.
    const channel = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === FRICTION_CHANNEL);
    expect(channel?.enabled).toBe(false);
  });

  test("offers exactly the kinds the agent is told to use", () => {
    expect([...FRICTION_KINDS]).toEqual(["blocked", "guessed", "unclear-rule", "missing-affordance", "slow"]);
  });
});
