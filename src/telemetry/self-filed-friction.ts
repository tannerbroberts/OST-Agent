/**
 * The self-filed friction census: did the agent file, per pass, and can anybody
 * act on what it filed?
 *
 * The solution under test is the filing affordance itself — `ost-agent friction`,
 * one line at the point of pain, while the context is still live. The assumption
 * beneath it is not that the affordance can be built, it is that **the agent uses
 * it under load rather than pushing through silently and reporting a clean run**.
 * The assumption test fixed three clauses before anything was counted:
 *
 * 1. **≥1 event filed per pass**, across five ordinary passes.
 * 2. **Every event actionable** — carrying the tool, the failing input and what
 *    was expected, so a filing made of bare prose does not count.
 * 3. **Unfiled-to-filed below 2:1** — the friction that went unrecorded, counted
 *    by a human reading the same five transcripts.
 *
 * This module computes the first two. It cannot compute the third and does not
 * try: counting what was NEVER filed means reading a session for friction that
 * left no trace, and the node assigns that to a person. Everything here is a
 * count of what IS in the channel, which is why {@link SelfFiledFrictionCensus}
 * reports a bar that is *met* rather than an assumption that is *confirmed* — the
 * clause that decides whether self-reporting can stand alone is the missing one.
 *
 * ## Why "per pass" needed a build at all
 *
 * A filing did not say which pass it came from. `source` is free text and
 * optional, and no historical filing set it, so the per-pass count the assumption
 * test asks for was not merely un-run — it was not computable from the record. The
 * six filings this vault held before this module could be counted (six) and dated
 * (two days), and that is the end of what they support. {@link FrictionFiling.pass}
 * is the field that changes it, and until filings carrying it accumulate, this
 * census's honest answer over the real archive is UNCOUNTABLE, not zero.
 *
 * That distinction is the whole reason {@link SelfFiledFrictionCensus.unattributed}
 * exists as its own number instead of being folded into a pass with no events. A
 * filing nobody can place is evidence the agent DID file; reading it as a silent
 * pass would turn the record of a filing into evidence against filing.
 */
import fs from "node:fs";
import path from "node:path";
import { FRICTION_FIELD_LABELS, FRICTION_KINDS, type FrictionFilingKind } from "../adapters/friction.js";

/**
 * What this census counts, and the bars it counts against — fixed by the
 * assumption test "Five-pass count of self-filed friction events" before any
 * filing carried a pass.
 *
 * Each number is here rather than inline so that changing one shows up as a
 * changed expectation in `test/telemetry/self-filed-friction-events.test.ts`
 * rather than as a quietly different finding.
 */
export const SELF_FILED_FRICTION_RULE = {
  /** Ordinary passes the count is taken over. Fewer than this is not a reading. */
  passes: 5,

  /** Events per pass below which the agent is pushing through silently. */
  perPassFloor: 1,

  /**
   * Share of events carrying all three actionable fields.
   *
   * The node's own threshold was ≥70% "specific enough for a human to act on",
   * which is a judgement. The instrument tightened it to every event, which is a
   * count, by naming the three fields that make one — and the writer now refuses
   * a filing without them, so anything below 1 is a filing made before the fields
   * existed or written past the affordance by hand.
   */
  actionableShare: 1,

  /** The fields a filing must carry to be actionable. */
  actionableFields: ["tool", "input", "expected"],

  /**
   * The clause this module refuses. Named rather than omitted: a census that
   * quietly reported two of three clauses would read as settling the assumption.
   */
  refuses: "the unfiled-to-filed ratio — counting friction that left no record needs a human reading the transcripts",
} as const;

/** Why a filing cannot be acted on later. */
export type UnactionableReason = "no tool named" | "no failing input" | "no expectation stated";

/** One filing, as the census reads it back off disk. */
export interface SelfFiledEvent {
  /** Basename of the filing, so a count can be checked by hand. */
  file: string;
  kind: FrictionFilingKind | "unknown";
  note: string;
  /** ISO timestamp the filing recorded, or "" when it recorded none. */
  at: string;
  /** The pass it was filed during, absent on every filing written before the field existed. */
  pass?: string;
  tool?: string;
  input?: string;
  expected?: string;
  /** True only when all three of {@link SELF_FILED_FRICTION_RULE.actionableFields} are present. */
  actionable: boolean;
  /** Every field that was missing, in field order. Empty when {@link actionable}. */
  missing: UnactionableReason[];
}

