/**
 * The denominator every count in this product is taken over.
 *
 * `readTree()` returns a list, and every command downstream reports its length as a
 * bare integer: "Nodes: 240", "invariants: PASS (0 violations)". Neither number says
 * what it was taken over, so a file that the walk enumerated and silently dropped —
 * a misspelled `type`, frontmatter that will not parse — subtracts itself from every
 * count in the product without leaving a trace. The operator reads a confident
 * integer over a set that quietly shrank.
 *
 * Guards catch the failures somebody predicted. A denominator catches the ones
 * nobody did: it shows "240 of 244 examined, 4 dropped" without anyone having had to
 * think of the specific defect in advance.
 *
 * There are two different blindnesses here and they need two different instruments:
 *
 *   1. Files the walk SAW and dropped. Same-traversal accounting is exactly right for
 *      these — the walk is the only thing that knows it skipped something, and why.
 *
 *   2. Files the walk NEVER ENUMERATED. Same-traversal accounting is worthless here,
 *      and this is the trap the idea was written against: a denominator computed by
 *      the same broken walk excludes the same files the counter excluded, so the
 *      ratio reads 100% and says nothing. Catching these requires a denominator from
 *      a genuinely DIFFERENT source, which is why `reconcileWithGit` shells out to
 *      git's index rather than walking the directory a second time.
 *
 * Only the second one costs anything, and it is the one that does the work.
 */
import fs from "node:fs";
import path from "node:path";
import { simpleGit } from "simple-git";
import { INIT_TRACE_TOOL, usageLogPath } from "../telemetry/usage.js";
import {
  evidenceActors,
  explainRung,
  historyOf,
  keyString,
  readTrustLedger,
  sourceTrustKey,
  trustLedgerPath,
  type ActorKey,
  type TrustLedger,
  type TrustObservation,
} from "../knowledge/actor-trust.js";
import { declaresHeading, entriesUnder, RETRACTION_HEADING } from "./headings.js";
import type { NodeStatus, OstNode } from "./node.js";
import { quarantineReason, type QuarantinedNode } from "./quarantine.js";

/** A markdown file the walk enumerated but did not turn into a node. */
export interface CensusDrop {
  /** Basename as it appeared on disk. */
  file: string;
  /** Why it did not become a node, in words an operator can act on. */
  reason: string;
}

/**
 * The subdirectory a human moves a node into to take it out of the live tree.
 *
 * Nothing in the product can put a file here. `Vault.nodePath` refuses any name
 * that resolves to more than one path segment, and there is no rename, move or
 * delete anywhere in the class — so archiving is an act at a shell, by a person,
 * recorded as a git rename. **That is the whole reason this half of retirement
 * is allowed to apply to every pass:** an unforgeable retirement cannot become
 * the agent's way of making a violation go away.
 *
 * The walk already never descended, so these files were *invisible* rather than
 * excluded. The difference this makes is that they are now counted and named
 * (`TreeCensus.retired`) instead of silently absent, which is the same argument
 * the census itself is built on.
 */
export const ARCHIVE_DIRNAME = "archive";

/**
 * The statuses that take a node out of the live tree.
 *
 * Taken from the `NodeStatus` union in `ost/node.ts` rather than invented here,
 * and it is deliberately one value. Walking the vocabulary: `unvalidated` is the
 * marker stamped on *everything* the agent creates, so retiring it would retire
 * the tree; `validated` and `shipped` are the two outcomes of work that
 * succeeded, which is the opposite of retirement; `in-discovery` is work in
 * flight. `deferred` is the only word in the vocabulary that means "we are not
 * working on this" — `ost_set_status`'s own description offers it as the way to
 * "record abandonment" — and there is no `abandoned` or `resolved` status to add
 * beside it, whatever the readiness entry's prose called them.
 *
 * **`deferred` IS agent-settable** (`AGENT_SETTABLE_STATUSES`), which is exactly
 * why {@link withoutRetiredNodes} is not applied to the gates. See its comment.
 */
export const RETIRED_STATUSES: readonly NodeStatus[] = ["deferred"];

const RETIRED = new Set<string>(RETIRED_STATUSES);

/** Is this node retired by its declared status? */
export function isRetiredNode(node: { status?: string }): boolean {
  return node.status !== undefined && RETIRED.has(node.status);
}

