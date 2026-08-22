---
type: Opportunity
source: >-
  INBOX:2026-08-16-build-loop-stuck-ask-the-open-question-first-and-offer-options-only-once-the-.md
created: '2026-08-20'
evidence: assertion
---
#Opportunity #unvalidated #evidence/assertion
[[The builder files a structured disconfirmation that the loop carries into the tree beside the red]]
[[After two builds leave an instrument red on an assertion, the loop files the target as disputed and stops selecting it]]
[[Replay-style instruments are a distinct kind whose red is a finding, not a permit]]

**The need (operator's voice):** "The builder ran the experiment and the idea lost — 92 turns against 72, only 28% reframed, well under breakeven. That is the best news a test can bring. And the loop filed it as 'not shipped, instrument still red' and went looking for another buildable candidate, as if the spec just hadn't been written yet."

**Why this is a child of its parent and not the parent restated.** The parent says nothing kills a candidate. This node names one specific way a kill is offered and declined: the loop's own verdict vocabulary has no word for *refuted*. A pre-committed kill criterion (the parent's first solution) would be satisfied here — the criterion was written, the bar was ~50% reframed, the data came in at 28% — and the candidate still did not die, because the thing that watched the exit code can only say red, green or no-spec. A solution that teaches the loop to file a red-that-survived-a-build as a disconfirmation serves this need and does nothing for the parent's wider claim about ideas that were never tested at all. Subset, so it hangs beneath.

**What was observed.** `INBOX:2026-08-16-build-loop-stuck-ask-the-open-question-first-and-offer-options-only-once-the-.md` (automated build note; an exit code the loop watched): the builder implemented the instrument for "Ask the open question first, and offer options only once the frame is agreed" — `src/loop/questions.ts` replaying 11 harvested sessions — and reported the solution *falsified by real data*: "tsc clean, full suite green except this one assertion, which fails by design and should not be loosened… recommend the tree record the solution as disproven." The loop's postflight appended, in the same report: "[Loop check: the instrument for this solution is still red after the build, so the definition of done was not met regardless of what the report above says.]" The same target was then re-selected and re-refuted on 2026-08-19 (PR #171), identically. A human later set the solution `deferred` by hand.

**Where the gap is in the code, read this pass via `ost_read_repo`.** `src/ost/instrument.ts` defines `Observation = "red" | "green" | "no-spec"` and `verifyInstrument` files exactly one of those three; `transitioned` is true only on red→green. There is no observation kind, and no field on the log line, that says *a build was attempted against this instrument and it stayed red on an assertion*. `examples/automation/build-pass.sh` runs `verify` in its postflight and reads red as "definition of done not met" unconditionally — the comment block is explicit that the loop never lets the model's report override the exit code, which is correct for honesty and is exactly what makes a refutation unspeakable. The "stuck after 2 attempts" note is the closest thing to a kill the loop can produce, and it is addressed to a human.

**The distinction this node turns on.** Some instruments assert *new behaviour* (red until built); some *replay recorded data against a pre-committed bar* (red means the hypothesis lost). The first kind's red is a definition of done; the second kind's red is a finding. The loop treats both as the first.

**Litmus test (more than one way?):** Yes — let the builder file a structured disconfirmation the loop carries into the tree; have the loop count builds-attempted-while-red and propose deferral mechanically after N; classify replay-style instruments apart from permit-style ones so their red is read as a result. Distinct, with different trust assumptions. Passes.

**Provenance and rung.** Source is an automated build note on the inbox channel, which the ladder caps at `assertion` (the tool refused `observed` for it this pass). Corroborated by a second identical note on 2026-08-19 and by the human's subsequent `deferred` on the solution. Observed behaviour of this loop, n=1 operator; grounds the loop's mechanics, not demand.
