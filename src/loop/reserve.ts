/**
 * The discovery reserve — passes build work is not allowed to spend.
 *
 * Two loops draw on one pool. `examples/automation/autonomous-pass.sh` fires the
 * discovery pass and `examples/automation/build-pass.sh` fires the build pass;
 * both launch Claude Code with the vault as cwd, so both write their transcripts
 * into the directory `loop.spend.sessionsDir` names and both are charged against
 * the same window by `measureFiring` (`spend.ts`). Only one of them asks. `loop
 * due` is the discovery loop's gate and the build loop deliberately does not call
 * it (its own comment says so, and `test/release/build-pass-surface.test.ts`
 * pins it), so **build spends the shared pool without ever being asked whether
 * anything was left for discovery.** That is not a hypothetical: this vault's
 * `ost.config.yaml` records a ceiling raised eightfold on 2026-08-04 after
 * discovery went 21 hours without firing, and the firing that ended the gap put
 * the window back over the line within 20 minutes.
 *
 * So the reserve is a floor for discovery, expressed in passes rather than in
 * tokens. Passes, because a token ceiling is already declared and is the wrong
 * instrument for this: it bounds the *rate of the pair*, and the failure here is
 * a *split within* that rate. A pool that is 90% consumed refuses both loops
 * equally, which is exactly the moment discovery most needs its share.
 *
 * ## What "reserved" has to mean, and the way it is usually got wrong
 *
 * The obvious implementation computes build's allowance as "the budget, minus
 * what discovery actually used". That hands build the whole reserve the moment
 * discovery is idle — which is the borrow this exists to refuse, wearing the name
 * of the protection. A reserve is not protected if it is available to the other
 * claimant whenever its owner has not spent it yet.
 *
 * So the allowance is computed from the DECLARATION, never from consumption:
 *
 *     buildAllowance = totalPasses − discoveryPasses
 *
 * and it is the same number whether discovery has used three of its reserved
 * passes this window or none. An unused discovery pass is lost when the window
 * rolls forward; it is never banked into a larger build allowance, this window or
 * the next. That is the property {@link assessReserve} exists to hold and the one
 * `test/loop/discovery-budget-reserved.test.ts` is written against.
 *
 * ## What this gate refuses, and what it never refuses
 *
 * It refuses **build** passes, and only build passes. Discovery is never refused
 * by the mechanism that exists to protect it — a reserve that could stop a
 * discovery pass would be a second spend ceiling wearing the first one's name,
 * and the ceiling in `spend.ts` is what bounds the pair. What discovery gets from
 * this module is a count, printed.
 *
 * ## No default, and no refusal for the want of one
 *
 * An absent `loop.reserve` block means nothing is held, which is today's
 * behaviour, and the gate says so rather than inventing a share. This departs
 * from `loop.spend`, where an undeclared ceiling refuses to fire, and follows
 * `loop.questions`, where an undeclared budget prints UNBOUNDED — for the reason
 * that separates them. An undeclared ceiling risks the operator's money; an
 * undeclared reserve risks nothing that is not already being risked, while
 * refusing every build pass on a vault that predates the key would be a stopping
 * state whose only way out is a human editing YAML.
 *
 * ## Where the two counts come from
 *
 * Discovery passes are read off `runs.jsonl` — the ledger `loop start` already
 * writes, one record per firing — so this module adds no second writer to the
 * discovery loop and cannot disagree with it. Build passes have no such ledger,
 * because the build loop keeps its state outside the vault entirely, so this
 * module keeps one: `.git/ost-agent/build-passes.jsonl`, appended by
 * `loop reserve --kind build --claim` at the moment a build pass is about to
 * spend a model call.
 *
 * That path is inside the vault and NOT in its working tree, which is the
 * distinction the build loop's "keep state outside the vault" rule is really
 * about: git refuses to track anything under `.git/`, so a record written here
 * cannot be swept into the next `git add -A` commit and cannot wedge the
 * discovery loop's dirty-tree gate (`state.ts` makes the same argument for
 * `runs.jsonl` and `firing.lock`). It has to be a shared location — a ledger
 * under `$OST_BUILD_STATE` would be accounting the vault could not read, and a
 * reserve nobody can count is not one.
 *
 * **The honest limit, since this module is a decider.** The build surface holds
 * `Bash` and `Write`, so a build pass *can* reach this ledger; nothing here is
 * proof against a builder that edits its own budget. What the ledger is proof
 * against is the surface the discovery loop runs on, which holds no shell and no
 * tool that can write outside the vault's working tree — see part 2 of
 * `test/release/gate-f-deciders.test.ts`, which snapshots this file byte for byte
 * against every mutating MCP tool.
 */
import fs from "node:fs";
import path from "node:path";
import { loopStateDir, requireLoopStateDir } from "./state.js";

/** Filename of the build-pass ledger inside the loop's state directory. */
export const BUILD_PASSES_FILENAME = "build-passes.jsonl";

/** Which loop is asking. The two are counted apart and treated apart. */
export type PassKind = "discovery" | "build";

export interface DiscoveryReserve {
  /** Passes held for discovery inside the window, unspendable by build. */
  discoveryPasses: number;
  /** Passes of either kind the window allows in total. */
  totalPasses: number;
  /** The rolling window both counts are taken over. */
  windowHours: number;
}

/** One build pass that consumed the pool. Stamped by the loop, never by the pass. */
export interface BuildPassRecord {
  at: string;
}

/** Where the build-pass ledger lives, or null when this vault has nowhere to record. */
export function buildPassesPath(vaultDir: string): string | null {
  const dir = loopStateDir(vaultDir);
  return dir === null ? null : path.join(dir, BUILD_PASSES_FILENAME);
}

