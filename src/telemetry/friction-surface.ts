/**
 * The surface rule: which harvested friction records get filed as evidence, and
 * which are counted instead.
 *
 * The friction channel taxes the pass it was built to help. A session whose whole
 * content is `(eval):1: == not found` arrives as an evidence record with the same
 * standing as one reporting that the loop stalled for four days, and a pass under
 * pressure to empty the queue is under pressure to promote a typo. The solution
 * this module implements scopes the filter by **what the failing call was
 * against**: a failure on this product's own surface becomes a record, a failure
 * on a shell, an editor or a script runner becomes a number in a tally. Nothing is
 * discarded — {@link SurfaceRuleReading.tally} is the tally, and it is part of the
 * output rather than a side effect.
 *
 * ## What the rule can see, and it is less than the solution assumed
 *
 * The solution's stated reason for preferring this rule is that it is "the
 * cheapest to implement, since the tool name is already recorded on every event".
 * The tool name is recorded. It is also, for the largest class of events in the
 * record, not enough — and the reason is the one
 * `path-failure-attribution.ts` already had to name: **this product's CLI is
 * invoked through `Bash`**. A digest line reads
 *
 * ```
 * - **tool_error** (Bash): Exit code 1 … (eval):1: == not found
 * ```
 *
 * and a failing `ost-agent rollup` would read `- **tool_error** (Bash): Exit code
 * 1 …` too. The digest keeps the *error*, not the *command*, so on a `Bash` event
 * the tool name routes this product's own CLI failures to `foreign` by
 * construction.
 *
 * That is not worked around here, because working around it silently is how a
 * measurement becomes an opinion. It is carried as a **bound**:
 *
 * - {@link RecordDisposition.certainty} `certain` — the failing tool is one this
 *   product implements ({@link ALLOWED_TOOL_NAMES}), an `ost_…` MCP tool, or a
 *   `Bash` call whose recorded command invokes the product CLI.
 * - `possible` — a `Bash` call whose recorded *text* names the product anywhere.
 *   Generous on purpose: `ls: /Users/tanner/dev/ost-agent-meta: No such file` is a
 *   failing `ls`, and the generous bound files it anyway so a reader who thinks
 *   the strict reading is unfair can see the answer theirs would have given.
 *
 * {@link SurfaceRuleReplay.boundDecides} says on the report's face whether the
 * choice between them moved the verdict.
 *
 * ## What a green run here does and does not settle
 *
 * It settles that the rule runs, keeps what touches this product's surface, and
 * counts the rest rather than dropping it on the floor. It does **not** settle
 * that the counted material was safe to demote — {@link frictionSurfaceReplay}
 * exists to answer that against a judgement made before the rule was written, and
 * a reading that fails {@link FRICTION_SURFACE_RULE.keepsBar} is this module
 * working, not this module broken.
 */
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_TOOL_NAMES } from "../security/policy.js";
import { ATTRIBUTION_RULE, commandSegments, invokesProductCli } from "./path-failure-attribution.js";

/**
 * The rule, and the bars the assumption test fixed before the corpus was replayed.
 *
 * The two bars are asymmetric on purpose. The rule's whole claim is precision, so
 * the drop bar is easy to clear and the keep bar is where it has to earn its
 * place: a filter that demotes 24 of 24 non-needs and 4 of 5 needs has not been
 * shown to be precise, it has been shown to be quiet.
 */
export const FRICTION_SURFACE_RULE = {
  /** Records the pass judged to carry a product need. */
  needs: 5,
  /** Records the pass judged not to. */
  nonNeeds: 24,
  /** Of {@link needs}, how many the rule must keep. */
  keepsBar: 4,
  /** Of {@link nonNeeds}, how many the rule must demote. */
  dropsBar: 20,

  /**
   * Tool names this product implements. The closed allowlist is the authority
   * rather than a regex written here: a tool this repository builds is this
   * repository's surface, and the two sets are the same set by definition.
   */
  productTools: new Set<string>(ALLOWED_TOOL_NAMES),

  /**
   * Text that names this product, for the generous bound only.
   *
   * Never used on its own to make a `certain` attribution. `ost-agent` appears in
   * a path, in a repository name, in a script's own output and in the prose of a
   * question the agent asked — all of which are mentions, not failing calls.
   */
  mentionsProduct: /\bost[-_]agent\b|\bost_[a-z_]+\b|dist\/ost-agent\.mjs/i,

  /**
   * The clause this module refuses. Named rather than omitted, because a replay
   * that reported only the two counts would read as settling the comparison it
   * feeds.
   */
  refuses:
    "whether a demoted record was safe to demote — the tally says what was counted, it does not say what reading it would have produced",
} as const;

