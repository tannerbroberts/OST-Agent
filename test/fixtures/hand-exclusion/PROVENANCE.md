# Hand-exclusion corpus — how it was cut

The census in `test/telemetry/hand-exclusion-census.test.ts` counts how many distinct test
files this project has ever suppressed by typing an exclusion into a runner invocation. It
has to run offline and give the same answer next year, so the corpus lives here rather than
being read off the machine that produced it. This file records exactly what was taken, so
anyone can disagree with the cut instead of with the number.

## What is here

| File | What it is |
| --- | --- |
| `exclusions.jsonl` | Every value behind a test runner's exclusion flag found in **657** session transcripts under `~/.claude/projects` — 19 exclusions from 14 invocations, in the order they were issued. Both subjects are kept: the 15 that name a test file and the 4 that do not. |
| `unread-invocations.jsonl` | The 320 runner invocations whose shell the reader refused to guess at, kept so the denominator is visible rather than quietly smaller. |
| `corpus.json` | How many transcripts were found, how many were nested, how many runner invocations were read, and which session was excluded. |
| `785ea509-….jsonl` | Ten entries cut from the real transcript: the session the opportunity was written from, retyping one exclusion for 58 minutes. |
| `subagents/agent-a75….jsonl` | Four entries cut from a subagent's transcript, **kept nested**, because being found at all is what the headline turns on. |

`redactSecrets` was run over everything committed here; it found nothing to mask.

## How the exclusions were lifted

Every `Bash` tool call in every transcript on the machine, parsed into the command
invocations inside it, filtered to those whose executable is a **test runner** —
`vitest`, `jest`, or `npm test` / `npm run test`. Only a runner's `--exclude` is read.

That filter is the whole design. `--exclude` is common in this record and almost never
about tests: 46 `rsync --exclude node_modules`, 35 `--exclude .git`, a `grep
--exclude-dir=dist`, and a harvest script passing `--exclude <session-id>` so a census
would not count itself. A reader that lifted the flag rather than the invocation would
have reported dozens of "quarantined tests", none of which are tests.

Two smaller rules, both visible in `HAND_EXCLUSION_RULE`:

- **A file descriptor is not a file.** `npx vitest run 2>&1 | tail` tokenises as
  `… run` `2` `>` `&` `1`. Keeping the `2` recorded every pipeline in the corpus as an
  invocation that named a file to run; the `narrowed` count was 1890 of 1912 before the
  redirection rule and is 1351 after it.
- **`npm run gen:skill` is not a suite.** It appears on the same command line as a real
  exclusion in the record, so `npm` is read only when its script is a test script.

## What was deliberately left out

- **The session that built this census** (`5bca8279-…`, excluded by id in `corpus.json`).
  It types `--exclude` into probes all afternoon and quotes the real commands back to
  itself while writing the module. A count must not include the exclusions its own
  construction caused.
- **`--exclude 'node_modules/**'` is counted, but not as a test.** It is the runner's own
  default restated by hand beside a real exclusion, four times. It is reported as
  `defaultsRestated` because it is evidence about the cost of the hand-typed form — but
  nobody quarantined `node_modules`, and counting it would inflate the number the bar is
  read off.
- **Anything the reader would have had to guess at.** A command containing `$(…)`,
  backticks, `${…}` or unbalanced quoting is recorded in `unread-invocations.jsonl` and
  counted neither way.

## Fidelity

**The walk recurses, and the count depends on it.** Claude Code stores a subagent's
transcript under `<project>/subagents/**`: 346 of the 658 files on this machine are
nested. Three of the four distinct test files below were excluded by a subagent, so the
one-level read `readTranscriptSessions` performed until 2026-08-10 finds **one** file and
reports this census **red**. The test asserts that failure mode directly against the
committed fixture, so the reader cannot regress to it silently.

The unread bucket is 14% of the runner traffic, which makes "could an exclusion be hiding
in it" the question that decides whether the count is safe. The harvester checks the
**unclipped** text and records the answer as `unreadableMentioningExclude`: exactly **one**
unreadable command contains `--exclude`, and it is a `gh pr create --body "$(cat <<EOF …)"`
whose prose quotes a `vitest run --exclude` command that was never run. So the blind spot
is large and, for this flag, empty.

Re-running the reader live will now find *more* than 19 exclusions — the transcripts keep
growing — which is why the corpus is frozen here.

## What the corpus cannot support

- **It records exclusions that were TYPED, not suppressions that were WANTED.** An
  operator who ran a narrower suite instead of excluding anything is invisible here.
  `narrowed` counts the 1351 invocations that named specific files or a name filter, but
  that number is context, not evidence: naming the file you are working on is ordinary
  iteration far more often than it is a workaround, and nothing in a transcript separates
  the two.
- **Nobody ever quarantined by editing a test.** Not one `test.skip(`/`describe.skip(` was
  added to a test file in the whole record, checked separately — so the flag really is the
  only surface this behaviour uses, and this corpus is not missing a second one.
- **Breadth is not repetition.** Four distinct files clears the bar the assumption test
  fixed. But no file was excluded in a second session, and three of the four were excluded
  by one subagent inside two minutes while it worked around failures its own untracked
  files were causing. What the record supports is saving the retyping *within* one session;
  a committed list is a place to declare something for *next* time, and nothing here shows
  a next time.
- **One vault, one operator.** Every invocation here was issued by this project's own
  passes over its own repository. It is evidence about how an OST-Agent pass suppresses a
  test, not about how anyone else would.
