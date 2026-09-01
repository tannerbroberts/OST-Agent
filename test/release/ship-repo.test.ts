/**
 * The shipping sequence, driven entirely through an injected runner.
 *
 * What these pin is the ORDER and the refusals — the properties that make a
 * local merge as trustworthy as the CI wait it replaces:
 *
 *   - the branch is synced with the merge target BEFORE the gates run, because
 *     a branch that is green alone is not evidence that `main` stays green;
 *   - nothing merges while a gate is red;
 *   - a conflicting sync aborts and refuses rather than resolving;
 *   - `gh pr checks` is never called, by anything, ever.
 */
import { describe, expect, test } from "vitest";
import { ship } from "../../src/release/ship-repo.js";
import type { Runner } from "../../src/release/ship.js";

type Answer = { status: number | null; output: string };

/** Default answers for a clean feature branch two commits ahead of a current main. */
const CLEAN: Record<string, Answer> = {
  "git rev-parse --abbrev-ref HEAD": { status: 0, output: "feature\n" },
  "git status --porcelain": { status: 0, output: "" },
  "git rev-list --left-right --count origin/main...HEAD": { status: 0, output: "0\t2\n" },
  "git fetch origin main": { status: 0, output: "" },
  "git rev-list --count HEAD..origin/main": { status: 0, output: "0\n" },
  "git diff --name-only origin/main...HEAD": { status: 0, output: "docs/notes.md\n" },
};

function harness(overrides: Record<string, Answer> = {}) {
  const answers = { ...CLEAN, ...overrides };
  const calls: string[] = [];
  const run: Runner = (argv) => {
    const key = argv.join(" ");
    calls.push(key);
    return answers[key] ?? { status: 0, output: "" };
  };
  return { run, calls };
}

describe("the order that makes local gating equivalent to a PR run", () => {
  test("origin/main is merged in BEFORE any gate runs", () => {
    const { run, calls } = harness({
      "git rev-list --count HEAD..origin/main": { status: 0, output: "3\n" },
    });
    ship({ repo: "/repo", run });

    const merged = calls.indexOf("git merge --no-edit origin/main");
    const gated = calls.indexOf("npx tsc --noEmit");
    expect(merged).toBeGreaterThan(-1);
    expect(gated).toBeGreaterThan(merged);
  });

  test("an up-to-date branch is not merged with itself", () => {
    const { run, calls } = harness();
    ship({ repo: "/repo", run });
    expect(calls).not.toContain("git merge --no-edit origin/main");
  });

  test("a conflicting sync aborts, refuses, and never merges", () => {
    const { run, calls } = harness({
      "git rev-list --count HEAD..origin/main": { status: 0, output: "3\n" },
      "git merge --no-edit origin/main": { status: 1, output: "CONFLICT (content): both modified src/a.ts" },
    });
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(calls).toContain("git merge --abort");
    expect(outcome.refusals.join(" ")).toContain("conflicts");
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    // The gates never ran either: measuring a half-merged tree proves nothing.
    expect(calls).not.toContain("npx tsc --noEmit");
  });

  test("a fetch that fails does not block the merge, but is reported", () => {
    // The whole point of this change is that the network is off the critical
    // path. An unreachable remote narrows what the gates measured; it does not
    // become a reason to stop shipping.
    const lines: string[] = [];
    const { run } = harness({ "git fetch origin main": { status: 1, output: "could not resolve host" } });
    const outcome = ship({ repo: "/repo", run, log: (l) => lines.push(l) });
    expect(outcome.shipped).toBe(true);
    expect(lines.join(" ")).toContain("this branch alone");
  });
});

