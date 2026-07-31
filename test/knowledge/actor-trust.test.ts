/**
 * The actor-keyed trust ledger: the namespace, the ceilings, and the scoring
 * function. (V1 readiness, B5 and B6.)
 *
 * Every test here is offline and clock-injected — `appendObservation` takes its `now`,
 * and the migration takes none at all because it stamps from the legacy record it
 * folds. A `Date.now()` anywhere in this file would make "why is this host at expert?"
 * a question the suite could not answer twice the same way.
 *
 * Each block carries its own non-vacuity control, named in a comment: the assertion
 * that would fail if the mechanism were removed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  actorKey,
  actorTrustKey,
  appendObservation,
  CORROBORATIONS_FOR_CEILING,
  evidenceActors,
  explainRung,
  historyOf,
  keyString,
  LEGACY_TEST,
  migrateLegacyHostTrust,
  readTrustLedger,
  recordedVerdict,
  resultObservations,
  rungOf,
  sourceTrustKey,
  standings,
  TRUST_CEILINGS,
  TRUST_INITIAL,
  TRUST_KINDS,
  trustLedgerPath,
  tryActorKey,
  webStanding,
  type ActorKey,
  type NewObservation,
} from "../../src/knowledge/actor-trust.js";
import { hostTrustPath } from "../../src/knowledge/web-trust.js";
import { rungRank, type RungId } from "../../src/knowledge/believability.js";
import { ACTORS } from "../../src/adapters/source.js";
import { writeEvidence } from "../../src/processes/tree.js";
import type { OstNode } from "../../src/ost/node.js";

let dir: string;
/** One fixed instant, advanced by hand where ordering matters. Never the wall clock. */
const T0 = new Date("2026-01-01T00:00:00.000Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-actor-trust-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function append(rec: NewObservation, ms = 0): void {
  appendObservation(dir, rec, at(ms));
}
function supported(key: ActorKey, test: string, ms = 0): void {
  append({ ...key, type: "corroboration", test, verdict: "supported", by: "test" }, ms);
}
function rung(key: ActorKey): RungId {
  return rungOf(readTrustLedger(dir), key);
}

const WEB = actorKey("web", "example.com");
const INBOX = actorKey("channel", "inbox");
const TRANSCRIPT = actorKey("instrument", "transcript");
const SPONSOR = actorKey("sponsor", "ignored");

describe("the actor namespace (B6)", () => {
  test("a bare word is not a hostname — the collision that put a pipeline in the publisher namespace", () => {
    expect(() => actorKey("web", "stripe-webhook-feed")).toThrow(/is not a hostname/);
    // Non-vacuity: the guard is not simply refusing everything. A real publisher still
    // takes a row, through the same constructor, with the same normalization.
    expect(keyString(actorKey("web", "https://WWW.Example.com:443/post"))).toBe("web:example.com");
  });

  test("a channel id and an instrument id cannot be swapped, and neither can be invented", () => {
    expect(keyString(actorKey("instrument", "transcript"))).toBe("instrument:transcript");
    // The drop folder cannot enter through the measuring-device ceiling…
    expect(() => actorKey("instrument", "inbox")).toThrow(/not a declared instrument/);
    // …and a name nobody declared takes no row at all.
    expect(() => actorKey("channel", "sponsor")).toThrow(/not a declared channel/);
    // Non-vacuity control: `channel:inbox` itself is accepted.
    expect(keyString(actorKey("channel", "inbox"))).toBe("channel:inbox");
  });

  test("singleton kinds ignore the id they are handed", () => {
    expect(keyString(actorKey("sponsor", "anything at all"))).toBe("sponsor:sponsor");
    expect(keyString(actorKey("unattributed", "inbox"))).toBe("unattributed:unknown");
  });

  test("every declared producer maps to a kind — adding one without a ceiling fails to compile", () => {
    // The compile-time half is the exhaustive switch with no `default` in
    // `actorTrustKey`; this is the runtime half, which proves the map is TOTAL.
    for (const actor of ACTORS) {
      const key = actorTrustKey(actor);
      expect(TRUST_KINDS).toContain(key.kind);
      expect(TRUST_CEILINGS[key.kind]).toBeDefined();
    }
    // Non-vacuity: the map is not collapsing everything onto one kind.
    expect(actorTrustKey("inbox").kind).toBe("channel");
    expect(actorTrustKey("transcript").kind).toBe("instrument");
    expect(actorTrustKey("unknown").kind).toBe("unattributed");
  });

  test("read paths degrade instead of throwing", () => {
    expect(tryActorKey("web", "stripe-webhook-feed")).toBeNull();
    expect(webStanding(readTrustLedger(dir), "not a host")).toBe("assertion");
  });
});

