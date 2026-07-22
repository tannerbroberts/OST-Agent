Source: design spec, trust model, 2026-07-22

Hard requirement: the worst case an operator will tolerate is that the agent makes commits
that make no sense. No destructive action may be possible, even under a prompt-injection
attack delivered through ingested content (a poisoned Jira comment saying "delete
everything"). The agent must operate on a git folder, instantiate git if absent, never
delete, and only ever make new commits. Remote push is optional and off by default.
