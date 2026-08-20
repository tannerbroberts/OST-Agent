/**
 * The MCP-absent fallback: when a firing's pass reached no tool at all, route
 * the read-only half of the pass through the command line, refuse the write
 * half, and make sure the firing cannot seal clean.
 *
 * **The night this is for.** Three scheduled passes on the meta vault ran in a
 * session whose tool surface was simply absent: mapping, ideation and ranking
 * could not run, and each pass discovered that for itself after the compute was
 * already spent. The command line was still there every time. The two sibling
 * answers to that night both end the run — refuse at second zero, or have the
 * scheduler check first — and both are already built (`required-tools`,
 * `tool-surface`). This is the third: treat the missing surface as a
 * degradation rather than a stop, do the work that needs no model, and say
 * plainly what did not happen.
 *
 * **Three properties, each the reason for a piece of this file.**
 *
 *   1. *Same vault, same answers.* The verbs are not reimplemented. They are the
 *      MCP tools themselves — `ost_ingest_inbox`, `ost_check`, `ost_status`,
 *      `ost_debt` — built from the same context with the same options
 *      ({@link ostToolOptions}) and dispatched the same way, so what the
 *      fallback prints is byte for byte what the MCP surface would have
 *      returned. A fallback that reached the right vault by a different route
 *      and quietly reported different counts would be worse than none: a
 *      degraded run entering the record as a clean one carrying wrong numbers.
 *   2. *The write half is refused, not routed.* The fallback carries exactly
 *      four verbs and builds exactly four tools. Every other name on the MCP
 *      surface — and every name off it — is refused before anything is built,
 *      with a sentence saying which of the three reasons applies. A degraded
 *      pass with write access is unattended authoring through a path nobody
 *      designed for it, which is the one hazard the node this implements names.
 *   3. *A fallback run cannot pass as clean.* The fallback stamps the open run
 *      record before it runs a verb; `assessDegradation` reads the stamp at seal
 *      and names it `mcp-absent-fallback`; and `countToolCallsSince` excludes
 *      this surface, so the four traced calls the fallback makes cannot satisfy
 *      the no-tool-calls rule on the pass's behalf. Without the stamp AND the
 *      exclusion, a naive fallback would turn twenty-two `no-op` firings into
 *      twenty-two `no-op` firings with more output.
 *
 * **Where `ingest` sits, stated rather than assumed.** The MCP dispatcher
 * classifies `ost_ingest_inbox` as MUTATING — it writes evidence records and
 * advances cursors, and the server commits after it. The node this implements
 * lists it in the read-only half regardless, and the line it draws is *report
 * versus author*: ingest captures what the channels already hold, stamped by
 * the surface and idempotent, and authors nothing. So it is carried, and its
 * captures are committed here under a `fallback:` message by the same rule the
 * server uses ({@link mutatesVault}) — a fallback that captured evidence and
 * left it uncommitted would wedge the next firing on the dirty-tree gate.
 *
 * **Who decides.** The loop, from the vault's trace, never the pass. The
 * engagement test is the same one `degraded.ts` runs at seal: zero tool calls
 * traced since the run opened. A pass that made even one call is a pass whose
 * surface was present, and this does nothing for it — a present surface used
 * badly is a question about diligence, not about tools.
 */
import { buildPassContext } from "../runner/context.js";
import { buildOstTools } from "../security/tools.js";
import { vaultReadiness } from "../mcp/bootstrap.js";
import { enqueueCommit } from "../mcp/commit.js";
import { MCP_TOOL_NAMES, mutatesVault, ostToolOptions } from "../mcp/server.js";
import { countToolCallsSince, FALLBACK_SURFACE } from "./degraded.js";
import { readOpenRun, stampFallback, type FallbackRecord, type FallbackVerbRecord } from "./health.js";

/** The four verbs, in the order a pass would have made the calls. */
export const FALLBACK_VERBS = {
  ingest: "ost_ingest_inbox",
  check: "ost_check",
  status: "ost_status",
  debt: "ost_debt",
} as const;

export type FallbackVerb = keyof typeof FALLBACK_VERBS;

export const FALLBACK_VERB_ORDER: readonly FallbackVerb[] = ["ingest", "check", "status", "debt"];

/** Exactly the tools the fallback builds. Nothing outside this list can be reached through it. */
export const FALLBACK_TOOL_NAMES: readonly string[] = FALLBACK_VERB_ORDER.map((v) => FALLBACK_VERBS[v]);

