/**
 * Run a bash 3.2 linter over every helper this project installs, and count
 * what it flags and what it misses.
 *
 * The assumption test fixed the bar before anything was counted: **the known
 * failure is flagged, with at most 2 false alarms across all helpers.** The
 * known failure is `/Users/tanner/.local/bin/ost-reports: line 21: mapfile:
 * command not found` — a bash 4.0 builtin reaching macOS's bash 3.2, decided at
 * authoring time and discovered at run time on the author's own hardware.
 *
 * The count is in: **1 flagged, 0 false alarms** across five helpers — the two
 * shipped automation scripts, the generated pre-commit hook, and the recorded
 * helper in both its broken and its fixed form.
 *
 * ## Three findings the node did not contain
 *
 * **1. The off-the-shelf linter cannot express this floor.** The solution node
 * says "configure an existing shell linter to a bash 3.2 floor", and the
 * assumption test calls the experiment small because "the linter exists off the
 * shelf". ShellCheck 0.11.0 selects a dialect by *family* — `sh`, `bash`,
 * `dash`, `ksh`, `busybox` — and has no option anywhere naming a bash version.
 * Recorded in `test/fixtures/bash-compat/shellcheck.json` and asserted below:
 * under `-s bash`, the dialect these helpers actually declare, **none of the
 * seven above-floor constructs on the probe is flagged at all**, `mapfile`
 * included. The obvious configuration misses the known failure silently.
 *
 * **2. `-s sh` catches it and drowns it.** The other setting raises 15 SC3xxx
 * findings against this project's own two helpers, and every one resolves —
 * through `SHELLCHECK_POSIX_CODES`, asserted below — to a construct bash 3.2
 * has had for twenty years. That is 15 false alarms against a bar of 2. The
 * node's hazard clause named the right risk; it just did not know the
 * off-the-shelf route trips it by 7.5×.
 *
 * **3. Two of ShellCheck's codes cannot be resolved to a version at all.**
 * `SC3044` is "in POSIX sh, X is undefined" for every builtin: it is the code
 * that fires on `mapfile` (4.0, real) and on `declare` (2.0, fine). `SC3028`
 * does the same for variables. The release lives in the English of the message,
 * not in the classification — so even the `-s sh` route has to re-derive a
 * version table before it can sort catches from false alarms, which is the
 * work the off-the-shelf claim assumed away.
 *
 * ## Why the false-alarm half is asserted in both directions
 *
 * The catch was never the doubtful part — the rule reads what the script does
 * rather than what someone declared. What kills a check like this is people
 * learning to ignore it, so the controls below are as load-bearing as the
 * catch: the same helper before and after its fix, where the fix's own comment
 * says the word `mapfile`; a 500-line English heredoc that must not be read as
 * shell; and a probe of seven above-floor constructs that must all be caught,
 * so a rule table that had quietly stopped matching could not pass by being
 * silent everywhere.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PRE_COMMIT_HOOK } from "../../src/git/conflict-guard.js";
import {
  activeLines,
  aboveFloor,
  BASH_32_FLOOR,
  BASH_FEATURES,
  bashCompatReport,
  bashVersion,
  discoverShippedHelpers,
  formatBashCompatReport,
  generatedHelper,
  lintBashCompat,
  shebangInterpreter,
  shellcheckFloorVerdict,
  SHELLCHECK_POSIX_CODES,
  type Helper,
} from "../../src/runner/bash-compat-lint.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtureDir = path.join(repoRoot, "test", "fixtures", "bash-compat");

function recordedHelper(file: string): Helper {
  const source = fs.readFileSync(path.join(fixtureDir, file), "utf8");
  return {
    name: `test/fixtures/bash-compat/${file}`,
    origin: "recorded",
    interpreter: shebangInterpreter(source),
    source,
  };
}

/** Every helper the check runs over: discovered, generated, and recorded. */
const HELPERS: Helper[] = [
  ...discoverShippedHelpers(repoRoot),
  generatedHelper("src/git/conflict-guard.ts#PRE_COMMIT_HOOK", PRE_COMMIT_HOOK),
  recordedHelper("ost-reports.recorded.sh"),
  recordedHelper("ost-reports.fixed.sh"),
];

