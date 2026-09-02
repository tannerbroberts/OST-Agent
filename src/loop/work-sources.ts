/**
 * The work-source census — everything that can put new work in front of a pass,
 * enumerated in one place, each carrying the affordance that would *wake* a
 * sleeping loop rather than the interval that would go and look.
 *
 * **What this is for.** `cadence.ts` answers "may this vault fire now?" by
 * comparing a clock against a number the operator wrote. A loop built that way is
 * forced to guess whether work exists: guess short and it pays for empty passes,
 * guess long and the tree goes stale. The candidate this module serves removes the
 * question — the loop registers interest in the things that could give it more
 * work and blocks — and it carries one risk that is worth more than the listener
 * itself: **if a single source turns out to be unwatchable, the loop sleeps
 * through it and looks perfectly healthy doing so.** That failure is invisible at
 * run time and cheap to find at enumeration time, which is why the enumeration is
 * the check and why it lives here rather than inside a listener.
 *
 * ## Derived, never listed
 *
 * The channel half is read off {@link allChannels}, the same function
 * `ost-agent channels` reports from. Nothing here restates the channel names, and
 * that is the load-bearing decision in this file: the candidate that motivated it
 * named six channels (`inbox`, `friction`, `transcript`, `usage`, `atlassian`,
 * `slack`) and this vault runs nine — `deposit`, `retrospective` and `actions`
 * arrived after that sentence was written. A hardcoded census would have been
 * born blind to three sources and would have said so nowhere. A census that
 * cannot go stale is worth more than one that is currently complete.
 *
 * The human half cannot be derived the same way — there is no structural list of
 * "writes only a person may make" — so {@link HUMAN_MUTATIONS} is a table, and it
 * is deliberately wider than the four that candidate named: `outcome-signal` and
 * `prerequisite` are the same kind of write by the same rule (CLI-only, off every
 * allowlist, attribution required) and a loop that slept through them would be
 * just as asleep.
 *
 * ## Direct, proxy, and the estimate that is not a measurement
 *
 * A source is `direct` when a watcher can be registered on something local that
 * changes when the source produces work — a drop folder, a transcript directory,
 * the vault's own root where every node file lands. It is `proxy` when nothing
 * local moves and the affordance has to be built: Atlassian, Slack and GitHub
 * Actions are HTTP APIs, and their events reach a listener only over a webhook
 * with a public endpoint (infrastructure, not an afternoon) or through a poller
 * that lives inside the adapter and emits when it sees an id the cursor has not.
 * The second is what {@link Watchability.proxy} costs out, and the loop is still
 * woken by an event either way — the polling moves into the adapter instead of
 * being the loop's own heartbeat.
 *
 * **Those costs are estimates, written here by hand, and the threshold this
 * module is measured against ("watchable directly, or a proxy costing under an
 * hour") is being read against them.** They are not measurements and this file
 * cannot make them into measurements. The honest use of them is to build the
 * first one, time it, and replace the number with what it took.
 *
 * ## What a green census does not say
 *
 * That the watcher fires when it should, that a wakeup costs less than the poll
 * it replaces, or that the loop can tell somebody else's write from its own. That
 * last one is not a small caveat: most of the sources here carry
 * {@link WorkSource.selfWritten} — eleven of fifteen in the vault this was first
 * run against — because the pass's own writes land on the same target a person's
 * do. A watcher on the vault root cannot, on its own, tell
 * `ost-agent result` from the agent writing a node — which means waking is
 * cheap and *deciding there is work* still costs a read.
 */
import fs from "node:fs";
import path from "node:path";
import { allChannels, type ChannelEnv, type ReportableChannel } from "../adapters/channels.js";
import { transcriptDirs } from "../runner/context.js";
import { usageLogPath } from "../telemetry/usage.js";
import { TEMP_WRITE_SUFFIX } from "../fs/atomic-write.js";
import type { Config } from "../config/schema.js";

/**
 * The bar the assumption test fixed in advance: a source is acceptable if it is
 * watchable directly, or has a proxy costing under an hour to build. Kept as a
 * constant so {@link unwatchableSources} scores against the threshold rather than
 * against whatever the estimates happen to say.
 */
export const PROXY_BUDGET_MINUTES = 60;

/** Something a watcher can be registered on. */
export interface WatchTarget {
  /** Absolute path. */
  path: string;
  kind: "dir" | "file";
  /** What produces the change, in the operator's terms. */
  what: string;
}