/** Whose failing call it was. `foreign` means: not this product's surface. */
export type RecordSurface = "product" | "foreign";

/**
 * How sure that is. A `Bash` event keeps an error and rarely a command, so
 * "the product is named in here somewhere" is not "the thing that failed was ours".
 */
export type SurfaceCertainty = "certain" | "possible";

/** What the rule did with a record. */
export type Disposition = "filed" | "counted";

/** Why a record was counted rather than filed. */
export type CountedReason =
  | "no failing call against this product's own surface"
  | "no failing call to attribute";

/** One friction event as a harvested record writes it down. */
export interface RecordEvent {
  /** `tool_error`, `retry`, `clarifying_question`, … as the digest names it. */
  kind: string;
  /** The tool the digest names, or `""` when it named none. */
  tool: string;
  /** The detail line, verbatim. For `Bash` this is the error, not the command. */
  detail: string;
  /**
   * The command, present only when the event's detail carried one — `retry`
   * events record their input as JSON and a `Bash` input has a `command` field.
   * Empty on every `tool_error`, which is the blindness the module comment names.
   */
  command: string;
}

/** The kind of harvest a record came out of. */
export type RecordKind = "transcript" | "usage";

/** One harvested evidence record, as the rule reads it. */
export interface FrictionRecord {
  /** The record's `id:` — `TRANSCRIPT:<uuid>` or `USAGE:<date>`. */
  id: string;
  /** Basename on disk, so any row can be checked by hand. */
  file: string;
  kind: RecordKind;
  events: RecordEvent[];
  /**
   * True when the digest said it was showing only the first N events. A record
   * whose product-surface event fell past the cap would be demoted for a reason
   * that is about the harvester, not about the record — see
   * {@link SurfaceRuleReplay.truncated}.
   */
  truncated: boolean;
}

/** One event, after attribution. */
export interface AttributedEvent extends RecordEvent {
  surface: RecordSurface;
  certainty: SurfaceCertainty;
  /** Why it was attributed that way, in the words a reader can check. */
  because: string;
}

/** One record, after the rule ran. */
export interface RecordDisposition {
  record: FrictionRecord;
  events: AttributedEvent[];
  /** Events attributed to this product's surface with `certain`. */
  productCertain: number;
  /** …plus the ones where it might have been. */
  productPossible: number;
  /** Failing calls in the record at all. Zero means there was nothing to judge. */
  failing: number;
  disposition: Disposition;
  /** The disposition under the generous bound. Differs only where `possible` events exist. */
  dispositionUpperBound: Disposition;
  certainty: SurfaceCertainty;
  reason?: CountedReason;
}

/** What the rule counted rather than filed, grouped so nothing is lost. */
export interface SurfaceRuleTally {
  /** Records demoted. */
  records: number;
  /** Events inside them. */
  events: number;
  /** Demoted events by tool, largest first. */
  byTool: { tool: string; n: number }[];
  /** Demoted events by friction kind, largest first. */
  byKind: { kind: string; n: number }[];
  /** Every demoted record's id, so the tally can be read back to its subjects. */
  ids: string[];
}

/** The rule's reading of a corpus, before any judgement is compared to it. */
export interface SurfaceRuleReading {
  read: number;
  dispositions: RecordDisposition[];
  filed: string[];
  counted: string[];
  tally: SurfaceRuleTally;
  /** Records with no failing call at all — counted, but not *demoted*. */
  nothingToJudge: string[];
}

/** The pass's judgement of one record, made before the rule existed. */
export interface JudgedRecord {
  id: string;
  /** True when the pass read this record as revealing a product need. */
  need: boolean;
  /** The pass's own one-line reason, carried so a disagreement can be read. */
  note: string;
}

/** One clause of the assumption test, scored. */
export interface ReplayClause {
  name: string;
  got: number;
  of: number;
  bar: number;
  meets: boolean;
  /**
   * Whether there was anything to score at all. A clause over zero judged records
   * is no reading, not a failed one — the distinction the sibling censuses draw
   * with `enoughPasses`, and the one a bare `meets: false` would erase.
   */
  scored: boolean;
}

