/**
 * Write a manifest for every helper this project installs, then check whether
 * the manifests catch the failure already seen — and, separately, how much a
 * careful author leaves out.
 *
 * The assumption test fixed the bar before anything was counted: **the
 * manifests catch the known failure, and each omits at most 1 real
 * dependency.** The known failure is `/Users/tanner/.local/bin/ost-reports:
 * line 21: mapfile: command not found` — a bash 4.0 builtin reaching macOS's
 * bash 3.2, installed, executable, on the PATH, and dead at its first real
 * statement.
 *
 * The count is in: **the catch lands, and 0 of 5 manifests omit anything** —
 * across the two shipped automation scripts, the generated pre-commit hook, and
 * the recorded `ost-reports` helper in both its broken and its fixed form.
 *
 * ## Four findings the node did not contain
 *
 * **1. The manifest cannot always live in the helper, and the exception is not
 * exotic.** The design that makes an install-time preflight possible at all is
 * that requirements travel *inside* the file being copied — which is why the
 * generated hook can carry one. Two of the five helpers here cannot: they are
 * verbatim copies of a live artefact whose line numbers another spec pins
 * (`mapfile` must land on line 21). Prepending eleven comment lines would move
 * it. So a sidecar exists, and the general case it stands for is ordinary: **a
 * helper you did not author cannot be made to declare anything.**
 *
 * **2. A real dependency can be invisible to any command-position analysis, and
 * both examples are in one helper.** `autonomous-pass.sh` needs `claude` and
 * `rm`. Neither is ever in command position: `claude` is an *argument* to
 * `ost-agent loop step`, and `rm` is inside a single-quoted `trap` body that is
 * deferred code. Both are declared and both are reported below as "declared but
 * not seen in the script" — so the omission diff's floor is real but its
 * ceiling is not: it under-counts by exactly the amount a wrapper or a trap
 * hides.
 *
 * **3. The extraction the diff depends on is the part that can quietly fail,
 * and the compat lint's scanner is not reusable for it.** `activeLines` keeps
 * double-quoted spans on purpose, because `"${v,,}"` is a real 4.0 dependency.
 * Run over these helpers — which are mostly English — it turns the sentence
 * "Build loop ran N instrument(s)" into commands named `instrument` and `s`,
 * and it resets its quote state per line, so the hook's multi-line
 * single-quoted `awk` program becomes shell contributing `sub` and `prevfile`.
 * Before {@link evaluatedCommandText} existed, the honest measure read 48
 * omissions against `build-pass.sh`, none of them a command. Every one of those
 * failure modes is asserted below, because a scanner that has quietly gone
 * silent produces a *perfect* omission score.
 *
 * **4. The bias in the sample is not removed by any of this.** These manifests
 * were written by hand by somebody looking straight at this class of problem.
 * That they came out complete measures the manifests this project happens to
 * have on one afternoon; it says nothing about the discipline holding, and the
 * discipline is the mechanism. The node said so first and the green run does
 * not answer it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { ensurePreCommitHook, HOOK_SIGNATURE, PRE_COMMIT_HOOK, preCommitHookManifest } from "../../src/git/conflict-guard.js";
import { discoverShippedHelpers, generatedHelper, shebangInterpreter, type Helper } from "../../src/runner/bash-compat-lint.js";
import {
  builtinIntroducedIn,
  definedFunctions,
  evaluatedCommandText,
  formatHelperRefusal,
  formatManifestCoverage,
  hasManifest,
  manifestCoverage,
  manifestOmissions,
  manifestOverdeclarations,
  parseHelperManifest,
  preflightHelper,
  statedMachine,
  usedCommands,
  type HelperManifest,
} from "../../src/runner/helper-manifest.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const compatFixtures = path.join(repoRoot, "test", "fixtures", "bash-compat");
const manifestFixtures = path.join(repoRoot, "test", "fixtures", "helper-manifest");

function recordedHelper(file: string): Helper {
  const source = fs.readFileSync(path.join(compatFixtures, file), "utf8");
  return { name: `test/fixtures/bash-compat/${file}`, origin: "recorded", interpreter: shebangInterpreter(source), source };
}

/**
 * Every helper this project puts on a machine, paired with the manifest that
 * travels with it — inside the file where it can, beside it where it cannot.
 */
