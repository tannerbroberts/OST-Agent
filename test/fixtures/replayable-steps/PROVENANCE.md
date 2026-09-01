# Replayable-step corpus — how it was cut, and what it does and does not show

`test/loop/replayable-step-share.test.ts` implements "Count how many recorded steps are
safely replayable at all", the assumption test beneath **"Replay a recorded failure in its
recorded context on demand"** in the meta vault. The bar it pre-committed: **at least 60%
of recorded steps from the last thirty days classify as side-effect-free by a fixed rule,
with no case-by-case judgement**, and steps needing a human to decide count as failures of
the rule rather than as passes.

**The result is 44.9%. The assumption is refuted.**

## The ordering, which the node says is the load-bearing part

The node is explicit that deriving the allowlist from the sample and then scoring the
sample against it "would produce a number that means nothing and looks identical to one
that does". Two things keep that from happening here, and only the first is checkable by a
test:

1. **Structural.** `src/loop/replayable.ts` imports nothing, reads no file, and names no
   fixture — it cannot have seen this corpus, because it has no way to open it. Asserted in
   `describe("the rule was fixed before the corpus was read")`.
2. **Historical.** The allowlist landed in its own commit, *"feat(replay): commit the
   read-only allowlist before any corpus is cut"*, before `scripts/harvest-replayable-step-corpus.ts`
   existed and before this fixture was written. That ordering is visible in the branch's
   history and nowhere else; a squash merge collapses it, which is a real limit on how much
   of this a later reader can verify.

The allowlist's verbs come from the assumption test's own text (`vitest`, `tsc`,
`ost-agent check`, `git status`, "and similar"), from `ost-agent --help`, and from git's
documented read subcommands. One entry is **stricter** than the node: bare `tsc` writes its
emit output, so the entry requires `--noEmit`. Tightening a rule before measuring can only
lower the share, never manufacture a green.

## The cut

The source is the meta vault's own loop health ledger, `.git/ost-agent/runs.jsonl` under
`/Users/tanner/ost-agent-meta` — the same file `readRuns` (`src/loop/health.ts`) reads, and
the same file the sibling `record-replay` corpus was cut from.
`scripts/harvest-replayable-step-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-replayable-step-corpus.ts /Users/tanner/ost-agent-meta 2026-09-01
```

1. Flatten every step of every recorded run.
2. Keep steps whose `at` falls in `[cut − 30 days, cut)` — **2026-08-02T00:00:00Z through
   2026-09-01T00:00:00Z**, which is 619 steps across 341 runs.
3. Sort ascending by the step's own `at`.
4. Redact (`redactSecrets`) and cap each `argv` element at 200 characters, since 341 of the
   619 are `claude -p <prompt>` invocations tens of kilobytes long. The cap is applied from
   the end of each element, so the head the rule reads — the verb, its subcommand, its first
   flags — always survives intact.

**Nothing is filtered.** No selection on phase, exit code, or `refused` marker: the
assumption test asks for the share over *every* recorded step, and every filter applied on
the way in is a thumb on that share. The test asserts the presence of all three outcome
classes rather than trusting this paragraph.

The window is the ledger's whole life, or close to it — `runs.jsonl` starts 2026-08-02.
"The last thirty days" and "everything ever recorded" are the same corpus here, which is
worth knowing before treating the window as a choice that could have gone another way.

## What it found

| population | replayable | share |
| --- | --- | --- |
| every recorded step | 278 / 619 | **44.9%** |
| non-refused steps | 259 / 600 | 43.2% |
| every non-zero exit | 19 / 82 | 23.2% |
| **commands that ran and failed** (non-zero, not refused) | **0 / 63** | **0.0%** |

Weekly, across the four full weeks of the window: 37.4%, 46.6%, 48.3%, 39.1%. The bar is
missed under every sub-window, so the miss is not an artefact of where the cut landed.

## Why the allowlist is not what refused them

This is the first objection a refuted rule attracts, and it does not hold. **This vault's
thirty days contain exactly two distinct commands:**

- `ost-agent check --vault …` — 278 steps, all `check` phase, all cleared;
- `claude -p <prompt>` — 341 steps, all `pass` phase, all refused.

The allowlist carries 44 verbs. Exactly one of them is ever exercised. And the refused half
is a single command — an agent pass that edits files, commits and pushes — which no
allowlist of read-only verbs can admit without abandoning the safety property the rule
exists for. Granting *every* non-`claude` command for free, whatever it is, still lands at
44.9%: that is a ceiling on this corpus, not this allowlist's score. The test asserts it.

## The number that decides the row

The headline 44.9% is over all steps, because that is the population the assumption test
named. But the solution is about replaying a recorded **failure**, and on that population
the answer is not "short of the bar" — it is **zero**. All 63 commands in this window that
actually ran and exited non-zero are `claude -p` agent passes.

The 19 replayable non-zero exits are `refused: "spend-ceiling"` steps, which never spawned
anything: `src/cli/loop.ts` stamps their `cwd`/`argv` from its own process state *before*
the ceiling check runs, so they record what *would* have run. `test/fixtures/record-replay/PROVENANCE.md`
already names this class as the one that clears a bar by construction while exercising none
of the question. They are the entire replayable half of the non-zero exits.

So on this record there is not one recorded failure that replay could safely re-run.

## What this does and does not settle

It settles the feasibility question the node asked, in the negative, and it does so on a
corpus that cannot be widened into a different answer without the ledger itself changing
shape. Per the solution node's own text, that redirects the row to the sibling **"Snapshot
the resolved environment, but only for the step that failed"** — portability of explanation
rather than certainty of answer, which does not require the step to be safe to re-run.

It does **not** settle what the node says green would not have settled either: whether an
operator would close a failure on a replay result rather than re-running by hand. That
still needs a person, and it is now moot for this row rather than answered.

One limit worth naming, because it bounds how far this generalises. "Recorded step" here
means a `LoopStepRecord` in the loop health ledger — the population `src/loop/replay.ts`
already operates on, and the only one carrying `argv` at all. A session transcript records
a different and much richer notion of "step" (individual `Bash`, `Edit`, `Read` tool
calls), and this corpus says nothing about that population. The two are not
interchangeable: the ledger's steps are the *phases the loop issued*, of which there are
two, while a transcript's are the hundreds of tool calls one of those phases makes. A rule
measured over the second would be answering a different question than the one the node
asked — but it is the question a reader may think was asked, so it is named here.
