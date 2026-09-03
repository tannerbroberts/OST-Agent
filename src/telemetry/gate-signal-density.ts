/**
 * How buried was a gate's firing in the output around it?
 *
 * On 2026-08-06 three gates fired in one session and all three were first read
 * as environmental — "flaky timing test", "stale fixture", "CI flake". Two were
 * real defects in the thing being measured and the third was a real defect in
 * the measurement. None was the machine. The tree offers two explanations for
 * the misreading and they do not overlap: either the gates' *wording* failed to
 * say what they defended (fix the messages), or the firings were *buried* in
 * output and wording was never the binding constraint (fix the placement —
 * hold firings to a decision boundary instead of interleaving them with
 * progress).
 *
 * This module answers the second question, which is the cheap one: how much
 * unrelated output stood around each firing when the reader met it. It can only
 * kill the wording hypothesis, never confirm it — a perfectly isolated firing
 * that was still misread could have been misread for half a dozen reasons this
 * count cannot see.
 *
 * ## What is counted
 *
 * A **reader line** is one line of what arrived in the session and scrolled past
 * whoever was watching: assistant prose, the command line of a tool call, each
 * line of a tool result, and injected user-side text (task notifications and the
 * like). Blank lines are dropped — a blank line costs no reading, and counting
 * it would inflate every window equally. Thinking blocks are dropped because
 * they are the reader's own reasoning rather than output competing with the
 * firing for attention; in the recorded session the point is moot, since not one
 * of its 96 thinking blocks carries any text.
 *
 * ANSI colour and the `test\tRun npm test …\t<timestamp>Z ` prefix that GitHub
 * Actions logs put on every line are stripped before matching. The prefix is
 * uniform noise sitting on related and unrelated lines alike, so it cancels out
 * of the ratio the measure reports.
 *
 * ## Related, and the two rules for deciding it
 *
 * A line is **related** to a firing when it is part of that gate's own report —
 * its test file, its test name, its assertion, its measured number, its source
 * location. Two rules are implemented because the choice is arguable and the
 * arguable half should be visible rather than settled by fiat:
 *
 * - `strict` — a line is related if it matches one of the firing's subject
 *   patterns, or if it continues a related line inside the same output block.
 *   Continuation runs **forward only**: a `FAIL` header claims the indented
 *   detail beneath it, which is the grammar vitest actually prints. Backward
 *   propagation is refused, because it would hand the four `question(s), budget`
 *   log lines that happen to precede the ENOTEMPTY error to the ENOTEMPTY gate.
 * - `generous` — every line of an output block that contains a related line is
 *   related, unless it names some other test file. This is the rule most
 *   favourable to the wording hypothesis and it is here as a robustness check:
 *   a verdict that survives it is not an artefact of where the strict rule drew
 *   the line.
 *
 * ## The window, and why it is the size it is
 *
 * The bar was fixed by a human before anything was measured — *fewer than 10
 * unrelated lines in the surrounding window* — but "the surrounding window" was
 * left without a size, and the count rises monotonically with it. So the size is
 * chosen here on a ground that has nothing to do with the outcome: the window is
 * the reader's screen, and `SCREEN_RADIUS` is 12 lines each side, a 25-line
 * viewport — the classic 24-line terminal, which is the **smallest screen anyone
 * actually reads on**. Every larger screen raises every count, so this is the cut
 * most favourable to the hypothesis under test.
 *
 * Because that choice is still a choice, `densityCurve` reports the count at
 * every radius and `flipRadius` reports the first radius at which a firing
 * reaches the bar. A verdict that only holds at one window size is one the
 * reader gets to see as such.
 */

/** What a reader line came from. Thinking is not among them; see the header. */
export type ReaderLineKind = "assistant_text" | "tool_use" | "tool_result" | "user_text";

export interface ReaderLine {
  kind: ReaderLineKind;
  /**
   * Which contiguous emission this line belongs to — one tool result, one prose
   * block, one command. Continuation only runs inside a block, so this is what
   * stops a `FAIL` header claiming the next tool's output.
   */
  block: number;
  /** The line as read: ANSI stripped, CI log prefix stripped, never truncated. */
  text: string;
}

