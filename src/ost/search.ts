/**
 * A search returns results **or** an explicit unread marker. It never returns an
 * empty set for a question that did not run.
 *
 * **The failure this exists to stop.** `rg: error parsing glob '{Charge'` costs a
 * wasted call, and that is the cheap half. The expensive half is that the caller
 * now holds zero results, and zero results is what "nothing is wrong here" looks
 * like. The tree names the consequence one layer up — a sweep that cannot read
 * its subject reports a clean result — and a malformed pattern is only one way in.
 * Four of this vault's recorded friction events were reads *denied* on a
 * directory and one was a read refused for exceeding a size cap; neither is a
 * syntax problem and both produce the identical false zero. So nothing here tries
 * to prevent the failure. It makes the failure impossible to miscount.
 *
 * **Why this is a type and not a convention.** The pressure at every boundary
 * runs toward flattening: a caller that wants a count writes `results.length`, a
 * caller that wants to filter writes `results.filter(...)`, and both turn "could
 * not examine" into "examined and found nothing" without looking wrong at the
 * call site. The harm surfaces three layers up in a total that reads as complete.
 * {@link SearchTotal} therefore is not a collection and does not carry one: it
 * holds its outcomes in private fields, exposes no `hits`, no `length` and no
 * iterator, and the only route to a count is {@link SearchTotal.resolve}, which
 * takes a handler for the unread case as a required argument. A consumer can
 * still *decide* to ignore unread subjects — no type stops that — but it has to
 * write the branch that does it, in a function whose parameter is named after
 * what it is discarding.
 *
 * **What this does not cover.** Prose. Every summary a pass writes is composed by
 * a model, and nothing in a type system stops a sentence from saying "no issues
 * found" over a subject that was never read. That limit is stated rather than
 * designed around.
 */
import fs from "node:fs";
import type { SweepSubject } from "./sweep.js";

/**
 * Why a subject went unread, in the three shapes this vault has actually hit.
 *
 * `malformed-pattern` is `{Charge` — the question never compiled, so it never ran
 * against anything. `denied` is the filesystem refusing, which is what happened
 * four times on the product directory. `unreadable` is everything else that costs
 * a subject: a size cap, a timeout, a decode failure. The union is open to
 * extension on purpose — the point is never to have run out of names, it is that
 * a subject that could not be examined has *some* name and is never a zero.
 */
export type UnreadCause = "malformed-pattern" | "denied" | "unreadable";

/** A subject the search could not examine, and the reason, kept together. */
export interface UnreadSubject {
  /** What could not be examined, named the way the caller named it. */
  readonly subject: string;
  readonly cause: UnreadCause;
  /** The failure in its own words — the message a person needs to fix it. */
  readonly detail: string;
}

/** One subject that was examined, with whatever it turned up (possibly nothing). */
export interface ExaminedSubject<T> {
  readonly subject: string;
  readonly hits: readonly T[];
}

/**
 * The result of asking one question of one subject.
 *
 * Discriminated on `read` rather than on the presence of `hits`, so a consumer
 * cannot reach the hits without having narrowed the union first. `read: false`
 * carries no `hits` field at all — not an empty array, which is the value this
 * whole module exists to stop being returned.
 */
export type SearchOutcome<T> =
  | ({ readonly read: true } & ExaminedSubject<T>)
  | ({ readonly read: false } & UnreadSubject);

/** An examined subject, for callers assembling outcomes by hand. */
export function examined<T>(subject: string, hits: readonly T[]): SearchOutcome<T> {
  return { read: true, subject, hits };
}

/** An unread subject. There is no other way to report a question that did not run. */
export function unread<T>(subject: string, cause: UnreadCause, detail: string): SearchOutcome<T> {
  return { read: false, subject, cause, detail };
}

/**
 * How a consumer gets a number out of a search, and the only way.
 *
 * Both handlers are required. `whenComplete` runs when every offered subject was
 * examined — that is the only case in which a count means what a count usually
 * means. `whenUnread` runs otherwise and is handed the unread subjects *first*,
 * because the ordering is the argument: a consumer that wants to discard them has
 * to name the parameter it is discarding.
 */
export interface SearchHandlers<T, R> {
  whenComplete: (hits: readonly T[], examined: number) => R;
  whenUnread: (unread: readonly UnreadSubject[], hits: readonly T[], examined: number) => R;
}

