/**
 * Credential intake's spec — the instrument attached to "Count the distinct
 * credential forms in play and how often each changed in a year", beneath
 * "Accept the credential in whatever form the operator already has it, and
 * adapt internally".
 *
 * The adaptation the node makes the tool's problem, asserted here: each form
 * the operator plausibly already holds — a session token, stored CLI auth, an
 * OAuth grant, a personal access token, an environment variable set by
 * something else — resolves to the ONE internal call shape (a secret the
 * broker holds and spends inside a grant), and none of them is echoed back to
 * the caller on any printable surface. Before this layer existed, one
 * credential type was demanded by name and every other container the same
 * authority arrived in read as "not set".
 *
 * The threshold this test can hold is the count: the assumption's bar is "at
 * most 6 forms", and the registry is counted against it so a seventh form is a
 * decision rather than an accretion. What a green here does NOT settle, stated
 * in the node and repeated so nobody reads this file as more than it is: the
 * other half of that bar — how often each form breaks in a year — is a reading
 * of vendors' changelogs no suite can perform, and the security objection is
 * the trade itself: proving the handling correct proves the exposure real.
 * Whether an operator accepts that trade is not a suite's question.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  CREDENTIAL_FORMS,
  ghCliStoredAuth,
  ghHostsOauthToken,
  resolveCredential,
  type CredentialOffer,
} from "../../src/security/credential-forms.js";
import { createCredentialBroker } from "../../src/security/broker.js";
import { brokeredFetch, httpGetAction, HTTP_GET } from "../../src/security/brokered-fetch.js";
import {
  credentialBrokerFromEnv,
  githubOffers,
  slackOffers,
  ASKER_ACTIONS,
  ASKER_SLACK,
  CREDENTIAL_GITHUB,
  CREDENTIAL_SLACK,
} from "../../src/runner/credentials.js";

/** A fixed clock: expiry is data, and data in tests must not drift. */
const NOW = "2026-08-11T00:00:00.000Z";
const clock = () => NOW;
const BEFORE_NOW = "2026-08-10T23:59:59.000Z";
const AFTER_NOW = "2026-08-12T00:00:00.000Z";

/**
 * The internal call shape, end to end: build a broker holding the resolved
 * secret, spend it through a grant, and return what the vendor saw next to
 * what the caller got. "Resolves to the internal call shape" means exactly
 * this round trip works, whatever the form of arrival.
 */
async function spendThroughBroker(secret: string) {
  let vendorSawAuth = "";
  const broker = createCredentialBroker({
    credentials: { it: secret },
    grants: [{ asker: "adapter:it", action: HTTP_GET, credential: "it", targets: ["https://api.example.com/v1/*"] }],
    actions: {
      [HTTP_GET]: httpGetAction(async (_url, init) => {
        vendorSawAuth = init.headers.Authorization;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => `hello ${secret}` };
      }),
    },
    now: clock,
  });
  const fetchFn = brokeredFetch(broker, "adapter:it");
  const res = await fetchFn("https://api.example.com/v1/thing", {
    headers: { Authorization: `Bearer ${broker.handle("it")}` },
  });
  return { vendorSawAuth, callerGot: await res.text() };
}

describe("the registry of accepted forms", () => {
  test("holds every form the node names, and stays under the threshold's six", () => {
    const forms = Object.keys(CREDENTIAL_FORMS);
    for (const named of ["session-token", "cli-stored-auth", "oauth-grant", "personal-access-token", "env-var"]) {
      expect(forms).toContain(named);
    }
    // The assumption's fixed bar: "At most 6 forms". A seventh is a decision
    // made against the threshold, not a quiet accretion — this line is where
    // that decision becomes visible.
    expect(forms.length).toBeLessThanOrEqual(6);
  });
});

