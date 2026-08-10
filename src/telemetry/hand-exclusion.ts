/**
 * The hand-exclusion census: how many distinct test files this project has ever
 * suppressed by typing an exclusion into a runner invocation.
 *
 * The solution under test is a quarantine list committed to the repository, so a
 * known-flaky file is declared once instead of retyped into every subsequent
 * command. That is infrastructure — a file format, a runner change, a review
 * habit — and the assumption test beneath it fixed the bar before anyone counted:
 * **at least 3 distinct test files must have been hand-excluded across the
 * captured sessions.** At one or two, the honest answer is to fix the flake and
 * build nothing, and this module exists to be able to return that answer.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * {@link HAND_EXCLUSION_RULE} says what counts as a runner, what counts as a test
 * file, and what is deliberately refused. The refusals carry most of the weight,
 * because the record is full of `--exclude` that has nothing to do with tests:
 *
 * - **`rsync -a --exclude node_modules` and `grep --exclude-dir=dist` are not
 *   suppressed tests.** They are the same nine characters in front of a command
 *   that never ran a suite. Only an invocation whose executable is a test runner
 *   is read at all.
 * - **`--exclude 'node_modules/**'` is not a suppressed test either.** It is the
 *   runner's own default being restated by hand beside a real exclusion. It is
 *   counted and reported separately, as {@link HandExclusionCensus.defaultsRestated},
 *   because *the cost of the hand-typed form* is what the solution is arguing
 *   about — but it is not a file anybody quarantined.
 * - **A session id passed to a harvest script is not a test file.** The corpus
 *   contains `npx tsx scripts/harvest-…​.ts … --exclude 598061c2-…`, which is a
 *   census excluding its own session, and reading it as a quarantine would be the
 *   census counting itself.
 *
 * ## What a count out of this cannot settle
 *
 * It cannot see an exclusion that was never typed because the operator ran a
 * narrower suite instead. {@link HandExclusionCensus.narrowed} counts invocations
 * that named specific files, but that number is **context, not evidence**: naming
 * the file you are working on is ordinary iteration, not a quarantine, and
 * nothing in a transcript separates the two.
 *
 * And it says nothing about the candidate's real hazard — that a comfortable
 * quarantine lowers the cost of never fixing anything. A list that clears this bar
 * has been shown to have subjects, not to be a good idea.
 */
import path from "node:path";
import { redactSecrets } from "../adapters/transcript.js";
import type { TranscriptSession } from "./preflight.js";
import { SHELL_GROUPING, SHELL_OPERATORS, SHELL_UNREADABLE, shellWords } from "./shell.js";

/** Whether an exclusion's value names a test file, and so whether it is counted. */
export type ExclusionSubject = "test-file" | "not-a-test-file";

/** Why a value behind a runner's `--exclude` was not counted as a quarantined test. */
export type NotATestFileReason =
  | "the runner's own default, restated by hand"
  | "a directory or glob, not a named test file";

/** One exclusion typed into one test-runner invocation. */
export interface HandExclusion {
  session: string;
  /** Index of the transcript entry that issued it, so a count can be checked by hand. */
  entry: number;
  ts: string;
  /** The directory the invocation ran in, after following any `cd` on the same line. */
  cwd: string;
  /** The runner as it was typed: `vitest`, `jest`, `npm test`. */
  runner: string;
  /** The flag the exclusion was typed behind. */
  flag: string;
  /** The value exactly as it was typed, after unquoting. */
  value: string;
  subject: ExclusionSubject;
  /** The normalised test path, present only when {@link subject} is `test-file`. */
  file?: string;
  /** Present only when {@link subject} is `not-a-test-file`. */
  reason?: NotATestFileReason;
  /** The command it came from, redacted and clipped. */
  command: string;
}

/** A runner invocation whose arguments this module refused to guess at. */
export interface UnreadInvocation {
  session: string;
  entry: number;
  ts: string;
  cause: "unparseable-shell";
  command: string;
}

