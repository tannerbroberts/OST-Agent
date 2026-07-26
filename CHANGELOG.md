# Changelog

## 0.15.0

- **`ost-agent lanes` now reports a lane a test states in its own prose.** A test could
  declare `**Lane: compute-only.**` in the sentence a human reads and carry nothing in the
  `lane:` field the tool reads — so every tool correctly treated it as unclassified, and the
  operator was told to go classify a test that already said what it was. On the meta vault
  that was **4 of 82** unclassified tests, two of them `compute-only`, including the one a
  previous pass could only run by reading its prose by hand.
  - **Reported, never applied.** A prose declaration is unverified text; promoting it to a
    label would let a node authorize its own execution by asserting a lane in a sentence.
    `runnableByCompute` does not consult it, and a test pins that invariant. The output is a
    paste-ready `ost-agent lane … --set` line per finding; the permissive call stays a
    human's.
  - Flags a prose/frontmatter *conflict* separately (`includeConflicts`), since a stale
    declaration and a wrong label look identical from the outside and only a person can tell.

- **The release path no longer depends on a step an unattended pass cannot take.** `0.10.0`
  through `0.13.0` were cut, tagged locally and never published: the workflow's only trigger
  was a published GitHub Release, which is manual, and this loop's container gets **HTTP 403**
  from its git proxy on `git push --tags` — which removes the tag *and* any Release pointing
  at it.
  - The workflow now also triggers on `push: tags: ["v*"]`, and `RELEASING.md` documents
    `gh workflow run npm-publish.yml --ref main` as the path that still works when tags cannot
    be pushed at all.
  - Because three triggers can now describe one release, the job checks the registry first and
    **skips** an already-published version instead of failing on npm's duplicate error, which
    reads like a broken release when it means the opposite.

- **Outward sensing: the agent can now look — under a budget it can see.** Four new
  allowlisted tools (spec: `docs/superpowers/specs/2026-07-26-web-lookup-and-trust-design.md`):
  - **`ost_search_web`** (Brave Search, `BRAVE_SEARCH_API_KEY`) and **`ost_read_web`**
    (one guarded GET, HTML reduced to text, private/internal hosts refused even across
    redirects). Both spend from one shared per-session lookup budget (`web.lookupBudget`,
    default 10); exhaustion answers with an instruction — cite what you read, record open
    questions on the tree — not an error.
  - **`ost_read_repo`** — read-only, path-confined sight of the product's own codebase(s)
    (`product.repos`), secrets redacted, symlink escapes refused. Ideation stops being a
    black box.
  - **`ost_rank_source`** — append-only per-host trust (`.ost-agent/trust/hosts.jsonl`).
    Web claims enter the believability ladder at the `assertion` floor via `WEB:<host>`
    provenance; a publisher can be promoted to `expert` — the ceiling for a byline — only
    with a reason naming the first-party result that corroborated its claim. `observed`/
    `money` stay earnable exclusively by measurement, so the trust loop closes through
    the product's own metrics, exactly where it should.
  - Autonomous passes (P1–P5) stay hermetic: the new tools live on the MCP surface only.

  _Recorded for accuracy: this work merged to `main` before `0.14.0` was published, and that
  publish ran against `main` — so the `0.14.0` tarball already contains it, even though it is
  listed here. The version it was released **as** is 0.14.0; the version it is documented
  under is 0.15.0._

## 0.14.0

- **`ost-agent loop start | step | decide | seal` — deterministic health records for one
  unattended firing.** Tasks 2 and 3 of the self-bootstrapping loop plan the founder
  committed today (`docs/superpowers/plans/2026-07-26-self-bootstrapping-loop.md`), built to
  that plan's exact contract so tasks 4–9 have the interfaces they were written against.
- **The verdict is computed, never supplied.** No command takes a verdict. A firing brackets
  itself and `seal` derives `healthy | unhealthy | no-op | crashed` from what the CLI
  observed. The problem this exists for is that the thing describing an unattended run is
  the same model that performed it, so "the pass went well" is a self-report, and a fleet of
  loops cannot be steered on self-report.
