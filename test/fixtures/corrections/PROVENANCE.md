# The seven-refusal corpus — how it was cut

`test/loop/corrections-ledger.test.ts` replays seven machine-captured sessions through the
corrections ledger and asserts that the refusal all seven were given reaches a later
session exactly once. It has to run offline, in CI, and give the same answer next year, so
the corpus lives here rather than being read off the machine that produced it. This file
records exactly what was taken, so anyone can disagree with the cut instead of with the
number.

## What is here

Seven `*.jsonl` files, one per session, named by the session id the opportunity node names
(`The same blocked call comes back next session, because a correction only lives as long
as the session it was given in`, in the `ost-agent-meta` vault):

| Session | Date | Original entries | Kept | Errored results | Guard refusals |
| --- | --- | --- | --- | --- | --- |
| `470cb94a` | Jul 30 | 691 | 10 | 5 | 2 |
| `4ff7b605` | Jul 29 | 679 | 6 | 3 | 3 |
| `995b8ab1` | Jul 29 | 284 | 6 | 3 | 2 |
| `a0eb3fd4` | Jul 29 | 201 | 4 | 2 | 1 |
| `97546e2f` | Jul 30 | 238 | 6 | 3 | 1 |
| `516fdfb8` | Jul 30 | 793 | 10 | 5 | 3 |
| `87a025f8` | Jul 31 | 594 | 2 | 1 | 1 |

All seven come from `~/.claude/projects/-Users-tanner-dev-OST-Agent/` — Claude Code
sessions against the OST-Agent repository, all of them build work.

## How they were cut

For every `tool_result` with `is_error: true`, the cut keeps two entries: the result
itself, and the assistant entry carrying the `tool_use` it answers. Nothing else. That is
the complete input the ledger reads — it joins a result to its call by `tool_use_id` and
looks at nothing in between — so the cut loses no information the extractor could have
used, and it takes 3486 entries down to 44.

Entries are kept **verbatim**. `redactSecrets` was run over all seven files before
committing and found nothing to mask.

## Every errored result was kept, not just the refusals

22 errored results are here and only 13 of them are guard refusals; the other 9 are
ordinary command failures (a `sed` that would not parse, an `Edit` whose `old_string` had
moved, a test run that timed out). They were kept deliberately. The classification this
corpus exists to exercise is *which errors are corrections*, and a corpus containing only
corrections would make that question unaskable — the extractor could return everything and
still look right.

Two of the nine earn their place specifically:

- **`Edit`: "String to replace not found in file."** followed by ninety lines of the
  caller's own source. One of those lines is a comment reading "the default genome must
  not pay for a ledger walk", and an earlier draft of the extractor read that comment as
  the guard's advice and filed it as a correction. It is the reason a permitted form has
  to be the guard's *closing* words rather than any cue anywhere in the message.
- **`Edit`: "No changes to make: old_string and new_string are exactly the same."** —
  a refusal that names no alternative at all. It must not become a ledger entry, because
  there is nothing a later session could do differently with it.

## What the corpus supports, and what it does not

The claim it can carry: **the identical `Blocked: sleep …` refusal appears in all seven
sessions, eight times in total (`470cb94a` hit it twice), and folds to one ledger entry
carrying the permitted form the guard named.** That is a delivery claim and it is
mechanical.

Three things it cannot carry, all of which matter:

- **Whether a session that receives the correction acts on it.** The assumption test says
  so itself: it proves delivery, not persuasion. A reflex that survived seven explicit
  refusals may well survive a note about them, and nothing here can see that.
- **Whether the ledger stays readable over months.** The unbounded-growth failure the
  solution node names appears after a long time and a lot of distinct guards. Seven
  sessions produce two corrections; the cap is exercised with synthetic sightings instead,
  which is a test of the cap and not of the growth curve.
- **How many refusal classes exist in general.** These seven sessions contain two. That is
  a fact about four days of one machine's build work, not a population estimate.

# `aged-ledger.json` — the growth curve, taken off the machine

The second bullet above says what the seven-session corpus cannot carry: *"whether the
ledger stays readable over months. The unbounded-growth failure the solution node names
appears after a long time and a lot of distinct guards. Seven sessions produce two
corrections; the cap is exercised with synthetic sightings instead, which is a test of the
cap and not of the growth curve."*

`aged-ledger.json` is that missing subject, and it is not synthetic. It is a verbatim copy
of this machine's real build-loop ledger — `~/.local/state/ost-build-loop/corrections.json`
— taken on 2026-08-31, after the loop had harvested **678 finished sessions** over four
weeks. `test/knowledge/corrections-file-size.test.ts` measures against it.

Copied byte-for-byte, `harvested` array and all. That array is 678 session ids and most of
the file's 33 KB, and trimming it would have destroyed the only thing that makes this
fixture worth having: it is the denominator. Three corrections **out of 678 sessions** is
the finding; three corrections on their own is a shrug. `redactSecrets` runs over every
`attempted` and `permitted` string on the way into the ledger, so the copy needed no
further masking; the paths and session ids in it are the same ones already carried verbatim
in `src/loop/wait.ts`.

## What it turned out to say, which is not what the node predicted

The solution node this fixture was cut for ("Refusals are written back as a standing
corrections file every session reads first") named its own failure mode as *"it grows
without bound"*. After 678 sessions the ledger holds **three** entries, `dropped` is **0**,
and `MAX_CORRECTIONS` (25) has never been approached. Entry growth is not the problem.

The briefing is over the bar anyway — **2,128 characters against a 2,000-character
threshold** — because one entry costs 1,577 of them on its own. That entry is the sleep
block, and it is expensive because `renderWaitAffordance()` appends three verbatim example
commands to it, two carrying ~200-character absolute paths. The overrun is per-entry cost,
not entry count.

Which is why neither expiry rule the assumption test proposed can work here, and the
instrument asserts that rather than assuming it: "drop anything not seen in 30 days" and
"keep only the top ten by count" are both counted in *entries*, and both drop **zero** of
these three. `MAX_BRIEFING_CHARS` and `fitToBudget` are the third rule, counted in the unit
that actually overran.

## What this fixture still cannot carry

It is one machine, one workspace, four weeks, and one agent's tool surface. Three refusal
classes is what *this* environment produced; a workspace with more guards, or a session
with a wider tool grant, would produce more, and at more entries the count-ordered eviction
in `fitToBudget` starts making choices this fixture never asks it to make. The synthetic
at-the-cap ledger in the instrument covers that arm deliberately, and it is synthetic for
the honest reason: nothing on this machine has ever reached the cap.