/** One distinct test file, with the breadth that decides whether a list pays. */
export interface ExcludedFile {
  file: string;
  /** How many runner invocations carried it. */
  invocations: number;
  /** Distinct sessions it was typed in — the number the assumption turns on. */
  sessions: string[];
  /** Distinct UTC dates it was typed on. */
  days: string[];
  first: string;
  last: string;
  /** Minutes between the first and last time it was typed, within the record. */
  spanMinutes: number;
}

export interface HandExclusionCensus {
  /** Transcripts read. Leads the report: a census of nothing is not a clean result. */
  sessionsRead: number;
  /** Readable test-runner invocations — the denominator the share is taken over. */
  invocations: number;
  /** Of those, how many named specific files rather than running everything. Context only. */
  narrowed: number;
  /** Invocations whose shell could not be read, counted neither way. */
  unread: UnreadInvocation[];
  /** Every exclusion lifted, both subjects, in the order they were issued. */
  exclusions: HandExclusion[];
  /** Invocations that carried at least one test-file exclusion. */
  excludingInvocations: number;
  /** The distinct test files, most-excluded first. */
  files: ExcludedFile[];
  distinct: number;
  /** Whether the pre-committed bar of {@link HAND_EXCLUSION_RULE.bar} is cleared. */
  meetsBar: boolean;
  /**
   * Distinct files that were excluded in **more than one session**.
   *
   * The assumption is that a committed list "pays for itself across repetition
   * and breadth". Breadth is {@link distinct}; this is the repetition, and the
   * two can come apart — several files each suppressed once, inside the session
   * that hit them, is breadth without any repetition for a list to save.
   */
  repeatedAcrossSessions: number;
  /** `node_modules` and friends re-typed beside a real exclusion. */
  defaultsRestated: number;
}

/**
 * What this census counts, fixed before the corpus was read.
 *
 * Each field is here rather than inline so a later edit shows up as a changed
 * expectation in `test/telemetry/hand-exclusion-census.test.ts` rather than as a
 * quietly different finding.
 */
export const HAND_EXCLUSION_RULE = {
  /**
   * Distinct test files below which a committed list loses to fixing the flake.
   * Set by the assumption test "Enough distinct files get hand-excluded that
   * declaring them once beats retyping", before anything was counted.
   */
  bar: 3,

  /** Executables that run a test suite. Nothing else's `--exclude` is read. */
  runners: ["vitest", "jest"],

  /**
   * Wrappers that are transparent: the runner is whatever they invoke.
   * `npm` is deliberately absent — it needs its script name inspected, below.
   */
  wrappers: ["npx", "bunx", "pnpm", "yarn", "bun", "exec", "dlx"],

  /** `npm run <script>` is a suite invocation only for these scripts. */
  packageScripts: ["test", "test:unit", "test:run", "vitest"],

  /** Flags whose value names something to suppress. */
  excludeFlags: ["--exclude", "--testPathIgnorePatterns", "--testPathIgnorePattern"],

  /** A test file, by this repository's convention. */
  testFile: /\.test\.[cm]?[jt]sx?$/,

  /** Runner subcommands, so `vitest run` does not read `run` as a named file. */
  subcommands: ["run", "watch", "dev", "list", "related", "bench", "init", "typecheck"],

  /**
   * Flags whose next word is their value rather than a file to run. Read off the
   * corpus, not guessed: `-t`, `--root` and the long form of `-t` are the only
   * value-taking flags any recorded invocation used in the space-separated form.
   */
  valueFlags: ["-t", "--testNamePattern", "--root", "--config", "--reporter", "--project", "--shard"],

  /** Flags that narrow the run without naming a file. */
  filterFlags: ["-t", "--testNamePattern"],

  /**
   * Values that are a runner default being restated rather than a quarantine.
   * See the module comment: these are evidence about the workaround's cost, and
   * are reported, but they are not files anybody suppressed.
   */
  runnerDefaults: /^(\*\*\/)?(node_modules|dist|coverage)(\/|$)/,
} as const;

const MAX_COMMAND_CHARS = 200;

/** Operators after which the next word is a file, and before which a digit is a descriptor. */
const REDIRECTS = [">", ">>", "<"];

function clip(text: string): string {
  const flat = redactSecrets(text).replace(/\s+/g, " ").trim();
  return flat.length > MAX_COMMAND_CHARS ? `${flat.slice(0, MAX_COMMAND_CHARS)}…` : flat;
}

