/**
 * The compression-surface registry — every place this product shortens what a
 * reader gets, written down as a contract instead of scattered as reflexes.
 *
 * Every bounded output here exists to serve a downstream decision, and each of
 * those decisions reads specific things from the bounded form. Until now that
 * contract lived only in each module's comments: the caps are real (Z2, the
 * byte-budgeted tree read, the 280-char excerpts, the computed rollup) but each
 * was cut into its surface after an unbounded read did damage, and nothing
 * anywhere said what the squeeze must preserve. A cap with no stated contract
 * can only ever be tuned by waiting for the next injury.
 *
 * This registry is to outputs what the sense census (`src/loop/senses.ts`) is
 * to inputs: an enumeration with honest states, built so the gaps are sayable.
 * Three of them are load-bearing:
 *
 *  - a surface that clips **silently** is registered as `drops: "silent"` —
 *    the debt is named rather than hidden, and the harness pins the list so it
 *    can only shrink;
 *  - a surface whose contract is **declared but not yet proven** carries
 *    `proof: "declaration"` — distinguishable from one whose preservation a
 *    test actually drives, for the same reason the census keeps "live" and
 *    "reached" on separate axes;
 *  - the codebase's four vocabularies for "I shortened something" (a
 *    `Truncation` record, a `{count, shown, hidden}` frame, a bare boolean, a
 *    running dropped-count) are named as values of one type, so the
 *    fragmentation is visible in one file instead of discoverable by reading
 *    twenty-two.
 *
 * The harness that holds this file to the source is
 * `test/compression/fidelity-contract.test.ts`: every cap constant in `src/`
 * must be claimed by exactly one surface here (a new cap fails the build until
 * it is registered), every claimed cap must still exist in its module, and
 * every surface marked `proof: "behavioral"` is driven over a real fixture.
 *
 * Deliberately dependency-free, like `SenseObservation` and for the same
 * reason: the declarations must be importable from anywhere (tests, the CLI,
 * a future census renderer) without inverting a layering edge.
 */

/** What a bound is for — because not every cap is display compression. */
export type SurfaceKind =
  /** Output shortened to fit a reader's window. The core case. */
  | "bounded-output"
  /** A bound on what enters the system (sanitization, filing clips). */
  | "input-bound"
  /** A bound on how far a traversal goes, not on what is shown. */
  | "walk-bound";

/**
 * How a surface admits it shortened something.
 *
 * Six values rather than a boolean because the reader acts differently on
 * each, and a registry that rounded them to admitted/silent would be a second
 * way of saying nothing.
 */
export type DropRecord =
  /** A `Truncation`-shaped record — `{ list, shown, total, hidden }` — travels with the sample. */
  | "truncation-record"
  /** A `{ count, shown, hidden, note }` response frame; the count is never capped. */
  | "count-frame"
  /** A running overflow number (`dropped: N`) accumulates and is reported. */
  | "dropped-count"
  /** A bare `truncated: true` — the fact survives, the size of the loss does not. */
  | "boolean-flag"
  /** A rendered sentence — "… N more not listed" — in the prose itself. */
  | "prose-note"
  /** Nothing records the clip. Registered so the debt is named, and pinned so it only shrinks. */
  | "silent"
  /** Nothing is dropped at all: the bounded form is derived over the full set. */
  | "derived";

/** How far the harness currently holds this surface to its contract. */
export type ProofState =
  /** A test drives the real production code over a fixture and asserts the contract. */
  | "behavioral"
  /** The contract is declared here and the caps are pinned to source, but no test drives it yet. */
  | "declaration";

/**
 * One registered compression surface.
 *
 * `reads` is the decision-fields contract: the facts the downstream decision
 * consumes, which the bounded form must therefore carry. It is written from
 * the decision's side ("counts are over the full set"), never from the
 * implementation's ("slice(0, 25)"), because the implementation is what the
 * contract exists to judge.
 */
