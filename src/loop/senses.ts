/**
 * The sense census — what a firing could perceive, enumerated rather than
 * inferred from what it happened to touch.
 *
 * **The failure this exists to stop.** `src/loop/degraded.ts` already refuses to
 * let a firing that reached nothing report a clean run. It answers one question —
 * *was this pass crippled?* — and it answers it only for the modes that are loud:
 * no tool calls at all, a declared source that would not build, a config that
 * would not parse. What it cannot say is the quieter thing, which is what the
 * 2026-08-06 sweep's own summary could not say either: **a sense this pass never
 * reached for reads exactly like a sense that worked.** The pass never called
 * `ost_read_repo`, so nothing anywhere knows whether the product repo was
 * readable; it wrote instruments against paths it had never looked at, and the
 * closing report was silent about the difference between "checked, fine" and
 * "never looked".
 *
 * **The precedent, borrowed deliberately.** `ost_ingest_inbox` reports one line
 * per channel *including the ones it never read* — "[atlassian] disabled — turned
 * off in ost.config.yaml (adapters.atlassian.enabled: false)" — and it derives
 * every one of those lines from the config, with nothing having been tried. That
 * is what makes an empty result legible instead of ambiguous. Nothing equivalent
 * existed for the senses a pass reads *with*, and this module is that.
 *
 * ## Two axes, and keeping them apart is the whole mechanism
 *
 * Every sense carries a {@link SenseState} and a reach count, and they come from
 * different evidence on purpose:
 *
 *   - **state** is derived from config and grant *without trying anything* — the
 *     `ost_ingest_inbox` property. `product.repos` being empty is knowable with no
 *     repo read; Slack being off is knowable with no Slack call.
 *   - **reach** is read off the vault's mechanical tool trace, which the pass
 *     cannot author (see `src/telemetry/usage.ts`).
 *
 * A census built from reach alone would reproduce the exact ambiguity it exists to
 * remove: a sense nothing called would render as fine. A census built from state
 * alone would claim a sense worked when nothing ever asked it to. Reported
 * together, "live, never reached" is sayable — and it is the sentence the
 * 2026-08-06 sweep needed and did not have.
 *
 * ## The half this genuinely cannot see, reported as unknown rather than omitted
 *
 * The candidate's own assumption node predicted this and it is correct: the
 * read-senses are **not** symmetric with the write-channels. Whether `ost_read_repo`
 * is usable is a config question and is answered here. Whether the host's own
 * `Glob`/`Read`/`Bash` are granted is a *harness* question, and a vault cannot
 * enumerate a grant that lives in the process that launched it. So
 * {@link HARNESS_SENSE} is reported `unknown`, permanently, and rendered as *not
 * observable from here* rather than as *never reached* — because "nothing called
 * it" and "nothing here could tell" are different facts, and collapsing them would
 * be this module committing the error it was built to name.
 *
 * Omitting it would be worse. A census that lists only what it can see reads as
 * complete, and the operator would have no way to know a whole half was missing —
 * which is, one level up, the same failure again.
 */
import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME } from "../config/load.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { buildPassContext } from "../runner/context.js";
import { readUsageEvents } from "../telemetry/preflight.js";
import type { LoopRunRecord } from "./health.js";

/**
 * What a sense was, stated so that the honest answers are sayable.
 *
 * Seven words rather than a boolean, because an operator acts differently on each
 * and a census that rounded them to available/unavailable would be a second way of
 * saying nothing. `absent` is the node title's own phrase — the sense this firing
 * *never had* — and it is deliberately not spelled `unavailable`: nothing broke,
 * nobody configured it.
 */
export type SenseState =
  /** Configured, constructed, and usable by this process right now. */
  | "live"
  /** Usable, but by the HOST rather than by this process — the grant is not ours to see. */
  | "delegated"
  /** The operator turned it off. The configuration working is not a loss. */
  | "disabled"
  /** Asked for by the config and could not be built or read this firing. */
  | "unavailable"
  /** Never configured. This firing never had it, and nothing went wrong. */
  | "absent"
  /** Configured and live, and its allowance for this firing is spent. */
  | "exhausted"
  /** Could not be determined from here. Unknown is not clean — see the header. */
  | "unknown";

