/**
 * The first-contact path-guess census: of the calls a look-before-you-address
 * guard would have blocked, how many were about to fail anyway?
 *
 * The solution under test is "require a path to have been observed this session
 * before a command may address it" — a call naming a path that has not yet
 * appeared in a listing, a search result or a prior read is refused, and the run
 * is made to look first. The refusal is cheap. What is not cheap is that it fires
 * on every first contact, including the ones that would have worked, so the guard
 * is only worth having if wrong guesses are a large enough share of first
 * contacts. The assumption test beneath it fixed that share before anyone counted:
 * **at least 1 in 5**. Below it the guard taxes more correct addresses than it
 * saves wrong ones and the solution gives way to its cheaper sibling, "a path
 * failure answers with the layout it was addressed against".
 *
 * ## Why this reads raw transcripts and refuses to read anything else
 *
 * The denominator is *successes*, and this product's distilled friction records
 * hold failures only. A census run over `.ost-agent/evidence/TRANSCRIPT_*.md`
 * would see no successful guess anywhere, compute a hit rate of 100%, and pass
 * resoundingly while measuring nothing at all. That is not a hypothetical mistake
 * — it is the shape the assumption test predicted, and it would be invisible in a
 * green exit code. {@link assertNotFailuresOnly} therefore throws rather than
 * returning a number when the corpus it is handed carries no successful
 * path-taking call, and {@link looksLikeFrictionDigest} throws on the markdown
 * digest by its own shape before a single event is lifted.
 *
 * ## The rule is committed here, not chosen after seeing the number
 *
 * {@link GUESS_RULE} holds the bar, what counts as a path-taking call, what counts
 * as having observed a path, and which failures count as a wrong guess. Two
 * judgements in it are genuinely arguable, so the census takes the whole count
 * every way rather than asking to be trusted:
 *
 * - **Which calls the guard would block.** A path named in a declared field
 *   (`Read`, `Edit`, `Write`) is unambiguous. A path inside a shell command has to
 *   be parsed out, and half of every session is `Bash`. {@link GUESS_RULE.populations}
 *   counts both with and without it.
 * - **What counts as having looked.** A listing returns basenames, not paths, so
 *   `ls src` arguably licenses `src/cli/index.ts` and arguably does not.
 *   {@link ObservationMode} counts it both ways.
 *
 * {@link PathGuessCensus.readingDecides} says on the report's face whether any of
 * those choices moved the verdict.
 *
 * ## What a count out of this cannot settle
 *
 * **It counts turns; it cannot weigh them.** The solution's own argument is that
 * the turn the guard forces is worth *more* than the turn it replaces — a listing
 * returns a whole directory where a failure returns one negation — which would
 * justify the guard at a poor ratio. Nothing here prices a turn.
 *
 * **It reads the guesses that were made, not the ones that were avoided.** A pass
 * that stopped guessing because its last three guesses failed appears here as
 * never having needed the layout. That bias runs toward the answer the solution
 * wants, and nothing in the corpus corrects it.
 *
 * And it is bounded by what survives: a call whose result was never paired back is
 * UNREAD, never "succeeded" — see {@link PathGuessCensus.unread}, reported ahead of
 * the ratio and also credited wholesale to the guard in
 * {@link PathGuessCensus.hitRateUpperBound}, because a sweep that cannot read its
 * subject must not report a clean result.
 */
import path from "node:path";
import { classifyPathFailure, clip, MAX_COMMAND_CHARS, MAX_ERROR_CHARS, type PathFailureClass } from "./path-failure-attribution.js";
import type { TranscriptSession } from "./preflight.js";

/** How generously a path counts as having been seen before it was addressed. */
export type ObservationMode = "strict" | "generous";

/** Which calls the guard is taken to govern. */
export type Population = "declared" | "all";

/**
 * The rule, written down before the corpus was counted.
 */
