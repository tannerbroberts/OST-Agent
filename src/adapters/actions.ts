/**
 * GitHub Actions adapter (read-only): the repository's own gate runs become evidence.
 *
 * ## Why this source, and why it is the least convenient one
 *
 * The gates this project merges on — `tsc --noEmit`, `vitest run`, `bundle-drift` —
 * do not only run on a laptop. They run in GitHub Actions, once per push and once
 * per pull request, and that is where their exit codes accumulate. An instrument's
 * result is experiment data by definition, so the repository's run history is a pile
 * of experiment data that the vault has no door for: nothing pushes it in, no folder
 * receives it, and the only way a run's outcome has ever reached the tree is a human
 * or a session running `gh` and retyping what it said. The tree records that carry
 * happening by hand across twenty sessions and fourteen pull requests.
 *
 * It is also the most awkward source this operator holds, which is exactly why it is
 * the one worth adapting first: it is the only one behind a network call, an auth
 * header, a pagination scheme and a rate limit at once. Every other channel here
 * reads a local file.
 *
 * ## What it emits, and why a day rather than a run
 *
 * One evidence item per finished UTC day, mirroring {@link UsageSource} — because a
 * run on its own is not a finding. "The suite failed" is noise at the volume CI
 * produces; "three of nineteen runs failed on this day, all on the same workflow,
 * and the worst wait for a runner was 4h07m" is a finding, and the second of those
 * numbers is the one that had to be carried in by hand.
 *
 * **Queue delay is computed here rather than left to a reader.** `run_started_at`
 * minus `created_at` is how long the run sat before a machine picked it up, and it
 * is the only number in the payload that separates "CI is slow" from "CI never
 * started" — the distinction that cost four finished branches four hours on
 * 2026-08-06. A reader who has to subtract two timestamps to see it will not.
 *
 * ## Read-only, like every adapter here
 *
 * Every request is a GET against `/repos/{owner}/{repo}/actions/runs`. There is no
 * method on {@link ActionsClient} that can re-run, cancel or delete a run, and the
 * grant the credential broker issues for this asker names that path prefix and
 * nothing else — so an adapter that grew a `POST` would be denied rather than
 * quietly authenticated.
 *
 * The HTTP layer is injected ({@link ActionsClient}), so the parsing, rollup and
 * cursor logic run offline against a fake — which is what lets the replay corpus in
 * `test/fixtures/actions-replay/` drive the real code path with no network.
 *
 * ## Parsing is tolerant on purpose
 *
 * {@link parseWorkflowRun} refuses exactly one thing — a record with no usable
 * identity — and degrades everything else to a stated default. That is not
 * defensive habit: this adapter's whole risk is that the source changes shape
 * without telling anyone, and a strict parse turns an added field or a newly-null
 * one into a channel that stops delivering. A record that arrives half-understood is
 * worth more than a fetch that throws, because the half that parsed is still the
 * exit code somebody needs.
 */
import type { Actor, Cursor, EvidenceItem, FetchResult, Source } from "./source.js";

/** One workflow run, after the source's payload has been reduced to what is used. */
export interface WorkflowRun {
  /** GitHub's numeric run id — monotonically increasing per repository. */
  id: number;
  /** Workflow display name ("CI"), or "" when the payload omits it. */
  name: string;
  /** Workflow file path (".github/workflows/ci.yml"), or "". */
  workflowPath: string;
  /** Attempt number; > 1 means somebody re-ran it, which is itself a signal. */
  attempt: number;
  /** What triggered it: "push", "pull_request", "workflow_dispatch", "release", … */
  event: string;
  /** "completed", "in_progress", "queued", … */
  status: string;
  /**
   * "success" / "failure" / "cancelled" / … , or null.
   *
   * Null is a real answer, not missing data: a run that has not concluded has no
   * conclusion. Collapsing it to "failure" would report every in-flight run as a
   * broken gate, which is the reading this channel exists to make impossible.
   */
  conclusion: string | null;
  branch: string;
  sha: string;
  /** When the run was created — the clock the day bucket is keyed on. */
  createdAt: string;
  /** When a runner actually picked it up, or null. */
  startedAt: string | null;
  updatedAt: string | null;
  url?: string;
}

