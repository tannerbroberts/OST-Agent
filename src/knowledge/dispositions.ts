/**
 * The disposition ledger — the one place a pass can say "this is settled", and the
 * one place every work bucket looks before it lists anything.
 *
 * `computeNextWork` re-derives outstanding work from raw structure on every pass, and
 * it has no notion of *closed*. So work a previous pass settled comes back on the next
 * list, and each bucket leaks differently: an opportunity whose solution space really
 * does live on its children is underserved forever; a solution that shipped still owes
 * an assumption test; and the evidence face cannot be fixed by a smarter derivation at
 * all — an item is mapped only when a node's frontmatter `source:` equals its id, body
 * citations are invisible to the sweep, and no tool can add a `source:` to an existing
 * node. There is nothing on disk for a cleverer predicate to read. Something has to be
 * written down.
 *
 * **Where it lives is the constraint, not a preference.** A `## Disposition` section in
 * a node body was tried on 2026-08-05 and the sweep did not see it — the acknowledgement
 * has to live where the *sweep* reads, not where a *reader* reads. So this is a sidecar
 * ledger under `.ost-agent/`, in the shape `asks.ts` and `actor-trust.ts` already use:
 * append-only JSONL, attributed, dated off an injected clock, read as a history.
 *
 * **One entry type, and `kind` is not a branch.** The three faces look like three
 * subjects — an ingest id that lives outside the tree, a solution title that lives in
 * it, an opportunity's claim about its own children — and the open question was whether
 * they fit one record without a discriminated union per case, which is the general form
 * collapsing back into three special cases wearing one name. They do, because the only
 * thing a bucket asks is "does a live disposition name this string?", and every one of
 * those subjects is a string the bucket already holds. {@link isDisposed} therefore does
 * not read `kind` and cannot: it is metadata for the human auditing the ledger, and the
 * read is deliberately blind to it so that no bucket can grow a case of its own.
 *
 * **This is the highest-risk write on the surface, and the risk is not in the code.**
 * Every other item leaves a work list by something checkable — code shipped, an
 * instrument attached, a node created. A disposition removes work by *asserting*, and
 * it would be written by the party whose budget the work costs. That is the same shape
 * as the self-validation this tool surface exists to refuse. Three things follow, and
 * they are load-bearing:
 *
 *   1. **The write is not on the agent's surface.** It is `ost-agent dispose`, a CLI
 *      command a human runs, for the reason B1/B2 keep `ost-agent result` and
 *      `ost-agent promote` there: a pass that could dismiss its own work list has a
 *      completion signal that means nothing. Whether it should ever reach the agent is
 *      "An operator would accept a pass dismissing its own work list by written
 *      assertion", and that needs people, not a build.
 *   2. **Nothing is hidden silently.** A withheld item is reported on the response that
 *      withheld it ({@link Withheld}), the same way a capped list names what it capped.
 *      A dismissal nobody can see is an amnesty.
 *   3. **Every disposition is reversible.** A `reopened` entry puts the subject back on
 *      its bucket. An irreversible hide is the mirror image of the unclearable red this
 *      repository keeps re-learning.
 *   4. **An acknowledgement is only as good as the node it names.** `corroborates [[X]]`
 *      is the one verdict whose whole justification for removing work is a pointer into
 *      the tree, so the pointer is resolved against the tree — at the funnel, and again
 *      on every read ({@link isOrphanedAcknowledgement}). An acknowledgement filed under
 *      a title no node carries would otherwise be the perfect silent dismissal: it clears
 *      the item, it prints in the audit like a filing, and it strengthens nothing forever.
 */
import fs from "node:fs";
import path from "node:path";
import { nearestName } from "../fs/near-miss.js";
import type { OstNode } from "../ost/node.js";

/**
 * The three faces of "settled" this ledger covers, in the vocabulary a human reads.
 *
 * A closed set rather than a free string, so `ost-agent dispositions` can group by it
 * and a typo cannot invent a fourth kind. It is audit metadata only — see
 * {@link isDisposed}, which never reads it.
 */
export const DISPOSITION_KINDS = ["evidence", "solution", "opportunity"] as const;
export type DispositionKind = (typeof DISPOSITION_KINDS)[number];

