/**
 * The declared root vocabulary — a run is handed a few named places and asks for
 * things relative to those names instead of assembling absolute paths itself —
 * and the census that measures how much of this machine's recorded path failure
 * a vocabulary that small could ever have covered.
 *
 * The candidate this measures: "Resolve every path against a declared root, so a
 * wrong prefix cannot be constructed". A caller asks for the vault's inbox, not
 * for a string beginning `/Users/tanner/`; the prefix is supplied once, correctly,
 * by whatever knows it. The failures it is aimed at are this product's own passes
 * assembling a head they had no business assembling —
 * `/Users/tanner/dev/ost-agent-meta` for `/Users/tanner/ost-agent-meta`, a segment
 * wrong in the part the caller invented and right in the part it actually meant.
 *
 * The assumption test beneath it fixed the bar before anything was counted, and
 * fixed the vocabulary with it: **a declared root vocabulary of at most four names
 * covers at least 80% of the paths that actually failed**, the four being the ones
 * the node itself named — project, vault, logs, home. Coverage is the whole test
 * rather than a proxy for it, because anything outside the named roots is
 * constructed by hand exactly as before: a root set that covers half the failures
 * halves the benefit and keeps all of the machinery.
 *
 * ## The rule is committed here, before the corpus is cut
 *
 * Nothing in this file reads a file, and the four names come from the node's own
 * text rather than from the record — a vocabulary chosen after seeing which
 * prefixes failed would score against the sample it was fitted to and look
 * identical to one that was not. {@link PATH_ROOT_RULE} carries the bar, the
 * ceiling on how many names may be declared, and the three readings the census
 * refuses to choose between.
 *
 * ## `home` is a container, not a root, and the census says so both ways
 *
 * On a single-operator machine every path worth having begins `/Users/tanner`, so
 * a vocabulary that counts `home` as a root scores near 100% while preventing
 * nothing: `~/dev/ost-agent-meta` and `~/ost-agent-meta` are both under it, which
 * is precisely the mistake the solution exists to make unconstructible. That is
 * why {@link Containment} is a reading rather than a decision — the census reports
 * `specific` (project, vault, logs) beside `with-home` and publishes whether the
 * choice moved the verdict, instead of quietly taking the number that flatters the
 * solution.
 *
 * ## `project` is a binding, not a name
 *
 * The same argument applies once a machine holds more than one repository. This
 * one holds five, so "the project" resolves to a different directory in every
 * session, and {@link Vocabulary} recounts the whole census both ways: `per-session`
 * binds `project` to the directory the call was actually issued from, and `fixed`
 * binds it to this product's own repository the way a machine-wide vocabulary
 * would have to.
 *
 * ## What a count out of this cannot settle
 *
 * Green here would say only that a small vocabulary *reaches* the places that
 * failed. It says nothing about the failure the node itself calls the more
 * dangerous one — a root pointing somewhere wrong produces confident, uniform,
 * wrong paths everywhere at once, and no coverage number would show it. And every
 * path counted here was reached for by a run that had **no** root vocabulary, so
 * the corpus cannot say how the habit changes once one exists.
 */
import path from "node:path";
import {
  classifyPathFailure,
  clip,
  MAX_COMMAND_CHARS,
  MAX_ERROR_CHARS,
  subjectOf,
  type PathFailureClass,
} from "../telemetry/path-failure-attribution.js";
import { GUESS_RULE, pathsInCommand, normalizePath } from "../telemetry/path-guess-hit-rate.js";
import type { TranscriptSession } from "../telemetry/preflight.js";

/** The four names the node declared, in the order it declared them. */
export const ROOT_NAMES = ["project", "vault", "logs", "home"] as const;

export type RootName = (typeof ROOT_NAMES)[number];

/**
 * Whether `home` is allowed to count as a root.
 *
 * `specific` is the reading in which a root does work: it supplies a prefix the
 * caller could otherwise have got wrong. `with-home` is the vocabulary exactly as
 * the node named it, kept because dropping a name the node chose would be fitting
 * the test to the answer.
 */
export type Containment = "specific" | "with-home";

/**
 * What to do with a path that was written relative.
 *
 * `recorded-cwd` resolves it against the working directory the transcript entry
 * carried; `as-written` refuses to resolve it at all and counts it as uncovered.
 * The second is the conservative convention this repository already runs under —
 * a record needing a judgement counts as a failure of the rule rather than a pass
 * — and the first exists because the judgement here is not a judgement: the
 * directory is on the record.
 */
export type Resolution = "recorded-cwd" | "as-written";

