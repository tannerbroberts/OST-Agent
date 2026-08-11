/**
 * Credential intake — accept the credential in whatever form the operator
 * already has it, and adapt internally.
 *
 * **The shape of the problem.** Every credential this repository uses was
 * demanded in exactly one form: a single named environment variable, checked by
 * `credentialBrokerFromEnv` and nowhere else. An operator holding the same
 * authority in a different container — `GH_TOKEN` exported by another tool, the
 * token `gh auth login` already stored on this machine, an OAuth grant, a
 * session token with an expiry — was told the credential "is not set" while
 * holding it. The vault records exactly that friction: a run refused to start
 * for want of a variable while an authenticated session was live, and the work
 * was reachable the whole time by an undocumented route.
 *
 * **The internal call shape is one string.** The broker (`broker.js`) holds
 * `name → secret` and everything downstream — grants, handles, scrubbing,
 * audit — operates on that. So "adapt internally" means exactly one thing:
 * every accepted form resolves to that string here, at intake, and the rest of
 * the pipeline never learns which form it arrived in.
 *
 * **A refusal names the route, never the value.** When no offered form is
 * usable, the problem string lists every route tried and why each failed —
 * that is the "message that names the ambient route" the friction note asked
 * for. Nothing this module returns on its printable surfaces (`problem`,
 * `source`, `form`) ever contains the secret; the secret appears only on
 * `accepted.secret`, whose one consumer is the broker's constructor.
 *
 * **The registry is deliberately short.** The assumption this hangs beneath —
 * "the credential forms in play are few enough and stable enough to adapt to
 * all of them" — carries a fixed bar of at most six forms. The spec
 * (`test/security/credential-forms.test.ts`) counts this registry against it,
 * so a seventh form is a decision made against the threshold rather than a
 * quiet accretion.
 */
import fs from "node:fs";
import path from "node:path";
import { MIN_SECRET_CHARS, usableSecret } from "./broker.js";

/**
 * The forms an operator plausibly already holds a credential in, each with the
 * one-line description a refusal or a report can print.
 */
export const CREDENTIAL_FORMS = {
  "env-var": "an environment variable, including one another tool set",
  "personal-access-token": "a personal access token pasted from the vendor's settings page",
  "session-token": "a token minted for a live session, which can expire",
  "oauth-grant": "an OAuth grant carrying an access token",
  "cli-stored-auth": "authentication a CLI already stored on this machine",
} as const;

export type CredentialFormName = keyof typeof CREDENTIAL_FORMS;

/**
 * One way a credential is being offered. The payload differs per form because
 * the forms genuinely differ — an OAuth grant is a document, stored CLI auth is
 * a read of somebody else's file — and flattening them to "a string" here would
 * move the adaptation back onto the operator, which is the failure this module
 * exists to end.
 */
export type CredentialOffer =
  | { form: "env-var"; variable: string; value: string | undefined }
  | { form: "personal-access-token"; source: string; token: string | undefined }
  | {
      form: "session-token";
      source: string;
      token: string | undefined;
      /** ISO timestamp after which the session is dead. Omitted = not known to expire. */
      expiresAt?: string;
    }
  | {
      form: "oauth-grant";
      source: string;
      /** The grant document as the operator has it. Shape is checked here, not by the caller. */
      grant: unknown;
    }
  | {
      form: "cli-stored-auth";
      /** The CLI whose stored auth this is, e.g. "gh". */
      cli: string;
      /** Where it is stored, for the refusal message. */
      location: string;
      /** Reads the stored token, or undefined when none is stored. Injected so tests own the disk. */
      read: () => string | undefined;
    };

/** What intake hands the broker: the one internal shape, plus printable provenance. */
export interface AcceptedCredential {
  /** The secret. Consumed by the broker's constructor and printable nowhere. */
  secret: string;
  form: CredentialFormName;
  /** Where it came from, safe to print — a variable name, a file, never the value. */
  source: string;
}

export type IntakeResult =
  | { accepted: AcceptedCredential; problem?: undefined }
  | { accepted?: undefined; problem: string };

export interface IntakeOptions {
  /** Injected clock for expiry checks — expiry is data, and data in tests must not drift. */
  now?: () => string;
}

/** The grant fields this module reads. Everything else in the document is ignored. */
interface OAuthGrantShape {
  access_token?: unknown;
  /** ISO timestamp, or seconds since the epoch — both appear in the wild. */
  expires_at?: unknown;
}

/** The one refusal wording for a value the broker could not hold, shared across forms. */
function tooShort(source: string, length: number): string {
  return (
    `${source} supplied a value of ${length} characters, under the ${MIN_SECRET_CHARS} the broker requires — ` +
    `too short to redact from a log or a result, so it is refused rather than held unscrubbable`
  );
}