export interface CompressionSurface {
  /** What an operator would call it. Unique across the registry. */
  readonly name: string;
  /** Repo-relative path of the module holding the bound. */
  readonly module: string;
  /**
   * The cap/budget constants in that module this surface claims. Every
   * census-matched constant in `src/` must be claimed by exactly one surface;
   * empty is legal for surfaces whose bound is an inline literal or whose
   * compression is pure derivation, and the decision text says which.
   */
  readonly caps: readonly string[];
  readonly kind: SurfaceKind;
  /** The downstream decision this bounded output serves. One sentence. */
  readonly decision: string;
  /** The decision-fields contract: what must survive the bound. */
  readonly reads: readonly string[];
  readonly drops: DropRecord;
  readonly proof: ProofState;
}

/**
 * The registry. Ordering is by module path, so a reader can diff it against
 * the census grep without re-sorting either side.
 */
export const COMPRESSION_SURFACES = [
  {
    name: "actions history fetch",
    module: "src/adapters/actions.ts",
    caps: ["DEFAULT_MAX_PAGES"],
    kind: "walk-bound",
    decision: "how much CI-run history one cold fetch may pull before it is treated as caught up",
    reads: ["the page walk stops at the cap instead of running away on a cold start"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "deposit metadata clip",
    module: "src/adapters/deposit.ts",
    caps: ["MAX_META_CHARS"],
    kind: "input-bound",
    decision: "keeping the agent-authored frame around a deposit short enough to stay a frame",
    reads: [
      "the collaborator's answer is NEVER clipped — the cap binds only the from/closing metadata, so the verbatim contract survives any input",
    ],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "friction filing clip",
    module: "src/adapters/friction.ts",
    caps: ["MAX_NOTE_CHARS", "MAX_CONTEXT_CHARS"],
    kind: "input-bound",
    decision: "whether a filed friction note is specific enough to map into the tree",
    reads: ["the leading characters of the note survive, because the point of pain is stated first"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "transcript reading served to the model reader",
    module: "src/adapters/transcript-model-reader.ts",
    caps: ["MAX_QUOTE_CHARS", "MAX_READING_CHARS"],
    kind: "bounded-output",
    decision: "which stalls and dead ends in a finished session are worth filing as evidence",
    reads: [
      "an elision marks its omitted character count inline, so a filed quote stays locatable",
      "head and tail both survive — the clip removes the middle, never the frame",
    ],
    drops: "prose-note",
    proof: "declaration",
  },
  {
    name: "transcript adapter event digest",
    module: "src/adapters/transcript.ts",
    caps: ["DEFAULT_MAX_EVENTS", "DEFAULT_MAX_SESSIONS", "MAX_DETAIL_CHARS"],
    kind: "bounded-output",
    decision: "which sessions' friction events become evidence records in the vault",
    reads: ["event counts per session are taken before the display cap"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "dirty-path refusal listing",
    module: "src/cli/loop.ts",
    caps: ["DIRTY_PATHS_SHOWN"],
    kind: "bounded-output",
    decision: "whether an operator can tell what made the working tree dirty enough to refuse a firing",
    reads: ["the dirty-file count is exact even when the listing is cut"],
    drops: "prose-note",
    proof: "declaration",
  },
  {
    name: "analysis renders",
    module: "src/eval/render.ts",
    caps: ["MAX_ITEMS_PER_LIST", "RENDER_BUDGET_BYTES", "DETAIL_BUDGET_BYTES"],
    kind: "bounded-output",
    decision: "what a human acts on from check, debt, gate and status without opening the vault",
    reads: [
      "every shortened list names how many it is not showing and the full total",
      "every verdict and count is computed over the full set — the elision coda says so",
      "a sample is a prefix, never a selection: an unaffordable line stops the list",
    ],
    drops: "prose-note",
    proof: "declaration",
  },
  {
    name: "near-miss directory listing",
    module: "src/fs/near-miss.ts",
    caps: ["MAX_PRESENT"],
    kind: "bounded-output",
    decision: "whether a failed path was a typo — judged against what actually exists nearby",
    reads: ["the listing marks itself truncated, so an absence is never read as proof"],
    drops: "boolean-flag",
    proof: "declaration",
  },
  {
    name: "near-miss ancestor walk",
    module: "src/fs/near-miss.ts",
    caps: ["MAX_ANCESTOR_HOPS"],
    kind: "walk-bound",
    decision: "how far up the tree a path diagnosis may look for the intended directory",
    reads: ["the walk terminates at the cap instead of scanning to the filesystem root"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "corrections ledger",
    module: "src/loop/corrections.ts",
    caps: ["MAX_CORRECTIONS", "MAX_PERMITTED_CHARS", "MAX_ATTEMPTED_CHARS"],
    kind: "bounded-output",
    decision: "whether the loop repeats a correction it has already been given",
    reads: ["overflow accumulates into a dropped-count the briefing names, so age-out is visible"],
    drops: "dropped-count",
    proof: "declaration",
  },
  {
    name: "ruleset proposal bound",
    module: "src/knowledge/ruleset-proposal.ts",
    caps: ["MAX_RULE_CHARS", "MAX_RATIONALE_CHARS", "MAX_SOURCE_CHARS"],
    kind: "input-bound",
    decision: "whether a human adopts the agent's drafted rule change into the executing ruleset",
    reads: [
      "nothing is ever clipped: a draft past the cap is refused whole, so the reviewed text and the adopted text are the same bytes",
    ],
    drops: "derived",
    proof: "behavioral",
  },
  {
    name: "sense census detail",
    module: "src/loop/senses.ts",
    caps: ["MAX_DETAIL_CHARS"],
    kind: "bounded-output",
    decision: "which senses an operator repairs after reading a firing's closing report",
    reads: ["the state and the reach clause survive whatever the detail clip does"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "next-work sweep",
    module: "src/mcp/next-work.ts",
    caps: ["MAX_ITEMS_PER_LIST", "MAX_LISTED_CHILDREN", "EXCERPT_CHARS"],
    kind: "bounded-output",
    decision: "what an unattended pass does next, and whether the sweep is done",
    reads: [
      "every count and the done verdict are computed over the full set, never the shown one",
      "each capped list carries a truncation record whose hidden equals total minus shown",
      "the hidden totals appear in the summary prose, not only in a field",
      "an excerpt travels with the true body length, and the full-body channel is named",
    ],
    drops: "truncation-record",
    proof: "behavioral",
  },
  {
    name: "evidence body channel",
    module: "src/mcp/next-work.ts",
    caps: ["MAX_BODY_CHARS"],
    kind: "bounded-output",
    decision: "whether one evidence record, read in full, changes how it should be mapped",
    reads: ["the served body names its true character count, and the truncation label names its units"],
    drops: "truncation-record",
    proof: "behavioral",
  },
  {
    name: "census quoted sources",
    module: "src/ost/census.ts",
    caps: ["MAX_QUOTED_SOURCE_LENGTH"],
    kind: "bounded-output",
    decision: "whether the census's response-size bound argument holds — every quoted string is clamped",
    reads: ["no quoted source exceeds the clamp, because the per-list caps' size argument rests on it"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "title sanitization",
    module: "src/ost/sanitize.ts",
    caps: ["MAX_TITLE_LENGTH"],
    kind: "input-bound",
    decision: "the base assumption every response-size argument in the product rests on",
    reads: ["no stored title exceeds the bound, so every downstream cap can price a line"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "capability record refs",
    module: "src/product/capability.ts",
    caps: ["MAX_REFS"],
    kind: "bounded-output",
    decision: "what a builder-capability profile cites as its evidence",
    reads: ["a truncated clone is marked shallow before anything is read from it"],
    drops: "boolean-flag",
    proof: "declaration",
  },
  {
    name: "repo file read",
    module: "src/product/repo.ts",
    caps: ["MAX_FILE_CHARS"],
    kind: "bounded-output",
    decision: "whether an idea is grounded in what the product's source actually says",
    reads: ["the cap applies to content and never to the frame — the truncation marker always survives"],
    drops: "boolean-flag",
    proof: "declaration",
  },
  {
    name: "repo listing",
    module: "src/product/repo.ts",
    caps: ["MAX_LIST_ENTRIES"],
    kind: "bounded-output",
    decision: "which files a repo-grounding pass believes exist",
    reads: ["the entry cap is declared here because the listing itself does not admit it"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "offline pass round cap",
    module: "src/runner/offline-pass.ts",
    caps: ["MAX_ITERATIONS"],
    kind: "walk-bound",
    decision: "when the zero-credential offline driver stops looping rather than treating the tree as caught up",
    reads: [
      "the loop already breaks on its own the moment a round does nothing, so this cap only bounds the pathological case — a round that keeps finding heuristic work forever",
    ],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "broker detail clip",
    module: "src/security/broker.ts",
    caps: ["MAX_DETAIL_CHARS"],
    kind: "bounded-output",
    decision: "what an operator learns about a brokered action from its logged detail",
    reads: ["the leading characters survive, where the action names itself"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "ingest report titles",
    module: "src/security/tools.ts",
    caps: ["MAX_TITLE_DISPLAY_LENGTH", "MAX_TITLES_LISTED"],
    kind: "bounded-output",
    decision: "whether an ingest run captured what the operator dropped in — bodies never reach the transcript",
    reads: ["overflow is rendered as a named '+N more', never dropped without count"],
    drops: "prose-note",
    proof: "declaration",
  },
  {
    name: "tree read",
    module: "src/security/tools.ts",
    caps: ["READ_TREE_BUDGET_BYTES", "MAX_EDGES_LISTED_PER_NODE"],
    kind: "bounded-output",
    decision: "which neighbourhood of the tree a session decides to work in",
    reads: [
      "count is always the whole tree — the number that says what was left out is never capped",
      "shown plus hidden equals count",
      "per-node tagCount and linkCount appear exactly when the arrays are samples",
      "the note says the verdicts are computed over all nodes, so a cap cannot read as a smaller tree",
    ],
    drops: "count-frame",
    proof: "behavioral",
  },
  {
    name: "hand-exclusion command clip",
    module: "src/telemetry/hand-exclusion.ts",
    caps: ["MAX_COMMAND_CHARS"],
    kind: "bounded-output",
    decision: "which hand-run commands are excluded from the loop's own telemetry",
    reads: ["the leading characters survive, where the command names itself"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "path-failure attribution clips",
    module: "src/telemetry/path-failure-attribution.ts",
    caps: ["MAX_ERROR_CHARS", "MAX_COMMAND_CHARS"],
    kind: "bounded-output",
    decision: "which directory a captured path failure is attributed to",
    reads: ["the leading characters of command and error survive, where the path appears"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "preflight excerpt clip",
    module: "src/telemetry/preflight.ts",
    caps: ["MAX_EXCERPT_CHARS"],
    kind: "bounded-output",
    decision: "whether a preflight statement was read before the tool ran",
    reads: ["the leading characters survive"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "search-literality excerpt clip",
    module: "src/telemetry/search-literality.ts",
    caps: ["MAX_EXCERPT_CHARS"],
    kind: "bounded-output",
    decision: "whether a search was taken literally or paraphrased",
    reads: ["the leading characters survive"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "usage rollup error clip",
    module: "src/telemetry/usage.ts",
    caps: ["MAX_ERR_CHARS"],
    kind: "bounded-output",
    decision: "which failure shapes recur across a window of runs",
    reads: ["the leading characters survive, where the error names its shape"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "web redirect walk",
    module: "src/web/guard.ts",
    caps: ["MAX_REDIRECTS"],
    kind: "walk-bound",
    decision: "how many hops a fetched URL may take before the fetch is refused",
    reads: ["the walk terminates at the cap"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "web page read",
    module: "src/web/guard.ts",
    caps: ["MAX_PAGE_CHARS"],
    kind: "bounded-output",
    decision: "what a budgeted lookup brings back into the context",
    reads: ["the read marks itself truncated and the rendering names the served length"],
    drops: "boolean-flag",
    proof: "declaration",
  },
  {
    name: "web search request",
    module: "src/web/search.ts",
    caps: ["MAX_SEARCH_RESULTS"],
    kind: "input-bound",
    decision: "how many results one budgeted search may request",
    reads: ["the request clamp is applied at both the search and the tool boundary"],
    drops: "silent",
    proof: "declaration",
  },
  {
    name: "computed rollup",
    module: "src/eval/rollup.ts",
    caps: [],
    kind: "bounded-output",
    decision: "the top-level state of the whole tree, one line per bucket, on demand",
    reads: [
      "every figure is derived from the full tree at read time — nothing is narrated or stored",
      "nodes the walk could not file are reported as unfiled, never silently omitted",
    ],
    drops: "derived",
    proof: "behavioral",
  },
  {
    name: "standing briefing recent-node window",
    module: "src/ost/standing-briefing.ts",
    caps: [],
    kind: "bounded-output",
    decision: "what a returning operator re-learns about the tree without opening it — the 10-node window is an inline literal",
    reads: ["the recent-node list names how many more the week held when it stops early"],
    drops: "prose-note",
    proof: "declaration",
  },
] as const satisfies readonly CompressionSurface[];

/** The registry, keyed by surface name. Built once; the census test asserts uniqueness. */
export const SURFACE_BY_NAME: ReadonlyMap<string, CompressionSurface> = new Map(
  COMPRESSION_SURFACES.map((s) => [s.name, s]),
);

/** One cap constant found in the source by the census grep. */
export interface CensusConstant {
  /** Repo-relative module path. */
  readonly module: string;
  /** The constant's name as declared. */
  readonly name: string;
}

/** What the census found when it held the registry against the source. */
export interface CensusGaps {
  /** Constants in the source no surface claims — new caps that must be registered to build. */
  readonly unclaimed: CensusConstant[];
  /** Claimed caps that no longer exist in their module — registry rot. */
  readonly phantom: CensusConstant[];
  /** Constants claimed by more than one surface — a contract with two owners has none. */
  readonly doubleClaimed: CensusConstant[];
}

/**
 * Hold the registry against the source's cap constants. A pure fold, like
 * `assembleCensus`, and for the same reason: the test drives it directly with
 * whatever it grepped, so every gap state is exercisable without a fixture.
 *
 * Claims are per (module, name): two modules may each declare
 * `MAX_DETAIL_CHARS` and be claimed by different surfaces, but within one
 * module a constant has exactly one owning surface.
 */
export function censusGaps(found: readonly CensusConstant[]): CensusGaps {
  const claims = new Map<string, number>();
  for (const s of COMPRESSION_SURFACES) {
    for (const cap of s.caps) {
      const key = `${s.module} ${cap}`;
      claims.set(key, (claims.get(key) ?? 0) + 1);
    }
  }

  const foundKeys = new Set(found.map((c) => `${c.module} ${c.name}`));

  const unclaimed = found.filter((c) => !claims.has(`${c.module} ${c.name}`));
  const phantom: CensusConstant[] = [];
  for (const key of claims.keys()) {
    if (foundKeys.has(key)) continue;
    const [module, name] = key.split(" ");
    phantom.push({ module, name });
  }
  const doubleClaimed: CensusConstant[] = [];
  for (const [key, n] of claims) {
    if (n < 2) continue;
    const [module, name] = key.split(" ");
    doubleClaimed.push({ module, name });
  }
  return { unclaimed, phantom, doubleClaimed };
}