- **`loop step` wraps the command rather than being told about it.** `ost-agent loop step
  --phase build -- pnpm test` spawns the command (`shell: false`), streams its stdio, records
  the exit code it actually observed, and propagates it. There is no `--exit` flag to get
  wrong or to lie with. A command that never ran at all — binary not found, `spawnSync`
  status `null` — records a non-zero exit rather than a 0, so a phase whose command could not
  be found cannot seal healthy.
- **`seal` re-runs the tree invariants itself** and records the result as a `check` step, so a
  firing cannot end healthy over a broken tree however green its phases were. A test proves
  it bites: a dangling link seals the run `unhealthy` with every phase at exit 0.
- **Omission is visible.** A work run must show `sense`, `decide`, `build` and `ost-pass`;
  any missing phase seals `unhealthy`. Not running the health system is itself a health
  signal rather than a gap in the data. A `no-op` directive seals `no-op` without them, and a
  `restore` run needs at least one step — a restore that ran nothing restored nothing.
- **A dead process still leaves a record.** The open-run marker outlives it, and the next
  firing's `start` sweeps it into `runs.jsonl` as `crashed` before opening its own. A marker
  too corrupt to parse still gets a line: invisibility is the failure mode this file exists
  to prevent.
- **Two corrections to the plan, both found by running it**, recorded in the plan document
  next to the tasks they belong to:
  - *`runId` collided.* The specified `${startedAt}-loop` is millisecond-resolved, and a
    sweep plus a start is two small writes — 50 back-to-back `startRun` calls produced **4**
    distinct ids. That made the plan's own crash-sweep test flaky, because a crashed run and
    its successor could share an identity. A per-millisecond counter disambiguates, with a
    test that fails against the original expression.
  - *The plan's first CLI test could never pass.* Its fixture wrote only `ost.config.yaml`,
    giving a tree with no root Outcome — which `seal`'s invariant check correctly refuses.
    The fixture now builds a real vault.
- **Records are append-only JSONL** at `.ost-agent/health/runs.jsonl`, one line per firing,
  stamped with the loop version that produced it — which is what makes "did version N+1 beat
  version N" arithmetic rather than an argument. A corrupt line is skipped, never thrown on.
- **What this release does *not* include**, so the design is not read as delivered: the
  `loop:` config block (task 1), the preflight directive (4), `LOOP_RULESET.md` (5), the
  prompt renderer and bare `ost-agent loop` command (6), fleet aggregation (7), the
  dist-tag canary and promote gate (8), and the full-firing integration test (9). This is the
  spine the other seven hang on.
- 376 tests across 55 files (up from 360 / 53).

**Not yet on npm.** 0.10.0 through this release are cut but unpublished — the environment the
release commits were made in holds no npm credential (`npm whoami` → `ENEEDAUTH`), and
`git push --tags` is refused here with HTTP 403, so `RELEASING.md`'s GitHub-Release path is
unavailable from here regardless of credentials. Until `npm publish` runs, the plugin's
`npx -y ost-agent@latest mcp` still resolves to 0.9.0.

## 0.13.0

- **`check` now fails on a wikilink split across a line break** (rule `wrapped-wikilink`),
  and the hygiene detectors — `ost_next_work` and the `P5_hygiene` pass — report it
  alongside dangling links and orphans. The message carries the *flattened* title, because
  that is what the author meant and what a reader has to go and repair.
- **Why this defect was invisible.** Only a whole line of the form `[[Title]]` becomes an
  edge. A link that a hard-wrapped paragraph broke in two is therefore not a link at all —
  not an edge, and not a *dangling* one either — so the dangling-link rule, the only thing
  that looks at wikilinks, cannot see it. Obsidian renders it as bracketed text, and the
  graph the whole product exists to produce silently lacks the line.