export const GUESS_RULE = {
  /**
   * The pre-committed bar: wrong first-contact guesses must be at least this share
   * of all first-contact path-taking calls. Below it the guard costs more turns
   * than it saves and the solution is refuted in favour of its cheaper sibling.
   */
  bar: 0.2,

  /**
   * Tools that name a path in a declared input field. No parsing, no judgement:
   * the field is the path, and these are the calls nobody can argue the guard
   * would not govern.
   */
  declaredPathFields: {
    Read: "file_path",
    Edit: "file_path",
    MultiEdit: "file_path",
    Write: "file_path",
    NotebookEdit: "notebook_path",
  } as Record<string, string>,

  /**
   * The two populations, each recounted in full.
   *
   * `declared` is the conservative one. `all` adds paths parsed out of `Bash`
   * commands, which is where the parent opportunity's failures actually live — 69
   * of the 76 path-shaped failures in the sibling census arrived through `Bash`.
   */
  populations: ["declared", "all"] as Population[],

  /**
   * Which failures are a wrong guess the guard would have saved.
   *
   * `denied-path` is deliberately absent. A path whose grant is missing *exists*,
   * and looking first returns the same permission denial — the solution node says
   * so itself. Counting it would credit the guard with a save it does not make.
   * The count is reported separately as {@link PathGuessCensus.deniedNotSaved} so
   * a reader who disagrees can add it back and see that it does not move the
   * verdict.
   */
  savedClasses: ["missing-path", "no-matches", "not-a-repo"] as PathFailureClass[],

  /**
   * Shell words that are never a path guess however path-shaped they look.
   * A flag, a URL, a glob (which addresses a pattern rather than a path), and a
   * word carrying shell expansion (whose text is not what the kernel saw).
   */
  notAPathWord: [/^-/, /:\/\//, /[*?[\]{}$`]/, /^\/\/+/],

  /**
   * Character devices every process already has. `2>/dev/null` is a path-shaped
   * word in half this corpus's commands and it addresses nothing a run could get
   * wrong, so counting it would pad the denominator with guaranteed successes —
   * which runs against the assumption under test.
   */
  alwaysPresent: ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/zero"],

  /**
   * Programs whose whole job is to look. The guard's refusal names these — "go
   * list it first" — so a first-contact call that IS one of them is not a guess
   * the guard would save; it is the bootstrap the guard has to allow or the run
   * can never start. Counted and published as
   * {@link PathGuessCensus.discoveryBlocked} rather than silently excluded.
   */
  discoveryPrograms: ["ls", "find", "grep", "rg", "tree", "fd", "stat", "file", "du", "wc", "git"],

  /**
   * What a path looks like in free text, used to read observations out of a
   * listing or a search result. Either a word with a separator in it, or a bare
   * filename with an extension this project actually uses.
   */
  pathShapedToken:
    /(?:~|\.{1,2})?\/?[\w.@+-]+(?:\/[\w.@+-]+)+|\b[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|jsonl|md|yaml|yml|txt|sh|py|lock|gz)\b/g,

  /** Extensions that make a separator-free word a filename rather than a word. */
  bareFileName: /^[\w.-]+\.(?:ts|tsx|js|mjs|cjs|json|jsonl|md|yaml|yml|txt|sh|py|lock|gz)$/,

  /**
   * The read-before-write handshake firing. Not a path failure — the path was
   * right — but the recorded cost of the exact mechanism this solution
   * generalises, so the census reports it beside the ratio rather than dropping
   * it. See {@link PathGuessCensus.handshakeRefusals}.
   */
  handshakeRefusal: /File has not been read yet\.? Read it first/i,

  /**
   * The markdown digest this census must never be run over. Matching it is a
   * thrown error, not a zero — see the module docstring.
   *
   * The markers are checked only against text that does not read as JSONL, and
   * that ordering is the whole guard. A raw transcript *quotes* these digests
   * routinely — the sessions that wrote them are in the corpus — so a marker
   * alone throws away real sessions. The first cut of this census refused 1 of
   * 1,216 transcripts for containing the words it was told to look for.
   */
  frictionDigestMarkers: [/^source:\s*'TRANSCRIPT:/m, /produced \d+ friction events/],
} as const;

// ── the record, distilled to what a replay needs ─────────────────────────────

/** One tool call, with whatever of it bears on a path. */
export interface CallEvent {
  kind: "call";
  tool: string;
  /** `Bash`'s command, clipped. Empty for every other tool. */
  command: string;
  /** The declared path field's value, when the tool has one. Empty otherwise. */
  declaredPath: string;
  /** `true` only when a `tool_result` came back with `is_error`. */
  failed: boolean;
  /** Clipped failure text; empty unless `failed`. */
  error: string;
  /** No `tool_result` was ever paired back to this call. Never read as success. */
  unread: boolean;
}

/** Path-shaped tokens a tool result put in front of the caller. */
export interface ObserveEvent {
  kind: "observe";
  tokens: string[];
}

export type StreamEvent = CallEvent | ObserveEvent;

/** One session, reduced to the ordered events a guard replay needs. */
export interface SessionStream {
  session: string;
  events: StreamEvent[];
}

/** One call the guard would have blocked, and what became of it. */
export interface FirstContact {
  session: string;
  tool: string;
  command: string;
  /** The addressed paths that had not been observed — why it was blocked. */
  unseen: string[];
  failed: boolean;
  unread: boolean;
  /** Which layout failure it was, when it failed with one. */
  cls: PathFailureClass | null;
  /** A failure the guard would actually have saved: a wrong guess. */
  wrongGuess: boolean;
  /** This blocked call was itself the looking the refusal would have demanded. */
  discovery: boolean;
  error: string;
}

/** One full recount under one (population, observation) choice. */
export interface GuessReading {
  population: Population;
  observation: ObservationMode;
  /** Path-taking calls the guard would have blocked. The denominator. */
  firstContact: number;
  /** Path-taking calls it would have let through untouched. */
  observed: number;
  /** Blocked calls that were about to fail with a layout failure. The numerator. */
  wrongGuesses: number;
  /** Blocked calls that failed for any reason at all — the generous numerator. */
  anyFailure: number;
  /** wrongGuesses / firstContact, or null when nothing was blocked. */
  hitRate: number | null;
  /** (anyFailure + unread) / firstContact — every doubt resolved for the guard. */
  hitRateUpperBound: number | null;
  meetsBar: boolean;
  /** Even the upper bound clears the bar. */
  upperBoundMeetsBar: boolean;
}

export interface PathGuessCensus {
  sessionsRead: number;
  /** Every tool call in the corpus, path-taking or not. Context for the share. */
  calls: number;
  /** Calls whose result never came back. Counted for the guard, never against it. */
  unread: number;
  /** The reading the assumption test's plain words name: every path-taking call, strict observation. */
  primary: GuessReading;
  /** All four recounts. */
  readings: GuessReading[];
  /** The verdict off `primary`. */
  meetsBar: boolean;
  /** Any reading at all, on any numerator, clears the bar. */
  anyReadingMeetsBar: boolean;
  /** The choices between readings changed the verdict. */
  readingDecides: boolean;
  /** The best case the corpus can be made to give the guard, across every reading. */
  bestCaseHitRate: number | null;
  /**
   * Blocked calls that failed on a permission denial. The guard does not save
   * these — looking first returns the same denial — so they are excluded from
   * `wrongGuesses` and published here instead.
   */
  deniedNotSaved: number;
  /**
   * Blocked calls that were themselves a look — `ls`, `find`, `grep`, `git`.
   *
   * The guard's refusal names the looking that would satisfy it, and these ARE
   * that looking. Refusing them is a deadlock: a session's first `ls` addresses a
   * directory nothing has observed yet, so under the guard as written it never
   * runs and nothing is ever observed. The solution node does not name this seam;
   * it names only the create-a-new-file exemption. The number is here so the size
   * of the missing exemption is on the record.
   */
  discoveryBlocked: number;
  /**
   * How many turns the guard costs for each one it saves, on the primary reading.
   * The number an operator actually acts on.
   */
  taxedPerSave: number | null;
  /** `File has not been read yet` refusals in the corpus: the handshake's recorded cost. */
  handshakeRefusals: number;
  /** The blocked wrong guesses themselves, for a reader who wants to check them. */
  wrongGuesses: FirstContact[];
}

// ── refusing the corpus that would answer the question by construction ───────

/**
 * Does this text read as a session transcript at all?
 *
 * A transcript is JSONL: every line is one JSON object. A digest is markdown with
 * YAML frontmatter, and not one line of it parses. Sampling the head is enough
 * and is what keeps this cheap over a thousand multi-megabyte files.
 */
export function readsAsJsonl(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (lines.length === 0) return true; // an empty file is zero sessions, not a digest
  let parsed = 0;
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === "object") parsed++;
    } catch {
      // not JSON — counted against it below
    }
  }
  return parsed > lines.length / 2;
}

