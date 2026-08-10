/**
 * The path-failure attribution census: of the path failures this project's own
 * passes actually hit, how many arrived through a tool this repository controls?
 *
 * The question decides a design. One candidate answer to "commands are composed
 * against a repo layout nobody checked" is to let the wrong guess happen and make
 * the first failure carry the layout back — a missing path answers with the
 * nearest existing ancestor and its contents, a `git` call outside a repository
 * says which directories above it are repositories. That is strictly an
 * improvement to a message, and it is cheap. But a message can only be improved
 * where the message is ours to write. `sed: src/cli/index.ts: No such file or
 * directory` is written by `sed`, and nothing in this repository will ever change
 * it.
 *
 * So this module counts, over the record of failures that actually happened. Two
 * axes, and the design turns on their interaction:
 *
 * - **Shape.** Is the failure about layout at all — a path that was not there, a
 *   pattern that matched nothing, a `git` call outside a repository, a path whose
 *   grant was missing? {@link classifyPathFailure}.
 * - **Surface.** Did the call go through a tool this repository controls — its MCP
 *   tools, or its CLI — or through one it does not? {@link attributeSurface}.
 *
 * ## Attribution cannot be done on the tool name alone
 *
 * The assumption test that named this census proposed "a string match on the tool
 * name each friction event already records". That method cannot work, and the
 * reason is worth stating rather than working around silently: **this product's
 * CLI is invoked through `Bash`**. Every `ost-agent …` call that ever failed is
 * recorded under the tool name `Bash`, indistinguishable from `sed`, and a census
 * that matches on tool names alone assigns 100% of this repository's own CLI
 * failures to a surface it does not own. It would answer the question by
 * construction.
 *
 * {@link attributeSurface} therefore reads the command. A `Bash` call is this
 * repository's surface when the program it invokes is this repository's — and
 * because a compound command has several programs and the record does not say
 * which one failed, the census reports a **lower and an upper bound** rather than
 * one number it cannot justify: {@link PathFailureCensus.owned} counts only calls
 * where every segment is ours, {@link PathFailureCensus.ownedUpperBound} counts
 * every call where any segment is.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * {@link ATTRIBUTION_RULE} holds the bar the assumption test fixed before anyone
 * counted (**40%**), the four failure shapes it named, and what counts as this
 * repository's surface. A classifier tuned after the count is a number that means
 * nothing.
 *
 * One judgement in it is genuinely arguable and the census does not ask to be
 * trusted on it. A permission denial on a path is arguably not a layout failure,
 * so {@link PathFailureCensus.readings} takes the whole count both ways — with
 * and without — and {@link PathFailureCensus.permissionDecides} says on the report's
 * face whether the choice moved the verdict.
 *
 * ## What a count out of this cannot settle
 *
 * It reads failures that were **recorded**, not failures that were **suffered**. A
 * pass that stopped guessing at paths because the last three guesses failed is
 * recorded as never having needed the layout, and that bias runs toward the answer
 * the solution wants. Nothing here corrects for it.
 *
 * It also says nothing about whether a better message changes what a run does
 * next. It establishes only whether the messages this solution would improve are a
 * large enough share to be worth improving — necessary for the solution and
 * nowhere near sufficient.
 *
 * And it is bounded by what survives. A failing call whose tool name was never
 * paired to its result is UNREAD, never "foreign": see
 * {@link PathFailureCensus.unread}, reported ahead of the share, because a sweep
 * that cannot read its subject must not report a clean result.
 */
import path from "node:path";
import type { TranscriptSession } from "./preflight.js";

/** The four failure shapes the assumption test named, before anything was counted. */
export type PathFailureClass = "missing-path" | "no-matches" | "not-a-repo" | "denied-path";

/** Whose error message this was. `foreign` means: not this repository's to change. */
export type Surface = "mcp" | "cli" | "foreign";

/**
 * How sure the attribution is. A compound shell command runs several programs and
 * the record keeps one exit code, so "an `ost-agent` ran in here somewhere" is not
 * the same claim as "the thing that failed was `ost-agent`".
 */
export type Certainty = "certain" | "possible";

/** Where the thing that was not there lives, when the message named it. */
export type SubjectRoot = "project" | "foreign" | "unrooted" | "unnamed";

/**
 * The rule, written down before the corpus was counted.
 *
 * Every regular expression here matches an error message's *text*, which is the
 * only thing a tool-agnostic classifier has. They are deliberately narrow: a
 * pattern broad enough to catch every phrasing of "not there" also catches
 * `Property 'configProblem' does not exist on type 'ToolContext'`, and a census
 * that counts type errors as layout failures is measuring the wrong population.
 */
