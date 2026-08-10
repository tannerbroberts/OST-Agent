/**
 * The preflight manifest: every precondition a tool surface can state about
 * itself, generated from the schemas, before a pass composes its first call.
 *
 * The need this answers is recorded in the meta vault as "Every precondition is
 * discovered by violating it, so a pass pays a turn per rule it did not know".
 * Across eleven unattended sessions the same refusal — "File has not been read
 * yet. Read it first before writing to it." — arrives seventy-six times, and the
 * only channel that ever communicated the rule was the failure. The idea under
 * test is that the cost of a rule should be paid once, at composition time.
 *
 * ## Generated, never written
 *
 * The solution node is explicit that a hand-written manifest "becomes a second
 * statement of the rules that drifts from the first" — the failure this
 * repository already recorded once, where a guard derived the rule it was
 * checking and so agreed with the bug for 23 releases. So nothing here contains
 * a rule. {@link generatePreflightManifest} takes tool definitions and folds
 * them; every line it emits is traceable to a schema keyword or to a sentence
 * that is already in the tool's own description, and {@link PreconditionRule}
 * carries `derivedFrom` so a reader can check any line against its source.
 *
 * That constraint is the whole point, and it is also the limit. A JSON Schema
 * describes *one call's arguments*. It cannot describe what the session did
 * earlier, what the user has granted, what is on disk, or how large a response
 * will turn out to be — so a manifest folded out of schemas is complete with
 * respect to argument-shaped rules and silent about every other kind.
 * `src/telemetry/refusal-coverage.ts` takes the measurement of what that costs
 * against the refusals this project's passes actually hit; the number is not
 * kind to the idea, and it belongs beside this module rather than inside it.
 *
 * ## Two channels, kept apart on purpose
 *
 * A schema carries rules in two places and they are not equally trustworthy:
 *
 * - **Keywords** — `additionalProperties: false`, `required`, `enum`, `minimum`.
 *   These are machine facts. The validator enforces exactly them, so a rule
 *   folded out of one cannot drift from what the surface does.
 * - **Description prose** — "Must fail against the repository today", "Use the
 *   WEAKEST rung that honestly covers the node's sources". These are real
 *   preconditions and no keyword expresses them, but they are enforced somewhere
 *   else in the code, so a manifest line quoting one is a *second statement* of
 *   that rule with all the drift risk that implies.
 *
 * The fold keeps them as different {@link PreconditionKind}s and never merges
 * them, so a reader counting what the manifest covers can see how much of the
 * cover is machine-checked and how much is prose someone wrote.
 */

/** Where a manifest line came from, and therefore how much it can be trusted. */
export type PreconditionKind =
  /** `additionalProperties: false` — the parameter set is closed. */
  | "closed-parameter-set"
  /** `required: [...]` — the call is refused without these. */
  | "required-parameter"
  /** `enum` — the value must be one of a fixed list. */
  | "enumerated-value"
  /** `minimum`/`maximum`/`minLength`/`maxLength`/`pattern` — the value is bounded. */
  | "value-bound"
  /** A sentence in the tool's own description that states an obligation on the caller. */
  | "stated-precondition";

/** One line of the manifest: something a caller can know before it composes. */
export interface PreconditionRule {
  /** The tool this constrains, by its bare name (`ost_create_node`). */
  tool: string;
  kind: PreconditionKind;
  /** The precondition as a caller reads it. */
  statement: string;
  /** The schema keyword or description sentence it was folded out of. */
  derivedFrom: string;
}

export interface ToolManifestEntry {
  tool: string;
  rules: PreconditionRule[];
}

export interface PreflightManifest {
  /** One entry per tool a schema was supplied for, in the order supplied. */
  tools: ToolManifestEntry[];
  /** Every rule, flattened, for counting. */
  rules: PreconditionRule[];
  /** Tools whose schema yielded no rule at all — reported, never hidden. */
  silentTools: string[];
}