export function isDispositionKind(v: unknown): v is DispositionKind {
  return typeof v === "string" && (DISPOSITION_KINDS as readonly string[]).includes(v);
}

/**
 * What one entry does to its subject. `closed` takes it off its bucket; `reopened`
 * puts it back.
 *
 * Reversal is an entry rather than a deletion because the ledger is append-only: the
 * record that a pass once dismissed something, and that a human disagreed, is the part
 * an auditor most needs and the part a delete would destroy.
 */
export const DISPOSITION_STATES = ["closed", "reopened"] as const;
export type DispositionState = (typeof DISPOSITION_STATES)[number];

export function isDispositionState(v: unknown): v is DispositionState {
  return typeof v === "string" && (DISPOSITION_STATES as readonly string[]).includes(v);
}

/**
 * The two verdicts an acknowledgement can carry, and why they must be distinct.
 *
 * Three consecutive sweeps of this project's own vault classified their stranded
 * evidence and found the same shape: most items corroborate a need the tree already
 * holds, a few reveal nothing, and the difference is the fact a later reader most
 * needs — a need corroborated by nine independent sessions is a different claim from
 * one asserted once. A free-text `reason` records the difference for a human and
 * erases it for every consumer: "corroborates X" and "nothing here" read identically
 * to code. So the verdict is typed, and only `corroborates` — never `no-genuine-need`,
 * never an entry with no verdict at all — can strengthen a node's evidence later
 * (see {@link corroborationsFor}).
 *
 * Optional, not required: a plain disposition ("shipped", "lives on its children")
 * settles work without passing judgement on an evidence item, and forcing a verdict
 * onto it would blur exactly the distinction the vocabulary exists to keep.
 */
export const ACKNOWLEDGEMENT_VERDICTS = ["corroborates", "no-genuine-need"] as const;
export type AcknowledgementVerdict = (typeof ACKNOWLEDGEMENT_VERDICTS)[number];

export function isAcknowledgementVerdict(v: unknown): v is AcknowledgementVerdict {
  return typeof v === "string" && (ACKNOWLEDGEMENT_VERDICTS as readonly string[]).includes(v);
}

/**
 * One disposition. The whole schema — there is not a second one, and the three kinds
 * differ only in what the `subject` string happens to name.
 */
export interface DispositionRecord {
  /** When it was written, from the injected clock — never `Date.now()` directly. */
  ts: string;
  /**
   * What it settles, written exactly as the bucket that lists it sees it: an evidence
   * `id` for the evidence face, a node title for the other two. Matched by string
   * equality, like every other identity in this codebase, so a subject that does not
   * match is a disposition that does nothing rather than one that hides the wrong item.
   */
  subject: string;
  /** Which surface the subject lives on. For the auditor; {@link isDisposed} ignores it. */
  kind: DispositionKind;
  state: DispositionState;
  /** Why, in the writer's words. Required: a dismissal with no stated reason is unauditable. */
  reason: string;
  /** Who wrote it. Required, for the same reason an ask is attributed. */
  by: string;
  /**
   * The typed verdict, when the entry is an acknowledgement of an evidence item.
   * Like `kind`, {@link isDisposed} never reads it — it decides nothing about whether
   * the subject leaves its bucket, only what the acknowledgement may do later.
   */
  verdict?: AcknowledgementVerdict;
  /**
   * The existing node the item was counted toward, exactly as titled. Present iff
   * `verdict` is `corroborates` — the pointer is what lets the corroboration
   * strengthen that node's evidence later.
   */
  node?: string;
}

export function dispositionLedgerPath(dir: string): string {
  return path.join(dir, ".ost-agent", "dispositions", "dispositions.jsonl");
}

/**
 * Append one disposition. Returns the record as written.
 *
 * Every field is checked here rather than at the CLI, because this is the funnel and a
 * rule enforced at one of two callers is not a rule. An unattributed or unexplained
 * dismissal is refused outright: the entire safeguard on a write that removes work by
 * assertion is that a human can read the assertion and see whose it was.
 *
 * `index` is the tree the acknowledgement is filed against — the same node set every
 * bucket reads. It is required rather than optional for the funnel's own reason: an
 * existence check a caller can decline to pass is not an existence check.
 */
