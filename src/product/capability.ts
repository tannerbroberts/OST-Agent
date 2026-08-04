/**
 * The committed capability profile: what each builder demonstrably knows how to
 * do, read off the record they have already written, with nothing asked of them.
 *
 * Every other way of learning what a collaborator can do needs a deposit — a
 * skills matrix somebody fills in, a form at onboarding, a trace channel each
 * builder has to opt into. A mechanism that needs compliance is defeated by
 * non-compliance, and the one artifact that is never missing is the one the work
 * already produced: authored commits, their scopes, their diffs, and the pull
 * requests they arrived in. This module infers over those and asks for nothing.
 *
 * **The prior question, and why it is answered here rather than assumed.** "The
 * artifacts are already there" and "the artifacts are legible" are different
 * properties. A history of `wip`, `fixes`, and `update stuff` is present in full
 * and says nothing about capability; a profile built over it would be a
 * confident restatement of who touched which file. So the reader computes its
 * own denominator as it goes ({@link RecordLegibility}) and the report carries
 * the share of the record that could name a capability at all on its face
 * ({@link CapabilityProfileReport.coverage}) — the profile never claims to cover
 * more of the record than it could read.
 *
 * **What counts as naming a capability**, and it is deliberately narrow:
 *
 *   - a **kind of work**, taken only from a conventional-commit type in the
 *     subject or in the first line of the body. Never inferred from free prose —
 *     a reader that guesses at intent from an English sentence is the point
 *     where an archaeology starts inventing the thing it was sent to find; and
 *   - a **domain**, taken from the conventional scope, or failing that from the
 *     source area the diff actually touched; and
 *   - more than a bare gesture: a subject that survives {@link CONTENTLESS} and
 *     carries at least {@link MIN_SUBJECT_WORDS} words of its own.
 *
 * All three come from the artifact alone. Nothing here reads a vault, a config,
 * a network, or an operator.
 *
 * **What it cannot do**, stated where the numbers are, because the numbers look
 * authoritative and this part never will be. It models what a builder *did*
 * under the constraints they were under and reads that as what they *can* do:
 * capability never exercised is invisible, and capability suppressed by a bad
 * environment reads as capability absent, so the ceiling this reports is
 * sometimes really a floor. A collaborator who works outside the repository —
 * whose contribution is a decision taken in conversation — leaves no artifact
 * here and is profiled as having no capability rather than as unobserved. Both
 * are properties of the source, not defects in the reading, and no amount of
 * later engineering recovers signal that was never written down.
 */
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";

/** A person the record attributes work to. */
export interface Builder {
  name: string;
  email: string;
}

export type ArtifactKind = "commit" | "pr";

/** One unit of the committed record, as it can be read without leaving git. */
export interface CommittedArtifact {
  kind: ArtifactKind;
  /** Abbreviated sha for a commit, `#46` for a pull request. */
  ref: string;
  subject: string;
  body: string;
  /**
   * Everyone the artifact attributes it to: the git author first, then every
   * `Co-authored-by:` trailer. Plural because the author field records whoever
   * ran the tool, which in a repository with agent collaborators is routinely
   * not the party that did the work.
   */
  authors: Builder[];
  /** Paths the diff touched. Empty for a merge commit and for a pull request. */
  paths: string[];
  /** For a pull request: the subjects of the commits it brought in. */
  commitSubjects: string[];
}

/** The two halves of the record, as read. */
export interface CommittedRecord {
  repo: string;
  commits: CommittedArtifact[];
  prs: CommittedArtifact[];
}

/**
 * A capability named off one artifact — a kind of work and what it was over.
 *
 * Two fields rather than one string so the profile can group by domain without
 * re-parsing the label it printed.
 */
export interface NamedCapability {
  /** The kind of work, in words: "builds", "diagnoses and repairs". */
  verb: string;
  /** What it was over: "adapters", "evidence", "the git surface". */
  domain: string;
  /** `${verb} ${domain}` — the phrase a reader would use. */
  label: string;
}

/** What one builder's slice of the record supports. */
export interface CapabilityEvidence {
  label: string;
  verb: string;
  domain: string;
  /** Artifacts naming this capability for this builder. */
  count: number;
  /** Refs backing it, newest first, capped at {@link MAX_REFS} so a claim stays checkable. */
  refs: string[];
}