/**
 * Everything one search learned, with the unread subjects still in it.
 *
 * Deliberately not an array and deliberately not array-*like*. The outcomes are
 * in a `#private` field, so there is no `hits` to read, no `length` to take, no
 * iterator to spread and nothing for `JSON.stringify` to hand out — the four ways
 * a collection normally leaks a bare count. What is exposed instead is the pair
 * of numbers that make a count legible (`offered`, `examined`) and the unread
 * subjects themselves, which are the thing a summary must not be silent about.
 */
export class SearchTotal<T> {
  readonly #outcomes: readonly SearchOutcome<T>[];

  private constructor(outcomes: readonly SearchOutcome<T>[]) {
    this.#outcomes = outcomes;
  }

  /** Gather outcomes into a total. The one constructor. */
  static over<T>(outcomes: readonly SearchOutcome<T>[]): SearchTotal<T> {
    return new SearchTotal<T>([...outcomes]);
  }

  /**
   * One total over several searches, with both denominators added up.
   *
   * Exists so a caller that runs two searches is not the place the distinction
   * gets lost. Concatenating two `resolve` results by hand is precisely the
   * boundary the assumption underneath this module says the marker dies at: the
   * obvious way to write it drops the unread half of each.
   */
  static merge<T>(...totals: readonly SearchTotal<T>[]): SearchTotal<T> {
    return new SearchTotal<T>(totals.flatMap((t) => [...t.#outcomes]));
  }

  /** How many subjects the search was pointed at. The denominator. */
  get offered(): number {
    return this.#outcomes.length;
  }

  /** How many of them it actually got as far as examining. */
  get examined(): number {
    return this.#outcomes.reduce((n, o) => (o.read ? n + 1 : n), 0);
  }

  /**
   * The subjects it could not examine, each with its reason.
   *
   * Exposed directly, unlike the hits, because the asymmetry is the point: a
   * consumer that never looks at this cannot obtain a count either, and a
   * consumer that formats a summary has the reasons in hand without asking.
   */
  get unread(): readonly UnreadSubject[] {
    return this.#outcomes.filter((o): o is { read: false } & UnreadSubject => !o.read);
  }

  /** Per-subject detail for the subjects that were read. */
  get examinedSubjects(): readonly ExaminedSubject<T>[] {
    return this.#outcomes.filter((o): o is { read: true } & ExaminedSubject<T> => o.read);
  }

  /** True when nothing was read at all — the case {@link sweepReport} calls blind. */
  get blind(): boolean {
    return this.offered > 0 && this.examined === 0;
  }

  /**
   * Get something out of the search, having said what happens to the unread.
   *
   * This is the whole mechanism. `resolve` is the only member that yields the
   * hits, and it cannot be called without supplying `whenUnread`, so the
   * flattening path is absent rather than discouraged. The convention version of
   * this rule already failed here once — the wrapped-wikilink guard exists
   * because asking people to keep links on one line did not work.
   */
  resolve<R>(handlers: SearchHandlers<T, R>): R {
    const hits = this.examinedSubjects.flatMap((s) => [...s.hits]);
    const unread = this.unread;
    const examined = this.examined;
    return unread.length === 0
      ? handlers.whenComplete(hits, examined)
      : handlers.whenUnread(unread, hits, examined);
  }

  /** The offered/read pair, for {@link sweepReport} and the sweep ledger. */
  toSweepSubject(): SweepSubject {
    return { offered: this.offered, read: this.examined };
  }
}

/**
 * The total as an operator reads it: what was examined, what was not, and why.
 *
 * Three quantities on the first line and never two. "8 of 10 examined" with the
 * other two left in silence is the same bug wearing better manners — it was
 * silence about an unread subject that produced the clean result in the first
 * place — so every unread subject gets its own line naming its cause.
 */
export function formatSearchTotal<T>(name: string, total: SearchTotal<T>): string {
  return total.resolve<string>({
    whenComplete: (hits, examined) => `${name}: ${hits.length} hit(s) over ${examined} of ${total.offered} subject(s) examined, 0 unread.`,
    whenUnread: (unread, hits, examined) => {
      const head = total.blind
        ? `${name}: UNREAD — 0 of ${total.offered} subject(s) examined, ${unread.length} unread. ` +
          `This search found nothing because it ran against nothing.`
        : `${name}: ${hits.length} hit(s) over ${examined} of ${total.offered} subject(s) examined, ${unread.length} unread — ` +
          `the hit count is short by whatever the ${unread.length} unread subject(s) hold.`;
      return [head, ...unread.map((u) => `  – unread ${u.subject} (${u.cause}): ${u.detail}`)].join("\n");
    },
  });
}

/**
 * A compiled pattern, or the reason it would not compile.
 *
 * Returned rather than thrown. A throw at this layer is how the caller ends up in
 * a `catch` that returns `[]`, which is the bug — the compile failure has to be
 * carriable all the way to the total.
 */
export type CompiledPattern =
  | { readonly ok: true; readonly matches: (line: string) => boolean }
  | { readonly ok: false; readonly error: string };

const GLOB_SPECIALS = /[.+^$()|[\]\\]/g;

/**
 * Compile a glob into a line matcher, refusing the ones ripgrep refuses.
 *
 * `*`, `?` and `{a,b}` alternation, which is the subset a caller reaches for and
 * the subset `{Charge` comes from. An unterminated alternate group is an error
 * with ripgrep's own wording, because the point of reproducing the failure is
 * that a person who has seen the real message recognises this one.
 */
export function compileGlob(pattern: string): CompiledPattern {
  let out = "";
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      out += pattern[++i].replace(GLOB_SPECIALS, "\\$&");
      continue;
    }
    if (c === "*") out += ".*";
    else if (c === "?") out += ".";
    else if (c === "{") {
      depth++;
      out += "(?:";
    } else if (c === "}") {
      if (depth === 0) {
        return { ok: false, error: `error parsing glob '${pattern}': unopened alternate group; missing '{' (maybe escape '}' with '\\}'?)` };
      }
      depth--;
      out += ")";
    } else if (c === "," && depth > 0) out += "|";
    else out += c.replace(GLOB_SPECIALS, "\\$&");
  }
  if (depth > 0) {
    return { ok: false, error: `error parsing glob '${pattern}': unclosed alternate group; missing '}' (maybe escape '{' with '\\{'?)` };
  }
  const re = new RegExp(`^${out}$`);
  return { ok: true, matches: (line: string) => re.test(line) };
}

/** One question asked of one subject: which file, under which name, with which pattern. */
export interface SearchRequest {
  /** How the subject is named in the report. */
  readonly subject: string;
  readonly file: string;
  /** Glob, matched against each line of the file. */
  readonly pattern: string;
}

/** A matching line, kept with its position so a hit can be gone back to. */
export interface LineHit {
  readonly subject: string;
  readonly line: number;
  readonly text: string;
}

/** Injectable so a test can drive a failure mode it cannot reliably create on disk. */
export type ReadFile = (file: string) => string;

const defaultRead: ReadFile = (file) => fs.readFileSync(file, "utf8");

/**
 * Classify a read failure into an unread cause.
 *
 * `EACCES`/`EPERM` are the denial that hit the product directory. `EISDIR` is
 * grouped with them because it is the same event from the caller's side — the
 * filesystem declined to hand over the bytes. Everything else is `unreadable`
 * rather than being guessed at: a cause invented to look precise is worse than
 * one that admits it is a catch-all, since only the second makes anyone read the
 * detail.
 */
export function causeOfReadFailure(err: unknown): UnreadCause {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EACCES" || code === "EPERM" || code === "EISDIR" ? "denied" : "unreadable";
}

/**
 * Run every request and gather the outcomes, dropping none of them.
 *
 * A request whose pattern will not compile is unread and never examined — the
 * distinction matters, because a pattern that did not compile ran against zero
 * lines of a file that is perfectly readable, and reporting that subject as
 * examined-with-no-hits is exactly the miscount. Same for a file that would not
 * open. Neither costs the rest of the sweep: the walk continues and the total
 * carries what it lost.
 */
export function searchSubjects(
  requests: readonly SearchRequest[],
  opts: { readFile?: ReadFile } = {},
): SearchTotal<LineHit> {
  const readFile = opts.readFile ?? defaultRead;
  return SearchTotal.over(
    requests.map((req): SearchOutcome<LineHit> => {
      const compiled = compileGlob(req.pattern);
      if (!compiled.ok) return unread(req.subject, "malformed-pattern", compiled.error);

      let raw: string;
      try {
        raw = readFile(req.file);
      } catch (err) {
        return unread(req.subject, causeOfReadFailure(err), (err as Error).message);
      }

      const hits: LineHit[] = [];
      raw.split("\n").forEach((text, i) => {
        if (compiled.matches(text)) hits.push({ subject: req.subject, line: i + 1, text });
      });
      return examined(req.subject, hits);
    }),
  );
}