export const ATTRIBUTION_RULE = {
  /**
   * The pre-committed bar: at least this share of path-shaped failures must arrive
   * through a tool this repository controls for "improve the first failure" to
   * cover the work. Below it the solution is refuted as stated and must narrow to
   * a named subset or give way to a sibling.
   */
  bar: 0.4,

  /**
   * What each failure shape looks like in the text. First match wins, in this
   * order, so a message carrying two shapes is counted once.
   */
  shapes: [
    // `sed: x: No such file or directory`, `cd: no such file or directory: x`,
    // and every coreutils/zsh phrasing of the same thing.
    { cls: "missing-path", pattern: /no such file or directory/i },
    // Claude Code's `Grep`/`Glob` refusal, which names the path.
    { cls: "missing-path", pattern: /\bPath does not exist\b/ },
    // Claude Code's `Read` refusal, which names nothing — see `subjectOf`.
    { cls: "missing-path", pattern: /\bFile does not exist\b/ },
    // Anything that surfaced a raw node/libc errno instead of a sentence.
    { cls: "missing-path", pattern: /\bENOENT\b/ },
    // zsh refusing to run a command because a glob operand expanded to nothing.
    { cls: "no-matches", pattern: /no matches found:/i },
    { cls: "no-matches", pattern: /\bNo files found\b/i },
    // `git` outside a working tree — exit 128, the shape the solution wants to
    // answer with "which directories above you are repositories".
    { cls: "not-a-repo", pattern: /not a git repository/i },
    // The path is there and the grant is not. Zero of these in the corpus this
    // census was first run over; see `readings`.
    { cls: "denied-path", pattern: /(^|[\s:])Permission denied\b/i },
    { cls: "denied-path", pattern: /\bEACCES\b/ },
  ] as { cls: PathFailureClass; pattern: RegExp }[],

  /**
   * Failures that are refusals about a *tool*, not about a *path*, and are excluded
   * before any shape is tested.
   *
   * Both would otherwise land in `denied-path` on the word "denied" or "permission"
   * and neither is a layout failure: the first is a human saying no to a call, the
   * second is a session that has not been granted a tool it asked for. The second
   * is the larger population in this project's own record — 122 of 719 recorded
   * failures — so letting it leak in would not be a rounding error, it would be the
   * finding.
   */
  notAboutAPath: [
    /but you haven't granted it yet/i,
    /user doesn't want to (?:proceed|take this action)/i,
    /user rejected/i,
    /permission (?:was )?denied by the user/i,
  ] as RegExp[],

  /**
   * A shape that was considered and left out, published rather than defended.
   *
   * `ERR_MODULE_NOT_FOUND` is a path failure by any plain reading — a scratch
   * script written to `/tmp` importing `./src/ost/node.js` is a command composed
   * against a layout nobody checked, which is the parent opportunity's own
   * sentence. It is excluded because it is a *module resolver's* failure rather
   * than a *file operation's*, and the four shapes this census counts are the ones
   * the assumption test named before anyone counted.
   *
   * The choice is published because the reader is entitled to disagree with it:
   * {@link PathFailureCensus.excludedByRule} carries how many failures it costs,
   * and the test beside this file asserts what including them would have done to
   * the verdict. Widening a rule after seeing a count is how a census becomes an
   * opinion, so the widening is offered as a number instead.
   */
  consideredAndExcluded: [{ name: "module-not-found", pattern: /\bERR_MODULE_NOT_FOUND\b/ }] as {
    name: string;
    pattern: RegExp;
  }[],

  /**
   * The two defensible readings of "path-shaped", widest last. Monotone on
   * purpose: a later reading may only admit more, so a share that moves between
   * them moved because of the one class that differs and nothing else.
   */
  readings: [
    { name: "without permission denials", classes: ["missing-path", "no-matches", "not-a-repo"] },
    { name: "with permission denials", classes: ["missing-path", "no-matches", "not-a-repo", "denied-path"] },
  ] as { name: string; classes: PathFailureClass[] }[],

  /**
   * This repository's MCP tools as a session records them. Both the direct server
   * name and the plugin-prefixed one, because a session that reaches the same tools
   * through the installed plugin records `mcp__plugin_ost-agent_ost-agent__ost_…`
   * and dropping those would undercount our own surface.
   */
  ownedMcpTool: /^mcp__[a-z0-9_-]*ost[-_]agent[a-z0-9_-]*__ost_/,

  /** Programs that are this repository's CLI, however a command spells them. */
  cliPrograms: ["ost-agent", "ost-agent.mjs"] as string[],

  /** Running the CLI from source counts as the CLI: same code, same messages. */
  cliEntrySource: /(?:^|\/)src\/cli\/index\.ts$/,

  /** Launchers that put the real program in a later word. */
  cliLaunchers: ["npx", "node", "bunx", "tsx", "pnpm", "yarn"] as string[],
} as const;

