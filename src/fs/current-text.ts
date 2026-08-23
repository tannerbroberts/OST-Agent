/**
 * A failed literal match answers with the text that is actually there now.
 *
 * The sibling of {@link ./near-miss.ts}, one level down: that file answers a
 * failed *path* lookup with what exists at the reached directory, this one
 * answers a failed *text* match with what exists at the intended site inside a
 * file. Both come from the same recorded shape — a call is refused, the
 * information that would have fixed it was one call away, and no call
 * volunteered it.
 *
 * Six sessions in this project's own transcripts end with a literal-match edit
 * refused as `String to replace not found in file`, and in two of them the
 * harness volunteered the one guess it had — that it tried swapping `\uXXXX`
 * escapes for their characters and neither form matched, *"so the mismatch is
 * likely elsewhere in old_string. Re-read the file and co…"*. That is a refusal
 * that has exhausted its own reasoning and handed the problem back. What it
 * never says is the one thing it is holding: the file, open, at the place the
 * caller was aiming.
 *
 * So a miss here reports the site rather than the failure: **where the closest
 * region is** ({@link IntendedSite.line}), **the text that is there**
 * ({@link IntendedSite.text} — verbatim, usable as the retry's quote without
 * transcription), and **how it differs from what was quoted**
 * ({@link IntendedSite.differs}).
 *
 * ## Why "vanished" is a real answer and not a failure to try harder
 *
 * The candidate this implements makes its own limit explicit: *"If the old text
 * is gone entirely, there is no near-miss to show and this returns nothing
 * useful."* A region scored below {@link MIN_SIMILARITY} comes back as
 * {@link VanishedText} carrying the score it actually reached, never as the
 * least-bad window dressed up as a site. Showing a caller an unrelated stretch
 * of file and calling it "what is there now" is worse than the generic refusal
 * it replaces: the generic one at least does not point anywhere.
 *
 * That is the same discipline `near-miss.ts` applies to a suggested path, for
 * the same reason — a helpful guess is how a wrong answer gets adopted — and it
 * is why the drift-detecting sibling ("Carry a content hash from read to write
 * and refuse on drift") stays a complement rather than a rival. That one says
 * *why* the match failed. This one says *what to do next*, and honestly reports
 * the cases where it cannot.
 *
 * ## What this cannot do
 *
 * It never touches the filesystem — the caller hands it content it has already
 * read — and it never prevents anything: the call that failed is still spent.
 * And a site being *right* says nothing about whether a caller handed one
 * actually retries with it rather than re-reading the whole file anyway. Only
 * the next sessions' traces show that.
 */

/** Lines of surrounding file shown on each side of the site, for re-anchoring. */
export const CONTEXT_LINES = 3;

/**
 * Most lines of site text shown before the block is cut.
 *
 * A refusal is read in a context window, so an unbounded excerpt is a refusal
 * that costs more than the call it is explaining. Twenty lines covers every
 * region the recorded failures quoted; past that the caller is replacing a
 * section, and re-reading is the cheaper move anyway.
 */
export const MAX_SITE_LINES = 20;

/**
 * How much of the quoted text a region must still resemble to be called the
 * intended site.
 *
 * Below this the honest answer is that the text is gone. The bar is set on
 * whole-block similarity rather than on any single line, because the failures
 * this is for are near-misses by construction — a stale quote of a block that
 * mostly survived, not a quote of something that was never there.
 */
export const MIN_SIMILARITY = 0.4;

/** How the text at the site differs from the text the caller quoted. */
export type SiteDifference =
  /** Same characters, different indentation, trailing spaces or blank lines. */
  | "whitespace"
  /** The caller quoted a `\uXXXX` escape where the file holds the character it names. */
  | "escape"
  /** Same text, different case somewhere. */
  | "case"
  /** A genuine content difference — the file says something else here now. */
  | "content";

export interface IntendedSite {
  /** 1-based line in the current content where {@link text} begins. */
  line: number;
  /**
   * The text actually there, verbatim.
   *
   * This is the point of the whole module: it is the string a correct retry
   * quotes, so a caller holding it composes the next call by copying rather
   * than by re-reading and re-transcribing.
   */
  text: string;
  /** {@link text} with {@link CONTEXT_LINES} of file on each side, for re-anchoring. */
  withContext: string;
  /** True when {@link text} was cut at {@link MAX_SITE_LINES}. */
  truncated: boolean;
  /** Fraction of the quoted lines present verbatim (bar surrounding whitespace) at this site. */
  linesMatched: number;
  /** How many lines the caller quoted — the denominator of {@link linesMatched}. */
  linesQuoted: number;
  /** Whole-block similarity, 0–1. Always at or above {@link MIN_SIMILARITY}. */
  similarity: number;
  differs: SiteDifference;
}

