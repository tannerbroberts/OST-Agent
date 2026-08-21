/**
 * The workspace map, and the census that measures how much of the run's own
 * path-guessing it would have answered.
 *
 * The candidate this measures: "Hand the run a layout of the workspace before it
 * takes its first action" — at the start of every run, produce a compact map of
 * what is actually here (the top of the home tree, where the source is, where the
 * tests are, where the vault is, which sibling directories exist) and give it to
 * the run before it does anything. The recorded failures it is aimed at are this
 * product's own agent guessing at paths and being told they are not there:
 * `ls: /Users/tanner/dev/ost-agent-meta: No such file or directory` when the
 * directory was `/Users/tanner/ost-agent-meta`, a segment off and a call spent to
 * learn it.
 *
 * The node fixed the bar before anything was counted, and it is deliberately TWO
 * clauses in one command: a rendered map that **serializes under 2,000 characters**
 * must answer **at least 70%** of the path lookups that actually failed in this
 * vault's harvested transcripts. Asserting both at once is what keeps the solution
 * from being trivially satisfiable by making the map bigger — a map large enough to
 * answer everything is too large to carry into every session, and one small enough
 * to carry will omit the thing being looked for often enough that the probing habit
 * survives.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * {@link WORKSPACE_MAP_RULE} fixes the byte budget and the coverage bar. The
 * coverage predicate is fixed here too, and it is the arguable part, so it is
 * written down rather than tuned: a failed lookup for path `X` is **answered** when
 * the map lists the children of `X`'s deepest existing ancestor directory. That is
 * the exact information a guess needs — the map shows what really sits where the run
 * was reaching, so the wrong next segment is visible as absent (or the right one as
 * present) without a call. A lookup whose neighbourhood the map does not cover is
 * **not** answered, however close the map comes, because the run would still have
 * had to probe to see the truth.
 *
 * ## What a count out of this cannot settle, and what it excludes
 *
 * The corpus is the path-shaped failures this product's passes actually suffered
 * (`test/fixtures/workspace-map/`, cut from the same transcripts as the
 * path-failure-attribution fixture). It is NOT the whole of that record: a WORKSPACE
 * map can only answer a lookup that is *about this workspace*, so the harvest keeps
 * only the path lookups that name a location inside the mapped territory — the code
 * repository, the vault, their sibling vaults, and the home/`dev` containers above
 * them — and drops, counted and named in the fixture's `PROVENANCE.md`, three
 * classes it can never serve: failures that name no path at all (a bare
 * `File does not exist`, a `git` fatal outside a repo), failures whose subject is a
 * glob-expanded command-line flag rather than a path (`--include=*.ts`), and
 * failures in a different project or an ephemeral scratch/worktree directory. Those
 * exclusions are why the headline share is read against workspace lookups and not
 * against every failure the passes hit — see the census over the committed corpus in
 * `test/runner/workspace-map-coverage.test.ts`, which pins both numbers.
 *
 * It also scores the map against paths reached for by runs that had **no** map,
 * which is a corpus shaped by the absence of the thing being tested; it says nothing
 * about staleness (a map handed over at the first action and wrong by the fortieth),
 * and nothing about whether a run that is handed a map consults it rather than
 * probing anyway.
 */

/** The byte budget and the coverage bar, fixed before the corpus was counted. */
export const WORKSPACE_MAP_RULE = {
  /** A rendered map must serialize under this many characters to be worth carrying into every session. */
  maxChars: 2000,
  /** At least this share of workspace path-lookups must be answered for the solution to clear as stated. */
  bar: 0.7,
} as const;

/**
 * A frozen snapshot of the directory tree the map is rendered from and scored
 * against. `dirs` maps an absolute directory path to its sorted child names; a path
 * is "a directory that exists" iff it is a key here. Notable dotfiles at a root
 * (`.gitignore`, config) are listed among a directory's children but are not
 * themselves keys, because the map lists them without drilling into them.
 */
export interface Layout {
  /** Absolute home directory, the anchor `~` renders against. */
  home: string;
  /** Absolute directory path → sorted child names (directories and notable files). */
  dirs: Record<string, string[]>;
}

/**
 * Which parts of a layout the map renders, in the order it renders them. Each entry
 * names a directory whose children are listed and a short label; the renderer walks
 * them until the byte budget is spent, so earlier entries are the ones that survive
 * a tight budget. This is the boundary the node calls "the design question": what a
 * map small enough to carry chooses to include.
 */
export interface MapSection {
  /** Absolute path of a directory in the layout whose children to list. */
  dir: string;
  /** Human label for the line, e.g. "home", "repo", "vault". */
  label: string;
}

