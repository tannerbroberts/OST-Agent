# Friction (slow): wall-clock-budget test flaked once: ost_next_work took 2004ms against a 2000ms budget when run inside the full 141-file suite, passed cleanly (18077ms well under its own margin) re-run in isolation seconds later

- **kind:** slow
- **filed:** 2026-08-01T19:30:22.444Z
- **filed by:** loop

**Context:** twentieth scheduled pass, running the OST-Agent gates (npm install, tsc --noEmit, vitest run) against the meta vault; test/mcp/wall-clock-budget.test.ts is a hard-coded ms threshold with no tolerance for suite-level CPU contention, so it can fail on a shared sandbox without any code regression

Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by
the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent
failed to notice or chose not to file.