/**
 * Does this text look like a distilled friction digest rather than a transcript?
 *
 * Shape first, markers second. A raw transcript that merely *quotes* a digest is
 * still a raw transcript, and refusing it would silently shrink the corpus.
 */
export function looksLikeFrictionDigest(text: string): boolean {
  if (readsAsJsonl(text)) return false;
  return GUESS_RULE.frictionDigestMarkers.some((re) => re.test(text));
}

/**
 * Throw if handed the friction records instead of raw transcripts.
 *
 * The digest holds failures only. A hit rate computed over it is 100% by
 * construction, and 100% is a resounding pass. This runs before anything is
 * lifted, so the mistake surfaces as a thrown error naming itself rather than as
 * a green exit code.
 */
export function assertRawTranscripts(sessions: TranscriptSession[]): void {
  for (const session of sessions) {
    if (looksLikeFrictionDigest(session.jsonl)) {
      throw new Error(
        `path-guess census: session "${session.id}" is a distilled friction digest, not a raw transcript. ` +
          `The digest records failures only, so the hit rate over it is 100% by construction and the census would ` +
          `pass while measuring nothing. Point this at ~/.claude/projects, not at .ost-agent/evidence/.`,
      );
    }
  }
}

/**
 * Throw if the corpus carries no successful path-taking call.
 *
 * The second half of the same guard, and the one that catches a failures-only
 * corpus that does not announce itself in its formatting — the sibling census's
 * `failures.jsonl`, for instance, which is exactly the wrong input and exactly
 * the shape a reader would reach for first.
 */
