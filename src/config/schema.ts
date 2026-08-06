/**
 * `ost.config.yaml` schema + defaults.
 *
 * Validated with Zod (v3). The `outcome` is required — the single human-set root
 * of the tree. Everything else has a safe default: no remote push, inbox enabled.
 */
import { z } from "zod";
import { parseCadence } from "../loop/cadence.js";

const RemoteSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z.string().optional(),
  })
  .default({ enabled: false });

/**
 * What a channel may be called.
 *
 * A channel name is three things at once: the cursor filename under
 * `.ost-agent/state/`, the id-namespace segment (`INBOX:<name>/<file>`), and the
 * key an operator reads in `ost-agent channels`. Lowercase alnum-dash only, so a
 * name can never contain `/` or `..` — which would be a cursor write *out of* the
 * state directory — and can never collide case-insensitively with another channel
 * on macOS, where `Support.json` and `support.json` are one file.
 */
export const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Names an operator may not take, because something already owns that cursor file.
 *
 * A channel called `usage` would write `.ost-agent/state/usage.json` — the usage
 * adapter's cursor — and the two would consume each other's watermark. `inbox` and
 * `friction` are reserved for the two channels this file declares itself: `inbox`
 * is channel zero, whose id shape is frozen (see `channelIdPrefix`), and `friction`
 * is where the agent files its own record.
 */
export const RESERVED_CHANNEL_NAMES = ["inbox", "friction", "transcript", "usage", "atlassian", "slack"] as const;

/**
 * One drop folder: its own path, its own cursor, its own id namespace, its own
 * declared cadence. `adapters.inbox` is channel zero rather than a special case.
 */
const DropChannelSchema = z.object({
  name: z
    .string()
    .regex(
      CHANNEL_NAME_PATTERN,
      "a channel name must be lowercase letters, digits and dashes (1-32 chars) — it is a filename and an id segment, not a label",
    ),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
  /**
   * Absent ⇒ this channel can never be reported silent. Same rule, and the same
   * reason, as `loop.cadence`: a tool that picks the number is deciding on the
   * operator's behalf what "this pipeline is dead" means.
   */
  cadence: z.string().nullish(),
});

export type DropChannel = z.infer<typeof DropChannelSchema>;

// Channel zero. The default path stays `.ost-agent/inbox` on purpose: changing it
// would mean a vault whose config omits the key silently stops reading the drop
// folder it already has. New vaults get an *escaping* path written into their own
// config by `init` instead, which is what makes "may write the drop folder" and
// "may write the tree" different grants (W1/DEC-1).
const InboxSchema = z
  .object({
    enabled: z.boolean().default(true),
    path: z.string().default(".ost-agent/inbox"),
    cadence: z.string().nullish(),
    /**
     * `.nullish().transform(v => v ?? [])`, never a bare `.default([])`: YAML hands
     * `null` for a bare `channels:` key, `z.array` REJECTS null, and an operator who
     * typed the key and went to look up the syntax would take the whole config down
     * over it. That is G1's failure mode exactly.
     */
    channels: z
      .array(DropChannelSchema)
      .nullish()
      .transform((v) => v ?? []),
  })
  // Pure string work only. Whether a channel's path escapes the vault cannot be
  // decided here — Zod has no vault directory — so confinement is the resolver's
  // job (`src/adapters/channels.ts`), which is also the only place that knows
  // which channels are first-party.
  .superRefine((inbox, ctx) => {
    const seen = new Set<string>();
    inbox.channels.forEach((c, i) => {
      if ((RESERVED_CHANNEL_NAMES as readonly string[]).includes(c.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channels", i, "name"],
          message: `"${c.name}" is reserved — it already names a cursor file under .ost-agent/state/, and two channels sharing one cursor consume each other's watermark`,
        });
      }
      if (seen.has(c.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channels", i, "name"],
          message: `duplicate channel name "${c.name}" — a name IS the cursor file, so two channels with one name are one channel`,
        });
      }
      seen.add(c.name);
      if (c.cadence != null && parseCadence(c.cadence) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["channels", i, "cadence"],
          message: `unreadable cadence "${c.cadence}" — use a count and a unit ("30m", "6h", "7d"). Guessing at it would be inventing the number that decides this channel is dead`,
        });
      }
    });
    if (inbox.cadence != null && parseCadence(inbox.cadence) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cadence"],
        message: `unreadable cadence "${inbox.cadence}" — use a count and a unit ("30m", "6h", "7d")`,
      });
    }
  })
  .default({ enabled: true, path: ".ost-agent/inbox", channels: [] });

const AtlassianSchema = z
  .object({
    enabled: z.boolean().default(false),
    projects: z.array(z.string()).default([]),
    spaces: z.array(z.string()).default([]),
  })
  .default({ enabled: false, projects: [], spaces: [] });

// Harvests the agent's own finished sessions as usage evidence. Opt-in: it reads
// session transcripts, so the operator turns it on deliberately.
//
// The keys below name ONE directory — the sessions in which the agent is worked
// on. A vault that also declares `loop.spend.sessionsDir` gets that directory
// harvested too, without naming it twice: those are the sessions in which the
// agent ran *by itself*, which is the other half of "the agent's own sessions"
// and the half a cwd-keyed session directory hides. See `transcriptDirs` in
// src/runner/context.ts. Every evidence item says which of the two it came from.
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
 * It stays an OPERATOR knob: it is the single field
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
const ProcessSchema = z.object({
  minSolutionsPerOpportunity: z.number().int().positive().default(DEFAULT_MIN_SOLUTIONS_PER_OPPORTUNITY),
});

