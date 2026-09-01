/**
 * Replay the last ten releases and count how many a pull-at-start instance
 * would have received.
 *
 * **What this scores.** The solution "Resolve the newest published version at
 * pass start and refuse to run silently on a stale one" rests on one claim: the
 * registry is a path improvements *actually travel down*, not just one they
 * could. Its assumption test fixed a bar before anybody counted — at least 8 of
 * the last 10 versions cut on `main` resolvable from the registry within 24
 * hours of their commit; at 7 or fewer the candidate is killed rather than
 * repaired, because the fix would be a publish credential and a release
 * discipline, which is a different opportunity.
 *
 * **The count, on the window as specified: 9 of 10. The bar is cleared.**
 * Nine of the last ten bumps were on npm within three minutes of the commit
 * that cut them; the median lag across those nine is 98 seconds.
 *
 * **And the number does not mean what it looks like it means**, which is why
 * the four tests after the score exist and assert as loudly as it does:
 *
 *   - Over the *whole* history the rate is 13 of 25 — 52%, well under the same
 *     80% bar. The ten-release window lands entirely inside one two-day burst
 *     (2026-07-26 → 2026-07-27) where publishing worked. Slide it back two and
 *     it swallows v0.10.0–v0.13.0, the four-release unpublished stretch the
 *     assumption test's own prose cited as its counter-evidence. The window
 *     misses the node's own witness by two.
 *   - Every one of those fourteen publishes was withdrawn wholesale at
 *     2026-07-28T16:29:34.971Z. The registry returns 200 for `ost-agent` and
 *     carries zero live versions: a pull-at-start instance running today
 *     resolves nothing at all.
 *   - `0.23.0`, the newest release in the scored window, was committed four
 *     minutes and forty-two seconds *after* that withdrawal — cut into a
 *     package that had already ceased to exist.
 *   - `package.json` is `"private": true`, `.github/workflows/` holds only
 *     `ci.yml`, and `RELEASING.md:20` says in as many words that there is no
 *     publish step and no npm package. There is no path left to travel down.
 *
 * So the pre-committed bar is cleared and the assumption behind it is false in
 * the present. The bar was fixed in advance and is not moved here — moving it
 * after seeing the count is the one thing this file may not do. What it does
 * instead is commit the three facts that make 9/10 a statement about
 * 2026-07-26/27 rather than a licence to build. Read together: the mechanism
 * this number was supposed to clear cannot resolve anything at all today, and
 * the blocker is upstream of any instance-side pull.
 *
 * Evidence: `test/fixtures/release-propagation-lag/corpus.json`, cut from git
 * history and the registry's own `time` field by
 * `scripts/harvest-release-propagation-corpus.ts`. See that directory's
 * PROVENANCE.md. Nothing here touches the network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** The bar, exactly as the assumption test's `threshold` field states it. Fixed
 *  2026-08-02, before anything was counted. */
const BAR = { window: 10, atLeast: 8, withinHours: 24 } as const;

interface Corpus {
  package: string;
  head: string;
  localVersion: string;
  localPrivate: boolean;
  commitsSinceLastPublish: number;
  registry: {
    status: number;
    created: string | null;
    modified: string | null;
    published: Record<string, string>;
    unpublished: { time: string; versions: string[] } | null;
  };
  bumps: { version: string; commit: string; committedAt: string; subject: string }[];
}

const corpus: Corpus = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "test/fixtures/release-propagation-lag/corpus.json"), "utf8"),
) as Corpus;

const HOUR_MS = 3_600_000;

interface Scored {
  version: string;
  committedAt: string;
  publishedAt: string | null;
  /** Hours from the cut to the publish. `null` when it was never published at
   *  all — which is a different thing from a large lag and is kept distinct so
   *  a reader cannot mistake "slow" for "never". */
  lagHours: number | null;
  resolvable: boolean;
}

/**
 * One release, scored the way the node phrases the question: would an instance
 * pulling `latest` within 24 hours of this commit have received this version?
 *
 * A publish that predates its own commit scores `false` rather than as a
 * negative lag. That happens when a release was published from a branch before
 * the bump landed in this history, and "already there" is not propagation of
 * the commit being scored.
 */
function score(bump: { version: string; committedAt: string }): Scored {
  const publishedAt = corpus.registry.published[bump.version] ?? null;
  if (!publishedAt) {
    return { ...bump, publishedAt: null, lagHours: null, resolvable: false };
  }
  const lagHours = (Date.parse(publishedAt) - Date.parse(bump.committedAt)) / HOUR_MS;
  return {
    ...bump,
    publishedAt,
    lagHours,
    resolvable: lagHours >= 0 && lagHours <= BAR.withinHours,
  };
}

const scoredAll = corpus.bumps.map(score);
const lastTen = scoredAll.slice(0, BAR.window);

