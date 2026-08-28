/**
 * A first-class waiting primitive, and the measurement that says whether it was
 * worth building.
 *
 * Eight times across seven sessions this machine's build loop wrote some form of
 * `sleep 45; gh pr checks 17` and was refused. The guard's message was correct
 * every time — "use Monitor with an until-loop … or run_in_background: true" —
 * and the reflex came back anyway. The corrections ledger (`corrections.ts`)
 * answers the *memory* half of that: the correction now reaches the next session.
 * This module answers the *economy* half, which is the half the ledger cannot
 * touch: **whatever a session remembers, it still writes whichever form is
 * shortest.**
 *
 * ## What is claimed, and what the instrument can settle
 *
 * The solution node this implements ("Offer the permitted form at the moment of
 * reach") rests on a premise nobody had measured: that the reflex is driven by
 * expression cost. Its assumption test is a disconfirmer aimed at that premise —
 * if the permitted form were *already* no longer to write than the blocked one,
 * expression cost is not what drives the repeat and a primitive is aimed at the
 * wrong cause. {@link WAITING_CASES} is that measurement's subject: the three
 * waiting cases visible in the evidence, each carrying the blocked command
 * **verbatim from the transcript it was refused in**, so the comparison is against
 * what was written rather than against a tidied-up version of it.
 *
 * **Nothing here hand-picks what the permitted form has to do.** {@link peekOf}
 * and {@link probeOf} derive both halves of a replacement mechanically from the
 * blocked string — strip the fixed sleep, then strip the output-shaping the shim
 * supplies itself. That is deliberate and it is the part an author could most
 * easily have cheated: choosing a narrower condition by hand makes the permitted
 * form arbitrarily short, and under a hand-narrowed condition (`wc -l <path>`
 * alone, for the `condition` case) the guard's own until-loop already comes out
 * *cheaper* than the blocked command it replaces. A comparison in which the
 * permitted form delivers less than the blocked one answers an easier question
 * than the node asked.
 *
 * The measurement is {@link expressionCost}, and it counts the whole tool-call
 * input rather than just the command string. That is not pedantry: the guard's
 * first named remedy is a `Monitor` call, and `Monitor` requires `description`,
 * `timeout_ms` and `persistent` on top of the command. A comparison that counted
 * only the command would price that remedy at a third of what it costs to write.
 *
 * ## Why the primitive is a shell script and not a tool
 *
 * The build pass grants `Bash,Read,Edit,Write,Glob,Grep` (`BUILD_TOOLS` in
 * `examples/automation/build-pass.sh`) and `Monitor` is not among them. Whether
 * that grant is the whole story about reachability is not something this file can
 * settle — but the corpus can say what actually happened, and it says that across
 * all eight sightings **no session ever answered the refusal with `Monitor`**.
 * The one session that complied ({@link OBSERVED_PERMITTED}) wrote a `Bash`
 * until-loop by hand, and it cost 2.6× the call it replaced. So the permitted
 * form that pays has to be expressible with `Bash` alone.
 *
 * ## The shim, and why the invocation prefix is the whole ballgame
 *
 * `sleep 45; ` is ten characters bolted onto a command the composer was going to
 * write anyway. Any wrapper longer than that loses the bare comparison and can
 * only win by absorbing the noise a fixed sleep forces (`2>&1 | head -20`, and
 * the second copy of a long path a blind peek needs). `ost-agent wait '…'` would
 * be a wash at best, and through the invocation this project actually documents —
 * `node "$CLAUDE_PLUGIN_ROOT/dist/ost-agent.mjs" …` — it is far worse than the
 * reflex it replaces. So the affordance is not a subcommand; it is
 * {@link SHIM_NAME}, five characters on `PATH`, installed by the wrapper that
 * already controls the session's environment. A primitive nobody can reach in
 * fewer keystrokes than `sleep` is not an affordance, it is a preference.
 *
 * The shim is therefore plain POSIX `sh` with no `node` in it and nothing baked
 * in at install time. That is a second decision and it matters twice: a shim that
 * shelled back into this CLI would have to carry an absolute path to a bundle,
 * which fails as "command not found" three weeks later and reads exactly like the
 * affordance never existing — and it would put a caller-supplied command through
 * a `spawn` inside `src/`, which is a door
 * (`test/runner/suite-result-consumer-census.test.ts`) that this work has no
 * business opening. Nothing in this module executes anything.
 */

