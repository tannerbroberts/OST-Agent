/**
 * The channel layer — the single source of truth about the vault's drop folders.
 *
 * There is exactly one concept here: a **channel** is a named drop folder with its
 * own path, its own cursor file, its own id namespace and its own declared cadence.
 * `adapters.inbox` is *channel zero* rather than a special case, and **all** of the
 * back-compat lives in {@link resolveChannels}. Every consumer — the context
 * builder, the ingest tool, the friction filer, `ost-agent channels` — reads this
 * function's output and never reads `config.adapters.inbox` directly. That is what
 * stops the ingestion path being rebuilt once per consumer, each with its own idea
 * of which folder is real.
 *
 * Three things deliberately do NOT live here and are not config-driven: `ACTORS`,
 * the `INBOX:` id prefix, and how provenance is classified. Config may mint a new
 * channel *instance*; it may never mint a new trust *kind*. Every drop folder,
 * however many there are, stamps `actor: "inbox"` — they are one trust kind (a
 * folder writable by whoever can write that mount), and one kind gets one ceiling,
 * decided in `source.ts` next to the union rather than in somebody's YAML.
 */
import fs from "node:fs";
import path from "node:path";
import { CHANNEL_NAME_PATTERN, RESERVED_CHANNEL_NAMES, type Config } from "../config/schema.js";
import { CONFIG_FILENAME } from "../config/load.js";
import { parseCadence } from "../loop/cadence.js";
import { defaultTranscriptDir } from "./transcript.js";
import { usageLogPath } from "../telemetry/usage.js";
import { loadCursorRecord } from "./source.js";
import { MIN_SECRET_CHARS } from "../security/broker.js";
import { resolveCredential } from "../security/credential-forms.js";
import { atlassianOffers, slackOffers } from "../runner/credentials.js";

/**
 * Channel zero: the drop folder every vault has already had, under the name its
 * cursor file already carries.
 *
 * Its id shape is FROZEN. If `INBOX:note.md` became `INBOX:inbox/note.md`, every
 * existing cursor — a JSON set of ids — would stop matching and every note in every
 * existing vault would re-ingest. That is a data event, not a refactor.
 */
export const CHANNEL_ZERO = "inbox";

/**
 * The agent's own record of where it got stuck, as a first-party channel.
 *
 * It lives INSIDE the vault on purpose, which is the opposite of every other
 * channel. Once channel zero's folder moved outside the git working tree, a
 * friction filing written there would stop being committed by the vault's own
 * `git add -A` — the agent would silently lose its own record. So the filings get
 * a folder of their own, inside, where they are versioned.
 */
export const FRICTION_CHANNEL = "friction";
export const FRICTION_CHANNEL_PATH = ".ost-agent/friction";

/** Where a channel came from, which is what decides how strictly it is judged. */
export type ChannelOrigin =
  /** `adapters.inbox` — the key every existing vault already carries. */
  | "channel-zero"
  /** Declared by this file, with a path chosen in code. */
  | "first-party"
  /** `adapters.inbox.channels[]` — new expressiveness, born confined. */
  | "config"
  /**
   * A commissioned pipeline rather than a folder: `transcript`, `usage`,
   * `atlassian`, `slack`. It has a cursor file, a declared switch and a producer
   * that can die — everything a report needs — and no drop folder at all.
   */
  | "commissioned";

/**
 * Anything `ost-agent channels` may report on — a folder or a pipeline.
 *
 * This exists because S2's sentence is "**every** commissioned channel is
 * enumerable", and a report that covers the drop folders alone answers about three
 * of the six channels a default vault runs. `resolveChannels` still returns drop
 * folders only, deliberately: it is what `buildPassContext` and `init` iterate to
 * decide which folders to *read* and *create*, and folding a Slack workspace into
 * that list would ask `init` to mkdir it. So the reporting shape is the wider one
 * and {@link ResolvedChannel} is a subtype of it, which keeps one health function
 * and one renderer for both kinds.
 */
