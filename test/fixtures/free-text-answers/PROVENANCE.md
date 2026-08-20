# The two recorded rejections — where they came from

`test/loop/free-text-answer-parsing.test.ts` replays the assumption test's own material:
`TRANSCRIPT:42dcb7b4-f01b-40bc-a211-ed4a44a74fd3`, the session the opportunity node
("Answering one question costs me three turns…") was distilled from.

## What is here

`rejections.json` — the two `AskUserQuestion` stops in that session where the operator
rejected the tool rather than picking an option, and what they wrote when Claude Code
asked them to clarify. Cut by hand from the raw transcript at
`~/.claude/projects/-Users-tanner-dev-OST-Agent/42dcb7b4-f01b-40bc-a211-ed4a44a74fd3.jsonl`,
which this repository does not carry (it is a local Claude Code session log, not a
checked-in artefact) — `askEntry`/`rejectionEntry`/`answerEntry` are the 0-based line
indices in that file so the cut can be checked by eye against the original.

## Why `text` is not the `tool_result` content

`src/loop/questions.ts`'s existing harvest (`scripts/harvest-question-corpus.ts`) reads an
answer as the `tool_result` for the ask's `tool_use_id`. For a *rejected* ask that content
is Claude Code's fixed boilerplate — "The user doesn't want to proceed… the user said: The
user wants to clarify these questions… (No answer provided)" — and never contains what the
operator actually typed. Both entries here end that way (`rejectionEntry`, not committed —
see `.ost-agent/evidence/TRANSCRIPT_42dcb7b4-f01b-40bc-a211-ed4a44a74fd3.md` in the vault
for the redacted summary).

The operator's own sentence arrives one hop later: after the rejection, the assistant asked
in plain text ("What would you like to clarify?"), and the *next* `user` entry is what they
actually wrote. `text` is that entry, verbatim. This is the material the solution node
means by "a sentence the operator wrote" — prose given as an answer, not a tool result — so
it is what `resolveFreeTextAnswer` is fed, not the rejection boilerplate that precedes it.
