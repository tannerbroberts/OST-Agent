/**
 * Re-derive the failure-context corpus from real ledgers.
 *
 * `test/telemetry/failure-context-coverage.test.ts` scores the assumption test
 * beneath "Snapshot the resolved environment, but only for the step that failed":
 * would `cwd`, `argv`, tool versions and the git SHA have explained the ten most
 * recent recorded failures? This script performs the whole cut so the committed
 * fixture can be regenerated and checked against the raw records rather than
 * trusted:
 *
 *   npx tsx scripts/harvest-failure-context-corpus.ts /path/to/vault
 *
 * Two corpora come out of it.
 *
 * - **current** — the ten most recent non-refused failures in the vault's live
 *   loop ledger (`.git/ost-agent/runs.jsonl`), cut through the same
 *   `recentNonZeroExitSteps` the sibling instrument uses, so the two are scored
 *   over the same population.
 * - **legacy** — the two failures in `test/fixtures/unknown-context-price/runs-legacy.jsonl`,
 *   already committed. They are the era that motivated this branch of the tree,
 *   they are the only recorded failures anybody fixed by changing a directory, and
 *   they are in the corpus as the positive control: a classifier that answered
 *   "not explained" to everything would satisfy a breached bar, and these are what
 *   stops it.
 *
 * Nothing about the label is authored here. What explained a failure is read off
 * the record two ways — the terminating entry in the session transcript the run
 * itself names, and the corrected re-run in the ledger — and both are written into
 * the fixture verbatim so a reader can disagree with the classification without
 * re-running anything.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../src/adapters/transcript.js";
import { readRuns, type LoopRunRecord, type LoopStepRecord } from "../src/loop/health.js";
import { recentNonZeroExitSteps } from "../src/loop/replay.js";
import { SNAPSHOT_FIELDS, type LabelledFailure, type RerunDelta, type SnapshotField } from "../src/telemetry/failure-context.js";
import { payloadOf } from "../src/telemetry/unknown-context-census.js";

const TEXT_CAP = 400;
const ARGV_ELEMENT_CAP = 200;

function clip(raw: string, cap: number): string {
  const flat = redactSecrets(raw).replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…[truncated ${flat.length - cap} chars]` : flat;
}

// ── channel one: what the failing process last said ──────────────────────────

interface Session {
  id: string;
  file: string;
  lastTs: number;
  lines: string[];
}

function readSessions(dir: string): Session[] {
  const files: string[] = [];
  const walk = (at: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".jsonl")) files.push(full);
    }
  };
  walk(dir);

  const sessions: Session[] = [];
  for (const file of files) {
    let lines: string[];
    try {
      lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    } catch {
      continue;
    }
    let lastTs = -1;
    for (const line of lines) {
      const m = /"timestamp":"([^"]+)"/.exec(line);
      if (m) lastTs = Math.max(lastTs, Date.parse(m[1]));
    }
    if (lastTs > 0) sessions.push({ id: path.basename(file).replace(/\.jsonl$/, ""), file, lastTs, lines });
  }
  return sessions;
}

/**
 * The session that ended when the step did, and the entry it ended on.
 *
 * The join is the clock, and the tolerance is deliberately tight: a `loop step`
 * records its exit within a second of the child's last write, and every one of
 * the current ten lands inside 700ms. Widening it would start matching the wrong
 * session on a busy hour, which is a label this census invented rather than read.
 */
const JOIN_TOLERANCE_MS = 5_000;

