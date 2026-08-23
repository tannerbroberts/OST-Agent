/**
 * The symbol-failure census: when a run called a symbol the compiler could not
 * find, had the run *meant to add it* — or was the symbol already there and the
 * call simply wrong?
 *
 * The question decides whether to build a declaration ledger. The proposal is
 * that a run about to reference a not-yet-written symbol declares it first, so
 * that a batch ending with the declaration still open reports a dropped
 * intention by name instead of leaving a typecheck error that reads exactly like
 * a typo. That mechanism only pays for itself if dropped intentions are a real
 * share of these failures. If the symbol usually existed already, the ledger
 * addresses a case that barely occurs, and the effort belongs elsewhere.
 *
 * So this module counts, over the compiler errors that actually reached a run.
 * The bar was fixed before the count: **at least 3 in 10** must be dropped
 * intentions. See {@link SYMBOL_FAILURE_RULE.bar}.
 *
 * ## What a failure is classified by: what the session did next
 *
 * A run's intention is not recorded anywhere, so the census does not try to read
 * it. It reads the **repair** — the first edit after the failure that touches the
 * symbol — because that is an observable act with only a few possible shapes, and
 * each shape says something different about what went wrong:
 *
 * - **defined** — the session went on to write the symbol. The intention was real
 *   and had not landed. *This is the only class the ledger covers.*
 * - **imported** — the session added the symbol to an import clause. It existed,
 *   spelled correctly, in another file. Declaring it would have been a lie.
 * - **renamed** — the reference was replaced or removed. The symbol the run wanted
 *   was a different one, or none.
 * - **rehomed** — the name survived and what it was asked of changed
 *   (`readConfig(dir).processes` → `readConfig(dir).config.processes`). The
 *   property was never missing; the receiver was wrong.
 * - **unresolved** — the session never touched it again. Counted **neither way**.
 *
 * Only the first of those five is a dropped intention, and the middle three are
 * classes the parent solution's binary taxonomy — dropped intention *or* wrong
 * name — does not have. That the corpus needs them is itself a finding; see
 * {@link Resolution}.
 *
 * ## The reading the solution's own framing implies, published beside it
 *
 * There is a cheaper classifier available, and it is the one the opportunity node
 * reaches for: the compiler's `Did you mean 'X'?`. Where the compiler offers a
 * near-match, call it a wrong name; where it offers none, call it a dropped
 * intention. {@link SymbolFailureCensus.readings} takes the count both ways,
 * because on this corpus they do not merely differ — they disagree about the bar,
 * and by a wide margin. A verdict that turns on which of two defensible readings
 * an author picked is a fact about the reading, and
 * {@link SymbolFailureCensus.ruleDecides} says so on the report's face.
 *
 * ## Coverage comes first, because most of this signal is an echo
 *
 * A compiler error is text, and this project writes its own failures into the
 * vault as evidence. Every later pass that reads that node, dumps the tree, or
 * greps the record re-emits the same error into its own transcript. Counting
 * occurrences would therefore report the same two failures hundreds of times and
 * call it a corpus.
 *
 * Two rules answer that, and both are load-bearing:
 *
 * - A failure counts only when the text came out of a **typecheck, build or test
 *   command** ({@link isTypecheckCommand}). Anything else is a
 *   {@link SymbolFailureCensus.cited} — the record being read back, reported but
 *   never counted.
 * - Within a session, a symbol counts **once**. A `tsc` run repeated after a
 *   failed fix emits the same error again; that is one failure, not two.
 *
 * ## What a count out of this cannot settle
 *
 * It sees failures that **reached a typecheck**. A symbol a run declared, forgot,
 * and never called is invisible here — and that is precisely the abandonment the
 * ledger claims to catch. This census can say how much of the *observed* failure
 * traffic the ledger would cover; it cannot size the silent case at all, and a
 * low share here is therefore an argument about cost-effectiveness rather than a
 * proof that dropped intentions are rare.
 */
import type { TranscriptSession } from "./preflight.js";

/**
 * The error codes this census reads: TypeScript's "I cannot see that symbol"
 * family.
 *
 * `TS2304` and `TS2552` are a bare name the checker could not resolve, with and
 * without a spelling suggestion. `TS2339` and `TS2551` are the same thing for a
 * property, again without and with. Both halves of the pair matter: the presence
 * of a suggestion is one of the two readings this census reports, so a code that
 * only fires when a suggestion exists cannot be dropped without biasing it.
 */
