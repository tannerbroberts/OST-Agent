/**
 * The spend ceiling — what a firing is allowed to have cost lately.
 *
 * **No default grant.** An undeclared ceiling means the loop refuses to fire.
 * The alternative is a number this project picked for somebody else's account,
 * and the whole point of an unattended loop is that nobody is watching the bill.
 *
 * **Measured, not asserted.** OST-Agent never calls the model — Claude Code
 * does — so the tool tracer cannot see a token. The spend is read out of Claude
 * Code's session JSONL (`src/adapters/tokens.ts`), per usage record, weighted by
 * the same published ratios `eval/attention.ts` uses. Nothing the agent writes
 * is an input: it cannot reach the transcripts, and it cannot reach the config
 * the ceiling is declared in (`nodePath` refuses any path containing a
 * separator, `src/ost/vault.ts:103-110`).
 *
 * **The ceiling is resolved once, before the firing, and never re-read.** That
 * is `web.lookupBudget`'s shape (`src/security/tools.ts:161-167`), and for the
 * same reason: a budget re-read from a file mid-run is a budget its spender can
 * widen.
 *
 * **Why a rolling window rather than a lifetime pool.** A lifetime pool that
 * runs out is a permanent red whose only exit is a human editing YAML — R2's
 * shape, on the mechanism most likely to be switched off when it triggers at
 * 3am. A window bounds the *rate*, which is the bound "forever means bounded"
 * actually needs, and it clears itself: the vault fires again as soon as the
 * expensive firings age out. Raising the ceiling is still a human's call and
 * still available; it is no longer the only way out.
 */
import fs from "node:fs";
import path from "node:path";
import { readSessionUsage, sessionCwd } from "../adapters/tokens.js";
import { weightedTokenCost } from "../eval/attention.js";
import { addTiers, emptyTiers, type TokenTiers } from "../telemetry/attention.js";

export interface SpendCeiling {
  /** Weighted tokens (ratios, not currency — see DEFAULT_WEIGHTED_TOKEN_SPEND). */
  weightedTokens: number;
  windowHours: number;
  /** Directory of Claude Code session transcripts. Declared, never derived. */
  sessionsDir: string;
}

export type SpendMeasurement =
  | { measurable: true; weighted: number; tiers: TokenTiers; sessions: number; entries: number }
  | { measurable: false; reason: string };

/**
 * Weighted spend attributable to this vault inside the window.
 *
 * `sessionsDir` is a parameter, never a derivation: nothing here may reach
 * `os.homedir()`, or a test would measure the developer's own account.
 *
 * A usage record carrying no timestamp is counted rather than dropped. It
 * cannot be placed in the window, and for a ceiling the cautious direction is
 * to charge for spend you cannot rule out.
 */
/**
 * A path in the form a comparison can trust. The transcript records the cwd the
 * session was launched from and the caller passes whatever was on the command
 * line; on macOS one of those is routinely `/var/folders/…` and the other
 * `/private/var/folders/…`. A textual mismatch here reads as "this vault has
 * spent nothing", which is a silent grant of the entire ceiling.
 */
function canonical(p: string): string {
  try {
    return fs.realpathSync(path.resolve(p));
  } catch {
    return path.resolve(p);
  }
}

export function measureFiring(
  sessionsDir: string,
  opts: { vaultDir: string; sinceMs: number },
): SpendMeasurement {
  const dir = path.resolve(sessionsDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    // Fail closed. An unreadable transcript directory is an unbounded pool, and
    // the honest answer to "how much has this spent" is not zero. The way out is
    // the path, not a file anyone has to hand-edit: create it, or point
    // `loop.spend.sessionsDir` at the directory Claude Code is really writing.
    return {
      measurable: false,
      reason: `cannot read session transcripts at ${dir} (${(e as NodeJS.ErrnoException).code ?? "unreadable"}) — spend is unmeasurable, so the loop refuses to fire`,
    };
  }

  const vault = canonical(opts.vaultDir);
  let tiers = emptyTiers();
  let sessions = 0;
  let entries = 0;
  for (const name of names.sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const file = path.join(dir, name);
    const cwd = sessionCwd(file);
    if (cwd === undefined || canonical(cwd) !== vault) continue;
    sessions += 1;
    for (const entry of readSessionUsage(file)) {
      const at = entry.ts ? Date.parse(entry.ts) : NaN;
      if (Number.isFinite(at) && at < opts.sinceMs) continue;
      tiers = addTiers(tiers, entry.tiers);
      entries += 1;
    }
  }
  return { measurable: true, weighted: weightedTokenCost(tiers), tiers, sessions, entries };
}

export interface CeilingVerdict {
  /** May the firing proceed on spend grounds? */
  ok: boolean;
  /** Which refusal, so a caller can give each its own exit code. */
  kind: "ok" | "undeclared" | "unmeasurable" | "exhausted";
  reason: string;
  spent?: number;
}

/**
 * Compare measured spend against the declared ceiling.
 *
 * An undeclared ceiling and an unmeasurable pool both refuse, and they are
 * reported apart — they are different mistakes with different fixes.
 */
export function checkCeiling(ceiling: SpendCeiling | null, measurement?: SpendMeasurement): CeilingVerdict {
  if (ceiling === null) {
    return {
      ok: false,
      kind: "undeclared",
      reason:
        "no `loop.spend` in ost.config.yaml — an unattended loop spends real money, and this tool will not pick a ceiling on your behalf",
    };
  }
  if (!measurement) return { ok: false, kind: "unmeasurable", reason: "spend was never measured" };
  if (!measurement.measurable) return { ok: false, kind: "unmeasurable", reason: measurement.reason };
  if (measurement.weighted >= ceiling.weightedTokens) {
    return {
      ok: false,
      kind: "exhausted",
      spent: measurement.weighted,
      reason:
        `spent ${Math.round(measurement.weighted).toLocaleString()} weighted tokens in the last ${ceiling.windowHours}h, ` +
        `at or over the ${ceiling.weightedTokens.toLocaleString()} ceiling — firing resumes as the window rolls forward`,
    };
  }
  return {
    ok: true,
    kind: "ok",
    spent: measurement.weighted,
    reason: `spent ${Math.round(measurement.weighted).toLocaleString()} of ${ceiling.weightedTokens.toLocaleString()} weighted tokens in the last ${ceiling.windowHours}h`,
  };
}
