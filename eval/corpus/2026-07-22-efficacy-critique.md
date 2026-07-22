Source: design review conversation, 2026-07-22

The maintainer pushed back hard: "This is already way too open-ended. How does the
efficacy of the system ever get tested holistically?" The plumbing is well unit-tested
(append-only vault, allowlist, adapters), but nothing tests whether the agent actually
produces a good, faithful Opportunity Solution Tree from real evidence. The end-to-end
test used a scripted driver that hand-fed canned outputs, so it proves the pipeline moves
nodes, not that the ideation is any good. Adding more adapters or scheduler polish widens
the sprawl instead of proving value. The team cannot currently tell if the system works.