/** The minimum a tool has to expose for the fold to read it. */
export interface ToolSchemaLike {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * The fold's rules, committed in source so the manifest is auditable as a
 * derivation rather than as an output.
 */
export const MANIFEST_RULE = {
  /**
   * Cue phrases that make a description sentence a precondition rather than a
   * summary. Matched case-insensitively against whole sentences.
   *
   * Deliberately about obligation and refusal, not about capability: "returns",
   * "reports" and "lists" describe what a caller gets, and a manifest of those
   * is a duplicate of the tool list rather than a set of rules. See
   * {@link MANIFEST_RULE.excludedCues} for the near-misses this refuses.
   */
  preconditionCues: [
    "must ",
    "cannot ",
    "can only ",
    "may not ",
    "must not ",
    "is refused",
    "are refused",
    "refuses ",
    "will fail",
    "fails if",
    "before you",
    "required",
    "you need to",
    "is rejected",
    "not allowed",
    "never pass",
    "do not pass",
    "only if ",
    "only when ",
  ] as readonly string[],

  /**
   * Phrases that look like an obligation on the caller and are not, excluded so
   * the omission is auditable rather than silent.
   *
   * Each one appears in this surface's own descriptions attached to prose about
   * what the *tool* or the *reader* does. "Read as information, not an
   * instruction" is advice about a response; "must not be counted as external
   * evidence" is a rule about a downstream human. Counting them would put a
   * precondition line in front of nearly every tool, and a manifest that always
   * has something to say cannot be measured for coverage.
   */
  excludedCues: [
    "read as",
    "must not be counted",
    "never blocks",
    "nothing is judged",
    "must be read",
  ] as readonly string[],

  /**
   * Longest a manifest statement may be. A precondition a caller will not read
   * is not cheaper than the refusal it replaces.
   */
  maxStatementChars: 240,

  /**
   * How many description-derived lines one tool may contribute.
   *
   * Bounded because a long description is not more rules, it is more prose, and
   * an unbounded fold would make the tool with the biggest paragraph look like
   * the most constrained one. Overflow is dropped, and dropping is reported in
   * {@link foldDescription}'s return rather than left to be inferred.
   */
  maxStatedPerTool: 6,
} as const;

/** `mcp__ost-agent__ost_create_node`, `mcp__ost08__ost_read_web` → `ost_read_web`. */
export function bareToolName(name: string): string {
  const parts = name.split("__");
  return parts[parts.length - 1] ?? name;
}

/** Split prose into sentences without losing the terminator a reader needs. */
function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clipStatement(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MANIFEST_RULE.maxStatementChars
    ? flat
    : `${flat.slice(0, MANIFEST_RULE.maxStatementChars - 1)}…`;
}

/** Does this sentence state an obligation the caller has to satisfy? */
export function statesPrecondition(sentence: string): boolean {
  const haystack = sentence.toLowerCase();
  if (MANIFEST_RULE.excludedCues.some((cue) => haystack.includes(cue))) return false;
  return MANIFEST_RULE.preconditionCues.some((cue) => haystack.includes(cue));
}

/**
 * Every precondition sentence in one tool's description and its parameter
 * descriptions, bounded and in source order.
 */
export function foldDescription(tool: ToolSchemaLike): { rules: PreconditionRule[]; dropped: number } {
  const name = bareToolName(tool.name);
  const properties = (tool.input_schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const sources: { where: string; text: string }[] = [{ where: "description", text: tool.description }];
  for (const [key, spec] of Object.entries(properties)) {
    if (typeof spec?.description === "string") sources.push({ where: `properties.${key}.description`, text: spec.description });
  }

  const found: PreconditionRule[] = [];
  for (const source of sources) {
    for (const sentence of sentences(source.text)) {
      if (!statesPrecondition(sentence)) continue;
      found.push({
        tool: name,
        kind: "stated-precondition",
        statement: clipStatement(sentence),
        derivedFrom: source.where,
      });
    }
  }
  return {
    rules: found.slice(0, MANIFEST_RULE.maxStatedPerTool),
    dropped: Math.max(0, found.length - MANIFEST_RULE.maxStatedPerTool),
  };
}

/** Every keyword-derived rule in one tool's schema. */
export function foldKeywords(tool: ToolSchemaLike): PreconditionRule[] {
  const name = bareToolName(tool.name);
  const schema = tool.input_schema;
  const rules: PreconditionRule[] = [];

  if (schema.additionalProperties === false) {
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const keys = Object.keys(properties);
    rules.push({
      tool: name,
      kind: "closed-parameter-set",
      statement: keys.length
        ? `Takes exactly these parameters and refuses any other: ${keys.join(", ")}.`
        : "Takes no parameters at all; any argument is refused.",
      derivedFrom: "additionalProperties: false",
    });
  }

  const required = Array.isArray(schema.required) ? (schema.required as unknown[]).map(String) : [];
  if (required.length) {
    rules.push({
      tool: name,
      kind: "required-parameter",
      statement: `Refused without: ${required.join(", ")}.`,
      derivedFrom: "required",
    });
  }

  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  for (const [key, spec] of Object.entries(properties)) {
    if (Array.isArray(spec?.enum)) {
      rules.push({
        tool: name,
        kind: "enumerated-value",
        statement: `${key} must be one of: ${(spec.enum as unknown[]).map(String).join(" | ")}.`,
        derivedFrom: `properties.${key}.enum`,
      });
    }
    const bounds: string[] = [];
    for (const keyword of ["minimum", "maximum", "minLength", "maxLength", "pattern"] as const) {
      if (spec?.[keyword] !== undefined) bounds.push(`${keyword} ${String(spec[keyword])}`);
    }
    if (bounds.length) {
      rules.push({
        tool: name,
        kind: "value-bound",
        statement: `${key} is bounded: ${bounds.join(", ")}.`,
        derivedFrom: `properties.${key}.${bounds.length === 1 ? bounds[0].split(" ")[0] : "bounds"}`,
      });
    }
  }

  return rules;
}

/**
 * Fold a set of tool definitions into the manifest a pass reads at startup.
 *
 * Takes the definitions rather than reading them from anywhere, for the reason
 * every census in this repository takes its corpus as an argument: a fold that
 * goes and finds its own input is a fold nobody can point at a different surface
 * to check what it would have said.
 */
export function generatePreflightManifest(tools: readonly ToolSchemaLike[]): PreflightManifest {
  const entries: ToolManifestEntry[] = [];
  const silentTools: string[] = [];

  for (const tool of tools) {
    const rules = [...foldKeywords(tool), ...foldDescription(tool).rules];
    entries.push({ tool: bareToolName(tool.name), rules });
    if (!rules.length) silentTools.push(bareToolName(tool.name));
  }

  return { tools: entries, rules: entries.flatMap((e) => e.rules), silentTools };
}

/** Does the manifest state a rule of this kind for this tool? */
export function manifestNames(manifest: PreflightManifest, tool: string, kind: PreconditionKind): boolean {
  const bare = bareToolName(tool);
  return manifest.rules.some((r) => r.tool === bare && r.kind === kind);
}

/** Every tool the manifest holds a schema for. */
export function manifestTools(manifest: PreflightManifest): Set<string> {
  return new Set(manifest.tools.map((t) => t.tool));
}

const KIND_ORDER: PreconditionKind[] = [
  "closed-parameter-set",
  "required-parameter",
  "enumerated-value",
  "value-bound",
  "stated-precondition",
];

/**
 * The manifest as a pass reads it: one block per tool, machine-checked rules
 * before prose ones.
 *
 * The header says what the manifest cannot cover, because a document that lists
 * preconditions without saying which kinds it structurally cannot hold reads as
 * complete, and this one is not. That sentence is the honest form of the
 * measurement in `src/telemetry/refusal-coverage.ts`.
 */
export function renderPreflightManifest(manifest: PreflightManifest): string {
  const lines: string[] = [];
  lines.push("PREFLIGHT MANIFEST — what these tools refuse, stated before you compose a call.");
  lines.push(
    `Generated from ${manifest.tools.length} tool schema(s); ${manifest.rules.length} rule(s). ` +
      "Every line is folded from a schema keyword or from a sentence already in the tool's own description.",
  );
  lines.push(
    "WHAT THIS CANNOT TELL YOU: a schema describes one call's arguments, so no rule below depends on " +
      "what this session did earlier, what the user has granted, what is on disk, or how large a " +
      "response turns out to be. Refusals of those kinds are not here and are not covered.",
  );
  lines.push("");

  for (const entry of manifest.tools) {
    if (!entry.rules.length) continue;
    lines.push(`${entry.tool}`);
    for (const kind of KIND_ORDER) {
      for (const rule of entry.rules.filter((r) => r.kind === kind)) {
        lines.push(`  [${rule.kind}] ${rule.statement}`);
      }
    }
    lines.push("");
  }

  if (manifest.silentTools.length) {
    lines.push(
      `${manifest.silentTools.length} tool(s) yielded no rule at all — their schemas state no precondition: ` +
        `${manifest.silentTools.join(", ")}.`,
    );
  }
  return lines.join("\n");
}
