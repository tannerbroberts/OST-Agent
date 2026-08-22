---
type: Opportunity
status: unvalidated
source: 'INBOX:2026-07-25-friction-an-empty-annotation-is-recorded-rather-than-refu.md'
created: '2026-08-02'
evidence: assertion
---
#Opportunity #unvalidated #evidence/assertion
[[Show the whole write, exactly as it will land, and require a confirm before it does]]
[[A retraction append that supersedes an earlier node, which every reader and gate honours]]
[[Every regretted write becomes a new pre-write invariant, so the class cannot recur]]

Append-only is what makes the vault trustworthy, and it is also what makes a malformed write unrecoverable. A call that passed an empty or undefined argument was accepted and written, so two entries whose entire body is the literal text `undefined` now sit permanently on a root node — the damage cannot be edited out and the original intent cannot be reconstructed.

The asymmetry is the point: in a system that can edit, a bad write costs a correction; here it costs a permanent scar on the node's history. Validation that would be a nicety elsewhere is load-bearing here, and its absence is only discovered after the record is already immutable.

**The need:** I want the tool to refuse a write that carries no meaning, because I cannot take it back once it lands.

More than one way to address it: refuse empty/undefined arguments at the tool boundary, require a minimum-substance check before any append, offer a supersede-with-reason entry that visibly retracts without deleting, or surface malformed entries as hygiene issues so a human can annotate over them.

## Provenance

Distilled from `INBOX:2026-07-25-friction-an-empty-annotation-is-recorded-rather-than-refu.md` — filed by the bootstrap loop after `ost_annotate` accepted an undefined issue string against the tetrix-ost root Outcome.

## History
- 2026-08-02 evidence: stated → assertion — Demoted from 'stated' for consistency: this rests on an inbox friction note, and the inbox channel's earned ceiling is 'assertion'. Sibling nodes distilled from identical notes were capped there by the ranker; the difference was that this item's actor was unrecorded, not that its evidence is stronger.

## Issues
- 2026-08-02 Likely merge candidate — flagged by the pass that created it. Its parent "A tool call I got slightly wrong destroyed the note I was filing" already carries "Refuse a write whose content is empty or literally undefined", which is precisely the fix this node's evidence calls for, alongside "Validate every tool call against the schema the tool already declares" and "Echo the written line back so a bad write is visible immediately". The child's one genuinely distinct claim is about append-only as an amplifier — that a malformed write here costs a permanent scar rather than a correction, so input validation is load-bearing in a way it would not be in an editable system. If a human does not think that distinction earns its own branch, this should be folded into the parent. No solutions were ideated here on purpose, to avoid duplicating the parent's three.
- 2026-08-02 Created against an explicit prior disposition — flagged by the pass that created it, 2026-08-02, and this is the sharpest of the conflicts. The Outcome's ledger records the same source, `friction-an-empty-annotation-is-recorded-rather-than-refu`, as ACKNOWLEDGED, no node, by the bootstrap loop on 2026-07-25, with the reasoning stated outright: "It reveals no customer need, so distilling an #Opportunity from it would be inventing one." This pass distilled an #Opportunity from it. The disagreement is substantive rather than accidental — this node argues that append-only turns an input-validation gap into a permanent one, which is a claim about the product's design rather than a bug report — but a prior pass considered the same evidence and ruled the other way, and the human has not adjudicated. Combined with the merge-candidate note already on this node, the default action should be to archive it unless the append-only amplification argument persuades a human on its own merits.
- 2026-08-03 2026-08-03, unattended sweep — this pass ALSO declined to ideate here, deliberately, and is recording that rather than leaving the abstention to look like an oversight. `ost_next_work` reports this node as under-served (0 of 3 solutions) and the sweep's mandate is to fill that gap, but two prior rulings on this node argue against it and neither has been adjudicated: (1) the merge-candidate note above states that no solutions were ideated on purpose, because the parent "A tool call I got slightly wrong destroyed the note I was filing" already carries the three fixes this node's evidence calls for; (2) the note below records that this node was created against an explicit prior disposition, where the bootstrap loop had ruled the same source revealed no customer need. Ideating three solutions here would either duplicate the parent's three — the exact outcome the first note exists to prevent — or manufacture distinct-sounding alternatives to satisfy a counter, which is worse. The under-served count will therefore keep reporting this node every pass until a human either archives it or folds it into its parent, and that recurring report is the correct behaviour, not a defect. Suggested disposition for the human, unchanged from the prior pass: archive unless the append-only-amplification argument (that a malformed write here costs a permanent scar rather than a correction, making input validation load-bearing in a way it would not be in an editable system) earns its own branch on its merits.
