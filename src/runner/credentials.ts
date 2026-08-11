/**
 * The broker this product actually runs with: the three credentials it reads
 * from the environment, and the scopes they answer within.
 *
 * **What changed at the call sites.** `buildPassContext` used to read
 * `SLACK_BOT_TOKEN`, `ATLASSIAN_API_TOKEN` and `BRAVE_SEARCH_API_KEY` and hand
 * each one, in full, to the client that would use it — and in the search case
 * onto `PassContext.web.searchApiKey`, an object every tool is built with. Now
 * the secrets stop here. The clients are handed a handle and a brokered fetch,
 * so the token exists in exactly one place and every request it authenticates is
 * checked against a scope and written to the vault's credential log first.
 *
 * **The grants are narrow on purpose and they are the whole policy.** Each names
 * the one host, and the one path prefix under it, that the adapter is built to
 * read. Slack's history and channel-list calls live under `/api/`; Atlassian's
 * Jira and Confluence searches live under `/rest/` of the operator's own site;
 * search is one Brave endpoint. An adapter that grew a call outside its prefix
 * would be denied rather than quietly authenticated — which is the point, and
 * why the patterns are not `https://slack.com/*`.
 *
 * **A credential that cannot be held is reported, not swallowed.** A secret too
 * short for the broker to scrub is dropped with a reason, and the caller turns
 * that into the same NAMED unavailability a missing variable already produces.
 * An adapter silently missing its credential is the failure `context.ts` was
 * rewritten to stop.
 *
 * **A credential is accepted in whatever form the operator already has it.**
 * Each name below resolves through `security/credential-forms.ts` from an
 * ordered list of offers — an explicit variable first, then ambient routes like
 * `GH_TOKEN` or the token `gh auth login` stored on this machine — and the
 * broker holds whichever usable form arrived first. When none is usable, the
 * problem string names every route tried, so the operator learns each way in
 * rather than the one the tool would have preferred.
 */
import { createCredentialBroker, type AuditSink, type CredentialBroker, type Grant } from "../security/broker.js";
import { ghCliStoredAuth, resolveCredential, type CredentialOffer } from "../security/credential-forms.js";
import { httpGetAction, HTTP_GET, type RawFetch } from "../security/brokered-fetch.js";

/** The names credentials are held under, and the askers allowed to spend them. */
export const CREDENTIAL_SLACK = "slack";
export const CREDENTIAL_ATLASSIAN = "atlassian";
export const CREDENTIAL_SEARCH = "search";
export const CREDENTIAL_GITHUB = "github";

export const ASKER_SLACK = "adapter:slack";
export const ASKER_ATLASSIAN = "adapter:atlassian";
export const ASKER_SEARCH = "web:search";
export const ASKER_ACTIONS = "adapter:actions";

const SLACK_SCOPE = "https://slack.com/api/*";
const BRAVE_SCOPE = "https://api.search.brave.com/res/v1/*";
/**
 * The run-listing endpoint of one repository, and nothing else under it.
 *
 * Narrow to the `/actions/` subtree on purpose: a GitHub token is the broadest
 * credential in this file — the same string that reads a workflow run can open an
 * issue, push a branch or publish a release. The grant is what makes the adapter's
 * read-only claim enforced rather than asserted, so it names the repo and the path.
 */
const githubActionsScope = (repo: string) => `https://api.github.com/repos/${repo}/actions/*`;

export interface EnvBrokerOptions {
  /** The environment to read. Passed in rather than reached for, so tests are not global state. */
  env?: NodeJS.ProcessEnv;
  /** Where audit records go. Omit and nothing is recorded — only ever right in a test. */
  audit?: AuditSink;
  /** Injected fetch for the brokered GET action. */
  fetchFn?: RawFetch;
  now?: () => string;
  /**
   * The "owner/repo" the `actions` adapter is configured to read, if any.
   *
   * Passed in rather than read from the environment because it is a *config*
   * fact, and the grant has to name it: a GitHub token scoped by this broker to
   * no particular repository would authenticate a read of any repository the
   * token can see, which is the opposite of what a narrow grant is for. No repo
   * configured ⇒ no grant issued, even when the token is held.
   */
  githubRepo?: string;
}

export interface EnvBroker {
  broker: CredentialBroker;
  /** credential name → why it is not held, for the ones that are not. */
  problems: Record<string, string>;
}

