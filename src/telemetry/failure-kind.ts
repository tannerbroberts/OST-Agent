/**
 * Shape or meaning: which half of the damage did schema validation actually take?
 *
 * `validateToolInput` shipped in v0.17.0 on the strength of one replayed call.
 * It checks the *shape* of a call — required properties present, none unexpected,
 * types as declared — and it is honest in its own header that it cannot check
 * *meaning*: a call with every field present and correctly typed, naming a node
 * that does not exist, still reaches `run`. Nobody had ever sized that gap. A
 * validator that reports few problems reads identically whether it is catching
 * everything or catching the easy tenth, so the shipped state made the question
 * more urgent rather than less.
 *
 * This module answers it by classifying the failures that actually happened.
 * Every failed call in a window of the vault's append-only usage trace is sorted
 * into:
 *
 * - **shape** — a schema keyword would have refused it before `run` was reached;
 * - **meaning** — schema-valid and semantically wrong (a nonexistent node, an
 *   empty-but-typed string, a well-formed title naming the wrong thing);
 * - **neither** — an environment, permission or filesystem failure no validator
 *   was ever aimed at;
 * - **unclassified** — a refusal this rule cannot read. Never silently folded
 *   into a bucket: see {@link FailureKindCensus.unreadable}.
 *
 * ## The trace stores no input, so the classifier reads the refusal
 *
 * `usage.ts` records input SIZE and never input CONTENT, deliberately, so that
 * nothing sensitive can leak into a file that travels in git. That policy is
 * right and it is also the binding constraint here: the obvious classifier —
 * replay each recorded input through `validateToolInput` and see whether it is
 * refused — cannot be written, because the inputs are gone. What survives is the
 * tool's own verdict, the `err` string, and the question becomes *which layer
 * produced this refusal*.
 *
 * That is weaker than replay and the weakness is named rather than papered over:
 * a refusal whose wording this rule does not recognise lands in `unclassified`
 * and is reported by message, so a rule that has stopped being able to read its
 * subject cannot come out looking like a corpus with nothing in it.
 *
 * ## What makes a refusal a shape error
 *
 * Four of the shape families are the wordings `validateToolInput` itself emits,
 * which is as direct as this gets. Two more exist because a refusal can restate
 * a schema constraint from inside `run`, after a surface that has no validator in
 * front of it let the call through — `ost_create_node` throws `"undefined" needs
 * an evidence class — one of: money, observed, …` for a call the schema's own
 * `required` and `enum` would both have stopped:
 *
 * - **absent-required interpolation** — the message quotes the literal string
 *   `undefined` as a value. That is a required property that arrived absent and
 *   got interpolated into a sentence, which is the *exact* incident the parent
 *   solution was built for.
 * - **enum recital** — the message spells out a declared `enum`'s members, in
 *   order. This one is read off the schemas the tools publish rather than from a
 *   list written here, so pass the live schemas
 *   (`buildOstTools(...).map(t => t.input_schema)`) and it fires off the real
 *   surface. Pass none and it cannot fire, which is stated rather than silently
 *   degraded: {@link FailureKindCensus.schemasRead}.
 *
 * ## Two things are counted separately because they inflate the denominator
 *
 * **Probes.** The assumption test asked for these by name: a day where the tool
 * surface is being poked with titles like `probe` and `x` is not the failure mode
 * this branch is about, and those calls must be reported separately rather than
 * either counted or quietly dropped. With no input content in the trace, SIZE is
 * the only signal left — a call too small to carry the thing the tool exists to
 * write. See {@link FAILURE_KIND_RULE.probeMaxArgBytes}.
 *
 * **Bursts.** Not asked for, and the corpus insists on it: 59 of the 62 failures
 * in the pre-committed window arrived inside 21 seconds, same tool, same refusal
 * family, each carrying an identical ~930-byte payload under a one-word title —
 * one unquoted shell argument splattering five intended annotations into 59
 * calls. Counting that as 59 independent failures is the same error as reading
 * one actor recorded 59 times as 59 voices, so {@link FailureKindCensus.readings}
 * publishes the per-incident denominator beside the per-call one instead of
 * picking.
 */
