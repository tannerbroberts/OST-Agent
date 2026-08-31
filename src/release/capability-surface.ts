/**
 * Ask the built artefact what it exposes, rather than reading the source that
 * was supposed to have built it.
 *
 * This is the half of {@link ./capability-manifest.ts} that touches the world,
 * kept separate for one reason: a manifest generated from `MCP_TOOL_NAMES` and
 * checked against `MCP_TOOL_NAMES` is a copy of a list agreeing with itself, and
 * the failure it would have to catch — `dist/ost-agent.mjs` shipping a surface
 * that is not the one the source declares — is precisely the failure both halves
 * of that comparison are blind to. `bundle-drift` covers staleness of the whole
 * file; this covers what the file actually answers to.
 *
 * Two spawns, because there are two doors into this program and they are
 * enumerated by different mechanisms:
 *
 *   - **`mcp` + `tools/list`** — what a Claude Code session can call. The
 *     JSON-RPC line protocol is used directly, with no `initialize` handshake,
 *     for the reason `test/release/bundle.test.ts` records: the SDK's `Server`
 *     does not gate other requests on it.
 *   - **`--help`** — what a shell with a `Bash(node …/ost-agent.mjs <cmd>)` grant
 *     can run. `examples/automation/*.sh` hand out exactly that grant, so a
 *     subcommand is as much of the agent's capability surface as a tool is, and
 *     a manifest that listed only tools would publish half the surface while
 *     sounding complete.
 *
 * **The limit, stated rather than implied.** An artefact that misreports itself
 * misreports itself to this module too. Nothing here is a defence against a
 * hostile build; it is a defence against an honest one that grew a capability
 * nobody wrote down, which is the failure that has actually occurred in software
 * of this shape. Authenticity is the signature's job, and the signature needs a
 * key a human holds.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACT_PATH,
  MANIFEST_PATH,
  RELEASE_KEY_PATH,
  fingerprintOf,
  verifyRelease,
  type Capability,
  type CapabilityManifest,
  type ReleaseInput,
  type ReleaseVerdict,
} from "./capability-manifest.js";

/** How long either probe may take before the release check calls the artefact broken. */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * The one line written to the child's stdin, as the bytes that go on the wire.
 *
 * Written as a literal document rather than composed with `JSON.stringify` for
 * two reasons, and the second one is not tidiness. First, what is being asserted
 * is the exact frame the MCP line protocol expects, and a reader checking it
 * against the spec should not have to run a serialiser in their head. Second,
 * `test/release/outward-mutation.test.ts` reads every literal HTTP verb key in
 * `src/` as an outward call site that must be a GET (readiness criterion P6) — a scan whose
 * value depends entirely on having no noise in it. This is a JSON-RPC method
 * name sent over a pipe to a child process, not an HTTP verb, and nothing in
 * this module touches a transport that could leave the machine; teaching that
 * gate to ignore a case would be worth less than not handing it one.
 */
const TOOLS_LIST_REQUEST = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n';

/**
 * Every capability the artefact at `artifactPath` answers to, sorted.
 *
 * Sorted here rather than by the caller so that a manifest, a verdict and a
 * report are all reading the same order; the canonical form used for signing
 * sorts again anyway, because relying on a caller to have done it is how a
 * signature ends up depending on who built the array.
 */
export async function observeArtifactSurface(artifactPath: string): Promise<Capability[]> {
  const [tools, commands] = await Promise.all([observeMcpTools(artifactPath), observeCliCommands(artifactPath)]);
  return [...tools, ...commands].sort((a, b) =>
    a.surface === b.surface ? a.name.localeCompare(b.name) : a.surface.localeCompare(b.surface),
  );
}

/** What `tools/list` returns, reduced to the two fields a manifest is about. */
interface ListedTool {
  name: string;
  inputSchema?: unknown;
}

/** The MCP tools the artefact exposes, fingerprinted by their input schemas. */
export async function observeMcpTools(artifactPath: string): Promise<Capability[]> {
  // A scratch vault, removed afterwards: `mcp` takes a `--vault` and the point of
  // the probe is the tool table, which does not depend on what is in one. Passing
  // a real vault would make the manifest a function of whichever tree the release
  // happened to be built beside.
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ost-capability-probe-"));
  try {
    const stdout = await runArtifact(artifactPath, ["mcp", "--vault", vault], TOOLS_LIST_REQUEST);
    const tools = parseToolsList(stdout);
    return tools.map((t) => ({
      name: t.name,
      surface: "mcp-tool" as const,
      fingerprint: fingerprintOf(t.inputSchema ?? null),
    }));
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
}

/** The `tools/list` result out of a stream of newline-delimited JSON-RPC responses. */
export function parseToolsList(stdout: string): ListedTool[] {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: { id?: unknown; result?: { tools?: ListedTool[] } };
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // a log line on stdout is not a protocol error; a missing result is
    }
    if (parsed.id === 1 && Array.isArray(parsed.result?.tools)) return parsed.result.tools;
  }
  throw new Error(`the artefact answered no tools/list result; stdout was:\n${stdout.slice(0, 2000)}`);
}

