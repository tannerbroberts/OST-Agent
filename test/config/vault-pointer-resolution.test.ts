/**
 * The pointer file, and the claim that anything opening the repo actually reads it.
 *
 * The friction this comes from: finding this repo's own vault took six
 * exploratory commands and a guess between four candidate directories in `$HOME`,
 * because nothing in the repo, its config or its docs said where its discovery
 * tree lived. The fix is a committed `ost.vault.yaml` at the project root — but a
 * pointer nobody is required to read changes nothing except that the information
 * is technically present. So these tests are mostly about the readers, not the
 * file.
 *
 * Three layers, because "every entry point reads it" is three different claims:
 *
 *  1. the resolver gets the right answer, and says where it came from;
 *  2. every `--vault` declaration in the CLI defers to it — checked against the
 *     source, so a command added next year cannot bring its own default back;
 *  3. commands run for real, from a project directory, with no path argument,
 *     find the vault the pointer names.
 *
 * What none of it covers, and what the assumption test cares about most: the
 * readers someone else wrote. No spec in this repository can speak for whether a
 * strange agent opening this repo looks for the file at all.
 */
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { initVault } from "../../src/runner/init.js";
import {
  describeVaultSource,
  findVaultPointer,
  readVaultPointer,
  resolveVaultDir,
  VAULT_POINTER_FILENAME,
} from "../../src/config/pointer.js";

// The local tsx binary, invoked directly rather than through `npx`: `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

const OUTCOME = "Make vault discovery cost zero exploratory commands";

/** Root holding the two directories the whole scenario is about. */
let root: string;
/** The code repository — where a session starts, and where the pointer lives. */
let project: string;
/** The vault, deliberately NOT inside the project. */
let vault: string;

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-pointer-")));
  project = path.join(root, "my-product");
  vault = path.join(root, "my-product-tree");
  fs.mkdirSync(project, { recursive: true });
  await initVault(vault, OUTCOME);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Write the pointer file a project commits at its root. */
function writePointer(body: string, dir = project): void {
  fs.writeFileSync(path.join(dir, VAULT_POINTER_FILENAME), body);
}

/**
 * Run the CLI from inside the project, with no `--vault` and no `OST_VAULT`.
 * The file is the only thing left that could be telling it where to look.
 */
function cliFromProject(args: string[]) {
  return run(TSX, [CLI, ...args], { cwd: project, env: { ...process.env, OST_VAULT: "" } });
}

describe("the pointer file itself", () => {
  test("names a vault by a path relative to the file, not to the cwd", () => {
    writePointer(`vault: ../my-product-tree\noutcome: ${OUTCOME}\n`);

    const pointer = readVaultPointer(project)!;

    expect(pointer.dir).toBe(vault);
    expect(pointer.outcome).toBe(OUTCOME);
    expect(pointer.file).toBe(path.join(project, VAULT_POINTER_FILENAME));
  });

  test("accepts a bare path on one line, because that is what a human writes", () => {
    writePointer(`../my-product-tree\n`);

    expect(readVaultPointer(project)!.dir).toBe(vault);
  });

  test("expands a leading ~, which otherwise resolves to a directory that cannot exist", () => {
    writePointer(`vault: ~/some-tree\n`);

    expect(readVaultPointer(project)!.dir).toBe(path.join(os.homedir(), "some-tree"));
  });

  test("is found by walking up, because commands get run from subdirectories", () => {
    writePointer(`vault: ../my-product-tree\n`);
    const deep = path.join(project, "src", "config");
    fs.mkdirSync(deep, { recursive: true });

    expect(findVaultPointer(deep)!.dir).toBe(vault);
  });

  test("is absent, not empty, when there is no file", () => {
    expect(readVaultPointer(project)).toBeNull();
    expect(findVaultPointer(project)).toBeNull();
  });

  test("a file that exists and cannot be used is an error naming the file", () => {
    writePointer("vault:\n  - not\n  - a path\n");

    expect(() => readVaultPointer(project)).toThrow(VAULT_POINTER_FILENAME);
  });
});

describe("resolveVaultDir — which answer wins", () => {
  test("an explicit --vault outranks the pointer file", () => {
    writePointer(`vault: ../my-product-tree\n`);

    const r = resolveVaultDir(project, { cwd: project });

    expect(r).toMatchObject({ dir: project, via: "argument" });
  });

  test("the pointer file outranks OST_VAULT, which the plugin sets for every project alike", () => {
    // This is the whole case. The plugin exports OST_VAULT=${CLAUDE_PROJECT_DIR},
    // which is right when the vault IS the project and wrong when it is not. A
    // pointer file only exists in the second case.
    writePointer(`vault: ../my-product-tree\n`);

    const r = resolveVaultDir(undefined, { cwd: project, env: project });

    expect(r.dir).toBe(vault);
    expect(r.via).toBe("pointer");
  });

  test("OST_VAULT still answers when no project committed a pointer", () => {
    const r = resolveVaultDir(undefined, { cwd: project, env: vault });

    expect(r).toMatchObject({ dir: vault, via: "environment" });
  });

  test("the cwd is the last resort, as it always was", () => {
    const r = resolveVaultDir(undefined, { cwd: project, env: undefined });

    expect(r).toMatchObject({ dir: project, via: "cwd" });
  });

  test("a broken pointer falls through and reports itself, rather than taking every command down", () => {
    // One typo in one file must not turn `ost-agent status`, `debt`, `lanes` and
    // the MCP server into stack traces — that failure mode is why `readConfig`
    // reports a problem instead of throwing.
    writePointer("vault: [oops\n");

    const r = resolveVaultDir(undefined, { cwd: project, env: vault });

    expect(r.dir).toBe(vault);
    expect(r.problem).toContain(VAULT_POINTER_FILENAME);
    expect(describeVaultSource(r)).toContain(VAULT_POINTER_FILENAME);
  });

  test("says nothing when the answer came from somewhere the operator can already see", () => {
    expect(describeVaultSource(resolveVaultDir(vault))).toBeNull();
  });

  test("names the file and the outcome when the answer came from a pointer", () => {
    writePointer(`vault: ../my-product-tree\noutcome: ${OUTCOME}\n`);

    const line = describeVaultSource(resolveVaultDir(undefined, { cwd: project }))!;

    expect(line).toContain(vault);
    expect(line).toContain(OUTCOME);
    expect(line).toContain(VAULT_POINTER_FILENAME);
  });
});

