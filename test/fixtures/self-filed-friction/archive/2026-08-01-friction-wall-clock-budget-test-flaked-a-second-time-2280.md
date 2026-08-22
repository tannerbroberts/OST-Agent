# Friction (slow): wall-clock-budget test flaked a second time (2280ms vs 2000ms budget), same test as the twentieth pass's filing; that pass named a second flake as worth a human's eye rather than routine re-filing

- **kind:** slow
- **filed:** 2026-08-01T20:32:48.136Z
- **filed by:** loop

**Context:** twenty-first scheduled pass, full-suite vitest run in OST-Agent; test/mcp/wall-clock-budget.test.ts failed on the first run again, passed in isolation again — same shape, same root cause (zero tolerance for suite-level CPU contention), but now a second confirmed occurrence rather than a one-off

Filed by the agent at the moment of friction. Evidence class: **observed behavior** — self-reported by
the product's own agent, so it grounds usability, not demand, and is subject to whatever this agent
failed to notice or chose not to file.