/**
 * The third way out of the live tree, and the only one that is BOTH total and
 * expressible without a shell.
 *
 * The other two each give up one of those. `archive/` is total — the walk never
 * descends, so every reader honours it — but it costs a human at a shell with
 * `git mv`, which is not a thing a remote operator, a scheduled loop or a person
 * on their phone can do. `deferred` is one tool call away, and is therefore
 * allowed to reach exactly one suspicion-only scan, because a status the agent
 * can set on itself must never be able to empty a gate's denominator.
 *
 * Retraction is total like the archive and reachable like a status, and it is
 * allowed both because it is neither the agent's to write nor the agent's to
 * remove. `## Retraction` is a {@link ../ost/headings.ts} reserved heading: every
 * caller-supplied string on the tool surface is scanned for one and refused, and
 * `splitReservedSections` holds the block aside so an edit cannot drop it either.
 * The one writer is `retractNode` on the CLI, beside `recordResult` and
 * `promoteNode`, off every allowlist. So the same sentence that licenses the
 * archive licenses this: an unforgeable retirement cannot become the agent's way
 * of making a violation go away.
 *
 * Read off the BODY rather than a frontmatter field on purpose. A field would be
 * one more thing `serialize` writes, which means one more thing an edit could
 * carry or drop silently; the heading is the same mechanism the three
 * measurements already use, and it is the mechanism the guards already know how
 * to protect.
 */
export function isRetractedNode(node: { body?: string }): boolean {
  return node.body !== undefined && declaresHeading(node.body, RETRACTION_HEADING);
}

/**
 * Why a node was retracted, in the retracting human's own words — or a bare
 * statement that it was, if the section carries no list entry.
 *
 * Named, never merely counted, for the reason {@link formatCensus} states: "1
 * retired" tells an operator a number moved, and the retraction line tells them
 * who moved it and why. Flattened and clamped by {@link quotableSource} because
 * it reaches a census entry that renderers put on one line.
 */
export function retractionReason(node: { body?: string }): string {
  const entries = node.body ? entriesUnder(node.body, RETRACTION_HEADING) : [];
  const first = entries[0];
  return first ? `retracted — ${quotableSource(first)}` : "retracted — no reason recorded";
}

/**
 * The census with status-retired nodes withheld from `nodes` and named in
 * `retired` instead — the status half of Z4's filter, as a pure function over a
 * census that has already been read, so nothing has to parse the vault twice.
 *
 * **Where this may be used, and why the boundary is narrow.** `deferred` is a
 * status the agent can set on itself, in one call, on any node. If a retirement
 * removed a node from `checkInvariants` or from `done`, then "retire it" would
 * be a tool for making a dangling link, an orphan, an unearned rung or a
 * self-validation contradiction *disappear* — a gate the constrained actor can
 * clear on its own authority, which is the failure B1 and B2 exist to prevent.
 * So this filter feeds exactly one consumer: the near-duplicate scan.
 *
 * That one is safe, and not by accident. `near-duplicate` is the single hygiene
 * rule with no invariant behind it (`HYGIENE_ONLY_RULES`), it reports a
 * *suspicion* rather than a defect, and the honest resolution for a real
 * duplicate in an append-only vault is precisely to abandon the redundant node —
 * there is no delete. Marking a duplicate `deferred` is therefore the remedy the
 * issue is asking for, recorded in the node's History with a date, and it costs
 * the agent the same one call that annotating the issue would. It buys no
 * shortcut to `done` that P5's own instruction does not already grant.
 *
 * The archive half needs no such argument and is applied unconditionally at the
 * read (see {@link ARCHIVE_DIRNAME}).
 */
export function withoutRetiredNodes(census: TreeCensus): TreeCensus {
  const kept: OstNode[] = [];
  const retired = [...census.retired];
  for (const n of census.nodes) {
    if (isRetiredNode(n)) {
      retired.push({ file: `${n.title}.md`, reason: `status: ${n.status} — retired, withheld from the duplicate scan` });
    } else {
      kept.push(n);
    }
  }
  return { ...census, nodes: kept, retired };
}

/** A denominator taken from somewhere other than the walk that produced the count. */
export interface IndependentDenominator {
  source: "git";
  /** Markdown files this source believes exist in the vault. */
  tracked: number;
  /**
   * Files the independent source knows about that the walk never enumerated.
   * Non-empty means the walk is blind, and every count in the product is short
   * by at least this much.
   */
  unseenByWalk: string[];
}

export interface TreeCensus {
  /** What the counter counted. The same array `readTree()` returns. */
  nodes: OstNode[];
  /** Markdown files the walk enumerated — the denominator the count was taken over. */
  examined: number;
  /**
   * The enumerated filenames themselves, which is what makes reconciliation against
   * an independent source possible: comparing two integers can only tell you THAT
   * they disagree, never which file went missing.
   */
  seenFiles: string[];
  /** Enumerated, readable, but not an OST node. */
  skipped: CensusDrop[];
  /** Enumerated but could not be read or parsed at all. */
  unreadable: CensusDrop[];
  /**
   * Enumerated, readable, node-shaped — but carrying a `type:` this reader does
   * not recognise. Retained here rather than dropped; see
   * {@link ./quarantine.ts} for the whole argument.
   *
   * A separate list from `skipped` for the same reason `retired` is: a skipped
   * file was never a node, and a quarantined one is a node this reader cannot
   * classify. Conflating them is exactly the silence that made a `type: Metric`
   * edit read as four orphan Opportunities and a dangling link.
   */
  quarantined: QuarantinedNode[];
  /**
   * Real nodes that were withheld from `nodes` because they have left the live
   * tree — archived into `archive/`, or (only when the caller asked for the
   * status filter) carrying a retired status.
   *
   * A separate list from `skipped` on purpose. A skipped file is something that
   * was never a node; a retired one is a node that *was* one, and conflating the
   * two would report a deliberate retirement as a malformed file. Both are
   * named rather than counted, for the reason {@link formatCensus} states.
   */
  retired: CensusDrop[];
  /** Absent when no independent source was available (e.g. the vault is not a repo). */
  independent?: IndependentDenominator;
  /** Absent when the trace cannot speak for this vault's whole life. See {@link reconcileWithUsage}. */
  unexplained?: UsageAccounting;
  /** Absent when no trust ledger exists for this vault. See {@link reconcileWithTrust}. */
  standing?: SourceStandingAccounting;
}