- **The assumption test was run before the rule was written, against its pre-committed
  threshold, and it passed on all three numbers.** The candidate regex was replayed over
  every commit of both live vaults (100 commits, ~275 node files):
  - *Soundness — 0 hits on a link that resolves.* **0.** No false positive, and none inside
    a fenced code block, which was the named hazard given that these vaults contain prose
    about wikilinks.
  - *Utility — at least 3 of the known occurrences caught.* **3** distinct wrapped links
    reached a commit and all 3 were caught. (The remaining occurrences on file never landed:
    they were repaired by hand before committing, so history cannot show them. Read 3 as the
    number that got past the humans and the tools alike, not as the total.)
  - *Utility — at least 1 not already reported by the dangling-link check at that commit.*
    **3 of 3.** Nothing in the product reported any of them. Two of the three had a target
    that resolves once flattened — real edges the author wrote and the graph never got.
- **`wrappedLinkTargets` lives in `src/ost/node.ts`**, next to the grammar it is the inverse
  of, and the three detectors share it rather than growing a fourth copy of the link scan.
  An unclosed `[[` cannot swallow the rest of a body: the character class excludes brackets,
  so a stray open bracket reports nothing instead of one enormous phantom title.
- **A ruleset rule states the writing habit** — keep every wikilink on one line, let the line
  run long rather than wrap inside the brackets — so the agent that causes this defect is
  told not to, and not only caught afterwards. It renders into `SKILL.md`.
- 360 tests across 53 files (up from 351 / 53).

**Not yet on npm.** 0.10.0 through this release are cut but unpublished — the environment
the release commits were made in holds no npm credential (`npm whoami` → `ENEEDAUTH`).
Until `npm publish` runs, the plugin's `npx -y ost-agent@latest mcp` still resolves to
0.9.0, which refuses to start outside a vault — so the front door added in 0.12.0 is still
not reachable by the person it was built for.

## 0.12.0

- **`/ost-setup` — the first run becomes findable, not just reportable.** v0.11.0 made an
  empty directory answer `{ bootstrap: true }` instead of failing to connect, and taught
  the skill a branch for it. Both are only reachable by someone who already asks for
  discovery work, which is the thing a stranger installs this to learn how to do. The
  slash-command menu is where a person who has just run `/plugin install` actually looks,
  so the branch now has a name in it.
- **What the command does.** Calls `ost_next_work`; on `no-vault` it asks the one question
  it is not allowed to answer — *what outcome do you want this tree to serve?* — reads the
  human's sentence back verbatim, and runs `ost-agent init <folder> --outcome "<their
  words>"`. On `no-outcome` it does the same through `set-outcome`. On an existing vault it
  reports the outcome and node counts, points at `/ost-status`, and **stops** — it does not
  re-initialise over a live tree or touch an Outcome someone already chose.
- **Generated from `OST_RULESET.firstRun`, like the skill.** `scripts/gen-skill.ts` now
  writes both `SKILL.md` and `.claude/commands/ost-setup.md`, and `test/skill/drift.test.ts`
  fails on either being stale. Two hand-maintained copies of the one branch that must never
  invent the outcome would drift, and the drift would be silent.
- **Its shell allowance is four named commands, not a shell.** `allowed-tools` grants
  `Bash(ost-agent init:*)`, `Bash(ost-agent set-outcome:*)` and their `npx` forms, and a
  test asserts the shape of every grant — a bare `Bash` would hand a shell to the one
  product whose promise is that no tool it holds can take a destructive action.
- **Both bootstrap messages now name the front door**, so a human who hits the state
  through the tool layer and one who hits it through the menu are sent to the same place.
- **A ruleset rule says it out loud**: *reporting first run is not the same as being
  findable* — if a human seems to be starting from nothing, say `/ost-setup` rather than
  waiting to be asked. It renders into the skill, so both brains learned it.
- 351 tests across 53 files (up from 340 / 52).

**Not yet on npm.** 0.10.0, 0.11.0 and this release are cut but unpublished — the
environment the release commits were made in holds no npm credential. Until
`npm publish` runs, the plugin's `npx -y ost-agent@latest mcp` still resolves to 0.9.0,
which refuses to start outside a vault — so the front door added here is not reachable by
the person it was built for.

