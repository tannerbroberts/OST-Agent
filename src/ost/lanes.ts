/**
 * Lane triage over a tree — reading, reporting, and classifying assumption tests
 * by the human minutes they actually cost.
 *
 * The vocabulary and its fail-closed rule live in `knowledge/lanes.ts`. This is
 * the part that touches the tree: which tests sit in which lane, which of them a
 * pass may run itself, and the attributed, append-only way a lane gets set.
 */
import fs from "node:fs";
import path from "node:path";
import { CAUTIOUS_LANE, computeMayRun, isLane, LANES, type LaneId } from "../knowledge/lanes.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

export interface LaneTriage {
  /** Test titles per lane, in tree order. */
  byLane: Record<LaneId, string[]>;
  /** Tests carrying no lane at all — the triage backlog. */
  unlabelled: string[];
  totals: { tests: number; labelled: number; unlabelled: number };
  /** compute-only tests with no result yet: what a pass may go run right now. */
  runnable: string[];
}

function assumptionTests(tree: readonly OstNode[]): OstNode[] {
  return tree.filter((n) => n.layer === "AssumptionTest");
}

/**
 * Tests an unattended pass is permitted to run itself: labelled `compute-only`
 * and not already carrying a result. Everything else — including every
 * unlabelled test — is excluded, by {@link computeMayRun}'s fail-closed rule.
 */
export function runnableByCompute(tree: readonly OstNode[]): OstNode[] {
  return assumptionTests(tree).filter((t) => computeMayRun(t.lane) && !hasRecordedResult(t));
}

/** Group the tree's assumption tests by lane. */
export function triageLanes(tree: readonly OstNode[]): LaneTriage {
  const tests = assumptionTests(tree);
  const byLane = Object.fromEntries(LANES.map((l) => [l.id, [] as string[]])) as Record<LaneId, string[]>;
  const unlabelled: string[] = [];

  for (const t of tests) {
    if (t.lane && isLane(t.lane)) byLane[t.lane].push(t.title);
    else unlabelled.push(t.title);
  }

  return {
    byLane,
    unlabelled,
    totals: { tests: tests.length, labelled: tests.length - unlabelled.length, unlabelled: unlabelled.length },
    runnable: runnableByCompute(tree).map((t) => t.title),
  };
}

/**
 * Phrases that mean a person outside the building is part of the measurement.
 * Deliberately narrow and literal: this list exists to raise a hand, and every
 * hit is quoted back in the reason so the call can be checked in one glance.
 */
const PEOPLE_MARKERS: readonly RegExp[] = [
  /\binterviews?\b/i,
  /\binterviewing\b/i,
  /\brecruit(?:ing|ment)?\b/i,
  /\bstrangers?\b/i,
  /\bparticipants?\b/i,
  /\bcohort\b/i,
  /\bsurvey(?:s|ed)?\b/i,
  /\bpre-order\b/i,
  /\bwillingness to pay\b/i,
  /\bconsent\b/i,
  /\busability\b/i,
  /\bdesign partners?\b/i,
  /\breal (?:players?|users?|operators?|teams?|customers?)\b/i,
  /\boutside (?:teams?|operators?|people)\b/i,
];

export interface LaneSuggestion {
  lane: LaneId;
  /** Why, quoting the phrase that triggered it, so a human can check the call. */
  why: string;
}

/**
 * A mechanical triage aid that can only ever point at {@link CAUTIOUS_LANE}.
 *
 * It never returns a lane compute is allowed to run, and its silence means
 * "no marker found" — never "safe to automate". Both halves matter: a helper
 * that could talk a pass into running a test would defeat the point of having
 * lanes at all, so the permissive call is left to a person by construction.
 */
export function suggestCaution(test: OstNode): LaneSuggestion | undefined {
  if (test.layer !== "AssumptionTest") return undefined;
  const haystack = `${test.title}\n${test.body ?? ""}`;
  for (const marker of PEOPLE_MARKERS) {
    const hit = haystack.match(marker);
    if (hit) {
      return {
        lane: CAUTIOUS_LANE,
        why: `names an outside person: "${hit[0]}"`,
      };
    }
  }
  return undefined;
}

export interface LaneFiling {
  /** Title of the AssumptionTest being classified. */
  test: string;
  lane: LaneId;
  /** Who made the call — an unattributed label cannot be audited. */
  by: string;
  /** Why this lane, in the classifier's words. */
  why: string;
}

/**
 * Classify a test into a lane, recording the call in History. Attribution and a
 * reason are both required: the lane decides whether an unattended agent may run
 * the test, so a label nobody can trace back is worse than no label at all.
 */
export function setLane(vaultDir: string, filing: LaneFiling): string {
  if (!isLane(filing.lane)) {
    throw new Error(`"${filing.lane}" is not a lane — use one of: ${LANES.map((l) => l.id).join(", ")}`);
  }
  const by = (filing.by ?? "").trim();
  if (!by) {
    throw new Error("a lane classification needs attribution — say who made the call");
  }
  const why = (filing.why ?? "").trim();
  if (!why) {
    throw new Error("a lane classification needs a why — an unauditable label is worse than no label");
  }

  const vault = new Vault(path.resolve(vaultDir));
  const node = vault.read(filing.test);
  if (node.layer !== "AssumptionTest") {
    throw new Error(`"${filing.test}" is a ${node.layer} — lanes classify an AssumptionTest`);
  }

  return vault.setLane(filing.test, filing.lane, `by ${by} — ${why}`);
}

/** True when the directory looks like a vault (used for friendlier CLI errors). */
export function isVaultDir(dir: string): boolean {
  return fs.existsSync(path.join(path.resolve(dir), "ost.config.yaml"));
}
