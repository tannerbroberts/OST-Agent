/**
 * Usage tracing — the mechanical record of what the agent actually did.
 *
 * The friction adapter and builder reports are the agent's own *account* of its
 * work: honest, but a narrated account all the same — "subject to whatever this
 * agent failed to notice or chose not to file." This module records the part no
 * narrator touches: every allowlisted tool invocation, as it happens, with its
 * outcome and timing, appended to a JSONL log inside the vault. A trace cannot
 * flatter itself, and it disagrees with the narrative exactly where the
 * narrative is wrong — which is the most valuable evidence dogfooding produces.
 *
 * Recording is fail-open by design: telemetry must never break a tool call, so
 * an unwritable log means a lost event, not a failed mutation. Events carry
 * tool name, outcome, duration, surface, and input SIZE — never input content,
 * so nothing sensitive can leak into the trace. The one exception is `wrote`, the
 * names of the node files a call created, and it is not really one: see the field.
 *
 * ATTRIBUTION IS STAMPED, NEVER SNIFFED (H5). `session` and `unknown` are the two
 * fields any later analysis groups by — cost-per-unknown, calls-per-run — and for
 * a while they were the two fields this module read out of `process.env`. That
 * made the claim three lines up false exactly where it mattered: a trace that
 * reads its own attribution from the ambient environment is a trace an unrelated
 * shell can author, and `export OST_UNKNOWN=...` in some terminal hours earlier
 * would silently bill every later call to an unknown nobody was working. A wrong
 * number reads as a measured one, so this module now reads NOTHING from the
 * environment. Attribution arrives from the surface that dispatched the call,
 * either as the `attribution` argument to `withUsageTracing` or via the
 * `withAttribution` scope a surface enters around one call. A surface that does
 * not honestly know leaves the field ABSENT — absent is honest, guessed is not.
 */
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { redactSecrets } from "../adapters/transcript.js";

export interface UsageEvent {
  /** ISO timestamp of the invocation. */
  ts: string;
  /** Tool name, e.g. "ost_create_node". */
  tool: string;
  /** Whether the call returned without throwing. */
  ok: boolean;
  /** Wall-clock duration in milliseconds. */
  ms: number;
  /** Which surface dispatched it: "mcp", "cli-tool", "pass:P2_map", ... */
  surface: string;
  /** Byte length of the JSON-encoded input — size only, never content. */
  argBytes: number;
  /** Redacted, truncated error message when ok=false. */
  err?: string;
  /**
   * True when the failure was a refusal for lack of a grant, distinct from the
   * tool failing on its own terms. Set at capture from the thrown error's TYPE
   * ({@link PermissionDeniedError}), never from `err`'s text — a classifier that
   * pattern-matched the message would drift silently the moment host wording
   * changed, which is exactly the failure this field exists to rule out.
   */
  denied?: true;
  /**
   * Which run dispatched this call — minted by the surface, never handed to it.
   *
   * Present only when the surface has an identity worth grouping by (the MCP
   * server mints one per server instance at start-up). Absent otherwise, which
   * is the honest answer for a one-shot CLI invocation.
   */
  session?: string;
  /**
   * Which unknown this call was spent on, when the caller DECLARED one.
   *
   * Never inferred from the node a call happens to name, and never read from the
   * environment: the whole value of "unattributed share" is that it is a real
   * measurement rather than a heuristic artifact.
   */
  unknown?: string;
  /**
   * Node files this call brought into existence, as basenames.
   *
   * The trace's other fields describe the call; this one describes its effect on the
   * tree, and it is what turns the trace from a record into a *denominator*. A node
   * file the tree has and no event here claims is a file no tool invocation explains
   * (W2) — the only detector available, because the commit trail cannot supply one:
   * every mutating call runs `git add -A`, so an out-of-band write does not merely go
   * unnoticed, it acquires a commit message attributing it to an allowlisted tool.
   *
   * A filename is not "input content" in the sense the header above refuses. It is
   * already in the vault root, in git, and in that commit message; withholding it here
   * would hide nothing and cost the join.
   */
  wrote?: string[];
}

