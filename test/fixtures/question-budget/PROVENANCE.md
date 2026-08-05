# Clarifying-question corpus — how it was cut

`test/loop/question-budget-ordering.test.ts` asks whether a run can rank its own
clarifying questions by consequence well enough that a spent budget buys the important
ones. It has to run offline and give the same answer next year, so the corpus lives here
rather than being read off the machine that produced it. This file records exactly what
was taken, so anyone can disagree with the cut instead of with the number.

## What is here

`sessions.json` — every Claude Code session transcript under `~/.claude/projects` on the
authoring machine that contains **three or more answered clarifying questions**, as of
2026-08-05. Eleven sessions, 46 questions. Nothing was selected by hand; the cut is
`scripts/harvest-question-corpus.ts`, which is committed so it can be re-run.

Each question carries the transcript entry index and the `tool_use` id it came from, so
any line here can be checked against the original by eye.

## The four, and the other seven

The assumption test names *four* sessions. Four is what you get by asking which sessions
stopped their operator **repeatedly** — three or more `AskUserQuestion` calls:

| Session | Project | Interruptions | Questions |
| --- | --- | --- | --- |
| `16e9596b` | `dev/OST-Agent` | 8 | 8 |
| `38b03967` | `~` | 5 | 5 |
| `e42cd03d` | `dev/OST-Agent` | 3 | 3 |
| `5201915d` | `dev/tetrix-ost` | 3 | 3 |

The interruption is the unit the budget spends, not the question — one ask carrying six
questions stopped the operator once — so that is the bar for the headline corpus
(`MIN_INTERRUPTIONS_PER_SESSION`). The other seven sessions asked three or more questions
across only one or two interruptions. They are harvested anyway and the same replay is run
over all eleven, reported beside the headline, so **"why those four" is answerable by
looking rather than by trusting the cut.** The two numbers do not agree, and the test says
so out loud.

## Forks are deduplicated

Claude Code writes a resumed or forked conversation as a second transcript replaying the
same asks with the same timestamps. Two pairs in this corpus are forks
(`7e982096`/`16e9596b`, `6a0319fd`/`38b03967`). Same first-ask timestamp means same
conversation; the longer transcript is kept, ties broken by lexicographically first id. Not
deduplicating would have counted one conversation twice and inflated agreement between the
ranker and hindsight by construction.

## The answer key is derived, not authored

This is the part most likely to be wrong, so it is the part stated most plainly.

The assumption test's design says *"have a person rank the questions by consequence with
full hindsight."* Nobody did that. A ranking function graded against a key its own author
wrote proves nothing, and the author available here was the same process that wrote the
ranking function.

Instead the key is read off what the operator **did**, by `HINDSIGHT_RULE`:

- **reframed** — they declined the ask, or answered in their own words instead of picking
  an option. Every option the run offered was wrong.
- **overridden** — they picked an option, but not the one the run had marked
  `(Recommended)`. Banking the default would have taken the other branch.
- **confirmed** — they picked the run's own default. The interruption changed nothing.

Every input to that is a fact recorded by Claude Code in a file no agent in this system can
write. Ties break toward the **latest** question, which is the direction hardest for a
budget spending in arrival order to catch: a test that broke its own ties in its own favour
would not be measuring anything.

**What this substitutes, and what it costs.** "The operator did not take our default" is a
proxy for "this question mattered", not the thing itself. It scores an override on a small
question above a confirmation on a structural one — in `16e9596b`, the question that
reshaped the whole product (*"does that mean cutting the API-key-billed runner?"*) is not
the key's top; the npm-deletion question is, because that is where the operator wrote their
own answer. A person ranking these with hindsight would very plausibly disagree, and their
ranking is still the test the assumption node actually asked for.

## What the corpus cannot support

- **Two of `16e9596b`'s ten questions were never answered** — the session ended first.
  They are excluded from the replay and counted in `askedButUnanswered`, because a question
  with no recorded answer has no hindsight to be scored against.
- **The order these were asked in is the order an unrationed run chose.** A run that knew
  it had a budget might have held questions back or merged them, and no replay of this
  corpus can see that counterfactual. The assumption test names this limitation itself.
- **Three of the eleven sessions are not about this product at all** (`tetrix-ost`,
  `tetrix-game-monorepo`). They are kept because excluding them would be selecting on the
  subject matter, which is the one axis most likely to correlate with the answer.
