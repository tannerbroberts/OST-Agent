# The faithfulness corpus

Twelve real nodes from this project's own meta vault, and the seven stored evidence
records they cite, committed so that `src/eval/faithfulness.ts` has something fixed to
be judged against. `test/eval/faithfulness-judge.test.ts` scores all twelve and pins the
three properties the assumption test's instrument names: a fixed scale over every node
offered, a verbatim citation behind every score, and repeat runs within a point.

## `nodes/` — the subject

Copied verbatim on 2026-08-22 from `/Users/tanner/ost-agent-meta`, selected by a rule
chosen so the sample could not be picked for how it scores: **the first twelve
`Opportunity`- or `Solution`-typed files in C-locale filename order.** No node was
skipped, substituted or edited.

| node | type | citation |
|---|---|---|
| `A Context node type for evidence that is true, useful, and not a customer need` | Solution | does not resolve |
| `A background task's own output directory is automatically readable by the Monitor call that started it` | Solution | resolves |
| `A backgrounded session leaves no marker of what it finished versus abandoned` | Opportunity | resolves |
| `A block stops everything and announces itself to no one` | Opportunity | does not resolve |
| `A broker holds the credential and answers scoped, audited requests from the run` | Solution | does not resolve |
| `A budget for questions, spent down across the run and visible to the operator` | Solution | does not resolve |
| `A budget sweep that finds where shrinking the window flips the verdict` | Solution | resolves |
| `A build session's edit to the automation scripts becomes unreviewed policy for every future firing` | Opportunity | resolves |
| `A build that is finished and waiting in an open PR is picked as a target again, because selection reads only the tree` | Opportunity | resolves |
| `A build that refutes my idea looks, to the loop, exactly like a build that is not finished yet` | Opportunity | resolves |
| `A builder capability profile read off the work already committed, with no deposit asked for` | Solution | does not resolve |
| `A call the tool should have refused is permanent, because append-only cannot take it back` | Opportunity | resolves |

Five of the twelve cite something that resolves to no stored evidence record. That is
the vault's real ratio at that end of the alphabet, not an arrangement — and it is the
population the judge must still score rather than skip.

## `evidence/` — what the judge is allowed to read

The seven records those nodes cite, copied verbatim from the vault's
`.ost-agent/evidence/`, frontmatter included. Two are founder or audit notes, four are
build/friction notes, one is a harvested session transcript. Nothing was trimmed: a
citation checked against an abridged document is a citation checked against a document
the judge was not shown.

## What this corpus does not settle

It does not settle whether the judge agrees with a human. No human faithfulness rating
of these twelve nodes exists, and producing one is a person's work — the assumption
test says so, and this fixture cannot substitute for it. What a green suite says is
narrower and prior: the judge emits a number a human rating could be compared against,
with the span it read attached to it.

It also does not settle whether the mechanical rater is *right*. `A background task's
own output directory is automatically readable by the Monitor call that started it`
scores 5 here while the sentence it quotes describes the security restriction the node's
claim contradicts — lexical overlap cannot see negation, the test pins that ceiling
deliberately, and it is the strongest argument for the injected rater the module exists
to accept.

Regenerate by hand if the node format changes; there is no generator in the repo, on the
same reasoning `test/fixtures/golden-set/PROVENANCE.md` gives — a fixture a script can
rewrite is a fixture a scoring change can quietly rewrite to fit.
