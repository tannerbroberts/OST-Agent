/**
 * Which check ruleset a vault is held to — declared by the operator, read by
 * every gate, and moved only when they say so.
 *
 * **The act this makes explicit.** A tightening lands on `main` and every tree
 * in the world is out of compliance the moment it pulls. The operator did not
 * choose the timing, cannot see what the move cost them until the gate is
 * already red, and has no way to take the change on a Tuesday instead. Here they
 * pin a version, `checkInvariants` evaluates against it, and adopting a newer
 * one is a command that first shows exactly what would newly fail.
 *
 * **An undeclared vault is held to the LATEST ruleset, and that is a decision.**
 * The obvious alternative — grandfather anything unstamped to whatever it was
 * probably written under — would silently loosen the gate for every vault that
 * has never run this command, which is all of them today. A loosening nobody
 * asked for is the failure mode this product refuses in every other place it
 * appears, so the default fails toward the standard and {@link
 * resolveDeclaredRuleset} says out loud that it is a default and names the
 * command that pins it.
 *
 * **What this does NOT settle.** Whether being grandfathered is what an operator
 * wants. A vault can sit on an old ruleset indefinitely, and two vaults
 * reporting a clean `check` are then not held to the same standard — the version
 * line in the report is what stops that being invisible, not what stops it being
 * true.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CHECK_RULESET_VERSIONS,
  LATEST_CHECK_RULESET,
  checkRulesetOrdinal,
  checkRulesetVersion,
  rulesLiveIn,
  versionCost,
} from "../knowledge/check-ruleset.js";
import { checkInvariants, type Violation } from "../eval/invariants.js";
import type { OstNode } from "./node.js";
import type { QuarantinedNode } from "./quarantine.js";

/** Where the declaration lives, relative to the vault root. */
export const DECLARED_RULESET_PATH = ".ost-agent/state/ruleset-version.json";

/** One adoption, as recorded. */
export interface RulesetAdoption {
  version: string;
  /** ISO timestamp. */
  at: string;
  /** Who adopted it. An unattributed adoption cannot be told apart from a fabricated one. */
  by: string;
}

/** The declaration file's shape. `history` only ever grows. */
export interface DeclaredRulesetState {
  current: RulesetAdoption;
  /** Every adoption, oldest first, including `current`. */
  history: RulesetAdoption[];
}

/** What the vault is actually held to, and why. */
export interface RulesetResolution {
  version: string;
  /** `declared` when the operator pinned it; `default` when nothing here says. */
  source: "declared" | "default";
  /** The sentence a report prints. Always set — a default says it is one. */
  reason: string;
  /** How many recorded versions sit between this one and the latest. */
  behind: number;
  /** Set when a stored declaration named a version nothing recognises. */
  unrecognised?: string;
}

/** Absolute path of the declaration in `dir`. */
export function declaredRulesetPath(dir: string): string {
  return path.join(dir, DECLARED_RULESET_PATH);
}

/** The declaration as stored, or null when this vault has never declared one. */
export function readDeclaredRuleset(dir: string): DeclaredRulesetState | null {
  const file = declaredRulesetPath(dir);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as DeclaredRulesetState;
    if (!parsed?.current?.version || !Array.isArray(parsed.history)) return null;
    return parsed;
  } catch {
    // An unreadable declaration is not a declaration. Saying nothing here means
    // the caller falls back to the latest, which is the direction that does not
    // quietly stop checking things.
    return null;
  }
}

/**
 * The version this vault's checks run against.
 *
 * Never throws and never returns an id `rulesLiveIn` cannot replay: a stored
 * version nothing recognises is reported on `unrecognised` and the resolution
 * falls to the latest, because a declaration that resolved to nothing would be a
 * way to check nothing.
 */
export function resolveDeclaredRuleset(dir: string): RulesetResolution {
  const stored = readDeclaredRuleset(dir);
  const latestAt = CHECK_RULESET_VERSIONS.length - 1;

  if (!stored) {
    return {
      version: LATEST_CHECK_RULESET,
      source: "default",
      behind: 0,
      reason:
        `no declared ruleset version, so this tree is held to the latest (${LATEST_CHECK_RULESET}) — ` +
        `pin the one it was built under with \`ost-agent ruleset-version --adopt <id> -b "<you>"\``,
    };
  }

  const at = checkRulesetOrdinal(stored.current.version);
  if (at === -1) {
    return {
      version: LATEST_CHECK_RULESET,
      source: "default",
      behind: 0,
      unrecognised: stored.current.version,
      reason:
        `the declared ruleset version "${stored.current.version}" is not one this build records, so this tree is ` +
        `held to the latest (${LATEST_CHECK_RULESET}) — a declaration nothing can resolve must not be a way to check nothing`,
    };
  }

  const behind = latestAt - at;
  return {
    version: stored.current.version,
    source: "declared",
    behind,
    reason:
      behind === 0
        ? `ruleset ${stored.current.version}, adopted by ${stored.current.by} on ${stored.current.at.slice(0, 10)} — the latest`
        : `ruleset ${stored.current.version}, adopted by ${stored.current.by} on ${stored.current.at.slice(0, 10)} — ` +
          `${behind} tightening(s) behind ${LATEST_CHECK_RULESET}, and this tree is not held to them`,
  };
}

