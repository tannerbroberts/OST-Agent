/**
 * The external-signal gate on the root Outcome.
 *
 * Every other gate in this repo governs one node's faithfulness. This one
 * governs the verdict at the top — *did it work* — and it is the one verdict a
 * model must never be able to return about itself. An agent that can record its
 * own Outcome as achieved closes the loop it was built to open: the tree becomes
 * a hall of mirrors in which the thing being measured is also the thing writing
 * the measurement down.
 *
 * The rule is the same asymmetry `validated` already rests on, moved up a layer:
 *
 *   - **Declaring** the signal is the operator's, and it lives in
 *     `ost.config.yaml` — a file no tool on the agent surface can write. A signal
 *     compute could declare is a gate compute could open, so the declaration is
 *     not a node, not a frontmatter field, and not an argument on any call.
 *   - **Reading** the signal is a person's. `## Outcome Signal` is a reserved
 *     heading ({@link ./headings.ts}), reachable only through
 *     `appendUnderSection`'s unscanned `heading` argument, which is to say only
 *     through {@link recordOutcomeSignal} below and the CLI that calls it.
 *   - **Everything else refuses.** Until a declared signal has been read as met
 *     by a named person, every write on the agent surface that would land an
 *     achievement claim on the Outcome is refused
 *     ({@link outcomeSelfCertificationRefusal}).
 *
 * **What the prose half is and is not.** The structural half above is the gate:
 * nothing in this product reads the root's ordinary prose as an achievement
 * record, so prose cannot clear anything. The text detector here is defence in
 * depth against a different harm — a human opening the vault and reading, in the
 * root node, a sentence the agent wrote saying the outcome was met. It refuses
 * the forms a self-certifying pass actually writes; it is not, and cannot be, a
 * proof that no phrasing gets through. A determined author can always paraphrase
 * past a regex, which is precisely why the verdict is typed and lives somewhere
 * else.
 */
import fs from "node:fs";
import path from "node:path";
import { readConfig } from "../config/load.js";
import { entriesUnder, OUTCOME_SIGNAL_HEADING } from "./headings.js";
import { titlesMatch } from "./sanitize.js";
import type { OstNode } from "./node.js";
import { Vault } from "./vault.js";

export { OUTCOME_SIGNAL_HEADING };

/** The two verdicts a reading may carry. Closed, for the reason `VERDICTS` is. */
export const SIGNAL_VERDICTS = ["met", "unmet"] as const;
export type SignalVerdict = (typeof SIGNAL_VERDICTS)[number];

/**
 * The operator's declared external signal, as `ost.config.yaml` states it.
 *
 * Two fields and both required, because either one alone is unfalsifiable: a
 * `signal` with no `met` is a thing to watch rather than a bar to clear, and a
 * `met` with no `signal` is a number attached to nothing.
 */
export interface DeclaredOutcomeSignal {
  /** What is measured, out in the world, in the operator's own words. */
  signal: string;
  /** The bar that counts as the outcome having been achieved. */
  met: string;
  /** Where the number comes from, when the operator said. */
  source?: string;
}

/** One human-recorded reading of that signal, parsed back off the root node. */
export interface OutcomeSignalReading {
  on: string;
  verdict: SignalVerdict;
  by: string;
  reading: string;
}

/**
 * The whole state of the gate: what was declared, what was read, and therefore
 * whether the Outcome may be recorded as achieved at all.
 */
export interface OutcomeSignalState {
  declared?: DeclaredOutcomeSignal;
  /** Every reading recorded under the reserved heading, oldest first. */
  readings: OutcomeSignalReading[];
  /** The one the gate consults — the most recent. */
  latest?: OutcomeSignalReading;
  /** True only when a signal is declared AND its latest reading is `met`. */
  achieved: boolean;
}

/**
 * The declared signal, or undefined.
 *
 * Reads the file rather than a `Config` a caller passed in, on purpose: the gate
 * runs on surfaces that build their tools from a bare directory (see the test
 * harnesses, which construct a `ToolContext` with no config at all), and a gate
 * that is only present when someone remembered to thread a config through is not
 * a gate. Every failure to read — no file, bad YAML, schema violation — answers
 * "undeclared", which is the closed direction: an unreadable config cannot
 * declare anything.
 */
export function readDeclaredOutcomeSignal(dir: string): DeclaredOutcomeSignal | undefined {
  try {
    const { config, problem } = readConfig(dir, { missing: "defaults" });
    if (problem) return undefined;
    const declared = config.outcomeSignal;
    if (!declared) return undefined;
    const signal = declared.signal.trim();
    const met = declared.met.trim();
    if (!signal || !met) return undefined;
    const source = declared.source?.trim();
    return { signal, met, ...(source ? { source } : {}) };
  } catch {
    return undefined;
  }
}

