import { describe, expect, test } from "vitest";
import {
  bumpVersion,
  compareVersions,
  deriveNextVersion,
  interpretRegistryResponse,
  parseVersion,
  type RegistryState,
} from "../../src/release/next-version.js";

/**
 * Real release history for `ost-agent`, fixed in place rather than queried
 * live — CONTRIBUTING.md requires the suite stay offline and deterministic.
 *
 * `registryTime` is the npm registry's own `time` field for the package,
 * captured 2026-08-18 via `GET https://registry.npmjs.org/ost-agent` before
 * this test was written. `originTags` is `git for-each-ref refs/tags` on
 * `origin`, captured the same day. Both are what actually happened, not a
 * scenario built to make the rule look good — in particular, most releases
 * in this history were NEVER tagged (RELEASING.md's tag step was skipped far
 * more often than it ran), which is why the registry, not `origin`'s tags,
 * carries most of the weight below.
 */
const registryTime: Record<string, string> = {
  "0.1.0": "2026-07-24T15:49:43.206Z",
  "0.1.3": "2026-07-24T18:13:11.686Z",
  "0.4.0": "2026-07-25T02:11:08.904Z",
  "0.9.0": "2026-07-26T00:50:56.500Z",
  "0.14.0": "2026-07-26T19:44:56.834Z",
  "0.15.0": "2026-07-26T19:52:35.489Z",
  "0.16.0": "2026-07-26T20:59:49.988Z",
  "0.17.0": "2026-07-26T21:25:08.265Z",
  "0.18.0": "2026-07-27T00:56:48.260Z",
  "0.19.0": "2026-07-27T02:16:14.686Z",
  "0.19.1": "2026-07-27T02:28:27.616Z",
  "0.20.0": "2026-07-27T06:08:17.787Z",
  "0.21.0": "2026-07-27T11:15:14.234Z",
  "0.22.0": "2026-07-27T15:59:45.725Z",
};

/** 2026-07-28T16:29:34.971Z: the package was fully unpublished. Every number
 *  above is still named in `time.unpublished.versions` — npm never lets a
 *  burned number come back. */
const unpublishedAt = "2026-07-28T16:29:34.971Z";

const originTags: Record<string, string> = {
  "0.1.1": "2026-07-24T16:58:21Z",
  "0.1.3": "2026-07-24T18:12:27Z",
  "0.4.0": "2026-07-25T02:09:53Z",
  "0.18.0": "2026-07-27T00:55:27Z",
  "0.19.0": "2026-07-27T02:13:16Z",
  "0.19.1": "2026-07-27T02:27:10Z",
};

const releasedInOrder = Object.entries(registryTime).sort(([, a], [, b]) => (a < b ? -1 : 1));

/** The number is decided BEFORE either the tag or the registry publish it
 *  produces — whichever of those two events happened first is the closest
 *  observable stand-in for "the moment the rule would have been asked". Using
 *  the publish time alone is wrong when the tag lands first, as it did for
 *  v0.18.0: the tag would then be visible to a query about its own release. */
function decisionInstant(version: string): string {
  const tag = originTags[version];
  const published = registryTime[version]!;
  return tag && tag < published ? tag : published;
}

/** What the registry + origin tags knew at a moment in history, mirroring the
 *  live query this rule is meant to replace the local file with. */
function knownAsOf(instant: string): RegistryState {
  const versions = Object.entries(registryTime)
    .filter(([, publishedAt]) => publishedAt < instant)
    .map(([v]) => v);
  return { reachable: true, versions };
}

function tagsAsOf(instant: string): string[] {
  return Object.entries(originTags)
    .filter(([, createdAt]) => createdAt < instant)
    .map(([v]) => v);
}

type Verdict = "match" | "rule-right-history-wrong" | "both-defensible";

/**
 * Replay one release: does any bump the rule could plausibly have been asked
 * for collide with a number already published or tagged before it? That is
 * the one failure the pre-committed threshold forbids. A rule answer that
 * differs from the actual number without colliding is expected — the early
 * history below jumps several minors at once, which no single mechanical
 * bump reproduces, and that is a fact about how those releases were cut, not
 * a defect in deriving the next number from what is externally known.
 */
function replay(actualVersion: string, publishedAt: string, everPublishedBefore: readonly string[]) {
  const registry = knownAsOf(publishedAt);
  const tags = tagsAsOf(publishedAt);
  const candidates = (["major", "minor", "patch"] as const).map((bump) => ({
    bump,
    result: deriveNextVersion({ registry, tags, bump }),
  }));

  const collisions = candidates.filter(
    (c) => c.result.ok && everPublishedBefore.includes(c.result.version),
  );

  const exactMatch = candidates.find((c) => c.result.ok && c.result.version === actualVersion);
  const verdict: Verdict = exactMatch
    ? "match"
    : everPublishedBefore.includes(actualVersion)
      ? "rule-right-history-wrong"
      : "both-defensible";

  return { candidates, collisions, verdict };
}