/** Whether `project` is bound per run or fixed machine-wide. */
export type Vocabulary = "per-session" | "fixed";

/**
 * The bar, the ceiling on the vocabulary, and the readings — all fixed before any
 * path was counted.
 */
export const PATH_ROOT_RULE = {
  /** At least this share of failed paths must fall under the declared roots. */
  bar: 0.8,
  /** The node's ceiling on how many names may be declared. */
  maxRoots: 4,
  containments: ["specific", "with-home"] as Containment[],
  resolutions: ["recorded-cwd", "as-written"] as Resolution[],
  vocabularies: ["per-session", "fixed"] as Vocabulary[],
  /**
   * Which failure shapes are about a path at all. The same three the sibling
   * census counts as savable, for the same reason: a `denied-path` names a path
   * that *exists*, so a root vocabulary neither causes it nor prevents it.
   * Counted separately rather than dropped silently — see
   * {@link PathRootCensus.deniedPaths}.
   */
  countedClasses: ["missing-path", "no-matches", "not-a-repo"] as PathFailureClass[],
  /**
   * An error message names its subject in prose, and prose sometimes hands back a
   * program name or a command-line flag where a path should be. A subject is kept
   * only if it looks like a path under the sibling census's rule — a separator in
   * it, or a bare filename with an extension this machine's work actually uses.
   */
  notAPathWord: GUESS_RULE.notAPathWord,
  bareFileName: GUESS_RULE.bareFileName,
} as const;

/**
 * Where the named places are on the machine this corpus came from.
 *
 * Fixed rather than read, for the reason the sibling census fixes `HOME`: a replay
 * has to give the same answer on a different machine next year. `logs` is the
 * directory this product's own loops write to, named in the observation tokens of
 * the corpus itself (`~/Library/Logs/ost-meta-loop.log`).
 */
export const OPERATOR_LAYOUT = {
  home: "/Users/tanner",
  vault: "/Users/tanner/ost-agent-meta",
  logs: "/Users/tanner/Library/Logs",
  /** This product's own repository — what `fixed` binds `project` to. */
  project: "/Users/tanner/dev/OST-Agent",
  /**
   * Directories that hold projects rather than being one. A session whose cwd is
   * `<container>/<name>/…` belongs to the project `<container>/<name>`; a session
   * launched anywhere else is its own project.
   */
  projectContainers: ["/Users/tanner/dev"],
} as const;

/** One vocabulary instance: every declared name bound to an absolute directory. */
export type RootVocabulary = Record<RootName, string>;

/** Why a path could not be built from a root. Each is a refusal, never a guess. */
export type RootRefusal = "unknown-root" | "absolute-tail" | "escapes-root" | "too-many-roots";

/** A call that tried to construct a path the vocabulary does not permit. */
export class RootError extends Error {
  constructor(
    readonly refusal: RootRefusal,
    message: string,
  ) {
    super(message);
    this.name = "RootError";
  }
}

/**
 * Bind the four names to four directories.
 *
 * Rejects a vocabulary that is not four absolute paths, because a root given a
 * relative path is the failure mode the node warns about — one wrong root
 * produces confident, uniform, wrong paths everywhere at once.
 */
export function declareRoots(bindings: Record<string, string>): RootVocabulary {
  const vocab = {} as RootVocabulary;
  const names = Object.keys(bindings);
  if (names.length > PATH_ROOT_RULE.maxRoots) {
    throw new RootError(
      "too-many-roots",
      `a vocabulary may declare at most ${PATH_ROOT_RULE.maxRoots} roots, got ${names.length}`,
    );
  }
  for (const name of names) {
    if (!(ROOT_NAMES as readonly string[]).includes(name)) {
      throw new RootError("unknown-root", `no root is called "${name}" — the vocabulary is ${ROOT_NAMES.join(", ")}`);
    }
    const dir = bindings[name];
    if (!dir.startsWith("/")) {
      throw new RootError("absolute-tail", `root "${name}" must be an absolute directory, got "${dir}"`);
    }
    vocab[name as RootName] = normalizePath(path.normalize(dir));
  }
  return vocab;
}

/**
 * The mechanism itself: ask for a place by name and a tail, and get back a path
 * whose head you did not write.
 *
 * Three refusals, and they are the whole guarantee. An unknown name cannot be
 * silently treated as a directory; a tail that is already absolute is a caller
 * assembling the head anyway; and a tail that climbs out of its root with `..` is
 * the same thing spelled differently.
 */