import type { UsageEvent } from "./usage.js";
import type { ToolSchema } from "../security/validateToolInput.js";

/** Which half of the damage a failure belongs to. */
export type FailureKind = "shape" | "meaning" | "neither" | "unclassified";

/** One recognisable family of refusal, and why it lands where it lands. */
export interface RefusalFamily {
  /** Stable id, used in reports and asserted against in the suite. */
  id: string;
  kind: Exclude<FailureKind, "unclassified">;
  /**
   * The JSON Schema keyword that would have caught it, for shape families.
   * Absent elsewhere — a meaning error has no keyword that reaches it, which is
   * the entire finding this census exists to size.
   */
  keyword?: "required" | "additionalProperties" | "type" | "enum";
  /** Where the wording comes from, so a reader can go and check it. */
  emittedBy: string;
  test: RegExp;
}

/**
 * Refusal families, tried in order. Shape first, so a call that a schema keyword
 * would have stopped is never credited to a later layer that also had something
 * to say about it.
 *
 * Typed rather than `as const`: a `keyword` a reader can only reach by narrowing
 * the union first is a field the report cannot print and a test cannot audit.
 */
const REFUSAL_FAMILIES: readonly RefusalFamily[] = [
  // ── what `validateToolInput` itself says ─────────────────────────────────
  {
    id: "missing-required",
    kind: "shape",
    keyword: "required",
    emittedBy: "src/security/validateToolInput.ts",
    test: /missing required property `/,
  },
  {
    id: "unexpected-property",
    kind: "shape",
    keyword: "additionalProperties",
    emittedBy: "src/security/validateToolInput.ts",
    test: /unexpected property `.+` — allowed: /,
  },
  {
    id: "wrong-type",
    kind: "shape",
    keyword: "type",
    emittedBy: "src/security/validateToolInput.ts",
    test: /expected (?:object|array|string|number|integer|boolean|null)\b[^,]*, got /,
  },
  {
    id: "not-in-enum",
    kind: "shape",
    keyword: "enum",
    emittedBy: "src/security/validateToolInput.ts",
    test: / is not one of: /,
  },
  // ── what a tool body says about a constraint the schema already held ─────
  {
    id: "absent-required",
    kind: "shape",
    keyword: "required",
    // A required property that arrived absent and got interpolated into a
    // sentence. `"undefined"` is never a value anybody passes; it is what a
    // missing one looks like once it has been printed — and printing it is the
    // exact incident the parent solution was built for.
    emittedBy: "any tool `run` reached with a required property missing",
    test: /["'`]undefined["'`]/,
  },
  // ── what the world says, after a schema-valid call got through ───────────
  {
    id: "no-such-node",
    kind: "meaning",
    emittedBy: "src/ost/vault.ts",
    test: /^no such node: /,
  },
  {
    id: "parent-missing",
    kind: "meaning",
    emittedBy: "src/security/tools.ts",
    test: /does not exist — create it before attaching under it/,
  },
  {
    id: "wrong-parentage",
    kind: "meaning",
    emittedBy: "src/security/tools.ts",
    test: /must attach under .+, but ".+" is a /,
  },
  {
    id: "empty-field",
    kind: "meaning",
    emittedBy: "src/security/tools.ts",
    test: /\bis empty\b|\bcannot be empty\b|\bmust not be empty\b/,
  },
  // ── what nothing in the call could have prevented ────────────────────────
  {
    id: "filesystem",
    kind: "neither",
    emittedBy: "node:fs",
    test: /\b(?:ENOENT|EACCES|EPERM|EEXIST|EISDIR|ENOTDIR|ENOSPC|EMFILE)\b/,
  },
  {
    id: "network",
    kind: "neither",
    emittedBy: "node:net",
    test: /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|\bfetch failed\b/,
  },
];