describe("ceilings and initials", () => {
  test("an empty history is the kind's initial, and no initial is above its ceiling", () => {
    const ledger = readTrustLedger(dir);
    for (const kind of TRUST_KINDS) {
      const key = tryActorKey(kind, kind === "web" ? "example.com" : kind === "channel" ? "inbox" : "transcript");
      if (!key) continue;
      expect(rungOf(ledger, key)).toBe(TRUST_INITIAL[key.kind]);
      expect(rungRank(TRUST_INITIAL[kind])).toBeGreaterThanOrEqual(rungRank(TRUST_CEILINGS[kind]));
    }
  });

  test("an instrument starts at 'observed' and can only fall; a publisher can never reach it", () => {
    // B6 check (b), at the ledger: a first-party commissioned pipeline HOLDS observed
    // by construction, with no promotion anywhere.
    expect(rung(TRANSCRIPT)).toBe("observed");
    // …and no amount of corroboration lifts a publisher to a measurement rung.
    for (let i = 0; i < 10; i++) supported(WEB, `test ${i}`, i);
    expect(rung(WEB)).toBe("expert");
    expect(rungRank(rung(WEB))).toBeGreaterThan(rungRank("observed"));
    // Non-vacuity: the same ten observations DO move the host off the floor.
    expect(rung(WEB)).not.toBe("assertion");
  });

  test("no kind's ceiling is 'money', ever", () => {
    for (const kind of TRUST_KINDS) expect(TRUST_CEILINGS[kind]).not.toBe("money");
  });

  /**
   * The clamp, asserted where it is load-bearing rather than where it is decorative.
   *
   * The scorer's intermediate step is `oneRungAbove(initial)`, and for an `instrument`
   * that is one step above `observed` — which is `money`. So the `weakestRung([earned,
   * ceiling])` line is the ONLY thing standing between this ledger and the one rung the
   * module promises it can never reach, and it is reachable with a SINGLE supporting
   * corroboration. The table assertion above cannot see that: `TRUST_CEILINGS.instrument`
   * stays `observed` either way.
   *
   * Measured: deleting the clamp (`return { rung: earned, … }`) leaves every other test
   * in this file green and turns this one red with `expected 'money' to be 'observed'`.
   */
  test("the ceiling clamps the step, not just the destination — one corroboration cannot mint 'money'", () => {
    supported(TRANSCRIPT, "the first one", 0);
    expect(rung(TRANSCRIPT)).toBe("observed");
    supported(TRANSCRIPT, "the second one", 1);
    expect(rung(TRANSCRIPT)).toBe("observed");
    // The property, over every kind and every count either side of the ceiling threshold:
    // no history any writer can produce ever scores above the kind's ceiling.
    for (const key of [WEB, INBOX, TRANSCRIPT, SPONSOR]) {
      for (let i = 0; i <= CORROBORATIONS_FOR_CEILING + 1; i++) {
        supported(key, `climb ${i}`, i);
        expect(rungRank(rung(key)), `${keyString(key)} after ${i + 1} distinct tests`).toBeGreaterThanOrEqual(
          rungRank(TRUST_CEILINGS[key.kind]),
        );
        expect(rung(key)).not.toBe("money");
      }
    }
    // Non-vacuity: the loop is not asserting a bound nothing approaches. Every one of
    // those actors is now sitting exactly ON its ceiling, so the `>=` above is tight.
    for (const key of [WEB, INBOX, TRANSCRIPT, SPONSOR]) expect(rung(key)).toBe(TRUST_CEILINGS[key.kind]);
  });

  test("a channel and the sponsor stop at 'stated'", () => {
    for (let i = 0; i < 10; i++) {
      supported(INBOX, `t${i}`, i);
      supported(SPONSOR, `t${i}`, i);
    }
    expect(rung(INBOX)).toBe("stated");
    expect(rung(SPONSOR)).toBe("stated");
  });
});

