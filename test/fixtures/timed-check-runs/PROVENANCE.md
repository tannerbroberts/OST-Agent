# timed-check-runs

Every execution of this repository's test suite that the record can see, over the
thirty days ending **2026-09-01T00:00:00Z**, with where it ran.

Cut by `scripts/harvest-timed-check-run-corpus.ts`:

```
npx tsx scripts/harvest-timed-check-run-corpus.ts \
  ~/.claude/projects tannerbroberts/OST-Agent test/fixtures/timed-check-runs 2026-09-01
```

It is the denominator for "Count how many timed checks would run somewhere that
cannot guarantee isolation", the assumption test beneath **"Run the timed check
under isolation, or do not let it fail the build at all"**. Read this before
believing anything in `test/release/timed-check-isolation-share.test.ts`.

## What is in it

2,628 runs, each `{ at, location, filters }` — `filters: null` for a whole-suite
run, otherwise the positionals the invocation named. Local runs also carry the
session id and the first 160 characters of the command, so any single row can be
checked against the transcript it came from.

| source | runs | whole-suite | filtered |
| --- | --- | --- | --- |
| `ci-github-hosted` | 451 | 451 | 0 |
| `operator-workstation-unattended` | 1,784 | 713 | 1,071 |
| `operator-workstation-interactive` | 393 | 143 | 250 |
| `contributor-workstation` | 0 | 0 | 0 |

Folded against the ten gating checks in `src/release/timed-checks.declared.ts`
that is **11,939 timed-check executions, 4,059 of them isolable — 34.0%, against
a bar of 50%.**

**Two records, two readings.**

- **GitHub Actions.** `gh api /repos/tannerbroberts/OST-Agent/actions/workflows/ci.yml/runs`,
  every run created inside the window. One run is one execution of the `test`
  job, which is `npm test`, which is the whole suite. The 4 runs whose conclusion
  was `cancelled` are **kept**, because dropping them would shrink the isolable
  side.
- **This workstation.** Every `Bash` tool call in a Claude Code transcript under
  `~/.claude/projects` whose project directory names this repository or one of
  its vaults, parsed by `suiteInvocations`
  (`src/release/timed-check-isolation.ts`). A session's own `entrypoint` header
  says which local location it was: `sdk-cli` is the unattended loop firing
  `claude -p`, everything else (`cli`, `claude-desktop`) is a person at the
  keyboard. 285 distinct sessions.

**Nothing is filtered on the way in.** Failing runs, filtered runs, runs that
named a single unrelated file — all of them are here, because the census is a
share and any selection applied at harvest is a thumb on it.

## What it cannot see

Three kinds of run leave no record this script can read, and **all three are
workstation runs**:

1. A suite run the operator types into a terminal.
2. `ost-agent ship` runs both core gates as subprocesses of itself, so the
   loop's own pre-merge suite run — one per shipped branch — is invisible.
3. Anything on a machine that is not this one.

Every one of those would increase the non-isolable side. **The share this corpus
produces is therefore an upper bound on the real one**, which is the direction
that matters for a result that came out refuted.

## Where the thumb was deliberately placed

The finding is a refutation, so every discretionary choice was made in the
direction that would flatter the assumption, and it still misses:

- Cancelled CI runs counted as full suite runs (+4 isolable).
- A GitHub-hosted runner counted as a place isolation **could** be guaranteed,
  on the assumption test's own modal wording, even though the suite currently
  runs 348 files in parallel on its two cores. The narrow reading — "the check
  runs alone there today" — returns zero before any counting starts.
- Only recorded workstation runs counted, per the section above.

## The one classification the verdict turns on

At 34.0%, the verdict flips only if the **unattended workstation** counts as a
place isolation can be guaranteed: that reading gives 89.0%. It is refused
because the loop's lock serialises loop passes against each other and nothing
else — this corpus contains 24 whole-suite workstation runs (of 856) that started
while a *different* session's run was still in flight, all 24 across the
unattended/interactive boundary — and because the foreign load that actually
convicted a check here was never another suite run. It was the rest of a laptop:
`test/mcp/wall-clock-budget.test.ts` failed at 2004ms against a 2000ms bar inside
the full suite and passed by an enormous margin alone, seconds later, with no
code changed between the two.

## What the machine was doing while this was verified

Not an anecdote — it is the classification above, observed. While the suite that
verifies this census ran on the operator's workstation, `ps` put a foreground
game at 44.3% of CPU and the window server at 25.9%, with a one-minute load
average of 2.94 against a five-minute 8.57. The suite took 959 s against the
207–413 s range `docs/reference/v1-readiness.md` records for it;
`test/loop/inherited-tree-build-check.test.ts` failed its 30-second bound at
38.264 s, and six tests in `test/ost/vault-merge-conflict-census.test.ts` — a
file that times nothing — hit the suite's own 20-second per-test timeout. Run
alone on the same machine minutes later, the first took 1.775 s (a 21.6x
difference) and the second's six tests took 2.3–2.7 s each. Nothing in either
file changed between those runs.

## What a reader should not take from it

It counts runs, not importance — the node says so itself. The place isolation is
impossible is also the place every change is written, so the check that cannot
gate there is the check that cannot gate where regressions are introduced. A
share cannot show that, and this one does not.