const EXPECTED: { floor: string; expected: { helper: string; line: number; feature: string }[] } = JSON.parse(
  fs.readFileSync(path.join(fixtureDir, "expected-findings.json"), "utf8"),
);

const SHELLCHECK: {
  tool: string;
  version: string;
  dialectOptions: string[];
  versionOption: string | null;
  probe: string;
  runs: { subject: string; dialect: string; findings: { file: string; line: number; code: string; message: string }[] }[];
} = JSON.parse(fs.readFileSync(path.join(fixtureDir, "shellcheck.json"), "utf8"));

// ── the rule, before any helper is read ──────────────────────────────────────

describe("the floor is committed in source, not chosen after the findings", () => {
  test("the floor is bash 3.2 — the bash macOS actually ships", () => {
    expect(BASH_32_FLOOR.floor).toEqual({ major: 3, minor: 2 });
    expect(EXPECTED.floor).toBe("3.2");
    expect(BASH_32_FLOOR.why).toMatch(/macOS/);
  });

  test("every feature in the table is above the floor and carries a way to write it at the floor", () => {
    expect(BASH_FEATURES.length).toBeGreaterThanOrEqual(15);
    for (const f of BASH_FEATURES) {
      expect(aboveFloor(f.introducedIn, BASH_32_FLOOR.floor), `${f.id} is not above the floor`).toBe(true);
      expect(f.insteadAtFloor.length, `${f.id} has no floor-legal alternative`).toBeGreaterThan(0);
    }
  });

  test("the limits are stated with the rule, including the two a green run does not settle", () => {
    const limits = BASH_32_FLOOR.limits.join(" ");
    // A command absent at every version is what an install-time preflight is for.
    expect(limits).toMatch(/absent at every bash version/);
    // A `#!/bin/sh` helper is held to a superset of what /bin/sh guarantees.
    expect(limits).toMatch(/POSIX/);
  });
});

// ── what the check reads, and what it refuses to read ────────────────────────

describe("only what the shell evaluates is read as code", () => {
  test("a comment is not code — the fix that mentions `mapfile` is not a finding", () => {
    const fixed = recordedHelper("ost-reports.fixed.sh");
    expect(fixed.source).toContain("rather than `mapfile`");
    expect(lintBashCompat(fixed)).toEqual([]);
  });

  test("`#` inside a word or an expansion does not open a comment", () => {
    const lines = activeLines('COUNT=${#FILES[@]}\necho "$# args" # tail\n');
    expect(lines[0].text).toBe("COUNT=${#FILES[@]}");
    expect(lines[1].text.trimEnd()).toBe('echo "$# args"');
  });

  test("a single-quoted span is literal, so a builtin named inside one is not a call", () => {
    const helper: Helper = { name: "probe", origin: "recorded", interpreter: "bash", source: "#!/bin/bash\necho 'use mapfile here'\n" };
    expect(lintBashCompat(helper)).toEqual([]);
  });

  test("a quoted heredoc body is inert data", () => {
    const source = "#!/bin/bash\ncat <<'PROMPT'\nmapfile is a word in this sentence.\nPROMPT\n";
    expect(lintBashCompat({ name: "probe", origin: "recorded", interpreter: "bash", source })).toEqual([]);
  });

  test("an unquoted heredoc body is half data: expansions count, builtins do not", () => {
    const source = "#!/bin/bash\ncat <<PROMPT\nmapfile is a word in this sentence.\nbut ${RAW,,} is really expanded here\nPROMPT\n";
    const findings = lintBashCompat({ name: "probe", origin: "recorded", interpreter: "bash", source });
    expect(findings.map((f) => f.feature)).toEqual(["case-modification"]);
    expect(findings[0].line).toBe(4);
  });

  test("`<<<` is a here-string, not a heredoc — the lines after it are still code", () => {
    const source = "#!/bin/bash\ngrep x <<< \"$v\"\nmapfile -t a < <(ls)\n";
    const findings = lintBashCompat({ name: "probe", origin: "recorded", interpreter: "bash", source });
    expect(findings.map((f) => [f.feature, f.line])).toEqual([["mapfile", 3]]);
  });
});