/** One test-runner invocation found inside a recorded command line. */
interface RunnerInvocation {
  /** The runner as typed — `vitest`, `jest` or `npm test`. */
  runner: string;
  /** Its words, without the runner itself. */
  argv: string[];
  /** Which of those words were quoted, so a quoted `--exclude` is not read as a flag. */
  quoted: boolean[];
  /** Where it ran, after following any `cd` earlier on the same line. */
  cwd: string;
}

function baseName(word: string): string {
  return word.split("/").pop() ?? word;
}

/**
 * Split a command line into the test-runner invocations inside it.
 *
 * Returns `null` when the command's text depends on evaluation — the caller
 * records that as {@link UnreadInvocation} rather than reading a fixed argument
 * out of something that had none. The corpus contains one real case of why that
 * matters: a `gh pr create --body "$(cat <<EOF …)"` whose prose quotes a
 * `vitest run --exclude` command that was never run.
 */
function runnerInvocations(command: string, cwd: string): RunnerInvocation[] | null {
  if (SHELL_UNREADABLE.test(command)) return null;
  const parsed = shellWords(command);
  if (!parsed) return null;

  const found: RunnerInvocation[] = [];
  let current: RunnerInvocation | null = null;
  let here = cwd;
  let segmentStart = true;

  for (let i = 0; i < parsed.words.length; i++) {
    const word = parsed.words[i];
    const isQuoted = parsed.quoted[i];

    if (!isQuoted && (SHELL_OPERATORS.includes(word) || SHELL_GROUPING.includes(word))) {
      // A redirection ends the argument list, and the file descriptor in front of
      // it is not an argument. `npx vitest run 2>&1 | tail` tokenises as
      // `… run` `2` `>` `&` `1`, and a reader that kept the `2` would record every
      // pipeline in the corpus as an invocation that named a file to run.
      if (current && REDIRECTS.includes(word) && /^\d$/.test(current.argv[current.argv.length - 1] ?? "")) {
        current.argv.pop();
        current.quoted.pop();
      }
      if (current) found.push(current);
      current = null;
      segmentStart = true;
      continue;
    }
    if (current) {
      current.argv.push(word);
      current.quoted.push(isQuoted);
      segmentStart = false;
      continue;
    }
    if (segmentStart && word === "cd") {
      const target = parsed.words[i + 1];
      if (target && !SHELL_OPERATORS.includes(target) && target !== "-") {
        here = path.isAbsolute(target) ? target : path.resolve(here, target);
        i++;
      }
      segmentStart = false;
      continue;
    }

    const base = baseName(word);
    if (!isQuoted && (HAND_EXCLUSION_RULE.runners as readonly string[]).includes(base)) {
      current = { runner: base, argv: [], quoted: [], cwd: here };
      segmentStart = false;
      continue;
    }
    // `npm test`, `npm run test` — and nothing else npm does. `npm run gen:skill`
    // is in the corpus on the same line as a real exclusion, and reading it as a
    // suite would put that line's flags on the wrong invocation.
    if (!isQuoted && base === "npm") {
      let j = i + 1;
      if (parsed.words[j] === "run") j++;
      const script = parsed.words[j];
      if (script && (HAND_EXCLUSION_RULE.packageScripts as readonly string[]).includes(script)) {
        current = { runner: "npm test", argv: [], quoted: [], cwd: here };
        i = j;
      }
      segmentStart = false;
      continue;
    }
    if (!isQuoted && (HAND_EXCLUSION_RULE.wrappers as readonly string[]).includes(base)) {
      segmentStart = true; // the next word is still the head of a command
      continue;
    }
    segmentStart = false;
  }
  if (current) found.push(current);
  return found;
}