export interface BuilderCapabilityProfile {
  /** `Name <email>`, the key the record is grouped by. */
  builder: string;
  name: string;
  email: string;
  /** Artifacts attributing work to this builder, whether or not they were legible. */
  attributed: number;
  /** Those of them that named a capability. The rest are this profile's blind spot. */
  legible: number;
  /** Capabilities, most-evidenced first. */
  capabilities: CapabilityEvidence[];
}

/** How much of one half of the record could be read, and how far it got. */
export interface RecordLegibility {
  kind: ArtifactKind;
  /** Artifacts read. The denominator every count below is taken over. */
  examined: number;
  /** Those carrying an identifiable author. */
  attributed: number;
  /** Those from which a capability could be named. */
  legible: number;
}

/**
 * Which of the three pre-committed outcomes the record landed in.
 *
 * `clear` — dense enough that the profile stands on the whole record.
 * `narrowed` — the profile ships, over the legible subset, saying so.
 * `refuted` — at this density the archaeology is reading noise.
 */
export type LegibilityVerdict = "clear" | "narrowed" | "refuted";

export interface CapabilityProfileReport {
  repo: string;
  commits: RecordLegibility;
  prs: RecordLegibility;
  /** Most-attributed builder first. */
  builders: BuilderCapabilityProfile[];
  verdict: LegibilityVerdict;
  /** The share of the record this profile was read from, in a sentence it carries everywhere. */
  coverage: string;
}

/**
 * The bands, fixed before the first reading and expressed as shares so a
 * different window measures the same thing.
 *
 * Written down as "at least 70 of the last 100 commits and 20 of the last 30
 * PRs", with "below 50 of 100 kills the candidate" — a pre-commitment made
 * against a record nobody had counted yet, which is the only kind that can come
 * out a failure.
 */
export const CLEAR_COMMIT_SHARE = 0.7;
export const CLEAR_PR_SHARE = 20 / 30;
export const KILL_COMMIT_SHARE = 0.5;

/** Refs kept per capability. Enough to check the claim, not enough to be a log. */
export const MAX_REFS = 5;

/** A subject shorter than this says who touched what, and nothing else. */
export const MIN_SUBJECT_WORDS = 3;

/**
 * Subjects that are present, well-formed, and carry no capability.
 *
 * The list is short on purpose: it is not a spam filter, it is the floor that
 * stops a conventional-commit prefix alone from certifying an empty message as
 * legible. Matched against the subject with its type prefix already stripped.
 */
export const CONTENTLESS = [
  /^wip\b/i,
  /^fix(es|ed)?$/i,
  /^update(s|d)?$/i,
  /^cleanup$/i,
  /^misc\.?$/i,
  /^tweaks?$/i,
  /^typos?$/i,
  /^bump(\s+version)?$/i,
  /^lint$/i,
  /^format(ting)?$/i,
  /^more$/i,
];

/**
 * Conventional-commit types, and the capability each one names.
 *
 * The verbs are the whole vocabulary — a type outside this map names no kind of
 * work, so a message can be perfectly well-formed and still be illegible here.
 */
const WORK_KINDS: Record<string, string> = {
  feat: "builds",
  fix: "diagnoses and repairs",
  perf: "optimises",
  refactor: "restructures",
  test: "tests",
  docs: "documents",
  build: "maintains the build for",
  ci: "maintains the pipeline for",
  chore: "maintains",
  style: "maintains the style of",
};

/** `type(scope): rest` — the only shape a kind of work is taken from. */
const CONVENTIONAL = /^([a-z]+)(?:\(([^)]+)\))?(!?):\s*(.+)$/;

/**
 * A scope segment reads as a domain only if it contains a word.
 *
 * Found by reading the output rather than by predicting it: this repository's
 * scopes include `w11`, `b4`, `p3`, `gate-z,gate-p` and `tier2` — work-item ids
 * from a plan, not areas of a product. They are perfectly well-formed
 * conventional scopes, and "builds w11" is a sentence no reader can act on, so
 * taking them as domains would have let the census count opaque tags as legible.
 * An opaque scope falls through to the diff, which names an area or names
 * nothing.
 *
 * A word is a whole alphabetic run of three or more characters that no digit is
 * glued to — enough to admit `vault`, `evidence`, `ost` and `gate-b`, enough to
 * reject `w2`, `f6` and `tier2`. Whole run, not any run: `tier2` contains `tie`
 * followed by a letter, and a rule that read that as a word would have let every
 * numbered tag back in through the side door.
 */
const SCOPE_WORD = /(?:^|[^a-z0-9])[a-z]{3,}(?![a-z0-9])/i;