/** One pass, and what it filed. */
export interface PassFilings {
  pass: string;
  events: SelfFiledEvent[];
  /** Of those, how many a reader could act on. */
  actionable: number;
  /** Whether this pass alone clears {@link SELF_FILED_FRICTION_RULE.perPassFloor}. */
  meetsFloor: boolean;
}

export interface SelfFiledFrictionCensus {
  /**
   * Passes the census was asked about. Leads the report: a five-pass bar read
   * over two passes is not a low number, it is no number.
   */
  passesRead: number;
  /** Whether that is enough passes to read the bar at all. */
  enoughPasses: boolean;
  /** Every pass asked about, in the order given, including the ones that filed nothing. */
  passes: PassFilings[];
  /** Passes that filed nothing — the shape the assumption predicts will be empty. */
  silentPasses: string[];
  /** Total filings credited to a named pass. */
  filed: number;
  /** Of those, how many carry all three actionable fields. */
  actionable: number;
  /** Of {@link filed}, the share that are actionable. `null` when nothing was filed. */
  actionableShare: number | null;
  /**
   * Filings that named no pass. Evidence the agent filed, and uncountable per
   * pass — never folded into {@link silentPasses}. See the module comment.
   */
  unattributed: SelfFiledEvent[];
  meetsPerPassFloor: boolean;
  meetsActionableShare: boolean;
  /** Both computable clauses. Never the assumption — see {@link SELF_FILED_FRICTION_RULE.refuses}. */
  meetsBar: boolean;
}

const FIELD_ORDER: readonly (keyof typeof FRICTION_FIELD_LABELS)[] = ["tool", "input", "expected"];

const MISSING_REASON: Readonly<Record<keyof typeof FRICTION_FIELD_LABELS, UnactionableReason>> = {
  tool: "no tool named",
  input: "no failing input",
  expected: "no expectation stated",
};

/**
 * Pull one `- **label:** value` line out of a filing body.
 *
 * Anchored to the start of a line and to the bullet, not searched anywhere in the
 * text, because a filing's own note is the operator's prose and routinely quotes
 * the words this is looking for — the archive contains a note whose first sentence
 * is about a missing tool, and a loose match would read that sentence as the
 * `tool` field.
 */