export function resolveUnderRoot(vocab: RootVocabulary, root: string, tail: string): string {
  const base = vocab[root as RootName];
  if (base === undefined) {
    throw new RootError("unknown-root", `no root is called "${root}" — declared roots are ${Object.keys(vocab).join(", ")}`);
  }
  if (tail.startsWith("/") || tail.startsWith("~")) {
    throw new RootError("absolute-tail", `"${tail}" already carries a head; ask for a tail relative to "${root}"`);
  }
  const resolved = normalizePath(path.normalize(path.join(base, tail)));
  if (!isUnder(base, resolved)) {
    throw new RootError("escapes-root", `"${tail}" climbs out of root "${root}" (${base})`);
  }
  return resolved;
}

/** Is `p` at or under `base`? Segment-wise, so `/a/bc` is not under `/a/b`. */
export function isUnder(base: string, p: string): boolean {
  return p === base || p.startsWith(base.endsWith("/") ? base : base + "/");
}

/**
 * Which declared root contains this absolute path, or `null` for none.
 *
 * The deepest root wins, so a path inside the vault is charged to `vault` rather
 * than to `home` — otherwise the container would absorb every path on the machine
 * and the byRoot breakdown would say nothing.
 */
export function rootContaining(vocab: RootVocabulary, abs: string, containment: Containment): RootName | null {
  let best: RootName | null = null;
  for (const name of ROOT_NAMES) {
    if (containment === "specific" && name === "home") continue;
    const base = vocab[name];
    if (base === undefined) continue;
    if (!isUnder(base, abs)) continue;
    if (best === null || base.length > vocab[best].length) best = name;
  }
  return best;
}

/** The project a session belongs to, read off the directory it was launched in. */
export function projectRootFor(cwd: string, layout = OPERATOR_LAYOUT): string {
  const normalized = normalizePath(path.normalize(cwd || layout.home));
  for (const container of layout.projectContainers) {
    if (normalized === container) return container;
    if (isUnder(container, normalized)) {
      const first = normalized.slice(container.length + 1).split("/")[0];
      return `${container}/${first}`;
    }
  }
  return normalized;
}

/** The vocabulary a given call would have been handed, under one reading. */
export function vocabularyFor(cwd: string, mode: Vocabulary, layout = OPERATOR_LAYOUT): RootVocabulary {
  return declareRoots({
    project: mode === "per-session" ? projectRootFor(cwd, layout) : layout.project,
    vault: layout.vault,
    logs: layout.logs,
    home: layout.home,
  });
}

/**
 * Make an addressed path absolute, or say it cannot be.
 *
 * `null` is a finding rather than a gap: a path written relative carries no head
 * at all, so the mistake the solution prevents was not available to make, and
 * whether it falls under a root is a question about the working directory rather
 * than about the path.
 */
export function resolveAddressed(addressed: string, cwd: string, resolution: Resolution): string | null {
  if (addressed.startsWith("/")) return normalizePath(path.normalize(addressed));
  if (resolution === "as-written") return null;
  if (!cwd) return null;
  return normalizePath(path.normalize(path.resolve(cwd, addressed)));
}

/** Does this subject read as a path at all, or is it a flag the prose caught? */
export function readsAsPath(subject: string): boolean {
  if (!subject) return false;
  if (PATH_ROOT_RULE.notAPathWord.some((re) => re.test(subject))) return false;
  return subject.includes("/") || PATH_ROOT_RULE.bareFileName.test(subject);
}

// ── the record ───────────────────────────────────────────────────────────────

/** One path a call addressed, with the directory it was addressed from. */
export interface AddressedPath {
  session: string;
  /** The working directory the transcript entry carried. Empty if it carried none. */
  cwd: string;
  tool: string;
  /** The path as the record has it — absolute or relative, never resolved here. */
  addressed: string;
}

/** One failed path: what the error message said was not there, and which shape it was. */
export interface FailedPath extends AddressedPath {
  cls: PathFailureClass;
  /** Clipped failure text, so a reader can disagree with the classification. */
  error: string;
  /** Clipped `Bash` command, empty for every other tool. */
  command: string;
}

/** What a read of the raw transcripts found, with everything it could not use. */
export interface AddressedRecord {
  failures: FailedPath[];
  successes: AddressedPath[];
  sessions: number;
  calls: number;
  errors: number;
  /** Path-shaped failures whose message named nothing — `File does not exist.` */
  unnamed: number;
  /** Named subjects that were a flag or a program name rather than a path. */
  notAPath: number;
  /** Path-shaped failures excluded by class: the path was there, the grant was not. */
  deniedPaths: number;
}

