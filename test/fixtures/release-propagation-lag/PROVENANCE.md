# release-propagation-lag corpus

`corpus.json` is the whole evidence base for
`test/release/registry-propagation-lag.test.ts`, which scores the assumption
test "Replay the last ten releases and count how many a pull-at-start instance
would have received". That node says the answer is "entirely in git history and
the registry's own version list", so this corpus is exactly those two lists and
nothing else — no authored readings, no labels, no judgement calls.

Regenerate with:

```bash
npx tsx scripts/harvest-release-propagation-corpus.ts
```

Captured 2026-09-01 at `a6c045627c2deba877f8f274974e9f8da2eb7cb8` (the tip of
`main` when the test was written), recorded in the `head` field so a later
re-cut is a visibly different corpus rather than a silently different one.

## The two lists

**`bumps`** — every commit reachable from `HEAD` that *added* a
`"version": "X.Y.Z"` line to `package.json`, newest first, 25 of them. A version
bump rather than a tag is the unit because most of this history was never
tagged: `git for-each-ref refs/tags` on `origin` names six versions against
fourteen the registry carried, so scoring on tags would drop most of the
releases that actually happened. Each entry keeps the *committer* date,
normalised to UTC — rebase and squash rewrite it to when the change landed in
this history, which is the closest thing the record has to "was on `main`".

**`registry`** — `GET https://registry.npmjs.org/ost-agent`, verbatim `time`
field, split into `published` (version → the instant it became resolvable) and
`unpublished` (npm's own record of the withdrawal). The response is HTTP 200
with fourteen versions in `time` and all fourteen also named under
`time.unpublished.versions`: the package was published, then withdrawn whole.

## What the corpus contains that the scoring window does not reach

Three facts are in `corpus.json` and outside the ten-release window the
assumption test fixed. The test asserts all three, because the window's verdict
is not readable without them:

1. **`registry.unpublished.time` is `2026-07-28T16:29:34.971Z`** and lists all
   fourteen versions. Nothing is resolvable from this package today. The 200 is
   a tombstone, not a catalogue.
2. **`bumps[0]`, version `0.23.0`, was committed `2026-07-28T16:34:17Z`** — four
   minutes and forty-two seconds *after* the withdrawal above. The newest
   release in the scored window was cut into a package that had already ceased
   to exist.
3. **`commitsSinceLastPublish` is 382.** `main` has moved 382 commits since
   `0.22.0`, the last version the registry ever carried, on 2026-07-27.

`localPrivate` (`package.json`'s `"private": true`) is recorded for the same
reason: `RELEASING.md:20` states there is no publish step and no npm package,
and `.github/workflows/` contains only `ci.yml`. The corpus carries the fact
rather than the test asserting it from memory.

## What it deliberately does not cover

One package and one publisher. It measures this project's release discipline
over its own history — which is what the assumption test asked for and all it
asked for — and says nothing about the npm registry's reliability in general,
nor about a future operator publishing their own fork.