/** One failing tool call, lifted out of a session transcript. */
export interface FailingCall {
  /** Session id, so any row can be traced back to the transcript it came from. */
  session: string;
  /** The tool name as the transcript records it. Empty when the call was not paired. */
  tool: string;
  /** `Bash`'s command, redacted and bounded. Empty for every other tool. */
  command: string;
  /** The error text, redacted and bounded. */
  error: string;
}

export interface ClassifiedFailure extends FailingCall {
  cls: PathFailureClass;
  surface: Surface;
  certainty: Certainty;
  /** What the message said was missing, when it said. */
  subject: string | null;
  subjectRoot: SubjectRoot;
  /**
   * True when the thing that "did not match" was a command-line flag the shell
   * glob-expanded, not a path anyone addressed — `no matches found: --include=*.ts`.
   * Counted as path-shaped because the shell's message is, and reported separately
   * because no layout answer would have helped it.
   */
  flagNotPath: boolean;
}

export interface PathFailureReading {
  name: string;
  classes: PathFailureClass[];
  pathShaped: number;
  owned: number;
  share: number | null;
  meetsBar: boolean;
}

export interface PathFailureCensus {
  /** Coverage, reported before any share. */
  sessionsRead: number;
  calls: number;
  errors: number;
  /** Failing calls whose tool name was never paired to a result. Counted neither way. */
  unread: number;

  classified: ClassifiedFailure[];
  /** The headline denominator: the widest reading of "path-shaped". */
  pathShaped: number;
  byClass: Record<PathFailureClass, number>;
  byTool: { tool: string; n: number }[];

  /** Calls whose failing surface is certainly this repository's. */
  owned: number;
  /** …plus every call where it might have been. The generous bound. */
  ownedUpperBound: number;
  foreign: number;
  share: number | null;
  shareUpperBound: number | null;
  /** Did the pre-committed bar clear, on the headline reading? */
  meetsBar: boolean;

  readings: PathFailureReading[];
  /** True when the with/without-permission choice changes the verdict. */
  permissionDecides: boolean;
  /** True when the certain/possible bound choice changes the verdict. */
  boundDecides: boolean;

  /** Path-shaped failures whose subject was a glob-expanded flag, not a path. */
  flagNotPath: number;
  /**
   * How many more failures the widest shape this census *declined* to count would
   * have added, and what crediting every one of them to this repository would have
   * done to the verdict. The generous direction on purpose: a reader who thinks the
   * exclusion is wrong should be able to see the answer it would have given.
   */
  excludedByRule: { name: string; n: number; shareIfCountedAndOwned: number }[];
  /** Where the missing thing lived, when the message named it. */
  bySubjectRoot: Record<SubjectRoot, number>;
}

// ── shape ────────────────────────────────────────────────────────────────────

/**
 * Which layout failure this message is, or `null` for anything else.
 *
 * The exclusions run first and that ordering is the whole guard: "Claude requested
 * permissions to use `mcp__ost-agent__ost_check`, but you haven't granted it yet"
 * contains neither "permission denied" nor a path, but its neighbours in the same
 * family do, and this project's record holds 83 of them against its own tools. A
 * classifier that let those through would hand the assumption a majority made
 * entirely of failures that are not about layout at all.
 */
export function classifyPathFailure(error: string): PathFailureClass | null {
  if (ATTRIBUTION_RULE.notAboutAPath.some((re) => re.test(error))) return null;
  for (const { cls, pattern } of ATTRIBUTION_RULE.shapes) {
    if (pattern.test(error)) return cls;
  }
  return null;
}

/**
 * What the message said was missing.
 *
 * `null` is a finding rather than a gap: `File does not exist.` names nothing at
 * all, which is the exact failure the solution under test wants to replace, and
 * counting how often a message is already a bare negation is worth more than
 * guessing at what it meant.
 */
