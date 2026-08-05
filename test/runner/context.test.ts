import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { configPath } from "../../src/config/load.js";

let dir: string;
const ENV_KEYS = ["ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN", "BRAVE_SEARCH_API_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-ctx-"));
  await initVault(dir, "Reach 10,000 daily active users");
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

function enableAtlassian() {
  fs.writeFileSync(
    configPath(dir),
    `outcome: "Reach 10,000 daily active users"\nadapters:\n  atlassian:\n    enabled: true\n    projects: ["PROJ"]\n    spaces: []\n`,
    "utf8",
  );
}

/** The name of every channel the context accounts for, built or not. */
function accountedFor(ctx: ReturnType<typeof buildPassContext>): string[] {
  return [...ctx.sources.map((s) => s.name), ...ctx.unavailableSources.map((u) => u.name)].sort();
}

describe("buildPassContext adapter wiring", () => {
  test("the drop folders and the mechanical usage trace by default", () => {
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["friction", "inbox", "usage"]);
  });

  test("enabling Atlassian without credentials degrades that source and nothing else", () => {
    // G1's shape, applied per source: it USED to throw here, and buildPassContext is
    // what every tool is built through — so one absent env var took `ost_check` and
    // `ost_read_tree` down with it, tools that never needed a Jira token.
    enableAtlassian();
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name)).not.toContain("atlassian");
    // Named and reported, never silently skipped: an enabled channel that vanishes
    // makes "0 new items" mean both "nothing to report" and "never looked".
    const gap = ctx.unavailableSources.find((u) => u.name === "atlassian");
    expect(gap?.kind).toBe("unavailable");
    expect(gap?.reason).toMatch(/ATLASSIAN_BASE_URL|API token/);
    // The rest of the surface is untouched — that is the whole point of degrading.
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["friction", "inbox", "usage"]);
    expect(ctx.vault.readTree().length).toBeGreaterThan(0);
  });

  test("enabling the transcript adapter with an explicit path adds the source", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nadapters:\n  transcript:\n    enabled: true\n    path: ${JSON.stringify(dir)}\n`,
      "utf8",
    );
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["friction", "inbox", "transcript", "usage"]);
  });

  test("enabling the transcript adapter with neither path nor projectDir degrades it by name", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nadapters:\n  transcript:\n    enabled: true\n`,
      "utf8",
    );
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name)).not.toContain("transcript");
    // The adapter still states its own requirement in its own words; what changed is
    // that the sentence is carried rather than thrown.
    expect(ctx.unavailableSources.find((u) => u.name === "transcript")?.reason).toMatch(/transcript.*(path|projectDir)/i);
  });

  test("a source turned OFF and a source that could not be built are different facts", () => {
    // Both are "not in ctx.sources". Collapsing them into one word is how an
    // operator staring at a full folder is told the same thing whether they turned
    // the channel off or the process is missing its credentials.
    enableAtlassian();
    const ctx = buildPassContext(dir);
    expect(ctx.unavailableSources.find((u) => u.name === "atlassian")?.kind).toBe("unavailable");
    expect(ctx.unavailableSources.find((u) => u.name === "slack")?.kind).toBe("disabled");
  });

  test("every declared channel lands in exactly one of the two lists", () => {
    // The partition property. A channel that falls out of both is invisible, which
    // is the failure this whole split exists to make impossible.
    enableAtlassian();
    const ctx = buildPassContext(dir);
    expect(accountedFor(ctx)).toEqual(["atlassian", "friction", "inbox", "slack", "transcript", "usage"]);
    // Non-vacuity: with credentials present the SAME channel moves lists rather than
    // disappearing, so the equality above is tracking config and env, not a constant.
    process.env.ATLASSIAN_BASE_URL = "https://x.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@x.com";
    process.env.ATLASSIAN_API_TOKEN = "atlassian-api-token-fixture";
    const withCreds = buildPassContext(dir);
    expect(accountedFor(withCreds)).toEqual(["atlassian", "friction", "inbox", "slack", "transcript", "usage"]);
    expect(withCreds.sources.map((s) => s.name)).toContain("atlassian");
  });

  test("enabling Atlassian with credentials adds the source", () => {
    enableAtlassian();
    process.env.ATLASSIAN_BASE_URL = "https://x.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@x.com";
    process.env.ATLASSIAN_API_TOKEN = "atlassian-api-token-fixture";
    const ctx = buildPassContext(dir);
    expect(ctx.sources.map((s) => s.name).sort()).toEqual(["atlassian", "friction", "inbox", "usage"]);
  });

  test("skipSources claims nothing about the channels it did not build", () => {
    // An empty `unavailableSources` here is meaningful: nothing was considered, so
    // nothing may be reported as off or as broken.
    enableAtlassian();
    const ctx = buildPassContext(dir, { skipSources: true });
    expect(ctx.sources).toEqual([]);
    expect(ctx.unavailableSources).toEqual([]);
  });
});

describe("buildPassContext budget wiring — the operator's number, and only theirs", () => {
  test("the budget is the operator's configured number", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });

  test("a genome.yaml at the vault root is inert — nothing loads it, so nothing can shadow the operator", () => {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  lookupBudget: 4\n`,
      "utf8",
    );
    fs.writeFileSync(path.join(dir, "genome.yaml"), `budgets:\n  sharedPool: 2\n`, "utf8");
    expect(buildPassContext(dir).web?.budget?.limit).toBe(4);
  });
});

/**
 * Brave, else the keyless federated sources if they are turned on, else
 * nothing — in which case ost_search_web tells the agent to use its host's own
 * search, which is the normal path in Claude Code.
 */
describe("search provider resolution", () => {
  function enableFederated(hosts: string[] = []) {
    fs.writeFileSync(
      configPath(dir),
      `outcome: "Reach 10,000 daily active users"\nweb:\n  search:\n    federated:\n      enabled: true\n      discourseHosts: [${hosts.join(", ")}]\n`,
      "utf8",
    );
  }

  test("no key and federated off resolves no provider — the delegation default", () => {
    expect(buildPassContext(dir).web?.provider).toBeUndefined();
  });

  test("a Brave key wins over the keyless fallback", () => {
    process.env.BRAVE_SEARCH_API_KEY = "brave-key-fixture";
    enableFederated();
    expect(buildPassContext(dir).web?.provider?.name).toBe("brave");
  });

  test("federated enabled resolves the keyless sources, including configured Discourse hosts", async () => {
    enableFederated(["forum.obsidian.md"]);
    const provider = buildPassContext(dir).web?.provider;
    expect(provider?.name).toBe("federated");

    const asked: string[] = [];
    await provider?.search("q", 3, async (url) => {
      asked.push(new URL(url).hostname);
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => "{}" };
    });
    expect(asked.sort()).toEqual(["en.wikipedia.org", "forum.obsidian.md", "hn.algolia.com"]);
  });
});
