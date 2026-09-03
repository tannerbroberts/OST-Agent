/**
 * Typecheck the files just touched, at the moment they are touched — so the
 * diagnostic arrives attached to the edit that caused it rather than to a batch.
 *
 * The candidate this serves: "Typecheck the files just touched, at the moment
 * they are touched." A run writes several files, then runs `npx tsc --noEmit`
 * and learns that one of the edits referenced something that does not exist. The
 * signal is correct and far too late — it arrives detached from the edit that
 * caused it, after the rest of the batch has been written on top of the mistake.
 * The captured failure is this product's own session
 * (`TRANSCRIPT:b7aae32d-150a-462f-9027-cdf7af12badd`):
 *
 *   `src/security/tools.ts(744,63): error TS2339: Property 'configProblem' does
 *   not exist on type 'ToolContext'`
 *
 * So this keeps the check and moves it. {@link TouchedFileChecker.check} builds a
 * TypeScript program whose roots are the touched files and their immediate
 * importers, reports the diagnostics **for those files only**, and returns in a
 * few hundred milliseconds. The verdict is advisory text handed back with the
 * edit result, never a refusal: a run mid-refactor is legitimately broken between
 * two edits, and a gate that forbade that would make ordinary work impossible.
 *
 * ## Why the immediate importers are in the program and not an extra
 *
 * They are half the diagnostic. Deleting `configProblem` from `ToolContext`
 * produces two errors, and only one of them is in the file that was edited: the
 * other is `src/mcp/server.ts(101,5) TS2353`, in a module that imports the one
 * that changed. A check scoped to the touched file alone reports one of the two
 * and reads as complete, which is the failure mode "A sweep that cannot read its
 * subject reports a clean result" names. With the immediate importers as roots,
 * this check reports **exactly** what the whole-project run reports for the same
 * edit — measured, in the same process, by
 * `test/runner/incremental-typecheck.test.ts`.
 *
 * ## What it costs, and the number the node got wrong
 *
 * The solution node's risk was entirely cost: "a check that adds seconds to every
 * edit will be turned off within a week". On this repository (262 files in
 * `tsconfig.json`) the check costs ~0.9 s cold and ~0.25 s with a warm cache,
 * against ~1.3 s for the whole-project program in the same process and ~1.7 s for
 * `npx tsc --noEmit` at a shell. It is affordable per edit, which is the half of
 * the bar that matters.
 *
 * **The other half of the bar is refuted.** The assumption test fixed its
 * threshold as *"under 2 seconds, while the whole-project `tsc --noEmit` it
 * replaces takes longer than 10 seconds on the same machine"*. The whole-project
 * run on this repository does not take longer than 10 seconds — it takes about
 * 1.7 (three runs: 2.05 s, 1.67 s, 1.64 s, 2026-09-03, idle laptop). So the
 * margin this design was chosen for is not the order of magnitude the node
 * assumed; it is roughly 1.5–2× cold and 5× warm. The reason to move the check is
 * therefore **attribution**, not speed: the same second of compute spent per edit
 * instead of per batch buys a diagnostic that names the edit. That is a weaker
 * argument than the node makes, and it is the true one.
 *
 * ## What this deliberately is not
 *
 * - **Not a gate.** {@link TypecheckVerdict.advisory} is always true and no caller
 *   here turns a diagnostic into an exit code. `npx tsc --noEmit` remains the
 *   thing that decides whether a branch merges.
 * - **Not the whole project.** A diagnostic in a *transitive* dependent — a module
 *   that imports a module that imports the touched file — is outside these roots.
 *   {@link TypecheckVerdict.limits} says so in the verdict rather than leaving the
 *   caller to assume otherwise.
 * - **Not a judge of anything a typechecker cannot see.** `b7aae32d`'s TS2339 is
 *   in scope; a logic error that compiles is not.
 * - **Not shipped in the bundle.** `typescript` is a devDependency, and
 *   `dist/ost-agent.mjs` is what the plugin launches. Nothing on the CLI's import
 *   graph reaches this module; `scripts/typecheck-touched.ts` is its caller, run
 *   through `tsx` by whoever wants the check.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * The bar the assumption test fixed, pinned here rather than typed into the spec
 * that reads it.
 *
 * On the rule `SYMBOL_INDEX_CASES` established in {@link ./symbol-index.ts}: a
 * threshold a test carries privately is a threshold the next edit can quietly
 * restate. `expect` reads these; it does not get to choose them.
 */