/**
 * The forms each credential is accepted in, in preference order — the ONE list
 * both the broker and the `channels` health probe resolve, so "present" cannot
 * mean two different things (see `test/cli/channels.test.ts`).
 *
 * An explicit variable always outranks anything scavenged: an operator who set
 * `SLACK_BOT_TOKEN` or `GITHUB_TOKEN` said which authority to spend, and a
 * broader ambient credential must not silently win over that.
 */
export function slackOffers(env: NodeJS.ProcessEnv): CredentialOffer[] {
  return [
    { form: "env-var", variable: "SLACK_BOT_TOKEN", value: env.SLACK_BOT_TOKEN },
    // A user token is session-shaped authority the operator already holds; the
    // grant still confines it to the same read-only /api/ prefix as a bot's.
    { form: "session-token", source: "SLACK_USER_TOKEN", token: env.SLACK_USER_TOKEN },
  ];
}

export function atlassianOffers(env: NodeJS.ProcessEnv): CredentialOffer[] {
  return [{ form: "env-var", variable: "ATLASSIAN_API_TOKEN", value: env.ATLASSIAN_API_TOKEN }];
}

export function searchOffers(env: NodeJS.ProcessEnv): CredentialOffer[] {
  return [{ form: "env-var", variable: "BRAVE_SEARCH_API_KEY", value: env.BRAVE_SEARCH_API_KEY }];
}

export function githubOffers(env: NodeJS.ProcessEnv): CredentialOffer[] {
  return [
    { form: "env-var", variable: "GITHUB_TOKEN", value: env.GITHUB_TOKEN },
    // Set by GitHub Actions and by `gh` itself — the commonest "env var set by
    // something else" an operator is already carrying.
    { form: "env-var", variable: "GH_TOKEN", value: env.GH_TOKEN },
    { form: "cli-stored-auth", ...ghCliStoredAuth(env) },
  ];
}

export function credentialBrokerFromEnv(opts: EnvBrokerOptions = {}): EnvBroker {
  const env = opts.env ?? process.env;
  const credentials: Record<string, string> = {};
  const problems: Record<string, string> = {};

  /** Hold the first usable form, or say which routes were tried and why each failed. */
  function offer(name: string, offers: CredentialOffer[], note?: string): void {
    const intake = resolveCredential(offers, opts.now ? { now: opts.now } : {});
    if (intake.accepted) credentials[name] = intake.accepted.secret;
    else problems[name] = note ? `${intake.problem} ${note}` : intake.problem;
  }

  offer(CREDENTIAL_SLACK, slackOffers(env));
  offer(CREDENTIAL_ATLASSIAN, atlassianOffers(env));
  offer(CREDENTIAL_SEARCH, searchOffers(env));
  offer(CREDENTIAL_GITHUB, githubOffers(env), "(a credential is only needed for a private repository)");

  const base = env.ATLASSIAN_BASE_URL?.trim().replace(/\/$/, "");
  const grants: Grant[] = [];
  if (credentials[CREDENTIAL_SLACK]) {
    grants.push({ asker: ASKER_SLACK, action: HTTP_GET, credential: CREDENTIAL_SLACK, targets: [SLACK_SCOPE] });
  }
  if (credentials[CREDENTIAL_ATLASSIAN] && base) {
    grants.push({
      asker: ASKER_ATLASSIAN,
      action: HTTP_GET,
      credential: CREDENTIAL_ATLASSIAN,
      // The operator's own site, and only the REST tree on it. A base URL that is
      // not a URL yields no grant at all rather than a pattern that matches oddly.
      targets: [`${base}/rest/*`],
    });
  }
  if (credentials[CREDENTIAL_SEARCH]) {
    grants.push({ asker: ASKER_SEARCH, action: HTTP_GET, credential: CREDENTIAL_SEARCH, targets: [BRAVE_SCOPE] });
  }
  const githubRepo = opts.githubRepo?.trim();
  if (credentials[CREDENTIAL_GITHUB] && githubRepo) {
    grants.push({
      asker: ASKER_ACTIONS,
      action: HTTP_GET,
      credential: CREDENTIAL_GITHUB,
      targets: [githubActionsScope(githubRepo)],
    });
  }

  return {
    broker: createCredentialBroker({
      credentials,
      grants,
      actions: { [HTTP_GET]: httpGetAction(opts.fetchFn) },
      ...(opts.audit ? { audit: opts.audit } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    }),
    problems,
  };
}