/**
 * Node files created since the last drain — the bridge from the single writer to the
 * trace.
 *
 * Module-level and mutable, and honest about the limit that entails: it is correct
 * because a surface dispatches one call at a time and the drain happens inside the
 * same call that filled it. Two genuinely interleaved calls would attribute one
 * call's creation to the other's event. (Attribution used to share this limit for
 * the same reason — one process-global variable — and no longer does: see
 * `withAttribution`, whose store is per async context. This array is now the only
 * piece of the trace that a concurrent surface would have to fix.) It lives here rather
 * than in `vault.ts` so that nothing in `src/ost/` has to import telemetry, and the
 * one writer (W4 pins that it is `Vault`) reports its effects to the one recorder.
 */
const createdNodeFiles: string[] = [];

/** Called by the single writer immediately after a node file appears on disk. */
export function noteNodeFileCreated(file: string): void {
  createdNodeFiles.push(file);
}

/** Take and clear what the writer has reported since the last drain. */
export function drainCreatedNodeFiles(): string[] {
  return createdNodeFiles.splice(0, createdNodeFiles.length);
}

/**
 * The tool name the trace uses for the vault's own beginning.
 *
 * Declared here rather than beside `initVault` because the reader (`reconcileWithUsage`)
 * and the writer live in different halves of the tree, and a shared literal is the only
 * form of agreement that cannot drift. Importing it from the runner would also close a
 * cycle: the census is reachable from init, not the other way round.
 */
export const INIT_TRACE_TOOL = "vault_init";

/**
 * Thrown by a caller that structurally KNOWS a call was refused for lack of a
 * grant — never inferred here from what the message says. A thrower that only
 * has prose (host-generated permission text it cannot re-derive) has nothing to
 * construct this from and must throw a plain `Error`, which is the honest
 * answer: a call this module cannot classify at capture is recorded as a
 * failure, not guessed into a denial.
 */
export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionDeniedError";
  }
}

const MAX_ERR_CHARS = 300;

/** Where the trace lives: inside the vault, owned by the operator, travels in git. */
export function usageLogPath(vaultDir: string): string {
  return path.join(path.resolve(vaultDir), ".ost-agent", "usage", "events.jsonl");
}

/**
 * Append one event to the vault's usage log. NEVER throws — a telemetry
 * failure must cost an event, not a mutation.
 */