export const INCREMENTAL_TYPECHECK_BAR = {
  /** The node's threshold, verbatim, including the half measurement refuted. */
  threshold:
    "A single-file check over `src/security/tools.ts` reports the TS2339 on `configProblem` and returns in " +
    "under 2 seconds, while the whole-project `tsc --noEmit` it replaces takes longer than 10 seconds on the " +
    "same machine.",
  /** The file the transcript's error was reported in. */
  file: "src/security/tools.ts",
  /** `TS2339: Property 'configProblem' does not exist on type 'ToolContext'`. */
  code: 2339,
  type: "ToolContext",
  member: "configProblem",
  /** The node's affordability half: a check a run will tolerate on every edit. */
  budgetMs: 2000,
  /**
   * What the whole-project program costs in-process on an idle machine here —
   * the speed the node's 2000 ms was stated against.
   *
   * It is the denominator that makes the budget survivable inside a parallel
   * suite. Measured on 2026-09-03, idle: 1.26–1.32 s in-process, 1.6–2.1 s for
   * `npx tsc --noEmit` at a shell. During a full `npx vitest run` on the same
   * laptop the same in-process program took 8.4 s — a 6× contention factor — and
   * a bare 2000 ms ceiling convicted a check that had not changed. So the spec
   * scales the budget by `wholeProjectMs / this`, never below 1×: a machine that
   * is demonstrably six times slower gets six times the budget, and an idle
   * machine gets exactly the node's number.
   */
  wholeProjectReferenceMs: 1300,
  /**
   * The node's comparison half, **refuted by measurement**. Kept because a bar
   * that was wrong is evidence, and deleting it would leave the file claiming a
   * margin nothing here ever had. `npx tsc --noEmit` over this project takes
   * 1.6–2.1 s, not >10 s; the spec asserts the measured figure and names this one.
   */
  wholeProjectFloorMsClaimed: 10_000,
  /**
   * The speed-up the spec actually holds this to, warm, same run, same process.
   *
   * Chosen here rather than by the node, and the honest account is: the node's
   * own pair of numbers implies ≥5×, measurement gives ~5× warm and ~1.6× cold,
   * and 3 is set below the warm figure with room for a contended machine while
   * still failing if the narrow path stops being the cheap one. A ratio taken in
   * the same run is self-normalising — a busy box slows both sides — which is
   * why the ceiling this repository can trust is a ratio and not a stopwatch.
   */
  minSpeedup: 3,
} as const;

/** A file the run has just written, or is about to. */
export interface TouchedFile {
  /** Absolute, or relative to the project root. */
  path: string;
  /**
   * The buffer as it now reads, when the edit is not on disk yet. Omitted means
   * "read it from disk" — the ordinary case for a hook that fires after a write.
   */
  source?: string;
}

/** One diagnostic, in the shape a run can act on without parsing anything. */
export interface EditDiagnostic {
  /** Project-relative, slash-separated. */
  file: string;
  /** 1-based, as an editor counts. */
  line: number;
  /** 1-based. */
  column: number;
  /** The `TS####` number, unprefixed. */
  code: number;
  category: "error" | "warning" | "suggestion" | "message";
  message: string;
  /** `src/security/tools.ts(2416,70): error TS2339: …` — the form `tsc` prints. */
  text: string;
}

/** What the check saw, what it did not, and what it cost. */
export interface TypecheckVerdict {
  /** The touched files, project-relative. */
  checked: string[];
  /** Immediate importers of those files, also in the program and also reported on. */
  dependents: string[];
  /** Every diagnostic in `checked` ∪ `dependents`, in file then position order. */
  diagnostics: EditDiagnostic[];
  /** Wall-clock cost of this check, including program construction. */
  elapsedMs: number;
  /**
   * Always true. This verdict is text handed back with an edit result; nothing
   * here refuses a write, and a run mid-refactor is expected to be broken.
   */
  advisory: true;
  /** What this check cannot see, stated in the verdict rather than assumed away. */
  limits: string[];
}

/** The one thing this check cannot see, said out loud on every verdict. */
const LIMITS: readonly string[] = [
  "only the touched files and their immediate importers are reported on — a diagnostic in a transitive dependent " +
    "is outside these roots and only the whole-project run will find it",
];

/** A cached parse of one file, invalidated when the file on disk moves under it. */
interface CachedSource {
  /** `mtimeMs:size`, the cheapest thing that changes when the file does. */
  version: string;
  file: ts.SourceFile;
}