/** Is a config file even present? Used only to word the refusal, never to decide it. */
function hasConfigFile(dir: string): boolean {
  return fs.existsSync(path.join(path.resolve(dir), "ost.config.yaml"));
}

const READING_PATTERN = /^(\d{4}-\d{2}-\d{2})\s+\*\*(met|unmet)\*\*\s+\(by\s+([^)]+)\)\s+—\s+(.*)$/;

/** The readings a node carries under the reserved heading, oldest first. */
export function outcomeSignalReadings(node: Pick<OstNode, "body">): OutcomeSignalReading[] {
  const out: OutcomeSignalReading[] = [];
  for (const entry of entriesUnder(node.body ?? "", OUTCOME_SIGNAL_HEADING)) {
    const m = READING_PATTERN.exec(entry.trim());
    if (!m) continue;
    out.push({ on: m[1], verdict: m[2] as SignalVerdict, by: m[3].trim(), reading: m[4].trim() });
  }
  return out;
}

/** The root Outcome node of a tree, or undefined for a vault that has none yet. */
export function rootOutcome(tree: readonly OstNode[]): OstNode | undefined {
  return tree.find((n) => n.layer === "Outcome");
}

/**
 * The gate's state for a vault: declaration from the config, readings from the
 * root node, and the one boolean everything else asks for.
 */
export function outcomeSignalState(dir: string, root: Pick<OstNode, "body"> | undefined): OutcomeSignalState {
  const declared = readDeclaredOutcomeSignal(dir);
  const readings = root ? outcomeSignalReadings(root) : [];
  const latest = readings.length > 0 ? readings[readings.length - 1] : undefined;
  return {
    ...(declared ? { declared } : {}),
    readings,
    ...(latest ? { latest } : {}),
    achieved: Boolean(declared) && latest?.verdict === "met",
  };
}

/**
 * Record a reading of the declared signal on the root Outcome. **CLI-only, and
 * that is the entire safety argument** — the same sentence `recordResult` and
 * `retractNode` carry, for the same reason. This function names
 * {@link OUTCOME_SIGNAL_HEADING} in `appendUnderSection`'s own argument, the one
 * position the content guard does not scan, so no free-text parameter on any
 * tool can reach it.
 *
 * Three refusals, each a way the record would stop being a record:
 *   - no declared signal in `ost.config.yaml` — a reading of nothing is not a
 *     measurement, and accepting one here would let the CLI invent the bar it
 *     then clears
 *   - no attribution — an unattributed reading cannot be told apart from a
 *     fabricated one (`recordResult`'s rule, verbatim)
 *   - no reading — "met" with no number behind it is the assertion this whole
 *     mechanism exists to refuse, merely typed by a human instead of an agent
 */
export interface OutcomeSignalFiling {
  verdict: SignalVerdict;
  by: string;
  reading: string;
  on?: string;
}

export function recordOutcomeSignal(vaultDir: string, filing: OutcomeSignalFiling): string {
  const dir = path.resolve(vaultDir);
  const declared = readDeclaredOutcomeSignal(dir);
  if (!declared) {
    throw new Error(
      `no external signal is declared for this vault, so there is nothing to read. Declare one in ` +
        `ost.config.yaml before recording against it:\n\n` +
        `outcomeSignal:\n  signal: "what you measure out in the world"\n  met: "the bar that counts as achieved"\n` +
        `  source: "where the number comes from"\n\n` +
        `It lives in that file and nowhere else because no tool on the agent surface can write it — a signal ` +
        `compute could declare is a gate compute could open.`,
    );
  }
  if (!SIGNAL_VERDICTS.includes(filing.verdict)) {
    throw new Error(`"${filing.verdict}" is not a signal verdict — use one of: ${SIGNAL_VERDICTS.join(", ")}`);
  }
  const by = (filing.by ?? "").trim();
  if (!by) {
    throw new Error(
      "a signal reading needs attribution — say who read it. An unattributed reading cannot be told apart from a fabricated one.",
    );
  }
  const reading = (filing.reading ?? "").trim();
  if (!reading) {
    throw new Error(
      "a signal reading needs the number you actually saw — what the signal said, and when. A verdict with no " +
        "reading behind it is the assertion this gate exists to refuse; a person typing it does not make it a measurement.",
    );
  }

  const vault = new Vault(dir);
  const root = rootOutcome(vault.readTree());
  if (!root) throw new Error(`no Outcome node in ${dir} — run \`ost-agent init\` first`);

  const on = filing.on ?? new Date().toISOString().slice(0, 10);
  const line = `- ${on} **${filing.verdict}** (by ${by}) — ${reading} [signal: ${declared.signal}; met when: ${declared.met}]`;
  // The heading travels as `appendUnderSection`'s own argument — the position the
  // content guard does not scan — which IS this path's exclusivity. Do not inline
  // it into `line` (ost/headings.ts).
  vault.appendUnderSection(root.title, OUTCOME_SIGNAL_HEADING, line, "human");
  return line;
}