/** Whether a value behind an exclusion flag names a test file, and what to call it if not. */
export function classifyExclusion(value: string): {
  subject: ExclusionSubject;
  file?: string;
  reason?: NotATestFileReason;
} {
  const trimmed = value.replace(/^\.\//, "").replace(/^\*\*\//, "");
  if (HAND_EXCLUSION_RULE.runnerDefaults.test(value)) {
    return { subject: "not-a-test-file", reason: "the runner's own default, restated by hand" };
  }
  if (HAND_EXCLUSION_RULE.testFile.test(trimmed)) return { subject: "test-file", file: trimmed };
  return { subject: "not-a-test-file", reason: "a directory or glob, not a named test file" };
}

/** What one invocation asked to suppress, and whether it named files to run. */
function invocationExclusions(invocation: RunnerInvocation): { values: { flag: string; value: string }[]; narrowed: boolean } {
  const values: { flag: string; value: string }[] = [];
  let narrowed = false;

  for (let i = 0; i < invocation.argv.length; i++) {
    const word = invocation.argv[i];
    const isQuoted = invocation.quoted[i];
    if (!isQuoted) {
      const equals = word.indexOf("=");
      if (equals > 0 && (HAND_EXCLUSION_RULE.excludeFlags as readonly string[]).includes(word.slice(0, equals))) {
        values.push({ flag: word.slice(0, equals), value: word.slice(equals + 1) });
        continue;
      }
      if ((HAND_EXCLUSION_RULE.excludeFlags as readonly string[]).includes(word)) {
        const value = invocation.argv[++i];
        if (value !== undefined) values.push({ flag: word, value });
        continue;
      }
      if ((HAND_EXCLUSION_RULE.filterFlags as readonly string[]).includes(word)) {
        i++; // its value is a test name, not a file
        narrowed = true;
        continue;
      }
      if ((HAND_EXCLUSION_RULE.valueFlags as readonly string[]).includes(word)) {
        i++; // its value is the flag's, not a file to run
        continue;
      }
      if (word === "--" || word.startsWith("-")) continue;
      if ((HAND_EXCLUSION_RULE.subcommands as readonly string[]).includes(word)) continue;
    }
    // A bare operand: the caller named what to run. Context, never a quarantine.
    narrowed = true;
  }
  return { values, narrowed };
}

export interface ReadHandExclusionsResult {
  exclusions: HandExclusion[];
  unread: UnreadInvocation[];
  /** Readable test-runner invocations across the corpus. */
  invocations: number;
  /** Of those, how many named specific files to run. */
  narrowed: number;
  sessionsRead: number;
}

/** Every exclusion typed into a test runner in a corpus of transcripts. */
export function readHandExclusions(sessions: readonly TranscriptSession[]): ReadHandExclusionsResult {
  const exclusions: HandExclusion[] = [];
  const unread: UnreadInvocation[] = [];
  let invocations = 0;
  let narrowed = 0;

  for (const session of sessions) {
    let entryIndex = -1;
    for (const line of session.jsonl.split("\n")) {
      if (!line.trim()) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a corrupt line costs one entry, never the session
      }
      entryIndex++;
      const message = parsed.message as Record<string, unknown> | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) continue;
      const cwd = typeof parsed.cwd === "string" ? parsed.cwd : "";
      const ts = typeof parsed.timestamp === "string" ? parsed.timestamp : "";

      for (const block of content as Record<string, unknown>[]) {
        if (block.type !== "tool_use") continue;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const command = input.command;
        if (typeof command !== "string") continue;
        // Cheap gate: a command that names no runner cannot hold a runner's flag,
        // and the corpus is 658 transcripts.
        if (!/\b(vitest|jest|npm)\b/.test(command)) continue;

        const found = runnerInvocations(command, cwd);
        if (found === null) {
          if (/\b(vitest|jest)\b/.test(command)) {
            unread.push({ session: session.id, entry: entryIndex, ts, cause: "unparseable-shell", command: clip(command) });
          }
          continue;
        }
        for (const invocation of found) {
          invocations++;
          const { values, narrowed: isNarrowed } = invocationExclusions(invocation);
          if (isNarrowed) narrowed++;
          for (const { flag, value } of values) {
            exclusions.push({
              session: session.id,
              entry: entryIndex,
              ts,
              cwd: invocation.cwd,
              runner: invocation.runner,
              flag,
              value,
              ...classifyExclusion(value),
              command: clip(command),
            });
          }
        }
      }
    }
  }

  return { exclusions, unread, invocations, narrowed, sessionsRead: sessions.length };
}

function minutesBetween(first: string, last: string): number {
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 60_000);
}

