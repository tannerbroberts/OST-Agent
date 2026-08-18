# Write-intent preflight corpus — how it was cut

`test/runner/write-intent-preflight-false-stop.test.ts` replays
`evaluateWriteIntentPreflight` (`src/runner/write-intent-preflight.ts`) over `corpus.json`
and asserts both halves of the assumption test's bar: it refuses the one recorded
collision, and it refuses fewer than 1 in 10 of the sessions that finished cleanly. This
file records exactly how each case was built, so the reading can be checked or disagreed
with rather than trusted.

## The collision case

`424486ec-3489-4b53-8e2b-012232d221ab` is the session named in "Two agents sharing my
vault can trample each other" and "A second process is editing the same files, and a
failed string match is the only notification" — the one collision this building has
actually recorded, not a synthesized one. The raw transcript (kept outside this repo,
under `~/.claude/projects/-Users-tanner-dev-OST-Agent/`) still exists, and every number in
this case is read off it directly, not off the vault's prose summary of it:

| Field | Value | Where it comes from |
| --- | --- | --- |
| `intent.paths` | `["docs/reference/v1-readiness.md"]` | The only file this session's own `Edit` calls ever named. |
| `intent.referenceHeadSha` | `3fd68a8…` | `git log -1 --before=<session's first transcript timestamp, 2026-07-30T18:51:23.761Z> --format=%H main`, run against this repository. |
| `snapshot.headSha` | `cf75488…` | The session's own `git log --oneline -1`, entry 256 of the transcript: `cf75488 Merge pull request #22 from tannerbroberts/tier5-bounds-and-scale`. |
| `snapshot.dirty` (6 of 22 real dirty paths) | mtimes `14:01:45`–`14:03:57`, 2026-07-30, `-05:00` | Entries 252 and 256: `ls -lT` / `stat -f "%Sm %N"` output the session ran on itself while diagnosing the failure. Converted to epoch ms at America/Chicago (`-05:00`), the offset every commit in this repository's history from that day carries. |
| `observedAtMs` | `1785438275000` (`14:04:35 -05:00`) | The `date` output alongside the second mtime probe, entry 256. |

**What is real and what is derived.** The `git log --oneline -1` result, the two mtime
probes, and the session's own `Edit` targets are verbatim transcript content — nobody
invented a number here. `intent.referenceHeadSha` is the one derived field: the transcript
never ran `git log` at session start, so it is reconstructed from this repository's real
commit history at the session's real first timestamp. That reconstruction is a single
`git log --before` call against an unambiguous linear window (`3fd68a8` was `HEAD` on
`main` from `2026-07-30T13:31:52-05:00` until the merge landed at `13:54:17-05:00`, and the
session started inside that window, at `13:51:23-05:00`) — not a guess.

**What the full dirty list says and does not say.** `git status --porcelain` at the
diagnostic moment (entry 247/248) named 22 dirty paths; this case commits mtimes for the 6
the session happened to probe. The other 16 are real too — omitted rather than assigned a
made-up mtime. None of this changes the verdict: the case is refused on `headSha` alone
(see "What actually caught it", below), so the incomplete `dirty` map costs the corpus
nothing here, but it means this case cannot be used to test the `path-contended` arm of the
rule — nothing in this corpus does (see "What this cannot support").

## The clean cases

Five sessions, chosen from the 13 sessions this project's own transcripts show running
`git status --porcelain` at all (`grep -l "git status --porcelain" ~/.claude/projects/-Users-tanner-dev-OST-Agent/*.jsonl`), narrowed to the ones where that command ran
**before the session's own first `Edit`/`Write`/`MultiEdit` call** — the only ones that
represent an honest "before this run has touched anything" preflight moment. (Eight
sessions were left out for exactly that reason: their first `git status --porcelain` came
after the session had already been editing for a while, so any dirty path in it could be
the session's own doing, and using it would not test anything. A ninth, `0f8b6427-…`,
was left out because `HEAD` moved between its start and its pre-edit check — from `git log`,
by five commits this same operator made earlier the same evening — and nothing in the
reduced record can say whether that was this session's own prior work or a second writer,
so it is neither a confirmed clean case nor a confirmed collision.)

For each of the five kept sessions:

- `intent.paths` is every repo-relative path the session's own `Edit`/`Write`/`MultiEdit`
  calls ever named, across the whole session — the closest honest proxy for "what it
  intended to write" that exists, since the declare-before-you-start step this feature
  adds did not exist yet when these sessions ran. Paths outside `dev/OST-Agent` (scratch
  files under `/private/tmp`, this project's own memory notes, an unrelated vault) are
  dropped: they are not in the repository this preflight guards.
- `intent.referenceHeadSha` and `snapshot.headSha` are the same value: `main`'s tip at the
  session's first transcript timestamp and at its pre-edit status-check timestamp,
  respectively, both read via `git log --before=<ts> --format=%H main` against this
  repository. All five came back equal — confirmed, not assumed — which is what makes
  them usable as a false-stop test of the `head-moved` arm at all.
- `snapshot.dirty` is the real `git status --porcelain` output at that pre-edit check,
  filtered to lines matching a porcelain status prefix. Four of the five show nothing
  dirty. `4ff7b605-…` shows one (`test/zz-probe.test.ts`), which does not overlap that
  session's own later-declared paths and is dropped from the committed snapshot for the
  same reason the collision case's 16 unprobed paths are: no mtime was ever captured for
  it, and it does not change the case's verdict either way (`evaluateWriteIntentPreflight`
  never reads a dirty path that is not in `intent.paths`).
- `observedAtMs` is the pre-edit status check's own transcript timestamp.

## What this corpus cannot support

- **It is six sessions, one operator, one machine.** The false-stop share this test reports
  is a share of six, not a share of "sessions in general" — the same caveat every corpus in
  this repository's `test/fixtures/` carries, stated here rather than left implicit.
- **Nothing here exercises `path-contended`.** The rule's third arm — a declared path
  already dirty with a fresh mtime, and `HEAD` untouched — never fires in this corpus: the
  collision is caught on `head-moved` alone, and every clean case's declared paths are
  either not dirty at all or dirty in a file the run never declared. `recentDirtyWindowMs`
  is asserted for its value, not for its boundary; a corpus that could test it would need a
  second recorded collision where two processes edit the same file without either of them
  committing, which has not been observed yet.
- **One excluded session (`0f8b6427-…`) is a real, unresolved ambiguity, not a coverage
  gap glossed over.** `HEAD` moved under it too, by commits this operator plausibly made in
  an earlier phase of the same long session — plausible, not confirmed, because commit
  authorship inside one operator's own history cannot be attributed to "this session" from
  the reduced record alone. Counting it either way would be reading a gap in the instrument
  as a fact about the world.
- **This says the rule matches the one collision recorded and does not false-stop on six
  ordinary sessions. It does not say the `head-moved` signal generalizes** to a busier
  repository, a second concurrent human, or a rebase — only that it is what actually
  separated this building's one real collision from ordinary work, and that six unrelated
  sessions' honest preflight moments never asked it to refuse them.
