/**
 * Token correlation — dividing one session's spend across the unknowns it touched.
 *
 * Since the API-key runner was deleted, OST-Agent never calls the model; Claude
 * Code does. So the two traces that matter are written by two different
 * processes into two different files, and nothing links them. The usage log says
 * WHICH unknown a tool call was spent on and exactly when (`ts` start, `ms`
 * duration). The session transcript says HOW MANY tokens were spent and exactly
 * when. The only join available is the clock, and this module is that join.
 *
 * The honest part is what it refuses to do. A tool call's window covers the
 * sliver in which the tool executed; the great majority of a session's tokens
 * are spent BETWEEN those windows — thinking, reading, and the assistant turn
 * that emits the call itself. Interval overlap therefore leaves a majority
 * residual, and `residual: unattributed` keeps it visible instead of smearing
 * it over whichever unknown happened to be nearby. That number is not noise to
 * be tuned away: unattributed share is a reported fitness metric, and a variant
 * that cannot say what it spent attention on is measurably worse. How the
 * residual is treated is an allele (`tokenSplit.residual`), so a harness can
 * measure whether smearing it beats admitting it — but the default admits it.
 *
 * Two timing facts govern the read. First, the usage log is appended AFTER the
 * call returns while `ts` records when it started, so the file is in finish
 * order and its timestamps are starts; nothing here may assume file order.
 * Second, a transcript is only consumed once it has been quiet for half an
 * hour, exactly as the friction adapter requires, so a still-writing session is
 * never half-read. The consequence is structural and not a defect to fix: the
 * pass that spends the tokens can never see its own cost. Attribution is
 * retroactive by construction.
 *
 * The cursor is this module's own, under `.ost-agent/state/`. It deliberately
 * does not share `TranscriptSource`'s, whose seen-id set is marked BEFORE its
 * zero-friction skip — sharing it would silently lose exactly the sessions with
 * the most tokens and the least friction. Consumption is also checked against
 * the attention ledger itself, because that ledger is append-only and a second
 * run over the same transcript would otherwise double-count.
 *
 * Everything here is fail-open, like every other reader of a file no OST-Agent
 * process wrote: a missing directory, an unreadable transcript or a malformed
 * usage object degrades to an empty result. This runs inside `ost_status`; a
 * correlator that throws takes the status tool down with it.
 */
import fs from "node:fs";
import path from "node:path";
import { loadCursor, saveCursor } from "../adapters/source.js";
import { readSessionUsage, sessionCwd } from "../adapters/tokens.js";
import { defaultTranscriptDir } from "../adapters/transcript.js";
import type { Genome } from "../genome/schema.js";
import type { OstNode } from "../ost/node.js";
import { addTiers, emptyTiers, readAttention, type TokenTiers } from "../telemetry/attention.js";
import { usageLogPath } from "../telemetry/usage.js";

/** This module's own cursor name under `.ost-agent/state/` — never the transcript adapter's. */
export const CORRELATOR_CURSOR = "token-correlator";

/**
 * A session counts as finished only after this long untouched, matching the
 * transcript adapter's default. Consuming a live session would read half its
 * tokens and then mark it done.
 */
const QUIET_MINUTES = 30;

type SplitMethod = Genome["tokenSplit"]["method"];

export interface CorrelationResult {
  /** Tokens apportioned per unknown title. Fractional by design — the split conserves totals. */
  byUnknown: Map<string, TokenTiers>;
  /** Everything the windows could not claim. Large, and meant to be. */
  residual: TokenTiers;
  /** Session ids consumed by this run, ready for {@link markCorrelated}. */
  sessions: string[];
  /** Recorded on the result so a comparison mixing bases can be refused, not normalized. */
  costBasis: "tokens" | "calls-and-ms";
}

/** One tool call's execution window: `[start, end)`, derived from `ts` and `ms`. */
interface Interval {
  title: string;
  start: number;
  end: number;
}

/**
 * Where this vault's own sessions live. Derived from the VAULT dir, never from
 * `config.adapters.transcript.projectDir` — that names the product repo whose
 * sessions are harvested as friction evidence, which is a different question.
 */