describe("every --vault declaration defers to the resolver", () => {
  // Twenty of the twenty-two used to hard-code `"."` and two read OST_VAULT, so
  // "the CLI honours the environment" was true of two commands out of
  // twenty-two. Reading the source is the only check that covers commands nobody
  // has written yet.
  const SOURCES = ["src/cli/index.ts", "src/cli/loop.ts"];

  test("no command carries its own default", () => {
    const declarations: string[] = [];
    for (const rel of SOURCES) {
      const src = fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8");
      for (const m of src.matchAll(/\.option\(\s*"--vault <dir>"([^)]*)\)/g)) {
        declarations.push(`${rel}: .option("--vault <dir>"${m[1]})`);
      }
    }

    expect(declarations.length).toBeGreaterThanOrEqual(20);
    for (const d of declarations) {
      expect(d).toContain("VAULT_OPTION_HELP");
      // A third argument to `.option` is a default value, and a default value is
      // this command opting out of the shared rule.
      expect(d.split(",")).toHaveLength(2);
    }
  });
});

describe("entry points, run from the project with no path argument", () => {
  beforeEach(() => {
    writePointer(`# Where this project's Opportunity Solution Tree lives.\nvault: ../my-product-tree\noutcome: ${OUTCOME}\n`);
  });

  // One per shape of reader: the tree summary, the two analyses, the channel
  // report, and a command registered from a different module.
  test.each([
    ["status", ["status"]],
    ["rollup", ["rollup"]],
    ["debt", ["debt"]],
    ["lanes", ["lanes"]],
    ["channels", ["channels"]],
  ])("ost-agent %s reads the vault the pointer names", async (_name, args) => {
    const { stdout, stderr } = await cliFromProject(args);

    // The project directory is not a vault, so anything that fell back to the
    // cwd fails on the missing config — the one unmistakable tell.
    expect(stderr).not.toContain("ost.config.yaml");
    expect(stdout.length).toBeGreaterThan(0);
  }, 30_000);

  test("ost-agent status shows the pointed-at tree's own outcome", async () => {
    const { stdout } = await cliFromProject(["status"]);

    expect(stdout).toContain(OUTCOME);
  }, 30_000);

  test("a command registered by another module gets the same answer", async () => {
    // `loop due` lives in src/cli/loop.ts and is attached to the same program;
    // it refuses (undeclared cadence) but it must refuse about the VAULT, not
    // about a missing config in the project directory.
    const r = await cliFromProject(["loop", "due"]).catch((e: { stdout: string; stderr: string }) => e);

    expect(`${r.stdout}${r.stderr}`).not.toContain(`no ost.config.yaml`);
    expect(r.stdout).toContain("last record");
  }, 30_000);

  test("a pointer aimed at a directory that is not a vault names itself", async () => {
    // The design's known weakness, made loud. Without this a fresh clone gets
    // `no ost.config.yaml in <a path it never chose>` and has to work out on its
    // own that a file it may not know exists is what sent it there.
    writePointer(`vault: ../moved-away\n`);

    const r = await cliFromProject(["status"]).catch((e: { stdout: string; stderr: string }) => e);

    expect(r.stderr).toContain(VAULT_POINTER_FILENAME);
    expect(r.stderr).toContain("is not a vault");
  }, 30_000);

  test("an explicit --vault still wins over the pointer", async () => {
    const other = path.join(root, "elsewhere");
    await initVault(other, "A different outcome entirely");

    const { stdout } = await cliFromProject(["status", "--vault", other]);

    expect(stdout).toContain("A different outcome entirely");
    expect(stdout).not.toContain(OUTCOME);
  }, 45_000);
});

describe("the MCP server — the entry point an agent actually arrives through", () => {
  test("serves the pointed-at vault and says which file sent it there", async () => {
    writePointer(`vault: ../my-product-tree\noutcome: ${OUTCOME}\n`);

    const stderr = await mcpBanner();

    expect(stderr).toContain(`serving ${vault}`);
    expect(stderr).toContain(VAULT_POINTER_FILENAME);
  }, 45_000);
});

/**
 * Start `ost-agent mcp` from the project directory and collect its stderr banner.
 *
 * The server never exits on its own — it is a stdio transport waiting for
 * JSON-RPC — so this reads until the banner arrives and then kills it. stdout is
 * the protocol channel and is deliberately not read.
 */
function mcpBanner(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, "mcp"], {
      cwd: project,
      env: { ...process.env, OST_VAULT: "" },
    });
    let stderr = "";
    const done = (fn: () => void) => {
      child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(() => done(() => reject(new Error(`mcp never announced itself; stderr was: ${stderr}`))), 30_000);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      // Both lines are written back-to-back after connect; wait for the second.
      if (stderr.includes("named by") || stderr.includes("No OST vault")) {
        clearTimeout(timer);
        done(() => resolve(stderr));
      }
    });
    child.on("error", (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
