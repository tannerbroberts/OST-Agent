/**
 * Every shipped adapter is reachable from a live caller, or is not shipped. (S5.)
 *
 * The failure this ends: five `Source` classes were built, tested and documented,
 * `ost.config.yaml` had a switch for each, and exactly one of them was ever
 * constructed by anything a user can run. Turning on `adapters.slack` recorded
 * nothing and said nothing — a configurable option that is a no-op, which is worse
 * than an absent one because the operator believes the channel is live.
 *
 * **The adapter list is DERIVED, never written down here.** It comes from scanning
 * `src/adapters/` for `export class …Source`, exactly as the criterion words its
 * check, so a sixth adapter fails this test on the commit that adds it and stays
 * failing until it is either wired to a live caller or removed. A hand-written list
 * would let the next adapter ship unreachable and this test pass.
 *
 * Three things are asserted, because any one alone is fakeable:
 *   1. each class is CONSTRUCTED somewhere outside `src/adapters/`;
 *   2. that construction site is import-reachable from a live entry point — the CLI
 *      and the MCP server, the only two things a user can actually run;
 *   3. building a context from a config that enables everything really does produce
 *      an instance of each class. (1) and (2) are text; (3) is the behaviour.
 *
 * **None of the three would have caught the original bug, and saying so is the point
 * of this paragraph.** `skipSources: true` lived in `src/mcp/server.ts`, not in
 * `buildPassContext` — which built every enabled adapter faithfully — so (3) calls
 * the layer that was always correct. Reinstating `skipSources` on the server leaves
 * this whole file green; it reddens `test/mcp/s1-self-feeding.test.ts` and
 * `test/mcp/channel-degradation.test.ts`, which drive `createLazyOstMcpServer`.
 * That split is deliberate — this file owns "no adapter ships unreachable", those two
 * own "the shipped surface actually reaches them" — but a reader who takes (3) for
 * the surface check will believe a criterion is pinned on a path nobody executes,
 * which is H5's recorded failure arriving through a different door. The all-enabled
 * config cannot be driven through the MCP surface here for a good reason: ingesting
 * with real-looking Slack and Atlassian credentials would make those adapters fetch,
 * and no test in this repo may reach the network.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { configPath } from "../../src/config/load.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcRoot = path.join(repoRoot, "src");
const adapterRoot = path.join(srcRoot, "adapters");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

const SRC_FILES = tsFiles(srcRoot);

/** The criterion's own enumeration: `grep -rn 'export class .*Source' src/adapters/`. */
function shippedAdapterClasses(): string[] {
  const names: string[] = [];
  for (const file of tsFiles(adapterRoot)) {
    const source = fs.readFileSync(file, "utf8");
    for (const m of source.matchAll(/^export class\s+(\w*Source)\b/gm)) names.push(m[1]);
  }
  return [...new Set(names)].sort();
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier.replace(/\.js$/, ".ts"));
  if (SRC_FILES.includes(base)) return base;
  const asIndex = base.replace(/\.ts$/, "/index.ts");
  return SRC_FILES.includes(asIndex) ? asIndex : null;
}

function importsOf(file: string): string[] {
  const source = fs.readFileSync(file, "utf8");
  return [
    ...[...source.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
  ]
    .map((s) => resolveSpecifier(file, s))
    .filter((p): p is string => p !== null);
}

/**
 * Everything the two live surfaces can reach. The CLI is what a human runs; the MCP
 * server is what the plugin launches. A construction reachable from neither is a
 * construction nothing performs.
 */
function reachableFromLiveSurfaces(): Set<string> {
  const roots = [path.join(srcRoot, "cli/index.ts"), path.join(srcRoot, "mcp/server.ts")];
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) if (!seen.has(next)) stack.push(next);
  }
  return seen;
}

/** Files outside `src/adapters/` that contain `new <Name>(`. */
function constructionSites(className: string): string[] {
  const pattern = new RegExp(`\\bnew\\s+${className}\\s*\\(`);
  return SRC_FILES.filter((f) => !f.startsWith(adapterRoot + path.sep) && pattern.test(fs.readFileSync(f, "utf8")));
}

