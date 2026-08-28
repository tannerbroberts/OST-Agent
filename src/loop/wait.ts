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
 * The wall clock a `Bash` call gets before the harness kills it.
 *
 * Read off the corpus rather than assumed: `test/fixtures/corrections/97546e2f…`
 * holds a result reading `Exit code 143 / Command timed out after 2m 0s`, and
 * the session this whole opportunity was distilled from is described the same
 * way — "a command that timed out after two minutes, having reported `still
 * pending` five times".
 *
 * It bounds both shapes, which is why it lives here rather than in the
 * measurement. It is the poller's real give-up point, and it is the ceiling the
 * shim's own bound has to fit inside if the shim is ever to report its own
 * verdict instead of being killed mid-wait.
 */
export const HARNESS_BASH_TIMEOUT_SECONDS = 120;

/**
 * Seconds before the wait gives up when the caller names none.
 *
 * Bounded rather than open-ended on purpose: this exists to be written *instead
 * of* a fixed sleep by an unattended session, and a wait that can hang forever
 * would trade eight refusals for one wedged firing. Timing out is a reported
 * outcome — the condition's own nonzero status, and a line on stderr — never a
 * silent one.
 *
 * **The number is derived, not chosen.** A `Bash` call gets
 * {@link HARNESS_BASH_TIMEOUT_SECONDS} before the harness kills it, and the
 * cheapest permitted form — the one the affordance advertises — carries no
 * `timeout` field, so it gets exactly that. A bound larger than the ceiling is
 * not a bound: the shim never reaches its own give-up branch, prints nothing,
 * and comes back as `Exit code 143 / Command timed out after 2m 0s`. That is
 * *worse* than the reflex it replaced, which at least printed `still pending` on
 * the way down. So the bound sits one whole interval inside the ceiling, leaving
 * room for the final attempt to finish and for the shim to say what it saw.
 */
export const DEFAULT_FOR_SECONDS = HARNESS_BASH_TIMEOUT_SECONDS - 2 * DEFAULT_EVERY_SECONDS;

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
 *   - **The bound is elapsed time, not the sum of the sleeps.** This is the
 *     difference between a bound and a hope. Counting only the sleeps prices the
 *     condition at zero, and the conditions this exists for do not cost zero: at
 *     the default interval a `gh pr checks` taking three seconds an attempt runs
 *     twenty-three attempts, so a wait that believes it is bounded at
 *     {@link DEFAULT_FOR_SECONDS} actually runs past
 *     {@link HARNESS_BASH_TIMEOUT_SECONDS} and is killed — no output, no verdict,
 *     exit 143. A deadline read off the clock cannot drift that way whatever the
 *     condition costs.
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
    "start=$(date +%s)",
    "waited=0",
    "while :; do",
    '  out=$(eval "$cond" 2>&1)',
    "  rc=$?",
    '  [ "$rc" -eq 0 ] && break',
    '  waited=$(($(date +%s) - start))',
    '  [ "$((waited + every))" -gt "$limit" ] && break',
    '  sleep "$every"',
    "done",
    'waited=$(($(date +%s) - start))',
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

/*
 * ---------------------------------------------------------------------------
 * The parity measurement: did the cost go away, or did it move?
 * ---------------------------------------------------------------------------
 *
 * Everything above is the affordance and the question it was built to answer —
 * is the permitted form cheaper to *write* than the blocked one. What follows is
 * the second question, and it is the one the solution node "One cheap blocking
 * wait replaces the poll-and-retry loop" stands or falls on:
 *
 *   > The affordance already exists and the loop simply is not reaching for it.
 *   > Adopting it is only strictly better if waiting once is no slower than
 *   > polling — otherwise the refusals were buying something.
 *
 * Two numbers settle that, and they are the two halves of the threshold its
 * assumption test states: the count of `Blocked:` refusals across the passes,
 * and the wall clock those passes spend against what the polling record spent.
 * `test/loop/blocking-wait-refusal-parity.test.ts` is where they are counted.
 *
 * **The refusal half is a classifier, not an assertion.** {@link sleepGuardRefusal}
 * reconstructs the guard's whole message rather than returning a boolean, so the
 * eight refusals recorded verbatim in `test/fixtures/corrections/` can disagree
 * with it byte for byte. A predicate that only said yes/no could be wrong in the
 * direction that flatters the permitted form and no reader could tell.
 *
 * **The wall-clock half cannot be read off the record, and that is a finding.**
 * The node says the baseline is "thirteen-plus real sessions with counted
 * refusals, not a construction". For refusals that is exactly right. For wall
 * clock it is not, and the corpus says why in one number: every recorded
 * sighting was answered in 0.00–0.01 seconds, because the guard refused it
 * before the `sleep` ever ran. Nobody paid those forty-five seconds. So there is
 * no recorded poll-and-retry elapsed time to compare against, and the comparison
 * is built out of the three quantities the record does hold: the seconds each
 * refused call *committed to* before it could look once, the one compliant wait
 * that did run (`516fdfb8`, 26.42s, and it still came back nonzero), and the
 * ceiling everything runs under ({@link HARNESS_BASH_TIMEOUT_SECONDS}).
 */

/**
 * The guard's closing advice, verbatim.
 *
 * Held as one string because the instrument reproduces whole recorded messages
 * with it; a paraphrase here would make every comparison against the corpus a
 * comparison against this file instead.
 */
export const SLEEP_GUARD_REMEDY =
  "To wait for a condition, use Monitor with an until-loop (e.g. `until <check>; do sleep 2; done`). " +
  "To wait for a command you started, use run_in_background: true. " +
  "Do not chain shorter sleeps to work around this block.";

/** The leading fixed sleep the guard refuses, and the command it precedes. */
const FIXED_SLEEP_PROLOGUE = /^\s*sleep\s+(\d+)\s*(?:;|&&|\|\|)?\s*([\s\S]+)$/;

/** Shell operators the refusal message drops when it quotes what followed. */
const SEPARATORS = /&&|\|\||[;|]/g;

/** Redirections the refusal message drops for the same reason. */
const REDIRECTIONS = /2>&1|2>\/dev\/null|>\/dev\/null/g;

/**
 * How the guard quotes the command that followed the sleep: operators and
 * redirections dropped, whitespace collapsed.
 *
 * Derived by reading the eight recorded messages against the eight recorded
 * commands, not by guessing at an implementation nobody here owns — and the
 * instrument re-derives it every run by requiring all eight to come back
 * byte-identical.
 */
function quotedTail(rest: string): string {
  return rest.replace(REDIRECTIONS, " ").replace(SEPARATORS, " ").replace(/\s+/g, " ").trim();
}

/**
 * The refusal this command would draw from the sleep guard, or `null` if it
 * draws none.
 *
 * Only the shape the record actually contains is claimed: a fixed `sleep N`
 * followed by something else. A bare `sleep 30` with nothing after it returns
 * `null` here, because no session wrote one and the corpus cannot say what the
 * guard would do with it — a classifier that guessed would be inventing evidence
 * in the direction that makes the count look better.
 */
export function sleepGuardRefusal(command: string): string | null {
  const match = FIXED_SLEEP_PROLOGUE.exec(command);
  if (!match) return null;
  const tail = quotedTail(match[2]);
  if (tail === "") return null;
  return `Blocked: sleep ${match[1]} followed by: ${tail}. ${SLEEP_GUARD_REMEDY}`;
}

/** The seconds a refused call committed to before it could look even once. */
export function committedSleepSeconds(command: string): number | null {
  const match = FIXED_SLEEP_PROLOGUE.exec(command);
  return match ? Number(match[1]) : null;
}

/**
 * When a fixed-sleep-then-look poller first *sees* a subject that becomes ready
 * `readyAtSeconds` after the wait begins.
 *
 * The shape sleeps first and looks second, so it cannot observe anything before
 * `sleepSeconds` however quickly the subject settles — that is the `max(1, …)`,
 * and it is the entire economic difference this candidate claims. Observation
 * only ever lands on a multiple of the interval because every look is preceded
 * by another full sleep.
 */
export function pollingObservationSeconds(readyAtSeconds: number, sleepSeconds: number): number {
  return Math.max(1, Math.ceil(readyAtSeconds / sleepSeconds)) * sleepSeconds;
}

/**
 * When the blocking wait first sees the same subject.
 *
 * Same arithmetic minus the prologue: the first attempt happens at zero, so a
 * subject that is already ready is observed at zero rather than at one interval.
 */
export function blockingObservationSeconds(readyAtSeconds: number, everySeconds: number): number {
  return Math.ceil(readyAtSeconds / everySeconds) * everySeconds;
}

/**
 * Does the blocking wait observe no later than the poller, for every readiness
 * time up to `horizonSeconds`?
 *
 * Swept rather than sampled on purpose. The comparison is riggable by choosing a
 * readiness time — pick one just under a sleep interval and the blocking wait
 * wins by 44 seconds; pick a multiple of it and the two tie — so the instrument
 * asks the question over the whole domain and reports the readiness time where
 * the claim first fails, if it fails anywhere.
 */
export function firstReadinessWhereBlockingLoses(
  sleepSeconds: number,
  everySeconds = DEFAULT_EVERY_SECONDS,
  horizonSeconds = 300,
): number | null {
  for (let readyAt = 0; readyAt <= horizonSeconds; readyAt++) {
    if (blockingObservationSeconds(readyAt, everySeconds) > pollingObservationSeconds(readyAt, sleepSeconds)) {
      return readyAt;
    }
  }
  return null;
}

/**
 * Passes the threshold asks for: "five passes that would normally poll a pending
 * check, using the blocking wait instead".
 *
 * A floor rather than a target. The corpus holds eight sightings and the
 * instrument runs all of them, because choosing which five to run is the one
 * degree of freedom that could hide a case the wait handles badly.
 */
export const REQUIRED_PASSES = 5;