function terminationFor(step: LoopStepRecord, sessions: readonly Session[]): LabelledFailure["termination"] {
  const end = Date.parse(step.at);
  const hit = sessions
    .filter((s) => Math.abs(s.lastTs - end) <= JOIN_TOLERANCE_MS)
    .sort((a, b) => Math.abs(a.lastTs - end) - Math.abs(b.lastTs - end))[0];
  if (!hit) return undefined;

  // Newest first: the terminating entry is the last one carrying text.
  for (const line of [...hit.lines].reverse()) {
    let entry: { type?: string; timestamp?: string; message?: { content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry.timestamp) continue;
    const content = entry.message?.content;
    const text = Array.isArray(content)
      ? content
          .filter((b): b is { type: string; text: string } => typeof b === "object" && b !== null && (b as { type?: string }).type === "text")
          .map((b) => b.text)
          .join(" ")
      : typeof content === "string"
        ? content
        : "";
    if (text.trim().length === 0) continue;
    return { session: hit.id, ts: entry.timestamp, text: clip(text, TEXT_CAP) };
  }
  return undefined;
}

// ── channel two: the same command, re-run and passing ────────────────────────

/**
 * A `cd` inside the command is a directory change the record's own `cwd` field
 * cannot see — `loop step` stamps the cwd it spawned from, not the one the shell
 * moved to. So the delta is read from the command text as well as the field.
 */
function leadingCd(command: string): string | null {
  const m = /(?:^|;\s*)cd\s+(\S+)\s*&&/.exec(command.replace(/^(?:bash|sh|zsh)\s+-[a-z]*c\s+/, ""));
  return m ? m[1] : null;
}

function rerunFor(step: LoopStepRecord, all: readonly LoopStepRecord[]): RerunDelta | undefined {
  const payload = payloadOf(step.command ?? "");
  if (payload.length === 0) return undefined;
  const after = all
    .filter((s) => s.exit === 0 && s.phase === step.phase && Date.parse(s.at) > Date.parse(step.at) && payloadOf(s.command ?? "") === payload)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (!after) return undefined;

  const changed: SnapshotField[] = [];
  const failedIn = leadingCd(step.command ?? "") ?? step.cwd ?? null;
  const passedIn = leadingCd(after.command ?? "") ?? after.cwd ?? null;
  if (failedIn !== passedIn) changed.push("cwd");
  // Compared as arrays rather than joined: `health.ts` documents that a joined
  // command "cannot tell one spaced argument from two", and a separator chosen
  // here would inherit exactly that.
  if (JSON.stringify(step.argv ?? []) !== JSON.stringify(after.argv ?? []) && (step.argv || after.argv)) changed.push("argv");

  return { at: after.at, command: clip(after.command ?? "", ARGV_ELEMENT_CAP), changed };
}

// ── the field projections the discriminability reading is taken over ─────────

type FieldValues = Readonly<Record<SnapshotField, string | null>>;

/** The resolved argv exactly as the node words it — prompt and all. */
function fullFields(step: LoopStepRecord, run: LoopRunRecord | undefined): FieldValues {
  return {
    cwd: step.cwd ?? null,
    argv: step.argv ? step.argv.join(" ") : (step.command ?? null),
    toolVersions: null, // nothing in this repository records them
    gitSha: run?.headBefore ?? null,
  };
}

/**
 * The same, with the argv reduced to its invocation shape — executable plus
 * option names, never option values.
 *
 * Committed alongside the full reading because the full one makes a `claude -p
 * <40kB prompt>` argv unique on every firing, and a field that never repeats
 * cannot discriminate for a reason that has nothing to do with this solution.
 * Under the shape reading the same argv recurs, which is the reading most
 * generous to the thing under test.
 */
function shapeFields(step: LoopStepRecord, run: LoopRunRecord | undefined): FieldValues {
  const argv = step.argv ?? [];
  const shape = argv.length > 0 ? [argv[0], ...argv.filter((a) => a.startsWith("--"))].join(" ") : payloadOf(step.command ?? "").split(/\s+/).slice(0, 2).join(" ");
  return { ...fullFields(step, run), argv: shape.length > 0 ? shape : null };
}

// ── the cut ──────────────────────────────────────────────────────────────────

interface Corpus {
  source: string;
  note: string;
  phases: string[];
  failures: LabelledFailure[];
  fieldsFull: { failures: FieldValues[]; successes: FieldValues[] };
  fieldsShape: { failures: FieldValues[]; successes: FieldValues[] };
}

function cut(source: string, note: string, runs: readonly LoopRunRecord[], limit: number, sessions: readonly Session[]): Corpus {
  const runOf = new Map<LoopStepRecord, LoopRunRecord>();
  for (const run of runs) for (const step of run.steps ?? []) runOf.set(step, run);
  const all = [...runOf.keys()];

  const failing = recentNonZeroExitSteps(runs, limit);
  const phases = [...new Set(failing.map((s) => s.phase))];
  // Successes are restricted to the phases the failures occupy: a `sense` step
  // legitimately runs from a different directory than a `build` step, and mixing
  // them would report `cwd` varying for a reason that is not a failure.
  const succeeding = all.filter((s) => s.exit === 0 && phases.includes(s.phase));

  const failures: LabelledFailure[] = failing.map((step) => ({
    at: step.at,
    phase: step.phase,
    exit: step.exit,
    durationMs: step.durationMs,
    ...(step.cwd === undefined ? {} : { cwd: step.cwd }),
    ...(step.argv === undefined ? {} : { argv: step.argv.map((a) => clip(a, ARGV_ELEMENT_CAP)) }),
    command: clip(step.command ?? "", ARGV_ELEMENT_CAP),
    ...(runOf.get(step)?.headBefore === undefined ? {} : { gitSha: runOf.get(step)!.headBefore }),
    ...((): Partial<LabelledFailure> => {
      const t = terminationFor(step, sessions);
      return t ? { termination: t } : {};
    })(),
    ...((): Partial<LabelledFailure> => {
      const r = rerunFor(step, all);
      return r ? { rerun: r } : {};
    })(),
  }));

  return {
    source,
    note,
    phases,
    failures,
    fieldsFull: { failures: failing.map((s) => fullFields(s, runOf.get(s))), successes: succeeding.map((s) => fullFields(s, runOf.get(s))) },
    fieldsShape: { failures: failing.map((s) => shapeFields(s, runOf.get(s))), successes: succeeding.map((s) => shapeFields(s, runOf.get(s))) },
  };
}

function readLegacy(repoRoot: string): LoopRunRecord[] {
  const file = path.join(repoRoot, "test", "fixtures", "unknown-context-price", "runs-legacy.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoopRunRecord);
}

function main(): void {
  const vaultDir = process.argv[2];
  if (!vaultDir) {
    console.error("usage: npx tsx scripts/harvest-failure-context-corpus.ts /path/to/vault");
    process.exitCode = 1;
    return;
  }
  const repoRoot = path.join(import.meta.dirname, "..");
  const runs = readRuns(vaultDir);

  // The sessions directory is read off the ledger rather than guessed: every run
  // stamps the one its spend ceiling was measured over.
  const sessionsDir = runs.map((r) => r.ceiling?.sessionsDir).filter((d): d is string => typeof d === "string").at(-1);
  const sessions = sessionsDir ? readSessions(sessionsDir) : [];
  if (!sessionsDir) console.error("warning: no run names a sessionsDir — every current failure will come out `unread`");

  const out = {
    cutFrom: { vault: vaultDir, sessionsDir: sessionsDir ?? null, sessionsRead: sessions.length },
    corpora: {
      current: cut(
        `${path.basename(vaultDir)}/.git/ost-agent/runs.jsonl`,
        "the ten most recent non-refused failures in the live loop ledger",
        runs,
        10,
        sessions,
      ),
      legacy: cut(
        "test/fixtures/unknown-context-price/runs-legacy.jsonl",
        "the two failures of the era that motivated this branch — the positive control",
        readLegacy(repoRoot),
        10,
        [],
      ),
    },
  };

  const dir = path.join(repoRoot, "test", "fixtures", "failure-context");
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, "failures.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `wrote ${out.corpora.current.failures.length} current and ${out.corpora.legacy.failures.length} legacy failure(s) to ${outPath}`,
  );
}

main();
