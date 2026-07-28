/**
 * Distribution invariants. The plugin must launch its own committed bundle —
 * not a registry package — and package.json must be unable to publish.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

test("the plugin launches node against the committed bundle", () => {
  const plugin = readJson(".claude-plugin/plugin.json");
  const server = plugin.mcpServers["ost-agent"];
  expect(server.command).toBe("node");
  expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs", "mcp"]);
  expect(server.env.OST_VAULT).toBe("${CLAUDE_PROJECT_DIR}");
});

test("no plugin asset reaches for npm", () => {
  const files = [
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ...fs.readdirSync(path.join(root, ".claude/commands")).map((f) => `.claude/commands/${f}`),
  ];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    expect(text, `${f} still references npx`).not.toMatch(/npx/);
    expect(text, `${f} still references npm install`).not.toMatch(/npm install/);
  }
});

test("package.json cannot publish", () => {
  const pkg = readJson("package.json");
  expect(pkg.private).toBe(true);
  expect(pkg.bin).toBeUndefined();
  expect(pkg.files).toBeUndefined();
  expect(pkg.publishConfig).toBeUndefined();
  expect(pkg.scripts.prepack).toBeUndefined();
  expect(pkg.scripts.prepublishOnly).toBeUndefined();
});

test("the committed bundle exists and is a real bundle", () => {
  const bundle = path.join(root, "dist/ost-agent.mjs");
  expect(fs.existsSync(bundle)).toBe(true);
  const text = fs.readFileSync(bundle, "utf8");
  // Inlined, not a thin wrapper around node_modules.
  expect(text.length).toBeGreaterThan(100_000);
  expect(text).not.toMatch(/require\(["']@modelcontextprotocol/);
});