export function assertNotFailuresOnly(streams: SessionStream[]): void {
  let succeeded = 0;
  let total = 0;
  for (const stream of streams) {
    for (const event of stream.events) {
      if (event.kind !== "call") continue;
      if (!pathsAddressedBy(event, "all").length) continue;
      total++;
      if (!event.failed && !event.unread) succeeded++;
    }
  }
  if (total > 0 && succeeded === 0) {
    throw new Error(
      `path-guess census: ${total} path-taking call(s) in this corpus and not one of them succeeded. ` +
        `That is the signature of a failures-only record, and the hit rate over it is 100% by construction. ` +
        `The denominator of this census is successes; it must be read off raw session transcripts.`,
    );
  }
}

// ── what the guard would govern ──────────────────────────────────────────────

/**
 * Split a shell command into words, honouring quotes and backslashes.
 *
 * Crude on purpose. An unbalanced quote swallows the rest of the command into one
 * word, which then fails {@link GUESS_RULE.notAPathWord} or carries a separator
 * and is read as one path — either way the call still enters the census, so the
 * error is in how a word is spelled rather than in whether the call is counted.
 */
export function commandWords(command: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "\\") {
      current += command[++i] ?? "";
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) words.push(current);
  return words;
}

/** Where `~` points. Fixed rather than read, so a replay is the same anywhere. */
export const HOME = "/Users/tanner";

/**
 * The paths a shell command addresses.
 *
 * A glob is excluded by {@link GUESS_RULE.notAPathWord} and the exclusion is a
 * judgement worth naming: `ls src/*.ts` does not address a path, it addresses a
 * pattern, and the guard as written has nothing to refuse. Excluding globs drops
 * calls from the denominator that were mostly succeeding, which runs *toward* the
 * answer the solution wants.
 */
