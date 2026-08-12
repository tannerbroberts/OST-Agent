---
type: Solution
status: unvalidated
created: '2026-08-03'
evidence: assertion
---
#Solution #unvalidated #evidence/assertion
[[A caller about to make a failing call usually already doubts it, so a validate-only twin gets reached for]]

Every mutating call gains a validate-only twin: identical arguments, every check run, nothing written, and a verdict returned. A caller unsure whether a composition will be accepted asks first. The round trip is still spent, but it is spent on a call that was never going to change anything, so a rejection costs nothing but latency.

**Compared to the alternatives.** Covers every refusal the tool can issue, including ones too situational to publish or to summarise in a suggestion, and it can never drift from the real rules because it runs them. It is also the only option that still costs a round trip per uncertain call, and a caller who validates everything has doubled the traffic to avoid a rare failure.

**What would make this the wrong pick.** Validation is a promise about a moment. In a vault two agents share, a call that validates cleanly can be refused a second later, and a caller who trusts the verdict will be more surprised by that failure than by an ordinary one. It also does nothing for the caller who does not know they should be uncertain — which, on the evidence of three identical rung refusals in one day, is the actual case.

## Test

"Check how often the caller knew to be uncertain before the call that failed"

`npx vitest run test/telemetry/preflight-uncertainty-census.test.ts`

Green when the census, run over the committed usage and transcript fixtures, reports what fraction of failed calls were preceded by a visible hedge or a read. Feasibility and sizing only — it cannot show a caller would actually spend the extra call, and it produces no evidence that anyone outside this project wants a dry-run mode.

## History
- 2026-08-05 unlinked "Check how often the caller knew to be uncertain before the call that failed" — moved under "A caller about to make a failing call usually already doubts it, so a validate-only twin gets reached for" — the belief this test measures now has a node of its own
