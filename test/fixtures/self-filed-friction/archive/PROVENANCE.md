# The self-filed friction archive — every filing that existed before the fields did

`test/telemetry/self-filed-friction-events.test.ts` implements "Five-pass count of
self-filed friction events", the assumption test beneath "In-the-moment friction events
filed by the agent" in the meta vault. Two of its three clauses are countable — at least
one event per pass across five passes, and every event carrying the tool, the failing
input and what was expected — and `src/telemetry/self-filed-friction.ts` counts them.

This folder is what the affordance had actually produced when that census was built.

## The cut

Every `.md` file in `.ost-agent/friction/` of the OST-Agent meta vault at
`/Users/tanner/ost-agent-meta`, HEAD `b4c8e5fe86aec1828298d66536dd8b5e279b1bd3`, copied
verbatim on 2026-08-22:

```
cp /Users/tanner/ost-agent-meta/.ost-agent/friction/*.md test/fixtures/self-filed-friction/archive/
```

**Six files. That is not a sample — it is the entire archive**, every friction event the
agent has ever filed at the point of pain, from the affordance landing to the day the
census was written. Nothing was dropped for being awkward, and the test asserts the count
so that a later re-cut cannot quietly become a selection.

## What it shows, and it is not the number the assumption test wanted

- **Six filings, on two days.** Five on 2026-08-01, one on 2026-08-10. Nothing in
  between and nothing since.
- **Not one of them names a pass.** The `pass` field did not exist. Five carry
  `filed by:` — `session`, `session`, `session`, `loop`, `loop` — which is a *role*, not
  a firing, and two filings from two different passes of the loop are indistinguishable
  under it. So the per-pass count this assumption test is named for was never merely
  un-run against this archive: it was **not computable from it**, and the census reports
  these six as `unattributed` rather than as evidence about any pass.
- **Not one of them is actionable by the instrument's definition.** Zero of six carry
  the tool, the failing input and what was expected. This is the archive that settles the
  node's usability assumption — "that a one-line note carries enough context to be
  actionable later" — in the negative, six for six, which is why the writer now refuses a
  filing without those fields rather than scoring one after the fact.
- **The one that reads most like an exception proves the rule.** Two filings report the
  same `wall-clock-budget` flake five weeks before `CLAUDE.md` recorded that the flake was
  a 3× regression nobody profiled. The channel had the signal twice. Nothing counted it,
  because until `src/telemetry/self-filed-friction.ts` nothing counted anything here.

## What this fixture cannot be used for

It cannot answer the third clause, the unfiled-to-filed ratio, and no enlargement of it
ever will: counting friction that left no record means reading the sessions for the
moments the agent pushed through silently, which the node assigns to a human and which
stays there.

It also cannot be read as a filing *rate*. Six filings over the vault's whole life is a
count over an unknown number of passes — unknown precisely because the filings do not say
which pass they came from. A rate needs the denominator this archive does not carry.