export type WatchMode =
  /** Something local changes when this source produces work. */
  | "direct"
  /** Nothing local changes; an emitter has to be built, and it costs. */
  | "proxy"
  /** Nothing can be watched at all. A source in this state refutes the candidate. */
  | "none";

export interface Watchability {
  mode: WatchMode;
  /** Empty is legal and means something specific — see {@link WorkSource.pending}. */
  targets: readonly WatchTarget[];
  /** How a watcher would be registered, in one line. */
  how: string;
  /** For `proxy`: what has to be built, and the estimate the threshold reads against. */
  proxy?: { build: string; estimateMinutes: number };
  /** For `none`: why nothing here can be watched. */
  why?: string;
}

export interface WorkSource {
  name: string;
  kind: "channel" | "human-mutation";
  /** What new work it can put in front of a pass, in one line. */
  delivers: string;
  /**
   * Whether the operator has this source switched on. A source that is off is
   * still enumerated: it produces no work today and will the moment somebody
   * flips it, and a census that listed only live sources would read as complete.
   */
  enabled: boolean;
  /** Asked for and not runnable, in one line. Never folded into `enabled`. */
  unavailable?: string;
  watch: Watchability;
  /**
   * Why this source has no target *in this vault* although its affordance is
   * sound — an unconfigured transcript directory, say. Distinct from
   * `watch.mode === "none"`, which is a property of the source itself.
   */
  pending?: string;
  /**
   * Set when the pass's own writes land on the same target. A wakeup on it says a
   * file changed, not that somebody else acted, and a loop that treated it as the
   * latter would wake itself forever.
   */
  selfWritten?: string;
}

export interface WorkSourceCensus {
  sources: WorkSource[];
  /** Channel refusals, carried through unchanged: refused is not the same as quiet. */
  problems: string[];
}

/**
 * The writes only a person may make, and what each one hands the next pass.
 *
 * Not derived, because nothing in the repository enumerates human-only writes —
 * the rule lives in prose on each command ("humans only — never the agent") and
 * in the fact that none of them is on `ALLOWED_TOOL_NAMES`. So this is a table,
 * and it is the part of this census that can go stale. Every entry writes a node
 * file, and node files are flat in the vault root (`Vault.nodePath`), which is why
 * they all share one target.
 */
export const HUMAN_MUTATIONS: readonly { name: string; command: string; delivers: string }[] = [
  {
    name: "result",
    command: "ost-agent result",
    delivers: "a recorded verdict clears the evidence gate beneath a solution — work becomes buildable that was not",
  },
  {
    name: "promote",
    command: "ost-agent promote",
    delivers: "a node becomes validated, which clears that same gate by the other route",
  },
  {
    name: "lane",
    command: "ost-agent lane",
    delivers: "a lane decides whether an unattended pass may run a test at all, so it moves work across the line",
  },
  {
    name: "retract",
    command: "ost-agent retract",
    delivers: "a node leaves the live tree — every count, scan, gate and rollup above it changes",
  },
  {
    name: "outcome-signal",
    command: "ost-agent outcome-signal",
    delivers: "a reading of the declared external signal on the Outcome — the one verdict no surface here can write",
  },
  {
    name: "prerequisite",
    command: "ost-agent prerequisite",
    delivers: "one test becomes uninterpretable until another lands, which reorders what is answerable now",
  },
];

/** The vault root, where every node file a human writes lands. */
function vaultRootTarget(vault: string): WatchTarget {
  return { path: vault, kind: "dir", what: "node files, written flat in the vault root" };
}

/**
 * Why the pass's own writes reach the same place a person's do.
 *
 * Said in full on each source rather than once in the render, because a caller
 * reading a single source has to see it: this is the difference between "a
 * wakeup means work" and "a wakeup means look".
 */
const SELF_WRITE = {
  vaultRoot:
    "the agent writes node files into the same directory, so a wakeup here says a file changed, not that a person acted",
  agentFiled: "the agent's own surfaces file into this folder, so it wakes on its own footsteps",
  ownSessions: "these are the agent's own session transcripts — a firing writes this directory while it runs",
  ownTrace: "every surface in this repository appends to this trace, including the pass that would be woken by it",
} as const;