export function appendDisposition(
  dir: string,
  rec: Omit<DispositionRecord, "ts">,
  index: ReadonlyMap<string, OstNode>,
  now: () => Date = () => new Date(),
): DispositionRecord {
  if (!rec.subject.trim()) throw new Error("a disposition needs the subject it settles");
  if (!isDispositionKind(rec.kind)) throw new Error(`kind must be one of: ${DISPOSITION_KINDS.join(", ")}`);
  if (!isDispositionState(rec.state)) throw new Error(`state must be one of: ${DISPOSITION_STATES.join(", ")}`);
  if (!rec.by.trim()) throw new Error("a disposition needs attribution — say who settled it");
  if (!rec.reason.trim()) throw new Error("a disposition needs a reason — this write removes work by asserting, and the assertion is the only thing anyone can audit");
  if (rec.verdict !== undefined && !isAcknowledgementVerdict(rec.verdict)) {
    throw new Error(`verdict must be one of: ${ACKNOWLEDGEMENT_VERDICTS.join(", ")}`);
  }
  if (rec.verdict === "corroborates" && !rec.node?.trim()) {
    throw new Error('a "corroborates" verdict needs the node the item was counted toward — the pointer is what lets it strengthen that node later');
  }
  if (rec.verdict !== "corroborates" && rec.node !== undefined) {
    throw new Error('only a "corroborates" verdict names a node — an item that counts toward a node corroborates it');
  }
  // Last, because it is the only check that needs the tree and the cheapest thing to
  // get wrong by hand: a title with a typo, a node renamed since the work list printed
  // it. Refused rather than stored, because the alternative is the surface telling the
  // operator their item was "counted toward" a node that is not there.
  if (rec.verdict === "corroborates" && !index.has(rec.node as string)) {
    const near = nearestName(rec.node as string, [...index.keys()]);
    throw new Error(
      `no node in this tree is titled "${rec.node}" — an acknowledgement filed under a node that is not there ` +
        "takes the item off the sweep and strengthens nothing" +
        (near ? `. Did you mean "${near}"?` : ""),
    );
  }
  const record: DispositionRecord = {
    ts: now().toISOString(),
    subject: rec.subject,
    kind: rec.kind,
    state: rec.state,
    reason: rec.reason,
    by: rec.by,
    // Spread rather than always-present keys, so an entry with no verdict writes the
    // same six fields every kind writes — the one-entry-type shape a test pins.
    ...(rec.verdict !== undefined ? { verdict: rec.verdict } : {}),
    ...(rec.verdict === "corroborates" ? { node: rec.node } : {}),
  };
  const file = dispositionLedgerPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + "\n");
  return record;
}

/**
 * The ledger as read: histories keyed by subject, plus the count of lines that would
 * not parse.
 *
 * A damaged line is dropped rather than thrown on — the same fail-open `readAskLedger`
 * makes, for the same reason: this file must not take `ost_next_work` down with it. The
 * direction of the failure is the safe one here too. A line that will not parse cannot
 * close anything, so a corrupted ledger surfaces *more* work, never less.
 */
export interface DispositionLedger {
  histories: ReadonlyMap<string, readonly DispositionRecord[]>;
  damaged: number;
}

function parseDisposition(raw: string): DispositionRecord | null {
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!rec || typeof rec !== "object") return null;
  if (typeof rec.ts !== "string" || !rec.ts) return null;
  if (typeof rec.subject !== "string" || !rec.subject.trim()) return null;
  // `kind` and `state` fail CLOSED, where the free-text fields fail open. A record whose
  // state is missing or hand-edited to something outside the vocabulary is not read as
  // `closed`: an unreadable field must never be the one that removes work.
  if (!isDispositionKind(rec.kind)) return null;
  if (!isDispositionState(rec.state)) return null;
  // The verdict fails CLOSED too, in both of its directions: a mangled verdict must
  // neither remove work (the whole line is damaged, so the subject stays on its
  // bucket) nor strengthen a node (a corroboration is a claim about the tree, and an
  // unreadable field must never be the one that makes it).
  if (rec.verdict !== undefined && !isAcknowledgementVerdict(rec.verdict)) return null;
  if (rec.verdict === "corroborates" && (typeof rec.node !== "string" || !rec.node.trim())) return null;
  if (rec.verdict !== "corroborates" && rec.node !== undefined) return null;
  return {
    ts: rec.ts,
    subject: rec.subject,
    kind: rec.kind,
    state: rec.state,
    reason: String(rec.reason ?? ""),
    by: String(rec.by ?? ""),
    ...(rec.verdict !== undefined ? { verdict: rec.verdict } : {}),
    ...(rec.verdict === "corroborates" ? { node: rec.node as string } : {}),
  };
}

