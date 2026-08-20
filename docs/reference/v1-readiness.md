# V1.0.0 readiness — the validation criteria

**What has to be true before an OST-Agent vault can be pointed at OST-Agent, left
unattended, and trusted to make progress on an arbitrarily large, arbitrarily vague
mandate.**

Written 2026-07-29 against `0.23.0` (`8387c08`); revised after `8261a6f`
deleted the genome and the harness, again after the first Tier 1 batch closed
R1, R5, S6 and H2, and again after the second batch turned R3's table, W4 and G3
into committed tests, and again after R4 made the two health gates compute one
rule set, and again after B12 stated the ingest-to-rank chain as one criterion
instead of four cross-references, and again after B8 made a declared rung a claim
the tree checks, and again after **Gate F** was added because everything above it
specifies a system that cannot hurt you and none of it specifies a system that
does anything, and again after **F6's join landed** and Tier 3½'s acceptance test
stopped being a conjunction of tests written for other reasons, and again after
**Tier 2 closed** — B1, B2, B3, B9 and B10 in one batch, which took the tree's
three forgeable instruments off the agent's surface, and again after **W9 and W10
closed together**, because they turned out to be one defect: a `writeEvidence` that
answered "already stored" when it meant "not stored" is exactly what let the cursor
mark an unstored report as delivered — and again after **W2 and W3 closed together**,
which is the first criterion here whose detector had to be a third instrument: the walk
and git both go blind on the same file, because the `git add -A` every mutating call
runs has already reconciled the index the walk would be compared against — and again
after **Gate B's earned half closed**: B5, B6, B11, B12 and P5 in one batch, which
replaced a store where the agent wrote the rung it wanted with a ledger where no
record carries a rung at all and standing is a fold over what an actor's claims
predicted and what human-recorded tests then found. `tsc --noEmit` is
clean and the suite is green — and nothing below is about the code being broken.
It is about the difference between *a tool that works when watched* and *a system
that can be left alone*.

**75 criteria, 20 of them blockers. 74 met, 0 partial, 1 not met.** Three of the
twenty-eight were met by *deleting* something rather than building it, which is the
document working as intended; four more were the first Tier 1 batch, each of
which turned a wedge into a refusal at the boundary that could still take it back.
The Gate F batch closed nine — W5, W13, F1, F2, F3, H1, H3, H4 and G3, with F4 and
F6 partial — and **six of those nine were not Gate F criteria.** H1, H3 and H4 had
been waiting on a firing to record; G3's two dead modules were both dead because
the criterion that needed them had not been built. That is the ordering constraint
paying out rather than being obeyed. **F6 closed next**, on its own, and it is the
one criterion here whose subject is the other criteria: it asserts that the files
Gate F's verdicts are computed from cannot be written by either surface the
unattended path grants. Its entry records that the test's own first draft was
vacuous and green.

> **What the Gate F revision changed, beyond adding six criteria.** Three existing
> entries were wrong and one check could not be run at all. **Z1 — a blocker — was
> recorded `not met` and had been met since R4's commit**, which deleted the spread
> that caused its `RangeError` while rewriting something else; the reproduction was
> never re-run, and its citation had drifted onto an unrelated line. That is Z5's
> failure mode on a blocker, for the second time. **P8's check named
> `makeLookupBudget`, a function that exists nowhere** — three parameters, one of
> them a leftover `policy` argument — so a criterion on a bar had been unrunnable
> since `8261a6f`. **D1's evidence line claimed 790 tests across 79 files** against
> an actual 819/83, on the criterion whose subject is that the release gates pass,
> for the third time on that line. And **22 citations had drifted to wrong lines**,
> every one of them still in bounds, so `test/release/readiness-citations.test.ts`
> was green on all 22. The lesson is the one this document keeps re-learning from a
> new direction: *a check that cannot distinguish its passing state from its broken
> state is not a check*, and a status nothing runs is memory.

> *These numbers are re-counted out of this file on each revision rather than
> adjusted, because the last time they were adjusted two of them were wrong.* The
> line read **11 met, 53 not met** against 67 criteria while the file held 13
> `met` and 51 `not met` — R4 and R7 had closed and their own entries were updated
> while this line was not. The count that produced the numbers above, which is
> what to re-run:
>
> ```bash
> grep -cE '^\*\*(⛔ )?[A-Z][0-9]+ —' docs/reference/v1-readiness.md   # 75 criteria
> grep -cE '^\*\*⛔ [A-Z][0-9]+ —' docs/reference/v1-readiness.md      # 20 blockers
> grep -oE '^> \*Today:\*\s+\*\*[a-z, ]+' docs/reference/v1-readiness.md \
>   | sed 's/.*\*\*//;s/^met.*/met/;s/^partial.*/partial/;s/^not met.*/not met/' \
>   | sort | uniq -c                                                  # 74 / 0 / 1
> ```
>
> *Those three trailing comments read `68 / 17 / 17-3-48` until 2026-07-29 — the
> counts from the revision that introduced the commands, left behind by the two
> revisions after it. **A command that reports the right number beside a comment
> stating the wrong one is the same failure one layer down**, which is why the
> numbers are now pinned rather than commented: `test/release/readiness-counts.test.ts`
> re-runs all four counts against this file and fails when the summary line
> disagrees.*
>
> The `sed` collapse is load-bearing: eight entries qualify the verdict in the
> same bold span (*"not met, and nothing exists to build on"*), and a count that
> matched only the bare word would silently drop them. A naïve
> `grep -c '⛔'` returns 24, of which four are not criteria: the legend that
> explains the symbol, and three occurrences inside this blockquote's own prose
> and commands. *That sentence used to read "returns 18 blockers; the eighteenth
> is the legend" — a claim this blockquote falsified in the same commit that added
> it, by mentioning the symbol three more times.* **A number in a summary line was
> a claim carried by memory about claims carried by tests, and it was the one thing
> here nothing pinned.** It is pinned now. The commands above are what the test
> runs, so the summary line, the comments beside the commands, and the file itself
> can no longer drift apart in silence — the failure that produced `11 met, 53 not
> met` against a file holding 13 and 51, and then produced the stale comments
> above.

> **What the Tier 2 batch changed, beyond closing five criteria.** Two of them
> were recorded here with the wrong shape, and building them is what showed it.
> **B1 named one exposure and there were six**: `appendUnderHeading` splices any
> caller's string in as body lines, so `ost_create_node`'s `body`, two `note`
> parameters, an `issue` and a `why` each wrote `## Results` as well as `section`
> did — five of them granted to the unattended sweep — and each was measured
> clearing `gateSolution` on its own. **B2 named one door and there were two**:
> `ost_create_node` takes `status`, so closing `ost_set_status` alone would have
> left the criterion's sentence true and its intent defeated in one call. Both
> corrections point the same way: *a criterion that names its exposure by the tool
> it was found on will under-state it.* A third finding is smaller and worse —
> **the two readers of `## Results` did not agree about what one is**, one matching
> `## Results of the pilot` and the other `  ## Results`, so a guard written
> against either would have been a sieve. And **B2's refusal had no way out to
> name**: no CLI command, no tool, nothing in the repo moved a node to
> `validated` except the agent doing it on a human's say-so, so the criterion
> shipped with `ost-agent promote` or it shipped as R2.

**The second batch moved two criteria in opposite directions, and that is the
point of pinning things.** R9's clearability table now runs (`test/eval/clearability.test.ts`),
which promoted R3 from *not met* to *partial* by proving eight of its nine rows
and naming the ninth. G3 went the other way: it was recorded here as *met but
unpinned*, and the pin (`test/release/module-reachability.test.ts`) found two
modules with no live caller. **A criterion whose status was carried by memory was
wrong, and the only reason anyone knows is that it stopped being carried by
memory.**

An earlier meta-vault was started and abandoned because it broke in several ways.
This document is the attempt to name those ways before the second attempt, in a
form that can be checked rather than remembered.

**Every criterion states a check that can be run today.** Where a criterion
describes a mechanism that does not exist yet, the check is an *absence* check —
a grep or a unit assertion that comes out false now and true when the mechanism
lands. A criterion whose only check presupposes the thing being checked is
circular and does not belong on a bar; several drafts of this document contained
some, and they were removed.

> **This bar is deliberately not "everything below is built."** Several criteria
> are met by *deleting a claim* rather than by building a mechanism. Where a
> guarantee is currently carried by discipline, the cheapest honest fix is often
> to stop asserting it. Those are called out.

---

## Part 0 — The system V1 has to support

### Three roles, one writer

| Role | Reads the vault | Writes the vault | Acts on the world |
|---|---|---|---|
| **Cartographer** (OST-Agent) | yes | **yes — exclusively** | never |
| **Builder** (any actor, fungible) | yes | **no** | yes |
| **Sponsor** (the human) | yes | no | yes |

The cartographer owns the tree and cannot touch the world. The builder acts on
the world and cannot touch the tree; its only channel back is the inbox, where it
reports **sensing channels it has successfully commissioned**, in a form the
cartographer can digest. The sponsor signs, funds, and consents — and is *a
resource the cartographer has to manage a relationship with*, not an authority
whose statements are true.

### The three settled decisions

- **DEC-1 — Builder isolation.** The vault is off-limits to the builder. Read
  access only. It reports commissioned pipelines through the inbox. Who builds
  does not matter; that it cannot write the tree does.
- **DEC-2 — Earned believability.** A new stream, result, or source arrives
  untested, untrusted and fragile — a new hire whose résumé, references and
  self-description are all unverified. Standing is earned by **testing cause and
  effect**: a source that makes predictions reality corroborates rises; one that
  does not, does not.
- **DEC-3 — Unbounded envelope, granted in real time.** The agent assumes it has
  forever *and* must be maximally efficient. Whether a resource can be acquired
  is itself a question to be answered by **testing the working environment**. The
  sponsor's promises about that environment are exactly as suspect as any other
  claim and enter through the inbox like everything else.

Each decision has one gate that enforces it: **DEC-1 → Gate W**, **DEC-2 → Gate
B**, **DEC-3 → Gate P**. *(These were numbered `D1`–`D3` until 2026-07-29, which
collided with Gate D's criteria `D1`–`D5` — a reference like "under D2" resolved
to two different claims depending on which half of the document the reader had
open, and by the time it was caught R2's reachability note contained one of
each. Decisions are `DEC-n`; a bare letter-and-number is always a criterion.)*

### What follows mechanically — the derived consequences

These are not preferences. They fall out of DEC-1–DEC-3 and they reshape several
things the repo currently does.

1. **A result is not *recorded*, it is *reported*.** `ost-agent result` writes
   the vault (`src/ost/results.ts:75-83`). Under DEC-1 the builder cannot call it.
   So a test outcome arrives as an inbox report at the floor rung, and the
   cartographer decides what to believe. This deletes an entire class of
   attribution problem instead of patching it — and it removes the CLI path by
   which a non-human actor could raise a node to `money`/`observed` and clear its
   own gate.
2. **Every actor is a source with a track record** — commissioned pipeline, web
   host, builder, sponsor, and the cartographer's own speculation. One ledger
   shape, keyed on actor, not four special cases.
3. **`done` is a claim the system makes about itself**, so it must be
   unforgeable by the actor making it.
4. **The scarce resource is the sponsor, not compute.** "Forever" makes agent
   time nearly free and human attention the only real budget. Efficiency means
   *human-minutes per unit of progress*.
5. **Compute is cheap; consequences are not.** Once a builder acts on the tree's
   output, "the worst thing it can do is make a commit that doesn't make sense"
   stops being true of the system. Reversibility has to become a first-class
   property of a *decision*, not an accident of the tool surface.
6. **The tree is the artefact under test; it is never the referee.** Every gate
   above says what the cartographer may not *forge*. None of them says who decides
   that a mechanism *works* — and the answer can never be a heading, a status
   field, an annotation, or any `ost_*` call, because B1, B2 and B10 are the
   standing proof that those are writable by the actor being judged. A verdict has
   to be computed by a process exit code, a ledger no allowlisted tool can reach,
   a deterministic CLI run out of band, or a reviewing actor that reads the tree
   and cannot write it. **This is what Gate F adds, and it is why every Gate F
   criterion states two acceptance conditions rather than one:** what the
   mechanism must do, and what decides that it did.

---

## How to read a criterion

```
ID — the claim, stated so it can come out false.
    Check:  the exact command or assertion that decides it, runnable today.
    Today:  status, with file:line evidence.
```

Gate F criteria carry a third line, because a mechanism that works and a mechanism
that can be *shown* to work are different claims and this document has repeatedly
recorded the first while meaning the second:

```
    Decided by:  what computes the verdict, and why the agent cannot produce it.
```

| Status | Meaning |
|---|---|
| **met** | Holds today, and something pins it. |
| **partial** | A named half holds; a named half does not. |
| **not met** | Does not hold. |

**⛔ BLOCKER** marks a criterion that must pass before the meta-vault is started
at all. Everything else can be met on a schedule.

Findings marked *(verified)* were reproduced against scratch vaults built outside
this repository, not inferred from reading.

---

## Part I — The three settled decisions, as mechanisms

### Gate W — One writer

The boundary DEC-1 describes does not exist in this repository. `builder` appears
exactly once in all of `src/`, in a doc comment (`src/telemetry/usage.ts:4`).
The vault is a plain directory, it equals `CLAUDE_PROJECT_DIR`
(`.claude-plugin/plugin.json:28-30`), and any process with a filesystem handle
is a full-privilege writer. The isolation that failed in the main terminal
failed for a reason nothing here has changed.

**⛔ W1 — The drop folder resolves outside the vault root, so "may write the
inbox" and "may write the tree" are different grants.**
> *Check:* `path.relative(vaultDir, path.resolve(vaultDir,
> loadConfig(vaultDir).adapters.inbox.path))` starts with `..`.
> *Today:* **met** (2026-07-30). `init` writes a concrete escaping path —
> `../<vault-basename>.inbox` — **into the operator's own `ost.config.yaml`**, and
> creates the folder. Writing the literal string into the file the operator reads,
> rather than deriving it in code from a sentinel, is what "blessed" means here: the
> criterion asks for the escape to be *blessed and asserted*, not discovered, and a
> path you can see in your own config is the difference. It is a **sibling** of the
> vault rather than a fixed `../inbox`, because two vaults under one parent would
> otherwise share a drop folder and each ingest the other's notes. The criterion's
> check is committed verbatim, with the legacy path as its control.
>
> **The schema default stays `.ost-agent/inbox`, and that is the load-bearing
> decision.** Changing it would mean a vault whose config omits the key silently
> stops reading the folder it has been using — a data event, not a refactor. New
> vaults get the escaping path written down; old vaults keep the key's meaning.
>
> **The third answer for a drop folder still inside the vault** is neither refusal
> (which breaks every existing vault at load) nor silent acceptance (which is the
> state this entry described): it is grandfathering **by key**. `adapters.inbox.path`
> resolving inside the vault is accepted, marked `confined: false`, and **named on
> every surface that lists channels** with a remedy — and the remedy is safe to
> follow because ids and cursors key on filenames, not on the folder path, so
> moving the folder re-ingests nothing (pinned). A channel declared under the *new*
> `channels:` key that resolves inside is **refused**: new expressiveness is born
> confined, only the key that already existed is grandfathered.
>
> Confinement is decided on **realpath'd** paths where they exist, lexically where
> they do not. A symlink is the one way a lexically-outside path is really inside,
> and the grant this criterion is about would be defeated by it silently.
>
> *W13's residue is partly closed by this and the rest is stated:* `init` appends a
> `.gitignore` line for a grandfathered inside-vault folder, so notes not yet
> committed stop being swept in — but **already-committed notes stay in history**,
> which is why the honest remedy is moving the folder rather than ignoring it.

**⛔ W2 — A node file that no tool invocation explains is refused, or recorded as
unexplained.**
> *Check:* with the server running, `printf '---\ntype: Opportunity\n---\nx\n' >
> <vault>/Injected.md`, then call any mutating `ost_*` tool. **Pass =**
> `git log -1 --stat` does not list `Injected.md` under an `mcp: <tool>` commit,
> **or** `ost_check` returns a violation naming it.
> *Today:* **met** (2026-07-30) on the second half, pinned by
> `test/mcp/unexplained-node.test.ts:56-81`. `ost_check` now reports
> `[unexplained-node] "Injected.md"` and the check goes red.
>
> **The first half is still false, and the test asserts that it is.** Every mutating
> call runs `git add -A` (`src/git/safe-git.ts:49`) and commits with the message
> `mcp: <tool> — <output>` (`src/mcp/server.ts:206-208`), so an out-of-band write does
> not merely go unnoticed — it *acquires* a commit message attributing it to an
> allowlisted append-only tool, and the test reproduces exactly that before checking the
> branch that holds. A criterion whose passing branch is recorded while its failing
> branch is left to memory is how the OR quietly becomes an AND nobody notices breaking.
>
> The detector is W3's join, and the reason it has to be the trace rather than git is
> the sentence above: `reconcileWithGit` (`src/ost/census.ts:103-130`) compares the walk
> against a `git ls-files` that the `add -A` has already reconciled, so the two sources
> agree precisely when both are wrong. **The sharpest test is the one where every
> structural rule passes**: whoever can write the node file can also write the edge that
> connects it, so a competent injection leaves `invariants: PASS` and a tree that reads
> healthy, and only the trace disagrees.

**W3 — The usage trace is a denominator the tree can be checked against.**
> *Check:* write a node out of band, then assert `ost_check` names a violation
> whose basis is `.ost-agent/usage/events.jsonl`.
> *Today:* **met** (2026-07-30), pinned by `test/mcp/unexplained-node.test.ts:133-166`.
> The join was built and it was one join away, as this entry said. Three pieces:
> `UsageEvent.wrote` records the node files a call brought into existence
> (`src/telemetry/usage.ts:41-55`); the single writer reports each creation to a drain
> the tracer empties inside the same call (`src/ost/vault.ts:267-273`); and
> `reconcileWithUsage` (`src/ost/census.ts:161-192`) subtracts what the trace claims
> from what the walk saw. The violation names `.ost-agent/usage/events.jsonl` as its
> basis, because a finding an operator cannot go and read is a finding they have to take
> on faith.
>
> **Three decisions here are worth stating, because each could have been made the easy
> way and been wrong.**
>
> *It is not a rule in `checkInvariants`.* That module is model-independent structure
> over a node list; this is a claim about the world outside the list, read from a file.
> Putting it there would also have made it a `done`-blocker through `detectHygiene`'s
> derivation (R4) — and no tool on the surface can delete a node file, so the unattended
> sweep would wedge forever on a defect it cannot touch. It is a hard `ost_check`
> violation and a mandatory human interrupt, exactly as `single-outcome` is, and for the
> same reason.
>
> *It refuses to answer without a floor.* The trace can only speak for a vault it has
> watched since the beginning, so `init` writes a marker event, and without one the
> reconciliation returns *no basis* rather than reporting every node as unexplained. A
> wall of noise on every pre-existing vault is how an operator learns to skip the line
> that matters. An absent basis is not a discrepancy — the same answer `reconcileWithGit`
> gives a vault that is not a repository.
>
> *The floor cannot be re-laid.* `init` is re-runnable and `/ost-setup` grants a
> `Bash(… init:*)` prefix, so the first init explains everything at the root and every
> later one explains only what it wrote. Otherwise the laundry is two commands: drop a
> node file, run `init`, watch the violation disappear.
>
> *The honest limit, stated because it is the boundary and not a loophole:* anyone who
> can write a node file out of band can also delete the trace, and a deleted trace reads
> as no basis rather than as an alarm. What they cannot do is delete it quietly — the
> file is tracked, so its removal is a diff. This detects the write nobody was hiding,
> which is the one W2 is about.

**W4 — Only `Vault` serializes a node to disk.**
> *Check:* an import-level assertion that the set of `src/` modules able to reach
> `serialize` from `ost/node` is exactly `{src/ost/vault.ts}`. (Not the same-line
> form `grep 'serialize(' | grep writeFileSync`, which is defeated by splitting
> the call across two statements.)
> *Today:* **met** (2026-07-29), and now pinned by
> `test/ost/serialize-single-writer.test.ts`. The one bypass —
> `src/harness/generate.ts`, which wrote node files directly, skipping
> `assertWritableContent` and `nodePath` — was deleted with the harness, so the
> header claim at `src/ost/vault.ts:7-9` became true by accident; the test is what
> stops the next bypass shipping the same way. A second assertion covers the
> complementary hole — no module outside `vault.ts` writes a `.md` path at all —
> since a bypass could hand-roll the frontmatter instead of importing anything.
>
> *The grep this criterion used to specify was vacuous, which is worth recording.*
> `grep -rn "import.*\bserialize\b.*ost/node" src/ --include='*.ts'` matches
> **nothing** today: `vault.ts`'s import spans nine lines and names the module
> `./node.js`, so a line-oriented grep returns an empty set — the same output it
> would return if the vault stopped importing `serialize` entirely. A check whose
> passing state and whose broken state are indistinguishable was never checking
> anything, and the only way that surfaced was writing it down as a test.

**W5 — The unattended automation path grants no write capability beyond the MCP
tool surface.**
> *Check:* `grep -nE 'permission-mode|disallowedTools'
> examples/automation/autonomous-pass.sh examples/automation/github-workflow.yml`
> — pass requires either a non-`acceptEdits` mode or an explicit
> `--disallowedTools Edit,Write,Bash,…`.
> *Today:* **met** (2026-07-29). Both examples dropped `--permission-mode
> acceptEdits` and pass an explicit
> `--disallowedTools Bash,BashOutput,KillShell,Edit,Write,NotebookEdit,Task,Skill,WebFetch,WebSearch`
> (`examples/automation/autonomous-pass.sh:86`,
> `examples/automation/github-workflow.yml:80`). `Task` and `Skill` are on
> the list because neither writes anything itself — each hands the turn to
> something whose tool set the flag no longer describes, and `/ost-setup` already
> ships frontmatter granting a `Bash(…)` prefix. Corrected 2026-08-06: this list
> read `SlashCommand` and `MultiEdit`, both of which Claude Code had retired. An
> inert deny rule is not a narrower guarantee, it is none at all for that name —
> `Skill` had inherited the delegation this criterion claims to refuse, so the
> criterion was **wrong while reading met**. `test/release/examples-allowlist.test.ts`
> now ratchets both retired names out. `WebFetch`/`WebSearch` are on it
> because `ost_read_web` and `ost_search_web` meter against one per-pass budget and
> the raw built-ins do not, so leaving them would make P8's cap decorative.
> `test/release/examples-allowlist.test.ts` now holds the list to an authoritative
> `MUST_DENY` set, asserts neither example re-adds `acceptEdits`, and asserts
> allow ∩ deny = ∅ — a denied MCP tool would silently drop a phase, which is the
> failure the sync half of that file already existed to prevent.
>
> **This was the cheapest criterion on the list and the most load-bearing, and
> nothing in this document said so until Gate F was written.** It read as two shell
> flags on two example files. It is the precondition for every Gate F decider: the
> MCP surface cannot reach a sidecar ledger — `nodePath` refuses any path
> containing a separator (`src/ost/vault.ts:103-110`) — so the health record, the
> cadence ledger, the spend pool and `ost.config.yaml` were reachable by exactly
> one route, and it was this one. See F6, which exists to state that dependency in
> a form that can come out false, and the Tier 1 note on the promotion.

**W6 — No shipped command grants a Bash subcommand that writes the tree.**
> *Check:* `grep -n 'allowed-tools' .claude/commands/*.md | grep 'ost-agent.mjs'`
> — enumerate every granted subcommand and assert none of them writes the vault.
> *Today:* **met** (2026-07-30). The `set-outcome:*` grant is gone from
> `/ost-setup`; `init:*` is the only Bash prefix any shipped command grants.
> Pinned by `test/release/command-allowlists.test.ts`, whose W6 debt register is
> now empty — by **exact equality in both directions**, so widening it is a visible
> commit that has to argue for itself.
>
> **The check is behavioural, and it had to be.** Static classification was tried
> and rejected: import reachability calls every subcommand a writer, because
> `status` reaches `Vault`, which contains `writeFileSync`. So every granted
> subcommand is *run* against a real initialised scratch vault with the tree hashed
> on either side. "The tree" is the node files plus `ost.config.yaml` and
> deliberately not `.ost-agent/`, because `init` always appends a usage event there
> — W2 and W3 need it to — and a whole-directory snapshot would classify the one
> subcommand the criterion accepts as a writer. It fails closed twice: a granted
> subcommand with **no probe recipe** fails, and a probe **exiting non-zero** fails
> rather than being recorded as "wrote nothing". The second guard is not
> hypothetical — it is exactly how `set-outcome` would have escaped.
>
> **Which is the finding.** `/ost-setup`'s step 3 was the only path that reached
> `set-outcome`, and it fires on `reason: "no-outcome"` — a vault whose config is
> present and whose root node is absent. `setOutcome` opens by looking for an
> Outcome node and throws `no Outcome node found — run ost-agent init first`. **The
> remedy and the state were mutually exclusive**: the granted command could not
> succeed in the only state it was granted for. Dropping the grant removed a live
> tree-write and cost a code path that had never worked. Step 3 now restores the
> root through `init` from the mandate already recorded in the config, reads it
> back, and tells the human to run `set-outcome` themselves if they want to change
> it.
>
> *The separator between `init` and `set-outcome` is mechanical, not a judgement
> about mandates, and it is worth stating because the obvious argument is wrong.*
> On the `no-vault` branch the **model** composes the `--outcome` string and nothing
> checks the words came from a human, so dropping `set-outcome` narrows what the
> model can **retune**, not what it can **originate**. What actually separates them
> is that in every state a granted `init` can reach it cannot put model-chosen text
> into an *existing* tree — on a healthy vault it is a no-op, and on `no-outcome` it
> restores from the config and discards the argv — and `set-outcome` can.
>
> **This is also the objection F5 rests on**, and it narrows it rather than closing
> it: the Outcome is no longer writable from a shipped command's Bash grant, but
> `ost_append_to_node` has no layer guard and appends to a live Outcome body today,
> so the Outcome is still not a place to put an acceptance condition.

**W7 — There is one report channel, and the other refuses.**
> *Check:* configure `product.repos: [<vault>]`, ingest a note, then call
> `ost_read_repo({path: '.ost-agent/evidence/…'})`. **Pass =** refused (or
> `.ost-agent` is in `SKIP_DIRS`). Separately assert the designated channel can
> retrieve a full body by evidence id.
> *Today:* **met** (2026-07-30), in both directions.
>
> **The refusal.** `readProductRepo` refuses any path with a `.ost-agent`
> component, checked on the requested path *before the filesystem is touched* — so
> it cannot be used to probe which evidence records exist, because the sentence is
> identical for a file that is there and one that is not — and again on the
> realpath, so a symlink inside a configured root pointing at the sidecar is
> refused rather than followed. Configuring the sidecar itself as `product.repos`
> is refused by the same check. `.ost-agent` is also in `SKIP_DIRS`, but that is
> bookkeeping and **not** the guard: `SKIP_DIRS` only filters `readdir`, and the
> read that mattered never consulted it.
>
> **The retrieval, which is what makes this a fix rather than a restriction.**
> `ost_next_work` takes an optional `evidence: "<id>"` and returns that one record
> in full — framed, capped, with the hidden characters named — reachable only by an
> id the sweep already handed out. The sweep keeps its excerpt and now names
> `bodyChars` per item and says where the rest is. That is Z2's rule applied to a
> string instead of a list, which is exactly the reconciliation this entry asked
> for.
>
> *A mode rather than a new tool, and the reason is a real constraint rather than
> convenience:* a second tool needs a name on `ALLOWED_TOOL_NAMES`, on
> `MCP_TOOL_NAMES` and its `READ_ONLY` set, in `OST_RULESET.skillTools` with a
> regenerated `SKILL.md`, and in the command allowlists — and until all of them
> land it ships as a tool that refuses. `ost_next_work` already owns *what is in the
> evidence store*; `evidence` says *which record*, exactly as `ost_read_repo`'s
> `path` does. D2's and D3's checks were verified to hold either way.

**W8 — Re-delivering the same report twice produces exactly one evidence record.**
> *Check:* drop the same filename twice; drop it, delete the cursor, drop again.
> *Today:* **met.** Two independent guards — the cursor
> (`src/adapters/source.ts:48-63`) and `writeEvidence`'s `existsSync`
> (`src/processes/tree.ts:33`) — covered by `test/mcp/ingest-inbox.test.ts`.

**⛔ W9 — No delivered report is ever accepted and then silently dropped.**
> *Check:* drop two files colliding under `safeName` (`note.md`, `note.txt`);
> assert `readEvidence(dir).length === 2`.
> *Today:* **met** (2026-07-30), pinned by `test/mcp/inbox-durability.test.ts:79-95`.
> The filename is now a hint and the frontmatter `id` is the key: `evidenceFile`
> (`src/processes/tree.ts:69-73`) keeps the plain `safeName` path when the file there
> is absent or already carries this id, and moves to a name suffixed with a digest of
> the whole id when some other record owns it. Keeping the uncollided case
> byte-identical is what lets W8's second guard — the `existsSync` that survives a
> deleted cursor — keep recognising records written before this change, and a test
> asserts that the digest path is reached only on a real collision.
>
> **Two smaller things came out of building it.** The first is that `writeEvidence`'s
> `false` had been carrying two meanings — "already stored" and "not stored, and I am
> not going to tell you" — and only the first is safe to key a cursor on. Its return
> is now a stated contract of exactly three answers, with the residual case (a digest
> path owned by a third id) throwing rather than returning `false`, which hands it to
> W10's machinery instead of dropping it. The second is that this criterion and W10
> are one defect seen from two sides: a silent `false` is precisely what let the
> cursor advance past an unstored item, which is why W10's check has to forbid stubbing
> `false` to reproduce it.

**⛔ W10 — An unstored item leaves the cursor un-advanced, so a producer can
retry.**
> *Check:* stub `writeEvidence` to **throw** on the second of three inbox items;
> assert the saved cursor contains only the first item's id and that a second
> `ost_ingest_inbox` re-offers items two and three. (Do *not* stub it to return
> `false` — that is the ordinary already-stored path W8 depends on, and forcing it
> would re-capture every stored note.)
> *Today:* **met** (2026-07-30), pinned by `test/mcp/inbox-durability.test.ts:124-157`.
> The ingest loop stores one item at a time and keeps the list of items that actually
> reached disk; on a failure it stops there and saves a cursor covering that prefix,
> then returns a `STOPPED at "…"` report naming the item, the cause, and the fact that
> calling the tool again re-offers it (`src/security/tools.ts:651-683`).
>
> **The cursor is opaque to the framework by design, so the framework cannot narrow one
> — the adapter has to.** `Source` now requires `advanceCursor(previous, stored)`
> (`src/adapters/source.ts:78-95`), and *returning `previous` unchanged is a correct
> implementation*: a high-water mark cannot name a subset of its own batch, so Slack,
> Atlassian and the usage rollup return it and re-fetch, while the inbox — whose cursor
> is a set of ids — narrows exactly. The transcript source is the interesting one: its
> seen-set is deliberately **wider** than the items it emits, because a harvested
> session with no friction is marked seen and never becomes an item, so rebuilding from
> `stored` would re-harvest those sessions forever. The method is required rather than
> optional so a new adapter has to answer the question in the file where its cursor
> scheme is written, and the safe answer is always available.
>
> **The failure is reported, not thrown.** A throw skips the dispatcher's `git add -A`
> commit (`src/mcp/server.ts:206-208`), which would leave the records that *did* store
> sitting untracked in the working tree — trading a lost report for an unattributed
> file, which is D5's failure mode. The returned text is where the alarm lives.

**W11 — An evidence record names who produced it, stamped by the surface.**
> *Check:* (a) `EvidenceRecord` (`src/processes/tree.ts:12-25`) declares an
> `actor` field. (b) Drop an inbox file whose own frontmatter says
> `actor: sponsor`; assert the stored record's actor is `inbox` — stamped by
> `InboxSource`, not read from the payload.
> *Today:* **met** (2026-07-30). The record carries `actor`
> (`src/processes/tree.ts:24`) from a closed vocabulary
> (`src/adapters/source.ts:27`), and the shape is what makes it a stamp rather
> than a field: `EvidenceItem` deliberately has none, `writeEvidence` takes it as a
> third argument (`:67`), and it comes off the `Source` that did the fetching
> (`src/security/tools.ts:655`). An adapter that forgets does not compile, and an
> adapter that invents a producer name does not either. The read fails closed —
> a record written before the stamp, or one hand-edited outside the vocabulary,
> reads `unknown` rather than what it claims (`src/processes/tree.ts:123`), and
> never `inbox` by inference from an `INBOX:` id, which is the string the producer
> chooses. `test/processes/evidence-actor.test.ts` holds all of it.
>
> **Checking (b) found the payload already writing the record's frontmatter, which
> is the half of this criterion worth the entry.** `matter.stringify` PARSES a
> string body before writing and merges the frontmatter it finds *under* the
> fields passed to it — `matter.stringify(str, data)` runs `matter(str)` first — so
> a note opening with
> `---\nactor: sponsor\nrung: money\n---` had both keys hoisted onto the stored
> record verbatim — and its own frontmatter stripped out of the body it wrote
> *(verified against a scratch vault before the fix: the record came back
> `actor: sponsor, rung: money` with the body reduced to one line)*. Keys the write
> already set were overridden, so the hole was invisible for exactly as long as no
> reader consulted a field the write did not set. Adding `actor` without closing it
> would have shipped a stamp the builder sets, and `rung` is not hypothetical: B3
> refuses a rung the provenance has not earned, and this was the untrusted builder
> pre-loading the answer. The body now goes in as `{ content }`, and the record's
> field set is asserted exactly rather than by absence.
>
> `inbox` covers the agent's own friction filings too, since they land in that
> folder as ordinary files. That is the honest answer rather than a lost
> distinction — the folder is writable by anyone who can write the vault, so a
> finer-grained claim would be read off a name the producer picked. Distinguishing
> *within* a channel is S1's problem (relocate the path) and B6's (a ledger keyed
> on the actor), not something a stamp can do from inside the vault.
>
> One reader consumes it today — `ost_next_work` reports the actor alongside each
> unmapped record (`src/mcp/next-work.ts:31`), pinned end-to-end through the live
> MCP surface in `test/mcp/ingest-inbox.test.ts`. That is deliberate: **B12 names
> "an `actor` field no reader consumes" as this criterion's way of passing while
> the chain stays broken.** It was not the whole join when this closed, and it is
> now: B5 and B6 made the stamped actor the key of the trust ledger, so the ceiling
> a node's provenance is held to is derived from the identity this criterion
> records rather than from the id string. B12 — the end-to-end assertion that the
> identity stamped here is the one the ceiling comes from and the write boundary
> enforces — closed on 2026-07-30.

