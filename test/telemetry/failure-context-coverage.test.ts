/**
 * "Check past failures against the snapshot fields before building the snapshot"
 * — the instrument beneath "Snapshot the resolved environment, but only for the
 * step that failed".
 *
 * The solution proposes that when a step exits non-zero the recorder capture the
 * working directory, the resolved argv, the tool versions on `PATH` and the git
 * SHA, and attach them to that record. The assumption test runs **before** the
 * snapshot is built, and the node is explicit that it is allowed to stop it:
 * *at least 7 of the 10 most recent recorded failures are fully explained by
 * working directory, resolved argv, tool versions and git SHA alone*, and *below
 * 7 of 10 the honest response is to widen the fields or prefer "Replay a recorded
 * failure in its recorded context on demand", which does not have to predict what
 * will matter.*
 *
 * ## The result: refuted, 0 of 10
 *
 * Over the ten most recent non-refused failures in the meta vault's loop ledger,
 * **not one** is explained by any of the four fields. Seven terminate in the host
 * suspending mid-response, one in an upstream 529, one in the account's weekly
 * limit; the tenth has no surviving record and is counted `unread`, never as a
 * refutation. The most generous reading available (`explained + partly`) is also
 * zero, so the verdict does not turn on how strictly "fully explained" was read —
 * a point this file asserts rather than asks anyone to take on trust, because the
 * strict reading is deliberately biased against the thing under test.
 *
 * The control corpus — the two 2026-07-27 failures somebody fixed by changing a
 * directory, the founding case for this whole branch — comes out **2 of 2
 * explained**. So this is not a classifier that answers "not explained" to
 * everything, which is the one way a refutation like this gets manufactured.
 *
 * ## Why this file does not assert the bar, and what it asserts instead
 *
 * The bar is a claim about a recorded world, not about this codebase. The only
 * edit in this repository that could turn a breached bar green is an edit to the
 * corpus the census reads — and an instrument whose route to green runs through
 * rewriting its own evidence must not gate the suite. That is the same footing
 * `test/telemetry/unknown-context-refusal-cost.test.ts` stands on, for the same
 * reason.
 *
 * So what is asserted here is everything compute can settle without touching the
 * evidence: the rule holds the numbers the node fixed, the classifier fires and
 * fails to fire on both sides, the two evidence channels disagree in the
 * direction they are supposed to, the discriminability reading refuses the two
 * ways a field can look explanatory without being it, and — over each committed
 * corpus — the verdict is pinned to the failures that corpus actually holds, by
 * timestamp. The measured numbers are printed on every run, because they are the
 * deliverable.
 *
 * Nothing here builds the snapshot. That is the point: the test that was supposed
 * to run first ran first, and it came back refuted. See
 * `test/fixtures/failure-context/PROVENANCE.md` for the cut and for three things
 * the corpus exposed that the node does not say.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readVaultPointer } from "../../src/config/pointer.js";
import { readRuns } from "../../src/loop/health.js";
import { recentNonZeroExitSteps } from "../../src/loop/replay.js";
import {
  classifyTermination,
  discriminate,
  failureContextCensus,
  fieldExplainedClasses,
  formatFailureContextCensus,
  readCensus,
  readFailure,
  EXPLANATION_CLASSES,
  FAILURE_CONTEXT_RULE,
  OBSERVED_TERMINATION_CLASSES,
  SNAPSHOT_FIELDS,
  type ExplanationClass,
  type FieldValues,
  type LabelledFailure,
} from "../../src/telemetry/failure-context.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "failure-context", "failures.json");

interface CorpusFile {
  cutFrom: { vault: string; sessionsDir: string | null; sessionsRead: number };
  corpora: Record<
    string,
    {
      source: string;
      note: string;
      phases: string[];
      failures: LabelledFailure[];
      fieldsFull: { failures: FieldValues[]; successes: FieldValues[] };
      fieldsShape: { failures: FieldValues[]; successes: FieldValues[] };
    }
  >;
}

const CORPUS = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as CorpusFile;
const CURRENT = CORPUS.corpora.current;
const LEGACY = CORPUS.corpora.legacy;

/** The founding failure of the whole branch, by its recorded timestamp. */
const FOUNDING_FAILURE_AT = "2026-07-27T00:53:59.556Z";

