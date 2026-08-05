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
 */
import {
  createCredentialBroker,
  MIN_SECRET_CHARS,
  usableSecret,
  type AuditSink,
  type CredentialBroker,
  type Grant,
} from "../security/broker.js";
import { httpGetAction, HTTP_GET, type RawFetch } from "../security/brokered-fetch.js";

/** The names credentials are held under, and the askers allowed to spend them. */
export const CREDENTIAL_SLACK = "slack";
export const CREDENTIAL_ATLASSIAN = "atlassian";
export const CREDENTIAL_SEARCH = "search";

export const ASKER_SLACK = "adapter:slack";
export const ASKER_ATLASSIAN = "adapter:atlassian";
export const ASKER_SEARCH = "web:search";

const SLACK_SCOPE = "https://slack.com/api/*";
const BRAVE_SCOPE = "https://api.search.brave.com/res/v1/*";

export interface EnvBrokerOptions {
  /** The environment to read. Passed in rather than reached for, so tests are not global state. */
  env?: NodeJS.ProcessEnv;
  /** Where audit records go. Omit and nothing is recorded — only ever right in a test. */
  audit?: AuditSink;
  /** Injected fetch for the brokered GET action. */
  fetchFn?: RawFetch;
  now?: () => string;
}

export interface EnvBroker {
  broker: CredentialBroker;
  /** credential name → why it is not held, for the ones that are not. */
  problems: Record<string, string>;
}

export function credentialBrokerFromEnv(opts: EnvBrokerOptions = {}): EnvBroker {
  const env = opts.env ?? process.env;
  const credentials: Record<string, string> = {};
  const problems: Record<string, string> = {};

  /** Hold it, or say why not. The two reasons are different facts and get different words. */
  function offer(name: string, value: string | undefined, missing: string): void {
    const trimmed = value?.trim();
    if (!trimmed) {
      problems[name] = missing;
      return;
    }
    if (!usableSecret(trimmed)) {
      problems[name] =
        `the value supplied is ${trimmed.length} characters, under the ${MIN_SECRET_CHARS} the broker requires — ` +
        `too short to redact from a log or a result without mangling unrelated text, ` +
        `so it is refused rather than held unscrubbable`;
      return;
    }
    credentials[name] = trimmed;
  }

  offer(CREDENTIAL_SLACK, env.SLACK_BOT_TOKEN, "SLACK_BOT_TOKEN is not set");
  offer(CREDENTIAL_ATLASSIAN, env.ATLASSIAN_API_TOKEN, "ATLASSIAN_API_TOKEN is not set");
  offer(CREDENTIAL_SEARCH, env.BRAVE_SEARCH_API_KEY, "BRAVE_SEARCH_API_KEY is not set");

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