export function subjectOf(error: string): string | null {
  const forms = [
    /no matches found:\s*(\S+)/i,
    /\bPath does not exist:\s*([^\s.]+)/,
    /no such file or directory:\s*(\S+)/i, // zsh's `cd:` form puts the path last
    /(?:^|[\s(])([^\s:]+):\s*No such file or directory/i, // coreutils' `prog: path: …`
  ];
  for (const re of forms) {
    const m = re.exec(error);
    // Python's `FileNotFoundError` quotes the path and zsh does not; the quotes
    // are the reporting tool's punctuation, never part of what was addressed.
    if (m?.[1]) return m[1].replace(/^['"]+|['"]+$/g, "") || null;
  }
  return null;
}

/** Directory names this project owns, used only to root a subject. */
const PROJECT_ROOTS = ["OST-Agent", "ost-agent-meta", "ost-agent-vault", "ost-agent-e2e"];

function rootOf(subject: string | null): SubjectRoot {
  if (subject === null) return "unnamed";
  if (!subject.startsWith("/") && !subject.startsWith("~")) return "unrooted";
  const segments = subject.split("/");
  return segments.some((s) => PROJECT_ROOTS.includes(s)) ? "project" : "foreign";
}

// ── surface ──────────────────────────────────────────────────────────────────

/**
 * Split a shell command into the segments that each run a program.
 *
 * Deliberately crude — `&&`, `||`, `;`, `|` and newlines, nothing else. A
 * heredoc or a `$(…)` will be cut in the wrong place, and that is acceptable
 * here because the only question asked of a segment is whether its first word is
 * this repository's CLI: a mis-cut produces a segment whose first word is not,
 * which pushes the call toward `foreign`. The error runs against the assumption
 * under test, which is the direction a rule of this crudeness should fail in.
 */
export function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is the program this segment runs this repository's CLI? */
export function invokesProductCli(segment: string): boolean {
  const words = segment.split(/\s+/).filter(Boolean);
  let i = 0;
  // Leading `FOO=bar` assignments are the environment, not the program.
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;

  let launchers = 0;
  while (i < words.length) {
    const word = words[i];
    if (word.startsWith("-")) {
      // A launcher's own flag (`node --import tsx`). `--import tsx` takes a value,
      // and skipping only the flag leaves the value to be read as the program —
      // which is harmless here, because `tsx` is itself a launcher.
      i++;
      continue;
    }
    const base = path.basename(word);
    if (ATTRIBUTION_RULE.cliPrograms.includes(base)) return true;
    if (ATTRIBUTION_RULE.cliEntrySource.test(word)) return true;
    if (ATTRIBUTION_RULE.cliLaunchers.includes(base) && launchers < 3) {
      launchers++;
      i++;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Whose error message this was, and how sure that is.
 *
 * An MCP call is unambiguous — one tool, one result. A `Bash` call is not: the
 * transcript keeps one exit code for a command that may have run six programs,
 * so `cd ~/vault && ost-agent status` gets `possible` rather than `certain` and
 * the census carries both bounds instead of picking.
 */
export function attributeSurface(tool: string, command: string): { surface: Surface; certainty: Certainty } {
  if (ATTRIBUTION_RULE.ownedMcpTool.test(tool)) return { surface: "mcp", certainty: "certain" };
  if (tool !== "Bash") return { surface: "foreign", certainty: "certain" };

  const segments = commandSegments(command);
  const ours = segments.filter(invokesProductCli);
  if (ours.length === 0) return { surface: "foreign", certainty: "certain" };
  return { surface: "cli", certainty: ours.length === segments.length ? "certain" : "possible" };
}

// ── reading the record ───────────────────────────────────────────────────────

/**
 * How much of an error message and a command is kept.
 *
 * Bounded because a failing `tsc` run puts ten kilobytes of unrelated output in
 * the record and the fixture has to be committable. Head and tail, never the
 * head alone: a shell failure's signature line is routinely the *last* line of a
 * compound command's output, and clipping from the front would silently drop it.
 * The bound was checked against the unbounded classification over the corpus this
 * census was first cut from — see that fixture's `PROVENANCE.md`.
 */
export const MAX_ERROR_CHARS = 800;
export const MAX_COMMAND_CHARS = 600;

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const half = Math.floor(max / 2);
  return `${flat.slice(0, half)} … ${flat.slice(-half)}`;
}

/**
 * Lift every failing tool call out of a set of session transcripts.
 *
 * A `tool_result` with `is_error` is the only signal used, which is why the
 * `unread` count exists: a result whose `tool_use` was never seen (the call is in
 * an earlier session file, or the pairing id is missing) has no tool name, and a
 * call with no tool name cannot be attributed to a surface either way.
 */
export function readPathFailures(sessions: TranscriptSession[]): {
  failures: FailingCall[];
  calls: number;
  errors: number;
} {
  const failures: FailingCall[] = [];
  let calls = 0;
  let errors = 0;

  for (const session of sessions) {
    const byId = new Map<string, { name: string; command: string }>();
    for (const raw of session.jsonl.split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      const message = entry.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;

      for (const block of content as Record<string, unknown>[]) {
        if (block.type === "tool_use" && typeof block.id === "string") {
          calls++;
          const input = (block.input ?? {}) as Record<string, unknown>;
          byId.set(block.id, {
            name: String(block.name ?? ""),
            command: typeof input.command === "string" ? input.command : "",
          });
        }
        if (block.type === "tool_result" && block.is_error === true) {
          errors++;
          const call = byId.get(String(block.tool_use_id ?? ""));
          failures.push({
            session: session.id,
            tool: call?.name ?? "",
            command: clip(call?.command ?? "", MAX_COMMAND_CHARS),
            error: clip(resultText(block.content), MAX_ERROR_CHARS),
          });
        }
      }
    }
  }
  return { failures, calls, errors };
}

/** Tool results carry either a string or a list of content blocks. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join(" ");
  }
  return "";
}

// ── the census ───────────────────────────────────────────────────────────────

export function classifyFailure(call: FailingCall): ClassifiedFailure | null {
  const cls = classifyPathFailure(call.error);
  if (!cls) return null;
  const { surface, certainty } = attributeSurface(call.tool, call.command);
  const subject = subjectOf(call.error);
  return {
    ...call,
    cls,
    surface,
    certainty,
    subject,
    subjectRoot: rootOf(subject),
    flagNotPath: cls === "no-matches" && subject !== null && subject.startsWith("-"),
  };
}

function readingOf(
  name: string,
  classes: PathFailureClass[],
  classified: ClassifiedFailure[],
): PathFailureReading {
  const rows = classified.filter((c) => classes.includes(c.cls));
  const owned = rows.filter((c) => c.surface !== "foreign" && c.certainty === "certain").length;
  const share = rows.length === 0 ? null : owned / rows.length;
  return { name, classes, pathShaped: rows.length, owned, share, meetsBar: share !== null && share >= ATTRIBUTION_RULE.bar };
}

export function pathFailureCensus(
  failures: FailingCall[],
  meta: { sessionsRead: number; calls: number; errors: number },
): PathFailureCensus {
  const classified = failures.map(classifyFailure).filter((c): c is ClassifiedFailure => c !== null);

  const byClass: Record<PathFailureClass, number> = {
    "missing-path": 0,
    "no-matches": 0,
    "not-a-repo": 0,
    "denied-path": 0,
  };
  const bySubjectRoot: Record<SubjectRoot, number> = { project: 0, foreign: 0, unrooted: 0, unnamed: 0 };
  const toolCounts = new Map<string, number>();
  for (const c of classified) {
    byClass[c.cls]++;
    bySubjectRoot[c.subjectRoot]++;
    toolCounts.set(c.tool, (toolCounts.get(c.tool) ?? 0) + 1);
  }

  const owned = classified.filter((c) => c.surface !== "foreign" && c.certainty === "certain").length;
  const ownedUpperBound = classified.filter((c) => c.surface !== "foreign").length;
  const share = classified.length === 0 ? null : owned / classified.length;
  const shareUpperBound = classified.length === 0 ? null : ownedUpperBound / classified.length;

  const readings = ATTRIBUTION_RULE.readings.map((r) => readingOf(r.name, [...r.classes], classified));
  const meetsBar = share !== null && share >= ATTRIBUTION_RULE.bar;

  return {
    sessionsRead: meta.sessionsRead,
    calls: meta.calls,
    errors: meta.errors,
    unread: failures.filter((f) => f.tool === "").length,
    classified,
    pathShaped: classified.length,
    byClass,
    byTool: [...toolCounts.entries()]
      .map(([tool, n]) => ({ tool, n }))
      .sort((a, b) => b.n - a.n || a.tool.localeCompare(b.tool)),
    owned,
    ownedUpperBound,
    foreign: classified.length - ownedUpperBound,
    share,
    shareUpperBound,
    meetsBar,
    readings,
    permissionDecides: new Set(readings.map((r) => r.meetsBar)).size > 1,
    boundDecides: meetsBar !== (shareUpperBound !== null && shareUpperBound >= ATTRIBUTION_RULE.bar),
    flagNotPath: classified.filter((c) => c.flagNotPath).length,
    excludedByRule: ATTRIBUTION_RULE.consideredAndExcluded.map(({ name, pattern }) => {
      const n = failures.filter(
        (f) => classifyPathFailure(f.error) === null && !ATTRIBUTION_RULE.notAboutAPath.some((re) => re.test(f.error)) && pattern.test(f.error),
      ).length;
      // The most generous arithmetic available: count them all AND give every one
      // of them to this repository. If the bar still does not clear there, the
      // exclusion cannot be what decided the verdict.
      const denominator = classified.length + n;
      return { name, n, shareIfCountedAndOwned: denominator === 0 ? 0 : (owned + n) / denominator };
    }),
    bySubjectRoot,
  };
}

function pct(share: number): string {
  return `${Math.round(share * 1000) / 10}%`;
}

/**
 * The census as an operator reads it: coverage first, then the verdict, then the
 * numbers that could overturn it.
 *
 * The verdict line says REFUTED or CLEARS in words rather than leaving a reader to
 * compare two decimals, because this census exists to kill a solution or license
 * it and an exit code cannot carry that distinction — the command is green when
 * the count has been taken, whichever way it came out.
 */
export function formatPathFailureCensus(census: PathFailureCensus): string {
  const lines: string[] = [];

  if (census.pathShaped === 0) {
    lines.push(
      `Path-failure attribution: UNREAD — ${census.errors} failed call(s) across ` +
        `${census.sessionsRead} session(s), and not one of them is path-shaped.`,
    );
    return lines.join("\n");
  }

  const verdict = census.meetsBar ? "CLEARS" : "REFUTED";
  lines.push(
    `Path-failure attribution: ${verdict} — ${census.owned} of ${census.pathShaped} ` +
      `path-shaped failure(s) (${pct(census.share ?? 0)}) arrived through a tool this repository controls, ` +
      `against a pre-committed bar of ${pct(ATTRIBUTION_RULE.bar)}.`,
  );
  lines.push(
    `Read from ${census.sessionsRead} session(s): ${census.calls} tool call(s), ${census.errors} failure(s), ` +
      `${census.unread} unpaired and counted neither way.`,
  );
  lines.push(
    `Generous bound — crediting every call where any segment was ours: ` +
      `${census.ownedUpperBound}/${census.pathShaped} (${pct(census.shareUpperBound ?? 0)}).` +
      (census.boundDecides ? " THE BOUND DECIDES THIS." : ""),
  );

  lines.push("");
  lines.push("By shape:");
  for (const [cls, n] of Object.entries(census.byClass)) lines.push(`  ${cls.padEnd(14)} ${n}`);
  lines.push("By tool:");
  for (const { tool, n } of census.byTool) lines.push(`  ${(tool || "(unpaired)").padEnd(44)} ${n}`);

  lines.push("");
  for (const r of census.readings) {
    lines.push(
      `  ${r.name.padEnd(28)} ${r.owned}/${r.pathShaped} (${pct(r.share ?? 0)}) — ${r.meetsBar ? "clears" : "below"} the bar`,
    );
  }
  if (census.permissionDecides) lines.push("  THE PERMISSION-DENIAL READING DECIDES THIS.");

  if (census.flagNotPath > 0) {
    lines.push("");
    lines.push(
      `${census.flagNotPath} of the "no matches" failures are a glob-expanded command-line flag, ` +
        `not a path anyone addressed — no layout answer would have helped them.`,
    );
  }
  lines.push(
    `Subjects: ${census.bySubjectRoot.project} under this project, ${census.bySubjectRoot.foreign} elsewhere, ` +
      `${census.bySubjectRoot.unrooted} relative, ${census.bySubjectRoot.unnamed} named nothing at all.`,
  );

  for (const ex of census.excludedByRule) {
    lines.push(
      `Shape not counted — ${ex.name}: ${ex.n} more failure(s). Counting them all AND crediting every one ` +
        `to this repository would give ${pct(ex.shareIfCountedAndOwned)}, ` +
        `${ex.shareIfCountedAndOwned >= ATTRIBUTION_RULE.bar ? "which clears the bar" : "which still does not clear the bar"}.`,
    );
  }

  return lines.join("\n");
}
