/**
 * The setup check: can a session opened on this project actually launch the
 * vault's tools?
 *
 * The gap this diagnoses is invisible from both sides. The plugin declares its
 * MCP server correctly (`.claude-plugin/plugin.json`), and a vault can be
 * perfectly formed — and a session opened on the project still gets no `ost_*`
 * tools, because the thing that launches the server is one line in the
 * *project's* `.claude/settings.json`, a file the vault does not carry and the
 * plugin cannot see. Four scheduled passes in a row ran toolless before a
 * human found the difference by comparing against a sibling example vault.
 * The comparison is mechanical and takes under a second; this module is that
 * comparison, with the answer phrased as the file to create and the exact
 * line to add — it tells the operator what to do rather than editing their
 * configuration for them.
 */
import fs from "node:fs";
import path from "node:path";
import { VAULT_DECLARATION_FILENAME, usableVaultDeclaration } from "./vault-declaration.js";

/** The key Claude Code looks up: `<plugin>@<marketplace>`, both `ost-agent`. */
export const PLUGIN_KEY = "ost-agent@ost-agent";

/** The exact line an enabling file needs, verbatim, ready to paste. */
export const ENABLING_LINE = `"${PLUGIN_KEY}": true`;

/**
 * The smallest file that closes the gap, for the case where none exists. Kept
 * in lock-step with `examples/vault/.claude/settings.json` — the sibling whose
 * presence was the only visible difference in the observed failure — by the
 * control case in `test/config/setup-check-diagnosis.test.ts`.
 */
export const MINIMAL_SETTINGS = `{
  "extraKnownMarketplaces": {
    "ost-agent": {
      "source": { "source": "github", "repo": "tannerbroberts/OST-Agent" }
    }
  },
  "enabledPlugins": {
    ${ENABLING_LINE}
  }
}
`;

/** The one way it can be right has four ways of being wrong. */
export type SetupGap =
  /** No `.claude/settings.json` in the project (the observed root cause). */
  | "settings-file-missing"
  /** The file exists but is not JSON, so nothing in it can enable anything. */
  | "settings-unparseable"
  /** The file parses but carries no `"ost-agent@ost-agent"` under `enabledPlugins`. */
  | "enabling-line-missing"
  /** The key is present and explicitly `false` — someone turned it off. */
  | "plugin-disabled";

export interface SetupDiagnosis {
  ok: boolean;
  /**
   * The file the finding is about, absolute. When something is wrong this is
   * always the project's `.claude/settings.json` — the canonical place the fix
   * belongs, whether or not the file exists yet.
   */
  file: string;
  gap: SetupGap | null;
  /** The exact line to add, verbatim. */
  line: string;
  /** Where that line belongs, in words the operator can follow. */
  where: string;
  /** Which file satisfied the check, when one did. */
  enabledBy?: string;
}

/** `true` only for a file that exists, parses, and enables the plugin. */
function enables(file: string): boolean {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as { enabledPlugins?: Record<string, unknown> };
    return parsed?.enabledPlugins?.[PLUGIN_KEY] === true;
  } catch {
    return false;
  }
}

/**
 * Inspect a project directory and name the specific gap, if there is one.
 *
 * `extraSettingsFiles` is for the other places Claude Code reads
 * `enabledPlugins` from — the project's `settings.local.json` is always
 * consulted, and the CLI passes the user-level `~/.claude/settings.json`. A
 * session enabled at any of those levels has its tools, and accusing a
 * correctly configured project is the one failure this check must never
 * produce: a false alarm here costs exactly the trust that would make someone
 * run it again.
 */
