/**
 * The self-reflection gauge: three questions the build loop asks about its OWN
 * brief, each bound to the nodes of the pass it is asked in.
 *
 * When the builder is an agent, its whole trace is visible to the loop that
 * briefed it, and the founder's claim (2026-07-26) is that three questions asked
 * against that trace catch what the builder's report leaves out:
 *
 *   1. Does the builder understand exactly what to build, and why?
 *   2. Does it understand the working environment?
 *   3. Are there further constraints that only a human can unblock?
 *
 * Whether they catch anything is a human's measurement — a real builder
 * misreading a real brief — and nothing here claims it. What this module makes
 * mechanical is the precondition: **the questions cannot catch anything they
 * are never asked**, and a question asked in the abstract ("does it understand
 * what to build?") is one a builder answers "yes" to by reflex. So every
 * question is bound to the named solution and the named test the pass is about,
 * the render REFUSES a binding that would leave one unbound, and
 * {@link auditReflection} reads any pass output and says which questions are
 * missing or were asked without their node. That audit is what the instrument
 * on "Do the three reflection questions catch a builder misunderstanding the
 * pass output missed" runs.
 *
 * The binding comes from whichever permit cleared the solution — a red
 * instrument (`buildable`) or a human's recorded result (`gate`) — because the
 * two license different work and question 1 has to say which. A solution
 * nothing cleared has no binding, and the gauge renders nothing rather than a
 * question about a pass that is not happening.
 */
import type { OstNode } from "../ost/node.js";
import { byTitle, testsUnderSolution } from "../processes/tree.js";
import { titlesMatch } from "../ost/sanitize.js";
import { hasRecordedResult } from "../eval/evidence-debt.js";
import { buildPermit } from "../eval/buildable.js";

export type ReflectionKey = "target" | "environment" | "human";

/** Which permit a pass arrived under. They mean different things (see build-pass.sh). */
export type ReflectionPermit = "instrument" | "result";

export interface ReflectionBinding {
  /** The Solution the pass was cleared to build. */
  solution: string;
  /** The AssumptionTest carrying the permit. */
  test: string;
  permit: ReflectionPermit;
  /** The command that must go green — present when the permit is an instrument. */
  instrument?: string;
}

export interface ReflectionQuestion {
  key: ReflectionKey;
  /** The question, bound to this pass's nodes. */
  ask(binding: ReflectionBinding): string;
  /**
   * The stem that identifies the question in any output, bound or not. The
   * audit finds the stem first and only then asks whether the node is named,
   * so an abstract copy of the question is reported as UNBOUND rather than as
   * missing — the two are different failures and the second is the subtler one.
   *
   * A stem anchors the HEAD of its question: the audit reads from the stem to
   * the next `?`, so a stem matched mid-sentence would start the span after the
   * node it is looking for and report every bound question as unbound.
   */
  stem: RegExp;
  /** The binding fields whose quoted value must appear inside the question. */
  binds: readonly ("solution" | "test")[];
}

/** The three questions, in the order the founder stated them. Exported so the test reads the same list the render does. */
export const REFLECTION_QUESTIONS: readonly ReflectionQuestion[] = [
  {
    key: "target",
    stem: /Does the builder understand exactly what to build/,
    binds: ["solution", "test"],
    ask: (b) => {
      const why =
        b.permit === "instrument"
          ? `"${b.test}" is red: \`${b.instrument ?? "(instrument unrecorded)"}\` fails today and must pass`
          : `"${b.test}" carries a result a human recorded, and that finding is the reason`;
      return `Does the builder understand exactly what to build — "${b.solution}" — and why — ${why}?`;
    },
  },
  {
    key: "environment",
    stem: /Does it understand the working environment/,
    binds: ["solution", "test"],
    ask: (b) =>
      `Does it understand the working environment — the repository "${b.test}" is measured against, ` +
      `which it may change, and the vault holding "${b.solution}", which it may read and never write?`,
  },
  {
    key: "human",
    stem: /Are there further constraints/,
    binds: ["solution"],
    ask: (b) =>
      `Are there further constraints on building "${b.solution}" that only a human can unblock — ` +
      `ones the builder would otherwise work around silently rather than name?`,
  },
];