/**
 * The name the permitted form is reached by.
 *
 * Five characters, and deliberately not `wait` — that is a shell builtin, so a
 * shim called `wait` would be shadowed in every shell that matters and the
 * affordance would silently become job control. `await` is neither a builtin nor
 * a reserved word in `sh`, `bash` or `zsh`.
 */
export const SHIM_NAME = "await";

/** Seconds between attempts when the caller names none. */
export const DEFAULT_EVERY_SECONDS = 5;

/**
 * Seconds before the wait gives up when the caller names none.
 *
 * Bounded rather than open-ended on purpose: this exists to be written *instead
 * of* a fixed sleep by an unattended session, and a wait that can hang forever
 * would trade eight refusals for one wedged firing. Timing out is a reported
 * outcome — the condition's own nonzero status, and a line on stderr — never a
 * silent one.
 */
export const DEFAULT_FOR_SECONDS = 300;

/** Lines of the final attempt's output the shim prints. */
export const DEFAULT_LINES = 20;

/** One tool call, as the composer would author it. */
export interface ToolCall {
  /** The tool the call is made against — it decides which fields are mandatory. */
  tool: string;
  /** The input object, exactly the keys a composer has to type. */
  input: Record<string, unknown>;
}

/** One waiting case, as observed. */
export interface WaitingCase {
  id: "ci-check" | "started-task" | "condition";
  /** What the composer was trying to do, in words. */
  intent: string;
  /** Session the blocked form was read out of — a transcript in the corpus. */
  session: string;
  /** The blocked command, byte-for-byte as the refused `Bash` call carried it. */
  blocked: string;
}

/**
 * The three waiting cases in the evidence, with the blocked form verbatim.
 *
 * These are not illustrations. Each `blocked` string is the `command` field of a
 * `Bash` call that the sleep guard refused, copied out of
 * `test/fixtures/corrections/<session>*.jsonl`, and the instrument asserts it is
 * still findable there — a case whose blocked form drifted into something more
 * flattering would be measuring a command nobody ever wrote.
 *
 * The corpus holds eight sightings, six of them the CI-check case with different
 * PR numbers and tail lengths. The shortest of the six is the one carried here,
 * because it is the hardest for a replacement to beat and the claim should be
 * made against the hard instance.
 */
export const WAITING_CASES: readonly WaitingCase[] = [
  {
    id: "ci-check",
    intent: "poll a CI check until it settles",
    session: "516fdfb8",
    blocked: "sleep 45; gh pr checks 17 2>&1 | head",
  },
  {
    id: "started-task",
    intent: "wait on a task that was already started to produce its output",
    session: "4ff7b605",
    blocked:
      "sleep 45; ls -la /Users/tanner/.claude/projects/-Users-tanner-dev-OST-Agent/" +
      "4ff7b605-da1d-4f2e-8c05-ec6408118837/subagents/workflows/wf_a51c57d4-bc9/ 2>/dev/null | head -20",
  },
  {
    id: "condition",
    intent: "wait for a condition to become true",
    session: "470cb94a",
    blocked:
      "sleep 240; git status --porcelain | wc -l; ls /Users/tanner/.claude/projects/-Users-tanner-dev-OST-Agent/" +
      "470cb94a-d709-43b1-85aa-dedd917ac866/subagents/workflows/wf_452ccb28-61c/journal.jsonl 2>/dev/null && " +
      "wc -l /Users/tanner/.claude/projects/-Users-tanner-dev-OST-Agent/" +
      "470cb94a-d709-43b1-85aa-dedd917ac866/subagents/workflows/wf_452ccb28-61c/journal.jsonl",
  },
];

/**
 * The one permitted form in the corpus that a session actually wrote.
 *
 * Session `516fdfb8`, immediately after the refusal of `WAITING_CASES[0]`. It is
 * the only non-hypothetical data point the premise has, and it is worth more than
 * any constructed baseline for two reasons. It shows what compliance really costs
 * — the naive `until <peek>; do …` does not even work here, because a pipeline's
 * exit status is `head`'s and the loop would fall through on the first attempt,
 * so the composer had to build a `grep`-and-test condition by hand. And it shows
 * which remedy a session reaches for when both are offered: not `Monitor`.
 */
