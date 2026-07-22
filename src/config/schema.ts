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

const SlackSchema = z
  .object({
    enabled: z.boolean().default(false),
    channels: z.array(z.string()).default([]),
  })
  .default({ enabled: false, channels: [] });

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
  outcome: z.string().min(1, "outcome is required — the single #Outcome (human-set)"),
  model: z.string().default("claude-opus-4-8"),
  remote: RemoteSchema,
  adapters: z
    .object({
      inbox: InboxSchema,
      atlassian: AtlassianSchema,
      slack: SlackSchema,
    })
    .default({}),
  processes: z.record(z.string(), ProcessSchema).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
export type ProcessConfig = Config["processes"][string];

/** The scaffolded default config written at `init`, given a human-set outcome. */
export function defaultConfigYaml(outcome: string): string {
  return `# OST-Agent configuration
outcome: ${JSON.stringify(outcome)}   # the single #Outcome (human-set; the agent never changes this)
model: claude-opus-4-8

remote:
  enabled: false            # default: local-only, no push. Set url + enabled to push.

adapters:
  inbox:
    enabled: true
    path: .ost-agent/inbox  # drop notes here; kept out of the vault root so Obsidian's graph shows only OST nodes
  atlassian:
    enabled: false
    projects: []
    spaces: []
  slack:
    enabled: false
    channels: []

processes:
  P1_ingest:      { cron: "*/15 * * * *", triggers: ["inbox:new"] }
  P2_map:         { cron: "",             triggers: ["after:P1_ingest"] }
  P3_ideate:      { cron: "0 */6 * * *",  triggers: ["after:P2_map"], minSolutionsPerOpportunity: 3 }
  P4_assumptions: { cron: "",             triggers: ["after:P3_ideate"] }
  P5_hygiene:     { cron: "0 3 * * *",    triggers: [] }
`;
}