const base: LabelledFailure = { at: "2026-01-01T00:00:00.000Z", phase: "build", exit: 1, durationMs: 10, command: "npx vitest run" };

// ── the rule, before any number is read off it ───────────────────────────────

describe("the rule was committed before the corpus was counted", () => {
  test("the bar is the one the node fixed: 7 of the 10 most recent", () => {
    expect(FAILURE_CONTEXT_RULE.bar).toBe(7);
    expect(FAILURE_CONTEXT_RULE.sample).toBe(10);
  });

  test("the fields are the four the threshold names, not the five the solution's prose lists", () => {
    // The solution also wants the dirty-file count and the environment variables
    // the step read. The threshold was written against four, and scoring a wider
    // set than the bar was written against is how a breached bar gets rescued.
    expect([...FAILURE_CONTEXT_RULE.fields]).toEqual(["cwd", "argv", "toolVersions", "gitSha"]);
    expect([...SNAPSHOT_FIELDS]).toEqual([...FAILURE_CONTEXT_RULE.fields]);
  });

  test("each explanation class declares once whether the snapshot carries it", () => {
    // The whole judgement of the census lives here rather than in a scoring
    // function, so a later reader can see it without tracing control flow.
    expect(fieldExplainedClasses().sort()).toEqual(["revision", "toolchain", "wrong-command", "wrong-place"]);
    for (const cls of Object.keys(EXPLANATION_CLASSES) as ExplanationClass[]) {
      const entry = EXPLANATION_CLASSES[cls];
      // A class inside the snapshot must name which field carries it; one outside
      // must not claim a field.
      expect(entry.within ? entry.field !== null : entry.field === null, `${cls} disagrees with its own field`).toBe(true);
      if (entry.field !== null) expect(SNAPSHOT_FIELDS).toContain(entry.field);
    }
  });

  test("every class the snapshot does not carry names something outside the invocation", () => {
    const outside = (Object.keys(EXPLANATION_CLASSES) as ExplanationClass[]).filter((c) => !EXPLANATION_CLASSES[c].within);
    expect(outside.sort()).toEqual(["host", "quota", "upstream"]);
  });
});

// ── channel one: the terminating record fires, and fails to fire ─────────────

describe("classifying what the failing process last said", () => {
  test("the host suspending is the host, not an upstream error, though it arrives as one", () => {
    // Verbatim from seven of the current ten. It is delivered as "API Error: …",
    // which the upstream pattern would otherwise swallow — the reason pattern
    // order is load-bearing and asserted.
    expect(classifyTermination("API Error: Your computer went to sleep mid-response. The response above may be incomplete.")).toBe("host");
  });

  test("a 529 is upstream", () => {
    expect(classifyTermination("API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.")).toBe(
      "upstream",
    );
  });

  test("a usage cap is quota, not upstream", () => {
    expect(classifyTermination("You've hit your weekly limit · resets 5pm (America/Chicago)")).toBe("quota");
  });

  test("a relative import that did not resolve is the wrong place — the founding case's shape", () => {
    expect(classifyTermination("Error: Cannot find module './src/telemetry/preflight.js'")).toBe("wrong-place");
    expect(classifyTermination("bash: line 1: cd: /nope: No such file or directory")).toBe("wrong-place");
  });

  test("a missing binary is the toolchain, and a bad flag is the command", () => {
    expect(classifyTermination("bash: pnpm: command not found")).toBe("toolchain");
    expect(classifyTermination("error: unknown option '--vualt'")).toBe("wrong-command");
  });

  test("an unrecognised string is null, never a guess", () => {
    // `null` is not "no cause" — it is "this text does not say", and it leaves the
    // failure to the other channel or to `unread`. Guessing a class out of an
    // unfamiliar string is how a census invents its own corpus.
    expect(classifyTermination("Recording the three examinations.")).toBeNull();
    expect(classifyTermination("")).toBeNull();
    expect(classifyTermination(undefined)).toBeNull();
    expect(classifyTermination("   ")).toBeNull();
  });

  test("a test failure is not a symptom of anything the snapshot holds", () => {
    // The tempting misclassification: a failing assertion is *about* the source,
    // so a reader reaches for `revision`. Nothing in the text says which revision,
    // and the rule does not pretend otherwise.
    expect(classifyTermination("FAIL test/x.test.ts > it works — expected 1 to be 2")).toBeNull();
  });

  test("the classes claimed as observed are the ones the committed corpus actually carries", () => {
    // Stops the comment above from drifting into a claim about failure modes this
    // vault has never had.
    const seenInCorpus = new Set(
      [...CURRENT.failures, ...LEGACY.failures].map((f) => classifyTermination(f.termination?.text)).filter((c): c is ExplanationClass => c !== null),
    );
    for (const cls of seenInCorpus) expect(OBSERVED_TERMINATION_CLASSES, `${cls} fired on the corpus but is not marked observed`).toContain(cls);
    expect([...seenInCorpus].sort()).toEqual(["host", "quota", "upstream"]);
  });
});