/** One channel, classified. `c` is exactly what `ost-agent channels` reports on. */
function channelSource(vault: string, config: Config, c: ReportableChannel): WorkSource {
  const base = {
    name: c.name,
    kind: "channel" as const,
    enabled: c.enabled,
    ...(c.unavailable ? { unavailable: c.unavailable } : {}),
  };

  // A drop folder. Watchable by construction: a file lands in it and that is the
  // whole event.
  if (c.dir) {
    return {
      ...base,
      delivers: `whatever is dropped into ${c.declaredPath}`,
      watch: {
        mode: "direct",
        targets: [{ path: c.dir, kind: "dir", what: "a file dropped into the folder" }],
        how: "watch the folder; an arriving file is the event",
      },
      // `confined` is true when the folder is OUTSIDE the vault. The first-party
      // folders are inside on purpose (an uncommitted filing is a lost one), and
      // they are inside *because* the agent is what writes them.
      ...(c.origin === "first-party" ? { selfWritten: SELF_WRITE.agentFiled } : {}),
    };
  }

  if (c.name === "transcript") {
    // Read from `transcriptDirs`, NOT from the channel's `endpoint`, and the two
    // genuinely differ: `endpoint` names `adapters.transcript` alone, while the
    // adapter also harvests `loop.spend.sessionsDir` — the sessions of this
    // vault's own unattended firings. A watcher built from the report would sleep
    // through exactly the sessions an unattended loop produces.
    const dirs = transcriptDirs(vault, config);
    return {
      ...base,
      delivers: "a finished session transcript, harvested as evidence about how the agent actually behaved",
      watch: {
        mode: "direct",
        targets: dirs.map((d) => ({ path: d.dir, kind: "dir" as const, what: d.origin })),
        how: "watch each transcript directory; a session file appearing or growing is the event",
      },
      ...(dirs.length === 0
        ? {
            pending:
              "no transcript directory is declared — set adapters.transcript.projectDir or .path, or loop.spend.sessionsDir. " +
              "The affordance is a directory watch and there is no directory yet.",
          }
        : { selfWritten: SELF_WRITE.ownSessions }),
    };
  }

  if (c.name === "usage") {
    const file = usageLogPath(vault);
    return {
      ...base,
      delivers: "a day of the vault's own mechanical tool trace, rolled up as evidence",
      watch: {
        mode: "direct",
        targets: [{ path: file, kind: "file", what: "an appended tool-call event" }],
        how: "watch the trace file (its directory until it exists); an append is the event",
      },
      selfWritten: SELF_WRITE.ownTrace,
    };
  }

  // Everything left is an HTTP pipeline: Atlassian, Slack, GitHub Actions. Nothing
  // local moves when work appears there.
  return {
    ...base,
    delivers: `whatever ${c.endpoint ?? c.declaredPath} reports that the cursor has not seen`,
    watch: {
      mode: "proxy",
      targets: [],
      how: "nothing local changes when work appears at the far end — the emitter has to be built",
      proxy: {
        build:
          "wrap the adapter's existing cursor read in an interval poller that emits only when it returns an id the " +
          "cursor has not seen. The adapter already holds the cursor and the dedupe (src/adapters/source.ts), so what " +
          "is new is the timer and the diff — the poll lives in the adapter and the loop is still woken by an event. " +
          "The alternative, a webhook, needs a public endpoint and is not an afternoon.",
        estimateMinutes: 30,
      },
    },
  };
}

/**
 * Every source of new work this vault has, folders and pipelines and people.
 *
 * Pure with respect to the vault: it reads config and resolves paths, opens
 * nothing and creates nothing, because the surface this feeds is one an operator
 * runs when the loop is already asleep or already broken.
 */
export function workSourceCensus(vaultDir: string, config: Config, opts: { env?: ChannelEnv } = {}): WorkSourceCensus {
  const vault = path.resolve(vaultDir);
  const { channels, problems } = allChannels(vault, config, opts);
  const sources: WorkSource[] = channels.map((c) => channelSource(vault, config, c));

  for (const m of HUMAN_MUTATIONS) {
    sources.push({
      name: m.name,
      kind: "human-mutation",
      delivers: m.delivers,
      // A person needs no switch. `enabled` is about the operator's config and
      // there is none to read here; the command exists in every vault.
      enabled: true,
      watch: {
        mode: "direct",
        targets: [vaultRootTarget(vault)],
        how: `${m.command} rewrites a node file in the vault root; the rewrite is the event`,
      },
      selfWritten: SELF_WRITE.vaultRoot,
    });
  }

  return { sources, problems };
}

/**
 * The sources that fail the threshold — no affordance at all, or a proxy over the
 * hour the assumption test allowed. An empty list is what supports the candidate.
 */