// ── the subject: every helper this project installs ──────────────────────────

describe("the subject is discovered, not listed", () => {
  test("the walk finds the shipped helpers by their shebangs", () => {
    const shipped = discoverShippedHelpers(repoRoot).map((h) => h.name);
    expect(shipped).toContain("examples/automation/autonomous-pass.sh");
    expect(shipped).toContain("examples/automation/build-pass.sh");
    // Nothing under node_modules, dist or a worktree is a helper this project installs.
    expect(shipped.filter((n) => /node_modules|^dist\/|^\.worktrees/.test(n))).toEqual([]);
  });

  test("the generated pre-commit hook is in the corpus, because the product writes it onto machines", () => {
    const hook = HELPERS.find((h) => h.origin === "generated");
    expect(hook?.interpreter).toBe("sh");
    expect(hook?.source).toBe(PRE_COMMIT_HOOK);
  });

  test("a sweep that read nothing would report clean, so the corpus size is asserted", () => {
    expect(HELPERS.length).toBeGreaterThanOrEqual(5);
    for (const h of HELPERS) expect(h.source.length, `${h.name} is empty`).toBeGreaterThan(0);
  });
});

// ── the control: a table that stopped matching must not pass by being silent ──

describe("the rule catches every above-floor construct it claims to", () => {
  test("one construct per release above the floor, each flagged with its release", () => {
    const probe: Helper = {
      name: "floor-probe",
      origin: "recorded",
      interpreter: "bash",
      source: [
        "#!/usr/bin/env bash",
        "mapfile -t FILES < <(ls)",
        "declare -A table",
        "lower=${RAW,,}",
        "declare -g everywhere=1",
        "declare -n alias=FILES",
        "quoted=${RAW@Q}",
        "now=$EPOCHSECONDS",
        "upper=${RAW@U}",
        "",
      ].join("\n"),
    };
    const byFeature = new Map(lintBashCompat(probe).map((f) => [f.feature, f.introducedIn]));
    expect(Object.fromEntries(byFeature)).toEqual({
      mapfile: "4.0",
      "associative-array": "4.0",
      "case-modification": "4.0",
      "declare-g": "4.2",
      nameref: "4.3",
      "parameter-transform": "4.4",
      "epoch-variables": "5.0",
      "case-transform": "5.1",
    });
  });

  test("the floor is a floor: raise it above a feature and that feature stops being a finding", () => {
    const helper: Helper = { name: "probe", origin: "recorded", interpreter: "bash", source: "#!/bin/bash\nmapfile -t a < <(ls)\n" };
    expect(lintBashCompat(helper, bashVersion("3.2")).map((f) => f.feature)).toEqual(["mapfile"]);
    expect(lintBashCompat(helper, bashVersion("4.0"))).toEqual([]);
  });
});

// ── the threshold ────────────────────────────────────────────────────────────

describe("the assumption test's bar, over every helper this project installs", () => {
  const report = bashCompatReport(HELPERS);

  test("the known `mapfile` failure is flagged, on the line the transcript recorded", () => {
    const known = report.findings.filter(
      (f) => f.feature === "mapfile" && f.helper === "test/fixtures/bash-compat/ost-reports.recorded.sh",
    );
    expect(known).toHaveLength(1);
    // `… ost-reports: line 21: mapfile: command not found`
    expect(known[0].line).toBe(21);
    expect(known[0].introducedIn).toBe("4.0");
  });

  test("at most 2 findings outside the committed expected set — the half that decides this", () => {
    const key = (f: { helper: string; line: number; feature: string }) => `${f.helper}:${f.line}:${f.feature}`;
    const expected = new Set(EXPECTED.expected.map(key));
    const unexpected = report.findings.filter((f) => !expected.has(key(f)));
    expect(unexpected, formatBashCompatReport(report)).toHaveLength(0);
    expect(unexpected.length).toBeLessThanOrEqual(2);
  });

  test("the helpers this project actually ships and generates are clean at the floor", () => {
    const live = report.helpers.filter((h) => h.origin !== "recorded");
    expect(live.length).toBeGreaterThanOrEqual(3);
    for (const h of live) expect(h.findings, `${h.name}: ${formatBashCompatReport(report)}`).toBe(0);
  });
});

