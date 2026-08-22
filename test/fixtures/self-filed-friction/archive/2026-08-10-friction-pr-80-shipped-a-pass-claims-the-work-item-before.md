# Friction (blocked): PR #80 shipped 'a pass claims the work item before it builds it' — src/loop/claim.ts, an ost-agent claim CLI command, and test/cli/claim.test.ts. Nothing invokes it: examples/automation/build-pass.sh has zero calls to it (its only 'claim' matches are English prose in comments), and no work-claims.jsonl exists in either candidate state dir (~/.local/state/ost-build-loop or the vault's .git/ost-agent). So there are zero claims on this machine, and two concurrent build passes would still collide on…

- **kind:** blocked
- **filed:** 2026-08-10T01:17:08.152Z



Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by
the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent
failed to notice or chose not to file.