## 0.11.0

- **The first run stops being a wall.** The founder's launch bar for handing this to
  another PM is one sentence — *"Just install ost-agent, setup runs itself."* A fresh-user
  simulation on 2026-07-25 walked the cold path from an empty directory and found the
  one-liner true everywhere except two places, both of which failed in the same way:
  technically correct, operationally useless. This release is those two places.
- **`ost-agent mcp` now starts in a directory that is not a vault.** It used to refuse,
  which meant the plugin — whose server runs against `${CLAUDE_PROJECT_DIR}` — showed a
  first-time operator an MCP server that failed to connect. That is the least actionable
  signal available: it names no cause and no fix. The server now comes up, serves the
  identical tool surface, and answers with the command that creates the vault.
- **`ost_next_work` reports first run as state, not as an error.** It returns
  `{ bootstrap: true, done: false, reason, vault, message, nextStep }`. `reason` is
  `no-vault` (nothing here) or `no-outcome` (a repo whose root Outcome is missing) —
  different reasons because they need different commands. Every other tool refuses with
  the same message and `isError: true`; `ost_read_tree` refuses rather than returning an
  empty tree, because an empty tree is a lie about a missing vault.
- **The skill learned the matching branch**, generated from `OST_RULESET.firstRun` like
  every other rule, so the standalone agent and the Claude-Code-driven one cannot drift.
  It says to ask the human for the outcome, in their words, and it says three times over
  not to invent one. **Setup needs no model — but it does need the one human input the
  agent may never supply**, and an agent that scaffolds a vault around a placeholder to
  keep making progress has quietly chosen the mandate the whole tree hangs from.
- **The credential wall is now an instruction.** `ost-agent run P2_map` without a key
  died with the SDK's own words — *"Could not resolve authentication method. Expected
  either apiKey or authToken to be set."* Accurate, and it conceals the thing that matters
  most: **a credential is not the only way in.** The MCP server holds no model and needs
  no key. The message now names the variable to set *and* the two-line plugin install
  that needs none, and lists the commands that already work without one.
- **Only the model-driven processes are gated, and that is derived rather than declared.**
  `drivesModel(process)` is `allowedTools.length > 0` — a process delegates to the driver
  exactly when it has tools to hand it. `test/processes/model-free.test.ts` runs every
  model-free process against a driver that throws if anyone calls it, so the derivation is
  proved against the implementations instead of trusted. `P1_ingest` and `P5_hygiene`
  keep working with no credential, as they always did.
- The pre-flight fails **before** the pass, so an unrunnable run leaves no journal entry
  and no commit to explain later, and it still prints `<id> FAILED:` — the token cron and
  `status` already key off.
- New: `src/mcp/bootstrap.ts` (`vaultReadiness`, `bootstrapNextWork`),
  `src/runner/credentials.ts` (`anthropicCredentialsPresent`, `credentialGuidance`,
  `assertAnthropicCredentials`), `drivesModel` in `src/processes/types.ts`, and
  `loadConfig(dir, { missing: "defaults" })` / `buildPassContext(dir, { allowMissingConfig })`
  for the one caller that must survive a directory that is not a vault. An *invalid*
  config still throws either way.
- **What this does not fix.** Nothing yet runs `init` on the operator's behalf, and
  deliberately so: the one input it needs is the outcome, which is the human's to give.
  The gap between "the tools tell you the command" and "the wizard walks you through it"
  is the next seam, and it is a smaller one than it was this morning.
- 340 tests across 52 files (up from 315 / 47).

## 0.10.0

- **A threshold that is still an instruction to choose one is now named.** v0.9.0's
  side-by-side was run over both live vaults before it shipped and found that in one of
  them the pre-commitment mostly is not a commitment: paragraph after paragraph opening
  *Fix the minimum before starting*, *Decide the acceptable rate*, *Choose a bar*. An
  instruction to pre-commit, standing exactly where the pre-commitment should be. **A test
  whose threshold was never fixed cannot come out a failure** — whatever the run produces
  reads as clearing a bar nobody set, and the reader will clear it, because by then they
  want to build the thing. `ost-agent debt` now classifies every assumption test's
  pre-commitment and names the ones with no bar in them; `ost-agent status` says how many
  in one line.
