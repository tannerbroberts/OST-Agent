/**
 * A failed path lookup answers with the nearest thing that does exist.
 *
 * Six sessions in this project's own transcripts end the same way: a path is
 * reached for, the answer is `No such file or directory`, and the very next call
 * is an `ls` that would have said what the first one refused to. The information
 * was one call away and no call announced it, so a miss costs three turns instead
 * of one — reach, be told nothing, enumerate, reach again.
 *
 * So a miss here reports three things rather than one: **how far down the path was
 * valid** ({@link PathMiss.reached}), **what is actually present at that point**
 * ({@link PathMiss.present}), and **the one obvious correction** if there is one
 * ({@link PathMiss.suggestion}). The first two are facts and are always returned.
 * The third is a guess, and most of this file is about when not to make it.
 *
 * ## Why the suggestion is the dangerous part
 *
 * A caller told "did you mean this other file" will sometimes say yes when the
 * honest answer is that what it wanted does not exist and something is wrong
 * further upstream. A helpful suggestion is how that goes unnoticed, and the
 * recorded failures contain a live example: a run wrote its output to
 * `report2.txt`, the writing step died before it ran, and `cat report2.txt`
 * failed in a directory that still held `report.txt` from the previous run. That
 * is one character of edit distance and completely wrong — following it would
 * have made a stale artefact read as this run's result, silently.
 *
 * Hence {@link RULES}: four ways to be confident, each one grounded in a recorded
 * miss, and three ways to refuse — a numeric-series difference, a tie between
 * candidates, and a segment too short for distance to mean anything. When nothing
 * clears the bar the answer is the listing and an explicit sentence saying that
 * nothing there was close enough to name. Declining out loud is a result; a
 * silent omission would read as "there was nothing there at all".
 *
 * ## What this cannot do
 *
 * It searches only where it was told to look — the reached directory, a bounded
 * walk up its ancestors, and roots the caller declared. It never scans a
 * filesystem, so a path whose real home was never declared comes back with no
 * suggestion, correctly. And a suggestion being *right* says nothing about
 * whether being handed one stops the caller guessing again; only the next few
 * sessions' traces can show that.
 */
import fs from "node:fs";
import path from "node:path";

/** Names listed at the reached directory. Enough to orient, not a directory dump. */
export const MAX_PRESENT = 20;

/**
 * How far up from the reached directory an exact-name match is looked for.
 *
 * Four hops covers the recorded case — `/Users/tanner/dev/ost-agent-meta` missing
 * while `/Users/tanner/ost-agent-meta` exists, one hop — with room for a project
 * nested a few levels deep. Unbounded would walk to `/`, where a match means
 * nothing and a stat costs the same as one that does.
 */
export const MAX_ANCESTOR_HOPS = 4;

export type NearMissReason =
  /** The caller is already standing inside what it asked for. */
  | "already-there"
  /** The same name exists, under a declared root or an ancestor. */
  | "elsewhere"
  /** One entry at the reached point is a near-spelling of the missing segment. */
  | "spelling"
  /** The request was several names run together; the first of them is real. */
  | "one-of-several";

export interface NearMissSuggestion {
  /** The path to try instead. */
  path: string;
  reason: NearMissReason;
  /** The clause that lets a caller refuse it — why this, and on what evidence. */
  because: string;
}

export interface PathMiss {
  /** What was asked for, verbatim. */
  requested: string;
  /**
   * Deepest ancestor of the request that does exist. Empty when nothing on the
   * path exists at all, which is itself the answer: the caller is not where it
   * thinks it is.
   */
  reached: string;
  /** The first path segment that was not there. */
  missing: string;
  /** Names at {@link reached}, sorted, capped at {@link MAX_PRESENT}. */
  present: string[];
  /** True when the listing was cut — so a caller knows an absence is not proof. */
  truncated: boolean;
  /** The one obvious correction, or absent because nothing cleared the bar. */
  suggestion?: NearMissSuggestion;
}

/**
 * The rules, written down here rather than left implicit in the branches below,
 * because a suggestion rule invented after seeing which suggestions looked good is
 * not a rule. Each `fires` entry names the recorded miss it was written for.
 */
export const RULES = {
  suggest: [
    {
      reason: "one-of-several" as const,
      fires: "a shell expansion put three newline-separated node filenames into one argument; the first was a real file",
    },
    {
      reason: "already-there" as const,
      fires: "`cd docs/reference` issued from inside `docs/reference` — the caller had arrived and asked again",
    },
    {
      reason: "elsewhere" as const,
      fires: "`src/cli/index.ts` reached for while standing in the vault; the file exists in the other declared root",
    },
    {
      reason: "spelling" as const,
      fires: "a single entry at the reached directory differs from the missing segment by a typo's worth of characters",
    },
  ],
  refuse: [
    "a candidate that differs only in a numeric run — `report.txt` for `report2.txt`, `v` for `v2`. Those are deliberately distinct members of a series, and the recorded `report2.txt` miss is exactly this: the near name was the previous run's output.",
    "a tie. Two candidates equally close means the evidence does not pick one, and picking anyway is how a guess gets laundered into an answer.",
    "a missing segment under three characters, unless the match is exact bar case. Distance over short names is noise.",
  ],
} as const;