export function unwatchableSources(sources: readonly WorkSource[]): WorkSource[] {
  return sources.filter(
    (s) =>
      s.watch.mode === "none" ||
      (s.watch.mode === "proxy" && (s.watch.proxy?.estimateMinutes ?? Infinity) >= PROXY_BUDGET_MINUTES),
  );
}

/** The census as an operator reads it. */
export function renderWorkSourceCensus(census: WorkSourceCensus): string[] {
  const { sources } = census;
  const lines = [`sources of new work in this vault (${sources.length}):`];
  for (const s of sources) {
    const where =
      s.watch.targets.length > 0
        ? s.watch.targets.map((t) => t.path).join(", ")
        : s.watch.mode === "proxy"
          ? `${s.watch.proxy?.estimateMinutes ?? "?"} min to build`
          : "nothing to watch";
    lines.push(
      `  [${s.name}] ${s.kind} · ${s.watch.mode} — ${s.delivers}; ${where}` +
        (s.enabled ? "" : " (turned off, and still listed — it produces work the moment it is turned back on)"),
    );
    if (s.unavailable) lines.push(`      unavailable: ${s.unavailable}`);
    if (s.pending) lines.push(`      no target here: ${s.pending}`);
  }

  const direct = sources.filter((s) => s.watch.mode === "direct").length;
  const proxied = sources.filter((s) => s.watch.mode === "proxy").length;
  const failing = unwatchableSources(sources);
  lines.push(
    `  ${direct} watchable directly, ${proxied} through a proxy; ` +
      (failing.length === 0
        ? `none with no affordance at all.`
        : `${failing.length} that a sleeping loop would miss: ${failing.map((s) => s.name).join(", ")}.`),
  );
  lines.push(
    `  Proxy costs are estimates written by hand, not measurements — the threshold "under an hour" is being read ` +
      `against a guess until the first one is built and timed.`,
  );

  const shared = sources.filter((s) => s.selfWritten).length;
  if (shared > 0) {
    lines.push(
      `  ${shared} of them are also written by the pass itself, so a wakeup on one means look, not work — ` +
        `waking is cheap and deciding still costs a read.`,
    );
  }
  const pending = sources.filter((s) => s.pending);
  if (pending.length > 0) {
    lines.push(`  ${pending.length} declare no target in this vault yet: ${pending.map((s) => s.name).join(", ")}.`);
  }
  for (const p of census.problems) lines.push(`  refused: ${p}`);
  return lines;
}

/**
 * A fingerprint of what a watch target currently holds.
 *
 * Exists so a caller — and the instrument — can ask the question a declaration
 * cannot answer: *did the thing this source names actually change when the source
 * produced work?* A census whose targets were merely plausible is the failure this
 * whole module is about, one level up.
 *
 * Absent paths fingerprint to `""` rather than throwing: a target that does not
 * exist yet is the normal state of a drop folder nobody has used, and appearing is
 * itself a change.
 */
export function watchTargetSignature(target: WatchTarget): string {
  try {
    if (target.kind === "file") {
      const st = fs.statSync(target.path);
      return `${st.size}:${st.mtimeMs}`;
    }
    return fs
      .readdirSync(target.path, { withFileTypes: true })
      .filter((e) => !isTemporary(e.name))
      .map((e) => {
        const st = fs.statSync(path.join(target.path, e.name));
        return `${e.name}:${st.size}:${st.mtimeMs}`;
      })
      .sort()
      .join("|");
  } catch {
    return "";
  }
}

/** A file staged by an atomic write, which is not an event anybody wants. */
function isTemporary(name: string): boolean {
  return name.endsWith(TEMP_WRITE_SUFFIX);
}

export interface WakeEvent {
  /** The source that woke the loop. */
  source: string;
  /** The path the watcher was registered on. */
  target: string;
  /** What the watcher saw, in one line. */
  detail: string;
}

export interface WatchHandle {
  /** Sources this handle is actually watching. */
  watching: readonly string[];
  /**
   * Sources it is NOT watching, with why. A caller that ignores this is a loop
   * that sleeps through them — which is why they are returned rather than logged.
   */
  notWatching: readonly { source: string; why: string }[];
  close(): void;
}