- **It reaches the backlog, which the side-by-side cannot.** v0.9.0 only reads tests that
  have already recorded a result. This reads every assumption test in the tree — which is
  where a threshold is still cheap to fix, because nobody has run anything against it yet.
- **Four kinds, and they sum.** `bound` (a number, or a comparison in words), `instruction`
  (opens on a deferring verb with no bar in it), `prose` (neither — often a perfectly good
  falsifiable bar written in words, and deliberately not flagged), `absent` (no
  pre-commitment paragraph at all). The counts add up to the number of tests, so a reader
  can see what the classifier did with everything rather than only what it complained about.
- **Report only, and that is the point.** Nothing is blocked, refused, or rewritten. The
  distinction between a threshold and an instruction to set one is fuzzy, and this rule will
  be wrong at the edges; a report that is wrong is a nuisance, while a refusal that is wrong
  is a wall. The two stronger siblings — refusing a result against an unfixed threshold, and
  moving the threshold out of prose into a required field — stay unbuilt on purpose.
- **A bar wins over an imperative opening**, deliberately: "Decide the bar; last time 5 of
  20 booked" reads as `bound`, because something *was* fixed. The false positive that costs
  most is nagging about a well-written threshold — that is how the report gets turned off,
  and the genuinely empty ones come back with it. What it still cannot see is documented in
  the module: "Two numbers, both fixed in advance: …" names two numbers and states neither.
- **A second failure mode, found by running it:** `ost-agent-meta` has **12** assumption
  tests with no pre-commitment paragraph at all (0 instructions), against `tetrix-ost`'s
  **18** instructions and 0 absent. The same agent wrote both trees. One defers the bar;
  the other never opens the question.
- New: `thresholdKindOf`, `computeUnfixedThresholds`, `ThresholdKind` in `src/eval/coverage.ts`.
- 315 tests across 47 files (up from 299 / 46).

## 0.9.0

- **The uncovered statement now has somewhere to be *checked*, not just written.** v0.8.0
  made every result carry a statement of what it left untested, and then never read it —
  `debt` counted the pair and stopped. A count proves a sentence exists; it cannot show the
  sentence bounds anything. `ost-agent debt` now prints every **bounded** test side by side:
  the threshold the node pre-committed to before the run, above the limit the run stated
  afterwards. Two pieces of text the tool already held, printed together.
- **It never compares them.** No parsing of the result, no scoring, no model. Whether the run
  answered the threshold printed next to it is the human call the whole coverage feature was
  built around, and the output says so in place of the old caveat.
- **A bounded test with no written threshold is called out, not skipped.** A limit stated
  against no stated question has nothing to be read against — and that is exactly the case
  the pair count reports as healthy. `debt` names those tests and totals them.
- **The pre-commitment marker is matched on the phrase, not one spelling.** Between them the
  two live vaults write "Pre-committed threshold", "Pre-committed success threshold",
  "Pre-commit before looking", "Pre-commit the threshold before starting" and more; neither
  was written against this feature. Insisting on one spelling would have reported a tree full
  of thresholds as having none.
- New: `askedOf`, `uncoveredStatementsOf`, `computeCoveragePairs` in `src/eval/coverage.ts`.
- 299 tests across 46 files (up from 285 / 45).

## 0.8.0

- **A result must now say what it does *not* cover.** `ost-agent result` gains a required
  `--uncovered`, alongside `--by`. The reasoning is the same in both cases: a result with no
  name on it cannot be told apart from a fabricated one, and a result with no stated limit
  gets read as answering the whole threshold the test was written against. Two runs in a row
  on a sibling product ended with a node being split, because the artefact covered less than
  the question asked — and both times that depended on somebody happening to notice. This is
  the mechanical half of noticing.
