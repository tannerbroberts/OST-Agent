# Recorded runner output — instrument-red-now

`runner-output.json` is not a set of plausible strings. Every entry is the actual
`{status, stdout, stderr}` of a `spawnSync("npx", ["vitest", "run", <target>])`
run on 2026-08-31, captured by driving each failure mode deliberately and writing
down what came back. It exists because the classifier in
`src/ost/instrument.ts` sorts on the runner's *wording*, and a classifier tested
against wording somebody imagined is a classifier that agrees with its author
rather than with vitest.

Captured against this repository, `vitest@2.1.9`, `npm` 11.x, macOS. The spec
files that produced them were throwaway; what each one was written to do is in
the `why` field of every entry.

Two of these changed the code they were meant to test, which is the reason the
capture was worth the trouble:

- **`empty-spec`** — vitest says `No test suite found in file <path>`, *not*
  "No test files found". `collectedNothing` matched only the second string, so
  an existing spec with no test case in it was classified `red` — a file that
  cannot fail, minting a permit — while the comment above that function said the
  empty-spec case was covered. It was not, until this capture.
- **`runner-absent`** — an offline box with an empty npx cache answers
  `npm error code ENOTCACHED`, not the "could not determine executable to run"
  wording the first draft of the detector looked for. A first attempt at this
  capture on a networked box came back **green-adjacent for a different reason
  entirely**: npx silently downloaded `vitest@4.1.11` and ran the spec under it.
  An instrument run in a checkout that has not installed its own dependencies is
  therefore not measuring that checkout's suite at all.

## Entries

| id | what was run | what it is evidence of |
| --- | --- | --- |
| `assertion-fails` | a spec asserting `2 + 2 === 5` | the honest red: a collected spec whose assertion failed |
| `unbuilt-local-module` | a spec importing `../../src/not-built-yet.js` | test-first red — the solution's own module is missing, and this must stay `red` |
| `empty-spec` | a spec file with no test case | `no-spec`: collected, nothing in it can fail |
| `missing-package` | a spec importing `totally-missing-package` | `unavailable`: a dependency of the box, not of the repository |
| `passes` | a spec asserting `1 === 1` | green — the case the write guard refuses |
| `runner-absent` | offline npx, empty cache, no local vitest | `unavailable`: no runner was produced, so no spec ran |
| `spawn-failed` | a binary that does not exist | `unavailable`: the process never started (`error`, `status: null`) |
