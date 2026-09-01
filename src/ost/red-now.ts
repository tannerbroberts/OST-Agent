/**
 * The red-now guard: running a candidate instrument before accepting it.
 *
 * **The property this enforces is the only load-bearing one an instrument has,
 * and until now nothing checked it.** `ost_set_instrument`'s own description
 * says a command "MUST name behaviour that does not exist yet, so it fails
 * against the repository today"; the ruleset says an instrument that already
 * passes "cannot fail, so it measures nothing". Both were true statements about
 * what the author was supposed to do, and the write boundary took the author's
 * word for it — which means the property was held up by the honour of the agent
 * writing the node, on a surface whose whole design assumes an agent's
 * unchecked claim is worth nothing. The `ost-agent verify` filing path in
 * {@link ../ost/instrument.ts} does refuse a first-run green, but only later,
 * only on the CLI, and only for the node that reached it; the wrong command has
 * landed by then and the queue has already been read.
 *
 * ## Three verdicts, not two
 *
 * Sorting into accept and refuse is what a weaker version of this would do, and
 * it is wrong in the direction that matters. A command can fail for reasons that
 * have nothing to do with the repository — a spec nobody wrote, a package nobody
 * installed, a runner npx could not produce — and every one of those exits
 * non-zero exactly like an honest red. A guard that accepts them has not
 * enforced red-now; it has enforced *non-zero*, which is the weak-red problem
 * wearing an execution capability. So:
 *
 * - `accepted` — a spec was collected, ran, and an assertion in it failed.
 * - `already-built` — it passed. Refused: the behaviour is there, and what the
 *   node needs is a status, not an instrument.
 * - `declined` — nothing was measured. Refused too, and separately, because the
 *   caller's next move is different in each case and neither is "try again".
 *
 * The middle two are the whole question. `no-spec` and `unavailable` are both
 * declines and they stay apart in the message, because one says write the spec
 * and the other says fix the box.
 *
 * ## What this cannot do, said here rather than discovered later
 *
 * The classification is only as good as {@link ../ost/instrument.ts#classifyRun},
 * whose patterns are drawn from output this repository has actually observed. A
 * failure mode nobody has seen yet reads as `red` and is therefore *accepted* —
 * the guard's errors run toward letting a weak instrument through rather than
 * toward blocking a real one, which is the survivable direction for a write
 * boundary but is not "no false accepts".
 *
 * And it executes a command as part of a write, on a tool surface built without
 * a shell (CONTRIBUTING.md: "never add a tool that … shells out"). Two bounds
 * make that narrower than it sounds and neither makes it nothing: the command is
 * whatever {@link ../knowledge/instruments.ts} already accepted — one spec file
 * in the repository's own suite, argv with no interpreter, nothing else
 * expressible — and it is a command the agent could already cause to run by
 * writing it into the vault and letting `ost-agent verify` reach it. This moves
 * that execution earlier; it does not widen what may be executed. It is still a
 * new thing for a tool call to do, which is why it is off unless an operator
 * turns it on ({@link ../config/schema.ts}, `instruments.runOnWrite`).
 */
import type { InstrumentRun } from "./instrument.js";

/** What the guard decided about a candidate command. */
export type RedNowVerdict = "accepted" | "already-built" | "declined";

/** The verdict, and the reason a refusal is a refusal. */
export interface RedNowRuling {
  verdict: RedNowVerdict;
  /** Present exactly when the verdict is not `accepted`. Addressed to the author. */
  refusal?: string;
}

/**
 * Sort one run into the three verdicts.
 *
 * `title` and `command` appear in the refusals because a message that names
 * neither leaves the caller to guess which of its calls was refused, and this
 * surface's refusals are read by an agent that made several.
 */
export function ruleOnCandidate(run: InstrumentRun, title: string, command: string): RedNowRuling {
  if (run.observation === "red") return { verdict: "accepted" };

  if (run.observation === "green") {
    return {
      verdict: "already-built",
      refusal:
        `refusing to attach \`${command}\` to "${title}": it PASSES against the repository right now (exit ` +
        `${run.exitCode ?? "0"}). An instrument that is green before anything was built cannot fail, so it ` +
        `measures nothing and hands a builder no definition of done — it would make the test look answered ` +
        `while answering nothing. If the behaviour is already there, that is a fact about the solution and ` +
        `belongs in its \`status\` (\`ost_set_status\`), not in a command pretending to predict it. If it is ` +
        `not, point this at the assertion that fails today.`,
    };
  }

  if (run.observation === "no-spec") {
    return {
      verdict: "declined",
      refusal:
        `refusing to attach \`${command}\` to "${title}": the command exits non-zero, but no spec was collected ` +
        `(${run.excerpt}). That is not a red about behaviour — every question written on that filename is ` +
        `equally red, and an empty spec would turn it green. Write the failing spec, then attach the command ` +
        `that fails on its assertion.`,
    };
  }

  return {
    verdict: "declined",
    refusal:
      `refusing to attach \`${command}\` to "${title}": the command exits non-zero, but the run never reached ` +
      `the spec (${run.excerpt}). This repository has not said anything about the behaviour — the environment ` +
      `failed to ask it. Nothing is written, because a red recorded from a broken box would be indistinguishable ` +
      `from a prediction the code refuted. Fix the environment and make the call again.`,
  };
}