/** `Co-authored-by: Name <email>` — the only place the second builder appears. */
const CO_AUTHOR = /^co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim;

/** A squash merge keeps the PR number in the subject: `... (#46)`. */
const SQUASHED_PR = /\(#(\d+)\)\s*$/;

/** A merge commit names it outright. */
const MERGED_PR = /^Merge pull request #(\d+) from (\S+)/;

/**
 * Emails that identify a machine rather than a party the record can profile.
 *
 * `ost-agent@localhost` is this product's own fallback identity, written by
 * `gitInitIfAbsent` when no git identity is resolvable — a commit carrying it
 * says only that some process ran here.
 */
const UNATTRIBUTABLE = [/^ost-agent@localhost$/i, /^root@/i, /\[bot\]@/i, /^$/];

/** Field and record separators, chosen because a commit message can contain neither. */
const FS = "\x1f";
const RS = "\x1e";

function isAttributable(author: Builder | undefined): author is Builder {
  if (!author || !author.name.trim() || !author.email.trim()) return false;
  return !UNATTRIBUTABLE.some((p) => p.test(author.email));
}

/** `Name <email>`, the key a profile is grouped under. */
export function builderKey(b: Builder): string {
  return `${b.name} <${b.email}>`;
}

/**
 * Every co-author trailer in a body, in the order written.
 *
 * Read here, at the reader, rather than anywhere downstream: {@link
 * CommittedArtifact.authors} is the list of parties an artifact is attributed
 * to, and by the time the profile sees one that question is already settled.
 */
export function coAuthorsOf(body: string): Builder[] {
  const found: Builder[] = [];
  for (const m of body.matchAll(CO_AUTHOR)) found.push({ name: m[1].trim(), email: m[2].trim() });
  return found;
}

/**
 * The domain a conventional scope names, or undefined when it names only a tag.
 *
 * A comma-separated scope is several claims; the first one that reads as a word
 * is the domain, and a scope made entirely of work-item ids names none.
 */
export function domainFromScope(scope: string | undefined): string | undefined {
  if (!scope) return undefined;
  const parts = scope
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.find((p) => SCOPE_WORD.test(p));
}

/**
 * The domain a set of paths is over, or undefined when they do not agree on one.
 *
 * Two segments under a source root (`src/adapters/slack.ts` → `adapters`), the
 * top-level directory otherwise. A diff spread over more areas than any one
 * dominates names no domain — that is a commit whose subject had better carry a
 * scope, and if it does not, it is illegible and should count as such.
 */
export function domainFromPaths(paths: readonly string[]): string | undefined {
  const areas = new Map<string, number>();
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    if (!parts.length) continue;
    const area = (parts[0] === "src" || parts[0] === "test") && parts.length > 1 ? parts[1] : parts[0];
    // A single file at the root ("README.md") is a path, not an area.
    if (area.includes(".") && parts.length === 1) continue;
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }
  if (!areas.size) return undefined;
  const ranked = [...areas].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [top, count] = ranked[0];
  const total = [...areas.values()].reduce((n, c) => n + c, 0);
  return count * 2 >= total ? top : undefined;
}

/** The first conventional-commit header in `text`, if there is one. */
function conventionalHeader(text: string): { type: string; scope?: string; rest: string } | undefined {
  for (const line of text.split("\n")) {
    const m = CONVENTIONAL.exec(line.trim());
    if (m && WORK_KINDS[m[1]]) return { type: m[1], scope: m[2]?.trim(), rest: m[4].trim() };
  }
  return undefined;
}

/**
 * Name the one capability an artifact demonstrates, or nothing.
 *
 * Reads the artifact and only the artifact. Returning undefined is the load-
 * bearing half: an extractor that always finds something turns the census that
 * calls it into a tautology, so a well-formed message with an empty subject, a
 * type outside the vocabulary, or no locatable domain gets no capability rather
 * than a vague one.
 */
export function nameCapability(artifact: CommittedArtifact): NamedCapability | undefined {
  // A pull request's own commits are part of the artifact a reader sees, so a
  // merge whose title says nothing is still legible when what it merged does.
  const searchable = [artifact.subject, artifact.body, ...artifact.commitSubjects].join("\n");
  const header = conventionalHeader(searchable);
  if (!header) return undefined;

  const rest = header.rest.replace(SQUASHED_PR, "").trim();
  if (rest.split(/\s+/).filter(Boolean).length < MIN_SUBJECT_WORDS) return undefined;
  if (CONTENTLESS.some((p) => p.test(rest))) return undefined;

  const domain = domainFromScope(header.scope) ?? domainFromPaths(artifact.paths);
  if (!domain) return undefined;

  const verb = WORK_KINDS[header.type];
  return { verb, domain, label: `${verb} ${domain}` };
}

