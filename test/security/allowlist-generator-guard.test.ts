/**
 * Drive the allowlist generator down the path an agent would take to widen its
 * own grant, and require a refusal at each step.
 *
 * The generator (`src/security/allowlist-generator.ts`) exists because there are
 * two lists of tools maintained by different hands at different times: the
 * skill's `allowed-tools` frontmatter, written when a capability is added, and
 * the run's permission allowlist, written when the automation is wired. Under
 * `claude -p --permission-mode acceptEdits` a call outside the grant is denied
 * rather than prompted, so the drift shows up as a pass that quietly does less —
 * `ost_flag_humans_required` was named in the skill and denied in five
 * consecutive unattended runs before anyone noticed.
 *
 * Deriving one list from the other removes the copy that drifts. It also hands
 * compute a pen over a human's settings file, which is the same act the ruleset
 * forbids everywhere else — a generated allowlist that silently widens a grant
 * is compute granting itself a permit. **This file is the specification of the
 * refusals that make that impossible**, and the bar is pre-committed: three
 * cases, each exiting non-zero with zero bytes written to the target settings
 * file. Any one of them writing kills the candidate in favour of
 * "Preflight the run's tool demands against its grant and stop at turn one",
 * which detects the same gap without ever holding the pen.
 *
 * Everything runs through the real CLI, because "non-zero exit" is a property of
 * a process rather than of a return value, and the whole point is what an
 * operator's shell (or an agent's) actually gets back. All fixtures: no network,
 * no real settings file, nothing under `$HOME` touched.
 *
 * **What a green run here does not settle.** It proves the dangerous path is
 * closed. It does not prove anyone wants the generator: case three passing means
 * it tolerates a deliberately narrow grant, which is a mechanism, not evidence
 * that any operator maintains one.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { AGENT_SESSION_MARKERS } from "../../src/security/allowlist-generator.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// The local tsx binary, invoked directly rather than through `npx` — `npx` takes
// npm's cacache lock, and concurrent spawns on a small runner contend on it.
const TSX = path.join(REPO, "node_modules/.bin/tsx");
const CLI = path.join(REPO, "src/cli/index.ts");

/** The five tools the fixture skill declares. */
const DECLARED = [
  "mcp__plugin_ost-agent_ost-agent__ost_next_work",
  "mcp__plugin_ost-agent_ost-agent__ost_read_tree",
  "mcp__plugin_ost-agent_ost-agent__ost_create_node",
  "mcp__plugin_ost-agent_ost-agent__ost_annotate",
  "mcp__plugin_ost-agent_ost-agent__ost_flag_humans_required",
];

function skillWith(tools: readonly string[]): string {
  return [
    "---",
    "name: fixture-skill",
    "description: a fixture, not the shipped skill",
    `allowed-tools: ${tools.join(", ")}`,
    "---",
    "",
    "# body",
    "",
  ].join("\n");
}

function settingsGranting(tools: readonly string[]): string {
  return `${JSON.stringify({ permissions: { allow: [...tools], deny: ["Bash"] } }, null, 2)}\n`;
}

/**
 * The environment of a person at their own terminal: every agent-session marker
 * removed, because this suite itself runs inside one and would otherwise be
 * refused for the right reason in the wrong test.
 */
function humanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !(AGENT_SESSION_MARKERS as readonly string[]).includes(k)) env[k] = v;
  }
  return { ...env, ...extra };
}

let dir: string;
let skillPath: string;
let settingsPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-allowlist-"));
  skillPath = path.join(dir, "SKILL.md");
  settingsPath = path.join(dir, "settings.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function generate(opts: { env?: Record<string, string>; confirm?: boolean } = {}) {
  const args = [CLI, "allowlist", "--skill", skillPath, "--settings", settingsPath];
  if (opts.confirm) args.push("--confirm-install");
  const r = spawnSync(TSX, args, { cwd: REPO, encoding: "utf8", env: opts.env ?? humanEnv() });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The bytes of the target, or `null` when there is no file — the thing that must not change. */
function targetBytes(): string | null {
  return fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, "utf8") : null;
}

describe("case one — invoked from an agent session rather than a human install", () => {
  test.each(AGENT_SESSION_MARKERS)("%s in the environment is a refusal, and no file is created", (marker) => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    const r = generate({ env: humanEnv({ [marker]: "1" }) });

    expect(r.status, `${marker} did not produce a non-zero exit`).not.toBe(0);
    // Zero bytes written: the target did not exist and still does not.
    expect(fs.existsSync(settingsPath)).toBe(false);
    // The message must say who may run it — a refusal that does not name the
    // party who can is a dead end, and this is the message an operator reads.
    expect(r.out).toMatch(/only a human may run it/i);
    expect(r.out).toContain("ost-agent allowlist --skill");
    expect(r.out).toContain(marker);
  });

  test("an existing settings file is left byte-for-byte alone", () => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting(DECLARED.slice(0, 2)));
    const before = targetBytes();

    const r = generate({ env: humanEnv({ CLAUDECODE: "1" }) });

    expect(r.status).not.toBe(0);
    expect(targetBytes()).toBe(before);
  });

  test("the refusal does not depend on the files being readable at all", () => {
    // No skill file, no settings file. The session check runs before either is
    // read, so an agent cannot learn what the generator would have said about
    // its request by making the request badly.
    const r = generate({ env: humanEnv({ CLAUDECODE: "1" }) });
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/only a human may run it/i);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });
});