export interface HandExclusionCensusInput {
  sessionsRead: number;
  invocations: number;
  narrowed: number;
  unread: readonly UnreadInvocation[];
}

/** The count the assumption test reads: distinct test files, and their breadth. */
export function handExclusionCensus(
  exclusions: readonly HandExclusion[],
  input: HandExclusionCensusInput,
): HandExclusionCensus {
  const byFile = new Map<string, HandExclusion[]>();
  for (const exclusion of exclusions) {
    if (exclusion.subject !== "test-file" || !exclusion.file) continue;
    const bucket = byFile.get(exclusion.file);
    if (bucket) bucket.push(exclusion);
    else byFile.set(exclusion.file, [exclusion]);
  }

  const files: ExcludedFile[] = [...byFile.entries()]
    .map(([file, hits]) => {
      const stamps = hits.map((h) => h.ts).filter(Boolean).sort();
      const first = stamps[0] ?? "";
      const last = stamps[stamps.length - 1] ?? "";
      return {
        file,
        invocations: hits.length,
        sessions: [...new Set(hits.map((h) => h.session))].sort(),
        days: [...new Set(stamps.map((s) => s.slice(0, 10)))].sort(),
        first,
        last,
        spanMinutes: minutesBetween(first, last),
      };
    })
    .sort((a, b) => b.invocations - a.invocations || (a.file < b.file ? -1 : 1));

  const excludingEntries = new Set(
    exclusions.filter((e) => e.subject === "test-file").map((e) => `${e.session}:${e.entry}`),
  );

  return {
    sessionsRead: input.sessionsRead,
    invocations: input.invocations,
    narrowed: input.narrowed,
    unread: [...input.unread],
    exclusions: [...exclusions],
    excludingInvocations: excludingEntries.size,
    files,
    distinct: files.length,
    meetsBar: files.length >= HAND_EXCLUSION_RULE.bar,
    repeatedAcrossSessions: files.filter((f) => f.sessions.length > 1).length,
    defaultsRestated: exclusions.filter((e) => e.reason === "the runner's own default, restated by hand").length,
  };
}

/**
 * The census as an operator reads it: coverage first, then the count.
 *
 * Coverage leads because it is the number most likely to invalidate the other
 * one — a census that read no runner invocation has not found "nobody excludes
 * anything", it has found nothing.
 */
export function formatHandExclusionCensus(census: HandExclusionCensus): string {
  const lines: string[] = [];

  lines.push(
    `Coverage: ${census.sessionsRead} session(s) read, ${census.invocations} test-runner invocation(s), ` +
      `${census.unread.length} unreadable and counted neither way.`,
  );

  if (census.invocations === 0) {
    lines.push("Hand exclusions: UNREAD — no test-runner invocation was found at all, so no count is available.");
    return lines.join("\n");
  }

  lines.push(
    `Hand exclusions: ${census.distinct} distinct test file(s) suppressed by hand across ` +
      `${census.excludingInvocations} invocation(s) — bar is ${HAND_EXCLUSION_RULE.bar}, ` +
      `${census.meetsBar ? "MET" : "NOT MET"}.`,
  );

  for (const file of census.files) {
    lines.push(
      `  ${file.file} — ${file.invocations}× in ${file.sessions.length} session(s), ` +
        `${file.days.join(", ")}${file.spanMinutes > 0 ? `, over ${file.spanMinutes} min` : ""}`,
    );
  }

  lines.push(
    `Repetition: ${census.repeatedAcrossSessions} of ${census.distinct} file(s) were excluded in more than one ` +
      `session. A list saves the retyping a second session would have cost; breadth alone does not establish that cost.`,
  );

  if (census.defaultsRestated > 0) {
    lines.push(
      `Restated defaults: ${census.defaultsRestated} exclusion(s) named the runner's own defaults beside a real one — ` +
        `the hand-typed form accreted arguments nobody checked.`,
    );
  }

  lines.push(
    `Not counted: ${census.narrowed} invocation(s) named specific files to run. That is ordinary iteration as ` +
      `often as it is a workaround, and this census counts exclusions that were TYPED, not suppressions that were WANTED.`,
  );

  return lines.join("\n");
}