export function readDispositionLedger(dir: string): DispositionLedger {
  const file = dispositionLedgerPath(dir);
  const histories = new Map<string, DispositionRecord[]>();
  let damaged = 0;
  if (!fs.existsSync(file)) return { histories, damaged };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = parseDisposition(line);
    if (!rec) {
      damaged += 1;
      continue;
    }
    const list = histories.get(rec.subject) ?? [];
    list.push(rec);
    histories.set(rec.subject, list);
  }
  return { histories, damaged };
}

/**
 * The standing disposition for one subject — the last entry written about it, or `null`
 * when the ledger has never named it.
 *
 * Read as a history and folded to its latest state, rather than last-record-wins over
 * the file: what an auditor needs is every entry, and what a bucket needs is only
 * whether the most recent one closed the subject.
 */
export function latestDisposition(ledger: DispositionLedger, subject: string): DispositionRecord | null {
  const list = ledger.histories.get(subject);
  if (!list || list.length === 0) return null;
  return list[list.length - 1];
}

/**
 * THE read. Every bucket asks this question and no bucket asks a different one.
 *
 * It takes a string and nothing else — no kind, no layer, no bucket name — which is the
 * whole claim the general form rests on: if this needed to know which face it was
 * looking at, the schema would be three schemas wearing one name and the two cheaper
 * per-bucket fixes would be the better buy.
 */
export function isDisposed(ledger: DispositionLedger, subject: string): boolean {
  return latestDisposition(ledger, subject)?.state === "closed";
}

/**
 * An acknowledgement whose node the tree no longer holds — the case the funnel check
 * cannot reach, and the reason the pointer is resolved twice.
 *
 * The funnel refuses a title that is missing at write time. It cannot refuse a node
 * being retitled, retired or removed *afterwards*, and this vault retitles nodes
 * routinely. An orphaned acknowledgement is exactly the shape rule 4 exists to refuse:
 * the item is off the sweep, the filing it was traded for is gone, and nothing on any
 * surface would ever say so. So it withholds nothing — the item comes back on its
 * bucket, which is the same fail-closed direction a damaged ledger line takes, and the
 * same "the fact changing IS the revival" a suppression takes.
 *
 * An entry with no verdict carries no pointer and is never orphaned; `no-genuine-need`
 * names no node by construction and is never orphaned either.
 */
export function isOrphanedAcknowledgement(rec: DispositionRecord, index: ReadonlyMap<string, OstNode>): boolean {
  return rec.verdict === "corroborates" && rec.node !== undefined && !index.has(rec.node);
}

/** One item a live disposition kept off a list, carried on the response that withheld it. */
export interface Withheld {
  /** The `NextWork` field it would otherwise have appeared on. */
  list: string;
  subject: string;
  kind: DispositionKind;
  reason: string;
  by: string;
  /** When the disposition was written. */
  at: string;
}

/**
 * Drop every item a live disposition covers, recording what was dropped.
 *
 * This is the shared call the buckets make: one function, one predicate, one accumulator
 * of what it hid. A bucket integrates it in a single line and gets both halves — the
 * filtering and the disclosure — so there is no version of "consulted the ledger" that
 * quietly skips the second half.
 */
