---
type: Solution
status: unvalidated
created: '2026-08-03'
evidence: assertion
---
#Solution #unvalidated #evidence/assertion
[[A run can rank its own questions by consequence well enough that a spent budget buys the important ones]]

The operator sets how many times a run may interrupt them. The run spends that budget on the questions it judges most consequential, and takes a stated default on everything else. When the budget is gone it stops asking and starts banking. The operator always knows the upper bound on interruptions before the run begins.

This changes what the run has to be good at. It no longer has to answer everything correctly on its own; it has to rank, and ranking a set of questions by consequence is a much easier judgement than answering each one.

**Compared to the alternatives.** The only option that gives the operator direct control over the cost, and it degrades sensibly in both directions — a generous budget behaves like today, a budget of zero behaves like a fully banked run. It needs the run to rank questions before it has seen them all, which will sometimes spend the budget on the first three of seven and default on the most important.

**What would make this the wrong pick.** A number is a poor proxy for what the operator actually cares about, which is which kinds of decision they want to make. Seven cheap questions may be entirely welcome while one structural question was the only one worth asking, and a count cannot express that.

## Definition of done

"Rank each session's questions by consequence and check whether the first ones asked were the important ones"

`npx vitest run test/loop/question-budget-ordering.test.ts`

The spec replays the four already-harvested sessions' clarifying-question sequences against the budget's ranking function and asserts that the hindsight-most-consequential question falls inside the half the budget would have spent, in at least 3 of 4 sessions. It is red today because neither the budget nor the ranking function exists.

**What a green here does not settle.** It shows that spending in ranked order would have caught the question that mattered on four sessions already on disk. It says nothing about whether an operator wants a numeric cap at all — the node's own stated risk is that a count cannot express *which kinds of decision* someone wants to be asked about, and no spec can find that out. That half stays with the humans-required test.

## History
- 2026-08-05 unlinked "Rank each session's questions by consequence and check whether the first ones asked were the important ones" — moved under "A run can rank its own questions by consequence well enough that a spent budget buys the important ones" — the belief this test measures now has a node of its own
