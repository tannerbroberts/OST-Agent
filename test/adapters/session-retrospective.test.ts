/**
 * The end-of-session retrospective — pinned against the design question the
 * node says this candidate has to survive: whether it can stay silent
 * credibly.
 *
 * The solution ("End-of-session retrospective the agent must write before the
 * session closes") is not "In-the-moment friction events filed by the agent":
 * that sibling fires at the moment of pain, which is exactly when a conceptual
 * mistake is invisible. This channel is the after-the-fact one — a confession
 * of the wrong turn a session took, filed at the close — and its own prose
 * names the property this spec has to prove real:
 *
 * 1. a session with nothing conceptual to report produces NO inbox item — not
 *    a "nothing notable" one. The channel's existing problem is volume without
 *    signal (82 mechanical friction events, none useful); a mechanism that adds
 *    a mostly-empty item per session makes that worse, not better.
 * 2. a retrospective that IS written lands with the session id as provenance,
 *    and enters the tree at the `assertion` floor as self-report, exactly like
 *    every other drop-folder note.
 *
 * What a green here does NOT settle, verbatim from the node: every bias in
 * self-report runs the wrong way — under-reporting, written to look competent,
 * thinnest exactly where the session went worst. A spec can force the field to
 * exist and cannot make it honest; only "Check three past pass notes for the
 * wrong turn they left out" (a human, reading the record before the note) can
 * catch a fluent, silent omission.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { fileRetrospective } from "../../src/adapters/retrospective.js";
import { RETROSPECTIVE_CHANNEL, RETROSPECTIVE_CHANNEL_PATH, channelIdPrefix, resolveChannels } from "../../src/adapters/channels.js";
import { InboxSource } from "../../src/adapters/inbox.js";
import { loadCursor } from "../../src/adapters/source.js";
import { readEvidence, writeEvidence } from "../../src/processes/tree.js";
import { evidenceActors, readTrustLedger, sourceStanding } from "../../src/knowledge/actor-trust.js";
import { FLOOR_RUNG } from "../../src/knowledge/believability.js";
import { loadConfig } from "../../src/config/load.js";
import { initVault } from "../../src/runner/init.js";

let parent: string;
let dir: string;

beforeEach(async () => {
  parent = fs.mkdtempSync(path.join(os.tmpdir(), "ost-retro-"));
  dir = path.join(parent, "vault");
  await initVault(dir, "Reach ten returning operators.", "Retention");
});
afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

const retroDir = () => path.join(dir, RETROSPECTIVE_CHANNEL_PATH);

describe("the retrospective channel", () => {
  test("is first-party, inside the vault, and follows the inbox switch", () => {
    const channel = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === RETROSPECTIVE_CHANNEL);
    expect(channel).toBeDefined();
    expect(channel?.origin).toBe("first-party");
    expect(channel?.dir).toBe(path.join(dir, ".ost-agent", "retrospectives"));
    expect(channelIdPrefix(RETROSPECTIVE_CHANNEL)).toBe("INBOX:retrospective/");
  });
});

describe("staying silent credibly: no shape exists for 'nothing notable'", () => {
  test("a session with nothing conceptual to report never calls fileRetrospective, and the channel stays empty", () => {
    // `init` makes every enabled channel's folder up front (same as friction and
    // deposit), so the directory existing proves nothing here — the behaviour
    // under test is that nothing in this module offers a "notable: false" or
    // "summary" call shape a caller could reach for instead of just not calling
    // it, so a quiet session leaves the folder with no files in it at all.
    expect(fs.existsSync(retroDir())).toBe(true);
    expect(fs.readdirSync(retroDir())).toEqual([]);
  });

  test("refuses an empty wrong turn rather than filing a blank confession", () => {
    expect(() => fileRetrospective(dir, { wrongTurn: "   ", session: "s1" })).toThrow(/wrong turn/i);
    expect(fs.readdirSync(retroDir())).toEqual([]);
  });

  test("refuses a wrong turn with no session id — a confession nobody can trace is not filed either", () => {
    expect(() => fileRetrospective(dir, { wrongTurn: "assumed the wrong file layout", session: "  " })).toThrow(/session/i);
    expect(fs.readdirSync(retroDir())).toEqual([]);
  });

  test("a real confession is filed, and an earlier one is never replaced", () => {
    const first = fileRetrospective(dir, { wrongTurn: "Chased a red gate for an hour before profiling it", session: "s1" });
    const second = fileRetrospective(dir, { wrongTurn: "Chased a red gate for an hour before profiling it", session: "s2" });
    expect(second).not.toBe(first);
    expect(fs.existsSync(first)).toBe(true);
    expect(fs.existsSync(second)).toBe(true);
  });
});

describe("what is written carries the session id as provenance", () => {
  test("with a pinned clock the file names the session, the wrong turn, and (optionally) the cost and the lesson", () => {
    const written = fileRetrospective(dir, {
      wrongTurn: "Treated a wall-clock flake as CI noise instead of profiling it",
      session: "85dcb89b-44be-4fd0-8b0f-835a0a12758c",
      cost: "about 40 minutes re-running the same red gate",
      wouldHaveNeeded: "to know a 5-minute profile settles this class of failure before blaming the runner",
      at: "2026-08-12T09:00:00.000Z",
    });
    const body = fs.readFileSync(written, "utf8");
    expect(body).toContain("85dcb89b-44be-4fd0-8b0f-835a0a12758c");
    expect(body).toContain("Treated a wall-clock flake as CI noise instead of profiling it");
    expect(body).toContain("about 40 minutes re-running the same red gate");
    expect(body).toContain("5-minute profile settles this class of failure");
    expect(body).toContain("**assertion**");
  });

  test("cost and would-have-needed are optional — a bare confession is still filed", () => {
    const written = fileRetrospective(dir, { wrongTurn: "Assumed the config key existed without checking the schema", session: "s3" });
    const body = fs.readFileSync(written, "utf8");
    expect(body).toContain("Assumed the config key existed without checking the schema");
    expect(body).not.toContain("**Cost:**");
    expect(body).not.toContain("**Would have needed:**");
  });

  test("redacts secrets pasted into any field", () => {
    const written = fileRetrospective(dir, {
      wrongTurn: "Logged the request with Bearer abcDEF123456ghijkl still in it",
      session: "s4",
    });
    const body = fs.readFileSync(written, "utf8");
    expect(body).not.toContain("abcDEF123456ghijkl");
    expect(body).toContain("[redacted]");
  });
});

describe("a retrospective enters at the assertion floor, like any other drop-folder note", () => {
  async function ingestAll(): Promise<string[]> {
    const channel = resolveChannels(dir, loadConfig(dir)).channels.find((c) => c.name === RETROSPECTIVE_CHANNEL)!;
    const source = new InboxSource({ dir: channel.dir, channel: channel.name });
    const { items } = await source.fetchSince(loadCursor(dir, channel.name));
    for (const item of items) writeEvidence(dir, item, source.actor);
    return items.map((i) => i.id);
  }

  test("the ingesting surface stamps actor 'inbox', with the session id readable in the body", async () => {
    fileRetrospective(dir, { wrongTurn: "Built the whole surface before checking the definition of done", session: "s5" });
    const [id] = await ingestAll();
    expect(id).toMatch(/^INBOX:retrospective\//);

    const record = readEvidence(dir).find((r) => r.id === id);
    expect(record?.actor).toBe("inbox");
    expect(record?.body).toContain("s5");

    const ledger = readTrustLedger(dir);
    expect(sourceStanding(ledger, id, evidenceActors(dir))).toBe(FLOOR_RUNG);
    expect(FLOOR_RUNG).toBe("assertion");
  });

  test("a session that stayed silent contributes nothing to ingest — zero items, not a placeholder", async () => {
    const ids = await ingestAll();
    expect(ids).toEqual([]);
  });
});