export interface ActionsClient {
  /**
   * Return raw workflow-run records, newest first, read-only.
   *
   * Deliberately typed `unknown[]`: the client's job is transport, and every
   * judgement about the shape of a record belongs to {@link parseWorkflowRun}
   * where the replay corpus can exercise it.
   */
  fetchRuns(opts: { createdSince: string | null }): Promise<unknown[]>;
}

export interface ActionsOptions {
  /** "owner/repo" — recorded in item bodies so evidence says which repo it measured. */
  repo: string;
  /** A day needs at least this many runs to become an evidence item. */
  minRuns?: number;
  /** Injectable "today" (UTC day string) for tests; defaults to the real clock. */
  today?: () => string;
  /** How many days back to ask the source for on a cold start. */
  lookbackDays?: number;
}

const DEFAULT_MIN_RUNS = 1;
const DEFAULT_LOOKBACK_DAYS = 14;

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * One raw record → a {@link WorkflowRun}, or null when it cannot be identified.
 *
 * The two required fields are the two a rollup cannot proceed without: an id (so
 * the run can be counted once) and a creation timestamp (so it lands in a day).
 * A record missing either is dropped and counted, never guessed at — a run
 * assigned to the wrong day is worse than a run nobody counted, because the first
 * one is invisible and the second is reported.
 */
export function parseWorkflowRun(raw: unknown): WorkflowRun | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;

  // Numeric ids arrive as numbers today and have arrived as strings from other
  // GitHub endpoints; accept both rather than lose the record over a quoting change.
  const id = typeof r.id === "number" ? r.id : typeof r.id === "string" ? Number(r.id) : NaN;
  if (!Number.isFinite(id)) return null;

  const createdAt = str(r.created_at);
  if (!createdAt) return null;

  const attempt = typeof r.run_attempt === "number" && r.run_attempt > 0 ? r.run_attempt : 1;

  return {
    id,
    name: str(r.name),
    workflowPath: str(r.path),
    attempt,
    event: str(r.event, "unknown"),
    status: str(r.status, "unknown"),
    conclusion: nullableStr(r.conclusion),
    branch: str(r.head_branch),
    sha: str(r.head_sha),
    createdAt,
    startedAt: nullableStr(r.run_started_at),
    updatedAt: nullableStr(r.updated_at),
    ...(typeof r.html_url === "string" ? { url: r.html_url } : {}),
  };
}

/** Seconds a run waited between being created and a runner picking it up. */
export function queueSeconds(run: WorkflowRun): number | null {
  if (!run.startedAt) return null;
  const created = Date.parse(run.createdAt);
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(created) || !Number.isFinite(started)) return null;
  // Clamped at zero: the two stamps come from different services and have been
  // seen to disagree by a second, and a negative wait is noise, not a finding.
  return Math.max(0, Math.round((started - created) / 1000));
}

