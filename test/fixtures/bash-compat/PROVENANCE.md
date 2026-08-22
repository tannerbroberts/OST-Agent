# bash-compat fixtures — where each file came from

The subject of `test/runner/helper-bash-compat-lint.test.ts` is **every helper this
project installs**, and that set is discovered by walking the working tree
(`discoverShippedHelpers`) rather than listed here. What is committed here is the part of
the corpus that cannot be discovered: a failure that has already been fixed, and the
verdict of a tool that is not a dependency of this project.

## `ost-reports.recorded.sh` — the known failure, reconstructed

The recorded failure this whole check exists for:

```
/Users/tanner/.local/bin/ost-reports: line 21: mapfile: command not found
/Users/tanner/.local/bin/ost-reports: line 22: FILES: unbound variable
/Users/tanner/.local/bin/ost-reports: line 23: COUNT: unbound variable
```

`TRANSCRIPT:3d729ebc-348f-4d45-8f3c-25df1de8fbc9`, pinned in
`test/fixtures/path-failure-attribution/failures.jsonl:97`.

**The helper it happened to has since been fixed, so the live artefact no longer contains
the failure.** `~/.local/bin/ost-reports` now spells the same operation as a `read` loop
and carries a comment explaining why. A check that could only be exercised against a bug
somebody had already fixed would have nothing to run on, so the failing form is
reconstructed here and committed as a regression fixture.

The reconstruction is the fixed file with its four-line workaround (a two-line comment,
`FILES=()`, and the `while read` loop) replaced by the two lines the workaround replaced:
a `# Newest first.` comment and the `mapfile` call. It is pinned by all three recorded
error lines at once — `mapfile` lands on line 21, the `FILES` reference on 22 and the
`COUNT` reference on 23, exactly as the transcript recorded them. Nothing else in the file
is changed.

## `ost-reports.fixed.sh` — the same helper today, as the negative control

Copied verbatim from `~/.local/bin/ost-reports` on 2026-08-21.

This is the load-bearing half of the corpus, not decoration. The comment the fix left
behind reads "Spelled with a read loop rather than `mapfile`, which is bash 4+" — so a
linter that does not understand comments flags the person who fixed the bug, on the line
where they explained the fix. The spec asserts zero findings here.

## `shellcheck.json` — what the off-the-shelf linter actually says

Produced by `scripts/harvest-shellcheck-floor-corpus.ts` against ShellCheck 0.11.0
(Homebrew, 2026-08-21). Every helper, plus the generated pre-commit hook, plus a probe
holding one construct from each bash release above the floor, each run under `-s bash` and
`-s sh`.

It is committed rather than re-run in the suite because ShellCheck is not a dependency of
this project and was not installed on the machine that wrote the lint — a gate that needs
a binary the developer may not have is a gate that gets skipped, and a skipped gate
reports green. The version is recorded in the file because the finding is about a specific
version's capabilities.

## `expected-findings.json` — the bar

The committed expected set the assumption test measures against: the known `mapfile`, and
nothing else. Findings outside it are counted, and at most 2 are allowed across every
helper.
