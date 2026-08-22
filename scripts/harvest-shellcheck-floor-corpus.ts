/**
 * Record what the off-the-shelf shell linter says, so the claim "it cannot
 * express a bash 3.2 floor" is a measurement anybody can re-run.
 *
 *   brew install shellcheck   # or apt-get install shellcheck
 *   npx tsx scripts/harvest-shellcheck-floor-corpus.ts test/fixtures/bash-compat
 *
 * The output is committed to `test/fixtures/bash-compat/shellcheck.json` and
 * asserted in `test/runner/helper-bash-compat-lint.test.ts`. The spec reads the
 * fixture rather than shelling out, for two reasons that both matter:
 *
 *   - ShellCheck is not a dependency of this project and was not installed on
 *     the machine that wrote the lint. A gate that needs a binary the developer
 *     may not have is a gate that gets skipped, and a skipped gate reports green.
 *   - The finding being pinned is about a *specific version's* capabilities.
 *     Re-running against whatever ShellCheck happens to be installed would
 *     quietly change the subject.
 *
 * Nothing here is imported by `src/` or by a test. The fixture is the artefact.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRE_COMMIT_HOOK } from "../src/git/conflict-guard.js";
import { discoverShippedHelpers } from "../src/runner/bash-compat-lint.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(repoRoot, "test/fixtures/bash-compat"));

function shellcheckVersion(): string {
  const out = execFileSync("shellcheck", ["--version"], { encoding: "utf8" });
  return /version:\s*(\S+)/.exec(out)?.[1] ?? "unknown";
}

interface Finding {
  readonly file: string;
  readonly line: number;
  readonly code: string;
  readonly message: string;
}

/** One `shellcheck -s <dialect>` run over one file, parsed out of `-f gcc`. */
function run(file: string, dialect: string): Finding[] {
  let out = "";
  try {
    out = execFileSync("shellcheck", ["-s", dialect, "-f", "gcc", file], { encoding: "utf8" });
  } catch (err) {
    // Findings make shellcheck exit non-zero; the report is still on stdout.
    out = String((err as { stdout?: string }).stdout ?? "");
  }
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*?):(\d+):\d+:\s*\w+:\s*(.*)\s\[(SC\d+)\]$/.exec(line);
      return m ? { file: path.basename(m[1]), line: Number(m[2]), code: m[4], message: m[3] } : null;
    })
    .filter((f): f is Finding => f !== null);
}

/**
 * A probe holding one construct from each bash release above the floor. Its
 * job is to show which of them the linter names in each dialect — which is how
 * "misses the known failure under `-s bash`" is recorded rather than asserted.
 */
const PROBE = [
  "#!/usr/bin/env bash",
  "# One construct per release above the bash 3.2 floor.",
  "mapfile -t FILES < <(ls)            # 4.0",
  "declare -A table                    # 4.0",
  'lower=${RAW,,}                      # 4.0',
  "declare -g everywhere=1             # 4.2",
  "declare -n alias=FILES              # 4.3",
  'quoted=${RAW@Q}                     # 4.4',
  "now=$EPOCHSECONDS                   # 5.0",
  'echo "$FILES $table $lower $everywhere $alias $quoted $now"',
  "",
].join("\n");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shellcheck-floor-"));
const probePath = path.join(tmp, "floor-probe.sh");
fs.writeFileSync(probePath, PROBE, "utf8");
const hookPath = path.join(tmp, "pre-commit");
fs.writeFileSync(hookPath, PRE_COMMIT_HOOK, "utf8");

const helpers = discoverShippedHelpers(repoRoot);
const subjects = [
  ...helpers.map((h) => ({ name: h.name, file: path.join(repoRoot, h.name) })),
  { name: "src/git/conflict-guard.ts#PRE_COMMIT_HOOK", file: hookPath },
  { name: "floor-probe.sh", file: probePath },
];

const corpus = {
  tool: "shellcheck",
  version: shellcheckVersion(),
  /** Recorded verbatim so a reader knows the option set was searched, not guessed. */
  dialectOptions: ["sh", "bash", "dash", "ksh", "busybox"],
  versionOption: null as string | null,
  probe: PROBE,
  runs: subjects.flatMap((s) =>
    ["bash", "sh"].map((dialect) => ({
      subject: s.name,
      dialect,
      findings: run(s.file, dialect),
    })),
  ),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "shellcheck.json"), JSON.stringify(corpus, null, 1) + "\n", "utf8");
fs.rmSync(tmp, { recursive: true, force: true });

for (const r of corpus.runs) {
  const posix = r.findings.filter((f) => /^SC3/.test(f.code));
  console.log(`${r.subject} [-s ${r.dialect}] — ${r.findings.length} finding(s), ${posix.length} portability`);
}
