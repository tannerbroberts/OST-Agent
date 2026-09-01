/**
 * Replay the four toolless passes and see whether the check names the right file.
 *
 * The 15th through 18th scheduled passes all ran with no `ost_*` tools, because
 * the project beside the vault carried nothing enabling the ost-agent plugin —
 * the root cause took four passes and a human comparison against
 * `examples/vault/.claude/settings.json` to locate. The claim under test
 * (feasibility): that gap is mechanically diagnosable, and the diagnosis names
 * the missing file and the exact line to add.
 *
 * The four fixtures reconstruct the failing path, one plausible project state
 * per pass. The recorded root cause is a single condition — no
 * `.claude/settings.json` enabling the plugin — so four byte-identical fixtures
 * would prove nothing the first one didn't; instead each pass here is a distinct
 * way of being in that condition, which also guards against a check that keys on
 * incidentals rather than on the enabling line itself. Threshold, from the
 * assumption test: the check names the missing file and its location in at
 * least three of the four cases (these specs demand all four), with no false
 * accusation in a session that is correctly configured.
 *
 * What a green run here does NOT settle: whether the check ever fires inside a
 * session that is missing its tools. That is the sibling question "Check
 * whether a toolless session can even run the tool check" — this file only
 * proves the diagnosis is right when the check runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  diagnoseSetup,
  ENABLING_LINE,
  formatSetupDiagnosis,
  MINIMAL_SETTINGS,
  PLUGIN_KEY,
} from "../../src/config/setup-check.js";
import { renderVaultDeclaration, runningServerArtifact } from "../../src/config/vault-declaration.js";

/** The project directory a session opens — rebuilt per case. */
let project: string;

beforeEach(() => {
  project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-setup-")));
  // Every fixture is a real-looking vault-as-project, so a diagnosis cannot be
  // excused by the directory being empty: the vault is fine; the wiring is not.
  fs.writeFileSync(path.join(project, "ost.config.yaml"), 'outcome: "OST-Agent (meta)"\n');
  fs.writeFileSync(path.join(project, "Outcome.md"), "# OST-Agent (meta)\n");
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

/** Where the fix belongs in every failing case. */
function canonical(): string {
  return path.join(project, ".claude", "settings.json");
}

/**
 * The threshold's two demands, applied to one failing case: the report names
 * the file (its full path, so "its location" is not left to inference) and the
 * exact line to add.
 */
function expectNamesFileAndLine(report: string): void {
  expect(report).toContain(canonical());
  expect(report).toContain(ENABLING_LINE);
}

describe("the four toolless passes, reconstructed", () => {
  test("pass 15: no .claude directory at all — the state ost-agent-meta was found in", () => {
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("settings-file-missing");
    expect(d.file).toBe(canonical());
    expectNamesFileAndLine(formatSetupDiagnosis(d));
    // A missing file gets the whole content to create, not just the one line.
    expect(formatSetupDiagnosis(d)).toContain(MINIMAL_SETTINGS.trimEnd());
  });

  test("pass 16: .claude/ exists (a settings.local.json is there) but no settings.json", () => {
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(
      path.join(project, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Read"] } }),
    );
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("settings-file-missing");
    expectNamesFileAndLine(formatSetupDiagnosis(d));
  });

  test("pass 17: settings.json is present with unrelated keys and no enabledPlugins", () => {
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(canonical(), JSON.stringify({ permissions: { allow: ["Read", "Grep"] } }, null, 2));
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("enabling-line-missing");
    expectNamesFileAndLine(formatSetupDiagnosis(d));
  });

  test("pass 18: enabledPlugins exists but carries a different plugin, not ost-agent", () => {
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(
      canonical(),
      JSON.stringify({ enabledPlugins: { "some-other-plugin@somewhere": true } }, null, 2),
    );
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("enabling-line-missing");
    expectNamesFileAndLine(formatSetupDiagnosis(d));
  });
});

describe("no false accusation when the session is correctly configured", () => {
  test("the shipped example vault's settings, verbatim, draw no accusation", () => {
    // Read from the repository, not restated here: if the example the operator
    // is told to copy ever stops satisfying the check, this is where it shows.
    const example = fs.readFileSync(
      path.resolve(__dirname, "../../examples/vault/.claude/settings.json"),
      "utf8",
    );
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(canonical(), example);
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(true);
    expect(d.gap).toBeNull();
    expect(d.enabledBy).toBe(canonical());
    expect(formatSetupDiagnosis(d)).toContain("OK");
  });

  test("a plugin enabled at the user level is not accused at the project level", () => {
    // The enabling line can legitimately live in ~/.claude/settings.json. The
    // CLI passes that path in; here a stand-in proves the check honours it.
    const userFile = path.join(project, "home-settings.json");
    fs.writeFileSync(userFile, JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: true } }));
    const d = diagnoseSetup(project, { extraSettingsFiles: [userFile] });
    expect(d.ok).toBe(true);
    expect(d.enabledBy).toBe(userFile);
  });
});

describe("the remaining ways the canonical file can fail", () => {
  test("a file that is not JSON is reported as broken, with the file and line named", () => {
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(canonical(), "{ this is not json");
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("settings-unparseable");
    expectNamesFileAndLine(formatSetupDiagnosis(d));
  });

  test("a plugin explicitly set to false is reported as disabled, not missing", () => {
    fs.mkdirSync(path.join(project, ".claude"));
    fs.writeFileSync(canonical(), JSON.stringify({ enabledPlugins: { [PLUGIN_KEY]: false } }));
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("plugin-disabled");
    expectNamesFileAndLine(formatSetupDiagnosis(d));
  });
});

/**
 * The second route to the same tools, and the reason this check had to learn
 * about it: a directory carrying its own `.mcp.json` launches the server with no
 * plugin and no `enabledPlugins` line anywhere. Told to add one, an operator
 * would be adding a *second* copy of a server they already have — the false
 * accusation this check's own header says it must never produce.
 */
describe("a directory that declares its own tool server", () => {
  /** A declaration naming an artefact that is really on disk. */
  function declare(artifact: string): void {
    fs.writeFileSync(path.join(project, ".mcp.json"), renderVaultDeclaration(artifact));
  }

  test("is not accused of a missing settings file — it carries its own tools", () => {
    declare(runningServerArtifact() as string);
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(true);
    expect(d.gap).toBeNull();
    expect(d.enabledBy).toBe(path.join(project, ".mcp.json"));
    // And the report says which of the two routes answered, because they are
    // different facts: one follows the directory, the other follows the vault.
    expect(formatSetupDiagnosis(d)).toMatch(/declares the ost-agent server itself/);
  });

  test("a declaration naming an artefact that is not on disk is NOT called OK", () => {
    // The false-OK mirror image: present configuration, absent tools, and a
    // check that says the setup is fine is exactly as expensive as one that
    // says a correct setup is broken.
    declare(path.join(project, ".ost-agent", "bin", "ost-agent.mjs"));
    const d = diagnoseSetup(project);
    expect(d.ok).toBe(false);
    expect(d.gap).toBe("settings-file-missing");
  });

  test("a declaration for some other server enables nothing here", () => {
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { "some-other-tool": { command: "node", args: ["x.mjs"] } } }),
    );
    expect(diagnoseSetup(project).ok).toBe(false);
  });
});
