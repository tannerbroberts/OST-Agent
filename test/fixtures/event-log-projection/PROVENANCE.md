# Event-log-projection corpus — how it was cut, and what it does and does not show

`test/ost/event-log-projection.test.ts` is the instrument for "Replay this vault's whole
git history as events and see if the projection matches" — the assumption test beneath
"The log is the agent — an event-sourced graph the whole tree is projected from", in the
OST-Agent meta vault. The pre-committed threshold, fixed before this corpus existed:

> At least 95% of tree-changing commits express as events with no residue, AND the
> projection of the full log is byte-identical to the current vault. Below 90%, or any node
> the projection cannot reproduce, refutes it.

The measured result is **98.26% expressible (3,114 of 3,169)** and **0 of 1,618 nodes the
projection fails to reproduce**.

Read "What the green does not settle" before believing that is a verdict on the
architecture. It is a feasibility answer and nothing more.

## The cut

The source is the meta vault's own git history at `/Users/tanner/ost-agent-meta`, HEAD
`3d2cff7fe57e40c97dde1a6a6ab000385cc8d9bf`, 2026-07-24 to 2026-09-02.
`scripts/harvest-event-log-corpus.ts` re-runs the extraction exactly:

```
npx tsx scripts/harvest-event-log-corpus.ts /Users/tanner/ost-agent-meta
```

Subject: every commit touching a `.md` file outside `.ost-agent/` — 3,174 commits, of which
3,169 are the non-merge commits the method counts. `.ost-agent/usage/` sweeps fall out of
that filter on their own, because they touch no node.

## What is here

- `log.json.gz` — the whole decomposition: 8,754 events in replay order, with the
  per-commit slice lengths and the writer each commit declared. Payloads are carried
  verbatim, because the payloads *are* the subject — a summarised log cannot be projected.
- `tree.json.gz` — SHA-256 per file for the vault at HEAD (1,618 nodes), plus six
  checkpoints at every 500th tree-changing commit, each carrying the digests of the tree as
  it actually stood there (561 to 1,589 nodes).

**No verdict is in the fixture.** No residue count, no projected tree, no pass/fail. The
test folds the log with `projectEvents` and takes its own digests, so an event the
harvester mislabelled turns up there as a mismatch rather than being carried past.

## The vocabulary, and what measuring it cost

Ten event types, listed in `src/ost/event-log.ts`. Two rules keep the count from being
free, and they are the whole reason the number means anything:

1. **The commit's declared writer licenses the event type, not the bytes.** Every commit
   here names its writer in the subject (`mcp: ost_set_status — …`). `node.edited`, the one
   event carrying whole content, is licensed only to the two writers that genuinely take a
   whole node. Anything else that would need it is residue.
2. **A semantic event carries its argument, not its result.** `node.appended` carries the
   appended text; `node.linked` carries a title and no position. The projector re-derives
   the bytes from the tool's own rule, and every proposed event is verified by replaying it
   against the file as it stood before the commit. An event that does not reconstruct
   byte-for-byte is not an expression of the change, however plausible it looks.

Event counts: `node.appended` 3,849 · `residue.write` 1,631 · `node.created` 1,156 ·
`node.linked` 1,156 · `node.fieldSet` 520 · `node.sectionAppended` 343 · `node.edited` 67 ·
`node.removed` 14 · `node.unlinked` 13 · `node.retagged` 5.

## Four findings the node did not predict

**1. One event per tool does not survive contact with the history.** The solution node's
step 1 sketches a vocabulary of one event per MCP mutation. That is wrong about this
codebase, because every mutating tool reads the node, changes it, and writes it back
through `serialize` — so each one normalises on the way past. `ost_append_to_node` also
stamps `authorship: machine`. `ost_create_node` also moves the parent's `evidence` field
into canonical order. Neither commit's subject says so. Expressibility was **82.6%** with
one event per tool and **98.3%** once `node.fieldSet` was licensed to every writer that
round-trips, which is most of them.

**2. `ost_annotate` writes into a section, not onto the end of a node.** An annotation
lands at the end of `## Issues`, which on a node carrying later sections is the middle of
the file. Treating it as an append accounted for 100 unexpressible commits until
`node.sectionAppended` existed.

**3. The build loop's instrument recorder is not append-only in the byte sense.** Commits
titled `chore(instruments): record N observation(s) from the build loop` append an
Instrument Log line — and, in the same write, rewrite body prose, unwrapping `[[wikilinks]]`
into quoted plain text. That is the serializer's link policy firing through a commit whose
subject claims only an append. Two commits in this corpus are residue for exactly that
reason. It is a small count and a large fact: the one writer whose name promises it only
adds is silently editing node bodies.

**4. Merges cannot be excluded from the fold, only from the count — and finding that out
took the checkpoint replay.** The method says to exclude merge commits. Doing so leaves the
projection byte-identical at HEAD anyway, so clause 2 passes; it is the prefix replay the
*solution* node asks for that fails. A whole-file residue snapshot written on one branch
reverts a `node.linked` written on another, and without the merge that reconciled them the
fold settles on a tree that never existed. The corpus therefore carries all 5 tree-touching
merges as a `git.merge` writer that licenses nothing, so every one is residue by
construction; `residueCensus` drops them from the denominator, per the method. **The
general point: clause 2 alone is much weaker than it reads.** Residue markers carry literal
bytes so the fold survives them, which means a byte-identical HEAD proves the log is
*complete*, not that any single event is *right*. What proves that is the checkpoint
replay.

## What the green does not settle

**Feasibility only, exactly as the node says.** It says the architecture is expressible
against this vault. It does not say it is worth the rewrite.

**This is the most favourable possible input, and the residue proves it.** Every write here
went through the append-only MCP surface. 51 of the 55 residue commits declare no writer at
all — hand edits, migrations, bulk repairs, the 365-file `refactor(tree)` sweep. The node
predicted residue would concentrate in the hand-edit case, and it does. A vault that has
been hand-edited normally would not look like this, and nothing here says otherwise.

**Residue is rare per commit and large per event.** 1.7% of commits leave residue, but
18.6% of the events in the log are residue markers, because the changes that resist
expression are bulk rewrites touching hundreds of files at once. A reader taking 98.26% as
"98% of the vault is event-sourced" would be reading it wrong.

**Nothing here tests the architecture's claimed properties.** Cheap forking, behaviours,
lineage, and the load-bearing question of what happens to an operator's hand edit under a
projection — the node's own step 3 — are all untouched. This measures one thing: that the
history decomposes and the projector reproduces the tree.