const CORPUS: { helper: Helper; manifest: HelperManifest }[] = [
  ...discoverShippedHelpers(repoRoot),
  generatedHelper("pre-commit (ost-agent conflict guard)", PRE_COMMIT_HOOK),
  recordedHelper("ost-reports.recorded.sh"),
  recordedHelper("ost-reports.fixed.sh"),
].map((helper) => {
  const sidecar = path.join(manifestFixtures, `${path.basename(helper.name, ".sh")}.manifest`);
  const declaration = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, "utf8") : helper.source;
  return { helper, manifest: parseHelperManifest(helper.name, declaration) };
});

/** The machine the known failure actually happened on. */
const MACOS = statedMachine({
  interpreters: { bash: "3.2", sh: "3.2" },
  commands: {
    bash: "/bin/bash", sh: "/bin/sh", ls: "/bin/ls", sort: "/usr/bin/sort", basename: "/usr/bin/basename",
    head: "/usr/bin/head", tail: "/usr/bin/tail", fold: "/usr/bin/fold", sed: "/usr/bin/sed",
    tr: "/usr/bin/tr", cut: "/usr/bin/cut", wc: "/usr/bin/wc", seq: "/usr/bin/seq", awk: "/usr/bin/awk",
    git: "/usr/bin/git", node: "/usr/local/bin/node", claude: "/usr/local/bin/claude",
    mktemp: "/usr/bin/mktemp", mkdir: "/bin/mkdir", rm: "/bin/rm", mv: "/bin/mv", cat: "/bin/cat",
    date: "/bin/date", grep: "/usr/bin/grep", find: "/usr/bin/find", comm: "/usr/bin/comm",
    dirname: "/usr/bin/dirname",
  },
});

// ── the declaration, before any helper is read ───────────────────────────────

describe("a requirement is a kind, a symbol and a reason", () => {
  test("a well-formed directive parses into all three", () => {
    const m = parseHelperManifest("probe", "#!/bin/bash\n# ost-requires: command jq — parses the API response\n");
    expect(m.requires).toEqual([{ kind: "command", symbol: "jq", minimum: null, why: "parses the API response", line: 2 }]);
    expect(m.malformed).toEqual([]);
  });

  test("a requirement with no reason is malformed, because the reason is what survives the next author", () => {
    const m = parseHelperManifest("probe", "# ost-requires: command jq\n");
    expect(m.requires).toEqual([]);
    expect(m.malformed).toHaveLength(1);
    expect(m.malformed[0].problem).toMatch(/no reason given/);
  });

  test("an unreadable directive is surfaced, never dropped — a manifest that cannot read itself must not preflight clean", () => {
    const m = parseHelperManifest("probe", "# ost-requires: binary jq — nope, that is not a kind\n");
    expect(m.requires).toEqual([]);
    const verdict = preflightHelper(m, MACOS);
    expect(verdict.ok).toBe(false);
    expect(verdict.unsatisfied[0].verdict).toBe("undecidable");
  });

  test("an explicit minimum is read, and so is the em-dash-free `--` form", () => {
    const m = parseHelperManifest("probe", "# ost-requires: interpreter bash >= 4.2 -- declare -g\n");
    expect(m.requires[0].minimum).toEqual({ major: 4, minor: 2 });
    expect(m.requires[0].why).toBe("declare -g");
  });

  test("a builtin's release comes from the compat lint's table, so the author declares usage rather than a version", () => {
    expect(builtinIntroducedIn("mapfile")).toEqual({ major: 4, minor: 0 });
    expect(builtinIntroducedIn("printf")).toBeNull();
  });
});

// ── the control: what the extraction reads, and what it refuses to read ──────
//
// Every case here is a way the omission diff can silently read zero. A scanner
// that stopped matching produces a perfect score, which is why the quiet side is
// asserted as hard as the loud one.