export interface VanishedText {
  /** The best whole-block similarity any region reached — below {@link MIN_SIMILARITY}. */
  bestSimilarity: number;
  /** Why no site is named, in a clause a caller can act on. */
  because: string;
}

export type QuotedTextLookup =
  /** The quoted text is present after all, at this 1-based line. Not a miss. */
  | { kind: "matched"; line: number }
  /** A region close enough to be the site the caller meant. */
  | { kind: "site"; site: IntendedSite }
  /** Nothing close enough. The caller's text is not there in any form. */
  | { kind: "vanished"; vanished: VanishedText };

/** Levenshtein distance, bounded inputs only — lines and small blocks, not files. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0 || b.length === 0) return Math.max(a.length, b.length);
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

/** 1 for identical, 0 for nothing in common. Long lines are compared by prefix — distance over a paragraph is noise anyway. */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  const cap = 400;
  const [x, y] = longest > cap ? [a.slice(0, cap), b.slice(0, cap)] : [a, b];
  return Math.max(0, 1 - distance(x, y) / Math.max(x.length, y.length, 1));
}

/** Quoted text split into lines, with the single trailing newline's empty line dropped. */
function quotedLinesOf(quoted: string): string[] {
  const lines = quoted.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Turn the six characters `→` into `→`, which is the one repair the recorded refusals say they already tried. */
function unescapeUnicode(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

function classifyDifference(quoted: string, present: string): SiteDifference {
  if (collapse(quoted) === collapse(present)) return "whitespace";
  if (unescapeUnicode(quoted) === present || collapse(unescapeUnicode(quoted)) === collapse(present)) return "escape";
  if (collapse(quoted).toLowerCase() === collapse(present).toLowerCase()) return "case";
  return "content";
}

/** The clause that goes in the refusal, so the caller reads a cause rather than inferring one. */
export function describeDifference(differs: SiteDifference): string {
  switch (differs) {
    case "whitespace":
      return "the same characters with different whitespace — indentation, a trailing space, or a blank line";
    case "escape":
      return "you quoted a `\\uXXXX` escape where the file holds the character itself";
    case "case":
      return "the same text in a different case";
    case "content":
      return "different content — the file says something else here now";
  }
}

/**
 * The text at the site the caller meant, given a literal quote that did not match.
 *
 * `current` is the file's content as it is now — already in the caller's hand,
 * because a literal-match write has just read it to discover the miss. `quoted`
 * is the string that failed to match. Costs no I/O.
 */
export function textAtIntendedSite(current: string, quoted: string): QuotedTextLookup {
  if (quoted === "") {
    return {
      kind: "vanished",
      vanished: { bestSimilarity: 0, because: "the quoted text is empty, so it names no site to look at" },
    };
  }

  const exact = current.indexOf(quoted);
  if (exact >= 0) {
    return { kind: "matched", line: current.slice(0, exact).split("\n").length };
  }

  const quotedLines = quotedLinesOf(quoted);
  const currentLines = current.split("\n");
  const span = quotedLines.length;
  const lineAt = (i: number) => currentLines[i] ?? "";

  // Pass one, cheap: score every window on exact and trimmed-exact line
  // equality alone. String comparison over the whole file is affordable;
  // edit distance over the whole file is not.
  const trimmedQuoted = quotedLines.map((l) => l.trim());
  const cheapScore = (start: number) => {
    let hits = 0;
    for (let j = 0; j < span; j++) {
      const line = lineAt(start + j);
      if (line === quotedLines[j]) hits += 1;
      else if (trimmedQuoted[j] !== "" && line.trim() === trimmedQuoted[j]) hits += 1;
    }
    return hits;
  };

  const lastStart = Math.max(0, currentLines.length - 1);
  let candidates: number[] = [];
  let bestCheap = 0;
  for (let start = 0; start <= lastStart; start++) {
    const hits = cheapScore(start);
    if (hits === 0) continue;
    if (hits > bestCheap) {
      bestCheap = hits;
      candidates = [start];
    } else if (hits === bestCheap) {
      candidates.push(start);
    }
  }

  // Pass two: when no line survived verbatim anywhere — a one-line quote with a
  // typo in it, a block re-indented and reworded at once — fall back to edit
  // distance. Bounded, because this runs on a path that has already failed and
  // must not turn a refusal into a hang.
  if (candidates.length === 0) {
    if (currentLines.length * span > 200_000) {
      return {
        kind: "vanished",
        vanished: {
          bestSimilarity: 0,
          because:
            `no line of the text you quoted appears anywhere in the file, and it is too large ` +
            `(${currentLines.length} lines) to search for a site by similarity`,
        },
      };
    }
    candidates = Array.from({ length: lastStart + 1 }, (_, i) => i);
  }

  // Cap the fine pass: many windows can tie on the cheap score in a repetitive
  // file, and each fine score is an edit distance over a block.
  const MAX_FINE = 64;
  const fine = candidates.slice(0, MAX_FINE);

  let bestStart = fine[0];
  let bestSimilarity = -1;
  for (const start of fine) {
    const window = Array.from({ length: span }, (_, j) => lineAt(start + j)).join("\n");
    const score = similarity(quoted.replace(/\n$/, ""), window);
    if (score > bestSimilarity) {
      bestSimilarity = score;
      bestStart = start;
    }
  }

  if (bestSimilarity < MIN_SIMILARITY) {
    return {
      kind: "vanished",
      vanished: {
        bestSimilarity,
        because:
          `the closest region in the file matches only ${Math.round(bestSimilarity * 100)}% of the text you ` +
          `quoted, below the ${Math.round(MIN_SIMILARITY * 100)}% bar — the text is not there in any form, ` +
          `so there is nothing here to re-quote`,
      },
    };
  }

  return { kind: "site", site: siteAtLine(current, bestStart, span, quoted, bestSimilarity) };
}

/**
 * The site at a line the caller already knows, rather than one this module had
 * to find.
 *
 * The drift guard is the case: it has computed exactly which lines diverged, so
 * asking {@link textAtIntendedSite} to locate them by similarity throws away a
 * certainty and can — as it did for a one-line replacement sharing three words
 * with its replacement — come back "vanished" about a region whose position is
 * not in doubt. Both paths render the same block, because a caller should not
 * have to learn two shapes for "what is there now".
 *
 * `startLine` is 0-based; `span` is how many lines of `current` the region
 * covers, and may be 0 for a region that was deleted outright.
 */
export function siteAtLine(
  current: string,
  startLine: number,
  span: number,
  quoted: string,
  knownSimilarity?: number,
): IntendedSite {
  const currentLines = current.split("\n");
  const lineAt = (i: number) => currentLines[i] ?? "";
  const quotedLines = quotedLinesOf(quoted);
  const trimmedQuoted = quotedLines.map((l) => l.trim());

  const shown = Math.min(span, MAX_SITE_LINES);
  const end = Math.min(startLine + shown, currentLines.length);
  const text = currentLines.slice(startLine, end).join("\n");

  const contextFrom = Math.max(0, startLine - CONTEXT_LINES);
  const contextTo = Math.min(currentLines.length, Math.max(end, startLine) + CONTEXT_LINES);
  const withContext = currentLines.slice(contextFrom, contextTo).join("\n");

  let linesMatched = 0;
  for (let j = 0; j < Math.min(span, quotedLines.length); j++) {
    const line = lineAt(startLine + j);
    if (line === quotedLines[j] || (trimmedQuoted[j] !== "" && line.trim() === trimmedQuoted[j])) linesMatched += 1;
  }

  const present = Array.from({ length: span }, (_, j) => lineAt(startLine + j)).join("\n");
  return {
    line: startLine + 1,
    text,
    withContext,
    truncated: span > MAX_SITE_LINES,
    linesMatched,
    linesQuoted: quotedLines.length,
    similarity: knownSimilarity ?? similarity(quoted.replace(/\n$/, ""), present),
    differs: classifyDifference(quoted.replace(/\n$/, ""), present),
  };
}

/**
 * The lookup as the block a refusal carries.
 *
 * `where` names the file so the caller does not have to hold which of its open
 * files this refusal is about. The "nothing close enough" branch is not filler:
 * without it, a refusal carrying no site is indistinguishable from one where
 * nobody looked, and the caller re-reads the file to find out which — the exact
 * cost this exists to remove.
 */
export function renderIntendedSite(lookup: QuotedTextLookup, where: string): string {
  if (lookup.kind === "matched") {
    return `the text you quoted IS present in ${where}, at line ${lookup.line} — the match did not fail on its absence`;
  }
  if (lookup.kind === "vanished") {
    return `nothing at any site in ${where} is close enough to show: ${lookup.vanished.because}`;
  }
  return renderSite(lookup.site, where);
}

/** The site as the block a refusal carries. Shared by the found and the known-line paths. */
export function renderSite(site: IntendedSite, where: string): string {
  if (site.text === "") {
    return (
      `what is at ${where}:${site.line} now — the lines you quoted were deleted outright, so there is ` +
      `nothing there to re-quote. What surrounds the gap:\n${site.withContext}`
    );
  }
  const cut = site.truncated ? ` (first ${MAX_SITE_LINES} of ${site.linesQuoted} lines)` : "";
  return (
    `what is at ${where}:${site.line} now — ${site.linesMatched} of ${site.linesQuoted} quoted line(s) still ` +
    `match there, and the rest is ${describeDifference(site.differs)}${cut}:\n` +
    `${site.withContext}\n` +
    `Retry quoting the text above; it is what the file holds, so this does not need a re-read.`
  );
}