function field(body: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^- \\*\\*${escaped}:\\*\\* *(.*)$`, "m").exec(body);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
}

/** Read one filing. Returns `null` for a file that is not a filing at all. */
export function readSelfFiledEvent(file: string, body: string): SelfFiledEvent | null {
  const kindText = field(body, "kind");
  const filed = field(body, "filed");
  // Both, not either: the pair is what every filing this writer has ever produced
  // carries, and requiring it keeps a hand-written note dropped into the folder
  // from being counted as a filing the agent made.
  if (!kindText || !filed) return null;

  const heading = /^#\s+Friction\s*\([^)]*\)\s*:\s*(.*)$/m.exec(body);
  const missing: UnactionableReason[] = [];
  const values: Partial<Record<keyof typeof FRICTION_FIELD_LABELS, string>> = {};
  for (const key of FIELD_ORDER) {
    const value = field(body, FRICTION_FIELD_LABELS[key]);
    if (value) values[key] = value;
    else missing.push(MISSING_REASON[key]);
  }

  return {
    file: path.basename(file),
    kind: (FRICTION_KINDS as readonly string[]).includes(kindText) ? (kindText as FrictionFilingKind) : "unknown",
    note: heading?.[1]?.trim() ?? "",
    at: filed,
    pass: field(body, "pass"),
    ...values,
    actionable: missing.length === 0,
    missing,
  };
}

/**
 * Every filing in a friction channel folder, oldest first.
 *
 * A missing folder reads as no filings rather than throwing: "nothing has ever
 * been filed here" is a result this census must be able to return, and it is the
 * result most worth distinguishing from a crash.
 */
export function readSelfFiledFriction(frictionDir: string): SelfFiledEvent[] {
  let names: string[];
  try {
    names = fs.readdirSync(frictionDir);
  } catch {
    return [];
  }

  const events: SelfFiledEvent[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    let body: string;
    try {
      body = fs.readFileSync(path.join(frictionDir, name), "utf8");
    } catch {
      continue; // an unreadable file costs one filing, never the census
    }
    const event = readSelfFiledEvent(name, body);
    if (event) events.push(event);
  }
  return events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.file < b.file ? -1 : 1));
}

/**
 * The two computable clauses, over a named set of passes.
 *
 * The passes are supplied rather than inferred from the filings, and that is the
 * point: inferring them would define a pass as "a pass that filed something",
 * which makes the per-pass floor true by construction and unable to report the
 * silence it exists to detect.
 */
export function selfFiledFrictionCensus(
  events: readonly SelfFiledEvent[],
  passIds: readonly string[],
): SelfFiledFrictionCensus {
  const byPass = new Map<string, SelfFiledEvent[]>(passIds.map((id) => [id, []]));
  const unattributed: SelfFiledEvent[] = [];

  for (const event of events) {
    if (!event.pass) {
      unattributed.push(event);
      continue;
    }
    const bucket = byPass.get(event.pass);
    // A filing from a pass outside the window is neither this window's evidence
    // nor unattributed — it is simply another pass's, and counting it here would
    // let one loud pass cover for four silent ones.
    if (bucket) bucket.push(event);
  }

  const passes: PassFilings[] = passIds.map((pass) => {
    const passEvents = byPass.get(pass) ?? [];
    return {
      pass,
      events: passEvents,
      actionable: passEvents.filter((e) => e.actionable).length,
      meetsFloor: passEvents.length >= SELF_FILED_FRICTION_RULE.perPassFloor,
    };
  });

  const filed = passes.reduce((n, p) => n + p.events.length, 0);
  const actionable = passes.reduce((n, p) => n + p.actionable, 0);
  const enoughPasses = passIds.length >= SELF_FILED_FRICTION_RULE.passes;
  const actionableShare = filed === 0 ? null : actionable / filed;
  const meetsPerPassFloor = passes.every((p) => p.meetsFloor);
  const meetsActionableShare = actionableShare !== null && actionableShare >= SELF_FILED_FRICTION_RULE.actionableShare;

  return {
    passesRead: passIds.length,
    enoughPasses,
    passes,
    silentPasses: passes.filter((p) => !p.meetsFloor).map((p) => p.pass),
    filed,
    actionable,
    actionableShare,
    unattributed,
    meetsPerPassFloor,
    meetsActionableShare,
    meetsBar: enoughPasses && meetsPerPassFloor && meetsActionableShare,
  };
}

/**
 * The census as an operator reads it: coverage, then the two clauses, then the
 * clause this cannot settle.
 *
 * The refusal is printed every time, including on a met bar. A report that ended
 * on "BAR MET" would read as the assumption confirmed, and the clause that decides
 * whether self-reporting can stand alone is the one not in this output.
 */
export function formatSelfFiledFrictionCensus(census: SelfFiledFrictionCensus): string {
  const lines: string[] = [];

  lines.push(
    `Coverage: ${census.passesRead} pass(es) read — the bar is stated over ` +
      `${SELF_FILED_FRICTION_RULE.passes}, ${census.enoughPasses ? "enough to read it" : "NOT enough to read it"}.`,
  );

  if (census.unattributed.length > 0) {
    lines.push(
      `Unattributed: ${census.unattributed.length} filing(s) name no pass and cannot be counted per pass. ` +
        `They are evidence the agent filed; they are not evidence about any pass.`,
    );
  }

  lines.push(
    `Per pass: ${census.filed} filing(s) across ${census.passesRead} pass(es) — floor is ` +
      `${SELF_FILED_FRICTION_RULE.perPassFloor} per pass, ${census.meetsPerPassFloor ? "MET" : "NOT MET"}.`,
  );
  for (const pass of census.passes) {
    lines.push(
      `  ${pass.pass} — ${pass.events.length} filed, ${pass.actionable} actionable` +
        (pass.meetsFloor ? "" : "   ← filed nothing"),
    );
  }

  if (census.actionableShare === null) {
    lines.push("Actionable: no filing was credited to a pass, so there is no share to take.");
  } else {
    lines.push(
      `Actionable: ${census.actionable}/${census.filed} carry ${SELF_FILED_FRICTION_RULE.actionableFields.join(", ")} ` +
        `(${Math.round(census.actionableShare * 100)}%) — bar is ` +
        `${Math.round(SELF_FILED_FRICTION_RULE.actionableShare * 100)}%, ${census.meetsActionableShare ? "MET" : "NOT MET"}.`,
    );
    for (const pass of census.passes) {
      for (const event of pass.events) {
        if (!event.actionable) lines.push(`  ${event.file} — ${event.missing.join(", ")}`);
      }
    }
  }

  lines.push(`Bar (both computable clauses): ${census.meetsBar ? "MET" : "NOT MET"}.`);
  lines.push(
    `Not settled: ${SELF_FILED_FRICTION_RULE.refuses}. A met bar says the agent filed and that the filings are ` +
      `actionable. It does not say how much friction went by unfiled, which is what decides whether self-reporting ` +
      `can stand alone or is a supplement to retrospective harvesting.`,
  );

  return lines.join("\n");
}
