/**
 * The work claim's vocabulary — can a claim be matched at all?
 *
 * This is the instrument named by the assumption test *"Have two independent
 * readers name the work in one briefing paragraph and compare the identities"*,
 * under the solution *"A pass claims the work item before it starts, and the
 * claim outlives the session"*. Its bar, verbatim from the node:
 *
 *   > Given the briefing paragraph both colliding sessions read, two independent
 *   > readings must produce work identities that a claim matcher resolves to the
 *   > same item. The bar is that the matcher returns "already claimed" — not that
 *   > the two strings are equal.
 *
 * **The matcher is the object under test, not the file format.** A spec that only
 * asserted a claim can be written and read back would pass on a mechanism that
 * never excludes anything, which is the exact failure this assumption exists to
 * catch. So the three refusal cases below carry as much weight as the match: a
 * matcher that answers "already claimed" to everything fails this file.
 *
 * The briefing is `test/fixtures/work-claim/briefing-2026-07-26.md`. It is
 * reconstructed, not captured — read `PROVENANCE.md` beside it before reading a
 * green here as more than it is. The two namings are the ones the assumption node
 * proposes as what the colliding commits imply; neither pass is recorded as ever
 * having written down what it was building, which is the finding underneath all
 * of this.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { claimWork, claimsPath, liveClaims, releaseClaim, resolveWorkItem } from "../../src/loop/claim.js";
import { similarity } from "../../src/ost/dedupe.js";

const BRIEFING = fs.readFileSync(
  path.resolve(__dirname, "../fixtures/work-claim/briefing-2026-07-26.md"),
  "utf8",
);

/** The two readings the colliding commits imply. Neither pass wrote either down. */
const READING_A = "invited-visitor arm split";
const READING_B = "add an arm column to visitor_events";

const HOUR = 3_600_000;
const TTL = 8 * HOUR; // one build pass, which is what the observed one cost

let state: string;
beforeEach(() => {
  state = fs.mkdtempSync(path.join(os.tmpdir(), "ost-claim-"));
});
afterEach(() => {
  fs.rmSync(state, { recursive: true, force: true });
});

describe("the two readings are genuinely different strings", () => {
  test("nothing about the wording says they are the same work", () => {
    expect(READING_A).not.toBe(READING_B);
    // This is why a claim keyed on the wording would not have stopped the
    // collision: `dedupe.ts` needs 0.6 before it will call two titles the same
    // thing, and `bestMatch` defaults to that.
    expect(similarity(READING_A, READING_B)).toBeLessThan(0.5);
  });
});

describe("two readings of one briefing resolve to one item", () => {
  test("both namings land on the same identity key", () => {
    const a = resolveWorkItem(READING_A, BRIEFING);
    const b = resolveWorkItem(READING_B, BRIEFING);
    expect(a.resolved).toBe(true);
    expect(b.resolved).toBe(true);
    if (!a.resolved || !b.resolved) return;
    expect(a.identity.key).toBe(b.identity.key);
    expect(a.identity.itemIndex).toBe(b.identity.itemIndex);
    expect(a.identity.label).toMatch(/invited-visitor arm split/i);
  });

  test("the claim written from the first reading refuses the second", () => {
    const first = claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });
    expect(first.status).toBe("claimed");

    const second = claimWork(state, { naming: READING_B, briefing: BRIEFING, session: "session-two", ttlMs: TTL });
    expect(second.status).toBe("already-claimed");
    if (second.status !== "already-claimed") return;
    expect(second.held.session).toBe("session-one");
    expect(second.why).toContain(READING_A);
  });

  test("and it refuses in the other direction too", () => {
    const first = claimWork(state, { naming: READING_B, briefing: BRIEFING, session: "session-two", ttlMs: TTL });
    expect(first.status).toBe("claimed");

    const second = claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });
    expect(second.status).toBe("already-claimed");
  });
});

/**
 * The half that stops a degenerate matcher. Every assertion here would fail on a
 * mechanism that answered "already claimed" to anything it was handed, and a
 * mechanism like that would pass the block above.
 */
