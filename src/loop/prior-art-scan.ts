/**
 * The start-of-build prior-art scan — look before building, not at the push.
 *
 * The failure this addresses was observed once, in full ("Two agents sharing my
 * vault can trample each other", 2026-07-26). A pass cloned a clean repo at
 * 00:47Z, read the standing briefing, built the item it named, and committed at
 * 08:46Z. At 08:47Z the push was rejected: a different session had pushed the
 * same feature at 02:56Z. The only detector in the system was `git push`, it
 * fired after every hour had been spent, and it fired at all only because the
 * two implementations happened to touch overlapping files.
 *
 * This module moves the look to the front of the pass. Before building, a pass
 * states the intent it is about to implement and asks what the target
 * repository's recent history already holds. `src/loop/claim.ts` prevents the
 * duplicate by agreement between passes; `src/loop/early-push.ts` bounds the
 * loss when prevention misses. This one needs no agreement and no participation
 * from the other pass — it only needs the other pass's work to be *visible*.
 * That last word is the whole finding, and it is stated below rather than
 * discovered by whoever reads the spec.
 *
 * ## What the replay measured, said before anything else
 *
 * `test/loop/prior-art-scan-catches-recorded-collision.test.ts` replays the
 * recorded timeline and runs this scan at start-of-build, 00:47Z, as the vault's
 * assumption test fixes it. **It reports nothing.** The colliding commit did not
 * exist for another two hours and nine minutes, and no scan sees work that has
 * not happened. The bar the vault set — "it must report the collision" — is not
 * met at start-of-build, and the spec asserts the miss rather than moving the
 * clock to a moment that would pass.
 *
 * What the same replay also measured, and what turns that miss into a
 * re-specification rather than a refutation: the scan run at 02:57Z, one minute
 * after the colliding commit lands, **does** report it — by identity, not by
 * wording. So the detector works and the defect is purely one of *when*. Run
 * once at the start, it is blind for the first 129 minutes of the recorded
 * timeline; run on a cadence, it reports within one tick of the commit landing.
 * That is the same shape `early-push.ts` arrived at from the other direction,
 * and it is the honest form of this candidate.
 *
 * ## Matching is a lookup, not a judgement — which is the interesting part
 *
 * The solution node predicted its own weakest point: "matching intent against
 * commit history is a judgement, not a lookup". It does not have to be. The two
 * colliding passes never agreed on a word — the commits imply `invited-visitor
 * arm split` on one side and `add an arm column to visitor_events` on the other,
 * which `src/ost/dedupe.ts` scores well under the 0.6 it needs to call two
 * titles the same thing. Comparing the pass's naming against a commit subject
 * directly would have missed this collision even with the commit sitting in
 * front of it.
 *
 * So nothing is compared to anything else. Both sides are resolved against the
 * **briefing** with {@link resolveWorkItem}, exactly as a claim is, and prior art
 * is "a history entry that resolves to the work item I am about to start". Two
 * namings that land on one briefing item are one piece of work however
 * differently they are worded, and the matcher is the same code path the claim
 * ledger already depends on rather than a second heuristic to mis-tune.
 *
 * The cost of that choice, which is real: **the briefing has to name the work,
 * and so does the history entry.** A commit subject with no briefing vocabulary
 * in it (`chore: wire it up`, `feat: migration 024`) resolves to nothing and is
 * invisible to this scan no matter when it runs. That, and not
 * "non-overlapping duplicates", is this scan's actual blind spot — the spec
 * measures both cases and the difference between them is a finding the node did
 * not have.
 *
 * ## Unresolved is a refusal, not permission
 *
 * A pass that cannot say which briefing item it is starting is the pass this
 * whole family of mechanisms exists to stop, so {@link scanForPriorArt} answers
 * `unresolved-intent` and never `clear`. Reporting an unresolvable intent as
 * clear would reproduce the original bug inside the detector built to catch it —
 * the same rule, and the same reasoning, as `claim.ts`'s `unresolved` outcome.
 *
 * ## What counts as visible, and why branches and pull requests are in the shape
 *
 * The vault records a second variant of this failure ten times over: work that
 * was *finished* and sitting in an open pull request, re-selected by firing
 * after firing because the only state target selection reads is the tree, and
 * the tree does not move until the PR merges. Its own instruction to whoever
 * builds this: "'taken' has to include an unmerged branch or PR naming the
 * target, not only a merge." So {@link PriorArtEntry} carries three kinds, and
 * `src/git/prior-art-sight.ts` reads the first two out of real git.
 *
 * **The third has no reader here.** Pull requests live behind a network API this
 * project has no client for, and inventing one to make a spec greener would be
 * the wrong trade. `pull-request` entries are an input this module scores
 * correctly and a caller must supply; the spec measures the scoring against the
 * recorded PR and says plainly that the fetch is unbuilt. That gap is the
 * difference between this candidate covering one recorded collision and covering
 * eleven.
 *
 * ## Why the git is in another file
 *
 * Everything here is a pure function over entries the caller hands in, and the
 * reading lives in `src/git/prior-art-sight.ts`. That split is not tidiness: the
 * release gates require every `src/loop/` module to be classified as a reader, a
 * trace reader, a pure module, a reporter or an off-gate decider
 * (`test/release/gate-f-deciders.test.ts`), and none of those classes fits a
 * module whose input is the target repository's own history — a surface the
 * agent writes to by building, and not a ledger under `.git/ost-agent/` that it
 * cannot reach. Keeping the spawn out of `src/loop` means the classification
 * this module takes is true rather than true-of-the-regex.
 */
