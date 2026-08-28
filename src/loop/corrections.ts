/**
 * The corrections ledger — a carrier for a refusal, out of the session it was
 * issued in.
 *
 * When a guard refuses a call it usually says what to do instead: "To wait for a
 * condition, use Monitor with an until-loop". The message is clear, it is obeyed
 * once, and then the session ends and nothing is left holding it. Seven sessions
 * across four days on this machine hit the identical `Blocked: sleep …` refusal
 * (`test/fixtures/corrections/PROVENANCE.md`), which is not a reasoning failure —
 * it is a storage failure. The guard was the only memory in the system, so it
 * fired forever because it was the only thing that remembered.
 *
 * This module gives the correction somewhere to live. It reads finished session
 * transcripts, keeps the refusals that named a permitted form, folds them into a
 * per-workspace ledger, and renders that ledger as text a later session can be
 * handed before it composes anything.
 *
 * ## What is a correction, and what is merely a failure
 *
 * Both arrive as an errored `tool_result`, and telling them apart is the whole
 * classification. `String to replace not found in file.` is a failure: the call
 * was well-formed and the world disagreed with it, and there is nothing to carry
 * forward but the fact that a file changed. `Blocked: sleep 45 … To wait for a
 * condition, use Monitor …` is a correction: the surface rejected a *shape* of
 * call and named the shape it wanted instead. Only the second is worth a ledger
 * entry, because only the second tells a later session what to write.
 *
 * So the discriminator is the permitted form itself — see {@link readPermittedForm}.
 * A refusal that names no alternative is dropped, deliberately and visibly: it
 * would be an entry that says "this went wrong once" to a reader who cannot act
 * on it, and the failure this ledger must not reproduce is being long enough that
 * nobody reads it.
 *
 * ## The permitted form is also the identity
 *
 * Two refusals are the same correction **iff they name the same permitted form**.
 * That is not a convenience: the ledger's unit is the correction, and a correction
 * IS its remedy. The verdict half of a refusal quotes the call that provoked it —
 * `sleep 45; gh pr checks 13` one time, `sleep 240; git status …` the next — so
 * keying on the whole message would store the same correction once per command
 * anyone ever typed, which is the unbounded ledger this was built to avoid.
 * Keying on the remedy collapses all eight sightings of the sleep block into one
 * line, which is what a reader needs.
 *
 * ## Where the ledger lives, and why the caller has to say
 *
 * A **state directory**, passed in, never derived from a vault here. There are two
 * loops on this machine and they do not share a home: the discovery loop records
 * under `<vault>/.git/ost-agent/` (see `state.ts` for why never the working tree —
 * every mutating MCP tool commits with `git add -A`, so a ledger in the tree is
 * swept into the next `mcp: <tool>` commit), and the build loop keeps its state
 * outside the vault entirely, at `$OST_BUILD_STATE`, precisely so it cannot wedge
 * discovery's dirty-tree gate. A module that picked one would be wrong for the
 * other, so it picks neither.
 */
import fs from "node:fs";
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";
import { isWaitingCorrection, renderWaitAffordance } from "./wait.js";

/** Filename of the ledger inside the state directory. */
const LEDGER_FILE = "corrections.json";

/** Schema stamp, so a future shape change can be detected rather than mis-parsed. */
const LEDGER_VERSION = 1;

/** A session must be untouched this long to count as finished and be harvested. */
export const DEFAULT_QUIET_MINUTES = 30;

/**
 * How many corrections the ledger keeps, most-recently-seen first.
 *
 * The node this was built from names the failure directly: "a ledger that grows
 * without bound becomes a thing nobody reads, which is the exact failure it was
 * built to fix, one level up." A cap is the cheapest defence available and this is
 * the one number that decides whether the briefing stays readable. What falls off
 * is **counted and named in the briefing** rather than dropped in silence — a
 * truncated list that does not say it was truncated reads as the whole truth.
 */
export const MAX_CORRECTIONS = 25;