export interface Sense {
  /** What an operator would call it — a channel name, or one of the read-senses. */
  readonly name: string;
  readonly state: SenseState;
  /** Why it is in that state, in the operator's terms. One line. */
  readonly detail: string;
  /** Traced invocations of the tools that reach through it, inside this firing. */
  readonly reached: number;
  /**
   * Whether the trace can evidence reach for this sense AT ALL.
   *
   * False only for {@link HARNESS_SENSE}. When false, `reached: 0` means "nothing
   * here could tell", never "nothing tried" — and {@link senseCensusReport} says so
   * in those words rather than printing the same phrase it prints for a sense that
   * was genuinely not called.
   */
  readonly observable: boolean;
}

/** The sense whose grant lives in the harness and not in the vault. */
export const HARNESS_SENSE = "harness-tools";

/**
 * The read-senses, which are named by this module rather than by the config.
 *
 * Everything in a census that is NOT one of these came from the operator's channel
 * list, which is how the report knows whether it has any channels to caveat.
 */
const RESERVED_SENSE_NAMES = new Set<string>(["all", "tree", "product-repo", "web-search", "web-read", HARNESS_SENSE]);

/**
 * Which traced tool names count as reaching through which sense.
 *
 * The tree entry lists every tool that touches the vault's own nodes, mutating
 * ones included: a pass that only wrote nodes still reached the tree, and a
 * mapping that admitted reads alone would report the most productive firings as
 * never having reached it.
 *
 * The channels share one entry, and the limit is worth stating: `ost_ingest_inbox`
 * reads every source in a single call, so the trace cannot say which channel was
 * touched — only that ingestion ran. Per-channel reach would need per-channel
 * tracing that does not exist, and inventing it from the call count would be a
 * number nobody measured.
 */
export const SENSE_TOOLS = {
  tree: [
    "ost_read_tree",
    "ost_next_work",
    "ost_check",
    "ost_debt",
    "ost_status",
    "ost_gate",
    "ost_create_node",
    "ost_append_to_node",
    "ost_link_nodes",
    "ost_set_status",
    "ost_set_evidence",
    "ost_set_instrument",
    "ost_flag_humans_required",
    "ost_annotate",
    "ost_detach_nodes",
    "ost_edit_node",
    "ost_merge_nodes",
    "ost_rank_source",
  ],
  "product-repo": ["ost_read_repo"],
  "web-search": ["ost_search_web"],
  "web-read": ["ost_read_web"],
  channels: ["ost_ingest_inbox"],
} as const satisfies Record<string, readonly string[]>;

/**
 * What this firing's senses were, as observed from OUTSIDE the firing.
 *
 * A plain value with no reader attached, exactly as `SurfaceObservation` is in
 * `degraded.ts` and for the same reason: it lets {@link assembleCensus} be a pure
 * fold a test can drive directly, so every state can be exercised without standing
 * up the credential, the repo or the exhausted budget that produces it.
 */
export interface SenseObservation {
  /** Whether the vault's own tree could be read, and what to say if not. */
  readonly tree: { readonly readable: boolean; readonly detail: string };
  /** `product.repos`, and which of them do not resolve to a readable directory. */
  readonly productRepos: readonly string[];
  readonly unreadableRepos: readonly { readonly path: string; readonly reason: string }[];
  /** How `ost_search_web` would answer: with a credential, federated, or by delegating. */
  readonly search: "credential" | "federated" | "none";
  /** The operator's `web.lookupBudget` — the burst allowance for this pass. */
  readonly webLookupBudget: number;
  /** Every declared evidence channel, partitioned the way `buildPassContext` partitions it. */
  readonly channels: readonly {
    readonly name: string;
    readonly kind: "live" | "disabled" | "unavailable";
    readonly reason?: string;
  }[];
  /** Traced invocations inside this firing's window, per tool name. */
  readonly callsByTool: Readonly<Record<string, number>>;
  /** Present when the surface could not be inspected at all. */
  readonly observationFailure?: string;
}