export const OBSERVED_PERMITTED: { session: string; call: ToolCall } = {
  session: "516fdfb8",
  call: {
    tool: "Bash",
    input: {
      command:
        "until [ -n \"$(gh pr checks 17 2>/dev/null | grep -E 'pass|fail')\" ]; do sleep 5; done; gh pr checks 17",
      timeout: 420000,
    },
  },
};

/** The leading fixed sleep a refused command opens with. */
const SLEEP_PREFIX = /^\s*sleep\s+\d+\s*(?:;|&&)\s*/;

/**
 * Output-shaping a blind peek has to bolt on and the shim supplies itself:
 * merging stderr, discarding it, and trimming to a screenful.
 */
const OUTPUT_SHAPING = /(?:\s*\|\s*(?:head|tail)(?:\s+-\d+)?|\s*2>&1|\s*2>\/dev\/null)$/;

/**
 * What the composer wanted to *see*: the refused command with its fixed sleep
 * removed, and nothing else touched.
 *
 * This is the payload half of a replacement, and it is the reason the comparison
 * is fair. Whatever form replaces the blocked call still has to produce this,
 * or it is not a replacement.
 */
export function peekOf(blocked: string): string {
  return blocked.replace(SLEEP_PREFIX, "");
}

/**
 * What the composer was *waiting on*: the peek with the output-shaping stripped.
 *
 * Stripped repeatedly, right to left, because the shapings stack (`2>&1 | head`).
 * The shim merges stderr and trims the tail itself, so a composer writing the
 * permitted form does not type them again — which is where roughly half of its
 * saving comes from, and why the saving is not an accounting trick: the
 * characters really do not have to be written.
 */
export function probeOf(blocked: string): string {
  let probe = peekOf(blocked);
  for (;;) {
    const trimmed = probe.replace(OUTPUT_SHAPING, "");
    if (trimmed === probe) return trimmed.trim();
    probe = trimmed;
  }
}

/**
 * What it costs to write one tool call: the characters of its input, serialised
 * canonically.
 *
 * Keys are sorted so two callers spelling the same call in a different order get
 * the same number, and the whole input is counted rather than one field of it —
 * a mandatory field is a keystroke whether or not it is the interesting one.
 * Characters are a proxy for effort and an imperfect one; they are the part of
 * "longer, less obvious, and has to be recalled" that a machine can settle, and
 * the other two are why this instrument can refute the premise but never confirm
 * the mechanism.
 */
export function expressionCost(call: ToolCall): number {
  return JSON.stringify(call.input, Object.keys(call.input).sort()).length;
}

/** The blocked reflex, as the refused call was actually shaped. */
export function blockedCall(c: WaitingCase): ToolCall {
  return { tool: "Bash", input: { command: c.blocked } };
}

/**
 * The until-loop both of the guard's remedies are built around, followed by the
 * peek.
 *
 * The trailing peek is not padding. An `until` loop consumes the condition's
 * output — that is what makes it a condition — so a composer who wanted to *see*
 * the result writes the command a second time, which is exactly what the one
 * observed permitted form in the corpus does.
 */
export function guardLoop(c: WaitingCase, everySeconds = DEFAULT_EVERY_SECONDS): string {
  return `until ${probeOf(c.blocked)}; do sleep ${everySeconds}; done; ${peekOf(c.blocked)}`;
}

/**
 * The two forms the sleep guard itself names, priced as calls.
 *
 * "The permitted form" in the assumption test's threshold means *what the guard
 * told the session to write*, and pricing something else would be answering an
 * easier question. `Monitor`'s three mandatory fields are included because they
 * are mandatory; the `description` used is the shortest honest one.
 */
export function guardRemedies(c: WaitingCase): ToolCall[] {
  const loop = guardLoop(c);
  return [
    { tool: "Bash", input: { command: loop, run_in_background: true } },
    {
      tool: "Monitor",
      input: { command: loop, description: c.intent, timeout_ms: DEFAULT_FOR_SECONDS * 1000, persistent: false },
    },
  ];
}

/** The permitted form this module ships: one `Bash` call, reached by the shim. */
export function permittedCall(c: WaitingCase): ToolCall {
  return { tool: "Bash", input: { command: permittedWait(probeOf(c.blocked)) } };
}

