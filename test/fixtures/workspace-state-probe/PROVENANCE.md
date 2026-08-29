# Workspace-state coverage corpus — how it was cut

The census in `test/runner/workspace-state-probe-coverage.test.ts` asks whether a
**small fixed** set of state questions covers the environment failures this project's
own passes actually hit. It has to run offline and give the same answer next year, so
the corpus lives here rather than being read off the machine that produced it. This
file records exactly what was taken, so anyone can disagree with the cut instead of
with the number.

Everything here was produced by `scripts/harvest-workspace-state-corpus.ts`, committed
so the cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-workspace-state-corpus.ts test/fixtures/workspace-state-probe
```

Unlike the workspace-map harvest beside it, this one reads **no machine state at
all** — no home directory, no `~/.claude/projects`, no live filesystem. Its whole
input is a committed file, so it is reproducible on any checkout by anyone.

## What is here

| File | What it is |
| --- | --- |
| `failures.json` | The 78 **environment failures**, each with the signature that recognised it, the question that would have predicted it, and the error text so a row can be read rather than trusted. |
| `corpus.json` | The counts: the upstream size, every exclusion, and the survivors split into state-shaped and path-shaped. |

## The upstream cut

The starting point is the committed
`test/fixtures/path-failure-attribution/failures.jsonl` — every failing tool call found
in 646 session transcripts, **719** of them, already redacted and bounded. Starting here
rather than re-reading transcripts means this census and the path-failure census cannot
disagree about what failed, and it is why this harvest needs nothing from the machine.

## The partition

`classifyEnvironmentFailure` sorts all 719 into three piles, and all three are counted:

| Pile | n | What it is |
| --- | --- | --- |
| **environment failures** | 78 | The workspace was not in the state the command assumed. The census's subject. |
| **not about workspace state** | 166 | Dropped by name before any signature is tested — see below. |
| **not an environment failure** | 475 | A type error, a failing assertion, a bad argument, an API refusal. Nothing about the workspace predicts these. |

`78 + 166 + 475 = 719`, and the spec asserts that they partition exactly.

The 166 dropped are dropped because **another mechanism in this repository already owns
each of them**, and letting them in would swamp the census rather than inform it:

| Exclusion | n | Owned by |
| --- | --- | --- |
| `tool-not-granted` | 132 | `src/runner/grant-preflight.ts` — a session asking for a tool it was never granted is not a fact about the workspace. |
| `timed-out` | 20 | Nothing, and nothing could: a wall-clock kill is transient by definition. |
| `literal-match` | 13 | The failed-literal-match answer — an `Edit` whose anchor was not in the file is about content, not state. |
| `worktree-refusal` | 1 | This repository's own worktree-isolation hook. |

## The questions, and where they came from

`NODE_QUESTIONS` in `src/runner/workspace-state-probe.ts` holds the **five the solution
node named, in its own words**, written down before the corpus was counted. Nothing was
added. The node's budget is six and it named five; the empty sixth slot was left empty
on purpose, because filling it with something read off the corpus is exactly the tuning
that would make the count meaningless.

`RESIDUAL_QUESTIONS` holds the questions this history demanded that the five do not
ask. These were named **after** reading the corpus, and that ordering is unavoidable —
you cannot name what history required without reading history. It is why they live in a
separate list: the thing under test is the node's five, and the residuals are the
measurement of what they missed.

## Two judgement calls, both published rather than defended

**1. Question granularity.** A count of questions can be made to come out any way at all
by changing what counts as one question. The node did not fix this and it had to be
fixed, because the bar is a count. `WORKSPACE_STATE_RULE.granularity` pins it at the
granularity the node's own five use — one fact with a single bounded answer, evidenced
by the node asking "is this a git repository" and "does it have a remote" as two
questions rather than one. The coarsest defensible alternative (one question per
subsystem) is reported as a counter-reading with its own verdict, and **the two
disagree**. That disagreement is itself a finding: the bar as stated is not decidable
until granularity is pinned, and the node did not pin it.

**2. `bare-package-unresolvable` → `has-lockfile`.** Nine failures are a bare package
specifier that would not resolve (`Cannot find package 'yaml'` from a script written
into `/tmp`). Crediting these to the node's lockfile question is generous: a lockfile
answers "which package manager, and are the dependencies declared", not "will module
resolution reach them from where I am writing". It is credited anyway, because this
census came out refuted and **a refutation reached by a harsh classifier is worth
nothing**. The strict reading is reported as a counter-reading; it makes the refutation
worse, never better.

## What the numbers came out to be

Over the 33 **state-shaped** environment failures, the node's five questions predict
**22**. The remaining 11 need **four** questions from outside the set — is the branch or
worktree path still free (5), is the tree clean and in sync with its upstream (3), is
this path tracked in the index (2), does the running shell have this builtin (1). Five
plus four is **nine questions against a budget of six: refuted.**

The refutation survives every counter-reading but one:

| Reading | Questions | Verdict |
| --- | --- | --- |
| Headline — state-shaped only, the solution node's wording | 9 | over budget |
| Wide — plus the 45 missing-path failures, the assumption test's wording | 10 | over budget |
| Trimmed — drop the node question that predicted nothing | 8 | over budget |
| Strict — withdraw the one generous attribution | 10 | over budget |
| Aggregate — one question per subsystem (git, tooling, dependencies) | 3 | **clears** |

Two further facts fell out of the count that the node did not claim:

- **`build-has-run` predicted nothing.** Not one failure in 719 was a missing build
  output. One of the node's five slots, out of a budget of six, is spent on a question
  this history never asked.
- **Four of the six PATH failures *were* the probe.** `which gtimeout timeout`,
  `which tmux script`, `which psql` (twice) — the run performing the state lookup by
  hand, one binary and one tool call at a time. These are not failures the probe would
  have predicted; they are the behaviour the solution's own title names, and the node's
  argument (which is entirely about failures arriving *after* the plan is made) does not
  use them.

## What the count cannot support

- **It is bounded by failures that happened, not failures that can happen.** A question
  absent from this history may be the one that matters next week. The node says so, and
  it is the limit that makes the result an argument rather than a proof.
- **It counts questions, not cost.** Six cheap questions and six that each cost a
  subprocess are different products. `probeWorkspaceState` answers all five without
  spawning anything, which is evidence about cost but is not what the bar measures.
- **It says nothing about whether anyone wants a probe** — only whether one could be
  small enough to be worth wanting.
- **One machine, one operator.** Every failure here was caused by this project's own
  passes, and a corpus of failures suffered by runs that had no probe is a corpus shaped
  by the absence of the thing being tested.
