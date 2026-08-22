# Evaluating OST-Agent — how we know if it works

> **Status: this is a design argument, not a set of instructions.** An earlier era of
> this repo shipped an automated evaluation harness — an independent faithfulness judge,
> a pass/fail scorecard, a reference corpus under `eval/corpus/`, and an `eval` npm script
> that tied them together. **All of it has been removed, and nothing automated replaced
> it.** What replaced layers 2 and 3 below is human judgement, exercised by whoever reads
> the tree. The three-layer framing is kept here because it is still how efficacy is
> reasoned about, and because it names precisely which of the three layers a machine can
> hold and which two it cannot. Read it for the argument; the only commands in it that
> exist are the ones under [Running what still exists](#running-what-still-exists).
>
> *(The removed script is called "an `eval` npm script" above rather than written in its
> full invocation form on purpose. The guard in `test/release/doc-references.test.ts` fails
> any operator-facing doc that spells out a runnable command `package.json` does not
> define, and it cannot tell "here is what to run" from "here is what no longer exists" —
> so the one file explaining a deleted command must not itself write the invocation.)*

An open-ended *ideation* agent has no ground truth: there is no single "correct" set
of solutions for an opportunity (Torres's method is compare-and-contrast precisely
because "good" is relative). So OST-Agent's efficacy is not one number you can unit-test.
It is three layers, and their composition is the holistic test.

## The three layers

1. **Structural invariants — deterministic, a hard gate. Shipped, and the only layer
   that is.**
   After any pass the tree must satisfy every invariant in `src/eval/invariants.ts` —
   ten rules, of which the load-bearing ones for this argument are: exactly one
   (human-set) outcome, every opportunity connected to it, every solution under an
   opportunity, every assumption under a solution, no dangling links, and nothing
   agent-ideated marked `validated`. (The rest govern link syntax and evidence rungs.
   **The module is the list; this paragraph is a summary of it, and the guard in
   `test/release/doc-references.test.ts` checks that the module exists, not that this
   sentence still describes it.**) This bounds the worst case and needs no model, which
   is exactly why it survived the removal of the other two layers: a check with no model
   in it cannot be wrong about itself. Run it with `ost-agent check`, or call the
   `ost_check` MCP tool.

2. **Faithfulness — an independent judge, measured against evidence. *Designed, built,
   removed; today a human reads the node.***
   For every node the agent creates, the design called for a *separate* adversarial pass
   with its own context and no stake in the tree, checking two truth-values: is the node
   **grounded** in the evidence it cites (not invented — the cardinal Torres sin), and is
   it **classified** into the right layer (an opportunity is a need, not a feature)? That
   judge, and the scorecard that thresholded its output (grounding ≥ 95%, methodology
   ≥ 90%), are gone. **No automated grounding rate is produced today, by any command.**
   Every node the agent writes cites its sources and declares its evidence rung, so the
   question is answerable by a reader opening the node — but it is answered by a person,
   one node at a time, not by a percentage.

   *One node at a time does not survive a 1,400-node tree, so the reading is sampled rather
   than exhaustive.* `ost-agent review-sample` draws a tenth of the tree — stratified so
   every bucket and every layer is represented, reproducible under a seed — and prints it
   as a sheet carrying the two truth-values above, plus layer 3's question, as unfilled
   checkboxes. **It draws; it does not rate.** Nothing in `src/eval/review-sample.ts` reads
   a node's prose or emits a number, which is the line this document draws and the reason
   the command is a sampler rather than the judge coming back.

3. **Usefulness — a human-acceptance metric, measured in use. Never automated, and not
   automatable.**
   Because the agent marks everything `unvalidated`, the terminal signal is which ideated
   nodes a human keeps versus reverts. There is no automated proxy for "insightful"; only
   people acting on the ideas certify that. Track acceptance rate over time in real use.

**Consequence of the removal, stated plainly: "it works" has no mechanical definition of
done today.** It used to mean "on the reference corpus it satisfies every invariant and
clears the grounding and methodology thresholds". It now means: the invariants hold — that
part is still a hard, testable gate — and a human who read the tree thinks the ideas are
worth keeping. Anyone reinstating layer 2 should read the next section first, because the
constraint that made the judge safe is the reason it is worth rebuilding correctly rather
than quickly.

## Why self-hosting is not a hall of mirrors

OST-Agent was bootstrapped by running it **on itself** — the removed corpus was real
evidence about this repo (its goals, safety requirements, design decisions, and the
critique that "efficacy is unmeasured"). That is dogfooding, and it is the domain where
the maintainer is the world expert on whether the output is any good. Running the agent
on this repo's own discovery work is still how it is exercised; what is gone is the
canned corpus and the harness that scored a run over it.

The recursion ("a system that improves itself and certifies it improved") is broken by
**separating who proposes from who disposes**:

- **The tool proposes.** OST-Agent ideates opportunities/solutions/assumptions.
- **An independent judge grounds** — in the design. Faithfulness is a truth-value checked
  *against the evidence*; it does not grade "is this a good idea". With the judge removed,
  this role is unfilled by machinery and falls to the reviewing human, who has the same
  job description: check the citation, not the taste.
- **The human and reality dispose.** Usefulness is human acceptance. The root outcome is
  human-set and lives in external reality; the agent **never validates its own ideas and
  never declares its own outcome met**. That external referent is the fixed point the
  regress was missing — the tool does not certify the tool; reality and the maintainer do.

The important half of that argument is enforced by code rather than asserted: the
`no-self-validation` invariant, the human-set outcome (P0 refuses to invent it), and
`unvalidated`-until-a-human-says-otherwise. **Note which half that is.** The layer that
stops the tool certifying itself is mechanical and still runs; the layer that measured how
*good* the output is was always the model-shaped one, and it is the one that is gone.
Losing it costs a number, not the anti-recursion guarantee.

The acid test the corpus was built to trigger is still the right one to apply by hand:
feed the agent the real signal — including "we can't tell if this works" — and a faithful
agent should surface *measuring efficacy* as a top opportunity. If it does, that is
evidence it distills real signal. If it doesn't, your own read of the tree catches the
miss. That last clause used to say "the judge and your own read". Now it is only your own.

## Running what still exists

```bash
ost-agent check           # deterministic tree invariants, no model, exit 1 on any violation
ost-agent status          # what the tree contains, per evidence rung, and what is outstanding
ost-agent review-sample   # a stratified, reproducible 10% draw + the rubric, for a person to fill in
```

All three operate on a vault directory (`--vault <dir>`, defaulting to the working directory).
`ost-agent` here is the CLI in `src/cli/index.ts`; the package publishes no `bin`, so from a
plugin install invoke the committed bundle directly —
`node "$CLAUDE_PLUGIN_ROOT/dist/ost-agent.mjs" check` — exactly as the README's operator
section describes.

`ost-agent check` is layer 1 and nothing more: a clean run says the tree is *well-formed*,
not that it is *good*. **There is no command that scores faithfulness or usefulness. If
you are looking for one because a document told you it exists, that document is this one,
in an older revision.**

Layers 2 and 3 are read, not run: for each node the agent created, check its cited sources
against what it claims and decide whether you would keep it. `ost-agent review-sample` says
*which* nodes to read — a tenth of them, drawn so the reading is not a reading of whichever
bucket sorts first — and prints the three questions beside each one. It stops there. The
gap between a filled-in sheet and a number is real, is deliberate as of this revision, and
is tracked in [`v1-readiness.md`](v1-readiness.md) rather than papered over here.

**One thing to know before averaging a finished sheet, because the arithmetic is silent.**
The draw is stratified by `bucket × layer` cell, and on this repo's own vault there are
more such cells (150) than a tenth of the tree has nodes (142) — so every cell contributes
exactly one node, whether it holds five or fifty. That makes the sheet a *coverage* sample
rather than a proportional one: the flat mean of its checkmarks is a mean over cells, not
over the tree, and it over-weights the small buckets. Each cell prints how many nodes one
rating stands for; weight by that figure, or compare the sample against a `--fraction 1`
sheet and find out how far the unweighted read is off. Neither number is computed for you,
and that is the same line as everywhere else on this page.
