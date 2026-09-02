# Rung-suggestion corpus — how it was cut

The census in `test/telemetry/rung-suggestion-reflex.test.ts` counts how often a caller,
told which rung would have been accepted, took that rung without offering any grounds it
had not already offered. It has to run offline and give the same answer next year, so the
corpus lives here rather than being read off the machine that produced it. This file
records exactly what was taken, so anyone can disagree with the cut instead of with the
number.

## What is here

Eight session transcripts, cut from `~/.claude/projects` on 2026-09-02 by
`scripts/harvest-rung-suggestion-corpus.ts`. Between them they hold **every rung refusal
anywhere on this machine** — ten of them — and the seven retries that answered one.

| File | Rung refusals | Retries |
| --- | --- | --- |
| `807bed15-…` | 1 | 1 |
| `860ade27-…` | 2 | 2 |
| `8a9777ad-…` | 1 | 1 |
| `8e6fe785-…` | 1 | 1 |
| `a16fcaf7-…` | 1 | 1 |
| `afce034c-…` | 1 | 1 |
| `d1f1dace-…` | 2 | 0 |
| `e5bee282-…` | 1 | 0 |

## The rule the harvester applies

1. **Select by refusal, not by session.** Every `.jsonl` under the projects directory whose
   text contains a rung refusal (`cannot declare '<rung>'`) is a candidate; everything else
   is dropped whole. A session with no rung refusal contributes to no number this census
   reports, so keeping one would only make the fixture larger.
2. **Keep from the refused call forward through the retry window.**
   `RUNG_SUGGESTION_RULE.retryWindowCalls` (20) bounds how far after a refusal a later
   declaration still counts as its retry, so the cut runs forward until that many
   rung-declaring calls have gone by, or the session ends. A narrower cut would drop a
   retry the caller made and report it as a refusal nobody answered — and unanswered
   refusals are counted **neither way**, so the loss would shrink the denominator silently
   instead of showing up as a wrong number.
3. **Keep only the entries the census reads** — an entry carrying a rung-declaring
   `tool_use`, or a `tool_result` joined to one. The census indexes calls rather than
   entries, so dropping the assistant prose and thinking blocks between them changes
   nothing it computes, and it is the whole size budget: keeping every entry across the
   same windows produced 2.3 MB to carry ten refusals, against 404 KB here.
4. **Redact.** Every kept line goes through `redactSecrets` (`src/adapters/transcript.ts`),
   the same pass the friction adapter applies. It found nothing to mask.

## Fidelity

The harvester runs the census over the live corpus and over the cut, and prints both. The
committed cut reproduces the live census **exactly** — refusals seen, refusals that named a
value, pairs, unretried, reflexive count, and all three readings — and the run that
produced these files printed `fidelity: EXACT`. Re-running the harvester re-checks it.

## What the cut deliberately does not carry

**`otherRefusals` is a floor here, not a total.** The census also counts rung-declaring
calls refused over something *other* than the rung — an instrument naming no spec file, a
threshold fixing no bar — to show that those are excluded from the coverage denominator
rather than quietly folded into it. On the live corpus there are 17 of them, spread across
sessions holding no rung refusal at all; the cut selects by rung refusal, so it keeps only
the ones that happened to sit in the same eight sessions. The number the fixture reports
for that field is therefore smaller than the machine's, on purpose, and no test asserts it
against the live figure.

**Nothing here settles the question.** Whether a retry that took the named rung was being
honest or being suggestible turns on reading its justification, which is a judgement. The
census produces the flag; a human records the result.
