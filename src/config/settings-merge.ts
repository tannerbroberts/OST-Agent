/**
 * Merge the plugin-enabling keys into a project's `.claude/settings.json`
 * without disturbing anything already there.
 *
 * This is what makes "creating a vault writes the tool-enabling config into
 * the project beside it" (the fix for the four toolless passes `setup-check.ts`
 * diagnoses) safe to run automatically at `init` time. The file being merged
 * into is the operator's own — it may already enable other plugins, may carry
 * comments, and its formatting is never ours to decide — so this edits the two
 * keys `MINIMAL_SETTINGS` needs and nothing else, using `jsonc-parser`'s
 * `modify`/`applyEdits` so untouched text (including comments) survives
 * byte-for-byte rather than going through a parse/stringify round trip that
 * would silently drop them.
 *
 * `package.json`'s `bundle` script carries `--alias:jsonc-parser=jsonc-parser/lib/esm/main.js`
 * for this import specifically: esbuild otherwise resolves the package's `main`
 * (a UMD build with an internal `require("./impl/format")` esbuild cannot
 * inline), which throws `MODULE_NOT_FOUND` at runtime once bundled into a
 * single file — `test/release/bundle.test.ts` runs the committed bundle's
 * `init` for real and would catch a regression here.
 */
import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";
import { PLUGIN_KEY } from "./setup-check.js";

const MARKETPLACE_SOURCE = { source: "github", repo: "tannerbroberts/OST-Agent" };

const FORMATTING = { insertSpaces: true, tabSize: 2, eol: "\n" };

export interface MergeOutcome {
  ok: boolean;
  /** The merged text, when `ok`. Unset on failure — never a partial write. */
  content?: string;
  /** Why the merge refused to touch the file, when `!ok`. */
  reason?: string;
}

/**
 * `true` when `raw` parses (comments and trailing commas tolerated) as an
 * object — the only shape `modify` can safely edit. Anything else is a file
 * this routine must not touch, so the caller falls back to naming the fix
 * instead of attempting one, same as `diagnoseSetup`'s `settings-unparseable`.
 */
function isEditableObject(raw: string): boolean {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(raw, errors, { allowTrailingComma: true });
  return errors.length === 0 && typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
}

/**
 * Merge the enabling keys into `raw`, an existing `.claude/settings.json`'s
 * text. Refuses (rather than guesses) when `raw` is not a JSONC object, so a
 * caller never overwrites a file it could not safely parse.
 *
 * Idempotent and additive only: it upserts `extraKnownMarketplaces.ost-agent`
 * and `enabledPlugins["ost-agent@ost-agent"]`, and touches no other key. A
 * key that already holds a different value for one of those two paths is
 * still overwritten — the point of this routine is that both end up enabling
 * the plugin — but nothing else in the file is read as a value, only as text
 * to preserve.
 */
export function mergeEnablingConfig(raw: string): MergeOutcome {
  if (!isEditableObject(raw)) {
    return { ok: false, reason: "not a JSON object (comments and trailing commas are tolerated; other syntax errors are not)" };
  }

  let text = raw;
  text = applyEdits(
    text,
    modify(text, ["extraKnownMarketplaces", "ost-agent"], { source: MARKETPLACE_SOURCE }, { formattingOptions: FORMATTING }),
  );
  text = applyEdits(text, modify(text, ["enabledPlugins", PLUGIN_KEY], true, { formattingOptions: FORMATTING }));

  return { ok: true, content: text };
}