export interface ReportableChannel {
  name: string;
  /** Exactly as the operator wrote it, so a report names something they recognise. */
  declaredPath: string;
  enabled: boolean;
  /** Declared cadence string, or null. Absent ⇒ never reportable as silent. */
  cadence: string | null;
  origin: ChannelOrigin;
  /** Absolute directory this channel reads, when it reads a directory at all. */
  dir?: string;
  /** What it reads when that is not a folder — an endpoint, in the operator's terms. */
  endpoint?: string;
  /**
   * True when the folder resolves OUTSIDE the vault root — which is what makes
   * "may write the drop folder" and "may write the tree" different grants (W1).
   * False means the folder is inside the git working tree. Undefined for a channel
   * with no folder, where the question does not arise — and undefined rather than
   * `true` on purpose, so a Slack pipeline never renders the W1 reassurance that
   * belongs to a folder someone had to place.
   */
  confined?: boolean;
  /**
   * Enabled, asked for, and not runnable — the reason in one line.
   *
   * A separate field from `enabled` because "turned off" and "asked for and broken"
   * are the two facts S2 exists to stop being one observable. Mirrors
   * `UnavailableSource.kind` in `src/processes/types.ts`, which is where the same
   * distinction is made for the ingest path.
   */
  unavailable?: string;
}

export interface ResolvedChannel extends ReportableChannel {
  /** Absolute directory this channel reads. Always present for a drop folder. */
  dir: string;
  confined: boolean;
}

export interface ChannelResolution {
  channels: ResolvedChannel[];
  /**
   * Channels that were refused, in the operator's terms. Merged into
   * `configProblem` by the context builder — never thrown, so a bad channel list
   * costs the ingest capability and nothing else (G1).
   */
  problems: string[];
}

/**
 * The id prefix a channel stamps on everything it captures.
 *
 * **`INBOX:` is an actor-kind constant and never a config value.** A config-minted
 * prefix (`SUPPORT:foo.md`) would be unrecognised by `EVIDENCE_ID_PREFIXES`, whose
 * closed list is what tells a citation of a stored record apart from an honest
 * non-stored one — so a node citing `SUPPORT:typo.md` would read as legitimately
 * non-stored and its dangling citation would never be reported (W12). It would also
 * let a channel named `interview` lift its whole namespace above the believability
 * floor from a YAML file.
 *
 * The separator is `/`, which a filename cannot contain and a channel name cannot
 * contain, so an id parses uniquely at its first slash — and the channel segment is
 * something the file's author cannot forge, unlike the filename they chose.
 *
 * The prefix is written as ONE template literal on purpose:
 * `test/mcp/w12-citation-resolution.test.ts` derives the set of prefixes the
 * adapters mint by grepping `src/adapters/` for exactly this shape, and a prefix an
 * adapter mints that `EVIDENCE_ID_PREFIXES` omits is a citation nothing checks.
 */
export function channelIdPrefix(channel: string): string {
  if (!CHANNEL_NAME_PATTERN.test(channel)) {
    throw new Error(`refusing to mint ids for channel "${channel}" — a channel name must match ${CHANNEL_NAME_PATTERN}`);
  }
  // Channel zero's shape is bare. If `INBOX:note.md` became `INBOX:inbox/note.md`,
  // every existing cursor would stop matching and every vault would re-ingest.
  const segment = channel === CHANNEL_ZERO ? "" : `${channel}/`;
  return `INBOX:${segment}`;
}

/**
 * Resolve a path that may not exist yet through any symlinked ancestor.
 *
 * A symlink is the one way a lexically-outside path is really inside, and the
 * grant W1 is about would be defeated by it silently. So the deepest ancestor that
 * exists is realpath'd and the rest re-appended; a folder about to be created is
 * judged by where its parent actually is.
 */
function realpathish(p: string): string {
  let head = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    if (fs.existsSync(head)) {
      try {
        return path.join(fs.realpathSync(head), ...tail);
      } catch {
        return path.resolve(p);
      }
    }
    const parent = path.dirname(head);
    if (parent === head) return path.resolve(p);
    tail.unshift(path.basename(head));
    head = parent;
  }
}

/** Does `target` land inside the vault's own directory tree? */
export function isInsideVault(vaultDir: string, target: string): boolean {
  const vault = realpathish(vaultDir);
  const rel = path.relative(vault, realpathish(target));
  if (rel === "") return true;
  return !rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel);
}

