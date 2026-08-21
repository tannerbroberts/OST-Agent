---
type: AssumptionTest
status: unvalidated
source: "INBOX:2026-08-17-platform-note.md"
created: '2026-08-20'
evidence: assertion
threshold: "the estimate is within 20% of actual duration on at least 9 of 10 sampled queries"
---
#AssumptionTest #evidence/assertion

**Design.** Sample ten queries over an hour long from last week's log and replay them with the estimator on. **Pre-committed threshold:** the estimate is within 20% of actual duration on at least 9 of 10 sampled queries.
