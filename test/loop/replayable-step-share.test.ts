/**
 * The instrument for "Count how many recorded steps are safely replayable at
 * all" — the assumption test beneath "Replay a recorded failure in its recorded
 * context on demand" in the meta vault.
 *
 * The bar it pre-committed: **at least 60% of recorded steps from the last
 * thirty days classify as side-effect-free by a fixed rule, with no
 * case-by-case judgement.** Steps needing a human to decide count as failures
 * of the rule rather than as passes.
 *
 * **It came out REFUTED, and not narrowly.** 278 of 619 steps — 44.9% — clear
 * the allowlist. Every weekly sub-window of the thirty lands between 37% and
 * 50%, so the miss is not an artefact of where the window was cut. And the
 * number that decides the row is worse than the headline: of the 63 recorded
 * steps that are a command which actually ran and exited non-zero — a recorded
 * *failure*, the thing this solution exists to replay — **zero** are
 * replayable.
 *
 * **The rule's breadth is not what refused them.** This vault's ledger holds
 * exactly two distinct commands across thirty days: `ost-agent check …` (278)
 * and `claude -p …` (341). Every refusal is the second one, an agent pass that
 * edits files, commits and pushes. No allowlist of read-only verbs can admit
 * it, so 44.9% is a *ceiling* on this corpus rather than this allowlist's
 * score — a point the tests below assert directly, because "your list was too
 * short" is the first thing a reader should suspect of a refuted rule.
 *
 * Per the solution node, a red result here does not kill the row: it redirects
 * it to the sibling "Snapshot the resolved environment, but only for the step
 * that failed", which asks for portability of explanation instead of certainty
 * of answer and does not need the step to be safe to re-run.
 *
 * See `test/fixtures/replayable-steps/PROVENANCE.md` before believing anything
 * here.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  READ_ONLY_ALLOWLIST,
  REPLAYABLE_SHARE_BAR,
  classifyReplayable,
  normalizeArgv,
  replayableShare,
} from "../../src/loop/replayable.js";

interface CorpusStep {
  runId: string;
  phase: string;
  command: string;
  argv?: string[];
  cwd?: string;
  exit: number;
  at: string;
  refused?: string;
}

const fixtureDir = path.join(__dirname, "../fixtures/replayable-steps");
const corpus = JSON.parse(fs.readFileSync(path.join(fixtureDir, "steps.json"), "utf8")) as {
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  steps: CorpusStep[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

describe("the rule was fixed before the corpus was read", () => {
  const ruleSource = fs.readFileSync(path.join(__dirname, "../../src/loop/replayable.ts"), "utf8");

  test("the rule module reads no ledger and no fixture", () => {
    // The node's own text makes the ordering load-bearing rather than the
    // threshold: an allowlist derived from the sample and scored against that
    // same sample looks identical to one that was not. This is the structural
    // half of that guarantee — the rule cannot have seen the corpus, because it
    // has no way to open it. (The other half is the commit order, recorded in
    // PROVENANCE.md.)
    expect(ruleSource).not.toContain("fixtures");
    expect(ruleSource).not.toContain("runs.jsonl");
    expect(ruleSource).not.toMatch(/from "node:fs"/);
  });

  test("it names the verbs the assumption test named, not verbs read off the sample", () => {
    const phrases = READ_ONLY_ALLOWLIST.map((v) => v.phrase.join(" "));
    for (const named of ["vitest", "tsc", "ost-agent check", "git status"]) {
      expect(phrases).toContain(named);
    }
  });

  test("the allowlist is far wider than the corpus needs — only one entry ever matches", () => {
    // Stated as a test rather than as prose because it is the answer to the
    // first objection a refuted rule attracts. 44 verbs are on the list; this
    // vault's thirty days exercise exactly one of them.
    const matched = new Set(
      corpus.steps.map((s) => classifyReplayable(s.argv)).flatMap((v) => (v.replayable ? [v.verb] : [])),
    );
    expect(READ_ONLY_ALLOWLIST.length).toBeGreaterThan(40);
    expect([...matched]).toEqual(["ost-agent check"]);
  });
});

describe("normalizeArgv", () => {
  test("resolves an interpreter-launched CLI to the verb it is", () => {
    expect(normalizeArgv(["node", "/repo/dist/ost-agent.mjs", "check", "--vault", "."])).toEqual([
      "ost-agent",
      "check",
      "--vault",
      ".",
    ]);
  });

  test("drops a package runner and its flags", () => {
    expect(normalizeArgv(["npx", "--yes", "vitest", "run"])).toEqual(["vitest", "run"]);
    expect(normalizeArgv(["pnpm", "dlx", "tsc", "--noEmit"])).toEqual(["tsc", "--noEmit"]);
  });

  test("drops leading environment assignments", () => {
    expect(normalizeArgv(["CI=1", "FORCE_COLOR=0", "npx", "vitest"])).toEqual(["vitest"]);
  });

  test("reduces an absolute executable to its basename", () => {
    expect(normalizeArgv(["/usr/bin/git", "status"])).toEqual(["git", "status"]);
  });

  test("drops `git -C <dir>`, which says where it runs and not what it does", () => {
    expect(normalizeArgv(["git", "-C", "/repo", "log", "-1"])).toEqual(["git", "log", "-1"]);
  });

  test("leaves an unrecognised head alone", () => {
    expect(normalizeArgv(["claude", "-p", "do the thing"])).toEqual(["claude", "-p", "do the thing"]);
  });
});

describe("classifyReplayable", () => {
  test("clears an allowlisted verb", () => {
    expect(classifyReplayable(["npx", "vitest", "run"])).toEqual({ replayable: true, verb: "vitest" });
  });

  test("clears the CLI form the loop actually spawns", () => {
    expect(classifyReplayable(["node", "/repo/dist/ost-agent.mjs", "check", "--vault", "."])).toEqual({
      replayable: true,
      verb: "ost-agent check",
    });
  });

  test("refuses a verb the list does not name — unknown means no", () => {
    const verdict = classifyReplayable(["claude", "-p", "build the thing"]);
    expect(verdict).toEqual({ replayable: false, reason: "not-on-allowlist", head: "claude" });
  });

  test("refuses bare `tsc`, which emits, and clears `tsc --noEmit`", () => {
    expect(classifyReplayable(["tsc"])).toEqual({
      replayable: false,
      reason: "missing-required-flag",
      head: "tsc",
    });
    expect(classifyReplayable(["tsc", "--noEmit"])).toEqual({ replayable: true, verb: "tsc" });
  });

  test("refuses a mutating subcommand of an otherwise-read-only tool", () => {
    // `git branch -D` is why `git branch` is not on the list at all: a
    // token-prefix rule cannot tell the deleting form from the listing one, so
    // the whole verb stays off rather than being admitted with a caveat.
    expect(classifyReplayable(["git", "branch", "-D", "topic"]).replayable).toBe(false);
    expect(classifyReplayable(["git", "push", "--force"]).replayable).toBe(false);
  });

  test("refuses a shell wrapper rather than looking inside it", () => {
    expect(classifyReplayable(["sh", "-c", "git status && rm -rf /"]).replayable).toBe(false);
    expect(classifyReplayable(["bash", "script.sh"]).replayable).toBe(false);
  });

  test("refuses a record with no argv — the rule has no invocation to judge", () => {
    expect(classifyReplayable(undefined)).toEqual({ replayable: false, reason: "no-argv", head: "" });
    expect(classifyReplayable([])).toEqual({ replayable: false, reason: "no-argv", head: "" });
  });
});

describe("replayableShare", () => {
  test("counts every step given, and reports the refusals behind the number", () => {
    const result = replayableShare([["vitest"], ["claude", "-p", "x"], ["tsc"], undefined]);
    expect(result).toMatchObject({ total: 4, replayable: 1, share: 0.25 });
    expect(result.byReason).toEqual({
      "allowed:vitest": 1,
      "refused:not-on-allowlist": 1,
      "refused:missing-required-flag": 1,
      "refused:no-argv": 1,
    });
  });

  test("an empty corpus scores 0, not a vacuous 1", () => {
    // "There was no work" is not evidence that replay covers the work.
    expect(replayableShare([]).share).toBe(0);
  });
});

describe("the corpus is the window, not a sample of it", () => {
  test("is a thirty-day window", () => {
    expect(corpus.windowDays).toBe(30);
    expect(Date.parse(corpus.windowEnd) - Date.parse(corpus.windowStart)).toBe(30 * DAY_MS);
  });

  test("every step falls inside the window", () => {
    for (const step of corpus.steps) {
      const at = Date.parse(step.at);
      expect(at).toBeGreaterThanOrEqual(Date.parse(corpus.windowStart));
      expect(at).toBeLessThan(Date.parse(corpus.windowEnd));
    }
  });

  test("nothing was filtered on the way in — successes, failures and refusals are all here", () => {
    // The share is over EVERY recorded step. Any selection applied at harvest
    // is a thumb on the number, so the presence of all three outcome classes is
    // asserted rather than assumed.
    expect(corpus.steps.some((s) => s.exit === 0)).toBe(true);
    expect(corpus.steps.some((s) => s.exit !== 0 && s.refused === undefined)).toBe(true);
    expect(corpus.steps.some((s) => s.refused !== undefined)).toBe(true);
    expect(corpus.steps).toHaveLength(619);
  });
});

describe("what this vault's thirty days actually contain", () => {
  test("two distinct commands, and the majority one is the agent pass itself", () => {
    const heads = new Map<string, number>();
    for (const step of corpus.steps) {
      const head = normalizeArgv(step.argv ?? []).slice(0, 2).join(" ");
      heads.set(head, (heads.get(head) ?? 0) + 1);
    }
    expect([...heads.entries()].sort()).toEqual([
      ["claude -p", 341],
      ["ost-agent check", 278],
    ]);
  });

  test("no allowlist could clear the bar here — the ceiling is 44.9%", () => {
    // The strongest form of "the rule is not what refused them": grant every
    // non-`claude` command, for free, whatever it is. The share still misses.
    const ceiling =
      corpus.steps.filter((s) => normalizeArgv(s.argv ?? [])[0] !== "claude").length / corpus.steps.length;
    expect(ceiling).toBeCloseTo(0.449, 3);
    expect(ceiling).toBeLessThan(REPLAYABLE_SHARE_BAR);
  });

  test("no weekly sub-window clears the bar either", () => {
    const start = Date.parse(corpus.windowStart);
    const weekly: number[] = [];
    for (let week = 0; week < 4; week += 1) {
      const from = start + week * 7 * DAY_MS;
      const steps = corpus.steps.filter((s) => {
        const at = Date.parse(s.at);
        return at >= from && at < from + 7 * DAY_MS;
      });
      weekly.push(replayableShare(steps.map((s) => s.argv)).share);
    }
    expect(weekly.every((share) => share < REPLAYABLE_SHARE_BAR)).toBe(true);
    expect(Math.max(...weekly)).toBeLessThan(0.5);
  });
});

describe("THE ASSUMPTION IS REFUTED", () => {
  const result = replayableShare(corpus.steps.map((s) => s.argv));

  test("44.9% of recorded steps are safely replayable, against a 60% bar", () => {
    expect(result.total).toBe(619);
    expect(result.replayable).toBe(278);
    expect(result.share).toBeCloseTo(0.449, 3);
    expect(result.share).toBeLessThan(REPLAYABLE_SHARE_BAR);
  });

  test("every refusal is the same command: the agent pass", () => {
    expect(result.byReason).toEqual({
      "allowed:ost-agent check": 278,
      "refused:not-on-allowlist": 341,
    });
  });

  test("not one recorded FAILURE is replayable — the share overstates the coverage", () => {
    // The headline number is over all steps, because that is what the
    // assumption test asked for. But replay is for a recorded *failure*, and on
    // that population the answer is not 44.9% — it is zero. Every command in
    // this window that ran and exited non-zero is a `claude -p` agent pass.
    const failures = corpus.steps.filter((s) => s.exit !== 0 && s.refused === undefined);
    expect(failures).toHaveLength(63);
    expect(replayableShare(failures.map((s) => s.argv)).replayable).toBe(0);
  });

  test("the 19 replayable non-zero exits are refusals that never spawned anything", () => {
    // `refused: "spend-ceiling"` steps carry perfect `cwd`/`argv` because the
    // CLI stamps both from its own process state before the ceiling check runs
    // — they say what WOULD have run. Counting them as replayable failures is
    // the vacuous pass `test/fixtures/record-replay/PROVENANCE.md` already
    // names; they are the entire replayable half of the non-zero exits.
    const nonZero = corpus.steps.filter((s) => s.exit !== 0);
    const replayableNonZero = nonZero.filter((s) => classifyReplayable(s.argv).replayable);
    expect(replayableNonZero).toHaveLength(19);
    expect(replayableNonZero.every((s) => s.refused === "spend-ceiling")).toBe(true);
  });
});
