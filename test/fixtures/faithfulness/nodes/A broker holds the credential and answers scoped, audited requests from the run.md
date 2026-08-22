---
type: Solution
status: unvalidated
created: '2026-08-03'
evidence: assertion
---
#Solution #unvalidated #evidence/assertion
[[Operators will accept one process holding every secret, in exchange for never handing one to a run]]

The operator hands the secret once, to a small local broker, and never to a run. A run asks the broker for a specific action against a specific target — push this branch, read this issue — and the broker performs it and returns the result. The run never sees the secret, and every request is logged with who asked, for what, and what came back.

This converts the credential from a thing a run must possess into a service a run may call. The operator's involvement moves from per-run to once, and what they are trusting is a written scope rather than an agent's judgement in the moment.

**Compared to the alternatives.** Strictly more capable than batching approvals, because the run never stops at all rather than stopping in one place. More expensive than short-lived tokens, since it needs a process that stays up and a policy language to express the scopes. Its real advantage over both is the audit log: it is the only one of the three that leaves a record of what the credential was actually used for.

**What would make this the wrong pick.** It concentrates every secret into one process on one machine. If that trade is unacceptable — and for some operators it plainly is — the scoped-token route gives most of the unblocking with none of the concentration.

## Definition of done

"Ask five operators whether they would put their secret in a broker that acts for a run"

`npx vitest run test/security/credential-broker.test.ts`

The spec asserts the containment the node's argument rests on: a run asking for a scoped action gets the result and never the secret, and every request lands in the log with who asked, for what, and what came back. That last part is what the node claims as its real advantage over both siblings, so it is the right thing to make falsifiable. Red today because no broker, scope policy or request log exists.

**What a green here does not settle.** Whether operators would hand a secret to a broker at all — the node's own stated risk is that concentrating every secret into one process on one machine is plainly unacceptable to some of them, and no spec can find out which. That stays with the humans-required test. A green also cannot weigh this against short-lived tokens, since the comparison is about a trade an operator makes, not about whether the code works.

## History
- 2026-08-05 unlinked "Ask five operators whether they would put their secret in a broker that acts for a run" — moved under "Operators will accept one process holding every secret, in exchange for never handing one to a run" — the belief this test measures now has a node of its own