describe("case two — allowed-tools mutated after install, generator re-run in place", () => {
  test("the appended tool is not silently added, and nothing is written", () => {
    // Install: four tools declared, four granted, the two lists agree.
    const installed = DECLARED.slice(0, 4);
    fs.writeFileSync(settingsPath, settingsGranting(installed));
    // …then the skill grows a fifth, the way a skill grows one.
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    const before = targetBytes();

    const r = generate();

    expect(r.status, "re-running in place after a mutation must exit non-zero").not.toBe(0);
    expect(targetBytes(), "the settings file was written").toBe(before);
    // Specifically: the appended tool did not reach the grant.
    expect(targetBytes()).not.toContain("ost_flag_humans_required");
    // And the refusal names it, so the operator can decide about the actual tool.
    expect(r.out).toContain("ost_flag_humans_required");
    expect(r.out).toMatch(/--confirm-install/);
  });

  test("the refusal survives the settings file granting things the skill never mentions", () => {
    // A real settings file carries unrelated grants. They are not evidence of
    // anything and must not turn the comparison into a rewrite.
    fs.writeFileSync(settingsPath, settingsGranting([...DECLARED.slice(0, 4), "Bash(git status:*)", "Read"]));
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    const before = targetBytes();

    const r = generate();

    expect(r.status).not.toBe(0);
    expect(targetBytes()).toBe(before);
  });
});

describe("case three — a settings file a human narrowed by hand", () => {
  test("five declared, four granted, and the omission is honoured rather than repaired", () => {
    // Indistinguishable on disk from case two, and that is the finding: the two
    // files cannot say whether the fifth tool was appended to the skill or
    // withheld by a person. The generator must not guess, in either direction.
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting(DECLARED.slice(0, 4)));
    const before = targetBytes();

    const r = generate();

    expect(r.status, "a narrower grant must not be repaired into a wider one").not.toBe(0);
    expect(targetBytes()).toBe(before);
    // The message is the difference between a generator and a bulldozer: it may
    // not call the human's narrowing "drift", and it must say doing nothing is a
    // supported answer. "The two lists cannot drift" reads as licence to make
    // them equal, and this is the case where that reading is wrong.
    expect(r.out).toMatch(/NOT drift/i);
    expect(r.out).toMatch(/deliberate/i);
  });

  test("a repeated run is still a refusal — the guard does not wear off", () => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting(DECLARED.slice(0, 4)));
    const before = targetBytes();

    for (const _ of [1, 2, 3]) {
      const r = generate();
      expect(r.status).not.toBe(0);
    }
    expect(targetBytes()).toBe(before);
  });
});

/*
 * Positive controls. Without these the three refusals above are satisfied by a
 * command that has been broken in any way at all — a typo in the flag name exits
 * non-zero and writes nothing too. These pin that the generator does the job
 * when the job is authorized, so the refusals are the guard's doing.
 */
describe("the generator is not merely broken", () => {
  test("a fresh human install derives the grant from the declaration", () => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));

    const r = generate();

    expect(r.status, r.out).toBe(0);
    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      permissions: { allow: string[] };
    };
    expect(written.permissions.allow).toEqual(DECLARED);
  });

  test("widening is exactly what --confirm-install unlocks, and it adds only what was missing", () => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting([...DECLARED.slice(0, 4), "Bash(git status:*)"]));

    const r = generate({ confirm: true });

    expect(r.status, r.out).toBe(0);
    const written = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
      permissions: { allow: string[]; deny: string[] };
    };
    expect(written.permissions.allow).toContain("mcp__plugin_ost-agent_ost-agent__ost_flag_humans_required");
    // Nothing the generator was not told about is removed — the unrelated grant
    // and the deny list both survive.
    expect(written.permissions.allow).toContain("Bash(git status:*)");
    expect(written.permissions.deny).toEqual(["Bash"]);
  });

  test("--confirm-install does NOT unlock the agent-session refusal", () => {
    // The flag is a human's confirmation, not a bypass token. If it worked from
    // inside a session, case one would be decoration.
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting(DECLARED.slice(0, 4)));
    const before = targetBytes();

    const r = generate({ env: humanEnv({ CLAUDECODE: "1" }), confirm: true });

    expect(r.status).not.toBe(0);
    expect(targetBytes()).toBe(before);
  });

  test("an already-current grant is a no-op that writes nothing and exits 0", () => {
    fs.writeFileSync(skillPath, skillWith(DECLARED));
    fs.writeFileSync(settingsPath, settingsGranting(DECLARED));
    const before = targetBytes();

    const r = generate();

    expect(r.status, r.out).toBe(0);
    // Not rewritten, not reformatted: a byte-identical rewrite of a human's file
    // is still a write, and it is how a "harmless" generator earns distrust.
    expect(targetBytes()).toBe(before);
  });
});