function sum(calls: Readonly<Record<string, number>>, tools: readonly string[]): number {
  return tools.reduce((n, t) => n + (calls[t] ?? 0), 0);
}

/**
 * Fold one observation into the census, without trying anything.
 *
 * Every branch below decides a state from configuration alone. The reach counts
 * are attached beside it and never consulted to decide a state — that separation
 * is the mechanism (see the header), and it is what makes "live, never reached"
 * a thing this report can say.
 */
export function assembleCensus(o: SenseObservation): Sense[] {
  const senses: Sense[] = [];
  const reach = (tools: readonly string[]): number => sum(o.callsByTool, tools);

  // An uninspectable surface is not an empty one. If the observation itself
  // failed, every state below would be a guess dressed as a reading, so the
  // census says the one true thing and stops.
  if (o.observationFailure !== undefined) {
    return [
      {
        name: "all",
        state: "unknown",
        detail:
          `this firing's senses could not be enumerated (${o.observationFailure}) — ` +
          `what it could and could not perceive is unknown, and unknown is not clean.`,
        reached: 0,
        observable: false,
      },
    ];
  }

  senses.push({
    name: "tree",
    state: o.tree.readable ? "live" : "unavailable",
    detail: o.tree.detail,
    reached: reach(SENSE_TOOLS.tree),
    observable: true,
  });

  // The named fixture of this candidate's own assumption test. An empty
  // `product.repos` is not a breakage and is not reported as one: the pass simply
  // never had sight of the product, which is a fact about the config that is
  // knowable without opening a single file.
  if (o.productRepos.length === 0) {
    senses.push({
      name: "product-repo",
      state: "absent",
      detail:
        `product.repos is empty in ${CONFIG_FILENAME}, so this firing never had sight of the product it is for — ` +
        `ost_read_repo would refuse every path.`,
      reached: reach(SENSE_TOOLS["product-repo"]),
      observable: true,
    });
  } else if (o.unreadableRepos.length > 0) {
    senses.push({
      name: "product-repo",
      state: "unavailable",
      detail:
        `${o.unreadableRepos.length} of ${o.productRepos.length} declared product repo(s) could not be read: ` +
        o.unreadableRepos.map((r) => `${r.path} (${r.reason})`).join("; "),
      reached: reach(SENSE_TOOLS["product-repo"]),
      observable: true,
    });
  } else {
    senses.push({
      name: "product-repo",
      state: "live",
      detail: `${o.productRepos.length} readable product repo(s): ${o.productRepos.join(", ")}`,
      reached: reach(SENSE_TOOLS["product-repo"]),
      observable: true,
    });
  }

  // The budget is shared by both web senses, and a search with no provider never
  // spends it — `ost_search_web` returns the delegation instruction BEFORE
  // `lookupBudget.take()`, so counting those calls would report a firing as
  // exhausted on lookups that cost nothing.
  const searchCalls = reach(SENSE_TOOLS["web-search"]);
  const readCalls = reach(SENSE_TOOLS["web-read"]);
  const lookupsSpent = (o.search === "none" ? 0 : searchCalls) + readCalls;
  const exhausted = lookupsSpent >= o.webLookupBudget;
  const budgetNote = `${lookupsSpent} of web.lookupBudget's ${o.webLookupBudget} lookup(s) traced this firing`;

  senses.push({
    name: "web-search",
    state: o.search === "none" ? "delegated" : exhausted ? "exhausted" : "live",
    detail:
      o.search === "none"
        ? `no search credential and web.search.federated is off — ost_search_web answers by telling the agent to ` +
          `use its host's own search, which this vault cannot see the grant for`
        : o.search === "credential"
          ? `a search credential is held; ${budgetNote}`
          : `federated keyless search is on; ${budgetNote}`,
    reached: searchCalls,
    observable: true,
  });

  senses.push({
    name: "web-read",
    state: exhausted ? "exhausted" : "live",
    detail: exhausted
      ? `the shared lookup allowance is spent — ${budgetNote}`
      : `ost_read_web needs no credential; ${budgetNote}`,
    reached: readCalls,
    observable: true,
  });

  // One line per declared channel, including the ones nothing read — the borrowed
  // property, and the reason a turned-off channel appears here at all.
  const channelReach = reach(SENSE_TOOLS.channels);
  for (const c of o.channels) {
    senses.push({
      name: c.name,
      state: c.kind === "live" ? "live" : c.kind,
      // The shared-reach caveat belongs in the summary, once, not on every
      // channel line: a vault with six channels would repeat the same ninety
      // characters six times, and a report nobody finishes reading is this
      // candidate's own stated failure mode arriving by the back door.
      detail: c.kind === "live" ? `declared and constructed` : (c.reason ?? "no reason recorded"),
      reached: channelReach,
      observable: true,
    });
  }

  senses.push({
    name: HARNESS_SENSE,
    state: "unknown",
    detail:
      `the host's own file and shell tools are granted by the harness that launched this firing, and a vault ` +
      `cannot enumerate a grant that lives in another process — this line is here so the gap is visible rather ` +
      `than absent from the report`,
    reached: 0,
    observable: false,
  });

  return senses;
}