/** Longest a remedy may be before it is clipped in the ledger. */
const MAX_PERMITTED_CHARS = 400;
/** Longest a quoted example of the refused call may be. */
const MAX_ATTEMPTED_CHARS = 200;

/** One refusal, as it was seen in one session. */
export interface RefusalSighting {
  /** Session id — the transcript's basename, so a line can be checked by hand. */
  session: string;
  /** The tool whose call was refused, when the transcript joins the result to a call. */
  tool?: string;
  /** The verdict half: what this particular call was refused for. */
  attempted: string;
  /** The remedy half: the form the guard said to use instead. This is the identity. */
  permitted: string;
  /** ISO timestamp of the transcript entry, or "" when the entry carried none. */
  at: string;
}

/** One correction, folded across every sighting of it. */
export interface Correction {
  /** A readable, stable slug of the permitted form. For display and for grepping. */
  id: string;
  /** The permitted form, verbatim and whitespace-flattened. The dedup key. */
  permitted: string;
  /** One example of a call this refused, so the reader can recognise the reflex. */
  attempted: string;
  /** Every tool this correction has been issued against, sorted. */
  tools: string[];
  /** Sessions that hit it, sorted — the count of these is how expensive it has been. */
  sessions: string[];
  /** Total sightings, which exceeds `sessions.length` when one session repeated it. */
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
}

/** The whole ledger as it sits on disk. */
export interface CorrectionsLedger {
  version: number;
  /** Session ids already folded in. A harvested session is never harvested twice. */
  harvested: string[];
  /** Corrections, most-recently-seen first. */
  corrections: Correction[];
  /** How many corrections have been dropped by the cap over this ledger's life. */
  dropped: number;
}

/**
 * The cues that mark the start of a remedy.
 *
 * Every one of them is a way of saying "write it like this instead", and a guard
 * that refuses without saying one of them has not issued a correction — it has
 * reported a failure. Matched against whole sentences rather than the raw message
 * so that a refused *command* containing the word "use" cannot be mistaken for the
 * guard's own advice.
 */
const REMEDY_CUES = [/\buse\b/i, /\bmust\b/i, /\binstead\b/i, /\btry\b/i];

/** A guard refusal — the surface rejecting a call — rather than a command that failed. */
const GUARD_MARKER = /<tool_use_error>/;

/** Split a message into sentence-ish pieces. Newlines end a sentence too. */
function sentences(text: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  let start = 0;
  const re = /(?:\.\s+|\n+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ start, text: text.slice(start, m.index + 1) });
    start = m.index + m[0].length;
  }
  if (start < text.length) out.push({ start, text: text.slice(start) });
  return out;
}

function flatten(text: string, max: number): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * The remedy half of a refusal, or null when the guard named none.
 *
 * **The rule: from the first sentence that carries a remedy cue, to the end of the
 * message.** Not "the sentence that carries the cue", because guards put the
 * variable part first and the advice last, and the advice frequently runs past one
 * sentence — the sleep block's remedy is three, and the third ("Do not chain
 * shorter sleeps to work around this block.") carries no cue of its own but is the
 * part a reader most needs. Taking to the end keeps it; taking one sentence would
 * store two thirds of a correction.
 *
 * **And the remedy must be the guard's closing words** — it has to begin within
 * {@link MAX_PERMITTED_CHARS} of the end of the message. That second half is not
 * belt-and-braces; without it the rule is wrong on real messages. Guards quote the
 * caller's own material back at them, and the caller's material is prose too:
 * `String to replace not found in file. String: <90 lines of source>` was read as a
 * correction whose permitted form was a code comment reading "the default genome
 * must not pay for a ledger walk", because the quoted block happened to contain the
 * word "must". A cue buried a thousand characters from the end is not advice the
 * guard is giving, it is content the guard is echoing.
 *
 * The cost of the rule is stated rather than hidden: a guard that appended something
 * long after its advice would have that advice missed entirely. That direction is
 * the right one to be wrong in — a correction that never gets recorded costs the
 * status quo, while a quoted payload recorded AS a correction puts noise in the one
 * document whose value is that it is short enough to read.
 */
