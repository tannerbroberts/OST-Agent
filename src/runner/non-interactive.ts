/**
 * Declare the run unattended to everything it invokes, and turn anything that
 * would still prompt into a loud failure.
 *
 * Built for "Non-interactive is the default, and any tool that would prompt is
 * made to fail loudly instead" (vault). The opportunity beneath it is a run
 * that does not fail but *stops*, mid-command, at a question a tool asked
 * expecting a human at a keyboard — nothing about the stop announcing itself as
 * a stop. Turning a silent stall into a reportable, countable failure is the
 * whole gain.
 *
 * ## What the two harvested stalls actually do, measured
 *
 * The node's premise is that invoked tools honour the convention, and its named
 * risk is that the ones which ignore it are the ones that caused the problem.
 * Both recorded commands were reproduced before this module was written, and
 * neither behaves the way the node assumed:
 *
 * - **The git that hit divergent branches never prompted and never hung.** It
 *   exits 128 in well under a second with `fatal: Need to specify how to
 *   reconcile divergent branches`, with or without `GIT_TERMINAL_PROMPT=0`. It
 *   was already a loud failure. What the run lacked was the reconcile policy,
 *   which is the sibling node's job ("Settle the standing answers once, in
 *   committed configuration the run inherits") and deliberately not set here —
 *   this module declares the run unattended, it does not answer for it.
 * - **The overwrite question is `cp -i`, and in the harvested session it came
 *   from a shell alias.** On the machine that produced the transcript, `cp` is
 *   `cp -i`; `/bin/cp` on the argv path, with no shell in the way, overwrites
 *   without asking. So no flag or environment variable reaches that stall —
 *   *not going through a shell* does, which is the argv path
 *   `shell-necessity.ts` already argues for.
 *
 * ## Which signal is load-bearing, and it is not an environment variable
 *
 * With stdin at `/dev/null`, `cp -i` prints its question and gives up in
 * milliseconds. With stdin an open pipe — what a terminal looks like — the same
 * command was still sitting there after three seconds and would have sat there
 * forever. **stdin is the signal that decides hang versus fail** for these
 * commands; the environment variables in {@link NON_INTERACTIVE_ENV} cover the
 * tools that ask through a different door (git's editor, an askpass helper, a
 * pager waiting on a keystroke). That is why stdin is not a parameter of
 * {@link runNonInteractive}: a caller who could pass an inheritable stdin could
 * reintroduce exactly the stall this exists to remove.
 *
 * ## Failing promptly is not the same as failing loudly
 *
 * `cp -i` under a closed stdin exits **1** — the same 1 a permissions error or
 * a missing source file produces. It answered its own question "no", left the
 * file alone, and reported nothing a supervisor could distinguish from ordinary
 * failure. So the third layer here reads the captured output back for the
 * prompt shapes actually recorded ({@link PROMPT_SHAPES}) and re-labels such an
 * exit as `prompted`, quoting the line. And a tool that honours nothing at all
 * is bounded by a timeout and reported as `hung` rather than waited on.
 */
import { spawnSync } from "node:child_process";

/**
 * The declaration itself: what the run says about itself to every process it
 * starts. Every entry is a signal some tool reads to mean "no terminal is
 * watching", and each is set to the value that makes the tool *fail* rather
 * than wait — `false` for an editor or an askpass helper is a program that
 * exists on every POSIX box and exits non-zero, which is a loud stop.
 *
 * What is deliberately NOT here: any variable that answers a question. There is
 * no `pull.rebase`, no `--yes` to a destructive operation. Declaring nobody is
 * watching and deciding what they would have said are different jobs, and this
 * module only does the first.
 */
export const NON_INTERACTIVE_ENV: Readonly<Record<string, string>> = Object.freeze({
  /** The signal the widest range of tools already reads. */
  CI: "1",
  DEBIAN_FRONTEND: "noninteractive",
  /** No credential prompt on the terminal; git says so and exits. */
  GIT_TERMINAL_PROMPT: "0",
  /** An editor that opens is a hang. `false` exits non-zero and git says why. */
  GIT_EDITOR: "false",
  EDITOR: "false",
  VISUAL: "false",
  /** A pager waiting for `q` is the same stall wearing different clothes. */
  GIT_PAGER: "cat",
  PAGER: "cat",
  /** An askpass helper that fails is a reported failure; one that pops a window is not. */
  GIT_ASKPASS: "false",
  SSH_ASKPASS: "false",
  SSH_ASKPASS_REQUIRE: "never",
  /**
   * `false`, not `true`. `npx some-package` asks "Ok to proceed?" before it
   * installs, and `true` would answer that question — installing software on
   * the operator's behalf is precisely what this module does not do. `false`
   * makes the same invocation exit with an error naming the missing package.
   */
  NPM_CONFIG_YES: "false",
  PIP_NO_INPUT: "1",
  /** No cursor addressing, no progress spinner, nothing that assumes a screen. */
  TERM: "dumb",
});

