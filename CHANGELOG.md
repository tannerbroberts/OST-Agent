# Changelog

## Unreleased

- **Setup can now look at the workspace it finds instead of asserting there isn't one — and
  the useful half of that turned out to be the refusals.** `ost-agent reconcile-workspace`
  classifies whatever is at a fixed workspace path into one of twelve states and returns a
  verdict for each: reuse a clean worktree already on the wanted branch, move a clean one
  that is on another branch, create an absent one, prune a registration whose directory is
  gone, clear an empty directory — and refuse everything else, by name, touching nothing.
  The partition is fixed in `RECONCILE_RULE` and the invariant is computed rather than
  claimed: no state holding uncommitted or in-progress work is replaceable. Two findings
  came out of building it. **The state that broke the observed run is not one of the eight
  the node enumerated**: `/tmp/ost-main` was the carcass of a pruned worktree — checkout on
  disk, `.git/worktrees/` entry gone — which is the mirror of the "stale registration" the
  list does name, and it is refused rather than repaired, because `git status` cannot run
  there and `git worktree repair` will not resurrect it. **The `ln: node_modules: File
  exists` half of that same failure was still live**: `prepareWorkspace` tested its link
  with `fs.existsSync`, which follows symlinks, so a link left dangling by a shared tree
  that moved read as absent and the `symlinkSync` after it threw `EEXIST`. It now compares
  the link itself and repoints it, and never touches a real installed `node_modules`.
  `test/runner/workspace-reconcile-states.test.ts` builds every state against a real
  repository. What none of it settles, said out loud: a live run mid-build and a dead run's
  leftovers are byte-identical to inspection, so every *reuse* verdict is safe only while no
  second run is live.

- **Restoring a displaced instrument no longer hands back a permit earned against a spec
  file that has since changed.** The finding came before the fix and inverts what the work
  was: re-arming was *already* the behaviour. An observation is recognised by the command
  it names, `currentObservations` keeps the log lines matching the command the node declares
  today, and that filter is symmetric — so putting a command back byte-for-byte revived its
  old reds silently, unconditionally, and with nothing written down to say it had happened.
  Measured against this repository, not assumed: swap a command away and back and the permit
  clears, is withdrawn, and clears again with no other change. That is the un-clearing rule
  defeated by a string comparison, because the command names a *path* and says nothing about
  the file's contents. So each recorded observation now carries a digest of the spec file it
  measured, a restore records the digest of that file as it stands at that moment, and the
  permit re-arms only when the two agree. A mismatch — or an unreadable file, or an
  observation recorded before digests existed — **withholds** it, and the restore says so in
  its response and writes the count into the node's `## History` rather than doing it
  quietly. The withheld lines stay in the log, because a run that happened, happened; the
  way back is `ost-agent verify`, whose fresh observation sits past the withholding.
  `test/instruments/permit-rearm.test.ts` pins both directions with the same call against
  two repositories differing in one file's contents. **What this costs, said out loud:**
  every red in an existing vault predates the digest, so the first restore of any of them is
  refused and has to be re-measured. That is the fail-closed direction on purpose — "cannot
  show what it measured" and "measured something else" license the same amount of building,
  which is none.

- **A rewrite that would drop a section you never accounted for is now refused, by name.**
  `ost_edit_node` replaces a node's prose wholesale, so any `## Section` the caller did not
  reproduce was deleted — with no error, no warning, and the same success string a lossless
  edit returns. That is how four `## History` entries died on 2026-08-05, recovered only
  because the pass happened to have read the file minutes earlier for something else.
  `## History` itself is closed (it joined the reserved set, which is what that observation
  bought first), but the *shape* was not: `## Provenance`, `## Definition of done` and the
  `## Issues` section `ost_annotate` writes into are all ordinary prose, and all were
  droppable by a caller who simply did not know they were there. A rewrite must now
  **account for every stored section** — include its heading in `prose` to keep it, or name
  it in the new **`dropping`** argument to remove it on purpose, which is recorded in the
  node's History as a named removal. A section in neither is refused, the refusal names
  every one of them at once and in full so the name can be pasted straight back, and
  nothing is written. Reserved sections are exempt because no tool can drop one: they are
  reattached verbatim, and naming one in `dropping` is refused rather than silently
  ignored. Published on `ost-agent preconditions` as `sections-accounted-for`.
  **What this costs, said out loud:** consolidating two sections, retitling one, or folding
  one into running prose are all legitimate rewrites, and all three now pay a refusal and a
  retry. `test/mcp/edit-node-unacknowledged-section-guard.test.ts` asserts that cost exists
  rather than pretending it away — how often it is actually paid is a replay of recorded
  edits with someone judging which were legitimate, and that measurement has not been made.

- **A merge now requires that you have seen the node you are merging into.**
  `ost_merge_nodes` stopped taking the survivor's body a release ago, so prose you never
  read can no longer be *lost* there — but `contribution` is still prose you compose, and
  its contract is "only what the loser says that the survivor does not". A caller who has
  not read the survivor cannot evaluate that clause at all: it appends whatever the loser
  said, and the survivor ends up saying the same thing twice under a dated heading. The
  merge is now **refused unless this session has been served the survivor's body** by
  `ost_read_tree({ node })` — the shape the file tools already use, and the reason
  `File has not been read yet` appears throughout this project's own friction records.
  What the guard proves is stated as the limit it is, in the refusal text and in the
  instrument: it checks that the body was **served**, not that it was read, and a fetch
  whose result is discarded satisfies it. `test/tools/merge-read-guard-bypass.test.ts`
  asserts that the bypass is **open**, because the assumption the tree cleared this
  against is that the bypass exists — a guard that silently closed it would be a
  different claim than the one that was argued. The refusal names the call that clears
  it, sits **behind** every structural refusal (a merge that can never be allowed is not
  answered with "go read the survivor"), and is published on `ost-agent preconditions`
  as `survivor-body-read` so a caller can screen for it before spending the call.

