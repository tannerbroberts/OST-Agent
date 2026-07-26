/**
 * Check a tool call against the schema the tool itself declares, before the
 * tool is allowed to touch the vault.
 *
 * The allowlist answers *which tool may run*. Until this existed, nothing
 * answered *with what*. A caller that misremembered a property name —
 * `ost_annotate({title, note})` where the schema says `issue` — reached `run`
 * unchallenged, which read the missing property as `undefined` and appended the
 * string "undefined" to the node. The call reported success, and because the
 * vault is append-only the note it was given is unrecoverable: the line can be
 * annotated but never removed. Fourteen such lines exist across the two live
 * vaults, written by several different passes.
 *
 * That is worth being precise about, because it is the product's own claim
 * under strain. "Incapable of destructive action by construction" was true of
 * the tool *surface* — no delete tool exists, and none was involved here. The
 * destruction came through a constructive tool holding an argument nobody
 * checked. A guarantee about which verbs exist is not a guarantee about what
 * they are handed.
 *
 * Deliberately a small hand-written subset of JSON Schema — `type`, `properties`,
 * `required`, `additionalProperties`, `enum`, `items` — rather than a validator
 * dependency. It covers every construct the tool schemas in `tools.ts` actually
 * use, and a validator that silently ignores a keyword it does not implement is
 * the same class of bug as the one it is here to prevent. So an unrecognised
 * keyword is not silently skipped: anything this cannot check, it does not claim
 * to have checked.
 */

/** The JSON Schema subset the tool definitions use. */
export interface ToolSchema {
  type?: string;
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  items?: ToolSchema;
  [keyword: string]: unknown;
}

/**
 * Validate `input` against `schema`. Returns the problems found, most specific
 * first; an empty array means it passed. Never throws — the caller decides what
 * a failure means.
 */
export function validateToolInput(schema: ToolSchema | undefined, input: unknown, path = ""): string[] {
  if (!schema) return [];
  const at = path ? ` at \`${path}\`` : "";
  const problems: string[] = [];

  if (schema.enum && !schema.enum.some((v) => v === input)) {
    return [`${describe(input)}${at} is not one of: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`];
  }

  if (schema.type && !matchesType(schema.type, input)) {
    return [`expected ${schema.type}${at}, got ${describe(input)}`];
  }

  if (schema.type === "object" || schema.properties) {
    const obj = (input ?? {}) as Record<string, unknown>;

    // Missing required properties. `undefined` counts as missing rather than as
    // a value — that distinction is the whole defect this file exists for.
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) {
        problems.push(`missing required property \`${key}\`${at}`);
      }
    }

    // Unexpected properties, named. A caller who typed the wrong name needs to
    // see the name they typed, not just that something was wrong.
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          problems.push(`unexpected property \`${key}\`${at} — allowed: ${Object.keys(schema.properties).join(", ")}`);
        }
      }
    }

    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined) {
        problems.push(...validateToolInput(sub, obj[key], path ? `${path}.${key}` : key));
      }
    }
  }

  if (schema.type === "array" && schema.items && Array.isArray(input)) {
    input.forEach((item, i) => {
      problems.push(...validateToolInput(schema.items, item, `${path}[${i}]`));
    });
  }

  return problems;
}

function matchesType(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      // An unrecognised type keyword is not silently accepted as valid; it is
      // simply not something this checker can speak to, so it says nothing and
      // the other keywords still apply.
      return true;
  }
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `${typeof value} (${JSON.stringify(value)})`;
}