/**
 * The sections a workspace map renders, in priority order, for a home directory that
 * holds the code repository at `dev/OST-Agent` and the vault at `ost-agent-meta`.
 *
 * The home and the two project roots come first, their interiors after: a tight
 * budget drops from the end, so the order encodes what a run most needs to be told —
 * where it is, which siblings exist, and the top of each project tree — before the
 * finer structure. This is the single definition the harvest and the coverage test
 * both render from, so the map they measure cannot drift from the map that ships.
 */
export function defaultWorkspaceSections(home: string): MapSection[] {
  return [
    { dir: home, label: "home" },
    { dir: `${home}/dev`, label: "dev" },
    { dir: `${home}/dev/OST-Agent`, label: "repo" },
    { dir: `${home}/ost-agent-meta`, label: "vault" },
    { dir: `${home}/dev/OST-Agent/src`, label: "repo/src" },
    { dir: `${home}/dev/OST-Agent/test`, label: "repo/test" },
    { dir: `${home}/dev/OST-Agent/docs`, label: "repo/docs" },
    { dir: `${home}/dev/OST-Agent/scripts`, label: "repo/scripts" },
    { dir: `${home}/dev/OST-Agent/examples`, label: "repo/examples" },
    { dir: `${home}/ost-agent-meta/.ost-agent`, label: "vault/.ost-agent" },
  ];
}

export interface WorkspaceMap {
  /** The rendered map, as the text a run is handed before its first action. */
  text: string;
  /** Every directory whose children the text actually lists — the coverage set. */
  covered: string[];
  /** Sections dropped because the budget was spent before they could be rendered. */
  omitted: MapSection[];
}

/** `~`-abbreviate an absolute path for display, leaving non-home paths whole. */
function tilde(abs: string, home: string): string {
  return abs === home ? "~" : abs.startsWith(home + "/") ? "~" + abs.slice(home.length) : abs;
}

/**
 * The line the map prints for one directory: its child DIRECTORIES, named, and a
 * count of the files alongside them.
 *
 * A map is for navigating the tree, so it lists the directories a run would `cd`
 * into or address, not every file beside them — that is the difference between "a
 * map" and "a full listing" the node turns on. A child `c` of `dir` is known to be a
 * directory when `dir/c` is itself a key in the layout; children that are not keys
 * are files (or unsnapshotted), and are summarised as a count so the line stays
 * short without pretending they are not there.
 */
function sectionLine(dir: string, label: string, layout: Layout): string {
  const children = layout.dirs[dir] ?? [];
  const subdirs = children.filter((c) => layout.dirs[`${dir}/${c}`] !== undefined);
  const fileCount = children.length - subdirs.length;
  const body = subdirs.length > 0 ? subdirs.join(" ") : "(no subdirectories)";
  const files = fileCount > 0 ? ` (+${fileCount} file${fileCount === 1 ? "" : "s"})` : "";
  return `${label} ${tilde(dir, layout.home)}/: ${body}${files}`;
}

/**
 * Render a workspace map from a layout and an ordered list of sections, stopping
 * before the byte budget is exceeded.
 *
 * A section is rendered whole or not at all: a half-listed directory would read as a
 * complete one and answer a lookup wrongly, which is worse than omitting it and
 * saying so. Every omitted section is returned on {@link WorkspaceMap.omitted} so a
 * caller — and the coverage census — can see what the budget cost rather than
 * inferring a clean map from a silent one.
 */
export function renderWorkspaceMap(
  layout: Layout,
  sections: MapSection[],
  opts: { maxChars?: number } = {},
): WorkspaceMap {
  const maxChars = opts.maxChars ?? WORKSPACE_MAP_RULE.maxChars;
  const header = `workspace layout (home ${layout.home}):`;
  const lines: string[] = [header];
  const covered: string[] = [];
  const omitted: MapSection[] = [];

  for (const section of sections) {
    const children = layout.dirs[section.dir];
    if (children === undefined) {
      // A section naming a directory the layout does not hold is a mistake in the
      // caller's section list, not a budget casualty. It contributes nothing and is
      // reported as omitted so the gap is visible rather than silent.
      omitted.push(section);
      continue;
    }
    const block = sectionLine(section.dir, section.label, layout);
    // The header is always kept; a section is kept only if the whole map still fits
    // with it (the join adds one newline per line, counted by re-joining below).
    const candidate = [...lines, block].join("\n");
    if (candidate.length > maxChars) {
      omitted.push(section);
      continue;
    }
    lines.push(block);
    covered.push(section.dir);
  }

  return { text: lines.join("\n"), covered, omitted };
}