// ── channel two: the corrected re-run, and what happens when they disagree ───

describe("the corrected re-run outranks the terminating text", () => {
  test("a re-run that passed with a field changed is fully explained", () => {
    const reading = readFailure({ ...base, rerun: { at: "2026-01-01T00:01:00.000Z", command: "cd /repo && npx vitest run", changed: ["cwd"] } });
    expect(reading.coverage).toBe("explained");
    expect(reading.class).toBe("wrong-place");
    expect(reading.via).toEqual(["corrected-rerun"]);
  });

  test("a re-run that passed with nothing changed proves the fields did not explain it", () => {
    // The same invocation, in the same place, passing. Whatever moved is not in
    // the record — which is a finding, and the opposite of `unread`.
    const reading = readFailure({ ...base, rerun: { at: "2026-01-01T00:01:00.000Z", command: "npx vitest run", changed: [] } });
    expect(reading.coverage).toBe("not-explained");
    expect(reading.class).toBeNull();
  });

  test("text naming a field class does not survive a re-run that changed nothing", () => {
    // This is the disagreement case, and the direction matters: the re-run
    // observed a field NOT differing between fail and pass, which beats a guess
    // that the field was the kind of thing that broke.
    const reading = readFailure({
      ...base,
      termination: { session: "s", ts: "t", text: "Error: Cannot find module './x.js'" },
      rerun: { at: "2026-01-01T00:01:00.000Z", command: "npx vitest run", changed: [] },
    });
    expect(reading.coverage).toBe("not-explained");
    expect(reading.via).toEqual(["termination", "corrected-rerun"]);
  });

  test("text naming a field class with no re-run is partly, never fully", () => {
    // One channel is not full. The node asks for *fully* explained.
    const reading = readFailure({ ...base, termination: { session: "s", ts: "t", text: "Error: Cannot find module './x.js'" } });
    expect(reading.coverage).toBe("partly");
    expect(reading.class).toBe("wrong-place");
  });

  test("text naming something outside the snapshot is not explained, whatever else is there", () => {
    const reading = readFailure({ ...base, termination: { session: "s", ts: "t", text: "API Error: 529 Overloaded" } });
    expect(reading.coverage).toBe("not-explained");
    expect(reading.class).toBe("upstream");
  });

  test("neither channel is unread, and unread is not a zero", () => {
    const reading = readFailure(base);
    expect(reading.coverage).toBe("unread");
    expect(reading.via).toEqual([]);
  });
});

// ── the discriminability reading: two ways a field looks explanatory ─────────

describe("could the field have told a failure from a success", () => {
  const values = (over: Partial<FieldValues>[]): FieldValues[] =>
    over.map((v) => ({ cwd: null, argv: null, toolVersions: null, gitSha: null, ...v }));

  test("a field with the same value on every pass and every fail cannot discriminate", () => {
    const d = discriminate(values([{ cwd: "/repo" }, { cwd: "/repo" }]), values([{ cwd: "/repo" }, { cwd: "/repo" }]));
    expect(d.find((f) => f.field === "cwd")!.verdict).toBe("cannot-discriminate");
  });

  test("a field that takes a fresh value on every step is uninformative, not explanatory", () => {
    // The trap the git SHA walks into. Ten failures with ten distinct commits and
    // 299 successes with 299 more separates every step from every other step —
    // in any ledger at all — which is a statement about cardinality, not about
    // failures.
    const d = discriminate(values([{ gitSha: "a" }, { gitSha: "b" }]), values([{ gitSha: "c" }, { gitSha: "d" }]));
    expect(d.find((f) => f.field === "gitSha")!.verdict).toBe("uninformative");
  });

  test("a field whose failing value recurs on failures and never on successes does discriminate", () => {
    const d = discriminate(values([{ cwd: "/home" }, { cwd: "/home" }]), values([{ cwd: "/repo" }, { cwd: "/repo" }]));
    expect(d.find((f) => f.field === "cwd")!.verdict).toBe("discriminates");
  });

  test("a field nothing records is `not-recorded`, distinct from one that fails to discriminate", () => {
    // Tool versions. Reporting them as "cannot discriminate" would read as a
    // measurement of a field that has never been measured.
    const d = discriminate(values([{ cwd: "/a" }]), values([{ cwd: "/b" }]));
    expect(d.find((f) => f.field === "toolVersions")!.verdict).toBe("not-recorded");
  });
});

