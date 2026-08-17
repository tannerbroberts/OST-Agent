/**
 * "Be found through the agent ecosystem's own directories rather than through
 * product channels" — packaging for two directories, per
 * docs/distribution/*.json.
 *
 * The claim under test: each manifest's documented install command resolves
 * to a server that starts outside a vault. That claim used to be false — the
 * plugin manifest launched `npx -y ost-agent@latest mcp`, which resolved to
 * 0.9.0, a release that refused to start outside a vault at all (see
 * CHANGELOG.md and test/release/bundle.test.ts). Both are fixed now: npm
 * publishing was retired on purpose (docs/npm-archive.md) and the plugin
 * launches the committed bundle directly. This file is the regression guard
 * for the two NEW listings, not a re-test of that history.
 *
 * Neither manifest may reach for npm/npx — there is nothing there to resolve
 * to (package.json is private; `npm view ost-agent` 404s) — so an install
 * command built on it would fail for every visitor, not just the ones this
 * node is worried about.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundlePath = path.join(root, "dist/ost-agent.mjs");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));

/**
 * Sends one `tools/list` request over stdio and returns the parsed response
 * plus everything written to stderr. Ending stdin closes the transport, which
 * ends the process — the same mechanism test/release/bundle.test.ts relies on.
 */
function probeServer(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server timed out; stderr so far:\n${stderr}`));
    }, 15_000);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) + "\n");
    child.stdin.end();
  });
}

function assertNoRegistryReference(text: string, label: string) {
  expect(text, `${label}: still references npx`).not.toMatch(/npx/);
  expect(text, `${label}: still references npm install`).not.toMatch(/npm install/);
}

test("neither manifest's install steps reach for npm/npx", () => {
  // Scoped to the `install` block, not the whole file — a manifest's own
  // `$comment` is free to explain *why* there is no npx form without tripping
  // the guard it is describing.
  const mcpManifest = readJson("docs/distribution/mcp-directory-manifest.json");
  const pluginManifest = readJson("docs/distribution/plugin-marketplace-manifest.json");
  assertNoRegistryReference(JSON.stringify(mcpManifest.install), "mcp-directory-manifest.json install block");
  assertNoRegistryReference(JSON.stringify(pluginManifest.install), "plugin-marketplace-manifest.json install block");
});

test(
  "the generic MCP directory manifest's mcpServers block starts outside a vault",
  async () => {
    const manifest = readJson("docs/distribution/mcp-directory-manifest.json");
    const server = manifest.install.mcpServers["ost-agent"];
    expect(server.command).toBe("node");
    // The manifest documents the path as it looks right after `git clone` —
    // relative to a freshly cloned "OST-Agent" directory. In this checkout
    // that clone directory *is* the repo root, so strip the one path segment
    // the manifest adds for a reader who has not cloned yet.
    const [clonedEntry] = server.args;
    expect(clonedEntry).toBe("OST-Agent/dist/ost-agent.mjs");
    const entryPoint = clonedEntry.replace(/^OST-Agent\//, "");
    expect(path.join(root, entryPoint)).toBe(bundlePath);
    expect(fs.existsSync(bundlePath)).toBe(true);

    const outsideVault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-registry-mcp-directory-"));
    try {
      const { stdout, stderr } = await probeServer([entryPoint, "mcp"], { ...process.env, OST_VAULT: outsideVault });
      // A dead package resolution or a crash on load would show up as an empty
      // stdout / a module-resolution error on stderr, not as a clean response.
      assertNoRegistryReference(stderr, "runtime stderr");
      expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
      const response = JSON.parse(stdout.trim().split("\n").find((l) => l.trim().length > 0) ?? "{}");
      expect(response.result?.tools?.length, JSON.stringify(response)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(outsideVault, { recursive: true, force: true });
    }
  },
  20_000,
);

test(
  "the plugin marketplace manifest's source resolves to a manifest that launches the committed bundle",
  async () => {
    const registryEntry = readJson("docs/distribution/plugin-marketplace-manifest.json");
    expect(registryEntry.source).toBe("github:tannerbroberts/OST-Agent");
    expect(registryEntry.install.steps[0]).toBe("/plugin marketplace add tannerbroberts/OST-Agent");

    // What that source resolves to, in THIS checkout, is the plugin manifest
    // an aggregator's install step ultimately launches.
    const plugin = readJson(".claude-plugin/plugin.json");
    const pluginServer = plugin.mcpServers["ost-agent"];
    expect(pluginServer.command).toBe("node");
    expect(pluginServer.args[0]).toBe("${CLAUDE_PLUGIN_ROOT}/dist/ost-agent.mjs");
    const entryPoint = pluginServer.args[0].replace("${CLAUDE_PLUGIN_ROOT}", ".").replace(/^\.\//, "");
    expect(path.join(root, entryPoint)).toBe(bundlePath);

    const outsideVault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-registry-plugin-marketplace-"));
    try {
      // A plugin session sets OST_VAULT to ${CLAUDE_PROJECT_DIR} — the folder
      // the human has open, which here is deliberately not a vault.
      const { stdout, stderr } = await probeServer([entryPoint, "mcp"], { ...process.env, OST_VAULT: outsideVault });
      assertNoRegistryReference(stderr, "runtime stderr");
      expect(stderr).not.toMatch(/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
      const response = JSON.parse(stdout.trim().split("\n").find((l) => l.trim().length > 0) ?? "{}");
      expect(response.result?.tools?.length, JSON.stringify(response)).toBeGreaterThan(0);
    } finally {
      fs.rmSync(outsideVault, { recursive: true, force: true });
    }
  },
  20_000,
);