/**
 * The build passes on record, oldest first.
 *
 * A malformed or unstamped line is dropped rather than repaired: a record that
 * cannot be placed in the window cannot be counted against it, and inventing a
 * timestamp for one would be charging the budget for a firing nobody can date.
 * An absent ledger is zero build passes, which is what a vault that has never
 * built means.
 */
export function readBuildPasses(vaultDir: string): BuildPassRecord[] {
  const p = buildPassesPath(vaultDir);
  if (p === null || !fs.existsSync(p)) return [];
  const records: BuildPassRecord[] = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as BuildPassRecord;
      if (typeof parsed?.at !== "string" || !Number.isFinite(Date.parse(parsed.at))) continue;
      records.push({ at: parsed.at });
    } catch {
      continue;
    }
  }
  return records;
}

/**
 * Charge one build pass to the window.
 *
 * Unguarded, for `health.ts`'s reason: this record IS the decider, and a build
 * pass that silently failed to record would leave the window unconsumed and the
 * reserve spendable forever. A throw here refuses the pass instead.
 */
export function recordBuildPass(vaultDir: string, at: string): void {
  const dir = requireLoopStateDir(vaultDir);
  fs.appendFileSync(path.join(dir, BUILD_PASSES_FILENAME), JSON.stringify({ at }) + "\n");
}

export interface ReserveVerdict {
  /** May a pass of this kind consume the pool? */
  ok: boolean;
  /** `undeclared` is permitted-but-unprotected, and must not read as `ok`. */
  kind: "ok" | "undeclared" | "held";
  /** One line, in the operator's terms, for whichever surface prints it. */
  reason: string;
  /** Discovery firings inside the window. */
  discoveryUsed?: number;
  /** Build passes inside the window. */
  buildUsed?: number;
  /** What build may consume in a window — `totalPasses − discoveryPasses`, always. */
  buildAllowance?: number;
  /** Records stamped after `now`, ignored for the window and reported here. */
  ignoredFuture: number;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Stamps that fall inside the window, with the ones that could not have happened
 * yet counted separately.
 *
 * A future-stamped record is ignored rather than clamped, which is `cadence.ts`'s
 * rule and matters more here: a single build record stamped a year out would sit
 * inside every window until the clock caught up, holding build off permanently
 * with no way out but hand-editing a JSONL file. The anomaly travels with the
 * verdict instead, so the operator sees the clock problem rather than inheriting
 * its consequences.
 */
function inWindow(stamps: readonly string[], now: number, sinceMs: number): { count: number; ignoredFuture: number } {
  let count = 0;
  let ignoredFuture = 0;
  for (const s of stamps) {
    const at = Date.parse(s);
    if (!Number.isFinite(at)) continue;
    if (at > now) {
      ignoredFuture += 1;
      continue;
    }
    if (at >= sinceMs) count += 1;
  }
  return { count, ignoredFuture };
}

/**
 * May a pass of this kind consume the pool?
 *
 * Deterministic and read-only: it takes the two ledgers' stamps, the declared
 * reserve and the current time. The caller opens the files — `runs.jsonl` is
 * `health.ts`'s to read and the build ledger is {@link readBuildPasses}'s — for
 * the same reason `evaluateCadence` takes the runs it judges.
 */
export function assessReserve(input: {
  reserve: DiscoveryReserve | null;
  kind: PassKind;
  /** `startedAt` of every discovery firing on record. */
  discoveryAt: readonly string[];
  /** `at` of every build pass on record. */
  buildAt: readonly string[];
  now: number;
}): ReserveVerdict {
  const { reserve, kind, discoveryAt, buildAt, now } = input;

  if (reserve === null) {
    return {
      ok: true,
      kind: "undeclared",
      reason:
        "no `loop.reserve` in ost.config.yaml — no passes are held for discovery, so build work may spend the " +
        "whole window. This does not refuse a pass; it reports that nothing is protected.",
      ignoredFuture: 0,
    };
  }

  const sinceMs = now - reserve.windowHours * HOUR_MS;
  const discovery = inWindow(discoveryAt, now, sinceMs);
  const build = inWindow(buildAt, now, sinceMs);
  const ignoredFuture = discovery.ignoredFuture + build.ignoredFuture;

  // From the declaration, never from `discovery.count`. See this module's header:
  // subtracting what discovery has actually used is the implementation that hands
  // build the reserve the moment discovery is idle.
  const buildAllowance = Math.max(0, reserve.totalPasses - reserve.discoveryPasses);
  const common = {
    discoveryUsed: discovery.count,
    buildUsed: build.count,
    buildAllowance,
    ignoredFuture,
  };

  if (kind === "discovery") {
    return {
      ok: true,
      kind: "ok",
      reason:
        `discovery has used ${discovery.count} pass(es) in the last ${reserve.windowHours}h, with ` +
        `${reserve.discoveryPasses} of the window's ${reserve.totalPasses} held for it — unused ones are lost ` +
        "when the window rolls forward, never banked",
      ...common,
    };
  }

  if (build.count >= buildAllowance) {
    return {
      ok: false,
      kind: "held",
      reason:
        `build has used ${build.count} of the ${buildAllowance} pass(es) it may spend in ${reserve.windowHours}h — ` +
        `the remaining ${reserve.discoveryPasses} in this window are held for discovery and cannot be borrowed, ` +
        `whether or not discovery has spent them (it has used ${discovery.count}). Building resumes as the window ` +
        "rolls forward.",
      ...common,
    };
  }

  return {
    ok: true,
    kind: "ok",
    reason:
      `build has used ${build.count} of ${buildAllowance} pass(es) in the last ${reserve.windowHours}h, with ` +
      `${reserve.discoveryPasses} held for discovery`,
    ...common,
  };
}