describe("the scoring function", () => {
  test("standing is earned by DISTINCT tests — volume buys nothing", () => {
    for (let i = 0; i < 20; i++) supported(WEB, "one test named twenty times", i);
    expect(rung(WEB)).toBe("expert"); // one rung above the floor, which for `web` is the ceiling
    const ledger = readTrustLedger(dir);
    expect(historyOf(ledger, WEB)).toHaveLength(20);
    // Non-vacuity control: twenty DIFFERENT tests would be no better here (the
    // ceiling binds), so the distinctness claim is made where it can be seen — a
    // channel, whose ladder has two steps below its ceiling.
    for (let i = 0; i < 20; i++) supported(INBOX, "one test", i);
    expect(rung(INBOX)).toBe("expert"); // one rung above assertion, NOT the 'stated' ceiling
    for (let i = 0; i < CORROBORATIONS_FOR_CEILING; i++) supported(INBOX, `distinct ${i}`, i);
    expect(rung(INBOX)).toBe("stated");
  });

  test("one refutation is fatal, and it does not need to be recent", () => {
    for (let i = 0; i < 5; i++) supported(WEB, `t${i}`, i);
    expect(rung(WEB)).toBe("expert");
    append({ ...WEB, type: "corroboration", test: "the one that failed", verdict: "refuted", by: "test" }, 10);
    expect(rung(WEB)).toBe("assertion");
    // …and later successes do not wash it out.
    for (let i = 0; i < 5; i++) supported(WEB, `later ${i}`, 20 + i);
    expect(rung(WEB)).toBe("assertion");
  });

  test("'inconclusive' scores nothing in either direction", () => {
    supported(WEB, "a real one", 0);
    const before = rung(WEB);
    append({ ...WEB, type: "corroboration", test: "unclear", verdict: "inconclusive", by: "test" }, 1);
    expect(rung(WEB)).toBe(before);
    // Non-vacuity: a `supported` in the same position DOES move a channel.
    append({ ...INBOX, type: "corroboration", test: "unclear", verdict: "inconclusive", by: "test" }, 1);
    expect(rung(INBOX)).toBe("assertion");
    supported(INBOX, "a real one", 2);
    expect(rung(INBOX)).toBe("expert");
  });

  test("a strike lands at the floor in one call, and only a human's reset clears it", () => {
    for (let i = 0; i < 5; i++) supported(WEB, `t${i}`, i);
    append({ ...WEB, type: "strike", reason: "published a claim that did not replicate", by: "agent:test" }, 10);
    expect(rung(WEB)).toBe("assertion");
    // A later corroboration must NOT climb back out — B11's failure mode wearing a
    // recovery story.
    supported(WEB, "something that worked", 11);
    expect(rung(WEB)).toBe("assertion");
    // The human's route: everything before the reset stops counting, in both directions.
    append({ ...WEB, type: "reset", reason: "reviewed by Tanner; the strike was a mistake", by: "human:tanner" }, 12);
    expect(rung(WEB)).toBe("assertion"); // history cleared: back to the INITIAL, not to expert
    supported(WEB, "earned again", 13);
    expect(rung(WEB)).toBe("expert");
  });

  test("an instrument falls to the floor on a strike, like anything else", () => {
    expect(rung(TRANSCRIPT)).toBe("observed");
    append({ ...TRANSCRIPT, type: "strike", reason: "the harvester wrote sessions that never happened", by: "agent:test" });
    expect(rung(TRANSCRIPT)).toBe("assertion");
  });

  test("monotonicity: no append of a strike or refutation ever raises, no 'supported' ever lowers", () => {
    const keys = [WEB, INBOX, TRANSCRIPT, SPONSOR];
    for (const key of keys) {
      const before = rung(key);
      supported(key, "a", 1);
      const afterSupport = rung(key);
      expect(rungRank(afterSupport)).toBeLessThanOrEqual(rungRank(before)); // never weaker
      append({ ...key, type: "corroboration", test: "b", verdict: "refuted", by: "test" }, 2);
      const afterRefute = rung(key);
      expect(rungRank(afterRefute)).toBeGreaterThanOrEqual(rungRank(afterSupport)); // never stronger
      append({ ...key, type: "strike", reason: "and again", by: "test" }, 3);
      expect(rung(key)).toBe("assertion");
      // The bound that holds over every history: never above the kind's ceiling.
      expect(rungRank(rung(key))).toBeGreaterThanOrEqual(rungRank(TRUST_CEILINGS[key.kind]));
    }
  });

  test("explainRung names the record that decided it", () => {
    supported(WEB, "one", 0);
    append({ ...WEB, type: "strike", reason: "caught fabricating", by: "agent:test" }, 1);
    const why = explainRung(readTrustLedger(dir), WEB);
    expect(why.rung).toBe("assertion");
    expect(why.ceiling).toBe("expert");
    expect(why.because).toHaveLength(1);
    expect(why.because[0].type).toBe("strike");
    // Non-vacuity: with no strike, the supporting tests are what it names.
    const other = actorKey("web", "other.org");
    supported(other, "one", 0);
    expect(explainRung(readTrustLedger(dir), other).because.map((r) => r.type)).toEqual(["corroboration"]);
  });

  test("standings lists every actor with a history, strongest first", () => {
    supported(WEB, "one", 0);
    append({ ...INBOX, type: "strike", reason: "noise", by: "test" }, 1);
    const rows = standings(readTrustLedger(dir));
    expect(rows.map((r) => keyString(r.key))).toEqual(["web:example.com", "channel:inbox"]);
    expect(rows[0].rung).toBe("expert");
  });
});