/** What the usage trace says about where the tree's files came from. */
export interface UsageAccounting {
  source: "usage-trace";
  /** The file the finding was computed from, named so an operator can open it. */
  basis: string;
  /** Node files on disk that no recorded invocation claims to have created. */
  unexplained: string[];
}

/**
 * Ask git — not the filesystem walk — how many markdown files this vault has.
 *
 * `git ls-files` reads the index, a structure maintained by a different program
 * through a different code path than `fs.readdirSync`. That independence is the
 * entire value: a walk that cannot see a file for whatever reason (an encoding it
 * mishandles, a name it mangles, a directory it never descends into) does not get to
 * define the denominator that would have exposed it.
 *
 * `-z` because vault filenames legitimately contain quotes, spaces and em-dashes —
 * the very characters that produced the failure this instrument exists to catch. Git
 * would otherwise C-quote them and the reconciliation would report phantom
 * discrepancies on exactly the files that matter most.
 *
 * Returns undefined rather than throwing when there is no repo. An absent source is
 * not a discrepancy, and a vault is not required to be under version control.
 */
export async function reconcileWithGit(
  vaultRoot: string,
  census: TreeCensus,
): Promise<IndependentDenominator | undefined> {
  const root = path.resolve(vaultRoot);
  let raw: string;
  try {
    const g = simpleGit(root);
    if (!(await g.checkIsRepo())) return undefined;
    raw = await g.raw(["ls-files", "-z", "--", "*.md"]);
  } catch {
    // No repo, no git binary, or a repo we cannot read. The walk's own accounting
    // still stands; we simply have no second opinion to offer.
    return undefined;
  }

  // NUL-delimited, so nothing here needs unquoting.
  const tracked = raw.split("\0").filter((f) => f.length > 0);

  // Only files directly in the vault root are nodes; the walk never descends, so
  // comparing against nested paths would manufacture a discrepancy that is not one.
  const topLevel = tracked.filter((f) => !f.includes("/"));

  const seen = new Set(census.seenFiles);
  const unseenByWalk = topLevel.filter((f) => !seen.has(f)).sort();

  return { source: "git", tracked: topLevel.length, unseenByWalk };
}

/**
 * Ask the usage trace — not git, and not the walk — which node files something asked
 * for.
 *
 * This is the third instrument, for the blindness the other two share. The walk cannot
 * tell a node the tree grew from a node that appeared beside it: both are files with
 * valid frontmatter. Neither can git, and git is worse than silent here — every
 * mutating tool call runs `git add -A` and commits as `mcp: <tool> — …`, so a file
 * written out of band does not merely go unnoticed, it *acquires* a commit message
 * attributing it to an allowlisted append-only tool (W2). `reconcileWithGit` compares
 * the walk against an index that the same `add -A` has already reconciled, so the two
 * agree precisely when they are both wrong.
 *
 * The trace is the one record written *before* the file exists, by the code path that
 * asked for it. A node file no event claims is a node file no tool invocation explains.
 *
 * **Returns undefined unless the trace can speak for the vault's whole life**, which
 * it can only do from an `init` marker onwards (see `recordInitInTrace`). A vault older
 * than this mechanism has nodes no event could ever claim, and reporting all of them as
 * unexplained would be a wall of noise that trains an operator to ignore the one line
 * that matters. An absent basis is not a discrepancy — the same answer
 * `reconcileWithGit` gives a vault that is not a repository.
 *
 * *The honest limit, stated because it is the boundary and not a loophole:* anyone who
 * can write a node file out of band can also delete this trace, and a deleted trace
 * reads as "no basis" rather than as an alarm. What it cannot do is delete the trace
 * quietly — the file is tracked, so its removal is a diff. This detects the write
 * nobody was hiding, which is the one the criterion is about.
 */
