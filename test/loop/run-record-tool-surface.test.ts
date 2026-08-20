/**
 * "Every run records the tool surface it actually had" — the assumption test's
 * threshold, held directly: a run started with a tool deliberately withheld
 * writes a record naming that tool expected-and-absent; the same run started
 * with the full surface names it present; and a run whose surface could not be
 * determined says so rather than omitting the block.
 *
 * `observeToolSurface` is exercised on its own first — it is the part that
 * decides what "had" and "expected and did not get" mean — and then through
 * `startRun`, which never re-derives the observation itself: it is handed
 * whatever the caller already computed, once, which is the whole of "without
 * any tool being consulted twice" this instrument asks for. `required-tools.ts`
 * already owns the comparison; this file pins that the run record carries its
 * answer rather than growing a second one.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { readOpenRun, startRun } from "../../src/loop/health.js";
import { isToolSurfaceUnknown, observeToolSurface } from "../../src/loop/tool-surface-record.js";

const PLUGIN = "mcp__plugin_ost-agent_ost-agent__";

/** A declaration file in the shape the skill and the command files ship. */
function writeDeclaration(dir: string, opts: { required: readonly string[]; wouldUse: readonly string[] }): string {
  const file = path.join(dir, "pass.md");
  const allowed = [...opts.required, ...opts.wouldUse].map((t) => `${PLUGIN}${t}`).join(", ");
  const required = opts.required.map((t) => `${PLUGIN}${t}`).join(", ");
  fs.writeFileSync(file, `---\nname: a-pass\nallowed-tools: ${allowed}\nrequired-tools: ${required}\n---\n\nbody\n`);
  return file;
}

const REQUIRED = ["ost_next_work", "ost_read_tree", "ost_create_node"];
const WOULD_USE = ["ost_ingest_inbox"];

let dir: string;
let passFile: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-tool-surface-record-"));
  passFile = writeDeclaration(dir, { required: REQUIRED, wouldUse: WOULD_USE });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("observeToolSurface — the pure comparison", () => {
  test("a tool deliberately withheld comes back expected-and-absent", () => {
    const withheld = [...REQUIRED.filter((t) => t !== "ost_read_tree"), ...WOULD_USE].map((t) => `${PLUGIN}${t}`);
    const observed = observeToolSurface({ passFile, available: withheld });

    expect(isToolSurfaceUnknown(observed)).toBe(false);
    if (isToolSurfaceUnknown(observed)) throw new Error("unreachable");
    expect(observed.expectedAndAbsent).toEqual([`${PLUGIN}ost_read_tree`]);
    expect(observed.present).toEqual(withheld);
  });

  test("the same tool on the full surface comes back present, and nothing is named absent", () => {
    const full = [...REQUIRED, ...WOULD_USE].map((t) => `${PLUGIN}${t}`);
    const observed = observeToolSurface({ passFile, available: full });

    expect(isToolSurfaceUnknown(observed)).toBe(false);
    if (isToolSurfaceUnknown(observed)) throw new Error("unreachable");
    expect(observed.present).toContain(`${PLUGIN}ost_read_tree`);
    expect(observed.expectedAndAbsent).toEqual([]);
  });

  test("a withheld would-use tool is not reported as expected-and-absent — only required tools are", () => {
    const full = [...REQUIRED].map((t) => `${PLUGIN}${t}`);
    const observed = observeToolSurface({ passFile, available: full });

    expect(isToolSurfaceUnknown(observed)).toBe(false);
    if (isToolSurfaceUnknown(observed)) throw new Error("unreachable");
    expect(observed.expectedAndAbsent).toEqual([]);
  });

  test("an unreadable pass file comes back unknown, not an empty surface", () => {
    const observed = observeToolSurface({ passFile: path.join(dir, "does-not-exist.md"), available: [] });
    expect(isToolSurfaceUnknown(observed)).toBe(true);
    if (!isToolSurfaceUnknown(observed)) throw new Error("unreachable");
    expect(observed.unknown).toContain("does-not-exist.md");
  });

  test("a pass file with no `required-tools` line comes back unknown, not a clean surface", () => {
    const noDeclaration = path.join(dir, "undeclared.md");
    fs.writeFileSync(noDeclaration, `---\nname: a-pass\nallowed-tools: ${PLUGIN}ost_next_work\n---\n\nbody\n`);
    const observed = observeToolSurface({ passFile: noDeclaration, available: [`${PLUGIN}ost_next_work`] });
    expect(isToolSurfaceUnknown(observed)).toBe(true);
  });
});

describe("startRun — the run record carries the observation rather than re-deriving it", () => {
  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  }
  beforeEach(() => {
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    fs.writeFileSync(path.join(dir, "Root.md"), "# Root\n");
    git("add", "-A");
    git("commit", "-qm", "root");
  });

  const meta = { loopVersion: "0.0.0", cliVersion: "0.0.0" };

  test("a run started with a tool withheld writes a record naming it expected-and-absent", () => {
    const withheld = [...REQUIRED.filter((t) => t !== "ost_read_tree"), ...WOULD_USE].map((t) => `${PLUGIN}${t}`);
    const observed = observeToolSurface({ passFile, available: withheld });

    const opened = startRun(dir, { ...meta, toolSurface: observed });
    const persisted = readOpenRun(dir);

    expect(opened.toolSurface).toEqual(observed);
    expect(persisted?.toolSurface).toEqual(observed);
    if (isToolSurfaceUnknown(persisted!.toolSurface!)) throw new Error("unreachable");
    expect(persisted!.toolSurface!.expectedAndAbsent).toEqual([`${PLUGIN}ost_read_tree`]);
  });

  test("the same pass started with the full surface writes a record naming it present", () => {
    const full = [...REQUIRED, ...WOULD_USE].map((t) => `${PLUGIN}${t}`);
    const observed = observeToolSurface({ passFile, available: full });

    startRun(dir, { ...meta, toolSurface: observed });
    const persisted = readOpenRun(dir);

    if (isToolSurfaceUnknown(persisted!.toolSurface!)) throw new Error("unreachable");
    expect(persisted!.toolSurface!.present).toContain(`${PLUGIN}ost_read_tree`);
    expect(persisted!.toolSurface!.expectedAndAbsent).toEqual([]);
  });

  test("a run that cannot determine its surface records that it could not, rather than omitting the block", () => {
    const observed = observeToolSurface({ passFile: path.join(dir, "missing.md"), available: [] });

    startRun(dir, { ...meta, toolSurface: observed });
    const persisted = readOpenRun(dir);

    expect(persisted?.toolSurface).toBeDefined();
    expect(isToolSurfaceUnknown(persisted!.toolSurface!)).toBe(true);
  });

  test("a run started with no tool surface handed in omits the block, rather than fabricating one", () => {
    startRun(dir, meta);
    const persisted = readOpenRun(dir);
    expect(persisted?.toolSurface).toBeUndefined();
  });
});