export function transcriptDirFor(vaultDir: string, genome: Genome): string {
  const configured = genome.tokenSplit.transcriptDir.trim();
  return configured ? path.resolve(configured) : defaultTranscriptDir(vaultDir);
}

function emptyResult(costBasis: CorrelationResult["costBasis"]): CorrelationResult {
  return { byUnknown: new Map(), residual: emptyTiers(), sessions: [], costBasis };
}

function isZero(t: TokenTiers): boolean {
  return t.input === 0 && t.output === 0 && t.cacheCreate === 0 && t.cacheRead === 0;
}

function share(tiers: TokenTiers, fraction: number): TokenTiers {
  return {
    input: tiers.input * fraction,
    output: tiers.output * fraction,
    cacheCreate: tiers.cacheCreate * fraction,
    cacheRead: tiers.cacheRead * fraction,
  };
}

function credit(byUnknown: Map<string, TokenTiers>, title: string, tiers: TokenTiers): void {
  byUnknown.set(title, addTiers(byUnknown.get(title) ?? emptyTiers(), tiers));
}

/**
 * One pass over the usage trace, yielding a window per attributed call.
 *
 * Events naming a title that is not on the tree are dropped rather than folded
 * into the residual, matching the rollup's treatment of stale attribution: a
 * window belonging to nothing cannot claim tokens for anything.
 */
