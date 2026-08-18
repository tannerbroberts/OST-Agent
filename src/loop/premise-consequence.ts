/**
 * The consequence set — deriving every decision a stated premise implies before a
 * run begins, presenting the whole batch together, and telling a later question
 * apart from one the batch already covers.
 *
 * The opportunity this answers ("One migration stopped me seven times…") is not
 * that the operator was asked — several of the seven were real forks a silent run
 * would have shipped broken. It is that they were asked one at a time, with no view
 * of how many more were coming, in a session where the alternative was to derive
 * the whole set up front and answer it once. Questions 1 through 4 in that session
 * were consequences of a single shipping decision; 5 through 7 were consequences of
 * the route chosen in 4 — and that dependency link, not the batching alone, is what
 * the node calls load-bearing: seeing that #4 is why #5 through #7 exist is a
 * different act from meeting each one cold.
 *
 * OST-Agent does not call the model — Claude Code does — so this module cannot
 * derive the seven questions itself any more than `question-bank.ts` can decide
 * what a run would pick. What it owns is the shape a derivation is held to:
 *
 * - every item states what it depends on — nothing (the premise alone) or an
 *   earlier item's id — and {@link validateConsequenceSet} refuses a set where
 *   that link is missing or points forward, because a dependency on an item the
 *   operator has not read yet cannot have been seen by them either;
 * - {@link formatConsequenceBatch} presents every item together, in one read, with
 *   its default and — reading the dependency link in the other direction — which
 *   later items it unlocks, so the answer to "why does #5 exist" is on the same
 *   screen as #4;
 * - {@link classifyEncounter} tells a question the run meets mid-firing apart from
 *   one the batch already covers, reusing `question-bank.ts`'s own subject-overlap
 *   rule rather than a second copy of it, so the two modules cannot drift on what
 *   "about the same thing" means. A match proceeds on that item's stated default
 *   without stopping; no match is what still earns a stop — the node is explicit
 *   that some consequences (the duplicated refusal template, the severed ingestion
 *   in the session this was drawn from) only become visible after work is done,
 *   and no amount of up-front derivation reaches those.
 *
 * `test/loop/premise-consequence-set.test.ts` is a shape test, not a completeness
 * one: it does not and cannot certify that a derivation found 4 of the session's 7
 * questions. That comparison is the assumption test's, run by a human against a
 * blind derivation and recorded on its own node.
 */
import { subjectTokens } from "./question-bank.js";

/** One decision the premise implies. */
export interface ConsequenceItem {
  /** Stable within one set; used as the `#id` other items point at. */
  id: string;
  question: string;
  /** id of the item this follows from, or absent when it follows from the premise alone. */
  dependsOn?: string;
  /** The answer the run would take on its own if nobody stops it. */
  default: string;
}

/** The whole batch, derived once from one stated premise. */
export interface ConsequenceSet {
  premise: string;
  items: ConsequenceItem[];
}

export interface ConsequenceSetIssue {
  itemId: string;
  problem: string;
}

/**
 * Refuse a set whose dependency links do not hold: an id used twice, a
 * `dependsOn` naming an id not in the set, or one naming an item that does not
 * appear earlier than the item pointing at it. The last case is not cosmetic —
 * the whole argument for presenting the batch together is that the operator sees
 * #4 before meeting #5 through #7, and a forward or self-referencing link would
 * defeat that even though the batch still "renders".
 */
export function validateConsequenceSet(set: ConsequenceSet): ConsequenceSetIssue[] {
  const issues: ConsequenceSetIssue[] = [];
  const seenIds = new Set<string>();
  set.items.forEach((item, index) => {
    if (seenIds.has(item.id)) {
      issues.push({ itemId: item.id, problem: `duplicate id — an earlier item in the set already uses "${item.id}"` });
    }
    seenIds.add(item.id);

    if (item.dependsOn === undefined) return;
    const dependsOnIndex = set.items.findIndex((i) => i.id === item.dependsOn);
    if (dependsOnIndex === -1) {
      issues.push({ itemId: item.id, problem: `depends on "${item.dependsOn}", which is not in the set` });
      return;
    }
    if (dependsOnIndex >= index) {
      issues.push({
        itemId: item.id,
        problem:
          `depends on "${item.dependsOn}", which does not appear earlier in the set — dependency links only run ` +
          "backward, from a later item to one the operator has already read",
      });
    }
  });
  return issues;
}

/** The reverse of `dependsOn`: for each item, which later items it unlocks. */
function dependents(set: ConsequenceSet): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const item of set.items) {
    if (item.dependsOn === undefined) continue;
    const list = map.get(item.dependsOn) ?? [];
    list.push(item.id);
    map.set(item.dependsOn, list);
  }
  return map;
}

/**
 * Present the whole set as one read: premise, then every item with its
 * dependency, its default, and — directly under the item it depends on — which
 * later items that item unlocks. The operator answers once, seeing the shape of
 * the whole thing, rather than meeting each item as its own interruption.
 */
export function formatConsequenceBatch(set: ConsequenceSet): string {
  const unlocks = dependents(set);
  const lines: string[] = [];
  lines.push(`Premise: ${set.premise}`);
  lines.push("");
  lines.push(
    `The whole consequence set, derived from the premise before the run begins — ${set.items.length} item(s), answered once:`,
  );
  lines.push("");
  for (const item of set.items) {
    const on = item.dependsOn === undefined ? "the premise" : `#${item.dependsOn}`;
    lines.push(`${item.id}. ${item.question} — depends on: ${on} — default: ${item.default}`);
    const later = unlocks.get(item.id);
    if (later && later.length > 0) {
      lines.push(`   → #${later.join(", #")} depend${later.length === 1 ? "s" : ""} on this`);
    }
  }
  lines.push("");
  lines.push(
    "Answer once, in one sitting. The run then proceeds on these defaults without stopping again unless it meets something genuinely outside this set.",
  );
  return lines.join("\n");
}

export interface EncounterClassification {
  /** True when the encountered question restates one already in the set. */
  covered: boolean;
  /** id of the item it matched, when covered. */
  matchedId?: string;
  why: string;
}

/**
 * Tell a question the run meets mid-firing apart from one the derived set
 * already covers. Reuses `question-bank.ts`'s subject-overlap tokenizer rather
 * than a second copy of it: an item sharing a content term with the encountered
 * text is about the same thing, so the run proceeds on that item's stated
 * default instead of stopping again. No shared term with anything in the set is
 * the case the node concedes up-front derivation cannot reach — a genuinely
 * emergent question, and still a stop.
 */
export function classifyEncounter(set: ConsequenceSet, encountered: string): EncounterClassification {
  const encounteredTokens = subjectTokens(encountered);
  for (const item of set.items) {
    const shared = [...encounteredTokens].filter((t) => subjectTokens(item.question).has(t));
    if (shared.length > 0) {
      return {
        covered: true,
        matchedId: item.id,
        why: `matches #${item.id} on ${shared.slice(0, 4).join(", ")} — proceed on its default without stopping again`,
      };
    }
  }
  return {
    covered: false,
    why: "shares no subject term with any item in the derived set — outside what was covered, so the run stops",
  };
}
