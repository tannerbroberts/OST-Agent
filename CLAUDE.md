# CLAUDE.md

Guidance for Claude Code working in this repository. See [`CONTRIBUTING.md`](CONTRIBUTING.md)
for the load-bearing invariants (the closed tool allowlist, the generated skill, adapter
rules) — this file is about how work gets finished.

## How to report back

**Keep it simple for the user. The details don't matter so much as how well the details
align with the user's vision.** Lead with what it means, not with what was touched. Names,
counts and `file:line` belong in the commit, the PR body and the tests — surface them here
only when the user asks for them or when one of them is the point.

## Standing directive: finish the work by shipping it

**Work is not done when the diff is ready. It is done when it is on `main`.** Carry every
change through the whole sequence — branch, commit, push, PR, merge — without being asked,
and without pausing to offer it. That authorization is standing and does not expire at the
end of a conversation; "want me to commit this?" is a question that has already been
answered, permanently, yes.

The flow:

1. **Branch off `main`.** Never commit directly to it. Name the branch for the work
   (`tier1-wedge-batch`, `remove-genome`).
2. **Commit** in conventional-commit style (`feat:`, `fix:`, `docs:`, `chore:`,
   `refactor:`), each commit green on its own. The message says *why* — this repo's
   history is an argument, not a list of files touched.
3. **Push and open a PR** whose body states the problem, what changed, and what was
   verified. If a claim was checked by running something, say what was run.
4. **Merge to `main`** once CI is green, and delete the branch.

## The gates that make merging-without-asking safe

Run these before pushing. **A red gate is the one reason to stop and report instead of
merging** — report the failure with its output rather than working around it.

```bash
npx tsc --noEmit     # must exit 0
npx vitest run       # must be green
```

Two more, each conditional and each enforced by CI, so skipping one turns into a failed
build rather than a silent drift:

- **Changed anything under `src/`?** Run `npm run bundle` and commit
  `dist/ost-agent.mjs`. The plugin launches that committed artifact; the `bundle-drift`
  job in `.github/workflows/ci.yml` fails if it is stale.
- **Changed `src/knowledge/ruleset.ts`?** Run `npm run gen:skill` and commit the
  regenerated `SKILL.md` (`test/skill/drift.test.ts` holds you to it).

Leave the working tree clean. An untracked file left behind is a file the next
auto-committing tool will attribute to itself.

## Where the standards for this repo are written down

`docs/reference/v1-readiness.md` is the bar: 75 criteria, each stating a check that can be
run today, with a status and file:line evidence. When work closes a criterion, update its
entry in the same commit — status, the date, and what the test that pins it actually
proves. **A criterion whose status is carried by memory rather than by a test is how that
document has been wrong before.** Prefer converting a finding into a committed test over
recording it as prose.
