# Filesystem events from three working sessions

Scored by `test/runner/fs-event-classification.test.ts` against the rule in
`src/runner/fs-event-classification.ts`. Taken by
`npx tsx scripts/capture-fs-events.ts`, which rebuilds this directory from
scratch.

## The rule was committed before the capture existed

A rule tuned against the sessions it is scored on measures nothing except that it
was tuned, so `FS_EVENT_RULE` was written and committed while there was no capture
in the repository to look at:

| commit | what it fixed |
| --- | --- |
| `be65f30` | the rule: burst threshold, coalesce window, scratch patterns, ignored directories, both bars |
| `69b67d8` | scoring a folded write as one the run was told about |
| `440f5c1` | the contested denominator, with the `.git` mass removed |

`ground-truth.json` records `be65f30` as `preregistration` and the commit the
capture ran against as `capturedAgainst`. Every constant is asserted in the test,
so a later edit shows up as a changed expectation rather than as a better score.

## What was captured

Three sessions, each a fresh `git clone --local` of this repository at
`capturedAgainst` with `node_modules` copied in, driven by a committed script:

| session | what happens in it |
| --- | --- |
| `gate-run` | reads six files, runs `npx tsc --noEmit` and `npx vitest run`; another process edits a held file **while the suite runs**, runs a formatter-on-save pass over 26 files including three the session holds, drops editor scratch, appends to a held `run.log`, and atomically saves over `src/index.ts` between commands |
| `merge-lands` | reads seven files, then another process runs `git checkout --detach origin/gate-signal-density` — 26 files and git's own internals in one wave — and edits a held file afterwards |
| `unattended-loop` | reads five files, edits one itself, runs `npm run bundle` (which rewrites `dist/ost-agent.mjs`, a file it is holding) and `git add`/`git commit`; another agent edits the ruleset between commands |

**It is a reenactment, and `ground-truth.json` carries `"kind": "reenactment"` so it
cannot quietly be presented as anything else.** Every event in these files landed on
a real disk, written by real `tsc`, `vitest`, `esbuild` and `git` processes, with a
genuinely separate process playing the other writer. What it is not is three
sessions somebody happened to be having: nobody was watching the tree on 2026-08-03
when the merge landed on session `424486ec`, so a capture of that session does not
exist and cannot be made. The cut is one-directional — a reenactment holds the churn
its script produces and none of the churn nobody thought to script, so the rate here
is a **ceiling** on what a watcher would score in a tree with Spotlight, an editor
and a sync daemon in it.

Two cases were added after the corpus had been scored once, and both make it
harder rather than easier. The first pass put the other writer's edit inside
`npx tsc --noEmit`, which returns in about two seconds, so the write landed after
the command had ended and the case the opportunity was written from was not in the
corpus at all; it now lands inside `npx vitest run`, and the rule gets it wrong. The
first pass also formatted only files the session had never read, so the clause that
recognises a rewrite with identical bytes never fired; the formatter now covers held
files too. Nothing was changed in the rule in either pass.

## Ground truth is provenance, not a second opinion

`ground-truth.json` labels every file event from the driver's side, where the
capture knows which process wrote the file. The classifier is never given that: it
sees the path, git's opinion of it, the commands the session started, and the bytes
of the files the session is holding. A label is `meaningful` when an external
process changed a file the session had read and still held the old bytes of.

## The watcher is not the instrument this corpus was recorded with

The capture runs two instruments at once. The corpus is built from a **150ms
poller** that walks the tree comparing mtime and size. Node's recursive `fs.watch`
— FSEvents on macOS — runs beside it, and what it delivered is recorded per session
because it is a result rather than a detail of the harness:

| session | writes that happened | delivered by `fs.watch` | events it emitted | of those, for writes older than the session |
| --- | --- | --- | --- | --- |
| `gate-run` | 41 | 40 | 1350 | 1306 |
| `merge-lands` | 22 | **0** | 0 | 0 |
| `unattended-loop` | 64 | 56 | 925 | 855 |

Across the three, the watcher delivered 96 of 127 writes and 2161 of the 2275 events
it emitted were for files last written *before* the session began. In `merge-lands`
it delivered nothing at all — a `git checkout` of 26 files went past it in silence.
Standalone probes agreed: a watcher opened on a fresh clone ten seconds after the
clone finished received 1009 events in one flush thirteen seconds in, every one for
a file written before the watch opened and none for the five files written under it
while it ran; arrival lagged the write by 325–1411ms in one probe and by 4.2 seconds
in another.

Three consequences, and the last one is the reason the numbers in the test are worth
reading at all:

1. Every timing clause in the rule is read off the file's **mtime**, not off the
   moment the event arrived. Read off arrival, a burst threshold counts kernel
   flushes rather than branch operations.
2. Watcher deliveries are merged into the corpus only for writes made during the
   session, and only for files the poller could not see because they were already
   gone — the transient scratch case. Everything else in the fixture is the poller's.
3. **The assumption test measures classification and says nothing about delivery.**
   The rule clears both of its clauses on this corpus; the watcher that was supposed
   to feed it missed a quarter of the writes and one entire session. That is a fact
   about the candidate, not about the harness, and it is why the corpus was recorded
   by the poll the solution names as its own cheaper fallback.

## What this corpus cannot support

- **`node_modules` is not in it.** The poller skips it and the watcher's events for
  it are dropped, so the `node_modules` clause of `alwaysIgnoredDirs` is exercised
  only by the synthetic cases in the test.
- **Churn shorter than 150ms is under-counted.** A scratch file created and removed
  inside one poll interval is only in the corpus if `fs.watch` happened to deliver
  it, which in one of these three sessions it never did.
- **Three sessions is three sessions.** 74 external write events is a small
  denominator, and one misclassification moves the rate by 1.4 points.