- **A solution now says what would kill it before it is allowed to exist.** Nothing in this
  product removed anything: candidates entered `unvalidated` and stayed there, so the meta
  vault reached 435 solutions of which exactly **one** has ever been retired, and the tree
  it was built to sharpen got harder to read with every pass. The reason was never that
  nobody would kill one — it is that killing one was always an argument, had *after* effort
  had accrued, against someone by then attached to it. **`ost_create_node` now requires `killIf` and
  `killBy` on every Solution**: the observation that would end the candidate, and the date
  that observation gets checked. Both are frontmatter fields rather than a sentence in the
  prose, so something other than a reader can find them, and both are refused in the forms
  that fill a slot without committing to anything — an empty or placeholder condition, one
  word, a pasted paragraph, a sentence that opens by scheduling the decision ("decide
  whether it is working"), a date already gone, a date past a 365-day horizon.
  **`ost-agent kill-list`** is the sweep: every live solution whose date has passed, most
  overdue first, with its condition beside it, and the solutions carrying no criteria at
  all named rather than counted as compliant.
  What this does **not** do is kill anything. The machine checks the date; a person reads
  the condition and retires the candidate. Whether a written criterion is actually honoured
  needs two weeks of calendar and someone willing to act on the list — this is the
  precondition for measuring that, not the measurement.
  It also does nothing for the **434 solutions already on disk**: this is a birth condition,
  and no allowlisted tool can add the pair to an existing node (`ost_edit_node` does not
  touch frontmatter, and there is no `ost_set_kill_criteria` — the same shape as the
  unsettable `source` field that `src/ost/stranded.ts` describes). Those candidates are
  reported by the sweep as carrying no criteria rather than as compliant, and back-filling
  them needs a write path that does not exist yet.
  Pinned by `test/ost/kill-criteria-required.test.ts`.

- **Bring-your-own-key search is off until you say so, instead of switching itself on when
  it finds a key.** Provider resolution keyed on `holds(CREDENTIAL_SEARCH)` alone, which
  made the presence of an environment variable the entire opt-in: an operator carrying
  `BRAVE_SEARCH_API_KEY` for some unrelated tool got a vault that called out to
  api.search.brave.com on the first `ost_search_web`, with nothing in `ost.config.yaml`
  asking for it. Observed rather than argued — a keyless first run with a stray key in the
  environment came back with a live HTTP 422 from Brave's own server. Every other
  credentialed channel here (slack, atlassian, actions, transcript) is gated by an
  `enabled` a person wrote, and even the *keyless* federated fallback is opt-in; paid
  search was the one exception, and the ordering was backwards. **`web.search.brave.enabled`
  (default `false`) is now that gate**, and it gates the handle on `ctx.web.searchApiKey`
  too — `ost_search_web` falls back to building a Brave provider straight off that field,
  so leaving it populated would have routed around the flag. A key that is held but
  switched off is *narrated* rather than hidden: `ost_search_web`'s delegation message
  names the flag that would spend it, and the sense census reports `credential-off` rather
  than rounding it to "no credential" — being asked for a credential you are already
  holding, with no account of why yours will not do, is the friction
  `src/security/auth-detection-report.ts` exists to end.
  Pinned by `test/cli/first-run-without-key.test.ts`, which also drives a whole first run
  — init, set-outcome, ingest, and the maintenance passes — in an allowlisted environment
  holding no credential at all, and asserts no model SDK is a dependency, the assertion
  that actually catches a future change putting a key back on the first-run path.

- **A stale firing lock now recovers in minutes, and a live one survives a laptop lid.**
  The overlap lock had exactly one recovery rule that worked without a named holder pid:
  a sixty-minute TTL. That is four times the fifteen-minute bar the node fixed for how
  long a vault may sit unusable after a crash — and, less obviously, it was *too eager*
  in the other direction at the same time. Wall-clock age is a proxy for "nobody is
  home"; a machine that sleeps through the TTL wakes with a perfectly healthy firing's
  lock breakable by the next arrival, which is the recovery policy manufacturing the
  concurrent write the lock exists to prevent. Both directions are closed by splitting
  the evidence into what a single reading can settle and what it cannot. A named holder
  pid that is **gone** on this host is conclusive and breaks the lock on the spot; a live
  one **suppresses** the TTL, because a pid answering `kill -0` is the thing the TTL was
  only guessing at. What catches a hang instead is a heartbeat the holder promises
  (`loop.lockHeartbeatMinutes`, default 4) and every commit stamps (`src/mcp/commit.ts`)
  — a hung process and a working one are the same live pid, but they are not the same
  commit stream.
  **The second agent waits now** (`loop.lockWaitMinutes`, default 15) instead of exiting
  15 on sight, and that is the load-bearing half rather than a courtesy. A heartbeat that
  has fallen behind is produced identically by a hung holder and by a suspended machine,
  and nothing that takes one reading can tell them apart: only an observer watching over
  time can, and it must discard its whole observation window whenever **its own** clock
  jumps, because a jump means it was not running either and everything it "saw" describes
  a world on pause. So a single-shot `acquireFiringLock` never acts on a late heartbeat —
  only `waitForFiringLock` does, and only after the heartbeat fails to advance across an
  unbroken window, and only if the record is still byte-for-byte the one it judged.
  Measured rather than argued: `test/git/stale-lock-recovery.test.ts` drives a real
  holder process through four kill shapes — clean exit, SIGKILL, SIGSTOP-while-holding,
  and a modelled machine sleep — and asserts the node's own two bars, that the vault is
  usable again inside fifteen minutes in every shape and that recovery never once
  releases a lock still genuinely held. Only elapsed wall time is simulated; the
  processes, the signals, the `kill -0` and the break are real.
  **What this does not settle, stated because no implementation can:** a hung holder and
  a crashed one are the same process from outside. The cadence only decides which way
  that ambiguity resolves and what it costs, and picking it is the operator's call.
  `lockWaitMinutes: 0` restores the previous refuse-on-sight behaviour exactly, for a
  cron whose interval is shorter than the wait.

- **The `threshold` field has to be a bar now, or it is not written.** The field shipped on
  2026-08-01 as the readable half of "the threshold is a field, not a sentence buried in
  prose", and it shipped accepting any string. The assumption recorded against it named the
  cost in advance: the field fills with the same unbounded sentence, "at which point the
  structure improved and the commitment did not" — and a test whose bar is a sentence
  cannot come out a failure, because whoever wants to build the thing can read whatever
  came back as a pass. It is load-bearing beyond rigour, too: `confirmPermit` keeps a
  `no-spec` instrument's build permit **if and only if** the test carries a bound
  threshold, so an unbounded one is the difference between handing a builder a definition
  of done and handing them nothing. `parseThresholdField` (`src/eval/coverage.ts`) reads
  the field strictly and `ost_create_node` refuses what is not a bar — refused before
  anything reaches disk, like every other create-node guard, and at the only door there
  is (`ost_edit_node` does not touch frontmatter and no `ost_set_threshold` exists).
  Strict is three requirements, each closing a different way of failing: **one line**,
  because a hard-wrapped paragraph in the field IS the relocation the field was meant to
  prevent and is the one form the field can rule out that the prose scan — which reads
  across line breaks on purpose — never could; **a comparator adjacent to its number**, so
  "Over the next 15 nodes, classify each threshold" is refused and "over 15" is not, which
  a co-presence check ("some comparator word, some digit") gets exactly backwards; and
  **`A_BOUND` on top**, which makes the strict field reading a *subset* of the census
  classifier by construction — nothing the field accepts can be something `ost-agent debt`
  would then call unfixed. Word-numbers count beside digits, because this repository had
  already refused a threshold for spelling its numbers out and accepted the identical bar
  in digits, and a rule that turns on typography is not reading the commitment.
  **What is deliberately unchanged:** the field is still optional and the prose fallback is
  untouched, and that is what makes a strict rule safe here rather than the nag the parent
  opportunity warned would get switched off. A bar whose reasoning must travel with it —
  *">= 2 incidents beyond the known one, else defer (…)"* — belongs in the body under a
  `**Pre-committed threshold:**` lead-in, and the refusal message says so, so no author is
  left with nowhere to put it.
  **What green does NOT settle,** and it is the question the assumption test actually
  asked: whether *authors* write bounds. This closes the door rather than measuring who
  walks through it. The pre-committed observation — 10 of the next 15 field values classify
  as `bound` — can no longer be run as written, because the population it would sample is
  now empty by construction. The behavioural question that survives is where authors go
  instead, into a real bar or into the fallback, and only the next 15 tests show that.

- **The mirror says how old it is.** `.ost-agent/evidence/` has always BEEN a local
  read-only replica of the systems the adapters fetch from — every adapter is GET-only and
  everything downstream reads their output off disk, so nothing in a maintenance pass ever
  touches a live system. What was missing was the price of that arrangement: a replica is
  correct in proportion to how recently it was filled, and nothing on a record said when
  that was. `writeEvidence` now stamps `fetchedAt` from the ingesting surface's clock,
  beside `actor` and omitted from `UnstampedEvidence` for the same reason — a producer that
  can date its own capture can make a stale record look current. `src/adapters/mirror.ts`
  turns that stamp into four verdicts and refuses to collapse any two of them: `fresh`,
  `stale`, `undated` (no stamp — age unknown, which is neither), and `unbounded` (no
  `evidence.staleAfterDays` set, so nothing here calls the age too old). Only `fresh`
  licenses treating a mirrored read like a live one, and `isCertifiedFresh` is where that
  is written once, so no call site gets to decide `undated` is probably fine.
  `ost_next_work` carries the verdict on every unmapped row and on the full-record read,
  and says so in its summary.
  **What the build turned up, and the node did not say.** `timestamp` — the field ageing
  already ran on — is the *item's* time, not ours: an inbox file's mtime answers to
  `touch`, a Jira `updated` to whoever edited the issue. So `evidence.ageOutDays` was
  reading a producer-controlled clock, which meant a record could arrive already buried
  (the actions adapter's own 14-day cold-start lookback mints records at exactly a 14-day
  limit) and the untrusted drop folder could bury its own report by dating it 2019. Age-out
  now reads `fetchedAt`, falling back to `timestamp` only on records written before the
  stamp existed.
  **What green does NOT settle:** whether the staleness is *acceptable*. That is the
  assumption test's actual question, it depends on what a team is deciding with the data,
  and it stays a person's call — this only makes the number exist and travel with the read.

- **The one compatibility read this product performs now has an end date, and says what it
  is holding up.** `testsUnderSolution` has resolved a pre-Assumption direct
  Solution→AssumptionTest edge since the layer landed on 2026-08-05, so a schema addition
  would not reopen every un-migrated vault's finished work. That was right, and it was
  unbounded: it applied to any direct edge at any age, it had no expiry, and a solution
  counted tested through it was byte-identical to one counted through an Assumption — the
  exact shape a compatibility layer has just before it becomes the thing nobody can remove.
  `src/ost/legacy-fallback.ts` bounds it three ways. The edge is honoured only for tests
  created before the boundary; the fallback goes inert at **0.26.0**, a release
  `legacyTestEdgeStatus` reads off `VERSION` rather than one written in a comment; and
  `ost-agent legacy-fallback` prints what it is carrying, separating the solutions it is
  holding up *alone* — the population that reopens the day it expires — from the ones that
  also have a current route. `buildPermit` now carries `viaLegacyEdge`, so a builder can
  tell a permit that stops clearing at 0.26.0 from one that does not.
  **What measuring it turned up, and it is the thing the node did not say.** Against this
  repository's own 1,445-node vault the fallback is carrying **zero** edges: the 2026-08-05
  restructure migrated every one of them, so a layer that has been running for seventeen
  days is holding up nothing and is droppable today — which no surface could have said
  before, and which is precisely why "report what the legacy signal alone is holding up"
  had to be a clause rather than a nicety. The bound is also weaker than it reads in one
  named place: 297 of those 1,445 files carry no `created` line at all (the field is
  stamped by `ost_create_node`, not by hand), and an undated node is honoured as
  pre-boundary — reading it the other way would reopen the work the fallback exists to keep
  counted. Those edges are counted separately, because they are exactly the population the
  boundary cannot bound and the release date is the only thing that ever ends them.
  **What green does NOT settle:** whether the union is *correct* — whether work a legacy
  edge keeps counted was genuinely finished by the newer standard. A perfectly bounded
  fallback around a wrong rule is a wrong rule with a deadline, and that is a person's
  judgement, not an exit code's.

- **Two operators can now exchange vaults directly, and find out first what it will cost
  them.** `ost-agent peer-census --peer <dir>` runs the exchange as a real `git merge`
  into a scratch repository neither vault can see — `--allow-unrelated-histories`, because
  two peers who each ran `ost-agent init` share no ancestor — and partitions every conflict
  git stops on into the ones a stated rule settles and the ones a person has to rule on.
  Nothing is committed and neither vault is touched. A rule counts only when it is
  deterministic, symmetric, and lossless: every value it does not adopt is written into the
  node's `## History`, so a reviewer can see each choice and what it cost. Ledgers, tags and
  child edges union; the weaker evidence rung and the weaker provenance win; a verdict, a
  pre-committed bar, an instrument, a lane, a rewritten body and a one-sided retraction are
  never settled by machine. A settlement is an `OstNode`, never bytes — `Vault` remains the
  only thing that renders a node file.
  **What measuring it turned up.** Against this repository's own vault at `HEAD` versus its
  own past, re-rooted as independent repositories, the judgement count scales with how long
  the peers have been apart: 1 at 25 commits, 3 at 100, 10 at 300, 10 against a three-week
  branch tip. So peer exchange is cheap if you do it often and stops being cheap at roughly
  two days of divergence — a qualification the assumption test's flat "at most 5" did not
  carry. And the single largest cost was not disagreement at all: 39 of the 52 collisions
  no other rule could settle differed only in whether a cited title was written `[[Title]]`
  or `"Title"`, a dialect this tree changed mid-life, which is why `citation-style-normalised`
  exists and why it compares sigils and nothing else.

- **Installing a helper now runs the helper's own preflight and refuses what cannot run
  here.** A helper declares what it needs — `# ost-requires: command git — reads the staged
  index` — in its own header, so the declaration travels in the one file that gets copied.
  `ensurePreCommitHook` checks the generated hook's manifest against the machine *before*
  writing it and returns a refusal naming what is missing and what was found instead;
  `ost-agent helper-preflight` does the same for the helpers an operator installs by hand.
  A builtin's release comes from the compat lint's own version table, so an author declares
  `mapfile` rather than having to know it is bash 4.0 — which is how the recorded failure
  (`ost-reports: line 21: mapfile: command not found`, macOS bash 3.2) is caught at install
  time instead of at line 21. `test/runner/helper-manifest-coverage.test.ts` holds the bar
  the assumption test fixed: the manifests catch that failure, and each omits at most one
  command its script genuinely invokes (measured: 0 of 5 omit anything).
  **Three things the design turned up.** A manifest cannot always live inside the helper —
  two of the five here are verbatim copies whose line numbers another spec pins, which is
  the general case of any helper you did not author, so they carry sidecars. A real
  dependency can be invisible to any command-position analysis: `autonomous-pass.sh` needs
  `claude` (an *argument* to `ost-agent loop step`) and `rm` (inside a single-quoted `trap`
  body), so the omission count is a floor rather than a ceiling. And the compat lint's
  scanner is not reusable for this — it keeps double-quoted spans on purpose, which over
  these mostly-English helpers reads "ran 3 instrument(s)" as commands named `instrument`
  and `s`; the first honest run scored 48 omissions against `build-pass.sh`, none of them a
  command. Every one of those failure modes is now asserted, because a scanner that has
  quietly gone silent produces a *perfect* omission score.

- **A tenth of the tree, drawn so a person can actually review it — the draw only, never a
  score.** `docs/reference/evaluating-ost-agent.md` has said since the faithfulness judge
  was deleted that layers 2 and 3 are read by a human "one node at a time", which on a
  1,400-node tree is a method nobody runs, so the reading was not being done at all.
  `ost-agent review-sample` prints a review sheet: 10% of the reviewable nodes, stratified
  by `bucket × layer` cell so every bucket and every layer is on it rather than whichever
  sorts first, reproducible under `--seed` so two reviewers rate the same nodes, with the
  three rubric questions (grounded / classified / useful) as unfilled checkboxes beside
  each. `test/cli/review-sample.test.ts` holds all three properties, and holds them against
  the defect rather than the adjective — the fixture's alphabetical head is one bucket of
  three, so a head-of-the-list draw fails eight of its assertions. **The line it does not
  cross:** the command reads no node's prose and emits no number. There is still no command
  in this repo that scores faithfulness or usefulness.
  **What building it surfaced, and it changes how a finished sheet must be read:** on this
  repo's own vault the frame has 150 `bucket × layer` cells and a tenth of the tree is 142
  nodes, so covering every cell costs *more* than the fraction asks and every cell draws
  exactly one node — a five-node cell and a fifty-node cell weigh the same. A tenth of this
  tree is therefore a **coverage** sample and not a proportional one, and the flat mean of
  its checkmarks is a mean over cells rather than over the tree. The sheet says so, prints
  how many nodes each rating stands for, and does not compute the weighted figure for you.

- **The scheduler checks the host before it dispatches, and records whether that check was
  worth anything.** `loop due` decided from the clock and the token ledger alone, and both
  of those it reads *through* the vault — so a checkout whose `.git` had moved answered
  "never fired" (`readRuns` returns `[]` when there is no state dir) and came back **due**
  on every cycle, forever, with each firing dying seconds later inside `loop start` against
  a lock and a record it could not write either. It now verifies reachability first and
  refuses with its own exit code (**21**, `environmentUnready`), counting consecutive skips
  across cycles — a thing a scheduler can do and a pass cannot. **The half that keeps this
  from being a hint:** a preflight taken from a different shell, user or directory than the
  run gets proves nothing, and a hint wired to prevent dispatch eventually cancels a run
  that would have worked. So `loop due` writes down what it saw, `loop start` writes down
  what the run itself sees in its first instant, and the pairs are compared on all four axes
  — working directory, resolved `PATH`, user, vault reachability — into a ledger under
  `.git/ost-agent/` the unattended surface cannot forge.
  `test/loop/preflight-parity.test.ts` holds ten consecutive dispatches to exact agreement,
  in the two processes the claim is about, with one disagreement enough to fail it.
  **What green does NOT settle:** those ten pairs are a scheduler and a run sharing a shell,
  which is the deployment `examples/automation/autonomous-pass.sh` produces. It says nothing
  about a scheduler and a run on different hosts, in different containers or under different
  users — the case where divergence is likeliest. A disagreement is recorded and said loudly
  and does **not** stop the run: cancelling work that would have succeeded is the failure a
  preflight exists to prevent, and whether an operator wants that trade is their call.

- **A legal Workflow skeleton, handed to the composer at the address the tool looks.**
  Two sessions in this repository composed a `Workflow` script of 170 and 240 lines and
  learned the accepted dialect from `Script parse error: Unexpected token (172:33)` and
  `(24:12)`. `.claude/workflows/skeleton.js` is now the starting point: plain JavaScript,
  `meta` first, one example of each construct the tool offers, generated from
  `src/knowledge/workflow-grammar.ts` by `npm run gen:skill` and drift-tested byte for byte
  like `SKILL.md`. The grammar module parses a script the way the surface does — acorn in
  module goal with top-level `await` and `return` — and `test/skill/skeleton-validity.test.ts`
  pins that parser to every refusal on record: both recorded submissions are refused at the
  recorded line **and column**, and the generator refuses to write a skeleton that fails the
  same check. **What the corpus said that the refusal did not:** neither rejected script
  contained TypeScript. Both were a backtick inside a template-literal prompt, so the
  skeleton's one prose-with-backticks example is a double-quoted string and the grammar
  names that as the first reject. **What this does not settle:** whether the surface accepts
  the skeleton — the corpus holds no accepted submission, so the positive direction rests on
  the tool's documentation, and the skeleton is built to be runnable bare (no `args` → no
  agents) precisely so that running it by name is a free check. Whether a composer stays in
  the dialect past what the skeleton shows is the node's own stated limit.