/* ------------------------------------------------------------------ *
 * The prose half: what an achievement claim looks like in ordinary text
 * ------------------------------------------------------------------ */

/** The nouns a claim about the top of the tree is made about. */
const SUBJECT = String.raw`(?:outcome|goal|mandate|objective|north\s+star|mission)`;

/** The past-tense verbs that turn one of those nouns into a record of fact. */
const ACHIEVED = String.raw`(?:achieved|met|reached|attained|accomplished|fulfill?ed|satisfied|hit|realis?ed|realized|delivered|succeeded)`;

/**
 * Assertions of state about the Outcome. Each pattern requires a form that
 * claims something HAPPENED, not a form that names a target.
 *
 * That distinction is the whole design of these three patterns and the reason
 * they are narrow. The root Outcome's body is, by construction, a goal statement
 * — "so that teams reach their goal" is what a mandate SOUNDS like — and a
 * detector that fired on it would refuse the operator's own outcome text on
 * every edit. So a bare subject-plus-verb is not enough: there has to be a
 * copula ("the outcome IS met"), a perfect ("we HAVE met the goal"), or a label
 * ("Outcome: achieved").
 */
const CLAIM_PATTERNS: readonly RegExp[] = [
  // "the outcome is achieved", "our goal has been met", "the mandate was reached"
  new RegExp(String.raw`\b${SUBJECT}\b[^.\n]{0,30}?\b(?:is|are|was|were|has\s+been|have\s+been|had\s+been)\b[^.\n]{0,20}?\b${ACHIEVED}\b`, "i"),
  // "we have achieved the outcome", "the agent met the goal", "this hit the north star"
  new RegExp(String.raw`\b(?:we|i|the\s+team|the\s+agent|ost-agent|this|it|that)\b[^.\n]{0,20}?\b${ACHIEVED}\b[^.\n]{0,30}?\b${SUBJECT}\b`, "i"),
  // "Outcome: achieved", "OUTCOME — MET", "outcome status: achieved"
  new RegExp(String.raw`\b${SUBJECT}\b[^\S\n]*(?:status)?[^\S\n]*[:—–-][^\S\n]*${ACHIEVED}\b`, "i"),
];

/**
 * Words that turn a claim back into something other than a record: a denial, a
 * hypothetical, a question, a plan.
 *
 * Scanned over the whole sentence the match sits in rather than a fixed window,
 * because the negation can arrive on either side of the verb ("we have NOT met
 * the goal", "the outcome is met, or so I assumed" — the second is why `assum`
 * is here). Under-detecting an adversarially-phrased claim is accepted and
 * stated in this file's header; over-detecting an honest "not yet" would refuse
 * the sentence a truthful pass most wants to write.
 */