**W12 — "Mapped" has one writer and one reader, and a citation must resolve.**
> *Check:* (a) `grep -rn 'setMapped\|getMapped' src/` shows a writer with a
> caller, or `mapped.json` leaves the read path. (b) `ost_create_node({…, source:
> "INBOX:does-not-exist.md"})` is refused, or `computeNextWork` reports the
> citation as unresolvable.
> *Today:* **met** (2026-07-30), on both halves, pinned by
> `test/mcp/w12-citation-resolution.test.ts`.
>
> **(a) The dead half was deleted rather than given a caller.** `getMapped`,
> `setMapped` and `mapped.json` are gone. The reader with no writer was not merely
> dead code: it was a *second* answer to "has this been read?", settable only by an
> actor outside the tool surface — which is a way to retire a builder's report from
> the work list with nobody having read it. One writer is `ost_create_node`'s
> `source`, landing in node frontmatter; one reader is the `citedSources`
> derivation in `computeNextWork`. Pinned both ways: a source scan, and
> behaviourally — a hand-planted `mapped.json` does not clear the list, citing the
> id does.
>
> **(b) A citation that claims a stored record must name one.** The criterion's
> second branch: `computeNextWork` reports a dangling citation as a hygiene issue
> (`unresolved-citation`) naming the node and quoting the id. The rule is
> deliberately narrower than "the source must resolve" — only prefixes an adapter
> actually **mints** as an evidence id are held to it, so `WEB:` and a citation to
> a page the agent genuinely read are left alone. A node citing a page is making a
> true statement; it is not claiming a file exists.
>
> One detail decides whether this is a detector or a sieve: the predicate matches
> the *claim* case-insensitively while resolution stays byte-exact, so
> `inbox:note.md` against a stored `INBOX:note.md` becomes a loud report instead of
> the silent stranding this criterion is about.
>
> *On the wedge hazard, which is R2's lesson applied before the fact:* the issue
> goes through `detectHygiene`'s ordinary path, so `ost_annotate` clears it — a
> tool `/ost-pass` already grants. And annotation clears the **issue** without
> clearing the **mapping**: the uncited evidence stays outstanding, so the escape
> hatch is not an amnesty.
>
> *Two limits left open, both stated in the test file.* A node may legitimately cite
> a ticket read in a browser and never ingested; this reports it, judged correct
> because the tree is then claiming a provenance nobody can go read, and the clear
> path makes that a written record rather than a silent one. And the refusal at the
> **write** boundary is still missing — the predicate is exported for it — so this
> is the reporting branch of the criterion's own "or", not the refusing one.

**W13 — No evidence record reaches disk with a credential still in it.**
> *Check:* drop an inbox note containing `sk-ant-api03-…`, ingest it, and assert
> the bytes of `.ost-agent/evidence/*.md` do not contain the key — in the body and
> in the title, since the title is derived from a filename the producer chooses.
> *Today:* **met** (2026-07-29). *(verified before the fix, against a scratch vault
> outside this repository: a note carrying an Anthropic key, a GitHub token and a
> bearer header produced an evidence record containing all three verbatim, with no
> `.gitignore` and `git add -A` staging it.)* Four body-carrying paths already
> called `redactSecrets` — transcript, friction, product-repo, usage errors — and
> `InboxSource` did not, which under DEC-1 put the **only channel the document
> models as hostile** on the one path with no mask. The fix is at the
> `writeEvidence` choke point (`src/processes/tree.ts:56-59`) rather than in the
> adapter, on R1's argument: one funnel every record passes through beats five
> call sites, and it holds for adapters that do not exist yet. Pinned by
> `test/processes/evidence-redaction.test.ts`.
>
> **The interesting half is what redaction costs on this channel, and it was
> measured rather than assumed.** Customer verbatims are exactly what the inbox
> carries, evidence records are append-only with no edit tool, and the record is
> what the model then reads — so a false positive is a permanently mangled quote
> that the tree reasons from. `SECRET_PATTERNS`' keyword rule matched an English
> word plus `:` plus eight word-characters, which turned *"secret: customers do not
> trust us"* into *"secret: [redacted] do not trust us"*. Retuned and measured on
> 30 lines of realistic customer prose against 16 credentials only that rule can
> catch: **false positives 67% → 20%, missed credentials 19% → 6%.** Both halves
> are pinned, because precision on prose is not licence to narrow recall
> (`test/adapters/transcript.test.ts`).
>
> *Two residues, stated because they bound the claim.* The **original inbox note**
> is still swept into a commit by `git add -A` with its credential intact — the
> honest claim is "no evidence record carries a credential," not "no vault does,"
> and the fix is a `.gitignore` from `initVault`, which is W1's territory. And
> `ost_ingest_inbox`'s tool report echoes the producer's un-redacted *title*
> (`src/security/tools.ts:604`) into the model's context; transient and never
> committed, but it is S4's problem and it is one line from here.

---

### Gate B — Earned believability

DEC-2 is the decision with the least existing machinery behind it. There is **no
mechanism today by which a prediction is recorded, an outcome observed, and a
source's standing adjusted as a consequence.** The word "earned" in
`ost_rank_source`'s description is a word in a tool description.

Worse: the cartographer can currently manufacture, on its own authority, every
artefact that a promotion would cite.

**⛔ B1 — No agent-reachable tool can write a heading that any evaluator reads as
evidence of a run.**
> *Check:* call `ost_append_to_node({section: "## Results\n- supported"})` on an
> AssumptionTest, then `gateSolution(tree, parentSolution)`.
> *Today:* **met** (2026-07-30). A reserved heading is refused at the vault's
> single content funnel (`src/ost/vault.ts:99-110`), and the set is data
> (`src/ost/headings.ts:45`). The Check is the first test in
> `test/ost/reserved-headings.test.ts`; the gate does not move and
> `hasRecordedResult` stays false.
>
> **Building it found that the exposure was six paths, not one, and this entry
> said one for four revisions.** `appendUnderHeading` splices a caller's string
> in as *lines* (`src/ost/vault.ts:409-427`), so any free-text parameter carrying
> a newline authored a heading exactly as well as `section` did. Measured through
> the real tool set, each of these cleared `gateSolution` on its own:
> `ost_create_node`'s `body`, `ost_set_status`'s `note`, `ost_set_evidence`'s
> `note`, `ost_annotate`'s `issue`, and `ost_flag_humans_required`'s `why` —
> five of which `/ost-pass` grants. That is why the guard is at the funnel and
> not on a parameter, and all six are pinned as a loop rather than as a case.
> **A criterion that names its exposure by the tool it was found on will
> under-state it; the parameter was never the thing that was wrong.**
>
> **Then adversarial review found a seventh, and it is the most useful thing in
> this entry.** `tags` is not free text, so it was never enumerated as a writable
> parameter — but `serialize` renders every tag onto one shared line, and
> `deserialize` reads only the first line back. A tag carrying a newline was
> therefore arbitrary body content: one allowlisted `ost_create_node` call wrote a
> `## Results` block, cleared `gateSolution`, zeroed the coverage debt, and left
> `checkInvariants` empty — **and it stranded the `#unvalidated` stamp below the
> break, where the next read loses it, defeating B2's marker in the same call.**
> Three of four review lenses found it independently; not one of the tests written
> for these criteria did, because **a list cannot fail for the door it does not
> name.** The guard now covers tags (`src/ost/vault.ts:142-155`), and whitespace
> in a tag is refused outright — a tag is one `#word`, and a space-bearing one
> already split in two on the round trip.
>
> *So the pin is a property, not a seventh entry on the list.* For every
> string-valued argument every mutating tool declares — read off the tool's own
> `input_schema`, array items included — the attack is attempted and the tree is
> then asserted to hold no recorded result, no silenced coverage debt, and no
> node that lost its marker. An eighth writable argument is covered on the day it
> lands. **That test was itself vacuous when first written** — it reused one
> title, so every `ost_create_node` attempt failed on "node already exists" rather
> than on the guard — and it was caught by deleting the guard and watching the
> test stay green. The lesson costs nothing to restate: *neuter the mechanism and
> confirm the pin goes red, or the pin is decoration.*
>
> *What makes the human's path survive its own guard:* `appendUnderSection` takes
> the heading as its **own argument** and runs the content guard on the line only
> (`src/ost/vault.ts:288-293`), and `recordResult` writes from that position
> (`src/ost/results.ts:78`). So the exclusivity is a property of the **writer**,
> not of the string — the `ost_flag_humans_required` shape transposed from a
> parameter onto a value. No string-valued argument on any tool reaches the
> heading position, and that sentence is now the assertion a test makes rather
> than a claim this entry states.
>
> *A second finding, and it is the reason the guard could have been a sieve:*
> **the two readers of `## Results` did not agree about what one is.**
> `hasRecordedResult` used a case-insensitive regex and read `## Results of the
> pilot`; `countEntriesUnder` used trim-equality and read `  ## Results`. Each
> was blind to the other's spelling, so a guard matching either one alone would
> have left the other's open. **There was a fourth matcher and review caught that
> too:** `appendUnderHeading`, the WRITER, was still on trim-equality, so once the
> readers honoured `## Results of the pilot` the writer could not find it and
> appended a second section — after which `countEntriesUnder`, which stops at the
> first, counted half the results. All four now match through
> `isHeadingLine` (`src/ost/headings.ts:73-75`), and both directions are pinned —
> six spellings refused, five near-misses (`### Results`, `##Results`,
> `## Resultsish`) still writable, because a guard on the word rather than the
> heading is a different and worse product.
>
> *Way out:* a human records one — `ost-agent result "<test>" -v … -b … -u …`,
> CLI-only and on no allowlist (`src/ost/results.ts:1-13`). The refusal names
> that command, and is pinned NOT to say "record one", which is what
> `UnearnedRung.missing` says to its own reader and would, here, be advice to
> forge. Ordinary prose under any other heading is untouched.

**⛔ B2 — An agent cannot move a node to `validated`, and `ost_check` catches it
if one appears.**
> *Check:* `ost_create_node` with `tags: []`, then
> `ost_set_status({status:"validated"})`, then `checkInvariants`.
> *Today:* **met** (2026-07-30), both halves, in
> `test/security/self-validation.test.ts`. `validated` is gone from the status
> enum on **both** tools that carried it (`src/security/tools.ts:58`), so the
> value is refused by the schema before `run` — it has no argument position
> rather than a validator behind one. The marker is stamped server-side
> regardless of what the caller asked (`src/security/tools.ts:288-294`), the same
> move the evidence refusal two lines above already made, so the rule's
> precondition is no longer the constrained actor's to withhold. And the detector
> still fires on a node that arrives from outside the surface, turning `done`
> false rather than only reddening `check`.
>
> **The criterion's own Check names one door and there were two.**
> `ost_create_node` takes `status` in the same call, so "born validated" was a
> single call that left the criterion's sentence — *an agent cannot **move** a
> node to validated* — technically true and its intent defeated. Closing only
> `ost_set_status` would have been a met criterion and an open hole. Pinned
> separately as "the second door".
>
> *Why this is a status and not a heading:* `hasRecordedResult` returns true for
> `status === "validated"` (`src/eval/evidence-debt.ts:47`), so this was B1's
> forgery needing no heading at all. B1 and B2 are one exposure with two doors,
> and closing either alone leaves the predicate writable.
>
> *Way out, and it did not exist before this change:* **no human path could
> promote an existing node.** `ost-agent init` writes `validated` once, on the
> human-set Outcome, and nothing moved a node there afterwards: `ost-agent result`
> never touches `status`, no other CLI command set one, and the shipped instruction for promotion
> (`.claude/commands/ost-review.md`) told the *agent* to do it on the human's
> say-so — which is the discipline this criterion says must become mechanism.
> Refusing the agent without building the human's path would have been R2 with a
> text editor as the only remedy. `ost-agent promote "<title>" --by --why`
> (`src/cli/index.ts:144-157` → `src/ost/results.ts:96-127`) is that path: it
> drops the marker *and* sets the status, because promoting without dropping it
> would manufacture the contradiction it exists to resolve. It carries
> `recordResult`'s attribution rules for the same reason, and it is idempotent,
> which is how a vault written before this change gets repaired. It is
> deliberately **not** gated on a recorded result — that predicate is the thing
> this path protects, and gating the human on it would be circular.

**⛔ B3 — A declared rung is refused when it exceeds the ceiling derivable from
the node's provenance.**
> *Check:* `ost_set_evidence({title: <node with source 'INBOX:note.md'>,
> evidence: 'money'})` is refused, naming the derived ceiling; and the same call
> on a node with no source at all is refused to the floor.
> *Today:* **met** (2026-07-30), at the scope stated below, pinned in
> `test/security/rung-ceiling.test.ts`. B8's ceiling is now *asked* at the write
> boundary instead of only reported afterwards: `unearnedRung`
> (`src/eval/rungs.ts:88-125`) was split out of the detector's loop so both
> callers compute one rule, and `ost_set_evidence` evaluates the node **as it
> will be** rather than as it sits — evaluating the stored rung would only ever
> re-refuse nodes that are already red. `ost_create_node` carries the same guard,
> because it takes a rung *and* a source in one call and is granted on both
> surfaces; a refusal on one boundary while the other stayed open would have been
> a fake fix.
>
> **The scope is B8's — the two measurement rungs — and the criterion's second
> row, read strictly, is a wedge.** *"Every rung above the floor requires a
> source"* refuses a write while naming a remedy the agent cannot perform: **no
> allowlisted tool can add a `source` to an existing node** (`source` is an
> `ost_create_node` parameter and there is no `ost_set_source`). Recorded as
> considered and rejected rather than silently narrowed; its prerequisite is a
> source-setting write path, which is its own criterion. The row that ships is
> the readable one — a *measurement* rung on a sourceless node is refused, and
> the ceiling named is the floor — and it satisfies the Check as written.
>
> *The refusal is a second rendering, not a second rule.* `UnearnedRung.missing`
> tells its reader to *"record one (a `## Results` section …)"*, which is right
> for a human reading `ost_check` and would, at the write boundary, be advice to
> the one actor forbidden to record results — naming the path B1 just closed.
> `rungRefusal` (`src/eval/rungs.ts:135-148`) is the same verdict addressed to
> the caller being refused. One module owns the ceiling and both of its
> renderings; the negative is pinned.
>
> **Unlike B4 and B8 when they landed, this one is not standing on a forgeable
> predicate.** Both routes by which the agent could manufacture what the ceiling
> reads — the `## Results` heading and `status: validated` — closed in this same
> change (B1, B2). What remains outside it is a human with a text editor, which
> is the actor the gate defers to.
>
> **What it does not close, stated rather than left for a reader to find.** The
> `money` half needs a result, and a result is now unforgeable. The `observed`
> half also accepts provenance that *is* a recording — and the only string that
> qualifies is one matching `TRANSCRIPT:`, which the agent types into
> `ost_create_node`'s `source` as free text. **So `observed` is refused exactly
> when the agent declines to assert a transcript, and self-conferrable when it
> does.** That is not a hole this criterion opened — nothing anywhere verifies a
> source string — but B7's ceiling is only as good as the provenance under it, and
> that is **B6**'s subject: a ledger keyed on an actor, with a rung ceiling per
> actor kind, so a claimed channel has to have earned its standing. B3 refuses the
> label that outruns its evidence; B6 is what makes the evidence mean something.
>
> *Way out:* demotion, never gated, agent-reachable, no human needed — pinned as
> clearing the violation. Above that: provenance that is itself a recording, or a
> human recording a result. Every node already on disk is untouched; the guard is
> prospective and `rung-unearned` stays a detector for the rest.

**B4 — A promotion names a corroborating result that exists and has an outcome.**
> *Check:* four rows against a vault, each of which must be refused —
> `ost_rank_source({kind:'web', id:'example.com', direction:'corroborated',
> reason:'corroborated by [[No Such Test]]'})`; the same with `reason:'looks solid'`
> (names no node); the same with `reason:'corroborated by [[Real Test]]'` where Real
> Test exists but carries no `## Results`; and the same where Real Test carries one
> but was never a test *of this source*. (All four keys are required and
> `additionalProperties: false`, `src/security/tools.ts:966-993` — omitting one
> throws for the wrong reason and proves nothing.)
> *Today:* **met** (2026-07-29; the fourth row added 2026-07-30 with B5).
> `checkCorroboration` (`src/eval/corroboration.ts:73-108`) requires the reason to
> RESOLVE — it names nodes as `[[wikilinks]]`, at least one is on the tree, and that
> one satisfies `hasRecordedResult` — and `ost_rank_source` calls it before touching
> the ledger (`src/security/tools.ts:1031-1036`), so a refused corroboration writes
> nothing. All four rows are pinned through the tool rather than against the
> function, in `test/security/rank-source-corroboration.test.ts:90-118`; the
> no-write-on-refusal row is at `:119-123`.
>
> **The fourth row is the one that closed the replay, and it did not exist when this
> criterion first read met.** Naming *any* already-supported test satisfied the
> first three, so the agent could hitch a source it chose onto a result somebody
> else's test produced. The join `joinedTests`
> (`src/knowledge/actor-trust.ts:337`) requires the cited test to sit one level from
> a node whose own `source` resolves to this actor — the same one-level relation
> `gateSolution` and `unearnedRung` already mean by "a result for a node", reused so
> a grandchild's result cannot launder standing two layers up.
>
> Three scope limits, each recorded because each is a place this could have
> become a wedge instead of a guard:
> - **Only promotions are held to it** (`src/eval/corroboration.ts:77`). Withdrawal
>   stays free — `direction: 'contradicted'`, no citation, one call — and is pinned
>   as such (`test/security/rank-source-corroboration.test.ts:156-172`). A guard
>   that demanded paperwork before the agent
>   could stop trusting a bad host would point at the safe direction; B11's failure
>   mode is the expensive one.
> - **"Has an outcome" is `hasRecordedResult`, reused rather than restated**
>   (`src/eval/corroboration.ts:91`). That predicate was forgeable when this
>   criterion closed, which was **B1's** business and not this one's: B4 closed
>   the path where a promotion cites *nothing at all*, and said it would tighten
>   automatically when B1 landed. **B1 landed on 2026-07-30 and it did**, without
>   a line changing here — reuse rather than restatement is what collected that.
>   The residue is now the same one every criterion in this gate has: a human
>   with a text editor.
> - **A rung is no longer namable here at all**, which retired this bullet's original
>   worry rather than answering it. The tool takes a `direction`, not a rung, so
>   there is no `money` promotion to refuse for the wrong reason. What survives is
>   the membership test `checkCorroboration` uses to decide whether a change is a
>   raise (`isHostRung`, `src/knowledge/web-trust.ts:41-43`), passed the guard's own
>   word for one; the guard's refusal text is then re-addressed to the actor being
>   raised rather than to a rung nobody named (`src/security/tools.ts:1036`).
>   **An id the namespace refuses complains about the namespace, not about
>   corroboration** — the wrong *thing* named before the wrong *permission* — and
>   that ordering is a committed row
>   (`test/security/rank-source-corroboration.test.ts:173-191`).
>
> The check shape it followed already existed twice: `ost_create_node` resolves a
> parent through `vault.has()` and refuses a wrong-layer one
> (`src/security/tools.ts:242-249`); `gateSolution` resolves a title through
> `titlesMatch` and reads its result state (`src/eval/evidence-debt.ts:85-92`).

**B5 — A source's rung is a *function* of its recorded track record, not an
independently settable field.**
> *Check:* (a) no variant of the ledger's record type declares a `rung`, asserted
> against the type rather than grepped. (b) every function in `src/` that hands
> back a rung folds a whole history to get it — equivalently, `grep -rn 'hostRung\|
> readHostTrust\|rankHost' src/` is empty.
> *Today:* **met** (2026-07-30), both halves, pinned by
> `test/knowledge/trust-derivation.test.ts:48-128`. The live ledger is
> `src/knowledge/actor-trust.ts`, and the two properties are carried by types
> rather than by review: `TrustObservation` (`:372-397`) has four variants —
> `corroboration`, `strike`, `reset`, `migration` — and **none of them has a rung
> field**, so a record that asserts standing is unrepresentable; and
> `readTrustLedger` (`:494`) returns *histories* rather than a last-record-wins map,
> so there is no stored current value for a consumer to read. `explainRung`
> (`:587`) is the only thing in the repo that turns a history into a rung.
>
> **The scoring rule, because "computed" is not the same as "computed sensibly".**
> Any strike or any refuted verdict sends an actor to the floor, immediately and
> absolutely; otherwise standing rises by **distinct supporting tests** — the kind's
> starting rung, one rung above at the first, the kind's ceiling at
> `CORROBORATIONS_FOR_CEILING` (`:530`, three). *Distinct tests, never a ratio*, and
> that is B11's sentence turned into arithmetic: under a ratio, a channel that
> delivers plausible wrong content on cadence has a numerator. Fifty nodes citing
> one host under one test are worth one observation. `inconclusive` scores nothing
> in either direction, because punishing the honest third answer pushes whoever
> records a result toward a verdict they do not have. No decay and no
> time-weighting, so "why is this host at expert?" is answerable without a clock.
>
> **The asymmetry is the safety argument, and it is why this closed without a new
> forgeable predicate.** The agent can append only records that LOWER standing —
> `direction: 'contradicted'`, ungated, one call, no citation. Credit is minted only
> where the verdict is read off a test a human recorded under `## Results`, which B1
> made unauthorable; the caller never supplies the verdict, `recordedVerdict`
> (`:317`) reads it. So falling is one tool call and rising back from a strike takes
> a human (`ost-agent trust reset`). **Naming a refuted test therefore lowers the
> source that cited it** — the one behaviour that makes this a track record rather
> than an applause meter.
>
> *The old store is not deleted, and that is deliberate.* `web-trust.ts` is now a
> hundred-line read-only shim (`src/knowledge/web-trust.ts:1-25`) whose only live
> caller is `migrateLegacyHostTrust` (`src/knowledge/actor-trust.ts:767`). It reads
> `hosts.jsonl` in **file order** rather than last-record-wins, because the old fold
> collapsed the one distinction the migration needs: a host sitting at `assertion`
> having never been promoted is nothing to migrate, and one that was demoted there
> is a strike. The file is never rewritten or deleted, so a vault rolled back to an
> earlier version still finds its trust history where it left it.

**B6 — The trust ledger is keyed on an actor, with a rung ceiling per actor
kind.**
> *Check:* (a) `rankHost({host:'stripe-webhook-feed', rung:'expert'})`'s successor
> call is refused — a bare pipeline name cannot take a row in the publisher
> namespace. (b) a first-party commissioned instrument can hold `observed` and a web
> publisher cannot, no matter how much corroboration it accumulates.
> *Today:* **met** (2026-07-30), pinned by `test/security/actor-namespace.test.ts`.
> An actor is an `ActorKey` — a `{kind, id}` pair (`src/knowledge/actor-trust.ts:72`)
> whose `kind` comes from a closed union (`:64`) and whose `id` is normalized *per
> kind* by a constructor that refuses rather than coerces (`actorKey`, `:196`). The
> `web` namespace admits only something shaped like a hostname (`:150`), so
> `stripe-webhook-feed` — the trap this criterion was filed on — has nowhere to land
> in it. Ceilings are a table (`TRUST_CEILINGS`, `:110`): `expert` for a publisher,
> `stated` for a delivery channel or the sponsor, `observed` for a first-party
> instrument. A byline can never confer a measurement rung and an instrument is not
> capped at one; both halves of the old collision are unrepresentable.
>
> **`ost_rank_source` no longer takes a rung, and that is the shape of the fix
> rather than a side effect.** The tool takes `{kind, id, direction, reason}`
> (`src/security/tools.ts:964-993`) and the namespace refusal comes from the
> constructor first, before the permission check — the wrong *thing* named is
> reported before the wrong *permission*, so a bad id complains about the namespace
> rather than about what the surface may write.
>
> *What it costs, stated:* a starting rung is per kind too (`TRUST_INITIAL`, `:119`),
> and an instrument starts at `observed` rather than at the floor. A commissioned
> first-party measuring device that has recorded nothing is trusted as a measuring
> device. That is the claim the operator makes by declaring it an instrument at all,
> and it is the one place in this gate where standing is granted rather than earned.

**B7 — `classifyProvenance` has a production caller.**
> *Check:* `grep -rn 'classifyProvenance' src/ --include=*.ts | grep -v
> '^src/knowledge/believability.ts:'` is non-empty.
> *Today:* **met** (2026-07-29) — **and the caller is on the read side, which is
> less than the entry above once implied.** B8's detector calls it to derive a
> node's source ceiling (`src/eval/rungs.ts:81`), reached from `checkInvariants`,
> and the derivation is pinned by behavior rather than by the grep: `TRANSCRIPT:`
> backs a node's `observed` claim, `JIRA:` does not
> (`test/eval/rungs.test.ts:66-81`). What that buys is a node whose label outruns
> its provenance being *reported*. What it did not buy was the label being
> *refused* when written, which was **B3** — and B3 closed on 2026-07-30 by
> calling the very function this criterion is about, from
> `ost_set_evidence` and `ost_create_node`. The caller is now on both sides. Under
> DEC-1 the inbox is precisely where an unverified builder's self-description
> arrives, and the gap between reported and refused is closed for the two
> measurement rungs; the three below them are still reported only, which is B3's
> stated scope and not a silent narrowing of this one.
>
> **The check as written is a grep, and a grep is a proxy.** It came out true the
> moment a production module imported the function, which is exactly the kind of
> pass this document has been wrong by before — so the status rests on the two
> behavior assertions cited above, not on the import.

**B8 — `checkInvariants` reports a node whose declared rung exceeds what its
source and results support.**
> *Check:* run it on a Solution declaring `evidence: money` with no result of any
> kind.
> *Today:* **met** (2026-07-29). The check is that row verbatim, committed:
> `test/eval/rungs.test.ts:35-43`. `unearnedRungs` (`src/eval/rungs.ts:71-110`)
> raises `rung-unearned` through `checkInvariants`
> (`src/eval/invariants.ts:101-107`), and it is a blocking hygiene rule on both
> gates (`src/mcp/next-work.ts:120`), so a red here also turns `done` false rather
> than only reddening `check` — the R4 defect this document was built to stop
> re-introducing.
>
> **The rule was already written down twice, in prose, addressed to the model.**
> When this closed, `ost_rank_source`'s description and `web-trust.ts` both said
> `observed`/`money` "can only be earned by first-party measurement
> (AssumptionTests + `ost_set_evidence`), never by a byline" — in the two places
> where the model is the actor being constrained. Both are now *data* rather than
> prose: B5 and B6 turned the second into `TRUST_CEILINGS`
> (`src/knowledge/actor-trust.ts:110`), whose table says the same thing in a form the
> scorer reads, and the tool description that remains
> (`src/security/tools.ts:966`) describes that table instead of asking the model to
> honour it. This criterion computes it on the node side: a
> measurement rung has to point at a measurement, which is either a recorded
> result (the node's own `## Results`, or one on a node it links to) or provenance
> that *is* a recording (`classifyProvenance` → `observed`, i.e. `TRANSCRIPT:`).
> Results license both rungs; provenance licenses `observed` only, pinned at
> `test/eval/rungs.test.ts:70-75` — a source string can describe a measurement, it
> cannot put a price on one.
>
> Three scope limits, each a place this could have become a wedge:
> - **Only the two measurement rungs are policed** (`src/eval/rungs.ts:44`).
>   `stated` and `expert` also have to be earned, but their ceilings are B7's wire
>   and B6's actor namespace; a detector deriving all five today would fire on
>   every hand-authored node in every existing vault, and a rule that fires on
>   everything is a rule someone turns off. Pinned as *not* firing at
>   `test/eval/rungs.test.ts:83-87`.
> - **One level of links, not the transitive closure** (`src/eval/rungs.ts:79`).
>   That is the relation `gateSolution` already means by a result for a node, and
>   it stops a grandchild's result laundering a claim two layers up
>   (`test/eval/rungs.test.ts:55-64`).
> - **Demotion always clears it**, on both surfaces, needing no result at all.
>   The clearability row records the demotion rather than the second route out —
>   append a `## Results` section and the claim is backed — because that route was
>   **B1's** forgeable path. **B1 closed it on 2026-07-30**, so the sentence this
>   entry carried, *"it catches a rung nothing supports, not a rung supported by a
>   result the agent wrote for itself"*, no longer has a second clause: the agent
>   cannot write that result. B3 closed the same claim at the write boundary in
>   the same change, so an over-claimed rung is now refused as well as reported.

**B9 — A resolved Unknown's answer was checked against its own `## Format`.**
> *Check:* create an Unknown whose `## Format` reads "a dollar figure with a
> date" and whose `## Answer` reads "n/a"; assert
> `resolutionState(node, DEFAULT_RESOLUTION) === "open"`.
> *Today:* **met** (2026-07-30). The Check is the first test in the B9 block of
> `test/knowledge/unknowns.test.ts`. `ResolutionRule` gained two optional data
> fields — `requires` and `nonAnswers` — and the default policy's satisfied rule
> names both, so a resolution needs a declared `## Format` *and* an `## Answer`
> that is not a recorded absence.
>
> **What this does and does not claim, because the criterion's title outruns the
> mechanism and that is worth saying rather than hiding.** The Format is read for
> **existence, never for meaning**: a Format asking for "a dollar figure with a
> date" beside an Answer reading "sail west" is satisfied. What is checked is
> that a stopping condition was declared at all, and that the answer is not one
> of fourteen tokens recording an absence. That is a crude floor on
> `hasRecordedResult`'s own precedent — deliberately not a judge. **The two
> designs that would deliver the title literally were rejected in writing:** a
> machine-readable `## Format` is a node-contract change every existing vault
> fails, and a keyword table mapping Format prose to answer shapes is F5's "number
> nobody should trust" with the confidence stripped off.
>
> *The one implementation detail that is load-bearing:* the answer probe reads the
> **union** of every `## Answer` block, never the first. An append-only vault
> cannot rewrite a bad answer — it can only append a better one — so first-wins
> semantics would have made "n/a" an unclearable state, R2 exactly. That way out
> is a committed test.
>
> *Way out, three, all automatic:* append a second `## Answer`; append the missing
> `## Format`, which `ost_next_work` already reports as a gap before anyone asks;
> or a human's `validated`, which is never graded. And the blast radius is a
> report rather than a gate — `openUnknowns` is deliberately not a term of `done`,
> pinned as an assertion in `test/mcp/next-work.test.ts`, so reclassifying
> unknowns cannot wedge a pass under any circumstance.
>
> *What it does not close:* `ost_set_status` to `validated` was a granted,
> ungraded route to satisfied. B2 closed that in the same batch; B9 did not.

**B10 — The coverage-debt signal cannot be silenced by the actor that created
the debt.**
> *Check:* `ost_append_to_node({section:'## Uncovered\n- nothing much'})` on a
> test with an unbounded claim; re-run `computeCoverageDebt`.
> *Today:* **met** (2026-07-30) — **closed by B1's mechanism rather than by one
> of its own, which is why it cost one array entry.** `## Uncovered` is the
> second member of `RESERVED_HEADINGS` (`src/ost/headings.ts:45`), so the write
> is refused at the same funnel and the gap count does not move. The Check is
> committed verbatim in `test/ost/reserved-headings.test.ts`.
>
> The bar for reserving a heading is that a gate reads it as a measurement, and
> this one qualifies: `computeCoverageDebt` counts its entries against the result
> count, so an agent writing one silences the debt it just created. Nothing on
> any shipped surface ever instructed the agent to write it — the only writer is
> `recordResult`, which pairs one line here with each result, from the heading
> argument position. **A criterion met by a set already built for a neighbouring
> one is the ordering constraint paying out, the way H1/H3/H4 fell out of Gate F.**

**B11 — A source that loses standing causes everything downstream to be reported
as suspect.**
> *Check:* record a demotion for source S, then assert `ost_check` names every
> node whose `source` is S.
> *Today:* **met** (2026-07-30). The Check is committed as written — demote through
> the real tool, then read the report — in
> `test/eval/suspect-source.test.ts:156-292`, with the operator-facing half in
> `test/mcp/suspect-source-work.test.ts`. `withdrawnStanding`
> (`src/ost/census.ts:515`) reads a *transition* rather than a state: an actor that
> once stood above the floor and now stands at it, which is either a strike or a
> refuted verdict. `reconcileWithTrust` (`:595`) then names every node whose own
> `source` resolves to that actor, and the issue carries the source, both rungs and
> the withdrawal's own date, so the operator can see what changed and when.
>
> **The resolution of "reported as suspect" is the whole design decision here.** A
> withdrawn source does *not* raise a `checkInvariants` violation. It is a
> hygiene-only rule (`SUSPECT_SOURCE_RULE`, `src/ost/census.ts:430`, listed in
> `HYGIENE_ONLY_RULES`, `src/mcp/next-work.ts:223`), which turns `done` false
> without reddening `check`. The reason is R4's, inverted: a violation is a
> statement that the tree's *shape* is wrong, and nothing about this tree's shape is
> wrong — a source it rests on stopped being trustworthy, which is a report about
> the world. Making it an invariant would red a vault permanently for a fact the
> tree cannot fix, and `check` stricter than `done` is the defect this document was
> built to stop re-introducing; `done` stricter than `check` is the safe direction.
>
> *Way out, and there is exactly one the unattended sweep has:* annotate the node.
> That is deliberate — `/ost-pass` cannot rank a source, so annotation is its only
> exit, and it is the exit that leaves a dated line a human can read. A
> corroboration does **not** clear it: the agent cannot vote a struck source back
> up. A human's `ost-agent trust reset` clears it everywhere at once, writing
> nothing to any node. And a *second* withdrawal is reported again past the first
> one's annotation, so re-affirmed bad news is new information rather than
> already-suppressed news. All five are committed rows.
>
> *Non-vacuity, since a rule that names everything names nothing:* a node citing a
> source that kept its standing is not named, an `inconclusive` verdict withdraws
> nothing, and a vault with no ledger at all is unaffected.

**B12 — A report is ranked at the boundary it arrives on, and the rank is derived
from the channel rather than from anything the producer wrote.**
> *Check:* one end-to-end pass against a scratch vault, not four separate greps.
> Drop `note.md` into the inbox whose own frontmatter declares `source:
> TRANSCRIPT:session-1` and `evidence: money`; ingest it; create a node citing the
> stored record; call `ost_set_evidence({evidence:'money'})`. **Pass requires all
> four links to be wired to each other:** the stored record's actor reads `inbox`,
> stamped by the surface (W11); the rung derived for it is the floor, derived from
> the channel and not from the payload's self-description (B7); `ost_set_evidence`
> refuses above that ceiling and names it (B3); and the ceiling comes from a ledger
> keyed on the actor rather than on a hostname (B6).
> *Today:* **met** (2026-07-30), pinned by `test/mcp/b12-ingest-to-rank.test.ts` —
> **one `test()` running the whole pass, not four assertions about four modules**,
> because the reason this is a criterion rather than a summary of its neighbours is
> that each of W11, B7, B3 and B6 can pass in isolation while the chain stays
> broken. A conjunction of unit tests is precisely what lets that happen silently.
> The note that arrives lies about itself in the strongest way the format allows —
> its own frontmatter declares `source: TRANSCRIPT:session-1`, `evidence: money` and
> `actor: transcript` — and not one of those is believed.
>
> **Every link was mutation-tested, and the mutation and its failure text are
> recorded in the test's own header.** Stamping the payload's claimed actor instead
> of the surface's makes the derived key `instrument:transcript`, which *starts* at
> `observed`, so the note talks its way onto the measuring-device ceiling — RED.
> Deriving the ceiling from the id string instead of the stamped actor's history
> makes three recorded results invisible, so `stated` stays refused after the
> channel has earned it — RED. Deleting the ceiling check from `ost_set_evidence`
> writes `stated` onto a node whose channel has earned nothing — RED. Keying the row
> by stripping the prefix and handing the remainder to the `web` namespace — B6's
> original bug seen from this end — makes the corroborations recorded against
> `channel:inbox` invisible — RED. A link whose break leaves the test green is a
> link the test is not exercising, and none of these did.
>
> **The half-built place this entry used to describe is closed, and the fix is a
> key rather than a rule.** `classifyProvenance` was fail-closed everywhere except a
> single `INBOX:` pattern keyed on a *substring of the producer's own filename* —
> `/^INBOX:.*friction/i`, matched anywhere in an id that is `INBOX:${filename}`
> verbatim, so `my-notes-on-friction.md` dropped into channel zero classified as a
> first-person report. It is now keyed on the leading channel segment
> (`/^INBOX:friction\//i`, `src/knowledge/believability.ts:143`), which
> `channelIdPrefix` mints from the channel's own name. A filename cannot contain a
> slash, `friction` is a reserved channel name so config cannot mint a second one,
> and the friction folder is inside the vault where the builder does not write — so
> channel zero has no spelling that reaches the rule. Same rule, unforgeable key.
>
> *The cost is stated rather than hidden:* a filing made before the friction channel
> existed lives in channel zero as `INBOX:<date>-friction-<slug>.md` and now reads
> `assertion`. That is the honest answer, since such an id is byte-for-byte
> something the builder could have written, and it is a committed assertion in
> `test/adapters/friction-channel.test.ts` so the regression is a decision somebody
> made rather than a surprise somebody finds.

---

### Gate P — The sponsor, permission, and consequence

DEC-3 makes the sponsor a managed, fallible resource and admits real money and real
legal entities into the picture. The repo has two risk vocabularies — the lane
(who must be present) and the ladder (how strong the evidence is) — and **both
describe the input to a decision, never the consequence of acting on it.**

**⛔ P1 — Every action carries a declared reversibility class, from a closed
fail-closed vocabulary with a cautious default.**
> *Check:* `grep -rn 'export const REVERSIBILITY' src/` is non-empty, plus a unit
> assertion mirroring P4's shape:
> `reversibilityOf(undefined) === reversibilityOf("invented") === "irreversible"`.
> *Today:* **met** (2026-08-02). `src/knowledge/reversibility.ts` is the vocabulary,
> built the way `lanes.ts` says to: closed, three members (`reversible`, `costly`,
> `irreversible`), and `reversibilityOf` fails closed to `irreversible` on a missing
> or invented class — pinned verbatim by `test/knowledge/reversibility.test.ts`,
> the same check this entry names.
>
> **The second half is the one a standalone vocabulary does not buy on its own:**
> a fact nothing reads is a fact that rots, so `OstToolDef` (`src/security/tool.ts`)
> now resolves a `reversibility` field through `reversibilityOf` for every tool the
> `tool()` helper builds — never `undefined`, because a spec that forgets to declare
> one falls to the cautious class rather than reading as unclassified. Every one of
> the 20 tools `buildOstTools` constructs (`src/security/tools.ts`) declares its
> class explicitly: `git_push` — the one tool that leaves the vault, and the one P6
> already singled out as outward-mutating — is `costly`; everything else, git_commit
> included, is `reversible`, because every other tool's whole effect is an append to
> a git-tracked vault, a correction away from gone. `test/security/tool-reversibility.test.ts`
> pins both halves: every built tool's class is a real vocabulary member, `git_push`
> is the lone `costly` tool, and the `tool()` helper itself resolves an undeclared or
> invented class to `irreversible` rather than passing it through.
>
> **What this does not yet claim:** nothing in this repo *branches* on reversibility
> yet — no tool is refused or gated by its class. P1 asked for a declared class on
> every action, which is now true and fail-closed; consuming that declaration to
> change behaviour (the `costly`/`irreversible` classes demanding something a
> `reversible` action does not) is DEC-3 machinery this criterion does not build.

**⛔ P2 — An outstanding ask of the sponsor has an age, and an unanswered one is
surfaced.**
> *Check:* `ls .ost-agent/asks/` (or equivalent) exists with ask/answer timestamp
> pairs, **and** `NextWork` (`src/mcp/next-work.ts:52-79`) declares a field
> derived from it.
> *Today:* **met** (2026-08-01). `.ost-agent/asks/asks.jsonl` is an append-only ledger
> (`src/knowledge/asks.ts`), the same shape B5 sharpened for the trust ledger: read as
> a *history* keyed by test title, never last-record-wins, with the clock injected so
> age is deterministic under test (`src/knowledge/actor-trust.ts:405-520` is the
> pattern it copies). `setLane` (`src/ost/lanes.ts`) is the one write path every
> lane classification goes through — the CLI's `ost-agent lane --set` directly,
> `ost_flag_humans_required` via its cautious-lane call — so it is the one place that
> needed the hook: landing on any needs-a-person lane files an ask, attributed to
> whoever made the call and carrying the command that would clear it. (Widened from
> `pending-permission` alone on 2026-08-11, when the standing pending-ask queue
> landed — before that, an ask a run raised mid-pass by flagging `humans-required`
> was never persisted, so the queue showed it ageless or not at all.)
> `NextWork.outstandingAsks` (`src/mcp/next-work.ts`) is the declared field,
> assembled by `pendingAskQueue` (`src/ost/pending-asks.ts`) — the same derivation
> the operator's `ost-agent asks` reads, so the two surfaces can never disagree:
> every unresulted test labelled into a needs-a-person lane or carrying a ledger ask,
> joined against the ledger's latest record for that title, reporting `ageDays: null`
> rather than `0` when no ask is on file — a test that entered its lane before this
> ledger existed reads as *unmeasured*, not fresh, so a stale ask can never
> masquerade as a new one. There is no "answered" record type: a test leaves the
> queue (a result is recorded, or a human re-classifies it `compute-only`) through
> the same read `disposeAssumptionTests` already does, so a second ledger tracking
> resolution would be a second place that fact could disagree with the first.
> Pinned by `test/knowledge/asks.test.ts` (ledger mechanics: append, history-not-fold,
> damaged-line survival), `test/ost/lanes.test.ts`'s `setLane` block (an ask is filed
> on every needs-a-person lane and never on `compute-only`, and a second ask appends
> rather than overwrites), `test/mcp/next-work.test.ts`'s `outstandingAsks` block
> (age computed from the *latest* ask after a re-ask, `null` on an unrecorded ask,
> cleared automatically once a result lands, and never blocking `done`), and
> `test/ost/pending-ask-queue.test.ts` (an ask raised mid-pass by one run is still
> in the queue on a later run, aged non-null and carrying its clearing command; an
> unlabelled test is triage backlog, never an ask). **Ask latency
> is the one genuinely sponsor-specific measurement** — the rest of the sponsor
> relationship is B5 and B6 applied to one actor, and that half closed on
> 2026-07-30 (P5). What P2 closes is exactly the part a ledger of outcomes cannot see:
> an ask that is never answered records nothing, so silence is now measured by a
> clock rather than scored by a fold.