export function omitDisposed<T>(
  items: readonly T[],
  subjectOf: (item: T) => string,
  ledger: DispositionLedger,
  index: ReadonlyMap<string, OstNode>,
  list: string,
  into: Withheld[],
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const subject = subjectOf(item);
    const standing = latestDisposition(ledger, subject);
    if (standing?.state === "closed" && !isOrphanedAcknowledgement(standing, index)) {
      into.push({ list, subject, kind: standing.kind, reason: standing.reason, by: standing.by, at: standing.ts });
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/**
 * Every live acknowledgement that counted an item toward `node` — the one read that
 * can strengthen a node's evidence later, and the reason the verdict is typed at all.
 *
 * Only `corroborates` entries whose standing state is `closed` qualify. A
 * `no-genuine-need` acknowledgement can never surface here for any node, an entry with
 * no verdict carries no claim about the tree, and a reopened corroboration was
 * disputed — the dispute wins until a new entry closes it again.
 */
export function corroborationsFor(ledger: DispositionLedger, node: string): DispositionRecord[] {
  const live: DispositionRecord[] = [];
  for (const [subject] of ledger.histories) {
    const standing = latestDisposition(ledger, subject);
    if (standing?.state === "closed" && standing.verdict === "corroborates" && standing.node === node) {
      live.push(standing);
    }
  }
  return live.sort((a, b) => a.ts.localeCompare(b.ts));
}

/** Every subject currently closed, oldest disposition first — the bulk-audit set. */
export function liveDispositions(ledger: DispositionLedger): DispositionRecord[] {
  const live: DispositionRecord[] = [];
  for (const [subject] of ledger.histories) {
    const standing = latestDisposition(ledger, subject);
    if (standing?.state === "closed") live.push(standing);
  }
  return live.sort((a, b) => a.ts.localeCompare(b.ts));
}

/**
 * The audit surface, in the form the risk actually demands: every live dismissal on one
 * screen, dated, attributed and reasoned, cheap to skim and cheap to reverse.
 *
 * Reversal is printed beside the list rather than left to be looked up. The cost of a
 * wrong disposition is work that never comes back, and the difference between that and a
 * recoverable mistake is whether the person reading the list knows the one command.
 *
 * Orphaned acknowledgements print in a block of their own rather than among the live
 * ones. They hide nothing, so counting them as "work no bucket is listing" would be a
 * lie in the other direction — but the operator who wrote one believes an item is filed
 * and it is not, and this screen is the only place that mismatch can surface.
 */
export function formatDispositions(ledger: DispositionLedger, index: ReadonlyMap<string, OstNode>): string {
  const standing = liveDispositions(ledger);
  const orphaned = standing.filter((d) => isOrphanedAcknowledgement(d, index));
  const live = standing.filter((d) => !isOrphanedAcknowledgement(d, index));
  const lines: string[] = [];
  if (live.length === 0) {
    lines.push("No live dispositions — every bucket is listing everything it derives.");
  } else {
    lines.push(`${live.length} live disposition(s) — each one is work no bucket is listing:\n`);
    for (const kind of DISPOSITION_KINDS) {
      const of = live.filter((d) => d.kind === kind);
      if (of.length === 0) continue;
      lines.push(`${kind} (${of.length}):`);
      for (const d of of) {
        // The verdict is the auditor's first sorting key — "counted toward a node" and
        // "nothing here" are different dismissals — so it prints beside the subject.
        const verdict =
          d.verdict === "corroborates" ? `  → corroborates [[${d.node}]]` : d.verdict === "no-genuine-need" ? "  → no genuine need" : "";
        lines.push(`  ${d.ts.slice(0, 10)}  ${d.subject}${verdict}`);
        lines.push(`      ${d.reason} — ${d.by}`);
      }
      lines.push("");
    }
    lines.push('Disagree with one? `ost-agent dispose "<subject>" --reopen --by <you> --why "<why>"` puts it back.');
  }
  if (orphaned.length) {
    lines.push(
      `\n${orphaned.length} acknowledgement(s) name a node this tree does not hold — retitled, retired or ` +
        "never there. Each one hides nothing (its item is back on the work list) and strengthens nothing. " +
        "Re-file each under a node that exists:",
    );
    for (const d of orphaned) {
      lines.push(`  ${d.ts.slice(0, 10)}  ${d.subject}  → corroborates [[${d.node}]] — no such node`);
      lines.push(`      ${d.reason} — ${d.by}`);
    }
  }
  if (ledger.damaged) {
    lines.push(
      `\n${ledger.damaged} ledger line(s) would not parse and were dropped. A dropped line closes nothing, ` +
        "so the effect is more work listed, never less — but the entries themselves are lost to the audit.",
    );
  }
  return lines.join("\n");
}