/** Traced invocations since this firing opened, counted per tool name. */
export function toolCallsByToolSince(vaultDir: string, startedAt: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const from = Date.parse(startedAt);
  if (!Number.isFinite(from)) return counts;
  for (const e of readUsageEvents(vaultDir)) {
    const at = Date.parse(e.ts);
    // An event whose timestamp will not parse cannot be placed inside this
    // firing's window, and a call that cannot be placed in time is not evidence
    // that anything was reached — same rule as `countToolCallsSince`.
    if (!Number.isFinite(at) || at < from) continue;
    counts[e.tool] = (counts[e.tool] ?? 0) + 1;
  }
  return counts;
}

/** Does this path resolve to a directory this process can list? */
function repoProblem(vaultDir: string, repo: string): string | null {
  const resolved = path.resolve(vaultDir, repo);
  try {
    if (!fs.statSync(resolved).isDirectory()) return "not a directory";
    fs.readdirSync(resolved);
    return null;
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
  }
}

/** One line, so a multi-line adapter message cannot forge structure in a report. */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
}

/**
 * Observe this firing's senses from the vault rather than from the firing.
 *
 * A second `buildPassContext` beside the one `observeDegradation` builds, and that
 * is deliberate rather than overlooked: construction touches no network, both
 * happen once per seal, and threading a shared context through would couple the
 * degradation reader to this one for a cost neither of them pays.
 *
 * Same stated limit as `observeSurface`: this reads the surface as it stands at
 * SEAL time, not as it stood during the pass. In an unattended firing those are
 * the same process tree with the same environment, so the approximation is tight —
 * and where it drifts it drifts conservatively, toward reporting a sense as worse
 * than the pass found it rather than better.
 */
export function observeSenses(vaultDir: string, run: LoopRunRecord): Sense[] {
  const callsByTool = toolCallsByToolSince(vaultDir, run.startedAt);
  try {
    const ctx = buildPassContext(vaultDir, { tolerateInvalidConfig: true });
    const readiness = vaultReadiness(ctx);
    const repos = ctx.productRepos ?? [];
    const unreadableRepos: { path: string; reason: string }[] = [];
    for (const repo of repos) {
      const problem = repoProblem(vaultDir, repo);
      if (problem !== null) unreadableRepos.push({ path: repo, reason: problem });
    }
    return assembleCensus({
      tree: readiness.ready
        ? { readable: true, detail: `the vault's own tree at ${ctx.dir}` }
        : { readable: false, detail: oneLine(readiness.message) },
      productRepos: repos,
      unreadableRepos,
      search: ctx.web?.searchApiKey ? "credential" : ctx.web?.provider ? "federated" : "none",
      webLookupBudget: ctx.config.web.lookupBudget,
      channels: [
        ...ctx.sources.map((s) => ({ name: s.name, kind: "live" as const })),
        ...ctx.unavailableSources.map((s) => ({
          name: s.name,
          kind: s.kind === "disabled" ? ("disabled" as const) : ("unavailable" as const),
          reason: oneLine(s.reason),
        })),
      ],
      callsByTool,
    });
  } catch (e) {
    // Never throws out of a seal, for the same reason `observeSurface` does not:
    // a firing whose senses cannot be enumerated still has to land a report, and
    // it lands one that says exactly that.
    return assembleCensus({
      tree: { readable: false, detail: "not reached" },
      productRepos: [],
      unreadableRepos: [],
      search: "none",
      webLookupBudget: 0,
      channels: [],
      callsByTool,
      observationFailure: oneLine(e),
    });
  }
}