export type SymbolFailureCode = "TS2304" | "TS2339" | "TS2551" | "TS2552";

/**
 * What the session did about the failure, and therefore what the failure was.
 *
 * The parent solution's taxonomy has two values — a dropped intention or a wrong
 * name. The corpus does not fit in two. `imported` and `rehomed` are both cases
 * where the symbol existed under exactly the name the run used, which is neither
 * a dropped intention (nothing was missing) nor a wrong name (nothing was
 * misspelled), and a declaration ledger does nothing for either.
 */
export type Resolution = "defined" | "imported" | "renamed" | "rehomed" | "unresolved";

/** One symbol failure, as it reached a run. */
export interface SymbolFailure {
  /** Transcript session id — with `entry`, how a reader goes and looks at it. */
  session: string;
  /**
   * Line index of the entry carrying the compiler's output.
   *
   * A line index rather than a count of entries, because {@link classifyResolution}
   * walks the same array forward from here. The two agree on any real transcript,
   * which is what made them disagree quietly on a sliced one until a fixture
   * caught it.
   */
  entry: number;
  /** The transcript's timestamp for that entry. */
  ts: string;
  code: SymbolFailureCode;
  /** The name the compiler could not find, or the property it could not see. */
  symbol: string;
  /** The type the property was looked for on; empty for a bare name. */
  onType: string;
  /** The near-match the compiler offered, or null when it offered none. */
  suggestion: string | null;
  /** The command whose output carried it, clipped. */
  command: string;
  /** The message as the compiler wrote it, clipped. */
  message: string;
}

/** A failure with the repair the session made for it. */
export interface ResolvedFailure extends SymbolFailure {
  resolution: Resolution;
  /** The tool and entry that resolved it — `Edit e199`. Empty when unresolved. */
  resolvedBy: string;
  /** The text that decided the classification, clipped. Empty when unresolved. */
  evidence: string;
}

/** A symbol error that reached a run without a compiler having just produced it. */
export interface CitedFailure {
  session: string;
  entry: number;
  /** The tool that carried the text back — `Read`, `ost_read_tree`, `Bash`. */
  tool: string;
  /** What it was reading, clipped: a file path, a command, or empty. */
  subject: string;
  /** How many symbol errors that one result carried. */
  errors: number;
}

/** How many failures fell to each repair. */
export type ResolutionCells = Record<Resolution, number>;

/** The same count taken under a different classifier. */
export interface CensusReading {
  /** What the reading is, in the reader's words. */
  name: string;
  /** How it decides "dropped intention". */
  rule: string;
  dropped: number;
  denominator: number;
  /** dropped / denominator, or null when the denominator is empty. */
  share: number | null;
  meetsBar: boolean;
}

/** The same count taken with a different answer for the unresolved failures. */
export interface DenominatorReading {
  name: string;
  dropped: number;
  denominator: number;
  share: number | null;
  meetsBar: boolean;
}

export interface SymbolFailureCensus {
  /** Sessions offered to the reader — the corpus, before scope. */
  sessionsRead: number;
  /**
   * Symbol errors found in tool output, before either scope rule. The gap
   * between this and {@link failures} is the echo, and it is most of the signal.
   */
  errorsSeen: number;
  /** Errors that reached a run by being read back rather than newly produced. */
  cited: CitedFailure[];
  /** Distinct (session, symbol) failures a compiler produced. The corpus. */
  failures: number;
  cells: ResolutionCells;
  /** Failures whose repair the reader found. The headline denominator. */
  resolved: number;
  /** Of those, how many were a symbol the session then wrote. */
  dropped: number;
  /** dropped / resolved under the headline reading, null when empty. */
  share: number | null;
  /** The pre-committed bar, carried here so a reader need not look it up. */
  bar: number;
  meetsBar: boolean;
  /** The headline reading beside the one the solution's framing implies. */
  readings: CensusReading[];
  /** What each answer for the unresolved failures would have said. */
  denominators: DenominatorReading[];
  /**
   * True when some reading or rung disagrees with the headline about the bar.
   * The verdict is then a property of the rule rather than of the failures, and
   * the report says so instead of standing on its own number.
   */
  ruleDecides: boolean;
  /** Every failure with its repair, in the order the errors were produced. */
  classified: ResolvedFailure[];
}