export interface SurfaceRuleReplay {
  reading: SurfaceRuleReading;
  /** Judgement rows supplied. Zero means the rule was asked to read, not to score. */
  judged: number;
  /** Records the judgement covers but the corpus does not hold, and the reverse. */
  unjudged: string[];
  missing: string[];
  /** Needs the rule kept, and needs it demoted — the disagreement, by name. */
  needsKept: string[];
  needsDropped: string[];
  /** Non-needs the rule kept. The rule's false positives. */
  nonNeedsKept: string[];
  keeps: ReplayClause;
  drops: ReplayClause;
  /** True only when both clauses clear. Never "the assumption is confirmed". */
  meetsBar: boolean;
  /** The same two clauses under the generous bound. */
  keepsUpperBound: ReplayClause;
  dropsUpperBound: ReplayClause;
  /** True when the certain/possible choice changes either verdict. */
  boundDecides: boolean;
  /**
   * Records whose digest was truncated by the harvester. Reported ahead of the
   * score: a sweep that cannot read its subject must not report a clean result.
   */
  truncated: string[];
}

// ── reading a record ─────────────────────────────────────────────────────────

const FRONTMATTER_ID = /^id:\s*'?([^'\n]+?)'?\s*$/m;
const EVENT_LINE = /^- \*\*([a-z_]+)\*\*(?:\s*\(([^)]*)\))?:\s*(.*)$/;
const USAGE_CALLS = /^- \*\*Calls:\*\*\s*(\d+)\s*\((\d+) ok, (\d+) failed\)/m;
const USAGE_FAILED_CALL = /^- `([^`]+)`:\s*(.*)$/;

/**
 * The command a `retry` event recorded, when it recorded one.
 *
 * `retry` details are the tool's own input serialised as JSON, so a retried
 * `Bash` carries the command the digest drops everywhere else. Parsed rather than
 * pattern-matched, and a parse failure costs the command and never the event: a
 * clipped detail is truncated JSON, which is common and not an error.
 */
export function commandOf(detail: string): string {
  if (!detail.startsWith("{")) return "";
  try {
    const parsed: unknown = JSON.parse(detail);
    const command = (parsed as { command?: unknown }).command;
    return typeof command === "string" ? command : "";
  } catch {
    return "";
  }
}

/**
 * Read one harvested record.
 *
 * The two harvests write different bodies and the rule has to read both. A
 * transcript digest lists its events as bullets; a usage rollup lists tool call
 * *counts* and the first few failing calls by tool name. Only the failing ones are
 * lifted from a usage rollup — a successful `ost_create_node` is not friction, and
 * counting the whole trace would file every usage record by construction.
 *
 * Returns `null` for a file that is neither, so a hand-written note dropped into
 * an evidence folder is not read as a harvest.
 */
export function parseFrictionRecord(file: string, body: string): FrictionRecord | null {
  const id = FRONTMATTER_ID.exec(body)?.[1]?.trim();
  if (!id) return null;

  const base = path.basename(file);
  const truncated = /^Showing the first \d+;/m.test(body);

  if (id.startsWith("USAGE:")) {
    const calls = USAGE_CALLS.exec(body);
    if (!calls) return null;
    const failed = Number(calls[3]);
    const events: RecordEvent[] = [];
    if (failed > 0) {
      // The rollup prints only the first few failing calls by name. Those are the
      // ones that can be attributed; the remainder are known to exist and known
      // only as a number, so they are represented by the named ones rather than
      // invented. Attribution is unanimous across every usage rollup this vault
      // holds, so the shortfall has never split a record's disposition.
      for (const line of body.split("\n")) {
        const match = USAGE_FAILED_CALL.exec(line);
        if (match) events.push({ kind: "tool_error", tool: match[1], detail: match[2], command: "" });
      }
    }
    return { id, file: base, kind: "usage", events, truncated };
  }

  if (!id.startsWith("TRANSCRIPT:")) return null;
  const events: RecordEvent[] = [];
  for (const line of body.split("\n")) {
    const match = EVENT_LINE.exec(line);
    if (!match) continue;
    const detail = match[3].trim();
    events.push({ kind: match[1], tool: (match[2] ?? "").trim(), detail, command: commandOf(detail) });
  }
  return { id, file: base, kind: "transcript", events, truncated };
}

/** Every harvested record in a folder, by id. A missing folder reads as none. */
export function readFrictionRecords(dir: string): FrictionRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const records: FrictionRecord[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    let body: string;
    try {
      body = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue; // an unreadable file costs one record, never the replay
    }
    const record = parseFrictionRecord(name, body);
    if (record) records.push(record);
  }
  return records.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ── the rule ─────────────────────────────────────────────────────────────────

/**
 * Is an `mcp__<server>__<tool>` name one of ours, judged on the tool rather than
 * the server?
 *
 * `path-failure-attribution.ts` matches the *server* name against `ost[-_]agent`,
 * and over this vault's live record that misses `mcp__ostmeta__ost_set_evidence`
 * — the server the meta vault registers is called `ostmeta`, and the census
 * demoted this product's own MCP failures on the strength of a label the operator
 * chose. The tool suffix is the authority instead: a tool named in the closed
 * allowlist is one this repository built, whatever the server it is served under
 * is called.
 *
 * That regex is left alone rather than widened, because its census has a committed
 * number that was counted with it.
 */
export function servedByThisProduct(tool: string): boolean {
  const suffix = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/.exec(tool)?.[1];
  return suffix !== undefined && FRICTION_SURFACE_RULE.productTools.has(suffix);
}

/**
 * Whose surface one event's failing call was against.
 *
 * The order is the argument. A tool this product implements is `certain` and
 * needs no text; a `Bash` call is judged on its command when one survives and on
 * a mention only as the generous bound. Nothing else can reach `product`, because
 * `Edit`, `Workflow`, `AskUserQuestion` and `Skill` are the host's tools and this
 * repository will never change one of their messages.
 */
export function attributeEvent(event: RecordEvent): { surface: RecordSurface; certainty: SurfaceCertainty; because: string } {
  if (FRICTION_SURFACE_RULE.productTools.has(event.tool)) {
    return { surface: "product", certainty: "certain", because: "the tool is one this product implements" };
  }
  if (ATTRIBUTION_RULE.ownedMcpTool.test(event.tool) || servedByThisProduct(event.tool)) {
    return { surface: "product", certainty: "certain", because: "an MCP tool this product serves" };
  }
  if (event.tool !== "Bash") {
    return { surface: "foreign", certainty: "certain", because: `${event.tool || "an unnamed tool"} is not this product's` };
  }

  if (event.command) {
    const segments = commandSegments(event.command);
    const ours = segments.filter(invokesProductCli);
    if (ours.length > 0) {
      return {
        surface: "product",
        certainty: ours.length === segments.length ? "certain" : "possible",
        because: "the recorded command invokes this product's CLI",
      };
    }
    return { surface: "foreign", certainty: "certain", because: "the recorded command invokes no program of ours" };
  }

  // No command survived the digest. The tool name says `Bash` and nothing more,
  // which is exactly where the cheap rule cannot tell an `ost-agent` failure from
  // an `ls` one — so a mention buys the generous bound and never the strict one.
  if (FRICTION_SURFACE_RULE.mentionsProduct.test(event.detail)) {
    return { surface: "product", certainty: "possible", because: "the error text names this product, but the command was not recorded" };
  }
  return { surface: "foreign", certainty: "certain", because: "a shell call whose command the digest did not keep" };
}