describe("only what the shell runs as a command is read as one", () => {
  const commands = (source: string) =>
    usedCommands({ name: "probe", origin: "recorded", interpreter: "bash", source }).map((u) => u.command);

  test("a plain pipeline yields each stage", () => {
    expect(commands("#!/bin/bash\nls -1 | sort -r | head -3\n")).toEqual(["ls", "sort", "head"]);
  });

  test("English inside double quotes is prose, not a command list", () => {
    // The exact shape that produced 48 false omissions against build-pass.sh.
    expect(commands('#!/bin/bash\necho "Build loop ran 3 instrument(s) from the build loop"\n')).toEqual([]);
  });

  test("but a command substitution inside a double-quoted string is still a command", () => {
    expect(commands('#!/bin/bash\nprintf \'%s\' "$(cat "$FILE") and $(date +%s)"\n')).toEqual(["cat", "date"]);
  });

  test("a multi-line single-quoted program is data all the way to its closing quote", () => {
    const source = "#!/bin/sh\nawk -F: '\n  { file = $1\n    sub(/x/, \"\", file)\n    next }\n'\n";
    expect(commands(source)).toEqual(["awk"]);
  });

  test("a line continuation does not put its next line's first word in command position", () => {
    // `git … \` then `commit -q -m …` is one invocation of git, not one of `commit`.
    expect(commands('#!/bin/bash\ngit -C "$D" -c user.name="x" \\\n  commit -q -m "msg"\n')).toEqual(["git"]);
  });

  test("`$((…))` is arithmetic, not a command substitution", () => {
    expect(commands("#!/bin/bash\nN=$(( COUNT + 1 ))\necho $((N-1))\n")).toEqual([]);
  });

  test("a quoted heredoc body is inert, and an unquoted one still runs its substitutions", () => {
    // `cat` is the command the heredoc feeds; `git push --force` inside the body is not.
    expect(commands("#!/bin/bash\ncat <<'P'\ngit push --force\nP\n")).toEqual(["cat"]);
    expect(commands("#!/bin/bash\ncat <<P\nthe tree says: $(node cli rollup)\nP\n")).toEqual(["cat", "node"]);
  });

  test("a `#` inside a word does not open a comment", () => {
    expect(commands("#!/bin/bash\nN=${#FILES[@]}\njq . file\n")).toEqual(["jq"]);
  });

  test("builtins the floor already has are not machine dependencies; ones above it are", () => {
    expect(commands("#!/bin/bash\nprintf x\ncd /tmp\nread -r line\n")).toEqual([]);
    expect(commands("#!/bin/bash\nmapfile -t A < <(ls)\n")).toEqual(["mapfile", "ls"]);
  });

  test("a function the script defines is not a dependency on the machine", () => {
    const source = "#!/bin/bash\nreport() {\n  printf '%s' \"$1\"\n}\nreport hello\njq . x\n";
    expect(definedFunctions(source).has("report")).toBe(true);
    expect(commands(source)).toEqual(["jq"]);
  });

  test("a command built at runtime is not read, and the diff is a floor because of it", () => {
    expect(commands('#!/bin/bash\n"$CMD" --flag\neval "$LINE"\n')).toEqual([]);
  });
});

// ── the subject: a sweep that read nothing must not report clean ─────────────