function resolveOne(
  vaultDir: string,
  input: { name: string; declaredPath: string; enabled: boolean; cadence: string | null; origin: ChannelOrigin },
): ResolvedChannel {
  const dir = path.resolve(vaultDir, input.declaredPath);
  return {
    name: input.name,
    dir,
    declaredPath: input.declaredPath,
    enabled: input.enabled,
    cadence: input.cadence,
    confined: !isInsideVault(vaultDir, dir),
    origin: input.origin,
  };
}

/**
 * Every channel this vault has, with all of the back-compat in one place.
 *
 * **A vault carrying today's single `adapters.inbox` needs no migration at all.**
 * The old key keeps its meaning and its cursor file and its id shape; adopting a
 * second channel is a purely additive config diff.
 *
 * The one asymmetry is deliberate. An `adapters.inbox.path` that resolves *inside*
 * the vault is **grandfathered**: accepted, marked `confined: false`, and labelled
 * by name on every surface that lists channels, with a remedy. A channel declared
 * under the new `channels:` key that resolves inside the vault is **refused**. New
 * expressiveness is born confined; only the key that already existed is
 * grandfathered — which enforces the safety property on everything new without
 * breaking a single existing vault at load. (Refusing inside-vault outright breaks
 * every existing vault; accepting silently is the state W1 already calls
 * "undocumented, untested and unvalidated"; a `strict: true` opt-in is a safety
 * property enforced on nobody.)
 */
export function resolveChannels(vaultDir: string, config: Config): ChannelResolution {
  const vault = path.resolve(vaultDir);
  const inbox = config.adapters.inbox;
  const channels: ResolvedChannel[] = [];
  const problems: string[] = [];

  channels.push(
    resolveOne(vault, {
      name: CHANNEL_ZERO,
      declaredPath: inbox.path,
      enabled: inbox.enabled,
      cadence: inbox.cadence ?? null,
      origin: "channel-zero",
    }),
  );

  // Gated on the same switch as channel zero: `adapters.inbox.enabled: false` has
  // always meant "the drop-folder adapter is off", and friction filings have always
  // landed in that folder — so following the switch keeps today's behaviour exactly
  // rather than quietly starting to read a folder the operator turned off.
  channels.push(
    resolveOne(vault, {
      name: FRICTION_CHANNEL,
      declaredPath: FRICTION_CHANNEL_PATH,
      enabled: inbox.enabled,
      cadence: null,
      origin: "first-party",
    }),
  );

  const taken = new Set(channels.map((c) => c.name));
  for (const declared of inbox.channels) {
    // The schema refuses all three of these, so reaching them means a Config was
    // built in code rather than parsed. Checked anyway: this function is the last
    // gate before a name becomes a filename under `.ost-agent/state/`.
    if (!CHANNEL_NAME_PATTERN.test(declared.name)) {
      problems.push(`adapters.inbox.channels: "${declared.name}" is not a usable channel name (lowercase letters, digits and dashes).`);
      continue;
    }
    if (taken.has(declared.name) || (RESERVED_CHANNEL_NAMES as readonly string[]).includes(declared.name)) {
      problems.push(
        `adapters.inbox.channels: "${declared.name}" is already taken — a name IS the cursor file, so two channels with one name would consume each other's watermark.`,
      );
      continue;
    }
    const resolved = resolveOne(vault, {
      name: declared.name,
      declaredPath: declared.path,
      enabled: declared.enabled,
      cadence: declared.cadence ?? null,
      origin: "config",
    });
    if (!resolved.confined) {
      problems.push(
        `adapters.inbox.channels: "${declared.name}" points at ${resolved.dir}, which is inside the vault — refused. ` +
          "A drop folder inside the git working tree makes writing evidence the same grant as writing the tree. " +
          "Point it outside the vault (e.g. `../" + declared.name + "-drop`).",
      );
      continue;
    }
    taken.add(declared.name);
    channels.push(resolved);
  }

  return { channels, problems };
}

/** Just the channels something should actually read. */
export function enabledChannels(resolution: ChannelResolution): ResolvedChannel[] {
  return resolution.channels.filter((c) => c.enabled);
}