/**
 * The one tripwire: a binding that would render a question in the abstract is
 * refused before anything is rendered. Same rule `Vault.annotate` and the
 * Next Build briefing hold — the content is *exactly* empty/`undefined`/`null`,
 * never *contains* it, so a solution whose title discusses `null` still binds.
 */
function assertBound(name: string, value: string | undefined): asserts value is string {
  const t = (value ?? "").trim();
  if (t.length === 0 || /^(undefined|null)$/i.test(t)) {
    throw new Error(
      `refusing to render the reflection gauge: ${name} is ${t.length === 0 ? "empty" : `the literal string "${t}"`} — ` +
        `a question asked of no node is one a builder answers "yes" to by reflex`,
    );
  }
}

/** The gauge as the build prompt carries it: a lead-in, the three bound questions, and what to do with them. */
export function renderReflectionGauge(binding: ReflectionBinding): string {
  assertBound("the solution", binding.solution);
  assertBound("the test", binding.test);
  const questions = REFLECTION_QUESTIONS.map((q, i) => `  ${i + 1}. ${q.ask(binding)}`);
  return [
    "SELF-REFLECTION GAUGE — three questions this loop asks about its own brief to you, each bound to",
    "the nodes of this pass rather than asked in the abstract:",
    "",
    ...questions,
    "",
    "Answer all three in your final message, one sentence each, before you exit. A bare \"yes\" is",
    "the misunderstanding they exist to catch: name the thing you understood it to be, so a reader of",
    "the trace can see whether the brief landed or you filled its gaps yourself.",
  ].join("\n");
}

export interface ReflectionAudit {
  /** Questions present AND naming every node they bind. */
  asked: ReflectionKey[];
  /** Questions whose stem never appears in the output. */
  missing: ReflectionKey[];
  /** Questions whose stem appears but whose bound node is not named inside the question. */
  unbound: ReflectionKey[];
  /** All three asked, all three bound. */
  complete: boolean;
}

/**
 * Read a pass output and report which of the three questions reached it, bound.
 *
 * A question runs from its stem to the next `?`, so a question hard-wrapped by
 * a heredoc or a terminal still audits as one question. A node is "named" when
 * its title appears in double quotes inside that span — the same quoting the
 * render uses, and the same one every other CLI surface here uses for a title.
 */
export function auditReflection(output: string, binding: Pick<ReflectionBinding, "solution" | "test">): ReflectionAudit {
  const asked: ReflectionKey[] = [];
  const missing: ReflectionKey[] = [];
  const unbound: ReflectionKey[] = [];
  for (const q of REFLECTION_QUESTIONS) {
    const at = output.search(q.stem);
    if (at === -1) {
      missing.push(q.key);
      continue;
    }
    const end = output.indexOf("?", at);
    const span = output.slice(at, end === -1 ? undefined : end + 1);
    const bound = q.binds.every((field) => span.includes(`"${binding[field]}"`));
    (bound ? asked : unbound).push(q.key);
  }
  return { asked, missing, unbound, complete: missing.length === 0 && unbound.length === 0 };
}

/**
 * Resolve the binding for a solution from the tree: the red instrument first
 * (the permit the build loop acts on most), else the first test beneath it
 * with a recorded result, else null — nothing cleared it, so there is no pass
 * to ask about.
 */
export function reflectionBinding(tree: readonly OstNode[], solution: string): ReflectionBinding | null {
  const permit = buildPermit(tree, solution);
  if (permit.cleared && permit.test) {
    return { solution, test: permit.test, permit: "instrument", instrument: permit.instrument };
  }
  const node = tree.find((n) => n.layer === "Solution" && titlesMatch(n.title, solution));
  if (!node) return null;
  const withResult = testsUnderSolution(node, byTitle([...tree])).find(hasRecordedResult);
  if (!withResult) return null;
  return { solution: node.title, test: withResult.title, permit: "result" };
}
