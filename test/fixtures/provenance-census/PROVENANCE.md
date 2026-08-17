# Provenance-census ground truth — the three guards that agreed with the bug

`test/guards/provenance-census-scores-against-known-defects.test.ts` scores
`scripts/provenance-census.ts` against the one population where the answer is
already known: the three files named in "A guard derived the rule it was
checking, so it agreed with the bug for 23 releases" (vault, 2026-08-06). Each
derived the MCP tool-name prefix independently from `.claude-plugin/plugin.json`,
all three the same wrong way, and all three shipped for 23 releases without
disagreeing with each other.

The three files here are git blobs taken verbatim from `4521f06^` — the commit
immediately before `fix(plugin): every grant named a tool no plugin session
mints` (`4521f06`) replaced all three derivations with one shared import from
`scripts/mcp-prefix.ts`:

```bash
git show 4521f06^:scripts/gen-skill.ts               > gen-skill.defective.ts.txt
git show 4521f06^:test/release/command-allowlists.test.ts > command-allowlists.defective.test.ts.txt
git show 4521f06^:test/skill/surface-parity.test.ts       > surface-parity.defective.test.ts.txt
```

Named `*.txt` rather than `*.ts` so neither `tsc` (its imports do not resolve
from this directory) nor vitest's `test/**/*.test.ts` glob (which would try to
run them as live tests) ever touch them. They are census subjects, not code.

## Why only two of the three are inspectable by an assertion census

`scripts/gen-skill.ts` is a generator: it computes the wrong prefix and writes
it into `SKILL.md`, but it contains no `expect(...)` — nothing there disagrees
or agrees with anything, because nothing there is a check. A provenance
census, scoped to "every assertion in the suite" per its own definition, has
no assertion to examine in that file. That is not a gap in the census; it is
the census correctly reporting that a generator with no check on it is
invisible to *any* assertion-based technique, syntactic or not — a distinct
and larger finding than "this file's assertion was too permissive."

The two guards that are inspectable: `test/release/command-allowlists.test.ts`
asserts `expect(MCP_PREFIX).toBe("mcp__ost-agent__")` — a locally-derived
value against a hardcoded literal. `test/skill/surface-parity.test.ts` asserts
`expect(prefixProblems(skill, MCP_PREFIX)).toEqual([])` — a locally-derived
value folded into a call, against an empty-array literal. Neither expected
side traces to an import or declaration the census tracks, so neither is
flagged. That is the expected result: the census is syntactic (import- and
declaration-based), and these three files share no import edge with each
other — three independent derivations of one wrong belief, which is exactly
the shape the vault node predicted the census would miss.