const NEGATORS =
  /\b(?:not|no|never|isn't|isnt|aren't|arent|wasn't|wasnt|weren't|werent|hasn't|hasnt|haven't|havent|hadn't|hadnt|cannot|can't|cant|won't|wont|unmet|unachieved|yet|if|whether|unless|until|once|when|would|could|should|might|may|will|assum\w*|suppose\w*|pretend\w*|hypothetic\w*|\?)\b|\?/i;

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The first sentence of `text` that records the Outcome as achieved, or
 * undefined. Returned rather than a boolean so the refusal can quote what it
 * refused — a guard that names nothing teaches the caller nothing.
 */
export function claimsOutcomeAchieved(text: string): string | undefined {
  for (const sentence of sentencesOf(text)) {
    if (NEGATORS.test(sentence)) continue;
    if (CLAIM_PATTERNS.some((p) => p.test(sentence))) return sentence;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * The guard every write on the agent surface passes through
 * ------------------------------------------------------------------ */

/**
 * Statuses that, on the ROOT node specifically, are themselves an achievement
 * record — no prose required.
 *
 * `validated` is already refused everywhere by `AGENT_SETTABLE_STATUSES`; it is
 * named here anyway because this guard runs in front of `run`, and a guard that
 * relied on a second mechanism holding would be one mechanism, described twice.
 * `shipped` earns its place for the reason it does not on a Solution: a Solution
 * that shipped was built, while an Outcome that shipped is a claim that the
 * mandate is done.
 */
const ACHIEVING_STATUSES = new Set(["validated", "shipped"]);

/** Every string a call carries, whatever the tool calls its arguments. */
function stringArguments(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const out: string[] = [];
  for (const value of Object.values(input as Record<string, unknown>)) {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) for (const v of value) if (typeof v === "string") out.push(v);
  }
  return out;
}

export interface OutcomeGateSubject {
  vault: Vault;
  dir: string;
  /**
   * The root Outcome's title, resolved by the caller.
   *
   * Passed in rather than found here because finding it costs a whole-tree read,
   * and this guard runs in front of EVERY mutating call. On a 10,000-node vault
   * that is the difference between a gate and a tax: the caller resolves the
   * title once per tool set (see `security/tools.ts`), and each call then reads
   * exactly one file — the root's own — to see whether a person has recorded a
   * reading on it since.
   */
  rootTitle: string | undefined;
}

function refusal(what: string, quoted: string, dir: string, declared: DeclaredOutcomeSignal | undefined): string {
  const head =
    `refusing to record the Outcome as achieved: ${what} — ${JSON.stringify(quoted)}. ` +
    `Whether this outcome was met is decided by a real-world signal plus a person, never by the agent. ` +
    `A surface that could write this verdict would be grading its own homework, and every gate beneath ` +
    `it would inherit the grade.`;
  if (!declared) {
    const where = hasConfigFile(dir) ? "ost.config.yaml declares no `outcomeSignal`" : `there is no ost.config.yaml in ${dir}`;
    return (
      `${head}\n\nRight now ${where}, so there is not even a bar to read against. The operator declares one ` +
      `in that file — the one place no tool on this surface can write:\n\n` +
      `outcomeSignal:\n  signal: "what you measure out in the world"\n  met: "the bar that counts as achieved"\n\n` +
      `Once it is declared, a person records what they actually saw with ` +
      `\`ost-agent outcome-signal --verdict met --by "<who>" --reading "<the number>"\`. Until then, say what ` +
      `progress you observed and leave the verdict alone.`
    );
  }
  return (
    `${head}\n\nThe declared signal is ${JSON.stringify(declared.signal)}, met when ${JSON.stringify(declared.met)}, ` +
    `and no reading of it says met. A person records one with ` +
    `\`ost-agent outcome-signal --verdict met --by "<who>" --reading "<the number>"\`; that is the only path, and ` +
    `it is deliberately not on this surface.`
  );
}

/**
 * The refusal this call earns, or null.
 *
 * Applies to writes that land on the ROOT Outcome — which is the node the
 * circularity is about — and nowhere else. Two ways to earn one: setting a
 * status that is itself an achievement record, or carrying prose that reads as
 * a claim of fact. Both are waived once {@link outcomeSignalState} says a
 * declared signal has been read as met, because at that point the agent is
 * reporting a person's measurement rather than authoring one.
 *
 * `input`'s strings are read WHOLESALE rather than through a per-tool table of
 * which argument holds prose. That is deliberate and it is the lesson
 * `assertWritableTag` already paid for: a hand-written list of writable
 * parameters will always be one short of the truth, and the parameter nobody
 * remembered is exactly the path this gate exists to close.
 */
export function outcomeSelfCertificationRefusal(ctx: OutcomeGateSubject, input: unknown): string | null {
  const rootTitle = ctx.rootTitle;
  if (!rootTitle) return null; // a vault with no Outcome has no verdict to forge

  const args = stringArguments(input);
  // Does this call touch the root at all? Every tool that writes to a node names
  // it by title in some argument, so a call that never mentions the root cannot
  // land on it.
  if (!args.some((a) => titlesMatch(a, rootTitle))) return null;

  let root: OstNode | undefined;
  try {
    root = ctx.vault.read(rootTitle);
  } catch {
    root = undefined; // unreadable root — treat its readings as absent, which is the closed direction
  }
  const state = outcomeSignalState(ctx.dir, root);
  if (state.achieved) return null;

  const status = (input as { status?: unknown } | null)?.status;
  if (typeof status === "string" && ACHIEVING_STATUSES.has(status)) {
    return refusal(`"${status}" on the Outcome node is that record`, status, ctx.dir, state.declared);
  }
  for (const arg of args) {
    const claim = claimsOutcomeAchieved(arg);
    if (claim) return refusal("this call writes the verdict as prose", claim, ctx.dir, state.declared);
  }
  return null;
}
