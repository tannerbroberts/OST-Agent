/**
 * "Refuse a source that names no record, at write time rather than at sweep time."
 *
 * The assumption this test sits under names the sharper reading of "every channel
 * names its sources": naming a source is worthless if the name does not resolve.
 * Before this, a dangling citation was only ever caught by `ost_check`'s
 * sweep-time `unresolved-citation` rule (`test/mcp/w12-citation-resolution.test.ts`)
 * — reported, annotatable, but never refused. `ost_create_node` writes the node
 * first and lets the sweep find the dangling citation afterwards.
 *
 * **The naive fix is wrong, and the node this test hangs under says so.** Refusing
 * every citation that does not resolve at write time would have refused the exact
 * four nodes this vault shipped on 2026-08-06, each citing the live session that
 * was writing them — well-formed, real, and simply not harvested into
 * `.ost-agent/evidence/` yet, because the session had not ended. So the refusal
 * has to distinguish an id that names nothing at all from one that names a session
 * whose file already exists on disk (Claude Code writes the `.jsonl` as the
 * session runs) and just has not been read yet — `resolveClaimedSource` in
 * `src/processes/tree.ts` is that distinction, and this file is what proves
 * `ost_create_node` acts on it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import { buildPassContext } from "../../src/runner/context.js";
import { configPath } from "../../src/config/load.js";
import { Vault } from "../../src/ost/vault.js";
import { writeEvidence } from "../../src/processes/tree.js";
import { buildOstTools, type ToolContext } from "../../src/security/tools.js";
import { MCP_TOOL_NAMES } from "../../src/mcp/server.js";

const OUTCOME = "Players keep playing";

let dir: string;
let sessions: string;
let ctx: ToolContext;

/** Points `adapters.transcript` at `sessions`, the same edit `test/mcp/s1-self-feeding.test.ts` makes. */
function enableTranscript(): void {
  const raw = fs
    .readFileSync(configPath(dir), "utf8")
    .replace(/(\n {2}transcript:\n {4}enabled: )false/, "$1true")
    .replace(/(\n {4}path: )""/, `$1${JSON.stringify(sessions)}`);
  fs.writeFileSync(configPath(dir), raw, "utf8");
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-source-attribution-"));
  sessions = fs.mkdtempSync(path.join(os.tmpdir(), "ost-source-attribution-sessions-"));
  await initVault(dir, OUTCOME, OUTCOME);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(sessions, { recursive: true, force: true });
});

const create = (input: Record<string, unknown>): Promise<string> => {
  const tool = buildOstTools(ctx, MCP_TOOL_NAMES).find((t) => t.name === "ost_create_node")!;
  return (tool as unknown as { run: (i: unknown) => Promise<string> }).run(input);
};

/** The vault root's files — what "nothing landed" means for a refused write. */
const rootFiles = (): string[] =>
  fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile())
    .sort();

const GOOD = {
  layer: "Opportunity",
  parent: OUTCOME,
  body: "an idea worth testing",
  evidence: "assertion",
} as const;

describe("a citation that claims a stored evidence record is checked before it is written", () => {
  test("a source naming no record anywhere is refused, and nothing lands", async () => {
    enableTranscript();
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };

    const before = rootFiles();
    await expect(create({ ...GOOD, title: "A dangling idea", source: "INBOX:does-not-exist.md" })).rejects.toThrow(
      /claims a stored evidence record but no record/,
    );
    expect(rootFiles()).toEqual(before);
  });

  test("CONTROL — a source that resolves to a stored evidence record is accepted", async () => {
    enableTranscript();
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };
    writeEvidence(
      dir,
      { id: "INBOX:real.md", source: "INBOX:real.md", title: "real", timestamp: "2026-08-06T00:00:00Z", body: "a builder's report" },
      "inbox",
    );

    await expect(create({ ...GOOD, title: "A grounded idea", source: "INBOX:real.md" })).resolves.toMatch(/created/);
  });

  test("a live session's own id is allowed — well-formed and unharvested is not the same as nothing", async () => {
    enableTranscript();
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };

    // The exact shape of the bug this repository shipped and watched self-heal: a
    // session still running, or still inside its quiet window, has already written
    // its .jsonl to disk, and a node authored inside that same session can cite it
    // honestly before the transcript adapter has ever read it.
    const id = "89ac8277-29ce-4d80-827e-cefea0bebabf";
    fs.writeFileSync(path.join(sessions, `${id}.jsonl`), '{"type":"user"}\n', "utf8");

    await expect(create({ ...GOOD, title: "A self-observed idea", source: `TRANSCRIPT:${id}` })).resolves.toMatch(/created/);
  });

  test("CONTROL — a well-formed transcript id naming no file anywhere is still refused", async () => {
    enableTranscript();
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };

    await expect(
      create({ ...GOOD, title: "A hallucinated session", source: "TRANSCRIPT:00000000-0000-0000-0000-000000000000" }),
    ).rejects.toThrow(/claims a stored evidence record but no record/);
  });

  test("honest, non-evidence provenance is never checked", async () => {
    enableTranscript();
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };

    // WEB:, INTERVIEW: and free prose make no claim on `.ost-agent/evidence/` — see
    // `claimsStoredEvidence` and `test/mcp/w12-citation-resolution.test.ts`'s own
    // "provenance that is not an evidence id is left alone".
    await expect(create({ ...GOOD, title: "A web-sourced idea", source: "WEB:example.com/pricing" })).resolves.toMatch(/created/);
  });

  test("with the transcript channel off, a live session file on disk no longer excuses the citation", async () => {
    // Deliberately NOT calling enableTranscript(): the channel is off, so the
    // session directory this process would otherwise check is not configured at
    // all, and the "unharvested" exception has nothing to read.
    ctx = { vault: new Vault(dir), dir, remote: { enabled: false }, passContext: buildPassContext(dir) };
    const id = "off-channel-session";
    fs.writeFileSync(path.join(sessions, `${id}.jsonl`), '{"type":"user"}\n', "utf8");

    await expect(create({ ...GOOD, title: "An unreachable session", source: `TRANSCRIPT:${id}` })).rejects.toThrow(
      /claims a stored evidence record but no record/,
    );
  });
});