/** How a sense's reach reads — the clause the whole candidate turns on. */
function reachClause(s: Sense): string {
  if (!s.observable) return "not observable from here — no trace can evidence this one either way";
  return s.reached > 0 ? `reached ${s.reached}×` : "never reached";
}

/**
 * How long one sense's `detail` may be before the line is cut.
 *
 * Bounded because a detail is not this module's text. It is whatever the thing
 * that failed had to say for itself, and some of those are pages: an unreadable
 * tree hands back `vaultReadiness`'s full setup guidance — six sentences and a
 * shell command — which `oneLine` flattens into a single six-hundred-character
 * line that pushes every other sense off the reader's screen. The state and the
 * reach clause are the load-bearing parts of a census line and they must survive
 * whatever the detail does, so the detail is what gets cut.
 *
 * This is the node's own weakness arriving by the back door and it is worth naming:
 * "a report at the end is a report nobody may read", and an unbounded line is how a
 * report earns that. The full text is never only here — a tree that will not open
 * says so through `ost-agent check`, in full, on a surface with room for it.
 */
const MAX_DETAIL_CHARS = 160;

function clampDetail(detail: string): string {
  const flat = detail.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_DETAIL_CHARS ? flat : `${flat.slice(0, MAX_DETAIL_CHARS - 1).trimEnd()}…`;
}

/**
 * The closing report: one line per sense, always, including the ones nothing
 * touched.
 *
 * Printed on every seal rather than only on a degraded one, which is the
 * difference between this and `degradedReport`. A census that appeared only when
 * something was already known to be wrong could not tell an operator that a
 * *healthy-looking* firing spent the night unable to see the product — and that
 * firing is the one that produced the work nobody knew to distrust.
 *
 * The two closing lines are load-bearing and are not decoration. The first is the
 * tally, so a reader who skims gets the shape. The second says outright that a
 * never-reached sense is not a working one, because without it a reader completes
 * the sentence the wrong way — which is the whole ambiguity this exists to remove.
 */
export function senseCensusReport(senses: readonly Sense[]): string[] {
  if (senses.length === 0) return [];
  const lines = [
    `senses this firing had:`,
    ...senses.map((s) => `  [${s.name}] ${s.state} — ${clampDetail(s.detail)}; ${reachClause(s)}`),
  ];

  const byState = new Map<SenseState, number>();
  for (const s of senses) byState.set(s.state, (byState.get(s.state) ?? 0) + 1);
  lines.push(
    `  ${senses.length} sense(s): ` +
      [...byState.entries()].map(([state, n]) => `${n} ${state}`).join(", ") +
      ".",
  );

  const unreached = senses.filter((s) => s.observable && s.reached === 0).length;
  const unobservable = senses.filter((s) => !s.observable).length;
  lines.push(
    `  ${unreached} of them were never reached this firing — a sense nothing reached for is not a sense that ` +
      `worked, and nothing here claims it was` +
      (unobservable > 0
        ? `; ${unobservable} more could not be observed from here at all, which is a gap in this report rather than a state of the sense.`
        : `.`),
  );
  // Said once, here, rather than on every channel line. The limit is real and a
  // reader who acts on a channel's reach count needs it: `ost_ingest_inbox` reads
  // every source in a single call, so the trace can say ingestion ran and cannot
  // say which channel it got anything from.
  if (senses.some((s) => !RESERVED_SENSE_NAMES.has(s.name))) {
    lines.push(
      `  Channel reach is shared: ost_ingest_inbox reads every channel in one call, so the trace says ingestion ` +
        `ran and cannot say which channel answered.`,
    );
  }
  return lines;
}