/** The CLI subcommands the artefact exposes, fingerprinted by their argument usage. */
export async function observeCliCommands(artifactPath: string): Promise<Capability[]> {
  const help = await runArtifact(artifactPath, ["--help"], "");
  return parseCommandTable(help).map((c) => ({
    name: c.name,
    surface: "cli-command" as const,
    fingerprint: fingerprintOf(c.usage),
  }));
}

/**
 * Commander's `Commands:` table, as name plus argument usage.
 *
 * The parse leans on the one thing commander's help layout guarantees: an entry
 * begins at exactly two spaces of indentation, and every wrapped description
 * line is indented to the description column, which is always deeper. Matching
 * `^ {2}\S` therefore takes entries and skips continuations without needing to
 * know the terminal width the help was rendered at.
 */
export function parseCommandTable(help: string): Array<{ name: string; usage: string }> {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => /^Commands:/.test(l));
  if (start < 0) throw new Error(`the artefact's --help has no "Commands:" section:\n${help.slice(0, 2000)}`);

  const commands: Array<{ name: string; usage: string }> = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // a new unindented section ends the table
    const entry = /^ {2}(\S.*)$/.exec(line);
    if (!entry) continue;
    // The term is everything up to the run of spaces that separates it from the
    // description. Commander pads with at least two.
    const term = entry[1].split(/\s{2,}/)[0].trim();
    const [name, ...usage] = term.split(/\s+/);
    if (!name) continue;
    commands.push({ name, usage: usage.join(" ") });
  }
  if (commands.length === 0) throw new Error(`the artefact's --help lists no commands:\n${help.slice(0, 2000)}`);
  return commands;
}

/**
 * Everything {@link verifyRelease} needs, read off a checkout the way an
 * operator would read it: the manifest file, the artefact's bytes, the version
 * the repository claims, the trusted key if one is published, and the surface
 * the artefact reports when asked.
 *
 * The manifest is *not* validated here beyond parsing. A hand-mangled file with
 * a missing field should come out as a named failure from the one function that
 * decides releases, not as a `TypeError` from the loader — the loader's opinion
 * about a release is exactly nothing.
 */
export async function loadRelease(repoRoot: string): Promise<ReleaseInput> {
  const manifestPath = path.join(repoRoot, MANIFEST_PATH);
  const artifactPath = path.join(repoRoot, ARTIFACT_PATH);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`no capability manifest at ${MANIFEST_PATH} — run \`npm run manifest\` and commit it`);
  }
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`no artefact at ${ARTIFACT_PATH} — run \`npm run bundle\``);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as CapabilityManifest;
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string };
  const keyPath = path.join(repoRoot, RELEASE_KEY_PATH);
  return {
    manifest,
    artifact: fs.readFileSync(artifactPath),
    observed: await observeArtifactSurface(artifactPath),
    version: pkg.version,
    trustedPublicKey: fs.existsSync(keyPath) ? fs.readFileSync(keyPath, "utf8").trim() : undefined,
  };
}

/**
 * The directory a release was laid out in: the nearest ancestor of `from` that
 * holds `dist/ost-agent.mjs`.
 *
 * Derived rather than defaulted to the working directory because the operator
 * this command exists for is running the plugin's own copy from wherever their
 * project happens to be — `node "$CLAUDE_PLUGIN_ROOT/dist/ost-agent.mjs"`, with
 * a cwd that has nothing to do with the release. Walking up from the running
 * file finds it in both shapes: from `dist/` in a plugin install, and from
 * `src/cli/` when the CLI is run out of the source tree.
 */
export function findReleaseRoot(from: string): string {
  let dir = path.resolve(from);
  for (;;) {
    if (fs.existsSync(path.join(dir, ARTIFACT_PATH))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`no ${ARTIFACT_PATH} in ${from} or any directory above it`);
    dir = parent;
  }
}

/** {@link loadRelease} then {@link verifyRelease} — the whole gate, in the order a caller wants it. */
export async function checkRelease(repoRoot: string): Promise<{ input: ReleaseInput; verdict: ReleaseVerdict }> {
  const input = await loadRelease(repoRoot);
  return { input, verdict: verifyRelease(input) };
}

/** Run the artefact, feed it `input`, and hand back stdout — or throw with what it said. */
function runArtifact(artifactPath: string, argv: readonly string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [artifactPath, ...argv], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`\`${argv.join(" ")}\` against ${artifactPath} did not finish in ${PROBE_TIMEOUT_MS}ms; stderr:\n${stderr}`));
    }, PROBE_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      // `--help` exits 0; the mcp server exits 0 once stdin closes. A non-zero
      // exit means the probe read nothing trustworthy, and guessing from partial
      // stdout is how an empty surface gets published as a small one.
      if (code !== 0) {
        reject(new Error(`\`${argv.join(" ")}\` against ${artifactPath} exited ${code}; stderr:\n${stderr}`));
        return;
      }
      resolve(stdout);
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}