/** Record an adoption. The caller is responsible for having shown its cost first. */
export function declareRuleset(dir: string, opts: { version: string; by: string; now: string }): DeclaredRulesetState {
  const who = opts.by.trim();
  if (who.length === 0) {
    throw new Error("an adoption needs a name on it: who is taking this tightening?");
  }
  if (!checkRulesetVersion(opts.version)) {
    throw new Error(
      `"${opts.version}" is not a ruleset version this build records — available: ` +
        CHECK_RULESET_VERSIONS.map((v) => v.id).join(", "),
    );
  }

  const stored = readDeclaredRuleset(dir);
  const adoption: RulesetAdoption = { version: opts.version, at: opts.now, by: who };
  const state: DeclaredRulesetState = stored
    ? { current: adoption, history: [...stored.history, adoption] }
    : { current: adoption, history: [adoption] };

  const file = declaredRulesetPath(dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
  return state;
}

/** What moving from one version to another would do to this tree's `check`. */
export interface AdoptionPreview {
  from: string;
  to: string;
  /** Violations that fail under `to` and did not under `from` — the work adoption asks for. */
  newlyFailing: Violation[];
  /** Violations that fail under `from` and would stop under `to`. A tightening usually has none; a removal has some. */
  noLongerFailing: Violation[];
  /** Rules that come into force across the move. */
  rulesAdded: string[];
  /** Rules that stop applying across the move. */
  rulesRemoved: string[];
  /** The versions crossed, in order, so the operator reads what each one was for. */
  crossing: { id: string; summary: string }[];
}

/**
 * Exactly what newly fails if this tree adopts `to`.
 *
 * Computed by running the real checker twice rather than by reasoning about the
 * lineage, so the preview cannot disagree with the gate it is predicting. That
 * is the whole affordance the solution turns on: adoption is a decision made
 * against a list, not against a version number.
 */
export function previewAdoption(
  tree: OstNode[],
  quarantined: readonly QuarantinedNode[],
  from: string,
  to: string,
): AdoptionPreview {
  const before = checkInvariants(tree, quarantined, { ruleset: from });
  const after = checkInvariants(tree, quarantined, { ruleset: to });
  const key = (v: Violation): string => `${v.rule} ${v.node ?? ""} ${v.detail}`;
  const seenBefore = new Set(before.map(key));
  const seenAfter = new Set(after.map(key));

  const liveBefore = rulesLiveIn(from);
  const liveAfter = rulesLiveIn(to);
  const lo = Math.min(checkRulesetOrdinal(from), checkRulesetOrdinal(to));
  const hi = Math.max(checkRulesetOrdinal(from), checkRulesetOrdinal(to));

  return {
    from,
    to,
    newlyFailing: after.filter((v) => !seenBefore.has(key(v))),
    noLongerFailing: before.filter((v) => !seenAfter.has(key(v))),
    rulesAdded: [...liveAfter].filter((r) => !liveBefore.has(r)).sort(),
    rulesRemoved: [...liveBefore].filter((r) => !liveAfter.has(r)).sort(),
    crossing: CHECK_RULESET_VERSIONS.slice(lo + 1, hi + 1).map((v) => ({ id: v.id, summary: v.summary })),
  };
}

/** The resolution as a line, plus what adoption would cost when the tree is behind. */
export function formatDeclaredRuleset(resolution: RulesetResolution): string {
  const lines = [`check ruleset: ${resolution.reason}`];
  if (resolution.behind > 0) {
    const cost = versionCost([resolution.version, LATEST_CHECK_RULESET]);
    lines.push(
      `  holding both live costs ${cost.conditionals} conditional(s) in the checking code ` +
        `(${cost.rulesGatedByLineage.length} rule(s) gated by lineage, ${cost.rulesChanged.length} changed in place).`,
    );
    lines.push(`  \`ost-agent ruleset-version --preview\` lists exactly what would newly fail here.`);
  }
  return lines.join("\n");
}