describe("registry propagation lag — the last ten versions cut on main", () => {
  test("the bar is the one the assumption test fixed, not one chosen after the count", () => {
    // Pinned so that a later edit which relaxes any of the three has to argue
    // for itself in a diff, rather than sliding past in the scoring code.
    expect(BAR).toEqual({ window: 10, atLeast: 8, withinHours: 24 });
  });

  test("the corpus is this repository's own record, not a scenario built for it", () => {
    expect(corpus.package).toBe("ost-agent");
    expect(corpus.head).toBe("a6c045627c2deba877f8f274974e9f8da2eb7cb8");
    expect(corpus.bumps).toHaveLength(25);
    // 200 with a populated `time` — the registry answered, so a miss below is a
    // fact about publishing rather than about a failed lookup.
    expect(corpus.registry.status).toBe(200);
    expect(Object.keys(corpus.registry.published)).toHaveLength(14);

    // Newest first, strictly, and no version counted twice — the window below
    // is "the last ten" only if this holds.
    const instants = corpus.bumps.map((b) => Date.parse(b.committedAt));
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
    expect(new Set(corpus.bumps.map((b) => b.version)).size).toBe(corpus.bumps.length);
  });

  test("THE PRE-COMMITTED BAR IS CLEARED — 9 of the last 10 resolvable within 24 hours", () => {
    const resolvable = lastTen.filter((r) => r.resolvable);
    expect(resolvable).toHaveLength(9);
    expect(resolvable.length).toBeGreaterThanOrEqual(BAR.atLeast);

    // The one miss is the newest release in the window, and it is a never, not
    // a late: nothing named 0.23.0 was ever published.
    const misses = lastTen.filter((r) => !r.resolvable);
    expect(misses.map((m) => m.version)).toEqual(["0.23.0"]);
    expect(misses[0].publishedAt).toBeNull();

    // The nine that landed did so in minutes, not hours — this is what a
    // working publish path looks like, and it is the strongest thing that can
    // be said for the mechanism anywhere in this file.
    const lags = resolvable.map((r) => r.lagHours!).sort((a, b) => a - b);
    expect(Math.max(...lags) * 60).toBeLessThan(4);
    expect(lags[Math.floor(lags.length / 2)] * 3600).toBeCloseTo(98, -1);
  });

  test("...and 9/10 is an artefact of where the window falls: 13 of 25 over the whole history", () => {
    const resolvableAll = scoredAll.filter((r) => r.resolvable);
    expect(resolvableAll).toHaveLength(13);
    // 52% against the same 80% the window cleared at 90%.
    expect(resolvableAll.length / scoredAll.length).toBeCloseTo(0.52, 2);

    // The assumption test's prose cited one stretch as its counter-evidence:
    // "v0.10.0 through v0.13.0 sat on `main`" while `@latest` resolved 0.9.0.
    // That stretch is real, and it sits at positions 12–15 — two releases
    // outside the ten the same node fixed as the window.
    const eneedauth = ["0.13.0", "0.12.0", "0.11.0", "0.10.0"];
    const positions = eneedauth.map((v) => scoredAll.findIndex((r) => r.version === v));
    expect(positions).toEqual([11, 12, 13, 14]);
    for (const v of eneedauth) {
      expect(scoredAll.find((r) => r.version === v)!.publishedAt, `${v} was never published`).toBeNull();
    }
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(BAR.window);

    // Widen by four to include exactly the stretch the node named, and the
    // rate falls to 10/14 — still over the bar. Widen to the whole history and
    // it fails. Neither reading is more principled than the other after the
    // fact, which is the point: the window decides the verdict.
    expect(scoredAll.slice(0, 14).filter((r) => r.resolvable)).toHaveLength(10);
  });

  test("what a pull-at-start instance resolves TODAY: nothing — the package was withdrawn whole", () => {
    const withdrawn = corpus.registry.unpublished;
    expect(withdrawn).not.toBeNull();
    expect(withdrawn!.time).toBe("2026-07-28T16:29:34.971Z");

    // Every version the registry ever carried is named in the withdrawal.
    // `published` minus `unpublished` is the set an instance could resolve, and
    // it is empty.
    const live = Object.keys(corpus.registry.published).filter((v) => !withdrawn!.versions.includes(v));
    expect(live).toEqual([]);

    // And `main` has not stood still while that was true.
    expect(corpus.commitsSinceLastPublish).toBe(382);
    const lastPublish = Object.values(corpus.registry.published).sort().at(-1)!;
    expect(lastPublish).toBe("2026-07-27T15:59:45.725Z");
  });

  test("the newest release in the scored window was cut into a package that no longer existed", () => {
    const newest = corpus.bumps[0];
    expect(newest.version).toBe("0.23.0");
    expect(newest.committedAt).toBe("2026-07-28T16:34:17.000Z");

    const gapSeconds = (Date.parse(newest.committedAt) - Date.parse(corpus.registry.unpublished!.time)) / 1000;
    expect(gapSeconds).toBeGreaterThan(0);
    expect(gapSeconds).toBeCloseTo(282, 0); // four minutes and forty-two seconds

    // It is also still the local version, so the halt-on-stale rule this
    // solution proposes would today compare 0.23.0 against an empty registry
    // on every pass.
    expect(corpus.localVersion).toBe("0.23.0");
  });

  test("there is no publish path left for an improvement to travel down", () => {
    expect(corpus.localPrivate).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      private?: boolean;
      scripts: Record<string, string>;
    };
    expect(pkg.private).toBe(true);
    expect(Object.values(pkg.scripts).some((s) => s.includes("npm publish"))).toBe(false);

    // Only CI. The `npm-publish` workflow CONTRIBUTING.md used to name has
    // never existed.
    expect(fs.readdirSync(path.join(repoRoot, ".github/workflows")).sort()).toEqual(["ci.yml"]);

    // RELEASING.md says it in prose, and the prose and the tree agree.
    expect(fs.readFileSync(path.join(repoRoot, "RELEASING.md"), "utf8")).toContain(
      "There is no publish step. There is no npm package.",
    );
  });
});