/** The environment a credential check reads. Injected so the probe is testable. */
export type ChannelEnv = Readonly<Record<string, string | undefined>>;

interface CommissionedSpec {
  name: string;
  /** The config key that declares it — what the operator would go and edit. */
  declaredPath: string;
  enabled: (config: Config) => boolean;
  /** What it reads, in the operator's terms. */
  endpoint: (vaultDir: string, config: Config) => string | undefined;
  /** `null` ⇒ it can run. A one-line reason ⇒ it cannot, though it was asked for. */
  unavailable: (config: Config, env: ChannelEnv) => string | null;
}

/**
 * The channels that are pipelines rather than folders.
 *
 * **This list mirrors `buildSources` in `src/runner/context.ts`, and the mirror is
 * the risk.** That function decides whether a source can be *built*; this one
 * decides what a *report* says about the same channel, and the two disagreeing would
 * mean `ost-agent channels` calls a channel healthy that no pass can run — the exact
 * "success and failure share one observable" shape S2 is about. They are separate
 * because the report must not construct sources: `ost-agent channels` runs against a
 * vault it may not touch and a config it may not be able to parse, and
 * `buildPassContext` opens a Vault handle that creates the directory.
 *
 * `test/cli/channels.test.ts` holds the two together: for every channel here it
 * builds a real `PassContext` over a matrix of switches and credentials and asserts
 * the report's verdict and `unavailableSources` agree, channel by channel. A new
 * adapter added to one and not the other fails there rather than in a quiet report.
 *
 * Every entry declares `cadence: null` and that is not an oversight — see
 * {@link commissionedChannels}.
 */
const COMMISSIONED: readonly CommissionedSpec[] = [
  {
    name: "transcript",
    declaredPath: "adapters.transcript",
    enabled: (c) => c.adapters.transcript.enabled,
    endpoint: (vaultDir, c) => {
      const t = c.adapters.transcript;
      if (t.path) return path.resolve(vaultDir, t.path);
      return t.projectDir ? defaultTranscriptDir(t.projectDir) : undefined;
    },
    unavailable: (c) =>
      c.adapters.transcript.path || c.adapters.transcript.projectDir
        ? null
        : "enabled but neither `path` nor `projectDir` is set — set projectDir to the repo whose sessions to harvest, " +
          "or path to a directory of *.jsonl transcripts.",
  },
  {
    name: "usage",
    declaredPath: "adapters.usage",
    enabled: (c) => c.adapters.usage.enabled,
    endpoint: (vaultDir) => usageLogPath(vaultDir),
    // The one channel that needs nothing: the trace it rolls up is the vault's own
    // file, written by every surface. Enabled is therefore always runnable, and a
    // quiet `usage` really is a quiet vault rather than a missing credential.
    unavailable: () => null,
  },
  {
    name: "atlassian",
    declaredPath: "adapters.atlassian",
    enabled: (c) => c.adapters.atlassian.enabled,
    endpoint: (_vaultDir, c) => {
      const scope = [...c.adapters.atlassian.projects, ...c.adapters.atlassian.spaces].join(", ");
      return `Atlassian Cloud${scope ? ` (${scope})` : ""}`;
    },
    // The same intake the broker resolves, not truthiness: what counts as a
    // credential being present is the credential broker's answer, because the
    // broker is what will hold it. A second definition here is how this probe
    // and `buildSources` come to disagree, which is the one thing this table
    // exists not to do.
    unavailable: (_c, env) =>
      env.ATLASSIAN_BASE_URL && env.ATLASSIAN_EMAIL && resolveCredential(atlassianOffers(env)).accepted
        ? null
        : "enabled but ATLASSIAN_BASE_URL / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN are not all set in this environment " +
          `(the token must be at least ${MIN_SECRET_CHARS} characters — the broker refuses to hold one it cannot redact).`,
  },
  {
    name: "slack",
    declaredPath: "adapters.slack",
    enabled: (c) => c.adapters.slack.enabled,
    endpoint: (_vaultDir, c) => {
      const scope = c.adapters.slack.channels.join(", ");
      return `Slack${scope ? ` (${scope})` : ""}`;
    },
    unavailable: (_c, env) => {
      const intake = resolveCredential(slackOffers(env));
      return intake.accepted ? null : `enabled but no Slack credential was found in any accepted form: ${intake.problem}.`;
    },
  },
  {
    name: "actions",
    declaredPath: "adapters.actions",
    enabled: (c) => c.adapters.actions.enabled,
    endpoint: (_vaultDir, c) => {
      const repo = c.adapters.actions.repo;
      return `GitHub Actions${repo ? ` (${repo})` : ""}`;
    },
    // The only commissioned channel whose credential is OPTIONAL, so this probe
    // reads config rather than the environment: a public repository is readable
    // unauthenticated, and reporting the channel unavailable for want of a token it
    // does not need would send an operator hunting for a credential to fix a
    // configuration problem. What it genuinely cannot run without is the repo.
    unavailable: (c) =>
      c.adapters.actions.repo
        ? null
        : 'enabled but `repo` is not set — set it to the "owner/repo" whose workflow runs measure this product ' +
          "(it is not derived from a git remote, because a checkout can point at a fork).",
  },
];

