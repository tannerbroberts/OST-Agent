# The resource-question subject — what was cut, and from where

`test/config/resource-question-recoverability.test.ts` asks, for each of the five
standing resource questions, whether the vault already holds the answer. The answer has
to be the same next year and has to run offline, so the subject lives here rather than
being read off the machine that produced it.

| File | What it is |
| --- | --- |
| `ost.config.yaml` | The `ost-agent-meta` vault's config, copied verbatim on 2026-08-20. Nothing was edited, including the comments — the `loop.spend` block and its history are the point. |

The manifest half of the subject is not duplicated here: the spec reuses
`test/fixtures/manifest-planner/hand-filled.ost.resources.yaml`, the manifest a human
filled for the same vault on 2026-08-04 from facts already recorded in its prose. That
file's own `PROVENANCE.md` names where each field was read off, and the spec's last part
rests on exactly that: a vault carrying it answers every question, so the cadence's case
there is decay alone.

What this cut cannot support: anything about timing. Whether the full question set can
be answered in under ten minutes, and how fast an answer goes stale, are properties of
the operator and are not in any file.
