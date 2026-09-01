# The last hundred states of this repository's own vault

Captured 2026-09-01 from `ost-agent-meta`, the meta-vault this repository maintains, to
answer the question "Check whether the writing version is recoverable from vault state at
all" against real history rather than against a vault a test built to be recoverable.

## What is here

- `commits.json` — the last 100 commits of the vault, newest first, each with its sha, its
  committer date, the machine-written files under `.ost-agent/` it held, and an `oversize`
  list (see below).
- `blobs/<id>` — the file contents, de-duplicated by sha256 the way git does. 100 states of
  a live vault come to 147 unique blobs.

## How to reproduce it

```bash
node test/fixtures/writing-version/capture.mjs ../../ost-agent-meta 100
```

The script copies bytes out of `git show`; it does not summarise them.

## What it captures, and what it leaves out on purpose

**Captured:** `.ost-agent/state/*` and `.ost-agent/health/runs.jsonl` — the machine-written
state a resolver is entitled to read.

**Not captured:** `.ost-agent/NEXT-BUILD.md`, the operator's briefing. It is the *only* file
in these hundred states that names the version actually running (`0.23.0`), and it names it
inside an English sentence a person wrote — "`package.json` remains at `0.23.0` — unchanged
since the thirty-seventh pass" — byte-identical in all hundred. A resolver that reads prose
is one that will one day read the wrong sentence with full confidence, so the omission is
the fixture's position and not a gap in it.

**Recorded rather than copied:** files over 8 KB, all of them adapter cursors
(`.ost-agent/state/transcript.json`). For each, `oversize` keeps the path, the byte count
and whether the bytes hold a semver-shaped token. Across all hundred states none of them
does — so leaving the megabyte out costs the fixture nothing, and a cursor that ever starts
carrying a version breaks the assertion in
`test/ost/writing-version-recoverable.test.ts` rather than slipping past a fixture that
stopped looking.

## The finding this fixture exists to hold

Across all hundred states, exactly one machine-written file names a version:
`.ost-agent/health/runs.jsonl`, whose last record is `cliVersion: "0.21.0"`,
`startedAt: "2026-07-27T15:51:36.854Z"`. The states themselves run 2026-08-31T11:44:28-05:00
to 2026-09-01T03:43:49-05:00 — the stamp is **35 days and two minor releases** older than
the oldest of them, and byte-identical across all hundred, because the loop that wrote it
stopped on 2026-07-27 and nothing noticed.

The build that actually wrote these states was `0.23.0`. Verified in the OST-Agent
repository, where `VERSION` has read `0.23.0` since `dd673e43` (2026-07-28):

```bash
git log --format='%H %ad' --date=iso-strict -- src/index.ts   # newest entry: 2026-07-28
git show dd673e43:src/index.ts | grep 'export const VERSION'  # 0.23.0
```

So a resolver that answered with the newest version it could find would have said `0.21.0`
a hundred times out of a hundred, unambiguously, and been wrong a hundred times.

Two things follow, and both are in `src/ost/writing-version.ts`:

1. Freshness is the load-bearing clause, not a refinement. Unresolved sends a reader to
   look; confidently stale does not.
2. A version stamp alone would not have been enough anyway. `VERSION` has not moved since
   2026-07-28 while 205 pull requests merged, several of which changed what counts
   as done — which is why `legacy-fallback.ts` had to express its own boundary as a date.
   The stamp therefore carries an accounting fingerprint beside the version.