/**
 * The rule, fixed in source before the corpus was counted.
 *
 * One object rather than constants scattered through the reader, because
 * changing a value here changes the finding and a reader disagreeing with the
 * verdict should be able to name the line they disagree with.
 */
export const FAILURE_KIND_RULE = {
  /**
   * The pre-committed bar: shape errors at half or more of all failures and the
   * shipped validator stands as a substantially complete answer to its
   * opportunity. Below it, the majority of real damage is semantic and the
   * branch needs a sibling aimed at meaning rather than more schema work.
   */
  bar: 0.5,

  /** The window the assumption test named, inclusive, as ISO dates. */
  window: { from: "2026-07-25", to: "2026-07-27" },

  /**
   * A failed call at or under this many bytes of input is reported as a probe.
   *
   * The trace carries no input content, so size is the only probe signal that
   * exists. The floor is not tuned to the answer: in the pre-committed window the
   * smallest SUCCESSFUL writing call is 353 bytes (`ost_annotate`), and the
   * largest call this excludes is 32 bytes. Anything between 33 and 352 would
   * give the same partition, which is what makes 64 a floor rather than a fit.
   */
  probeMaxArgBytes: 64,

  /**
   * Consecutive failures of the same tool and the same refusal family, each
   * within this many milliseconds of the last, are one incident.
   *
   * Also not tuned: inside the window's one burst the calls are ~0.33 s apart and
   * the nearest failure outside it is 61 s away, so any gap from 1 s to 60 s
   * draws the same line.
   */
  burstGapMs: 5_000,

  /** See {@link REFUSAL_FAMILIES}. */
  families: REFUSAL_FAMILIES,
} as const;

/** One failure, with everything the census concluded about it. */
export interface ClassifiedFailure {
  event: UsageEvent;
  kind: FailureKind;
  /** The family that fired, or `null` when nothing did. */
  family: string | null;
  /** For a shape failure, the schema keyword that would have refused it. */
  keyword?: RefusalFamily["keyword"];
  /** True when the call was too small to carry what the tool writes. */
  probe: boolean;
  /** 0-based index of the burst this call belongs to; singletons get their own. */
  incident: number;
}

/** One way of counting the same failures, with what it says about the bar. */
export interface CensusReading {
  name: string;
  /** Why this denominator, in one line, so it can be argued with. */
  rule: string;
  shape: number;
  denominator: number;
  share: number | null;
  meetsBar: boolean;
}

export interface FailureKindCensus {
  /** Every call in the window, failed or not — the denominator's denominator. */
  callsRead: number;
  /** Failed calls in the window. The corpus. */
  failures: number;
  /** How many tool schemas the classifier was given; 0 disables two shape families. */
  schemasRead: number;
  cells: Record<FailureKind, number>;
  /** Failures reported separately as probes, by the rule's size floor. */
  probes: ClassifiedFailure[];
  /** Distinct refusal messages no family could read. MUST be empty to trust the rest. */
  unreadable: string[];
  /** Bursts: the count of incidents the failures collapse to. */
  incidents: number;
  /** The headline: the rule's own reading, probes reported separately. */
  shape: number;
  denominator: number;
  share: number | null;
  bar: number;
  meetsBar: boolean;
  /** Every defensible denominator, including the one most generous to the solution. */
  readings: CensusReading[];
  /**
   * True when the readings disagree about the bar. The verdict is then a
   * property of the rule rather than of the failures, and the report says so
   * instead of standing on its own number.
   */
  ruleDecides: boolean;
  classified: ClassifiedFailure[];
}

/** Parse a usage trace. Malformed lines are skipped — a trace is append-only, not atomic. */
export function readUsageEvents(text: string): UsageEvent[] {
  const events: UsageEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      // a torn final line is a lost event, never a failed read
    }
  }
  return events;
}

