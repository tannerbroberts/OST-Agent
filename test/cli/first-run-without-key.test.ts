/**
 * A first run with no credential anywhere, and the bring-your-own-key path off
 * until somebody asks for it.
 *
 * The instrument for "Test can users complete first run without providing a key",
 * beneath the solution "Optional bring-your-own-key, off by default". The node
 * that commissioned it flagged a fork it could not settle without reading the
 * repository, so this spec settles both halves rather than picking one:
 *
 *   - **The mechanical half** — does anything in the default path *demand* a key?
 *     Measured end to end through the real CLI and the real MCP server, in a
 *     stripped environment: no ANTHROPIC_API_KEY, no ANTHROPIC_AUTH_TOKEN, no
 *     adapter token, and `HOME` pointed at an empty directory so the `gh` stored
 *     auth this machine may really hold is out of reach. This half is green by
 *     construction today — the Anthropic SDK is not a dependency of this project
 *     and no code path calls a model — which is exactly why it is pinned here:
 *     the guard is against a future change that reintroduces the demand, and
 *     `no model SDK is a dependency` is the assertion that actually catches it.
 *
 *   - **The "off by default" half** — does anything spend a key that nobody asked
 *     it to spend? This was NOT green. Provider resolution keyed on
 *     `holds(CREDENTIAL_SEARCH)` alone, so an operator carrying
 *     `BRAVE_SEARCH_API_KEY` for an unrelated tool got a vault that called
 *     api.search.brave.com on the first `ost_search_web`, with nothing in
 *     `ost.config.yaml` requesting it. Observed as a live HTTP 422 from Brave's
 *     own server during a keyless run on 2026-08-29. Every other credentialed
 *     channel here is gated by an `enabled` a person wrote; search was the
 *     exception, and `web.search.brave.enabled` is now that gate.
 *
 * What this settles is mechanical only. Whether a stranger *experiences* the
 * keyless path as complete — the assumption's own threshold, five of five users
 * unconfused about whether a key is required — is usability and stays with a
 * person.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "../../src/config/load.js";
import { credentialBrokerFromEnv, CREDENTIAL_SEARCH } from "../../src/runner/credentials.js";
import { credentialAuditPath } from "../../src/security/credential-audit.js";

// The local tsx binary, invoked directly rather than through `npx` — see the
// note in first-run.test.ts: npx takes a cacache lock that concurrent spawns
// contend on.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const run = promisify(execFile);
const REPO = path.resolve(__dirname, "../..");
const CLI = path.join(REPO, "src/cli/index.ts");

/**
 * The whole environment a run gets: PATH so node resolves, HOME pointed at an
 * empty directory, and nothing else. Built by ALLOWLIST rather than by deleting
 * known key names from `process.env`, because a deny-list only ever excludes the
 * credentials somebody remembered — this excludes the ones nobody has invented
 * yet, which is what "no credential in the environment" has to mean for the
 * assertion to be worth anything.
 */
function keylessEnv(home: string): Record<string, string> {
  fs.mkdirSync(home, { recursive: true });
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home };
}

let dir: string;
let vault: string;
let home: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-keyless-"));
  vault = path.join(dir, "vault");
  home = path.join(dir, "home");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Run the CLI keyless; rejects (and so fails the test) on a non-zero exit. */
function cli(...args: string[]) {
  return run(TSX, [CLI, ...args], { env: keylessEnv(home), cwd: REPO });
}