// ── the verdict derives the node's rule, not a friendlier one ────────────────

describe("readCensus", () => {
  const census = (explained: number, partly: number, notExplained: number, unread: number) => {
    const mk = (coverage: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({ failure: { ...base, at: `${coverage}-${i}` }, coverage, class: null, via: [], because: "" }));
    const readings = [...mk("explained", explained), ...mk("partly", partly), ...mk("not-explained", notExplained), ...mk("unread", unread)];
    return {
      scored: readings.length,
      readings: readings as never,
      explained,
      partly,
      notExplained,
      unread,
      fields: [],
    };
  };

  test("seven fully explained clears; six does not", () => {
    expect(readCensus(census(7, 0, 3, 0)).verdict).toBe("cleared");
    expect(readCensus(census(6, 0, 4, 0)).verdict).toBe("refuted");
  });

  test("`partly` never clears the bar, and never refutes it either", () => {
    // Seven partly-explained would clear a generous reading. It must not clear
    // this one: the node's word is "fully". But it must not read `refuted`
    // either — a `partly` is one channel naming a snapshot field with the other
    // silent, which is unsettled evidence, not evidence against. Only failures
    // positively explained by something outside the snapshot count against.
    const reading = readCensus(census(0, 7, 3, 0));
    expect(reading.verdict).toBe("undecidable");
    expect(reading.strict).toBe(0);
    expect(reading.generous).toBe(7);
  });

  test("but `partly` too thin to reach the bar does not rescue one", () => {
    expect(readCensus(census(0, 2, 8, 0)).verdict).toBe("refuted");
  });

  test("an unread set large enough to still carry the bar is undecidable, not refuted", () => {
    // A sweep that cannot read its subject must not report a clean result in
    // either direction.
    expect(readCensus(census(1, 0, 2, 7)).verdict).toBe("undecidable");
    expect(readCensus(census(1, 0, 8, 1)).verdict).toBe("refuted");
  });

  test("a corpus shorter than the sample cannot refute a bar written over ten", () => {
    // Without this, a two-failure cut reporting 0 explained would read `refuted`,
    // and cutting short would be a way to manufacture a refutation.
    expect(readCensus(census(0, 0, 2, 0)).verdict).toBe("undecidable");
    expect(readCensus(census(0, 0, 0, 0)).verdict).toBe("undecidable");
  });
});

// ── the control: a corpus where the fields do explain the failures ───────────

describe("the legacy corpus — the classifier fires", () => {
  test("both failures of the founding era are fully explained, by the re-run channel", () => {
    const c = failureContextCensus(LEGACY.failures, LEGACY.fieldsFull.failures, LEGACY.fieldsFull.successes);
    expect(c.scored).toBe(2);
    expect(c.explained).toBe(2);
    expect(c.notExplained).toBe(0);
    expect(c.unread).toBe(0);
    for (const r of c.readings) {
      expect(r.class).toBe("wrong-place");
      expect(r.via).toEqual(["corrected-rerun"]);
    }
  });

  test("the founding failure is in it, with the corrected re-run 63 seconds later", () => {
    const founding = LEGACY.failures.find((f) => f.at === FOUNDING_FAILURE_AT);
    expect(founding, "the founding failure is not in the control corpus").toBeDefined();
    expect(founding!.command).toContain("npx vitest run");
    expect(founding!.rerun!.changed).toEqual(["cwd"]);
    expect(Date.parse(founding!.rerun!.at) - Date.parse(founding!.at)).toBe(62_606);
  });

  test("and it does not count toward a bar written over ten failures", () => {
    expect(readCensus(failureContextCensus(LEGACY.failures, LEGACY.fieldsFull.failures, LEGACY.fieldsFull.successes)).verdict).toBe(
      "undecidable",
    );
  });

  test("the recorded `cwd` would NOT have separated the founding case from its own fix", () => {
    // The finding PROVENANCE.md states third. Both fixes inserted `cd <repo> &&`
    // INSIDE the `bash -c` payload, and `loop step` stamps the directory it
    // spawned from rather than the one the shell then moved to. So the failing
    // build and the passing re-run 73 seconds later carry the same recorded
    // `cwd`. The one case everybody agrees the field explains is a case the field
    // as currently written down does not discriminate — the re-run channel
    // catches it only because the `cd` is visible in the command text.
    const d = discriminate(LEGACY.fieldsFull.failures, LEGACY.fieldsFull.successes);
    expect(d.find((f) => f.field === "cwd")!.verdict).toBe("cannot-discriminate");
    const late = LEGACY.failures.find((f) => f.at === "2026-07-27T15:56:45.099Z")!;
    expect(late.cwd).toBe("/home/user/ost-agent-meta");
    expect(late.rerun!.command).toContain("cd /home/user/OST-Agent &&");
  });
});