/**
 * Every commissioned channel this vault declares, whether or not it can run.
 *
 * Pure: it reads config and `env` and nothing else. No source is constructed, no
 * request is made and no file is opened, because the command this feeds is the one
 * an operator runs when things are already broken.
 *
 * **Their cadence is always `null` today, which means none of them can ever be
 * reported silent.** That is honest rather than convenient: `adapters.transcript`,
 * `adapters.usage`, `adapters.atlassian` and `adapters.slack` carry no `cadence`
 * key in `src/config/schema.ts`, and Zod strips what it does not declare — so there
 * is no number to read. Inventing one here would be this tool deciding on the
 * operator's behalf what "this pipeline is dead" means, which is the reason
 * `loop.cadence` and `adapters.inbox.cadence` have no default either. Enumerated,
 * dated and named they already are; declaring them silent waits on that schema key.
 */
export function commissionedChannels(
  vaultDir: string,
  config: Config,
  opts: { env?: ChannelEnv } = {},
): ReportableChannel[] {
  const env = opts.env ?? process.env;
  const vault = path.resolve(vaultDir);
  return COMMISSIONED.map((spec) => {
    const enabled = spec.enabled(config);
    const reason = enabled ? spec.unavailable(config, env) : null;
    const endpoint = spec.endpoint(vault, config);
    return {
      name: spec.name,
      declaredPath: spec.declaredPath,
      enabled,
      cadence: null,
      origin: "commissioned" as const,
      ...(endpoint ? { endpoint } : {}),
      ...(reason ? { unavailable: `${spec.declaredPath} is ${reason}` } : {}),
    };
  });
}

/**
 * Every channel the vault is commissioned to read — folders and pipelines both.
 *
 * The one entry point a report should use. Drop folders keep coming from
 * {@link resolveChannels} so there is still exactly one place their back-compat
 * lives, and the refusals it collects are carried through unchanged: a channel that
 * was refused is not a channel that is quiet.
 */
export function allChannels(
  vaultDir: string,
  config: Config,
  opts: { env?: ChannelEnv } = {},
): { channels: ReportableChannel[]; problems: string[] } {
  const drop = resolveChannels(vaultDir, config);
  return {
    channels: [...drop.channels, ...commissionedChannels(vaultDir, config, opts)],
    problems: drop.problems,
  };
}

export type ChannelStatus =
  /** Turned off in config. Says nothing about liveness. */
  | "disabled"
  /**
   * Turned ON and not runnable — a credential is absent, or a required path was
   * never declared. Distinct from `disabled` (nobody asked for it) and from
   * `silent` (asked for, running, producing nothing): merging any two of the three
   * is how "0 new items" comes to mean both "nothing to report" and "never looked".
   */
  | "unavailable"
  /** No state file: nothing has ever run an ingest for this channel. */
  | "never-fetched"
  /** A pre-timestamp `{cursor}` file. Neither live nor silent — it will be dated by the next fetch. */
  | "undated"
  /** Has fetched, has never stored an item, and is not yet past its cadence. */
  | "never-delivered"
  /** Delivered within its cadence, or has delivered and declares no cadence. */
  | "live"
  /** Past its declared cadence with nothing delivered in that window. */
  | "silent";

