/**
 * Derive a session's permission allowlist from the skill's own `allowed-tools`,
 * so the two lists cannot drift — and refuse, loudly, every time deriving it
 * would mean compute widening its own grant.
 *
 * **The disease.** There are two lists. The skill's `allowed-tools` frontmatter
 * is written when the capability is added; the run's permission allowlist is
 * written when the automation is wired. A tool added to the skill in March does
 * not appear in a grant written in January and nobody is told, because under
 * `claude -p --permission-mode acceptEdits` a call outside the grant is
 * **denied, not prompted** — the pass runs, does less, and exits 0 (see
 * `scripts/mcp-prefix.ts` for the five firings that shape cost). Generating the
 * second list from the first removes the copy that drifts.
 *
 * **Why most of this file is refusals.** A generator that rewrites a human's
 * settings file is, in miniature, the act the ruleset forbids everywhere else:
 * compute granting itself a permit. So the write is the narrow path and the
 * refusals are the feature. Three of them are specified by
 * `test/security/allowlist-generator-guard.test.ts` and each must exit non-zero
 * having written zero bytes to the target:
 *
 *   1. Invoked from an agent session rather than a human install.
 *   2. Re-run in place after `allowed-tools` grew — it may not silently add the
 *      appended tool.
 *   3. Pointed at a grant a human narrowed by hand — a narrower grant is a
 *      choice, not drift to be repaired.
 *
 * **Cases 2 and 3 are the same state on disk, and that is the point.** "A tool
 * was appended to the skill after install" and "a human deliberately withheld a
 * tool" both leave exactly `declared ⊃ granted`; nothing in either file
 * distinguishes them. The generator therefore does not try to, and refuses to
 * widen in both — which is what makes it a generator rather than a bulldozer.
 * Only a human at install time, saying `--confirm-install`, resolves the
 * ambiguity, because only they know which of the two happened.
 *
 * Everything here is a pure decision over strings ({@link decideAllowlist}) with
 * one IO shell ({@link runAllowlistGenerator}) that holds the only write in the
 * module, unreachable except on the one verdict that authorizes it.
 */
import fs from "node:fs";

/**
 * Environment variables whose presence means a coding-agent session is driving
 * this process rather than a person at an install prompt.
 *
 * Fail-closed and deliberately over-broad: every one of these is set by Claude
 * Code in every session shape observed on this machine (`CLAUDECODE=1`,
 * `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, `AI_AGENT`), and
 * `CLAUDE_PLUGIN_ROOT` is set for anything the plugin launches. A human's own
 * shell carries none of them, so a false refusal costs a person nothing;
 * a false *permit* costs the guarantee the whole project sells.
 *
 * This is a signal, never a proof — an agent that scrubs its environment gets
 * past it. Scrubbing is a deliberate act rather than the drift this closes, and
 * the second lock ({@link decideAllowlist}'s widening refusal) does not depend
 * on the environment at all.
 */
export const AGENT_SESSION_MARKERS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_PLUGIN_ROOT",
  "AI_AGENT",
] as const;

