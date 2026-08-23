---
type: Solution
status: unvalidated
evidence: assertion
source: 'INBOX:2026-07-24-opp-idempotent-runtime.md'
created: '2026-07-24'
---
_(prose elided — this fixture preserves only the inputs the two accountings read)_
`INBOX:2026-07-24-friction-a-backgrounded-session-leaves-no-marker-of-where.md`: a builder pass was backgrounded mid-work; the next pass had no way to tell finished from abandoned. Exactly the failure this solution exists to prevent — first observed instance in the wild. Evidence class: observed behavior (self-reported by the agent at the moment of friction).