describe("the ledger file", () => {
  test("append-only jsonl under .ost-agent/trust, and no record carries a rung", () => {
    supported(WEB, "one", 0);
    append({ ...WEB, type: "strike", reason: "later", by: "test" }, 1);
    const lines = fs.readFileSync(trustLedgerPath(dir), "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const rec = JSON.parse(line) as Record<string, unknown>;
      expect(rec).not.toHaveProperty("rung");
      expect(rec.by).toBe("test"); // stamped by the surface, never self-reported
    }
  });

  test("a damaged line is skipped AND counted — a lost strike must not pass in silence", () => {
    supported(WEB, "one", 0);
    fs.appendFileSync(trustLedgerPath(dir), "not json\n" + JSON.stringify({ kind: "web", type: "strike" }) + "\n");
    const ledger = readTrustLedger(dir);
    expect(ledger.damaged).toBe(2);
    // Non-vacuity: the readable record still counts, so `damaged` is not just a
    // synonym for "the file failed to parse".
    expect(rungOf(ledger, WEB)).toBe("expert");
    expect(readTrustLedger(dir).damaged).toBe(2);
  });

  test("a missing file is an empty ledger, not an error", () => {
    const ledger = readTrustLedger(dir);
    expect(ledger.histories.size).toBe(0);
    expect(ledger.damaged).toBe(0);
    expect(rungOf(ledger, WEB)).toBe("assertion");
  });

  test("the write boundary refuses an id the namespace does not accept", () => {
    expect(() =>
      append({ kind: "web", id: "stripe-webhook-feed", type: "strike", reason: "r", by: "test" }),
    ).toThrow(/is not a hostname/);
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
  });
});