function readIntervals(vaultDir: string, knownTitles: ReadonlySet<string>): Interval[] {
  const out: Interval[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(usageLogPath(vaultDir), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as { ts?: string; ms?: number; unknown?: string };
      if (!event.unknown || !knownTitles.has(event.unknown)) continue;
      const start = typeof event.ts === "string" ? Date.parse(event.ts) : Number.NaN;
      if (!Number.isFinite(start)) continue;
      const ms =
        typeof event.ms === "number" && Number.isFinite(event.ms) && event.ms > 0 ? event.ms : 0;
      out.push({ title: event.unknown, start, end: start + ms });
    } catch {
      // a corrupt trace line buys no window
    }
  }
  // The log is appended after the call returns, so it arrives in FINISH order
  // while `ts` is START time. Sort by start; never trust the file's order.
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/** Under `proportional-by-ms` a window's weight is its duration; otherwise it is one call. */
function intervalWeight(iv: Interval, method: SplitMethod): number {
  return method === "proportional-by-ms" ? Math.max(iv.end - iv.start, 0) : 1;
}

function overlapping(intervals: readonly Interval[], t: number): Interval[] {
  return intervals.filter((iv) => iv.start <= t && t < iv.end);
}

/** The most recently opened of several covering windows — the innermost work. */
function innermost(hit: readonly Interval[]): Interval {
  return hit.reduce((best, iv) =>
    iv.start > best.start ||
    (iv.start === best.start && (iv.end < best.end || (iv.end === best.end && iv.title < best.title)))
      ? iv
      : best,
  );
}

/** The window that finished most recently before `t`, if any. */
function nearestPreceding(intervals: readonly Interval[], t: number): Interval | undefined {
  let best: Interval | undefined;
  for (const iv of intervals) {
    if (iv.end > t) continue;
    if (!best || iv.end > best.end || (iv.end === best.end && iv.title < best.title)) best = iv;
  }
  return best;
}

function cursorSessions(vaultDir: string): string[] {
  try {
    const raw = loadCursor(vaultDir, CORRELATOR_CURSOR);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Sessions already written into the attention ledger, which is append-only. */
function ledgerSessions(vaultDir: string, titles: readonly string[]): string[] {
  const seen: string[] = [];
  for (const title of titles) {
    for (const entry of readAttention(vaultDir, title)) {
      if (entry.kind === "spend" && entry.session) seen.push(entry.session);
    }
  }
  return seen;
}

/**
 * Record that these sessions have been consumed. `correlateTokens` never writes
 * — `eval/` stays read-only — so whoever persists a correlation calls this, and
 * the next run skips what this one already accounted for.
 */
export function markCorrelated(vaultDir: string, sessions: readonly string[]): void {
  try {
    const merged = new Set([...cursorSessions(vaultDir), ...sessions]);
    saveCursor(vaultDir, CORRELATOR_CURSOR, JSON.stringify([...merged].sort()));
  } catch {
    // fail-open: a lost cursor costs a re-read, never a crash
  }
}

/** Finished, vault-owned, not-yet-consumed session transcripts, in a stable order. */
function sessionFiles(
  dir: string,
  vaultDir: string,
  skip: ReadonlySet<string>,
): { id: string; file: string }[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const quietBefore = Date.now() - QUIET_MINUTES * 60_000;
  const vault = path.resolve(vaultDir);
  const out: { id: string; file: string }[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
    // Claude Code names each transcript for its sessionId, so the stem IS the id.
    const id = e.name.replace(/\.jsonl$/, "");
    if (skip.has(id)) continue;
    const file = path.join(dir, e.name);
    try {
      if (fs.statSync(file).mtimeMs > quietBefore) continue; // still spending; invisible until quiet
    } catch {
      continue;
    }
    const cwd = sessionCwd(file);
    if (!cwd || path.resolve(cwd) !== vault) continue; // another project's session
    out.push({ id, file });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Divide the tokens of every finished, vault-owned session across the unknowns
 * whose tool-call windows contain them. Never throws; never writes.
 */
export function correlateTokens(
  vaultDir: string,
  tree: readonly OstNode[],
  genome: Genome,
): CorrelationResult {
  const split = genome.tokenSplit;
  if (!split.enabled) return emptyResult(split.costBasis);

  try {
    const titles = tree.filter((n) => n.layer === "Unknown").map((n) => n.title);
    const skip = new Set([...cursorSessions(vaultDir), ...ledgerSessions(vaultDir, titles)]);
    const files = sessionFiles(transcriptDirFor(vaultDir, genome), vaultDir, skip);
    if (files.length === 0) return emptyResult(split.costBasis);

    const intervals = readIntervals(vaultDir, new Set(titles));
    const titleWeight = new Map<string, number>();
    let totalWeight = 0;
    for (const iv of intervals) {
      const w = intervalWeight(iv, split.method);
      titleWeight.set(iv.title, (titleWeight.get(iv.title) ?? 0) + w);
      totalWeight += w;
    }

    const byUnknown = new Map<string, TokenTiers>();
    const sessions: string[] = [];
    let leftover = emptyTiers();

    for (const s of files) {
      sessions.push(s.id);
      for (const entry of readSessionUsage(s.file)) {
        const t = Date.parse(entry.ts);
        const hit = split.method === "none" || !Number.isFinite(t) ? [] : overlapping(intervals, t);

        if (hit.length === 0) {
          if (split.method !== "none" && split.residual === "nearest-preceding" && Number.isFinite(t)) {
            const prev = nearestPreceding(intervals, t);
            if (prev) {
              credit(byUnknown, prev.title, entry.tiers);
              continue;
            }
          }
          leftover = addTiers(leftover, entry.tiers);
          continue;
        }

        if (split.method === "winner-take-all") {
          credit(byUnknown, innermost(hit).title, entry.tiers);
          continue;
        }

        const weights = new Map<string, number>();
        let sum = 0;
        for (const iv of hit) {
          const w = intervalWeight(iv, split.method);
          weights.set(iv.title, (weights.get(iv.title) ?? 0) + w);
          sum += w;
        }
        if (sum <= 0) {
          leftover = addTiers(leftover, entry.tiers);
          continue;
        }
        for (const [title, w] of weights) credit(byUnknown, title, share(entry.tiers, w / sum));
      }
    }

    // The residual is spread on exactly the basis the method used, or — the
    // default — left standing, which is the number the design asks to report.
    // `method: none` means "attribute nothing", and no residual policy may
    // override that: the windows still exist and still carry weight, so without
    // this guard `proportional` would hand every token straight back to the
    // unknowns the method just declined to credit.
    let residual = leftover;
    if (
      split.method !== "none" &&
      split.residual === "proportional" &&
      totalWeight > 0 &&
      !isZero(leftover)
    ) {
      for (const [title, w] of titleWeight) credit(byUnknown, title, share(leftover, w / totalWeight));
      residual = emptyTiers();
    }

    return { byUnknown, residual, sessions, costBasis: split.costBasis };
  } catch {
    // fail-open by contract: this runs inside ost_status
    return emptyResult(split.costBasis);
  }
}