describe("a claim excludes the work it covers and nothing else", () => {
  test("a different item in the same briefing is free to claim", () => {
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });

    const other = claimWork(state, {
      naming: "fix the lobby reconnect timeout on mobile networks",
      briefing: BRIEFING,
      session: "session-two",
      ttlMs: TTL,
    });
    expect(other.status).toBe("claimed");
    if (other.status !== "claimed") return;
    expect(other.claim.key).not.toBe(
      (claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL }) as { identity: { key: string } }).identity.key,
    );
    expect(liveClaims(state)).toHaveLength(2);
  });

  test("a third item is a third identity, so the briefing is not one bucket", () => {
    const arm = resolveWorkItem(READING_A, BRIEFING);
    const lobby = resolveWorkItem("the lobby reconnect timeout on flaky mobile networks", BRIEFING);
    const seed = resolveWorkItem("rewrite the slow local Postgres seed script", BRIEFING);
    expect(arm.resolved && lobby.resolved && seed.resolved).toBe(true);
    if (!arm.resolved || !lobby.resolved || !seed.resolved) return;
    expect(new Set([arm.identity.key, lobby.identity.key, seed.identity.key]).size).toBe(3);
  });

  test("work the briefing never names is unresolved — which is a refusal, not permission", () => {
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });

    const stranger = claimWork(state, {
      naming: "upgrade the CI image so integration jobs stop timing out",
      briefing: BRIEFING,
      session: "session-two",
      ttlMs: TTL,
    });
    // Not "already-claimed" (that would be the everything-matches degenerate)
    // and not "claimed" (a key nobody else can recompute excludes nobody).
    expect(stranger.status).toBe("unresolved");
    if (stranger.status !== "unresolved") return;
    expect(stranger.reason).toMatch(/does not|not about|no term/i);
    expect(liveClaims(state)).toHaveLength(1);
  });

  test("a naming that could be either of two items is refused rather than guessed", () => {
    // Two items mention the funnel — the arm split, and the seed rewrite that is
    // deferred until "the funnel question above is answered". A naming that says
    // only "funnel" does not pick one, and guessing would hand a claim to the
    // wrong item, which excludes work nobody took.
    const vague = resolveWorkItem("the funnel", BRIEFING);
    expect(vague.resolved).toBe(false);
    if (vague.resolved) return;
    expect(vague.reason).toMatch(/fits two briefing items/);
  });

  test("a naming drawn from three items at once is refused as spread", () => {
    const spread = resolveWorkItem("reconnect the visitor arm to the seed script", BRIEFING);
    expect(spread.resolved).toBe(false);
    if (spread.resolved) return;
    expect(spread.reason).toMatch(/spread across the briefing/);
  });
});

describe("the claim outlives the session", () => {
  test("it is on disk, in a format a later pass folds last-wins", () => {
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });
    const lines = fs.readFileSync(claimsPath(state), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).state).toBe("held");
  });

  test("a separate process, sharing nothing but the file, is still refused", async () => {
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });

    const tsx = path.resolve(__dirname, "../../node_modules/.bin/tsx");
    const worker = path.join(state, "second-pass.ts");
    const claimModule = path.resolve(__dirname, "../../src/loop/claim.ts");
    const briefingFile = path.resolve(__dirname, "../fixtures/work-claim/briefing-2026-07-26.md");
    // Written outside the repo, so it inherits no `"type": "module"` and tsx
    // treats it as CJS — same constraint as `lock.test.ts`'s race worker.
    fs.writeFileSync(
      worker,
      `import fs from "node:fs";\n` +
        `import { claimWork } from ${JSON.stringify(claimModule)};\n` +
        `const briefing = fs.readFileSync(${JSON.stringify(briefingFile)}, "utf8");\n` +
        `const r = claimWork(process.argv[2], { naming: ${JSON.stringify(READING_B)}, briefing, session: "session-two", ttlMs: ${TTL} });\n` +
        `console.log(r.status);\n`,
      "utf8",
    );

    const status = await new Promise<string>((resolve, reject) => {
      const child = spawn(tsx, [worker, state], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      child.stdout.on("data", (d) => (out += String(d)));
      child.on("error", reject);
      child.on("close", () => resolve(out.trim()));
    });
    expect(status).toBe("already-claimed");
  }, 60_000);
});

/**
 * The expiry is the half this solution inherits unsolved, and the tests say only
 * what the clock does — nothing here shows a claim survives a pass dying
 * mid-build, because nothing in the mechanism does.
 */
describe("a claim is only as good as its clock", () => {
  test("past the TTL the item is free again", () => {
    const t0 = Date.parse("2026-07-26T00:47:00Z");
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL, now: t0 });

    const during = claimWork(state, {
      naming: READING_B, briefing: BRIEFING, session: "session-two", ttlMs: TTL, now: t0 + 2 * HOUR,
    });
    expect(during.status).toBe("already-claimed");

    const after = claimWork(state, {
      naming: READING_B, briefing: BRIEFING, session: "session-two", ttlMs: TTL, now: t0 + 9 * HOUR,
    });
    expect(after.status).toBe("claimed");
  });

  test("the holder renewing its own claim is not a collision", () => {
    const t0 = Date.parse("2026-07-26T00:47:00Z");
    claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL, now: t0 });
    const again = claimWork(state, {
      naming: READING_B, briefing: BRIEFING, session: "session-one", ttlMs: TTL, now: t0 + 2 * HOUR,
    });
    expect(again.status).toBe("held-by-self");
    // Renewal moves the expiry and keeps the original wording and start time.
    if (again.status !== "held-by-self") return;
    expect(again.held.claimedAt).toBe(new Date(t0).toISOString());
    expect(again.held.naming).toBe(READING_A);
    expect(Date.parse(again.held.expiresAt)).toBe(t0 + 2 * HOUR + TTL);
  });

  test("only the holder can release, and a release frees the item", () => {
    const first = claimWork(state, { naming: READING_A, briefing: BRIEFING, session: "session-one", ttlMs: TTL });
    expect(first.status).toBe("claimed");
    if (first.status !== "claimed") return;

    expect(releaseClaim(state, first.claim.key, "session-two")).toBe(false);
    expect(releaseClaim(state, first.claim.key, "session-one")).toBe(true);
    expect(liveClaims(state)).toHaveLength(0);

    const second = claimWork(state, { naming: READING_B, briefing: BRIEFING, session: "session-two", ttlMs: TTL });
    expect(second.status).toBe("claimed");
  });
});
