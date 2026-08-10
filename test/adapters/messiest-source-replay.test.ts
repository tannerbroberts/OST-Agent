/**
 * The instrument for "Write one adapter against the messiest source and time how
 * long it stays working" — durability by replay rather than by waiting.
 *
 * ## What the corpus is
 *
 * `test/fixtures/actions-replay/runs-page-*.json.gz` are the VERBATIM bodies of
 * `GET https://api.github.com/repos/tannerbroberts/OST-Agent/actions/runs`, both
 * pages, captured 2026-08-10 — the repository's entire workflow-run history at that
 * moment: 193 runs spanning 2026-07-24 → 2026-08-10. Nothing is trimmed, reordered
 * or hand-written. They are gzipped because the raw JSON is 2.9 MB and the point of
 * a committed corpus is that it stays committed.
 *
 * ## What a green run here means, and what it does not
 *
 * It means the adapter parses every record the source has produced over the period
 * on record, in creation order, and loses none of them. It does NOT mean the adapter
 * will survive the source's next change — and on this corpus it means less than the
 * assumption test hoped, which the last block in this file measures rather than
 * asserts away. See the `corpus census` test: all 193 records carry the identical
 * 35-key shape, so the replay exercises payload VARIETY (conclusions, events,
 * re-run attempts, two workflows) and encounters no schema drift at all, because
 * the source produced none in seventeen days.
 *
 * The replay is also structurally blind to how the source is REACHED: an auth
 * change, a rate limit or a moved endpoint never appears in a response body, and
 * those are the failures that actually kill pull adapters. Nothing here can see
 * them, and a green run must not be read as though it could.
 *
 * ## Replay vs. derived
 *
 * The first blocks replay history and only history. The `tolerates shapes the
 * corpus never produced` block is explicitly DERIVED — variants built by degrading
 * real records — and is labelled that way so it can never be mistaken for evidence
 * about what the source has done.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { ActionsSource, parseWorkflowRun, queueSeconds, type ActionsClient } from "../../src/adapters/actions.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "actions-replay");

/** The repository the corpus was captured from — recorded, not configurable. */
const CORPUS_REPO = "tannerbroberts/OST-Agent";

/** Every raw run record in the corpus, oldest first. */
function loadCorpus(): Record<string, unknown>[] {
  const pages = fs
    .readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".json.gz"))
    .sort();
  expect(pages.length).toBeGreaterThan(0);

  const runs: Record<string, unknown>[] = [];
  for (const page of pages) {
    const body = zlib.gunzipSync(fs.readFileSync(path.join(FIXTURES, page))).toString("utf8");
    const parsed = JSON.parse(body) as { workflow_runs?: Record<string, unknown>[] };
    runs.push(...(parsed.workflow_runs ?? []));
  }
  // The source pages newest-first; a replay of history runs the other way.
  //
  // Ordered by ID, not by `created_at`, and the corpus is why: two runs in it were
  // created in the same second (2026-07-27T02:15:00Z), so the timestamp does not
  // totally order the history — it has second granularity and the source allocates
  // several runs inside one. The id does order it. Any cursor scheme keyed on a
  // timestamp therefore cannot say "resume after this exact run", which is the
  // reason the adapter's watermark is a whole finished DAY rather than an instant.
  return runs.sort((a, b) => Number(a.id) - Number(b.id));
}

/** A client that serves a fixed list of raw records, ignoring the query. */
function replayClient(records: unknown[]): ActionsClient {
  return { fetchRuns: async () => records };
}