/**
 * The classifier, fixed in source before the corpus was counted.
 *
 * Exported so a test can assert against it and a reader can disagree with it by
 * name rather than by suspicion. Changing a value here changes the finding, which
 * is why it is one object and not constants scattered through the reader.
 */
export const SYMBOL_FAILURE_RULE = {
  /**
   * The pre-committed bar: at least this share of symbol failures must be dropped
   * intentions for a declaration ledger to be worth the mechanism it costs.
   *
   * Set by the assumption test before anything was counted, together with the
   * losing branch — below it, the solution is deferred in favour of its two
   * siblings, which cover the wrong-name case between them.
   */
  bar: 0.3,

  /** The codes read. See {@link SymbolFailureCode}. */
  codes: ["TS2304", "TS2339", "TS2551", "TS2552"] as const,

  /**
   * Commands whose output is a compiler's verdict rather than a record being
   * read back.
   *
   * This is the rule that keeps the census from counting its own subject matter.
   * It is deliberately about the *command*, not about the text: an early draft
   * matched on the word "typecheck" and promptly counted four `Read`s of a node
   * titled "…a whole-project typecheck at the end of the batch is what tells me"
   * as four compiler runs.
   */
  producers: [
    "tsc",
    "vitest",
    "jest",
    "run build",
    "run check",
    "run typecheck",
    "run type-check",
    "run test",
    "run lint",
    "run bundle",
    "run gen:skill",
    "npm test",
  ] as const,

  /**
   * How far past the failure the reader will look for the repair.
   *
   * Unbounded, because a session that fixes a symbol two hundred entries later
   * still fixed it, and a window would silently convert those into `unresolved`
   * — the bucket the most generous denominator counts as dropped intentions. A
   * cap here would therefore flatter the solution under test.
   */
  repairWindow: Number.POSITIVE_INFINITY,
} as const;

/** How much of a command or message is kept. Long enough to identify, short enough to read. */
export const MAX_SYMBOL_TEXT_CHARS = 400;

export function clipText(text: string, max = MAX_SYMBOL_TEXT_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Escape a symbol so it can be dropped into a `RegExp` as itself. */
function literal(symbol: string): string {
  return symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── reading the failures out of the record ───────────────────────────────────

/**
 * Whether a shell command runs a compiler.
 *
 * A command may be a pipeline, a `cd &&` chain or a heredoc with a build on the
 * end — this project writes all three — so the whole command line is searched,
 * not just its first word. What is *not* searched is the output: see
 * {@link SYMBOL_FAILURE_RULE.producers} for the mistake that rule prevents.
 */
export function isTypecheckCommand(command: string): boolean {
  return SYMBOL_FAILURE_RULE.producers.some((producer) => {
    const escaped = producer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    return new RegExp(`(^|[\\s&|;(])(npx\\s+|npm\\s+|pnpm\\s+|yarn\\s+|bun\\s+)?${escaped}\\b`).test(command);
  });
}

/** One compiler error, as parsed out of a block of output. */
export interface ParsedSymbolError {
  code: SymbolFailureCode;
  symbol: string;
  onType: string;
  suggestion: string | null;
  message: string;
}

/**
 * Lift every symbol error out of a block of compiler output.
 *
 * Two shapes, one per half of the family: `Cannot find name 'x'` with an optional
 * `Did you mean 'y'?`, and `Property 'x' does not exist on type 'T'` with the same
 * optional tail. The type is captured because a property missing from an inline
 * union is a different animal from one missing from a named interface, and a
 * reader of the census wants to see which it is looking at.
 */
export function parseSymbolErrors(output: string): ParsedSymbolError[] {
  const found: ParsedSymbolError[] = [];
  const codes = SYMBOL_FAILURE_RULE.codes.join("|");
  const line = new RegExp(`error (${codes}): ([^\\n]*)`, "g");
  let match: RegExpExecArray | null;
  while ((match = line.exec(output)) !== null) {
    const code = match[1] as SymbolFailureCode;
    const message = match[2];
    const name = /Cannot find name '([^']+)'/.exec(message);
    const property = /Property '([^']+)' does not exist on type '([\s\S]*)/.exec(message);
    const suggestion = /Did you mean '([^']+)'\?/.exec(message);
    if (name) {
      found.push({ code, symbol: name[1], onType: "", suggestion: suggestion?.[1] ?? null, message: clipText(message) });
    } else if (property) {
      // The type is everything up to the closing quote of the final `'…'`, which
      // an inline union spends hundreds of characters reaching.
      const tail = property[2];
      const close = tail.lastIndexOf("'");
      found.push({
        code,
        symbol: property[1],
        onType: clipText(close === -1 ? tail : tail.slice(0, close), 120),
        suggestion: suggestion?.[1] ?? null,
        message: clipText(message),
      });
    }
  }
  return found;
}