/** Levenshtein distance. Small inputs only — path segments, not documents. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** How much difference still counts as a typo, scaled to the name's length. */
function tolerance(name: string): number {
  if (name.length < 3) return 0;
  return Math.min(3, Math.max(1, Math.floor(name.length / 4)));
}

/**
 * Do these two names differ only in their digits?
 *
 * `report.txt`/`report2.txt`, `v`/`v2`, `state`/`state2` — every one of those pairs
 * was in the same directory in the same recorded session, created deliberately by
 * the caller as separate things. A numbered sibling is the one near name that is
 * reliably NOT what was meant, which is why this is a refusal and not a demotion.
 */
export function differsOnlyInDigits(a: string, b: string): boolean {
  const strip = (s: string) => s.replace(/\d+/g, "");
  const digits = (s: string) => s.replace(/\D+/g, "");
  return strip(a) === strip(b) && digits(a) !== digits(b);
}

/**
 * The closest candidate to `missing`, or undefined when none is close enough or
 * two are equally close. Exported because node titles are looked up by name too,
 * and a vault's `no such node` is the same mistake with no directory in it.
 */
export function nearestName(missing: string, candidates: readonly string[]): string | undefined {
  const folded = missing.toLowerCase();
  // Case is the one difference that is always a typo rather than a distinction,
  // and it is checked before the tolerance floor so short names still get it.
  const caseOnly = candidates.filter((c) => c !== missing && c.toLowerCase() === folded);
  if (caseOnly.length === 1) return caseOnly[0];
  if (caseOnly.length > 1) return undefined;

  const bar = tolerance(missing);
  if (bar === 0) return undefined;
  let best: string[] = [];
  let bestAt = Infinity;
  for (const c of candidates) {
    if (differsOnlyInDigits(c, missing)) continue;
    const d = distance(folded, c.toLowerCase());
    if (d > bar) continue;
    if (d < bestAt) {
      bestAt = d;
      best = [c];
    } else if (d === bestAt) {
      best.push(c);
    }
  }
  return best.length === 1 ? best[0] : undefined;
}

function listing(dir: string, hide?: (name: string) => boolean): { present: string[]; truncated: boolean } {
  let names: string[];
  try {
    // Dotfiles are dropped unconditionally: this listing is an aid to a caller
    // that mistyped, and a miss must never become a way to enumerate a `.git`,
    // a `.env`, or a vault's `.ost-agent/` sidecar one probe at a time.
    names = fs.readdirSync(dir).filter((n) => !n.startsWith(".") && !hide?.(n));
  } catch {
    return { present: [], truncated: false };
  }
  names.sort((a, b) => a.localeCompare(b));
  return { present: names.slice(0, MAX_PRESENT), truncated: names.length > MAX_PRESENT };
}

function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export interface NearMissOptions {
  /** Where a relative request is resolved from. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * Directories the caller has declared it works in — configured product repos,
   * the vault. Searched for an exact-name match; never anything wider, because a
   * suggestion pulled out of a filesystem scan is a path nobody said was in play.
   */
  roots?: readonly string[];
  /**
   * A boundary the ancestor walk may not cross.
   *
   * The product-repo reader confines every read to a configured root, and a
   * suggestion is a read's answer — so a miss inside a repo must not report that
   * the name it wanted exists two levels above the repo. Without this, the
   * helpfulness here would be a way to probe the filesystem outside the
   * confinement one failed path at a time. Declared {@link roots} are still
   * searched: those are directories the operator named.
   */
  confineTo?: string;
  /** Names to leave out of the listing, on top of the unconditional dotfile filter. */
  hide?: (name: string) => boolean;
}

/**
 * Answer a failed lookup with the nearest thing that does exist.
 *
 * Costs one `readdir` and a bounded number of `stat`s, all on a path that has
 * already failed — so it is paid only by callers who were going to pay for an
 * `ls` anyway.
 */