/**
 * Variables removed rather than set. `DISPLAY` present is how ssh and git decide
 * a graphical askpass is available — a dialog on a screen nobody is looking at
 * is the purest form of this stall, and there is no value of `DISPLAY` that
 * means "none", only its absence.
 */
export const NON_INTERACTIVE_UNSET: readonly string[] = Object.freeze(["DISPLAY"]) as readonly string[];

/**
 * The environment a child is started in. The declaration wins over whatever the
 * parent had: a caller who exported `EDITOR=vim` for their own shell must not
 * hand that to an unattended child.
 */
export function nonInteractiveEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...NON_INTERACTIVE_ENV };
  for (const name of NON_INTERACTIVE_UNSET) delete env[name];
  return env;
}

/**
 * stdin for every child this module starts. Not a parameter — see the module
 * note on which signal is load-bearing.
 */
export const NON_INTERACTIVE_STDIN = "ignore" as const;

/** How long a child is given before it is treated as having ignored the declaration. */
export const DEFAULT_NON_INTERACTIVE_TIMEOUT_MS = 10 * 60_000;

/** One shape of question, as it appears in a command's own output. */
export interface PromptShape {
  id: string;
  pattern: RegExp;
}

/**
 * The questions this loop has actually been stopped by, plus git's own message
 * for honouring the declaration. Kept to shapes with a recorded instance or a
 * documented emitter — a wider net would start reading help text and error
 * messages as questions, and a false "it prompted" sends a builder after a
 * prompt that was never asked.
 */
export const PROMPT_SHAPES: readonly PromptShape[] = Object.freeze([
  // `overwrite src/web/budget.ts? (y/n [n]) not overwritten` — TRANSCRIPT:e42cd03d.
  { id: "overwrite-confirmation", pattern: /\boverwrit(?:e|ing)\b[^\n]{0,160}\?/i },
  { id: "yes-no-question", pattern: /\?[^\n]{0,40}[[(]\s*y(?:es)?\s*\/\s*n(?:o)?[^)\]\n]*[)\]]/i },
  { id: "ok-to-proceed", pattern: /\bok to proceed\b/i },
  { id: "are-you-sure", pattern: /\bare you sure\b/i },
  { id: "press-a-key", pattern: /\bpress\s+(?:any\s+key|enter|return)\b/i },
  { id: "secret-request", pattern: /\b(?:enter\s+)?pass(?:word|phrase)\b[^\n]{0,80}:/i },
  // git honouring GIT_TERMINAL_PROMPT=0 and saying so, rather than waiting.
  { id: "terminal-prompts-disabled", pattern: /terminal prompts disabled/i },
]) as readonly PromptShape[];

/** The prompt a command's output contains, with the line it was found on. */
export interface DetectedPrompt {
  shapeId: string;
  line: string;
}

/**
 * Find a question in what a command wrote. Line-wise so the report can quote
 * the question rather than the whole log.
 */
export function detectPrompt(output: string): DetectedPrompt | undefined {
  for (const line of output.split("\n")) {
    for (const shape of PROMPT_SHAPES) {
      if (shape.pattern.test(line)) return { shapeId: shape.id, line: line.trim() };
    }
  }
  return undefined;
}

/**
 * What a command did under the declaration.
 *
 * `completed` covers a non-zero exit as well as a zero one: `git pull` on
 * divergent branches exiting 128 is this module working, not failing. The two
 * outcomes that mean the declaration was not honoured are `prompted` and
 * `hung`, and they are the ones {@link assertHonoured} raises.
 */
export type NonInteractiveOutcome =
  | { kind: "completed"; status: number; output: string; durationMs: number }
  | { kind: "prompted"; status: number | null; output: string; durationMs: number; prompt: DetectedPrompt }
  | { kind: "hung"; output: string; durationMs: number; timeoutMs: number }
  | { kind: "not-run"; output: string; durationMs: number; message: string };

export interface NonInteractiveRun {
  argv: readonly string[];
  outcome: NonInteractiveOutcome;
}

export interface RunNonInteractiveOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Base environment the declaration is applied over. */
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  /** Injected for tests; the real one is `Date.now`. */
  now?: () => number;
}