export function recordUsageEvent(vaultDir: string, event: UsageEvent): void {
  try {
    const file = usageLogPath(vaultDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // fail-open: tracing is best-effort by contract
  }
}

/** The minimal shape of a betaTool we wrap; kept structural so we never import SDK types here. */
interface RunnableTool {
  name: string;
  run: (input: never) => unknown | Promise<unknown>;
}

/**
 * What a surface asserts about the calls it dispatches.
 *
 * Both fields are optional and both mean "the surface knows this", not "somebody
 * once set this". Omit rather than guess.
 */
export interface UsageAttribution {
  /** The dispatching run's own identity. Minted by the surface, not accepted from outside it. */
  session?: string;
  /** The unknown the current call is being spent on, as the caller declared it. */
  unknown?: string;
}

/**
 * The scope a surface enters around one dispatched call.
 *
 * Two shapes of surface need attribution and they need it differently. A surface
 * that builds its own tools and works one unknown for their whole lifetime can
 * pass an object to `withUsageTracing` and be done. The MCP server cannot: it
 * builds its tools once, through `buildOstTools`, and then learns the unknown per
 * call from that call's arguments — so it needs a way to declare attribution
 * *around* an invocation of an already-wrapped tool.
 *
 * `AsyncLocalStorage` rather than a module-level variable, and this is the whole
 * point of the choice: the store is per async context, so two calls genuinely
 * interleaved in one process each see their own attribution. The `process.env`
 * dance this replaces (set on entry, restore in a `finally`) was correct only for
 * a strictly serial dispatcher and said so in a comment; the failure it warned
 * about — the loser of a race billed to the winner's unknown — is now
 * unrepresentable rather than merely documented.
 */
const attributionScope = new AsyncLocalStorage<UsageAttribution>();

/**
 * Run `fn` with `attribution` stamped onto every traced tool call it makes.
 *
 * The surface owns this. Nothing outside the process can enter the scope, which
 * is exactly what an environment variable could not promise.
 */
export function withAttribution<T>(attribution: UsageAttribution, fn: () => T): T {
  return attributionScope.run(attribution, fn);
}

/** A blank string is a surface that does not know; it must not become a group of its own. */
function stamp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Attribution declared for one call, resolved the moment that call starts.
 *
 * An explicit argument to `withUsageTracing` wins outright over the ambient
 * scope — not merged with it. Merging would let a surface end up half-stamped
 * from two authorities, and a record whose `session` and `unknown` came from
 * different places is precisely the kind of plausible-looking wrong number this
 * criterion exists to prevent.
 */
type AttributionSource = UsageAttribution | (() => UsageAttribution | undefined);

function resolveAttribution(source: AttributionSource | undefined): UsageAttribution {
  const declared = typeof source === "function" ? source() : source;
  const effective = declared ?? attributionScope.getStore();
  if (!effective) return {};
  return {
    ...(stamp(effective.session) ? { session: stamp(effective.session) } : {}),
    ...(stamp(effective.unknown) ? { unknown: stamp(effective.unknown) } : {}),
  };
}

/**
 * Wrap every tool's `run` so each invocation lands in the vault's usage log.
 * Results and thrown errors pass through untouched; only observation is added.
 *
 * `attribution` is the surface's declaration (H5) and is the ONLY way `session`
 * or `unknown` can reach an event — pass an object when the surface knows both up
 * front, a function when it re-reads them per call, or nothing at all when it
 * honestly does not know, in which case the fields are absent.
 */
export function withUsageTracing<T extends RunnableTool>(
  tools: T[],
  vaultDir: string,
  surface: string,
  attribution?: AttributionSource,
): T[] {
  return tools.map((tool) => ({
    ...tool,
    run: async (input: never) => {
      // Resolved before the tool runs, so the record describes what the surface
      // declared when it dispatched — not whatever the scope happens to hold by
      // the time a long call returns.
      const { session, unknown } = resolveAttribution(attribution);
      const started = Date.now();
      let argBytes = 0;
      try {
        argBytes = Buffer.byteLength(JSON.stringify(input ?? null), "utf8");
      } catch {
        // unserializable input: size stays 0, the call itself proceeds
      }
      try {
        const result = await tool.run(input);
        const wrote = drainCreatedNodeFiles();
        recordUsageEvent(vaultDir, {
          ts: new Date(started).toISOString(),
          tool: tool.name,
          ok: true,
          ms: Date.now() - started,
          surface,
          argBytes,
          ...(session ? { session } : {}),
          ...(unknown ? { unknown } : {}),
          ...(wrote.length > 0 ? { wrote } : {}),
        });
        return result;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Structural, not textual: a `PermissionDeniedError` says so by its TYPE,
        // which cannot drift the way host wording does.
        const denied = e instanceof PermissionDeniedError;
        // Drained on the failure path too, and recorded. A call that created a node
        // file and then threw still created it (R8's orphan is exactly this shape), and
        // an undrained entry would be stamped onto whatever call came next — attributing
        // a real write to an innocent tool, which is worse than not recording it.
        const wrote = drainCreatedNodeFiles();
        recordUsageEvent(vaultDir, {
          ts: new Date(started).toISOString(),
          tool: tool.name,
          ok: false,
          ms: Date.now() - started,
          surface,
          argBytes,
          err: redactSecrets(message).slice(0, MAX_ERR_CHARS),
          ...(denied ? { denied: true } : {}),
          ...(session ? { session } : {}),
          ...(unknown ? { unknown } : {}),
          ...(wrote.length > 0 ? { wrote } : {}),
        });
        throw e;
      }
    },
  }));
}