describe("messiest-source replay — GitHub Actions", () => {
  const corpus = loadCorpus();

  it("parses every historical record in the corpus", () => {
    const unparsed: number[] = [];
    corpus.forEach((raw, i) => {
      if (parseWorkflowRun(raw) === null) unparsed.push(i);
    });
    // The whole instrument in one line: not "most", not "the ones we thought of".
    expect(unparsed).toEqual([]);
    expect(corpus.length).toBeGreaterThanOrEqual(193);
  });

  it("replays the corpus in creation order without losing or duplicating a run", () => {
    const parsed = corpus.map((raw) => parseWorkflowRun(raw)!);

    // One id, one run — replayed in the source's own total order.
    const ids = parsed.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);

    // Creation time is non-decreasing along that order but NOT strictly increasing,
    // and the difference is the finding: `created_at` is second-granular and the
    // corpus contains a second holding two runs. Asserting strict increase here
    // would be asserting a property the source does not have.
    const created = parsed.map((r) => r.createdAt);
    for (let i = 1; i < created.length; i++) {
      expect(created[i] >= created[i - 1]).toBe(true);
    }
    const ties = created.filter((t, i) => i > 0 && t === created[i - 1]);
    expect(ties.length).toBeGreaterThanOrEqual(1);
  });

  it("every parsed run carries the fields the rollup reads", () => {
    for (const raw of corpus) {
      const run = parseWorkflowRun(raw)!;
      expect(typeof run.id).toBe("number");
      expect(run.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof run.event).toBe("string");
      expect(typeof run.status).toBe("string");
      expect(run.attempt).toBeGreaterThanOrEqual(1);
      // `conclusion` is string-or-null and both are real answers; what it may not
      // be is undefined, because that is the value that reads as false everywhere.
      expect(run.conclusion === null || typeof run.conclusion === "string").toBe(true);
    }
  });

  it("accounts for every run of every finished day in the emitted evidence", async () => {
    // "The day after the newest record" — so the whole corpus is finished history.
    const newest = corpus[corpus.length - 1].created_at as string;
    const dayAfter = new Date(Date.parse(`${newest.slice(0, 10)}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);

    const source = new ActionsSource(replayClient(corpus), {
      repo: CORPUS_REPO,
      today: () => dayAfter,
    });
    const { items, cursor } = await source.fetchSince(null);

    const days = new Set(corpus.map((r) => String(r.created_at).slice(0, 10)));
    expect(items.length).toBe(days.size);
    expect(cursor).toBe([...days].sort().pop());

    // Each day's item names its own run count, and the counts sum to the corpus.
    let counted = 0;
    for (const item of items) {
      const m = /(\d+) workflow runs/.exec(item.body);
      expect(m).not.toBeNull();
      counted += Number(m![1]);
      expect(item.id).toMatch(/^ACTIONS:\d{4}-\d{2}-\d{2}$/);
    }
    expect(counted).toBe(corpus.length);
  });

  it("replays incrementally without re-emitting a day it already delivered", async () => {
    const newest = corpus[corpus.length - 1].created_at as string;
    const dayAfter = new Date(Date.parse(`${newest.slice(0, 10)}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const source = new ActionsSource(replayClient(corpus), { repo: CORPUS_REPO, today: () => dayAfter });

    const first = await source.fetchSince(null);
    // The same corpus served again to a caller holding the advanced cursor: the
    // realistic case, because the watermark is a DAY and the source re-offers the
    // whole window every time.
    const second = await source.fetchSince(first.cursor);
    expect(second.items).toEqual([]);
    expect(second.cursor).toBe(first.cursor);
  });

  it("reports the wait for a runner, which is the number that had to be carried by hand", async () => {
    const waits = corpus.map((raw) => queueSeconds(parseWorkflowRun(raw)!)).filter((s): s is number => s !== null);
    expect(waits.length).toBe(corpus.length); // the source reported it for every run on record
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(0);

    const newest = corpus[corpus.length - 1].created_at as string;
    const dayAfter = new Date(Date.parse(`${newest.slice(0, 10)}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const source = new ActionsSource(replayClient(corpus), { repo: CORPUS_REPO, today: () => dayAfter });
    const { items } = await source.fetchSince(null);
    for (const item of items) expect(item.body).toContain("Wait for a runner:");
  });
});

describe("messiest-source replay — what the corpus actually exercises", () => {
  const corpus = loadCorpus();

  /**
   * The honest reading of a green replay, committed as numbers.
   *
   * The assumption under test is that a pull adapter "keeps working without
   * attention". Replay can only support that to the extent the corpus contains
   * change — so the amount of change in the corpus is part of the result, not a
   * footnote to it. These are floors: they hold while the corpus only grows, and
   * the one that matters is the last.
   */
  it("corpus census — the variety a green run is evidence over", () => {
    const parsed = corpus.map((r) => parseWorkflowRun(r)!);

    const conclusions = new Set(parsed.map((r) => r.conclusion));
    const events = new Set(parsed.map((r) => r.event));
    const workflows = new Set(parsed.map((r) => r.workflowPath));
    const reruns = parsed.filter((r) => r.attempt > 1);
    const days = new Set(parsed.map((r) => r.createdAt.slice(0, 10)));

    expect(conclusions.size).toBeGreaterThanOrEqual(3); // success, failure, cancelled
    expect(events.size).toBeGreaterThanOrEqual(4); // push, pull_request, workflow_dispatch, release
    expect(workflows.size).toBeGreaterThanOrEqual(2);
    expect(reruns.length).toBeGreaterThanOrEqual(1);
    expect(days.size).toBeGreaterThanOrEqual(14);

    // The finding, asserted so it cannot be forgotten: across every record on
    // record the source emitted ONE key set. Seventeen days of history contain no
    // schema drift whatsoever, so "the adapter survived the corpus" is a statement
    // about payload variety and nothing at all about the adapter's tolerance for
    // change. If this number ever rises above 1, the corpus has finally acquired
    // the drift this instrument was written to measure — and this expectation
    // failing is the notification.
    const shapes = new Set(corpus.map((r) => Object.keys(r).sort().join(",")));
    expect(shapes.size).toBe(1);
  });
});

describe("messiest-source tolerance — DERIVED variants, not history", () => {
  /**
   * Everything below is constructed by degrading a real record. It is evidence
   * about the parser and NONE about the source: the source has never emitted any
   * of these shapes in the period on record. It exists because the corpus census
   * above shows the replay cannot test tolerance on its own, and a parser whose
   * tolerance is untested is a parser whose tolerance is a comment.
   */
  const real = loadCorpus()[0];

  it("keeps a record that has lost an optional field", () => {
    for (const field of ["name", "path", "head_branch", "html_url", "updated_at", "run_started_at", "conclusion"]) {
      const degraded = { ...real };
      delete (degraded as Record<string, unknown>)[field];
      expect(parseWorkflowRun(degraded)).not.toBeNull();
    }
  });

  it("keeps a record whose optional field turned null", () => {
    for (const field of ["name", "path", "head_branch", "conclusion", "run_started_at", "updated_at"]) {
      const run = parseWorkflowRun({ ...real, [field]: null });
      expect(run).not.toBeNull();
    }
  });

  it("keeps a record that grew a field nobody has seen", () => {
    const run = parseWorkflowRun({ ...real, some_future_field: { nested: [1, 2, 3] } });
    expect(run).not.toBeNull();
    expect(run!.id).toBe(real.id);
  });

  it("accepts a numeric id that arrived quoted", () => {
    const run = parseWorkflowRun({ ...real, id: String(real.id) });
    expect(run?.id).toBe(Number(real.id));
  });

  it("refuses exactly the two records it cannot place, and nothing else", () => {
    const noId = { ...real };
    delete (noId as Record<string, unknown>).id;
    const noCreated = { ...real };
    delete (noCreated as Record<string, unknown>).created_at;

    expect(parseWorkflowRun(noId)).toBeNull();
    expect(parseWorkflowRun(noCreated)).toBeNull();
    expect(parseWorkflowRun(null)).toBeNull();
    expect(parseWorkflowRun("a string where an object was")).toBeNull();
  });

  it("counts what it could not parse into the day's evidence rather than dropping it silently", async () => {
    const broken = { created_at: real.created_at }; // no id — unplaceable
    const day = String(real.created_at).slice(0, 10);
    const dayAfter = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

    const source = new ActionsSource({ fetchRuns: async () => [real, broken] }, {
      repo: "owner/repo",
      today: () => dayAfter,
    });
    const { items } = await source.fetchSince(null);
    expect(items).toHaveLength(1);
    expect(items[0].body).toContain("Unparsed records:** 1");
  });

  it("never reports an unconcluded run as a failure", async () => {
    const running = { ...real, id: Number(real.id) + 1, status: "in_progress", conclusion: null };
    const day = String(real.created_at).slice(0, 10);
    const dayAfter = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

    const source = new ActionsSource({ fetchRuns: async () => [running] }, {
      repo: "owner/repo",
      today: () => dayAfter,
    });
    const { items } = await source.fetchSince(null);
    expect(items[0].title).toContain("all green");
    expect(items[0].body).toContain("1 unconcluded");
  });
});
