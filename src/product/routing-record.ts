/**
 * The routing record: what work class each committed artifact belongs to, and
 * who it was ever attributed to — the comparison a capability estimate needs
 * before it can claim to be one rather than a tautology.
 *
 * {@link ../product/capability.ts} already reads the committed record and asks
 * "what capability does this artifact name". This module asks a narrower,
 * prior question: "what class of work is this, and how many distinct parties
 * has that class of work ever gone to". An outcome ledger only distinguishes
 * capability from assignment history if the same class of work has been given
 * to more than one collaborator — a class with exactly one owner says "the
 * person who does this does this" and nothing else.
 *
 * **What counts as a work class, and why it is this narrow.** Five classes,
 * each read off one literal, unambiguous signal already present in a
 * conventional-commit history — never guessed from free prose, on the same
 * rule {@link nameCapability} uses:
 *
 *   - `review` — the artifact is a pull request. A PR is the committed record
 *     of a change having passed this repository's review gate (see
 *     CONTRIBUTING.md); nothing about *what* it changed is read.
 *   - `release` — a `release: vX.Y.Z …` subject, this repository's own
 *     convention for the commit that cuts a version.
 *   - `discovery pass` — a `mcp: ost_ingest_inbox` subject in the vault: the
 *     one tool that pulls outside material into the tree.
 *   - `decision` — a `mcp: ost_set_status` subject in the vault: the one tool
 *     that validates or eliminates a candidate.
 *   - `build` — a conventional `feat`/`fix`/`perf`/`refactor` commit in a code
 *     repository, or a `chore(instruments): …` subject in the vault, which is
 *     how the build loop itself records what it did.
 *
 * An artifact matching none of these is unclassified rather than guessed into
 * the nearest bucket — the same refusal-to-guess {@link nameCapability} makes,
 * for the same reason: a reader that always answers turns the census that
 * calls it into a tautology.
 *
 * **What a collaborator is**: the same {@link Builder} extraction the
 * capability profile uses — the git author plus every `Co-authored-by:`
 * trailer, filtered through {@link isAttributable} so a machine identity with
 * no name behind it does not count as a party.
 */
import path from "node:path";
import { simpleGit } from "simple-git";
import {
  type CommittedArtifact,
  type CommittedRecord,
  builderKey,
  isAttributable,
  readCommittedRecord,
} from "./capability.js";

export const WORK_CLASSES = ["build", "review", "discovery pass", "release", "decision"] as const;
export type WorkClass = (typeof WORK_CLASSES)[number];

/** A conventional-commit build type in a code repository. */
const BUILD_TYPE = /^(feat|fix|perf|refactor)(\([^)]+\))?!?:\s*\S/;
/** This repository's own release-commit convention. */
const RELEASE = /^release:\s*v?\d+\.\d+\.\d+/i;
/** The one MCP tool that pulls outside material into the vault. */
const DISCOVERY_TOOL = /^mcp:\s*ost_ingest_inbox\b/;
/** The one MCP tool that validates or eliminates a candidate. */
const DECISION_TOOL = /^mcp:\s*ost_set_status\b/;
/** How the build loop records what it did, in the vault's own commit log. */
const BUILD_LOOP_RECORD = /^chore\(instruments\):/;

/**
 * The work class one artifact belongs to, or undefined when none of the five
 * literal signals matches.
 *
 * `kind === "pr"` is checked first and alone decides `review`: a squashed or
 * merged pull request also carries a conventional-commit subject, and reading
 * that subject too would let a `feat:`-titled PR be double-counted as `build`.
 * The artifact that passed the review gate is read as having done exactly
 * that, once.
 */
export function classifyWorkClass(artifact: CommittedArtifact): WorkClass | undefined {
  if (artifact.kind === "pr") return "review";
  if (RELEASE.test(artifact.subject)) return "release";
  if (DISCOVERY_TOOL.test(artifact.subject)) return "discovery pass";
  if (DECISION_TOOL.test(artifact.subject)) return "decision";
  if (BUILD_TYPE.test(artifact.subject) || BUILD_LOOP_RECORD.test(artifact.subject)) return "build";
  return undefined;
}

/** One work class, and everyone the routing record ever attributed it to. */
export interface WorkClassRouting {
  workClass: WorkClass;
  /** `Name <email>`, sorted, deduplicated — everyone this class was ever routed to. */
  collaborators: string[];
  /** Artifacts landing in this class, whether or not they carried an attributable author. */
  artifacts: number;
}

/** Which of the three pre-committed bands the routing record landed in. */
export type RoutingVerdict = "clear" | "narrowed" | "refuted";