/** One path lookup that failed, lifted from the harvested transcripts. */
export interface WorkspacePathLookup {
  /** The subject as the failure message named it, kept for display and provenance. */
  subject: string;
  /** The subject resolved to an absolute path, against the session's cwd at cut time. */
  absolute: string;
  /** Session id, so a row can be traced back to the transcript it came from. */
  session: string;
}

/**
 * The deepest ancestor-or-self of `abs` that is a directory in the layout.
 *
 * This is the directory whose contents a run needed to see. If `abs` itself is a
 * known directory, that is the answer; otherwise walk up until a real directory is
 * found (the layout root always terminates the walk). The nearest real directory is
 * where the truth about the guess lives: its child list either contains the next
 * segment the run reached for, or visibly does not.
 */
export function deepestExistingDir(abs: string, layout: Layout): string | null {
  let cur = abs;
  // Normalise a trailing slash so `/a/b/` and `/a/b` resolve to the same directory.
  if (cur.length > 1 && cur.endsWith("/")) cur = cur.slice(0, -1);
  while (cur !== "/" && cur.length > 0) {
    if (layout.dirs[cur] !== undefined) return cur;
    const parent = cur.slice(0, cur.lastIndexOf("/"));
    cur = parent.length === 0 ? "/" : parent;
  }
  return layout.dirs["/"] !== undefined ? "/" : null;
}

export interface WorkspaceMapCensus {
  /** Characters in the rendered map. */
  sizeChars: number;
  /** True when the map is within the byte budget. */
  withinBudget: boolean;
  /** Workspace path-lookups scored — the denominator. */
  total: number;
  /** Lookups whose neighbourhood the map covers. */
  answered: number;
  /** Lookups the map does not cover, with the ancestor directory each needed. */
  unanswered: { subject: string; needed: string; session: string }[];
  /** answered / total, or null when there is nothing to score. */
  share: number | null;
  /** True only when the map is within budget AND clears the coverage bar. Both clauses. */
  meetsBar: boolean;
}

/**
 * Score a rendered map against the workspace path-lookups that failed.
 *
 * The two clauses are joined here on purpose: {@link WorkspaceMapCensus.meetsBar} is
 * true only when the map is under budget AND answers at least the bar's share. A map
 * that answers everything by listing every leaf would blow the budget and fail the
 * first clause; a map that fits by covering nothing would fail the second. The
 * solution has to satisfy both at once, which is the squeeze the node named.
 */
export function workspaceMapCoverage(
  map: WorkspaceMap,
  layout: Layout,
  lookups: readonly WorkspacePathLookup[],
): WorkspaceMapCensus {
  const covered = new Set(map.covered);
  const unanswered: WorkspaceMapCensus["unanswered"] = [];
  let answered = 0;

  for (const lookup of lookups) {
    const needed = deepestExistingDir(lookup.absolute, layout);
    if (needed !== null && covered.has(needed)) {
      answered++;
    } else {
      unanswered.push({ subject: lookup.subject, needed: needed ?? "(none)", session: lookup.session });
    }
  }

  const total = lookups.length;
  const share = total === 0 ? null : answered / total;
  const withinBudget = map.text.length <= WORKSPACE_MAP_RULE.maxChars;
  return {
    sizeChars: map.text.length,
    withinBudget,
    total,
    answered,
    unanswered,
    share,
    meetsBar: withinBudget && share !== null && share >= WORKSPACE_MAP_RULE.bar,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * The census as an operator reads it: the map's size and coverage first, then the
 * verdict in words. The verdict says CLEARS or REFUTED rather than leaving a reader
 * to compare two decimals, because this census exists to license the solution or
 * kill it and an exit code cannot carry that distinction — the command is green when
 * the count has been taken, whichever way it came out.
 */
export function formatWorkspaceMapCensus(census: WorkspaceMapCensus): string {
  const lines: string[] = [];
  const verdict = census.meetsBar ? "CLEARS" : "REFUTED";
  lines.push(
    `Workspace-map coverage: ${verdict} — a map of ${census.sizeChars} char(s) ` +
      `(budget ${WORKSPACE_MAP_RULE.maxChars}, ${census.withinBudget ? "within" : "OVER"}) answers ` +
      `${census.answered} of ${census.total} workspace path-lookup(s) (${pct(census.share ?? 0)}), ` +
      `against a pre-committed bar of ${pct(WORKSPACE_MAP_RULE.bar)}.`,
  );
  if (census.unanswered.length > 0) {
    lines.push("");
    lines.push("Not answered — the map does not cover the directory each of these needed:");
    for (const u of census.unanswered) lines.push(`  ${u.subject} → needed ${u.needed}`);
  }
  return lines.join("\n");
}