describe("nothing merges on an unearned green", () => {
  test("a red gate stops the merge", () => {
    const { run, calls } = harness({ "npx vitest run": { status: 1, output: "1 failed" } });
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    expect(calls).not.toContain("git push --set-upstream origin feature");
    expect(outcome.summary).toContain("vitest");
  });

  test("a stale committed bundle is red even though the generator exits 0", () => {
    // `npm run bundle` succeeds at rebuilding; the drift is what it left behind.
    const { run, calls } = harness({
      "git diff --name-only origin/main...HEAD": { status: 0, output: "src/ost/search.ts\n" },
      "git status --porcelain -- dist/ost-agent.mjs": { status: 0, output: " M dist/ost-agent.mjs\n" },
    });
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.summary).toContain("bundle-drift");
    // …and it puts the file back, so a refusal does not leave the tree dirty
    // for the next pass's preconditions to trip over.
    expect(calls).toContain("git checkout -- dist/ost-agent.mjs");
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a dry run clears every gate and still does not merge", () => {
    const { run, calls } = harness();
    const outcome = ship({ repo: "/repo", dryRun: true, run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.gateRuns.every((r) => r.passed)).toBe(true);
    expect(outcome.summary).toContain("would have merged");
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("a dirty tree is refused before anything is run", () => {
    const { run, calls } = harness({ "git status --porcelain": { status: 0, output: " M src/a.ts\n" } });
    const outcome = ship({ repo: "/repo", run });
    expect(outcome.shipped).toBe(false);
    expect(calls).not.toContain("npx tsc --noEmit");
  });
});

describe("the merge itself", () => {
  test("green gates squash-merge and delete the branch", () => {
    const { run, calls } = harness();
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(true);
    expect(calls).toContain("git push --set-upstream origin feature");
    expect(calls).toContain("gh pr merge feature --squash --delete-branch --admin");
  });

  test("a push failure is reported rather than merged past", () => {
    const { run, calls } = harness({
      "git push --set-upstream origin feature": { status: 1, output: "rejected: non-fast-forward" },
    });
    const outcome = ship({ repo: "/repo", run });
    expect(outcome.shipped).toBe(false);
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
    expect(outcome.summary).toContain("push");
  });

  test("NOTHING in the sequence ever polls a check", () => {
    // The regression this whole module exists to prevent. If a future edit
    // reintroduces a wait on GitHub Actions, this is what says so.
    const { run, calls } = harness();
    ship({ repo: "/repo", run });
    expect(calls.some((c) => c.includes("pr checks"))).toBe(false);
    expect(calls.some((c) => c.includes("--watch"))).toBe(false);
    expect(calls.some((c) => c.includes("sleep"))).toBe(false);
  });
});

describe("the mergeability race, which is not a check poll", () => {
  /*
   * GitHub recomputes a pull request's mergeability asynchronously after a push.
   * Observed on #70: `gh pr merge` reported "Pull Request has merge conflicts"
   * seconds after a push, and `gh pr view` read MERGEABLE moments later with
   * nothing changed in between. That is a stale field settling with every input
   * already in hand — bounded, and it finishes. A CI run is work that has not
   * started and may never be scheduled. Retrying the first is not the thing this
   * module removed, and these pin the line between them.
   */
  function mergeAnswers(sequence: Answer[]) {
    let i = 0;
    const calls: string[] = [];
    const slept: number[] = [];
    const run: Runner = (argv) => {
      const key = argv.join(" ");
      calls.push(key);
      if (key.startsWith("gh pr merge")) return sequence[Math.min(i++, sequence.length - 1)]!;
      return CLEAN[key] ?? { status: 0, output: "" };
    };
    return { run, calls, slept, sleep: (ms: number) => slept.push(ms) };
  }

  test("a stale mergeability answer is retried and then succeeds", () => {
    const h = mergeAnswers([
      { status: 1, output: "GraphQL: Pull Request has merge conflicts (mergePullRequest)" },
      { status: 0, output: "merged" },
    ]);
    const outcome = ship({ repo: "/repo", run: h.run, sleep: h.sleep });

    expect(outcome.shipped).toBe(true);
    expect(h.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(2);
    expect(h.slept).toEqual([2000]);
  });

  test("a real refusal is NOT retried — it is reported on the first answer", () => {
    // Retrying a closed PR or a permissions error spends four more seconds
    // arriving at the same place, and makes a real failure look like a flake.
    const h = mergeAnswers([{ status: 1, output: "GraphQL: Pull request is closed" }]);
    const outcome = ship({ repo: "/repo", run: h.run, sleep: h.sleep });

    expect(outcome.shipped).toBe(false);
    expect(h.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(1);
    expect(h.slept).toEqual([]);
  });

  test("the retry is bounded, so a permanently stuck merge still reports", () => {
    const h = mergeAnswers([{ status: 1, output: "Pull Request has merge conflicts" }]);
    const outcome = ship({ repo: "/repo", run: h.run, sleep: h.sleep });

    expect(outcome.shipped).toBe(false);
    expect(h.calls.filter((c) => c.startsWith("gh pr merge"))).toHaveLength(5);
    expect(outcome.summary).toContain("not shipped");
  });
});

describe("reading the branch against origin, and what an unreadable comparison says", () => {
  test("a comparison that will not run refuses as itself, and never as an empty branch", () => {
    // `git rev-list ... origin/main...HEAD` exits non-zero when there is no
    // remote-tracking ref at all. That answer used to be caught and turned into
    // `ahead: 0`, which the refusal then reported as "nothing to merge" — a
    // sentence about commits, describing a missing ref.
    const { run, calls } = harness({
      "git rev-list --left-right --count origin/main...HEAD": {
        status: 128,
        output: "fatal: ambiguous argument 'origin/main...HEAD': unknown revision\n",
      },
    });
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.refusals).toHaveLength(1);
    expect(outcome.refusals[0]).toContain("could not compare");
    expect(outcome.refusals[0]).not.toMatch(/There is nothing to merge\.$/);
    // It refuses before anything is measured, so no gate ran and nothing merged.
    expect(calls).not.toContain("npx tsc --noEmit");
    expect(calls.some((c) => c.startsWith("gh pr merge"))).toBe(false);
  });

  test("output that is not two counts is unreadable, not agreement", () => {
    // A `git` that exits 0 while printing something else must not be read as
    // "0 behind, 0 ahead" — the same fail-open the exit-laundering rule refuses.
    const { run } = harness({
      "git rev-list --left-right --count origin/main...HEAD": { status: 0, output: "warning: something\n" },
    });
    const outcome = ship({ repo: "/repo", run });

    expect(outcome.shipped).toBe(false);
    expect(outcome.refusals.join(" ")).toContain("could not compare");
  });
});