/**
 * Why a name was refused. Three reasons, because they want three different
 * responses from the operator: a write verb is refused on principle and no
 * flag will change that; a read-only tool outside the four is a scope choice
 * this node made and a future one could widen; an unknown name is a typo.
 */
export type RefusalReason = "write-verb" | "not-carried" | "unknown";

export type VerbResolution =
  | { readonly ok: true; readonly verb: FallbackVerb; readonly tool: string }
  | { readonly ok: false; readonly asked: string; readonly why: RefusalReason; readonly reason: string };

/**
 * Accept the operator's spelling — `check`, `ost_check`, `ingest`,
 * `ingest_inbox`, `ost_ingest_inbox` — and refuse everything that is not one of
 * the four, naming why.
 */
export function resolveFallbackVerb(asked: string): VerbResolution {
  const trimmed = asked.trim();
  const bare = trimmed.toLowerCase().replace(/^ost_/, "");
  const verb = bare === "ingest_inbox" ? "ingest" : bare;
  if (verb in FALLBACK_VERBS) {
    const v = verb as FallbackVerb;
    return { ok: true, verb: v, tool: FALLBACK_VERBS[v] };
  }
  const asTool = trimmed.startsWith("ost_") ? trimmed : `ost_${bare}`;
  if ((MCP_TOOL_NAMES as readonly string[]).includes(asTool)) {
    if (mutatesVault(asTool)) {
      return {
        ok: false,
        asked: trimmed,
        why: "write-verb",
        reason:
          `\`${asTool}\` is a write verb, and a fallback run may report but never author — a degraded pass with ` +
          `write access is unattended work through a path nobody designed for it.`,
      };
    }
    return {
      ok: false,
      asked: trimmed,
      why: "not-carried",
      reason:
        `\`${asTool}\` is read-only but is not carried by the fallback, which routes exactly ` +
        `${FALLBACK_VERB_ORDER.join(", ")} — the part of a pass that needs no model.`,
    };
  }
  return { ok: false, asked: trimmed, why: "unknown", reason: `\`${trimmed}\` is not a tool on the OST surface.` };
}

/** One verb's output, exactly as the MCP surface would have returned it. */
export interface FallbackOutput {
  readonly verb: FallbackVerb;
  readonly tool: string;
  readonly text: string;
}

export type FallbackOutcome =
  /** At least one asked-for name is outside the four. Nothing was built, run or written. */
  | { readonly kind: "refused"; readonly refused: readonly Extract<VerbResolution, { ok: false }>[] }
  /** No firing is open, so there is nothing to fall back on behalf of. */
  | { readonly kind: "no-open-run" }
  /** The pass reached the tree: the MCP surface was present and this path has no business running. */
  | { readonly kind: "not-needed"; readonly passToolCalls: number }
  /** This run already fell back once; the stamp is on the record and the verbs are not run twice. */
  | { readonly kind: "already-fell-back"; readonly record: FallbackRecord }
  /** The vault is not a tree yet; the same refusal every MCP tool gives before `init`. */
  | { readonly kind: "vault-not-ready"; readonly message: string }
  | { readonly kind: "ran"; readonly record: FallbackRecord; readonly outputs: readonly FallbackOutput[] };

/** One line, so a tool's multi-line failure cannot forge structure in a record. */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").trim();
}

interface Runnable {
  name: string;
  run: (input: unknown) => Promise<unknown>;
}

/**
 * Build exactly the four tools against a vault, from the same context and
 * options the MCP server would use, dispatching under {@link FALLBACK_SURFACE}.
 */
function fallbackTools(vaultDir: string): Map<string, Runnable> {
  const ctx = buildPassContext(vaultDir, { tolerateInvalidConfig: true });
  const built = buildOstTools(ostToolOptions(ctx, FALLBACK_SURFACE), FALLBACK_TOOL_NAMES) as unknown as Runnable[];
  return new Map(built.map((t) => [t.name, t]));
}

/**
 * Run one verb exactly as the MCP dispatcher would: call the tool with an empty
 * input, render its result to text, and — for the one carried verb the server
 * classifies as mutating — commit and append the same suffix the server appends.
 *
 * Exported on its own so the byte-identity claim can be tested directly against
 * the in-process MCP server, without standing up a firing around it.
 */