describe("a first run with no credential in the environment", () => {
  test("init, set-outcome, ingest and the maintenance passes all complete", async () => {
    // init — the step the 2026-07-25 friction record died before finishing
    await cli("init", vault, "-o", "Learn what my users actually need");
    expect(fs.existsSync(path.join(vault, "ost.config.yaml"))).toBe(true);

    // set-outcome — a human-only write, and it must not want a key either
    const retuned = await cli("set-outcome", "Learn what my earliest users need", "--vault", vault);
    expect(retuned.stdout + retuned.stderr).not.toMatch(/API[_ ]?key|credential/i);

    // the maintenance passes, each exiting 0 or `cli` rejects
    for (const pass of ["check", "status", "rollup", "debt", "channels", "critic", "lanes"]) {
      const { stdout } = await cli(pass, "--vault", vault);
      expect(stdout.length).toBeGreaterThan(0);
    }

    // ingest, over the real MCP server — the P2 step that failed on auth
    const transport = new StdioClientTransport({
      command: TSX,
      args: [CLI, "mcp", "--vault", vault],
      env: keylessEnv(home),
      cwd: REPO,
    });
    const client = new Client({ name: "keyless", version: "0.0.0" });
    await client.connect(transport);
    try {
      for (const name of ["ost_ingest_inbox", "ost_next_work", "ost_check", "ost_status"]) {
        const res = (await client.callTool({ name, arguments: {} })) as {
          isError?: boolean;
          content: Array<{ text?: string }>;
        };
        expect(res.isError, `${name} refused a keyless run`).toBeFalsy();
      }
    } finally {
      await client.close();
    }
  }, 120_000);

  test("no model SDK is a dependency, so nothing downstream can demand a model key", () => {
    // The load-bearing reason the run above is keyless, and the assertion that
    // fails the day somebody reintroduces the demand the friction record hit.
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const modelSdks = declared.filter((d) => /^@anthropic-ai\/|^openai$|^@google\/gen|^@aws-sdk\/client-bedrock/.test(d));
    expect(modelSdks, "a model SDK would put a key back on the first-run path").toEqual([]);
  });
});

describe("bring-your-own-key is off by default", () => {
  test("a freshly initialised vault turns on nothing that needs a credential", async () => {
    await cli("init", vault, "-o", "Learn what my users actually need");
    const config = loadConfig(vault);

    // Every channel that can only run on somebody's key, off.
    expect(config.adapters.slack.enabled).toBe(false);
    expect(config.adapters.atlassian.enabled).toBe(false);
    expect(config.adapters.actions.enabled).toBe(false);
    expect(config.web.search.brave.enabled).toBe(false);
    // And the one that pushes the vault somewhere else.
    expect(config.remote.enabled).toBe(false);

    // The channels that ARE on need no credential at all — that is why they may
    // be on. Stated here so enabling a credentialed one by default has to change
    // this line rather than slip past it.
    expect(config.adapters.inbox.enabled).toBe(true);
    expect(config.adapters.usage.enabled).toBe(true);
  }, 60_000);

  test("a keyless environment holds no credential and issues no grant", () => {
    const { broker, problems } = credentialBrokerFromEnv({ env: {} });
    expect(broker.holds(CREDENTIAL_SEARCH)).toBe(false);
    // Nothing held silently: each name says which routes were tried.
    for (const name of ["slack", "atlassian", "search", "github"]) {
      expect(problems[name], `${name} was neither held nor explained`).toBeTruthy();
    }
  });

  test("a stray BRAVE_SEARCH_API_KEY does not switch search on by itself", async () => {
    // The defect this spec was written for. `ost_search_web` must delegate — and
    // spend nothing outward — when a key is merely PRESENT in the environment
    // and no one has written the opt-in. Before the `brave.enabled` gate this
    // call reached api.search.brave.com and came back HTTP 422.
    await cli("init", vault, "-o", "Learn what my users actually need");
    const transport = new StdioClientTransport({
      command: TSX,
      args: [CLI, "mcp", "--vault", vault],
      env: { ...keylessEnv(home), BRAVE_SEARCH_API_KEY: "BSA-not-a-real-key-0123456789" },
      cwd: REPO,
    });
    const client = new Client({ name: "stray-key", version: "0.0.0" });
    await client.connect(transport);
    try {
      const res = (await client.callTool({
        name: "ost_search_web",
        arguments: { query: "opportunity solution tree" },
      })) as { isError?: boolean; content: Array<{ text?: string }> };
      const text = res.content.map((c) => c.text ?? "").join("");
      expect(res.isError, `a key nobody opted into was spent: ${text}`).toBeFalsy();
      expect(text).toMatch(/ost_read_web/);
      // and the operator is told why the key they know they have is idle,
      // rather than being told there is no provider
      expect(text).toMatch(/web\.search\.brave\.enabled/);
    } finally {
      await client.close();
    }

    // Nothing outward was attempted: the broker writes every authenticated
    // request to the vault's credential log before making it, so an empty (or
    // absent) log is the record that no call was spent.
    const auditPath = credentialAuditPath(vault);
    const audited = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8").trim() : "";
    expect(audited, "a credentialed request was made without an opt-in").toBe("");
  }, 60_000);
});