/** The text of a `tool_result` block, whichever shape it arrived in. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "string" ? block : String((block as { text?: unknown })?.text ?? "")))
    .join("\n");
}

/** What a `tool_use` was pointed at, for the citation record. */
function subjectOf(name: string, input: Record<string, unknown>): string {
  if (name === "Bash") return clipText(String(input.command ?? ""), 160);
  const target = input.file_path ?? input.path ?? input.pattern ?? "";
  return clipText(String(target), 160);
}

/**
 * Every symbol failure a compiler produced in a corpus of transcripts, plus every
 * one that merely passed back through it.
 *
 * A symbol is counted once per session: a `tsc` re-run after a failed repair
 * emits the same error again, and the second emission is the same failure.
 */
export function readSymbolFailures(sessions: readonly TranscriptSession[]): {
  failures: SymbolFailure[];
  cited: CitedFailure[];
  errorsSeen: number;
} {
  const failures: SymbolFailure[] = [];
  const cited: CitedFailure[] = [];
  let errorsSeen = 0;

  for (const session of sessions) {
    const calls = new Map<string, { name: string; input: Record<string, unknown> }>();
    const seen = new Set<string>();
    const lines = session.jsonl.split("\n");

    for (let entryIndex = 0; entryIndex < lines.length; entryIndex++) {
      const line = lines[entryIndex];
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";

      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          calls.set(block.id, { name: String(block.name ?? ""), input: (block.input ?? {}) as Record<string, unknown> });
        }
        if (block.type !== "tool_result") continue;
        const errors = parseSymbolErrors(resultText(block.content));
        if (!errors.length) continue;
        errorsSeen += errors.length;

        const call = calls.get(String(block.tool_use_id ?? ""));
        const tool = call?.name ?? "";
        const command = tool === "Bash" ? String(call?.input.command ?? "") : "";
        if (!command || !isTypecheckCommand(command)) {
          cited.push({
            session: session.id,
            entry: entryIndex,
            tool: tool || "(unpaired)",
            subject: call ? subjectOf(tool, call.input) : "",
            errors: errors.length,
          });
          continue;
        }
        for (const error of errors) {
          if (seen.has(error.symbol)) continue;
          seen.add(error.symbol);
          failures.push({ session: session.id, entry: entryIndex, ts, ...error, command: clipText(command) });
        }
      }
    }
  }

  return { failures, cited, errorsSeen };
}

// ── reading the repair ───────────────────────────────────────────────────────

/** One text substitution an edit performed: what left, what arrived. */
export interface EditPair {
  removed: string;
  added: string;
}

/**
 * The substitutions a tool call performs, whatever tool carried it.
 *
 * `Edit`, `MultiEdit` and `Write` are structured and need no interpretation. The
 * fourth case is the one that decides whether this census can read its corpus at
 * all: **this project's passes edit through `python3 - <<'PY'` heredocs**, and a
 * reader that only understood `Edit` scored fourteen of twenty-five failures
 * `unresolved` — five of which had been repaired by a `s.replace(old, new)` in a
 * heredoc a few entries later. Missing them does not merely lose coverage, it
 * moves the answer: `unresolved` is the bucket the most generous denominator
 * counts as dropped intentions.
 */