/** Every call whose date falls inside the window, inclusive at both ends. */
export function eventsInWindow(events: readonly UsageEvent[], window = FAILURE_KIND_RULE.window): UsageEvent[] {
  return events.filter((e) => {
    const day = (e.ts ?? "").slice(0, 10);
    return day >= window.from && day <= window.to;
  });
}

/**
 * The one shape family that cannot be recognised from wording alone: a refusal
 * that spells out a declared `enum`'s members, in order.
 *
 * Only a refusal about that property can do that, and the members come from the
 * schema the tool published rather than from a list written here — so a tool
 * that adds a rung, or a new tool with an enum nobody has seen, is covered
 * without this file being edited. Given no schemas it cannot fire, which is
 * reported as {@link FailureKindCensus.schemasRead} rather than degraded past.
 */
function recitesADeclaredEnum(message: string, schemas: readonly ToolSchema[]): boolean {
  for (const schema of schemas) {
    for (const property of Object.values(schema.properties ?? {})) {
      const values = property?.enum;
      if (!Array.isArray(values) || values.length === 0) continue;
      if (message.includes(values.join(", "))) return true;
    }
  }
  return false;
}

/** Classify one failed call. Never guesses: an unreadable refusal says so. */
export function classifyFailure(event: UsageEvent, schemas: readonly ToolSchema[] = []): Omit<ClassifiedFailure, "incident"> {
  const message = event.err ?? "";
  const probe = event.argBytes <= FAILURE_KIND_RULE.probeMaxArgBytes;

  // A refusal for want of a grant is the surface declining, not the tool failing
  // on its own terms, and `usage.ts` sets this from the thrown error's TYPE
  // rather than from wording — the one signal here that cannot drift.
  if (event.denied) return { event, kind: "neither", family: "permission-denied", probe };

  for (const family of FAILURE_KIND_RULE.families) {
    if (!family.test.test(message)) continue;
    return { event, kind: family.kind, family: family.id, keyword: family.keyword, probe };
  }

  if (recitesADeclaredEnum(message, schemas)) return { event, kind: "shape", family: "enum-recital", keyword: "enum", probe };

  return { event, kind: "unclassified", family: null, probe };
}

/**
 * Group failures into incidents: a run of same-tool, same-family failures with
 * no gap longer than {@link FAILURE_KIND_RULE.burstGapMs} is one thing that went
 * wrong, however many calls it cost.
 */
function assignIncidents(failures: Omit<ClassifiedFailure, "incident">[]): ClassifiedFailure[] {
  let incident = -1;
  let previous: { tool: string; family: string | null; at: number } | null = null;
  return failures.map((failure) => {
    const at = Date.parse(failure.event.ts);
    const continues =
      previous !== null &&
      previous.tool === failure.event.tool &&
      previous.family === failure.family &&
      at - previous.at <= FAILURE_KIND_RULE.burstGapMs;
    if (!continues) incident += 1;
    previous = { tool: failure.event.tool, family: failure.family, at };
    return { ...failure, incident };
  });
}

function reading(name: string, rule: string, shape: number, denominator: number): CensusReading {
  const share = denominator === 0 ? null : shape / denominator;
  return { name, rule, shape, denominator, share, meetsBar: share !== null && share >= FAILURE_KIND_RULE.bar };
}

/**
 * Count the window.
 *
 * `events` is the whole trace or any superset of the window; the window filter is
 * applied here so `callsRead` is a fact about the corpus rather than about what
 * the caller happened to pass in.
 */