/**
 * Apply the rule to one record.
 *
 * A record is filed when **any** failing call in it was against this product's
 * surface. Any rather than all: a session that hit an `ost-agent` failure and six
 * shell slips is a session that found something, and requiring unanimity would
 * make the rule's recall a function of how sloppy the shell typing was that day.
 */
export function applySurfaceRule(record: FrictionRecord): RecordDisposition {
  const events: AttributedEvent[] = record.events.map((e) => ({ ...e, ...attributeEvent(e) }));
  const productCertain = events.filter((e) => e.surface === "product" && e.certainty === "certain").length;
  const productPossible = events.filter((e) => e.surface === "product").length;

  const filed = productCertain > 0;
  const reason: CountedReason | undefined = filed
    ? undefined
    : events.length === 0
      ? "no failing call to attribute"
      : "no failing call against this product's own surface";

  return {
    record,
    events,
    productCertain,
    productPossible,
    failing: events.length,
    disposition: filed ? "filed" : "counted",
    dispositionUpperBound: productPossible > 0 ? "filed" : "counted",
    certainty: filed || productPossible === 0 ? "certain" : "possible",
    reason,
  };
}

function rank(counts: Map<string, number>): { key: string; n: number }[] {
  return [...counts.entries()]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
}

/** Run the rule over a corpus and tally what it demoted. */
export function surfaceRuleReading(records: readonly FrictionRecord[]): SurfaceRuleReading {
  const dispositions = records.map(applySurfaceRule);
  const counted = dispositions.filter((d) => d.disposition === "counted");

  const byTool = new Map<string, number>();
  const byKind = new Map<string, number>();
  let events = 0;
  for (const d of counted) {
    for (const e of d.events) {
      events++;
      const tool = e.tool || "(unnamed)";
      byTool.set(tool, (byTool.get(tool) ?? 0) + 1);
      byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    }
  }

  return {
    read: dispositions.length,
    dispositions,
    filed: dispositions.filter((d) => d.disposition === "filed").map((d) => d.record.id),
    counted: counted.map((d) => d.record.id),
    tally: {
      records: counted.length,
      events,
      byTool: rank(byTool).map(({ key, n }) => ({ tool: key, n })),
      byKind: rank(byKind).map(({ key, n }) => ({ kind: key, n })),
      ids: counted.map((d) => d.record.id),
    },
    nothingToJudge: dispositions.filter((d) => d.failing === 0).map((d) => d.record.id),
  };
}