export function splitRefusal(message: string): { attempted: string; permitted: string } | null {
  const body = message.replace(/<\/?tool_use_error>/g, "");
  for (const s of sentences(body)) {
    if (body.length - s.start > MAX_PERMITTED_CHARS) continue;
    if (!REMEDY_CUES.some((re) => re.test(s.text))) continue;
    const permitted = flatten(body.slice(s.start), MAX_PERMITTED_CHARS);
    if (permitted.length === 0) return null;
    // The verdict half is whatever came before the remedy. Empty when the guard
    // led with its advice, which is a correction with no example — still worth
    // carrying, since the remedy is the part that changes what gets written.
    return { attempted: flatten(body.slice(0, s.start), MAX_ATTEMPTED_CHARS), permitted };
  }
  return null;
}

/** The remedy half alone, for callers that only need the identity. */
export function readPermittedForm(message: string): string | null {
  return splitRefusal(message)?.permitted ?? null;
}

/** A readable, stable id for a correction: the first words of its remedy. */
export function correctionId(permitted: string): string {
  return (
    permitted
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 8)
      .join("-") || "correction"
  );
}

/** Tool results carry either a string or a list of content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

/**
 * Every correction issued in one session transcript (raw JSONL text).
 *
 * Malformed lines are skipped rather than failing the session, on the transcript
 * adapter's precedent: a corrupt line costs one entry, never the whole harvest.
 */
export function extractRefusals(jsonl: string, session: string): RefusalSighting[] {
  const sightings: RefusalSighting[] = [];
  const toolById = new Map<string, string>();

  for (const raw of jsonl.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const at = typeof entry.timestamp === "string" ? entry.timestamp : "";
    const message = entry.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content as Record<string, unknown>[]) {
      if (block.type === "tool_use" && block.id) {
        toolById.set(String(block.id), String(block.name ?? ""));
        continue;
      }
      if (block.type !== "tool_result" || block.is_error !== true) continue;
      const body = resultText(block.content);
      // A command that exited non-zero is a failure, not a correction: nothing
      // rejected the SHAPE of the call, so there is no permitted form to carry.
      if (!GUARD_MARKER.test(body)) continue;
      const split = splitRefusal(body);
      if (split === null) continue;
      const tool = toolById.get(String(block.tool_use_id ?? ""));
      sightings.push({ session, ...(tool ? { tool } : {}), ...split, at });
    }
  }
  return sightings;
}

export function ledgerPath(stateDir: string): string {
  return path.join(path.resolve(stateDir), LEDGER_FILE);
}

/** A ledger with nothing in it — the starting state, and what an unreadable one becomes. */
export function emptyCorrectionsLedger(): CorrectionsLedger {
  return { version: LEDGER_VERSION, harvested: [], corrections: [], dropped: 0 };
}

/**
 * The ledger on disk, or an empty one.
 *
 * A ledger that will not parse is treated as absent rather than thrown over. This
 * is the one place in the loop where fail-open is right: the ledger decides
 * nothing — it is advice handed to a session — and refusing to fire because a
 * cache of tool-use advice got corrupted would be a stopping state with no
 * proportion to what was lost. Contrast `health.ts`, which throws, because the
 * cadence gate DECIDES on that record.
 */
export function readLedger(stateDir: string): CorrectionsLedger {
  const p = ledgerPath(stateDir);
  if (!fs.existsSync(p)) return emptyCorrectionsLedger();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<CorrectionsLedger>;
    if (parsed.version !== LEDGER_VERSION) return emptyCorrectionsLedger();
    return {
      version: LEDGER_VERSION,
      harvested: Array.isArray(parsed.harvested) ? parsed.harvested : [],
      corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      dropped: typeof parsed.dropped === "number" ? parsed.dropped : 0,
    };
  } catch {
    return emptyCorrectionsLedger();
  }
}