/** Read one half of the record's legibility, without building the profile. */
export function legibilityOf(kind: ArtifactKind, artifacts: readonly CommittedArtifact[]): RecordLegibility {
  return {
    kind,
    examined: artifacts.length,
    attributed: artifacts.filter((a) => a.authors.some(isAttributable)).length,
    legible: artifacts.filter((a) => a.authors.some(isAttributable) && nameCapability(a)).length,
  };
}

function verdictFor(commits: RecordLegibility, prs: RecordLegibility): LegibilityVerdict {
  const share = (r: RecordLegibility) => (r.examined ? r.legible / r.examined : 0);
  if (share(commits) < KILL_COMMIT_SHARE) return "refuted";
  if (share(commits) >= CLEAR_COMMIT_SHARE && (!prs.examined || share(prs) >= CLEAR_PR_SHARE)) return "clear";
  return "narrowed";
}

function coverageSentence(commits: RecordLegibility, prs: RecordLegibility, verdict: LegibilityVerdict): string {
  const over =
    `read from ${commits.legible} of ${commits.examined} commit(s) and ${prs.legible} of ${prs.examined} ` +
    `pull request(s) that named a capability at all`;
  if (verdict === "refuted") {
    return `Refuted: ${over}. Below half the record is legible, so this profile is reading noise — do not act on it.`;
  }
  if (verdict === "narrowed") {
    return `Narrowed: ${over}. The rest of the record is not covered here and its builders may be under-reported.`;
  }
  return `${over}. It reports capability exercised, which understates capability held.`;
}

/**
 * Build the profile from an already-read record.
 *
 * Split from {@link committedCapabilityProfile} so the inference can be tested
 * against arrays instead of against a repository on disk, and so a caller who
 * already holds the record does not read git twice.
 */
export function profileCommittedRecord(record: CommittedRecord): CapabilityProfileReport {
  const commits = legibilityOf("commit", record.commits);
  const prs = legibilityOf("pr", record.prs);

  const byBuilder = new Map<string, BuilderCapabilityProfile>();
  const evidence = new Map<string, Map<string, CapabilityEvidence>>();

  for (const artifact of [...record.commits, ...record.prs]) {
    const capability = nameCapability(artifact);
    for (const author of artifact.authors.filter(isAttributable)) {
      const key = builderKey(author);
      let profile = byBuilder.get(key);
      if (!profile) {
        profile = { builder: key, name: author.name, email: author.email, attributed: 0, legible: 0, capabilities: [] };
        byBuilder.set(key, profile);
        evidence.set(key, new Map());
      }
      profile.attributed += 1;
      if (!capability) continue;
      profile.legible += 1;
      const caps = evidence.get(key)!;
      const seen = caps.get(capability.label);
      if (seen) {
        seen.count += 1;
        if (seen.refs.length < MAX_REFS) seen.refs.push(artifact.ref);
      } else {
        caps.set(capability.label, { ...capability, count: 1, refs: [artifact.ref] });
      }
    }
  }

  for (const [key, profile] of byBuilder) {
    profile.capabilities = [...evidence.get(key)!.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label),
    );
  }

  const verdict = verdictFor(commits, prs);
  return {
    repo: record.repo,
    commits,
    prs,
    builders: [...byBuilder.values()].sort((a, b) => b.attributed - a.attributed || a.builder.localeCompare(b.builder)),
    verdict,
    coverage: coverageSentence(commits, prs, verdict),
  };
}

export interface RecordWindow {
  /** How many commits back to read. */
  commits?: number;
  /** How many pull requests back to read. */
  prs?: number;
  /**
   * How far back to look for those pull requests.
   *
   * A PR marker appears on one commit in several, so the window that holds N of
   * them is much wider than N. Bounded rather than unlimited: an unbounded scan
   * of a long history to find a handful of merges is a slow answer to a cheap
   * question, and a repository with no PR markers at all would read all of it.
   */
  scan?: number;
}

const DEFAULT_WINDOW: Required<RecordWindow> = { commits: 100, prs: 30, scan: 500 };