/**
 * Lift every addressed path out of raw session transcripts, failures and
 * successes alike.
 *
 * The working directory comes from the transcript entry that carried the call.
 * That field is why this census can ask its question at all: the sibling
 * path-guess corpus records that resolving a relative path "needs a working
 * directory the transcript does not record", and the transcript does record one —
 * on every entry, under `cwd`. See this census's `PROVENANCE.md`.
 *
 * Nothing is filtered by tool or by session. Which subjects are a path, which
 * failure shapes count, and what a root covers are all decided by
 * {@link PATH_ROOT_RULE} and by the census below, where they can be argued with.
 */
export function readAddressedPaths(sessions: TranscriptSession[]): AddressedRecord {
  const failures: FailedPath[] = [];
  const successes: AddressedPath[] = [];
  let calls = 0;
  let errors = 0;
  let unnamed = 0;
  let notAPath = 0;
  let deniedPaths = 0;

  for (const session of sessions) {
    const byId = new Map<string, { tool: string; command: string; declaredPath: string; cwd: string }>();
    for (const raw of session.jsonl.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      const cwd = typeof entry.cwd === "string" ? entry.cwd : "";
      const message = entry.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          calls++;
          const tool = String(block.name ?? "");
          const input = (block.input ?? {}) as Record<string, unknown>;
          const field = GUESS_RULE.declaredPathFields[tool];
          const declared = field && typeof input[field] === "string" ? (input[field] as string) : "";
          byId.set(block.id, {
            tool,
            command: typeof input.command === "string" ? clip(input.command, MAX_COMMAND_CHARS) : "",
            declaredPath: declared,
            cwd,
          });
        }
        if (block.type !== "tool_result") continue;
        const call = byId.get(String(block.tool_use_id ?? ""));
        if (!call) continue;
        if (block.is_error === true) {
          errors++;
          const error = clip(resultText(block.content), MAX_ERROR_CHARS);
          const cls = classifyPathFailure(error);
          if (cls === null) continue;
          if (!(PATH_ROOT_RULE.countedClasses as readonly PathFailureClass[]).includes(cls)) {
            deniedPaths++;
            continue;
          }
          const subject = subjectOf(error);
          if (subject === null) {
            unnamed++;
            continue;
          }
          const named = normalizePath(subject);
          if (!readsAsPath(named)) {
            notAPath++;
            continue;
          }
          failures.push({ session: session.id, cwd: call.cwd, tool: call.tool, addressed: named, cls, error, command: call.command });
          continue;
        }
        // A call that came back without `is_error` addressed its path successfully.
        for (const addressed of addressedBy(call)) {
          successes.push({ session: session.id, cwd: call.cwd, tool: call.tool, addressed });
        }
      }
    }
  }
  return { failures, successes, sessions: sessions.length, calls, errors, unnamed, notAPath, deniedPaths };
}

/** Every path a call addressed: the declared field, or the words of its command. */
function addressedBy(call: { tool: string; command: string; declaredPath: string }): string[] {
  if (call.declaredPath) return [normalizePath(call.declaredPath)];
  if (call.tool === "Bash" && call.command) return pathsInCommand(call.command).filter(readsAsPath);
  return [];
}

/** Tool results carry either a string or a list of content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

// ── the census ───────────────────────────────────────────────────────────────

/** One full recount under one (containment, resolution, vocabulary) choice. */
export interface CoverageReading {
  containment: Containment;
  resolution: Resolution;
  vocabulary: Vocabulary;
  /** Every path in the population. The denominator, always. */
  total: number;
  /** Paths that fall at or under a declared root. */
  covered: number;
  /** Paths that resolved to somewhere no declared root reaches. */
  outside: number;
  /** Paths that could not be resolved at all, counted as uncovered. */
  unresolvable: number;
  share: number;
  byRoot: Record<RootName, number>;
  meetsBar: boolean;
}

/** The whole count, both populations, every reading. */
export interface PathRootCensus {
  sessions: number;
  calls: number;
  errors: number;
  /** The population that decides the row: paths that actually failed. */
  failures: CoverageReading[];
  /** The comparison group the assumption test asked for: paths that worked. */
  successes: CoverageReading[];
  unnamed: number;
  notAPath: number;
  deniedPaths: number;
  /**
   * Does the answer to "does it clear the bar" depend on which reading you take?
   * Published on the report's face, because a census whose verdict is an artefact
   * of one of its own judgement calls must say so rather than pick.
   */
  readingDecides: boolean;
  /** The reading this census reports as its headline, and why it is that one. */
  headline: CoverageReading;
  meetsBar: boolean;
}