function writeLedger(stateDir: string, ledger: CorrectionsLedger): void {
  const dir = path.resolve(stateDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ledgerPath(dir), JSON.stringify(ledger, null, 2));
}

/**
 * Fold sightings into a ledger. Pure — the caller decides whether to persist.
 *
 * Rewritten whole rather than appended to, unlike `runs.jsonl`. The append-only
 * discipline in this codebase is about the *tree* and about records something
 * decides on; this is machine-local advice whose entire value is being deduplicated
 * and short. An append-only log of every sighting would be the unbounded file the
 * node warns about, wearing the right ideology.
 */
export function foldSightings(ledger: CorrectionsLedger, sightings: readonly RefusalSighting[]): CorrectionsLedger {
  const byPermitted = new Map<string, Correction>();
  for (const c of ledger.corrections) byPermitted.set(c.permitted, { ...c });

  for (const s of sightings) {
    const existing = byPermitted.get(s.permitted);
    if (!existing) {
      byPermitted.set(s.permitted, {
        id: correctionId(s.permitted),
        permitted: s.permitted,
        attempted: s.attempted,
        tools: s.tool ? [s.tool] : [],
        sessions: [s.session],
        occurrences: 1,
        firstSeen: s.at,
        lastSeen: s.at,
      });
      continue;
    }
    existing.occurrences += 1;
    if (s.tool && !existing.tools.includes(s.tool)) existing.tools = [...existing.tools, s.tool].sort();
    if (!existing.sessions.includes(s.session)) existing.sessions = [...existing.sessions, s.session].sort();
    // Empty timestamps sort before anything, so a dateless entry never claims to
    // be the most recent sighting and never overwrites a real firstSeen.
    if (s.at && (!existing.firstSeen || s.at < existing.firstSeen)) existing.firstSeen = s.at;
    if (s.at > existing.lastSeen) existing.lastSeen = s.at;
  }

  const ordered = [...byPermitted.values()].sort(
    (a, b) => b.lastSeen.localeCompare(a.lastSeen) || a.id.localeCompare(b.id),
  );
  const kept = ordered.slice(0, MAX_CORRECTIONS);
  return {
    version: LEDGER_VERSION,
    harvested: ledger.harvested,
    corrections: kept,
    dropped: ledger.dropped + (ordered.length - kept.length),
  };
}

/** One finished session transcript, ready to be read. */
interface HarvestableSession {
  id: string;
  file: string;
}

/**
 * The sessions worth reading: `*.jsonl`, not already folded in, and quiet long
 * enough to be finished.
 *
 * The quiet window is why a session's own refusals never reach the session that
 * produced them — which is correct and is the whole shape of the problem. A
 * correction has to outlive its session to be worth writing down.
 */
function harvestableSessions(
  sessionsDir: string,
  ledger: CorrectionsLedger,
  opts: { now: number; quietMinutes: number },
): HarvestableSession[] {
  const dir = path.resolve(sessionsDir);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const seen = new Set(ledger.harvested);
  const quietBefore = opts.now - opts.quietMinutes * 60_000;
  const out: HarvestableSession[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".jsonl")) continue;
    const id = name.replace(/\.jsonl$/, "");
    if (seen.has(id)) continue;
    const file = path.join(dir, name);
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs > quietBefore) continue;
    out.push({ id, file });
  }
  return out;
}

export type HarvestResult =
  | {
      readable: true;
      /** Sessions folded in by this call. */
      sessions: string[];
      /** Sightings found in them, before dedup. */
      sightings: number;
      /** Corrections that were not in the ledger before this call. */
      added: number;
      ledger: CorrectionsLedger;
    }
  | { readable: false; reason: string; ledger: CorrectionsLedger };