import { resolveWorkItem, type WorkIdentity } from "./claim.js";

/**
 * How far back a scan looks, and the reason it is a fortnight rather than a
 * tuned number: the recorded concurrent collision needed hours, and the
 * finished-but-unmerged PRs the loop re-selected were days to weeks old. Nobody
 * has counted the distribution — there is one concurrent collision on record and
 * eleven re-selections — so this is a bound chosen to cover both recorded shapes
 * and not a measurement. A window too short misses prior art; a window too long
 * costs only the reads, because prior art that resolves to the same briefing
 * item is prior art however old it is.
 */
export const DEFAULT_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/** Something already in the target repository that might be the work. */
export interface PriorArtEntry {
  /**
   * `commit` — landed on a branch. `branch` — a ref exists, work may be in
   * flight. `pull-request` — proposed and unmerged, which the vault records as
   * the shape that fools target selection most often.
   */
  kind: "commit" | "branch" | "pull-request";
  /** How to go look at it: a sha, a ref name, a PR number. */
  ref: string;
  /** The entry's own words for the work — commit subject, branch, PR title. */
  naming: string;
  /** When it became visible in the target repo, UTC milliseconds. */
  atMs: number;
}

/** A history entry that resolves to the work the pass was about to start. */
export interface PriorArtMatch {
  entry: PriorArtEntry;
  /** The briefing-item key both the intent and this entry resolved to. */
  key: string;
  /** How much of the entry's naming that item accounted for. */
  coverage: number;
  /** Why this is a match, in words a pass can put in its own report. */
  why: string;
}

/**
 * An entry the scan looked at and could not place, kept because a scan that
 * silently discards what it cannot read is a scan that reports clean for the
 * wrong reason ("A sweep that cannot read its subject reports a clean result").
 */
export interface UnreadableEntry {
  entry: PriorArtEntry;
  reason: string;
}

export type PriorArtScan =
  | {
      verdict: "prior-art" | "clear";
      /** The scan instant, ISO, on the timeline the caller is replaying. */
      scannedAt: string;
      /** What the pass said it was about to build, resolved. */
      intent: WorkIdentity;
      /** Entries inside the window at the scan instant. */
      considered: PriorArtEntry[];
      matches: PriorArtMatch[];
      /** Considered, but carrying no briefing vocabulary the scan could use. */
      unreadable: UnreadableEntry[];
    }
  | {
      /** The pass could not say which briefing item it was starting. */
      verdict: "unresolved-intent";
      scannedAt: string;
      reason: string;
      considered: PriorArtEntry[];
      matches: [];
      unreadable: [];
    };

