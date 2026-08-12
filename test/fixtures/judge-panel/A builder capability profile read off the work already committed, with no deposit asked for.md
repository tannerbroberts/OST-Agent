---
type: Solution
source: 'agent-ideated:2026-08-03-unattended-sweep-builder-capability'
created: '2026-08-03'
evidence: assertion
---
#Solution #unvalidated #evidence/assertion
[[The commits and PRs already written are specific enough to name what their author can do]]

**The mechanism:** nobody is asked to deposit anything. The agent builds its picture of each collaborator from the record that already exists and that it can already reach — authored commits and their diffs, PR descriptions and review exchanges, which node bodies a builder wrote, which tests they ran and which they abandoned, what they attempted and reverted. The profile is an inference over artifacts, not a submission.

**Why this shape.** The opportunity names two facets, and this candidate deliberately solves only the first (a capability picture) while refusing the second (contributors knowing the channel exists). That is its whole argument: facet 2 is a compliance problem, and a mechanism that needs no compliance cannot be defeated by non-compliance. It is also the only one of the three that works retroactively — the moment it is built it has months of history to read, where both other candidates start empty.

**Chief risk, stated plainly:** it models what a builder *did* under the constraints they were under, and reads that as what they *can* do. Capability never exercised is invisible to it, and capability suppressed by a bad environment reads as capability absent — the profile would confidently record a ceiling that is really a floor. It also cannot see a collaborator who works outside the repo at all: a stakeholder whose contribution is a decision in conversation leaves no artifact for this to read, and would be profiled as having no capability rather than as unobserved.

**Contrast with neighbors:** "Adopt session transcripts as the trace source instead of new instrumentation" acquires traces to serve the usage-feed opportunity — mechanical events, narrator distrusted. This candidate reads the *authored* record for a different question: not what happened, but what the author demonstrably knows how to do. "A declared resource manifest the planner must cite before it ranks anything" is declaration over project resources; this is inference over collaborator skill, opposite mechanism and different scope.

**Cost shape:** cheap to build against a git-backed project, worthless against a collaborator who leaves no artifact, and it improves with the age of the record rather than with the operator's effort.

## Definition of done

"Count how much of the committed record could name a capability at all"

```
npx vitest run test/product/committed-capability-profile.test.ts
```

Green means a capability profile can in fact be derived from commits alone, with nothing asked of the operator. It settles feasibility only. Whether the profile it produces is *accurate* about what a builder can do, and whether anyone would act on it, are untouched by this command.

## History
- 2026-08-05 unlinked "Count how much of the committed record could name a capability at all" — moved under "The commits and PRs already written are specific enough to name what their author can do" — the belief this test measures now has a node of its own