/**
 * Read every finished session in `sessionsDir` that this ledger has not seen, fold
 * their corrections in, and persist. Idempotent by session id: a second call over
 * the same directory folds nothing and changes no count.
 *
 * `readable: false` when the transcript directory cannot be listed. Reported rather
 * than swallowed, and it does NOT stop the ledger being rendered — the corrections
 * already recorded are still the best advice available, and losing them because
 * today's transcripts are unreachable would be the storage failure again.
 */
export function recordCorrections(
  stateDir: string,
  sessionsDir: string,
  opts: { now?: number; quietMinutes?: number } = {},
): HarvestResult {
  const ledger = readLedger(stateDir);
  const dir = path.resolve(sessionsDir);
  if (!fs.existsSync(dir)) {
    return { readable: false, reason: `no session transcripts at ${dir}`, ledger };
  }
  const sessions = harvestableSessions(dir, ledger, {
    now: opts.now ?? Date.now(),
    quietMinutes: opts.quietMinutes ?? DEFAULT_QUIET_MINUTES,
  });

  const sightings: RefusalSighting[] = [];
  const folded: string[] = [];
  for (const s of sessions) {
    let text: string;
    try {
      text = fs.readFileSync(s.file, "utf8");
    } catch {
      continue; // an unreadable session costs that session, never the harvest
    }
    // Marked harvested whether or not it carried a correction — a clean session
    // re-read every firing is a cost with no possible finding, and the transcript
    // adapter's cursor makes the same call for the same reason.
    folded.push(s.id);
    sightings.push(...extractRefusals(text, s.id));
  }

  const before = new Set(ledger.corrections.map((c) => c.permitted));
  const next = foldSightings({ ...ledger, harvested: [...ledger.harvested, ...folded].sort() }, sightings);
  writeLedger(stateDir, next);
  return {
    readable: true,
    sessions: folded,
    sightings: sightings.length,
    added: next.corrections.filter((c) => !before.has(c.permitted)).length,
    ledger: next,
  };
}

/**
 * The ledger as the text a session is handed before it composes.
 *
 * Written as instruction rather than as a report, because the reader is a model
 * about to write its first tool call and the failure being addressed is a reflex,
 * not an information gap. Each line names the permitted form first — that is the
 * part worth reaching for — and the count second, because "seven sessions have
 * already paid for this one" is the only argument the ledger has.
 *
 * An empty ledger renders as one honest line rather than as nothing. A prompt that
 * silently omits a section teaches the reader nothing about whether the section was
 * empty or the machinery was broken.
 */
export function renderCorrections(ledger: CorrectionsLedger): string {
  const lines = [
    "CORRECTIONS ALREADY ISSUED IN THIS WORKSPACE (read before composing a call):",
    "",
  ];
  if (ledger.corrections.length === 0) {
    lines.push("  (none recorded — no guard in a harvested session named a permitted form)");
    return lines.join("\n");
  }
  lines.push(
    "Each of these is a call the surface has already refused here, with the form it asked for",
    "instead. They were paid for once. Compose the permitted form the first time.",
    "",
  );
  for (const c of ledger.corrections) {
    const cost =
      c.sessions.length > 1
        ? `${c.occurrences} time(s) across ${c.sessions.length} sessions`
        : `${c.occurrences} time(s)`;
    lines.push(`- ${c.permitted}`);
    lines.push(`    refused ${cost}${c.tools.length > 0 ? ` (${c.tools.join(", ")})` : ""}: ${c.attempted}`);
    // A remedy stated as prose still leaves the composer to work out the loop, the
    // interval, the bound and the output trimming — four places to decide the fixed
    // sleep was easier. Where the correction is about waiting, the line itself goes
    // here, at the moment of reach. See `wait.ts` for why prose alone is not enough.
    if (isWaitingCorrection(c.permitted)) lines.push(renderWaitAffordance());
  }
  if (ledger.dropped > 0) {
    lines.push("");
    lines.push(
      `  (${ledger.dropped} older correction(s) have fallen off the end of this ledger — it keeps the ${MAX_CORRECTIONS} most recent.)`,
    );
  }
  return lines.join("\n");
}