export interface ChannelHealth {
  name: string;
  /** The folder it reads, when it reads one. Absent for a commissioned pipeline. */
  dir?: string;
  /** What it reads when that is not a folder. */
  endpoint?: string;
  declaredPath: string;
  enabled: boolean;
  confined?: boolean;
  origin: ChannelOrigin;
  cadence: string | null;
  firstFetchedAt?: string;
  lastFetchedAt?: string;
  lastItemAt?: string;
  itemsDelivered: number;
  status: ChannelStatus;
  /** Age of whatever stamp silence was measured from, in ms. */
  ageMs?: number;
  /** Stamps in the future, ignored for the age and reported rather than swallowed. */
  ignoredFuture: number;
  /** One line, in the operator's terms. */
  reason: string;
  /** What to do about it, when there is something to do. */
  remedy?: string;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function humanAge(ms: number): string {
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.max(0, Math.floor(ms / 60_000))}m`;
}

/**
 * Read each channel's state file and say whether it is alive.
 *
 * A stamp in the future is IGNORED for the age and counted in `ignoredFuture`, on
 * `src/loop/cadence.ts`'s argument verbatim: a future stamp otherwise pins a
 * channel "fresh" until the wall clock catches up, clearable only by hand-editing a
 * state file. Reported rather than swallowed, so the operator sees the clock
 * problem instead of inheriting its consequences.
 */
export function channelHealth(
  vaultDir: string,
  channels: readonly ReportableChannel[],
  opts: { now?: number } = {},
): ChannelHealth[] {
  const now = opts.now ?? Date.now();
  return channels.map((channel) => {
    const base = {
      name: channel.name,
      ...(channel.dir !== undefined ? { dir: channel.dir } : {}),
      ...(channel.endpoint !== undefined ? { endpoint: channel.endpoint } : {}),
      declaredPath: channel.declaredPath,
      enabled: channel.enabled,
      ...(channel.confined !== undefined ? { confined: channel.confined } : {}),
      origin: channel.origin,
      cadence: channel.cadence,
      itemsDelivered: 0,
      ignoredFuture: 0,
      ...(channel.origin === "channel-zero" && channel.confined === false
        ? {
            remedy:
              // Named for the vault, not `../inbox`: two vaults under one parent
              // would otherwise share a folder and each ingest the other's notes.
              `move it outside the vault (\`adapters.inbox.path: "../${path.basename(path.resolve(vaultDir))}.inbox"\`) and move the folder — ` +
              "ids and cursors are keyed on filenames, not on the folder path, so nothing re-ingests. " +
              "Notes already committed stay in git history, which is why moving beats ignoring.",
          }
        : {}),
    };

    if (!channel.enabled) {
      return { ...base, status: "disabled" as const, reason: "turned off in ost.config.yaml — nothing is read from it" };
    }

    // Ahead of every state-file question, because it is the more actionable fact and
    // it OUTRANKS the age. A Slack channel whose token was revoked a month ago is
    // past any cadence you like, and reporting it `silent` would send the operator to
    // look at the producer — which is working fine. The stamps below still ride
    // along, so "it was delivering until the token went" is still readable.
    if (channel.unavailable) {
      const stamps = loadCursorRecord(vaultDir, channel.name);
      return {
        ...base,
        ...(stamps?.lastFetchedAt ? { lastFetchedAt: stamps.lastFetchedAt } : {}),
        ...(stamps?.lastItemAt ? { lastItemAt: stamps.lastItemAt } : {}),
        itemsDelivered: stamps?.itemsDelivered ?? 0,
        status: "unavailable" as const,
        reason: `UNAVAILABLE — ${channel.unavailable}`,
        remedy:
          `supply what it needs, or set ${channel.declaredPath}.enabled: false in ${CONFIG_FILENAME}. ` +
          "Left as it is, this channel reads nothing and reports nothing — which from a full pipeline looks exactly like an empty one.",
      };
    }

    const record = loadCursorRecord(vaultDir, channel.name);
    if (!record) {
      return {
        ...base,
        status: "never-fetched" as const,
        reason: "never fetched — no ingest has run for this channel yet, so it has no age to judge",
      };
    }

    const usable = (stamp?: string): number | undefined => {
      if (!stamp) return undefined;
      const ms = Date.parse(stamp);
      if (!Number.isFinite(ms)) return undefined;
      return ms <= now ? ms : undefined;
    };
    const future = [record.lastItemAt, record.firstFetchedAt, record.lastFetchedAt].filter(
      (s) => s !== undefined && Number.isFinite(Date.parse(s)) && Date.parse(s) > now,
    ).length;

    const deliveredMs = usable(record.lastItemAt);
    const firstMs = usable(record.firstFetchedAt) ?? usable(record.lastFetchedAt);
    const anchor = deliveredMs ?? firstMs;

    const dated = {
      ...base,
      ...(record.firstFetchedAt ? { firstFetchedAt: record.firstFetchedAt } : {}),
      ...(record.lastFetchedAt ? { lastFetchedAt: record.lastFetchedAt } : {}),
      ...(record.lastItemAt ? { lastItemAt: record.lastItemAt } : {}),
      itemsDelivered: record.itemsDelivered ?? 0,
      ignoredFuture: future,
    };

    if (anchor === undefined) {
      return {
        ...dated,
        status: "undated" as const,
        reason:
          future > 0
            ? `every stamp on this channel is in the future (${future}) — ignored, so it has no age to judge`
            : "a state file from before channels carried timestamps — it will be dated by the next fetch",
      };
    }

    const ageMs = now - anchor;
    const cadenceMs = parseCadence(channel.cadence);
    if (cadenceMs !== null && ageMs > cadenceMs) {
      return {
        ...dated,
        status: "silent" as const,
        ageMs,
        reason: deliveredMs
          ? `SILENT — nothing delivered for ${humanAge(ageMs)}, past its declared cadence of ${channel.cadence}`
          : `SILENT — has fetched but has never delivered an item, ${humanAge(ageMs)} past its declared cadence of ${channel.cadence}`,
        remedy:
          base.remedy ??
          "check the producer that fills this folder; a fetch that keeps succeeding over a dead pipeline looks exactly like an idle one from here.",
      };
    }
    if (deliveredMs === undefined) {
      return {
        ...dated,
        status: "never-delivered" as const,
        ageMs,
        reason: `fetched for ${humanAge(ageMs)} and has never delivered an item — configured but not yet productive`,
      };
    }
    return {
      ...dated,
      status: "live" as const,
      ageMs,
      reason: `last delivered ${humanAge(ageMs)} ago${channel.cadence ? ` (cadence ${channel.cadence})` : " (no cadence declared — never reported silent)"}`,
    };
  });
}