export interface RoutingCensus {
  /** One row per work class the record ever produced, in {@link WORK_CLASSES} order. */
  classes: WorkClassRouting[];
  /** Distinct work classes the record produced at all — the denominator. */
  examined: number;
  /** Of those, the ones routed to more than one collaborator — the numerator. */
  comparable: number;
  /** `comparable / examined`, or 0 when nothing was examined. */
  share: number;
  verdict: RoutingVerdict;
}

/**
 * The bands the assumption test pre-committed before anything was counted:
 * "at least 40% of distinct work classes … must have been routed to more than
 * one collaborator. Below 25% kills the candidate."
 */
export const CLEAR_CLASS_SHARE = 0.4;
export const KILL_CLASS_SHARE = 0.25;

function verdictFor(share: number): RoutingVerdict {
  if (share < KILL_CLASS_SHARE) return "refuted";
  if (share >= CLEAR_CLASS_SHARE) return "clear";
  return "narrowed";
}

/**
 * Replay an already-read set of committed records into the census.
 *
 * Split from {@link routingRecordCensus} so the comparison can be tested
 * against fixture arrays instead of against repositories on disk, matching
 * {@link profileCommittedRecord}'s split in the sibling module.
 */
export function replayRoutingRecord(records: readonly CommittedRecord[]): RoutingCensus {
  const byClass = new Map<WorkClass, { collaborators: Set<string>; artifacts: number }>();

  for (const record of records) {
    for (const artifact of [...record.commits, ...record.prs]) {
      const workClass = classifyWorkClass(artifact);
      if (!workClass) continue;
      let entry = byClass.get(workClass);
      if (!entry) {
        entry = { collaborators: new Set(), artifacts: 0 };
        byClass.set(workClass, entry);
      }
      entry.artifacts += 1;
      for (const author of artifact.authors.filter(isAttributable)) {
        entry.collaborators.add(builderKey(author));
      }
    }
  }

  const classes: WorkClassRouting[] = WORK_CLASSES.filter((c) => byClass.has(c)).map((workClass) => {
    const entry = byClass.get(workClass)!;
    return { workClass, collaborators: [...entry.collaborators].sort(), artifacts: entry.artifacts };
  });

  const examined = classes.length;
  const comparable = classes.filter((c) => c.collaborators.length > 1).length;
  const share = examined ? comparable / examined : 0;

  return { classes, examined, comparable, share, verdict: verdictFor(share) };
}

/**
 * Read one repository's whole committed record — every commit and every pull
 * request reachable from HEAD, not a windowed sample.
 *
 * {@link readCommittedRecord} defaults to the last 100 commits and 30 pull
 * requests, a deliberate choice for a *legibility* census where a fixed window
 * lets a different clone measure the same thing. This census asks a different
 * question — how many work classes a class has *ever* been routed to more
 * than one collaborator — and a windowed answer to that would silently narrow
 * "ever" to "recently", which is a different claim wearing the same verdict.
 */
export async function readWholeCommittedRecord(repoRoot: string): Promise<CommittedRecord> {
  const repo = path.resolve(repoRoot);
  const git = simpleGit(repo);
  if (!(await git.checkIsRepo())) {
    throw new Error(`${repo} is not a git repository — there is no routing record to read`);
  }
  const total = Number.parseInt((await git.raw(["rev-list", "--count", "HEAD"])).trim(), 10) || 0;
  return readCommittedRecord(repo, { commits: total, prs: total, scan: total });
}

/**
 * Read the whole committed record of every repository given, and replay it
 * into the census — the mechanism in one call, over as many repositories as
 * the collaborators' work is actually split across.
 */
export async function routingRecordCensus(repoRoots: readonly string[]): Promise<RoutingCensus> {
  const records = await Promise.all(repoRoots.map(readWholeCommittedRecord));
  return replayRoutingRecord(records);
}

/** The census as an operator reads it. */
export function formatRoutingCensus(census: RoutingCensus): string {
  const lines: string[] = [];
  lines.push(
    `Routing record — ${census.verdict.toUpperCase()}: ${census.comparable} of ${census.examined} work class(es) ` +
      `were ever routed to more than one collaborator (${Math.round(census.share * 100)}%).`,
  );
  for (const c of census.classes) {
    lines.push(`  ${c.workClass}: ${c.collaborators.length} collaborator(s) over ${c.artifacts} artifact(s)`);
    for (const who of c.collaborators) lines.push(`    ${who}`);
  }
  const missing = WORK_CLASSES.filter((c) => !census.classes.some((row) => row.workClass === c));
  if (missing.length) lines.push(`  never routed at all: ${missing.join(", ")}`);
  lines.push(
    "A class with one owner says only that the person who does this does this — it is not comparable and is " +
      "excluded from the share above rather than counted against it.",
  );
  return lines.join("\n");
}
