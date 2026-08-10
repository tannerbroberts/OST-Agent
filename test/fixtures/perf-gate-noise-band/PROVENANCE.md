# Perf-gate noise band corpus — how it was cut

`test/eval/perf-gate-noise-band.test.ts` asks whether a perf gate's failure can be read as
"the code got slower" or "this box is slower" from the two numbers the gate has in hand:
the measurement, and the figure the criterion recorded when it was last met. Scoring a
reading needs failures whose cause is known, and real failures do not come labelled — so
these ten were **caused**, and the cause was then hidden from every rule under test.

Everything here was produced by `scripts/harvest-perf-noise-corpus.ts`, committed so the
cut is a rule anyone can re-run and disagree with:

```bash
npx tsx scripts/harvest-perf-noise-corpus.ts test/fixtures/perf-gate-noise-band
```

| File | What it is |
| --- | --- |
| `failures.json` | Ten perf-gate failures. Each carries its measurement, every timed repetition, the control's repetitions, the recorded range, the budget, and the cause it was produced by. |
| `corpus.json` | The calibration the recorded figures came from, the budget rule, and **every trial attempted including the ones that did not breach** — the yield, not just the hits. |

## What was arranged, and why each is the real article

**The regression is the one that actually happened.** Between 2026-07-30 and 08-05 three
rules in `checkInvariants` answered "who links to this node?" with `tree.filter(...)` per
node; it profiled at 44% of all CPU and drifted `ost_next_work` from ~620 ms to ~1,600 ms
(`docs/reference/v1-readiness.md`, Z3). The harvester puts those scans back, around the
same `computeNextWork` call the Z3 gate times, on the same 10,000-node `buildLargeTree`
fixture that gate uses.

**The busy machine is a busy machine** — forked child processes doing nothing but burning
CPU, at 1×, 2× and 3× the core count, which is what a CI box running test files in
parallel does to a benchmark sharing it.

**The measurement is taken the way the gate takes it**: fastest of three repetitions, as
`test/mcp/wall-clock-budget.test.ts` does. All three repetitions are kept, because the
spread across them is the extra information one of the rules under test is given.

## The numbers that bound the corpus, and where they came from

| Quantity | Value | Where it comes from |
| --- | --- | --- |
| recorded range | 249–267 ms | 18 repetitions of the unchanged call on an idle machine, before anything was arranged |
| control recorded range | 12–14 ms | the same, on a 500-node tree |
| budget | 712 ms | 2.67 × the recorded high — **the ratio Z3's own budget bears to its recorded figure** (2,000 ms against 620–750 ms), not a number chosen here |
| machine | darwin arm64, 10 cores | one laptop, 2026-08-10 |

Taking the budget multiple off the real criterion is what keeps the corpus's *failures* the
same population of failures a real gate produces. A tighter budget would have filled it
with trials nobody would ever have argued about.

## The cut rule, stated before the sweep ran

Load was swept from light to heavy and **the first breaches are the ones kept**. That is
deliberately the conservative cut: the least-loaded machine that can fail the gate produces
the smallest measurement, which is the noise case a threshold rule has the best chance of
reading correctly. Filling the corpus at 8× oversubscription would have made every rule
look worse for free.

Five noise, three regressions on an idle box, two regressions on a busy one. The last two
are the hard cases in both directions — the machine is busy *and* the code is slower — and
any rule that treats a busy machine as exculpatory has to get them wrong.

## Two things in `corpus.json` worth reading before the finding

- **`noise 1× cores: 0/4 breached`.** One spinner per core does not fail this gate. Noise
  failures needed 2× oversubscription, which is a fact about how much margin a 2.67×
  budget really has.
- **`regression idle severity 1: 0/3 breached`.** The historical drift, reproduced exactly,
  **does not breach the budget on an idle machine** — it lands at ~2.1× the recorded high
  against a 2.67× budget. That is the Z3 entry's own account of why nobody developing
  against it saw anything ("local runs still passed at 1,600 of 2,000 ms"), reproduced
  here without being aimed at. The idle regressions in this corpus therefore run the scan
  twice; the severity each case came from is written into its `condition`.

## What this fixture cannot settle

The causes are known because they were manufactured, and a rule that is right about ten
constructed cases may be useless on the eleventh real one. One limitation is specific
enough to name: **the contention here is continuous**, where a real CI box's is bursty —
other test files starting and finishing — and the run-to-run spread is exactly what that
difference moves. The spread arm's result should be read as bounded by that, in both
directions.

It also says nothing about whether an operator reading a rendered pair reaches the
conclusion a classifier does. No exit code closes that gap.