describe("what a prediction is: a citation resolved through the STAMPED actor (B12's link)", () => {
  test("a stored evidence id resolves to the actor the ingesting surface stamped", () => {
    writeEvidence(dir, { id: "INBOX:note.md", source: "INBOX:note.md", title: "t", timestamp: "", body: "b" }, "inbox");
    writeEvidence(dir, { id: "TRANSCRIPT:abc", source: "TRANSCRIPT:abc", title: "t", timestamp: "", body: "b" }, "transcript");
    const actors = evidenceActors(dir);
    expect(keyString(sourceTrustKey("INBOX:note.md", actors)!)).toBe("channel:inbox");
    expect(keyString(sourceTrustKey("TRANSCRIPT:abc", actors)!)).toBe("instrument:transcript");
    // The filename is NOT the identity: a record whose id says INBOX but which the
    // transcript harvester stamped reads as the instrument. That asymmetry is the whole
    // point — the producer chooses the id, the surface chooses the actor.
    writeEvidence(dir, { id: "INBOX:harvested.md", source: "INBOX:harvested.md", title: "t", timestamp: "", body: "b" }, "transcript");
    expect(keyString(sourceTrustKey("INBOX:harvested.md", evidenceActors(dir))!)).toBe("instrument:transcript");
  });

  test("a source claiming a stored record that does not exist lands on unattributed", () => {
    expect(keyString(sourceTrustKey("INBOX:nothing.md", new Map())!)).toBe("unattributed:unknown");
    // …while a source claiming no stored record at all names no actor, which readers
    // take as the floor.
    expect(sourceTrustKey("INTERVIEW: a conversation", new Map())).toBeNull();
    expect(sourceTrustKey(undefined, new Map())).toBeNull();
  });

  test("WEB: provenance resolves to the publisher's row; a malformed host to none", () => {
    expect(keyString(sourceTrustKey("WEB:example.com https://example.com/x", new Map())!)).toBe("web:example.com");
    expect(sourceTrustKey("WEB:stripe-webhook-feed", new Map())).toBeNull();
  });
});

describe("what an outcome is: a verdict under a reserved heading", () => {
  const node = (body: string): Pick<OstNode, "body"> => ({ body });

  test("the verdict is read from the ## Results section, latest last", () => {
    expect(recordedVerdict(node("## Results\n- 2026-01-01 **supported** (ran by T) — held\n"))).toBe("supported");
    expect(
      recordedVerdict(node("## Results\n- **supported** first\n- **refuted** on the rerun\n")),
    ).toBe("refuted");
    // Non-vacuity control: the same words OUTSIDE the section score nothing, which is
    // what makes this unforgeable by an agent that can write prose but not headings.
    expect(recordedVerdict(node("## Notes\nthe test was supported, obviously\n"))).toBeNull();
    expect(recordedVerdict(node("## Results\n- ran it\n## Notes\n- **refuted**\n"))).toBeNull();
  });
});

describe("observations written AT RESULT TIME (the bet must predate the settlement)", () => {
  const tree = (): OstNode[] => [
    // Two levels up from the test: cited, and deliberately out of reach.
    { title: "Users churn", layer: "Opportunity", body: "", tags: [], links: ["Streaks lift return"], source: "WEB:far.example" },
    { title: "Streaks lift return", layer: "Solution", body: "", tags: [], links: ["The test"], source: "WEB:example.com" },
    { title: "The test", layer: "AssumptionTest", body: "## Results\n- **supported**\n", tags: [], links: [] },
    { title: "Unrelated", layer: "Solution", body: "", tags: [], links: [], source: "WEB:other.org" },
  ];

  test("one observation per distinct actor cited one level from the test", () => {
    const recs = resultObservations(tree(), new Map(), { test: "The test", verdict: "supported", by: "human:t" });
    expect(recs).toHaveLength(1);
    expect(keyString({ kind: recs[0].kind, id: recs[0].id })).toBe("web:example.com");
    expect(recs[0].type).toBe("corroboration");
    // Non-vacuity, twice over: a source cited two levels up earns nothing — that is what
    // stops a grandparent laundering standing off a grandchild's result — and a source
    // on an unconnected node earns nothing either.
    const earned = recs.map((r) => r.id);
    expect(earned).not.toContain("far.example");
    expect(earned).not.toContain("other.org");
  });

  test("a refuted result writes the refutation, so the source falls on its own bet", () => {
    const recs = resultObservations(tree(), new Map(), { test: "The test", verdict: "refuted", by: "human:t" });
    for (const rec of recs) append(rec);
    expect(rung(actorKey("web", "example.com"))).toBe("assertion");
  });
});