export function diagnoseSetup(
  projectDir: string,
  opts: { extraSettingsFiles?: string[] } = {},
): SetupDiagnosis {
  const canonical = path.join(projectDir, ".claude", "settings.json");
  const candidates = [
    canonical,
    path.join(projectDir, ".claude", "settings.local.json"),
    ...(opts.extraSettingsFiles ?? []),
  ];

  const where = `inside the "enabledPlugins" object in ${canonical}`;
  const base = { file: canonical, line: ENABLING_LINE, where };

  const enabledBy = candidates.find(enables);
  if (enabledBy) return { ...base, ok: true, gap: null, enabledBy };

  // A directory that carries its own `.mcp.json` launches the server directly,
  // with no plugin and no `enabledPlugins` line anywhere. That path is the whole
  // point of the vault carrying its tools, and a check that still reported
  // "MISSING FILE" for it would be the false alarm this function must never
  // produce — telling an operator to add a line that would enable a *second*
  // copy of a server they already have.
  // Usable, not merely present: a declaration naming an artefact that is not on
  // disk produces exactly the silence this check exists to break, so calling it
  // OK would be the false alarm's mirror image and just as expensive.
  const declared = usableVaultDeclaration(projectDir);
  if (declared.ok) return { ...base, ok: true, gap: null, enabledBy: declared.file };

  // Nothing enables the plugin. Say which of the four ways the canonical file
  // is failing to, so the report is a fix rather than a verdict.
  if (!fs.existsSync(canonical)) return { ...base, ok: false, gap: "settings-file-missing" };

  let parsed: { enabledPlugins?: Record<string, unknown> };
  try {
    parsed = JSON.parse(fs.readFileSync(canonical, "utf8"));
  } catch {
    return { ...base, ok: false, gap: "settings-unparseable" };
  }
  if (parsed?.enabledPlugins?.[PLUGIN_KEY] === false)
    return { ...base, ok: false, gap: "plugin-disabled" };
  return { ...base, ok: false, gap: "enabling-line-missing" };
}

/**
 * The diagnosis as the operator reads it. Every failing shape names the file
 * and the exact line, because "your plugin isn't enabled" is the message the
 * failing path already delivers — silently — and it cost four passes.
 */
export function formatSetupDiagnosis(d: SetupDiagnosis): string {
  if (d.ok) {
    // Two ways to be right, and they are not the same fact: the plugin route is
    // a setting in a project that may or may not be the vault, the declaration
    // route is the vault carrying its own server. Saying which one answered is
    // the difference between "these tools follow this directory" and "these
    // tools follow this vault wherever it goes".
    if (d.enabledBy?.endsWith(VAULT_DECLARATION_FILENAME)) {
      return [
        `OK — ${d.enabledBy} declares the ost-agent server itself.`,
        "This directory carries its own tools: no plugin, no enabledPlugins line, and",
        "nothing to re-do if it is moved or copied somewhere else.",
      ].join("\n");
    }
    return [
      `OK — ${d.enabledBy} enables ${PLUGIN_KEY}.`,
      "A session opened on this project launches the vault's tools.",
    ].join("\n");
  }
  switch (d.gap) {
    case "settings-file-missing":
      return [
        `MISSING FILE: ${d.file} does not exist, so no session opened on this project`,
        `launches the ost-agent MCP server — the vault is present but its tools are not.`,
        `Create it with:`,
        "",
        MINIMAL_SETTINGS.trimEnd(),
      ].join("\n");
    case "settings-unparseable":
      return [
        `BROKEN FILE: ${d.file} exists but is not valid JSON, so nothing in it can`,
        `enable the plugin. Fix the syntax, then make sure it carries ${d.line}`,
        `${d.where.replace(` in ${d.file}`, "")}.`,
      ].join("\n");
    case "plugin-disabled":
      return [
        `DISABLED: ${d.file} sets "${PLUGIN_KEY}" to false, so the ost-agent MCP`,
        `server never launches. If that is not deliberate, change the line to ${d.line}.`,
      ].join("\n");
    default:
      return [
        `MISSING LINE: ${d.file} exists but does not enable the plugin, so the`,
        `ost-agent MCP server never launches. Add ${d.line} ${d.where.replace(` in ${d.file}`, "")}.`,
      ].join("\n");
  }
}