describe("each form resolves to the internal call shape", () => {
  const SECRET = "tok-abcdefghijklmnop-0123456789";

  const arrivals: Array<{ name: string; offer: CredentialOffer }> = [
    { name: "an environment variable set by something else", offer: { form: "env-var", variable: "GH_TOKEN", value: SECRET } },
    { name: "a personal access token", offer: { form: "personal-access-token", source: "the vendor settings page", token: SECRET } },
    { name: "a session token that has not expired", offer: { form: "session-token", source: "SLACK_USER_TOKEN", token: SECRET, expiresAt: AFTER_NOW } },
    {
      name: "an OAuth grant carrying an access token",
      offer: { form: "oauth-grant", source: "the host's grant file", grant: { access_token: SECRET, token_type: "bearer", expires_at: AFTER_NOW } },
    },
    { name: "auth a CLI already stored", offer: { form: "cli-stored-auth", cli: "gh", location: "~/.config/gh/hosts.yml", read: () => SECRET } },
  ];

  for (const { name, offer } of arrivals) {
    test(`${name} is spent through a grant like any other credential`, async () => {
      const intake = resolveCredential([offer], { now: clock });
      expect(intake.problem).toBeUndefined();
      expect(intake.accepted?.secret).toBe(SECRET);
      expect(intake.accepted?.form).toBe(offer.form);

      const { vendorSawAuth, callerGot } = await spendThroughBroker(intake.accepted!.secret);
      // The vendor got the real secret; the caller's echo of it came back scrubbed.
      expect(vendorSawAuth).toBe(`Bearer ${SECRET}`);
      expect(callerGot).toBe("hello [redacted]");
    });
  }

  test("the first usable offer wins, so an explicit variable outranks an ambient route", () => {
    const intake = resolveCredential([
      { form: "env-var", variable: "GITHUB_TOKEN", value: "explicit-token-0123456789" },
      { form: "cli-stored-auth", cli: "gh", location: "hosts.yml", read: () => "ambient-token-0123456789" },
    ]);
    expect(intake.accepted?.secret).toBe("explicit-token-0123456789");
    expect(intake.accepted?.source).toBe("GITHUB_TOKEN");
  });

  test("OAuth expiry in epoch seconds is read as the OAuth convention, not as milliseconds", () => {
    const past = Math.floor(Date.parse(BEFORE_NOW) / 1000);
    const intake = resolveCredential(
      [{ form: "oauth-grant", source: "grant.json", grant: { access_token: "expired-token-0123456789", expires_at: past } }],
      { now: clock },
    );
    expect(intake.accepted).toBeUndefined();
    expect(intake.problem).toMatch(/expired/);
  });
});

describe("a refusal names the route and never the value", () => {
  const SECRET = "tok-abcdefghijklmnop-0123456789";

  test("when nothing is usable, the problem lists every route tried, in order", () => {
    const intake = resolveCredential(
      [
        { form: "env-var", variable: "GITHUB_TOKEN", value: undefined },
        { form: "session-token", source: "the host session", token: SECRET, expiresAt: BEFORE_NOW },
        { form: "oauth-grant", source: "grant.json", grant: { token_type: "bearer" } },
        { form: "cli-stored-auth", cli: "gh", location: "/tmp/none/hosts.yml", read: () => undefined },
      ],
      { now: clock },
    );
    expect(intake.accepted).toBeUndefined();
    const problem = intake.problem!;
    // The message the friction note asked for: each way in that exists, named.
    expect(problem).toMatch(/GITHUB_TOKEN is not set/);
    expect(problem).toMatch(/session token from the host session expired/);
    expect(problem).toMatch(/grant\.json carries no access_token/);
    expect(problem).toMatch(/gh has no stored auth/);
    // …and none of it echoes the credential, expired or not.
    expect(problem).not.toContain(SECRET);
  });

  test("a value the broker could not scrub is refused by length, with the value withheld", () => {
    const intake = resolveCredential([{ form: "personal-access-token", source: "config", token: "shorty" }]);
    expect(intake.problem).toMatch(/too short/);
    expect(intake.problem).not.toContain("shorty");
  });

  test("a stored-auth read that fails is a named failure, not a silent absence", () => {
    const intake = resolveCredential([
      {
        form: "cli-stored-auth",
        cli: "gh",
        location: "hosts.yml",
        read: () => {
          throw new Error("EACCES: permission denied");
        },
      },
    ]);
    expect(intake.problem).toMatch(/could not be read.*EACCES/);
  });

  test("nothing on any printable surface carries the secret, in acceptance or refusal", () => {
    const accepted = resolveCredential(
      [{ form: "session-token", source: "SLACK_USER_TOKEN", token: SECRET, expiresAt: AFTER_NOW }],
      { now: clock },
    );
    // `secret` is the internal shape, consumed by the broker's constructor. The
    // printable rest — form, source, problem — must stand on its own without it.
    const { secret, ...printable } = accepted.accepted!;
    expect(secret).toBe(SECRET);
    expect(JSON.stringify(printable)).not.toContain(SECRET);

    const refused = resolveCredential(
      [{ form: "session-token", source: "SLACK_USER_TOKEN", token: SECRET, expiresAt: BEFORE_NOW }],
      { now: clock },
    );
    expect(JSON.stringify(refused)).not.toContain(SECRET);
  });
});