export async function runFallbackVerb(
  vaultDir: string,
  verb: FallbackVerb,
  tools: Map<string, Runnable> = fallbackTools(vaultDir),
): Promise<{ text: string; committed?: string }> {
  const name = FALLBACK_VERBS[verb];
  const tool = tools.get(name);
  if (!tool) throw new Error(`${name} was not built — the fallback surface is narrower than its own verb table`);
  const out = await tool.run({});
  let text = typeof out === "string" ? out : JSON.stringify(out);
  if (!mutatesVault(name)) return { text };
  const commit = await enqueueCommit(vaultDir, `fallback: ${name} — ${text}`);
  text += commit.committed ? `\ncommitted ${commit.sha.slice(0, 8)}` : `\n(no changes to commit)`;
  return commit.committed ? { text, committed: commit.sha } : { text };
}

/**
 * Decide from the trace whether this firing needs the fallback, and if it does,
 * stamp the run and route the asked-for verbs (all four by default).
 *
 * The order of the checks is the safety argument: refusals come before the run
 * record is even read, so a request naming a write verb leaves no trace of
 * having been made; the stamp lands before the first verb runs, so a process
 * that dies mid-fallback still seals degraded; and the engagement test is the
 * vault's trace rather than anything the caller said.
 */
export async function runFallback(
  vaultDir: string,
  asked: readonly string[] = [],
  now: () => Date = () => new Date(),
): Promise<FallbackOutcome> {
  const resolutions = (asked.length > 0 ? asked : FALLBACK_VERB_ORDER).map(resolveFallbackVerb);
  const refused = resolutions.filter((r): r is Extract<VerbResolution, { ok: false }> => !r.ok);
  if (refused.length > 0) return { kind: "refused", refused };
  const verbs: FallbackVerb[] = [];
  for (const r of resolutions) if (r.ok && !verbs.includes(r.verb)) verbs.push(r.verb);

  const open = readOpenRun(vaultDir);
  if (!open) return { kind: "no-open-run" };
  if (open.fallback) return { kind: "already-fell-back", record: open.fallback };

  const passToolCalls = countToolCallsSince(vaultDir, open.startedAt);
  if (passToolCalls > 0) return { kind: "not-needed", passToolCalls };

  const readiness = vaultReadiness({ dir: vaultDir });
  if (!readiness.ready) return { kind: "vault-not-ready", message: readiness.message };

  const at = now().toISOString();
  // Stamped BEFORE anything runs. A firing that dies between here and the seal
  // still carries the evidence that it fell back, which is the property that
  // matters more than the list of verbs.
  stampFallback(vaultDir, { at, passToolCalls, verbs: [] });

  const tools = fallbackTools(vaultDir);
  const outputs: FallbackOutput[] = [];
  const records: FallbackVerbRecord[] = [];
  for (const verb of verbs) {
    const tool = FALLBACK_VERBS[verb];
    try {
      const result = await runFallbackVerb(vaultDir, verb, tools);
      records.push({ verb, tool, ok: true, ...(result.committed ? { committed: result.committed } : {}) });
      outputs.push({ verb, tool, text: result.text });
    } catch (e) {
      const error = oneLine(e);
      records.push({ verb, tool, ok: false, error });
      outputs.push({ verb, tool, text: `${tool} failed: ${error}` });
    }
  }
  const record: FallbackRecord = { at, passToolCalls, verbs: records };
  stampFallback(vaultDir, record);
  return { kind: "ran", record, outputs };
}

/**
 * The refusal an operator reads. Every refused name is listed with its own
 * reason, and the closing line says what the fallback does carry — so the way
 * out is on the screen rather than in this file.
 */
export function fallbackRefusalReport(refused: readonly Extract<VerbResolution, { ok: false }>[]): string[] {
  return [
    `refused: ${refused.length} of the name(s) asked for cannot be routed through the fallback.`,
    ...refused.map((r) => `  - ${r.reason}`),
    `  Nothing was built, run or written. The fallback carries exactly: ${FALLBACK_VERB_ORDER.join(", ")}.`,
  ];
}

/**
 * The lines printed on stderr when the fallback engages — stderr because a cron
 * mails it, and this is the sentence that must not be scrolled past.
 */
export function fallbackBanner(record: FallbackRecord, verbs: readonly FallbackVerb[]): string[] {
  return [
    `⚠ falling back: ${record.passToolCalls} tool call(s) were traced since this run opened — the MCP surface was absent.`,
    `  Routing ${verbs.join(", ")} through the command line. Nothing will be authored, and this firing will seal degraded.`,
  ];
}