**P3 — Every lane has a behavioural consumer.**
> *Check:* for each of the four ids in `LANES`, `grep -rn "'<id>'" src/ | grep
> -vE 'src/knowledge/lanes\.ts|src/ost/lanes\.ts'` must name a consumer that
> changes behaviour, not one that formats a string.
> *Today:* **met** (2026-07-30). `ost_next_work` now routes every assumption test
> with no result into its lane's bucket — `assumptionWork.{runnable,
> awaitingOneCommand, blockedOnPermission, needsHumans}` — through a
> `Record<LaneId, …>` disposition table in `src/mcp/next-work.ts`, so each of the
> four lane ids drives which bucket a test lands in. That is the behavioural
> consumer the check demands: `test/mcp/lane-consumer.test.ts` proves it by
> input→output rather than by grep — the same tree with the test relabelled moves
> it between buckets, exactly one bucket ever holds it, and an unlabelled test
> falls to `needsHumans` by the fail-closed rule. `runnable` is asserted equal to
> `runnableByCompute`, so "what compute may run" has one definition, not two. This
> is the sort the lane vocabulary was designed for and never had — `lanes.ts` says
> a label "lets an unattended pass run the lane that costs nobody anything, and
> lets the rest be presented to a person already sorted by what they are actually
> waiting on."
>
> **What this deliberately is not, because the boundary is the point.** It is a
> work *surface*, not a runner that executes and records. Recording a result is a
> `## Results` heading or a `validated` status, both writable only off the agent's
> surface (`ost-agent result`/`promote` — B1, B2), and `/ost-pass` carries the hard
> rule "never run tests" for the same reason those gates exist: an agent that runs
> and records its own test is the one failure this product cannot survive. So
> `runnable` names what an *attended* session — a human present to run
> `ost-agent result` — may go run now; the unattended pass reads it as information,
> pinned by the "read, do not action" step added to `.claude/commands/ost-pass.md`.
> **The full DEC-3 mechanism — an agent that answers feasibility questions by
> executing tests against its environment unattended — is deliberately still
> unbuilt**, because building it means reopening B1/B2, and that trade is DEC-3's to
> make, not this criterion's. What P3 asked for was a consumer per lane and a
> runnable bucket in `ost_next_work`; both exist. `assumptionWork` never blocks
> `done` (a test the agent cannot mark run cannot be a completion blocker — the
> R2/R3 wedge), asserted in the same file.

**P4 — Exactly one lane is runnable by compute, and anything unrecognised is
not.**
> *Check:* `LANES.filter(l => l.computeMayRun).length === 1`;
> `computeMayRun(undefined) === computeMayRun("invented") === false`.
> *Today:* **met** (`src/knowledge/lanes.ts:30-87`), pinned by
> `test/security/lane-capability.test.ts`.

**P5 — The sponsor is one row in the actor-keyed ledger, not a special case.**
> *Check:* B5 and B6 pass, and nothing in `src/` *branches* on the sponsor — every
> occurrence of the word is a vocabulary member or a table row, never a condition.
> *Today:* **met** (2026-07-30), pinned by
> `test/knowledge/trust-derivation.test.ts:130-163`. B5 and B6 closed in the same
> change, and `sponsor` is a member of `TRUST_KINDS`
> (`src/knowledge/actor-trust.ts:64`) with a ceiling written in the same frozen
> table as everyone else's (`:110`, `stated`) and a starting rung in the same table
> below it. The check is stated as "no branch" rather than as the original "grep is
> empty" on purpose: the criterion's point was never that the word must be absent —
> it is that the sponsor must not have a *mechanism*, and a grep that goes red when
> the ledger correctly names one of its kinds would push the fix in the wrong
> direction.
>
> So a promise about the runtime environment is a prediction, its fulfilment or
> breach is a verdict recorded by a human, and the sponsor's standing is the fold of
> the two — the same fold, in the same file, as a publisher's. Derived consequence 2
> forbade building this twice, and it was not built twice.
>
> *What this does not do is P2's:* an ask that is never answered records no
> observation at all, so it moves the sponsor's standing not at all. Silence is
> invisible to a ledger that scores outcomes, which is exactly why ask latency is a
> separate measurement and still open.

**P6 — No tool ships an outward mutation.**
> *Check:* (a) `grep -rn 'method: *"' src/web src/adapters src/security | grep -v
> '"GET"'` is empty. (b) a committed test asserts `ALLOWED_TOOL_NAMES \
> MCP_TOOL_NAMES === {git_commit, git_push}` and that `buildOstTools(ctx,
> MCP_TOOL_NAMES)` produces no tool whose `run` reaches `gitPush`.
> *Today:* **met** (2026-08-05), both halves, in
> `test/release/outward-mutation.test.ts`. (a) was already true and is now
> asserted rather than grepped, and converting it tightened it three ways: the
> verdict runs over **all** of `src/` rather than the directories the check
> named, the fact that every match *lands* in `src/web`, `src/adapters` and
> `src/security/brokered-fetch.ts` is itself asserted so the scope is falsifiable,
> and the six call sites are pinned
> as a set — a move does not fail it, a seventh does. `src/security/brokered-fetch.ts`
> is the third directory and it arrived on 2026-08-05 with the credential broker: it
> is the transport the Slack and Atlassian adapters now read through, so that they
> hold a handle rather than a token. It carries no new capability — the same GETs
> leave the machine — and the check grew to name it rather than being widened to
> ignore it. The document's warning about
> the looser `grep -rn 'method:'` is now a check too: it matches strictly more,
> and every extra is a `method: string` type declaration that forbids nothing.
> (b) held in fact and was pinned by nothing, which is the configuration G3 and
> G4 were both in when they turned out to be wrong. `ALLOWED_TOOL_NAMES \
> MCP_TOOL_NAMES` is asserted as exactly `{git_commit, git_push}`, and the
> no-push property is **behavioural rather than static**: the git layer is stubbed
> and every built tool is driven, so a read-only tool that grew a push would fail
> too — verified by planting one in `ost_status` and watching the row go red.
>
> *One hardening beyond the criterion, recorded because it bounds what the check
> can see.* Half (a) reasons about the literal string `method: "…"`, which is blind
> to `fetchFn(url, {...init})`, `{"method": "POST"}` and `req.method = "POST"`.
> Rather than chase spellings, the transport itself is pinned: the outward path is
> driven with an injected fetch and the recorded method asserted. A grep over
> source text was never going to decide this, and saying so is cheaper than a
> regex that looks like it does.

**P7 — The name-level guard would flag a real-world-action tool.**
> *Check:* `isDestructiveToolName` on `ost_send_email`, `ost_sign_document`,
> `ost_pay_invoice`, `ost_publish_post` — all four return true.
> *Today:* **met** (2026-07-30). `CONSEQUENCE_TOKENS` sits beside the destruction
> tokens and is OR'd into the one guard, so `isDestructiveToolName` now decides
> *acting on the world* as well as *destroying things*: reaching a person, reaching
> the public, committing the operator, spending money, taking a slot, and making
> other software act. All four names from the check return true, camelCase
> spellings included. Pinned in `test/security/policy.test.ts`.
>
> **The constraint that decides whether this is a guard or a wedge is the one
> asserted next to it:** no name in `ALLOWED_TOOL_NAMES` may trip it. That is why
> `push` and `commit` are deliberately *not* tokens — pushing is an outward act,
> but `git_push`/`git_commit` are allowlisted and fixed-argument by construction,
> and the existing `force`/`branch`/`checkout` tokens already catch git's dangerous
> shapes. A token that flagged an allowlisted tool would be a token someone deletes.
>
> *What this is worth, stated so it is not over-read:* defence in depth, not the
> gate. Allowlist membership is what stops those four today, membership is a source
> edit, and a source edit is precisely the weakness this criterion objects to — the
> same complaint P6 makes about `MCP_TOOL_NAMES`. A determined author can still
> name a tool something bland. What the guard buys is that the *obvious* spelling
> of a consequential tool cannot ship by accident.

**P8 — The system can state a total bound on outward reach, not just a burst
rate.**
> *Check:* construct `createLookupBudget(operatorLimit, {now, refillPerHour})`
> (`src/web/budget.ts:65-108`) with an injected clock; run **two**
> simulated days hour by hour, calling `take()` until refused. **Pass =** day two
> sums to zero, i.e. total successful takes over all time equals `limit`.
> (One day cannot distinguish the hypotheses: with `DEFAULT_LOOKUP_BUDGET = 10`
> and `DEFAULT_REFILL_PER_HOUR = 10`, `src/web/budget.ts:39-40`, one day sums to
> ~240 whether the cap is lifetime or daily.)
> *Today:* **met** (2026-07-30). The budget now keeps **two** counters, not one: a
> refillable burst allowance, which is what paces a single pass, and a lifetime
> total that nothing refills. The criterion's two-day simulation is committed
> verbatim in `test/web/budget.test.ts` and day two sums to zero, with the control
> the criterion's own parenthesis demands — the same harness against a burst-only
> budget observes ~240, so the zero is a bound rather than a dead harness.
>
> **Building it found a hole that the mechanism as first written did not close, and
> it is the more interesting half of this entry.** `refund()` credited the lifetime
> counter without limit. Take → the source fails → refund → retry is not
> hypothetical: it is the loop `ost_search_web` runs against a failing provider.
> Measured against the first implementation: **10,000 real outward attempts under a
> stated total of 10**, with `lifetimeRemaining()` still reading 10. *A bound that
> any failure removes is a bound on success, not a total bound on outward reach* —
> which is the sentence this criterion makes. The lifetime pool now funds at most
> `lifetimeLimit` refunds ever; the burst is still refunded every time, because an
> outage should not cost pacing. Worst case is `2 × lifetimeLimit` outward
> attempts, and the doubling is stated in the header rather than left to be
> discovered. Pinned with its own control: the identical spin loop against an
> infinite lifetime runs to completion, so the small number cannot be a loop that
> never ran.
>
> *The check on this entry named a function that does not exist.* It read
> `makeLookupBudget(policy, operatorLimit, {…})` — three parameters, including a
> `policy` argument left over from the genome — and `grep -rn 'makeLookupBudget'`
> matched this document and nothing else. The real function is
> `createLookupBudget(limit, opts)`, two parameters. **A criterion whose check
> cannot be run is not a bar**, and this one had been unrunnable since `8261a6f`
> without anyone noticing, because nothing runs the checks.

**P9 — What leaves the machine is determined by the vault's config, not ambient
git state.**
> *Check:* assert statically that `remote.url` has a reader —
> `grep -rn 'remote\.url' src/ --include=*.ts | grep -v src/config/` is
> non-empty — and that `gitPush`'s remote comes from it.
> *Today:* **met** (2026-07-30), and fail-closed. `pushTargetFor` resolves the
> destination from `remote.url`; both call sites — the `git_push` tool and
> `initVault` — go through it, and `gitPush`'s arguments are still fixed and still
> non-forcing. **Enabled with no `url` refuses**, deliberately: a disabled remote
> is a decision and returns a no-op, but a missing address is an unanswered
> question, and pushing to whatever `origin` happens to be is precisely the ambient
> git state this criterion exists to stop mattering.
>
> Pinned in `test/git/safe-git.test.ts`, including the criterion's static half (the
> `remote.url` reader outside `src/config/`) and — the assertion that makes it real
> rather than structural — a **decoy**: a vault whose configured URL differs from
> its `origin`, asserting the push lands at the configured one and `origin` stays
> empty.

**P10 — No single agent-reachable call can flip a gate or empty a violation it
created.**
> *Check:* a table over `buildOstTools(ctx, MCP_TOOL_NAMES)` asserting (a) no
> single call flips `renderGate(tree, solution).cleared` from false to true, and
> (b) no single call takes `checkInvariants` from non-empty to empty for a rule
> the same caller created.
> *Today:* **met** (2026-07-30). The table exists, every row passes, and **the row
> that did not pass when it was first written is the reason this criterion was
> worth keeping separate from the six that "cover" it.** See the two paragraphs
> below for what it found; R6 closed it the following day, `KNOWN_OPEN` is now
> empty, and the closed hole moved to `CLOSED_HOLES` — which still fires the exact
> call every build, asserts the refusal, *and* asserts a legal edge still lands, so
> the door is re-tried rather than assumed shut.
>
> *One consequence to state, because it makes clause (b) read stranger than it is.*
> R6 also closed `dangling-link`'s only single-call create path, so **no invariant
> is agent-authorable in one call at all** — clause (b)'s generated sweep now
> iterates over an empty set. Satisfied by absence is stronger than the criterion
> asks and weaker as a *test*, so absence is not what is asserted: `CLOSED_CREATES`
> fires both former create calls on every build and asserts refusal plus an empty
> `checkInvariants`. R3's table is the same discipline one gate over.
>
> *The history below is kept because it is the argument for the criterion.* The two
> rows that failed before, `ost_append_to_node` and `ost_set_status`, were failing
> *by B1 and B2*,
> and both closed on 2026-07-30: the heading is refused at the vault's write
> funnel and `validated` is off both status enums. A third route, `ost_create_node`
> declaring a measurement rung, closed with B3. At that point this criterion
> stopped carrying anyone's blocker status by reference, and what was missing was
> **the table itself** — its check is a committed enumeration over
> `buildOstTools(ctx, MCP_TOOL_NAMES)`, and nothing enumerated. That distinction
> mattered here more than anywhere: three separate criteria each pinned the door
> they were about, and *"no single call flips a gate"* is a claim over the whole
> surface that no conjunction of them makes. **A property proved door by door is
> not proved** — F6 is the same shape one gate over, and it is the criterion that
> found the hole its own first draft left.
>
> **The table was written on 2026-07-30 and it found a fourth door, which is the
> whole reason this criterion is not a summary of B1, B2 and B3.**
> `test/security/no-single-call-flips-a-gate.test.ts` enumerates
> `buildOstTools(ctx, MCP_TOOL_NAMES)` and drives every mutating tool against both
> properties. Eighteen rows pass. One does not: **`ost_link_nodes` flips
> `renderGate(...).cleared` from false to true in a single call**, by attaching an
> AssumptionTest that already carries a recorded result to a Solution that did not
> commission it. B1 stops the agent *writing* `## Results`; nothing stopped it
> *adopting someone else's*. **That is a door none of B1, B2 or B3 is about, and no
> conjunction of them would ever have named it** — the enumeration found it because
> the enumeration asks the question over the whole surface. The row was committed
> with its expectation set to the hole, so that closing it would fail the build and
> tell the fixer to move it, and the next day R6 did exactly that.
>
> *Writing the table was worth it for the four defects the adversarial pass then
> found in the table itself*, every one of which would have left it green and
> hollow: an assertion of `not.toEqual([])` where the criterion says *"for a rule
> the same caller created"* — a call that erased its target while raising some
> other rule passed, and substituting the rule label left **all eighteen rows
> green**; a `CONSTRUCTIVE` exception that `return`ed and so skipped an entire
> tool's sweep rather than one call; a known-open exemption that suspended the
> property for every shape of `ost_link_nodes` rather than the one named hole; and
> `expect(reached).toBeGreaterThanOrEqual(0)` — an always-true assertion, carrying
> a comment claiming it proved non-vacuity, **in the file whose subject is
> always-true assertions**. F6's first draft was vacuous and green; so was this
> one, in four separate places, and only mutation found them.
>
> **The second branch of this criterion's fork was taken on 2026-07-29.** It read
> *"Either those two land, or `README.md` and `docs/consuming-from-claude-code.md`
> should stop promising that the worst outcome is a nonsensical, revertible
> commit."* B1 and B2 have not landed, so the promise was withdrawn. Each site
> keeps the half that is true — the MCP surface has no delete, edit, rename or
> shell tool, every write is a new append-only commit, so every write is
> revertible — and now says plainly that a pass can move a solution's gate with no
> human in the loop, citing B1, B2 and this criterion.
>
> **The claim shipped in four places and this entry named two.** The two it missed
> are the ones no criterion could see: `examples/automation/autonomous-pass.sh`,
> which D4's scope deliberately excludes as an example, and the *generated*
> `.claude/skills/opportunity-solution-tree/SKILL.md`, whose **prose** D3 does not
> read — D3 compares only its tool list against the server's surface. So the claim
> this criterion calls false was being loaded into the model's own instructions on
> every single run, by a file two criteria look at and neither one reads. Pinned by
> `test/release/withdrawn-claims.test.ts`, which scans the operator-facing surfaces
> for the phrasing *family* rather than one literal string — the claim was written
> four different ways in four files, and a literal-string guard would have caught
> one of them.
>
> *Withdrawing the promise was not progress on the mechanism, and the mechanism
> has since arrived.* B1 and B2 landed on 2026-07-30, so the operator-facing text
> was re-stated rather than merely withdrawn: `README.md` now says which two
> writes are closed and names the one that is not (a human with a text editor).
> **That text is now understated rather than overstated, which is the safe
> direction but is still a claim carried by memory** — the surface has since gained
> R6's guard and the enumeration that pins it, and the operator-facing wording has
> not moved with them. Restating it belongs in the same pass that re-reads
> `README.md` against Gate D.

---

## Part II — What unattended operation requires regardless

### Gate R — Recoverability: nothing the agent writes may be permanent

An append-only store plus an invariant that reads free text is a one-way door.
Two such doors exist.

**R1 — No append-only write can create a `wrapped-wikilink` violation.**
> *Check:* for each of `ost_create_node.body`, `ost_append_to_node.section`,
> `ost_annotate.issue`, `ost_set_status.note`, `ost_set_evidence.note`,
> `ost_flag_humans_required.why`, pass a value containing `[[Some\nTitle]]` and
> assert the call throws.
> *Today:* **met** (2026-07-29). `assertWritableContent` — the funnel every node write
> already passes through, and whose own comment argued it must hold "for entry points
> that do not exist yet" — now refuses a wrapped link outright
> (`src/ost/vault.ts:57-79`). All six parameters are pinned in
> `test/ost/vault-write-guard.test.ts`, including that a refused `createNode` leaves no
> file and a refused append lands nothing. `ost_flag_humans_required.why` arrives via
> `setLane`'s note and lands on the same guard, so it is covered by construction rather
> than by a second check.
>
> *What this does and does not close:* the tool surface can no longer author the
> violation, which is the whole of the criterion — a one-way door needs a doorway. It
> does **not** claim no such node can exist: a human editing in Obsidian, an import, or
> a node predating the guard can still put one on disk, and `wrapped-wikilink` stays
> unclearable for those. That residue is R4's problem (rule-set parity), not R1's, and
> `test/mcp/next-work.test.ts` deliberately builds its detector fixture by writing the
> file directly, so the detector keeps being tested against the case the guard cannot
> reach.

**R2 — `ost_flag_humans_required` cannot manufacture a permanent
`lane-conflict`.**
> *Check:* create an AssumptionTest whose body says `Lane: compute-only.` above
> any `##` heading, call `ost_flag_humans_required`, assert `laneConflicts` is
> empty.
> *Today:* **met** (2026-07-30), by refusing at the boundary rather than by adding
> a way back — R1's shape, and for R1's reason. `flagHumansRequired` now reads the
> node's *own* prose and refuses when it names a lane other than
> `humans-required`, so the conflict cannot be authored in the first place. **No
> permissive setter was added**: the agent's only lane tool is still the
> restrictive one, which is the product's central safety argument, and the human's
> `setLane` stays deliberately unguarded — a test pins that asymmetry so the day
> someone "fixes" it symmetrically is a red build.
>
> One implementation detail is load-bearing and would have been easy to get wrong:
> the guard reads `readProseLane`, not `proseDeclaredLane`. The latter goes silent
> exactly when the label already agrees with the sentence — which is the state one
> flag away from a conflict, i.e. every case this criterion is about. Pinned in
> `test/ost/flag-humans-required.test.ts`, including an executed proof that the
> pre-R2 path really did author the conflict, so the refusal is measured against a
> reproduction rather than against a description.
>
> *The residue, stated because it is a real route and not a rounding error:*
> `ost_append_to_node` can still land `Lane: …` in own prose — but only on a test
> that already carries a *different* frontmatter lane **and** has no `##` section.
> Since every lane write files a `## History` line, reaching that state needs a
> human hand-editing frontmatter. It is written into `laneConflicts`' doc comment
> rather than left for the next reader to rediscover.
>
> *The reachability argument this entry used to rest on is now retired, and how it
> retired is the point.* Containment was the whole defence: the tool appeared in no
> shipped command's `allowed-tools`, so under D2's finding that an out-of-allowlist
> tool is *denied, not prompted*, the unattended sweep could not reach the wedge at
> all. That is containment, not a fix, and this entry said so. With the guard in
> place the containment stopped being load-bearing — **and the first thing that
> happened is that D3 granted the tool on the skill surface in the same batch.** A
> criterion held closed by nobody having the key is a criterion that reopens the
> day someone is handed one, which is exactly why the fix had to be the refusal.
>
> Both halves are a row rather than a paragraph: `test/eval/clearability.test.ts`
> executes the create (`ost_flag_humans_required` on a test whose own prose says
> `compute-only`) and pins that it is now **refused**, with the refusal *text*
> pinned on both surfaces as an alternation — `/ost-pass` refuses by non-grant and
> MCP by the guard — so deleting the guard fails the MCP row rather than quietly
> passing on the other one's reason.

**⛔ R3 — Every rule `checkInvariants` can emit that the agent can create, the
agent can also clear.**
> *Check:* a table-driven test, one row per rule, built against
> `buildOstTools(ctx, MCP_TOOL_NAMES)` — **not** bare `buildOstTools`, which also
> builds `git_commit`/`git_push` the server never exposes. Give the table a second
> column for `/ost-pass`'s nine names, since "the agent can clear it" has a
> different answer on the unattended surface (R7).
> *Today:* **met** (2026-07-30) — **and it is met in the strongest way available,
> which is worth stating precisely because it can be mistaken for vacuity.** The
> table runs on every build as `test/eval/clearability.test.ts` (R9), one row per
> rule, rows grepped from `src/eval/invariants.ts`, each cell an executed tool call
> through `validateToolInput` against `buildOstTools(ctx, MCP_TOOL_NAMES)`. Every
> `create` cell now reads **no**, on both surfaces:
>
> | Rule | MCP: create | MCP: clear | `/ost-pass`: create | `/ost-pass`: clear |
> |---|---|---|---|---|
> | `single-outcome` | no | **no** (no delete, no Outcome creation) | no | no |
> | `dangling-link` | **no** (R6 closed it, 2026-07-30) | yes | no | yes |
> | `wrapped-wikilink` | **no** (R1 closed it) | no | no | no |
> | `opportunity-connected` | no | yes | no | yes |
> | `solution-mapped` | no | yes | no | yes |
> | `assumption-mapped` | no | yes | no | yes |
> | `test-mapped` | no | yes | no | yes |
> | `single-parent` | **no** (create attaches a new node; link refuses a second edge) | yes (detach the surplus edge) | no | yes |
> | `single-backlink` | **no** (create links its own node once; link writes edges, not prose) | yes (edit the prose to a plain mention) | no | yes |
> | `evidence-class` | no | yes | no | yes (R7 granted it, 2026-07-29) |
> | `no-self-validation` | no | yes | no | yes |
> | `lane-conflict` | **no** (R2 closed it, 2026-07-30) | no | no | no |
>
> The criterion reads *"every rule the agent can create, the agent can also clear"*,
> and the antecedent is now empty: **on the tool surface, the agent can author no
> invariant violation in a single call at all.** An empty antecedent makes the
> implication true, and a criterion that passes because its precondition vanished is
> exactly the shape this document distrusts — so the table does not stop at
> asserting nothing. Each closed create path is still **fired every build** and
> asserted to be refused, with the refusal text pinned, so the doors are re-tried
> rather than assumed shut. R3's property is also stated once over the verified
> table (`test/eval/clearability.test.ts`), as a claim about the cells rather than a
> claim repeated per row: any `create` cell that is true must have `clear` true.
> If a future change reopens a create path, the row goes red before the property
> does.
>
> `lane-conflict` was the last cell and it was the one that mattered — created by
> `ost_flag_humans_required` and clearable by nothing, held off the blocker bar only
> by the tool being reachable from no shipped command. That is containment, and R2
> replaced it with a refusal. `dangling-link` went the same way one day later, from
> the other direction: R6 gave `ost_link_nodes` the child-and-hierarchy check
> `ost_create_node` already had, and the tool that could author a dangling edge
> stopped being able to.
>
> Two cells moved when the table first ran, and neither move was news — which is the
> point. `wrapped-wikilink` read `yes/no`, the worst shape on the list, until R1 closed
> the create at the write boundary; the entry recording that fix and the table asserting
> the old state sat nine hundred lines apart in this file for a day. `evidence-class`'s
> surface split was carried as a prose aside in the old table and in R7. **Neither was
> hidden. Both were remembered rather than computed, and a table that runs cannot hold a
> stale cell for a day.** A third moved on 2026-07-29: R4 made `evidence-class` a
> `done`-blocker, which is only safe if the sweep can clear it, so R7's grant and this
> cell changed together — the table is what made "these two must move in the same
> commit" a mechanical fact rather than a thing to remember.
>
> Under DEC-1, an unclearable violation cannot be cleared by anyone but the sponsor
> on a shell — so **every one-way invariant is a mandatory human interrupt**,
> which is the exact resource DEC-3 is trying to spend sparingly.
>
> *What a `no` cell means, precisely:* the declared attempt — the move an agent
> would actually make — did not produce or did not clear the violation, and where
> a guard rather than an absence is the reason, the test pins the refusal text. It
> is not a proof that no sequence of the eighteen tools could. That negative is not
> available from a test, and claiming it would be the same self-certification Gate B
> exists to catch.