/** GitHub Actions prefixes every log line with job, step and timestamp. */
const CI_LOG_PREFIX = /^[\w-]+\tRun [^\t]*\t\d{4}-\d\d-\d\dT[\d:.]+Z /;
// eslint-disable-next-line no-control-regex
const ANSI = /\x1B\[[0-9;]*m/g;

function normalize(text: string): string {
  return text.replace(ANSI, "").replace(CI_LOG_PREFIX, "");
}

/**
 * Flatten a Claude Code transcript into the lines a reader saw, in order.
 *
 * Unparseable records are skipped rather than thrown on: a transcript with one
 * torn line is still a transcript, and the alternative is a census that cannot
 * read its subject and reports nothing.
 */
export function readerLines(jsonl: string): ReaderLine[] {
  const out: ReaderLine[] = [];
  let block = 0;
  const push = (kind: ReaderLineKind, text: string): void => {
    block += 1;
    for (const line of normalize(String(text ?? "")).split("\n")) {
      if (line.trim() === "") continue; // a blank line costs no reading
      out.push({ kind, block, text: line });
    }
  };
  for (const raw of jsonl.split("\n")) {
    if (raw.trim() === "") continue;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = record.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (record.type === "assistant") {
      if (!Array.isArray(content)) continue;
      for (const b of content as Record<string, unknown>[]) {
        if (b.type === "text") push("assistant_text", b.text as string);
        else if (b.type === "tool_use")
          push("tool_use", `$ ${String(b.name)} ${JSON.stringify(b.input)}`);
      }
    } else if (record.type === "user") {
      if (typeof content === "string") push("user_text", content);
      else if (Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
          if (b.type === "text") push("user_text", b.text as string);
          else if (b.type === "tool_result") {
            const c = b.content;
            const text =
              typeof c === "string"
                ? c
                : Array.isArray(c)
                  ? (c as { text?: string }[]).map((x) => x.text ?? "").join("\n")
                  : "";
            push("tool_result", text);
          }
        }
      }
    }
  }
  return out;
}

export interface FiringSpec {
  /** Stable key, used in assertions and in the corpus. */
  key: string;
  /** The gate, as the session would have named it. */
  gate: string;
  /** How the session first read it. */
  firstReading: string;
  /** What it turned out to be. */
  actually: string;
  /**
   * The first reader line at which this gate is shown *failing*. Written to
   * match nothing earlier in the session — the wall-clock gate, for instance,
   * prints a green line 300 lines before it prints this one.
   */
  opensWith: RegExp;
  /** Patterns that make a line part of this gate's own report. */
  subject: RegExp[];
}

/**
 * The three firings of session `89ac8277-29ce-4d80-827e-cefea0bebabf`,
 * 2026-08-06, as the solution node records them.
 */
export const GATE_FIRINGS_2026_08_06: FiringSpec[] = [
  {
    key: "corrections-ledger-quiet-window",
    gate: "test/loop/corrections-ledger.test.ts — the quiet window",
    firstReading: "stale fixture, ignore",
    actually: "a test asserting the age of the working copy, green only for 30 minutes after checkout",
    opensWith: /❯ test\/loop\/corrections-ledger\.test\.ts \(\d+ tests \| \d+ failed\)/,
    subject: [
      /corrections-ledger\.test\.ts/,
      /quiet ?-?window/i,
      /quietMinutes/,
      /recordCorrections/,
      /result\.sessions/,
      /a session still being written/,
    ],
  },
  {
    key: "wall-clock-budget-z3",
    gate: "test/mcp/wall-clock-budget.test.ts — the Z3 budget",
    firstReading: "flaky timing test, slow runner",
    actually: "a 3x regression: three tree.filter(...)-per-node scans, 44% of CPU",
    opensWith: /→ ost_next_work took \d+ms: expected \d+ to be less than 2000/,
    subject: [
      /wall-clock-budget/,
      /ost_next_work took/,
      /ost_check took/,
      /BUDGET_MS/,
      /10,000-node vault inside the budget/,
    ],
  },
  {
    key: "commit-enotempty",
    gate: "test/mcp/commit.test.ts — ENOTEMPTY on cleanup",
    firstReading: "CI flake",
    actually: "the fixture deletes a repository while `git gc --auto` is still writing in it",
    opensWith: /→ ENOTEMPTY: directory not empty, rmdir/,
    subject: [/ENOTEMPTY/, /commit\.test\.ts/, /enqueueCommit/, /does not wedge/],
  },
];

export type Attribution = "strict" | "generous";

/**
 * The pre-committed bar, from the assumption test: *"the content hypothesis
 * survives only if all three fired with fewer than 10 unrelated output lines in
 * the surrounding window. At 10 or more for any of them, that firing was
 * buried."* It is a human's number, fixed before anything was measured, and it
 * is pinned here so that moving it is a visible commit rather than a tuning.
 */
export const BURIAL_BAR = 10;

/** Twelve lines each side — a 25-line viewport. See the header. */
export const SCREEN_RADIUS = 12;

/** Does this line name a test file that is not the firing's own? */
function namesAnotherSubject(line: ReaderLine, spec: FiringSpec): boolean {
  const named = line.text.match(/test\/[\w/.-]+\.test\.ts/);
  return !!named && !spec.subject.some((re) => re.test(named[0]));
}

/**
 * Mark every line that belongs to this firing's own report.
 *
 * Returns one boolean per line, parallel to the input.
 */