export function failureKindCensus(
  events: readonly UsageEvent[],
  schemas: readonly ToolSchema[] = [],
  window = FAILURE_KIND_RULE.window,
): FailureKindCensus {
  const inWindow = eventsInWindow(events, window).sort((a, b) => a.ts.localeCompare(b.ts));
  const classified = assignIncidents(inWindow.filter((e) => e.ok === false).map((e) => classifyFailure(e, schemas)));

  const cells: Record<FailureKind, number> = { shape: 0, meaning: 0, neither: 0, unclassified: 0 };
  for (const failure of classified) cells[failure.kind] += 1;

  const probes = classified.filter((f) => f.probe);
  const counted = classified.filter((f) => !f.probe);
  const unreadable = [...new Set(classified.filter((f) => f.kind === "unclassified").map((f) => f.event.err ?? ""))];

  const shapeOf = (set: readonly ClassifiedFailure[]) => set.filter((f) => f.kind === "shape").length;
  const collapse = (set: readonly ClassifiedFailure[]) => {
    const first = new Map<number, ClassifiedFailure>();
    for (const failure of set) if (!first.has(failure.incident)) first.set(failure.incident, failure);
    return [...first.values()];
  };

  const readings = [
    reading(
      "probes reported separately",
      "every failed call except the ones too small to carry what the tool writes — the reading the assumption test asked for",
      shapeOf(counted),
      counted.length,
    ),
    reading("every failed call", "the raw trace, probes and all", shapeOf(classified), classified.length),
    reading(
      "one incident per burst, probes counted",
      "the reading most generous to the shipped validator: a run of identical failures counts once, and the probes stay in",
      shapeOf(collapse(classified)),
      collapse(classified).length,
    ),
  ];
  const headline = readings[0];

  return {
    callsRead: inWindow.length,
    failures: classified.length,
    schemasRead: schemas.length,
    cells,
    probes,
    unreadable,
    incidents: collapse(classified).length,
    shape: headline.shape,
    denominator: headline.denominator,
    share: headline.share,
    bar: FAILURE_KIND_RULE.bar,
    meetsBar: headline.meetsBar,
    readings,
    ruleDecides: new Set(readings.map((r) => r.meetsBar)).size > 1,
    classified,
  };
}

function pct(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

/** The census as a person reads it. The verdict it does not take: see the last line. */
export function formatFailureKindCensus(census: FailureKindCensus): string {
  const lines: string[] = [];
  lines.push(
    `Failure kinds: ${census.shape} of ${census.denominator} non-probe failure(s) (${pct(census.share)}) were shape ` +
      `errors; the bar is ${pct(census.bar)} and it is ${census.meetsBar ? "MET" : "MISSED"}.`,
  );
  lines.push(
    `  Corpus: ${census.failures} failure(s) in ${census.callsRead} call(s), ${census.incidents} incident(s) once ` +
      `bursts are collapsed; ${census.schemasRead} tool schema(s) read.`,
  );
  lines.push(
    `  Kinds: shape ${census.cells.shape}, meaning ${census.cells.meaning}, neither ${census.cells.neither}, ` +
      `unclassified ${census.cells.unclassified}.`,
  );
  lines.push(
    `  Probes (reported, not counted): ${census.probes.length} — ` +
      (census.probes.length === 0 ? "none" : census.probes.map((p) => `${p.event.tool}/${p.kind} @${p.event.argBytes}B`).join(", ")),
  );
  if (census.unreadable.length > 0) {
    lines.push(`  UNREADABLE: ${census.unreadable.length} refusal wording(s) no family recognises — the count below is a floor, not a census.`);
    for (const message of census.unreadable) lines.push(`    ${message.slice(0, 120)}`);
  }
  lines.push("");
  lines.push("  Denominators:");
  for (const r of census.readings) {
    lines.push(`    ${r.shape}/${r.denominator} (${pct(r.share)}) ${r.meetsBar ? "meets" : "MISSES"} the bar — ${r.name}`);
    lines.push(`        ${r.rule}`);
  }
  lines.push(
    census.ruleDecides
      ? `  Rule: THE RULE DECIDES THIS. The denominators above disagree about the ${pct(census.bar)} bar, so the verdict is ` +
          `as much a property of how the failures were counted as of the failures.`
      : `  Rule: every denominator agrees about the ${pct(census.bar)} bar, so the verdict does not turn on which one a reader prefers.`,
  );
  lines.push("  The verdict is a human's: this counts, it does not promote.");
  return lines.join("\n");
}
