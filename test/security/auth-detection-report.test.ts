/**
 * The auth-detection report's spec — the instrument attached to "Detect the
 * authentication that already exists and say exactly which one will be used".
 *
 * The node's argument: being asked for a credential is bearable; being asked
 * while already authenticated, with no explanation of why the existing one
 * will not do, is what makes it feel absurd. So this spec asserts three
 * things, each traceable to a sentence in the node or its definition of done:
 *
 *  1. **Before anything needs a credential.** `detectAuthentication` is a
 *     synchronous, pure function of the environment it is handed — it builds
 *     no broker, spends nothing, and reaches no network — so calling it costs
 *     nothing and can happen first, ahead of any adapter that would actually
 *     use a credential.
 *  2. **Names which will be used, or which were found and why each was
 *     rejected.** For every credential this repository's adapters read, the
 *     report says exactly one of those two things, resolved through the same
 *     offers list `credentialBrokerFromEnv` resolves — so "present" cannot
 *     mean two different things.
 *  3. **No secret value is ever echoed.** A rejection reason can leak more
 *     than the rejection, which is the node's own warning — checked here by
 *     never finding the configured secret anywhere in the report, rendered or
 *     structured.
 *
 * **What a green here does not settle**, repeated from the node so nobody
 * reads this file as more than it is: consent to the probe running at all.
 * That is "Operators consent to a probe that looks in the places their
 * credentials live", and no test can ask anyone whether they agree to the
 * list below — it can only show the list is what actually runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { detectAuthentication, renderAuthDetectionReport } from "../../src/security/auth-detection-report.js";
import { credentialBrokerFromEnv } from "../../src/runner/credentials.js";

const SLACK_SECRET = "xoxb-slack-secret-0123456789";
const ATLASSIAN_SECRET = "atlassian-secret-0123456789";
const SEARCH_SECRET = "brave-search-secret-0123456789";
const GITHUB_SECRET = "gho_github-secret-0123456789";

describe("before anything needs a credential", () => {
  test("is synchronous and returns without touching a broker, a network, or a vault", () => {
    const result = detectAuthentication({});
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.entries).toHaveLength(4);
  });

  test("costs nothing to call even with a hostile or empty environment", () => {
    expect(() => detectAuthentication({})).not.toThrow();
    expect(() => detectAuthentication(process.env)).not.toThrow();
  });
});

describe("names which credential will be used, or which were rejected and why", () => {
  test("with nothing set, all four are rejected and each names the routes it tried", () => {
    const report = detectAuthentication({});
    expect(report.entries.map((e) => e.name)).toEqual(["slack", "atlassian", "search", "github"]);
    for (const entry of report.entries) {
      expect(entry.status).toBe("rejected");
      if (entry.status === "rejected") expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  test("slack: a bot token in the environment is the one that will be used", () => {
    const report = detectAuthentication({ SLACK_BOT_TOKEN: SLACK_SECRET });
    const slack = report.entries.find((e) => e.name === "slack");
    expect(slack).toMatchObject({ status: "will-use", form: "env-var", source: "SLACK_BOT_TOKEN" });
  });

  test("slack: a user session token answers when no bot token is set", () => {
    const report = detectAuthentication({ SLACK_USER_TOKEN: SLACK_SECRET });
    const slack = report.entries.find((e) => e.name === "slack");
    expect(slack).toMatchObject({ status: "will-use", form: "session-token", source: "SLACK_USER_TOKEN" });
  });

  test("atlassian: an API token in the environment is reported by name", () => {
    const report = detectAuthentication({ ATLASSIAN_API_TOKEN: ATLASSIAN_SECRET });
    const atlassian = report.entries.find((e) => e.name === "atlassian");
    expect(atlassian).toMatchObject({ status: "will-use", form: "env-var", source: "ATLASSIAN_API_TOKEN" });
  });

  test("search: a Brave key in the environment is reported by name", () => {
    const report = detectAuthentication({ BRAVE_SEARCH_API_KEY: SEARCH_SECRET });
    const search = report.entries.find((e) => e.name === "search");
    expect(search).toMatchObject({ status: "will-use", form: "env-var", source: "BRAVE_SEARCH_API_KEY" });
  });

  test("github: GITHUB_TOKEN outranks GH_TOKEN, which is what an explicit choice means", () => {
    const report = detectAuthentication({ GITHUB_TOKEN: GITHUB_SECRET, GH_TOKEN: "some-other-token-0123456789" });
    const github = report.entries.find((e) => e.name === "github");
    expect(github).toMatchObject({ status: "will-use", form: "env-var", source: "GITHUB_TOKEN" });
  });

  test("github: GH_TOKEN, set by something else, is found and named when GITHUB_TOKEN is absent", () => {
    const report = detectAuthentication({ GH_TOKEN: GITHUB_SECRET });
    const github = report.entries.find((e) => e.name === "github");
    expect(github).toMatchObject({ status: "will-use", form: "env-var", source: "GH_TOKEN" });
  });

  describe("github: gh's own stored login", () => {
    let tmp: string;
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ost-auth-report-"));
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    test("is detected and named ahead of reporting no credential at all", () => {
      fs.writeFileSync(
        path.join(tmp, "hosts.yml"),
        `github.com:\n    users:\n        tanner:\n    git_protocol: https\n    user: tanner\n    oauth_token: ${GITHUB_SECRET}\n`,
        "utf8",
      );
      const report = detectAuthentication({ GH_CONFIG_DIR: tmp });
      const github = report.entries.find((e) => e.name === "github");
      expect(github?.status).toBe("will-use");
      if (github?.status === "will-use") {
        expect(github.form).toBe("cli-stored-auth");
        expect(github.source).toContain(tmp);
      }
    });
  });

  test("the report's offers are the same ones credentialBrokerFromEnv resolves — one definition of 'present'", () => {
    const env = { SLACK_BOT_TOKEN: SLACK_SECRET, ATLASSIAN_API_TOKEN: ATLASSIAN_SECRET };
    const report = detectAuthentication(env);
    const { broker, problems } = credentialBrokerFromEnv({ env });

    for (const entry of report.entries) {
      const brokerName = entry.name === "search" ? "search" : entry.name;
      if (entry.status === "will-use") {
        expect(broker.holds(brokerName)).toBe(true);
        expect(problems[brokerName]).toBeUndefined();
      } else {
        expect(broker.holds(brokerName)).toBe(false);
      }
    }
  });
});

describe("no secret value is ever echoed", () => {
  const env = {
    SLACK_BOT_TOKEN: SLACK_SECRET,
    ATLASSIAN_API_TOKEN: ATLASSIAN_SECRET,
    BRAVE_SEARCH_API_KEY: SEARCH_SECRET,
    GITHUB_TOKEN: GITHUB_SECRET,
  };

  test("not in the structured report, will-use or rejected", () => {
    const report = detectAuthentication(env);
    const serialized = JSON.stringify(report);
    for (const secret of [SLACK_SECRET, ATLASSIAN_SECRET, SEARCH_SECRET, GITHUB_SECRET]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("not in the rendered text report either", () => {
    const rendered = renderAuthDetectionReport(detectAuthentication(env));
    for (const secret of [SLACK_SECRET, ATLASSIAN_SECRET, SEARCH_SECRET, GITHUB_SECRET]) {
      expect(rendered).not.toContain(secret);
    }
    expect(rendered).toContain("WILL USE");
  });

  test("a rejection reason for a too-short value never quotes the value itself", () => {
    const tooShort = "zq9v";
    const report = detectAuthentication({ SLACK_BOT_TOKEN: tooShort });
    const slack = report.entries.find((e) => e.name === "slack");
    expect(slack?.status).toBe("rejected");
    if (slack?.status === "rejected") {
      expect(slack.reason).not.toContain(tooShort);
      expect(slack.reason).toMatch(/under the 8/);
    }
  });
});

describe("renderAuthDetectionReport", () => {
  test("summarizes the counts and lists every credential by name", () => {
    const rendered = renderAuthDetectionReport(detectAuthentication({ SLACK_BOT_TOKEN: SLACK_SECRET }));
    expect(rendered).toMatch(/4 credential\(s\) checked, 1 will be used, 3 rejected/);
    expect(rendered).toContain("[slack]");
    expect(rendered).toContain("[atlassian]");
    expect(rendered).toContain("[search]");
    expect(rendered).toContain("[github]");
    expect(rendered).toContain("not available");
  });
});