// The unattended firing loop. Everything here is opt-in and nothing here has a
// permissive default: no cadence means the vault never fires, and no spend
// ceiling means it refuses to. A tool that picked either number would be
// choosing a spend rate on somebody else's account.
//
// `.nullish()` on every wrapper is load-bearing, not style. YAML gives `null`
// for a bare key, and `z.object({…}).optional()` REJECTS null — so an operator
// who typed `loop:` and went to look up the syntax would throw out of
// `loadConfig`, which every tool calls, and take the entire surface down over a
// key none of them read. That is G1's failure mode exactly.
const LoopSpendSchema = z.object({
  /** Weighted tokens, on eval/attention.ts's published ratios. Required. */
  ceilingWeightedTokens: z.number().positive().nullish(),
  /** The rolling window the ceiling applies to. Required. */
  windowHours: z.number().positive().nullish(),
  /** Where Claude Code writes this vault's session transcripts. Declared, never derived. */
  sessionsDir: z.string().min(1).nullish(),
});

// The ceiling on the operator's ATTENTION, as `loop.spend` is the ceiling on their
// account. Unlike spend, an absent block does NOT refuse to fire: an unbounded
// question budget is exactly today's behaviour, and refusing every vault that
// predates this key would be a stopping state with a human-only way out. It is
// printed as UNBOUNDED instead, because "the operator knows the upper bound before
// the run begins" is the claim and "there isn't one" is an answer to it.
const LoopQuestionsSchema = z.object({
  /** `AskUserQuestion` calls, not questions inside them — one ask is one interruption. */
  budget: z.number().int().nonnegative().nullish(),
  /** The rolling window the budget applies to. Required alongside `budget`. */
  windowHours: z.number().positive().nullish(),
  /** Where Claude Code writes this vault's session transcripts. Declared, never derived. */
  sessionsDir: z.string().min(1).nullish(),
});

const LoopSchema = z
  .object({
    /** How often this vault may fire: `"30m"`, `"6h"`, `"1d"`. Absent ⇒ never. */
    cadence: z.string().nullish(),
    /** How long a firing lock may be held before it is assumed dead and broken. */
    lockTtlMinutes: z.number().int().positive().default(60),
    spend: LoopSpendSchema.nullish(),
    questions: LoopQuestionsSchema.nullish(),
  })
  .nullish();

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
  loop: LoopSchema,
});

export type Config = z.infer<typeof ConfigSchema>;
export type LoopConfig = NonNullable<Config["loop"]>;
export type ProcessConfig = Config["processes"][string];

export interface DefaultConfigOptions {
  /**
   * The drop folder written into the scaffolded config, vault-relative.
   *
   * `init` passes an *escaping* path (`../<vault>.inbox`) so a fresh vault's
   * "may write the drop folder" grant is not the "may write the tree" grant
   * (W1/DEC-1). The literal string goes into the operator's own file rather than
   * being derived in code from an empty sentinel, because a path you can read in
   * your own config is what "blessed" means.
   *
   * The default here stays the historical in-vault path: this function is also
   * how tests and docs render a plain config, and a config the operator never
   * asked to escape must not silently claim to.
   */
  inboxPath?: string;
}

/** The scaffolded default config written at `init`, given a human-set outcome. */
export function defaultConfigYaml(outcome: string, outcomeTitle = "Outcome", opts: DefaultConfigOptions = {}): string {
  const inboxPath = opts.inboxPath ?? ".ost-agent/inbox";
  const inboxComment =
    inboxPath.startsWith("..")
      ? "drop notes here — OUTSIDE the vault on purpose, so writing the drop folder is a different grant from writing the tree"
      : "drop notes here; kept out of the vault root so Obsidian's graph shows only OST nodes";
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
    path: ${JSON.stringify(inboxPath)}   # ${inboxComment}
    # cadence: "7d"         # optional: \`ost-agent channels\` reports this folder silent if nothing
                            # has ARRIVED in that long. No default — nobody but you can say what
                            # "this pipeline is dead" means for your team.
    # channels:             # more drop folders, each with its own cursor, id namespace and cadence:
    #   - name: support     #   ids are INBOX:support/<file>; cursor is .ost-agent/state/support.json
    #     path: ../support-drop      #   must resolve OUTSIDE the vault, or it is refused
    #     cadence: "7d"
  transcript:
    enabled: false          # harvest the agent's own finished sessions as usage evidence (observed behavior, not demand)
    projectDir: ""          # repo whose sessions to read; transcripts are found under ~/.claude/projects/<slug>
    path: ""                # or point straight at a directory of *.jsonl transcripts
    quietMinutes: 30        # a session is "finished" once its file has been untouched this long
                            # an unattended firing runs with cwd set to the VAULT, so its sessions land
                            # elsewhere: if loop.spend.sessionsDir is set, that folder is harvested too,
                            # and each evidence item names which of the two it came out of
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