export function reconcileWithUsage(vaultRoot: string, census: TreeCensus): UsageAccounting | undefined {
  const file = usageLogPath(vaultRoot);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }

  const claimed = new Set<string>();
  let covered = false;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event: { tool?: unknown; wrote?: unknown };
    try {
      event = JSON.parse(line) as { tool?: unknown; wrote?: unknown };
    } catch {
      // A torn final line loses itself, never the reconciliation — the same rule the
      // usage rollup reads this file under. It can only cost coverage, never invent it.
      continue;
    }
    if (event.tool === INIT_TRACE_TOOL) covered = true;
    if (Array.isArray(event.wrote)) for (const f of event.wrote) if (typeof f === "string") claimed.add(f);
  }
  if (!covered) return undefined;

  return {
    source: "usage-trace",
    basis: path.relative(path.resolve(vaultRoot), file) || file,
    unexplained: census.seenFiles.filter((f) => !claimed.has(f)).sort(),
  };
}

/**
 * How much of a caller-supplied string may be quoted into a finding, and the
 * characters that may survive the trip.
 *
 * **This lives here, in the lowest layer both readers already depend on, because
 * there must be exactly one of it.** It was written for `ost_next_work`'s
 * dangling-citation issue (W12) and now has a second caller in the withdrawn-standing
 * finding below; two spellings of one flattening rule is the drift R4 was spent
 * removing, and the failure it would cause here is not cosmetic — see the three
 * measured wedges below.
 *
 * **The strings this is applied to are the ones that never pass
 * `assertWritableContent`.** `ost_create_node` hands `input.source` straight to
 * `serialize`, where YAML happily stores a multi-line scalar; `rankHost` checks only
 * that a `reason` is non-empty and normalizes a `host` without ever looking for a
 * newline. So each of them is arbitrary untrusted content, and a finding quoting one
 * has to survive being written *back* through the write boundary by `ost_annotate` —
 * the one and only way out of the red it causes.
 *
 * Quoting raw was a wedge, and it was reachable in three ways at once (measured
 * against a scratch vault before this existed):
 *
 * - `source: "INBOX:x.md\n## Results\n- it worked"` produced an issue containing a
 *   reserved heading, and `vault.annotate` **refuses** it (B1). Permanent `done: false`
 *   with no tool on either surface able to clear it.
 * - `source: "INBOX:[[Some\nTitle]].md"` produced an issue carrying a split wikilink,
 *   refused by the same guard for the same reason.
 * - Even where the guard let it through, a multi-line issue is unclearable *silently*:
 *   `annotate` writes `- <date> <issue>` and `annotatedIssues` reads one line back,
 *   so the suppression key could never match what was written and the issue would be
 *   re-reported forever.
 *
 * Flattening C0 controls to spaces closes all three: the reserved-heading and
 * wrapped-wikilink checks are both line-anchored (`declaresHeading` splits on `\n`;
 * `wrappedLinkTargets` looks for a newline *inside* the brackets), and a one-line issue
 * is what the suppression reader can see. The length clamp is the response-size half —
 * the per-list caps' bound argument rests on every quoted string being clamped
 * (titles 200, excerpts 280), and neither a `source` nor a trust `reason` has a schema
 * length limit anywhere.
 *
 * The cost is that the quote is a rendering rather than the bytes: whitespace is
 * collapsed and a long id is cut. That is the right trade for a string whose purpose is
 * to let a human see the typo, and it cannot cause a *mis*-clear, because suppression is
 * keyed per node and a node has one `source`.
 */