/** Seconds between a runner starting the run and the run's last update. */
function runSeconds(run: WorkflowRun): number | null {
  if (!run.startedAt || !run.updatedAt) return null;
  const started = Date.parse(run.startedAt);
  const updated = Date.parse(run.updatedAt);
  if (!Number.isFinite(started) || !Number.isFinite(updated)) return null;
  return Math.max(0, Math.round((updated - started) / 1000));
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

export class ActionsSource implements Source {
  readonly name = "actions";
  readonly actor: Actor = "actions";
  private readonly repo: string;
  private readonly minRuns: number;
  private readonly lookbackDays: number;
  private readonly today: () => string;

  constructor(
    private readonly client: ActionsClient,
    opts: ActionsOptions,
  ) {
    this.repo = opts.repo;
    this.minRuns = opts.minRuns ?? DEFAULT_MIN_RUNS;
    this.lookbackDays = opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    this.today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  }

  async fetchSince(cursor: Cursor): Promise<FetchResult> {
    const today = this.today();
    const raw = await this.client.fetchRuns({ createdSince: cursor ?? this.coldStart(today) });

    const runs: WorkflowRun[] = [];
    let unparsed = 0;
    for (const record of raw) {
      const run = parseWorkflowRun(record);
      if (run) runs.push(run);
      else unparsed++;
    }

    const byDay = new Map<string, WorkflowRun[]>();
    const seenIds = new Set<number>();
    for (const run of runs) {
      // The source pages by recency and a run can move between pages while the
      // pages are being fetched, so the same run really does arrive twice. Counting
      // it twice would inflate the failure rate of the day it landed on.
      if (seenIds.has(run.id)) continue;
      seenIds.add(run.id);
      const day = utcDay(run.createdAt);
      if (day >= today) continue; // only finished days — a partial day would double-emit
      if (cursor && day <= cursor) continue;
      const bucket = byDay.get(day) ?? [];
      bucket.push(run);
      byDay.set(day, bucket);
    }

    const items: EvidenceItem[] = [];
    let advanced = cursor;
    for (const day of [...byDay.keys()].sort()) {
      const dayRuns = byDay.get(day)!;
      // Every finished day advances the watermark, emitted or not — the same rule
      // `usage` follows, so a too-quiet day is dropped once rather than forever.
      if (!advanced || day > advanced) advanced = day;
      if (dayRuns.length < this.minRuns) continue;
      items.push(this.rollup(day, dayRuns, unparsed));
    }

    return { items, cursor: advanced };
  }

  /**
   * Refuses to advance partially. The cursor is a day watermark that deliberately
   * moves past days which never became items, so rebuilding it from `stored` would
   * re-emit those days forever. A day is a rollup rather than a report someone is
   * waiting on, so re-deriving it costs one request and `writeEvidence`'s id-keyed
   * idempotency drops what is already on disk.
   */
  advanceCursor(previous: Cursor): Cursor {
    return previous;
  }

  /** The day to ask from when nothing has been read yet. */
  private coldStart(today: string): string {
    const t = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(t)) return today;
    return new Date(t - this.lookbackDays * 86_400_000).toISOString().slice(0, 10);
  }

  private rollup(day: string, runs: WorkflowRun[], unparsed: number): EvidenceItem {
    const failed = runs.filter((r) => r.conclusion === "failure");
    const cancelled = runs.filter((r) => r.conclusion === "cancelled");
    const unfinished = runs.filter((r) => r.conclusion === null);
    const reruns = runs.filter((r) => r.attempt > 1);

    const queues = runs.map(queueSeconds).filter((s): s is number => s !== null);
    const durations = runs.map(runSeconds).filter((s): s is number => s !== null);
    const worstQueue = queues.length > 0 ? Math.max(...queues) : null;

    const byWorkflow = new Map<string, { total: number; failed: number }>();
    for (const r of runs) {
      const key = r.name || r.workflowPath || "(unnamed)";
      const entry = byWorkflow.get(key) ?? { total: 0, failed: 0 };
      entry.total++;
      if (r.conclusion === "failure") entry.failed++;
      byWorkflow.set(key, entry);
    }

    const failureLines = failed
      .slice(0, 10)
      .map(
        (r) =>
          `- \`${r.name || r.workflowPath}\` on \`${r.branch}\` (${r.event}, attempt ${r.attempt}) — ` +
          `${r.sha.slice(0, 8)}${r.url ? ` — ${r.url}` : ""}`,
      );

    const body = [
      `# CI runs — ${day} (${this.repo}, ${runs.length} workflow runs)`,
      "",
      "Mechanical rollup of the repository's GitHub Actions history, pulled read-only by the",
      "`actions` adapter. Computed, not composed: no agent narrated, selected or summarized",
      "these numbers — they are exit codes and timestamps the source recorded.",
      "",
      `- **Runs:** ${runs.length} (${runs.length - failed.length - cancelled.length - unfinished.length} success, ` +
        `${failed.length} failure, ${cancelled.length} cancelled${unfinished.length > 0 ? `, ${unfinished.length} unconcluded` : ""})`,
      `- **Re-runs:** ${reruns.length} (a run somebody started again — a green after a red is not a green)`,
      ...(worstQueue !== null
        ? [
            `- **Wait for a runner:** worst ${duration(worstQueue)}, median ${duration(median(queues))}` +
              (worstQueue >= 1800
                ? " — **a wait this long is the failure mode where finished work sits unmerged, not a slow test**"
                : ""),
          ]
        : ["- **Wait for a runner:** not reported by the source for any run on this day"]),
      ...(durations.length > 0 ? [`- **Run time:** median ${duration(median(durations))}, max ${duration(Math.max(...durations))}`] : []),
      ...(unparsed > 0
        ? [
            `- **Unparsed records:** ${unparsed} in this fetch — records the source returned that carried no usable ` +
              "id or creation time. Reported rather than dropped silently, because a channel losing records quietly " +
              "is the failure this number exists to catch.",
          ]
        : []),
      "",
      "| Workflow | Runs | Failed |",
      "| --- | --- | --- |",
      ...[...byWorkflow.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([name, e]) => `| ${name} | ${e.total} | ${e.failed} |`),
      ...(failureLines.length > 0
        ? ["", `**Failed runs${failed.length > failureLines.length ? ` (first ${failureLines.length} of ${failed.length})` : ""}:**`, ...failureLines]
        : []),
      "",
      "Evidence class: **observed behavior** — a measuring device's own record of what it",
      "measured. It grounds whether this project's gates run, pass and finish; it says nothing",
      "about external demand and must not be counted as evidence that anybody wants this.",
      "",
    ].join("\n");

    const headline = failed.length > 0 ? `${failed.length} failed` : "all green";
    return {
      id: `ACTIONS:${day}`,
      source: `ACTIONS:${day}`,
      title: `CI runs ${day} — ${runs.length} runs, ${headline}`,
      body,
      timestamp: `${day}T23:59:59.000Z`,
    };
  }
}