/** Project-relative, slash-separated, whatever the platform's separator is. */
function relative(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

const CATEGORY: Record<ts.DiagnosticCategory, EditDiagnostic["category"]> = {
  [ts.DiagnosticCategory.Error]: "error",
  [ts.DiagnosticCategory.Warning]: "warning",
  [ts.DiagnosticCategory.Suggestion]: "suggestion",
  [ts.DiagnosticCategory.Message]: "message",
};

/**
 * A typechecker that stays alive across edits.
 *
 * The cache is the difference between a check a run tolerates and one it turns
 * off: the first check in a process pays ~0.9 s to parse the dependency graph and
 * the lib files, and every check after it pays ~0.25 s because those parses are
 * still here. A hook that spawns a fresh process per edit gets the cold number and
 * nothing else — which is the shape of the cost, and worth knowing before anyone
 * concludes the design is cheap.
 */
export class TouchedFileChecker {
  readonly projectRoot: string;

  private readonly options: ts.CompilerOptions;
  private readonly projectFiles: string[];
  private readonly cache = new Map<string, CachedSource>();
  /** Absolute path → the absolute paths it imports, for the reverse walk. */
  private importGraph: Map<string, string[]> | null = null;

  constructor(opts: { projectRoot: string; configPath?: string }) {
    this.projectRoot = path.resolve(opts.projectRoot);
    const configPath = opts.configPath ?? path.join(this.projectRoot, "tsconfig.json");
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      throw new Error(`cannot read ${configPath}: ${ts.flattenDiagnosticMessageText(read.error.messageText, " ")}`);
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, this.projectRoot);
    this.projectFiles = parsed.fileNames.map((f) => path.resolve(f));
    // Emit is off and declaration emit with it: this check reads the program, and
    // a declaration-emit diagnostic is a fact about output nobody is producing.
    this.options = { ...parsed.options, noEmit: true, declaration: false, declarationMap: false, sourceMap: false };
  }

  /** Every file `tsconfig.json` puts in the project, absolute. */
  get files(): readonly string[] {
    return this.projectFiles;
  }

  /**
   * Check the touched files and their immediate importers.
   *
   * `dependents: false` narrows the program to the touched files alone. It is
   * here because the cost difference is real (~0.5 s against ~0.9 s cold) and
   * because the spec measures both, not because a caller should prefer it: the
   * narrow form misses the half of the captured failure that lands in an
   * importer.
   */
  check(touched: readonly TouchedFile[], opts: { dependents?: boolean } = {}): TypecheckVerdict {
    const started = performance.now();
    const overlay = new Map<string, string>();
    const roots: string[] = [];
    for (const t of touched) {
      const abs = path.resolve(this.projectRoot, t.path);
      if (t.source !== undefined) overlay.set(abs, t.source);
      roots.push(abs);
    }

    const dependents =
      opts.dependents === false ? [] : this.immediateImporters(roots, overlay).filter((f) => !roots.includes(f));
    const program = this.program([...roots, ...dependents], overlay);

    const diagnostics: EditDiagnostic[] = [];
    for (const file of [...roots, ...dependents]) {
      const source = program.getSourceFile(file);
      // A root that resolves to nothing is a path the caller got wrong, and
      // silently reporting zero diagnostics for it is the clean-sweep failure.
      if (!source) throw new Error(`${relative(this.projectRoot, file)} is not a file this program can read`);
      for (const d of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
        diagnostics.push(this.render(d));
      }
    }

    return {
      checked: roots.map((f) => relative(this.projectRoot, f)),
      dependents: dependents.map((f) => relative(this.projectRoot, f)),
      diagnostics,
      elapsedMs: performance.now() - started,
      advisory: true,
      limits: [...LIMITS],
    };
  }

  /**
   * The whole-project run this check replaces, measured on identical terms.
   *
   * Same process, same `typescript` instance, same host and the same overlay, so
   * the ratio the spec asserts is a comparison of two checks rather than of two
   * harnesses. It is not `npx tsc --noEmit` — it is what that command does, minus
   * the process start and the npm shim, which flatters the whole-project side
   * rather than this one.
   */
  checkWholeProject(touched: readonly TouchedFile[] = []): TypecheckVerdict {
    const started = performance.now();
    const overlay = new Map<string, string>();
    for (const t of touched) {
      if (t.source !== undefined) overlay.set(path.resolve(this.projectRoot, t.path), t.source);
    }
    const program = this.program(this.projectFiles, overlay);
    const diagnostics = [
      ...program.getSyntacticDiagnostics(),
      ...program.getGlobalDiagnostics(),
      ...program.getSemanticDiagnostics(),
    ].map((d) => this.render(d));

    return {
      checked: this.projectFiles.map((f) => relative(this.projectRoot, f)),
      dependents: [],
      diagnostics,
      elapsedMs: performance.now() - started,
      advisory: true,
      limits: [],
    };
  }

  /** Drop every cached parse — what a caller does when it stops trusting the disk. */
  forget(): void {
    this.cache.clear();
    this.importGraph = null;
  }

  // ── the program, and the cache under it ────────────────────────────────────

  private program(roots: readonly string[], overlay: ReadonlyMap<string, string>): ts.Program {
    const host = ts.createCompilerHost(this.options, true);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);

    // A file being *created* is touched too, and it is not on disk yet — so the
    // overlay has to answer existence, not only content.
    host.readFile = (name) => overlay.get(path.resolve(name)) ?? readFile(name);
    host.fileExists = (name) => overlay.has(path.resolve(name)) || fileExists(name);
    host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
      const abs = path.resolve(name);
      const buffer = overlay.get(abs);
      // An overlaid file is never cached: it is the thing that is changing.
      if (buffer !== undefined) return ts.createSourceFile(name, buffer, languageVersion, true, ts.ScriptKind.TS);
      const version = this.versionOf(abs);
      const hit = this.cache.get(abs);
      if (hit && version !== null && hit.version === version) return hit.file;
      const file = getSourceFile(name, languageVersion, onError, shouldCreate);
      if (file && version !== null) this.cache.set(abs, { version, file });
      return file;
    };

    return ts.createProgram(roots as string[], this.options, host);
  }

  /** `mtimeMs:size`, or null when the file is gone — a cache key, not a hash. */
  private versionOf(file: string): string | null {
    try {
      const stat = fs.statSync(file);
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return null;
    }
  }

  // ── who imports the file that just changed ────────────────────────────────

  /**
   * The project files that import any of `targets` directly.
   *
   * Built by `ts.preProcessFile` over every file in the project — a scanner, not
   * a parse — which costs ~0.17 s once and is then held for the life of the
   * checker. Only relative specifiers are followed: an import of a package is not
   * an edge inside this project, and resolving one per file per edit would cost
   * more than the check.
   *
   * The graph is rebuilt for the touched files on every call, because the edit
   * under test may be the one that adds or removes an import. Everything else is
   * assumed still to import what it imported when the checker was constructed —
   * a long-lived checker in a session where *another* file's imports changed will
   * miss the new edge until {@link forget}.
   */
  private immediateImporters(targets: readonly string[], overlay: ReadonlyMap<string, string>): string[] {
    if (!this.importGraph) {
      this.importGraph = new Map();
      for (const file of this.projectFiles) this.importGraph.set(file, this.importsOf(file, overlay));
    }
    for (const file of targets) this.importGraph.set(file, this.importsOf(file, overlay));

    const wanted = new Set(targets);
    const importers: string[] = [];
    for (const [file, imports] of this.importGraph) {
      if (wanted.has(file)) continue;
      if (imports.some((i) => wanted.has(i))) importers.push(file);
    }
    return importers;
  }

  /** The project-local files one file imports, absolute and resolved. */
  private importsOf(file: string, overlay: ReadonlyMap<string, string>): string[] {
    const text = overlay.get(file) ?? this.readOrEmpty(file);
    const out: string[] = [];
    for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
      if (!ref.fileName.startsWith(".")) continue;
      const resolved = ts.resolveModuleName(ref.fileName, file, this.options, ts.sys).resolvedModule;
      if (resolved) out.push(path.resolve(resolved.resolvedFileName));
    }
    return out;
  }

  private readOrEmpty(file: string): string {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  }

  private render(d: ts.Diagnostic): EditDiagnostic {
    const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const category = CATEGORY[d.category];
    if (!d.file || d.start === undefined) {
      return { file: "", line: 0, column: 0, code: d.code, category, message, text: `${category} TS${d.code}: ${message}` };
    }
    const at = ts.getLineAndCharacterOfPosition(d.file, d.start);
    const file = relative(this.projectRoot, d.file.fileName);
    const line = at.line + 1;
    const column = at.character + 1;
    return { file, line, column, code: d.code, category, message, text: `${file}(${line},${column}): ${category} TS${d.code}: ${message}` };
  }
}

/**
 * The verdict as a run is handed it: the diagnostics, then what was and was not
 * looked at.
 *
 * Returns `""` when nothing was found, so a hook that prints this prints nothing
 * on a clean edit. A per-edit check that narrates its own success on every write
 * is a check somebody turns off.
 */
export function formatVerdict(verdict: TypecheckVerdict): string {
  if (verdict.diagnostics.length === 0) return "";
  const scope =
    verdict.dependents.length > 0
      ? `${verdict.checked.join(", ")} and ${verdict.dependents.length} immediate dependent(s)`
      : verdict.checked.join(", ");
  return [
    `typecheck (advisory, not a gate) — ${verdict.diagnostics.length} problem(s) after this edit, in ${Math.round(verdict.elapsedMs)} ms`,
    ...verdict.diagnostics.map((d) => `  ${d.text}`),
    `checked ${scope}. ${verdict.limits.join(" ")}`,
  ].join("\n");
}
