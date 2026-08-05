/**
 * The recorded failed lookups, replayed against the near-miss answer.
 *
 * The assumption under test is that a suggestion is more often right than
 * misleading — `Generate near-miss suggestions for past failures and count how
 * many point at the right thing`, threshold *at least 60% correct and at most 1
 * in 10 actively misleading*. The population is not invented here: each case
 * below is one lookup that actually failed in this project's session
 * transcripts, reconstructed as the directory shape it failed against, with the
 * intent read off the surrounding session.
 *
 * The misleading half of the threshold is the half worth having, so it is
 * asserted directly rather than inferred: `report2.txt` had a one-character
 * neighbour sitting in the same directory that was the *previous run's* output,
 * and naming it would have made a stale artefact read as this run's result. A
 * suggestion engine that scores well on the correct cases and offers that one
 * has failed this test, not passed it.
 *
 * Recorded sessions, for anyone re-deriving the fixtures:
 *   748498c4-31fb-4110-9012-464c441a463f — `sed: src/cli/index.ts: No such file`
 *   a0eb3fd4-5a36-44c1-93fc-ac8b48258cff — `cd: no such file or directory: docs/reference`
 *   42dcb7b4-f01b-40bc-a211-ed4a44a74fd3 — `cat: report2.txt: No such file`
 *   42dcb7b4-f01b-40bc-a211-ed4a44a74fd3 — a `cat` of three node filenames run together
 *   0d27cebf-9b5d-4cff-906c-0134512573bc — `ls: /Users/tanner/dev/ost-agent-meta: No such file`
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { differsOnlyInDigits, nearMiss, nearestName, renderNearMiss } from "../../src/fs/near-miss.js";
import { initVault } from "../../src/runner/init.js";
import { Vault } from "../../src/ost/vault.js";

// The local tsx binary, invoked directly rather than through `npx`: `npx` takes
// npm's cacache lock, and dozens of concurrent spawns contend on it.
const TSX = path.resolve(__dirname, "../../node_modules/.bin/tsx");
const CLI = path.resolve(__dirname, "../../src/cli/index.ts");
const run = promisify(execFile);

let tmp: string;

beforeEach(() => {
  // realpath because macOS hands out `/var/folders/...` symlinks for tmpdir, and
  // the near-miss walk reports resolved directories.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ost-near-miss-")));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function mkdirs(...dirs: string[]): void {
  for (const d of dirs) fs.mkdirSync(path.join(tmp, d), { recursive: true });
}
function touch(...files: string[]): void {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
    fs.writeFileSync(path.join(tmp, f), "x", "utf8");
  }
}

describe("the recorded failed lookups each come back with the path that was meant", () => {
  test("`src/cli/index.ts`, reached for while standing in the vault", () => {
    // 748498c4: the session had cd'd into the vault (its git remote is
    // ost-agent-meta) and reached for a file that lives in the code repo.
    mkdirs("ost-agent-meta");
    touch("ost-agent-meta/A node.md", "OST-Agent/src/cli/index.ts", "OST-Agent/package.json");

    const miss = nearMiss("src/cli/index.ts", {
      cwd: path.join(tmp, "ost-agent-meta"),
      roots: [path.join(tmp, "ost-agent-meta"), path.join(tmp, "OST-Agent")],
    });

    expect(miss.reached).toBe(path.join(tmp, "ost-agent-meta"));
    expect(miss.missing).toBe("src");
    expect(miss.present).toContain("A node.md");
    expect(miss.suggestion?.reason).toBe("elsewhere");
    expect(path.resolve(miss.reached, miss.suggestion!.path)).toBe(path.join(tmp, "OST-Agent/src/cli/index.ts"));
  });

  test("`docs/reference`, from inside docs/reference", () => {
    // a0eb3fd4: cwd was already .../docs/reference and the command opened with
    // `cd docs/reference`. The path that was meant is the one it is standing in.
    touch("OST-Agent/docs/reference/v1-readiness.md");

    const miss = nearMiss("docs/reference", { cwd: path.join(tmp, "OST-Agent/docs/reference") });

    expect(miss.suggestion?.reason).toBe("already-there");
    expect(miss.suggestion?.path).toBe(".");
    expect(miss.suggestion?.because).toContain(path.join(tmp, "OST-Agent/docs/reference"));
  });

  test("`report2.txt`, whose neighbour is the previous run's output — no suggestion", () => {
    // 42dcb7b4: `timeout: command not found` killed the writing step, so the
    // report was never created. `report.txt` in the same directory is the run
    // before it. Offering it is the failure mode this whole candidate risks.
    mkdirs("bp/v", "bp/v2", "bp/state", "bp/state2");
    touch("bp/report.txt");

    const miss = nearMiss("report2.txt", { cwd: path.join(tmp, "bp") });

    expect(miss.missing).toBe("report2.txt");
    // The listing still hands the caller everything it needs to decide for itself.
    expect(miss.present).toEqual(["report.txt", "state", "state2", "v", "v2"]);
    expect(miss.suggestion).toBeUndefined();
    expect(renderNearMiss(miss)).toContain("nothing there is close enough to name");
  });

  test("the missing node file — three filenames run together by one shell expansion", () => {
    // 42dcb7b4: `f=$(grep -l ... *.md | head -3)` produced three newline-separated
    // names and `cat "$x"` took all three as one path. Every one of them is real.
    const names = [
      "Acceptance rate of five self-drafted ruleset changes.md",
      "Add the pointer file and count how many tools actually look for it unprompted.md",
      "Ask ten buyers to split a test's price between designing it and running it.md",
    ];
    touch(...names.map((n) => `vault/${n}`));

    const miss = nearMiss(names.join("\n"), { cwd: path.join(tmp, "vault") });

    expect(miss.suggestion?.reason).toBe("one-of-several");
    expect(miss.suggestion?.path).toBe(names[0]);
    expect(miss.suggestion?.because).toContain("3 names together");
  });

  test("the node's own worked example — a wrong path segment one level up", () => {
    // 0d27cebf: `ls /Users/tanner/dev/ost-agent-meta` when the vault is at
    // /Users/tanner/ost-agent-meta. Off by one segment, and it cost a call.
    mkdirs("dev/OST-Agent", "dev/ost-benchmarks", "ost-agent-meta");

    const miss = nearMiss(path.join(tmp, "dev/ost-agent-meta"), { cwd: tmp });

    expect(miss.reached).toBe(path.join(tmp, "dev"));
    expect(miss.present).toEqual(["OST-Agent", "ost-benchmarks"]);
    expect(miss.suggestion?.path).toBe(path.join(tmp, "ost-agent-meta"));
    // The sentence the solution node wrote out by hand, in the shape it wrote it.
    expect(renderNearMiss(miss)).toBe(
      `${path.join(tmp, "dev")} exists and contains OST-Agent, ost-benchmarks; ` +
        `did you mean ${path.join(tmp, "ost-agent-meta")}? — "ost-agent-meta" does not exist under ` +
        `${path.join(tmp, "dev")}, but it does exist at ${path.join(tmp, "ost-agent-meta")}`,
    );
  });
});

describe("what it refuses to suggest, which is the half that decides the test", () => {
  test("a numbered sibling is never offered as a correction", () => {
    expect(differsOnlyInDigits("report.txt", "report2.txt")).toBe(true);
    expect(differsOnlyInDigits("v", "v2")).toBe(true);
    expect(differsOnlyInDigits("state", "state2")).toBe(true);
    // A real typo carries no digit difference and stays suggestible.
    expect(differsOnlyInDigits("index.ts", "idnex.ts")).toBe(false);
    expect(nearestName("report2.txt", ["report.txt", "report3.txt"])).toBeUndefined();
  });

  test("a tie is silence, because the evidence does not pick one", () => {
    expect(nearestName("indes.ts", ["index.ts", "indez.ts"])).toBeUndefined();
    expect(nearestName("index.ts", ["indez.ts"])).toBe("indez.ts");
  });

  test("a segment too short for distance to mean anything gets no guess", () => {
    expect(nearestName("v", ["x", "y", "z"])).toBeUndefined();
    // …except a pure case difference, which is only ever a typo.
    expect(nearestName("ci", ["CI", "docs"])).toBe("CI");
  });

  test("the ancestor search stays inside a boundary it was given", () => {
    mkdirs("repo/src", "wanted");
    touch("repo/package.json");
    const confined = nearMiss("wanted", { cwd: path.join(tmp, "repo"), confineTo: path.join(tmp, "repo") });
    expect(confined.suggestion).toBeUndefined();
    // Without the boundary the same lookup finds it — so the refusal above is the
    // confinement doing work, not the fixture being empty.
    expect(nearMiss("wanted", { cwd: path.join(tmp, "repo") }).suggestion?.reason).toBe("elsewhere");
  });

  test("dotfiles never appear in the listing a miss hands back", () => {
    mkdirs("repo/.git", "repo/.ost-agent", "repo/src");
    const miss = nearMiss("nope", { cwd: path.join(tmp, "repo") });
    expect(miss.present).toEqual(["src"]);
  });
});

describe("the surfaces that used to answer with only the refusal", () => {
  test("a mistyped --vault names the vault instead of offering to create one", async () => {
    // The pre-existing answer was `no ost.config.yaml in <typo> — run
    // `ost-agent init` first`, which for a one-segment typo is advice to build a
    // second empty tree at the wrong path.
    await initVault(path.join(tmp, "ost-agent-meta"), "Reach ten returning operators.", "Retention");
    mkdirs("dev/OST-Agent");

    const failure = await run(TSX, [CLI, "status", "--vault", path.join(tmp, "dev/ost-agent-meta")], {
      cwd: path.resolve(__dirname, "../.."),
    }).then(
      () => null,
      (e: { stderr: string }) => e.stderr,
    );

    expect(failure).not.toBeNull();
    expect(failure).toContain("that directory does not exist");
    expect(failure).toContain(path.join(tmp, "ost-agent-meta"));
    expect(failure).not.toContain("ost-agent init");
  });

  test("a node lookup that is one apostrophe out names the node it meant", async () => {
    const dir = path.join(tmp, "vault");
    await initVault(dir, "Reach ten returning operators.", "Retention");
    const vault = new Vault(dir);
    const real = "Ask ten buyers to split a test's price between designing it and running it";
    fs.writeFileSync(path.join(dir, `${real}.md`), "---\ntype: Solution\n---\n#Solution\n\nbody\n", "utf8");

    // The typographic apostrophe a model writes where the file has an ASCII one.
    expect(() => vault.read(real.replace("'", "’"))).toThrow(`did you mean "${real}"?`);
  });

  test("a node lookup with nothing close still says so plainly", async () => {
    const dir = path.join(tmp, "vault");
    await initVault(dir, "Reach ten returning operators.", "Retention");
    const vault = new Vault(dir);
    expect(() => vault.read("nothing like any title on disk at all")).toThrow(/^no such node: /);
  });
});