/** Past a cadence the operator declared, with nothing delivered in that window. */
export function silentChannels(health: readonly ChannelHealth[]): ChannelHealth[] {
  return health.filter((h) => h.status === "silent");
}

/** Asked for and not running. Kept apart from silence — the remedies differ. */
export function unavailableChannels(health: readonly ChannelHealth[]): ChannelHealth[] {
  return health.filter((h) => h.status === "unavailable");
}

/**
 * The channels a verdict should be non-zero over.
 *
 * Both states, and neither one absorbed into the other: a silent channel means look
 * at the producer, an unavailable one means look at the config or the environment.
 * `disabled` is never here — honouring the operator's own switch is not a failure.
 */
export function ailingChannels(health: readonly ChannelHealth[]): ChannelHealth[] {
  return [...unavailableChannels(health), ...silentChannels(health)];
}

function stampOr(value: string | undefined, fallback = "—"): string {
  return value ?? fallback;
}

/**
 * Say where the folder sits relative to the git working tree, and — for the one
 * channel that is inside on purpose — say that it is on purpose. An advisory that
 * fires identically on a deliberate choice and on a grandfathered accident is an
 * advisory nobody can act on.
 */
function confinementLine(h: ChannelHealth): string {
  // A pipeline has no folder, so it has no W1 grant to describe. Saying "outside the
  // vault" here would read as the reassurance that belongs to a drop folder somebody
  // deliberately placed, earned by an accident of not being a directory.
  if (h.confined === undefined) return "a commissioned pipeline — no drop folder, so nothing here is writable by a producer";
  if (h.confined) return "outside the vault — writing this folder is a separate grant from writing the tree";
  if (h.origin === "first-party") {
    return "inside the vault by design — filings here are committed with the tree, which is the point of them";
  }
  return "INSIDE the vault — writing this folder is the same grant as writing the tree";
}

