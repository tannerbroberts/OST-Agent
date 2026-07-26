/**
 * `ost.config.yaml` schema + defaults.
 *
 * Validated with Zod (v3). The `outcome` is required — the single human-set root
 * of the tree. Everything else has a safe default: no remote push, inbox enabled.
 */
import { z } from "zod";

const RemoteSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z.string().optional(),
  })
  .default({ enabled: false });

// Inbox lives under the .ost-agent dot-folder so Obsidian never graphs raw
// evidence notes — the vault root contains only actual OST nodes.
const InboxSchema = z
  .object({
    enabled: z.boolean().default(true),
    path: z.string().default(".ost-agent/inbox"),
  })
  .default({ enabled: true, path: ".ost-agent/inbox" });

const AtlassianSchema = z
  .object({
    enabled: z.boolean().default(false),
    projects: z.array(z.string()).default([]),
    spaces: z.array(z.string()).default([]),
  })
  .default({ enabled: false, projects: [], spaces: [] });

// Harvests the agent's own finished sessions as usage evidence. Opt-in: it reads
// session transcripts, so the operator turns it on deliberately.
const TranscriptSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Directory of `*.jsonl` transcripts. Empty ⇒ derive it from `projectDir`. */
    path: z.string().default(""),
    /** Repo whose sessions to harvest; used to derive the default transcript dir. */
    projectDir: z.string().default(""),
    /** A session counts as finished once untouched this long. */
    quietMinutes: z.number().int().positive().default(30),
    maxEventsPerSession: z.number().int().positive().default(25),
  })
  .default({ enabled: false, path: "", projectDir: "", quietMinutes: 30, maxEventsPerSession: 25 });

// Rolls the mechanical tool-invocation trace (.ost-agent/usage/events.jsonl,
// written by the telemetry layer on every surface) into one evidence item per
// finished day. The trace itself is always recorded — it is the vault's own
// operational log and never leaves the vault; this switch only controls
// whether the rollup enters discovery as evidence.
const UsageSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** A day needs at least this many tool calls to become an evidence item. */
    minEvents: z.number().int().positive().default(5),
  })
  .default({ enabled: true, minEvents: 5 });

const SlackSchema = z
  .object({
    enabled: z.boolean().default(false),
    channels: z.array(z.string()).default([]),
  })
  .default({ enabled: false, channels: [] });

// Outward web sensing. The budget bounds how much a single session can look
// (search + page reads share it); looking stays easy to start, hard to binge.
const WebSchema = z
  .object({
    lookupBudget: z.number().int().positive().default(10),
  })
  .default({ lookupBudget: 10 });

// The product the tree is FOR: local repo roots the agent may read (read-only,
// path-confined) so ideation is grounded in what the product actually is.
const ProductSchema = z
  .object({
    repos: z.array(z.string()).default([]),
  })
  .default({ repos: [] });

const ProcessSchema = z
  .object({
    cron: z.string().default(""),
    triggers: z.array(z.string()).default([]),
    limits: z
      .object({
        maxIterations: z.number().int().positive().default(30),
        timeoutSec: z.number().int().positive().default(300),
        tokenBudget: z.number().int().positive().optional(),
      })
      .default({ maxIterations: 30, timeoutSec: 300 }),
    minSolutionsPerOpportunity: z.number().int().positive().default(3),
  })
  .partial()
  .transform((p) => ({
    cron: p.cron ?? "",
    triggers: p.triggers ?? [],
    limits: p.limits ?? { maxIterations: 30, timeoutSec: 300 },
    minSolutionsPerOpportunity: p.minSolutionsPerOpportunity ?? 3,
  }));

export const ConfigSchema = z.object({
  // The steering mandate the agentic system optimizes toward (tuned often via
  // `ost-agent set-outcome`). Stored as the root node's body.
  outcome: z.string().min(1, "outcome is required — the mandate the system optimizes (human-set)"),
  // Stable, unique title/label for the root node (the graph's central hub).
  // Defaults to the vault folder name at init. Rarely changed.
  outcomeTitle: z.string().optional(),
  model: z.string().default("claude-opus-4-8"),
  remote: RemoteSchema,
  adapters: z
    .object({
      inbox: InboxSchema,
      transcript: TranscriptSchema,
      usage: UsageSchema,
      atlassian: AtlassianSchema,
      slack: SlackSchema,
    })
    .default({}),
  processes: z.record(z.string(), ProcessSchema).default({}),
  web: WebSchema,
  product: ProductSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProcessConfig = Config["processes"][string];

/** The scaffolded default config written at `init`, given a human-set outcome. */
export function defaultConfigYaml(outcome: string, outcomeTitle = "Outcome"): string {
  return `# OST-Agent configuration
outcome: ${JSON.stringify(outcome)}   # the steering mandate (human-set; tune with \`ost-agent set-outcome\`)
outcomeTitle: ${JSON.stringify(outcomeTitle)}   # stable label for the root node (rarely changed)
model: claude-opus-4-8

remote:
  enabled: false            # default: local-only, no push. Set url + enabled to push.

adapters:
  inbox:
    enabled: true
    path: .ost-agent/inbox  # drop notes here; kept out of the vault root so Obsidian's graph shows only OST nodes
  transcript:
    enabled: false          # harvest the agent's own finished sessions as usage evidence (observed behavior, not demand)
    projectDir: ""          # repo whose sessions to read; transcripts are found under ~/.claude/projects/<slug>
    path: ""                # or point straight at a directory of *.jsonl transcripts
    quietMinutes: 30        # a session is "finished" once its file has been untouched this long
  usage:
    enabled: true           # roll the mechanical tool-invocation trace into daily evidence (observed behavior, no narrator)
    minEvents: 5            # a day needs at least this many tool calls to become an evidence item
  atlassian:
    enabled: false
    projects: []
    spaces: []
  slack:
    enabled: false
    channels: []

web:
  lookupBudget: 10          # web lookups (search + page reads) one session may spend; set BRAVE_SEARCH_API_KEY to enable search

product:
  repos: []                 # local repo paths the agent may READ (read-only) to ground ideas in what the product is

processes:
  P1_ingest:      { cron: "*/15 * * * *", triggers: ["inbox:new"] }
  P2_map:         { cron: "",             triggers: ["after:P1_ingest"] }
  P3_ideate:      { cron: "0 */6 * * *",  triggers: ["after:P2_map"], minSolutionsPerOpportunity: 3 }
  P4_assumptions: { cron: "",             triggers: ["after:P3_ideate"] }
  P5_hygiene:     { cron: "0 3 * * *",    triggers: [] }
`;
}