/** Parse the `%x1e`-delimited log we asked git for. */
function parseLog(raw: string): CommittedArtifact[] {
  const out: CommittedArtifact[] = [];
  for (const chunk of raw.split(RS)) {
    if (!chunk.trim()) continue;
    const fields = chunk.split(FS);
    if (fields.length < 6) continue;
    const [sha, name, email, subject, body] = [fields[0], fields[1], fields[2], fields[3], fields[4]];
    const paths = fields[5]
      .split("\n")
      .map((p) => p.trim())
      .filter(Boolean);
    out.push({
      kind: "commit",
      ref: sha.replace(/^\s+/, "").slice(0, 8),
      subject: subject.trim(),
      body,
      authors: [{ name: name.trim(), email: email.trim() }, ...coAuthorsOf(body)],
      paths,
      commitSubjects: [],
    });
  }
  return out;
}

/**
 * Read the last `commits` commits and the last `prs` pull requests, from git and
 * from nothing else.
 *
 * Merge commits are included in the commit half deliberately. They are commits,
 * most of them say little on their own, and dropping them would be choosing the
 * legible subset before measuring how legible the record is — which is the one
 * move that would make the census flatter itself.
 */
export async function readCommittedRecord(repoRoot: string, window: RecordWindow = {}): Promise<CommittedRecord> {
  const w = { ...DEFAULT_WINDOW, ...window };
  const repo = path.resolve(repoRoot);
  const git: SimpleGit = simpleGit(repo);
  if (!(await git.checkIsRepo())) {
    throw new Error(`${repo} is not a git repository — there is no committed record to read`);
  }

  const format = `${RS}%H${FS}%an${FS}%ae${FS}%s${FS}%b${FS}`;
  const commits = parseLog(await git.raw(["log", `-n${w.commits}`, `--format=${format}`, "--name-only"]));

  // The PR half comes from the same source: a squash merge keeps `(#N)` in the
  // subject and carries the PR description as its body; a merge commit names the
  // PR and brings the commits a reviewer actually read.
  const scanned = parseLog(await git.raw(["log", `-n${w.scan}`, `--format=${format}`, "--name-only"]));
  const prs: CommittedArtifact[] = [];
  const seen = new Set<string>();
  for (const c of scanned) {
    if (prs.length >= w.prs) break;
    const merged = MERGED_PR.exec(c.subject);
    const squashed = SQUASHED_PR.exec(c.subject);
    const number = merged?.[1] ?? squashed?.[1];
    if (!number || seen.has(number)) continue;
    seen.add(number);
    // For a merge commit the artifact is what it merged; for a squash the commit
    // IS the merged work and its own subject already carries it.
    const commitSubjects = merged
      ? (await git.raw(["log", "--format=%s", `${c.ref}^1..${c.ref}^2`]).catch(() => ""))
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    prs.push({ ...c, kind: "pr", ref: `#${number}`, commitSubjects });
  }

  return { repo, commits, prs };
}

/** Read the record and profile it. The whole mechanism, in one call and one argument. */
export async function committedCapabilityProfile(
  repoRoot: string,
  window: RecordWindow = {},
): Promise<CapabilityProfileReport> {
  return profileCommittedRecord(await readCommittedRecord(repoRoot, window));
}

/** The profile as an operator reads it: what it was read from, then who can do what. */
export function formatCapabilityProfile(report: CapabilityProfileReport): string {
  const lines: string[] = [];
  lines.push(`Capability profile for ${report.repo} — ${report.verdict.toUpperCase()}`);
  lines.push(`  ${report.coverage}`);
  lines.push(
    `  commits: ${report.commits.legible} legible of ${report.commits.examined} examined ` +
      `(${report.commits.attributed} attributed) | pull requests: ${report.prs.legible} of ${report.prs.examined} ` +
      `(${report.prs.attributed} attributed)`,
  );
  lines.push("");
  if (!report.builders.length) lines.push("  (no builder the record could attribute work to)");
  for (const b of report.builders) {
    lines.push(`${b.name} <${b.email}> — ${b.legible} of ${b.attributed} artifact(s) named a capability`);
    if (!b.capabilities.length) lines.push("  (nothing this record could name)");
    for (const c of b.capabilities) lines.push(`  ${c.label} ×${c.count} — ${c.refs.join(" ")}`);
    lines.push("");
  }
  lines.push(
    "Read as capability EXERCISED. What a builder was never asked to do is absent here, and absent " +
      "reads the same as unable; a collaborator who works outside the repository leaves no artifact at all. " +
      "Nothing was asked of anyone to produce this.",
  );
  return lines.join("\n");
}