export interface ScanOptions {
  /** What the pass is about to build, in the pass's own words. */
  intent: string;
  /** The document both passes read. The identity of work is an item in it. */
  briefing: string;
  /** Everything the caller could see in the target repository. */
  entries: readonly PriorArtEntry[];
  /** The instant the scan runs, UTC milliseconds. */
  scanAtMs: number;
  /** Defaults to {@link DEFAULT_LOOKBACK_MS}. */
  lookbackMs?: number;
}

/**
 * Scan the target repository's recent history for work matching an intent.
 *
 * The scan instant is an argument and never `Date.now()`, so the same call that
 * a pass makes at the start of a build is the call a replay makes at 00:47Z on a
 * timeline seven weeks old. An entry is considered only if it was visible at
 * that instant — `atMs <= scanAtMs` — which is what makes the replay a
 * measurement rather than a re-enactment with hindsight.
 */
export function scanForPriorArt(opts: ScanOptions): PriorArtScan {
  const { intent, briefing, entries, scanAtMs } = opts;
  const lookbackMs = opts.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const scannedAt = new Date(scanAtMs).toISOString();

  const considered = entries
    .filter((e) => e.atMs <= scanAtMs && e.atMs > scanAtMs - lookbackMs)
    .sort((a, b) => a.atMs - b.atMs);

  const resolved = resolveWorkItem(intent, briefing);
  if (!resolved.resolved) {
    return {
      verdict: "unresolved-intent",
      scannedAt,
      reason: resolved.reason,
      considered,
      matches: [],
      unreadable: [],
    };
  }

  const matches: PriorArtMatch[] = [];
  const unreadable: UnreadableEntry[] = [];
  for (const entry of considered) {
    const entryItem = resolveWorkItem(entry.naming, briefing);
    if (!entryItem.resolved) {
      unreadable.push({ entry, reason: entryItem.reason });
      continue;
    }
    if (entryItem.identity.key !== resolved.identity.key) continue;
    matches.push({
      entry,
      key: entryItem.identity.key,
      coverage: entryItem.identity.coverage,
      why:
        `${entry.kind} ${entry.ref} ("${entry.naming}") resolves to the same briefing ` +
        `item as "${intent}" — ${resolved.identity.label}`,
    });
  }

  return {
    verdict: matches.length > 0 ? "prior-art" : "clear",
    scannedAt,
    intent: resolved.identity,
    considered,
    matches,
    unreadable,
  };
}

/** What a pass should print when the scan comes back, in one block. */
export function renderScan(scan: PriorArtScan): string {
  const window = `${scan.considered.length} entr${scan.considered.length === 1 ? "y" : "ies"} visible at ${scan.scannedAt}`;
  if (scan.verdict === "unresolved-intent") {
    return [
      `prior-art scan: REFUSED — ${scan.reason}`,
      `A pass that cannot name its work item cannot be told the work is taken. Say which briefing item this is.`,
      window,
    ].join("\n");
  }
  const blind =
    scan.unreadable.length === 0
      ? ""
      : `\n${scan.unreadable.length} entr${scan.unreadable.length === 1 ? "y" : "ies"} carried no briefing vocabulary and could not be placed — this scan is blind to them.`;
  if (scan.verdict === "clear") {
    return `prior-art scan: CLEAR for "${scan.intent.label}" — ${window}.${blind}`;
  }
  return [
    `prior-art scan: PRIOR ART for "${scan.intent.label}" — ${scan.matches.length} match(es), ${window}.`,
    ...scan.matches.map((m) => `  - ${m.why}`),
    `Pick different work; this is already taken.${blind}`,
  ].join("\n");
}