describe("S5 — no adapter ships without a live caller", () => {
  test("the enumeration is derived from the source tree, not from this file", () => {
    // Without this, a regex that matched nothing would make every assertion below
    // vacuously true — the exact way a "no dead adapters" test dies quietly.
    const classes = shippedAdapterClasses();
    expect(classes.length).toBeGreaterThanOrEqual(5);
    expect(classes).toContain("InboxSource");
    expect(classes).toContain("SlackSource");
    expect(reachableFromLiveSurfaces().size).toBeGreaterThan(20);
  });

  test("every shipped adapter is constructed somewhere a live surface can reach", () => {
    const reachable = reachableFromLiveSurfaces();
    for (const className of shippedAdapterClasses()) {
      const sites = constructionSites(className).map((f) => path.relative(repoRoot, f));
      expect(sites, `${className} is exported but never constructed outside src/adapters/`).not.toEqual([]);
      const live = constructionSites(className).filter((f) => reachable.has(f));
      expect(
        live.map((f) => path.relative(repoRoot, f)),
        `${className} is constructed only in ${sites.join(", ")}, which no live surface imports`,
      ).not.toEqual([]);
    }
  });
});

describe("S5 — the construction really happens, not just the text", () => {
  let dir: string;
  const ENV = ["ATLASSIAN_BASE_URL", "ATLASSIAN_EMAIL", "ATLASSIAN_API_TOKEN", "SLACK_BOT_TOKEN"];
  let saved: Record<string, string | undefined>;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-s5-"));
    await initVault(dir, "Reach ten returning operators.", "Reach ten returning operators");
    saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(enabled: boolean): void {
    // The transcript directory is the vault itself: it only has to exist, and no
    // adapter reads anything at construction — nothing here touches the network.
    fs.writeFileSync(
      configPath(dir),
      [
        `outcome: "Reach ten returning operators."`,
        `adapters:`,
        `  inbox:`,
        `    enabled: ${enabled}`,
        `  transcript:`,
        `    enabled: ${enabled}`,
        `    path: ${JSON.stringify(dir)}`,
        `  usage:`,
        `    enabled: ${enabled}`,
        `  atlassian:`,
        `    enabled: ${enabled}`,
        `    projects: ["PROJ"]`,
        `  slack:`,
        `    enabled: ${enabled}`,
        `    channels: ["C1"]`,
        `  actions:`,
        `    enabled: ${enabled}`,
        `    repo: "owner/repo"`,
        ``,
      ].join("\n"),
      "utf8",
    );
  }

  test("a config that enables everything yields one instance of every shipped adapter", () => {
    writeConfig(true);
    process.env.ATLASSIAN_BASE_URL = "https://x.atlassian.net";
    process.env.ATLASSIAN_EMAIL = "me@x.com";
    process.env.ATLASSIAN_API_TOKEN = "atlassian-api-token-fixture";
    process.env.SLACK_BOT_TOKEN = "xoxb-not-a-real-token";

    const ctx = buildPassContext(dir);
    const built = new Set(ctx.sources.map((s) => s.constructor.name));
    for (const className of shippedAdapterClasses()) {
      expect([...built], `${className} was enabled in config and never constructed`).toContain(className);
    }
    // Nothing was refused: an adapter that landed on the unavailable list would have
    // passed the loop above only if some OTHER instance of its class was built.
    expect(ctx.unavailableSources.filter((u) => u.kind === "unavailable")).toEqual([]);
  });

  test("with everything turned off, nothing is constructed — so the check above tracks config", () => {
    // Non-vacuity for the whole file. If `buildPassContext` built adapters
    // unconditionally, the assertion above would pass on a vault whose operator
    // asked for none of them, and it would be measuring nothing.
    writeConfig(false);
    const ctx = buildPassContext(dir);
    expect(ctx.sources).toEqual([]);
    // …and every one of them is still ACCOUNTED FOR, by name, as off by choice.
    expect(ctx.unavailableSources.map((u) => u.name).sort()).toEqual([
      "actions",
      "atlassian",
      "deposit",
      "friction",
      "inbox",
      "slack",
      "transcript",
      "usage",
    ]);
  });
});