export function nearMiss(requested: string, opts: NearMissOptions = {}): PathMiss {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const roots = (opts.roots ?? []).map((r) => path.resolve(r));

  // A request carrying a newline is not a path — it is several, run together by a
  // shell expansion that did not split where the caller assumed. Answer with the
  // first of them that is real rather than with a listing of a directory whose
  // name contains a line break.
  if (requested.includes("\n")) {
    const parts = requested.split("\n").map((p) => p.trim()).filter(Boolean);
    const real = parts.find((p) => exists(path.resolve(cwd, p)));
    const first = { requested, reached: cwd, missing: requested, present: [], truncated: false };
    if (real) {
      return {
        ...first,
        ...listing(cwd, opts.hide),
        suggestion: {
          path: real,
          reason: "one-of-several",
          because: `the name given runs ${parts.length} names together across line breaks; "${real}" is a real one`,
        },
      };
    }
    return { ...first, ...listing(cwd) };
  }

  const absolute = path.isAbsolute(requested);
  const target = path.resolve(cwd, requested);

  // Walk down from the root of the request to find how much of it is real.
  const segments = target.split(path.sep).filter(Boolean);
  let reached: string = path.sep;
  let consumed = 0;
  for (const seg of segments) {
    const next = path.join(reached, seg);
    if (!exists(next)) break;
    reached = next;
    consumed++;
  }
  const missing = segments[consumed] ?? "";
  const tail = segments.slice(consumed).join(path.sep);
  const { present, truncated } = listing(reached, opts.hide);
  const miss: PathMiss = { requested, reached, missing, present, truncated };
  if (!missing) return miss; // the whole path exists; the caller's problem is elsewhere

  const show = (p: string) => (absolute ? p : path.relative(cwd, p) || ".");

  // Already there. A relative request whose segments are the tail of the cwd's own
  // path is a caller that arrived and asked again — the recorded `cd docs/reference`
  // from inside `docs/reference`. Reported before the ancestor search below, which
  // would find the same directory and describe it far less usefully.
  if (!absolute) {
    const want = requested.split("/").filter((s) => s && s !== ".");
    const here = cwd.split(path.sep).filter(Boolean);
    const suffix = here.slice(here.length - want.length);
    if (want.length > 0 && suffix.length === want.length && suffix.every((s, i) => s === want[i])) {
      return {
        ...miss,
        suggestion: {
          path: ".",
          reason: "already-there",
          because: `the working directory is already ${cwd} — "${requested}" names where you are standing, not somewhere below it`,
        },
      };
    }
  }

  // Elsewhere: the same name, under a declared root or a few hops up. An exact
  // name somewhere real beats a fuzzy name here, so this runs before spelling.
  const hunted: string[] = [];
  for (const root of roots) {
    const c = path.join(root, tail);
    if (c !== target && exists(c)) hunted.push(c);
  }
  const boundary = opts.confineTo ? path.resolve(opts.confineTo) : null;
  for (let up: string = reached, hops = 0; hops < MAX_ANCESTOR_HOPS; hops++) {
    const parent = path.dirname(up);
    if (parent === up) break;
    if (boundary && parent !== boundary && !parent.startsWith(boundary + path.sep)) break;
    up = parent;
    const c = path.join(up, tail);
    if (c !== target && exists(c)) hunted.push(c);
  }
  const distinct = [...new Set(hunted)];
  if (distinct.length === 1) {
    return {
      ...miss,
      suggestion: {
        path: show(distinct[0]),
        reason: "elsewhere",
        because: `"${tail}" does not exist under ${reached}, but it does exist at ${distinct[0]}`,
      },
    };
  }

  // Spelling, last and most tentative: one entry right here that a typo could
  // explain. Everything the listing was capped at is invisible to this, which is
  // the right way round — a cut listing yields no suggestion rather than a worse one.
  const near = nearestName(missing, present);
  if (near) {
    return {
      ...miss,
      suggestion: {
        path: show(path.join(reached, near, ...(tail.split(path.sep).slice(1) || []))),
        reason: "spelling",
        because: `${reached} holds "${near}", which differs from "${missing}" by a typo's worth of characters`,
      },
    };
  }

  return miss;
}

/**
 * The miss as one sentence — the shape the recorded failures wanted back.
 *
 * `no such directory — /Users/tanner/dev exists and contains OST-Agent,
 * ost-benchmarks; did you mean /Users/tanner/ost-agent-meta?`
 *
 * The "nothing close enough" clause is not filler. Without it, a miss with no
 * suggestion is indistinguishable from a miss where nobody looked, and a caller
 * cannot tell a refusal from an omission.
 */
export function renderNearMiss(miss: PathMiss): string {
  const parts: string[] = [];
  if (miss.present.length > 0) {
    const names = miss.present.join(", ");
    parts.push(`${miss.reached} exists and contains ${names}${miss.truncated ? `, … (${MAX_PRESENT} shown)` : ""}`);
  } else {
    parts.push(`${miss.reached} exists and is empty`);
  }
  if (miss.suggestion) {
    parts.push(`did you mean ${miss.suggestion.path}? — ${miss.suggestion.because}`);
  } else {
    parts.push("nothing there is close enough to name, so this is not a typo to correct");
  }
  return parts.join("; ");
}