export function attributeLines(
  lines: ReaderLine[],
  spec: FiringSpec,
  mode: Attribution = "strict",
): boolean[] {
  const related = lines.map((l) => spec.subject.some((re) => re.test(l.text)));
  // Forward continuation inside a block: a header claims the detail beneath it.
  for (let i = 1; i < lines.length; i++) {
    if (related[i] || !related[i - 1]) continue;
    if (lines[i].block !== lines[i - 1].block) continue;
    if (namesAnotherSubject(lines[i], spec)) continue;
    related[i] = true;
  }
  if (mode === "strict") return related;
  // Generous: a block holding a related line is a block about the firing.
  let i = 0;
  while (i < lines.length) {
    let end = i;
    while (end + 1 < lines.length && lines[end + 1].block === lines[i].block) end += 1;
    let any = false;
    for (let k = i; k <= end; k++) if (related[k]) any = true;
    if (any) for (let k = i; k <= end; k++) if (!namesAnotherSubject(lines[k], spec)) related[k] = true;
    i = end + 1;
  }
  return related;
}

/** Where a firing opens, or -1 if this stream does not contain it. */
export function findFiring(lines: ReaderLine[], spec: FiringSpec): number {
  return lines.findIndex((l) => spec.opensWith.test(l.text));
}

export interface FiringDensity {
  key: string;
  /** Index of the opening line in the reader stream. */
  index: number;
  /** Unrelated lines in the window before the firing. */
  unrelatedBefore: number;
  /** Unrelated lines in the window after it. */
  unrelatedAfter: number;
  /** Both sides. This is the number the bar is applied to. */
  unrelated: number;
  /** `unrelated >= BURIAL_BAR` — the firing was buried, wording was not the constraint. */
  buried: boolean;
  /**
   * The smallest radius at which this firing reaches the bar, or null if it
   * never does inside `curveMax`. A firing that only crosses at a huge radius
   * was isolated; one that crosses at 6 was buried in its own screenful.
   */
  flipRadius: number | null;
  /**
   * Reader lines between the firing and the next line of assistant prose — the
   * next point at which the session said anything about anything. The second
   * measure the assumption test asks for: how far the firing had to survive in
   * attention before a reading of it was committed to.
   */
  linesToNextProse: number | null;
}

/** Unrelated-line count at every radius from 1 to `maxRadius`. */
export function densityCurve(
  lines: ReaderLine[],
  spec: FiringSpec,
  maxRadius: number,
  mode: Attribution = "strict",
): number[] {
  const at = findFiring(lines, spec);
  if (at < 0) return [];
  const related = attributeLines(lines, spec, mode);
  const curve: number[] = [];
  for (let r = 1; r <= maxRadius; r++) {
    let unrelated = 0;
    for (let i = Math.max(0, at - r); i <= Math.min(lines.length - 1, at + r); i++) {
      if (i !== at && !related[i]) unrelated += 1;
    }
    curve.push(unrelated);
  }
  return curve;
}

export interface MeasureOptions {
  radius?: number;
  mode?: Attribution;
  /** How far the flip-radius search runs. */
  curveMax?: number;
}

export function measureFiring(
  lines: ReaderLine[],
  spec: FiringSpec,
  options: MeasureOptions = {},
): FiringDensity {
  const radius = options.radius ?? SCREEN_RADIUS;
  const mode = options.mode ?? "strict";
  const curveMax = options.curveMax ?? 40;
  const at = findFiring(lines, spec);
  if (at < 0) {
    throw new Error(`firing "${spec.key}" is not in this stream — the corpus cannot answer for it`);
  }
  const related = attributeLines(lines, spec, mode);
  let unrelatedBefore = 0;
  let unrelatedAfter = 0;
  for (let i = Math.max(0, at - radius); i <= Math.min(lines.length - 1, at + radius); i++) {
    if (i === at || related[i]) continue;
    if (i < at) unrelatedBefore += 1;
    else unrelatedAfter += 1;
  }
  const curve = densityCurve(lines, spec, curveMax, mode);
  const flipIndex = curve.findIndex((n) => n >= BURIAL_BAR);
  let linesToNextProse: number | null = null;
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].kind === "assistant_text") {
      linesToNextProse = i - at;
      break;
    }
  }
  const unrelated = unrelatedBefore + unrelatedAfter;
  return {
    key: spec.key,
    index: at,
    unrelatedBefore,
    unrelatedAfter,
    unrelated,
    buried: unrelated >= BURIAL_BAR,
    flipRadius: flipIndex < 0 ? null : flipIndex + 1,
    linesToNextProse,
  };
}

/**
 * What the pre-committed bar says about one firing.
 *
 * `falsified` is a result, not a failure: the assumption test exists to be able
 * to kill the wording hypothesis, and killing it re-aims the solution at
 * placement rather than at message text.
 */
export function verdict(density: FiringDensity): "survives" | "falsified" {
  return density.buried ? "falsified" : "survives";
}
