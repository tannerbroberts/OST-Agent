# Workspace-map coverage corpus — how it was cut

The census in `test/runner/workspace-map-coverage.test.ts` asks whether a workspace map
small enough to carry into every session (under 2,000 characters) would have answered the
path lookups this project's own passes actually failed. It has to run offline and give the
same answer next year, so the corpus lives here rather than being read off the machine that
produced it. This file records exactly what was taken, so anyone can disagree with the cut
instead of with the number.

Everything here was produced by `scripts/harvest-workspace-map-corpus.ts`, committed so the
cut is a rule anyone can re-run:

```bash
npx tsx scripts/harvest-workspace-map-corpus.ts ~/.claude/projects test/fixtures/workspace-map
```

## What is here

| File | What it is |
| --- | --- |
| `lookups.json` | The 25 **workspace path-lookups** — path-shaped failures that name a location inside this workspace — each with the subject as it was written and the absolute path it resolved to. |
| `layout.json` | A snapshot of the directory tree the map renders from and is scored against: absolute directory → sorted child names. Directory names only, no file contents. |
| `corpus.json` | The counts: the upstream size, how many were path-shaped, every exclusion, and the survivors. |

## The upstream cut

The starting point is **not** raw transcripts but the committed
`test/fixtures/path-failure-attribution/failures.jsonl` — every failing tool call found in
646 session transcripts, 719 of them, already redacted and bounded. `classifyFailure` (the
same classifier that fixture's own census uses) selects the **76 path-shaped** failures.
Starting here rather than re-reading transcripts means the two corpora cannot disagree about
what a path failure is.

The one thing the upstream fixture drops is the cwd each `Bash` call ran in, which a relative
subject needs to resolve. That is read back from the raw transcript entry — but only for the
sessions that appear in the corpus (a few dozen), never by walking all of `~/.claude/projects`,
because a full walk blocks on the home directory's cloud-backed mounts. A call whose cwd is
not recovered falls to the `cwd-unknown` exclusion, counted below.

## Why the denominator is workspace lookups, not all 76

A map of **this** workspace can only answer a lookup that is **about** this workspace. The
harvest partitions the 76 path-shaped failures into the 25 it keeps and the 51 it excludes,
and every exclusion is a count in `corpus.json`, published rather than defended:

| Exclusion | n | Why a workspace map cannot answer it |
| --- | --- | --- |
| `not-a-path` | 16 | The subject is a glob-expanded command-line flag (`--include=*.ts`), not a path. |
| `unnamed` | 11 | The message names no path at all (`File does not exist`, a bare `git` fatal). |
| `foreign-project` | 8 | The lookup is in another repository (tetrix, apple-epoch-primes, ost-benchmarks). |
| `ephemeral` | 10 | A `/tmp` or `/private/tmp` scratchpad, a `.claude/worktrees` checkout, or a plugin dir — not the stable workspace. |
| `outside-territory` | 4 | Resolves outside the mapped roots (home, `dev`, the repo, the vault, sibling vaults). |
| `cwd-unknown` | 2 | A relative subject whose session cwd could not be recovered. |

`16 + 11 + 8 + 10 + 4 + 2 + 25 = 76`. The exclusions and the survivors partition the
path-shaped set exactly, and the test asserts that they do.

**This is the honest boundary, and it was drawn before the coverage was scored — not tuned to
reach a number.** Over the *whole* path-shaped corpus a sub-2,000-character map answers only
about 30%; the flag-globs, unnamed absences, foreign projects, and scratchpads are the bulk of
that record and no workspace map could ever serve them. Restricting the denominator to genuine
workspace lookups is the most favourable honest reading, and even there the map answers **16 of
25 (64%)** — below the 70% bar. The map's section list was fixed on principle (home, `dev`, the
repo tree, the vault tree) before any per-lookup result was seen; no section was added
afterwards to move the count.

## What the count cannot support

- **It records failures that were suffered, not failures that were avoided.** A pass that
  stopped guessing because its last three guesses failed appears here as never having needed
  the map. That bias runs toward the answer the solution wants.
- **It scores the map against paths reached for by runs that had no map** — a corpus shaped by
  the absence of the thing being tested.
- **It says nothing about staleness** (a map handed over at the first action and wrong by the
  fortieth) or about whether a run that is handed a map consults it rather than probing anyway.
- **One machine, one operator.** Every failure here was caused by this project's own passes.

## What the number came out to be, and why it is refuted

`layout.json` snapshots the real tree; the map renders to **1,619 characters** and answers
**16 of 25** workspace lookups (**64%**), against a **70%** bar — refuted. Of the 9 it misses,
**six** are probes for a specific `.test.ts` leaf file inside a directory the map already lists
(the map answers "which directories are here", not "which files"), and the other three are
single deep paths. Listing the test leaves that would answer the six takes the map past its own
2,000-character budget — the size clause and the coverage clause genuinely conflict on this
corpus, which is the squeeze the node named. The map cleanly serves the workspace-root and
repo-boundary confusions the opportunity actually documented; the leaf-file probes are a
different failure class the parent opportunity itself distinguishes.
