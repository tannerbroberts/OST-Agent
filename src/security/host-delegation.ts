/**
 * Ask the host for the credential it already holds, instead of asking the
 * operator for a second one.
 *
 * `credential-forms.ts` adapts to whatever *form* a credential the operator
 * hands over arrives in. This module answers a narrower question: for each
 * surface this repository actually ships an entry point for, does the host
 * that surface runs inside ever perform the authenticated action itself, so
 * there is no credential to hand over at all?
 *
 * The registry below is the enumeration `test/security/host-credential-
 * delegation.test.ts` checks. Each entry is either `delegable: true`, with a
 * pointer to the code that already spends the host's own authority, or
 * `delegable: false`, with the reason nothing in this repository borrows that
 * host's authority today. A surface only appears here because this repository
 * ships an entry point for it — a host nobody has written a path for is not a
 * silent "false", it is simply absent, matching what the assumption test this
 * hangs beneath ("Enumerate the hosts this tool runs under and check which
 * expose a delegable capability") already says a green run does and does not
 * settle.
 *
 * Two surfaces below are the ones that cover the majority of actual runs
 * (`agent-session` and `vault-git-remote`): every firing either serves an
 * agent session, writes+pushes the vault, or both, and neither one asks the
 * operator for a credential of its own today. That is the fact the
 * assumption's threshold — "at least 2 surfaces … covering the majority of
 * actual runs" — rests on.
 */

/** One host surface this repository ships an entry point for. */
export type HostSurface =
  | {
      id: string;
      label: string;
      entryPoint: string;
      delegable: true;
      /** Where in this repository the delegation is implemented. */
      implementedBy: string;
    }
  | {
      id: string;
      label: string;
      entryPoint: string;
      delegable: false;
      /** Why nothing here borrows the host's authority today. */
      reason: string;
    };

export const HOST_SURFACES: readonly HostSurface[] = [
  {
    id: "agent-session",
    label: "agent session — an MCP client (Claude Code or another host) driving `ost-agent mcp` over stdio",
    entryPoint: "ost-agent mcp",
    delegable: true,
    implementedBy:
      "No module under src/ reads ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN. The reasoning that " +
      "drives the MCP tool calls is paid for by the host's own subscription auth (see " +
      "examples/automation/autonomous-pass.sh and examples/automation/github-workflow.yml) — this server " +
      "only ever serves reads and append-only writes, so the model credential the operator already gave " +
      "the host is never asked for a second time here.",
  },
  {
    id: "vault-git-remote",
    label: "the git remote every entry point commits and pushes the vault to",
    entryPoint: "the `git_commit` / `git_push` MCP tools (src/security/tools.ts) and `ost-agent init` (src/runner/init.ts)",
    delegable: true,
    implementedBy:
      "src/git/safe-git.ts#gitPush shells to the system `git`, which authenticates with whatever credential " +
      "helper or SSH agent the host already has configured. Neither ost.config.yaml (src/config/schema.ts) " +
      "nor any call site reads a push credential from the environment — the destination is configured, the " +
      "authority to reach it never is.",
  },
  {
    id: "terminal-cli",
    label: "terminal CLI — an operator's shell where `gh auth login` already ran",
    entryPoint: "`ost-agent ship` (src/release/ship-repo.ts) and the `actions` adapter's credential (src/runner/credentials.ts#githubOffers)",
    delegable: true,
    implementedBy:
      "src/release/ship-repo.ts merges with `gh pr merge`, authenticated by gh's own stored login — no token " +
      "is passed by this repository's code. Separately, src/security/credential-forms.ts#ghCliStoredAuth reads " +
      "that same stored login directly, offered to githubOffers ahead of asking the operator to set a variable.",
  },
  {
    id: "scheduled-job",
    label: "scheduled job — a GitHub Actions runner",
    entryPoint: "examples/automation/github-workflow.yml, and any adapter reading GITHUB_TOKEN via githubOffers",
    delegable: true,
    implementedBy:
      "src/runner/credentials.ts#githubOffers reads GITHUB_TOKEN first — the repo-scoped secret Actions " +
      "injects into every job automatically — before falling back to GH_TOKEN or a variable an operator set.",
  },
  {
    id: "editor-extension",
    label: "editor extension",
    entryPoint: "(none)",
    delegable: false,
    reason:
      "This repository ships no editor-extension entry point — there is no host code path to check, so " +
      "there is nothing here to borrow authority from yet.",
  },
] as const;

/** Surfaces this repository already delegates to the host on. */
export function delegableHostSurfaces(): readonly HostSurface[] {
  return HOST_SURFACES.filter((s): s is HostSurface & { delegable: true } => s.delegable);
}

/** The report `ost-agent host-delegation` prints. Pure — no vault, no network. */
export function renderHostSurfaces(): string {
  const delegable = delegableHostSurfaces();
  const lines: string[] = [
    `Host surfaces: ${HOST_SURFACES.length}  (${delegable.length} delegable, ${HOST_SURFACES.length - delegable.length} ask the operator directly)`,
  ];
  for (const s of HOST_SURFACES) {
    lines.push("");
    lines.push(`[${s.id}] ${s.label}`);
    lines.push(`  entry point: ${s.entryPoint}`);
    lines.push(s.delegable ? `  DELEGABLE — ${s.implementedBy}` : `  not delegable — ${s.reason}`);
  }
  return lines.join("\n");
}