/** The command a composer writes to wait on `probe`. */
export function permittedWait(probe: string): string {
  const quoted = probe.split("'").join("'\\''");
  return SHIM_NAME + " '" + quoted + "'";
}

/**
 * The shim: a self-contained POSIX `sh` script that puts {@link SHIM_NAME} on
 * `PATH`.
 *
 * Behaviour, and every line of it is a character the composer does not write:
 *
 *   - **The first attempt happens immediately**, before any sleeping. That is the
 *     one behavioural difference from the reflex it replaces and it is worth
 *     naming: a fixed `sleep 45` pays forty-five seconds even when the thing
 *     finished in two, and six of the eight recorded sightings were exactly that
 *     — a guess at a duration followed by a single blind look. So this is not
 *     only shorter to write than the blocked form, it is strictly faster than it
 *     whenever the condition is already true, which the blocked form can never be.
 *   - stderr is merged and the last {@link DEFAULT_LINES} lines are printed, so
 *     `2>&1 | head -20` is not retyped.
 *   - The bound is checked *before* sleeping, so a wait never overshoots what the
 *     caller asked for by a whole interval.
 *   - The exit status is the condition's own, and giving up says so on stderr
 *     rather than looking like success.
 */
export function renderWaitShim(): string {
  return [
    "#!/bin/sh",
    "# " + SHIM_NAME + " — wait for a condition instead of guessing at a sleep.",
    "# Generated by `ost-agent wait-shim`; the reasoning is in src/loop/wait.ts.",
    "# Usage: " + SHIM_NAME + " '<condition>' [seconds-between-attempts] [give-up-seconds]",
    'if [ -z "${1:-}" ]; then',
    "  echo \"" + SHIM_NAME + ": name the condition to wait for, e.g. " + SHIM_NAME + " 'gh pr checks 17'\" >&2",
    "  exit 2",
    "fi",
    'cond=$1',
    "every=${2:-" + String(DEFAULT_EVERY_SECONDS) + "}",
    "limit=${3:-" + String(DEFAULT_FOR_SECONDS) + "}",
    "waited=0",
    "while :; do",
    '  out=$(eval "$cond" 2>&1)',
    "  rc=$?",
    '  [ "$rc" -eq 0 ] && break',
    '  [ "$((waited + every))" -gt "$limit" ] && break',
    '  sleep "$every"',
    "  waited=$((waited + every))",
    "done",
    'if [ -n "$out" ]; then printf \'%s\\n\' "$out" | tail -' + String(DEFAULT_LINES) + "; fi",
    'if [ "$rc" -ne 0 ]; then',
    "  echo \"" + SHIM_NAME + ': gave up after ${waited}s; the condition still exits $rc." >&2',
    "fi",
    'exit "$rc"',
    "",
  ].join("\n");
}

/**
 * Does this correction's remedy concern waiting?
 *
 * Matched on the remedy text rather than on a correction id, because the id is
 * derived from the remedy's first eight words and would change if the guard
 * reworded its opening. Both of the guard's named forms are looked for: a message
 * that offers either one is a message a session is about to pay the expression
 * cost of.
 */
export function isWaitingCorrection(permitted: string): boolean {
  return /until-loop|run_in_background/i.test(permitted);
}

/**
 * The affordance itself, as text offered wherever a waiting correction is
 * delivered.
 *
 * This is the "at the moment of reach" half, and it is why the module is wired
 * into the corrections briefing rather than left as a subcommand somebody has to
 * discover. A remedy stated as prose — "use Monitor with an until-loop" — still
 * leaves the composer to work out the loop, the interval, the bound and the
 * output trimming; every one of those is a place to decide the fixed sleep was
 * easier. What goes here is the line itself, ready to be written, for the three
 * shapes this workspace has actually been refused for.
 */
export function renderWaitAffordance(): string {
  const lines = [
    "    Ready to write instead — `" + SHIM_NAME + " '<condition>'` is on this session's PATH. It runs the",
    "    condition immediately, re-runs it every " + String(DEFAULT_EVERY_SECONDS) + "s until it exits 0, prints the last " + String(DEFAULT_LINES) + " lines,",
    "    and gives up after " + String(DEFAULT_FOR_SECONDS) + "s rather than hanging:",
  ];
  for (const c of WAITING_CASES) {
    lines.push("      " + c.intent + ": " + permittedWait(probeOf(c.blocked)));
  }
  return lines.join("\n");
}