// ─── Real HTTP client ──────────────────────────────────────────────────────────

type FetchFn = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface HttpActionsConfig {
  /** "owner/repo". */
  repo: string;
  /** A token with `actions:read` on that repository — or none, for a public repo. */
  token?: string;
  /** Page size (GitHub `per_page`, max 100). */
  perPage?: number;
  /** Hard cap on pages walked in one fetch, so a cold start cannot run away. */
  maxPages?: number;
  fetchFn?: FetchFn;
}

const GITHUB_API = "https://api.github.com";
const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 10;

export class HttpActionsClient implements ActionsClient {
  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly perPage: number;
  private readonly maxPages: number;
  private readonly fetchFn: FetchFn;

  constructor(cfg: HttpActionsConfig) {
    this.repo = cfg.repo;
    this.token = cfg.token;
    this.perPage = Math.min(cfg.perPage ?? DEFAULT_PER_PAGE, 100);
    this.maxPages = cfg.maxPages ?? DEFAULT_MAX_PAGES;
    this.fetchFn = cfg.fetchFn ?? ((globalThis as unknown as { fetch: FetchFn }).fetch);
  }

  async fetchRuns(opts: { createdSince: string | null }): Promise<unknown[]> {
    const out: unknown[] = [];
    for (let page = 1; page <= this.maxPages; page++) {
      const params = new URLSearchParams({
        per_page: String(this.perPage),
        page: String(page),
        // `>=` on a date, which is what the source's own search grammar accepts.
        // The day watermark is re-asked inclusively and the cursor drops the day
        // itself, so a run created late on the boundary day cannot fall in the gap.
        ...(opts.createdSince ? { created: `>=${opts.createdSince}` } : {}),
      });
      const data = await this.get<{ workflow_runs?: unknown[] }>(
        `${GITHUB_API}/repos/${this.repo}/actions/runs?${params}`,
      );
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
      out.push(...runs);
      if (runs.length < this.perPage) break;
    }
    return out;
  }

  private async get<T>(url: string): Promise<T> {
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub GET ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
