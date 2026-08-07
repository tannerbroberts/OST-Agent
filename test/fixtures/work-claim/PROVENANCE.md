# The 2026-07-26 briefing — how this fixture was cut, and what is wrong with it

`test/loop/work-claim-vocabulary-match.test.ts` replays the one collision this building has
actually observed: two passes read one standing briefing, named the work differently, and
built the same feature twice. `briefing-2026-07-26.md` is the briefing they read. This file
records how it got here so anyone can disagree with the cut rather than with the result.

## What is verbatim, and what is not

**Nothing here is verbatim.** The original briefing was not captured. What survives is the
account in the `ost-agent-meta` vault, in the node *"Two agents sharing my vault can trample
each other"*, under the heading *"Second sighting … 2026-07-26"*, and the fixture is
reconstructed from it.

Every fact the fixture asserts about the work item is taken from that account:

| In the fixture | Recorded in the vault node |
| --- | --- |
| the briefing names the invited-visitor arm split as the build to do "if something must be built" | *"It read the standing briefing, which named the invited-visitor arm split as the build to do 'if something must be built'"* |
| an `arm` on `visitor_events` | *"migration 024 adding `visitor_events.arm`"* |
| derived from the visitor id | *"an FNV-1a arm derived from the visitor id"* |
| assigned at arrival only, nullable for older rows | *"same nullable-arrival-only design"* |
| behind a default-off knob | *"the same default-off knob"* |
| a per-arm admin read | *"a per-arm admin read"* |

The prose around those facts — the sentence rhythm, the two "not this week" items, the note
that master is green — is **invented**. It is there because the matcher has to resolve a
naming against a briefing that contains more than one candidate item; a fixture holding only
the work that collided would let a matcher that always answers "that one" pass.

## What this weakens, said plainly

Three things, and the first is the one that matters.

1. **The fixture and the matcher were written in the same pass, by the same author.** That
   is the failure mode a spec exists to prevent, and it is present here. The assumption test
   under *"A pass claims the work item before it starts, and the claim outlives the session"*
   says so at creation time — *"The fixture paragraph is not in the repository either, so a
   builder writing this will build the fixture as part of it"* — but naming it in advance
   does not remove it. A green on this file is evidence that the matcher works on a
   paragraph written by someone who knew how the matcher works.

2. **n = 1, and the 1 was selected because it failed.** One briefing, one work item, one
   pair of namings. Nothing here says the vocabulary holds for a second briefing.

3. **The two namings are the ones the assumption node proposes, not the ones the passes
   used.** `invited-visitor arm split` and `add an arm column to visitor_events` come from
   the assumption *"Two passes reading one briefing would name the same work item the same
   way"*, which offers them as what the colliding commits *imply*. Neither pass is recorded
   as ever having written down what it was working on — that is the whole finding — so no
   naming either pass actually used exists to test against.

The honest reading of a green here: the matcher can resolve two differently-worded namings
of one item to one identity **on a paragraph built for it**. What it would do on a briefing
written by somebody who had never heard of it is unmeasured.