function clause(name: string, got: number, of: number, bar: number): ReplayClause {
  return { name, got, of, bar, meets: of > 0 && got >= bar, scored: of > 0 };
}

/**
 * Score the rule against a judgement made before it existed.
 *
 * The judgement is supplied rather than derived. Deriving "carries a product
 * need" from the record would mean writing a second classifier and grading the
 * first one with it, which measures the agreement of two guesses and calls it a
 * finding.
 */
export function frictionSurfaceReplay(
  records: readonly FrictionRecord[],
  judgement: readonly JudgedRecord[],
): SurfaceRuleReplay {
  const reading = surfaceRuleReading(records);
  const judged = new Map(judgement.map((j) => [j.id, j]));
  const byId = new Map(reading.dispositions.map((d) => [d.record.id, d]));

  const needsKept: string[] = [];
  const needsDropped: string[] = [];
  const nonNeedsKept: string[] = [];
  let needs = 0;
  let nonNeeds = 0;
  let nonNeedsDropped = 0;
  let needsKeptUpper = 0;
  let nonNeedsDroppedUpper = 0;

  for (const j of judgement) {
    const d = byId.get(j.id);
    if (!d) continue;
    const filed = d.disposition === "filed";
    const filedUpper = d.dispositionUpperBound === "filed";
    if (j.need) {
      needs++;
      if (filed) needsKept.push(j.id);
      else needsDropped.push(j.id);
      if (filedUpper) needsKeptUpper++;
    } else {
      nonNeeds++;
      if (filed) nonNeedsKept.push(j.id);
      else nonNeedsDropped++;
      if (!filedUpper) nonNeedsDroppedUpper++;
    }
  }

  const keeps = clause("needs kept", needsKept.length, needs, FRICTION_SURFACE_RULE.keepsBar);
  const drops = clause("non-needs demoted", nonNeedsDropped, nonNeeds, FRICTION_SURFACE_RULE.dropsBar);
  const keepsUpperBound = clause("needs kept (generous)", needsKeptUpper, needs, FRICTION_SURFACE_RULE.keepsBar);
  const dropsUpperBound = clause("non-needs demoted (generous)", nonNeedsDroppedUpper, nonNeeds, FRICTION_SURFACE_RULE.dropsBar);

  return {
    reading,
    judged: judgement.length,
    unjudged: reading.dispositions.filter((d) => !judged.has(d.record.id)).map((d) => d.record.id),
    missing: judgement.filter((j) => !byId.has(j.id)).map((j) => j.id),
    needsKept,
    needsDropped,
    nonNeedsKept,
    keeps,
    drops,
    meetsBar: keeps.meets && drops.meets,
    keepsUpperBound,
    dropsUpperBound,
    boundDecides: keeps.meets !== keepsUpperBound.meets || drops.meets !== dropsUpperBound.meets,
    truncated: reading.dispositions.filter((d) => d.record.truncated).map((d) => d.record.id),
  };
}