**⛔ R4 — `ost_check` and `ost_next_work.done` never disagree about a defect they
both compute, except where the disagreement is declared or written down on the
node.**
> *Check:* two parts, because the naïve property is unachievable for an unrelated
> reason. (a) **Rule-set parity, greppable:** the set of `rule: "…"` literals in
> `src/eval/invariants.ts` must partition into rules `detectHygiene` computes and
> rules explicitly declared "not a `done`-blocker" *with the reason stated* — none
> in neither, none in both. (b) **Property over the blocking rules:** never
> `done === true` while a blocking-rule violation stands un-annotated on its node.
> *Today:* **met** (2026-07-29), and pinned by `test/mcp/rule-parity.test.ts` — 18
> tests: the partition, one planted violation per blocking rule proving the label has
> a detector behind it, and the property asserted over all nine planted at once.
>
> **(a) is now structural rather than maintained.** `detectHygiene`
> (`src/mcp/next-work.ts:141-161`) no longer re-implements the rules beside
> `checkInvariants`; it *derives* from it, mapping each violation to a hygiene issue
> through `HYGIENE_LABELS` and skipping only what `NOT_DONE_BLOCKING` declares. Two
> hand-written detectors could not stay in agreement, and had not: **the gap was four
> rules, not the three this entry named.** `no-self-validation` was missing from
> `detectHygiene` too — an omission this document carried while enumerating the others,
> which is the exact failure mode R3 was built to end. It surfaced in the first minute
> of computing the set instead of listing it. The detectors had also drifted in a second
> way no rule count would show: the old orphan-opportunity check tested *direct*
> parenting where the invariant tests reachability from the Outcome, so a chain hanging
> off an orphan read connected on one gate and adrift on the other.
>
> `single-outcome` is the one declared non-blocker, and the argument is about the tool
> surface rather than the rule's importance: it names no node, so there is nothing to
> annotate, and R3's table pins that nothing on either surface can remove the second
> Outcome. Blocking `done` on it wedges every unattended pass forever on a defect the
> pass cannot touch. It stays a hard `ost_check` violation and a mandatory human
> interrupt. The set being exactly `{single-outcome}` is itself asserted, because a
> declaration is a decision and no other test in that file can tell a genuine
> non-blocker from a rule quietly downgraded to one — moving a second rule out of the
> blocking set fails the build, so it has to be argued in a diff.
>
> **`evidence-class` blocking `done` is only safe because R7's grant landed in the same
> commit.** A `done`-blocker the sweep holds no tool to clear is the same wedge by
> another route, so `ost_set_evidence` is now on `/ost-pass` and R3's table flipped that
> cell in the same change.
>
> *The residue, stated because it is the criterion's boundary and not a loophole:* an
> annotation still suppresses a hygiene issue — that is P5 (the agent flags, it never
> deletes) and R5 pins that only a real dated `ost_annotate` entry counts. So the
> reachable disagreement is exactly *"a human has been told, in writing, on the node."*
> The naïve property — never `done` while `check` is red — is not available to an
> append-only vault whose only clear path for an unrepairable defect is to write it
> down. What closed here is the disagreement that needed no forging and left no record:
> a legacy or human-authored node with no evidence class used to read `done: true`.

**R5 — A hygiene issue is suppressed only by a real annotation, not by prose
that quotes it.**
> *Check:* create a dangling link, then `ost_append_to_node` a section quoting the
> exact issue string inside an ordinary sentence; assert the issue survives.
> *Today:* **met** (2026-07-29). Suppression reads the structural line `ost_annotate`
> writes — a dated entry under `## Issues` — instead of the whole body
> (`src/mcp/next-work.ts:107-140`). The only thing that clears a hygiene issue is now
> the tool for clearing hygiene issues, which is what P5 always claimed. Pinned in
> `test/mcp/next-work.test.ts`: quoting does not clear, annotating does, an annotation
> about something else does not, and undated prose parked under a hand-written
> `## Issues` heading does not — the heading alone is not the signal.
>
> Deliberately loose on the date, so that a tree read the day after it was annotated
> does not re-raise everything and stop the sweep from reaching `done` twice.
>
> *This closed the forging path into `hygieneIssues`, not the disagreement* — the rule
> sets stayed different until R4 made `detectHygiene` derive from `checkInvariants`
> rather than re-implement it. The suppression this criterion pins is now the *only*
> way the two gates can disagree, which is what makes R4's boundary statable: a
> disagreement that exists is one a human was told about in writing.

**R6 — `ost_link_nodes` validates its child and its hierarchy, as
`ost_create_node` does.**
> *Check:* assert `ost_link_nodes({parent: <a Solution>, child: <an
> Opportunity>})` throws, and that a non-existent *child* throws.
> *Today:* **met** (2026-07-30), both halves, plus a third the criterion did not
> know it needed. `assertLinkAllowed` reuses the *same* `CHILD_HIERARCHY` table
> `ost_create_node` reads — reused rather than restated, which is the idiom that
> collected B4 and B8 for free — requires the child to exist, and refuses the
> wrong-layer edge. Pinned in `test/security/link-nodes-guard.test.ts`.
>
> **The third half is P10's finding, and it is the one worth the entry.** P10's new
> enumeration table found that `ost_link_nodes` flipped a Solution's gate from
> BLOCKED to CLEARED in one call, by attaching an AssumptionTest that *already
> carried a recorded result* to a Solution that never commissioned it. B1 stopped
> the agent **writing** `## Results`; nothing stopped it **adopting someone
> else's**. The guard now refuses that adoption — and the reason it costs no
> legitimate workflow was checked against the code rather than assumed:
> `ost_create_node` writes the edge at creation, before any result can exist, so
> the ordinary flow never presents the case.
>
> Three narrowings, each pinned, each a place this could have become a wedge:
> - **An already-existing edge is exempt** — `linkNodes` no-ops on it, and
>   `test/release/no-evolvable-policy.test.ts` drives exactly that re-issue.
> - **Linking an *unrun* test to a second Solution stays open**, so a shared
>   assumption still works; it is the human's result write that then moves both
>   gates, which is the correct owner.
> - **`gateSolution` is advisory** — `done` has no gate term — so a refusal here
>   cannot wedge an unattended pass. That was verified behaviourally *and*
>   structurally rather than taken on the tool description's word.
>
> *And the consequence for R3, stated because it changed another criterion's
> table:* closing this also closed `dangling-link`'s only single-call create path,
> which is what left every `create` cell in R3's table reading `no`.

**R7 — The unattended sweep holds every tool needed to clear every invariant it
can be blocked by.**
> *Check:* assert `/ost-pass`'s `allowed-tools` is a superset of what the R3 table
> requires on that surface.
> *Today:* **met** (2026-07-29). `ost_set_evidence` is granted on
> `.claude/commands/ost-pass.md:3`, and R3's table — which reads that allowlist out of
> the command file itself — now clears a planted `evidence-class` violation on both
> surfaces. The grant was not optional: R4 made `evidence-class` block `done`, and a
> `done`-blocker the sweep cannot clear is a permanent wedge, so the two landed in one
> commit. `test/release/examples-allowlist.test.ts` carried the same tool into both
> automation examples' `--allowedTools`, where a missing name is denied rather than
> prompted.
>
> The residue is the other direction and belongs to R2: **no shipped command grants
> `ost_flag_humans_required`**, which is what keeps `lane-conflict` — the one rule the
> agent can create and cannot clear — off the unattended surface entirely. That is
> containment, not a fix.

**R8 — `ost_create_node` leaves no orphan when the attach step fails.**
> *Check:* inject a failure into `Vault.linkNodes`; assert no node file persists
> unattached.
> *Today:* **met** (2026-07-30), with a residue that is stated rather than
> claimed away. **No delete was added** — that is the repository's load-bearing
> safety invariant and rolling back is not available, so atomicity had to come from
> the other end: `Vault.assertLinkable` moves every attach-time failure *ahead of
> the first write* (the parent resolves, the child title reduces to a name inside
> the root, the parent file is writable), and `ost_create_node` calls it before
> anything reaches disk. A refused call now leaves nothing behind, pinned by an
> injected pre-validation failure plus ten argument-reachable refusals that each
> assert the vault is byte-identical afterwards.
>
> *The residue:* a filesystem failure on the **second** write cannot be
> pre-validated and cannot be rolled back. It is made loud instead of silent — the
> error names the node it created, says ORPHAN, and gives the finishing
> `ost_link_nodes` call — and `ost_check`'s orphan invariants catch it, which is
> pinned too.
>
> **The tool description was the other half of this criterion and it was corrected,
> not defended.** It promised "one atomic step — so a node can never be an orphan",
> which was false when written and would have been *nearly* true afterwards; nearly
> true is the worse failure, because it is the version a reader believes. The
> shipped description now says what actually holds, and so does the generated
> `SKILL.md`, whose copy of the claim no criterion had been reading — the same blind
> spot P10 records for the withdrawn "worst it can do is a nonsensical commit".

**R9 — The clearability table is a committed test, not an audit finding.**
> *Check:* a test file exists that derives its rows from
> `grep -o 'rule: "[a-z-]*"' src/eval/invariants.ts` (today nine literals) rather
> than from a hand-written list, so adding a rule fails the build until its clear
> path exists.
> *Today:* **met** (2026-07-29). `test/eval/clearability.test.ts` reads the rule
> literals out of `src/eval/invariants.ts` and asserts they are exactly the table's
> keys — verified by adding a tenth rule to the source, which fails the build with
> nothing else changed. The two surfaces are derived too: the MCP column from
> `MCP_TOOL_NAMES`, the sweep column parsed from `.claude/commands/ost-pass.md`'s
> own frontmatter, so a tool added to or dropped from `/ost-pass` re-decides the
> second column without anyone editing this document.
>
> Each cell is an executed call, not a declaration: the fixture is built by direct
> `Vault` writes (never by the tool surface), the violation is asserted absent
> before a create attempt and present after a plant, and a call to an ungranted
> tool is refused the way `-p --permission-mode acceptEdits` refuses it. Three
> mutations confirmed it is not vacuous — flipping the `evidence-class` sweep cell,
> flipping the `wrapped-wikilink` create cell, and swapping one clear path's tool
> each fail exactly the row they belong to. The first of those stopped being a
> mutation on 2026-07-29 and became the state: R7's grant flipped that cell for real,
> and the row failed until the expectation moved with it.

---

### Gate F — Function: the system does the job it exists to do

**Every other gate in this document is negative.** They say what may not be forged
(B), what may not become permanent (R), what may not grow without bound (Z), what
may not be claimed untruthfully (D). Read together they specify a system that
cannot hurt you. They do not specify a system that does anything.

The headline on line 3 is that a vault can be *"pointed at OST-Agent, left
unattended, and trusted to make progress."* Nothing in Gates W through D decides
any clause of that sentence. Nothing fires the loop — the engine is an example
shell script, covered by W5 for its permission flags and H2 for its exit code and
by no criterion for existing. Nothing bounds what a firing costs; P8 caps outward
web lookups and there is no token, dollar or wall-clock bound anywhere in `src/`.
Nothing stops two firings overlapping on one vault; Gate W asks *who* may write and
never *how many at once*. Nothing distinguishes a firing that worked from one that
did nothing, and S1 records that the steady state after one sweep is `done: true`
forever. And nothing decides that the mandate advanced — `done` means "no
outstanding hygiene", the document explicitly disclaims measuring usefulness, and
S1's own after-check measures evidence *count*.

**A system passing all 68 of the other criteria could run forever, grow the tree
with true and worthless nodes, and read healthy the entire time.** That is not a
defect in any one of them. It is the shape of a bar assembled entirely out of
things that must not happen.

#### Why each criterion here states two acceptance conditions

Derived consequence 6: the tree is the artefact under test and never the referee.
So a Gate F criterion is not met by a mechanism that works — it is met by a
mechanism that works *and* whose working is decided by something the cartographer
cannot write. The two are separated on purpose, because the cheap version of every
criterion below is an `ost_*` tool that reports success, and B1, B2 and B10 are the
standing proof that the agent would then be grading its own homework.

**Disqualified deciders**, in every entry: any tool in `MCP_TOOL_NAMES`; any
heading, section, status field or annotation on a node; anything under the vault's
writable surface while W5 is open. **Qualified deciders:** a process exit code; an
append-only ledger no allowlisted tool can reach; a deterministic CLI run out of
band; CI; or a reviewing actor that reads the tree and cannot write it.

#### The dependency that governs this whole gate

**W5 is the precondition for every criterion below, and until it closed each of
their deciders was forgeable.** Not through MCP — that surface is clean, because
`nodePath` refuses any path containing a separator (`src/ost/vault.ts:103-110`), so
no `ost_*` call can write a sidecar ledger or `ost.config.yaml`. Through the
*harness*: `autonomous-pass.sh` passed `--permission-mode acceptEdits` with no
`--disallowedTools`, and the vault is cwd, so ordinary Edit and Write were
pre-accepted against every file a Gate F verdict reads. A health record the agent
can append one line to decides nothing; one future-stamped line pins a cadence gate
closed forever, and one appended line resets a no-op streak permanently.

This was found by trying to write these criteria and failing: each draft named an
unforgeable decider, and each named one that a single Write could forge. **W5 was
recorded as a Tier 3 item about shell flags. It is actually the load-bearing
precondition of the gate that makes this system work at all,** so it is promoted to
Tier 1 below — and it was closed in the same change that added this gate, because
shipping F1 through F4 against an open W5 would have produced four mechanisms whose
verdicts all read authoritative and none of which decided anything.

**A second precondition is not met and is not closable here.** The records the
loop writes live in `<vault>/.git/ost-agent/`, not `<vault>/.ost-agent/`, and that
is not tidiness: every mutating MCP tool commits with `git add -A`
(`src/git/safe-git.ts:49`), so a ledger on a tracked path would be swept into the
next `mcp: <tool>` commit — W2's failure and D5's, manufactured deterministically
on every single firing. Under `.git/` it is untrackable by construction rather than
by a `.gitignore` an operator can delete. The cost is stated rather than hidden: a
fresh CI checkout always reads "never fired", which is correct for a machine-local
record and is why the GitHub example keeps `cron` as its scheduler.

#### The wedge rule, stated once and applying to all six

Every mechanism here can enter a state that stops the loop: an exhausted budget, a
held lock, a future-stamped clock, an unmet acceptance condition. R2 is this
repo's cautionary tale — *"a safety mechanism that turns into a permanent red when
used as intended will be routed around"* — and the way an operator routes around a
cron that has been failing for a week is by deleting the cron. So **every stopping
state a Gate F mechanism can enter must name its way out, and that way out must be
automatic unless a human interrupt is the actual point.** R9's clearability table
is the institution for this; a Gate F stopping state with no row is a bug.

**⛔ F1 — A firing is an event with a beginning and an end, it recurs on a cadence
the vault declares, and a vault declaring none never fires.**
> *Check:* against a scratch vault with a declared cadence and an empty run ledger,
> `loop due` exits 0; run one full firing; `loop due` now exits non-zero with
> *not-elapsed*, without sleeping or advancing a clock — the firing consumed the
> window. Three fail-closed rows decide the negative half: with the cadence key
> deleted, `loop due` refuses even against a year-old run ledger (elapsed time
> never manufactures a cadence); an unparseable cadence refuses rather than
> defaulting; and a newest run stamped in the *future* is **ignored, with a warning
> on stderr, rather than either fired on or wedged behind** — see the note below,
> because this row was written the other way round and the implementation was right.
> *Decided by:* the CLI process's exit code, computed from `ost.config.yaml` and
> the newest record in the run ledger. Unforgeable because there is deliberately no
> `--force`, no `--cadence` and no `--since` anywhere in the command family, so
> "fire now" is not an expressible argument — `ost_flag_humans_required`'s shape
> (`src/security/tools.ts:326-353`) — and because W5 now closes the Write path onto
> the two files it reads.
> *Today:* **met** (2026-07-29). `ost-agent loop due | start | step | seal` exists
> (`src/cli/loop.ts`), cadence is declared per-vault under `loop.cadence`
> (`src/config/schema.ts`) with no default, and each refusal carries its own exit
> code — `notElapsed` is the only non-zero a wrapper should treat as routine, because
> collapsing them all into "not firing, exit 0" would make a vault that has never
> fired once indistinguishable from a healthy one, which is S2's failure statement
> verbatim. Pinned in `test/loop/cadence.test.ts` and `test/cli/loop.test.ts`.
>
> **The future-stamped row was wrong when this criterion was written, and building
> it is what showed that.** The criterion said *refuses rather than firing*, on the
> reasoning that a clock you cannot trust should stop the loop. But refusing has no
> way out: clock skew, a restored backup or a machine that briefly had the wrong
> date silences the vault permanently and silently, and the only remedy is a human
> hand-editing a JSONL file inside `.git/`. The implementation filters future
> records out, uses the newest record that is not in the future, and warns on
> stderr (`src/loop/cadence.ts`). That is strictly better on both counts — it
> neither wedges nor fires spuriously — so **the criterion moved to match the
> code, in the same commit, rather than the code being bent to match a row written
> before anyone tried it.** Recorded because the reverse is how this document has
> been wrong before.
>
> *Way out of every stopping state:* not-elapsed clears with time. Undeclared and
> unparseable clear by editing the config, which is the sponsor's job and correctly
> a human interrupt. Future-stamped clears itself, per above.

**F2 — Two firings cannot run against one vault at the same time.**
> *Check:* spawn N firings concurrently against one vault; assert exactly one
> proceeds and the rest exit with a distinct *held* code; then kill a holder
> uncleanly and assert the next firing acquires without human help.
> *Decided by:* the exit codes of the losing processes, plus an
> `fs.linkSync`-based acquire that is atomic on content, not merely on creation.
> Unforgeable because acquisition is decided by the filesystem, not by anything
> written into the vault.
> *Today:* **met** (2026-07-29). `acquireFiringLock` (`src/loop/lock.ts`) writes the
> full holder record to a temp file and then `fs.linkSync`s it into place, which
> fails `EEXIST` atomically and is never visible in a partial state. Losers exit
> 15. Pinned in `test/loop/lock.test.ts`, which spawns four concurrent firings and
> asserts exactly one wins.
>
> *Two failures this criterion did not commit, both found by trying:* a lock taken
> with `writeFileSync(…, {flag:"wx"})` is create-then-write, and between the two
> syscalls it exists and is **zero bytes** — measured over 20,000 trials, a second
> firing reads it, fails to parse, classifies it unreadable, breaks it and
> proceeds, so **both run**. And a lock or ledger on a git-tracked path is swept
> into the next `mcp: <tool>` commit by `git add -A` (`src/git/safe-git.ts:49`),
> which manufactures W2 on every firing and makes D5 red by construction — which is
> why these records live under `.git/ost-agent/`.
>
> *The pin is narrower than its name, and the test header says so.* Four concurrent
> processes prove **mutual exclusion**; they do not prove **atomicity** — reverting
> to `{flag:"wx"}` leaves that test green three runs out of three, because the
> zero-byte window is too narrow to hit by racing whole processes. Catching it would
> need a deterministic syscall-interleaving harness that does not exist here.
> Recorded rather than implied, because a test named for a property it does not
> decide is the vacuity W4 is about.
>
> *Way out:* stale locks break automatically on a TTL (`loop.lockTtlMinutes`,
> default 60). PID-liveness alone is not enough — a recycled pid landing on a
> long-lived daemon never clears, which would be a hand-cleared wedge on the exact
> surface this exists to protect.

**⛔ F3 — A firing that has not been granted a spend ceiling does not happen.**
> *Check:* with no ceiling declared, the firing refuses and exits non-zero before
> the model is invoked; with a ceiling declared, `floor(pool / per-firing)` firings
> succeed and the next refuses. Fail-closed: no default grant, and an unparseable
> or partially-declared ceiling refuses rather than falling back.
> *Decided by:* the exit code of a reservation step that runs *before* the model
> process is spawned, against an append-only ledger outside the tree. Unforgeable
> because the number is read once per firing, before the agent exists in that
> firing — the shape `web.lookupBudget` already uses, "resolved ONCE, at tool-set
> construction, and captured by every closure below" (`src/security/tools.ts:161-167`),
> which is why an agent editing that config value cannot widen its own live budget.
> *Today:* **met** (2026-07-29). `loop due` refuses with a distinct exit code
> before the model is ever spawned, and the ceiling is a rolling window declared at
> `loop.spend` — `ceilingWeightedTokens`, `windowHours`, `sessionsDir` — with **no
> default for any of the three**. An absent block refuses; a *half-typed* block also
> refuses, naming the missing keys, without throwing out of `loadConfig`. That last
> distinction is G1's whole lesson and the first implementation got it wrong: the
> wrappers were `.nullish()` and the three leaves were not, so an operator partway
> through writing the block took down `ost-agent status`, `ost-agent check` and the
> entire MCP surface over a key none of them read. Pinned in
> `test/loop/spend.test.ts` and `test/loop/config.test.ts`.
>
> **This wired up `src/adapters/tokens.ts`, the second entry on G3's dead-module
> register** — the one instrument that could measure what "forever" costs. Spend is
> read out of Claude Code's session transcripts, which the agent does not write, so
> the measurement is first-party in the sense DEC-2 means.
>
> *One sharp edge, found by review rather than by testing:* `sessionsDir` is the one
> field an operator cannot avoid writing a `~` into, and `path.resolve` turns
> `~/.claude/…` into `<vault>/~/.claude/…` silently — so the loop read an
> unmeasurable spend and refused to fire, permanently, **on the exact configuration
> the documentation hands out**. A refusal that cannot be cleared by following the
> instructions is R2 in its purest form. Fixed and pinned
> (`test/loop/config.test.ts`), and it is worth naming as a class: **a fail-closed
> gate turns every path-resolution bug into a wedge.**
>
> *Way out:* an exhausted pool stops the loop until a human raises it, and here that
> **is** the point rather than a wedge — spending real money is exactly where DEC-3
> says the sponsor should be interrupted. Stated explicitly so it reads as a decision
> and not an oversight. The failure mode to watch is the operator who raises the
> number until it stops mattering; F4 is what makes that visible.

**F4 — A firing that changed nothing does not read as a firing that worked.**
> *Check:* run three consecutive firings against a tree with no new input; assert
> each seals a *no-op* verdict rather than *healthy*, and that a run of them
> escalates rather than continuing to report success. Positive control: a firing
> that really does advance the tree seals *healthy*, so the detector is not simply
> reporting failure always.
> *Decided by:* a verdict derived from process exit codes and a committed-delta
> measurement, written to the run ledger by the runner — never by a tool on the
> agent's allowlist.
> *Today:* **met** (2026-07-30). **The per-firing half** was already the case: a
> firing that changes no commit seals `no-op`, never `healthy`, and the verdict is
> derived from the vault's own HEAD before and after rather than from anything the
> agent says (`computeVerdict`, `src/loop/health.ts:193-199`). A missing required
> phase seals `unhealthy` even when every recorded step exited 0, and a firing that
> dies without sealing is swept into a `crashed` record by the next `loop start` —
> so omission is visible in both directions. Pinned in `test/loop/health.test.ts`
> and `test/cli/loop.test.ts`.
>
> **The escalation half closed here, and its two preconditions are why it could.**
> S1 closed on 2026-07-30, so a dry firing is genuinely abnormal: three consecutive
> firings with zero human input produce strictly increasing evidence on a live
> vault, so a `no-op` streak is a vault that has actually stopped rather than a
> quiet healthy one — the R2 hazard that refused this detector for a whole tier
> (a permanent red in a repo whose normal state is the condition it detects) is
> gone. D5 closed the same day, so the committed-delta the verdict turns on is
> trustworthy: a firing refuses to begin against a dirty tree, so a stale untracked
> file can no longer shift verdicts by one and keep a dead vault reading healthy.
> Both were named here as preconditions; both are met.
>
> The detector is `assessStall` (`src/loop/stall.ts`) — a fold over the ledger that
> counts firings back to the last `healthy` one and escalates at three, exactly the
> streak the check runs. It is surfaced on `loop seal`, the point a `no-op` used to
> report and exit 0, and on `loop due`, the one command a cron runs every cycle
> whose stderr it reads. Pinned unit and end-to-end in `test/loop/stall.test.ts`
> and `test/cli/loop.test.ts`, positive control included: a firing that really
> advances the tree seals `healthy` and clears the signal, so the detector is not
> simply reporting failure always.
>
> **Both measurement hazards this entry named are handled, and each has its own
> test.** A `crashed` record does not reset the streak — only `healthy` does, since
> only `healthy` means the tree moved — so a vault alternating dry-run and timeout
> still escalates instead of reading never-stuck. And the committed-delta is safe
> because D5 refuses the dirty tree that would defeat it; that refusal is a firing
> precondition rather than a lint, for this exact reason.
>
> *The way out landed as the entry required:* escalation does not latch. It reports
> on stderr and leaves the firing's own exit code unchanged; the next healthy firing
> clears the streak with no file for a human to edit, and nothing here refuses to
> fire.
>
> **A fifth verdict landed on 2026-08-05, and it closes a gap this entry could not
> see.** F4 asks whether a firing that changed nothing reads as one that worked, and
> `no-op` answers it — but `no-op` means *nothing to do*, which is a claim about the
> tree. The meta vault then fired twenty-two scheduled passes whose MCP tool surface
> was never present: each ran `check` and `status` truthfully, changed no commit, and
> sealed `no-op`, so twenty-two firings that could not do their job wore the verdict
> for a tree that was already fine. `degraded` (`src/loop/degraded.ts`) is that case's
> own name. It outranks `healthy` **and** `no-op` and is outranked by `unhealthy` and
> `crashed`, so a firing without the means to work may claim neither that it worked
> nor that there was nothing to do, and a red step is never softened into an excuse.
> Its inputs are the vault's tool trace, the source surface `buildPassContext` could
> build, and whether the config was readable — the pass is asked nothing, which is the
> point, since the candidate behind it was written to rest on the agent's own honesty
> and its assumption test says plainly that this is the one thing that cannot be
> assumed. `loop seal` exits 17 for it, distinct from `unhealthy`'s 1. Pinned in
> `test/loop/degraded-pass-reporting.test.ts`, controls included. The trace is the one
> decider input the surface itself can move, which F6 now states rather than hides.

**F5 — The mandate carries a stated acceptance condition, and distance from it is
reported by something that cannot write the tree.**
> *Check:* a vault whose Outcome declares no acceptance condition is reported as
> undecidable rather than as done; a vault declaring one has its distance reported
> by a reader with no write path; and the report is byte-identical before and after
> an `ost_append_to_node` that would otherwise look like progress.
> *Decided by:* **not settled, and that is the honest state of this criterion.**
> A reviewing actor that reads the tree and cannot write it is the only shape that
> satisfies derived consequence 6 without shipping an automated judge, which this
> repo deliberately does not ship (`docs/reference/evaluating-ost-agent.md`).
> *Today:* **not met, and partly not designed.** Two findings bound it. First, the
> obvious home for a declared acceptance condition is the Outcome, and the Outcome
> is written by `set-outcome`, which **is** granted to the model
> (`.claude/commands/ost-setup.md:3`) — W6 already records this as a live tree
> write. Putting acceptance there hands the cartographer authorship of its own
> acceptance criteria, which is B2 with extra steps. Second, the deleted harness's
> fitness function got one thing right and it is the constraint here: it *refused*
> to score `resolutionState`, because that heading is "one allowlisted
> `ost_append_to_node` away."
>
> **What this criterion does not claim, stated in the voice of the section below:**
> not that usefulness is measured, not that an automated judge ships, and not that
> a number can distinguish a good tree from a large one. It claims only that
> "progress" should stop being a word no mechanism decides. **A criterion that is
> honestly undesigned is worth more here than a mechanism that reports a number
> nobody should trust** — and the temptation to ship the number is precisely why
> Gate B exists.