- **One statement per result, not one per test.** Each recording appends a line to `## Results`
  and a line to `## Uncovered`, in the same order, so a second run cannot ride on the first
  run's limits. `ost-agent debt` and `ost-agent status` count the pair and name any test whose
  results outrun its statements as **unbounded**.
- **Older vaults stay readable.** A result recorded before the field existed — or a node a
  human hand-flipped to `validated` with nothing written down — reads as one unbounded claim
  rather than as an error. The debt is surfaced, not enforced retroactively.
- **The check is deliberately shallow, and says so.** It never reads the uncovered statement
  or asks whether it is true; it only checks that a person was made to write one. Whether the
  limit is honest is a human judgement, and `debt` prints that caveat next to the number.
- **Fixed: `appendUnderSection` filed under the wrong heading.** It appended to the end of the
  *body* rather than the end of the named *section*, which was invisible while nodes had one
  growing section and wrong as soon as they had two — a second result would land under
  `## Uncovered`, and a status change after a result would land under `## Results`. It now
  inserts at the end of the section it names, still strictly additive: no existing line is
  moved or rewritten.
- 285 tests across 45 files (up from 265 / 44).

## 0.7.0

- **The agent can now put a test out of its own reach — and that is the only lane call it
  can make.** v0.6.0 shipped lanes with no agent tool at all, because the permissive call
  (`compute-only`) is what decides that an unattended pass may go run something on its own
  authority. The consequence was a backlog that stayed entirely unclassified, which by the
  fail-closed rule means *nothing* is runnable: correct, and useless. `ost_flag_humans_required`
  resolves it in the safe direction only. It takes `test` and `why` and **no lane argument**,
  so "which lane" is not a decision the tool is able to express — `suggestCaution`'s advice,
  promoted to a capability. The permissive call stays on the human's CLI.
- **The absence of the argument is the safety argument.** Not a rule the agent is trusted to
  follow, but a capability that can only point one way — the same move as the tool allowlist
  itself. A test asserts the schema has exactly two properties and `additionalProperties: false`,
  another that a `why` demanding `compute-only` still writes `humans-required`, and another that
  flagging can only ever *shrink* what an unattended pass may run.
- **`ost-agent lanes --flag-cautious <who>` does the backlog in bulk**, in the one direction
  where bulk is safe. It applies `humans-required` to every *unclassified* test whose own text
  names an outside person, quoting the phrase for each, and skips anything already carrying a
  lane — a human's `compute-only` call is never quietly reversed. It then reports how many
  remain unclassified, so a bulk pass can't be misread as "triage done".
- **Attribution comes from the surface, not the model.** The tool does not ask the agent to
  name itself; the filing is recorded as `agent:<surface>`. A self-reported `by` is worth
  little in exactly the audit this field exists for.
- 265 tests across 44 files (up from 243 / 42).

## 0.6.0

- **Assumption tests now declare what they cost a person — and a pass can run the lane
  that costs nobody anything.** A backlog of tests is not one queue: replays and audits
  over artifacts already on disk sit in the same list as interviews, so everything waits
  on the operator and the free tests never get run. Every `AssumptionTest` may now carry
  a `lane` in frontmatter — `compute-only`, `one-command`, `pending-permission`, or
  `humans-required` — with `ost-agent lanes` to see the tree grouped by cost and
  `ost-agent lane "<test>" --set <lane> --by <who> --why <text>` to classify one.
  Classification is attributed and recorded in the node's History, so any lane can be
  traced back to who made the call.
- **The lane vocabulary fails closed, and that is the whole safety argument.** Exactly
  one lane (`compute-only`) is runnable by an unattended pass; an unclassified test, or a
  lane string a future version invents, is *not* runnable — the same floor rule the
  believability ladder uses. Unclassified never means "safe to automate". A test
  mislabelled `compute-only` and then run by an agent would write fabricated evidence
  into the tree, which is the one failure this product cannot survive.