describe("the broker built from the environment accepts what the operator already has", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-cred-forms-"));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test("GH_TOKEN — the variable another tool set — is accepted where only GITHUB_TOKEN was", () => {
    const { broker, problems } = credentialBrokerFromEnv({
      env: { GH_TOKEN: "gho_from-another-tool-0123456789" },
      githubRepo: "tannerbroberts/OST-Agent",
    });
    expect(broker.holds(CREDENTIAL_GITHUB)).toBe(true);
    expect(problems[CREDENTIAL_GITHUB]).toBeUndefined();
  });

  test("gh's stored login is found through GH_CONFIG_DIR and spent inside the actions grant", async () => {
    const STORED = "gho_stored-by-gh-login-0123456789";
    fs.writeFileSync(
      path.join(tmp, "hosts.yml"),
      `github.com:\n    users:\n        tanner:\n    git_protocol: https\n    user: tanner\n    oauth_token: ${STORED}\n`,
      "utf8",
    );
    let vendorSawAuth = "";
    const { broker, problems } = credentialBrokerFromEnv({
      env: { GH_CONFIG_DIR: tmp },
      githubRepo: "tannerbroberts/OST-Agent",
      fetchFn: async (_url, init) => {
        vendorSawAuth = init.headers.Authorization;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
      },
    });
    expect(problems[CREDENTIAL_GITHUB]).toBeUndefined();
    expect(broker.holds(CREDENTIAL_GITHUB)).toBe(true);

    const fetchFn = brokeredFetch(broker, ASKER_ACTIONS);
    const res = await fetchFn("https://api.github.com/repos/tannerbroberts/OST-Agent/actions/runs", {
      headers: { Authorization: `Bearer ${broker.handle(CREDENTIAL_GITHUB)}` },
    });
    expect(res.ok).toBe(true);
    expect(vendorSawAuth).toBe(`Bearer ${STORED}`);
  });

  test("with no route usable, the github problem names all three routes it tried", () => {
    const { broker, problems } = credentialBrokerFromEnv({ env: {} });
    expect(broker.holds(CREDENTIAL_GITHUB)).toBe(false);
    expect(problems[CREDENTIAL_GITHUB]).toMatch(/GITHUB_TOKEN is not set/);
    expect(problems[CREDENTIAL_GITHUB]).toMatch(/GH_TOKEN is not set/);
    expect(problems[CREDENTIAL_GITHUB]).toMatch(/gh/);
    expect(problems[CREDENTIAL_GITHUB]).toMatch(/only needed for a private repository/);
  });

  test("a Slack user token the operator already holds answers the same grant a bot token would", async () => {
    let vendorSawAuth = "";
    const { broker, problems } = credentialBrokerFromEnv({
      env: { SLACK_USER_TOKEN: "xoxp-user-session-token-0123456789" },
      fetchFn: async (_url, init) => {
        vendorSawAuth = init.headers.Authorization;
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "{}" };
      },
    });
    expect(problems[CREDENTIAL_SLACK]).toBeUndefined();
    expect(broker.holds(CREDENTIAL_SLACK)).toBe(true);

    const fetchFn = brokeredFetch(broker, ASKER_SLACK);
    const res = await fetchFn("https://slack.com/api/conversations.list", {
      headers: { Authorization: `Bearer ${broker.handle(CREDENTIAL_SLACK)}` },
    });
    expect(res.ok).toBe(true);
    expect(vendorSawAuth).toBe("Bearer xoxp-user-session-token-0123456789");
  });

  test("the probe's offers and the broker's are the same list, so 'present' has one definition", () => {
    // Not a probe simulation — an identity check on the source of truth. The
    // channels health table resolves `slackOffers`/`githubOffers` too, so a form
    // added to one surface is added to both or the import breaks.
    const env = { SLACK_USER_TOKEN: "xoxp-user-session-token-0123456789" };
    expect(resolveCredential(slackOffers(env)).accepted).toBeDefined();
    expect(credentialBrokerFromEnv({ env }).broker.holds(CREDENTIAL_SLACK)).toBe(true);
    const empty = {};
    expect(resolveCredential(githubOffers(empty)).accepted).toBeUndefined();
    expect(credentialBrokerFromEnv({ env: empty }).broker.holds(CREDENTIAL_GITHUB)).toBe(false);
  });

  test("an env without a home reads nothing from the machine — a test's env is its whole world", () => {
    const stored = ghCliStoredAuth({});
    expect(stored.read()).toBeUndefined();
    expect(stored.location).toMatch(/no GH_CONFIG_DIR or HOME/);
  });
});

describe("reading gh's hosts.yml", () => {
  test("finds the token under github.com and not under some other host", () => {
    const text =
      `ghe.example.com:\n    oauth_token: gho_wrong-host-token-123456\n` +
      `github.com:\n    user: tanner\n    oauth_token: gho_right-token-0123456789\n`;
    expect(ghHostsOauthToken(text)).toBe("gho_right-token-0123456789");
  });

  test("a file without the host, or a block without a token, is no stored auth rather than an error", () => {
    expect(ghHostsOauthToken("")).toBeUndefined();
    expect(ghHostsOauthToken("ghe.example.com:\n    oauth_token: gho_x-123456\n")).toBeUndefined();
    expect(ghHostsOauthToken("github.com:\n    user: tanner\n")).toBeUndefined();
  });
});
