---
type: Solution
source: 'TRANSCRIPT:0f28d01f-35fa-49f0-b085-89170e306ef8'
created: '2026-08-18'
evidence: assertion
---
#Solution #unvalidated #evidence/assertion
[[A background task can declare its own output path and have Monitor's read scope extended to exactly that path]]

When a run backgrounds a task that writes logs outside the session's normal allowed directories, extend Monitor's read scope to cover exactly the path that task itself declared it would write to, for the lifetime of that task — so a `tail` on the task's own log does not hit the same working-directory restriction meant for arbitrary file reads.