/**
 * Run a command with the run declared unattended, capturing what it wrote.
 *
 * No shell (`spawnSync` with an argv array), because the one recorded overwrite
 * prompt came from a shell alias and would survive every flag here. stdin is
 * closed, the declaration is in the environment, and a child that outlives
 * `timeoutMs` is killed and reported rather than waited on.
 */
export function runNonInteractive(argv: readonly string[], options: RunNonInteractiveOptions = {}): NonInteractiveRun {
  const [command, ...args] = argv;
  if (!command) throw new Error("runNonInteractive needs a command");
  const timeoutMs = options.timeoutMs ?? DEFAULT_NON_INTERACTIVE_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const run = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: nonInteractiveEnv(options.env),
    stdio: [NON_INTERACTIVE_STDIN, "pipe", "pipe"],
    timeout: timeoutMs,
    maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
  });
  const durationMs = now() - startedAt;
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  // A killed-on-timeout child is the failure mode the node names as worse than
  // today: the tool ignored every signal, and a run that believed it could not
  // hang would be waiting on it still.
  const timedOut = (run.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (timedOut) return { argv, outcome: { kind: "hung", output, durationMs, timeoutMs } };

  // A spawn that never started is not a measurement of anything — reported
  // apart so it is never read as "the command ran and failed".
  if (run.error) {
    return { argv, outcome: { kind: "not-run", output, durationMs, message: run.error.message } };
  }

  const status = run.status;
  // Only a failing command is read for a question. A command that succeeded and
  // happened to print "are you sure" in its help text asked nobody anything,
  // and calling that a prompt would send a reader after a stall that never was.
  if (status !== 0) {
    const prompt = detectPrompt(output);
    if (prompt) return { argv, outcome: { kind: "prompted", status, output, durationMs, prompt } };
  }
  return { argv, outcome: { kind: "completed", status: status ?? 1, output, durationMs } };
}

/** Raised when a command did not honour the declaration. */
export class NonInteractiveStopError extends Error {
  constructor(
    public readonly argv: readonly string[],
    public readonly reason: "prompted" | "hung",
    public readonly detail: string,
  ) {
    super(`\`${argv.join(" ")}\` ${reason === "hung" ? "ignored" : "did not honour"} the non-interactive declaration: ${detail}`);
    this.name = "NonInteractiveStopError";
  }
}

/**
 * One line a supervisor can read, for every outcome. The point of converting a
 * stall into a failure is that somebody can see it, so the sentence says what
 * happened rather than only that something did.
 */
export function describeOutcome(run: NonInteractiveRun): string {
  const cmd = run.argv.join(" ");
  const o = run.outcome;
  switch (o.kind) {
    case "completed":
      return `\`${cmd}\` exited ${o.status} in ${o.durationMs}ms`;
    case "prompted":
      return `\`${cmd}\` stopped on a question nobody could answer (${o.prompt.shapeId}): ${o.prompt.line}`;
    case "hung":
      return `\`${cmd}\` was still running after ${o.timeoutMs}ms with no terminal attached, and was killed`;
    case "not-run":
      return `\`${cmd}\` never started: ${o.message}`;
  }
}

/** Throw on `prompted` or `hung`; return the run otherwise. */
export function assertHonoured(run: NonInteractiveRun): NonInteractiveRun {
  const o = run.outcome;
  if (o.kind === "prompted") throw new NonInteractiveStopError(run.argv, "prompted", describeOutcome(run));
  if (o.kind === "hung") throw new NonInteractiveStopError(run.argv, "hung", describeOutcome(run));
  return run;
}

/**
 * The `{status, output}` shape this repository's command runners already speak,
 * with a stall folded into it rather than dropped.
 *
 * A prompted or hung command comes back with a non-zero status it may not have
 * produced itself (`hung` has no exit code at all) and a final line naming the
 * stall, so a runner that only ever looks at `status` cannot read a stall as a
 * pass and a reader of the excerpt is told which of the two it was.
 */
export function nonInteractiveResult(run: NonInteractiveRun): { status: number | null; output: string } {
  const o = run.outcome;
  switch (o.kind) {
    case "completed":
      return { status: o.status, output: o.output };
    case "prompted":
      return { status: o.status === 0 || o.status === null ? 1 : o.status, output: `${o.output}\n${describeOutcome(run)}` };
    case "hung":
      // null, like a command that never ran: no exit code was produced, and
      // inventing one would put a number in the record nothing observed.
      return { status: null, output: `${o.output}\n${describeOutcome(run)}` };
    case "not-run":
      return { status: null, output: `${o.output}${o.message}` };
  }
}