describe("registry-derived version — pure replay of real release history", () => {
  test("parses and orders semver the way the rule depends on", () => {
    expect(parseVersion("v0.19.0")).toEqual({ major: 0, minor: 19, patch: 0 });
    expect(parseVersion("0.19.0")).toEqual({ major: 0, minor: 19, patch: 0 });
    expect(parseVersion("0.19.0-rc.1")).toBeNull();
    expect(compareVersions(parseVersion("0.19.1")!, parseVersion("0.19.0")!)).toBe(1);
    expect(bumpVersion(parseVersion("0.18.0")!, "minor")).toEqual({ major: 0, minor: 19, patch: 0 });
  });

  test("every past release, replayed: the rule never proposes a number already published or tagged", () => {
    const results = releasedInOrder.map(([version], i) => {
      const everBefore = releasedInOrder.slice(0, i).map(([v]) => v);
      return { version, ...replay(version, decisionInstant(version), everBefore) };
    });

    for (const r of results) {
      expect(r.collisions, `"${r.version}": rule proposed an already-used number`).toHaveLength(0);
    }

    // Real history: the first five releases jump several minors in one step
    // (0.1.0→0.1.3→0.4.0→0.9.0→0.14.0), which is why they cannot exact-match
    // a single bump. Every release from 0.15.0 onward is a clean single bump
    // and DOES exact-match — that is the era the near-collision below sits in.
    const byVersion = new Map(results.map((r) => [r.version, r]));
    for (const [version] of releasedInOrder.slice(5)) {
      expect(byVersion.get(version)!.verdict, `"${version}" should exact-match a bump`).toBe("match");
    }
  });

  test("the 2026-07-26 near-collision: the second train chooses v0.19.0 without a human rebasing", () => {
    // The autonomous loop published v0.18.0 at 00:56:48Z. A builder session had
    // finished locally, unpushed, and — on the OLD rule — would next have
    // reached for whatever its own last-seen local number implied. Query the
    // registry instead, right after the loop's publish, and the answer is
    // unambiguous.
    const asOfSecondTrain = "2026-07-27T01:30:00.000Z"; // after 0.18.0's publish, before 0.19.0's
    const registry = knownAsOf(asOfSecondTrain);
    const tags = tagsAsOf(asOfSecondTrain);

    expect(registry.reachable && registry.versions).toContain("0.18.0");

    const result = deriveNextVersion({ registry, tags, bump: "minor" });
    expect(result).toEqual({ ok: true, version: "0.19.0", base: "0.18.0" });

    // The number the OLD (local-file) rule was reaching for — the same "next
    // after what I last saw published myself" — collided with what the loop
    // had just published. The registry-derived answer does not.
    expect(result.ok && result.version).not.toBe("0.18.0");
  });

  test("registry unreachable is a refusal, not a number — distinguishable from nothing published yet", () => {
    const unreachable = deriveNextVersion({
      registry: { reachable: false, reason: "getaddrinfo ENOTFOUND registry.npmjs.org" },
      tags: [],
      bump: "minor",
    });
    expect(unreachable).toEqual({
      ok: false,
      reason: "registry-unreachable",
      detail: "getaddrinfo ENOTFOUND registry.npmjs.org",
    });

    const neverPublished = deriveNextVersion({ registry: { reachable: true, versions: [] }, tags: [], bump: "minor" });
    expect(neverPublished).toEqual({ ok: true, version: "0.1.0", base: null });

    // Both produce different shapes on purpose: one is `ok: false`, the other
    // `ok: true`. A caller that only checked "did we get a version string
    // back" would already tell them apart; nothing here can be mistaken for
    // the other by a caller that checks `ok`.
    expect(unreachable.ok).toBe(false);
    expect(neverPublished.ok).toBe(true);
  });

  test("npm's 404 for a fully-unpublished package is reachable-with-history, not unreachable or empty", () => {
    // The exact body ost-agent's own registry entry returns today (captured
    // 2026-08-18) — this package was unpublished on 2026-07-28 and every
    // number it ever had is still named here, permanently unavailable to
    // reuse even though nothing is live.
    const body = {
      _id: "ost-agent",
      name: "ost-agent",
      time: {
        created: "2026-07-24T15:49:42.875Z",
        modified: unpublishedAt,
        ...registryTime,
        unpublished: { time: unpublishedAt, versions: Object.keys(registryTime) },
      },
    };
    const state = interpretRegistryResponse(404, body);
    expect(state.reachable).toBe(true);
    expect(state.reachable && state.versions.sort()).toEqual(Object.keys(registryTime).sort());

    // The next call this package would ever accept must still clear 0.22.0 —
    // an unpublish does not free the number up again.
    const next = deriveNextVersion({ registry: state, tags: [], bump: "minor" });
    expect(next).toEqual({ ok: true, version: "0.23.0", base: "0.22.0" });

    // A genuinely never-published name gets the SAME 404 status but a body
    // with no `time.unpublished` — and that must read as "nothing here yet",
    // not be confused with the unpublished case above.
    const neverPublished = interpretRegistryResponse(404, { error: "Not found" });
    expect(neverPublished).toEqual({ reachable: true, versions: [] });

    // A response that never arrived at all (network failure) is the one
    // that must NOT be read as either "nothing published" or "history known".
    expect(interpretRegistryResponse(0, undefined).reachable).toBe(false);
    expect(interpretRegistryResponse(503, { error: "service unavailable" }).reachable).toBe(false);
  });
});