const QUOTED_SOURCE_CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F]+", "g");
export const MAX_QUOTED_SOURCE_LENGTH = 200;
export function quotableSource(source: string): string {
  const flat = source.replace(QUOTED_SOURCE_CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return flat.length > MAX_QUOTED_SOURCE_LENGTH ? `${flat.slice(0, MAX_QUOTED_SOURCE_LENGTH)}…` : flat;
}

/**
 * A source that held standing and lost it, together with the nodes it already
 * seeded (B11).
 *
 * DEC-2 says standing is earned by testing cause and effect. The half everyone
 * builds is the promotion; the half that costs money is the withdrawal, because a
 * channel that goes silent is noticed and a channel that keeps delivering
 * plausible, wrong content on cadence is not. A withdrawal that only edits a
 * ledger changes what the *next* page from that publisher is worth and says
 * nothing about the nodes already resting on it.
 *
 * **Every field here is derived, and none of it is ever written onto a node.** A
 * "suspect" flag stamped into frontmatter would be forgeable by the one actor
 * this is about (B1's path — the agent can write what it can also be judged on),
 * and it would go stale the moment the source's standing moved again. The ledger
 * is the single source of truth and this is a read of it.
 */
export interface WithdrawnSource {
  /**
   * The ledger's key for the source: `kind:id`, the same string the ledger keys
   * its own rows on and the same one `ost_rank_source` echoes back. Flattened for
   * display by {@link quotableSource}; the matching below is done on the raw key.
   */
  key: string;
  /**
   * Why standing is gone, in the ledger's own vocabulary: a `strike` the agent
   * filed with `direction: 'contradicted'`, or a `refuted` verdict a human
   * recorded on a test this source's own claim was put to.
   *
   * Carried rather than collapsed into one word because the two have different
   * readers: a strike is a judgement someone made about the channel, a refutation
   * is a prediction the world settled. DEC-2's sentence is about the second, and a
   * report that could not tell them apart would let the agent's own opinion of a
   * source read exactly like reality's.
   */
  why: "strike" | "refuted";
  /** The rung the source's history had earned it just BEFORE the withdrawing record. */
  from: string;
  /** The rung it now holds — the floor, which is what any live strike or refutation forces. */
  to: string;
  /**
   * The withdrawing record's own timestamp, straight from the ledger.
   *
   * The LAST live one, not the first, and that is the property that keeps this
   * from silencing itself. `ost_next_work` reports the finding as a hygiene issue
   * cleared by annotating the node, and annotation suppression is keyed on the
   * issue's text — so if a second strike produced the same sentence as the first,
   * a source struck, cleared by a human, and struck again would stay behind the
   * first annotation forever. A new record reads differently and re-raises.
   */
  at: string;
  /** Why standing was withdrawn, as recorded. Flattened and clamped — see {@link quotableSource}. */
  reason: string;
  /**
   * Titles of nodes whose OWN `source` resolves to this actor, in tree order.
   *
   * **Not transitive, and the shortfall is stated rather than implied.** A node
   * that cites no source but hangs beneath one that does is *not* here. Reporting
   * every node reachable downstream is a much larger claim than reporting every
   * node that rests on the source directly, and it needs an edge semantics this
   * tree does not have — `links` carries "parent of" and "related to" in one
   * relation, so a transitive walk would paint whole subtrees suspect on the
   * strength of a `Related:` line. The direct set is what a human can act on
   * without re-deriving the walk's assumptions, and it is what B11's check asks
   * for. Never capped here: a cap belongs to a renderer, and the count below is
   * what the renderers restate when they shorten a list.
   */
  nodes: string[];
}

/**
 * The name both gates report a withdrawn source's downstream under.
 *
 * Declared once, here beside the derivation, because `ost_check` and
 * `ost_next_work` name the same finding and a reader moving between them must not
 * have to work out that two strings mean one thing. It is deliberately *not* a
 * `checkInvariants` rule — see {@link reconcileWithTrust} for why — which is what
 * makes it a `HYGIENE_ONLY_RULES` member on the `next_work` side.
 */
export const SUSPECT_SOURCE_RULE = "suspect-source";

/** What the trust ledger says about the sources this tree already rests on. */
export interface SourceStandingAccounting {
  source: "trust-ledger";
  /** The file the finding was computed from, named so an operator can open it. */
  basis: string;
  /** Sources that lost standing and have not been reset. Empty is the ordinary case. */
  withdrawn: WithdrawnSource[];
  /** Nodes named across `withdrawn` — the number a display cap must not be able to change. */
  nodes: number;
  /**
   * Ledger lines that could not be read.
   *
   * Reported rather than swallowed because the direction of the loss is not
   * symmetric: a dropped `corroboration` costs a source standing it earned, but a
   * dropped `strike` leaves a source looking trustworthy that somebody withdrew
   * trust from — this report's exact failure mode, silently. The number travels
   * with the finding so "nothing is suspect" cannot be read off a file that was
   * partly unreadable.
   */
  damaged: number;
}

/**
 * What the ledger says about one actor, computed over an arbitrary slice of its
 * history.
 *
 * A synthetic single-row ledger rather than a second scorer, because "what had
 * this source earned before the strike?" must be answered by the *same* function
 * that answers "what does it hold now" (`explainRung`). A local re-implementation
 * of the ladder here is the drift R4 was spent removing, and it would drift in the
 * direction of this report disagreeing with the rung the write boundary enforces.
 */
function rungOver(key: ActorKey, history: readonly TrustObservation[]): string {
  return explainRung({ histories: new Map([[keyString(key), history]]), damaged: 0 }, key).rung;
}

/** The records after this actor's last `reset` — the only ones that still bind. */
function sinceReset(history: readonly TrustObservation[]): readonly TrustObservation[] {
  let last = -1;
  history.forEach((r, i) => {
    if (r.type === "reset") last = i;
  });
  return history.slice(last + 1);
}

/** Did this record take the source's standing away? */
function isWithdrawal(rec: TrustObservation): boolean {
  return rec.type === "strike" || (rec.type === "corroboration" && rec.verdict === "refuted");
}

/**
 * Which sources currently stand withdrawn, folded out of the ledger's history.
 *
 * Pure, over a ledger already read, because this is the whole of the mechanism and
 * it should be testable without a filesystem.
 *
 * **A withdrawal is a transition, not a state, and that is why the history has to
 * be read rather than the rung.** `rungOf` answers `assertion` for a struck
 * publisher and `assertion` for the thousands of publishers nobody ever ranked —
 * the floor is where everyone starts. Only the append-only history can tell
 * "never earned anything" from "somebody took it away", and only the second is a
 * reason to go back and re-read what the source already seeded.
 *
 * Three rules, each load-bearing:
 *
 * - **A `strike` withdraws on its own, with or without prior standing.** This is
 *   the record `ost_rank_source({direction: 'contradicted'})` writes and it is
 *   the criterion's own step one — "record a demotion for source S". Requiring a
 *   promotion first would be the weaker neighbouring check and would make B11
 *   unreachable in practice, since raising a source now needs a corroborating
 *   result joined to a node that cited it (B4/B5) and most struck channels never
 *   had one.
 * - **A `refuted` verdict withdraws too.** DEC-2's sentence is about predictions
 *   reality did not corroborate, and that is exactly what a refutation on a test
 *   one level from a citing node is. It reaches the ledger from the human-only
 *   result path, so it is the half of this the agent cannot author at all.
 * - **Only a `reset` clears it.** A later corroboration does not, which is the
 *   ledger's own rule (`explainRung` returns the floor while any strike stands)
 *   and the one that stops the actor being judged from voting itself back up. The
 *   corresponding cost — that clearing needs a human on a shell — is why the
 *   finding is reported by `ost_check` and `ost_next_work` rather than made an
 *   invariant violation; see {@link reconcileWithTrust}.
 */
export function withdrawnStanding(
  ledger: TrustLedger,
): Map<string, { why: "strike" | "refuted"; from: string; to: string; at: string; reason: string }> {
  const out = new Map<string, { why: "strike" | "refuted"; from: string; to: string; at: string; reason: string }>();
  for (const [key, history] of ledger.histories) {
    const first = history[0];
    // `migration` markers are dropped at read time and never keyed; this narrows
    // for the compiler rather than handling a case that occurs.
    if (!first || first.type === "migration") continue;
    const actor: ActorKey = { kind: first.kind, id: first.id };
    const live = sinceReset(history);
    // The LAST live withdrawal, so a second strike re-raises a finding an
    // annotation had suppressed. See {@link WithdrawnSource.at}.
    let at = -1;
    live.forEach((r, i) => {
      if (isWithdrawal(r)) at = i;
    });
    if (at === -1) continue;
    const rec = live[at];
    // `isWithdrawal` already established which two variants these are; the switch
    // is what makes the compiler agree, and it fails closed on any third.
    const said =
      rec.type === "strike"
        ? { why: "strike" as const, reason: rec.reason }
        : rec.type === "corroboration"
          ? {
              why: "refuted" as const,
              reason: `the test "${rec.test}" was refuted${rec.node ? `, on the claim in "${rec.node}"` : ""}`,
            }
          : null;
    if (!said) continue;
    out.set(key, {
      ...said,
      from: rungOver(actor, live.slice(0, at)),
      to: rungOver(actor, live),
      at: rec.ts,
    });
  }
  return out;
}

/**
 * Ask the trust ledger which of this tree's sources have lost their standing, and
 * which nodes already rest on them (B11).
 *
 * The fourth instrument, and the only one that reads a claim the *tree* makes
 * about the world rather than a claim about the tree's own files. It is shaped
 * like {@link reconcileWithUsage} deliberately: computed from a sidecar file,
 * carried on the census, rendered by `eval/render.ts`, and **not** a rule in
 * `src/eval/invariants.ts`.
 *
 * **It reads the LIVE ledger, and that sentence is the one thing here worth
 * checking on every change.** This mechanism was first written against
 * `.ost-agent/trust/hosts.jsonl`, which by then was the RETIRED host-keyed file
 * (`knowledge/web-trust.ts`): nothing writes it, `ost_rank_source` appends
 * `actors.jsonl`, and the whole report was dead on arrival while three dozen tests
 * that planted the legacy file by hand went green. A report keyed on a file no
 * writer produces is the failure mode this comment exists to prevent, which is why
 * the end-to-end assertion — demote through the tool, then read the finding — is
 * the first test in `test/eval/suspect-source.test.ts` and not an afterthought.
 * Legacy vaults are not lost: `readTrustLedger` folds `hosts.jsonl` in on first
 * sight, so an old demotion arrives here as a `strike`.
 *
 * **Why not an invariant, stated here because it is the design and not an
 * accident of where the data lives.** `checkInvariants` is model-independent
 * structure over a node list, and this is neither of those — the nodes are
 * perfectly well-formed; what moved is our confidence in what they were built
 * from. The decisive reason is R3's table, though. A strike is free and
 * agent-reachable in a single `ost_rank_source` call, deliberately (B4 kept it
 * that way so a guard could never make distrusting a bad source expensive). As an
 * invariant this would therefore be the table's first `create: true` cell since R2
 * and R6 closed the last two — and R3 then demands a one-call clear, which does
 * not exist: a strike is cleared only by `ost-agent trust reset`, a human-only CLI
 * path, and annotation clears a hygiene issue rather than an invariant violation.
 * Creatable and unclearable is precisely the permanent wedge R3 exists to forbid,
 * and the wedge would be triggered by the agent doing the *right* thing.
 *
 * Returns undefined when there is no ledger at all. An absent source is not a
 * discrepancy.
 */
export function reconcileWithTrust(vaultRoot: string, census: TreeCensus): SourceStandingAccounting | undefined {
  const file = trustLedgerPath(vaultRoot);
  // The legacy fold inside `readTrustLedger` can MINT this file, so "does it
  // exist" is asked after the read, not before — otherwise a vault whose only
  // trust history is a migrated `hosts.jsonl` would report no ledger on the run
  // that migrated it and a ledger on the next one.
  const ledger = readTrustLedger(vaultRoot);
  if (ledger.histories.size === 0 && ledger.damaged === 0 && !fs.existsSync(file)) return undefined;
  const basis = path.relative(path.resolve(vaultRoot), file) || file;

  const lost = withdrawnStanding(ledger);
  if (lost.size === 0) {
    return { source: "trust-ledger", basis, withdrawn: [], nodes: 0, damaged: ledger.damaged };
  }

  // Read once for the whole census: `sourceTrustKey` resolves a stored-evidence
  // citation through the actor the INGESTING SURFACE stamped on the record (W11),
  // which is the only identity here the producer could not choose for itself.
  const actors = evidenceActors(vaultRoot);

  // Taken over the whole census, in tree order. A node cites at most one source,
  // so the per-source lists partition the affected nodes and the total is their sum.
  const byKey = new Map<string, string[]>();
  for (const n of census.nodes) {
    const key = sourceTrustKey(n.source, actors);
    if (key === null) continue;
    const k = keyString(key);
    if (!lost.has(k)) continue;
    const seen = byKey.get(k);
    if (seen) seen.push(n.title);
    else byKey.set(k, [n.title]);
  }

  const withdrawn: WithdrawnSource[] = [];
  let nodes = 0;
  for (const [key, change] of lost) {
    const affected = byKey.get(key) ?? [];
    // A source nothing cites is a withdrawal with no downstream. Reported anyway,
    // with an empty list: "we stopped trusting this and nothing rests on it" is a
    // fact an operator should be able to read off, and hiding it would make the
    // section's absence mean two different things.
    nodes += affected.length;
    withdrawn.push({
      key: quotableSource(key),
      why: change.why,
      from: change.from,
      to: change.to,
      at: change.at,
      reason: quotableSource(change.reason),
      nodes: affected,
    });
  }
  return { source: "trust-ledger", basis, withdrawn, nodes, damaged: ledger.damaged };
}

/**
 * One line for `status`, plus a named line per dropped file.
 *
 * Named, not counted. "4 dropped" tells an operator a number is wrong; "Stray.md —
 * unrecognised type" tells them which file to open. The first is a statistic and the
 * second is a repair, and the cost of printing the filename is one line.
 */
export function formatCensus(census: TreeCensus, nodeCount: number): string {
  const lines: string[] = [];
  const dropped = census.skipped.length + census.unreadable.length;

  // The quarantine count rides on the HEADER, not only on the detail lines
  // beneath it. `appendCensus` emits this line unconditionally and samples what
  // follows, so a number that appeared only in the detail could be elided by a
  // vault with enough stray files — which is this file's own failure mode wearing
  // a display cap.
  lines.push(
    `Counted over: ${nodeCount} node(s) of ${census.examined} markdown file(s) examined` +
      (dropped > 0 ? `, ${dropped} dropped` : "") +
      (census.quarantined.length > 0 ? `, ${census.quarantined.length} quarantined (unrecognised \`type:\`)` : ""),
  );

  for (const s of census.skipped) lines.push(`  – dropped ${s.file}: ${s.reason}`);
  for (const u of census.unreadable) lines.push(`  – unreadable ${u.file}: ${u.reason}`);

  // Quarantine, named ABOVE the retired block and never folded into `dropped`.
  // A dropped file subtracted itself from every count in the product silently;
  // this one is the same subtraction with the subtraction stated, which is the
  // only difference the operator can act on.
  if (census.quarantined.length > 0) {
    lines.push(
      `  ⚠ quarantined: ${census.quarantined.length} node(s) present on disk that this reader cannot classify.` +
        `\n    They are NOT in the ${nodeCount} above, and the branches beneath them are dark to every` +
        `\n    count, gate and rollup. This is a hole in the tree, not a formatting complaint.`,
    );
    for (const q of census.quarantined) {
      lines.push(`    · ${q.file}: ${quarantineReason(q)}`);
      if (q.links.length > 0) {
        lines.push(`      quarantined-parent of: ${q.links.join(", ")}`);
      }
    }
  }

  // A retired node leaves the denominator, and this is the line that stops that
  // from being the same thing as vanishing. Before the archive directory was
  // read at all, a node moved out of the root simply stopped existing as far as
  // every count in the product was concerned — the exact silence this file was
  // written against, one directory level down.
  if (census.retired.length > 0) {
    lines.push(`  – retired: ${census.retired.length} node(s) out of the live tree, excluded from the counts above`);
    for (const r of census.retired) lines.push(`    · ${r.file}: ${r.reason}`);
  }

  const ind = census.independent;
  if (ind && ind.unseenByWalk.length > 0) {
    lines.push(
      `  ✗ ${ind.source} tracks ${ind.tracked} markdown file(s); the walk enumerated ${census.examined}.`,
    );
    lines.push(
      `    The walk never saw: ${ind.unseenByWalk.join(", ")}` +
        `\n    Every count in this vault is short by at least that much. This is not a` +
        `\n    tree problem — it is the reader failing to read, and no invariant will catch it.`,
    );
  }

  return lines.join("\n");
}

/**
 * One firing of `check` or `status`, as far as the census line is concerned.
 *
 * "Every count states the denominator it was taken over" shipped as v0.22.0 and
 * prints this per invocation — then throws it away. The follow-on assumption test
 * ("Does a stated denominator catch a drop nobody predicted") is answered by a
 * human reading ten firings and judging whether an unanticipated drop showed up,
 * whether it named a file specific enough to act on, and whether it was ignored.
 * None of those three questions can be answered from a single run's stdout once
 * the next invocation has overwritten the terminal — the human needs the last N
 * firings side by side, which means something has to have kept them.
 */
export interface CensusFiring {
  /** When this firing ran. */
  ts: string;
  /** Which command produced it — the two the assumption test reads. */
  command: "check" | "status";
  /** The denominator this firing's counts were taken over. */
  examined: number;
  /** Enumerated, readable, but not an OST node — same shape as {@link TreeCensus.skipped}. */
  skipped: CensusDrop[];
  /** Enumerated but unreadable — same shape as {@link TreeCensus.unreadable}. */
  unreadable: CensusDrop[];
  /**
   * Enumerated and quarantined — file and reason, flattened from
   * {@link TreeCensus.quarantined}.
   *
   * Optional, because the history file predates the field and a firing written
   * before it exists holds no answer either way. A reader must treat `undefined`
   * as "this firing could not say", never as "there were none" — the same
   * posture `sight` and `authorship` take on a node.
   */
  quarantined?: CensusDrop[];
  /** Filenames an independent source (git) saw that this walk never enumerated. */
  unseenByWalk: string[];
}

/** Flatten quarantined nodes to the file/reason pair the history and the renderers share. */
export function quarantineDrops(census: TreeCensus): CensusDrop[] {
  return census.quarantined.map((q) => ({ file: q.file, reason: quarantineReason(q) }));
}

/** Does this firing's census line carry a drop, a quarantine, an unreadable file, or a git discrepancy? */
export function isNonEmptyCensus(census: TreeCensus): boolean {
  return (
    census.skipped.length > 0 ||
    census.unreadable.length > 0 ||
    census.quarantined.length > 0 ||
    (census.independent?.unseenByWalk.length ?? 0) > 0
  );
}

/** How many firings {@link recordCensusFiring} keeps — the window the assumption test reads over. */
export const MAX_CENSUS_FIRINGS = 10;

/** Where the rolling firing history lives: inside the vault, travels in git like the usage trace. */
export function censusHistoryPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "census-history", "firings.jsonl");
}