// ── the report ───────────────────────────────────────────────────────────────

/** How many ids a line of the report names before it says how many more there are. */
export const MAX_IDS_SHOWN = 8;

function sample(ids: readonly string[]): string {
  if (ids.length <= MAX_IDS_SHOWN) return ids.join(", ");
  return `${ids.slice(0, MAX_IDS_SHOWN).join(", ")} … and ${ids.length - MAX_IDS_SHOWN} more`;
}

/**
 * The replay as an operator reads it: coverage, then the tally, then the two
 * clauses, then what the reading cannot settle.
 *
 * The refusal prints on a met bar too. A report ending on "BAR MET" would read as
 * the demotion having been shown safe, and the tally is precisely the material
 * nobody has read.
 */
export function formatFrictionSurfaceReplay(replay: SurfaceRuleReplay): string {
  const { reading } = replay;
  const lines: string[] = [];

  lines.push(`Read: ${reading.read} record(s) — ${reading.filed.length} filed, ${reading.counted.length} counted, 0 discarded.`);
  if (replay.truncated.length > 0) {
    lines.push(
      `Truncated: ${replay.truncated.length} digest(s) showed only their first events — a demotion there may be the ` +
        `harvester's cap rather than the record.`,
    );
  }
  if (replay.missing.length > 0) lines.push(`Judged but absent from the corpus: ${sample(replay.missing)}.`);
  // Only against a judgement that exists. Run over a whole vault with no
  // judgement at all, every record is "unjudged" and the line is five hundred
  // ids long — a report nobody reads is a report that hides the two lines under it.
  if (replay.judged > 0 && replay.unjudged.length > 0) {
    lines.push(`In the corpus and unjudged: ${sample(replay.unjudged)}.`);
  }

  lines.push(`Filed: ${reading.filed.length === 0 ? "(none)" : sample(reading.filed)}`);
  lines.push(
    `Counted, not discarded: ${reading.tally.records} record(s), ${reading.tally.events} event(s) — ` +
      reading.tally.byTool.map((t) => `${t.tool} ×${t.n}`).join(", "),
  );
  if (reading.nothingToJudge.length > 0) {
    lines.push(
      `  of those, ${reading.nothingToJudge.length} had no failing call at all — counted because there was nothing ` +
        `to keep, not because the rule demoted them.`,
    );
  }

  // A run with no judgement is a reading, and it stops here. Printing "0/0 — NOT
  // MET" would report a refuted rule to anyone who ran the command over a vault
  // without supplying the one input that can refute it.
  if (!replay.keeps.scored && !replay.drops.scored) {
    lines.push(
      `Not scored: no record was judged. The two clauses are stated over ` +
        `${FRICTION_SURFACE_RULE.needs} needs and ${FRICTION_SURFACE_RULE.nonNeeds} non-needs; supply a judgement ` +
        `to read them. What is above is what the rule would file, not whether it should have.`,
    );
    lines.push(`Not settled: ${FRICTION_SURFACE_RULE.refuses}.`);
    return lines.join("\n");
  }

  for (const c of [replay.keeps, replay.drops]) {
    lines.push(`${c.name}: ${c.got}/${c.of} — bar is ${c.bar}, ${c.meets ? "MET" : "NOT MET"}.`);
  }
  if (replay.needsDropped.length > 0) {
    lines.push(`  demoted despite carrying a need: ${sample(replay.needsDropped)}`);
  }
  if (replay.nonNeedsKept.length > 0) {
    lines.push(`  filed despite carrying none: ${sample(replay.nonNeedsKept)}`);
  }

  lines.push(
    `Generous bound (a mention of this product in the error text counts): needs kept ` +
      `${replay.keepsUpperBound.got}/${replay.keepsUpperBound.of}, non-needs demoted ` +
      `${replay.dropsUpperBound.got}/${replay.dropsUpperBound.of} — ` +
      (replay.boundDecides ? "and it CHANGES the verdict." : "the verdict is the same either way."),
  );

  lines.push(`Bar (both clauses): ${replay.meetsBar ? "MET" : "NOT MET"}.`);
  lines.push(`Not settled: ${FRICTION_SURFACE_RULE.refuses}.`);

  return lines.join("\n");
}
