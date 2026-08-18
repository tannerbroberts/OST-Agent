# Credentialed-step corpus — how it was cut, and what the classification rests on

`test/loop/credentialed-step-independence.test.ts` asks how much of a past run's work sat
upstream of the first step that needed the operator's own credential. The assumption test
it implements ("Classify the steps of ten past runs as credentialed or not, and see how
much work sits upstream", in the meta vault) pre-committed its corpus size and its bar
before this fixture existed: **ten past runs**, at least half of a run's steps independent
of any credentialed step, in at least 6 of the 10 runs — asserted over the distribution,
never the mean.

## The cut

The candidate pool is this repository's own Claude Code session transcripts
(`~/.claude/projects/-Users-tanner-dev-OST-Agent/`) — the same directory
`src/adapters/transcript.ts` already harvests as usage evidence. As of 2026-08-18, that
directory held 98 sessions. The cut, entirely by file metadata:

1. Sort by modification time, newest first.
2. Keep the first ten whose tool-use step count is at least 10 — a session with fewer
   steps is a stray click-through or an aborted start, not "a run" in the sense the
   assumption test means.

`scripts/harvest-credentialed-steps.ts` re-runs exactly this extraction (step count, tool
name, and — for `Bash` — the command line, redacted and capped at 400 characters) against
the ten session ids it names, so the corpus can be regenerated and checked against the raw
transcripts instead of trusted:

```
npx tsx scripts/harvest-credentialed-steps.ts ~/.claude/projects/-Users-tanner-dev-OST-Agent
```

## What is mechanical and what is authored

Everything in `runs.json` is mechanical. Every field — the tool name, the reduced command
text — is read verbatim off the transcript (through `redactSecrets`, the same masking
`src/adapters/transcript.ts` applies before anything reaches a committed file). No field is
a paraphrase or a judgement call about *this run*; the ten runs are exactly the ten
sessions with the most recent activity in this repository at the time the corpus was cut.

What is authored is the classification **rule**, `classifyStep` in
`src/loop/credentialedSteps.ts`: which tool names and which command shapes count as
spending a credential the operator holds. It is fixed by the four surfaces this repo's own
credential broker gates (Slack, Atlassian, brokered search, the GitHub Actions read) plus
the two credentials this build loop itself blocks on (`git push`/`fetch`/`pull`, any `gh`
call) and two more of the same shape (`curl`/`wget`, `npm publish`/`login`). The rule is
named in code so it can be argued with, and it is applied to all ten runs uniformly rather
than tuned per run.

## What the replay does and does not certify

**Positional, not causal.** A step counts as independent only if it sits strictly before
the run's first credentialed step. A later step that is not itself credentialed is still
not counted, because it may consume the credentialed step's output and the run's own order
is the only dependency signal available. The computed fraction is therefore a FLOOR on how
much work could run before an approval gate, not an estimate of it.

**The runs were written by an agent that already stops at the first block.** This is the
solution node's own caveat, restated here because the corpus makes it concrete: only three
of the ten runs in this cut (`run-01`, `run-09`, `run-10`) are prior turns of the very build
loop this task is a turn of, where credentialed work (`git push`, `gh pr create`) is a late,
terminal step by construction. The other seven are ordinary interactive sessions with the
operator present — pulled in because this directory holds only eight build-loop firings
total, not enough alone to fill a ten-run corpus, and picking "the ten most recent sessions
with at least ten steps" is the mechanical, non-cherry-picked cut this file commits to
instead. That mix matters for what the number below means: an interactive session's
`git push` is not really "blocked on a credential only the operator holds" in the sense the
solution node means, since the operator is right there to approve it. A run built to defer
credentialed work on purpose might also sequence itself quite differently upstream of its
first credentialed step; this replay cannot see that counterfactual, only the habit these
ten sessions already have.

**In-sample rule, and the honest result.** The same pass that cut this corpus wrote the
classification rule against it. The rule's four-plus-two surfaces are independently grounded
in `src/runner/credentials.ts` and in the vault's own record of what blocks this loop
("Every run ends blocked on a credential only I hold"), not fitted to make the bar pass — and
it wasn't: replayed honestly, **5 of the 10 runs** clear "half or more of the steps
independent," one short of the 6-of-10 bar the solution node pre-committed. The sixth
candidate, `run-02`, misses by a single step (51 of 106, 0.481). No bug or classifier
loophole produced the shortfall — every credentialed step the classifier finds in these ten
runs is a real `git push`/`fetch`/`pull` or `gh` call, checked by hand against the raw
commands in `runs.json`. The test pins the actual count (5, not 6) rather than the node's
forecast; see the PR this fixture shipped with for what that shortfall means for the
solution it was meant to clear for building.
