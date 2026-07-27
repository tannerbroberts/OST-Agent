/**
 * Distribution invariants. The plugin must launch its own committed bundle —
 * not a registry package — and package.json must be unable to publish.
 *
 * The bundle itself is built (package.json's "bundle" script) with a
 * `--banner:js` that installs a real `require` via node:module's
 * createRequire. Without it, esbuild's own CJS-in-ESM shim falls back to a
 * throwing Proxy, and the bundle crashes on load with
 * `Error: Dynamic require of "node:events" is not supported` — commander
 * calls `require("node:events")` etc. at its own module top level, and pure
 * ESM output has no ambient `require` for that shim to find. The banner does
 * NOT change what gets inlined — every dependency is still bundled — it only
 * gives already-inlined CJS code a working `require` to call.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const bundlePath = path.join(root, "dist/ost-agent.mjs");

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
  // Collected across the WHOLE list, not asserted file-by-file inside the
  // loop: an `expect` that throws on the first match aborts the loop, so
  // every file sorting after the first offender is silently never checked.
  // Asserting once at the end keeps any future violation's location visible
  // while still proving every file was actually checked, not just skipped
  // past.
  const violations: string[] = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    if (/npx/.test(text)) violations.push(`${f}: still references npx`);
    if (/npm install/.test(text)) violations.push(`${f}: still references npm install`);
  }
  expect(violations, "npm/npx references found (each entry names its own file)").toEqual([]);
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

/**
 * Send newline-delimited JSON-RPC `tools/call` requests to the built bundle
 * over stdio and collect the responses, keyed by request id. No MCP
 * `initialize` handshake is sent — the SDK's Server does not gate other
 * requests on it, confirmed by exercising this directly against the bundle.
 */
function callBundleTools(
  vaultDir: string,
  calls: Array<{ id: number; name: string; args: Record<string, unknown> }>,
): Promise<Map<number, { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }>> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [bundlePath, "mcp", "--vault", vaultDir], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`bundle mcp server timed out; stderr so far:\n${stderr}`));
    }, 20_000);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const responses = new Map<number, { result?: unknown; error?: unknown }>();
        for (const line of stdout.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parsed = JSON.parse(trimmed);
          if (typeof parsed.id === "number") responses.set(parsed.id, parsed);
        }
        resolve(responses as Map<number, { result?: { content?: Array<{ text?: string }>; isError?: boolean }; error?: unknown }>);
      } catch (e) {
        reject(new Error(`failed to parse bundle stdout as JSON-RPC lines: ${e}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }
    });
    const lines = calls.map((c) =>
      JSON.stringify({ jsonrpc: "2.0", id: c.id, method: "tools/call", params: { name: c.name, arguments: c.args } }),
    );
    child.stdin.write(lines.join("\n") + "\n");
    child.stdin.end();
  });
}

test(
  "the bundle actually executes tool handlers, not just tools/list",
  async () => {
    // `tools/list` only enumerates schemas; it never runs a handler body, so it
    // cannot catch a require() esbuild could not statically resolve (a computed
    // path, a lazy/conditional require of an optional peer). The --banner:js
    // createRequire shim fixes builtin requires that survive into the bundle,
    // but it also resolves third-party specifiers through normal node_modules
    // lookup — and dist/ ships with no node_modules beside it. A dependency
    // with that shape would build fine and answer tools/list fine, then fail
    // with a module-not-found error only when the specific code path
    // executes. This test drives three real handlers end to end against the
    // committed bundle (not against source) to catch exactly that:
    //   - ost_create_node: writes a node file and commits it (simple-git +
    //     gray-matter, through the write+commit path).
    //   - ost_check: reads the tree and runs the analysis modules.
    //   - ost_ingest_inbox: reads the adapter + cursor code and captures a
    //     real inbox file.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-bundle-handlers-"));
    try {
      const init = spawnSync("node", [bundlePath, "init", dir, "--outcome", "Bundle handler smoke test.", "--title", "Root"]);
      expect(init.status, init.stderr.toString()).toBe(0);

      const inboxDir = path.join(dir, ".ost-agent", "inbox");
      fs.mkdirSync(inboxDir, { recursive: true });
      fs.writeFileSync(path.join(inboxDir, "note1.md"), "A user said the export button is confusing.\n");

      const responses = await callBundleTools(dir, [
        {
          id: 1,
          name: "ost_create_node",
          args: {
            title: "Test Opportunity",
            layer: "Opportunity",
            parent: "Root",
            body: "exercised via bundle handler smoke test",
            evidence: "assertion",
          },
        },
        { id: 2, name: "ost_check", args: {} },
        { id: 3, name: "ost_ingest_inbox", args: {} },
      ]);

      const dump = () => JSON.stringify(Array.from(responses.entries()));

      const createRes = responses.get(1);
      expect(createRes?.result?.isError, dump()).not.toBe(true);
      expect(createRes?.result?.content?.[0]?.text, dump()).toMatch(/created Opportunity "Test Opportunity"/);

      const checkRes = responses.get(2);
      expect(checkRes?.result?.isError, dump()).not.toBe(true);
      expect(checkRes?.result?.content?.[0]?.text, dump()).toMatch(/invariants:/);

      const ingestRes = responses.get(3);
      expect(ingestRes?.result?.isError, dump()).not.toBe(true);
      expect(ingestRes?.result?.content?.[0]?.text, dump()).toMatch(/captured 1 new note/);

      // None of the three real results may be a deferred module-resolution
      // failure — the specific residual risk the createRequire banner leaves
      // open (see comment above).
      for (const [, res] of responses) {
        const text = res.result?.content?.[0]?.text ?? "";
        expect(text, dump()).not.toMatch(/Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