**⛔ F6 — No Gate F verdict is computed from a file the unattended surface can
write.**
> *Check:* enumerate every file each Gate F decider reads; assert that for each,
> the unattended automation path grants no tool that can write it — the MCP half
> from `MCP_TOOL_NAMES`, the harness half from the automation entry points'
> `--disallowedTools`.
> *Decided by:* a committed test over both surfaces, run by CI. This is the
> criterion that makes the other five mean anything, and the only one whose subject
> is the other five.
> *Today:* **met** (2026-07-29). The join is asserted, in one file, by
> `test/release/gate-f-deciders.test.ts` — 19 tests in four parts. **Enumeration:**
> every module under `src/loop/` is classified as a reader (attributed to the
> decider whose file list already names what it opens) or as pure (asserted to
> contain no read syscall at all), and a seventh module fails the build until
> someone classifies it. That is the part that answers *"a fourth decider added
> reading somewhere new"*; the previous entry named it as the hole and it is now
> the first test in the file. **The MCP surface, behaviourally:** every mutating
> tool is built from the real `buildOstTools` and invoked against every decider
> path — the path filled into *every* string argument its own schema declares,
> in three spellings, relative, absolute and dot-relative — after which all six
> decider files are compared byte for byte, the loop's state directory is compared
> for files planted *beside* a decider, and `git add -A` is run to confirm the
> sweep still cannot see any of them. **The harness surface:** each entry point's
> grant is checked to contain only names on `MCP_TOOL_NAMES` (the surface the
> previous part just exercised) and to deny every built-in that can write a path
> of its own choosing.
>
> **The fourth part is the join proper, and it is a classification rather than a
> list.** Each decider path lands in exactly one of three shelters —
> *outside-the-vault* (the transcript directory F3 measures spend from),
> *inside-dot-git* (the ledger, the open-run marker, the lock, `HEAD`), or
> *operator-owned-config* (`ost.config.yaml`) — and a path fitting none comes out
> `unclassified` and fails. All three are asserted to be in use, so none of them is
> prose that has quietly stopped applying.
>
> **What the classification exposed is worth more than the green.** Two of the
> three shelters are properties of *location* and survive any change to the grant.
> The config's is not: it is a property of the **writer** — every MCP write
> resolves to `<vault>/<sanitized title>.md`, and neither the separator nor the
> extension is the caller's to choose — plus the harness deny list. So
> `ost.config.yaml` holds three of the six Gate F inputs (`loop.cadence`,
> `loop.spend`, `loop.lockTtlMinutes`) inside the working tree, sheltered by
> exactly one thing: **W5's deny list, and W6's `set-outcome` grant staying off the
> unattended path.** One added `Bash(…)` prefix and the cadence, the ceiling and
> the lock TTL are all editable by the actor they bound. The gate's precondition
> note already said W5 was load-bearing; this says which decider falls first.
>
> **And the test's own first draft was vacuous and green, which is the failure this
> criterion is about, committed by the file asserting it.** The driver read
> `inputSchema` off each tool definition; the shipped definitions carry
> `input_schema` (`src/security/tool.ts:37`). So every generated input was
> `undefined`, every call threw *inside the `catch` written for the tools'
> refusals*, and the byte comparison passed against a surface nothing had ever
> touched. It surfaced only because a second test built its input outside the try
> and crashed. The fix is structural rather than a corrected key: inputs are built
> outside the `try`, a missing schema throws, and the run counts the argument
> fields the attack actually reached and asserts that count exceeds the number of
> calls — *the number that would have been zero while everything stayed green*.
> **A check that cannot distinguish its passing state from its broken state is not
> a check**, and this document has now watched that sentence come true on a
> citation, on a criterion status, and on a test's own driver.
>
> **The first genuine exception landed on 2026-08-05, and it is stated rather than
> absorbed.** The `degraded` verdict (F4's fifth word) reads the vault's own tool
> trace, `.ost-agent/usage/events.jsonl` — and the surface writes that file on every
> call, which is precisely what the byte-identity assertion refuses everywhere else.
> Filing it as an ordinary reader would have made part 2 fail for a true reason with
> a misleading message, so it has its own classification and its own part 5, whose
> claim is deliberately weaker: **the agent cannot forge a trace line, only cause
> one by really invoking a tool, and cannot remove one, because the allowlist has no
> tool that deletes or rewrites a file.** Both halves are driven, not argued — a real
> `ost_append_to_node` is shown appending, and the whole mutating surface is then
> aimed at the trace with a planted record in it, which survives byte for byte at the
> front. So the single direction the surface can move this verdict is *out* of
> `degraded`, by doing the work it is being asked whether it could do. The cost is
> named in the same place: this separates a firing whose surface was absent from one
> whose surface was present, not work done from work shirked.
>
> **F6 is what turns "the tree must never validate itself" from a principle into
> something with a failure mode**, and it is why W5 moved to Tier 1.

---

### Gate H — Deterministic health

Three of these five closed on 2026-07-29 with Gate F, because the event they
describe finally exists: **H1, H3 and H4 were all waiting on a firing to record,
and F1 built the firing.** What is left is H2 (met earlier) and H5.

**⛔ H1 — A firing appends one machine-readable record whose verdict comes from
exit codes.**
> *Check:* a scripted firing with one deliberately failed phase and one simulated
> kill produces exactly one record per firing with the expected verdict, and no
> command anywhere accepts a verdict from its caller.
> *Today:* **met** (2026-07-29). `ost-agent loop start | step | seal` appends
> exactly one JSONL record per firing to `<vault>/.git/ost-agent/runs.jsonl`, with a
> verdict in `healthy | unhealthy | no-op | crashed` computed only from what the
> process observed itself: the exit codes its steps actually produced, which
> required phases produced a step at all, and the vault's HEAD before and after
> (`computeVerdict`, `src/loop/health.ts:193-199`). Pinned in
> `test/cli/loop.test.ts`, which runs the real bracket — a green firing appends one
> line, a red phase seals `unhealthy` and exits 1, and a firing that never sealed is
> recorded `crashed` by the next one.
>
> **Recovered from history rather than rewritten, and repaired in two places the
> recovery made obvious.** `git show cce593b^:src/loop/health.ts` came back nearly
> intact, but its `REQUIRED_WORK_PHASES = ["sense","decide","build","ost-pass"]` was
> the deleted API-key runner's vocabulary — against the shipped firing every real
> run would have sealed `unhealthy`, and a rule that fires on everything is a rule
> someone turns off. It is now `["pass","check"]`, the two proving steps the script
> actually has. And `readRuns` admitted any line carrying a string `startedAt`,
> which is the field the cadence gate sorts on: one line reading
> `"startedAt": "tomorrow"` would answer "when did this vault last fire" forever.
> It now requires a timestamp that parses.
>
> *The record write is deliberately **not** wrapped in a blanket try/catch,* against
> the append-only fail-open convention the rest of the repo uses
> (`recordUsageEvent`, `src/telemetry/usage.ts:53-61`). That convention governs
> ledgers nothing decides on. Here the record **is** the decider: if the write
> failed silently and `seal` still exited 0, the cadence window would never be
> consumed and the vault would fire on every tick forever with no trace of why.
> Compare `computeMayRun` (`src/knowledge/lanes.ts:84-87`), which returns false when
> it does not know.

**H2 — A failed pass cannot exit 0, and no push follows one.**
> *Check:* the script gates the push on a check exit code.
> *Today:* **met** (2026-07-29). `autonomous-pass.sh:43-50` runs
> `ost-agent check --vault .` after the pass and exits 1 without pushing when it
> reports violations. `claude -p`'s own exit code reports Claude Code's health, not the
> tree's, which is why the deterministic checker is the thing consulted.
>
> Pinned by `test/automation/autonomous-pass.test.ts`, which **runs the real script**
> with `claude`, `node` and `git` stubbed on `PATH` rather than grepping it for the word
> "check" — a grep passes on a script that calls the checker and ignores what it said.
> Four assertions: a red tree exits non-zero and logs no `git push`; a clean tree does
> push (so the gate is not simply blocking everything); the check runs against the
> vault; and it runs *after* the pass, never instead of it.
>
> *This is a failure detector, not a health record.* It catches a firing that left the
> tree red. It cannot catch a firing that did nothing at all — a no-op pass over an
> already-clean tree still exits 0 and pushes nothing, and is indistinguishable from a
> productive one. That is H1/H4's job, and S1 is why the no-op case is the steady state
> today.

**H3 — Any recorded proving step could have come out red.**
> *Check:* `grep -rn 'detectLaunderedExit' src/ --include=*.ts | grep -v
> '^src/loop/exitLaundering.ts:'` is non-empty.
> *Today:* **met** (2026-07-29). `loop step` calls `detectLaunderedExit` before it
> runs or records anything (`src/cli/loop.ts`), so a phase whose exit code has been
> laundered through a pipe is refused rather than recorded green. Pinned in
> `test/cli/loop.test.ts`: a piped shell command exits 2 and writes nothing to the
> open run.
>
> **The criterion resolved the way its own entry predicted, in the cheaper of the
> two directions it named** — "H3 is met by wiring it up or by deleting it — either
> way the register changes and says so." The module's refusal message had named
> `ost-agent loop step` since before that command existed, and F1 built the command
> the message was already pointing at. Its entry came off G3's register in the same
> change, which is the register working as designed rather than being maintained.

**H4 — Omission is visible: a firing that skipped a phase does not read as
healthy.**
> *Check:* kill a firing between phases; assert exactly one record exists with
> verdict `crashed`, and that a firing which skipped a required phase reads
> `unhealthy` even when every step it *did* run exited 0.
> *Today:* **met** (2026-07-29). Omission is visible in both directions, which is
> the point — a skipped phase and a dead process fail differently and neither may
> read as success. A firing missing a required phase seals `unhealthy` on the
> phase-set check (`src/loop/health.ts:195-196`) regardless of exit codes; a firing
> that dies without sealing leaves its open record behind and is swept into a
> `crashed` record by the next `loop start`. Both pinned in
> `test/loop/health.test.ts` and `test/cli/loop.test.ts`.
>
> Note the asymmetry with F4, which is deliberate: **H4 is about a firing that did
> not finish; F4 is about a firing that finished and accomplished nothing.** The
> first is an error and reads as one. The second is not an error at all, which is
> exactly why it needed its own criterion and why H2 could never catch it.

**H5 — Attribution in the usage trace is stamped by the surface, not read from
the environment.**
> *Check:* run a tool call with `OST_SESSION`/`OST_UNKNOWN` set from an unrelated
> shell; assert the event does not carry them verbatim.
> *Today:* **met** (2026-07-30). `withUsageTracing` no longer touches
> `process.env` at all. Attribution is a parameter the surface supplies, plus an
> `AsyncLocalStorage` scope for surfaces that wrap once and learn attribution per
> call; an explicit argument wins outright over the ambient scope rather than
> merging, because a record whose `session` and `unknown` came from two different
> authorities is the exact failure this criterion is about.
>
> The MCP server **mints** `mcp-<uuid>` at construction and declares it on every
> dispatch — a value the server generates, which no unrelated shell can
> impersonate. Every other surface supplies nothing, and both fields are then
> *absent* rather than guessed: an absent field is honest and a wrong one is not.
> That costs nothing real, and checking why is what makes it a net gain rather than
> a removal — **`OST_SESSION` had no writer anywhere in the repository**, so every
> event in every real vault was already unattributed. `session` now has a writer
> for the first time.
>
> A side effect worth recording: the old code set `process.env.OST_UNKNOWN` and
> restored it in a `finally`, carrying a "NOT concurrency-safe" caveat. The scope
> makes that race unrepresentable, and two genuinely interleaved calls keeping
> separate attribution is now a test.
>
> **The adversarial pass refuted two of the lane's own non-vacuity claims and found
> the defect that mattered.** The stated falsification — reinstating the env read
> reddens the MCP suite — was false: MCP always enters the scope, so the store
> satisfies the lookup before any env fallback is reached, and only the unit test
> caught it. Worse, **every H5 test drove `createOstMcpServer`, and `ost-agent mcp`
> — what the plugin actually starts — builds `createLazyOstMcpServer`**, which
> mints its session on a different line. Replacing that line with `""` left all 133
> tests under `test/mcp` green: the criterion could have been marked met on a
> surface where `session` was empty in every real vault. The check now runs
> verbatim through the shipped factory. *A test that pins the criterion on a code
> path nobody executes is a green test asserting nothing* — the same sentence as
> F6's vacuous first draft, arriving through a door nobody was watching.
>
> *One limit left open:* no pass runner declares an unknown yet. The API accepts
> one; wiring it needs `ToolContext`, which is Gate S's territory.

---

### Gate S — The tree feeds itself

**⛔ S1 — An unattended firing on a `done` tree produces its own next evidence.**
> *Check (today):* `grep -rn 'passContext.sources\|ctx\.sources'
> src/security/tools.ts src/mcp/` is empty — `ost_ingest_inbox` constructs
> `new InboxSource(path.join(dir, inboxConfig.path))` directly
> (`src/security/tools.ts:592`) and never iterates the sources
> `buildPassContext` assembles, which the MCP server additionally suppresses with
> `skipSources: true` (`src/mcp/server.ts:269-274`).
> *Check (after H1):* three consecutive firings with zero human input; evidence
> count strictly increases and each firing yields at least one node tracing to a
> self-generated channel. Negative: a genuinely dry firing seals `no-op`, never
> `healthy`.
> *Today:* **met** (2026-07-30), pinned by `test/mcp/s1-self-feeding.test.ts`:
> three consecutive firings with zero human input, evidence strictly increasing,
> every increment tracing to a self-generated channel, `done: true` before and
> `done: false` after — plus the criterion's negative, a genuinely dry firing that
> produces nothing and does not throw. The first check's grep is committed as an
> assertion with a control regex proving the scan can fail.
>
> **`skipSources: true` was not removed — its *reason* was, and that distinction is
> the whole of the work.** The flag existed because an adapter whose credentials are
> absent in the MCP host process would throw during context construction and take
> every unrelated tool down with it, which is G1's failure mode and a closed
> criterion. So source construction now **degrades per source exactly as
> `readConfig` degrades per config problem**: each source is built inside a `try`,
> and a failure becomes a named entry on `unavailableSources` carrying its kind and
> its reason in the adapter's own words. `sources` and `unavailableSources` are a
> **partition** of what the config declares — a channel lands in exactly one, never
> neither — and `disabled` and `unavailable` are deliberately different words,
> because collapsing them recreates the ambiguity S2 exists to destroy. G1's
> property is asserted directly: with Slack and Atlassian enabled and no
> credentials, `ost_check`, `ost_read_tree` and `ost_next_work` still answer.
>
> **The feedback loop is bounded, not broken, and that is recorded as a decision
> rather than discovered later.** The usage rollup turns the vault's own activity
> into evidence. Its existing guards do not prevent the loop — `minEvents: 5` is
> met by any firing — but they *bound* it: the adapter rolls up only *finished* UTC
> days behind a watermark cursor that never revisits, so the ceiling is **one
> evidence item per calendar day of activity, however much work is done.** A
> constant, not a multiplier. It was wired anyway, because shipping a configurable
> option that records nothing is precisely what S5 forbids — but real containment
> belongs to the mapping side or to the no-op detector, not to this adapter, and
> that is worth deciding before the loop runs unattended for weeks.
>
> *Two limits on the "after H1" check, stated:* the transcript adapter is the one
> that can produce evidence **per firing**, and it is opt-in, so a default vault's
> only self-generated channel is usage — which increments once per *day*. And *"a
> dry firing seals `no-op`, never `healthy`"* is H1/H4's half; nothing here decides
> it.
>
> **The per-firing channel was not reading firings (2026-08-05).** The sentence
> above was true of the adapter and false of every vault running it. Claude Code
> keys a session directory to the cwd a session ran in; an unattended firing runs
> with cwd set to the *vault*, and `adapters.transcript.projectDir` points at the
> *code repository*. So the channel harvested the sessions in which the agent was
> worked on by a person and none of the ones in which it ran by itself: on this
> product's own meta vault, 36 cited sessions, all attended, zero firings, for the
> loop's entire life. Nothing was broken and nothing reported a gap — the cursor
> advanced, items arrived, and the half that was missing was missing silently,
> which is the shape S2 exists to catch and could not see here because the channel
> was neither disabled nor unavailable nor undated. It was healthy and half-blind.
>
> `TranscriptSource` now takes a **list** of directories, and
> `transcriptDirs` (`src/runner/context.ts`) composes it from what the vault has
> already declared: the configured project or path, plus `loop.spend.sessionsDir`
> — reusing the operator's existing declaration rather than asking for a third
> one, the same argument `src/loop/corrections.ts` makes for reading it. **Each
> item names the directory it came from** (`TranscriptDir.origin`, required), so
> the two are told apart downstream: friction in an attended session is something
> a person could have fixed on the spot, and the same friction in a firing is a
> failure mode nobody watched. Pinned in `test/adapters/transcript.test.ts` (six
> tests: both piles harvested, origin carried and not cross-contaminated, a
> missing directory not cancelling a present one, the newest-first cap spent
> across directories rather than per directory, one id harvested once) and
> `test/runner/context.test.ts` (a session in the declared `sessionsDir` becomes
> evidence labelled unattended, the path is declared exactly once, and a vault
> with no `loop:` block reads what it always read).

**⛔ S2 — Every commissioned channel is enumerable, and its silence is
detectable.**
> *Check:* a read-only command lists each channel with its last-item timestamp and
> flags any past its declared cadence.
> *Today:* **met** (2026-07-30). `ost-agent channels` is the read-only command,
> and cursor records now carry timestamps: `saveCursor` takes a `delivered`
> argument that is **the only writer of the delivery stamp**, so what is dated is
> *the channel delivered something*, never *the channel was polled*. Conflating the
> two is what hides a dead channel behind a healthy poller, and that distinction is
> asserted directly.
>
> Five states, each named and each distinct — **disabled** (turned off),
> **unavailable** (enabled, credentials absent, with the adapter's own reason),
> **silent** (past its declared cadence), **undated** (never delivered, so it cannot
> be called silent) and **healthy**. The criterion's sentence is that a dead channel
> and a quiet one must stop being the same observable, and collapsing any two of
> these back together is the way to fail it while looking green. Cadence is per
> channel and **absent means "can never be reported silent"**, following
> `loop.cadence`'s precedent that a tool which picks the number is deciding on the
> operator's behalf what "this pipeline is dead" means.
>
> The command is asserted read-only by snapshotting the vault across a run, and it
> answers against a **broken** `ost.config.yaml` — it reads through `readConfig`
> rather than `loadConfig`, because a config that will not parse is the most likely
> reason anyone runs it.
>
> **The adversarial pass found a wedge here, and it is the exact shape R2 warns
> about.** The migration left one call site passing the old three-argument
> `saveCursor`, so a channel captured notes and recorded **no delivery stamp** —
> and then read `silent` forever, no matter how many notes it delivered, with
> nothing the operator or the producer could do to clear it. `ost-agent channels`
> would have exited non-zero on a healthy vault for good. The shim now records the
> cursor and *nothing else*, so an un-migrated call site leaves the channel
> `undated`, which is what it actually is — and `undated` is never reported silent.
> *A stuck alarm is not a loud failure; it is the failure mode that gets the alarm
> switched off.*
>
> Two smaller findings from the same pass: the command originally died on the
> broken config it exists to explain, and its "cannot list channels from a config
> that could not be read" branch was **dead code no caller could reach**, exercised
> only in isolation — the shape this repository is organised against.

**S3 — Two commissioned channels are simultaneously expressible, with distinct
cursors and distinct id namespaces.**
> *Check:* configure a second inbox-shaped channel; assert it gets its own cursor
> file and its own id prefix. (Do **not** check "two evidence files with different
> prefixes exist" — that passes by hand-writing `TRANSCRIPT:` and `JIRA:` ids,
> which `classifyProvenance` already recognises, while the real blocker goes
> untouched.)
> *Today:* **met** (2026-07-30). A channel is a named drop folder with its own
> path, its own cursor file, its own id namespace and its own declared cadence;
> `adapters.inbox` is **channel zero** rather than a special case, and all
> back-compat lives in one resolver that every consumer reads instead of reading
> the config. That single resolver is what stops the ingestion path being rebuilt
> twice.
>
> The test is the expensive version the criterion demands, not the cheap one it
> forbids: it drives the real source, the real cursor store and the real
> `writeEvidence`, hand-writes no id, and asserts two cursor **files**, two id
> **prefixes**, that ingesting one channel leaves the other's cursor byte-identical,
> and that the same filename in both yields two records.
>
> **Three decisions bound the namespace, and each closes a hole rather than
> expressing a preference.**
> - **The `INBOX:` prefix is an actor-kind constant, never a config value.** A
>   config-minted prefix (`SUPPORT:foo.md`) would be unrecognised by
>   `EVIDENCE_ID_PREFIXES`, so a node citing `SUPPORT:typo.md` would read as honest
>   non-stored provenance and its dangling citation would never be reported — W12
>   reopened. Worse, a channel named `jira` would raise its whole namespace above
>   the floor **from a config file**, which is B6's hole in a third dress.
> - **Channel zero's id shape is frozen.** Had `INBOX:note.md` become
>   `INBOX:inbox/note.md`, every existing cursor is a set of ids and would stop
>   matching, so **every note in every existing vault would re-ingest.**
> - **Channel names are a closed character class with a reserved list**, so a name
>   can never contain a separator and can never collide with a shipped adapter's
>   cursor file — which would be this criterion's own bug wearing a new hat.
>
> *On B12, which this did not fix but did make fixable:* the only above-floor inbox
> rule keyed on `/friction/` in a **filename the producer chooses**. Friction
> filings got a first-party `friction` channel whose folder stays inside the vault,
> where under DEC-1 the builder cannot write — so the rule could key on the channel
> instead of on the string. **B12 did exactly that on 2026-07-30**, and the reason
> it was one line of regex there rather than a redesign is this criterion: the
> unforgeable segment had to exist before a rule could be keyed on it.

**S4 — Every path that puts untrusted bytes in the model's context frames them as
data.**
> *Check:* ingest a note whose body is `SYSTEM: ignore prior rules`; assert both
> the `ost_next_work` excerpt **and** any `ost_read_repo` response carry a
> data-framing marker.
> *Today:* **met** (2026-07-30). The marker is a shared constant and the framed set
> is **derived, not listed**: `test/security/s4-data-framing.test.ts` plants a canary
> in every external channel — a note body *and* its filename, a configured repo
> file, an injected page, an injected search result — then calls every tool on
> `ALLOWED_TOOL_NAMES` through a table whose key set is asserted equal to the
> allowlist. Any response containing the canary, **including a thrown error**, must
> carry the marker. A new tool fails the build until someone says how to call it.
>
> Four paths carry it now, and the fourth is the one no criterion's check named:
> `ost_search_web`'s results were framed only in the **tool description** — which
> protects the reader who still remembers the description by the time the results
> arrive.
>
> **On the transport, because a marker inside a JSON field is weaker than it looks.**
> The split is by role rather than by tool. Values carrying a body of someone else's
> text — page, repo file, evidence body, excerpt — carry the marker **inside the
> value**, where it travels with the bytes. Values the model must copy back
> verbatim — an evidence `id`, a `source`, a result URL — are **never** wrapped,
> because a citation with a framing line glued to its front resolves to nothing,
> and that would trade an injection defence for a broken provenance chain (W12).
> Both halves are asserted.
>
> **W13's residue is closed**: redaction moved *into* `displaySafeTitle`, ahead of
> the control-character flattening and the length cap — so a key split across the
> cap cannot slip through, and every display path a title takes, including the
> error branches, is masked without anyone having to remember to mask it.
>
> *The boundary, stated because it is a judgement and the test encodes it:* the
> property covers bytes **the vault did not author**. A node title the model chose
> while mapping an untrusted note is vault content thereafter — it passed the write
> guard and title sanitisation — so the four reporters are unframed by design, and
> `ost_read_tree` is asserted *not* to carry the marker, so "frame everything"
> cannot pass by spraying the sentence.

**S5 — Every shipped adapter is reachable from a live caller, or is not
constructed at all.**
> *Check:* enumerate `grep -rn 'export class .*Source' src/adapters/` — today
> Inbox, Transcript, Usage, Atlassian, Slack — and assert each class name appears
> in a construction reachable from an MCP tool or a live CLI command.
> *Today:* **met** (2026-07-30). All five are constructed from the live context and
> ingested by the live tool. Pinned by `test/adapters/s5-adapter-reachability.test.ts`,
> which **derives** the adapter list by scanning `src/adapters/` for
> `export class …Source` rather than writing it down, so a sixth adapter fails the
> build until it is wired or removed — the `module-reachability.test.ts` idiom.
>
> Three layers, and the third is the one that matters: constructed outside
> `src/adapters/`; that construction import-reachable from a real entry point; and
> **behaviourally, one live instance per class from a config that enables
> everything.** The first two would have passed on the old code, because
> `skipSources: true` made the wiring look present while nothing was constructed —
> which is exactly the bug this criterion is about.
>
> *One limit, stated:* Atlassian and Slack are covered by construction and by the
> unavailability path, not by exercising `fetchSince`. Both take an injected client
> precisely so they can be tested offline, and reaching the network in a test is
> forbidden here — so what is pinned is that they are built and ingested, not that
> their pagination is right.

**S6 — A malformed evidence file degrades one record, never the whole read.**
> *Check:* write `.ost-agent/evidence/bad.md` containing
> `---\nfoo: [unclosed\n---\nbody\n` alongside two valid records; assert
> `readEvidence(dir).length === 2`.
> *Today:* **met** (2026-07-29). The parse is per-file and the failure is per-record
> (`src/processes/tree.ts:45-77`), so one unparseable document no longer takes
> `ost_next_work` — the only tool the unattended sweep gates on — down with it. The
> file itself is untouched and still in git; what is dropped is its appearance in the
> list. Pinned by `test/processes/evidence-read.test.ts`, which also pins that *missing*
> frontmatter still degrades to defaults rather than being dropped, so the new
> `try`/`catch` cannot quietly widen into discarding merely sparse records.
>
> *One dependency quirk worth recording, because it will confuse the next reader:*
> gray-matter memoizes on the content string and populates that cache *before* parsing,
> so identical malformed bytes throw the first time they are seen in a process and
> return a junk record every time after. Harmless here — the read survives either way —
> but it makes any test that reuses one malformed fixture order-dependent, and the test
> file above uses a distinct fixture per case for exactly that reason.

---

### Gate Z — Forever means bounded

"Arbitrarily large" plus "nothing is ever deleted" makes this load-bearing rather
than theoretical. **The gate becomes unreadable long before it becomes slow.**

**⛔ Z1 — `ost_next_work` never throws on a large tree.**
> *Check:* build **500** near-identical same-layer Opportunities — the smallest
> size once proven to fail — and assert `computeNextWork` returns without throwing.
> (Do not use 5,000: at O(n²) that fixture builds ~12.5M issue objects and will
> exhaust memory before the assertion is reached, so the test cannot run.)
> *Today:* **met** (2026-07-29) — *and it was already met when this entry said
> `not met`, which is the finding.* Re-running the 500-Opportunity reproduction
> returns in **186 ms** with 125,750 hygiene issues. The `RangeError` came from
> `issues.push(...findNearDuplicateIssues(tree))` spreading an O(n²)-sized array
> into `Function.prototype.apply`'s argument list, and **R4's own commit deleted
> that line** while rewriting `detectHygiene` to derive from `checkInvariants`:
> `git log -L 156,156:src/mcp/next-work.ts` shows the spread replaced by
> `for (const d of findNearDuplicateIssues(tree)) issues.push({ ...d, rule: … })`
> (`src/mcp/next-work.ts:156`). Nobody re-ran the check, and the citation went on
> pointing at `:113`, which is now a `HYGIENE_LABELS` entry.
>
> **This is Z5's failure mode — "a criterion whose status outlived the code it
> described" — repeated on a blocker, and it is the second time.** It is also the
> exact hazard the near-miss in R4's own entry describes: a fix that moves a
> criterion nobody thought to re-check. Unlike Z5, this one moved in the safe
> direction; the same mechanism moving one the other way is G3. **A status is a
> claim, and until it is a test it is memory.** Pinned now at
> `test/mcp/large-tree.test.ts`, so the next rewrite of the dedupe path cannot
> silently reopen the hole the way the last one silently closed it. The pin asserts
> the issue set is non-empty rather than merely that nothing threw — a bare
> `.not.toThrow()` would stay green if the quadratic pass were skipped instead of
> fixed, which is the same vacuity W4 records.

**⛔ Z2 — Every unbounded list in a tool response is capped, with the hidden count
named.**
> *Check:* assert `JSON.stringify(computeNextWork(...))` and the `ost_read_tree`
> response each stay **under 200 KB** on a 5,000-node vault, and that each capped
> list names its hidden count.
> *Today:* **met** (2026-07-30). The pattern is `openUnknowns`', which this entry
> already called correct and which is now applied everywhere: **cap the display,
> compute every verdict over the full set, name the hidden count so a cap can never
> read as amnesty.** Measured on a 10,000-node vault, before → after:
> `ost_check` 3,795,008 → 14,659 B, `ost_debt` 500,043 → 15,995 B, `ost_gate`
> 72,979 → 3,924 B; `ost_read_tree` 137 KB and `ost_next_work` 14.6 KB on the
> criterion's 5,000-node fixture. Pinned by `test/mcp/response-size.test.ts` and
> `test/eval/render-caps.test.ts`, each with a control asserting the *uncapped*
> shape blows the same budget on the same fixture.
>
> **It took two rounds, because the criterion's sentence is wider than its check.**
> The first round capped the two tool responses the check names and left the four
> renderers — `ost_check` was still emitting 3.8 MB, which is the criterion's own
> worst case. That gap was reported rather than papered over, and closing it is
> what makes the sentence true.
>
> **Capping per rule rather than flat is the decision worth recording.** On the
> fixture the violations are 8,438 `rung-unearned` + 3,500 `assumption-mapped` + 1
> `solution-mapped`; a flat `slice(0, 25)` prints **zero** `rung-unearned` lines —
> the largest class disappears entirely behind the two that sort first. So each
> rule class carries its own window and its own full count, and the same argument
> put `renderDebt`'s solutions into per-state groups. A flat cap does not hide
> items, it hides *kinds*, which is amnesty in a subtler form.
>
> Two things are deliberately never charged against the byte allowance: headers and
> totals. Dropping a count to save bytes is precisely the failure this criterion
> names. And `done`, every summary count and every red/green verdict read the full
> set — `hygieneIssues`' total comes from a counter rather than an array length, so
> the near-duplicate scan counts all 125,750 while materializing at most 25, which
> also removes the 12.5M-object memory bomb Z1 used to trip over.
>
> **The adversarial pass found a regression the caps themselves introduced, and it
> is the best argument for the whole exercise.** `formatCensus` emits the
> independent-denominator alarm *last* — `git tracks 122 markdown file(s); the walk
> enumerated 121 … every count in this vault is short by at least that much` — and
> the new cap sampled that block as one 25-item list. Sixty harmless stray files
> crowded the alarm out of `ost_check` and `ost_status` entirely, and nothing on the
> surface pages to it. **An alarm that can be elided by being too alarming is not an
> alarm.** It now takes its own window first, with a degraded one-line form when
> even that will not fit.
>
> *Two smaller findings from the same pass, both about the tests rather than the
> code:* the byte allowance was **decoration** — setting it to infinity left all
> four renders byte-identical and the suite green, so the item cap was doing all
> the bounding and the paragraph defending the allowance defended nothing; and
> `appendUnexplained`'s cap had never been exercised above one item, despite being
> the one list that can make `ost_check` red on a structurally perfect tree, which
> is exactly this criterion's case. Both now have fixtures that discriminate.
>
> *One list stays uncapped on purpose:* `appendAttention`'s per-class rollup is one
> line per declared unknown class — O(vocabulary), not O(tree).

**Z3 — `ost_next_work` and `ost_check` complete within a fixed wall-clock budget
at 10,000 nodes.**
> *Check:* benchmark test, under 2,000 ms each.
> *Today:* **met** (2026-07-30). Measured at the **tool** surface, so `ost_check`'s
> git reconciliation is inside the number: `ost_next_work` 620–750 ms and
> `ost_check` 600–770 ms on a 10,000-node vault, against the criterion's 2,000 ms.
> The near-duplicate scan went from 2,150 ms to ~10 ms at 2,000 titles. Pinned by
> `test/mcp/wall-clock-budget.test.ts`, which asserts the budget *and* that both
> tools actually found work — a wall-clock assertion over a tool that returned
> early is the vacuity this document keeps re-learning.
>
> `src/ost/dedupe.ts` tokenizes once per title and blocks candidates through an
> inverted index over a prefix of each title's rarest tokens, plus a length filter.
> **The filter is exact, not heuristic**, and that mattered enough to prove twice:
> `test/ost/dedupe-scale.test.ts` carries the pre-change implementation verbatim as
> a reference and asserts identical output element-for-element at four thresholds,
> and the adversarial pass fuzzed the two against each other over **24,000
> randomized trials** — mixed layers, stopword-only, punctuation-only and unicode
> titles, 9,213 of them with non-empty answers — with zero mismatches. Two further
> quadratic passes in `computeNextWork` (a `find` inside a `map`, twice) became
> single-pass maps, and the annotation-suppression check is memoized per node.
>
> *The boundary, stated because the number flatters the change:* this is a ~200×
> constant, **not a change of asymptote**. With a finite vocabulary the candidate
> set still grows superlinearly, and on a vault of near-identical titles the
> *answer* is quadratic — no search strategy shortens it. What bounds that case is
> Z2's generator and materialization cap, not this index.
>
> **The budget was breached, the gate caught it, and nobody read the gate for a
> week (2026-08-06).** Between 07-30 and 08-05 the tree acquired four structural
> rules (`single-parent`, `test-mapped`, `assumption-mapped`, the wikilink and
> empty-subject checks). Three of them answered "who links to this node?" with
> `tree.filter(...)` **per node** — a full scan per Solution, per Assumption and
> per AssumptionTest, with an `Array.includes` inside each, which at 10,000 nodes
> is ~80M link comparisons and profiled at **44% of all CPU in this benchmark**.
> `ost_next_work` drifted 620ms → ~1,600ms and `ost_check` 600ms → ~1,570ms on the
> same laptop these figures were first taken on.
>
> The instructive part is not the quadratic — this document already records two of
> those — it is **how the failure was read**. Local runs still passed (1,600 of
> 2,000ms), so the drift was invisible to anyone developing; CI, on a slower box,
> failed six runs out of six at 2,045–2,183ms, on `main` as well as on branches.
> Three of those reds were treated as a flaky timing test and left, and this
> vault's inbox holds two friction filings from 08-01 saying exactly that. **A
> perf gate that fails only on the slowest machine that runs it will be read as
> the machine's fault every time**, and the tell that it is not is cheap: measure
> the number the gate reports against the number the criterion recorded. That
> comparison was available all week and nobody made it.
>
> Fixed by using the inbound-edge index `single-parent` had already built twenty
> lines further down — the three scans above it simply never used it.
> **`ost_next_work` 522–540ms, `ost_check` 463–469ms** on the same machine, which
> is now faster than the original figures and restores a ~3.8× margin. The rules'
> behaviour is unchanged by construction: the index holds parent *nodes*, one
> entry per (parent, link) occurrence, so `single-parent` still double-counts a
> duplicated edge exactly as it did.
>
> **The cheap tell above does not work, and that is now measured rather than
> assumed (2026-08-10).** "Measure the number the gate reports against the number
> the criterion recorded" scores **5 of 10** on ten perf-gate failures whose
> causes were arranged — this same drift, reinstated around this same
> `computeNextWork` call, against real CPU contention — against a bar of 8 fixed
> before the count (`test/eval/perf-gate-noise-band.test.ts`). Worse than the
> number: it calls **every** failure a regression, for an arithmetic reason that
> reaches every criterion here carrying both figures. A gate fires at `measured >
> budget`; this budget is 2.67× the recorded high; so breaching it already entails
> exceeding the 2× that comparison would use, and the second number decides
> nothing the first had not. Adding the run-to-run spread does not rescue it —
> also 5 of 10, because twenty spinners on ten cores are a *steady* tax rather
> than jitter. What did separate the fixture, 10 of 10 and exploratory rather than
> pre-registered, was timing a second much smaller call on the same box in the
> same trial and reading the ratio between them: contention moves both numbers, a
> quadratic moves one. **That is a change to what a criterion records when it is
> closed, not a cleverer reading of what it already says** — no criterion in this
> document records a control today, this one included.

**Z4 — Retired nodes leave the denominator.**
> *Check:* assert `readTreeCensus` supports a status/archive filter and that the
> quadratic passes use it.
> *Today:* **met** (2026-07-30), in two halves that are deliberately kept apart
> because one is forgeable by the agent and the other is not. Pinned by
> `test/ost/retired-nodes.test.ts`.
>
> **Archive is human-only, so it applies everywhere.** An `archive/` directory under
> the vault cannot be expressed by any tool — `nodePath` rejects any title
> resolving to more than one path segment — so a node a human archives is retired
> on every read. Those files were previously *invisible* to the walk; they are now
> counted and named, following `formatCensus`'s precedent that a denominator must
> report what it excluded.
>
> **Status is agent-settable, so it applies in exactly one place.** The vocabulary
> is `NodeStatus`, and `RETIRED_STATUSES` is `["deferred"]` — the only member that
> means *not working on this* (`unvalidated` is the stamp on everything the agent
> creates; `validated`, `shipped` and `in-discovery` are live). Because the agent
> can set `deferred`, `readTreeCensus({excludeRetired: true})` feeds **one**
> consumer, the near-duplicate scan. `readTree()`, `checkInvariants` and every term
> of `done` still see retired nodes, and the test asserts the attack directly:
> a dangling link, an evidence-class gap, and retiring the entire tree each still
> block `done`.
>
> *The residue, stated because it is a real capability and not an oversight:*
> retiring a node **does** clear a near-duplicate suspicion naming it. That rule is
> the one hygiene signal with no invariant behind it — it reports a suspicion, and
> in an append-only vault abandoning the redundant node *is* the remedy, at the
> same cost of one recorded call that annotating would take. Every invariant-backed
> rule is untouched, which is the line that keeps this from being B10 by another
> route.
>
> *Two of the three attack tests were near-vacuous when first written*, and the
> adversarial pass caught it: they asserted only that *some* `dangling-link` rule
> survived, and under the exact mutation they exist to catch — feeding
> `detectHygiene` the retired-filtered tree — removing a node makes its *parent's*
> link dangle, so a fresh violation appeared and both stayed green while the attack
> succeeded. They now name the surviving violation's owner.

**Z5 — A web lookup does not cost a full vault parse.**
> *Check:* spy on `Vault.readTree`, inject a stub fetch, set `OST_UNKNOWN`, call
> `ost_search_web` against a **3-node** vault; assert zero `readTree` calls. (The
> verdict is size-independent; a large fixture only makes the test slow, and a
> live fetch makes it unrunnable in CI.)
> *Today:* **met** (2026-07-29), and it was already true when this said
> otherwise. The parse belonged to `spendClass`, which computed which class to
> charge a per-class lookup budget; the gene's default was an empty map, so
> nothing was ever charged and the scan bought nothing. Deleting the genome
> deleted the scan with it (`src/web/budget.ts:16-19`), and this entry went on
> citing a `spendClass` that `grep -rn 'spendClass' src/ test/` no longer finds
> anywhere. **A criterion whose status outlived the code it described** — pinned
> now at `test/security/web-lookup-cost.test.ts`, which spies on
> `Vault.prototype.readTree` across the provider path, the no-provider delegation
> path and `ost_read_web`, and carries a control asserting the spy observes a
> parse when one really happens (`:59-64`), so the three zero-call assertions
> cannot pass vacuously.

---

### Gate G — Policy integrity

**The genome was deleted rather than fixed.** `genome.yaml`, `src/harness/` and
`src/eval/correlate.ts` are gone as of `8261a6f`, and with them three of this
gate's four original criteria: a genome that could outrank the operator's config,
genes that reached no consumer, and a policy file nobody could pin. The argument
is in the commit message; the short form is that the genome existed so policy
could breed, breeding required a harness, and the harness could never promote a
winner. Infrastructure for a loop with nothing on the other end.

What survives is the half that was never about the genome.

**⛔ G1 — A malformed file at the vault root degrades one capability, never the
whole tool surface.**
> *Check:* write `web:\n  lookupBudget: notanumber` to `<vault>/ost.config.yaml`;
> call `ost_check` and `ost_read_tree`. **Pass =** both succeed, falling back to
> defaults with a named warning.
> *Today:* **met** (2026-07-30), pinned by `test/mcp/broken-config.test.ts`, which
> runs the check above verbatim. This was originally written against `genome.yaml`,
> where it was *verified*: a two-line malformed file returned `isError` from
> `ost_check`, `ost_next_work`, `ost_read_tree`, `ost_create_node` and
> `ost_ingest_inbox` alike. **Deleting the genome removed one such file, not the
> failure class** — `loadConfig` threw, `buildPassContext` called it before anything
> else, and every tool is built through that call, including the ones that never read
> the config.
>
> `readConfig` (`src/config/load.ts:73-93`) reports a broken file instead of throwing
> on it, and `loadConfig` is now a throwing wrapper over it, so the two surfaces can
> differ without two parsers. The MCP server opts into tolerance
> (`src/mcp/server.ts:274`); the CLI does not, deliberately — **a human at a shell has
> someone to tell and a fix one edit away, and the unattended surface has neither.**
>
> **The half that makes it a degradation rather than a fallback is the refusal.**
> Falling back to defaults everywhere would have satisfied the sentence and broken
> G2: an operator who set `web.lookupBudget: 2` and then mistyped something else would
> silently get the schema default, which is *a broken file widening a bound*. So the
> five tools the file governs — `ost_ingest_inbox`, `ost_search_web`, `ost_read_web`,
> `ost_read_repo`, `git_push` — refuse by name (`CONFIG_DEPENDENT`,
> `src/security/tools.ts:769-775`), and everything else answers with a warning naming
> both the problem and what stopped. A default is a fallback, never a substitute for
> the operator's intent.
>
> *One thing this had to give back.* Recovery-on-fix used to be free: the throw meant
> nothing was cached, so the first call after the human edited the file built the real
> context. Tolerating the file removed that accident, and caching the degraded context
> would have traded a session-long outage for a session-long refusal *after* the file
> was correct. A degraded context is therefore never cached
> (`src/mcp/server.ts:276-284`), which costs one small file read per call and stops the
> moment it parses. A YAML *syntax* error now degrades the same way as a schema
> violation, which it did not before — `parseYaml` throwing was uncaught entirely, so
> the file that is not YAML failed differently from the file that is YAML but wrong.

**G2 — No file the agent can write may widen a bound the operator set.**
> *Check:* `grep -rn 'lookupBudget' src/` shows exactly one source for the limit
> — `config.web.lookupBudget` — with no `??` fallback that another file can win.
> *Today:* **met**, by deletion. `createLookupBudget(limit, opts)`
> (`src/web/budget.ts`) takes the operator's number and nothing else;
> `test/runner/context.test.ts` pins that a `genome.yaml` at the vault root is
> inert. Kept as a criterion because it is a property worth re-checking every
> time a new policy file is proposed, not a one-time cleanup.

**G3 — No module ships with zero non-test callers.**
> *Check:* for each module in `src/`, assert its name appears in at least one
> `import` outside `test/`. (Computing the dead set mechanically is the point —
> "excluding dead modules" as a manual carve-out lets whoever runs the check make
> it pass by declaring more modules dead.)
> *Today:* **met** (2026-07-29). **The debt register is empty**
> (`KNOWN_UNREACHABLE = {}`, `test/release/module-reachability.test.ts:59`), and it
> emptied itself rather than being emptied. `test/release/module-reachability.test.ts`
> walks the import graph from entry points **derived** from `package.json` (the
> esbuild bundle entry and the `tsx` dev entry, both `src/cli/index.ts`) plus
> whatever `scripts/` imports.
>
> | Module | How its entry came off |
> |---|---|
> | `src/loop/exitLaundering.ts` | H3's detector, whose refusal message named `ost-agent loop step` before that command existed. F1 built the command; `loop step` now calls it before it runs or records anything. |
> | `src/adapters/tokens.ts` | Reads token spend from Claude Code's session JSONL. F3's ceiling is the consumer it was written for and never had — the correlator its header names (`src/eval/attention.ts`) never imported it. |
>
> **Both entries came off because a criterion that needed them landed, which is the
> only ending this register was designed to have.** Its two entries had described
> "a module that is dead by neglect" and "a module that is dead because its
> criterion has not been built yet" — the register existed precisely so those two
> would stop looking alike, and in the event both turned out to be the second kind.
>
> *One trap worth recording, because the obvious way to close this criterion is to
> fake it.* The walk measures **import**-reachability, not call-reachability, so
> registering a `commander` subcommand is enough to make a module "reachable"
> whether or not anything ever invokes it. Wiring `tokens.ts` behind a `spend`
> command nobody calls would have satisfied the test while changing nothing — the
> inverse of the manual carve-out this criterion's check warns about. Both modules
> here are reached from a path the shipped `autonomous-pass.sh` actually executes.
>
> The criterion was once recorded as met because the module that motivated it
> (`correlate.ts`) had been deleted and nobody enumerated the rest; writing the pin
> moved it to *not met*, and building Gate F moved it back. Reachability is the
> assertion rather than "is imported at least once", because two dead modules that
> import each other pass the weaker form. The register is asserted by **exact
> equality**, not as a floor: widening it is a visible commit that has to argue for
> itself. A debt register, not an exemption — and now a paid one.
>
> The rule earns its place under DEC-2: the harness was the repo's only
> prediction/outcome/score triple, and a harness varying a gene that reached no
> consumer would have reported a fitness delta for a policy nobody applied —
> manufacturing corroboration out of noise, which is the exact pathology DEC-2
> exists to prevent.

**G4 — Policy does not evolve unattended.**
> *Check:* `ls src/harness src/genome` finds nothing, and no code path writes a
> policy file into a vault.
> *Today:* **met** (2026-07-29), and for the first time something runs it.
> Re-introducing an evolvable policy needs the replay holdout, variance
> decomposition and promotion gate that the removed harness never had — that is the
> bar, and it should be met before a second attempt, not after.
>
> **This entry read "met, by deletion" with nothing pinning it, which is exactly
> the configuration G3 was in before its pin was written — and G3 turned out to be
> wrong.** It was the document's last remaining *met carried by memory*.
> `test/release/no-evolvable-policy.test.ts` now runs both clauses. The directory
> half is trivial. The write half is asserted three ways: ten candidate policy
> files are dropped at a vault root — `genome.yaml`, `policy.yaml`,
> `ost.policy.yaml`, the near-miss spellings `ost.config.yml` and
> `ost.config.json`, and five more — each raising `lookupBudget` to 99, and the
> operator's bound survives every one, with a control asserting the probe can
> observe the bound change at all so the ten zero-effect assertions cannot pass
> vacuously. Then every mutating MCP tool is driven against a scratch vault and the
> config comes out byte-identical, with the exercised set checked against
> `MCP_TOOL_NAMES` so a new tool cannot join the surface unexercised. That
> generalises G2's pin, which only ever covered the one filename that used to
> exist.

#### The mechanisms that may never become tunable

Salvaged from the deleted `docs/reference/genome.md`, because it is the clearest
statement in the repo of what must stay fixed — and the argument is a measurement
argument, not squeamishness. **A variant able to relax any of these would score
well by corrupting the instrument rather than by being better**, and no fitness
number can tell those two apart.

| Mechanism | Where it lives | Why it can never be tunable |
|---|---|---|
| **The tool allowlist** | `ALLOWED_TOOL_NAMES`, `assertNoDestructiveTool` (`src/security/policy.ts`) | The closed set of capabilities OST-Agent may ever hold. Anything that could add a name could add `rm`. |
| **The lane gate** | `LANES`, `computeMayRun`, `CAUTIOUS_LANE` (`src/knowledge/lanes.ts`); `flagHumansRequired` (`src/ost/lanes.ts`) | Exactly one lane carries `computeMayRun: true`, and it fails closed on an unknown, missing or future id. The setter is restrictive-only *by having no lane parameter* — the absence of the parameter is the safety argument. |
| **The invariant checker** | `checkInvariants` (`src/eval/invariants.ts`) | Structural truths, model-independent. `no-self-validation` is the rule that stops a variant declaring its own work validated. |
| **The SSRF guard** | `assertAllowedUrl`, `isPrivateIpv4`, `MAX_REDIRECTS` (`src/web/guard.ts`) | Outward sensing crosses a trust boundary exactly once. `TIMEOUT_MS` and `MAX_PAGE_CHARS` are arguably cost parameters, but they sit inside the guard and extracting them risks loosening it by adjacency. |
| **The believability floor** | `FLOOR_RUNG` (`src/knowledge/believability.ts`); `TRUST_CEILINGS` (`src/knowledge/actor-trust.ts`) | Anything unjustified sinks to `assertion`, and each kind of actor has a fixed ceiling — `expert` for a byline, and `money` for nobody. Promoting a page to first-party-measurement strength is the same category error as self-validation. |
| **The promotion gate** | `gateSolution`, `hasRecordedResult` (`src/eval/evidence-debt.ts`) | Extracting the referee into the thing being refereed is the category error the whole design avoids. |

Also fixed, for the same family of reasons: `CHILD_HIERARCHY` (a rewritten tree
grammar produces trees `checkInvariants` rejects — crashed runs rather than
measured ones), `SECRET_PATTERNS` (a narrowed table leaks credentials into a
committed vault), the append-only fail-open ledger writes, and `OST_RULESET`,
which is distilled Torres canon and safety rules rather than tunable policy.

> **`SECRET_PATTERNS` is fixed, not frozen, and W13 is the worked example of the
> difference.** Its keyword rule was retuned on 2026-07-29 because it mangled the
> customer verbatims the inbox exists to carry, and the change was *measured* —
> false positives 67% → 20%, missed credentials 19% → 6% — with both halves pinned,
> so the recall floor cannot be quietly traded away for precision on prose. That is
> what "may never become tunable" means here: not that the table is immutable, but
> that **no variant may loosen it to score better**, because a variant that relaxed
> the mask would look identical to one that had genuinely learned to leak less. A
> human may edit it in a diff that argues for itself and shows the numbers. Nothing
> automated may.

---

### Gate D — Distribution and truthful documentation

**D1 — The release gates pass.**
> *Check:* `npx tsc --noEmit` exits 0; `npx vitest run` is green;
> `test/release/version.test.ts` passes; the bundle-drift check is green — run locally by
> `ost-agent ship`, and separately by the `bundle-drift` job in `.github/workflows/ci.yml`.
> As of 2026-08-06 the workflow is a signal rather than a gate: the build loop merges on
> gates it runs and watches itself, so a GitHub Actions outage no longer strands finished
> work (`src/release/ship.ts`, `test/release/ship-repo.test.ts`).
> *Today:* **met** — 3,208 tests across 269 files, verified 2026-08-20 (`npx vitest run`,
> after "Every self-observation channel names which of its sources each item came from"
> was given its second permit's definition of done:
> `test/adapters/source-attribution.test.ts` closed the gap between a citation that
> *claims* a stored evidence record and one that *resolves* — `ost_create_node` now
> refuses a source that names no record, checked at write time rather than left to
> `ost_check`'s sweep, while still allowing a node to cite the live session that is
> writing it (well-formed and merely unharvested is not the same as nothing;
> `resolveClaimedSource` in `src/processes/tree.ts` is the distinction)). Before that:
> "Every response that can be refused for size states its size first" was given its
> definition of done: `test/mcp/size-probe-precedes-refusal.test.ts` built a real size
> probe on `ost_read_repo` (`probe: true` returns a file's `bytes`/`wouldTruncate` from the
> `stat` a normal read already takes, without `fs.readFileSync`, redaction, or the binary
> sniff) and pinned why the other size-capped reads do not get one. The assumption beneath
> it predicted a split between file-backed and computed-aggregation reads; the split found
> is narrower — `ost_read_repo` resolves a caller-given PATH directly, so its `stat` is
> free, while `ost_read_tree({node})` and `ost_next_work({evidence})` resolve a
> caller-given TITLE/ID by scanning every file in the vault to validate it, so a probe
> would cost the same walk as the read it is meant to avoid (pinned by counting
> `fs.readFileSync` calls, not assumed). For those, the cap-and-disclose-in-the-same-call
> behaviour Gate Z already built is what "states its size" means; a separate probe would
> cost a turn to save nothing, exactly the failure mode the solution's own "where this
> fails" clause names.
> Previously 3,194 tests across 267 files, verified 2026-08-20 (`npx vitest run`,
> after "Every regretted write becomes a new pre-write invariant, so the class cannot
> recur" was given its definition of done: `test/ost/regretted-write-invariants.test.ts`
> replays ten writes this vault's own History and Issues sections record a human
> considering a mistake — a wrong-argument-name `undefined`, an empty annotation, a
> wrapped wikilink, a second parent, a dangling edge, a layer-mismatched edge, a merge
> laundering an untested node's evidence, a tag smuggling a heading — against the live
> tool surface; 8 of 10 are refused mechanically today, clearing the assumption test's
> 6-of-10 bar, and 2 are deliberately left uncaught because catching them needs reading a
> prior pass's reasoning in prose, not the call's own arguments. One of the eight needed
> building rather than merely confirming: `## History` joined `RESERVED_HEADINGS`
> (`src/ost/headings.ts`), so `editProse` and `mergeNodes` now carry a node's History
> section across a rewrite the way they already carried `## Results`, closing the specific
> regret ("A tool call I got slightly wrong destroyed the note I was filing," 2026-08-05)
> where three re-parenting records were silently dropped by an edit that did not
> reproduce them. What it does not settle: the fixture set is drawn from regrets that were
> *noticed and written down*, so it says nothing about the harder, unrecorded class.
> Previously 3,181 tests across 266 files, verified 2026-08-20 (`npx vitest run`,
> after "Every refusal a surface returns is recorded as tree evidence, not just as a
> failed call" was given its definition of done: `classifyUsageEvent` (`src/adapters/
> usage.ts`) tells a permission denial apart from a tool's own error by a `denied` field
> stamped at capture — `withUsageTracing` sets it only when the thrown value is a
> `PermissionDeniedError` (`src/telemetry/usage.ts`), never by reading the message's
> wording — and `brokeredFetch`'s existing refusal for an out-of-grant target now throws
> that type instead of a plain `Error`, the one in-process denial this repository already
> had (`test/adapters/usage-denial-classification.test.ts`). What it does not settle: the
> host-level MCP permission denials the parent opportunity's corroboration notes describe
> are refused before this process's own code ever runs, so they still cannot be captured
> this way — the classifier is proven feasible and wired to one real call site, not to
> every surface that can refuse a call.
> Previously 3,174 tests across 265 files, verified 2026-08-19 (`npx vitest run`,
> after "Every recorded step carries the directory and argv it actually ran with" was
> given its definition of done: `reconstructInvocation` and `recentNonZeroExitSteps`
> (`src/loop/replay.ts`) answer the mechanical half of "Try to reproduce ten recorded
> failures from the record alone" — whether a step's `cwd` and `argv` are present and
> well-formed enough to rebuild the invocation — over the 10 most recent real
> non-refused failures in the meta vault's own ledger, closing 10 of the pre-committed
> 5-of-10 bar (`test/loop/record-replay-sufficiency.test.ts`,
> `test/fixtures/record-replay/PROVENANCE.md`). What it does not settle: whether the
> rebuilt command reproduces the original exit code, which stays a person's judgement;
> and the literal 10-most-recent-non-zero-exits reading of the assumption test would
> have been cleared by construction, since every `refused: "spend-ceiling"` step
> carries perfect `cwd`/`argv` despite never having spawned a command at all —
> `recentNonZeroExitSteps` excludes them for that reason, named in the fixture's
> PROVENANCE. Previously, after "Every path the config declares is checked when the
> config is read, not when something reaches for it" landed: `readConfig` now runs
> `declaredPathDiagnostics` (`src/config/load.ts`) on every successful read, naming
> `product.repos` as absent when `adapters.transcript.projectDir` names a repository
> and `product.repos` was never set — the one required-but-absent shape the 2026-08-06
> sweep actually hit (`test/config/declared-path-validation.test.ts`).
> Previously 3,162 tests across 264 files, verified 2026-08-19 (`npx vitest run`, after
> "Every machine-selected quote carries the sentence it was cut from" landed:
> `sentencesAround` (`src/ost/lanes.ts`) generalises the whole-sentence rendering
> `proseLaneAmbiguity` already did for a two-lane declaration to the other lane-triage
> quoting surfaces — `proseDeclaredLane`'s clean single-lane quote, `laneConflicts`, and
> `suggestCaution`'s outside-person hint each now carry the sentence a fragment was cut
> from, not just the fragment (`test/ost/quote-full-sentence.test.ts`). What it does not
> settle: the node's own second stated weakness, that a qualification can sit outside the
> declaring sentence entirely — the next sentence, or a `## Issues` annotation added
> months later — which no sentence-level rendering reaches; and the change is scoped to
> the lane-triage family the originating bug was found in, not literally every quoting
> surface the opportunity names — `transcript-model-reader.ts`'s reading quotes and any
> future quoting surface remain unaudited.
> Previously 3,152 tests across 262 files, verified 2026-08-19 (`npx vitest run`, after
> "End-of-session retrospective the agent must write before the session closes" landed:
> `fileRetrospective` (`src/adapters/retrospective.ts`) and `ost-agent retrospective`
> (`src/cli/index.ts`) file one confession of a session's wrong turn into a new
> first-party `retrospective` channel, refusing to write at all when there is nothing to
> confess — no "nothing notable" shape exists in the module, so a quiet session leaves the
> channel's folder with zero files rather than an empty item
> (`test/adapters/session-retrospective.test.ts`).
> Previously 3,128 tests across 259 files, verified 2026-08-18 (`npx vitest run`,
> after "Each run gets a workspace named after itself, so two runs cannot collide" landed:
> `workspacePathFor` and `prepareWorkspace` (`src/runner/workspace.ts`, wired as
> `ost-agent workspace`) derive `<base>/ost-<runId>` and link its `node_modules` to an
> already-installed shared tree rather than reinstalling
> (`test/runner/per-run-workspace-cost.test.ts`). The pre-committed 20% wall-clock
> allowance turned out to only hold once the comparison includes the workspace's mutable
> half (the checked-out source, rewritten every firing regardless of naming scheme) —
> measured against the link step alone, in isolation, a fresh directory entry costs
> 10-15x an idempotent no-op check on this machine, not 20%, because "reuse in a tight
> loop with nothing else happening" has no marginal cost to be a percentage of. What it
> does not settle: the assumption test's own named gap, that two live per-run worktrees
> symlinking one shared `node_modules` are isolated in their working trees and not
> isolated at all in their dependencies — a run on a branch with different requirements
> would still overwrite another run's packages, silently, on every number this test
> reports.
> Previously 3,124 tests across 258 files, verified 2026-08-18 (`npx vitest run`,
> after "Each agent writes on its own branch, and merging is a deliberate, reviewable
> step" landed: `createAgentBranch` and `mergeAgentBranch` (`src/git/branch-isolation.ts`)
> give one pass its own checkout via `git worktree add -b` and bring a branch back as one
> real merge commit — no strategy option, no `-X ours`/`-X theirs` — so a genuine collision
> (a same-titled node created on both branches, competing appends to one parent's link
> list, a status changed on both sides) is left as conflict markers rather than resolved by
> picking a side (`test/git/branch-isolation-merge.test.ts`). What it does not settle:
> whether a *resolution* of one of those conflicts is any good — that is a person grading
> it against what both sides meant, and it is the assumption test's own humans-required
> half, unaddressed here on purpose.
> Previously 3,109 tests across 256 files, verified 2026-08-18 (`npx vitest run`,
> after "Classify the steps of ten past runs as credentialed or not, and see how much
> work sits upstream" landed: `classifyStep` and `independentFraction`
> (`src/loop/credentialedSteps.ts`) replay ten of this repository's own past runs and
> found 5 of 10 clear "half the steps independent of any credentialed step", one short
> of the 6-of-10 bar the solution node beneath it pre-committed
> (`test/loop/credentialed-step-independence.test.ts`). The reorder itself — "Do
> everything that needs no credential first, and bank the rest into one approval" — is
> unbuilt; this assumption test did not clear it. Before that, "Detect the
> authentication that already exists and say exactly which one will be used" landed:
> `detectAuthentication` (`src/security/auth-detection-report.ts`) resolves the same
> offers `credentialBrokerFromEnv` does and reports, before anything spends a
> credential, which will be used or why each candidate was rejected — never echoing a
> secret (`test/security/auth-detection-report.test.ts`). What it does not settle:
> consent to the probe itself, which is the assumption test beneath it and still
> unresolved.
> Previously 3,082 tests across 254 files, verified 2026-08-18 (`npx vitest run`,
> after "Detect that no terminal is attached and answer the prompt from a stated policy"
> landed: `answerPromptUnattended` (`src/runner/no-tty-policy.ts`) classifies a prompt
> against a fixed must-stop set — a destructive overwrite, a force push — that no policy
> line can shadow, then against a policy the operator wrote, and journals the question,
> the answer and the citing policy line for the ones it answers
> (`test/runner/no-tty-policy-answer.test.ts`). The assumption test beneath it never
> recorded a result — the two-person prompt sort it specified was never run — so this
> closes the instrument, not the desirability question. It is on the module-reachability
> debt register (`test/release/module-reachability.test.ts`): this repository has no
> subprocess call site with an inheritable stdin for it to answer on behalf of yet.
> Previously 3,066 tests across 253 files, verified 2026-08-18 (`npx vitest run`,
> after "Detect renames from link topology and repair the edge" landed:
> `findRenameShapedBreaks` (`src/git/rename-topology.ts`) walks a vault's git history for
> a commit where one node file went empty and another appeared carrying its exact
> outgoing link set — link-set identity, not title similarity, is the signal — and
> `liveRenameRepairs` (`src/ost/rename-repair.ts`) / `Vault.repointEdge` turn a match that
> STILL leaves a dangling edge on the live tree into a repaired one, exposed as
> `ost-agent repair-renames` (reports by default, `--write` applies and commits;
> `test/ost/rename-link-repair.test.ts`). The assumption test beneath this solution never
> recorded a result — no human ran the "≥2 incidents beyond the known one" audit this
> build permit rested on — so this closes the instrument, not the desirability question:
> whether renames outside Obsidian happen often enough to be worth this is still unweighed.
> Previously 3,064 tests across 252 files, verified 2026-08-18 (`npx vitest run`,
> after "Detect drift at write time and refuse, naming what changed since the read"
> landed: `Vault.beginPlan()` (`src/ost/plan.ts`) pins a fingerprint of every node a
> plan reads, and every `write` on it checks ALL of those — not only the write's own
> target — before doing anything, so the first drift found compromises the plan for
> good and nothing it does after that moment ever lands. A `PlanCompromisedError` is
> distinct from the single-file `DriftError` `Vault.editProse` already threw, so a
> caller can tell "this call needs a retry" apart from "this whole plan is void"
> (`test/ost/premise-drift-coherence.test.ts`).
> Previously 3,053 tests across 251 files, verified 2026-08-18 (`npx vitest run`,
> after "Derive the whole consequence set from the premise and ask about all of it at
> once" landed: `formatConsequenceBatch` (`src/loop/premise-consequence.ts`) presents
> every decision a stated premise implies as one batch, with each item's dependency link
> and proposed default, and `classifyEncounter` tells a question the run meets mid-firing
> apart from one the batch already covers (`test/loop/premise-consequence-set.test.ts`) —
> a shape spec only; whether a derivation is *complete* is the sibling assumption test's
> question, run by a human against a blind derivation.
> Previously 3,042 tests across 250 files, verified 2026-08-18 (`npx vitest run`,
> after "Derive the next version from the registry, never from the local file" landed:
> `deriveNextVersion` (`src/release/next-version.ts`) takes the maximum of what the
> registry has ever published — including numbers later unpublished — and what `origin`
> has tagged, and increments from there, replayed against every real `ost-agent` release
> including the 2026-07-26 near-collision it targets (`test/release/registry-derived-version.test.ts`).
> Parked on the module-reachability register rather than wired: `RELEASING.md` was
> rewritten 2026-07-27 to say there is no publish step and no npm package, and
> `package.json` has carried `"private": true` since that commit, so there is no live
> release path left for this to coordinate.
> Previously 3,037 tests across 249 files, verified 2026-08-18 (`npx vitest run`,
> after "Declare the tool surface a pass requires and abort in the first second if it is
> absent" landed: `ost-agent tool-surface` lists a live MCP surface's `tools/list` and
> confirms a pass's declared `required-tools` against it — zero tool invocations, no
> partial credit across surfaces — closing what `required-tools`' own `LIVE_SURFACE_CAVEAT`
> named as unchecked: whether the surface a run actually fires with is the list handed to
> `--available` (`src/runner/tool-surface-preflight.ts`,
> `test/runner/tool-surface-preflight.test.ts`).
> Previously 3,024 tests across 248 files, verified 2026-08-17 (`npx vitest run`,
> after "Declare the distance to the real goal as named darkness, so the gap is inventory"
> landed: `ost_create_node` refuses to create an Unknown whose body has no non-empty
> `## Format` section — a bare heading with nothing under it counts as missing, same as
> no heading at all — instead of leaving the contract advisory in the tool's description
> alone. A node written straight to the vault (predating the refusal, or edited outside
> the tool surface) is unreachable from that boundary, so `ost_next_work`'s `openUnknowns`
> still names `Format` in that node's `gaps`, which needed no new code — `contractGaps`
> already read presence, not content, correctly
> (`src/knowledge/unknowns.ts`, `src/security/tools.ts`,
> `test/ost/unknown-format-required.test.ts`).
> Previously 3,019 tests across 247 files, verified 2026-08-17 (`npx vitest run`,
> after "Creating a vault writes the tool-enabling config into the project beside it"
> landed: `init` now merges `.claude/settings.json`'s enabling keys in automatically,
> using a `jsonc-parser`-based merge (`src/config/settings-merge.ts`) proven safe across
> five real-shaped settings fixtures, including one that already enables a different
> plugin and one carrying comments the merge preserves rather than overwriting. It skips
> the write (never overrides) when the operator explicitly disabled the plugin, and when
> the pre-existing file cannot be safely parsed — and the merged file is proven byte-for-
> byte untouched by the unattended MCP surface, same as `ost.config.yaml`
> (`src/runner/init.ts`, `test/config/settings-merge-safety.test.ts`,
> `test/release/no-evolvable-policy.test.ts`).
> Previously 3,009 tests across 246 files, verified 2026-08-17 (`npx vitest run`,
> after "Compare what the run attempted against what it set out to do, and report the
> shortfall" landed: `ost-agent loop scope <statement>` freezes a run's intended scope
> before its first step is recorded — a declaration after a step exists, or a second
> declaration at all, is refused — and `loop seal --attempted <statement>` diffs the
> attempt against that frozen file (never a caller-supplied restatement of it), printing
> the dropped terms next to the result as a fact rather than a verdict
> (`src/loop/scope.ts`, `test/loop/scope-shortfall.test.ts`).
> Previously 2,999 tests across 245 files, verified 2026-08-17 (`npx vitest run`,
> after "Classify the failed match by comparing the file against the run journal's
> recorded read" landed: a run-scoped `ReadJournal` records the content hash of every
> file a run reads, and `classifyFailedMatch` compares a failed replacement's file
> against it — a hash that has moved since the read is reported as stale-file, a
> byte-identical file as bad-quote, and a file with no journalled read as an explicit
> cannot-say rather than either guess, meeting the assumption test's three-arm bar
> (`src/runner/failed-match-attribution.ts`, `test/runner/failed-match-attribution.test.ts`).
> The module has no live caller yet — no tool-call interception surface in this
> repository feeds its journal from a real Read or Edit — and is parked on the
> reachability register (`test/release/module-reachability.test.ts`) pending one.
> Previously 2,995 tests across 244 files, verified 2026-08-17 (`npx vitest run`, after
> "Census every check whose expected and actual sides are drawn from the same
> source" landed: a syntactic provenance census (`scripts/provenance-census.ts`) traces
> both sides of every `expect(actual).matcher(expected)` call to the import or local
> declaration each side resolves to, scored against the three files that independently
> derived the MCP prefix and agreed with the bug for 23 releases. The census flags 0 of
> 3 — confirming the parent assumption's prediction that a shared-symbol census misses a
> belief three files derived independently rather than one symbol they read in common —
> and sizes the population it can see over the rest of the suite: 36 same-source
> assertions across 21 of 243 test files (`test/guards/provenance-census-scores-against-known-defects.test.ts`).
> Before that, after "Carry a content hash from read to write and refuse on drift, naming what drifted"
> landed: a read now hands back a content-hash fingerprint alongside the file, and
> `Vault.editProse` — the one write that can silently discard something, a full-body
> replace — presents that fingerprint back before it writes, refusing with a message
> naming what moved (not a generic miss) when the node's file changed underneath it.
> Replayed against the vault's own transcript evidence: the one session whose own
> clarifying question named a concurrent writer is correctly labelled drift, the ten
> others carrying an Edit failure with no concurrent writer recorded are correctly
> labelled not-drift, and a false-refusal sweep across 200 real source files in this
> repository found zero (`src/git/read-write-hash-guard.ts`, `src/ost/vault.ts`,
> `test/git/read-write-hash-drift.test.ts`).
> Before that, after "Capability estimated from what each collaborator was asked to do and
> what came back" landed: the routing record — every commit and PR reachable from HEAD in
> this repository and the vault, classified into a work class and attributed to whoever it
> named — shows 3 of 5 work classes (build, review, release) were ever routed to more than
> one collaborator, clearing the 40% bar the assumption test pre-committed
> (`src/product/routing-record.ts`, `test/product/routing-record-capability.test.ts`).
> Previously 2,980 tests across 242 files, verified 2026-08-17 (`npx vitest run`, after
> "Candidate tournament that eliminates on grounded evidence rather than
> promoting on vibes" landed: a bracket of Solutions runs against a tree's own recorded
> results, eliminating a candidate only when a test beneath it recorded a `refuted` verdict,
> citing the verbatim `## Results` line — no round crowns a candidate, the consideration set only
> shrinks, and declaring a winner stays a human's call (`src/eval/tournament.ts`,
> `test/eval/tournament-elimination.test.ts`).
> Previously 2,952 tests across 240 files, verified 2026-08-17 (`npx vitest run`,
> after "Budget against a same-run baseline instead of against the clock" landed:
> `ost_next_work` timed alongside a same-run baseline call to the same function on a
> much smaller vault, gated on the ratio between the two rather than on an absolute
> millisecond bound, which is what the two 2026-08-01 flakes (2004ms and 2280ms against
> Z3's 2,000ms budget, both passing cleanly seconds later run alone) needed and did not
> have (`test/telemetry/same-run-baseline-ratio.test.ts`).
> Previously 2,938 tests across 238 files, verified 2026-08-17 (`npx vitest run`,
> after "Believability ladder required on every node" closed a gap its own review
> surfaced: the weakest-rung rollup excluded unlabelled nodes from the weakest-rung
> computation entirely, so a tree with nine strong-rung nodes and one undeclared node
> reported the strong rung as the tree's weakest belief — a floor the undeclared node
> never earned (`src/knowledge/believability.ts`, `test/ost/evidence-class-on-every-node.test.ts`).
> Previously 2,934 tests across 237 files, verified 2026-08-16 (`npx vitest run`,
> after "Be found through the agent ecosystem's own directories rather than through
> product channels" landed: packaging for two agent-ecosystem directories — a generic
> MCP client config and a third-party Claude Code plugin-marketplace listing — each
> spawning the committed bundle outside a vault to prove its documented install command
> actually starts a server, and neither reaching for the npm package this repo retired
> on purpose (`docs/distribution/*.json`, `test/release/registry-install-path.test.ts`).
> Previously 2,931 tests across 236 files, verified 2026-08-16 (`npx vitest run`,
> after fixing the ingest channel's commit-time conflict scan: `stagedConflictMarkers`
> and the installed `pre-commit` hook each spawned one `git show`/`git`-plumbing process
> PER staged file, which turned a burst of a few thousand notes into ~30s of subprocess
> overhead — past this suite's own `testTimeout` and, on a live MCP surface,
> indistinguishable from a hang. Both now read the whole staged index in a constant
> number of git invocations (`src/git/conflict-guard.ts`,
> `test/adapters/ingest-backpressure-provenance.test.ts`).
> Previously 2,930 tests across 235 files, verified 2026-08-16 (`npx vitest run`,
> after the instrument overwrite guard landed: `ost_set_instrument` refuses to overwrite
> a test that already carries a command unless the call explicitly declares `replace:
> true`, naming the command at risk in the refusal without spelling out the escape
> (`src/security/tools.ts`, `test/instruments/overwrite-guard.test.ts`).
> Previously 2,923 tests across 234 files, verified 2026-08-16 (`npx vitest run`,
> after "Assert on work units instead of milliseconds" landed: an instrument
> measuring whether `ost_next_work`'s own file-read count tracks its elapsed time
> across vault sizes (`test/telemetry/work-units-vs-elapsed.test.ts`).
> Previously 2,921 tests across 233 files, verified 2026-08-12 (`npx vitest run`,
> after "ask the host for the credential it already holds" landed: a registry of the
> host surfaces this repository ships entry points for, each resolving a host-held
> credential or recording that the host exposes none (`src/security/host-delegation.ts`,
> `test/security/host-credential-delegation.test.ts`).
> Previously 2,911 tests across 232 files, verified 2026-08-12 (`npx vitest run`,
> after a shipped solution's claim became something the repository settles as an
> observation rather than a red-now instrument (`src/ost/instrument.ts`,
> `test/ost/shipped-observation-queue.test.ts`).
> Previously 2,906 tests across 231 files, verified 2026-08-12 (`npx vitest run`,
> after the MCP auto-commit message gained the affected node's `source:` frontmatter
> when it has one, so an operator replaying `git log` can attribute a change without
> opening the vault (`src/mcp/server.ts`, `test/git/commit-provenance.test.ts`).
> Previously 2,903 tests across 230 files, verified 2026-08-12 (`npx vitest run`,
> after evidence age-out landed: an unmapped item may leave `unmappedEvidence` for the
> standing `agedOutEvidence` backlog line only once it is BOTH past the operator's
> `evidence.ageOutDays` (absent ⇒ off) AND redundant with a record some node has already
> cited — age alone never buries a novel item (`src/mcp/next-work.ts`,
> `test/evidence/age-out-preserves-novel.test.ts`).
> Previously 2,895 tests across 228 files, verified 2026-08-12 (`npx vitest run`,
> after the multi-level subtree count landed: `opportunitiesServedBeneath`'s existing
> exemption is now pinned at arbitrary depth, not only the one hop the category-exemption
> spec already covered (`test/ost/underserved-subtree-count.test.ts`).
> Previously 2,892 tests across 227 files, verified 2026-08-12 (`npx vitest run`,
> after condition-based suppression landed: a pass's decline recorded against a
> machine-checkable fact takes the item off every work bucket only while the fact holds —
> re-evaluated on each read, disclosed on the response, prose refused at the write funnel
> (`src/knowledge/suppressions.ts`, `test/ost/suppression-condition.test.ts`).
> Previously 2,886 tests across 226 files, verified 2026-08-12 (`npx vitest run`,
> after sight provenance landed: both instrument write boundaries stamp a `sight` field —
> `grounded`/`blind` — derived from `product.repos` and its readability at the moment of
> the write, never from a caller parameter, and `debt`/`status` report the two as separate
> figures (`src/product/repo.ts`, `test/instruments/sight-provenance.test.ts`).
> Previously 2,874 tests across 225 files, verified 2026-08-12 (`npx vitest run`,
> after the spec-path resolution guard landed: `ost_set_instrument` and `ost_create_node`
> resolve an instrument's spec path against the configured `product.repos` and refuse one
> that resolves to nothing, unless the test pre-commits a bound threshold — the same
> escape `confirmPermit` grants a vacuous red — or no repo is configured at all
> (`src/security/tools.ts`, `test/instruments/spec-path-resolution.test.ts`).
> Previously 2,863 tests across 224 files, verified 2026-08-12 (`npx vitest run`,
> after the judge panel landed: three independently-configured lexical judges each nominate
> every solution's riskiest assumption from the argument prose alone, majority agreement is
> 7 of 10 over a committed corpus of real Solution bodies with zero full scatter, and a
> panel over nothing reports BLIND rather than a clean run
> (`src/eval/judge-panel.ts`, `test/eval/judge-panel-agreement.test.ts`).
> Previously 2,856 tests across 223 files, verified 2026-08-12 (`npx vitest run`,
> after the corroboration-filing spec landed: thirty evidence items from one channel filed
> against one existing opportunity leave `unmappedEvidence` genuinely empty rather than
> cap-hidden, count as 30 corroborations on that node, create no node, and leave the node
> file byte-identical — the evidence rung and the rollup's source count both unmoved
> (`test/evidence/corroborate-disposition.test.ts`).
> Previously 2,855 tests across 222 files, verified 2026-08-12 (`npx vitest run`,
> after the end-of-session deposit channel landed: a collaborator's answer is stored
> byte-for-byte verbatim in `.ost-agent/deposits/`, ingests at the assertion floor, and
> the deposit path appends nothing to the trust ledger
> (`src/adapters/deposit.ts`, `test/adapters/deposit-prompt.test.ts`).
> Previously 2,845 tests across 221 files, verified 2026-08-12 (`npx vitest run`,
> after the upward vault search landed: with three nested vaults and two sibling vaults on
> one machine, ten start directories each resolve to the vault that contains them —
> nearest first, never a sibling — a start contained by no vault returns nothing rather
> than guessing, and the derived answer ranks below every recorded one and is announced
> on stderr whenever it redirects a command away from its cwd
> (`src/config/vault-search.ts`, `test/config/upward-vault-search.test.ts`).
> Previously 2,829 tests across 220 files, verified 2026-08-11 (`npx vitest run`,
> after acknowledgement verdicts landed: an acknowledged evidence item leaves
> `unmappedEvidence` without being deleted or mapped, its reason persists append-only, and
> `corroborates [[X]]` is stored as a typed verdict distinct from "no genuine need" — only
> the first can strengthen a node's evidence later
> (`src/knowledge/dispositions.ts`, `test/ost/acknowledge-evidence.test.ts`).
> Previously 2,819 tests across 219 files, verified 2026-08-11 (`npx vitest run`,
> after ambient-driver parity landed: the same fixed pass driven once by direct in-process
> tool invocation — the deleted API runner's dispatch shape — and once through a real MCP
> client/server pair produces identical node sets and edges over identical fixture vaults,
> so the ambient session route demonstrably loses and misplaces nothing a dedicated driver
> would have kept (`test/loop/ambient-driver-parity.test.ts`).
> Previously 2,818 tests across 218 files, verified 2026-08-11 (`npx vitest run`,
> after the allowlist registration audit landed: the fail-closed allowlist guard now runs
> inside `buildOstTools` itself, so every surface — including the CLI `manifest`/`refusals`
> commands that previously built the full set unguarded — refuses at construction if a
> non-allowlisted tool is ever registered, and the audit enumerates the registered set over
> a live MCP transport rather than comparing constants
> (`src/security/tools.ts`, `test/security/allowlist-registration-audit.test.ts`).
> Previously 2,813 tests across 217 files, verified 2026-08-11 (`npx vitest run`,
> after ruleset proposals landed: the agent drafts a change to its own ruleset as a
> reviewable proposal carrying the friction evidence ids that triggered it, a pending or
> rejected proposal never alters the ruleset a pass executes, and adoption is one
> attributed human CLI action
> (`src/knowledge/ruleset-proposal.ts`, `test/knowledge/ruleset-proposal.test.ts`).
> Previously 2,799 tests across 216 files, verified 2026-08-11 (`npx vitest run`,
> after the adversarial grounding judge landed: a critic pass that attacks every claim
> outrunning its backing, structurally unable to create or remove a node and refusing to
> emit an objection that does not name the evidence that would settle it
> (`src/eval/critic.ts`, `test/eval/adversarial-critic-invariants.test.ts`).
> Previously 2,789 tests across 215 files, verified 2026-08-11 (`npx vitest run`,
> after credential intake landed: each form the operator already holds — an env var
> another tool set, a personal access token, a session token, an OAuth grant, `gh`'s
> stored login — resolves to the one secret shape the broker holds, refusals name every
> route tried without echoing the value, and the accepted-form registry is counted
> against the assumption's at-most-six bar
> (`src/security/credential-forms.ts`, `test/security/credential-forms.test.ts`).
> Previously 2,769 tests across 214 files, verified 2026-08-11 (`npx vitest run`,
> after the early-push collision window landed: the recorded 2026-07-26 collision
> replayed against real git with skeleton pushes on a cadence, git's own
> non-fast-forward refusal arriving within 21 minutes of the colliding commit at a
> 30-minute cadence, against the 5h51m the status quo's single final push measured
> (`src/loop/early-push.ts`, `test/loop/early-push-collision-window.test.ts`).
> Previously 2765 tests across 213 files, verified 2026-08-11 (`npx vitest run`,
> after the whole-tree ranked ledger landed: every Solution in one order at
> `<vault>/.ost-agent/RANKED-LEDGER.md`, a row whose reason is missing, empty, or cites
> no node title or stored evidence id refused a rank into a named unranked tail, with an
> `ost-agent ledger` CLI surface
> (`src/ost/ranked-ledger.ts`, `test/ost/ranked-ledger-reasons.test.ts`).
> Previously 2752 tests across 212 files, verified 2026-08-11 (`npx vitest run`,
> after the tightening migration landed: `ost-agent migrate evidence-class` remediates
> the one past tightening that flagged every pre-existing node, with frontmatter-only
> edits a test holds byte-identical after the closing delimiter, a node-by-node report,
> and a refusal list naming what only a human may decide
> (`src/ost/migrate.ts`, `test/ost/tightening-migration-meaning.test.ts`).
> Previously 2737 tests across 210 files, verified 2026-08-11 (`npx vitest run`,
> after the standing pending-ask queue landed: every needs-a-person lane classification
> files an aged ask carrying its clearing command, `outstandingAsks` assembled from the
> ledger plus every labelled needs-a-person test rather than `blockedOnPermission`
> alone, and an `ost-agent asks` CLI surface the operator clears at their own cadence
> (`src/ost/pending-asks.ts`, `test/ost/pending-ask-queue.test.ts`).
> Previously 2731 tests across 209 files, verified 2026-08-11 (`npx vitest run`,
> after the standing tree briefing landed: `<vault>/.ost-agent/BRIEFING.md` regenerated
> in full from the tree each pass, naming the weakest rung of the believability rollup
> as the belief the tree rests on (`src/ost/standing-briefing.ts`,
> `test/ost/standing-briefing.test.ts`).
> Previously 2717 tests across 208 files, verified 2026-08-11 (`npx vitest run`,
> after the standing authority contract landed: decision classes drafted from the oldest
> eight recorded question-stops, held out against the nine newest on the vault's
> pre-committed bars, with an `authority` CLI surface a run consults at a fork
> (`src/loop/authority-contract.ts`, `test/loop/authority-class-holdout.test.ts`).
> Previously 2704 tests across 207 files, verified 2026-08-11 (`npx vitest run`,
> after the standing Next Build briefing landed: one stable address per vault
> (`<vault>/.ost-agent/NEXT-BUILD.md`), rewrites that fold the superseded reading into
> History so the file only ever grows, and a `next-build` CLI surface to read and
> rewrite it (`src/ost/briefing.ts`, `test/ost/next-build-briefing.test.ts`).
> Previously 2696 tests across 206 files, verified 2026-08-11 (`npx vitest run`,
> after evidence-extent decorrelation landed: sibling opportunities whose cited evidence
> collapses, nests, or entangles are hygiene issues (`shared-extent` / `subset-extent` /
> `entangled-extent`, `src/ost/extent.ts`) — the provenance half of duplicate detection,
> clustered and posting-list-indexed so the wall-clock budget holds on the 10,000-node
> fixture whose 2,000 siblings share one record
> (`test/ost/extent.test.ts`, `test/mcp/wall-clock-budget.test.ts`).
> Previously 2688 tests across 205 files, verified 2026-08-11 (`npx vitest run`,
> after branch-scoped discovery landed: a human-set `discovery.target` scopes the sweep
> and `done` to one opportunity's subtree, everything scoped away is counted in
> `scope.excluded`, a mistyped target runs unscoped and loud, and the tool surface has
> no parameter that could carry a target — the selection is structurally human
> (`src/mcp/next-work.ts`, `test/mcp/scoped-next-work.test.ts`).
> Previously 2679 tests across 204 files, verified 2026-08-11 (`npx vitest run`,
> after the mid-firing spend halt landed: the ceiling is stamped into the run record at
> `loop start` and enforced at every `loop step`, so a pass that crosses it is stopped at
> the next phase boundary — the phase is never spawned, the refusal is on the ledger, and
> widening the config mid-firing widens nothing
> (`src/cli/loop.ts`, `test/loop/spend-ceiling.test.ts`).
> Previously 2674 tests across 203 files, verified 2026-08-11 (`npx vitest run`,
> after the shipped-status audit landed: `solutionsMissingInstruments` excludes a shipped
> solution only when `## History` records the promotion with reasoning, and every module a
> trusted node names is audited against the repository, live vault included
> (`src/eval/shipped-audit.ts`, `test/ost/shipped-status-audit.test.ts`).
> Previously 2664 tests across 202 files, verified 2026-08-11 (`npx vitest run`,
> after the shell-necessity census landed: 14,802 recorded Bash invocations partitioned
> into argv-expressible and shell-bound, the argv path proven shell-less against every
> recorded failure class, and the assumption's 70% bar measured at 12.3% — NOT met
> (`src/runner/shell-necessity.ts`, `test/runner/shell-necessity-census.test.ts`).
> Previously 2630 tests across 201 files, verified 2026-08-10 (`npx vitest run`,
> after the setup-check diagnosis spec landed: the four toolless scheduled passes replayed
> as fixtures each get the missing `.claude/settings.json` and the exact
> `"ost-agent@ost-agent": true` line named, and the shipped example vault's settings draw
> no accusation (`src/config/setup-check.ts`, `test/config/setup-check-diagnosis.test.ts`).
> Previously 2622 tests across 200 files, verified 2026-08-10 (`npx vitest run`),
> after the exit-code-observation containment spec landed: a recorded exit code writes only
> to the instrument log, never to `## Results`, never changes status, and leaves the
> evidence gate BLOCKED — asserted for red, for green-after-red, and for the refused
> first-run green, which must leave the node byte-for-byte untouched
> (`test/runner/exit-code-observation.test.ts`).
> Previously 2618 tests across 199 files, verified 2026-08-10 (`npx vitest run`),
> after the run-journal interruption spec landed: ten runs SIGKILLed at seeded points, and
> **0 of 10** journals overstated with **0** understating, against a bar of 0 overstating /
> at most 2 understating fixed by the assumption test before the journal existed
> (`src/loop/journal.ts`, `test/loop/run-journal-interruption.test.ts`).
> Previously 2614 tests across 198 files, verified 2026-08-10,
> after the hand-exclusion census landed: **4** distinct test files have ever been
> suppressed by hand across 657 recorded sessions, against a bar the assumption test fixed
> at 3 before anyone counted — so a committed quarantine list has subjects. What the same
> census refutes is the argument for it: **0** of the 4 was excluded in a second session,
> three of the four were excluded by one subagent inside two minutes, and hand exclusion is
> 14 of 1912 runner invocations (`src/telemetry/hand-exclusion.ts`,
> `test/telemetry/hand-exclusion-census.test.ts`, `test/fixtures/hand-exclusion/PROVENANCE.md`).
> Earlier, after the refusal-coverage census landed: of the **24** distinct refusal classes in 646
> recorded sessions, a manifest folded from tool schemas alone could have named **8**
> (33%) against a bar the assumption test fixed at 60% before anyone counted — and on the
> reading the solution's own cost argument means, a rule a schema *keyword* carries, **0
> of 24**. So "a preflight manifest states every tool precondition" is refuted as stated,
> and what is committed is the generator, the census that refuted it, and the manifest the
> generator does produce (`src/security/preflight-manifest.ts`,
> `src/telemetry/refusal-coverage.ts`, `test/preflight/manifest-covers-observed-refusals.test.ts`).
> Previously 2469 tests across 190 files, verified 2026-08-10,
> after the perf-gate noise-band replay landed: ten gate failures with arranged causes,
> and the measurement-against-recorded comparison Z3 recommends separates **5 of 10** of
> them against a bar of 8 fixed before the count — refuted as a classifier, and what is
> committed is the corpus and the three-way score that refuted it
> (`src/eval/perf-noise-band.ts`, `test/eval/perf-gate-noise-band.test.ts`). Before that,
> the path-failure attribution census: of 76 path-shaped failures in 646
> recorded sessions, **0** arrived through a tool this repository controls, against a bar
> the assumption test fixed at 40% before anyone counted — so "make the first path failure
> answer with the layout it was addressed against" is refuted as stated, and what is
> committed is the census that refuted it rather than the improvement it was meant to
> license (`src/telemetry/path-failure-attribution.ts`,
> `test/friction/path-failure-attribution.test.ts`). That command being green means the
> count has been taken, never that the assumption held — `census.meetsBar` is asserted
> `false` by name, on the convention `test/telemetry/preflight-uncertainty-census.test.ts`
> already runs under.
> Previously 2404 tests across 188 files, verified 2026-08-09,
> after the sense census landed: a firing's closing report now enumerates every sense it
> reads with — the tree, the product repo, both web senses, every declared channel — each
> carrying a state derived from config and grant rather than from what the pass happened to
> touch, so a sense nothing reached for is distinguishable in the report from one that
> worked. It is a reporter and decides nothing: seal's exit code is still computed from the
> verdict alone (`src/loop/senses.ts`, `test/loop/sense-census-report.test.ts`, classified
> under `REPORTER_MODULES` in `test/release/gate-f-deciders.test.ts`).
> Previously 2385 tests across 187 files, verified 2026-08-09,
> after the vacuous-red distinction landed: an instrument naming a spec file nobody had
> written exited non-zero, was recorded `**red**`, and minted a build permit whose stated
> definition of done an empty file would have satisfied. It was not a rare edge — of the
> meta vault's 266 recorded reds on 2026-08-09, 260 read "No test files found" and 241
> pointed at specs that never existed, so the tree's whole stock of evidence that its tests
> could fail was evidence that they had not been written. Such a run is now observed
> `no-spec` rather than red and is filed rather than refused, so the node keeps the
> actionable fact. Whether it also loses the permit is set by the tree's own evidence
> rather than by the rule of thumb: the opportunity "My instruments are red because a file
> is absent, not because the behaviour is" records one complete weak-red lifecycle that
> ended green in a day, carried by the node's pre-committed threshold after the builder
> found the path empty — so a weak red keeps its permit when the threshold is bound, and
> loses it only when there is neither a spec nor a fixed bar. Measured against the meta
> vault, that leaves 180 of 241 affected permits standing and withdraws 61
> (`src/ost/instrument.ts`, `src/eval/buildable.ts`, `test/eval/vacuous-red.test.ts`).
> Previously 2373 tests across 186 files, verified 2026-08-09,
> after the category exemption landed: `underservedOpportunities` counted an opportunity's
> DIRECT solution children, so a heading holding dozens of solutions two levels down still
> read as under-served and sent every pass to ideate under it — the one place a solution
> does not belong. A node that files sub-opportunities is now exempt, but only while its
> subtree holds a solution at all: an empty heading is a genuine gap and is still reported,
> and every exemption is counted and named in the summary, because a heading that goes
> quiet unannounced is indistinguishable from a tree that got better
> (`src/processes/tree.ts`, `src/mcp/next-work.ts`,
> `test/ost/next-work-category-exemption.test.ts`). Previously 2369 tests across 185 files,
> verified 2026-08-07,
> after the work claim landed: a pass now takes the work item before it builds it, and the
> claim is keyed on the *briefing item* rather than on the pass's own wording — the two
> readings that collided on 2026-07-26 ("invited-visitor arm split" and "add an arm column
> to `visitor_events`") score 0.29 on the title similarity `ost_next_work` dedupes with, so
> a claim keyed on wording would not have stopped it. `src/loop/claim.ts`,
> `test/loop/work-claim-vocabulary-match.test.ts`, `test/cli/claim.test.ts`; the ledger is
> enumerated in `test/release/gate-f-deciders.test.ts` as an off-gate decider input, so the
> unattended surface is proved unable to forge or erase a claim by the same byte-for-byte
> comparison Gate F's own deciders get. Previously 2344 tests across 183 files, verified
> 2026-08-07,
> after the disposition ledger landed: `ost_next_work` has a notion of *closed* for the
> first time, so work a pass settled stops coming back on the next list. One append-only
> sidecar entry type carries all three faces — an evidence id acknowledged, a solution
> shipped, an opportunity served by its children — and every bucket reads it through one
> call that takes a subject and nothing else, so no bucket can grow a rule of its own
> (`src/knowledge/dispositions.ts`, `test/ost/disposition-ledger-shape.test.ts`). The
> write is `ost-agent dispose`, a human's command and deliberately not on the agent's
> surface: this is the one write that removes work by asserting rather than by doing, and
> whether a pass should ever hold it is an open question about operators. Every withheld
> item is named and counted on the response that withheld it, so a `done` reached by
> settling is legible as such. Previously 2326 tests across 181 files, verified 2026-08-07,
> after the required-tool precondition landed: the skill now declares `required-tools`
> beside `allowed-tools`, and a pass whose surface is missing one of the three it cannot
> work without refuses at second zero rather than discovering the gap at the call that
> needed it. Missing a *would-use* tool still starts the pass and reports the narrowing —
> without that half the check would refuse every scheduled firing over `ost_check`,
> `ost_flag_humans_required` and `ost_rank_source`, which this repo withholds on purpose,
> and a gate that reads as an obstacle is a gate that gets switched off
> (`test/mcp/preflight-required-tools.test.ts`). Previously 2306 tests across 180
> files, verified 2026-08-06,
> after the search-literality census landed: of the 850 search arguments this project has
> issued over its own node text, 125 of the 126 whose text came out of the tree are
> expressible as literal lookups — 99%, against a bar of 90% fixed before the count — while
> 246 of 724 hand-written arguments need real pattern semantics. The two axes come apart,
> and the census publishes the ladders that would move its verdict rather than asking to be
> trusted on where "literal" was drawn
> (`test/telemetry/search-literality-census.test.ts`). Previously 2124 tests across 173
> files, verified 2026-08-06,
> after the allowlist generator landed with its guard: a run's permission allowlist is now
> derived from the skill's own `allowed-tools` rather than hand-copied beside it, and the
> derivation refuses from an agent session, refuses to widen an existing grant without a
> human's install-time confirmation, and treats a grant a human narrowed by hand as a
> choice rather than as drift to repair — cases two and three are the *same* state on disk,
> which is why it refuses in both rather than guessing which happened
> (`test/security/allowlist-generator-guard.test.ts`). Previously 2109 tests across 172
> files, verified 2026-08-06,
> after the build permit was made to confirm itself against the repository: a permit is
> read off a recorded observation, an observation is a fact about the day it was filed,
> and nothing re-runs an instrument once it has been seen red — so a build landing from
> outside the loop leaves a permit that still reads live. The loop spent a full model pass
> on one: recorded red on 2026-08-05 with "No test files found", green since a merge 17
> minutes before the firing. `buildable --repo` now re-runs the command and refuses with
> SPENT when it passes, the loop files the green that was owed, and no model call is made
> against a definition of done already met. Pinned by
> `test/eval/permit-staleness.test.ts`. Previously 2099 tests across 171 files, verified
> 2026-08-06,
> after the plugin tool-namespace fix: every grant shipped to a plugin session named a
> tool no plugin session mints, three guards derived the prefix independently and all
> three derived it the same wrong way, and the mismatch was documented as harmless
> because interactively it is only a prompt — under `-p` it is a denial, which is five
> scheduled firings that ran, wrote nothing and reported success. Pinned by
> `test/release/plugin-tool-namespace.test.ts`, which records what a live session was
> observed to mint so the derivation is checked against an observation. Previously 2066
> tests across 169 files, verified 2026-08-05,
> after the first-run branch was made to ask exactly one question. The tool layer already
> resolved the vault directory into `nextStep`, but every *instruction* that renders the
> no-vault branch — the `firstRun` rule, the skill's first-run section, `/ost-setup` step
> 2 — told the session to compose `init <folder> --outcome "<their words>"` itself. Two
> holes where the tool had already filled one in: a session whose shell sits in a
> subdirectory scaffolds a vault the server never reads, `ost_next_work` still answers
> `bootstrap: true`, and the human is asked the question they have already answered
> correctly. All three surfaces now send the session to the payload's own `nextStep`, and
> `test/mcp/bootstrap-one-question.test.ts` holds each of them to one placeholder that is
> never the folder — proved discriminating by reverting each surface in turn — then runs
> the command end to end from a cwd that is *not* the vault and asserts the root Outcome
> carries the sentence verbatim. It settles the mechanical half only: whether a STRANGER
> gets there is a person's reaction and stays with a human. Before that,
> a corrections ledger gave a refusal a carrier out of the session it was issued in.
> A guard that refuses a call usually says what to use instead; that message was spoken,
> obeyed once, and gone — so seven sessions across four days hit the identical
> `Blocked: sleep …` refusal, and the guard ended up being the only memory in the system.
> `src/loop/corrections.ts` harvests those refusals out of finished transcripts, keys them
> by the permitted form the guard named — so eight sightings of one correction fold to one
> entry, not eight — and `ost-agent corrections` renders the ledger into the head of both
> wrappers' prompts, ahead of the tree. `test/loop/corrections-ledger.test.ts` replays the
> seven real sessions (`test/fixtures/corrections/PROVENANCE.md`) and pins the whole chain:
> the fold, the discrimination between a correction and an ordinary failure, the cap that
> names what it dropped, and that both wrappers read the ledger upstream of the line that
> invokes `claude`. What it proves is delivery, not persuasion: nothing here can see
> whether a session that receives a correction acts on it, and a reflex that survived seven
> explicit refusals may survive a note about them. Before that, the PRODUCT was made to
> obey `single-backlink` too. The rule was enforced on the
> agent and stated in the ruleset, but `Vault.detach`, `Vault.mergeNodes` and the duplicate
> scanner each wrote a `[[wikilink]]` into a `## History` or `## Issues` section — a second
> link to a node that already has a parent. Not hypothetical: this repository's own
> re-parenting migrations produced 272 of them in its own vault, in the same week the rule
> was authored. A rule the product breaks on its own writes un-fixes itself on the next pass.
> All four writes now name the node in quotes, and `assumption-layer.test.ts` runs the exact
> detach-then-link sequence the migrations ran, asserting `check` is as clean afterwards as
> before. One bracketed title survives on purpose and says why in a comment: `ost_rank_source`'s
> `reason` is appended to `.ost-agent/trust.jsonl`, never to a node body, and `namedNodes()`
> parses those brackets to resolve which test is cited (B4). Before that,
> `single-backlink` finished what `single-parent` started. `single-parent` counts
> EDGES — the contiguous `[[…]]` lines under the tag line, which is all `links` holds — so a
> wikilink inside a paragraph is not an edge by that definition and the tree could be a
> perfect one-parent tree while a node stayed linked from fifteen other bodies. Obsidian
> draws every wikilink wherever it sits, so by the only measure a reader has those were
> inbound edges and the graph was a web: 2,214 links across 920 nodes. A title is now linked
> exactly once, by its parent, and named in plain quoted text everywhere else — nothing was
> deleted, 1,295 links became mentions. The ruleset changed with it: the definition-of-done
> line that used to REQUIRE a `[[wikilink]]` to the test now requires the title in quotes.
> Before that, `single-parent` made the tree a tree. Every hierarchy rule asked whether a node had
> *at least one* correctly-layered parent and none ever asked how many, so a vault could
> satisfy all of them and still be a DAG — the meta vault was, with three solutions under two
> opportunities each. `ost_link_nodes` now refuses a second edge onto an already-parented node
> and `check` fails on one. The write-side refusal sits deliberately AFTER R6's borrowed-result
> guard: every adoption attack is also a second-parent attempt, so ordering it first would
> swallow R6's refusal and leave R6's own tests passing on the wrong message. Its cost is
> stated rather than hidden — two solutions may no longer share one assumption, which was
> legal before and was R6's non-vacuity control; that control is now an unparented node, which
> both rules permit. Before that, `test/loop/question-budget-ordering.test.ts` replayed four harvested sessions against
> the question budget's ranking function. It is green at 3 of 4 and prints three numbers that
> qualify it: plain arrival order scores the same 3 of 4, the other rounding of "half" scores
> 2 of 4, and the wider eleven-session corpus scores 6 of 11. The spec's threshold is met; what
> it establishes is narrower than the solution node claims, and the test says so in its own
> output rather than in a comment. Before that,
> `test/eval/assumption-layer.test.ts` pinned the Assumption layer between a Solution
> and its tests. The migration is write-strict and read-tolerant, and the spec holds both
> halves: `CHILD_HIERARCHY` refuses a new Solution→AssumptionTest edge, while
> `testsUnderSolution` still resolves a legacy direct one, so a vault written before the
> layer keeps a green `check` and a working gate. It also pins the hole the layer itself
> opened — a solution's gate now clears on a run test two hops down, so an Assumption
> already carrying one cannot be adopted by a second Solution, which is R6's forgery
> arriving one layer up. Previously verified after
> `test/security/credential-broker.test.ts` pinned the credential broker — the three
> credentials this product reads from the environment are held in one process and handed to
> nothing. An adapter is constructed with an opaque handle and a brokered fetch; the secret is
> substituted into the outgoing header (including inside HTTP Basic's base64) only after the
> URL has been matched against a written grant and the request has been appended to the vault's
> credential log. The property that costs something is the log: **no record, no action** — an
> unwritable audit sink denies the request before the credential is touched, and a sink that
> fails *after* the action returns the result flagged `auditIncomplete` rather than clean, since
> an action already performed cannot be un-performed by a failed write. `web.searchApiKey`, on
> the context object every tool is built with, now carries a handle instead of the search key.
> What no green here settles is whether an operator would put a long-lived secret in a broker at
> all; that is the desirability question the assumption test still owns;
> after `test/cli/path-near-miss.test.ts` pinned the near-miss answer — a failed path lookup
> reports how far down the path was real, what is present at that point, and the one obvious
> correction, replayed against the five lookups that actually failed in this project's own
> session transcripts. The half that decides it is what it refuses: a numbered sibling, a tie,
> and a two-character segment each yield silence, because the recorded `report2.txt` miss had
> the previous run's output sitting one character away in the same directory, and naming it
> would have made a stale artefact read as that run's result;
> after `test/loop/degraded-pass-reporting.test.ts` pinned the degraded verdict — a firing that
> ran without the means to do its job now has a name of its own and may not seal `healthy` or
> `no-op`, the two words a reader takes to mean the tree is fine. The evidence is the vault's
> own tool trace, the source surface the context could build, and whether the config was
> readable: the pass is asked nothing. Every mode is injected into a real firing and each has a
> full-surface twin that must still seal the old verdict, because a contract that always says
> degraded carries no information either. Two limits are pinned rather than papered over — the
> trace is the one Gate F decider input the surface itself writes (part 5 of
> `test/release/gate-f-deciders.test.ts` states the weaker append-only property that holds
> there instead), and the detector separates a firing whose surface was absent from one whose
> surface was present, not work done from work shirked;
> after `test/product/manifest-ranking-shift.test.ts` pinned the declared resource manifest —
> the operator states what they have, and the planner may not emit a priority order without
> naming which declared resources conditioned it and which are blank. What the spec settles is
> narrow and was pre-committed on the assumption test before anything was measured: ranking the
> corpus with the manifest absent and again with it hand-filled must move at least two of the
> top five, or an item must enter or leave it. Over the 39 buildable solutions of this
> product's own vault, all five top-five positions change and two items are replaced. Three
> assertions carry the file rather than that one: the manifest-absent order is asserted equal
> to what `ost-agent buildable` prints today, so the baseline is the product's real order and
> not a strawman; each detector is held to a control that forces it to find nothing; and the
> per-field conditioning counts are pinned, which is where the finding lives — of five declared
> fields, `capital` and `compute` deferred nothing, `hours` deferred all 39 and so reordered
> nothing, and the entire movement comes from `social-reach` (4) and `credentials` (1). It does
> not show the new order is better, and nothing here measures whether an operator would keep a
> manifest true;
> after `test/telemetry/preflight-uncertainty-census.test.ts` pinned the preflight-uncertainty
> census — how often a call that failed came from a caller already showing doubt, which is the
> assumption a validate-only twin of every mutating tool rests on. The classifier is committed
> in `src/telemetry/preflight.ts` (`UNCERTAINTY_RULE`) ahead of the count, including the nine
> bare hedges it refuses, and the controls in the test are what carry the file: every signal
> kind fires on a window built to carry it and stays silent on a window built to look like it.
> Over the committed corpus (`ost-agent preflight`) the answer is **0 of 6** against a bar of
> half — but the census reports two things ahead of that share and they matter more. 62 of the
> 68 failed calls have no session record at all, so the denominator is six. And the count moves
> from 0 to 6 as the lookback widens from 6 entries to 24, so the share is a property of the
> window as much as of the callers; `boundDecides` says so on the report's face rather than in
> a footnote;
> after `test/product/committed-capability-profile.test.ts` pinned the committed capability
> profile — what each builder demonstrably knows how to do, inferred from authored commits
> and the pull requests they arrived in, with nothing asked of anyone. Its load-bearing half
> is the census it takes on the way past: a capability is named only from a conventional
> type plus a domain the artifact locates, so the reading can come back empty, and the
> profile carries the share of the record it could read on its face. Run over this
> repository (`ost-agent capability`) it reports **NARROWED** — 64 of the last 100 commits
> and 20 of the last 30 PRs name a capability, above the 50-of-100 line that would have
> killed the candidate and below the 70 that would let it stand on the whole record. The
> first CI run on that test is itself part of D1's evidence: `actions/checkout` clones at
> depth 1, so the census over the last 100 commits read a record of ONE and reported a
> share of it. `fetch-depth: 0` is now set on the `test` job, and the reader refuses a
> truncated clone outright rather than reporting a clean run over a subject it never saw;
> after `test/ost/stranded-evidence-census.test.ts` pinned the stranded-evidence census —
> the split between evidence some node's prose already quotes and evidence nothing in the
> tree quotes, which is the number that decides between making `source` appendable and
> adding a whole new node layer. It is computed rather than narrated, and it names the
> citing nodes beside each verdict so the verdict can be checked: run over this repo's own
> vault (`ost-agent stranded`) it reports 21 stranded of 76, of which 20 are already quoted
> by some node and 1 is quoted nowhere — not the 14-of-19 a hand census recorded, because
> "carries no customer need" is a judgment and a citation is an observable;
> after `test/config/vault-pointer-resolution.test.ts` pinned that a project can name its
> own vault: `ost.vault.yaml` at the project root is read by every entry point that takes
> `--vault`, ahead of the `OST_VAULT` the plugin sets to `${CLAUDE_PROJECT_DIR}` for every
> project alike. The reason it is one hook rather than twenty-two edits is what the audit
> found: twenty of the twenty-two `--vault` declarations hard-coded `"."` and two read the
> environment, so "the CLI honours `OST_VAULT`" was true of two commands out of
> twenty-two. None of them carry a default now, and the test reads the CLI sources to hold
> a command written next year to the same rule;
> after `test/ost/retraction-consumers.test.ts` audited every reader of the tree and pinned
> the answer: there is ONE — nothing outside `src/ost/` turns a file into a node, so the
> eighteen call sites across six modules all get their nodes from `Vault.readTreeCensus`
> and honour a retraction by construction rather than by eighteen remembered edits. It
> also pins the third way a retraction could have been forged, which was real: `mergeNodes`
> carries the loser's reserved sections onto the survivor so a recorded result survives its
> file's deletion, and for `## Retraction` that made `ost_merge_nodes(retracted, live)` a
> delete of an arbitrary live node in one allowlisted call — reached by COPYING the heading
> rather than authoring it, so every guard on authorship was blind to it;
> after `test/eval/lineage.test.ts` pinned that a report's Outcome→node path is the
> SHORTEST one with ties broken alphabetically — the graph is not a tree, so more than one
> path exists and file order must not be what decides which the operator sees; and after
> `build-pass-reports.test.ts` pinned that the arrow prefix appears only when the pass
> actually touched a node, so it never names work the pass did not do;
> after `outcome-files-categories` made the bucket layer structural: only category
> Opportunities (and Unknowns, which carry no work) attach to the Outcome, so the root
> files categories instead of accumulating one edge per need — pinned in
> `test/eval/clearability.test.ts` and `test/mcp/rule-parity.test.ts`, and green against
> the real 566-node vault;
> after `test/eval/rollup.test.ts` pinned that the tree's top-level view is DERIVED —
> every figure read off an observed exit code, a human's recorded verdict, a stamped
> `source` or a stated threshold, and none off a score an agent wrote about its own work;
> after `test/ost/mutate.test.ts` pinned the three operations that walked back append-only
> — `unlink`, `editProse` and `mergeNodes` — and, in particular, that a reserved section
> survives both a rewrite of the prose around it and the deletion of the file it lived in:
> an agent that may not author a `## Results` may not destroy one either;
> after `test/git/conflict-marker-guard.test.ts` enumerated every route by which a commit
> reaches this repository and pinned which of them refuse staged conflict markers — and
> which two do not; and after instruments gave assumption tests a runnable half:
> `test/knowledge/instruments.test.ts`
> pins the allowlist that keeps an agent from authoring its own verdict, and
> `test/ost/instrument.test.ts` pins red-before-green against a real process, and
> `test/automation/build-pass-reports.test.ts` pins that the build loop parses and that its
> idle reports ask the operator for no tree work, and `test/security/instrument-required.test.ts`
> pins that a test must name a command or a person and that a swapped instrument cannot
> inherit the old one's permit, and `test/loop/health-report.test.ts` pins the read-only
> reporter the build loop consults before claiming discovery is working). (The count this line
> carried two revisions ago, 878 across 86, predated `8261a6f`'s deletion of the
> genome and harness and was never updated with it — a reminder that a number in this
> document is a claim like any other. It has since been wrong twice more, both times
> because a batch of tests landed and this line did not move with them, which is why
> each revision now re-runs the suite rather than reasoning about the delta.)
>
> *The **file** half of that count is pinned — `test/release/readiness-counts.test.ts`
> counts `test/**/*.test.ts` on disk and fails when this line disagrees. The **test**
> half is not, and cannot be from inside the suite: the number is only knowable by
> running the run, and a test that ran the suite to count it would run the suite
> inside the suite. Stated rather than left as an apparent oversight — this is a
> number carried by the command in the check line, and the file count is there so a
> whole batch of tests can never land with this line untouched.*

**D2 — Every command's `allowed-tools` names only tools that exist.**
> *Check:* for each of the nine files in `.claude/commands/`, every entry starting
> with `mcp__` must, after prefix strip, be in `MCP_TOOL_NAMES`; every non-`mcp__`
> entry must match an explicit allowlist of
> `Bash(node ${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs <subcommand>:*)` forms whose
> `<subcommand>` is in `src/cli/index.ts`'s `.command(` set. (A naïve "every entry
> must be in `MCP_TOOL_NAMES`" misfires on `ost-setup.md`, which legitimately
> grants two Bash forms.)
> *Today:* **met** (2026-07-30), pinned by
> `test/release/command-allowlists.test.ts`, which globs `.claude/commands/*.md`
> rather than listing them and audits every frontmatter entry against three
> authorities it **derives**: `MCP_TOOL_NAMES` from the server, the `.command("…")`
> set grepped from `src/cli/index.ts`, and the tool-name prefix read off
> `.claude-plugin/plugin.json`'s `mcpServers` key. A non-`mcp__` entry must match
> the single permitted shape, so `/ost-setup`'s two legitimate Bash grants pass
> while a bare `Bash` does not.
>
> **No command file needed fixing — all nine were already correct.** What was
> missing was anything that would notice if one stopped being, which is the
> configuration this document has now watched be wrong three times (G3, G4, Z1).
> The consequence it guards is not cosmetic: under `-p --permission-mode
> acceptEdits` an out-of-allowlist or misspelled tool is *denied, not prompted*, so
> the unattended pass runs, does less than it claims, and reports done. The repo
> learned that once when `ost_ingest_inbox` fell out of the examples, and fixed
> only the downstream half.
>
> *Non-vacuity here had to be proved on fixtures rather than on the real files,
> and the reason is worth recording:* the nine shipped files are correct, so no
> mutation of the checker can be caught by them — **correct files cannot carry the
> proof**. Neutering the MCP-name branch reddens exactly the two MCP fixtures;
> neutering the Bash-shape match reddens exactly the two shell fixtures; neither
> disturbs a real file.

**D3 — The skill's tool list and the server's surface agree.**
> *Check:* parse tool names from `.claude/skills/opportunity-solution-tree/SKILL.md:5`; assert `MCP_TOOL_NAMES \ SKILL` is
> empty, or that each omission carries an explicit `<!-- omitted: <reason> -->`.
> *Today:* **met** (2026-07-30), and the difference is now **empty** rather than
> excused. The grant lives in `OST_RULESET.skillTools` with the merits written
> beside each entry, and `scripts/gen-skill.ts` renders both the `allowed-tools:`
> line and an `<!-- omitted: … -->` comment for anything withheld — so the
> criterion's escape hatch exists and is currently unused.
>
> Five of the six were a plain omission. The four read-only reporters —
> `ost_check`, `ost_debt`, `ost_status`, `ost_gate` — were withheld from a skill
> whose whole job is keeping a tree honest, which asked the model to do that with
> its eyes shut; and `ost_set_evidence` was already granted on `/ost-pass` (R7) and
> refused above its earned ceiling at the write boundary (B3), so granting it adds
> no reach. Each granted tool also gained a body bullet, so the grant is usable
> rather than merely present.
>
> **The sixth is the one worth reading, because the ground moved under it inside a
> single batch.** `ost_flag_humans_required` was withheld first, with the sanctioned
> `<!-- omitted: … -->` reason naming R2: the flag wrote its label unconditionally,
> so filing it against a test whose own prose claimed another lane left a
> `lane-conflict` nothing on that surface could clear, and *a safety tool whose
> correct use turns permanently red is a safety tool that gets routed around*. The
> withholding named its own expiry — that `test/eval/clearability.test.ts` pin the
> refusal green — R2 landed hours later, the condition was **checked rather than
> assumed**, and the tool was granted. Note what that sequence demonstrates about
> R2: its containment argument (nobody holds the key) expired the same day the
> guard replaced it.
>
> Pinned by `test/skill/surface-parity.test.ts`, against `MCP_TOOL_NAMES` itself
> and never against the ruleset that generates the skill — **a mirror would pass
> through any drift**. Six mutation cases run the same function over a mutated
> skill: dropped grant, invented grant, deleted omission comment, a reason reduced
> to a shrug, a tool both granted and omitted, and a surface carrying a tool the
> skill has never heard of. A test also pins that a skill grant is **not** a command
> grant, because R3's clearability table reads `ost-pass.md`'s frontmatter and the
> next reader will assume otherwise.

**D4 — No document names a command, path, or module that does not exist.**
> *Check:* over the **operator-facing** docs only — `README.md`,
> `docs/reference/`, `docs/consuming-from-claude-code.md`, excluding this file —
> `grep -rhoE '(src/[A-Za-z0-9/_.-]+\.ts|npm run [a-z:-]+)' … | sort -u`; assert
> every `src/…` path exists on disk and every `npm run X` is a key of
> `package.json`'s `scripts`. **`docs/superpowers/` is deliberately out of
> scope** — it is a dated design archive whose specs and plans legitimately name
> files that were proposed or have since been deleted (the unscoped grep returns
> 31 such paths, which is the archive doing its job). This document is excluded
> for the same reason: naming absent machinery is its subject.
> *Today:* **met** (2026-07-30), pinned by `test/release/doc-references.test.ts`,
> which computes the criterion's scope rather than maintaining a list of allowed
> exceptions — an exception list is where the next `judge.ts` would go.
>
> `docs/reference/evaluating-ost-agent.md` was **repaired, not gutted**. Its
> three-layer argument is what this document cites it for and it is intact; what
> changed is that each layer now carries its own status — layer 1 shipped and the
> only one that is, layer 2 designed, built and removed, layer 3 never automated
> and not automatable — and the block that handed the reader `npm run eval` now
> lists only the two commands that exist. One wording choice is flagged inside the
> file itself: the removed script is described as *an `eval` npm script* rather
> than written in its runnable form, because the guard cannot tell "here is what to
> run" from "here is what no longer exists", and a doc explaining a deleted command
> must not be the reason the guard against deleted commands goes red.
>
> **Two holes in the guard were found by attacking it, and both are the shape this
> document keeps naming.** It used `script in definedScripts` — and `JSON.parse`
> returns an object with `Object.prototype`, so `npm run constructor` was reported
> as *defined* by a guard whose entire purpose is to fail closed. And it walked
> only `*.md`, an unstated narrowing of a criterion whose check is `grep -r` with no
> extension filter: invisible today, because `docs/reference/` is all Markdown, and
> it would have stayed invisible until someone landed a `runbook.sh` there — the
> file most likely to hold a copy-pasteable command, and the one the guard would
> have silently stopped reading.
>
> *Scope, stated:* only `src/**/*.ts` paths and `npm run <script>` — verbatim the
> two forms the criterion defines. `test/`, `scripts/` and bare CLI verbs are not
> verified, and existence is all that is checked: a path that exists but no longer
> contains what the prose claims still passes.

**D5 — The vault working tree is clean before any auto-committing tool runs.**
> *Check:* `git status --porcelain` in the vault is empty at the start of a
> firing, or the commit path refuses to stage paths the firing tool did not touch.
> *Today:* **met** (2026-07-30), on the criterion's **first** branch: a firing
> refuses to begin against a dirty vault, at `loop start`, before the lock is taken
> and before any record is opened. `workingTreeStatus` answers `clean`, `dirty` or
> `unknown` — and the third shape is deliberate, because a `catch { return clean }`
> is exactly the false-clean this criterion exists to prevent. Two distinct exit
> codes, `dirtyTree` and `treeUnreadable`, on F3's precedent that different mistakes
> deserve different codes.
>
> The refusal carries the argument rather than just the verdict: `git add -A` stages
> the whole vault, so a leftover is committed under the *next* tool's name — W2's
> failure manufactured deterministically on every firing — and because F4's verdict
> is a HEAD delta, verdicts shift by one and **one stale untracked file keeps a dead
> vault reading `healthy` indefinitely**. That is why D5 is F4's precondition.
>
> **The wedge decision, made deliberately rather than by default.** The way out is a
> human, which Gate F's wedge rule allows only when a human interrupt is the actual
> point — and here it is: only the person who left the file knows what it is, and
> every automatic exit is worse (committing it *is* the misattribution; deleting it
> is a destructive act this codebase takes nowhere; ignoring it is how the file
> stops being visible). So the refusal names the paths and names the commands, and
> the commit hint is `add -A && commit -m` rather than `commit -am`, because `-am`
> does not stage the untracked case and an operator following it would be refused
> again by the same file.
>
> *The self-wedge question was verified, not assumed:* the loop's own records under
> `<vault>/.git/ost-agent/` are invisible to `git status` — asserted directly, with
> a control proving the same two files one directory up *are* seen — and `init`
> commits everything it writes. Pinned by a full firing followed by a second
> `loop start` that is accepted, in `test/cli/loop.test.ts`.
>
> **The shared CLI fixture was `mkdir .git`** — a "repository" git could not
> describe, a state no real vault is ever in, and the thing that had hidden this
> question. It is now a real repository with a committed baseline.
>
> *Scope, stated:* only `loop start` is gated, so a wrapper calling only `loop due`
> gets no protection (the shipped `autonomous-pass.sh` calls both, in that order);
> the criterion's **second** branch is untouched — `gitCommit` still stages
> everything, because W2 and W3's detector currently depends on it; and a file
> dropped into the vault *during* a firing is still swept by that firing.

---

## The ordering constraint

These do not compose in arbitrary order. **Built out of sequence, the later ones
become unmeasurable rather than merely unbuilt.**

**Tier 1 — the vault must survive being left alone.** R1, R3, R4, R5 (a vault
that can be permanently reddened by its own prose), G1 and S6 (a single malformed
file that removes the tool the sweep depends on — S6 is the more reachable of the
two, because under DEC-1 the evidence directory is fed by an untrusted builder by
design), H2 (a firing that fails silently and pushes anyway), and **W5**. Nothing
measured afterwards means anything if the subject is dead or if failure is
invisible.

> **W5 was moved here from Tier 3 on 2026-07-29, and the move is the main structural
> change Gate F made to this section.** It had been filed as a Tier 3 item about
> shell flags — tighten `--permission-mode acceptEdits` on two example scripts. It
> is actually the precondition for every Gate F decider and therefore for F6, which
> is the criterion that makes the other five mean anything. While Edit and Write are
> pre-accepted across the vault, every verdict Gate F computes is one Write away
> from being forged, and a health record, a cadence gate and a spend ledger that the
> agent can rewrite are worse than absent — they are *believable*. The tell that it
> belongs in Tier 1: it satisfies this tier's own test, "nothing measured afterwards
> means anything." That is precisely what an open W5 does to Gate F.
>
> **Status (2026-07-30): Tier 1 is closed.** R1, R4, R5, S6, H2, W5, G1 and R9 were
> met by 2026-07-30, and **R3 — the tier's blocker and the "if only one thing"
> item — closed with R2 and R6.** Its table now reads `create: no` in every cell on
> both surfaces: the agent can author no invariant violation in a single call at
> all. R2 replaced `lane-conflict`'s containment argument with a refusal, and R6
> closed `dangling-link`'s last create path from the other direction. The tier's own
> test — *"nothing measured afterwards means anything if the subject is dead or if
> failure is invisible"* — is satisfied. **R4** closed on 2026-07-29: `detectHygiene`
> derives from `checkInvariants` instead of being written twice beside it, so the rule
> sets cannot drift, and the one rule that does not block `done` is declared with its
> reason and pinned as a set of exactly one. It took R7's grant with it. **G1** is the
> one left, and it is a decision rather than a bug: `acquire()` throws on a broken config
> deliberately — "both request handlers catch that and answer with the fix" — so the
> criterion's *degrade to defaults and keep serving* is a different product from today's
> *tell the operator what to repair*. It matters less now that `genome.yaml` is gone and
> the only such file is one a human wrote at init.

**Tier 2 — the instruments must not be forgeable. It closed on 2026-07-30.**
B1, B2, B3, B4, B8, B9 — all six are met, and B10 came with them. The tier's
premise was that while the agent can write `## Results`, flip `validated`, and
declare `money`, every number the system produces about itself is self-certified,
and a health record built on a forgeable gate records forgeries faithfully. All
three of those writes are now refused at the boundary: the heading and its
coverage counterpart at the vault's single content funnel (B1, B10), the status
by absence from both schemas that carried it (B2), and the measurement rung by
the ceiling B8 already computed, asked at the write boundary instead of after it
(B3). **B4 and B8 went first** and each recorded itself as *met and still
downstream of B1*; neither needed a line of code when B1 landed, because both
reused `hasRecordedResult` rather than restating it — **the clearest return this
document has yet collected on "derive, never restate."** B8 took B7 with it, the
way R4 took R7, and B3 took B7 the rest of the way by giving it a caller on the
write side. **Tier 4 has since closed too** (2026-07-30), so Gate B holds end to
end: the tier below refuses the three forgeable writes, and the tier above makes a
source's standing a fold over what those unforgeable results said.

**Tier 3 — the writer boundary, which several later gates sit on.** W1 and W11
precede Gate S: S1's entire failure statement is about write access to the inbox
path W1 must relocate, and S2/S3 build cursors, cadence and provenance on that
same ingestion path, while B6 and P5 were unbuildable until W11 stamped a producer
identity on the record. W2, W9, W10, W12 and W13 belong here too. Building S before
W1/W11 means rebuilding the ingestion path. *(**W11 closed 2026-07-30**, which
hands B6 the key it is meant to be keyed on and leaves W1 as the tier's remaining
precondition for Gate S.)* *(W5 was here until 2026-07-29 and is
now Tier 1 — see the note under that tier.)*

**Tier 3½ — the engine, which nothing above needs and nothing below works
without.** F1–F4 and F6, in that order, and **F6 is not last by accident** — it is
the acceptance test for the tier, the same role B12 plays for Tiers 2–4. Each of
F1 through F4 can be built, tested and shipped while the chain stays broken,
because each one's verdict lands in a file the harness can still write. Only F6
asks whether the deciders are actually outside the agent's reach, and it comes out
false when the other four are each built and W5 is not.

The tier is numbered 3½ rather than 6 because it does not come after Tier 5; it
sits on W5 (now Tier 1) and on nothing else in Tiers 2–5. It could be built
tomorrow — and on 2026-07-29 it was: **F1, F2, F3 and F6 are met, F4 is partial,
and W5 closed in the same change.** The reason it is placed after the
writer boundary rather than before the forgeable instruments is the counter-case
below, and F4 is where that argument actually bites: a firing that seals `healthy`
has passed `checkInvariants`, and B1 and B2 are the standing finding that
`checkInvariants` is forgeable. The resolution is the idiom B4 and B8 already use —
**land it and record that it is downstream of B1** — rather than blocking the
engine on Tier 2. A machine that cannot tell you it stopped working is a worse
problem than a machine whose success report is only as good as Gate B.

> **The join landed on 2026-07-29 and it closed the tier's acceptance test.** F6
> had been partial because both halves held and *nothing asserted they were the
> same chain* — the property was the conjunction of three tests written for three
> other reasons, B12's shape one tier over. `test/release/gate-f-deciders.test.ts`
> now enumerates every decider input, classifies each by the mechanism that
> shelters it, and refuses a fourth category; a new module under `src/loop/` fails
> the build until someone says what it reads. **What remains open in this tier is
> F4's escalation half, which is downstream of S1, not of anything here** — the
> tier's acceptance test passes, and the tier is done in the sense this document
> means: the mechanisms exist and their verdicts are decided by something the
> cartographer cannot write.

**F5 is deliberately not in this tier, or any tier.** It is not sequenced because
it is not designed; see its entry. Sequencing an undesigned criterion is how a
placeholder becomes a plan.

**Tier 4 — earned belief, once there are distinguishable sources emitting on a
cadence.** B5, B6, B11, P5. H1 belongs at the head of this tier: a self-feeding
tree that cannot report whether a firing succeeded is a machine for generating
unattributable work. **B12 is this tier's acceptance test and the reason it spans
Tiers 2–4 rather than sitting in one:** it is the only criterion that comes out
false when W11, B7, B3 and B6 are each built and none of them is wired to the
next, which is the shape a chain assembled across three tiers actually fails in.

> **The whole tier closed on 2026-07-30, and the acceptance test earned its keep.**
> B5, B6, B11 and P5 landed together because they are one data structure; the four
> unit-level criteria were green well before B12 was, and B12 is what said so. Its
> header records the mutation run against each of the four links and the failure
> text each one produced — the discipline this document keeps re-learning, applied
> before the status was written rather than after it was found wrong. **P5 cost
> nothing, which is the point of it:** the sponsor is a member of `TRUST_KINDS` and
> a row in the ceiling table, and the criterion is satisfied by there being no
> sponsor-specific mechanism to point at. The tier's own premise — *once there are
> distinguishable sources emitting on a cadence* — was met by W11's stamp and S2's
> channels, which is the ordering constraint paying out for the fourth time.

**Tier 5 — consequence, scale, release.** P1, P2, P7–P10; Z1–Z5; G3; Gate D.
(G2 and G4 are met by deletion. G3's grep is now committed, and it moved the
criterion from *met* to *not met*: two modules have no live caller, one of them
H3's detector. Retiring either entry is a Tier 5 cleanup, not a blocker — but the
register is where a module that is dead by neglect and a module that is dead
because its criterion has not been built yet stop looking alike.)
P1 and P2 gate the *first real-world action*, not the first firing, so they can
trail the spine — but they must land before anything the tree proposes gets
executed by a builder.

**Sequenced nowhere, deliberately:** W3, W4, W6, W7, W8, B10, F5, P3, P4, P6, R6,
R8, H4, H5, S4, S5. Each is buildable independently of every tier above — none is a
precondition for another criterion and none waits on one. *This line exists because
an audit found fifteen criteria absent from every tier with no way to tell an
independent one from a forgotten one, including S1 (a blocker, present only as
dependency prose) and W7, which another criterion names as an owner.* It is
asserted by `test/release/readiness-tiers.test.ts`, so a criterion added without
being sequenced — or listed here — fails the build. **A tier list that silently
omits a third of the document is not an ordering, it is a subset**, and the fix is
the same one `08a78e8` applied to citations: compute the set difference rather than
maintaining it.

*(S1, S2 and S3 appear in Tier 3's prose as dependencies rather than assignments;
they are sequenced by Gate S's own dependency on W1/W11 and are listed here for
completeness of the audit trail, not as unsequenced work.)*

> **The counter-case, stated so the ordering can be argued with:** one could put
> H1 first, on the grounds that you cannot debug a wedge you cannot see, and that
> a health record would have surfaced R1 and G1 within a day of the first
> meta-vault run. That is a real argument and it is why H2 sits in Tier 1 rather
> than with H1 — H2 is a two-line change to a shell script and it is the cheapest
> possible failure detector. The full record (H1) still comes later, because its
> value depends on the gates it records being unforgeable (Tier 2), and a
> trustworthy-looking record of a forgeable gate is worse than no record.

**R3 was the "if only one thing" item, and it is done.** The table is a build
failure now rather than an audit finding, which is what stopped this list from
having to be re-derived by hand — and it earned that description immediately, by
correcting two cells and by moving G3 off *met*. **R4 followed it and is done
too**, and it earned the same description the same way: the parity decision was
three sentences of judgement, but computing the set instead of listing it
immediately found a fourth un-computed rule this document had not named
(`no-self-validation`) and a semantic divergence in the orphan check that no rule
count would have shown.

**Tier 2 opened with B4, its head** (2026-07-29). A promotion now has to
name a corroborating result that exists and has an outcome; `reason` resolves
against the tree instead of being checked for non-emptiness. *(Both Tier 2 and
Tier 4 have since closed; B4's own entry records the fourth refusal row that
2026-07-30's ledger added to it.)* Tier 1 remains
closed except for G1, which is a product decision (*degrade and keep serving* vs.
*tell the operator what to repair*) rather than a defect, and which shrank when
`genome.yaml` was deleted.

B4 earned the same description R3 and R4 did — building it found something the
prose had not. The wedge was in the *safe* direction: the obvious reading of
"a promotion names a result" also blocks **demotion**, and a vault whose agent
cannot cheaply stop trusting a bad source is a vault pointed at B11's expensive
failure mode. So the guard fires only above the floor. The second finding is
narrower and worth stating because it bounds the criterion: B4 reuses
`hasRecordedResult` rather than restating it, which means **B4 is met and still
downstream of B1** — it closes the path where a promotion cites nothing, not the
path where the agent writes the `## Results` it then cites.

**B8 is done too** (2026-07-29), and it earned the same description a third time.
Two findings, both from building rather than from reading: the doctrine it
enforces was **already written down twice in prose**, in the two places where the
model is the actor being constrained — a rule stated to the model twice and
computed nowhere is the shape this whole tier is about. (Both have since become
data: `TRUST_CEILINGS`, `src/knowledge/actor-trust.ts:110`, and a tool description
that now describes that table rather than asking the model to honour it.) And
adding one rule turned out to
cost four pins, not one: the rule literal is grepped out of `invariants.ts` by both
`test/eval/clearability.test.ts` and `test/mcp/rule-parity.test.ts`, so a rule with
no clear path, or in neither the blocking nor the declared-non-blocking set, is a
red build. **That is R3 and R4 collecting their rent** — the cost of a new rule is
now paid up front, in the diff, instead of discovered as a permanent wedge later.
The second finding is narrower and bounds the criterion: the first plant turned
`done` false through *evidence debt* rather than hygiene, because a freshly planted
Solution has no test beneath it — so the fixture proved nothing about the new rule
until it relabelled a node already in the tree (`test/mcp/rule-parity.test.ts:141`).

**Gate F is new (2026-07-29), and writing it found something the prose had not —
the same way R3, R4, B4 and B8 each did.** The finding is W5, and it arrived by
failing. Each of the six criteria was drafted with an unforgeable decider named in
it, and each named one that a single `Write` could forge: the health record, the
cadence ledger, the spend pool, the config that declares all three. The MCP surface
is clean and was never the exposure. The exposure is that the *unattended harness*
pre-accepts Edit and Write across the vault, which is a fact this document already
recorded — as a Tier 3 item about tightening two shell scripts.

**So the most valuable line in this revision is a promotion, not a criterion.**
W5 is the precondition for Gate F, F6 exists to state that dependency in a form
that can come out false, and both moved to Tier 1. The general shape is worth
naming because it will recur: *a criterion filed by the surface it touches rather
than by what depends on it will be mis-tiered, and the mis-tiering is invisible
until something downstream tries to rest on it.* W5 looked like shell flags. It is
the difference between a health record and a rumour.

**The second finding bounds the gate.** Five of the six criteria can enter a state
that stops the loop — exhausted pool, held lock, future-stamped clock, escalating
no-op streak, unmet acceptance condition — and the first drafts of all five shipped
that state with no way out but a human editing a file, on a system whose defining
property is being left unattended. That is R2 five times over. The wedge rule at
the head of the gate is the response, and F3's stopping state is deliberately kept
as a human interrupt because spending real money is where DEC-3 says the sponsor
*should* be interrupted — recorded as a decision so it cannot later read as an
oversight.

**P10 was the next single item, it was a different kind of item, and it paid out
exactly as this paragraph predicted.** Every criterion closed before it was *build
the mechanism*. P10 was not: its three failing rows were failing by B1, B2 and B3,
all three of which held, so what was missing was **the enumeration, not the
mechanism** — a table over `buildOstTools(ctx, MCP_TOOL_NAMES)` asserting that no
single call flips a gate or empties a violation the same caller created. It was
worth doing precisely because it could not be assembled out of the six criteria
that had just closed: each pinned the door it was about, and *a property proved
door by door is not proved*.

**Written on 2026-07-30, it found a fourth door on its first run** —
`ost_link_nodes` clearing a Solution's gate by adopting an AssumptionTest that
already carried a recorded result — which no conjunction of B1, B2 and B3 would
ever have named, because none of them is about that tool. R6 closed it, and the
two criteria are now each other's evidence: R6's guard is what makes P10's table
green, and P10's table is what found the case R6 had to guard. B12 and F6 were the
precedents for what a criterion like that finds. F6's own first draft is the
standing warning — it was vacuous and green — **and so was this one, in four
separate places**, every one found by mutating the source rather than by reading it.

**S1 was the next single item, and it closed with Gate S** (2026-07-30), taking
with it the last thing standing between this repository and the sentence on line 3.
Gate B's earned half closed beside it. **What is left is Gate P's consequence
vocabulary — P1, P2, P3 — and it is a different kind of work than everything above
it.** P1 through P3 are not doors to shut on a capable agent; they are the
vocabulary an agent needs before it may be given a capability that costs money or
signatures, and nothing in the repo today has one. That is why they read *not met*
against a document otherwise 70-for-75: the safety properties above them are all
carried by the fact that **no irreversible verb exists on the tool surface**, which
is precisely the property DEC-3 removes.

> *All three closed after this paragraph was written* — P3 the same day (2026-07-30),
> P2 on 2026-08-01, P1 last, on 2026-08-02. **The vocabulary now exists and every
> tool declares against it, and that is a smaller claim than it sounds:** nothing
> yet branches on a lane or a reversibility class to refuse or gate a capability —
> DEC-3's actual mechanism, an agent trusted with something that costs money or
> signatures, is still unbuilt, and was never these three criteria's to build. What
> closed is the precondition the paragraph above names: the vocabulary an agent
> would need before that trust could be reasoned about at all.

> **What is *not* next, and why, because the ordering keeps being the thing this
> document gets right.** F4's escalation half is now unblocked — S1 closed — but it
> is still gated on D5, because a committed-delta measurement taken over a dirty
> tree shifts every verdict by one. F5 is undesigned rather than unbuilt. **Both
> debts this note recorded are paid:** B1 sat under B4, B8 and F4 as the named
> dependency of three met-or-partial criteria and it closed; S1 sat under F4's
> second half and Gate S and it closed. The open blockers are now Gate P's, and
> they are the ones that have to be *designed* rather than found.

---

## What V1.0.0 explicitly does not claim

Stating these keeps the bar honest and keeps the README from over-promising:

- **Not** that the agent determines its own autonomy. The lane gate is
  fail-closed and permanently non-evolvable (see *the mechanisms that may never
  become tunable*, Gate G); the
  agent may only ever *narrow* what compute runs. DEC-3's "unbounded envelope" is
  what testing the working environment has so far shown to be available — the
  sponsor's stated grant is one claim about that environment, scored like any
  other (P2, P5), not an authority the tree defers to.
- **Not** that policy evolves unattended (G4).
- **Not** that the tree can act on the world. P6 is a criterion precisely so the
  day it changes is deliberate and visible.
- **Not** that faithfulness or usefulness are measured. They remain human
  judgement, and no automated judge ships. (The design reasoning is in
  `docs/reference/evaluating-ost-agent.md` — which D4 flags as still instructing
  the reader to run a removed `npm run eval`; read it for the three-layer
  argument, not for the commands.)
- **Not** that "the worst thing it can do is make a commit that doesn't make
  sense." That claim is false today in the presence of a builder that reads the
  gate (P10), and it should be either earned or withdrawn before V1 — not
  repeated. *It shipped in four places, and P10 named two. The two it missed were
  `examples/automation/autonomous-pass.sh`, which D4's scope deliberately excludes,
  and the generated `SKILL.md`, whose prose D3 does not read — so the claim P10
  calls false was being loaded into the model's own instructions on every run.*
- **Not** that the tree decides whether the tree is working. Gate F's verdicts are
  computed by exit codes and by ledgers no allowlisted tool can reach, precisely
  because a heading, a status field and an annotation are all writable by the actor
  being judged (B1, B2, B10). **Where a Gate F decider is not yet outside the
  agent's reach, the criterion says so rather than reporting a number** — F6 is the
  criterion that comes out false while that is true, and as of 2026-07-29 it comes
  out true, asserted by `test/release/gate-f-deciders.test.ts`. Read its entry for
  the one shelter that is conditional rather than structural: three of the six
  decider inputs sit in `ost.config.yaml`, inside the working tree, held there by
  W5's deny list rather than by where the file lives.
- **Not** that "progress" is a measured quantity. F5 states the acceptance
  condition a mandate should carry and **does not ship a mechanism**, because the
  two obvious ones are both disqualified: an automated judge is what
  `evaluating-ost-agent.md` argues against, and declaring acceptance on the Outcome
  hands the cartographer authorship of its own bar through a `set-outcome` grant
  W6 already flags. An undesigned criterion is recorded as undesigned.

---

## Appendix — findings reproduced against a scratch vault

A mechanical join on the *(verified)* marker in the body.

The R1, R2 and R5 rows have since been overtaken: the clearability table (R3/R9)
executes the create and the clear attempt for all nine rules on both surfaces, so
those three findings are now re-run on every build rather than remembered here.
**A row in this table is a finding someone reproduced once; a row in that table is
a finding the build reproduces.** Moving rows from here to there is the work.

| Criterion | Finding | Evidence |
|---|---|---|
| B1 | `ost_append_to_node` writing `## Results` flips `gateSolution` BLOCKED → CLEARED | `src/eval/evidence-debt.ts:38-41` |
| B2 | `ost_set_status("validated")` flips `hasRecordedResult`; `checkInvariants` returns `[]` | `src/eval/invariants.ts:85-89` |
| B3 | `ost_set_evidence("money")` accepted with no note or corroboration | `src/security/tools.ts:369-377` |
| B6 | `rankHost({host:"stripe-webhook-feed", rung:"expert"})` succeeds — no actor namespace — *fixed 2026-07-30; the trap is now a row the build re-runs, and the constructor refuses it* | `test/security/actor-namespace.test.ts:58-73` |
| B8 | `checkInvariants` returns `[]` for a Solution declaring `money` with no result — *fixed 2026-07-29; the finding is now a row the build re-runs (`rung-unearned`), on both gates* | `test/eval/rungs.test.ts:35-43` |
| B10 | Coverage gaps drop 2 → 1 after an `ost_append_to_node` of `## Uncovered` | `src/eval/coverage.ts` |
| B12 | `classifyProvenance("INBOX:friction-report.md")` → `stated`, `"INBOX:note.md"` → `assertion`; the id is the producer's filename — *fixed 2026-07-30; the rule is keyed on the channel segment and the forged filename is a row the build re-runs* | `test/adapters/friction-channel.test.ts` |
| R1 | `wrapped-wikilink` survives every clearing attempt on the tool surface — *fixed 2026-07-29 at the write boundary; the tool surface can no longer author one* | `src/ost/node.ts:97-103` |
| R2 | `lane-conflict` created by `ost_flag_humans_required`, unclearable | `src/ost/lanes.ts:124-133` |
| R4 | `check` red while `next_work` reports zero hygiene issues, permanently | `src/eval/invariants.ts:38-46` |
| R5 | Hygiene issue suppressed by prose merely quoting it; `[[Ghost]]` cleared — *fixed 2026-07-29; suppression now reads the dated `## Issues` entry* | `src/mcp/next-work.ts:158-161` |
| R6 | `ost_link_nodes` accepted an Opportunity under a Solution; parent existence *is* checked | `src/ost/vault.ts:229-238` |
| W7 | `ost_read_repo` read a 4,311-char evidence body and `state/inbox.json` | `src/product/repo.ts:19` |
| W9 | Two colliding inbox files → one record, tool reports "captured 1" — *fixed 2026-07-30; the storage name is now a hint and the frontmatter `id` is the key, and both halves are rows the build re-runs* | `test/mcp/inbox-durability.test.ts:79-95` |
| F6 | Every drafted Gate F decider reads a file the unattended path can `Write`: `acceptEdits` with no `--disallowedTools`, vault as cwd | `examples/automation/autonomous-pass.sh` |
| W5 | Same finding, from the other side — the MCP surface cannot reach a sidecar ledger (`nodePath` refuses a separator), the harness surface can | `src/ost/vault.ts:103-110` |
| Z1 | 500 near-duplicates → `RangeError` — *withdrawn 2026-07-29: re-running it returns in 186 ms. R4's commit deleted the spread that caused it and nobody re-ran the check. Now a row the build re-runs* | `test/mcp/large-tree.test.ts` |
| Z2 | 500 near-duplicates → 125,750 hygiene issues, **21.4 MB** response (returns) — worse than the 400-node / 13.1 MB figure this row used to carry, and now the *only* home for the defect Z1 shed | `src/ost/dedupe.ts:62-72` |
| G1 | Malformed `genome.yaml` returned `isError` from every tool. The file is gone; `ost.config.yaml` throws the same way | `src/config/load.ts:56-59` |
| G2 | `budgets.sharedPool: 9999` overrode `web.lookupBudget: 10`. Fixed by deletion | `src/web/budget.ts` |
| G3 | `computeAttention` reported `calls-and-ms` when the genome asked `tokens` | `src/eval/attention.ts` |
| D5 | An audit probe file sat untracked in the working tree, awaiting `git add -A` | `src/git/safe-git.ts:49` |

Dedupe timings, distinct titles: 98 / 374 / 1,513 / 6,078 / 24,121 ms at
500 / 1k / 2k / 4k / 8k nodes.
