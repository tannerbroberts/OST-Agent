/**
 * Refuse a proving command whose exit code cannot report failure.
 *
 * **The failure this exists to stop, observed rather than imagined.** On
 * 2026-07-27 a loop pass wrapped its build phase as:
 *
 * ```
 * ost-agent loop step --phase build -- bash -c "npx vitest run 2>&1 | tail -25"
 * ```
 *
 * `vitest` was not on the path. The shell printed `vitest: not found` — and the
 * step recorded **exit 0**, because a POSIX pipeline's status is the status of
 * its *last* command, and `tail` succeeded at reading nothing. The health record
 * gained a build step that reports success for a command that never ran. Only a
 * re-run from the right directory produced a real result, and only reading
 * `runs.jsonl` back afterwards revealed that the first step had been a lie.
 *
 * That is the exact failure this whole bookend exists to prevent — "you cannot
 * assert health, only earn it" — arriving through the recorder's own front door.
 * `loop step` was not wrong to record 0; the shell really did hand it a 0. The
 * defect is that the tool accepted a command construction in which a red step
 * *cannot* report red, which is the definition of a check that is not a check.
 *
 * **Why refuse rather than warn.** A warning on stderr scrolls past in an
 * unattended loop, and the record it produces is indistinguishable afterwards
 * from an honest pass. The whole value of `runs.jsonl` is that a later reader
 * can trust it without having watched the run. One laundered step is enough to
 * make the file require corroboration, and a file that requires corroboration is
 * not a record. So this refuses, writes nothing, and names the fix — the same
 * contract the append-only tools use when handed invalid input.
 *
 * **The escape hatch is the correct fix, not a flag.** `set -o pipefail` makes
 * the pipeline report the first failing stage, after which the command is
 * genuinely provable and this check passes. There is deliberately no
 * `--i-know-what-im-doing`: a proving command that wants a laundered exit code
 * is a contradiction, and an override would be reached for precisely when it
 * does the most damage.
 */

/** Shells whose `-c` argument is a script this module knows how to read. */
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash"]);

export type LaunderingDiagnosis = {
  /** The pipeline fragment whose exit code is discarded, for the message. */
  readonly script: string;
  /** The shell the script was handed to, by basename. */
  readonly shell: string;
};

/** The basename of a path, without pulling in `node:path` for one operation. */
function basename(command: string): string {
  const parts = command.split(/[\\/]/);
  return parts[parts.length - 1] ?? command;
}

/**
 * Remove quoted spans so a `|` inside an argument is not read as a pipeline.
 *
 * Single quotes are literal in every shell here, so nothing inside them is
 * special. Double quotes still process `\` escapes, which matters only for a
 * `\"` that would otherwise end the span early. Unterminated quotes are treated
 * as running to the end of the script: that is a syntax error the shell will
 * reject anyway, and swallowing the tail is the conservative direction — it can
 * only cause this check to pass, never to refuse a command wrongly.
 */
function stripQuoted(script: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];

    if (quote === null) {
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      // A backslash outside quotes escapes the next character, including a
      // literal `\|` that is an argument rather than a pipeline.
      if (ch === "\\") {
        i++;
        continue;
      }
      out += ch;
      continue;
    }

    if (quote === '"' && ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) quote = null;
  }

  return out;
}

/**
 * Whether the script contains a pipeline — a `|` that is not part of `||`.
 *
 * `|&` (bash's shorthand for `2>&1 |`) counts: it is a pipeline and discards the
 * left-hand status exactly the same way.
 */
function hasPipeline(bare: string): boolean {
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] !== "|") continue;
    if (bare[i + 1] === "|") {
      i++; // `||` — a logical OR, and it propagates failure rather than hiding it.
      continue;
    }
    if (bare[i - 1] === "|") continue; // trailing half of a `||` already consumed
    return true;
  }
  return false;
}

/**
 * Whether the script turns on `pipefail` before anything else runs.
 *
 * Matches `set -o pipefail` and the clustered short forms (`set -eo pipefail`,
 * `set -euo pipefail`). Deliberately does not try to prove the `set` executes
 * before the pipeline in every branch — that is a reachability question no
 * regex settles. Writing `pipefail` at all is a deliberate act, and the check's
 * job is to catch the pass that never considered the problem.
 */
function enablesPipefail(bare: string): boolean {
  return /(^|[\s;&|(])set\s+(-[a-z]*o\s+|-o\s+)pipefail(\s|;|$)/.test(bare);
}

/**
 * Diagnose a proving command that cannot report failure, or `null` if it can.
 *
 * Only shell `-c` scripts are inspected. A direct `argv` invocation
 * (`["npx", "vitest", "run"]`) has no shell between the tool and the process, so
 * its exit code is the process's own and there is nothing to launder.
 */
export function detectLaunderedExit(argv: readonly string[]): LaunderingDiagnosis | null {
  if (argv.length < 2) return null;
  const shell = basename(argv[0]);
  if (!SHELLS.has(shell)) return null;

  // The script is the argument after the flag that carries `c` — `-c`, and also
  // clustered forms like `-lc` from a login shell.
  const flagIndex = argv.findIndex((a, i) => i > 0 && /^-[a-z]*c$/.test(a));
  if (flagIndex === -1) return null;
  const script = argv[flagIndex + 1];
  if (typeof script !== "string") return null;

  const bare = stripQuoted(script);
  if (!hasPipeline(bare)) return null;
  if (enablesPipefail(bare)) return null;

  return { script, shell };
}

/** The refusal text. Names what was seen, why it cannot be recorded, and the fix. */
export function launderedExitMessage(d: LaunderingDiagnosis): string {
  return [
    `refusing to record this step: its exit code cannot report failure.`,
    ``,
    `  ${d.shell} -c ${JSON.stringify(d.script)}`,
    ``,
    `A pipeline reports the exit code of its LAST command, so a failure anywhere`,
    `upstream is recorded as success. A step that cannot come out red is not a`,
    `check, and runs.jsonl is only worth reading if every step in it could have.`,
    ``,
    `Fix — make the pipeline report the first failing stage:`,
    ``,
    `  ${d.shell} -c ${JSON.stringify(`set -o pipefail; ${d.script}`)}`,
    ``,
    `Or drop the shell entirely and pass the command directly, which has no`,
    `pipeline to launder:`,
    ``,
    `  ost-agent loop step --phase <phase> -- <command> [args...]`,
    ``,
    `Nothing was written. The run is still open.`,
  ].join("\n");
}