/** The first session marker present, or `null` for an environment that looks human. */
export function agentSessionMarker(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string | null {
  for (const name of AGENT_SESSION_MARKERS) {
    const value = env[name];
    if (value !== undefined && value !== "") return name;
  }
  return null;
}

/**
 * The tools a skill (or command) file declares, read out of its YAML
 * frontmatter's `allowed-tools` key.
 *
 * Same shape the existing guards parse (`test/skill/surface-parity.test.ts`,
 * `test/release/command-allowlists.test.ts`): one line, comma-separated. Order
 * is preserved — the generated grant reads in the order the skill declares, so a
 * diff of the settings file lines up with a diff of the skill.
 */
export function declaredTools(skillMarkdown: string): string[] | null {
  const line = skillMarkdown.match(/^allowed-tools:\s*(.+)$/m);
  if (!line) return null;
  const tools = line[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return tools.length > 0 ? tools : null;
}

/** A settings file's `permissions.allow` list, or `[]` when it grants nothing. */
export function grantedTools(settings: SettingsFile): string[] {
  const allow = settings.permissions?.allow;
  return Array.isArray(allow) ? allow.filter((e): e is string => typeof e === "string") : [];
}

/** The Claude Code settings file this writes into — every other key is passed through untouched. */
export interface SettingsFile {
  permissions?: { allow?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

export type RefusalReason = "agent-session" | "no-declaration" | "would-widen";

export type AllowlistDecision =
  /** Refused. Nothing is written; the caller exits non-zero. */
  | { verdict: "refused"; reason: RefusalReason; message: string }
  /** The grant already covers everything declared. Nothing to do, nothing written. */
  | { verdict: "current"; message: string }
  /** Authorized: these grants, in this order, may be written. */
  | { verdict: "write"; allow: string[]; added: string[]; message: string };

export interface AllowlistInput {
  /** The skill file's raw text — the declaration, and the only authority on what is needed. */
  skill: string;
  /** The settings file as it stands, or `null` when the target does not exist yet. */
  settings: SettingsFile | null;
  /** The environment the generator was invoked in. */
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  /** The human's install-time confirmation (`--confirm-install`). */
  confirmed: boolean;
  /** Paths, for messages a person has to act on. */
  skillPath: string;
  settingsPath: string;
}

/**
 * Decide, without touching a file, what may be written.
 *
 * The order of the checks is load-bearing: the session check runs before
 * anything is parsed, so an agent cannot learn what the guard would have said
 * about its own request, and `--confirm-install` never gets to speak on a call
 * the first check already refused.
 */
export function decideAllowlist(input: AllowlistInput): AllowlistDecision {
  const marker = agentSessionMarker(input.env);
  if (marker) {
    return {
      verdict: "refused",
      reason: "agent-session",
      message: [
        `REFUSED: this ran inside an agent session (${marker} is set), and only a human may run it.`,
        "Generating a permission allowlist is an install-time act performed by the person who owns the",
        "machine, at their own shell, with no agent in the loop. A session that could write its own grant",
        "would be granting itself the permit — which is the one thing this generator exists not to do.",
        `Who may run it: the operator installing the plugin, from a plain terminal, as:`,
        `  ost-agent allowlist --skill ${input.skillPath} --settings ${input.settingsPath}`,
        "Nothing was written.",
      ].join("\n"),
    };
  }

  const declared = declaredTools(input.skill);
  if (!declared) {
    return {
      verdict: "refused",
      reason: "no-declaration",
      message:
        `REFUSED: ${input.skillPath} has no \`allowed-tools\` frontmatter line, so there is no declaration ` +
        `to derive a grant from. Nothing was written.`,
    };
  }

  if (input.settings === null) {
    // Nothing on disk to override, so there is no human decision to overrule.
    // This is the whole happy path: the grant is born from the declaration.
    return {
      verdict: "write",
      allow: declared,
      added: declared,
      message: `wrote ${declared.length} grant(s) to ${input.settingsPath}, derived from ${input.skillPath}`,
    };
  }

  const granted = grantedTools(input.settings);
  const missing = declared.filter((t) => !granted.includes(t));
  if (missing.length === 0) {
    return {
      verdict: "current",
      message: `${input.settingsPath} already grants every tool ${input.skillPath} declares. Nothing written.`,
    };
  }

  if (!input.confirmed) {
    return {
      verdict: "refused",
      reason: "would-widen",
      message: [
        `REFUSED: widening an existing grant needs a human at install time.`,
        `${input.skillPath} declares ${missing.length} tool(s) that ${input.settingsPath} does not grant:`,
        ...missing.map((t) => `  ${t}`),
        "",
        "This is NOT drift to be repaired. Two different histories leave exactly this state and these two",
        "files cannot tell them apart: a tool was appended to the skill after install, or a human narrowed",
        "the grant on purpose and meant to withhold it. Making the lists equal would silently overrule the",
        "second, so the generator does neither and asks the only party who knows which happened.",
        "",
        `If the omission is deliberate, do nothing — a grant narrower than the declaration is a supported`,
        `state and this command will keep saying so. If the tools above should be granted, re-run with`,
        `--confirm-install and they will be added (and nothing else will be touched).`,
        "Nothing was written.",
      ].join("\n"),
    };
  }

  // Additive only, and only with the flag. Existing entries keep their order and
  // their place: a settings file also grants things that have nothing to do with
  // this skill, and removing one would be this generator deciding something it
  // was never told about.
  return {
    verdict: "write",
    allow: [...granted, ...missing],
    added: missing,
    message: `added ${missing.length} grant(s) to ${input.settingsPath}: ${missing.join(", ")}`,
  };
}

export interface GeneratorRun {
  exitCode: number;
  /** Everything the operator should read — the refusal message, or what was written. */
  report: string;
  decision: AllowlistDecision;
}

/**
 * The IO shell: read both files, decide, and write only on the one verdict that
 * authorizes a write.
 *
 * The single `writeFileSync` in this module lives here, after the decision, and
 * is reached by no other path — which is what makes "zero bytes written" a
 * property of the code rather than of the test that checks it.
 */
export function runAllowlistGenerator(opts: {
  skillPath: string;
  settingsPath: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  confirmed?: boolean;
}): GeneratorRun {
  const env = opts.env ?? process.env;
  // Read the skill lazily-ish but before deciding, so a missing skill file is a
  // refusal with a path in it rather than a stack trace. A session-refusal does
  // not depend on either file, so it survives both being unreadable.
  let skill = "";
  if (agentSessionMarker(env) === null) {
    if (!fs.existsSync(opts.skillPath)) {
      return {
        exitCode: 1,
        report: `REFUSED: no skill file at ${opts.skillPath}. Nothing was written.`,
        decision: {
          verdict: "refused",
          reason: "no-declaration",
          message: `REFUSED: no skill file at ${opts.skillPath}. Nothing was written.`,
        },
      };
    }
    skill = fs.readFileSync(opts.skillPath, "utf8");
  }

  let settings: SettingsFile | null = null;
  if (fs.existsSync(opts.settingsPath)) {
    const raw = fs.readFileSync(opts.settingsPath, "utf8");
    try {
      settings = JSON.parse(raw) as SettingsFile;
    } catch (e) {
      const message =
        `REFUSED: ${opts.settingsPath} is not valid JSON (${e instanceof Error ? e.message : String(e)}). ` +
        `Rewriting a file this command cannot read would destroy whatever is in it. Nothing was written.`;
      return { exitCode: 1, report: message, decision: { verdict: "refused", reason: "would-widen", message } };
    }
  }

  const decision = decideAllowlist({
    skill,
    settings,
    env,
    confirmed: opts.confirmed === true,
    skillPath: opts.skillPath,
    settingsPath: opts.settingsPath,
  });

  if (decision.verdict !== "write") {
    return { exitCode: decision.verdict === "refused" ? 1 : 0, report: decision.message, decision };
  }

  const next: SettingsFile = { ...(settings ?? {}) };
  next.permissions = { ...(settings?.permissions ?? {}), allow: decision.allow };
  fs.writeFileSync(opts.settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { exitCode: 0, report: decision.message, decision };
}
