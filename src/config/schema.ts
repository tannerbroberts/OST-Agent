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

// Outward web sensing. `lookupBudget` is the burst capacity (search + page
// reads share it); `lookupRefillPerHour` is the sustained rate, which is what
// lets a session that lives for weeks keep working. Set the rate to 0 to get
// the old non-refilling behaviour.
//
// Federated search is OFF by default and that is deliberate: if it defaulted
// on, provider resolution would never reach the delegation branch, and an
// agent in a host that HAS web search would call ost_search_web, get the
// narrower federated results, and never learn its own search was better.
// discourseHosts is capped because the merge fills from the front: with more
// sources than result slots, the tail contributes nothing to a given call while
// still costing a live request against somebody's free forum. The provider
// rotates who goes first so starvation is temporary, but a long list is still
// mostly wasted traffic. Five is generous for a fallback.
const FederatedSchema = z
  .object({
    enabled: z.boolean().default(false),
    discourseHosts: z.array(z.string()).max(5).default([]),
  })
  .default({ enabled: false, discourseHosts: [] });

const WebSchema = z
  .object({
    lookupBudget: z.number().int().positive().default(10),
    lookupRefillPerHour: z.number().int().nonnegative().default(10),
    search: z.object({ federated: FederatedSchema }).default({ federated: { enabled: false, discourseHosts: [] } }),
  })
  .default({
    lookupBudget: 10,
    lookupRefillPerHour: 10,
    search: { federated: { enabled: false, discourseHosts: [] } },
  });

// The product the tree is FOR: local repo roots the agent may read (read-only,
// path-confined) so ideation is grounded in what the product actually is.
const ProductSchema = z
  .object({
    repos: z.array(z.string()).default([]),
  })
  .default({ repos: [] });

/**
 * How many candidate solutions an opportunity needs before `ost_next_work`
 * stops calling it under-served.
 *
 * Exported because three places need this number — the schema default, the
 * scaffolded `ost.config.yaml`, and the fallback in `buildOstTools` for a
 * ToolContext assembled without a config — and until now the third was an
 * independent literal `3` that could drift from the other two silently.
 *
 * It stays an OPERATOR knob rather than a genome allele: it is the single field
 * an operator most plausibly tunes per vault, and `test/config/load.test.ts`
 * pins it there. But a policy with two sources of truth cannot be reasoned
 * about at all, evolvable or not.
 */
export const DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY = 3;

// Per-process tuning. `minSolutionsPerOpportunity` is the only knob left: it is
// what `ost_next_work` uses to decide an opportunity is under-served.
//
// Vaults created before the API-key runner was deleted still carry `cron`,
// `triggers`, and `limits` here, and `model` at the top level — they scheduled
// and bounded passes that no longer exist. Those keys are deliberately NOT
// declared and deliberately NOT rejected: this schema uses Zod's default
// object behaviour, which strips undeclared keys instead of failing, so an
// existing vault keeps loading and simply stops being asked about a model.
// (`genome.yaml` is deliberately the opposite — strict — because a dropped
// allele would read as "behaviour unchanged".)
const ProcessSchema = z.object({
  minSolutionsPerOpportunity: z.number().int().positive().default(DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY),
});

export const ConfigSchema = z.object({
  // The steering mandate the agentic system optimizes toward (tuned often via
  // `ost-agent set-outcome`). Stored as the root node's body.
  outcome: z.string().min(1, "outcome is required — the mandate the system optimizes (human-set)"),
  // Stable, unique title/label for the root node (the graph's central hub).
  // Defaults to the vault folder name at init. Rarely changed.
  outcomeTitle: z.string().optional(),
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

# No model is named here, and none is needed: OST-Agent never calls one. The
# Claude Code session you are talking to supplies all the reasoning; everything
# this project runs on its own is deterministic.

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
  lookupBudget: 10          # burst: web lookups (search + page reads) available at once
  lookupRefillPerHour: 10   # sustained rate; 0 disables refill (one burst per process)
  search:
    federated:
      enabled: false        # keyless fallback for hosts with NO web search of their own.
                            # Leave off if your host has search — ost_search_web will tell
                            # the agent to use it, which is better than these sources.
      discourseHosts: []    # e.g. [forum.obsidian.md]

product:
  repos: []                 # local repo paths the agent may READ (read-only) to ground ideas in what the product is

processes:
  P3_ideate:
    minSolutionsPerOpportunity: ${DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY}   # how many candidate solutions an opportunity needs before \`ost_next_work\` stops calling it under-served
`;
}