export function readEdits(tool: string, input: Record<string, unknown>): EditPair[] {
  if (tool === "Edit") {
    return [{ removed: String(input.old_string ?? ""), added: String(input.new_string ?? "") }];
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    return (input.edits as Record<string, unknown>[]).map((edit) => ({
      removed: String(edit.old_string ?? ""),
      added: String(edit.new_string ?? ""),
    }));
  }
  if (tool === "Write") return [{ removed: "", added: String(input.content ?? "") }];
  if (tool !== "Bash") return [];

  const command = String(input.command ?? "");
  const pairs: EditPair[] = [];
  const patterns = [
    // s.replace('''old''', '''new''') — triple-quoted, the shape a multi-line
    // replacement takes.
    /\.replace\(\s*(?:'''|""")([\s\S]*?)(?:'''|""")\s*,\s*(?:'''|""")([\s\S]*?)(?:'''|""")/g,
    // s.replace("old", "new") — single-line.
    /\.replace\(\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1\s*,\s*(['"])((?:\\.|(?!\3)[\s\S])*)\3/g,
  ];
  for (const [index, pattern] of patterns.entries()) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(command)) !== null) {
      pairs.push(index === 0 ? { removed: match[1], added: match[2] } : { removed: match[2], added: match[4] });
    }
  }
  // old = """…"""\nnew = """…""" — the same substitution written as two variables.
  const named = /^old\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")\s*\n\s*new\s*=\s*(?:'''|""")([\s\S]*?)(?:'''|""")/gm;
  let match: RegExpExecArray | null;
  while ((match = named.exec(command)) !== null) pairs.push({ removed: match[1], added: match[2] });

  // A heredoc that writes a whole file, or any other command: what it contains is
  // added text and nothing is removed. Kept so `cat > f <<EOF` can still define a
  // symbol, at the cost of never reporting a rename from one.
  if (!pairs.length) pairs.push({ removed: "", added: command });
  return pairs;
}

/**
 * What one substitution says about a symbol, or `null` when it says nothing.
 *
 * The order is the order of specificity, and it matters. An edit that adds
 * `import { foo }` also matches nothing else, but an edit that adds
 * `export function foo()` inside a file that already imports `foo` would match
 * both — so imports are tested first and only fire when the import clause is new.
 */
export function readEditIntent(symbol: string, removed: string, added: string): Resolution | null {
  if (!removed.includes(symbol) && !added.includes(symbol)) return null;
  const name = literal(symbol);

  const imports = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}`);
  if (imports.test(added) && !imports.test(removed)) return "imported";

  const defines = new RegExp(
    // A declaration by keyword…
    `(?:export\\s+)?(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:function|const|let|var|class|interface|type|enum)\\s+${name}\\b` +
      // …or a member of a type or object literal, or a method.
      `|(?:^|[\\n{;,(])\\s*(?:readonly\\s+|public\\s+|private\\s+|protected\\s+|get\\s+|set\\s+)*${name}\\??\\s*[:(]`,
  );
  if (defines.test(added) && !defines.test(removed)) return "defined";

  if (removed.includes(symbol) && !added.includes(symbol)) return "renamed";
  if (!removed.includes(symbol)) return null;

  // The symbol survived the edit, so this is a wrong receiver only if the edit
  // changed how the symbol is *used*. Comparing the whole texts would have said
  // yes to any edit that appended an unrelated line to a file already mentioning
  // it — a control below pins that, because `rehomed` is the second-largest cell
  // and an over-eager one would quietly shrink the denominator's other classes.
  const onlyLinesWith = (text: string): string =>
    text
      .split("\n")
      .filter((line) => line.includes(symbol))
      .join("\n");
  return onlyLinesWith(removed) === onlyLinesWith(added) ? null : "rehomed";
}

/**
 * How a session repaired one failure: the first edit after it that touches the
 * symbol.
 *
 * First rather than best, because the first thing a run does in response to a
 * compiler error is the response — and any later rule ("the edit before the next
 * clean typecheck") requires knowing which typecheck was clean, which is a second
 * inference stacked on the first.
 */
export function classifyResolution(
  failure: SymbolFailure,
  jsonl: string,
): { resolution: Resolution; resolvedBy: string; evidence: string } {
  const lines = jsonl.split("\n");
  for (let index = failure.entry + 1; index < lines.length; index++) {
    if (!lines[index]?.trim()) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(lines[index]) as Record<string, unknown>;
    } catch {
      continue;
    }
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Record<string, unknown>[]) {
      if (block.type !== "tool_use") continue;
      const tool = String(block.name ?? "");
      for (const { removed, added } of readEdits(tool, (block.input ?? {}) as Record<string, unknown>)) {
        const intent = readEditIntent(failure.symbol, removed, added);
        if (!intent || intent === "unresolved") continue;
        return { resolution: intent, resolvedBy: `${tool} e${index}`, evidence: clipText(added, 200) };
      }
    }
  }
  return { resolution: "unresolved", resolvedBy: "", evidence: "" };
}

/**
 * Read the failures out of a corpus and classify each one's repair.
 *
 * Each session is resolved against the transcript it was read from, **not** against
 * a transcript looked up by id. Session ids are not unique on disk: a run in a git
 * worktree writes its transcript under the worktree's project directory and leaves
 * a two-line stub under the parent's, both named for the same session. An id-keyed
 * lookup picked the stub for one of this corpus's failures and scored a repair four
 * entries later as `unresolved` — an error in the direction that flatters the
 * solution under test, since unresolved is the bucket the generous denominator
 * counts as a dropped intention.
 */
export function resolveSymbolFailures(sessions: readonly TranscriptSession[]): {
  classified: ResolvedFailure[];
  cited: CitedFailure[];
  errorsSeen: number;
} {
  const classified: ResolvedFailure[] = [];
  const cited: CitedFailure[] = [];
  let errorsSeen = 0;

  for (const session of sessions) {
    const read = readSymbolFailures([session]);
    errorsSeen += read.errorsSeen;
    cited.push(...read.cited);
    for (const failure of read.failures) {
      classified.push({ ...failure, ...classifyResolution(failure, session.jsonl) });
    }
  }

  return { classified, cited, errorsSeen };
}

// ── the census ───────────────────────────────────────────────────────────────

function shareOf(dropped: number, denominator: number): number | null {
  return denominator ? dropped / denominator : null;
}

/**
 * Take the census over failures that have already been classified.
 *
 * The classification is passed in rather than read off a machine, so the number
 * is the same number next year — which is the only way a pre-committed bar means
 * anything.
 */
export function symbolFailureCensus(
  classified: readonly ResolvedFailure[],
  extra: { sessionsRead: number; errorsSeen: number; cited: readonly CitedFailure[] },
): SymbolFailureCensus {
  const cells: ResolutionCells = { defined: 0, imported: 0, renamed: 0, rehomed: 0, unresolved: 0 };
  for (const failure of classified) cells[failure.resolution]++;

  const resolved = classified.length - cells.unresolved;
  const dropped = cells.defined;
  const share = shareOf(dropped, resolved);
  const meetsBar = share !== null && share >= SYMBOL_FAILURE_RULE.bar;

  // The reading the parent solution's own framing implies: the compiler's
  // spelling suggestion stands in for "a near-match existed", so a failure with
  // no suggestion is a dropped intention.
  const unsuggested = classified.filter((failure) => failure.suggestion === null).length;
  const suggestionShare = shareOf(unsuggested, classified.length);

  const readings: CensusReading[] = [
    {
      name: "what the session did next (headline)",
      rule: "a dropped intention is a symbol the session then wrote",
      dropped,
      denominator: resolved,
      share,
      meetsBar,
    },
    {
      name: "whether the compiler offered a near-match",
      rule: "a dropped intention is a failure the compiler had no `Did you mean` for",
      dropped: unsuggested,
      denominator: classified.length,
      share: suggestionShare,
      meetsBar: suggestionShare !== null && suggestionShare >= SYMBOL_FAILURE_RULE.bar,
    },
  ];

  const denominators: DenominatorReading[] = [
    { name: "repaired failures only (headline)", dropped, denominator: resolved },
    { name: "every unresolved failure was a dropped intention", dropped: dropped + cells.unresolved, denominator: classified.length },
    { name: "no unresolved failure was a dropped intention", dropped, denominator: classified.length },
  ].map((rung) => {
    const rungShare = shareOf(rung.dropped, rung.denominator);
    return { ...rung, share: rungShare, meetsBar: rungShare !== null && rungShare >= SYMBOL_FAILURE_RULE.bar };
  });

  const verdicts = new Set([...readings.map((r) => r.meetsBar), ...denominators.map((r) => r.meetsBar)]);

  return {
    sessionsRead: extra.sessionsRead,
    errorsSeen: extra.errorsSeen,
    cited: [...extra.cited],
    failures: classified.length,
    cells,
    resolved,
    dropped,
    share,
    bar: SYMBOL_FAILURE_RULE.bar,
    meetsBar,
    readings,
    denominators,
    ruleDecides: verdicts.size > 1,
    classified: [...classified],
  };
}

function pct(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/**
 * The census as an operator reads it: coverage first, then the cells, then both
 * readings, and only then a verdict.
 *
 * Coverage leads because it is the number most likely to invalidate the others —
 * on this corpus, most of the error text in the record is the record being read
 * back to itself, and a reader who does not know that will read the wrong number.
 */
export function formatSymbolFailureCensus(census: SymbolFailureCensus): string {
  const lines: string[] = [];

  if (census.failures === 0) {
    lines.push(`Symbol failures: UNREAD — ${census.errorsSeen} symbol error(s) in the record and not one a compiler produced.`);
  } else {
    lines.push(
      `Symbol failures: ${census.dropped} of ${census.resolved} repaired failure(s) (${pct(census.share)}) were a ` +
        `dropped intention; the bar is ${pct(census.bar)}.`,
    );
  }
  const citedErrors = census.cited.reduce((total, citation) => total + citation.errors, 0);
  lines.push(
    `  Coverage: ${census.failures} distinct failure(s) over ${census.sessionsRead} session(s), from ` +
      `${census.errorsSeen} symbol error(s) seen; ${citedErrors} of those (${census.cited.length} result(s)) were the ` +
      `record being read back, not a compiler, and are counted neither way.`,
  );
  lines.push(
    `  Repairs: defined ${census.cells.defined}, imported ${census.cells.imported}, renamed ${census.cells.renamed}, ` +
      `rehomed ${census.cells.rehomed}, unresolved ${census.cells.unresolved}.`,
  );

  lines.push("");
  lines.push("  What counts as a dropped intention:");
  for (const reading of census.readings) {
    lines.push(
      `    ${reading.dropped}/${reading.denominator} (${pct(reading.share)}) ${reading.meetsBar ? "meets" : "MISSES"} ` +
        `the bar — ${reading.name}`,
    );
    lines.push(`        ${reading.rule}`);
  }
  lines.push("  What to do with the failures nobody repaired:");
  for (const rung of census.denominators) {
    lines.push(
      `    ${rung.dropped}/${rung.denominator} (${pct(rung.share)}) ${rung.meetsBar ? "meets" : "MISSES"} the bar — ${rung.name}`,
    );
  }
  lines.push(
    census.ruleDecides
      ? `  Rule: THE RULE DECIDES THIS. The readings above do not agree about the ${pct(census.bar)} bar, so the verdict ` +
          `is as much a property of how "dropped intention" was read as of the failures.`
      : `  Rule: stable — every reading above reaches the same verdict against the ${pct(census.bar)} bar.`,
  );

  const defined = census.classified.filter((failure) => failure.resolution === "defined");
  lines.push("");
  lines.push(`Dropped intentions — the case a declaration ledger covers (${defined.length}):`);
  if (!defined.length) lines.push("  (none)");
  for (const failure of defined) {
    lines.push(`  ${failure.code} ${failure.symbol}${failure.onType ? ` on ${failure.onType}` : ""} — ${failure.resolvedBy}`);
  }

  const others = census.classified.filter(
    (failure) => failure.resolution !== "defined" && failure.resolution !== "unresolved",
  );
  lines.push("");
  lines.push(`Failures a ledger does nothing for (${others.length}):`);
  for (const failure of others) {
    lines.push(`  ${failure.resolution.padEnd(9)} ${failure.symbol} — ${failure.resolvedBy}`);
  }

  const unresolved = census.classified.filter((failure) => failure.resolution === "unresolved");
  if (unresolved.length) {
    lines.push("");
    lines.push(
      `Never repaired (${unresolved.length}) — the bucket the generous denominator above turns into dropped intentions:`,
    );
    lines.push(`  ${unresolved.map((failure) => failure.symbol).join(", ")}`);
  }

  lines.push("");
  lines.push(
    "What this does not settle: it counts failures that REACHED A TYPECHECK. A symbol a run declared, forgot and " +
      "never called leaves no compiler error, so the abandonment the ledger claims to catch at its purest is " +
      "invisible here. A share below the bar is an argument about how much observed traffic the ledger would " +
      "cover, not a proof that dropped intentions are rare.",
  );
  return lines.join("\n");
}