export interface WatchOptions {
  onWake(event: WakeEvent): void;
  /**
   * One probe per proxied source, returning an opaque token that changes when the
   * far end has new work. Required: a proxied source with no probe would sleep
   * silently, so {@link watchWorkSources} refuses rather than skipping it.
   */
  probes?: Readonly<Record<string, () => string>>;
  /** How often a probe is called. Only proxied sources use it. */
  pollMs?: number;
  /** Injected so the wiring can be tested without the filesystem's timing. */
  watch?: (dir: string, listener: (event: string, filename: string | null) => void) => { close(): void };
}

/**
 * Register interest in every source and block — the shape the candidate is
 * about, as far as an enumeration can carry it.
 *
 * It is deliberately not wired into the firing path. What this proves is that the
 * census hands out something real: every source either yields a watcher here or
 * is named in {@link WatchHandle.notWatching}, and there is no third outcome where
 * a source is quietly dropped.
 *
 * **A wakeup is a level, not an edge.** One node write can produce two events (an
 * atomic write stages and renames), and a proxy poll coalesces everything that
 * arrived since the last one. The contract is "something may have happened here",
 * and a caller that counted wakeups would be counting the watcher's internals.
 */
export function watchWorkSources(sources: readonly WorkSource[], opts: WatchOptions): WatchHandle {
  const watch = opts.watch ?? ((dir, listener) => fs.watch(dir, listener));
  const probes = opts.probes ?? {};
  const pollMs = opts.pollMs ?? 60_000;

  const missing = sources.filter((s) => s.watch.mode === "proxy" && !probes[s.name]);
  if (missing.length > 0) {
    throw new Error(
      `refusing to watch: ${missing.map((s) => s.name).join(", ")} ${missing.length === 1 ? "is" : "are"} proxied and ` +
        "no probe was supplied. A proxied source with no probe is a source the loop would sleep through while " +
        "reporting itself asleep on everything.",
    );
  }

  const closers: (() => void)[] = [];
  const watching: string[] = [];
  const notWatching: { source: string; why: string }[] = [];

  for (const s of sources) {
    if (s.watch.mode === "none") {
      notWatching.push({ source: s.name, why: s.watch.why ?? "no affordance" });
      continue;
    }

    if (s.watch.mode === "proxy") {
      const probe = probes[s.name];
      let last = safeProbe(probe);
      const timer = setInterval(() => {
        const now = safeProbe(probe);
        if (now !== last) {
          last = now;
          opts.onWake({ source: s.name, target: "(remote)", detail: "the source's own probe reported something new" });
        }
      }, pollMs);
      timer.unref?.();
      closers.push(() => clearInterval(timer));
      watching.push(s.name);
      continue;
    }

    if (s.watch.targets.length === 0) {
      notWatching.push({ source: s.name, why: s.pending ?? "the source declares no target in this vault" });
      continue;
    }

    let registered = 0;
    for (const target of s.watch.targets) {
      // A file — or a directory that does not exist yet — is watched through the
      // nearest directory that does exist, filtered to the next segment on the way
      // down. `fs.watch` cannot register on a path that is not there, and "the
      // folder nobody has used yet" is the normal state of a fresh drop channel.
      const dir = target.kind === "file" || !isDirectory(target.path) ? nearestExistingDir(target.path) : target.path;
      if (!dir) continue;
      const wanted = dir === target.path ? null : path.relative(dir, target.path).split(path.sep)[0];
      let handle: { close(): void };
      try {
        handle = watch(dir, (event, filename) => {
          if (filename && isTemporary(filename)) return;
          if (wanted && filename && filename !== wanted) return;
          opts.onWake({ source: s.name, target: target.path, detail: `${event} ${filename ?? ""}`.trim() });
        });
      } catch (e) {
        notWatching.push({ source: s.name, why: `${target.path}: ${(e as Error).message}` });
        continue;
      }
      closers.push(() => handle.close());
      registered++;
    }
    if (registered > 0) watching.push(s.name);
    else if (!notWatching.some((n) => n.source === s.name)) {
      notWatching.push({ source: s.name, why: `no watchable directory exists for ${s.name} yet` });
    }
  }

  return {
    watching,
    notWatching,
    close() {
      for (const c of closers) c();
      closers.length = 0;
    },
  };
}

/** A probe that throws must not take the loop down with it — a dead probe is a quiet source, not a crash. */
function safeProbe(probe: () => string): string {
  try {
    return probe();
  } catch (e) {
    return `probe-failed:${(e as Error).message}`;
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The deepest existing directory at or above `p`, or null if even the root is gone. */
function nearestExistingDir(p: string): string | null {
  let dir = path.dirname(path.resolve(p));
  for (;;) {
    if (isDirectory(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