export function pathsInCommand(command: string): string[] {
  const found: string[] = [];
  for (const word of commandWords(command)) {
    // `2>/dev/null`, `>out.txt`, `<in.json`: the redirection is punctuation, and
    // the file descriptor in front of it is not part of what was addressed.
    let token = word.replace(/^\d*[<>]+&?/, "").replace(/[,;:]+$/, "");
    if (!token) continue;
    if (GUESS_RULE.notAPathWord.some((re) => re.test(token))) continue;
    if (token.startsWith("~/")) token = HOME + token.slice(1);
    // Read before normalising: `src/` is a path and `src` is a word, and the
    // trailing separator is the only thing that says so.
    const looksLikeAPath = token.includes("/") || GUESS_RULE.bareFileName.test(token);
    if (!looksLikeAPath) continue;
    token = normalizePath(token);
    if ((GUESS_RULE.alwaysPresent as readonly string[]).includes(token)) continue;
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * One spelling per path, so `ls src/` counts as having looked at `src`.
 *
 * Only the trailing separator, which is the one difference that carries no
 * meaning at all. Everything else — relative versus absolute, `.` segments — is
 * left alone, because resolving those needs a working directory the transcript
 * does not record, and inventing one would put paths in the observed set that the
 * run never saw.
 */
export function normalizePath(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

/** Is this call itself the looking the guard's refusal would name? */
export function isDiscoveryCall(call: CallEvent): boolean {
  if (call.tool === "Glob" || call.tool === "Grep") return true;
  if (call.tool !== "Bash") return false;
  return call.command
    .split(/&&|\|\||[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .some((segment) => {
      const words = segment.split(/\s+/).filter(Boolean);
      let i = 0;
      while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
      return (
        words[i] !== undefined &&
        (GUESS_RULE.discoveryPrograms as readonly string[]).includes(path.basename(words[i]))
      );
    });
}

/** Every path this call addresses, under one population. */
export function pathsAddressedBy(call: CallEvent, population: Population): string[] {
  if (call.declaredPath) return [normalizePath(call.declaredPath)];
  if (population === "all" && call.tool === "Bash" && call.command) return pathsInCommand(call.command);
  return [];
}

/** Every path-shaped token in a piece of free text — a listing, a search result. */
export function pathTokensIn(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(GUESS_RULE.pathShapedToken)) tokens.push(match[0]);
  return tokens;
}

// ── reading the record ───────────────────────────────────────────────────────

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("\n");
  }
  return "";
}

/**
 * Lift the ordered event stream out of raw session transcripts.
 *
 * Ordering is the whole point: a path counts as observed only if it appeared in a
 * result that arrived *before* the call that addressed it. Results are matched to
 * their calls by `tool_use_id` and emitted in file order, which is the order the
 * caller saw them in.
 *
 * `relevantOnly` drops observation tokens no call in that session ever addresses.
 * It is a lossless compression of the replay — a token nothing addresses cannot
 * change any call's verdict — and it exists so the frozen corpus is committable.
 * The harvest script runs the replay both ways and writes both counts into
 * `corpus.json`; if they ever differ the fixture is wrong.
 */
export function readSessionStreams(
  sessions: TranscriptSession[],
  options: { relevantOnly?: boolean } = {},
): { streams: SessionStream[]; sessionsRead: number; calls: number } {
  assertRawTranscripts(sessions);
  const streams: SessionStream[] = [];
  let calls = 0;

  for (const session of sessions) {
    const entries: Record<string, unknown>[] = [];
    for (const line of session.jsonl.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // a torn line is one fewer entry, never a thrown census
      }
    }
    const blocksOf = (entry: Record<string, unknown>): Record<string, unknown>[] => {
      const message = entry.message as Record<string, unknown> | undefined;
      return Array.isArray(message?.content) ? (message.content as Record<string, unknown>[]) : [];
    };

    // Pass one: pair every result back to its call, so a call can be read as
    // failed, succeeded or unread at the moment it is emitted.
    const outcome = new Map<string, { failed: boolean; error: string }>();
    for (const entry of entries) {
      for (const block of blocksOf(entry)) {
        if (block.type !== "tool_result") continue;
        const id = String(block.tool_use_id ?? "");
        if (!id) continue;
        const failed = block.is_error === true;
        outcome.set(id, { failed, error: failed ? clip(resultText(block.content), MAX_ERROR_CHARS) : "" });
      }
    }

    // Pass two: which paths does any call in this session address? Used only to
    // drop irrelevant observation tokens; a superset of what any extractor could
    // produce, because an extracted path is a substring of the input it came from.
    const addressedText: string[] = [];
    if (options.relevantOnly) {
      for (const entry of entries) {
        for (const block of blocksOf(entry)) {
          if (block.type !== "tool_use") continue;
          addressedText.push(JSON.stringify(block.input ?? {}));
        }
      }
    }
    const haystack = addressedText.join("\n");
    const relevant = (token: string): boolean => {
      if (!options.relevantOnly) return true;
      if (haystack.includes(token)) return true;
      if (token.startsWith(HOME) && haystack.includes(`~${token.slice(HOME.length)}`)) return true;
      return haystack.includes(path.basename(token));
    };

    // Pass three: the stream itself, in order.
    const events: StreamEvent[] = [];
    const emitted = new Set<string>();
    for (const entry of entries) {
      for (const block of blocksOf(entry)) {
        if (block.type === "tool_result") {
          const fresh: string[] = [];
          for (const token of pathTokensIn(resultText(block.content))) {
            if (emitted.has(token) || !relevant(token)) continue;
            emitted.add(token);
            fresh.push(token);
          }
          if (fresh.length) events.push({ kind: "observe", tokens: fresh });
          continue;
        }
        if (block.type !== "tool_use") continue;
        calls++;
        const tool = String(block.name ?? "");
        const input = (block.input ?? {}) as Record<string, unknown>;
        const field = GUESS_RULE.declaredPathFields[tool];
        const declaredRaw = field && typeof input[field] === "string" ? (input[field] as string) : "";
        const declaredPath = declaredRaw.startsWith("~/") ? HOME + declaredRaw.slice(1) : declaredRaw;
        const result = outcome.get(String(block.id ?? ""));
        events.push({
          kind: "call",
          tool,
          command: typeof input.command === "string" ? clip(input.command, MAX_COMMAND_CHARS) : "",
          declaredPath,
          failed: result?.failed ?? false,
          error: result?.error ?? "",
          unread: result === undefined,
        });
      }
    }
    streams.push({ session: session.id, events });
  }

  return { streams, sessionsRead: sessions.length, calls };
}

// ── the replay ───────────────────────────────────────────────────────────────

/**
 * Replay the guard over one corpus under one set of choices, and return every
 * call it would have blocked.
 *
 * The observation set grows as the session runs: tokens a result put in front of
 * the caller, and the path of any call that succeeded — because under the guard
 * that call would have been preceded by the look that licensed it, and afterwards
 * the run knows the path either way.
 */
export function replayGuard(
  streams: SessionStream[],
  population: Population,
  observation: ObservationMode,
): FirstContact[] {
  const blocked: FirstContact[] = [];
  for (const stream of streams) {
    const seen = new Set<string>();
    const seenBase = new Set<string>();
    const observe = (raw: string): void => {
      const token = normalizePath(raw);
      seen.add(token);
      seenBase.add(path.basename(token));
    };
    const wasSeen = (p: string): boolean =>
      seen.has(p) || (observation === "generous" && seenBase.has(path.basename(p)));

    for (const event of stream.events) {
      if (event.kind === "observe") {
        for (const token of event.tokens) observe(token);
        continue;
      }
      const paths = pathsAddressedBy(event, population);
      if (paths.length) {
        const unseen = paths.filter((p) => !wasSeen(p));
        if (unseen.length) {
          const cls = event.failed ? classifyPathFailure(event.error) : null;
          blocked.push({
            session: stream.session,
            tool: event.tool,
            command: event.command,
            unseen,
            failed: event.failed,
            unread: event.unread,
            cls,
            wrongGuess: cls !== null && GUESS_RULE.savedClasses.includes(cls),
            discovery: isDiscoveryCall(event),
            error: event.error,
          });
        }
      }
      // A call that came back clean leaves the run knowing the path, whether the
      // guard forced a look first or not.
      if (!event.failed && !event.unread) for (const p of paths) observe(p);
    }
  }
  return blocked;
}

function readingOf(streams: SessionStream[], population: Population, observation: ObservationMode): GuessReading {
  const blocked = replayGuard(streams, population, observation);
  let observedCalls = 0;
  for (const stream of streams) {
    for (const event of stream.events) {
      if (event.kind !== "call") continue;
      const paths = pathsAddressedBy(event, population);
      if (paths.length) observedCalls++;
    }
  }
  observedCalls -= blocked.length;

  const firstContact = blocked.length;
  const wrongGuesses = blocked.filter((b) => b.wrongGuess).length;
  const anyFailure = blocked.filter((b) => b.failed).length;
  const unread = blocked.filter((b) => b.unread).length;
  const hitRate = firstContact === 0 ? null : wrongGuesses / firstContact;
  const hitRateUpperBound = firstContact === 0 ? null : (anyFailure + unread) / firstContact;
  return {
    population,
    observation,
    firstContact,
    observed: observedCalls,
    wrongGuesses,
    anyFailure,
    hitRate,
    hitRateUpperBound,
    meetsBar: hitRate !== null && hitRate >= GUESS_RULE.bar,
    upperBoundMeetsBar: hitRateUpperBound !== null && hitRateUpperBound >= GUESS_RULE.bar,
  };
}

export function pathGuessCensus(streams: SessionStream[], meta: { sessionsRead: number; calls: number }): PathGuessCensus {
  assertNotFailuresOnly(streams);

  const readings: GuessReading[] = [];
  for (const population of GUESS_RULE.populations) {
    for (const observation of ["strict", "generous"] as ObservationMode[]) {
      readings.push(readingOf(streams, population, observation));
    }
  }
  const primary = readings.find((r) => r.population === "all" && r.observation === "strict")!;
  const primaryBlocked = replayGuard(streams, "all", "strict");

  let unread = 0;
  let handshakeRefusals = 0;
  for (const stream of streams) {
    for (const event of stream.events) {
      if (event.kind !== "call") continue;
      if (event.unread) unread++;
      if (event.failed && GUESS_RULE.handshakeRefusal.test(event.error)) handshakeRefusals++;
    }
  }

  const verdicts = new Set(readings.flatMap((r) => [r.meetsBar, r.upperBoundMeetsBar]));
  const rates = readings.flatMap((r) => [r.hitRate, r.hitRateUpperBound]).filter((r): r is number => r !== null);

  return {
    sessionsRead: meta.sessionsRead,
    calls: meta.calls,
    unread,
    primary,
    readings,
    meetsBar: primary.meetsBar,
    anyReadingMeetsBar: readings.some((r) => r.meetsBar || r.upperBoundMeetsBar),
    readingDecides: verdicts.size > 1,
    bestCaseHitRate: rates.length === 0 ? null : Math.max(...rates),
    deniedNotSaved: primaryBlocked.filter((b) => b.cls === "denied-path").length,
    discoveryBlocked: primaryBlocked.filter((b) => b.discovery).length,
    taxedPerSave:
      primary.wrongGuesses === 0 ? null : (primary.firstContact - primary.wrongGuesses) / primary.wrongGuesses,
    handshakeRefusals,
    wrongGuesses: primaryBlocked.filter((b) => b.wrongGuess),
  };
}

function pct(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 1000) / 10}%`;
}

/**
 * The census as an operator reads it: coverage first, then the verdict in words,
 * then the numbers that could overturn it.
 *
 * REFUTED and CLEARS are spelled out rather than left to a comparison of two
 * decimals, because this census exists to kill a solution or license it and an
 * exit code cannot carry that distinction — the command is green when the count
 * has been taken, whichever way it came out.
 */
export function formatPathGuessCensus(census: PathGuessCensus): string {
  const lines: string[] = [];
  lines.push(
    `Read ${census.sessionsRead} session(s), ${census.calls} tool call(s); ${census.unread} call(s) never came back and are counted FOR the guard.`,
  );
  const p = census.primary;
  lines.push(
    `A look-before-you-address guard would have blocked ${p.firstContact} first-contact path-taking call(s) and waved through ${p.observed}.`,
  );
  lines.push(
    `Of the blocked calls, ${p.wrongGuesses} were about to fail on the layout — a hit rate of ${pct(p.hitRate)} against a pre-committed bar of ${pct(GUESS_RULE.bar)}.`,
  );
  lines.push(
    census.meetsBar
      ? `CLEARS: the guard saves at least one turn in five.`
      : `REFUTED: the guard taxes ${census.taxedPerSave === null ? "every" : Math.round(census.taxedPerSave)} correct address for each wrong guess it saves.`,
  );
  lines.push(
    census.anyReadingMeetsBar
      ? `At least one reading clears the bar — the choice between them decides the verdict.`
      : `No reading clears the bar; the most generous arithmetic the corpus allows is ${pct(census.bestCaseHitRate)}, still short of ${pct(GUESS_RULE.bar)}.`,
  );
  for (const r of census.readings) {
    lines.push(
      `  ${r.population}/${r.observation}: ${r.wrongGuesses}/${r.firstContact} = ${pct(r.hitRate)} (any failure or unread: ${pct(r.hitRateUpperBound)})`,
    );
  }
  lines.push(
    `${census.deniedNotSaved} blocked call(s) failed on a permission denial, which looking first does not save.`,
  );
  lines.push(
    `${census.discoveryBlocked} blocked call(s) were themselves a look (ls, find, grep, git) — the guard has no exemption for them and would deadlock the run.`,
  );
  lines.push(
    `The read-before-write handshake this generalises fired ${census.handshakeRefusals} time(s) in the same corpus.`,
  );
  return lines.join("\n");
}