/**
 * Record one `check` or `status` firing, keeping only the last {@link MAX_CENSUS_FIRINGS}.
 *
 * Every firing is kept, not only the non-empty ones — a run that found nothing is
 * itself part of what the threshold reads ("zero non-empty census lines across 10
 * firings... means the vaults were clean and the instrument is untested"), and
 * "ignored for 2+ consecutive firings" can only be judged against the firings in
 * between. NEVER throws: this is telemetry about the census, not the census
 * itself, and a write failure here must cost a history entry, not a command.
 */
export function recordCensusFiring(
  vaultDir: string,
  command: CensusFiring["command"],
  census: TreeCensus,
  ts: string,
): void {
  try {
    const entry: CensusFiring = {
      ts,
      command,
      examined: census.examined,
      skipped: census.skipped,
      unreadable: census.unreadable,
      quarantined: quarantineDrops(census),
      unseenByWalk: census.independent?.unseenByWalk ?? [],
    };
    const next = [...readCensusHistory(vaultDir), entry].slice(-MAX_CENSUS_FIRINGS);
    const file = censusHistoryPath(vaultDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, next.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  } catch {
    // fail-open: recording a firing must never cost the command that fired it
  }
}

/**
 * The last (up to) {@link MAX_CENSUS_FIRINGS} recorded firings, oldest first.
 *
 * Absent file and unreadable lines both read as "no history yet" rather than as
 * an error — a torn final line loses itself, never the read, the same rule
 * {@link reconcileWithUsage} follows for the same reason.
 */
export function readCensusHistory(vaultDir: string): CensusFiring[] {
  let raw: string;
  try {
    raw = fs.readFileSync(censusHistoryPath(vaultDir), "utf8");
  } catch {
    return [];
  }
  const out: CensusFiring[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CensusFiring);
    } catch {
      continue;
    }
  }
  return out.slice(-MAX_CENSUS_FIRINGS);
}