// ── what the off-the-shelf linter flags, and what it misses ──────────────────

describe("ShellCheck 0.11.0, recorded", () => {
  const posix = (subject: string, dialect: string) =>
    (SHELLCHECK.runs.find((r) => r.subject === subject && r.dialect === dialect)?.findings ?? []).filter((f) => /^SC3/.test(f.code));

  test("it has no version floor — the dialects are shell families, and none of them is a version", () => {
    expect(SHELLCHECK.versionOption).toBeNull();
    expect(SHELLCHECK.dialectOptions).toEqual(["sh", "bash", "dash", "ksh", "busybox"]);
  });

  test("under `-s bash`, the dialect the helpers declare, every above-floor construct is missed", () => {
    // The probe carries mapfile, declare -A, ${v,,}, declare -g, declare -n, ${v@Q} and $EPOCHSECONDS.
    expect(posix("floor-probe.sh", "bash")).toEqual([]);
    const named = SHELLCHECK.runs
      .filter((r) => r.dialect === "bash")
      .flatMap((r) => r.findings)
      .filter((f) => /mapfile|readarray/.test(f.message));
    expect(named).toEqual([]);
  });

  test("under `-s sh` it catches the known failure — and one above-floor construct still escapes", () => {
    const probe = posix("floor-probe.sh", "sh");
    expect(probe.some((f) => f.code === "SC3044" && /mapfile/.test(f.message))).toBe(true);
    // `${RAW@Q}` — a bash 4.4 parameter transformation — is on the probe and is named by nothing.
    expect(probe.some((f) => /transformation|@Q/.test(f.message))).toBe(false);
  });

  test("under `-s sh`, every finding against this project's own helpers is a false alarm at the floor", () => {
    const ours = ["examples/automation/autonomous-pass.sh", "examples/automation/build-pass.sh"].flatMap((s) => posix(s, "sh"));
    expect(ours.length).toBe(15);
    const real = ours.filter((f) => shellcheckFloorVerdict(f.code, f.message).aboveFloor);
    expect(real, `false alarms: ${ours.map((f) => f.code).join(",")}`).toEqual([]);
    // 15 against a bar of 2 is the mechanism becoming furniture, which is what would kill this.
    expect(ours.length).toBeGreaterThan(2);
  });

  test("two codes carry the version in their prose rather than in the code, so the code alone cannot sort them", () => {
    expect(SHELLCHECK_POSIX_CODES.SC3044.introducedIn).toBeNull();
    expect(SHELLCHECK_POSIX_CODES.SC3028.introducedIn).toBeNull();
    // Same code, opposite verdicts — only the message tells them apart.
    expect(shellcheckFloorVerdict("SC3044", "In POSIX sh, 'mapfile' is undefined.")).toMatchObject({ introducedIn: "4.0", resolvedBy: "symbol", aboveFloor: true });
    expect(shellcheckFloorVerdict("SC3044", "In POSIX sh, 'declare' is undefined.")).toMatchObject({ introducedIn: "2.0", resolvedBy: "symbol", aboveFloor: false });
    expect(shellcheckFloorVerdict("SC3028", "In POSIX sh, EPOCHSECONDS is undefined.")).toMatchObject({ introducedIn: "5.0", aboveFloor: true });
    expect(shellcheckFloorVerdict("SC3028", "In POSIX sh, BASH_SOURCE is undefined.")).toMatchObject({ introducedIn: "3.0", aboveFloor: false });
  });

  test("the one `#!/bin/sh` helper is POSIX-clean, which is the gap this lint does not itself cover", () => {
    // This lint holds the generated hook to bash 3.2, a superset of /bin/sh. The recorded
    // ShellCheck verdict is what says the hook is clean under the floor it actually declares.
    expect(posix("src/git/conflict-guard.ts#PRE_COMMIT_HOOK", "sh")).toEqual([]);
    expect(HELPERS.filter((h) => h.interpreter === "sh")).toHaveLength(1);
  });
});