/**
 * The channel report, shared by `ost-agent channels` and the read-only tool.
 *
 * One renderer, because a CLI and a tool that disagree about what a channel's
 * status is are two answers to the same question.
 */
export function renderChannels(input: { health: readonly ChannelHealth[]; problems?: readonly string[] }): string {
  const { health, problems = [] } = input;
  const lines: string[] = [];

  if (problems.length > 0) {
    lines.push(`⚠ ${problems.length} channel problem(s) in ost.config.yaml:`);
    for (const p of problems) lines.push(`  - ${p}`);
    lines.push("");
  }

  if (health.length === 0) {
    lines.push("No channels could be listed.");
    // Listing schema defaults here would show the operator a channel list they
    // never wrote, which is worse than showing none: no channel list can honestly
    // be rendered from a config that could not be read.
    lines.push("A channel list cannot be shown from a configuration that could not be read.");
    return lines.join("\n");
  }

  const silent = silentChannels(health);
  const unavailable = unavailableChannels(health);
  lines.push(
    `Channels: ${health.length}  (${health.filter((h) => h.status === "live").length} live, ${silent.length} silent, ` +
      `${unavailable.length} unavailable, ${health.filter((h) => h.status === "disabled").length} turned off)`,
  );
  for (const h of health) {
    lines.push("");
    lines.push(`[${h.name}] ${h.declaredPath}  →  ${h.dir ?? h.endpoint ?? "—"}`);
    lines.push(`  ${confinementLine(h)}`);
    lines.push(
      `  status: ${h.status}   cadence: ${h.cadence ?? "none declared"}   items delivered: ${h.itemsDelivered}`,
    );
    lines.push(`  last fetched: ${stampOr(h.lastFetchedAt)}   last delivered: ${stampOr(h.lastItemAt)}`);
    lines.push(`  ${h.reason}`);
    if (h.ignoredFuture > 0) {
      lines.push(`  ⚠ ${h.ignoredFuture} stamp(s) on this channel are in the future and were ignored — check the clock that wrote them.`);
    }
    if (h.remedy) lines.push(`  → ${h.remedy}`);
  }

  lines.push("");
  // Two sentences, never one. "3 channels are not reporting" would put a revoked
  // token and a dead producer under one number, and they are fixed in different files.
  if (unavailable.length > 0) {
    lines.push(
      `${unavailable.length} channel(s) are enabled and CANNOT run: ${unavailable.map((h) => h.name).join(", ")} — ` +
        "asked for, reading nothing, and indistinguishable from quiet until it is said out loud.",
    );
  }
  lines.push(
    silent.length === 0
      ? "No channel is past its declared cadence. A channel with no cadence is never flagged — nobody but you can say what dead means for it."
      : `${silent.length} channel(s) past declared cadence: ${silent.map((h) => h.name).join(", ")}`,
  );
  return lines.join("\n");
}

/** The one line `ost_status` and `renderStatus` may spend on the channel layer. */
export function channelStatusLine(health: readonly ChannelHealth[]): string {
  const silent = silentChannels(health);
  const unavailable = unavailableChannels(health);
  const live = health.filter((h) => h.status === "live").length;
  const parts = [
    silent.length === 0 ? "none silent" : `${silent.length} silent: ${silent.map((h) => h.name).join(", ")}`,
    ...(unavailable.length > 0 ? [`${unavailable.length} unavailable: ${unavailable.map((h) => h.name).join(", ")}`] : []),
  ];
  return `Channels: ${health.length} (${live} live, ${parts.join(", ")} — see \`ost-agent channels\`)`;
}