- **The triage aid can only ever raise a hand.** `suggestCaution` scans a test for
  phrases naming people outside the building and quotes the one that matched
  (`names an outside person: "interview"`); it never returns a lane compute is allowed to
  run, and its silence means "no marker found", never "safe". The permissive call stays a
  human's by construction, enforced by test.
- **`pending-permission` is deliberately distinct from `one-command`.** Folded in from an
  observed stall in the unattended loop: `npm publish` is not a yes/no with evidence
  behind it, so filing it as a decision makes a decision docket feel like chores. What
  blocks it is a credential, not a judgement, and the two want different treatment.

## 0.5.0

- **A failed pass is now visible to a machine.** `ost-agent run` exits **1** and prints
  `<process> FAILED: <error>` to stderr when a pass errors — previously a pass that died
  on a driver error (observed 2026-07-25: an SDK auth failure in `P2_map`) still exited 0,
  committed, and printed a tidy summary, so a cron schedule would no-op forever while
  looking healthy. A partial pass — work committed, then an error — also exits 1: one
  code meaning "do not trust this run" is the contract cron, launchd, and CI already
  speak, and whatever landed before the error is still in the commit and the journal.
  `ost-agent schedule` logs the same `FAILED` line to stderr and stays up.
- **`ost-agent status` leads with the last failed run** — process, timestamp, the error
  verbatim, and the journal path — above the node counts, and labels each process's last
  run `ok`/`FAILED`. New `src/runner/journal.ts` reads the run journals that already
  existed and were already honest; the failure rule (a non-empty `error` field means the
  run failed) is the crudest one that survived a replay of all 14 existing journals —
  1/1 known failures caught, 0/13 healthy runs misclassified. A corrupt journal is
  skipped, never thrown on: one bad file must not hide a failure elsewhere.
- **Slack config accepts `#channel-name`s, not just IDs.** `HttpSlackClient` resolves
  names to ids via `conversations.list` (cached, GET-only) before reading history, and
  evidence keys on the stable channel id. Ids still pass straight through.

> Versions 0.2.0–0.4.0 were cut from a parallel feature line and left no changelog
> entries; their contents are in the git history between `f085862` and `3475ded`.

## 0.1.3

- **Fix:** a newly-created vault gets a repo-local git identity when none is
  configured globally, so `ost-agent init` (and every commit) works on a bare
  machine or a fresh CI runner instead of failing with "Please tell me who you are."
  Never overrides an existing identity. Regression test in `test/git/safe-git.test.ts`.
  (This was caught when the 0.1.2 publish workflow failed its own test gate in CI.)
- **Slack adapter (read-only):** channel history → evidence, via a least-privilege
  bot token (`channels:history`, `channels:read`); GET-only Web API. The last
  pending source is now built.
- **`/ost-review` command:** human triage of the `unvalidated` nodes the autonomous
  pass produces (promote with evidence, defer, mark in-discovery, or annotate).
- **Richer hygiene:** `ost_next_work` and `P5_hygiene` now flag same-layer
  near-duplicate titles (`findNearDuplicateIssues`, reusing the token-Jaccard
  `similarity`) — annotated for a human, never merged automatically.

## 0.1.1

- **Fix:** `ost_next_work` now treats evidence as mapped when any node cites it as
  its `source`, not only when the batch `P2_map` runner recorded it in
  `mapped.json`. The MCP-driven path (a Claude Code session running `/ost-pass`)
  attaches the evidence id via `ost_create_node` but never writes `mapped.json`, so
  previously a session-driven pass could map all evidence yet never see
  `ost_next_work` report `done: true`. Found by dogfooding the autonomous pass on the
  project's own eval corpus. Regression test: `test/mcp/next-work.test.ts`.

## 0.1.0

- Initial release: `ost-agent` CLI + append-only MCP server that maintains a Teresa
  Torres Opportunity Solution Tree as Obsidian-graph Markdown.
- Consumable from Claude Code as a skill + `/ost-*` slash commands + plugin (with a
  self-marketplace); `ost_next_work` orchestration tool; participant and autonomous
  (headless / scheduled) usage.