function expiresAtMs(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    // Seconds since the epoch, the OAuth convention. A value that would be in
    // the past as milliseconds and the future as seconds is read as seconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Try one offer: the secret in the internal shape, or the reason this route
 * did not yield one. The reason names the route and never echoes the value.
 */
function tryOffer(offer: CredentialOffer, nowMs: number): { secret?: string; reason?: string; source: string } {
  switch (offer.form) {
    case "env-var": {
      const value = offer.value?.trim();
      if (!value) return { reason: `${offer.variable} is not set`, source: offer.variable };
      if (!usableSecret(value)) return { reason: tooShort(offer.variable, value.length), source: offer.variable };
      return { secret: value, source: offer.variable };
    }
    case "personal-access-token": {
      const token = offer.token?.trim();
      if (!token) return { reason: `no personal access token from ${offer.source}`, source: offer.source };
      if (!usableSecret(token)) return { reason: tooShort(offer.source, token.length), source: offer.source };
      return { secret: token, source: offer.source };
    }
    case "session-token": {
      const token = offer.token?.trim();
      if (!token) return { reason: `no session token from ${offer.source}`, source: offer.source };
      const expiry = offer.expiresAt === undefined ? undefined : expiresAtMs(offer.expiresAt);
      if (expiry !== undefined && expiry <= nowMs) {
        return { reason: `the session token from ${offer.source} expired at ${offer.expiresAt}`, source: offer.source };
      }
      if (!usableSecret(token)) return { reason: tooShort(offer.source, token.length), source: offer.source };
      return { secret: token, source: offer.source };
    }
    case "oauth-grant": {
      const grant = offer.grant;
      if (grant === undefined || grant === null) {
        return { reason: `no OAuth grant from ${offer.source}`, source: offer.source };
      }
      if (typeof grant !== "object") {
        return { reason: `the OAuth grant from ${offer.source} is not a grant document`, source: offer.source };
      }
      const { access_token, expires_at } = grant as OAuthGrantShape;
      if (typeof access_token !== "string" || !access_token.trim()) {
        return { reason: `the OAuth grant from ${offer.source} carries no access_token`, source: offer.source };
      }
      const expiry = expires_at === undefined ? undefined : expiresAtMs(expires_at);
      if (expiry !== undefined && expiry <= nowMs) {
        return {
          reason: `the OAuth grant from ${offer.source} expired at ${String(expires_at)}`,
          source: offer.source,
        };
      }
      const token = access_token.trim();
      if (!usableSecret(token)) return { reason: tooShort(offer.source, token.length), source: offer.source };
      return { secret: token, source: offer.source };
    }
    case "cli-stored-auth": {
      const source = `${offer.cli} stored auth at ${offer.location}`;
      let stored: string | undefined;
      try {
        stored = offer.read();
      } catch (err) {
        const why = err instanceof Error ? err.message : String(err);
        return { reason: `${source} could not be read: ${why}`, source };
      }
      const token = stored?.trim();
      if (!token) return { reason: `${offer.cli} has no stored auth at ${offer.location}`, source };
      if (!usableSecret(token)) return { reason: tooShort(source, token.length), source };
      return { secret: token, source };
    }
  }
}

/**
 * Resolve a credential from whatever forms it was offered in, first usable
 * offer wins — order is the caller's preference, so an explicit variable can
 * outrank auth scavenged from a CLI's files.
 *
 * When nothing is usable, the problem lists every route tried in order, which
 * is the message the friction note asked for: the operator learns each way in
 * that exists, not just the one the tool would have preferred.
 */
export function resolveCredential(offers: readonly CredentialOffer[], opts: IntakeOptions = {}): IntakeResult {
  const nowMs = Date.parse(opts.now ? opts.now() : new Date().toISOString());
  const reasons: string[] = [];
  for (const offer of offers) {
    const attempt = tryOffer(offer, nowMs);
    if (attempt.secret !== undefined) {
      return { accepted: { secret: attempt.secret, form: offer.form, source: attempt.source } };
    }
    reasons.push(attempt.reason as string);
  }
  return { problem: reasons.length > 0 ? reasons.join("; ") : "no credential was offered in any form" };
}

/**
 * The stored-auth offer for the `gh` CLI: the `oauth_token` under the
 * `github.com` host in `hosts.yml`.
 *
 * The home directory comes from the PASSED environment, not `os.homedir()`, so
 * a test's env is the whole world it runs in — an env without `HOME` reads
 * nothing, which is also what keeps `credentialBrokerFromEnv({env: {...}})`
 * deterministic on a machine where the real `gh` is logged in. Best-effort on
 * purpose: `gh` can keep the token in the system keyring instead, and then the
 * honest answer is "no stored auth here", not a shell-out.
 */
export function ghCliStoredAuth(
  env: NodeJS.ProcessEnv,
  readFile: (file: string) => string = (file) => fs.readFileSync(file, "utf8"),
): { cli: "gh"; location: string; read: () => string | undefined } {
  const configDir =
    env.GH_CONFIG_DIR?.trim() ||
    (env.XDG_CONFIG_HOME?.trim() ? path.join(env.XDG_CONFIG_HOME.trim(), "gh") : undefined) ||
    (env.HOME?.trim() ? path.join(env.HOME.trim(), ".config", "gh") : undefined);
  if (!configDir) {
    return {
      cli: "gh",
      location: "(no GH_CONFIG_DIR or HOME in this environment)",
      read: () => undefined,
    };
  }
  const location = path.join(configDir, "hosts.yml");
  return {
    cli: "gh",
    location,
    read: () => {
      let text: string;
      try {
        text = readFile(location);
      } catch (err) {
        // Absent is a normal state (gh not installed, or token in the keyring),
        // and it reads as "no stored auth". Anything else is a real failure the
        // refusal message should carry.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
      return ghHostsOauthToken(text);
    },
  };
}

/**
 * Pull `oauth_token` out of the `github.com:` block of a `hosts.yml`. A
 * two-level scan, not a YAML parser: the file is machine-written by `gh` in a
 * fixed shape, and a document this module cannot read is a document it treats
 * as holding no token.
 */
export function ghHostsOauthToken(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const host = lines.findIndex((line) => /^["']?github\.com["']?:\s*$/.test(line));
  if (host === -1) return undefined;
  for (let i = host + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break; // next top-level key: past the block
    const match = /^[ \t]+oauth_token:\s*["']?([^"'\s]+)/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}
