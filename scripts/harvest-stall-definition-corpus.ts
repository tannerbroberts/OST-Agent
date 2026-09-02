/**
 * Re-derive the stall-definition corpus from a vault's own records.
 *
 * The fixture at `test/fixtures/stall-definition/runs.json` is every firing a
 * real vault has recorded, reduced to the timestamps a watchdog outside the
 * process could have read while the firing was still open — see that
 * directory's PROVENANCE.md for the cut and what it does and does not show.
 * This script re-runs the extraction so the corpus can be regenerated and
 * checked against the raw ledgers instead of trusted:
 *
 *   npx tsx scripts/harvest-stall-definition-corpus.ts /path/to/vault
 *
 * Three sources, all already on disk:
 *
 *   - `.git/ost-agent/runs.jsonl`   — the run's window and the verdict it sealed with
 *   - `.git/ost-agent/journal.jsonl` — every line the run wrote forward
 *   - `git log`                      — every commit in the vault, which is what a
 *                                      mutating tool call leaves behind
 *
 * Nothing but timestamps and the verdict word crosses into the fixture. No
 * command, path, prompt or subject is carried over: the definition reads only
 * *when* something happened, so a corpus carrying content would be carrying
 * material the measurement cannot use and a redactor would have to guard.
 *
 * Nothing here is imported by src/ or by a test. The fixture is the artefact.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readRuns, type LoopRunRecord } from "../src/loop/health.js";
import { readJournal } from "../src/loop/journal.js";
import type { ProgressMark, RecordedOutcome } from "../src/loop/liveness.js";

interface HarvestedRun {
  runId: string;
  outcome: RecordedOutcome;
  startedAtMs: number;
  /** Offset from `startedAtMs`, absent when the run never sealed. */
  sealedAfterMs?: number;
  /** `[kindCode, offsetFromStartMs]` — `j` journal, `c` commit. Ascending. */
  marks: [string, number][];
}

/**
 * Every commit timestamp in the vault, ascending, in epoch milliseconds.
 *
 * Committer dates, matching `commitTimesSince` (`src/loop/state.ts`) — see the
 * note there for why the pair has to agree. When work landed, not when it was
 * authored.
 */
function commitTimesMs(vaultDir: string): number[] {
  const out = spawnSync("git", ["-C", vaultDir, "log", "--format=%cI"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(`git log failed in ${vaultDir}: ${out.stderr}`);
  return out.stdout
    .split("\n")
    .map((line) => Date.parse(line.trim()))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
}

/**
 * The window a firing was open for.
 *
 * A record with no `endedAt` never sealed, and that is the one shape the
 * detector exists for — it is kept, with its window left open at the far end.
 */
function windowOf(run: LoopRunRecord): { startedAtMs: number; sealedAtMs?: number } | null {
  const startedAtMs = Date.parse(run.startedAt);
  if (!Number.isFinite(startedAtMs)) return null;
  const sealedAtMs = run.endedAt ? Date.parse(run.endedAt) : NaN;
  return Number.isFinite(sealedAtMs) ? { startedAtMs, sealedAtMs } : { startedAtMs };
}

function main(): void {
  const vaultDir = process.argv[2];
  if (!vaultDir) {
    console.error("usage: npx tsx scripts/harvest-stall-definition-corpus.ts /path/to/vault");
    process.exitCode = 1;
    return;
  }

  const commits = commitTimesMs(vaultDir);
  const journalByRun = new Map<string, number[]>();
  for (const entry of readJournal(vaultDir)) {
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at)) continue;
    const marks = journalByRun.get(entry.runId) ?? [];
    marks.push(at);
    journalByRun.set(entry.runId, marks);
  }

  const harvested: HarvestedRun[] = [];
  for (const run of readRuns(vaultDir)) {
    const window = windowOf(run);
    if (window === null) continue;
    const { startedAtMs, sealedAtMs } = window;
    // The far end of an unsealed run's window is the last thing that could
    // belong to it — beyond that, a commit belongs to whatever came next.
    const until = sealedAtMs ?? Number.POSITIVE_INFINITY;

    const marks: ProgressMark[] = [];
    for (const at of journalByRun.get(run.runId) ?? []) {
      if (at >= startedAtMs && at <= until) marks.push({ kind: "journal", atMs: at });
    }
    for (const at of commits) {
      if (at >= startedAtMs && at <= until) marks.push({ kind: "commit", atMs: at });
    }
    marks.sort((a, b) => a.atMs - b.atMs);

    harvested.push({
      runId: run.runId,
      outcome: run.verdict ?? "unsealed",
      startedAtMs,
      ...(sealedAtMs !== undefined ? { sealedAfterMs: sealedAtMs - startedAtMs } : {}),
      marks: marks.map((m) => [m.kind === "journal" ? "j" : "c", m.atMs - startedAtMs] as [string, number]),
    });
  }

  harvested.sort((a, b) => a.startedAtMs - b.startedAtMs);
  const outPath = path.join(import.meta.dirname, "../test/fixtures/stall-definition/runs.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ vault: path.basename(path.resolve(vaultDir)), runs: harvested }) + "\n");
  const counts = harvested.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  console.log(`wrote ${harvested.length} run(s) to ${outPath}`);
  console.log(`outcomes: ${JSON.stringify(counts)}`);
}

main();