/** Count one population under one reading. */
export function coverageUnder(
  paths: AddressedPath[],
  containment: Containment,
  resolution: Resolution,
  vocabulary: Vocabulary,
  layout = OPERATOR_LAYOUT,
): CoverageReading {
  const byRoot: Record<RootName, number> = { project: 0, vault: 0, logs: 0, home: 0 };
  let covered = 0;
  let outside = 0;
  let unresolvable = 0;
  for (const p of paths) {
    const abs = resolveAddressed(p.addressed, p.cwd, resolution);
    if (abs === null) {
      unresolvable++;
      continue;
    }
    const root = rootContaining(vocabularyFor(p.cwd, vocabulary, layout), abs, containment);
    if (root === null) {
      outside++;
      continue;
    }
    covered++;
    byRoot[root]++;
  }
  const total = paths.length;
  const share = total === 0 ? 0 : covered / total;
  return {
    containment,
    resolution,
    vocabulary,
    total,
    covered,
    outside,
    unresolvable,
    share,
    byRoot,
    meetsBar: share >= PATH_ROOT_RULE.bar,
  };
}

/**
 * The census.
 *
 * The headline reading is `specific` / `recorded-cwd` / `per-session`: home
 * excluded because a container that holds everything prevents nothing, the
 * recorded working directory used because it is on the record rather than
 * invented, and `project` bound per session because a machine holding five
 * repositories has no single one. Every other reading is counted in full beside
 * it, and {@link PathRootCensus.readingDecides} says whether the choice mattered.
 */
export function pathRootCoverage(record: AddressedRecord, layout = OPERATOR_LAYOUT): PathRootCensus {
  const readings = (paths: AddressedPath[]): CoverageReading[] => {
    const out: CoverageReading[] = [];
    for (const containment of PATH_ROOT_RULE.containments) {
      for (const resolution of PATH_ROOT_RULE.resolutions) {
        for (const vocabulary of PATH_ROOT_RULE.vocabularies) {
          out.push(coverageUnder(paths, containment, resolution, vocabulary, layout));
        }
      }
    }
    return out;
  };
  const failures = readings(record.failures);
  const successes = readings(record.successes);
  const headline = failures.find(
    (r) => r.containment === "specific" && r.resolution === "recorded-cwd" && r.vocabulary === "per-session",
  )!;
  const verdicts = new Set(failures.map((r) => r.meetsBar));
  return {
    sessions: record.sessions,
    calls: record.calls,
    errors: record.errors,
    failures,
    successes,
    unnamed: record.unnamed,
    notAPath: record.notAPath,
    deniedPaths: record.deniedPaths,
    readingDecides: verdicts.size > 1,
    headline,
    meetsBar: headline.meetsBar,
  };
}

/** Find one reading in a census, for a reader who wants a specific recount. */
export function readingOf(
  readings: CoverageReading[],
  containment: Containment,
  resolution: Resolution,
  vocabulary: Vocabulary,
): CoverageReading {
  const found = readings.find(
    (r) => r.containment === containment && r.resolution === resolution && r.vocabulary === vocabulary,
  );
  if (!found) throw new Error(`no reading for ${containment}/${resolution}/${vocabulary}`);
  return found;
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

/** The census as a table, verdict first — the shape a reader can disagree with. */
export function formatPathRootCensus(census: PathRootCensus): string {
  const lines: string[] = [];
  lines.push(
    `path-root coverage: ${census.meetsBar ? "MEETS" : "MISSES"} the ${pct(PATH_ROOT_RULE.bar)} bar — ` +
      `${pct(census.headline.share)} of ${census.headline.total} failed paths under ${PATH_ROOT_RULE.maxRoots} roots`,
  );
  lines.push(
    `read from ${census.sessions} sessions, ${census.calls} calls, ${census.errors} failures ` +
      `(${census.unnamed} named nothing, ${census.notAPath} named a flag, ${census.deniedPaths} were denials)`,
  );
  lines.push(`readings ${census.readingDecides ? "DISAGREE" : "agree"} about the bar`);
  for (const group of [
    { label: "failed", readings: census.failures },
    { label: "worked", readings: census.successes },
  ]) {
    for (const r of group.readings) {
      lines.push(
        `  ${group.label} ${r.containment}/${r.resolution}/${r.vocabulary}: ` +
          `${pct(r.share)} (${r.covered}/${r.total}, ${r.outside} outside, ${r.unresolvable} unresolvable) ` +
          `project ${r.byRoot.project} vault ${r.byRoot.vault} logs ${r.byRoot.logs} home ${r.byRoot.home}`,
      );
    }
  }
  return lines.join("\n");
}
