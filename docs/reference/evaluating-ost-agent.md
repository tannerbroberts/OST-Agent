# Evaluating OST-Agent — how we know if it works

An open-ended *ideation* agent has no ground truth: there is no single "correct" set
of solutions for an opportunity (Torres's method is compare-and-contrast precisely
because "good" is relative). So OST-Agent's efficacy is not one number you can unit-test.
It is three layers, and their composition is the holistic test.

## The three layers

1. **Structural invariants — deterministic, a hard gate.**
   After any pass the tree must satisfy every invariant in `src/eval/invariants.ts`:
   exactly one (human-set) outcome, every opportunity connected to it, every solution
   under an opportunity, every assumption under a solution, no dangling links, and nothing
   agent-ideated marked `validated`. Violations fail the scorecard outright. This bounds
   the worst case and needs no model.

2. **Faithfulness — an independent judge, measured against evidence.**
   For every node the agent creates, a *separate* adversarial pass (`src/eval/judge.ts`,
   its own context, no stake in the tree) checks two truth-values: is the node **grounded**
   in the evidence it cites (not invented — the cardinal Torres sin), and is it
   **classified** into the right layer (an opportunity is a need, not a feature)? This
   yields real rates, thresholded in `src/eval/scorecard.ts` (grounding ≥ 95%, methodology
   ≥ 90% by default).

3. **Usefulness — a human-acceptance metric, measured in use.**
   Because the agent marks everything `unvalidated`, the terminal signal is which ideated
   nodes a human keeps versus reverts. There is no automated proxy for "insightful"; only
   people acting on the ideas certify that. Track acceptance rate over time in real use.

**The scorecard (`npm run eval`) is OST-Agent's definition of done.** "It works" stops
meaning "it runs" and starts meaning: on the reference corpus it satisfies every invariant
and clears the grounding and methodology thresholds. Every future change is measured
against it.

## Why self-hosting is not a hall of mirrors

OST-Agent is bootstrapped by running it **on itself**: the `eval/corpus/` is real evidence
about this repo (its goals, safety requirements, design decisions — and the critique that
"efficacy is unmeasured"). That is dogfooding, and it is the domain where the maintainer is
the world expert on whether the output is any good.

The recursion ("a system that improves itself and certifies it improved") is broken by
**separating who proposes from who disposes**:

- **The tool proposes.** OST-Agent ideates opportunities/solutions/assumptions.
- **An independent judge grounds.** Faithfulness is a truth-value checked by a separate
  pass with no stake — it checks *against the evidence*, it does not grade "is this a good
  idea".
- **The human and reality dispose.** Usefulness is human acceptance. The root outcome is
  human-set and lives in external reality; the agent **never validates its own ideas and
  never declares its own outcome met**. That external referent is the fixed point the
  regress was missing — the tool does not certify the tool; reality and the maintainer do.

These are enforced, not just asserted: the `no-self-validation` invariant, the human-set
outcome (P0 refuses to invent it), and `unvalidated`-until-a-human-says-otherwise.

The acid test the corpus is built to trigger: feed the agent the real signal — including
"we can't tell if this works" — and a faithful agent should surface *measuring efficacy* as
a top opportunity. If it does, that is evidence it distills real signal. If it doesn't, the
judge and your own read of the tree catch the miss.

## Running it

```bash
# needs Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`) — it runs the real agent
npm run eval                      # throwaway vault; prints the scorecard
npm run eval -- --out ./discovery # keep the produced tree to read in Obsidian
```

The run: builds a vault from `eval/corpus/`, runs the real agent P1→P5, then the independent
judge, and prints a pass/fail scorecard (grounding %, methodology %, invariant violations).
Non-deterministic — track the score against the thresholds over time, not exact output.