describe("migration from the host-keyed ledger", () => {
  /** The old file, built by hand in the shape `rankHost` wrote. */
  function legacy(records: { host: string; rung: string; reason: string; ts: string }[]): void {
    const file = hostTrustPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, records.map((r) => JSON.stringify({ ...r, by: "agent:mcp" })).join("\n") + "\n");
  }

  test("a promoted host keeps exactly the rung it had", () => {
    legacy([{ host: "example.com", rung: "expert", reason: "corroborated by our funnel test", ts: "2026-01-02T00:00:00.000Z" }]);
    expect(rung(actorKey("web", "example.com"))).toBe("expert");
    // The legacy file is untouched — nothing in this repo rewrites or renames.
    expect(fs.existsSync(hostTrustPath(dir))).toBe(true);
    // The fold carries the legacy record's own timestamp and reason, so the history
    // stays readable rather than being reset to "today".
    const rec = historyOf(readTrustLedger(dir), actorKey("web", "example.com"))[0];
    expect(rec.ts).toBe("2026-01-02T00:00:00.000Z");
    expect(rec.type === "corroboration" && rec.test).toBe(LEGACY_TEST);
    expect(rec.type === "corroboration" && rec.reason).toMatch(/funnel test/);
  });

  test("a demoted host lands at the floor AND needs a human to come back", () => {
    legacy([
      { host: "bad.com", rung: "expert", reason: "looked good", ts: "2026-01-02T00:00:00.000Z" },
      { host: "bad.com", rung: "assertion", reason: "second claim failed replication", ts: "2026-01-03T00:00:00.000Z" },
    ]);
    const key = actorKey("web", "bad.com");
    expect(rung(key)).toBe("assertion");
    expect(historyOf(readTrustLedger(dir), key)[0].type).toBe("strike");
    // Which is the meaning a legacy demotion had, plus the property it lacked: a later
    // corroboration does not quietly restore it.
    supported(key, "a new test", 0);
    expect(rung(key)).toBe("assertion");
  });

  test("a host that was only ever at the floor mints nothing", () => {
    legacy([{ host: "plain.com", rung: "assertion", reason: "initial", ts: "2026-01-02T00:00:00.000Z" }]);
    const ledger = readTrustLedger(dir);
    expect(historyOf(ledger, actorKey("web", "plain.com"))).toHaveLength(0);
    expect(rungOf(ledger, actorKey("web", "plain.com"))).toBe("assertion");
  });

  test("an id that was never a hostname is retired VISIBLY, not silently reset", () => {
    legacy([{ host: "stripe-webhook-feed", rung: "expert", reason: "our own pipeline", ts: "2026-01-02T00:00:00.000Z" }]);
    readTrustLedger(dir);
    const marker = fs
      .readFileSync(trustLedgerPath(dir), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => r.type === "migration")!;
    expect(marker.retired).toEqual(["stripe-webhook-feed"]);
    // It holds nothing under either reading, which is the correction B6 asked for.
    expect(webStanding(readTrustLedger(dir), "stripe-webhook-feed")).toBe("assertion");
  });

  test("the fold runs once: a second read appends nothing", () => {
    legacy([{ host: "example.com", rung: "expert", reason: "r", ts: "2026-01-02T00:00:00.000Z" }]);
    readTrustLedger(dir);
    const first = fs.readFileSync(trustLedgerPath(dir), "utf8");
    readTrustLedger(dir);
    readTrustLedger(dir);
    expect(fs.readFileSync(trustLedgerPath(dir), "utf8")).toBe(first);
    // Calling the fold directly is a no-op too — the marker, not the caller, is what
    // makes it once.
    expect(migrateLegacyHostTrust(dir)).toEqual([]);
    // Non-vacuity, and it has to be a SECOND vault: the same legacy file, unmigrated,
    // does append. Without this the three assertions above are equally satisfied by a
    // fold that never wrote anything at all.
    const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "ost-actor-trust-fresh-"));
    try {
      fs.mkdirSync(path.dirname(hostTrustPath(fresh)), { recursive: true });
      fs.copyFileSync(hostTrustPath(dir), hostTrustPath(fresh));
      expect(migrateLegacyHostTrust(fresh)).toHaveLength(1);
      expect(fs.readFileSync(trustLedgerPath(fresh), "utf8")).toBe(first);
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  });

  test("a vault with no legacy file is untouched", () => {
    expect(migrateLegacyHostTrust(dir)).toEqual([]);
    expect(fs.existsSync(trustLedgerPath(dir))).toBe(false);
  });
});