describe("every helper this project installs is in the corpus, and every one carries a manifest", () => {
  test("the corpus is discovered rather than listed, and it is not empty", () => {
    const names = CORPUS.map((c) => c.helper.name);
    expect(names).toContain("examples/automation/autonomous-pass.sh");
    expect(names).toContain("examples/automation/build-pass.sh");
    expect(names).toContain("pre-commit (ost-agent conflict guard)");
    expect(CORPUS.length).toBeGreaterThanOrEqual(5);
    for (const { helper } of CORPUS) expect(helper.source.length, `${helper.name} is empty`).toBeGreaterThan(0);
  });

  test("every helper carries a manifest, and no manifest has a line that could not be read", () => {
    for (const { helper, manifest } of CORPUS) {
      expect(hasManifest(manifest), `${helper.name} carries no manifest`).toBe(true);
      expect(manifest.malformed, `${helper.name} has an unreadable directive`).toEqual([]);
    }
  });

  test("the extraction actually read each script — a silent reader would score perfectly", () => {
    for (const { helper } of CORPUS) {
      expect(usedCommands(helper).length, `nothing was extracted from ${helper.name}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── the threshold, half one: the manifests catch the known failure ───────────

describe("the known `mapfile` failure is caught at install time, on the machine it happened on", () => {
  const recorded = CORPUS.find((c) => c.helper.name.endsWith("ost-reports.recorded.sh"))!;

  test("the helper that uses `mapfile` declares it", () => {
    expect(recorded.manifest.requires.map((r) => r.symbol)).toContain("mapfile");
    expect(usedCommands(recorded.helper).map((u) => u.command)).toContain("mapfile");
  });

  test("installing it on macOS's bash 3.2 is refused, naming what is missing and what was found instead", () => {
    const verdict = preflightHelper(recorded.manifest, MACOS);
    expect(verdict.ok).toBe(false);
    const unmet = verdict.unsatisfied.filter((u) => u.requirement.symbol === "mapfile");
    expect(unmet).toHaveLength(1);
    expect(unmet[0].verdict).toBe("too-old");
    // `… line 21: mapfile: command not found` is what the machine says instead.
    expect(unmet[0].found).toBe("bash 3.2");
    expect(unmet[0].needs).toMatch(/bash 4\.0 or newer/);
    const refusal = formatHelperRefusal(verdict);
    expect(refusal).toMatch(/REFUSING to install/);
    expect(refusal).toMatch(/mapfile/);
    expect(refusal).toMatch(/bash 3\.2/);
  });

  test("the same helper after its fix installs cleanly on the same machine — the negative control", () => {
    const fixed = CORPUS.find((c) => c.helper.name.endsWith("ost-reports.fixed.sh"))!;
    expect(preflightHelper(fixed.manifest, MACOS)).toMatchObject({ ok: true, unsatisfied: [] });
  });

  test("every other helper installs cleanly on that machine, so the refusal is a finding rather than the default", () => {
    for (const { helper, manifest } of CORPUS) {
      if (helper.name.endsWith("ost-reports.recorded.sh")) continue;
      const verdict = preflightHelper(manifest, MACOS);
      expect(verdict.ok, formatHelperRefusal(verdict)).toBe(true);
    }
  });

  test("a machine missing a plain command is refused too — the gap the version lint cannot see", () => {
    const noJq = statedMachine({ interpreters: { bash: "5.2" }, commands: { bash: "/bin/bash" } });
    const manifest = parseHelperManifest("probe", "#!/bin/bash\n# ost-requires: command jq — parses the API response\n");
    const verdict = preflightHelper(manifest, noJq);
    expect(verdict.unsatisfied[0]).toMatchObject({ verdict: "missing", found: "not on PATH" });
    expect(formatHelperRefusal(verdict)).toMatch(/declared because: parses the API response/);
  });

  test("a machine the probe cannot read is not a pass — an undecidable requirement blocks", () => {
    const unreadable = statedMachine({ interpreters: {}, commands: { bash: "/bin/bash" } });
    const manifest = parseHelperManifest("probe", "#!/bin/bash\n# ost-requires: builtin mapfile — reads a listing\n");
    const verdict = preflightHelper(manifest, unreadable);
    expect(verdict.ok).toBe(false);
    expect(verdict.unsatisfied[0].verdict).toBe("undecidable");
  });
});

// ── the threshold, half two: the honest measure ──────────────────────────────
//
// The clause a careless author can actually fail. Weighted above the catch by
// the assumption test, because the catch is nearly free once manifests exist.

describe("no manifest omits more than one command its script genuinely invokes", () => {
  const rows = CORPUS.map(({ helper, manifest }) => manifestCoverage(helper, manifest));

  test("the omission diff, per helper, against a bar of 1", () => {
    for (const { helper, manifest } of CORPUS) {
      const omitted = manifestOmissions(manifest, helper);
      expect(omitted.map((o) => `${o.command}:${o.line}`), `${helper.name} — ${formatManifestCoverage(rows)}`).toEqual([]);
      expect(omitted.length).toBeLessThanOrEqual(1);
    }
  });

  test("the diff can fail — an empty manifest over a real script omits everything", () => {
    const build = CORPUS.find((c) => c.helper.name.endsWith("build-pass.sh"))!;
    const empty = parseHelperManifest(build.helper.name, "#!/usr/bin/env bash\n");
    expect(manifestOmissions(empty, build.helper).length).toBeGreaterThan(10);
  });

  test("what the diff cannot see is named rather than left as a clean score", () => {
    // `claude` is an argument to `ost-agent loop step`; `rm` is inside a
    // single-quoted trap body. Both are real needs, both are declared, and
    // neither is ever in command position for any analysis of this kind.
    const auto = CORPUS.find((c) => c.helper.name.endsWith("autonomous-pass.sh"))!;
    expect(manifestOverdeclarations(auto.manifest, auto.helper).map((r) => r.symbol).sort()).toEqual(["claude", "rm"]);
    expect(auto.helper.source).toMatch(/trap 'rm -f/);
    expect(auto.helper.source).toMatch(/loop step --phase pass --vault \. -- \\\n\s+claude -p/);
  });
});

// ── the install this product actually performs ───────────────────────────────

describe("installation runs the helper's own preflight and refuses what cannot run here", () => {
  const tempRepo = (): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ost-hook-preflight-"));
    fs.mkdirSync(path.join(dir, ".git", "hooks"), { recursive: true });
    return dir;
  };

  test("the generated hook carries its manifest inside itself, because that is the only thing that gets copied", () => {
    const manifest = preCommitHookManifest();
    expect(manifest.requires.map((r) => r.symbol).sort()).toEqual(["awk", "git", "sh", "tr"]);
    expect(PRE_COMMIT_HOOK).toContain("# ost-requires: command awk");
  });

  test("a machine without `awk` gets the refusal instead of the file", () => {
    const dir = tempRepo();
    const noAwk = statedMachine({ interpreters: { sh: "3.2" }, commands: { sh: "/bin/sh", git: "/usr/bin/git", tr: "/usr/bin/tr" } });
    const verdict = ensurePreCommitHook(dir, noAwk);
    expect(verdict).toMatch(/^refused: /);
    expect(verdict).toMatch(/awk — not on PATH/);
    expect(verdict).toMatch(/pairs each opening conflict marker/);
    expect(fs.existsSync(path.join(dir, ".git", "hooks", "pre-commit"))).toBe(false);
  });

  test("a machine that has everything gets the hook", () => {
    const dir = tempRepo();
    expect(ensurePreCommitHook(dir, MACOS)).toBe("installed");
    expect(fs.readFileSync(path.join(dir, ".git", "hooks", "pre-commit"), "utf8")).toContain(HOOK_SIGNATURE);
  });

  test("this machine can run it, so the repo's own hook install is not refused in practice", () => {
    // The real probe, against the real PATH. If this fails, the machine running
    // the suite genuinely cannot run the hook, which is the thing worth knowing.
    const dir = tempRepo();
    expect(ensurePreCommitHook(dir)).toBe("installed");
  });
});

// ── what green does NOT settle, stated with the measurement ──────────────────

describe("the limits are asserted rather than left to the reader", () => {
  test("a helper that declares nothing is unchecked, not clean", () => {
    const nothing = parseHelperManifest("probe", "#!/bin/bash\nls\n");
    const verdict = preflightHelper(nothing, MACOS);
    expect(verdict.ok).toBe(false);
    expect(formatHelperRefusal(verdict)).toMatch(/declares no requirements, so nothing about this machine was checked/);
  });

  test("the sidecar exists because a helper you did not author cannot be made to declare anything", () => {
    // The recorded fixtures are verbatim copies pinned line-for-line by the
    // compat lint's expected findings: `mapfile` must stay on line 21.
    const recorded = fs.readFileSync(path.join(compatFixtures, "ost-reports.recorded.sh"), "utf8");
    expect(recorded).not.toContain("ost-requires");
    expect(recorded.split("\n")[20]).toMatch(/mapfile/);
    expect(fs.existsSync(path.join(manifestFixtures, "ost-reports.recorded.manifest"))).toBe(true);
  });

  test("the scanner's own blind spots are the reason the omission count is a floor", () => {
    const source = '#!/bin/bash\nxargs jq . <list\nsudo systemctl restart x\n';
    // Both real dependencies are attributed to their wrapper and neither `jq`
    // nor `systemctl` is counted, so a manifest omitting them scores clean.
    expect(usedCommands({ name: "probe", origin: "recorded", interpreter: "bash", source }).map((u) => u.command)).toEqual([
      "xargs",
      "sudo",
    ]);
  });

  test("the evaluated text keeps line numbers, so a finding points at the real place in the file", () => {
    const lines = evaluatedCommandText("#!/bin/bash\n# a comment\njq . file\n");
    expect(lines).toHaveLength(4);
    expect(lines[1].text.trim()).toBe("");
    expect(lines[2]).toMatchObject({ line: 3, text: "jq . file", continuesPrevious: false });
  });
});