// ── the result: the ten most recent recorded failures ────────────────────────

describe("the current corpus — the ten most recent recorded failures", () => {
  const census = failureContextCensus(CURRENT.failures, CURRENT.fieldsFull.failures, CURRENT.fieldsFull.successes);
  const reading = readCensus(census);

  test("it holds exactly the ten the threshold asks for", () => {
    expect(CURRENT.failures).toHaveLength(FAILURE_CONTEXT_RULE.sample);
    // Newest first, and every one a real non-refused failure.
    const times = CURRENT.failures.map((f) => Date.parse(f.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    for (const f of CURRENT.failures) expect(f.exit).not.toBe(0);
  });

  test("all ten are the same command — this ledger has one failing invocation shape", () => {
    // Not a curated sample: of 661 recorded steps, 82 exit non-zero, 19 are
    // spend-ceiling refusals, and all 63 remaining failures are a `pass`-phase
    // `claude -p` exiting 1. No cut of this ledger could have produced a mix.
    expect(new Set(CURRENT.failures.map((f) => f.phase))).toEqual(new Set(["pass"]));
    expect(new Set(CURRENT.failures.map((f) => f.exit))).toEqual(new Set([1]));
    expect(new Set(CURRENT.failures.map((f) => f.argv?.[0]))).toEqual(new Set(["claude"]));
    expect(CURRENT.phases).toEqual(["pass"]);
  });

  test("refuted: not one of the ten is explained by any of the four fields", () => {
    expect(census.explained).toBe(0);
    expect(census.partly).toBe(0);
    expect(census.notExplained).toBe(9);
    expect(census.unread).toBe(1);
    expect(reading.verdict).toBe("refuted");
  });

  test("and the verdict does not turn on how strictly `fully explained` was read", () => {
    // The strict reading is deliberately biased against the thing under test —
    // one channel is never enough. If the generous reading disagreed, that bias
    // would be carrying the result. It does not: both are zero.
    expect(reading.strict).toBe(0);
    expect(reading.generous).toBe(0);
    expect(reading.bar).toBe(7);
  });

  test("what actually explained them: seven host, one upstream, one quota, one unread", () => {
    const byClass = new Map<string, number>();
    for (const r of census.readings) byClass.set(r.class ?? "unread", (byClass.get(r.class ?? "unread") ?? 0) + 1);
    expect(Object.fromEntries(byClass)).toEqual({ host: 7, upstream: 1, quota: 1, unread: 1 });
  });

  test("the one unread failure is named, not absorbed into the count", () => {
    const unread = census.readings.filter((r) => r.coverage === "unread");
    expect(unread.map((r) => r.failure.at)).toEqual(["2026-08-25T22:26:16.199Z"]);
    expect(unread[0].failure.termination).toBeUndefined();
  });

  test("no failure has a corrected re-run — the node's worst case is 100% of the population", () => {
    // The node names this as the case it handles worst: *you get a snapshot of
    // the failing attempt but nothing to diff it against, because the passing run
    // recorded nothing.* Every `pass` argv embeds the current tree in its prompt,
    // so no two invocations are ever textually identical and the channel that
    // could prove a field mattered is unavailable for every failure here.
    expect(CURRENT.failures.filter((f) => f.rerun !== undefined)).toEqual([]);
  });

  test("no field discriminates, under either reading of `resolved argv`", () => {
    // `fieldsFull` keeps the prompt, making every argv unique; `fieldsShape`
    // reduces it to executable plus option names, making them all identical. The
    // verdict survives either choice, which is why both are committed.
    for (const projection of ["fieldsFull", "fieldsShape"] as const) {
      const d = discriminate(CURRENT[projection].failures, CURRENT[projection].successes);
      for (const f of d) expect(f.verdict, `${projection}/${f.field} discriminates`).not.toBe("discriminates");
    }
    expect(discriminate(CURRENT.fieldsFull.failures, CURRENT.fieldsFull.successes).find((f) => f.field === "cwd")!.verdict).toBe(
      "cannot-discriminate",
    );
    // The cardinality trap, on real data: ten distinct commits over ten failures
    // and 299 more over the successes, sharing none.
    expect(discriminate(CURRENT.fieldsFull.failures, CURRENT.fieldsFull.successes).find((f) => f.field === "gitSha")!.verdict).toBe(
      "uninformative",
    );
    expect(CURRENT.fieldsFull.successes.length).toBeGreaterThan(200);
  });

  test("tool versions are scored as never recorded, not as failing to explain", () => {
    // Two of the four fields are in the record today; one is not, and one is only
    // there at run granularity. Reporting the unrecorded one as "did not explain"
    // would be a measurement of a field nobody has ever measured.
    const d = discriminate(CURRENT.fieldsFull.failures, CURRENT.fieldsFull.successes);
    expect(d.find((f) => f.field === "toolVersions")!.verdict).toBe("not-recorded");
    expect(CURRENT.failures.every((f) => typeof f.gitSha === "string")).toBe(true);
  });

  test("the count IS the deliverable, and it is printed", () => {
    const report = formatFailureContextCensus(CURRENT.source, census, reading);
    expect(report).toContain("REFUTED");
    // Every failure reaches the person who has to judge it. A count whose list is
    // shorter than the count is not a count anybody can check.
    for (const f of CURRENT.failures) expect(report).toContain(f.at);
    // eslint-disable-next-line no-console -- the coverage count is what a person re-reads the node against.
    console.log(report);
    console.log(formatFailureContextCensus(`${LEGACY.source} (control)`, ...(() => {
      const c = failureContextCensus(LEGACY.failures, LEGACY.fieldsFull.failures, LEGACY.fieldsFull.successes);
      return [c, readCensus(c)] as const;
    })()));
  });
});

// ── the committed projection, held against the ledger it came from ───────────

function liveVault(): string | null {
  try {
    const pointed = readVaultPointer(REPO_ROOT).dir;
    return fs.existsSync(path.join(pointed, "ost.config.yaml")) ? pointed : null;
  } catch {
    return null;
  }
}

const VAULT = liveVault();

describe.runIf(VAULT !== null)("the committed corpus against the live ledger", () => {
  test("every committed failure is still in the ledger, with the same fields", () => {
    // The one claim PROVENANCE.md makes that a reader would otherwise take on
    // faith: that these ten were read off the ledger rather than assembled. No
    // bar is asserted — the ledger grows, and a spec pinning today's ten would go
    // red on the next firing that records a step.
    const live = readRuns(VAULT!).flatMap((r) => r.steps);
    const byAt = new Map(live.map((s) => [s.at, s]));
    for (const f of CURRENT.failures) {
      const step = byAt.get(f.at);
      expect(step, `${f.at} is committed but not in the live ledger`).toBeDefined();
      expect(step!.phase).toBe(f.phase);
      expect(step!.exit).toBe(f.exit);
      expect(step!.cwd).toBe(f.cwd);
      expect(step!.refused).toBeUndefined();
    }
  });

  test("the population is still one failing invocation shape", () => {
    // If this ever goes red it is the good kind of red: this vault's loop started
    // failing in a second way, and the refutation is worth re-cutting against the
    // wider mix. `scripts/harvest-failure-context-corpus.ts` re-runs the cut.
    const failing = recentNonZeroExitSteps(readRuns(VAULT!), 500);
    expect(failing.length).toBeGreaterThan(0);
    expect(new Set(failing.map((s) => s.argv?.[0] ?? s.command.split(/\s+/)[0]))).toEqual(new Set(["claude"]));
  });
});