- **A golden set, and a scorer that must put every good tree above every broken one.**
  Nothing in the repository assigned a tree a quality score, so no change to the agent could
  be said to have made its trees better or worse. `src/eval/golden-set.ts` scores a tree on
  five dimensions read from what the product already checks — structural invariants,
  opportunities stated as needs rather than features, nodes that name a source and a rung,
  solutions with an assumption test beneath them, tests with a fixed bar — and
  `test/fixtures/golden-set/` commits three sound vaults in three domains plus five copies of
  one of them each broken a single named way. `test/eval/golden-set-discrimination.test.ts`
  asserts every good vault outscores every degraded one by at least 10 points **per pair**,
  not on the means, with two controls: the good vaults pass `checkInvariants` clean, and each
  degraded vault's planted breakage is the dimension the scorer finds weakest. `ost-agent
  score --vault <dir>` prints the same report for a live vault. **What this does not settle:**
  the degraded vaults are broken in ways their author imagined; a margin over them is no
  evidence the scorer sees a bad tree nobody planted, or that the score tracks what a human
  would call quality.

- **Ideation asks for candidates that differ on a named dimension, not candidates that are
  "genuinely distinct".** Asked for three solutions, a model returns three phrasings of one
  idea, and nothing downstream recovers — elimination is bounded above by generation. The rules
  already said "distinct" and nothing measured it. `src/knowledge/forced-variation.ts` now
  builds the ideation prompt for a target opportunity with one named variation dimension per
  candidate — who does the work, automated versus manual, bought versus built, what is
  deliberately given up, when it acts, where it lives, what it measures, who decides — no two
  alike, each carried into the text the model reads; it refuses a request for more candidates
  than there are dimensions rather than doubling one up, and `checkForcedVariation` refuses a
  prompt that claims the constraint and carries a candidate whose dimension is missing,
  repeated, unknown, or assigned but never named. `ost_next_work` carries the assignment under
  `underservedOpportunities[].variation`, one slot per candidate still needed, starting after
  the dimensions the existing siblings already took; the skill's `solutionRules` and its
  ideation step say to take the assigned position and write it into the solution's prose, so
  the difference is audited by reading. Pinned by
  `test/knowledge/forced-variation-prompt.test.ts`. **What this does not settle:** whether the
  constraint buys range rather than noise — distinctness up, plausibility down by no more than
  10% — which is a person blind-rating a constrained set against the unconstrained arm
  (`forcedVariation: false`) the builder also produces. The constraint widens the search inside
  the frame the dimensions draw; a dimension nobody named is an axis no candidate is pushed on.

- **`debt`'s threshold reading no longer depends on where the author put a line break.**
  The pre-commitment extractor matched its bold lead-in at the start of a line, so a
  `**Pre-committed threshold:**` that prose formatting had hard-wrapped across two lines —
  or that followed `**Design:** …` on the same line — was never seen, and the test counted
  `absent`. The first form was observed twice in a live vault, each time by accident; the
  second turned out to be how 12 of this vault's 18 `absent` tests were written. The scan
  now reads each paragraph joined onto one line and looks for the lead-in anywhere in it,
  so wrapped, unwrapped and mid-line forms classify identically (`bound`, `instruction` and
  `prose` alike), and a bold span that encloses the bar (`**Pre-committed threshold: 20
  arrivals.**`) is read past its colon. A mid-line match must look like a label — bold
  closed on a colon or full stop — so a design paragraph asking "**is this a real
  pre-commitment?**" is not mistaken for one; and the reading runs to the end of its
  paragraph with no cut at the next bold, because this vault's bars itemise their parts
  that way and every cut rule tried read ten bound tests as prose. Pinned by
  `test/ost/threshold-lead-in-wrap.test.ts`, whose fixtures are those live paragraphs. **The published number moves:** on
  this vault `absent` goes 18 → 6, and the six that remain use a plain `Threshold:` with no
  bold and no "pre-commit" in it, which is vocabulary rather than formatting and is left as
  it was. Every `absent` count published before this release was a floor, as the vault
  recorded; it is now a count of tests whose paragraph the extractor does not recognise.

- **A firing whose MCP surface was absent does the work that needs no model, and cannot
  seal clean.** `ost-agent loop fallback` runs after the pass step. If zero tool calls were
  traced since the run opened — the same evidence the `degraded` verdict reads — it routes
  `ingest`, `check`, `status` and `debt` through the very tools the MCP surface would have
  run, built from the same context, so the output is byte-identical; every other name is
  refused at exit 20 before anything is built, with the reason (a write verb, a read-only
  tool the fallback does not carry, or a typo); and the run is stamped before the first
  verb runs, so the seal reports `degraded` with `mcp-absent-fallback` named beside
  `no-tool-calls`. The fallback's own traced calls are excluded from the no-tool-calls
  rule by surface, so the rescue path cannot vouch for the pass. `ingest` is carried
  because it captures and never authors; its captures commit under a `fallback:` message.
  `examples/automation/autonomous-pass.sh` calls it between the pass and the check.

- **`loop start` no longer wedges on the check phase's own census record.** `ost-agent
  check` and `status` keep `.ost-agent/census-history/firings.jsonl` (v0.23), written by a
  read-only command that commits nothing. The first firing after it shipped left the
  directory untracked and the dirty-tree gate refused every tick for seventeen hours while
  `loop health` said `blocking: none`. The path now joins the usage trace as firing residue
  the gate waives, and `loop health` prints a `tree:` line naming any path `loop start`
  would refuse over.

- **A run finds out what it may call before it decides what to do.** `ost-agent grants
  --skill F --settings F` resolves the tools a run's instructions declare against the
  `permissions.allow` it will fire with, and names every demand the grant does not cover —
  by name, with the file the fix goes in, at exit 20. Under `claude -p` an ungranted call is
  denied rather than prompted, so the alternative is a pass that discovers its own grant one
  refused call at a time, at the point where it had already decided what it wanted to do.
  **Scope is part of the comparison, not an afterthought:** four of fifteen recorded denials
  in this workspace were `Glob` refused on `/Users/tanner/dev/OST-Agent` — the tool was
  granted and the directory was not — so coverage reads the grant syntax (server-level MCP
  grants, Bash prefix rules, path globs, directory subtrees) rather than comparing strings.
  Reporting a gap for a tool that is in fact granted would stop a run that could have done
  its work, so the coverage direction is pinned as hard as the gap direction. It writes
  nothing, requests nothing and escalates nothing: which grant to add is the operator's
  decision, and deriving one stays in `ost-agent allowlist`, which refuses from an agent
  session. An unreadable declaration or settings file exits 21, never 0 — a check that could
  not run is not a cleared run.

- **A credential broker holds the secrets, and the run holds a handle.** `SLACK_BOT_TOKEN`,
  `ATLASSIAN_API_TOKEN` and `BRAVE_SEARCH_API_KEY` used to be read from the environment and
  handed, in full, to the client that would use them — and in the search case onto
  `PassContext.web.searchApiKey`, the object every tool is built with. They now stop in one
  place (`src/security/broker.ts`). An adapter is constructed with an opaque handle
  (`ost-credential:slack`) and a brokered fetch; the secret is substituted into the outgoing
  header — including inside HTTP Basic's base64 — only after the URL has been matched against
  a written grant and the request has been appended to the vault's credential log at
  `.ost-agent/credentials/audit.jsonl`. A code path that keeps its own `fetch` sends the handle
  and gets a 401, which is a loud failure where a leaked token would have been a quiet success.

- **No record, no action.** The broker's one advantage over a short-lived scoped token is the
  log, so an unwritable audit sink DENIES the request before the credential is touched rather
  than degrading to best-effort. A sink that fails after the action has run returns the result
  flagged `auditIncomplete` — an action already performed cannot be un-performed by a failed
  write, and the one thing the broker will not do is hand it back looking clean. Grants use a
  deliberately tiny pattern language (exact, or a trailing `/*`); anything ambiguous throws
  when the broker is built rather than resolving itself at request time.

- **A credential under 8 characters is refused rather than held.** Scrubbing is substring
  replacement, so a secret that short cannot be redacted from a log or a result without
  mangling unrelated text. `ost-agent channels` and `buildPassContext` share one definition of
  usable (`usableSecret`), so the health report and what a pass can actually build cannot
  disagree about it.

- **The preflight-uncertainty census: did the callers whose calls failed already know they
  were unsure?** A validate-only twin of every mutating tool — same arguments, every check
  run, nothing written, a verdict returned — helps exactly one caller: the one who thinks
  to use it. So the assumption underneath it is not that the twin is buildable, it is that
  failing callers were hesitating. `ost-agent preflight` (`src/telemetry/preflight.ts`)
  takes that count: the denominator is every failed call in the usage trace, and for each
  it finds the call in the session transcript and reads a bounded window of what the caller
  did immediately before — a first-person hedge, an announced check, a read issued before
  the write, or a clarifying question. The rule is committed in `UNCERTAINTY_RULE` ahead of
  the count, including the nine bare hedges (`might`, `maybe`, `probably`, …) it refuses on
  the grounds that they occur in ordinary prose whatever the caller believes.

- **The answer is 0 of 6, and the two numbers reported ahead of it matter more.** Over this
  project's own trace — 1125 calls, 68 failures, committed whole under
  `test/fixtures/preflight/` — not one readable failure was preceded by any doubt signal.
  But 62 of the 68 have no session record at all, so the denominator is six; and the count
  moves from 0 to 6 as the lookback widens from 6 entries to 24, which the census reports
  as `boundDecides` on the face of the output rather than in a footnote. A share that swings
  from none to all across plausible windows is a property of the window, not of the callers.

- **A window whose reasoning was stripped is reported as unread prose, not as no hedge.**
  Found by building it: Claude Code stores an assistant `thinking` block with its text
  removed and only the signature kept, so the place a caller would have written "I'm not
  sure this rung is allowed" is not in the record. Five of the six readable windows carry
  no caller prose at all. `PreflightCensus.proseless` names them, because "no hedge" over a
  window where a hedge could not have been seen is the sweep that cannot read its subject
  reporting a clean run.

- **A builder capability profile read off the work already committed.** Every other way of
  learning what a collaborator can do asks for a deposit — a skills matrix somebody fills
  in, a trace channel each builder opts into — and a mechanism that needs compliance is
  defeated by non-compliance. `ost-agent capability` (`src/product/capability.ts`) asks for
  nothing: it reads authored commits, their scopes, their diffs, and the pull requests they
  arrived in, and reports what each builder demonstrably knows how to do with the refs
  under each claim so it can be checked. Co-author trailers are builders too, because in a
  repository with agent collaborators the author field records who ran the tool. It is the
  only capability mechanism that works retroactively: the moment it exists it has the whole
  history to read.

- **The profile states how much of the record it could read, because "already there" and
  "legible" are different properties.** A history of `wip` and `update stuff` is present in
  full and supports no inference; a profile built over it would be a confident restatement
  of who touched which file. So a capability is named only from a conventional-commit type
  plus a domain the artifact actually locates — a scope that reads as a word, or an area
  the diff dominates — and the reading is allowed to come back empty. Over this repository,
  against bands fixed before anything was counted (70 of 100 commits and 20 of 30 PRs to
  stand on the whole record, below 50 of 100 to kill the idea), it reports **NARROWED**:
  64 of 100 and 20 of 30. Two findings sit in that number. Discarding opaque scopes moved
  it from 87 to 64 — `feat(w11)` and `feat(tier2)` are well-formed conventional commits
  whose scope is a work-item id, and "builds w11" is a sentence nobody can act on. And most
  of what is left illegible is merge commits, which name a branch and nothing else. What
  the profile still cannot do is stated on its face: it reads capability *exercised*, so
  what a builder was never asked to do is absent, and absent reads the same as unable.

- **A shallow clone is refused rather than profiled.** Found by shipping the above:
  `actions/checkout` clones at depth 1, and the first CI run of the census over the last
  100 commits read a record of one commit and reported a share of it. Every number this
  produces is a share of a denominator, and a denominator of 1 makes any share look
  decisive — the exact shape of a sweep that cannot see its subject and reports a clean
  result. `fetch-depth: 0` is now set on CI's `test` job so the subject is there, and
  `CapabilityProfileReport.shallow` refuses the reading when it is not: the header reads
  `UNREAD (shallow clone)`, the coverage sentence says so ahead of any verdict and names
  the fix, and `ost-agent capability` exits non-zero. A skip in the test would have been
  the other option, and would have made the missing subject invisible.

- **The stranded-evidence census, computed instead of narrated.** An evidence record is
  mapped iff some node names its id in frontmatter `source`, and `source` is settable only
  at node creation — so an item that grounds a node written before the item arrived can be
  read, used and quoted in prose and still be reported as outstanding on every future
  sweep, with no action that clears it. That backlog is the case for two different fixes of
  very different size: an appendable `source`, or a whole new node layer for evidence that
  is true, useful and is not a customer need. The number that decides between them is not
  the size of the backlog but the **split**, so `ost-agent stranded` (`src/ost/stranded.ts`)
  computes it: stranded items divide into those some live node's prose already quotes —
  which an appendable `source` would clear — and those nothing in the tree quotes, which
  only a new home takes. `--also <dir>` takes the census across more than one vault, since
  the same hole in a second tree that never heard of the first is the part that is evidence.

- **The discriminator is a citation, and the census says so.** Each item carries the
  titles of the nodes that quote it, not just a verdict, because "an existing node already
  cites this" is checkable and "this carries no customer need" is a judgment no count can
  take. Over this repository's own vault it reports 21 stranded of 76 records, 20 already
  quoted somewhere and 1 quoted nowhere — where a hand-written census in that tree had
  recorded 14 and 4. The gap is the point: three of the four items a human read as carrying
  no need are quoted in other nodes' prose as grounding, and every id in the backlog is
  quoted by the node that *enumerates* the backlog, which is why `--ignore-citer <title>`
  exists. Ids are matched byte-exact with id-character boundaries, the same way every other
  reader compares them, so `USAGE:2026-07-2` is not found inside `USAGE:2026-07-25`.
  Citations from retracted nodes do not count.

- **A project can name its own vault.** A vault knows which product it serves; the
  product never knew which vault mapped it, and discovery always starts from the code —
  so finding this repository's own tree took six exploratory commands and a guess between
  four candidate directories in `$HOME`. `ost.vault.yaml` at the project root is that
  answer written where the search begins (`src/config/pointer.ts`): a `vault:` path
  relative to the file, `~/…` or absolute, plus the outcome it serves, for the human who
  opens it. It is a visible file rather than a dotfile because the assumption the whole
  idea rests on is that something reads it *unprompted*, and `ls` does not show dotfiles.
  Resolution order is **`--vault` as typed** › **the pointer, searched upward from the
  cwd** › **`$OST_VAULT`** › **the cwd**; the pointer outranks the environment because
  the plugin exports `OST_VAULT=${CLAUDE_PROJECT_DIR}` for every project alike, which is
  right whenever the vault *is* the project and wrong in the only case where anyone
  writes this file.

- **The audit that made it one hook instead of twenty-two edits.** Twenty of the
  twenty-two `--vault` declarations hard-coded `"."` and two read `OST_VAULT`, so the
  environment variable the plugin sets for every session was honoured by two commands out
  of twenty-two — `ost-agent status` run from a project directory looked in the project
  directory no matter what anything had been told. None of them carry a default now; a
  `preAction` hook on the root program fills the option in from one resolver
  (`src/cli/vault-option.ts`), which reaches the `loop` commands registered from another
  module for free. `test/config/vault-pointer-resolution.test.ts` reads the CLI sources
  and fails on any `--vault` that brings its own default back, so the rule covers
  commands nobody has written yet.

- **The pointer says when it has gone stale.** Its one weakness is that it is only a
  string: it goes stale the moment the vault moves. A pointer naming a directory with no
  `ost.config.yaml` now names *itself*, with its path, on stderr — rather than leaving a
  reader with `no ost.config.yaml in <a path they never chose>` and no way to know which
  file sent them there. `ost-agent mcp` prints the same provenance in its startup banner,
  which is where an agent-facing session finds out which tree it got. What none of this
  settles is the assumption the node actually rests on: whether the readers *someone else*
  wrote — editors, other agents, other people's scripts — look for the file at all. No
  spec in this repository can speak for that.

- **A conflict marker cannot reach a commit.** A merge conflict once got committed
  into a source file and the next run inherited a repository that could not build.
  `gitCommit` — the funnel every commit this product makes passes through — now scans
  the *staged blob* for an unresolved conflict block and throws instead of committing
  (`src/git/conflict-guard.ts`), and it installs a matching `pre-commit` hook that
  covers the commits a human makes in the same tree: `git commit`, `--amend`, and the
  `git commit` that concludes a conflicted merge or rebase. A `pre-commit` hook this
  project did not write is never overwritten — the run-side guard still holds there.
  The marker rule is a *block* (`<<<<<<<` closed by a later `>>>>>>>`), not any of the
  three lines: a bare `=======` is a setext `<h1>` underline, and a vault is Markdown.
  `test/git/conflict-marker-guard.test.ts` enumerates every commit route and asserts
  which refuse — including the two that do not. `git commit --no-verify` bypasses the
  hook (human-only; nothing in `src/` can reach the flag, and that is asserted), and a
  fresh clone has no hook until the product commits there. Both are the "advisory, not
  a guarantee" limit of a local hook, recorded rather than papered over.

- **An AssumptionTest may carry its threshold as a field, not only as a sentence
  buried in the body.** `ost_create_node` now accepts an optional `threshold` on an
  AssumptionTest (refused for any other layer); `askedOf` (`src/eval/coverage.ts`,
  the function every `debt`/`status` threshold count runs through) reads it first
  and falls back to the existing prose scan when it is absent, so every test
  written before the field existed — the entire vault as of this change — keeps
  reading exactly as it did. A field also has no line to hard-wrap across, so it
  sidesteps the prose scan's recorded line-wrap misread (a bold lead-in broken
  over two lines used to read as `absent`) for every new test that uses it,
  without touching the scan or its already-published counts for anything older.
  Scoped to the additive half of the proposing node's own Approach section —
  deliberately not the destructive migration its Size estimate also named, which
  the field's backward-compatible fallback makes unnecessary.

- **An outstanding ask now has an age, and silence is measured by a clock instead of
  read as the system working (P2).** A test classified `pending-permission` used to
  produce one dated `## History` line and then go dark — nothing re-read it, so an
  ask for a signature 40 days ago looked identical to one filed an hour ago; both just
  read `lane: pending-permission`. `setLane` (`src/ost/lanes.ts`) now files an ask to
  `.ost-agent/asks/asks.jsonl` — append-only, read as a history, attributed to whoever
  made the call — every time a test lands on that lane, the one write path every route
  to it goes through. `ost_next_work` reports the result as `outstandingAsks`: every
  currently-blocked test, aged from its latest ask, `ageDays: null` (not `0`) when no
  ask is on record so a pre-P2 test reads as unmeasured rather than fresh. Like
  `assumptionWork`, it is information, not a gate — answering an ask stays a human's,
  so none of it blocks `done`.

- **The lane vocabulary finally has a consumer: `ost_next_work` sorts every
  assumption test by what it is waiting on (P3).** A test's lane always decided who
  may run it, but nothing acted on that — the only reader printed a CLI list. Now
  the tool routes each not-yet-resulted test into `assumptionWork.{runnable,
  awaitingOneCommand, blockedOnPermission, needsHumans}`: `runnable` is the
  compute-only bucket a session with a human present may go run and record with
  `ost-agent result`; the other three are already sorted by whether they wait on a
  one-command verdict, a credential, or real outside people. Unlabelled tests fall
  to `needsHumans` by the fail-closed rule. It is a work *surface*, not a runner:
  recording a result stays off the agent's surface (B1/B2) and the unattended pass
  still never runs tests, so `assumptionWork` — like `openUnknowns` — never blocks
  `done`. Autonomous test execution remains DEC-3's to decide and is deliberately
  unbuilt; what shipped is the per-lane consumer and the runnable bucket the
  taxonomy always implied.

- **A run of firings that moves nothing now escalates, instead of reading as success
  one firing at a time (F4's escalation half).** A single `no-op` firing is ordinary
  — a cron that fires between two bits of new input finds nothing and says so. A
  *streak* of them is a vault spending its schedule and producing nothing, and until
  now each such firing exited 0 and looked exactly like a productive one. `assessStall`
  (`src/loop/stall.ts`) folds the ledger and escalates at three firings since the tree
  last moved; the signal rides on `loop seal` (where a `no-op` used to report success)
  and `loop due` (the cron's every-cycle stderr). Only a `healthy` firing resets the
  streak — a `crashed` one does not, so a vault alternating dry-run and timeout still
  escalates rather than looking never-stuck. It does not latch: nothing is stored, it
  reports on stderr without touching the firing's exit code, and the next healthy
  firing clears it with no file for a human to edit. Both preconditions the readiness
  doc named (S1, so a dry firing is genuinely abnormal; D5, so the committed-delta is
  trustworthy) closed first.

- **Three guarantees that were carried by discipline are now carried by tests.**
  No behaviour changed; what changed is that breaking any of them fails the build.
  - Every invariant the agent can create, it can also clear — one row per rule,
    rows read out of `src/eval/invariants.ts` so a new rule cannot ship without
    stating its clear path, and each cell an executed tool call on both the MCP
    surface and the narrower one `/ost-pass` grants. Two cells the hand-written
    audit had wrong are now right, and one real hole is named: a `lane-conflict`
    can still be created by `ost_flag_humans_required` and cleared by nothing,
    on the interactive surface only.
  - `Vault` is the only thing that serializes a node to disk — the claim its own
    header has always made, true by accident since the harness was deleted.
  - No `src/` module ships with zero live callers. Enforcing it found two that do
    (`src/loop/exitLaundering.ts`, `src/adapters/tokens.ts`); they are recorded as
    debt, and the list is asserted exactly, so it cannot quietly grow.

- **Four ways an unattended vault could wedge itself, closed.** Each was a state the
  agent could reach and then never leave, and all four are now refusals at the last
  boundary that could still take the write back.
  - A wikilink split across a line break is refused at the write. It was never an
    edge and never a *dangling* edge, so only `wrapped-wikilink` saw it — and nothing
    on an append-only surface could clear it, because clearing it would mean shrinking
    a body. `assertWritableContent` is the funnel every node write already passed
    through; it now says no.
  - A hygiene issue is cleared only by a real annotation. Suppression compared the
    whole node body against the issue text, so prose *quoting* an issue cleared it —
    which made every free-text write parameter a way to forge `done`, the one gate the
    unattended loop reads. It now reads the dated entry `ost_annotate` writes under
    `## Issues`.
  - One malformed evidence file costs one record, not the read. Unparseable
    frontmatter threw out of `readEvidence` and took `ost_next_work` down with it —
    a denial of service on the whole sweep, reachable by anything that can drop a file
    in the inbox.
  - `autonomous-pass.sh` gates its push on `ost-agent check`. `claude -p` exits 0 for
    a pass that wedged, so the script pushed unconditionally and a failed firing was
    indistinguishable from a good one.

- **Web search no longer needs an API key.** `ost_search_web` now tells the agent
  to use its host's own web search and feed URLs to `ost_read_web`, which is what
  records provenance. Keyless federated sources (Wikipedia, Hacker News, Discourse)
  are available as an opt-in fallback for hosts with no search of their own, and a
  `BRAVE_SEARCH_API_KEY` remains supported as an optional upgrade.
- **The lookup budget refills.** It was capped per process, which meant a session
  running for weeks got 10 lookups in total. Burst capacity is unchanged;
  `web.lookupRefillPerHour` (default 10) sets the sustained rate.

## 0.23.0

- **Every policy governing what OST-Agent does with what it cannot see is now data, and
  the default data is byte-for-byte the old code.** The previous release gave darkness a
  node, an append-only ledger and an attributed cost. What to *do* with it stayed a set of
  TypeScript constants: a three-branch classifier, a resolution state machine, a lookup
  counter, a token weighting. Each was parameterised and well-factored, and each was inert
  — a constant is a trait excluded from evolution, so nothing could vary the cost model and
  record what varying it bought. **A policy expressed as a TypeScript table cannot breed.**

  Those policies now live in an optional `genome.yaml` at the vault root, beside
  `ost.config.yaml`, which the kernel interprets. `init` deliberately never writes one:
  an absent file *is* the shipped default, so no vault that exists today changes behaviour
  and none acquires a file it did not ask for. There is exactly one source of truth for the
  defaults — the zod schema — with the annotated copy in `docs/reference/genome.md` held to
  it by a test, because a documented default that has drifted is the file an operator edits.

  The schema is **`.strict()`**, deliberately unlike `ost.config.yaml`, which strips
  undeclared keys so a pre-runner vault keeps loading. A genome has no legacy vaults to
  protect and it is the artifact a harness mutates: a misspelled allele silently dropped
  reads as *"behaviour unchanged"*, which is the one failure mode that corrupts a fitness
  record without announcing itself. A typo throws and names the field.

  Two numbers stay where an operator can reach them rather than becoming alleles.
  `web.lookupBudget` remains the operator's, and `budgets.sharedPool` defaults to `null`
  meaning *use it* — because the alternative is two numbers in two files that can silently
  disagree, and the honest failure of that arrangement is that neither is wrong. Token
  correlation ships whole and tested but `tokenSplit.enabled` defaults to `false`, so under
  the default genome nothing correlates and cost stays exactly what it was; every rollup now
  carries the `costBasis` it was computed on, so a comparison that mixes bases can be refused
  rather than quietly normalized.

  The refactor claim is made executable rather than asserted. `test/genome/identity.test.ts`
  pins the shipped defaults as a hand-written table, replays the Phase 1 classifier and
  resolution fixtures against the interpreter *as literals* so the old functions can be
  deleted without the test going hollow, and deep-equals a golden per-class rollup and the
  `ost_next_work` output. Five of those six checks pass perfectly well against an interpreter
  that accepts a genome and ignores it — which would be worse than not extracting anything,
  since the harness would then be measuring a variable that does not vary. So the suite ends
  with negative controls: doubling the input weight must double the cost, deleting the
  `unreached` rule must collapse three buckets into two, reversing resolution precedence must
  move a deferred-but-answered unknown from abandoned to satisfied, flipping `staleAttribution`
  must surface the ghost spend the default drops, and `unknownsBlockDone` must actually block.
  The same anti-vacuity guard the examples-allowlist test already carries.

  Nothing was added to the tool surface. `OST_UNKNOWN` is declared as an optional argument
  on tools that already exist; `ALLOWED_TOOL_NAMES` is unchanged at 20 names. The allowlist,
  the lane gate, the invariant checker, the SSRF guard, the believability floor and the
  promotion gate are all documented as permanently outside the genome, with the reason
  stated: a variant able to relax any of them would score well by corrupting the instrument
  rather than by being better, and a fitness number cannot tell those two apart.
## 0.22.0

- **Every count now states the denominator it was taken over.** `status` reported
  `Nodes: 240` and `check` reported `0 violations`; neither said what set those numbers
  were taken over. `readTree()` enumerated the vault root and silently dropped any
  markdown file whose frontmatter `type` was missing or misspelled — so a typo in one
  node subtracted it from every count in the product, and the operator read a confident
  integer over a set that had quietly shrunk. Nothing anywhere reported the drop.

  `readTreeCensus()` returns the same node list plus what the walk declined: how many
  markdown files were examined, which were dropped and why, which could not be parsed
  at all. It is the *same* traversal that produces the node list, deliberately — a
  census taken by a second walk measures the second walk, and can agree with itself
  while the real counter drops files.

  That covers files the walk saw. **Files the walk never enumerated are invisible from
  inside it by construction**, and that is the failure this idea was written against: a
  denominator computed by the same broken traversal excludes exactly the files the
  counter excluded, reads 100%, and says nothing. So the second denominator comes from
  a genuinely different source — `git ls-files`, an index maintained by another program
  through another code path. When git knows about a markdown file the walk never
  returned, `check` and `status` now name the file and say plainly that every count in
  the vault is short by at least that much.

  `ls-files -z`, because vault filenames legitimately contain quotes, spaces and
  em-dashes — the characters in the original failure. Git would otherwise C-quote them
  and the reconciliation would report phantom discrepancies on precisely the files that
  matter most. A positive control is recorded: with `-z` removed, the em-dash test
  fails; with it restored, it passes.

  Unparseable frontmatter is now recorded as `unreadable` rather than thrown. It
  previously escaped `readTree()` and took every command down with a stack trace that
  named no file — one malformed node made the whole vault unreadable.

  Both outputs stay quiet when the two sources agree, so the line is a ratio in the
  healthy case and a named repair in the unhealthy one. 16 new tests.

## 0.21.0

- **`loop step` now refuses a proving command whose exit code cannot report failure.**
  Observed, not theorised: a firing wrapped its build phase as
  `bash -c "npx vitest run 2>&1 | tail -25"`, `vitest` was not on the path, the shell
  printed `vitest: not found` — and the step recorded **exit 0**, because a pipeline's
  status is its *last* command's and `tail` succeeded at reading nothing. The health
  record gained a green build step for a command that never ran, and only a re-read of
  `runs.jsonl` afterwards revealed it.

  `loop step` was not wrong to record what the shell handed it. The defect is that the
  tool accepted a construction in which a red step *cannot* come out red — the exact
  failure the bookend exists to prevent, arriving through the recorder's own front
  door, and the fifth variant this project has met of "a rule reports success while
  covering less than it claims".

  A shell `-c` script containing an unguarded pipeline is now refused **before the
  child spawns and before anything is written**, so a laundered step never reaches the
  record at all. The message names the command, why it cannot be recorded, and the fix.
  There is deliberately no override flag: `set -o pipefail` makes the pipeline report
  its first failing stage and is the correct repair, and an escape hatch would be
  reached for exactly when it does the most damage. Direct `argv` commands have no
  shell between the tool and the process and are untouched; so are `||`, pipes inside
  quotes, escaped pipes, and any script that already enables `pipefail`.

## 0.20.0

- **Every recorded step now carries the directory and argv it actually ran with.**
  `loop step` observed phase, command, exit code and duration — but not *where* the
  command ran, so a recorded failure could not be reproduced from its own record. Both
  halves of that gap were observed live in one firing: a `loop step -- pnpm --filter …`
  invoked from a vault directory rather than the repo produced no output at all and
  recorded a line indistinguishable from the same command run correctly, and `command`
  is an `argv.join(" ")` that cannot tell one spaced argument from two. `LoopStepRecord`
  gains optional `cwd` and `argv`; `cwd` is captured *before* the child spawns, so it
  reports where the command was given rather than wherever the process ended up. Both
  fields are optional because `runs.jsonl` is append-only — a reader that threw on
  older lines would make the record unreadable at exactly the moment it matters.

- **The shipped checks now have a positive control: each one is observed finding an
  instance planted in its subject.** Three of this codebase's reporting rules were
  found blind *after* shipping green — the lane reader that read a fragment as a
  declaration, eleven audio tests that could not fail, and a history sweep that
  measured only the files it could open. The common property was that none had ever
  been seen finding anything, and a rule that has only ever reported success is
  indistinguishable from one that cannot report failure. `test/eval/planted-instance.test.ts`
  plants a synthetic violation for all eight `checkInvariants` rules and for the
  lane-conflict rule, each against an asserted-clean baseline so a hit is demonstrably
  the plant and not fixture noise, plus a negative control (a prose lane that *agrees*
  with its label must not be reported).

  Run as a one-off first, against the pre-committed threshold "2 or more checks failing
  to find their plant means blindness is the default rather than an accident":
  **12 plants, 12 found, 0 checks blind.** Threshold not crossed. Worth recording that
  the run's three apparent misses were all defects in the *plants* — a wikilink placed
  in prose rather than the contiguous edge block (correctly not an edge), a "conflict"
  whose two halves agreed, and an assertion grepping for a word the reporter never
  prints. An unattended pass that had not verified its own plants would have reported
  three blind checks and triggered the wrong fix.

## 0.19.0

- **The server the plugin auto-starts no longer needs a vault to exist — and the first
  minute is served instead of refused.** The plugin points its MCP server at
  `${CLAUDE_PROJECT_DIR}`, so a fresh consumer's very first session connects it to a
  directory with no vault, no config, and no git repo. `createLazyOstMcpServer` comes up
  anyway: it advertises the full 13-tool surface, answers every pre-init call with the
  setup guidance from one source (`src/mcp/setup.ts` — exact directory, exact init
  command, the outcome stays human-set, no API key needed), keeps `ost_next_work`'s
  `bootstrap: true` state contract, and starts serving the real tools on the first call
  after `init` runs — same session, no reconnect. The eager `createOstMcpServer` is
  unchanged; both factories delegate to the same handler internals, so the two paths
  cannot drift.

- **Adversarial review of that change found four ways the promise was false, each now
  fixed with a regression test.** Probing wrote to disk: `Vault`'s constructor ran
  `mkdirSync(recursive: true)`, so a typo'd `OST_VAULT` silently conjured the whole
  directory chain — probes now open the vault with `create: false`, and readiness is
  confirmed before anything is opened. A present-but-invalid `ost.config.yaml` turned
  every request, `tools/list` included, into a raw JSON-RPC -32603 — it now degrades to
  in-band guidance naming the file and the fix, and recovers the moment the file is
  fixed. An enabled adapter's missing env vars blocked every MCP tool, though the MCP
  surface never consumes adapter sources — context construction now skips them. And a
  vault missing only its Outcome node was told to run `init`, which on an existing vault
  would have silently discarded the human's outcome — every tool now names
  `set-outcome`, the same command `ost_next_work` gives.

- **An auth-shaped pass failure now names both ways forward.** The SDK's "Could not
  resolve authentication method" said neither of the real fixes. `withAuthHint` appends
  them — set a credential, or skip API keys entirely and drive the tree from Claude Code
  over MCP — to `run` and supervisor failure lines. The original error is preserved:
  a hint is added, information is never replaced.

- 493 tests across 66 files (up from 461 at 0.17.0 — the 0.18.0 release recorded no count), `tsc` clean.

## 0.18.0

- **The vault now refuses to write content that is empty or the literal string
  `undefined`/`null`.** This is the complement to 0.17.0's schema check, and it was built
  only after a test said it should be a tripwire rather than a policy.

  0.17.0 validated the tool *call*. It provably cannot see a malformed *value* arriving
  through a well-formed call: `{ issue: String(x) }` where `x` was never set is a
  schema-valid call carrying the four characters `undefined`. The guard added here sits in
  `Vault`, at the single point every node write funnels through, so it also holds for entry
  points that do not exist yet — including callers that never touch the CLI or the MCP
  server. Covered paths: `createNode`, `appendToNode`, `appendUnderSection`, `annotate`, and
  the optional notes on `setStatus`, `setEvidence`, `setLane`.

  **It is deliberately a tripwire, not a policy.** The rule is that content *is* exactly one
  of these strings, never that it *contains* one — several real annotations in this project's
  own vaults discuss the word `undefined`, and they must stay writable. A test pins that.
  Another test pins the distinction the guard turns on: an *absent* optional note (`undefined`
  the JS value) is a caller legitimately declining to explain itself and passes; the *string*
  `"undefined"` is a caller that stringified a variable it never set, and is refused.

- **Correction to the 0.17.0 entry above: the count was wrong, in both directions.** That
  entry says "fourteen such lines — 8 in `ost-agent-meta`, 6 in `tetrix-ost`". The real
  figure is **21 lines across 16 nodes — 6 in `ost-agent-meta`, 15 in `tetrix-ost`**. The
  original number came from `grep -rlc` over files *containing the word* `undefined`, which
  is a different question from *lines matching the annotation shape*; it under-counted nodes
  carrying several damaged lines and mis-split the total across the two vaults. The 0.17.0
  text is left standing and corrected here rather than edited, on the same principle the
  vaults use.

- **The count is now measured rather than asserted.** The assumption test
  *"Sweep both vault histories for writes that landed as undefined or empty"* was run before
  this feature was built, with its threshold fixed in advance: the "the `undefined` lines are
  the whole population" claim survived if fewer than 3 bad writes of any *other* shape turned
  up across both vaults. Replaying all 106 commits in the two vaults and classifying every
  annotation entry added under `## History` or `## Issues` — 306 entries — found **21
  `undefined`, 0 empty, 0 truncated**. The assumption held, which is why this guard ships as
  a tripwire for one known shape instead of as the primary fix.

  Two bugs in the sweep itself had to be fixed before its result meant anything, and both
  were the failure mode this project keeps meeting: a check that quietly measures nothing.
  Git quotes non-ASCII paths in `--name-only`, so `git show` failed on the vault's
  em-dashed filenames and the sweep *skipped four affected files without saying so*; and
  merge commits re-counted entries already counted on the side branch. The first run
  reported a clean, confident, wrong number.

## 0.17.0

- **A tool call that does not match the tool's own schema is now refused instead of
  written.** Found by using the product on itself, and it is the sharpest evidence this
  project has produced about its own central claim.

  A pass called `ost_annotate` with `note` instead of the declared `issue`. The tool's schema
  says `required: ["title","issue"]` and `additionalProperties: false`, so the call was
  invalid on its face. `runTool` handed the object straight to `run`, which read
  `input.issue` as `undefined`, appended the literal string **"undefined"** to the node's
  Issues section, and **reported success**. The note itself was never written anywhere.
  Because the vault is append-only, the line can be annotated but never removed: the content
  is unrecoverable.

  **Fourteen such lines exist across the two live vaults** — 8 in `ost-agent-meta`, 6 in
  `tetrix-ost`, written by several different passes over three days. Each is an annotation
  somebody wrote and nobody can read. They are flagged in place, not repaired; rewriting them
  would be the exact action this product refuses, including when this product caused it.

  **What this says about "incapable of destructive action by construction."** That claim was
  true of the tool *surface* — no delete tool exists, and none was involved here. The
  destruction came through a *constructive* tool holding an argument nobody checked. The
  allowlist answered *which tool may run*; nothing answered *with what*. A guarantee about
  which verbs exist is not a guarantee about what they are handed, and the codebase had been
  treating the first as if it covered the second — the comment at the call site said so
  explicitly ("safety is already enforced by the allowlist above").

  - `validateToolInput` checks input against the schema each tool already publishes:
    required properties present (`undefined` counts as missing, which is the whole defect),
    no unexpected properties, declared types. Errors name the offending property, so the
    original bad call now answers *missing required property `issue`* and *unexpected
    property `note` — allowed: title, issue*, and writes nothing.
  - A deliberately small hand-written subset of JSON Schema rather than a validator
    dependency — it covers every construct the tool schemas use, and an unrecognised keyword
    is not silently treated as checked, since a validator that quietly skips what it cannot
    read is the same class of bug it is here to prevent.
  - A companion test asserts **every** allowlisted tool declares a readable schema. Without
    it the guard degrades invisibly: a tool with no schema yields "0 problems", which is the
    same answer as a tool that passed.

- 461 tests across 63 files (up from 453), `tsc` clean.

## 0.16.0

- **`check` now fails when a test answers "may an unattended pass run this?" twice,
  differently** (rule `lane-conflict`). A `lane:` in the frontmatter and a different lane
  declared in the node's own prose is one node contradicting itself about the one question a
  lane exists to settle — the same shape as `no-self-validation`, and a hard failure for the
  same reason: the fail-closed direction of a lane is the whole safety argument, and a
  contradiction has no direction. The message names both readings and says which one costs
  something: labelled `compute-only` over prose saying `humans-required` is the expensive
  direction, because the label is what `runnableByCompute` obeys, so a pass will go and run a
  test whose own text says a person is part of the measurement. `ost-agent lanes` lists
  conflicts too, and the hygiene detector annotates them. Reported, never resolved — picking
  the permissive side stays a human's call.

- **The prose-lane reader stopped reporting fragments as declarations.** 0.15.0 read the
  first `lane: <id>` match anywhere in a node body. That was wrong twice over, and both were
  live in the vault this product maintains for itself:
  - **A qualified declaration was reported as a clean one.** A test reading
    `**Lane: compute-only for the census, humans-required for the fixing.**` was printed as a
    paste-ready `--set compute-only`, quoting the test's own words as the justification —
    i.e. the tool invited a human to classify the human half of a split test into compute's
    reach, and the invitation looked authoritative *because* it was a quote. A declaration
    naming two lanes now yields no declaration and no paste-ready command; it is reported
    separately as an ambiguity, with the **whole sentence**, since the fragment is what made
    it look unambiguous. The tree's advice: split the test.
  - **The audit trail read as prose.** `Vault.setLane` appends
    `- <date> lane: <prev> → <next>` under `## History`. Surfacing conflicts on top of the
    old reader would therefore have flagged every *reclassified* test as conflicting with its
    own paper trail — the tool arguing with its own record, in a rule whose only job is to
    report contradictions. The reader now scans a node's own prose only: everything above the
    first `##` heading. `## History` is an audit trail and `## Issues` is commentary; neither
    is the node speaking. Verified against a real reclassification in a copy of the tetrix
    vault: the pre-fix regex matches `lane: humans-required` from the history line and would
    report a conflict; the shipped reader reports none.

- A ruleset rule states the writing habit both brains now learn: one lane, one sentence, one
  name — and a lane in prose is a suggestion, never a label.

- 453 tests across 62 files (up from 432), `tsc` clean, `check` PASS with 0 violations on the
  meta vault and 0 `lane-conflict` findings on either live vault.

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
