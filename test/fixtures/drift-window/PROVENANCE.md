# Drift-window corpus — how it was cut

The census in `test/runner/drift-sentinel-window.test.ts` measures how many run steps
stood between the moment the ground moved under a run and the moment that run acted on
stale text. It has to run offline and give the same answer next year, so the corpus lives
here rather than being read off the machine that produced it. This file records exactly
what was taken, so anyone can disagree with the cut instead of with the number.

Cut by `scripts/harvest-drift-corpus.ts` on 2026-08-06:

```bash
npx tsx scripts/harvest-drift-corpus.ts ~/.claude/projects test/fixtures/drift-window \
  768f36cf-a860-4353-b789-9643cd30397a
```

## What is here

| File | What it is |
| --- | --- |
| `corpus.json` | How many transcripts were read, and one summary line per session whose **text** holds `String to replace not found in file` — 42 of them — recording which tool delivered each match and whether the session actually recorded a collision. |
| eight `*.jsonl` | Reduced transcripts of the **8** sessions where an edit tool returned that error. These are what the census replays. |

`redactSecrets` was run over every committed result. It masked one string, in
`agent-a61e055e71299a8ed.jsonl`.

## How the sessions were cut

Every `*.jsonl` under `~/.claude/projects`, walked recursively — **561 transcripts**,
including the subagent transcripts under `subagents/`, which the other censuses in this
repo do not read. They are included here because a subagent is a run with its own steps
and its own collisions, and leaving them out would have been the flattering cut: all
three of them land in the `unseen` bucket and none in the passing one.

The same subagent transcript is filed under every parent session that ran it, so one
copy of `agent-ac6008b9601a0f067` was skipped as a duplicate. Counting it twice would
have inflated both the denominator and the collision count.

**A session is a collision only when an edit tool returned the phrase as an error.** That
scoping is the whole difference between 42 and 8, and it is not a detail: this vault holds
nodes *about* this failure, so `ost_next_work` hands the phrase back as node text (51 of
the 91 matches), `Read` returns it out of committed files (25), and a `Bash` grep that went
looking for collisions prints it once per hit (4). Only the 11 `Edit` matches can be the
failure happening. A text scan over the evidence channel would have reported five times
more collisions than occurred, all of them the tree quoting itself.

## What "reduced" means

The committed transcripts are reductions, not summaries. Every tool call keeps its
position in the run, because the step distance is the measurement. What is dropped:

- **tool calls** keep `id`, `name` and `file_path`, and nothing else;
- **tool results** keep `is_error` and the first 300 characters — exactly the window
  `replaySession` reads, so the reduction cannot cost the reader a signal — plus a
  `mentionsPhrase` flag computed on the **full** result, so a match found in output too
  large to commit is still counted;
- **`edited_text_file` attachments** keep only the filename; the snippet of file content
  they also carry is neither read by the census nor ours to commit;
- everything else — assistant prose, system entries, hooks, file-history snapshots — is
  dropped.

## What was deliberately left out

- **The session that built this census** (`768f36cf-…`, recorded in
  `corpus.json.excludedSessions`). It grepped 561 transcripts for the phrase, which put
  the phrase in its own transcript; a count must not include the searches its own
  construction caused. It recorded no collision and would have entered as mention-only.
- **Sessions with no edit failure**, from the replay set. Their bodies are megabytes of
  unrelated `Bash` output and the only thing the census needs from them — which tool
  handed the phrase over — is in `corpus.json`.

## What the corpus cannot support

- **A transcript is not an mtime log.** Movement is visible here only when a tool result
  happened to report it. So a measured window is a **lower bound** — the mtime advanced at
  or before the step that reported it, never after — and a session with no movement event
  is `unseen`, not `still`. Four of the eight are `unseen`, and nothing in the record says
  whether the ground moved in them. Reading those four as evidence against the sentinel
  would be reading a gap in the instrument as a fact about the world.
- **A subagent cannot see the signal the parent gets.** The harness files its
  external-edit notice with the session that owns the file, so three of the four `unseen`
  collisions are subagents that had no movement signal available to them at all. That is a
  property of the record, not of the ground; the sentinel under test samples mtimes itself
  and would not depend on it.
- **The verdict turns on how "movement" is read.** Counting any movement in any file the
  run had read — which is what the sentinel under test does, since it samples every one of
  them — gives 4 sessions with room, and the bar of 3 is met. Counting only movement in
  the file that later failed gives 2, and the bar is missed. The census reports both and
  flags the disagreement rather than picking one.
- **It says a sentinel would have had time to fire. It does not say firing helps.** An
  unattended run interrupted by an operator saving a file, with no authority to decide what
  to do about the interruption, may be worse off than one that failed at the write. The
  false-stop rate belongs to the preflight candidate and is not measured here.
- **One machine, one operator, 8 collisions.** Every collision here happened to this
  project's own passes over its own repository. It is evidence about how an OST-Agent pass
  collides with a second writer, not about how anyone else's would — and eight is a small
  enough pool that one more session could move the count.
